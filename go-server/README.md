# go-server/

TokenTracker 自托管后端（Go + PostgreSQL）。**这里是运行时**；官方行为的"标准"在仓库根的 `contract/`。

文档不在这里维护，避免两处说法不一致：

| 你想做的事 | 去哪 |
|---|---|
| 5 分钟跑起来 | [`../docs/users/quickstart.md`](../docs/users/quickstart.md) |
| 正式部署 / 环境变量 / 反代 / 升级 | [`../docs/users/deploy.md`](../docs/users/deploy.md) |
| 官方客户端接入、设备管理 | [`../docs/users/official-client.md`](../docs/users/official-client.md)、[`../docs/users/devices.md`](../docs/users/devices.md) |
| 出问题了 | [`../docs/users/troubleshooting.md`](../docs/users/troubleshooting.md) |
| 现状 / 已知缺口 | [`../docs/status.md`](../docs/status.md) |
| 设计取舍（为什么只有 PG） | [`../docs/design/postgres.md`](../docs/design/postgres.md) |
| 改代码 / 跑契约 | [`../AGENTS.md`](../AGENTS.md) → [`../docs/agents/develop.md`](../docs/agents/develop.md) |

```sh
go vet ./... && go test -race ./...     # 需要一个 PG
./scripts/test-with-pg.sh               # 有 docker 时一键起临时库
```
