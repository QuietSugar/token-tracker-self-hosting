# L3 真实并发语义测试结果

生成时间：2026-10-26T12:51:16Z

环境：本地隔离运行的官方 InsForge v2.3.3 四容器栈；非用户 VPS；PostgreSQL **15.18**（真实多连接服务端）

应用基线：上游 TokenTracker v1.4.15，commit `4cf3e2125b8e274d03b7210c2fd0e1124e23f987`；15 步 SQL 首次安装与原样重跑均成功。
（1.4.12 时的基线为 `8d32a956`；两版安装 SQL 与迁移 SQL 逐字节相同，结果可直接沿用。）

## 镜像与运行时

| 服务 | 版本 | OCI 镜像摘要 |
|---|---|---|
| InsForge PostgreSQL | PostgreSQL 15.18 | `ghcr.io/insforge/postgres@sha256:23b767e82e17da08cec1dc0c1214e3002a06154e73a2cb4dfad30ab540405698` |
| PostgREST | v12.2.12 | `postgrest/postgrest@sha256:5f4ce744539bbba786b4e24dbbd95bdb2a956dcf568c5374995a0ff4a68f5bd2` |
| InsForge OSS | v2.3.3 | `ghcr.io/insforge/insforge-oss@sha256:a8d84d71b5ae3d076628d6f4d03961b49599a5d127e42739e983dfe3122259bd` |
| Deno function runtime | 2.0.6 | `denoland/deno@sha256:b64881926dcb3ba183b8767a4542aac69343dbc97008c22a60208cf07e4a21cc` |

L3 自动化在 `.github/workflows/contract.yml` 中另以 digest 固定的官方 `postgres:15.18` 服务运行，并用最小 InsForge auth/role schema 做 CI gate；CI workflow 本轮尚未推送或执行。

## 测试结果

| 测试 | 内容 | 结果 |
|---|---|---|
| T1 | 跨连接 advisory lock 互斥（会话 2 等待 2532 ms，期望 ≥2000 ms） | ✅ PASS |
| T2 | 8 连接并发重装（退出码全部 0，错误 0，安装 ledger 15 步） | ✅ PASS |
| T3 | 并发重装后 step checksum 与 golden 一致 | ✅ PASS |
| T4 | RLS / 角色权限矩阵：anon/authenticated 直接读取与受限 RPC 均拒绝 | ✅ PASS（`f|f|f|f`）|
| T5 | 10 个独立连接对同一键并发 upsert | ✅ PASS（1 行 / 100 tokens；退出码全 0，错误 0）|

**合计：5 PASS / 0 FAIL**

> 这一层是 PGlite（单连接 WASM）无法覆盖的。L1/L2 用 PGlite 做可复现的行为录制；L3 用真实 PostgreSQL 做并发/锁语义验证。结果只验证正式 PostgreSQL 路径的这些特定场景，不代表 Go/SQLite 已完成压力、故障恢复或生产验收。
