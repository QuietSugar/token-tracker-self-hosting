# Docker 镜像交付（linux/amd64）

> 目标：把「已审计的自托管应用侧产物」做成可分发的 OCI 镜像，用 GitHub Actions 构建、推送到 GHCR。
> 目前只构建 **linux/amd64**（x86_64）。ARM64 未验证，不提供。

---

## 1. 定位与边界

```
[上游 GitHub main@固定 commit] --reproduce--> [本仓库 releases/<ver>/ 审计产物]
                                                    |
                                        GitHub Actions build-image.yml
                                                    |
                                     [ GHCR OCI 镜像 ] --docker run--> SQL / 14 函数 / commands
                                                    |
                                          实例持有者在 VPS 上手动部署
```

**镜像是产物载体 + 部署 CLI，不是 InsForge 平台本身。**

| 镜像做 | 镜像不做 |
|---|---|
| 携带 15 步基线 SQL、迁移 SQL、14 个私有函数、校验和、清单 | 运行 PostgreSQL / PostgREST / InsForge API / Deno worker |
| 校验内部 SHA256SUMS 与函数数量 | 连接数据库或调用 InsForge API |
| 输出 SQL / 函数清单 / 完整部署命令 | 执行 psql、上传函数 |
| 导出产物到挂载目录 | 持有任何服务端凭据 |

InsForge 平台（VPS、Docker Compose、HTTPS、OAuth）仍由实例持有者按[官方文档](https://github.com/InsForge/InsForge#self-hosted-docker-compose)部署。

---

## 2. 镜像内容

| 路径 | 说明 |
|---|---|
| `/opt/tokentracker/artifacts/tokentracker-install.sql` | 独立事务 + 安装锁，幂等；首次安装用 |
| `/opt/tokentracker/artifacts/tokentracker-migration.sql` | 无事务包装，供 InsForge 平台迁移通道 |
| `/opt/tokentracker/artifacts/functions/*.js` | 14 个 async CommonJS 私有函数 |
| `/opt/tokentracker/artifacts/functions/functions.json` | 函数名 → 文件映射、公开入口、所需密钥、排除项 |
| `/opt/tokentracker/artifacts/manifest-report.md` | 15 步 id 与 `sha256(step.sql)`、依赖锁定 |
| `/opt/tokentracker/artifacts/SHA256SUMS` | 全部产物校验和 |
| `/opt/tokentracker/BUILD.json` | 版本、上游 commit、构建时间、平台、Node 版本 |
| `/opt/tokentracker/DEPLOY.md` | 镜像内自带的部署说明 |
| `/usr/local/bin/tokentracker` | 部署 CLI |

- 基础镜像：`node:20-alpine`；非 root（`uid 10001`）运行；`tini` 作为 PID 1。
- 镜像不含凭据；服务端密钥只在 VPS 上配置。

---

## 3. 使用

```sh
IMAGE=ghcr.io/quietsugar/token-tracker-self-hosting:1.4.12

docker run --rm "$IMAGE" info                 # 版本 / 上游 commit / 摘要
docker run --rm "$IMAGE" verify               # 内部校验和 + 14 函数检查
docker run --rm "$IMAGE" functions            # 函数清单
docker run --rm "$IMAGE" commands             # 输出在 VPS 上要执行的完整命令
docker run --rm "$IMAGE" sql > install.sql    # 直接取 SQL
docker run --rm "$IMAGE" migration > migration.sql
docker run --rm -v "$PWD/out:/out" "$IMAGE" export /out   # 导出全部产物
```

`docker-compose.example.yml` 提供了 `info` / `verify` / `commands` / `export` 四个一次性服务示例。
`export` 以 uid 10001 写入，宿主机目录需可写。

**部署顺序**（在 VPS 上，由人执行）：

1. 备份数据库（PG 15 系工具）。
2. `export` 产物 → `sha256sum -c SHA256SUMS`。
3. `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tokentracker-install.sql`。
4. 校验 `tokentracker_self_host_installations` 为 **15 行**且 checksum 与 `manifest-report.md` 一致。
5. 按 `functions.json` 通过自有 InsForge 管理界面上传 14 个函数。
6. 配置函数侧环境变量（`INSFORGE_BASE_URL`、`INSFORGE_SERVICE_ROLE_KEY`、`ANON_KEY`、`JWT_SECRET`/`JWT_PUBLIC_KEY`、`TOKENTRACKER_DASHBOARD_URL`、`TOKENTRACKER_BILLING_ENVIRONMENT`）。
7. 客户端 `npx tokentracker init --base-url ... --anon-key ... --dashboard-url ...`。
8. 按 `docs/runbook.md` 与 `releases/<ver>/acceptance.md` 验收。

完整命令由 `docker run --rm "$IMAGE" commands` 生成，避免手抄出错。

---

## 4. 构建流水线

`.github/workflows/build-image.yml`：

| 能力 | 实现 |
|---|---|
| 触发 | push(main，路径过滤) / PR（只构建不推送）/ `workflow_dispatch` / 每周定时回归 |
| 平台 | `linux/amd64` 单平台（`PLATFORMS` env） |
| 可复现性硬门槛 | `reproduce` job：从锁定上游 commit 重建产物，与 `releases/<ver>/SHA256SUMS` 逐字节比对，不一致即失败 |
| 层缓存 | `type=gha` scope `tokentracker-selfhost-amd64` |
| 标签 | `<version>`、`<version>-<short_sha>`、`latest`（默认分支）、`sha-<short>` |
| OCI labels | `org.opencontainers.image.*` + `dev.tokentracker.*`（上游 commit、版本、平台） |
| SBOM / provenance | `docker/build-push-action` 的 `sbom` + `provenance`（推送时启用） |
| SLSA attestation | `actions/attest-build-provenance@v2`（推送时，`continue-on-error` 避免阻塞） |
| 冒烟测试 | `info` / `verify` / `functions --json` / `sql` / `export` + 导出后 `sha256sum -c` |
| 权限 | 顶层 `contents: read`；build job 才提权到 `packages: write` / `id-token: write` / `attestations: write` |

**触发条件细节**：workflow 只在 `Dockerfile`、`docker/`、`releases/`、`scripts/{build,summarize,reproduce}.sh`、`tracking/REF`、workflow 自身变化时重跑。文档改动不会触发镜像重建。

`workflow_dispatch` 支持 `upstream_commit`（完整 40 位 hex，留空用 `tracking/REF`）与 `push`（是否推送）。覆盖 commit 会打 warning，**必须已评审**——CI 的 reproduce 会拿它与 `releases/<ver>/SHA256SUMS` 比对，不匹配就失败。

### 权限与 GHCR 可见性

- 用内置 `GITHUB_TOKEN` + `packages: write` 推送，无需 PAT。
- **GHCR 包首次推送默认是 private**。要让别人免登录拉取，需到仓库 → Packages → 包设置 → 改为 **public**（一次性操作）。[8](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
- fork 的 PR 不会推送镜像（无 `packages: write`），只做构建与冒烟测试。

---

## 5. 可复现性设计

产物的 `manifest-report.md` 含生成时间与本地路径，会破坏跨环境一致性。修复方式：

- `summarize.cjs` 用 `SOURCE_DATE_EPOCH`（上游 commit 的提交时间）生成时间，且不写入本地绝对路径。
- `build.sh` 与 `reproduce.sh` 都导出相同的 `SOURCE_DATE_EPOCH` 和 `TT_VERSION`。
- 生成的 SQL / 函数 / 报告统一 `chmod 644`，避免权限影响镜像层。

结果：本地 `./scripts/build.sh` 与 CI `./scripts/reproduce.sh` 产出的 `SHA256SUMS` **逐字节一致**（已实测两次构建一致）。镜像的 `verify` 阶段还会用 `sha256sum -c` 再校验一次。

---

## 6. 升级到新上游版本

1. `./scripts/upstream.sh review` → 判定契约是否变化。
2. 按 `docs/prompts.md` 提示词 B 写 `releases/<new>/review.md`。
3. `./scripts/upstream.sh pin <sha> <ver>` → 把上游 checkout 移到新 commit。
4. `./scripts/build.sh` → 生成新产物；`./scripts/verify.sh releases/<new>` → 校验。
5. 提交 `releases/<new>/` 与 `tracking/REF` → 自动触发 `build-image.yml`。
6. CI 的 reproduce 会验证新产物可由新 commit 重建；通过后推送 `<new>` 标签镜像。
7. 在 VPS 上按新镜像的 `commands` 升级（先 SQL 后函数），写 `acceptance.md`。

**旧版本镜像与 `releases/<old>/` 都不删除**，它们是回滚时唯一的已知函数来源。

---

## 7. 已知限制

- 只有 `linux/amd64`。需要 ARM64 时改 `PLATFORMS` 并重新验证函数产物（esbuild 输出应与平台无关，但未实测）。
- 镜像不自动部署。`apply` / 上传函数都由人在 VPS 上执行——这是刻意的安全边界。
- `TOKENTRACKER_DASHBOARD_URL` 是函数运行时读取的，镜像构建期不需要它；但部署时必须配置为自有 HTTPS 域名，否则设备授权会失败（源码锚点校验拒绝回落官方 dashboard）。
- 镜像层含 `manifest-report.md`，其中记录了依赖锁定版本；升级时需高亮任何依赖变化。
