# 给 AI 的开发剧本

你要在这个仓库里改代码或改文档。每一步都有验证门，**过不了不许往下走**；结束时必须能说清"改了什么、证据是什么"。

先读 [`../../AGENTS.md`](../../AGENTS.md) 的硬不变量。部署相关看 [`deploy.md`](deploy.md)。
约定与已退役的自动化见 [`../maintainers/conventions.md`](../maintainers/conventions.md)。

---

## §0 停手条件（先问，不要自己决定）

- 需要**改官方客户端**，或需要改 `base_url` 的校验规则 —— **不许**，那是别人的仓库。
- 需要**改已发布的契约语义**（已 PASS 的用例行为），而不是新增。
- 需要**改 core DDL**（`schemaBody`）而不是加 `additiveSteps`。
- 需要**重录 golden** 让测试变绿。那是把 bug 写进基准。
- 需要动真实/生产数据、删库、删卷。
- 需要引入 SQLite / 第二个数据库引擎。

---

## §1 仓库地图

```
AGENTS.md            硬不变量（改代码前必读）
tracking/REF         锁定点 VERSION + COMMIT（CI 依赖，不要手改，用 upstream.sh pin）
contract/            标准：scenarios / golden / adapters / lib
releases/<ver>/      从锁定点生成的产物（安装 SQL + 14 函数 + SHA256SUMS）
scripts/             工件线工具（upstream / build / verify / check-*）
go-server/           运行时
  cmd/server/        入口（main.go 注释指向 go-server/README.md，保留指针）
  internal/app/      HTTP 层：functions.go 分发表、oauth.go、owner.go、devices.go、ui.go、web/
  internal/store/    PG 层：placeholders.go / db.go / schema.go / checksums.go
  scripts/           issue-token.sh / approve-device.sh / import-usage.py / replay-queue.py / test-with-pg.sh
docker/              工件镜像 CLI（不是运行时）
.github/workflows/   verify / build-image / contract / go-server / build-go-image
```

## §2 环境

```sh
cd go-server
go mod download            # 沙箱里若 GOPROXY=off 失败：GOPROXY=direct GOSUMDB=off
go vet ./... && go build ./cmd/server
```

Go ≥1.24（以 `go.mod` 为准）。**必须有一个 PG**（SQLite 已移除）：

```sh
./scripts/test-with-pg.sh          # docker 一键起临时库，打印 DSN
# 无 docker：pip install --target /tmp/tools pgserver，然后用它给的 unix socket DSN
export TT_TEST_DATABASE_URL='postgresql://postgres:@/postgres?host=/tmp/pgdata'
```

`TT_JWT_SECRET` 重启后要保持一致，否则手头的 token 全废。

## §3 改动流程

1. **先定位「事实的出处」**：端点行为在 `internal/app/functions.go` 的分发表 + 具体 handler；
   schema 在 `internal/store/schema.go`;契约在 `contract/scenarios/*.json`。
   **按代码写文档，不要按旧文档写文档。**
2. 改实现。若涉及 SQL：`?` 占位符（store 层自动改写），不要手写 `$1`。
3. 若涉及表结构：加一条新的 `additiveSteps`（只做 `CREATE … IF NOT EXISTS` 这类可重放加法），
   **绝不改 `schemaBody` 或已发布的 step**。
4. 跑测试（§4）。
5. 跑契约（§4）。PASS 数不能少。
6. 同步文档（§5）。
7. 提交：中文一句话 + 前缀（`fix:` / `feat:` / `docs:` / `build:`）。推送前 `./scripts/check-secrets.sh && ./scripts/check-encoding.sh`。

## §4 验证门

**门 1 — 单元测试**

```sh
cd go-server
go vet ./...                 # 必须干净
go test -race ./...          # 全绿；PG 缺失时相关用例会 SKIP，SKIP 不算过
```

**门 2 — 契约**（脚本在仓库根，先 `cd ..` 回去）

```sh
cd ..
CONTRACT_ADAPTER=./contract/adapters/go-postgres.cjs \
GO_POSTGRES_URL="$TT_TEST_DATABASE_URL" \
./contract/scripts/verify.sh
# 门槛：33 PASS / 0 FAIL / 2 SKIP
```

只改文档或只改看板时，至少跑 `node contract/lib/verify.cjs --static-only`。

**门 3 — 看板只读**：`TestDashboardIsReadOnly` 只允许页面里出现 2 处 `method:"POST"`。
加任何写操作之前先想清楚——看板是只读视图，不是管理后台。

**门 4 — 编码/密钥**：`./scripts/check-encoding.sh`、`./scripts/check-secrets.sh` 都要过。

## §5 文档同步到哪一篇

| 你改了什么 | 改这里 |
|---|---|
| 端点、参数、返回形状、错误形状 | `docs/users/*` 对应页 + 契约新用例（[`../maintainers/contract.md`](../maintainers/contract.md)） |
| 环境变量、部署方式、镜像标签 | `docs/users/deploy.md`、`docs/maintainers/release.md` |
| 设备流程、认证语义 | `docs/users/devices.md`、`docs/design/auth.md` |
| 存储层、迁移、并发取舍 | `docs/design/postgres.md` |
| 与官方的差异（新增/删除偏差） | `docs/design/parity.md` +（真实偏差）`contract/waivers.json` |
| 上游跟进 | `docs/maintainers/upstream.md` |
| 用户能感知的变化 | `CHANGELOG.md`（3–5 条） |

**一个事实只写一处**，别处只链接。别把操作步骤写进 `design/`，别把维护者内容写进 `users/`。

## §6 常见坑

| 坑 | 说明 |
|---|---|
| 时间戳形状 | 服务端键是**字符串**：`…T00:30:00.000Z` ≠ `…T00:30:00Z`，会变成两行。`import-usage.py` 归整到整点；`replay-queue.py` 保留原样 |
| 队列尾部只有控制记录 | 不要回 4xx；真空 body 才 400 |
| 客户端硬编码路径 | `/functions/tokentracker-ingest`，且 `base_url` 只接受 https 或 localhost |
| `app.New()` 冻结时钟 | 曾经导致"登录已失效"，别在测试里依赖真实时钟 |
| 契约用例文件 | 键是 `cases`，不是 `scenarios` |
| 沙箱拉 GitHub raw | `raw.githubusercontent.com` 可能被拦，用 contents API |
| `GOPROXY=off` | 首次构建会失败，用 `GOPROXY=direct GOSUMDB=off go mod download` |

## §7 交付说明里必须有的东西

1. 改了哪些文件、每个为什么；
2. 门 1/2/3/4 的实际输出（PASS/FAIL 数）；
3. 契约是否变化：变了哪几个 case、为什么；
4. 文档同步到了哪几篇；
5. 你**没有**做的事（例如没重录 golden、没动核心 DDL、没碰客户端）。
