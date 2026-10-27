# Go 后端的 PostgreSQL 支持（以及「留不留 SQLite」的成本账）

> 定位前提：本后端面向**局域网自用**（单实例、单账户 owner、账号体系默认关闭）。
> 这个前提决定了很多取舍，见 [`../go-server/README.md`](../go-server/README.md) §0。
>
> 结论先说：
> 1. **PostgreSQL 已支持**：同一份 Go 代码、同一个镜像，用 `TT_DATABASE_URL` 切换引擎。
> 2. **它让"跑起来"更简单，但没有让"维护"更简单**：应用侧几乎没变（SQL 只写一份），
>    变简单的是运维语义（多连接、真并发、备份/PITR 是成熟工具）；
>    真正增加的是一层很薄的方言适配 + 两套验收流水线。
> 3. **现在不建议立刻删掉 SQLite**：SQLite 的边际维护成本已经是"一套测试"，
>    而它提供了"零依赖单文件启动"这条独有的部署路径。
>    只有当你能接受"必须有一个 PostgreSQL 实例才能跑"时，删掉 SQLite 才会**减少**成本。

---

## 1. 怎么用

```sh
# PostgreSQL（推荐，生产语义）
export TT_DATABASE_URL='postgres://user:pass@127.0.0.1:5432/tokentracker?sslmode=disable'
export TT_JWT_SECRET="$(openssl rand -hex 32)"
go run ./go-server/cmd/server        # 或直接用镜像

# SQLite（默认，零依赖）
export TT_DATABASE_PATH=/var/lib/tokentracker/tokentracker.db
export TT_JWT_SECRET="$(openssl rand -hex 32)"
go run ./go-server/cmd/server
```

Docker：

```sh
docker pull ghcr.io/quietsugar/token-tracker-self-hosting-go:experimental

docker compose -f go-server/docker-compose.postgres-go.example.yml up -d   # PG
docker compose -f go-server/docker-compose.sqlite-go.example.yml up -d     # SQLite
```

面向使用者的完整部署/运维手册（备份恢复、升级、反代、systemd、排错）：[`../go-server/README.md`](../go-server/README.md)。

一键全量测试：`cd go-server && ./scripts/full-test.sh`（可带 `TT_POSTGRES_URL` 打开 PG 项；无 docker 时自动 SKIP 镜像 smoke）。

### 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `TT_DATABASE_URL` | – | `postgres://…` 连接串，或 SQLite 文件路径。**优先级最高** |
| `TT_DATABASE_PATH` | `tokentracker.db` | 旧变量；仅 SQLite 文件路径 |
| `TT_DATABASE_DRIVER` | 按 DSN 推断 | 显式 `sqlite` / `postgres`；为空时 `postgres://` 判为 PG，其余判为 SQLite |
| `TT_POSTGRES_SCHEMA` | – | 仅 PG：把表建在指定 schema 里（测试/多实例共用一个库时隔离） |
| `TT_POSTGRES_SCHEMA_EPHEMERAL` | `false` | 仅 PG：进程退出时 `DROP SCHEMA … CASCADE`（配合上一项，仅测试用） |
| `TT_LISTEN_ADDR` | `127.0.0.1:8080` | 监听地址 |
| `TT_JWT_SECRET` | – | **必填**，≥32 字节，否则拒绝启动 |
| `TT_NOW` | – | 冻结时钟（RFC3339），用于契约测试复现 |

PG 连接串注意 `sslmode`：容器内网通常 `sslmode=disable`；云上托管 PG 用默认
`require`/`verify-full`。应用不打印密码（启动日志会脱敏成 `user:***@host`）。

### 装好之后：把真实数据接进来

服务端起来只是"空账本"，两种方式填数据：

1. **装官方客户端**，把它上报的 `baseUrl` 指向这台机器——之后自动累积。
   完整步骤、`base_url` 必须 HTTPS 的限制、设备批准三种模式见
   **[`docs/official-client.md`](official-client.md)**（已用官方 CLI v1.4.12 实测 device-login + sync）。
2. **已经有历史用量**（CSV / 客户端导出 / 自建脚本的日志）：用
   [`go-server/scripts/import-usage.py`](../go-server/scripts/import-usage.py) 导入，
   完整用法见 **`go-server/README.md` §3.5**（三步导入、列名别名表、重复导入不重复计数、常见报错）。

```sh
cd go-server
./scripts/import-usage.py --base http://192.168.1.10:8080 \
  --jwt "$(./scripts/issue-token.sh --json)" --device-name nas --input ~/usage.csv --dry-run
```

脚本会先把时间统一成 **UTC 整点**再上传——这是最容易踩的坑：服务端按字符串比较
`hour_start`，带 `+08:00` 偏移的时间不会出现在 `?from=&to=` 的汇总里。

---

## 2. 代码上到底改了什么（以及为什么这么改）

```
go-server/internal/store/
├── dialect.go   Dialect（sqlite/postgres）+ 占位符改写 + DSN 推断
├── db.go        DB/Tx 包装（Exec/Query/QueryRow/Begin 自动改写占位符）+ 连接池 + 可选 schema 隔离
├── schema.go    唯一一份逻辑 DDL（3 个占位符按引擎渲染）+ 迁移账本 + 幂等安装
└── checksums.go PG 15-step 参考 checksum（仅审计映射，NEVER 应用到本账本）
```

三条设计规则，目的都是"不要让方言渗进业务代码"：

1. **SQL 只写一份，占位符用 `?`。**
   `store.DB` 在 `Postgres` 方言下把 `?` 改写成 `$1..$n`；改写器会跳过
   字符串字面量、双引号标识符、行/块注释、美元引号字符串，
   所以 `LIKE '%?%'` 或注释里的问号不会被误伤（有表驱动单测）。

2. **DDL 只写一份，按引擎渲染。**
   逻辑 schema 里只有 3 个占位符：
   `{{ENGINE}}`（注释文字）、`{{BOOL}}`（`INTEGER` / `boolean`）、
   `{{FALSE}}`（`0` / `false`）。
   其余列类型（`TEXT` / `INTEGER`）在两种引擎里都合法，故意不改写。
   SQLite 额外的 `PRAGMA`（WAL / foreign_keys / busy_timeout）只在该引擎拼进去。

3. **列类型保持"可互换"**：时间存 RFC3339 UTC 文本、金额存十进制文本、ID 存 `TEXT`。
   - 好处：`Scan` 目标、比较与排序（ISO 文本即时间序）、`LIKE` 语义在两种引擎完全一致，
     业务层 0 处方言分支；PG 侧还能直接用同一份 `schema_migrations` 逻辑。
   - 代价：PG 侧没有 `timestamptz` / `numeric` 的原生类型校验与时区运算；
     排序用文本而非 timestamptz 的比较函数（索引仍是 B-tree，量级相同）。
   - 如果将来要改用原生类型：`timestamptz` 会让 `hour_start >= $1` 的参数类型、
     聚合函数的返回类型、Go 侧的 `string` 扫描全部要改，
     属于"一次性大改 + 迁移脚本"，不做在第一步里。

其他与引擎相关的点：

- **幂等插入**：`db.InsertIgnore("auth_users(id,email) VALUES(?,?)")` →
  SQLite `INSERT OR IGNORE` / PG `INSERT … ON CONFLICT DO NOTHING`。
- **布尔列**：PG 侧 `is_current`/`enabled` 是真 `boolean`，
  Go 侧用一个 `flexibleBool` 扫描器吸收 `0/1`、`t/f`、`true/false`。
- **连接池**：SQLite 固定 `MaxOpenConns=1`（单写者，写串行化由 Go mutex 提供）；
  PG 默认 16 连接、`ConnMaxLifetime=30m`。
- **启动等待**：PG 侧会轮询 `Ping` 最多 30s，避免 compose 里"应用先于数据库就绪"。
- **优雅退出**：收到 SIGTERM/SIGINT 后 `http.Server.Shutdown` → 关连接池
  （`docker stop` 不再硬杀，PG 不会留下半开事务）。
- **迁移账本**：`schema_migrations(version=1, checksum)` 里的 checksum 是
  **该引擎渲染后 DDL 的 sha256**。同版本在两种引擎上 checksum 不同是预期行为；
  同引擎内 schema 被改动会 fail closed（有单测）。
  引入 PG 支持时，SQLite 渲染结果**逐字节未变**，所以已部署的 SQLite 实例
  checksum 不变、不会因升级而拒绝启动（有专门的回归测试锁死这一点）。

---

## 3. 验证证据（可复现）

验收环境：**Go ≥1.24** 工具链（版本要求以 `go-server/go.mod` 为准，验收时沙箱为 1.27）、
`modernc.org/sqlite v1.34.5`、`github.com/lib/pq v1.10.9`、
PostgreSQL **16.2**（`pgserver` 自带二进制）：

```sh
cd go-server
./scripts/full-test.sh                                        # 全量（推荐）
go vet ./... && go test -race ./...                          # SQLite：PASS
TT_TEST_DATABASE_URL='postgres://…?sslmode=disable' go test -race ./...   # Postgres：PASS

CONTRACT_ADAPTER=./contract/adapters/go-sqlite.cjs   ./contract/scripts/verify.sh  # 33 PASS / 0 FAIL / 2 SKIP
GO_POSTGRES_URL='postgres://…?sslmode=disable' \
  CONTRACT_ADAPTER=./contract/adapters/go-postgres.cjs ./contract/scripts/verify.sh # 33 PASS / 0 FAIL / 2 SKIP
```

- 同一批 33 个 golden 行为用例在 **SQLite 与真实 PostgreSQL** 上都 PASS。
- 2 个 SKIP 仍然是刻意保留的 PG 15-step 安装账本/step checksum 用例：
  本实现不伪造官方 15 步迁移账本，用的是自己的 `schema_migrations(version=1)`。
- PG adapter 每个用例起独立 schema（`tt_case_<hex>`），退出时 `DROP SCHEMA CASCADE`，
  与 SQLite adapter 的"每个用例一个全新数据库文件"等价。
- CI：`.github/workflows/go-server.yml` 在 **PostgreSQL 15 与 16** 两个矩阵上跑同一批测试 + 契约，
  另外单独跑 SQLite 那一份；`.github/workflows/build-go-image.yml` 在每次镜像构建时跑
  **SQLite 模式 + PostgreSQL 模式**的容器 smoke（health、非 root、0600、`/_test/*` 404、重启后数据仍在、
  弱 secret 拒绝启动、PG 连接与日志脱敏），smoke 不通过就不会推送镜像。
- 备份/恢复已实测：SQLite 快照可重启恢复；PG 用 `pg_dump -Fc` 备份 → 删库 → `pg_restore` → 14 张表与
  `schema_migrations` checksum 一致 → 服务正常启动（详见 `go-server/scripts/backup.sh`）。
- **注意：本仓库从未在真实用户 VPS 上验收 PG 部署。**

---

## 4. 运维差异（PG vs SQLite）

| 维度 | SQLite | PostgreSQL |
|---|---|---|
| 部署形态 | 单文件 + 单进程 | 需要实例（容器/托管） |
| 并发写 | 串行（单写者） | 真并发，池化连接 |
| 备份 | 停服复制文件 / `.backup` | `pg_dump`、PITR、物理备 |
| 多实例/滚动升级 | ❌ 单进程单文件 | ✅ 天然支持 |
| 磁盘满/损坏恢复 | 未验收 | 成熟生态 |
| 权限模型 | 文件权限（0600） | 角色/GRANT（本实现只用单角色） |
| 迁移工具 | 自带 `schema_migrations` | 自带 `schema_migrations`（本实现不接外部迁移工具） |

两条都还没做的事：速率限制、审计日志、`TT_JWT_SECRET` 轮换流程、DB 指标导出。

---

## 5. 回答两个问题

### Q1：支持 PostgreSQL 会"更简单"吗？

分三层看：

| 层面 | 变化 |
|---|---|
| 业务代码（handlers/聚合/JWT/设备流） | **完全不变**。唯一改动是 `is_current` 的布尔扫描和 2 处 `INSERT OR IGNORE` |
| 存储层 | 新增约 500 行（`dialect.go` + `db.go` + schema 渲染）；SQL 与 DDL 仍然是**单份** |
| 验收 | 新增一条流水线（PG 上跑同一批单元测试 + 同一批契约）；CI 增加 2 个矩阵 job |

所以：**写代码没有更简单，但"上线后不出事"更简单**。多连接、并发写、
备份/恢复、滚动升级这些在 SQLite 上是"未验收风险"，在 PG 上是"用成熟工具解决"。
如果你最终的目标是"给别人部署的自托管服务",PG 是更省心的运维答案。

### Q2：支持 PG 之后不再支持 SQLite，会降低维护成本吗？

会降，但降的幅度比直觉小。具体到这个仓库：

**删掉 SQLite 能省掉的：**
- 一套 `_test` 之外的引擎分支开关（很小：`driver` 名、`PRAGMA`、`INSERT OR IGNORE`、布尔渲染）；
- 一条测试/契约流水线（SQLite job）；
- "WAL 多进程/网络文件系统/断电恢复未验收"这类**永久存疑项**（省的是解释成本）；
- SQLite 特有的备份/权限说明。

**删掉 SQLite 之后仍然存在的成本（与引擎无关）：**
- 24 张 PG 表的完整映射、session states、全量 pricing/聚合、客户端 E2E、安全审查——
  这些是真正的维护大头，删掉 SQLite 一点也不会少；
- PG 侧的验收（迁移、备份、池化、版本升级）本来就要维护。

**所以真实结论是：**
- 如果"必须有 PG"可以接受 → 删掉 SQLite 能让仓库**少一个引擎、少一条流水线**，
  心智负担确实下降（尤其对只想部署 PG 的使用者，文档不必再解释两套语义）。
- 如果"零依赖单文件启动"是产品卖点（本地/单机自托管、CI 快速验证、演示）→
  保留 SQLite 更划算：它现在的边际成本就是"同一批测试跑两遍"，
  而这批测试本来就是质量资产。

**建议的节奏（也是本次改动的做法）：**
1. **现在**：PG 优先（文档、compose、CI 主路径都指向 PG），SQLite 标记为"零依赖降级选项"，
   两种引擎跑同一批契约，任何一方 FAIL 都阻塞合并。
2. **一个观察期后**：如果 SQLite 路径的实际使用率接近 0，且没人依赖它做演示/CI，
   再单独提交一个"移除 SQLite"的 ADR：删 `modernc.org/sqlite` 依赖、
   `sqlitePreamble`、`INSERT OR IGNORE` 分支、SQLite adapter 与 CI job，
   并把 `schema_migrations` 的 checksum 语义改成"PG 单引擎"。
3. **不要**反过来"为了删 SQLite 而把 PG 侧改成文本列"——那会把 PG 的原生能力一起丢掉。

> 一句话：**PG 让部署更靠谱，双支持让架构更诚实；删 SQLite 省的是"解释与流水线"，不是"功能维护"。**
> 真正压缩维护成本的关键动作仍然是补齐数据模型、客户端 E2E 与安全审查，而不是选哪个引擎。
