# 数据库选型：PostgreSQL 是硬依赖吗？

> 结论按实现版本区分：**当前正式自托管后端（InsForge + TypeScript edge functions）硬依赖 PostgreSQL**，不能直接换 MySQL/SQLite/MongoDB。
> 我们后来建立了一个**实验性 Go 兼容实现**，同一份代码支持 SQLite 与 PostgreSQL（用 `TT_DATABASE_URL` 切换），
> 两者都通过 33 个可移植行为契约（另 2 个 PG 专属安装账本测试显式 SKIP）；但它目前只覆盖垂直切片，
> **不等价于完整正式后端，也不是生产替代品**。详见 [`../go-server/STATUS.md`](../go-server/STATUS.md) 与
> [`go-postgres.md`](go-postgres.md)。

---

## 1. 为什么不能换数据库引擎

### 1.1 应用侧 SQL 深度绑定 PostgreSQL

`releases/1.4.12/tokentracker-install.sql`（4,712 行 / 270 KB）的实测统计：

| PostgreSQL 特性 | 出现次数 | 说明 |
|---|---:|---|
| `jsonb` / `jsonb_*` | 338 | 用量数据、缓存、事件载荷的核心类型 |
| `timestamptz` / 时区 | 217 | 按小时/日/月聚合的语义基础 |
| PL/pgSQL 函数与触发器 | 82 | 聚合、缓存失效、身份刷新 |
| `GRANT` / `REVOKE` | 61 | 权限模型 |
| CTE (`WITH`) | 38 | 复杂聚合查询 |
| `pg_advisory_xact_lock` | 33 | 安装幂等与并发写入串行化 |
| `hashtextextended` | 33 | advisory lock 的键 |
| RLS (行级安全) | 28 | 私有数据隔离的核心机制 |
| `ON CONFLICT` | 22 | 幂等 upsert |
| `RETURNING` | 21 | 写入即返回 |
| PL/pgSQL `DO` 块 | 17 | 前置校验与条件迁移 |
| `auth.uid()` | 24 | 每用户身份判定 |
| `SECURITY DEFINER` | 2 | 受限提权 |

这不是"加个适配层"能解决的——**是语义级绑定**。例如 `jsonb` 聚合、`pg_advisory_xact_lock` 的跨连接互斥、RLS 策略、`auth.uid()` 与 JWT 声明的联动，都要在数据库内部执行。

### 1.2 安装器的第一行就要求 InsForge 的 PG 对象

```sql
DO $preflight$ BEGIN
    IF to_regclass('auth.users') IS NULL OR to_regprocedure('auth.uid()') IS NULL OR
      NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') OR
      NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') OR
      NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_admin' AND rolbypassrls) THEN
      RAISE EXCEPTION 'Install the compatible InsForge auth schema and API roles first';
    END IF;
    ...
```

`auth.users` 表、`auth.uid()` 函数、`anon` / `authenticated` / `project_admin` 三个角色（且 `project_admin` 必须 `BYPASSRLS`），全部由 InsForge 平台在 PostgreSQL 里创建。应用表还有 8+ 处 `REFERENCES auth.users(id)` 外键。

**没有 InsForge 的 PG schema，安装器会直接拒绝执行。** 这不是 TokenTracker 的设计选择，而是它选定的运行时平台决定的。

### 1.3 运行时链路也锁死在 PG 上

14 个私有函数通过 `@insforge/sdk` 的 `createClient(...).from(...)` / `.rpc(...)` 访问数据；SDK 走的是 **PostgREST** 协议。而 PostgREST 只能连接 PostgreSQL（要求 ≥ 9.6，新版 ≥ 13）。[参考 4](https://docs.postgrest.org/en/v10/install.html)

InsForge 官方自托管栈就是四个容器：`postgres` / `postgrest` / `insforge` / `deno`。[参考 2](https://docs.insforge.dev/deployment/deploy-to-hetzner) [参考 3](https://docs.insforge.dev/deployment/deployment-security-guide)

---

## 2. 当前正式 InsForge 路径：其他选择是 PG 的部署形态

对于**当前 v1.4.12 + InsForge v2.3.3**正式自托管包，可选的是 PostgreSQL 的部署形态，不是数据库引擎本身。按推荐度排序：

| # | 方案 | 可行性 | 主要代价 / 风险 | 适合 |
|---|---|---|---|---|
| **A** | **官方 Compose 内置 `postgres` 容器**（默认） | ✅ 上游 v2.3.3 实测（PG 15.18） | 需要自己备份；`pg_dump` 必须用 15 系工具（镜像默认 18.4 会因 `transaction_timeout` 失败） | **绝大多数场景，推荐** |
| **B** | **同机/异机自建 PG，Compose 只跑无状态服务** | ✅ 有成熟模板（Pigsty `app/insforge`） | 需手工创建 `anon`/`authenticated`/`project_admin` 角色、`bypassrls`、安装 `pgcrypto`/`http`/`pg_cron` 扩展、导入 InsForge baseline SQL；应用连接要 `project_admin` 级权限 [参考 5](https://doc.pigsty.io/docs/app/insforge/) | 已有 PG 运维体系 / 需要 HA、PITR、监控 |
| **C** | **托管 PostgreSQL**（Neon / Supabase / RDS / Cloud SQL / AlloyDB…） | ⚠️ 理论可行，实操高风险 | 托管服务不给真 superuser（Neon 是 `neon_superuser`，RDS 是 `rds_superuser`）；扩展有白名单；`pg_cron` 在 Neon 上只在 compute 活跃时跑；`project_admin` 的 `BYPASSRLS` 与自建角色可能不被允许 [参考 6](https://neon.com/docs/reference/compatibility.html) [参考 7](https://www.supascale.app/blog/using-external-managed-postgres-with-selfhosted-supabase) [参考 8](https://neon.com/docs/extensions/pg_cron) | 仅在你能确认平台允许所需角色与扩展时 |
| **D** | **PGlite**（PostgreSQL 编译成 WASM） | ⚠️ 仅测试 | 单连接、单用户、无并发、`alpha` 状态；上游确实用它跑真实 handler + SDK + SQL 的单元/回归测试，但明确不能当生产服务器 [参考 9](https://hysenlabs.com/projects/electric-sql-pglite) [参考 10](https://dev.co/databases/open-source/pglite) [参考 11](https://supabase.com/blog/database-build-live-share) | **CI 可复现性校验**（本仓库的 `verify.yml` 就是用它做语义测试的上游参考，但我们用真实 PG） |
| **E** | **PostgreSQL 兼容的分布式库**（CockroachDB / YugabyteDB） | ❌ 未验证，高危 | wire 协议兼容 ≠ 语义兼容；RLS、advisory lock、PL/pgSQL、扩展、`auth` schema 都是未知数；上游零验证 | 不建议 |
| **F** | **换掉整个 InsForge 平台**，自己写 API 层 + 任意数据库 | ❌ 等于重写项目 | 14 个函数、SDK、认证、设备流、RLS 全要重做 | 不在当前维护范围 |

### 关于 D（PGlite）的澄清

上游 `package.json` 里有 `@electric-sql/pglite`、`sql.js`、`@journeyapps/wa-sqlite` 三个依赖，**它们只用于测试**，不是生产数据库：

- `test/self-host-backend.test.js` 用 PGlite 起独立的 PG 实例，跑真实打包后的 handler 和 SDK（loopback HTTP）。
- 上游文档明确写过：PGlite **不能证明真实多连接锁行为**；并发/竞态测试必须在真实 PostgreSQL 上跑。

所以"上游用了 SQLite/WASM"≠"生产可以不用 PG"。

---

## 3. 对当前项目的影响

- **本仓库交付的 Docker 镜像不含数据库**（见 `docs/docker-image.md`）。它是产物载体，SQL 由实例持有者在 VPS 上执行。
- 因此数据库部署形态的选择**完全独立于镜像**：镜像对 A/B/C 三种方案都适用，只要目标 PG 里已有 InsForge 的 `auth` schema 与三个角色。
- `tracking/REF` 锁定的 v1.4.12 契约与 PG 版本无关，但上游只在 **PostgreSQL 15.18 + InsForge v2.3.3 + Deno 2.0.6** 组合上做过完整验收。换 PG 大版本属于"未验证变更"，需要在 `releases/<ver>/acceptance.md` 里单独记录。

### 若选择方案 B/C，部署前必须验证的清单

1. `auth.users` 与 `auth.uid()` 存在。
2. `anon`、`authenticated`、`project_admin` 三个角色存在，且 `project_admin` 的 `rolbypassrls = true`。
3. `project_admin` 对 `auth` schema 有 `USAGE`，对 `auth.users.id` 有 `SELECT`。
4. `gen_random_uuid()` 可用（`pgcrypto` 或 PG 13+ 内置）。
5. 支持 `jsonb`、`timestamptz`、`pg_advisory_xact_lock`、`hashtextextended`、RLS、`DO` 块、`SECURITY DEFINER`。
6. `pg_dump`/`pg_restore` 客户端版本与服务端主版本一致。
7. `db migrations up --all` 前先确认 `current.project.oss_host` 是自有实例。

---

## 4. 决策记录

- **2026-10-26（初始结论）**：对当前正式 InsForge/TypeScript 后端，PostgreSQL 是不可替代依赖；默认方案 A（官方 Compose 内置 PG 15.18）。依据见 §1。
- **2026-10-26（新目标）**：用户明确希望后续把后端改为 SQLite + Golang。于是新增 `go-server/` 实验垂直切片，而不是继续声称 SQLite 绝对不可能。它不改动正式 InsForge 产物，状态与限制见 [`../go-server/STATUS.md`](../go-server/STATUS.md)。
- **真实验收**：官方 InsForge v2.3.3 Compose 栈在隔离容器环境运行，PostgreSQL 15.18；15 步 SQL 安装/重装通过；L3 真实多连接测试 5 PASS / 0 FAIL（advisory lock、8 并发重装、RLS 矩阵、并发幂等 upsert）。说明见 `../contract/L3-RESULTS.md`。
- **2026-10-26（Go 后端支持 PostgreSQL）**：用户要求 Go 版本支持 PG。做法不是"再写一份 PG 实现"，而是
  在 `go-server/internal/store` 加一层方言适配（`?`→`$n`、布尔/幂等插入/DDL 渲染、连接池、schema 隔离），
  业务代码保持单份。同一批 33 个契约用例在 **SQLite 与真实 PostgreSQL 上都 33 PASS / 0 FAIL / 2 SKIP**；
  CI 新增 PG 15/16 矩阵。设计与取舍见 [`go-postgres.md`](go-postgres.md)。
- **关于"只留 PG 是否更省维护"**：会少一个引擎与一条流水线，但省不掉真正的成本大头
  （24 表映射、session states、客户端 E2E、安全审查）；SQLite 的边际成本已降到"同一批测试跑两遍"。
  结论与观察期计划写在 [`go-postgres.md`](go-postgres.md) §5，未做删除决定。
- 触发原因：用户先问 PG 是否必需，后要求进行 SQLite + Golang 改造并尽可能保持行为一致。
- 依据：本仓库 `releases/1.4.12/tokentracker-install.sql`、上游 `docs/self-hosting*.md`、InsForge/PostgREST 官方架构、真实 PostgreSQL 15.18 验收、契约 golden 与 Go adapter 对比结果。

## 参考

1. InsForge 官方架构（PostgreSQL + PostgREST + Deno）— <https://github.com/InsForge/InsForge#self-hosted-docker-compose>
2. InsForge 部署文档：四个服务 — <https://docs.insforge.dev/deployment/deploy-to-hetzner>
3. InsForge VPS 安全指南：服务与端口 — <https://docs.insforge.dev/deployment/deployment-security-guide>
4. PostgREST 安装要求（需要 PostgreSQL）— <https://docs.postgrest.org/en/v10/install.html>
5. Pigsty `app/insforge` 外部 PG 模板（角色、扩展、baseline）— <https://doc.pigsty.io/docs/app/insforge/>
6. Neon 兼容性：无真 superuser — <https://neon.com/docs/reference/compatibility.html>
7. 托管 PG 与自托管栈的 superuser/扩展冲突 — <https://www.supascale.app/blog/using-external-managed-postgres-with-selfhosted-supabase>
8. Neon 上 pg_cron 的限制 — <https://neon.com/docs/extensions/pg_cron>
9. PGlite：单连接、单用户、alpha — <https://hysenlabs.com/projects/electric-sql-pglite>
10. PGlite 不适合多用户生产 — <https://dev.co/databases/open-source/pglite>
11. PGlite 无法并发连接 — <https://supabase.com/blog/database-build-live-share>
