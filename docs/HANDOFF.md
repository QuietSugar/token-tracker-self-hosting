# TokenTracker Self-host：接手说明

更新日期：2026-10-26

当前已推送基线：`7a2c58f` — `Implement Go SQLite experiment and validate real PG stack`

> 本文是跨环境的快速交接入口；完整规则仍以 `MAINTENANCE.md` 和各专项状态文件为准。不要把密钥、token、用户数据或本机环境变量写进 Git。

## 1. 先读这些文件

建议顺序：

1. `MAINTENANCE.md` — 维护边界、会话启动协议、安全规则和标准流程。
2. `README.md` — 仓库目标与当前整体状态。
3. `tracking/REF` — 上游 TokenTracker 锁定版本和 commit。
4. `docs/reality-review-2026-10-26.md` — 项目现状审计与设计决策。
5. `contract/RESULTS.md`、`contract/L3-RESULTS.md` — 行为契约、真实 PostgreSQL 并发验收结果。
6. `go-server/STATUS.md` — Go 实验实现（SQLite / PostgreSQL）的覆盖范围、缺口和生产阻断项。
   `docs/go-postgres.md` — 为什么只用 PostgreSQL、「删掉 SQLite」的决定记录与验收证据。

会话开始时依照 `MAINTENANCE.md` 执行：

```sh
./scripts/bootstrap.sh
./scripts/session-start.sh
```

快照环境可能不保留 `.git/config`；`bootstrap.sh` 会恢复 `origin` 和提交身份。不要把它打印的凭据存在性信息误当作凭据已经安全或有效。

## 2. 架构与范围边界

- **正式自托管路径**：上游 TokenTracker v1.4.12 的 SQL / 14 个 handler 工件，运行于 InsForge + PostgreSQL。交付路径和说明见 `releases/1.4.12/`、`docs/docker-image.md`。
- **实验性替代方向**：`go-server/` 是 Go 垂直切片（存储层只用 PostgreSQL），不是完整重写、不是 InsForge 内的 SQLite，也不是生产 GA。禁止与正式工件镜像混用或据当前结果接入真实用户。
- 上游源代码应保持只读，当前锁定 commit 见 `tracking/REF`。未经明确授权，不修改上游 checkout 或部署到用户 VPS。

## 3. 已记录的验证结果

| 检查 | 记录结果 | 解释 |
|---|---:|---|
| 参考实现 vs Golden 自测 | 35 PASS / 0 FAIL | PGlite + 上游 handler 的自洽测试 |
| Go 候选契约（PostgreSQL） | 33 PASS / 0 FAIL / 2 SKIP | 两个 SKIP 是明确的 PostgreSQL 专属迁移账本行为，不代表全功能等价 |
| Go 候选契约（PostgreSQL 16.2） | 33 PASS / 0 FAIL / 2 SKIP | 同一份代码、同一批 golden，只换引擎 |
| 真实 PG 15.18 L3 | 5 PASS / 0 FAIL | advisory lock、并发重装、权限矩阵、并发 upsert；不是 Go/SQLite 压力测试 |
| Go race / vet / linux-amd64 构建 | 曾通过 | 在新的环境接手时应重新运行并确认工具链版本 |
| Go Docker image smoke | 曾通过 | `/health` 200、非 root、DB 文件 0600、生产 `/_test/sql` 为 404 |

上述结果和运行细节分别见 `contract/RESULTS.md`、`contract/L3-RESULTS.md`、`go-server/STATUS.md`。GitHub Actions 对 commit `7a2c58f` 的运行结果尚待确认；不要把本地验收等同于 CI 或 VPS 验收。

## 4. 推荐的下一步

1. 在 GitHub Actions 中检查 commit `7a2c58f` 对应的 contract、Go candidate、image 和 L3 jobs；处理失败并更新状态记录。
2. 在具备 Go 1.24.4 和 Docker 的环境重跑 Go race tests、vet、合同对比和镜像 smoke。空间受限时将 Go module cache 放到临时目录，或验收后清理 `~/go/pkg/mod`。
3. 继续补充 `go-server/STATUS.md` 中的数据模型、边界行为、安全审查、备份恢复、负载和客户端 E2E 缺口；每次变更都更新结果文档。
4. 保持 Go 标签为 `experimental`。是否继续推进到 GA 由用户另行明确决定。
   （SQLite 支持已于 2026-10-27 移除，归档 tag `sqlite-final`。）

## 5. 常用验证命令

```sh
# 正式 v1.4.12 工件
./scripts/verify.sh releases/1.4.12

# 静态契约（无需上游运行时）
node contract/lib/verify.cjs --static-only

# 参考实现自测（需要固定版本的上游 checkout 和 Node 依赖）
./contract/scripts/self-test.sh

# Go 候选实现（PostgreSQL）
cd go-server
export TT_TEST_DATABASE_URL='postgres://…?sslmode=disable'  # 存储层只支持 PG，没有默认库
go test -race ./...
TT_TEST_DATABASE_URL='postgres://user:pass@127.0.0.1:5432/db?sslmode=disable' \
  go test -race ./...                                                 # 真实 PostgreSQL
go vet ./...
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -o bin/tokentracker-server ./cmd/server
cd ..
CONTRACT_ADAPTER=./contract/adapters/go-postgres.cjs ./contract/scripts/verify.sh
GO_POSTGRES_URL='postgres://user:pass@127.0.0.1:5432/db?sslmode=disable' \
  CONTRACT_ADAPTER=./contract/adapters/go-postgres.cjs ./contract/scripts/verify.sh

# 真实标准环境 L3（仅隔离测试环境；需要 Docker、psql）
./contract/scripts/standard-env.sh up
./contract/scripts/standard-env-test.sh
```

运行正式标准环境时，凭据只保存在本机 `insforge-standard` 工作目录，不提交到仓库。结束后可停止容器；不要误把测试栈称作用户 VPS 部署。

## 6. 凭据规则

- 不提交任何 PEM、PAT、`.env`、账号信息或用户数据；不要在对话中粘贴 token。
- 推送需使用用户授权、最小权限且短期有效的凭据；推送完成后按用户安全策略撤销或轮换。
- 遇到缺失或过期凭据时先请求安全授权，不读取、猜测或复用历史本机凭据。
