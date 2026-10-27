# 文档索引

一个事实只有一个出处；这里告诉你它在哪。

## 四个入口

| 我是… | 从这开始 |
|---|---|
| **要用它的人**（部署、接客户端、看用量） | [`users/quickstart.md`](users/quickstart.md) |
| **要交给 AI 部署的人** | [`../AGENTS.md`](../AGENTS.md) → [`agents/deploy.md`](agents/deploy.md) |
| **要改代码 / 跟上游的人** | [`status.md`](status.md) → `design/`、`maintainers/`（见下方清单） |
| **只想确认它能做什么** | [`status.md`](status.md) |

## users/ — 怎么用

| 文档 | 回答的问题 |
|---|---|
| [quickstart.md](users/quickstart.md) | 五分钟内从零到「看板里有数字」 |
| [deploy.md](users/deploy.md) | 长期跑起来：compose / 裸机 / 反代 / systemd / 环境变量 / 升级 / 卸载 |
| [dashboard.md](users/dashboard.md) | 内建只读看板怎么用、有什么、没有什么 |
| [devices.md](users/devices.md) | 一台新机器怎么接进来；设备重命名、暂停、按设备看用量、时区 |
| [official-client.md](users/official-client.md) | 官方客户端怎么连；从官方云切过来会发生什么 |
| [importing.md](users/importing.md) | 历史用量怎么进来（两种工具怎么选） |
| [troubleshooting.md](users/troubleshooting.md) | 起不来 / 401 / 没数据 / 队列卡住 |

## agents/ — 给 AI 的剧本

| 文档 | 用途 |
|---|---|
| [deploy.md](agents/deploy.md) | 一个 AI 从零把服务部到你机器上的完整流程（含前置问答、验证门、停手条件） |

## status.md

能力清单（已验证 / 未验证）、已知缺口、非目标。**别在别处重复这些结论**。

## 正在补齐的部分

`design/`（为什么只有 PostgreSQL、认证怎么设计、与上游的等价范围）与 `maintainers/`（上游跟踪与工件产线、契约测试、发布、仓库约定）还在迁移中；迁移期间旧文档仍在 `docs/` 顶层，完成后会删除。
