# 仓库约定

## 1. 这是公有仓库

`github.com/QuietSugar/token-tracker-self-hosting` 是 public。**任何 push 都立即对全网可见**，
删提交 / 改历史 / force push 都不等于"已撤销"——**轮换密钥永远优先于清理历史**。

真实凭据只允许存在于实例持有者的机器上（`go-server/.env`、`/etc/tokentracker/env`、`chmod 600`）。
自托管不需要任何付费 / OAuth / 邮件服务商密钥。

推送前：

```sh
./scripts/check-secrets.sh    # 命中即非零退出；不要为了"过检查"放宽它
./scripts/check-encoding.sh   # UTF-8 无 BOM
```

CI（`verify.yml`）会再查一遍，但别把 CI 当唯一防线。误提交的处理顺序：
**先轮换 → 再看访问日志 → 最后才清历史**。

## 2. 文件与文本

- 文本文件 **UTF-8 无 BOM、LF 换行**；扩展名白名单在 `scripts/check-encoding.sh`。
- 中文为主，技术名词保留英文（`device token`、`refresh token`、`golden`、`adapter`）。
- 文档里不贴原始日志、抓包、截图、数据库 dump —— 它们会入库并公开。

## 3. 提交与 PR

- 提交信息中文，前缀用 `fix:` / `feat:` / `docs:` / `build:` / `chore:`，一句话说清"改了什么、为什么"。
- 一个 PR 一件事。文档重构、行为修改、发版产物**不要塞在同一个 PR**。
- 涉及契约的改动必须在 PR 说明里写清"哪个 case 变了、为什么"，golden 变化要逐字段解释。
- 合并用 squash。

## 4. 代码不变量（违反即错）

1. **不改官方客户端**（客户端在它自己的仓库里）。
2. **契约只增不改**：已发布行为不能改语义，新行为单独加并补 golden。
3. **schema 只加不删**：core DDL 的 checksum 钉死；改 DDL = 新的 `additiveSteps`，不是改旧的。
4. **单 owner**：不存在"第二个人能读数据"的路径；多用户后台不是目标。
5. **PostgreSQL 唯一**：不要把 SQLite 引回来（归档在 tag `sqlite-final`）。
6. **`contract/`、`releases/`、`tracking/REF` 是机器资产**：CI 与测试直接读，改动必须跑全链路。
7. `TT_ENABLE_TEST_ENDPOINTS` 的 `/_test/*`（含可执行任意 SQL 的 `/_test/sql`）**生产必须关闭**。

## 5. 测试门槛

```sh
cd go-server && go vet ./... && go test -race ./...
CONTRACT_ADAPTER=./contract/adapters/go-postgres.cjs GO_POSTGRES_URL=… ./contract/scripts/verify.sh
# 33 PASS / 0 FAIL / 2 SKIP
```

有 docker 时 `go-server/scripts/test-with-pg.sh` 一键起临时 PG 跑全套。
没验证过的改动不要合。

## 6. 文档规矩

- 按读者分层：`users/`（怎么用）、`agents/`（AI 剧本）、`design/`（为什么）、`maintainers/`（怎么维护）。
- **每个事实只有一个出处**，别处只链接。写第二遍就一定会和第一遍不一致。
- `users/` 里不写维护者流程、工件、InsForge；`design/` 里不写操作步骤。
- 改了行为就同步文档：端点/参数 → `docs/users/*` + `contract/SPEC.md`；环境变量 → `docs/users/deploy.md`；
  对外可见变化 → `CHANGELOG.md`（每版本 3–5 条）。
- 不写"曾经打算怎么做"的历史论证：git 历史里查得到。

## 7. 已退役的自动化（不要再引入）

早期的维护自动化已经拆除，不要在新文档或脚本里复活它们：

| 已退役 | 现在怎么做 |
|---|---|
| GitHub App 推送（`gh-app-token.cjs`、`push-with-app.sh`） | 直接 `git push`；CI 用 `GITHUB_TOKEN` |
| `bootstrap.sh`、`session-start.sh`、MAINTENANCE 会话启动协议 | 每项工作照 `docs/agents/develop.md` 与各 PR 检查单走 |
| `docs/maintainer-prompt.md` 里的提示词编排 | 判定规则已经固化进 `scripts/upstream.sh` 与文档 |

仍在用、**不要删**：`scripts/upstream.sh`、`build.sh`、`verify.sh`、`check-secrets.sh`、
`check-encoding.sh`、`reproduce.sh`、`summarize.cjs`、`tracking/REF`。
其中 `tracking/REF` 被 CI 与契约测试直接读取。

## 8. CI 的供应链约束

只用官方 `actions/*` 与少数固定版本的可信 action（`docker/*`）；
第三方镜像用 digest 固定（见 `contract.yml` 里的 `postgres:15.18`）。
不要为了省事引入来路不明的 action —— 这个仓库没有密钥可偷，但有产物完整性可破。
