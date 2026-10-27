# 变更记录

本文件记录**本运维仓库自身**的变更，不记录上游发布（上游版本见 `tracking/upstream.md`）。

## 2026-10-27 — 接入真实数据：导入脚本 + 设备重复签发修复

用户要"真实使用 go+postgres 版本、把真实数据接进去"。为此补上「数据怎么进来」这一段。

### 新增 `go-server/scripts/import-usage.py`（独立工具，不改主体程序）

- 输入：CSV/TSV（列名别名，大小写/下划线不敏感）、JSONL/NDJSON、JSON 数组（含 `{"buckets":[...]}` 包裹）。
- 时间归一化：带偏移/空格分隔/epoch 秒毫秒 → **UTC 整点**（服务端按字符串比较时间，非 UTC 会查不到）。
- 缺字段兜底：`total_tokens` 按 input+output+reasoning+cache_creation 计算；cost 支持 `$`/千分位。
- 去重与幂等：批内按 `(hour_start,source,model)` 去重；重跑靠服务端整行替换，不重复计数。
- 自动分批（默认 200，上限 500，≤512KB）、网络/5xx 退避重试 4 次、401 自动重签一次。
- device token 缓存 `~/.cache/token-tracker/device-tokens.json`（0600），重跑不会撞「同名设备已存在」。
- `--dry-run` / `--since` / `--until`（只给日期时 since 取 00:00、until 含当天）。
- 实测：CSV 5 行（1 行坏时间）→ 4 条入库，summary 41200 tokens / cost 1.07；
  重跑 3 次数据不变；1200 行自动去重为 600 键并分 2 批上传。

### 修复：同名设备重复签发

`device-token-issue`（以及设备授权 grant）在 `(user, machine_id)` 或 `(user, platform, device_name)`
已存在时直接 500（`UNIQUE constraint failed`）。客户端重装 / 重新登录 / 导入脚本重跑都会踩到。
改为复用已有 active 设备行 + 新签 token，`cloud_machines` 同样去重；契约用例未覆盖该场景，行为变更已记录。
回归测试 `TestDeviceIssueIsRepeatableForSameDevice`（3 次调用：同 device_id、3 个不同 token、1 台设备、1 台机器）。

### 文档

- `go-server/README.md` 新增 **§3.5 把已有用量数据导进来**：三步导入、格式与列名别名表、
  数据处理语义（时间归一化/去重/幂等）、设备与 token 缓存、常见报错、定时推送示例。

---

## 2026-10-27 — 定位澄清：局域网自用（不做注册登录）+ 首次使用可用性修复

用户明确：本项目定位是**自己部署到局域网、自己使用，不涉及注册登录**；主体程序尽量少改；HTTPS 不用管。

### 代码（2 处，均为非认证改动）

- **修复**：`device-token-issue` 与设备授权 `grant` 在 `auth_users` 无对应行时，
  因 `devices.user_id` 外键约束直接失败（`FOREIGN KEY constraint failed`），
  表现为「服务装好了却传不上去」。契约用例都会先建用户，所以从未覆盖到这条真实路径。
  新增幂等 `ensureAccount(sub)`，首次使用自动建账户行；**不改变任何认证语义**。
  回归测试：`TestDeviceIssueCreatesAccountOnFirstUse`（无预置账户 → 签发 → 上传 → 读回 1234 tokens → 无 token 仍 401）。
- 未新增 schema、未改契约/golden、未加任何认证开关；`TT_LOCAL_ACCOUNT` 等想法按用户要求**未实施**。

### 新增脚本（独立工具，不进主体程序）

- `go-server/scripts/issue-token.sh`：用 `TT_JWT_SECRET` 自签长期 JWT（默认 365 天、
  固定 `sub`、`--json` 只输出 token、`--role project_admin` 供 RPC 使用），并打印 curl 示例。
  这是「没有登录」场景的官方替代路径，将来接正式认证后可直接弃用。

### 文档

- `go-server/README.md`：§0 改为「定位：局域网自用」（无注册登录=设计选择、不多租户、
  不假设公网入口、不做计费），并说明将来接认证的接入点；新增 §1.0「先拿到 token」+ 完整最小流程
  （JWT → device token → ingest → summary，已实测跑通）。
- `go-server/STATUS.md`：signup/signin、InsForge/PostgREST 兼容、多副本锁、公网暴露能力
  从「生产阻断项」移入 **§5 非目标**；阻断项只留数据模型、聚合语义、安全/运维、行为矩阵、客户端 E2E。
- `docs/go-postgres.md`、根 `README.md`：补充定位前提。
- HTTPS：不写证书/反代教程，安全清单只保留一句「纯内网可信时可不启用，跨网络访问请自行加 TLS」。

### 验收

```
go vet / gofmt / CGO=0 build            PASS
go test -race（SQLite + PostgreSQL）    PASS（含新回归测试）
契约 go-sqlite / go-postgres            33 PASS / 0 FAIL / 2 SKIP（不变）
局域网最小流程手工验证                  JWT → device token → ingest → summary 看到数据
```

---

## 2026-10-27 — 首个 Go 实验镜像已发布（SQLite + PostgreSQL 双引擎）

- 全量测试（本地 + CI）全绿：

  | 项 | 结果 |
  |---|---|
  | `gofmt` / `go vet` / `CGO_ENABLED=0` build | PASS |
  | `go test -race`（SQLite） | PASS |
  | `go test -race`（PostgreSQL 16.2） | PASS |
  | 契约 `go-sqlite` | 33 PASS / 0 FAIL / 2 SKIP |
  | 契约 `go-postgres` | 33 PASS / 0 FAIL / 2 SKIP |
  | CI `go-server`（SQLite + PostgreSQL 15/16 矩阵） | PASS（[run](https://github.com/QuietSugar/token-tracker-self-hosting/actions/runs/40425780611)） |
  | 镜像 smoke（SQLite + PostgreSQL 双模式） | PASS（[run](https://github.com/QuietSugar/token-tracker-self-hosting/actions/runs/40426622276)） |
  | Docker 镜像构建 + 多平台推送 + provenance | PASS（[run](https://github.com/QuietSugar/token-tracker-self-hosting/actions/runs/40426828540)） |
  | 备份/恢复演练 | SQLite 快照可启动；PG `pg_dump -Fc` → drop → `pg_restore` 后 14 表 + checksum 一致 |

- 已发布镜像（实验通道）：`ghcr.io/quietsugar/token-tracker-self-hosting-go:experimental`、
  `:experimental-<short_sha>`、`:sha-<short_sha>`，以及兼容名
  `ghcr.io/quietsugar/token-tracker-self-hosting-sqlite-go:experimental`；平台 `linux/amd64` + `linux/arm64`；
  不发布 `latest`。digest 见构建 run 的 job summary；可用 `gh attestation verify` 校验来源。
- 镜像 smoke 曾经失败并修复（记录了踩坑，避免回归）：宿主机 runner 用户读不到容器内 uid 10001 的 0600 文件、
  WAL 模式下表名只在 `-wal` 里、`alpine` 的 busybox `grep` 行为差异 → 改为
  「优雅停服 → 主库大小 > 8KB → 重启 → health 200 → 无 checksum drift」。

---

## 2026-10-27 — Go 镜像流水线 + 面向使用者的运维文档 + 全量测试脚本

### 新增

- `.github/workflows/build-go-image.yml`：amd64 构建 → **容器 smoke（SQLite 模式 + PostgreSQL 模式）** →
  通过后才推送 `linux/amd64,linux/arm64` 镜像到 GHCR（SBOM + provenance）。
  镜像名 `ghcr.io/quietsugar/token-tracker-self-hosting-go:experimental[-<sha>]`，
  同时推送旧名 `-sqlite-go:experimental` 以兼容早期 compose；**不发布 `latest`**。
- `go-server/README.md`：使用者手册（快速开始、环境变量、JWT 约定、反代/TLS、备份恢复、升级、
  systemd、健康检查/日志、安全清单、故障排查表、已知限制、卸载）。
- `go-server/scripts/full-test.sh`：L0 gofmt/vet/build → L1 unit(SQLite) → L2 unit(PostgreSQL) →
  L3/L4 契约（两引擎）→ L5 Docker smoke；输出 PASS/FAIL/SKIP 汇总表。
- `go-server/scripts/backup.sh`：SQLite 在线快照、PostgreSQL `pg_dump -Fc`、恢复、按天清理。
- `go-server/.dockerignore`：构建上下文排除 `bin/`、`.db`、`.env` 等。

### 变更

- 两个 compose 示例改用新镜像名；sqlite 示例去掉内联 build（改为注释，默认拉镜像）。
- 文档同步：`go-server/STATUS.md`、`docs/go-postgres.md`、`docs/HANDOFF.md`、根 `README.md`。

### 验收（本地全量）

```
gofmt / go vet / CGO=0 build            PASS
go test -race（SQLite）                  PASS
go test -race（PostgreSQL 16.2）         PASS
契约 go-sqlite                          33 PASS / 0 FAIL / 2 SKIP
契约 go-postgres                        33 PASS / 0 FAIL / 2 SKIP
Docker 镜像 smoke                       本沙箱无 docker → SKIP（由 CI 强制）
备份/恢复演练                             SQLite 快照可启动；PG dump→drop→restore 后 14 表与 checksum 一致
```

---

## 2026-10-26 — Go 后端支持 PostgreSQL（双引擎，同一份代码）

用户要求：Go 版本支持 PostgreSQL；并问「支持 PG 是否更简单」「不再支持 SQLite 是否降低维护成本」。

### 实现

- `go-server/internal/store` 新增方言层：
  - `dialect.go`：`Dialect`（sqlite/postgres）、DSN 推断、`?`→`$n` 占位符改写
    （跳过字符串/标识符/注释/美元引号，表驱动单测覆盖）。
  - `db.go`：`DB`/`Tx` 包装（所有 SQL 自动按方言改写）、连接池
    （SQLite 单连接；PG 16 连接 + 30s 启动等待）、可选 PG schema 隔离、优雅关闭。
  - `schema.go`：DDL 仍是**唯一一份**，用 `{{ENGINE}}` / `{{BOOL}}` / `{{FALSE}}`
    三个占位符按引擎渲染；SQLite 的 `PRAGMA` 只在该引擎拼入。
- 启动配置：`TT_DATABASE_URL`（`postgres://…` 或 SQLite 路径）、`TT_DATABASE_DRIVER`、
  `TT_POSTGRES_SCHEMA[_EPHEMERAL]`；`TT_DATABASE_PATH` 保留兼容。启动日志脱敏密码。
- 幂等插入 `INSERT OR IGNORE` → `store.DB.InsertIgnore`（PG 走 `ON CONFLICT DO NOTHING`）；
  PG 布尔列由 `flexibleBool` 吸收。
- **不再支持 SQLite？未做此决定**：SQLite 渲染结果逐字节未变（checksum 不变，既有实例可原地升级），
  成本分析见 `docs/go-postgres.md` §5。

### 验收

- 新增 `contract/adapters/go-postgres.cjs`：每个用例起独立 schema（`tt_case_<hex>`），退出 `DROP SCHEMA CASCADE`。
- Go unit `-race`（SQLite）PASS；同一批测试切到真实 PostgreSQL 16.2 也 PASS。
- 契约：`go-sqlite` **33 PASS / 0 FAIL / 2 SKIP**；`go-postgres` **33 PASS / 0 FAIL / 2 SKIP**。
- 新增 `.github/workflows/go-server.yml`：SQLite 流水线 + PostgreSQL **15 / 16** 矩阵（unit + 契约）。

### 文档/配置

- 新增 `docs/go-postgres.md`（用法、架构、验证证据、运维差异、维护成本问答）。
- 新增 `go-server/docker-compose.postgres-go.example.yml`；`go-server/Dockerfile` 说明同一镜像双驱动。
- 更新 `go-server/STATUS.md`、`docs/database-choice.md`、`MAINTENANCE.md` §11、`contract/README.md`、`README.md`。

---

## 2026-10-26 — 真实标准环境 + Go/SQLite 垂直切片 + 文档现实审计

用户要求：① 运行真实标准环境；② 实现 SQLite + Go 版本；③ 按真实项目状态反审文档/规则。

### 1) 真实标准环境（不是 PGlite）

- 安装并启动官方 InsForge **v2.3.3** 四容器栈；PostgreSQL 实际 **15.18**、PostgREST v12.2.12、Deno 2.0.6。
- 从官方 compose 的 `insforge-oss:latest` 改为固定 v2.3.3 digest；四个镜像的 OCI digest 记录在 `contract/L3-RESULTS.md`。更新 `contract/scripts/standard-env.sh` 自动 pin digest。
- 容器网不能出公网 DNS（沙箱限制）；宿主机预热 Deno cache volume 后 Deno health=200。服务就绪：InsForge `/api/health`=200、Deno `/health`=200、PostgREST 可响应。
- 在真实 InsForge PG 15.18 上应用 `releases/1.4.12/tokentracker-install.sql`：15 步成功；原样二次重装成功且 ledger/checksum 不变。
- L3 真实多连接测试 **5 PASS / 0 FAIL**：advisory lock 竞争（等待约 2.5s）、8 并发重装（8/8 成功）、checksum、真实 role ACL、10 并发 upsert（1 行/100 tokens）。报告：`contract/L3-RESULTS.md`。
- 未连接任何用户 VPS/真实用户账号；这只是隔离验收环境，不代表公网部署验收。

### 2) Go + SQLite 实现（实验性垂直切片）

- 新增 `go-server/`：Go 1.24.4 + `modernc.org/sqlite@1.34.5`（纯 Go/CGO=0），真实 SQLite 文件、外键、WAL、事务、`schema_migrations(version, checksum)`。
- 实现 14 个函数路由的核心路径：HS256 JWT/device token、设备授权、token issue、ingest whole-row correction/idempotency、summary/daily/hourly/monthly/heatmap/model-breakdown/devices、自托管免费 policy/catalog、remove-device。
- 安全修正：production 强制 `TT_JWT_SECRET` ≥32 字节；Go RPC 只接受 project_admin JWT；危险 `/_test/*` 只在 `TT_ENABLE_TEST_ENDPOINTS=true` 时注册；DB/WAL/SHM 默认 0600；production container uid 10001。
- 纯 PG 的 15-step ledger/checksum **不再假装已在 SQLite 执行**。这两个 PG-specific 用例显式 SKIP；Go 自己有 schema checksum drift unit test。
- Go candidate 实测：**33 PASS / 0 FAIL / 2 SKIP**；`go test -race ./...`、`go vet ./...`、linux/amd64 CGO=0 build 全过。
- 新增 `go-server/Dockerfile`、compose 示例和 `.github/workflows/build-go-image.yml`（实验 `experimental` tag）；本机 build 成功，容器健康返回 200，生产默认 `/_test/sql` 返回 404。
- **性能仅作方向参考**（每 case wall-time 含实例启动，PGlite 是单连接 WASM）：当前测得 Go/SQLite 相对 PGlite fixture p50 约 10–21× 快；见 `contract/RESULTS.md`，不是生产吞吐结论。
- 完整缺口（24 PG 表映射、signup/signin/OAuth、session states、完整 pricing/aggregations、备份恢复、native/browser E2E、负载/安全审查）见 `go-server/STATUS.md`。**不标 GA、不接真实用户。**

### 3) 按真实情况修订文档/规则

- README 去掉过时的“首次实施尚未开始”；改为“正式 v1.4.12 工件已生成、本地标准栈已验收、用户公共 VPS 未部署”。
- `database-choice.md` 的 PostgreSQL 硬依赖结论收窄为“当前正式 InsForge/TS 路径”；新增实验 Go/SQLite 现状。
- `MAINTENANCE.md` 维护标准新增：正式/实验发布轨分离；真实 PG L3 门禁；Go migration 的 PG-only SKIP 规则；Go image 始终 experimental 直到生产阻断项通过。
- 新增 `docs/reality-review-2026-10-26.md`，记录本次逐项审视、证据和人工决定项。
- **契约测试曾有真实盲点，已修**：4 个 aggregation RPC scenario 用错参数名，之前 golden 只录了 42883；根据真实 PG `pg_get_function_arguments` 改正参数，增加 `expectStatus` 失败即停止；`account_usage_grouped_cached` 现在真实返回时区桶/缓存修正/off-peak 结果。
- 归一化升级到 v2：relative date 改成值驱动 `@relday±N`；JSON 对象按键序遍历，避免 Go/JS 插入顺序造成 UUID placeholder 差异；重录后的 golden 两次独立录制可复现。

### 验收结论

- 参考 PG/TS：35/35 PASS；两次 golden 可复现。
- Go/SQLite：33 PASS / 2 PG-specific SKIP / 0 FAIL。
- 真实 PostgreSQL 15.18 L3：5/5 PASS。
- 正式镜像路径与新实验后端分离；公共 VPS 部署未做。

## 2026-10-26 — 契约测试体系（为 Go+SQLite 改造做一致性基准）

用户目标：后续把数据库改成 SQLite、后端语言改成 Golang，需要尽可能多的测试保证两方一致，且全流程自动化。

**新增 `contract/`**（Golden Master / Characterization Tests）：

- **参考实现运行器**：直接复用上游 `test/helpers/self-host-fixture.cjs` —— PGlite 上安装 15 步基线，加载真实打包后的 14 个 async CommonJS handler，通过 loopback HTTP 提供函数与 PostgREST 风格端点。录到的是真实 SQL + 真实 handler 输出，不是 mock。
- **L1 静态契约** `lib/static.cjs`：从 `releases/1.4.12/` 提取 15 步 id+checksum、14 函数、24 表 / 52 SQL 函数 / 15 索引 / 8 触发器 / 4 RLS 策略 / 31 GRANT，以及 jsonb/timestamptz/advisory lock 等 PG 特性计数。写入 `golden/1.4.12/static.json`，作为 Go 改造施工图。
- **L2 行为契约**：35 个语言无关用例 / 82 步骤，8 组覆盖安装幂等、设备授权、上传与整行修正、7 个读接口、免费策略、认证与 RLS、时区/定价聚合、billing。归一化的 HTTP 响应快照。
- **归一化** `lib/normalize.cjs`：UUID/随机 token/时间戳/浮点/URL 内嵌 code/无序 SQL 结果集。修复三个真实缺陷：checksum 被误当 secret、`ctx.last` 覆盖导致 device-flow grant 失败、滚动窗口日期跨天漂移。
- **冻结时钟**：`CONTRACT_NOW=2026-10-26T00:00:00Z`，归一化把日期转成相对偏移；实测两个不同冻结时钟下输出一致。
- **进程池** `lib/pool.cjs`：PGlite 的 WASM 堆 `close()` 后不归还 OS，每 case 独立子进程是唯一可靠回收方式。并发 2 在 1.5GB 沙箱会 OOM（已实测），默认并发 1，CI 用 3。
- **对比器** `lib/compare.cjs`：结构化 diff（路径→期望/实际），支持 `waivers.json`（已登记偏差）与 `capabilities.json`（显式 SKIP，报告可见）。负向测试验证篡改能被检出。
- **自动化脚本**：`record.sh` / `verify.sh` / `self-test.sh` / `benchmark.sh` / `setup-upstream.sh`。
- **新 workflow** `.github/workflows/contract.yml`：L1 静态校验 → 重录 golden 并与仓库逐字节对比（可复现性硬门槛）→ 参考实现自测 → 候选实现 job（占位，待 Go 就绪）→ 每周性能基准。
- **Go+SQLite 交付模板**：`adapters/go-sqlite.example.cjs`、`SPEC.md §6` 检查清单、`mapping.json`（PG→SQLite 对象映射）、`capabilities.json`、`waivers.json`。

**验证结果**：
- 两次独立录制 `SHA256SUMS` **逐字节一致**。
- 自测 `35 PASS / 0 FAIL / 0 SKIP / 0 waived`（L1 静态契约也一致）。
- 基准：7 个热路径用例 3 轮采样，p50 从 174.9ms（空账户读）到 421.5ms（有数据聚合）。PGlite 绝对值不代表生产，用途是跨实现相对比值。

**已知限制**：PGlite 单连接，不能证明真实多连接 advisory lock 竞争（L3 待补）；详见 `contract/RESULTS.md`。

## 2026-10-26 — 数据库选型决策

用户询问「PG 数据库是必须的吗，有其他选择吗」。核实后新增 [`docs/database-choice.md`](docs/database-choice.md)：

- **PostgreSQL 引擎是硬依赖**，不能换成 MySQL/SQLite/MongoDB。依据：`releases/1.4.12/tokentracker-install.sql` 实测含 338 处 `jsonb`、82 处 PL/pgSQL 函数/触发器、33 处 `pg_advisory_xact_lock`、28 处 RLS、24 处 `auth.uid()`；第一行 preflight 就要求 InsForge 的 `auth.users`、`auth.uid()` 及三个 API 角色；14 个函数经 `@insforge/sdk` 走 PostgREST，而 PostgREST 只能连 PG。
- **可选的是 PG 的部署形态**：A 官方 Compose 内置 PG（推荐，v2.3.3 实测 15.18）／B 外部自建 PG（Pigsty 有模板，需自建角色与扩展）／C 托管 PG（Neon/RDS 等，无真 superuser 且有扩展白名单，高风险）／D PGlite（仅测试，单连接 alpha）／E 分布式 PG 兼容库（未验证）／F 重写平台（超出范围）。
- 澄清上游 `package.json` 里的 `pglite` / `sql.js` / `wa-sqlite` **只用于测试**，不是生产库；上游文档明确并发/锁测试必须在真实 PG 上跑。
- 明确本仓库 Docker 镜像不含数据库，对方案 A/B/C 都适用，只要目标 PG 已有 InsForge 的 `auth` schema 与角色。
- 同步更新 `docker/DEPLOY.md` 与 README 目录。

## 2026-10-26 — Docker 镜像交付 + 首次产物生成

用户明确：最终产物是 Docker 镜像，充分利用 GitHub 构建能力，目前只需 x86。

**首次实施完成**：`releases/1.4.12/`（19 个文件）——15 步基线 SQL、无事务版迁移 SQL、14 个 async CommonJS 私有函数、`functions.json`、`manifest-report.md`、`SHA256SUMS`。

**可复现性**：
- `summarize.cjs` 改用 `SOURCE_DATE_EPOCH`（上游 commit 时间），去掉报告里的本地绝对路径。
- `build.sh` 与新增的 `scripts/reproduce.sh` 用相同参数生成产物；实测两次构建 `SHA256SUMS` 逐字节一致。
- `reproduce.sh` 是 CI 硬门槛：从锁定上游 commit 重建，与仓库审计产物比对，不一致即失败。

**镜像**（linux/amd64）：
- 多阶段 `Dockerfile`：prepare → verify（构建期 `sha256sum -c` + 14 函数检查）→ runtime（`node:20-alpine`，非 root uid 10001，tini）。
- `docker/tokentracker.cjs` 部署 CLI：`info` / `verify` / `functions` / `sql` / `migration` / `checksums` / `export` / `commands`。只输出工件，不连实例、不执行 psql、不上传函数。
- 修复 `sql | head` 的 EPIPE 崩溃。
- `.dockerignore` 显式排除凭据；`docker-compose.example.yml` 提供一次性用法。
- OCI labels 记录上游 commit / 版本 / 平台；`BUILD.json` 含构建元数据。

**GitHub Actions** `.github/workflows/build-image.yml`：
- 触发：push(main，路径过滤) / PR（只构建不推送）/ `workflow_dispatch`（可覆盖上游 commit、控制是否推送）/ 每周定时回归。
- jobs：`meta`（读 REF）→ `reproduce`（可复现性硬门槛）→ `build`（buildx + GHA layer cache + SBOM + provenance + SLSA attestation + 冒烟测试）。
- 用内置 `GITHUB_TOKEN` + `packages: write` 推 GHCR，不需要 PAT；顶层权限仅 `contents: read`。
- 标签：`<version>`、`<version>-<short_sha>`、`latest`、`sha-<short>`。

**文档**：新增 [`docs/docker-image.md`](docs/docker-image.md) 与 `docker/DEPLOY.md`；README / MAINTENANCE 增加镜像章节。

**CI 上线过程（4 次迭代）**：
1. `badba45` 首跑失败 —— `reproduce.sh` 尾部 `[ ... ] && echo` 在成功时返回 1，CI 误判失败。改为 `if` + 显式 `exit 0`，并在 `verify.yml` 加退出码回归测试。
2. `a4e5125` Dockerfile 解析失败 —— 多行 `node -e '...'` 被 Dockerfile parser 当成指令。把 Node 逻辑抽成 `docker/verify-artifacts.cjs` 与 `docker/write-build-info.cjs`。
3. 同次构建**镜像已成功推送**，但 smoke test 的 `docker run ... sql | head -1` 在 `pipefail` 下 broken pipe。改为先重定向到文件；`export` 挂载目录加 `chmod 777`（容器 uid 10001）。
4. `8d7112e` 三个 job 全绿：`meta` → `reproduce` → `build`，冒烟测试含 `info`/`verify`/`functions`/`sql`/`export`+`sha256sum -c`/`commands`。

**产物**：`ghcr.io/quietsugar/token-tracker-self-hosting:1.4.12`（另有 `1.4.12-<short_sha>`、`latest`、`sha-<short>`），digest `sha256:6deb9ce1…`，包可见性 **public**，linux/amd64，含 SBOM 与 provenance attestation。

首次**部署**（VPS 上执行 SQL / 上传函数）仍未开始。

## 2026-10-26 — 首次推送成功（仓库正式上线）

- 用 GitHub App（App ID `5476780` / Installation `175378660`）的 installation token 推送 `main` 到 <https://github.com/QuietSugar/token-tracker-self-hosting.git>。
- 远程 `main` = `1949097`；`.github/workflows/verify.yml` 首次运行 **success**（密钥扫描 + 编码 + 脚本语法 + 产物校验通过）。
- 远程 29 个文件核对无 `.pem` / `.env` / 私钥类文件。
- 提交身份统一为 `hall <sugarjellyfish@gmail.com>`。
- 删除仅用于 PAT 无 workflow 权限场景的 `fallback-no-workflow` 备用分支及对应 bundle——完整历史已成功推送，不再需要。
- **首次实施（生成 SQL 与 14 个函数）仍未开始**；`releases/` 下暂无产物。

## 2026-10-26 — 改用 GitHub App 做长期推送认证

背景：fine-grained PAT 缺少 `workflow` 权限，推送 `.github/workflows/verify.yml` 被 GitHub 拒绝。用户希望长期维护，改用 GitHub App。

- 新增 [`docs/github-app-setup.md`](docs/github-app-setup.md)：完整的 GitHub App 创建/授权/安装/轮换指南，含必需的 `Contents: R/W` + `Workflows: R/W` 权限说明与官方参考链接。
- 新增 `scripts/gh-app-token.cjs`：用私钥签 RS256 JWT（`iat`/`exp`/`iss`）换取 1 小时 installation token；只写 600 权限的临时文件，stdout 不打印 token。
- 新增 `scripts/push-with-app.sh`：`GIT_ASKPASS` 注入 token 推送，输出脱敏，退出即清理临时文件；支持 `--dry-run`。
- `bootstrap.sh` / `session-start.sh`：检查 `~/.config/tokentracker-gh-app/` 凭据是否就绪。
- 提交身份设为 `hall <sugarjellyfish@gmail.com>`（可经 `SELFHOST_GIT_NAME` / `SELFHOST_GIT_EMAIL` 覆盖）。
- 查明仓库 owner 为 `QuietSugar`（User），与用户提供的用户名 `hall` 是两个不同账号；App 必须由有该仓库管理权限的账号安装。
- README / SECURITY.md / MAINTENANCE.md 同步更新推送方式与私钥保护规则。
- **首次实施仍未开始**；`releases/` 下暂无产物。

## 2026-10-26 — 建立长期维护机制

- 新增 `MAINTENANCE.md`：维护契约、会话启动协议、标准循环 SOP、决策树、硬停止条件、灾难恢复、当前不变式。明确「状态存在仓库里，不在对话记忆里」。
- 新增 `scripts/session-start.sh`：每次维护会话的状态快照命令，输出环境自检、锁定点、版本追踪、最近提交、已有产物、未完成待办、上游状态、安全检查结果。
- 新增 `scripts/bootstrap.sh`：实测发现工作区快照不保存 `.git/config` / `~/.gitconfig`，导致新会话丢失 `origin` 与提交身份（`git commit` 报 `Author identity unknown`）。该脚本幂等地恢复二者；`session-start.sh` 会增加环境自检提醒。
- 修正 `upstream.sh status` 误报：`git diff --numstat` 对纯权限位变更输出 `0  0  file`，之前被误计为内容变更。
- README 增加「长期维护」章节并在开头指向 `MAINTENANCE.md`；命令速查补充 `session-start.sh`。
- 约定：Agent 无法主动定时运行，由用户一句话触发；触发后应能完整执行而无需重新交代背景。
- **首次实施仍未开始**；`releases/` 下暂无产物。

## 2026-10-26 — 面向 public 远程仓库加固

远程确定为 <https://github.com/QuietSugar/token-tracker-self-hosting.git>（**公有仓库**）。

- 新增 `scripts/check-secrets.sh`：推送前密钥扫描（已知 token 格式、私钥块、疑似真实赋值、敏感文件名、`.gitignore` 覆盖验证）。
- 新增 `scripts/check-encoding.sh`：全仓 UTF-8 / 无 BOM 检查；`verify.sh` 改为复用它。
- 新增 `.github/workflows/verify.yml`：push / PR 时自动跑密钥扫描、编码检查、产物校验、脚本语法检查；只依赖官方 `actions/*`。
- README 新增「公有仓库安全约定」章节，明确公开内容范围与硬性规则。
- SECURITY.md 强调公有仓库 = 已泄露，误提交处置改为「先轮换再清历史」。
- 推送前全仓扫描结果：未发现真实凭据；域名均为 `your-domain.example` 类占位符。
- **首次实施仍未开始**；`releases/` 下暂无产物。

## 2026-10-26 — 仓库初始化（计划阶段）

- 创建独立运维仓库，与上游 TokenTracker checkout 分离。
- 归档三份规划文档到 `docs/`：维护提示词、可复用提示词、总体规划。
- 新增 `docs/runbook.md`：首次实施 / 升级 / 回滚操作手册。
- 建立 `tracking/REF`（锁定 v1.4.12 / `8d32a956181bf52fae449c89b8f6520253566283`）与 `tracking/upstream.md` 版本追踪表。
- 新增脚本：`upstream.sh`（只读上游检查）、`build.sh`（产物生成）、`summarize.cjs`（清单摘要）、`verify.sh`（完整性与编码校验）。
- 新增 `env/server.env.example`、`releases/_template/` 模板。
- 记录已知偏差：文档写 14 步，实际 `manifest.steps()` 为 15 步；以 `tracking/upstream.md` 为准。
- **首次实施尚未开始**：`releases/` 下暂无产物。
