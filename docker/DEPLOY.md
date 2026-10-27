# TokenTracker 自托管部署工件镜像

本镜像是**应用侧产物的载体 + 部署 CLI**，不是 InsForge 平台本身。

## 镜像内容

| 路径 | 内容 |
|---|---|
| `/opt/tokentracker/artifacts/tokentracker-install.sql` | 15 步应用基线（独立事务 + 安装锁，幂等） |
| `/opt/tokentracker/artifacts/tokentracker-migration.sql` | 同上但无事务包装，供平台迁移通道 |
| `/opt/tokentracker/artifacts/functions/` | 14 个 async CommonJS 私有函数 + `functions.json` |
| `/opt/tokentracker/artifacts/manifest-report.md` | 步骤 id、`sha256(step.sql)`、依赖与函数清单 |
| `/opt/tokentracker/artifacts/SHA256SUMS` | 全部产物校验和 |
| `/opt/tokentracker/BUILD.json` | 版本、上游 commit、构建时间、平台 |

产物的 `SHA256SUMS` 在镜像构建时由 Dockerfile 的 `verify` 阶段强制校验；CI 另有 `reproduce` job 从上游锁定 commit 重建并与仓库审计产物逐字节比对。

## 命令

```sh
docker run --rm <image> info          # 版本 / 上游 commit / 摘要
docker run --rm <image> verify        # 内部校验和 + 14 函数检查
docker run --rm <image> functions     # 函数清单
docker run --rm <image> commands      # 输出在 VPS 上执行的完整命令
docker run --rm <image> sql > install.sql
docker run --rm <image> migration > migration.sql
docker run --rm -v "$PWD/out:/out" <image> export /out
```

完整流程见 `docker run --rm <image> commands`；发版与校验见仓库 `docs/maintainers/release.md`。

## 边界

- 镜像**不**连接数据库、**不**调用 InsForge API、**不**上传函数、**不**持有凭据。
- 服务端密钥（`INSFORGE_SERVICE_ROLE_KEY`、`JWT_SECRET` 等）只在 VPS 上配置。
- **PostgreSQL 是硬依赖**：安装 SQL 依赖 `jsonb`、RLS、`auth.uid()`、`pg_advisory_xact_lock` 等 PG 特性，且要求 InsForge 平台预置的 `auth.users` 表与 `anon`/`authenticated`/`project_admin` 角色。不能换成 MySQL/SQLite。详见仓库 `docs/design/postgres.md`。
- `TOKENTRACKER_DASHBOARD_URL` 必须指向自有 HTTPS dashboard；函数内的源码锚点校验会拒绝回落官方域名。
- 付费 webhook、社区排行榜、`device-usage-reset` 被有意排除，不要额外部署。
- 仅构建 **linux/amd64**（x86_64）。ARM64 未验证。

## 上游来源

上游仓库：<https://github.com/xiufengsun/TokenTracker>（MIT）。
本镜像由 <https://github.com/QuietSugar/token-tracker-self-hosting> 的 GitHub Actions 构建，锁定 commit 见 `BUILD.json` 与 `org.opencontainers.image.*` / `dev.tokentracker.*` labels。
