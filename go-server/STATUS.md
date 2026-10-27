# Go 后端状态（PostgreSQL，实验性垂直切片）

> **状态：实验性（experimental）。**
> **定位：局域网自用、单账户（owner）、单实例；账号体系默认关闭，不做第三方登录（见 [`README.md`](README.md) §0）。**
> 这不是完整重写，也不能替代当前官方 InsForge + PostgreSQL 部署；它有自己明确的使用边界。
> 当前完成的是可运行的 Go HTTP 服务 + PostgreSQL 存储层，针对 v1.4.12 行为契约实现了核心垂直切片。
> **2026-10 起不再支持 SQLite**：需要单文件模式的请用归档 tag `sqlite-final`（见 §「SQLite 去哪了」）。

---

## 这次实际完成了什么

### 可运行交付

- Go **1.24+** 服务端，唯一依赖 `github.com/lib/pq v1.10.9`（PostgreSQL）。
  `TT_DATABASE_URL` 必须是 `postgres://…`；见 [`../docs/go-postgres.md`](../docs/go-postgres.md)。
- **逻辑 schema 只有一份**：`internal/store/schema.go` 里的 `schemaBody` 就是完整的
  PostgreSQL DDL（不再有引擎占位符与渲染分支）。
- `internal/store/dialect.go` + `db.go`：`DB`/`Tx` 包装层把 `?` 占位符按引擎改写成 `$n`，
  幂等插入渲染 `INSERT OR IGNORE` / `ON CONFLICT DO NOTHING`；业务代码零方言分支。
- 列类型跨引擎可互换（时间 RFC3339 UTC 文本、金额十进制文本、ID `TEXT`），
  只有布尔列在 PG 上是真 `boolean`，由 `flexibleBool` 扫描器吸收。
- 列/表规模：**16 张业务表** + 2 张迁移账本（`schema_migrations` / `schema_additions`）；
  PG 参考清单 24 张，仍未全量映射。
- 迁移账本 `schema_migrations(version, checksum)`：checksum 是 core DDL 的 sha256，
  **不伪造** PostgreSQL 15-step 安装账本；checksum 被 `TestSchemaChecksumIsPinned` 钉死。
- 连接管理：默认 16 连接池 + 启动时最多 30s 等待就绪 + `SIGTERM` 优雅关闭；
  写路径仍有进程内 `sync.Mutex`（见 §3「多实例写并发」）。
- JWT HS256 验证、过期检查、device token SHA-256 hash。
- 设备授权完整路径：authorize → poll → grant → poll(approved) → device token ingest。
- 用量上传、整行修正、幂等主键、账户/设备隔离、删除级联（两种引擎都验证了 FK cascade）。
- 账户 summary/daily/hourly/monthly/heatmap/model-breakdown/devices 的契约响应。
- 自托管免费策略与 billing catalog/account；付费/试用 RPC 明确拒绝。
- production 默认不挂载 `/_test/users`、`/_test/devices`、`/_test/sql` 等危险 fixture 端点；contract adapter 才显式开启。
- `TT_JWT_SECRET` 启动时强制至少 32 字节；`TT_DATABASE_URL` 缺失时拒绝启动并提示迁移。
- 每 case 独立实例：全新 PG schema（`tt_case_<hex>`，退出 `DROP SCHEMA CASCADE`）。
- `Dockerfile` + compose 示例（`docker-compose.postgres-go.example.yml`）；
  镜像推到 `ghcr.io/quietsugar/token-tracker-self-hosting-go:experimental[-<sha>]`；
  独立 buildx/GHCR workflow（仅 `experimental` tag，不覆盖正式镜像）。基础镜像按 OCI digest 固定。
- `.github/workflows/go-server.yml`：PostgreSQL **15/16 矩阵**，均跑 unit + 契约。
- `.github/workflows/build-go-image.yml`：amd64 构建 → **镜像 smoke（连真实 PostgreSQL）** → 通过后才推送多平台镜像（含 SBOM/provenance）。
- 已发布实验镜像 `ghcr.io/quietsugar/token-tracker-self-hosting-go:experimental`（linux/amd64+arm64，含 SBOM/provenance，不发布 latest）；推送前强制 PG smoke。
- 运维脚本：`scripts/full-test.sh`（L0–L3 全量测试）、`scripts/test-with-pg.sh`（起临时 PG）、`scripts/backup.sh`（PG 备份/恢复/清理）、
  `scripts/issue-token.sh`（自签 JWT，替换「注册登录」的替代品）。
- **官方客户端兼容（native-client E2E）**：用上游 v1.4.12 CLI 实测
  `init` / `device-login` / `sync` / `doctor` 全部通过（HTTPS + 私有 CA、以及 localhost 明文两条链路）。
  为此新增：`TT_DEVICE_APPROVE`（`jwt`/`page`/`auto`）、`/device` 批准页、
  `TT_DASHBOARD_URL` 留空时按 `Host`+`X-Forwarded-Proto` 推导（客户端要求 `verification_uri` 与
  `base_url` 同源）、`scripts/approve-device.sh`。文档 `docs/official-client.md`。
  （`/api/auth/refresh` 等会话端点随后补齐，见下方 `auth_owner` 与 §6 的 `/api/auth/*`。）
- **账户归属收敛**：`auth_owner` 单例 + 自动解析（凭据 / 首个身份），设备批准与
  注册/引导都指向它。**没有任何"默认账户"常量或环境变量**（`TT_DEFAULT_ACCOUNT`、
  `TT_OWNER_ACCOUNT` 全部删除，连同历史认领与 merge-account 的兼容路径）。
  新增 `/api/auth/owner`（仅回环，供脚本解析 sub）。
- **时区与 compact**：`account-*` 全部认 `tz` / `tz_offset_minutes`，按本地日归日
  （UTC 窗口两侧各放宽一天再裁剪）；summary 的 rolling 锚在本地今天、`days` 是本地活跃天数；
  heatmap 支持官方的 `format=compact` 稀疏线格式。
- **设备管理**：`billing?action=devices` 返回 `cloud_list_machines` 形状（含 `is_current`），
  `remove-device` / `resume-device` 暂停恢复（暂停撤销 device token），`ingest` 更新 `last_seen_at`。
- **设备维度（对齐官方）**：`account-devices` 返回每台设备一行；所有 `account-*`
  端点支持 `?device_id=<uuid>` 过滤；RPC `account_usage_grouped` 支持
  `p_device_id` / `p_device_ids`；`device-rename` 用官方的 `{device_id, device_name}` 且重名 409。
- `scripts/check-oauth.sh`：一键自检认证链路（登录 → 轮换 → 旧 token 拒绝 → 撤销 → account 读取）。
- 增量迁移机制：新增表走 `schema_additions` 账本（已发布的 step 改动即 fail closed），
  不动 core schema 的 checksum，老库升级不会 drift。新增 `auth_credentials` / `auth_sessions`。
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
- 本地 linux/amd64 镜像 smoke 已通过（CI 里由 `build-go-image.yml` 对每次构建强制执行）：`/health` 200、运行 UID 10001、`engine=postgres`、生产模式 `/_test/sql` 返回 404。
- 真实 PostgreSQL 标准环境的 L3 脚本与结果（见 `../contract/L3-RESULTS.md`）。

### 测试结果（2026-10-27，SQLite 移除后）

```
Go unit tests (-race, PostgreSQL):     PASS   # TT_TEST_DATABASE_URL 指向真实 PG
Go vet:                                PASS
Go build (CGO_ENABLED=0, linux/amd64): PASS
契约 go-postgres:  33 PASS / 0 FAIL / 2 SKIP / 0 waived
L3 真实 PG 15.18:  5 PASS / 0 FAIL
```

2 个 SKIP 是**有意且正确**的 PG 专属迁移行为：

1. `install/ledger-15-steps`：本实现不声称执行 PostgreSQL 的 15 个 SQL migration step。
2. `install/checksum-drift-refused`：PG step SQL checksum 不变规则由 PostgreSQL 安装器负责；
   本实现用 `schema_migrations(version=1, checksum=sha256(core DDL))` 做自己的 drift gate。

它们不是“忽略差异”：实现边界不同，不能伪造同一账本。schema checksum 修改会被
`TestInstallRefusesSchemaChecksumDrift` 拒绝；core DDL 的 checksum 本身由
`TestSchemaChecksumIsPinned` 钉死（改 DDL 需要同时改迁移与文档）。

### 可复现命令

```sh
cd go-server
./scripts/test-with-pg.sh --full                       # 起临时 PG 并跑全量（gofmt/vet/build/unit/契约）
# 或手工逐条：
export TT_TEST_DATABASE_URL='postgres://user:pass@127.0.0.1:5432/db?sslmode=disable'
go test -race ./...                                    # 存储层只支持 PG，没有默认库
go vet ./...
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o bin/tokentracker-server ./cmd/server

cd ..
GO_POSTGRES_URL='$TT_TEST_DATABASE_URL' \
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

Go 版本则通过独立的 33 个 HTTP 行为用例（跑在真实 PostgreSQL 15/16 上）。
它尚未接入 InsForge 平台；其 HTTP/auth/API 由本服务自己提供。这是“替代后端”的方向，
用法上就是“把官方云的 PG 换成你自己的 PG”，与 InsForge 平台无关。

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
- PG 死锁/序列化失败重试、事务中断、崩溃恢复
- 和真实 PG 15.18 的同输入“双运行 differential”自动化（现在 PG 的 L3 是并发/安装测试；行为 goldens 来自 PGlite fixture）

### 5. 非目标（out of scope，不打算做）

这些曾经被列为「阻断项」，但按**局域网自用**的定位它们不是缺口：

- **第三方登录 / 邮件验证 / 找回密码 / 多账户后台**：不做。本地账号体系（`/api/auth/*`）
  已实现，见 §6；但**不做**的是 OAuth provider、发信、密码重置、用户管理后台——
  自托管单账户场景下这些只是维护面。token 仍可用 `scripts/issue-token.sh` 自签（§1.0），
  不建账户也能上传。
- **InsForge SDK / PostgREST 兼容 API**：不做。现有 dashboard 若硬编码 InsForge endpoint，
  需要改 base URL/路由，这是使用者的适配工作，不是本服务的目标。
- **多副本 / 多实例并发**：不做。ingest 的整行修正靠进程内互斥，单实例足够；
  真要跑多副本，需要先补 `pg_advisory_xact_lock`（记在这里，不排期）。
- **公网暴露能力**（速率限制、WAF、TLS 终止）：不做。定位是内网；需要时由反代/网络层负责。

### 6. 客户端 E2E：上传链路与跨设备视图均已验收

- ✅ 已用上游 **v1.4.12 官方 CLI** 实测：`init` / `device-login` / `sync` / `doctor`，
  两条链路（`http://localhost` 明文、`https://` + 私有 CA + `NODE_EXTRA_CA_CERTS`）都通。
  设备批准三种模式（`jwt`/`page`/`auto`）与 `/device` 批准页见 `../docs/official-client.md`。
- ✅ **`/api/auth/*` 已实现**（同 InsForge 流程、自写代码）：`users` / `sessions` / `refresh`
  （轮换 + CSRF）/ `logout` / `sessions/current` / `public-config`。客户端「跨设备 account 视图」
  实测 `X-TokenTracker-Account-View: 1`（7500 tokens）。细节见 `../docs/oauth-selfhosted.md`。
- 未做（自托管非目标）：第三方 OAuth 登录、邮件验证、找回密码、多账户管理后台。
- 未验收：账号删除/恢复流程、菜单栏 App 的原生（非 CLI）路径。

---

## 升级路径（禁止直接替换正式镜像）

1. 每次改 Go handler/schema：`./scripts/test-with-pg.sh --full`（或先 export
   `TT_TEST_DATABASE_URL` 再 `go test -race ./...` + `go vet ./...`）。
2. `CONTRACT_ADAPTER=./contract/adapters/go-postgres.cjs ./contract/scripts/verify.sh`：
   必须保持 **0 FAIL**；SKIP 需人工评审。
3. `./contract/scripts/standard-env.sh up` + `./contract/scripts/standard-env-test.sh`：真实 PG L3 必须通过（测试参考实现本身，确认迁移前基线没破）。
4. 加 fuzz/property tests、跨时区/DST、并发、恢复测试；达到生产门槛前继续标为 experimental。
5. 完成 API/客户端 E2E 与安全评审后，单独发 ADR 决定是否替换当前正式 InsForge 路径。

**当前判断**：这是**有测试约束的可运行原型**，适合继续迭代和差分测试；不适合直接接真实用户或替换现有自托管生产环境。

引擎取舍的完整成本分析见 [`../docs/go-postgres.md`](../docs/go-postgres.md)；
SQLite 移除的决定与归档点见下方附录。

---

## 附录：SQLite 去哪了

2026-10-27 起本服务只支持 PostgreSQL。删除前后的事实：

| | 删除前 | 删除后 |
|---|---|---|
| 归档点 | — | tag **`sqlite-final`**（最后一次同时支持两个引擎的提交） |
| 依赖 | `modernc.org/{sqlite,libc,mathutil,memory}` | 只剩 `github.com/lib/pq`（`go.sum` 从 45 行降到 2 行） |
| 方言层 | `dialect.go` 183 行 + DDL 三占位符渲染 + `INSERT OR IGNORE` 双写 | 单一 `rewritePlaceholders`（`?`→`$n`） |
| 测试 | 默认 SQLite 文件，设了 `TT_TEST_DATABASE_URL` 才跑 PG | **必须**给 PG（`scripts/test-with-pg.sh`），没有默认库 |
| CI | sqlite job + postgres 15/16 矩阵 | postgres 15/16 矩阵 |
| 契约 adapter | `go-sqlite.cjs` / `go-postgres.cjs` | 只留 `go-postgres.cjs` |
| 镜像 smoke | SQLite + PG 双模式 | PG 单模式 |
| 备份 | `backup.sh sqlite\|postgres` | `backup.sh postgres` |

**为什么删**：双引擎会悄悄降低唯一在用那条路径的保真度——SQLite 分支的测试通过率
不能证明 PG 上的并发/类型/约束语义正确，却让人误以为"两种引擎都验证过了"；
同时它把方言层、双份 CI、双份 compose、双份契约 adapter 的成本摊到了每个改动上。
代价只有一个：`go test` 不能再零依赖跑（见上表）。

需要 SQLite 形态（单文件、零外部依赖）的人：`git checkout sqlite-final`，那是完整可用的
最后版本；从该版本迁到新版没有自动搬数工具（见 README §9 第 6 条）。
