# TokenTracker 自托管

> 把 [TokenTracker](https://github.com/xiufengsun/TokenTracker)（MIT）的「云端同步」换成**跑在你自己机器上的后端**。
> 官方客户端照常安装使用，只把 `base_url` 指向你的地址。
>
> 本仓库**不是**上游的 fork，也不含上游源码。

---

## 仓库包含两个部分

| | 是什么 | 谁需要 |
|---|---|---|
| **运行时**：Go 后端<br>`go-server/` | 单二进制 + 一个 PostgreSQL。实现上游 v1.4.12 的 14 个私有函数核心路径（设备接入 / 用量上传 / `account-*` 汇总）+ `/api/auth/*` + 内建只读看板。 | 需要自托管用量数据的使用者 |
| **标准**：上游工件线与契约<br>`releases/` `contract/` `tracking/` | 从锁定的上游 commit 生成 InsForge 基线与 14 个函数，作为「官方行为」的基准；Go 后端据此对齐。上游更新后重新生成 → diff → 同步实现 → 运行契约。 | 维护者（跟随上游更新） |

运行时供使用者部署，标准供维护者对齐上游。只部署、不改代码的使用者无需涉及第二行。

---

## 文档入口

| 目标 | 阅读文档 | 前置条件 |
|---|---|---|
| **五分钟启动服务** | [`docs/users/quickstart.md`](docs/users/quickstart.md) | Linux + Docker（或 Go 1.24 + 一个 PostgreSQL） |
| **长期部署到 NAS / 小主机** | [`docs/users/deploy.md`](docs/users/deploy.md) | 同上，并确定端口与反向代理方式 |
| **接入官方客户端** | [`docs/users/official-client.md`](docs/users/official-client.md) | 官方客户端 + 一个 `https://` 或 `localhost` 地址 |
| **接入新设备 / 管理设备** | [`docs/users/devices.md`](docs/users/devices.md) | 同上 |
| **仅查看用量（不安装客户端）** | [`docs/users/dashboard.md`](docs/users/dashboard.md) | 浏览器 |
| **导入历史用量** | [`docs/users/importing.md`](docs/users/importing.md) | 导出文件，或客户端本地队列 |
| **故障排查** | [`docs/users/troubleshooting.md`](docs/users/troubleshooting.md) | — |
| **由 AI 协助部署** | [`AGENTS.md`](AGENTS.md) → [`docs/agents/deploy.md`](docs/agents/deploy.md) | 一个能执行命令的 AI |
| **当前能力与已知缺口** | [`docs/status.md`](docs/status.md) | — |

文档全索引：[`docs/README.md`](docs/README.md)。

---

## 三项前提

1. **局域网自用**：单实例、单账户（owner）、注册默认关闭、不做第三方登录。不假设有公网入口。
2. **只支持 PostgreSQL**：不提供 SQLite 模式（2026-10 移除，归档于 tag `sqlite-final`），也不提供内置数据库选项。
3. **不改官方客户端**：客户端仅作为黑盒使用；对客户端自身拒绝的配置（例如局域网 IP 的明文 `http`）**不做绕过**，而是为其提供合规地址（[`docs/users/official-client.md`](docs/users/official-client.md)）。

---

## 当前状态：experimental

服务可运行、可接入真实客户端，但尚未达到生产 GA。

- ✅ 官方客户端 v1.4.12 实测通过：`init` / `device-login` / `sync` / `doctor`，含跨设备汇总视图
- ✅ 契约：35 个用例里 **33 PASS / 0 FAIL / 2 SKIP**（PostgreSQL 15/16 都跑；两个 SKIP 是上游专属的安装账本用例）
- ✅ Go 镜像的构建/运行基镜像按 OCI digest 固定；推送前强制跑真实 PG 冒烟
- ⚠️ 没有速率限制 / 审计日志 / 多副本锁；`contract` 覆盖不到的边界仍未知
- ⚠️ 备份与恢复**不在本仓库范围内**：属于数据库维护者的职责，可使用 `pg_dump` / PITR 或托管 PG 自带能力

细节与缺口清单：[`docs/status.md`](docs/status.md)。

---

## 目录

```
go-server/          运行时：Go 后端（代码、镜像、脚本、测试）
docs/               所有文档（索引在 docs/README.md）
contract/           标准：契约用例、golden 快照、Go adapter（机器资产）
releases/           从上游生成的工件（SQL + 14 个函数），按上游版本分目录
tracking/REF        上游锁定点（版本 + commit），构建与 CI 的唯一来源
scripts/            工件线工具（upstream / build / verify / check-*）
docker/             工件镜像内的部署 CLI
env/                环境变量示例
```

`docs/` 内部分层：`users/`（怎么用）、`design/`（为什么这么做）、`maintainers/`（怎么跟上游、怎么发布）、`agents/`（给 AI 的剧本）。

---

## 上游与许可

- 上游：<https://github.com/xiufengsun/TokenTracker>（MIT），当前锁定 **v1.4.12 / `8d32a956`**
- 本仓库：<https://github.com/QuietSugar/token-tracker-self-hosting>（公有仓库，**不要把任何凭据提交进来**）
- 上游源码在本仓库只读；我们只生成工件、只写自己的实现与记录
