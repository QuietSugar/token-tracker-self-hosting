# Go 后端状态（SQLite + PostgreSQL，实验性垂直切片）

> **状态：实验性（experimental）。**
> **定位：局域网自用、单用户、单实例；不做注册登录（见 [`README.md`](README.md) §0）。**
> 这不是完整重写，也不能替代当前官方 InsForge + PostgreSQL 部署；它有自己明确的使用边界。
> 当前完成的是可运行的 Go HTTP 服务 + 双引擎存储层（SQLite / PostgreSQL），针对 v1.4.12 行为契约实现了核心垂直切片。

---

## 这次实际完成了什么

### 可运行交付

- Go **1.24+** 服务端，同一个二进制内置两种驱动：
  - `modernc.org/sqlite v1.34.5`（纯 Go，CGO=0）
  - `github.com/lib/pq v1.10.9`（PostgreSQL）
  用 `TT_DATABASE_URL` 选择引擎（`postgres://…` 或 SQLite 路径）；见 [`../docs/go-postgres.md`](../docs/go-postgres.md)。
- **逻辑 schema 只有一份**：`internal/store/schema.go` 里通过
  `{{ENGINE}}` / `{{BOOL}}` / `{{FALSE}}` 三个占位符按引擎渲染；
  SQLite 额外拼 `PRAGMA foreign_keys / journal_mode=WAL / busy_timeout`。
- `internal/store/dialect.go` + `db.go`：`DB`/`Tx` 包装层把 `?` 占位符按引擎改写成 `$n`，
  幂等插入渲染 `INSERT OR IGNORE` / `ON CONFLICT DO NOTHING`；业务代码零方言分支。
- 列类型跨引擎可互换（时间 RFC3339 UTC 文本、金额十进制文本、ID `TEXT`），
  只有布尔列在 PG 上是真 `boolean`，由 `flexibleBool` 扫描器吸收。
- 列/表规模与之前一致（SQLite 14 张表；PG 静态清单 24 张，仍未全量映射）。
- 迁移账本 `schema_migrations(version, checksum)`：checksum 是**该引擎渲染后 DDL** 的 sha256；
  **不伪造** PostgreSQL 15-step 安装账本。引入 PG 支持时 SQLite 渲染结果逐字节未变，
  因此既有 SQLite 实例不会因 checksum 漂移拒绝启动（有回归测试锁死）。
- 连接管理：SQLite `MaxOpenConns=1` + Go `sync.Mutex` 串行化写；
  PG 默认 16 连接池 + 启动时最多 30s 等待就绪 + `SIGTERM` 优雅关闭。
- JWT HS256 验证、过期检查、device token SHA-256 hash。
- 设备授权完整路径：authorize → poll → grant → poll(approved) → device token ingest。
- 用量上传、整行修正、幂等主键、账户/设备隔离、删除级联（两种引擎都验证了 FK cascade）。
- 账户 summary/daily/hourly/monthly/heatmap/model-breakdown/devices 的契约响应。
- 自托管免费策略与 billing catalog/account；付费/试用 RPC 明确拒绝。
- production 默认不挂载 `/_test/users`、`/_test/devices`、`/_test/sql` 等危险 fixture 端点；contract adapter 才显式开启。
- `TT_JWT_SECRET` 启动时强制至少 32 字节；SQLite DB/WAL/SHM 文件默认 owner-only 权限。
- 每 case 独立实例：SQLite 用全新文件，PG 用全新 schema（`tt_case_<hex>`，退出 `DROP SCHEMA CASCADE`）。
- `Dockerfile` + 两个 compose 示例（`docker-compose.sqlite-go.example.yml` / `docker-compose.postgres-go.example.yml`）；
  镜像推到 `ghcr.io/quietsugar/token-tracker-self-hosting-go:experimental[-<sha>]`（旧名 `-sqlite-go` 同步推送兼容）；
  独立 buildx/GHCR workflow（仅 `experimental` tag，不覆盖正式镜像）。基础镜像按 OCI digest 固定。
- 新增 `.github/workflows/go-server.yml`：SQLite 一份流水线 + PostgreSQL **15/16 矩阵**各一份，均跑 unit + 契约。
- 新增 `.github/workflows/build-go-image.yml`：amd64 构建 → **镜像 smoke（SQLite 模式 + PostgreSQL 模式）** → 通过后才推送多平台镜像（含 SBOM/provenance）。
- 已发布实验镜像 `ghcr.io/quietsugar/token-tracker-self-hosting-go:experimental`（linux/amd64+arm64，含 SBOM/provenance，不发布 latest）；推送前强制 SQLite+PG 双模式 smoke。
- 新增运维脚本：`scripts/full-test.sh`（L0–L5 全量测试）、`scripts/backup.sh`（SQLite/PG 备份/恢复/清理）、
  `scripts/issue-token.sh`（自签 JWT，替换「注册登录」的替代品）。
- **官方客户端兼容（native-client E2E）**：用上游 v1.4.12 CLI 实测
  `init` / `device-login` / `sync` / `doctor` 全部通过（HTTPS + 私有 CA、以及 localhost 明文两条链路）。
  为此新增：`TT_DEVICE_APPROVE`（`jwt`/`page`/`auto`）、`/device` 批准页、
  `TT_DASHBOARD_URL` 留空时按 `Host`+`X-Forwarded-Proto` 推导（客户端要求 `verification_uri` 与
  `base_url` 同源）、`scripts/approve-device.sh`。文档 `docs/official-client.md`。
  **仍缺**：`/api/auth/refresh` 与 OAuth 会话，所以客户端「跨设备 account 视图」在自托管下不可用
  （上传与本机视图不受影响）。
- `scripts/import-usage.py`：把本地已有用量（CSV/JSONL/JSON）导入服务，含时间归一化（任意时区→UTC 整点）、
  列名别名、按主键去重、自动分批（≤500/批、≤512KB）、退避重试、device token 缓存；
  与服务端的「整行替换」语义配合，可反复重跑不重复计数。用于**接入真实数据**（见 README §3.5）。
- **修复**：`device-token-issue` / 设备授权 grant 在账户行不存在时因 `devices.user_id` 外键失败
  （契约用例都预先建了用户，所以没覆盖到）→ 新增 `ensureAccount()` 幂等建账，
  局域网首次使用可直接接通。回归测试 `TestDeviceIssueCreatesAccountOnFirstUse`。
- **修复**：同名设备/同 `machine_id` 重复调 `device-token-issue` 会撞 partial unique index 返回 500
  （客户端重装、重新登录、导入脚本重跑都会触发）→ 改为**复用已有 active 设备行并新签 token**，
  `cloud_machines` 也做去重。回归测试 `TestDeviceIssueIsRepeatableForSameDevice`。
- **面向使用者的部署运维手册：[`README.md`](README.md)**（快速开始、配置、反代、备份恢复、升级、监控、安全清单、排错、已知限制）。
- 本地 linux/amd64 镜像 smoke 已通过（CI 里由 `build-go-image.yml` 对每次构建强制执行 SQLite + PG 两种模式）：`/health` 200、运行 UID 10001、SQLite DB/WAL/SHM 为 0600、生产模式 `/_test/sql` 返回 404。
- 真实 PostgreSQL 标准环境的 L3 脚本与结果（见 `../contract/L3-RESULTS.md`）。

### 测试结果（2026-10-26）

```
Go unit tests (-race, SQLite):        PASS
Go unit tests (-race, PostgreSQL 16.2): PASS   # TT_TEST_DATABASE_URL 指向真实 PG
Go vet:                               PASS
Go build (CGO_ENABLED=0, linux/amd64): PASS
契约 go-sqlite:    33 PASS / 0 FAIL / 2 SKIP / 0 waived
契约 go-postgres:  33 PASS / 0 FAIL / 2 SKIP / 0 waived
L3 真实 PG 15.18:  5 PASS / 0 FAIL
```

2 个 SKIP 是**有意且正确**的 PG 专属迁移行为：

1. `install/ledger-15-steps`：本实现不声称执行 PostgreSQL 的 15 个 SQL migration step。
2. `install/checksum-drift-refused`：PG step SQL checksum 不变规则由 PostgreSQL 安装器负责；
   本实现用 `schema_migrations(version=1, checksum=sha256(渲染后 DDL))` 做自己的 drift gate。

它们不是“忽略差异”：实现边界不同，不能伪造同一账本。schema checksum 修改会被
`TestInstallRefusesSchemaChecksumDrift` 拒绝，SQLite 字节兼容性由
`TestSQLiteSchemaStaysByteCompatibleWithV1` 锁死。

### 可复现命令

```sh
cd go-server
./scripts/full-test.sh                                 # 全量：gofmt/vet/build/unit×2引擎/契约×2引擎/docker smoke
# 或手工逐条：
go test -race ./...                                    # SQLite
TT_TEST_DATABASE_URL='postgres://user:pass@127.0.0.1:5432/db?sslmode=disable' \
  go test -race ./...                                   # 同一批测试跑在真实 PostgreSQL
go vet ./...
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o bin/tokentracker-server ./cmd/server

cd ..
CONTRACT_ADAPTER=./contract/adapters/go-sqlite.cjs ./contract/scripts/verify.sh
GO_POSTGRES_URL='postgres://user:pass@127.0.0.1:5432/db?sslmode=disable' \
  CONTRACT_ADAPTER=./contract/adapters/go-postgres.cjs ./contract/scripts/verify.sh
```

Docker：

```sh
cd go-server
docker build -f Dockerfile -t tokentracker-go:experimental .
docker compose -f docker-compose.postgres-go.example.yml up -d   # PG 示例
```

---

## 真实标准环境与本地引擎验收必须分开看

本次启动了**官方 InsForge v2.3.3 标准 Compose 栈**：

- `ghcr.io/insforge/postgres:v15.13.4`（实际 PostgreSQL **15.18**）
- `postgrest/postgrest:v12.2.12`
- `ghcr.io/insforge/insforge-oss:v2.3.3`（Compose 原文 `latest`，本次实验临时 pin 到 v2.3.3）
- Deno 2.0.6

它用于验证**正式 PG 实现**与 L3 多连接语义。官方应用 SQL 15 步安装、二次幂等重装、8 连接并发重装、advisory lock 竞争、RLS ACL 与并发 upsert 均在真实 PG 通过。

Go 版本则通过独立的 33 个 HTTP 行为用例（SQLite 与 PostgreSQL 各跑一遍）。
它尚未接入 InsForge 平台；其 HTTP/auth/API 由本服务自己提供。这是“替代后端”的方向，
用法上只是“数据库可以是 PG 或 SQLite”，不是 InsForge 上的 SQLite。

> 沙箱的 Docker 容器不能直接访问公网 DNS。官方 Deno runtime 的 `deno.land` 依赖由宿主机预缓存到 Docker volume 后启动。此实验特定 workaround 不应被误写成普通 VPS 的必需步骤。

---

## 仍然缺什么（自用也需要补的）

### 1. 数据模型不完整

`internal/store/schema.go` 目前实现核心路径所需的表，不等于 PG 24 表的完整映射。完整 PG 静态契约见 `../contract/golden/1.4.12/static.json`。例如尚未完整等价实现：

- account session states / session snapshot / cache invalidation trigger
- 赠送码审计表、Waffo 授权审计表、订单/支付兼容表的完整列与约束
- 全部索引、partial unique index 语义、触发器与 cascade 策略
- 完整迁移升级图与备份恢复格式

### 2. 聚合语义仍需扩充

已通过目前用例的核心 summary/daily/model/tz/off-peak 路径，但尚缺：

- 全量 pricing catalog 与所有 provider 定价（当前未定价模型按 `unpriced`）
- cursor account-level session state 去重/合并语义
- session states 上传和 14 个函数的所有参数/错误边界
- model-breakdown、heatmap 对大数据量/分页/历史限制的完整支持
- 浮点 numeric 精度、cost rounding 的边界矩阵（两种引擎目前都用十进制文本规避差异）

### 3. 安全与运维审查

- 仍需独立威胁建模：跨账户读写、JWT secret 轮换、token revoke、速率限制、审计日志、DB corruption 恢复。
- `_test/*` 仅 `TT_ENABLE_TEST_ENDPOINTS=true` 时挂载；**production 必须保持 unset/false**。其中 `/_test/sql` 可执行任意 SQL，绝不能暴露。
- SQLite：WAL 在多进程部署/网络文件系统上的限制未验收；当前设计是单进程单文件。
- PostgreSQL：未验收备份/恢复（`pg_dump`/PITR 流程）、连接池调参、长事务/锁竞争表现、
  大版本升级窗口；也未在托管 PG（RDS/Neon 等）上验收。
- **多实例写并发**：ingest 的整行修正（DELETE + INSERT）目前靠**进程内** `sync.Mutex` 串行化。
  PG 上跑了多个服务实例时，不同进程之间没有 `pg_advisory_xact_lock`，同一主键的修正可能互相
  覆盖（表现为行被跳过/丢失最新值）。单实例部署没有这个问题；多实例前必须补 advisory lock。
- 未验证断电恢复、文件系统损坏、磁盘满、并发进程访问和备份一致性。

### 4. 全量行为矩阵还不够

33 个用例是第一批 characterization suite，不是形式化证明。缺：

- 大批量 fuzz/property-based、随机化输入与边界值笛卡尔积
- DST 转换日、跨时区周/月边界、闰日
- 10k/100k row 规模、并发连接压力、长时间 soak
- SQLite busy/locked 重试、事务中断、崩溃恢复；PG 死锁/序列化失败重试
- 和真实 PG 15.18 的同输入“双运行 differential”自动化（现在 PG 的 L3 是并发/安装测试；行为 goldens 来自 PGlite fixture）

### 5. 非目标（out of scope，不打算做）

这些曾经被列为「阻断项」，但按**局域网自用**的定位它们不是缺口：

- **账户 signup/signin/password reset/OAuth**：不做。token 由 `scripts/issue-token.sh` 用
  `TT_JWT_SECRET` 自签（§1.0），首次使用自动建账户行。将来若要接正式认证，
  接入点在 `Server.auth()` 与 ingest 的 device token 校验，属于明确的增量改动。
- **InsForge SDK / PostgREST 兼容 API**：不做。现有 dashboard 若硬编码 InsForge endpoint，
  需要改 base URL/路由，这是使用者的适配工作，不是本服务的目标。
- **多副本 / 多实例并发**：不做。ingest 的整行修正靠进程内互斥，单实例足够；
  真要跑多副本，需要先补 `pg_advisory_xact_lock`（记在这里，不排期）。
- **公网暴露能力**（速率限制、WAF、TLS 终止）：不做。定位是内网；需要时由反代/网络层负责。

### 6. 客户端 E2E：已验收上传链路，跨设备视图未接

- ✅ 已用上游 **v1.4.12 官方 CLI** 实测：`init` / `device-login` / `sync` / `doctor`，
  两条链路（`http://localhost` 明文、`https://` + 私有 CA + `NODE_EXTRA_CA_CERTS`）都通。
  设备批准三种模式（`jwt`/`page`/`auto`）与 `/device` 批准页见 `../docs/official-client.md`。
- ❌ **未实现 `/api/auth/refresh`**（官方 InsForge OAuth 层）：客户端「跨设备 account 视图」
  在自托管下退回本机视图。补齐它不需要改客户端，是纯服务端工作。
- 未验收：账号删除/恢复流程、菜单栏 App 的原生（非 CLI）路径。

---

## 升级路径（禁止直接替换正式镜像）

1. 每次改 Go handler/schema：先 `go test -race ./...` + `go vet ./...`（**两种引擎都要跑**：
   默认 SQLite；`TT_TEST_DATABASE_URL` 指向 PG 再跑一遍）。
2. `CONTRACT_ADAPTER=./contract/adapters/go-sqlite.cjs ./contract/scripts/verify.sh` 与
   `CONTRACT_ADAPTER=./contract/adapters/go-postgres.cjs ./contract/scripts/verify.sh`：
   必须都保持 **0 FAIL**；SKIP 需人工评审。
3. `./contract/scripts/standard-env.sh up` + `./contract/scripts/standard-env-test.sh`：真实 PG L3 必须通过（测试参考实现本身，确认迁移前基线没破）。
4. 加 fuzz/property tests、跨时区/DST、并发、恢复测试；达到生产门槛前继续标为 experimental。
5. 完成 API/客户端 E2E 与安全评审后，单独发 ADR 决定是否替换当前正式 InsForge 路径。

**当前判断**：这是**有测试约束的可运行原型**，适合继续迭代和差分测试；不适合直接接真实用户或替换现有自托管生产环境。

引擎取舍的完整成本分析（含“是否删掉 SQLite”）见 [`../docs/go-postgres.md`](../docs/go-postgres.md)。
