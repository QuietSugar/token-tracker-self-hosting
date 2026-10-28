# 发镜像

本仓库发布**两种完全不同的镜像**，请勿混淆标签与用途：

| | 工件镜像（正式） | Go 后端镜像（实验） |
|---|---|---|
| 是什么 | 已审计产物的**载体 + 部署 CLI** | 真正能跑的服务 |
| 内容 | 15 步安装 SQL、迁移 SQL、14 个函数、`SHA256SUMS`、`BUILD.json` | 单二进制 + 内建看板 |
| 跑起来会连库吗 | **不会**（不碰 PG、不碰 InsForge、不持凭据） | 会（PG 是硬依赖） |
| workflow | `build-image.yml` | `build-go-image.yml` |
| 平台 | 只 linux/amd64 | linux/amd64 + linux/arm64 |

## 1. 工件镜像

```sh
# 由 CI 构建：push 到 main 且 Dockerfile / docker/** / releases/** / scripts/** / tracking/REF 变化
# 也支持 workflow_dispatch（可覆盖 upstream_commit）
docker run --rm <image> info        # 版本 / 上游 commit / 摘要
docker run --rm <image> verify      # 内部 SHA256 + 14 函数检查
docker run --rm <image> commands    # 在 VPS 上执行的完整命令
docker run --rm <image> sql > install.sql
docker run --rm -v "$PWD/out:/out" <image> export /out
```

标签：`<version>`、`<version>-<short_sha>`、`latest`（仅默认分支）、`sha-<short>`；
带 OCI labels 与 `dev.tokentracker.upstream.commit`。构建期有 SBOM / provenance，
每週一定时重建做可复现性回归。

镜像**不含**平台：PostgreSQL / PostgREST / InsForge API / Deno worker 由实例持有者自己部署
（HTTPS 与 OAuth 同样由持有者负责）。部署命令与边界见 `docker run --rm <image> commands`。

## 2. Go 后端镜像

```sh
docker pull ghcr.io/quietsugar/token-tracker-self-hosting-go:experimental-<short_sha>
```

标签：`experimental`、`experimental-<short_sha>`、`sha-<short>`。**刻意不发 `latest`** ——
实验镜像不允许成为任何人的隐式默认。

CI 顺序是硬的：**build amd64 → 真 PG 冒烟 → 多平台 build+push**。
冒烟不过就不产生任何 tag。冒烟内容（`build-go-image.yml` 的 `Smoke test — PostgreSQL mode`）：真 PG 上起容器、
`/health` 200、启动日志 `engine=postgres` 且密码已脱敏、`/_test/sql` 返回 404。
数据面（ingest / 读回）由 `go-server.yml` 的契约对拍覆盖，不在镜像冒烟里重复。

GHCR 包默认私有，要给别人用需要在包设置里改可见性。

## 3. 一次 Go 后端发版检查单

1. `cd go-server && go vet ./... && go test -race ./...` 全绿；
2. 契约 **33 PASS / 0 FAIL / 2 SKIP**（[`contract.md`](contract.md)）；
3. 文档同步：改了端点行为 → `docs/users/*` + 契约用例；
4. `CHANGELOG.md` 加 3–5 条用户能感知的变化（不要写内部重构）；
5. push 到 main（`go-server/**` 变化会触发镜像构建），确认冒烟通过、tag 是 `experimental-<short_sha>`；
6. 需要固定版本的地方（compose 示例、给别人的部署命令）用 **`experimental-<short_sha>`**，不要用浮动的 `experimental`。

## 4. 工件线发版检查单

1. `./scripts/upstream.sh status` 确认锁定点；
2. `./scripts/build.sh`（覆盖旧产物要 `FORCE=1`，会改变审计基准，别随手用）；
3. `./scripts/verify.sh releases/<ver>`：SHA256、UTF-8 无 BOM、函数数量 = 14；
4. [`upstream.md`](upstream.md) 更新追踪表与两个结论；
5. 提交 `releases/<ver>` + `tracking/REF` + `docs/maintainers/upstream.md`；
6. 镜像由 CI 构建，本地不需要也不应该手工推。

## 5. 不该做的事

- 不要给实验镜像打 `latest`，也不要把两种镜像的标签混用；
- 不要在镜像里烘焙凭据、实例地址、`~/.tokentracker` 内容；
- 不要手工改 `releases/` 里的产物（校验和会失效，CI 直接红）；
- 不要跳过冒烟直接推镜像。
