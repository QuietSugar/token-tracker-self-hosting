# 文档索引

每个事实只有一个出处，本文档负责指明其位置。

## 四个入口

| 读者角色 | 起始文档 |
|---|---|
| **使用者**（部署、接入客户端、查看用量） | [`users/quickstart.md`](users/quickstart.md) |
| **由 AI 代为部署的使用者** | [`../AGENTS.md`](../AGENTS.md) → [`agents/deploy.md`](agents/deploy.md) |
| **修改代码 / 跟随上游的维护者** | [`status.md`](status.md) → [`design/`](#design--为什么这么做)、[`maintainers/`](#maintainers--怎么维护) |
| **仅需确认能力范围** | [`status.md`](status.md) |

## users/ — 怎么用

| 文档 | 回答的问题 |
|---|---|
| [quickstart.md](users/quickstart.md) | 五分钟内完成从零到「看板中显示数据」 |
| [deploy.md](users/deploy.md) | 长期运行的部署方式：compose / 裸机 / 反向代理 / systemd / 环境变量 / 升级 / 卸载 |
| [dashboard.md](users/dashboard.md) | 内建看板的使用方式、内容、设备改名与限制 |
| [devices.md](users/devices.md) | 新设备接入流程；设备重命名、暂停、按设备查看用量、时区处理 |
| [official-client.md](users/official-client.md) | 官方客户端接入方式；从官方云切换时的行为 |
| [importing.md](users/importing.md) | 历史用量导入方式（两种工具的适用场景） |
| [troubleshooting.md](users/troubleshooting.md) | 启动失败 / 401 / 无数据 / 队列阻塞 |

## agents/ — 给 AI 的剧本

| 文档 | 用途 |
|---|---|
| [deploy.md](agents/deploy.md) | AI 从零将服务部署到一台机器（前置问答 → 判定树 → 验证门 → 停手条件） |
| [develop.md](agents/develop.md) | AI 修改代码 / 文档（仓库地图 → 硬不变量 → 改动流程 → 验证门） |

## design/ — 为什么这么做

| 文档 | 回答的问题 |
|---|---|
| [postgres.md](design/postgres.md) | 为什么只支持 PostgreSQL；SQLite 为何移除；迁移与并发的取舍 |
| [auth.md](design/auth.md) | 身份模型：三种凭据、单 owner、`/api/auth/*`、设备授权三模式的安全边界 |
| [parity.md](design/parity.md) | 「与官方等价」的含义；三层验证方式；有意不等价之处 |

## maintainers/ — 怎么维护

| 文档 | 回答的问题 |
|---|---|
| [README.md](maintainers/README.md) | 仓库里各目录是什么关系 |
| [upstream.md](maintainers/upstream.md) | 上游发布新版本后的判定方式，以及产物锁定与重生成流程 |
| [contract.md](maintainers/contract.md) | 契约的运行方式、通过门槛，以及可重新录制 golden 的条件 |
| [release.md](maintainers/release.md) | 两种镜像的发布流程 |
| [conventions.md](maintainers/conventions.md) | 编码、密钥、提交、文档、已退役的自动化 |

## status.md

能力清单（已验证 / 未验证）、已知缺口、非目标。**请勿在其他文档中重复这些结论**。
