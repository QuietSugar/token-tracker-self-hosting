# 变更记录

本文件记录**本运维仓库自身**的变更，不记录上游发布（上游版本见 `tracking/upstream.md`）。

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
- ⚠️ **安全事项**：App 私钥曾被直接粘贴在对话中，视为已泄露，需尽快在 App settings 轮换（见 `docs/github-app-setup.md` §9）。
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
