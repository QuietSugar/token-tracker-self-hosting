# Go + SQLite 后端状态（实验性垂直切片）

> **状态：实验性、未达生产 GA。** 这不是完整重写，也不能替代当前官方 InsForge + PostgreSQL 部署。
> 当前完成的是可运行的 Go HTTP 服务 + SQLite 存储层，针对 v1.4.12 行为契约实现了核心垂直切片。

---

## 这次实际完成了什么

### 可运行交付

- Go **1.24.4** 服务端，`modernc.org/sqlite v1.34.5` 纯 Go SQLite 驱动（CGO=0）。
- SQLite schema（当前 14 张表，PG 静态清单有 24 张）+ 外键 + WAL + 单连接写事务；Go `sync.Mutex` 串行化上传/设备签发，替代已测 PG advisory lock 的关键串行语义。
- SQLite 自有 `schema_migrations(version, checksum)`；**不伪造** PostgreSQL 15-step 安装账本。测试会拒绝 SQLite schema checksum drift。
- JWT HS256 验证、过期检查、device token SHA-256 hash。
- 设备授权完整路径：authorize → poll → grant → poll(approved) → device token ingest。
- 用量上传、整行修正、幂等主键、账户/设备隔离、删除级联。
- 账户 summary/daily/hourly/monthly/heatmap/model-breakdown/devices 的契约响应。
- 自托管免费策略与 billing catalog/account；付费/试用 RPC 明确拒绝。
- production 默认不挂载 `/_test/users`、`/_test/devices`、`/_test/sql` 等危险 fixture 端点；contract adapter 才显式开启。
- `TT_JWT_SECRET` 启动时强制至少 32 字节；SQLite DB/WAL/SHM 文件默认 owner-only 权限。
- 每 case 独立 SQLite 文件的 contract adapter。
- `Dockerfile` + compose 示例；独立 buildx/GHCR workflow（仅 `experimental` tag，不覆盖正式镜像）。基础镜像按 OCI digest 固定，运行层不再安装浮动 apk 包。
- 本地 linux/amd64 镜像 smoke 已通过：`/health` 200、运行 UID 10001、SQLite DB/WAL/SHM 为 0600、生产模式 `/_test/sql` 返回 404。
- 真实 PostgreSQL 标准环境的 L3 脚本与结果（见 `../contract/L3-RESULTS.md`）。

### 测试结果（2026-10-26）

```
Go unit tests (-race): PASS
Go vet: PASS
Go build (CGO_ENABLED=0, linux/amd64): PASS
契约：33 PASS / 0 FAIL / 2 SKIP / 0 waived
L3 真实 PG 15.18：5 PASS / 0 FAIL
```

2 个 SKIP 是**有意且正确**的 PG 专属迁移行为：

1. `install/ledger-15-steps`：SQLite 不声称执行 PostgreSQL 的 15 个 SQL migration step。
2. `install/checksum-drift-refused`：PG step SQL checksum 不变规则由 PostgreSQL 安装器负责；SQLite 用 `schema_migrations(version=1, checksum=sha256(Go schema))` 做自己的 drift gate。

它们不是“忽略差异”：实现边界不同，不能伪造同一账本。Go SQLite schema 的 checksum 修改会被 `TestInstallRefusesSQLiteSchemaChecksumDrift` 拒绝。

### 可复现命令

```sh
cd go-server
go test -race ./...
go vet ./...
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o bin/tokentracker-server ./cmd/server

cd ..
CONTRACT_ADAPTER=./contract/adapters/go-sqlite.cjs \
  ./contract/scripts/verify.sh
```

Docker：

```sh
cd go-server
docker build -f Dockerfile -t tokentracker-go-sqlite:experimental .
```

---

## 真实标准环境与 SQLite 验收必须分开看

本次启动了**官方 InsForge v2.3.3 标准 Compose 栈**：

- `ghcr.io/insforge/postgres:v15.13.4`（实际 PostgreSQL **15.18**）
- `postgrest/postgrest:v12.2.12`
- `ghcr.io/insforge/insforge-oss:v2.3.3`（Compose 原文 `latest`，本次实验临时 pin 到 v2.3.3）
- Deno 2.0.6

它用于验证**正式 PG 实现**与 L3 多连接语义。官方应用 SQL 15 步安装、二次幂等重装、8 连接并发重装、advisory lock 竞争、RLS ACL 与并发 upsert 均在真实 PG 通过。

Go+SQLite 版本则通过独立的 33 个 HTTP 行为用例。它尚未接入 InsForge 平台；其 HTTP/auth/API 由本服务自己提供。这是“替代后端”的方向，不是 InsForge 上的 SQLite。

> 沙箱的 Docker 容器不能直接访问公网 DNS。官方 Deno runtime 的 `deno.land` 依赖由宿主机预缓存到 Docker volume 后启动。此实验特定 workaround 不应被误写成普通 VPS 的必需步骤。

---

## 仍然缺什么（生产阻断项）

### 1. 数据模型不完整

`internal/store/schema.go` 目前实现核心路径所需的 SQLite 表，不等于 PG 24 表的完整映射。完整 PG 静态契约见 `../contract/golden/1.4.12/static.json`。例如尚未完整等价实现：

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
- 浮点 numeric 精度、cost rounding 的边界矩阵

### 3. 安全与运维审查

- 仍需独立威胁建模：跨账户读写、SQLite 文件权限、JWT secret 轮换、token revoke、速率限制、审计日志、DB corruption 恢复。
- `_test/*` 仅 `TT_ENABLE_TEST_ENDPOINTS=true` 时挂载；**production 必须保持 unset/false**。其中 `/_test/sql` 可执行任意 SQL，绝不能暴露。
- SQLite WAL 在多进程部署/网络文件系统上的限制未验收；当前设计是单进程单文件。
- 未验证断电恢复、文件系统损坏、磁盘满、并发进程访问和备份一致性。

### 4. 全量行为矩阵还不够

35 个用例是第一批 characterization suite，不是形式化证明。缺：

- 大批量 fuzz/property-based、随机化输入与边界值笛卡尔积
- DST 转换日、跨时区周/月边界、闰日
- 10k/100k row 规模、并发连接压力、长时间 soak
- SQLite busy/locked 重试、事务中断、崩溃恢复
- 和真实 PG 15.18 的同输入“双运行 differential”自动化（现在 PG 的 L3 是并发/安装测试；行为 goldens 来自 PGlite fixture）

### 5. API 兼容性 / 客户端验收

- **尚无账户 signup/signin/password reset/OAuth 服务**。目前 JWT 测试令牌用于 contract adapter；不能让新用户自行注册/登录。
- 原生客户端的真实 base URL/config 路由、设备授权浏览器页、回调还未对 Go server 做 E2E。
- Go server 不是 InsForge SDK/PostgREST API 的完整替代；现有 dashboard 若硬编码 InsForge endpoint，仍需路由适配层/前端改造。
- HTTPS、反向代理、账号删除恢复流程均未验收。

---

## 升级路径（禁止直接替换正式镜像）

1. 每次改 Go handler/schema：先 `go test -race ./...` + `go vet ./...`。
2. `CONTRACT_ADAPTER=./contract/adapters/go-sqlite.cjs ./contract/scripts/verify.sh`：必须保持 **0 FAIL**；SKIP 需人工评审。
3. `./contract/scripts/standard-env.sh up` + `./contract/scripts/standard-env-test.sh`：真实 PG L3 必须通过（测试参考实现本身，确认迁移前基线没破）。
4. 加 fuzz/property tests、跨时区/DST、并发、恢复测试；达到生产门槛前继续标为 experimental。
5. 完成 API/客户端 E2E 与安全评审后，单独发 ADR 决定是否替换当前正式 InsForge 路径。

**当前判断**：这是**有测试约束的可运行原型**，适合继续迭代和差分测试；不适合直接接真实用户或替换现有自托管生产环境。
