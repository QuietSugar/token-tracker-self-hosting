# AGENTS.md

给在这个仓库里干活的 AI/自动化 agent。人类读者从 [`README.md`](README.md) 和 [`docs/README.md`](docs/README.md) 进。

## 你在哪个仓库里

`TokenTracker` 自托管后端。两条产品线，**别混**：

| | 是什么 | 谁在管 |
|---|---|---|
| **工件线** | 从上游客户端版本生成的标准（SQL + 函数契约 + SHA256） | `contract/`、`releases/`、`tracking/REF`；由 CI 与契约测试驱动 |
| **Go 后端** | 真正跑起来的服务（单二进制 + PostgreSQL） | `go-server/` |

改代码前先读 `docs/design/`（设计与取舍）与 `docs/maintainers/conventions.md`（维护与仓库约定）。

## 硬不变量（违反即错）

1. **不改官方客户端**。客户端只在它自己的仓库里；本仓库只提供它要的后端行为。
2. **契约只增不改**。已发布的行为不能改语义；新增行为单独加用例并补 golden（规则见 `docs/maintainers/contract.md`）。
3. **schema 只加不删**。core DDL 的 checksum 与迁移账本绑定；改 DDL = 新的迁移，不是改旧的。
4. **单 owner**。`auth_owner` 是单例，不存在"第二个人能读数据"的路径。多用户后台不是目标。
5. **PostgreSQL 是唯一引擎**。SQLite 已删除，不要以任何形式引回。
6. `users/` 文档里**不写**维护者流程、工件、InsForge；`design/` 里**不写**操作步骤。一个事实只有一个出处，别处只链接。
7. 文本文件 **UTF-8 无 BOM、LF**；中文为主，技术名词保留英文。

## 常用命令

```sh
cd go-server
go vet ./... && go test -race ./...        # 单测（PG 相关会 SKIP）

# 契约对拍（需要 PG）；脚本在仓库根，先 cd 回去
cd ..
CONTRACT_ADAPTER=./contract/adapters/go-postgres.cjs \
GO_POSTGRES_URL='postgres://…' ./contract/scripts/verify.sh
# 门槛：33 PASS / 0 FAIL / 2 SKIP
```

## 要装东西 / 要部署

- 部署剧本：[`docs/agents/deploy.md`](docs/agents/deploy.md)（含验证门与**停手条件**）
- 用户侧事实来源：[`docs/users/`](docs/users/)（`deploy.md` 有完整环境变量表）

**停手条件**：需要删/重建数据库或卷、需要暴露公网、需要改别人的生产服务、或有人给你一个来源不明的 DSN —— 先问，不要自己决定。

## 文档改哪里

| 你改了什么 | 同步更新 |
|---|---|
| 端点行为 / 参数 / 返回形状 | `docs/users/*` 对应页 + 契约新用例 |
| 环境变量 / 部署方式 | `docs/users/deploy.md` |
| 设计取舍 | `docs/design/*` |
| 上游跟进 / 发版 | `docs/maintainers/*` |
| 对外可见的变化 | `CHANGELOG.md`（每版本 3–5 条，只写用户能感知的） |
