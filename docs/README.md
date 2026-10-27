# 文档索引

一个事实只有一个出处；这里告诉你它在哪。

## 四个入口

| 我是… | 从这开始 |
|---|---|
| **要用它的人**（部署、接客户端、看用量） | [`users/quickstart.md`](users/quickstart.md) |
| **要交给 AI 部署的人** | [`../AGENTS.md`](../AGENTS.md) → [`agents/deploy.md`](agents/deploy.md) |
| **要改代码 / 跟上游的人** | [`status.md`](status.md) → [`design/`](#design--为什么这么做)、[`maintainers/`](#maintainers--怎么维护) |
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
| [deploy.md](agents/deploy.md) | AI 从零把服务部到一台机器上（前置问答 → 判定树 → 验证门 → 停手条件） |
| [develop.md](agents/develop.md) | AI 改代码 / 改文档（仓库地图 → 硬不变量 → 改动流程 → 验证门） |

## design/ — 为什么这么做

| 文档 | 回答的问题 |
|---|---|
| [postgres.md](design/postgres.md) | 为什么只有 PostgreSQL；SQLite 为什么删；迁移与并发怎么取舍 |
| [auth.md](design/auth.md) | 身份模型：三种凭据、单 owner、`/api/auth/*`、设备授权三模式的安全边界 |
| [parity.md](design/parity.md) | 「和官方等价」到底指什么；哪三层验证；哪些地方有意不等价 |

## maintainers/ — 怎么维护

| 文档 | 回答的问题 |
|---|---|
| [README.md](maintainers/README.md) | 仓库里各目录是什么关系 |
| [upstream.md](maintainers/upstream.md) | 上游发新版后怎么判断「要不要动」、怎么锁定和重生成产物 |
| [contract.md](maintainers/contract.md) | 契约怎么跑、门槛是多少、什么时候能重录 golden |
| [release.md](maintainers/release.md) | 两种镜像分别怎么发 |
| [conventions.md](maintainers/conventions.md) | 编码、密钥、提交、文档、已退役的自动化 |

## status.md

能力清单（已验证 / 未验证）、已知缺口、非目标。**别在别处重复这些结论**。
