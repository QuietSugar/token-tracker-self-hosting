# Go 后端为什么只用 PostgreSQL（附「删掉 SQLite」的决定记录）

> 定位前提：本后端面向**局域网自用**（单实例、单账户 owner、账号体系默认关闭）。
> 这个前提决定了很多取舍，见 [`../go-server/README.md`](../go-server/README.md) §0。
>
> 结论先说：
> 1. **只有 PostgreSQL 一个引擎**。`TT_DATABASE_URL` 是必填项，没有"零依赖默认引擎"。
> 2. **SQLite 支持已于 2026-10-27 移除**，归档在 tag **`sqlite-final`**（见本文 §5）。
> 3. 移除的收益是**保真度**：唯一在用的引擎被真正测到，方言层、双份 CI、双份契约
>    adapter 一起消失。代价只有一条：`go test` 不能零依赖跑，必须先有一个 PG。

---

## 1. 怎么用

```sh
export TT_DATABASE_URL='postgres://user:pass@127.0.0.1:5432/tokentracker?sslmode=disable'
export TT_JWT_SECRET="$(openssl rand -hex 32)"
go run ./go-server/cmd/server        # 或直接用镜像
```

Docker（PG 作为 compose 内部服务，一条命令全起来）：

```sh
docker pull ghcr.io/quietsugar/token-tracker-self-hosting-go:experimental
docker compose -f go-server/docker-compose.postgres-go.example.yml up -d
```

面向使用者的完整部署/运维手册（备份恢复、升级、反代、systemd、排错）：
[`../go-server/README.md`](../go-server/README.md)。

一键全量测试（起临时 PG，跑 unit + 契约 + 镜像 smoke）：

```sh
cd go-server && ./scripts/test-with-pg.sh --full
```

### 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `TT_DATABASE_URL` | **必填** | PostgreSQL 连接串（`postgres://…` / `postgresql://…` / lib/pq 的 `host=… user=…`）。给了 SQLite 路径会拒绝启动并提示迁移 |
| `TT_POSTGRES_SCHEMA` | – | 把表建在指定 schema 里（测试/多实例共用一个库时隔离） |
| `TT_POSTGRES_SCHEMA_EPHEMERAL` | `false` | 进程退出时 `DROP SCHEMA … CASCADE`（配合上一项，仅测试用） |
| `TT_LISTEN_ADDR` | `127.0.0.1:8080` | 监听地址 |
| `TT_JWT_SECRET` | – | **必填**，≥32 字节，否则拒绝启动 |
| `TT_NOW` | – | 冻结时钟（RFC3339），用于契约测试复现 |

`TT_DATABASE_PATH` / `TT_DATABASE_DRIVER` 是 SQLite 时代的变量，**已移除**；还在设会打一行
警告然后被忽略。

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

## 2. 代码结构（单引擎之后）

```
go-server/internal/store/
├── placeholders.go  `?` → `$1..$n` 改写器（跳过字符串/注释/美元引号）+ 单测
├── db.go            DB/Tx 包装（自动改写）+ 连接池 + 可选 schema 隔离 + DSN 校验
├── schema.go        唯一一份 PostgreSQL DDL（烘焙好的 schemaBody）+ 迁移账本 + 幂等安装
└── checksums.go     PG 15-step 参考 checksum（仅审计映射，NEVER 应用到本账本）
```

三条设计规则：

1. **SQL 只写一份，占位符用 `?`。**
   `store.DB` 在进入 `database/sql` 之前把 `?` 改写成 `$1..$n`；改写器会跳过
   字符串字面量、双引号标识符、行/块注释、美元引号字符串，
   所以 `LIKE '%?%'` 或注释里的问号不会被误伤（有表驱动单测）。

2. **DDL 是一段字面量。**
   `schemaBody` 就是完整的 PostgreSQL DDL，没有任何占位符或渲染分支；
   它的 sha256 被 `TestSchemaChecksumIsPinned` 钉死。
   **新增表/列请走 `additiveSteps`**，不要改 `schemaBody`——改了会让已部署实例
   启动即 `checksum drift` 拒绝。

3. **列类型保持"文本化"**：时间存 RFC3339 UTC 文本、金额存十进制文本、ID 存 `TEXT`。
   - 好处：`Scan` 目标、比较与排序（ISO 文本即时间序）、`LIKE` 语义在 Go 侧完全可预测。
   - 代价：没有 `timestamptz` / `numeric` 的原生类型校验与时区运算；
     排序用文本而非 timestamptz 的比较函数（索引仍是 B-tree，量级相同）。
   - 如果将来要改用原生类型：`timestamptz` 会让 `hour_start >= $1` 的参数类型、
     聚合函数的返回类型、Go 侧的 `string` 扫描全部要改，属于"一次性大改 + 迁移脚本"。

其他要点：

- **幂等插入**：`db.InsertIgnore(...)` → `INSERT … ON CONFLICT DO NOTHING`。
- **连接池**：默认 16 连接、`ConnMaxLifetime=30m`；
  写路径仍有进程内 `sync.Mutex`（多实例部署前必须换成 advisory lock）。
- **启动等待**：轮询 `Ping` 最多 30s，避免 compose 里"应用先于数据库就绪"。
- **优雅退出**：收到 SIGTERM/SIGINT 后 `http.Server.Shutdown` → 关连接池
  （`docker stop` 不再硬杀，PG 不会留下半开事务）。
- **迁移账本**：`schema_migrations(version=1, checksum)`，checksum 是 core DDL 的 sha256；
  schema 被改动会 fail closed（有单测）。

---

## 3. 验证证据（可复现）

- `go vet ./...`、`go test -race ./...`（真实 PostgreSQL）：全过。
- 契约：`CONTRACT_ADAPTER=./contract/adapters/go-postgres.cjs ./contract/scripts/verify.sh`
  → **33 PASS / 0 FAIL / 2 SKIP**（2 个 SKIP 是 PG 专属的 15-step 账本与 step checksum 规则，
  本实现不伪造该账本，属有意跳过）。
- CI：`.github/workflows/go-server.yml` 在 **PostgreSQL 15 与 16** 两个版本上各跑一遍
  unit + 契约；`.github/workflows/build-go-image.yml` 在推送前跑镜像 smoke（连真实 PG）。
- 验收环境：**Go ≥1.24**（以 `go.mod` 为准；写这份文档时的沙箱是 1.27）。
- 备份/恢复已实测：PG 用 `pg_dump -Fc` 备份 → 删库 → `pg_restore` → 16 张业务表与
  迁移账本均恢复，见 `../go-server/README.md` §4。

---

## 4. 当初的运维差异账（PG vs SQLite）

留着这段是因为它是删除决定的依据，不是现状描述：

| 维度 | SQLite | PostgreSQL |
|---|---|---|
| 起服务 | `TT_DATABASE_PATH=/tmp/tt.db` 一个文件 | 必须有一个 PG 实例 |
| 并发写 | 单写者，`MaxOpenConns=1` + Go mutex | 真并发，16 连接池 |
| 备份 | 复制文件 / `.backup`（要处理 WAL） | `pg_dump -Fc`，成熟工具链 |
| 恢复点 | 无 PITR | WAL 归档 / PITR 可做 |
| 多实例 | 不支持（文件锁） | 支持（但本服务写路径仍要补 advisory lock） |
| 类型语义 | 宽松（1/0、无 boolean） | 严格（boolean / 约束 / 并发事务） |
| 测试保真度 | 测的是"另一个引擎" | 测的就是生产引擎 |

**关键一条**：SQLite 分支再绿，也不能证明 PG 上的并发、约束、类型转换是对的；
而它带来的成本（方言层 183 行、双份 CI、双份 compose、双份契约 adapter、
"两引擎 checksum 不同"的文档解释）摊在每一次改动上。

---

## 5. 决定记录：删掉 SQLite（2026-10-27）

**决定**：删除 SQLite 支持；在删除**之前**打 tag `sqlite-final` 作为归档点，
需要单文件部署形态的人可以从那里 checkout。

| | 删除前 | 删除后 |
|---|---|---|
| 依赖 | `modernc.org/{sqlite,libc,mathutil,memory}` | 只剩 `github.com/lib/pq`（`go.sum` 45 → 2 行） |
| 方言层 | `dialect.go` + DDL 三占位符渲染 + `INSERT OR IGNORE` 双写 + `flexibleBool` | 单一 `rewritePlaceholders` |
| 测试 | 默认临时 SQLite 文件，设 `TT_TEST_DATABASE_URL` 才跑 PG | **必须**给 PG（`scripts/test-with-pg.sh`） |
| CI | sqlite job + postgres 15/16 | postgres 15/16 |
| 镜像 smoke | SQLite + PG 双模式 | PG 单模式 |
| compose | 两份示例 | 一份（PostgreSQL） |
| 契约 adapter | `go-sqlite.cjs` / `go-postgres.cjs` | 只留 `go-postgres.cjs` |
| 备份脚本 | `backup.sh sqlite\|postgres` | `backup.sh postgres` |

**为什么现在删**：

1. 这台机器（以及这个项目的目标部署形态）从一开始就用 PG，SQLite 分支从未承载过
   真实数据；它的"通过率"只是让人误以为覆盖面更大。
2. 每加一个功能都要在两边各验一遍，而其中一边永远不是生产形态。
3. 删完之后，"必须有一个 PG"这件事变成显式的：`go test` 不给库就直接失败并告诉你
   怎么起库，而不是悄悄跑另一个引擎给你虚假的安全感。

**代价（明确承认）**：`go test` 不能零依赖跑；开发/CI 必须准备一个 PG。
本地用 `./scripts/test-with-pg.sh`（docker 一键起临时库），CI 用 service 容器。

**迁移路径**：没有自动搬数工具。如果你确实在 `sqlite-final` 上跑过 SQLite 实例，
请在那条分支上导出 CSV/JSONL，再用 `scripts/import-usage.py` 导入本服务
（device token 需要重新签发）。

---

## 6. 遗留的判断

- **要不要原生类型（`timestamptz` / `numeric`）**：现在不做。收益是类型校验与时区运算，
  成本是全表迁移 + Go 侧扫描全部改写；在"局域网自用、单人数据量"的前提下不划算。
- **多实例**：PG 让多副本成为可能，但 ingest 的整行修正仍是进程内互斥。
  真要多副本，先加 `pg_advisory_xact_lock`，再谈连接池与监控。
- **托管 PG（RDS/Neon 等）**：未验收。连接串、`sslmode`、备份策略都要按托管方的规矩来。
