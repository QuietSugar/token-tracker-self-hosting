# 设计：只有 PostgreSQL

> 结论：`TT_DATABASE_URL` 是必填项，引擎只有 PostgreSQL。没有"零依赖默认引擎"，也不打算再支持第二个。
> 操作步骤见 [`../users/deploy.md`](../users/deploy.md)；现状见 [`../status.md`](../status.md)。

## 1. 为什么不采用"增加适配层"的方案

上游那套自托管后端（InsForge + TypeScript edge functions）是**语义级**绑在 PostgreSQL 上的。
在 v1.4.15 的安装 SQL（4,712 行；与 1.4.12 逐字节相同）里：`jsonb` 338 处、`timestamptz` 217 处、PL/pgSQL 82 处、
`pg_advisory_xact_lock` 33 处、RLS 策略 28 处、`auth.uid()` 24 处。
再加安装器第一行的 preflight：没有 `auth.users`、`auth.uid()`、`anon`/`authenticated`/`project_admin`
三个角色就直接 `RAISE EXCEPTION`。

我们做的是**同一个 HTTP 契约的另一个实现**（[`parity.md`](parity.md)），不是给上游换数据库。
在这个前提下，PG 不是"顺手选的"，而是：

- 上游的行为定义在 PG 上（golden 快照就是 PG 的输出），换引擎等于换基准；
- 我们自己的数据模型要用到 `ON CONFLICT`、`RETURNING`、真并发事务；
- 用户侧只需要理解一件事：这里要有一个 PG。

## 2. 代码结构

```
go-server/internal/store/
├── placeholders.go  `?` → `$1..$n` 改写器
├── db.go            DB/Tx 包装 + 连接池 + 可选 schema 隔离 + DSN 校验
├── schema.go        唯一的 PostgreSQL DDL + 增量 step + 迁移账本
└── checksums.go     PG 15-step 参考 checksum（仅审计对照，从不用来装我们的库）
```

### 2.1 SQL 只写一份，占位符用 `?`

`store.DB` 在进 `database/sql` 之前把 `?` 改写成 `$1..$n`。改写器会跳过字符串字面量、
双引号标识符、行/块注释、美元引号字符串，所以 `LIKE '%?%'` 和注释里的问号不会被误伤（有表驱动单测）。

理由：SQL 文本里到处是手写 `?`，直接写 `$n` 极易错位；而"两种占位符风格"是单引擎下唯一值得留的抽象。

### 2.2 DDL 是一段字面量，checksum 钉死

`schemaBody` 是完整的 core DDL，没有渲染分支，它的 sha256 被 `TestSchemaChecksumIsPinned` 锁住，
启动时与 `schema_migrations` 里记录的值比对，不一致就 **fail closed**（拒绝启动）。

要加东西，走增量：

```go
var additiveSteps = []struct{ Version int; Name, SQL string }{
    {1, "auth-sessions",     `CREATE TABLE IF NOT EXISTS …`},
    {2, "auth-owner",        `CREATE TABLE IF NOT EXISTS …`},
    {3, "auth-refresh-grace", `ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS rotated_at TEXT; …parent_id TEXT`},
}
```

- 每个 step 只做 `CREATE … IF NOT EXISTS` / `ALTER … ADD COLUMN IF NOT EXISTS` 这类**可重放**的加法，单独记一行 `schema_additions(version, name, checksum)`。
- 老实例升级只跑新 step，新实例全量跑一遍，两者终态一致。
- **step 一经发布永不修改**：改 = 新的 step。checksum 漂移视为篡改，拒绝启动。

这就是"没有自动回滚"的代价：升级前自备数据库备份（备份不在本项目范围）。

### 2.3 列类型保持文本化

时间存 RFC3339 UTC 文本、金额存十进制文本、ID 存 `TEXT`。

- 得：Go 侧 `Scan` 目标、比较、排序（ISO 文本即时间序）、`LIKE` 语义完全可预测，与上游 TS 实现逐字符对得上。
- 失：没有 `timestamptz`/`numeric` 的原生校验与时区运算；排序走文本比较（索引仍是 B-tree，量级相同）。

换原生类型的成本是**全表迁移 + 所有聚合函数返回类型 + Go 侧扫描全部改写**，在"单人数据量"前提下不划算。
如果哪天要做，这是一次性大改，不是渐进迁移。

### 2.4 其他行为

- **幂等插入**：`InsertIgnore` → `INSERT … ON CONFLICT DO NOTHING`；`ingest` 的整行修正是 `ON CONFLICT … DO UPDATE`。
- **连接池**：默认 16 连接、`MaxIdleConns=4`、`ConnMaxLifetime=30m`。
- **启动等待**：轮询 `Ping` 最多 30 秒，避免 compose 里"应用先于数据库就绪"。
- **优雅退出**：SIGTERM/SIGINT → `http.Server.Shutdown` → 关连接池。
- **schema 隔离**：`TT_POSTGRES_SCHEMA=tt` 把表建在指定 schema（测试与多实例共库时用）；
  `TT_POSTGRES_SCHEMA_EPHEMERAL=true` 在退出时 `DROP SCHEMA … CASCADE`（仅测试）。

## 3. SQLite 去哪了

2026-10-27 移除，删除**之前**打了 tag **`sqlite-final`** 作为归档点；需要单文件部署形态的人从那里 checkout。

| | 删除前 | 删除后 |
|---|---|---|
| 依赖 | `modernc.org/{sqlite,libc,mathutil,memory}` | 只剩 `github.com/lib/pq`（`go.sum` 45 → 2 行） |
| 方言层 | `dialect.go` + 三占位符渲染 + `INSERT OR IGNORE` 双写 + `flexibleBool` | 单一 `rewritePlaceholders` |
| 测试 | 默认临时 SQLite 文件，设 `TT_TEST_DATABASE_URL` 才跑 PG | **必须**给 PG |
| CI | sqlite job + postgres 15/16 | postgres 15/16 |
| compose / adapter | 两份 / `go-sqlite.cjs` + `go-postgres.cjs` | 一份 / 只留 `go-postgres.cjs` |

删的理由不是"PG 更好"，而是**保真度**：SQLite 分支从未承载过真实数据，它绿了也证明不了 PG 上的并发、
约束、类型转换是对的，却要在每次改动里各验一遍。

代价明确承认：`go test` 不能零依赖跑，开发/CI 必须准备一个 PG（`go-server/scripts/test-with-pg.sh`）。

**没有自动搬数工具**：如果真在 `sqlite-final` 上跑过实例，在那条分支导出 CSV/JSONL，再用
[`../users/importing.md`](../users/importing.md) 的 `import-usage.py` 导入，device token 重新签发。

## 4. 还没做的判断

- **多副本**：PG 让多副本在存储层成为可能，但 `ingest` 的整行修正仍是**进程内**互斥，
  多副本同时写同一主键没有 `pg_advisory_xact_lock`，可能互相覆盖。**单实例没有这个问题**，也不打算在单实例需求之外先做它。
- **托管 PG（RDS / Neon / Cloud SQL）**：未验收。连接串、`sslmode=verify-full`、备份策略都按托管方的规矩来，我们没有跑过。
- **原生 `timestamptz`/`numeric`**：见 §2.3，不做。
