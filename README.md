# TokenTracker 自托管

> 把 [TokenTracker](https://github.com/xiufengsun/TokenTracker)（MIT）的「云端同步」换成**跑在你自己机器上的后端**。
> 官方客户端照常安装使用，只把 `base_url` 指向你的地址。
>
> 本仓库**不是**上游的 fork，也不含上游源码。

---

## 仓库里有两个东西，别混

| | 是什么 | 谁需要 |
|---|---|---|
| **运行时**：Go 后端<br>`go-server/` | 单二进制 + 一个 PostgreSQL。实现上游 v1.4.12 的 14 个私有函数核心路径（设备接入 / 用量上传 / `account-*` 汇总）+ `/api/auth/*` + 内建只读看板。 | 想自托管用量数据的人 |
| **标准**：上游工件线与契约<br>`releases/` `contract/` `tracking/` | 从锁定的上游 commit 生成 InsForge 基线与 14 个函数，作为「官方行为」的基准；Go 后端照着它对齐。上游一更新就重新生成 → diff → 同步实现 → 跑契约。 | 维护者（跟上游的人） |

换句话说：**运行时给人用，标准给维护者用**。只部署不用改代码的人，永远不需要碰第二行。

---

## 你该从哪篇读

| 我想… | 读这个 | 需要什么 |
|---|---|---|
| **5 分钟把服务跑起来** | [`docs/users/quickstart.md`](docs/users/quickstart.md) | Linux + Docker（或 Go 1.24 + 一个 PostgreSQL） |
| **正式部署到 NAS / 小主机** | [`docs/users/deploy.md`](docs/users/deploy.md) | 同上 + 决定好端口和反代方式 |
| **让官方客户端连上来** | [`docs/users/official-client.md`](docs/users/official-client.md) | 官方客户端 + 一个 `https://` 或 `localhost` 地址 |
| **接新设备 / 管理设备** | [`docs/users/devices.md`](docs/users/devices.md) | 同上 |
| **只看用量（不装客户端）** | [`docs/users/dashboard.md`](docs/users/dashboard.md) | 浏览器 |
| **把历史用量导进来** | [`docs/users/importing.md`](docs/users/importing.md) | 导出文件，或客户端本地队列 |
| **出问题了** | [`docs/users/troubleshooting.md`](docs/users/troubleshooting.md) | — |
| **交给 AI 帮我部署** | [`AGENTS.md`](AGENTS.md) → [`docs/agents/deploy.md`](docs/agents/deploy.md) | 一个能执行命令的 AI |
| **现在到底能做什么、缺什么** | [`docs/status.md`](docs/status.md) | — |

文档全索引：[`docs/README.md`](docs/README.md)。

---

## 三条底线（所有文档都建立在它上面）

1. **局域网自用**：单实例、单账户（owner）、注册默认关闭、不做第三方登录。不假设有公网入口。
2. **只支持 PostgreSQL**：没有 SQLite 模式（2026-10 移除，归档在 tag `sqlite-final`）。也没有"内置数据库"这种选项。
3. **不改官方客户端**：客户端只被当作黑盒；它自己拒绝的东西（比如局域网 IP 的明文 `http`）我们**不绕过**，而是给它一个合规的地址（[`docs/users/official-client.md`](docs/users/official-client.md)）。

---

## 当前状态：experimental

能跑、能接真实客户端，但还不是生产 GA。

- ✅ 官方客户端 v1.4.12 实测通过：`init` / `device-login` / `sync` / `doctor`，含跨设备汇总视图
- ✅ 契约：33 个行为用例 PASS（PostgreSQL 15/16 都跑），2 个是有意 SKIP
- ✅ 镜像按 OCI digest 固定，推送前强制跑真实 PG 冒烟
- ⚠️ 没有速率限制 / 审计日志 / 多副本锁；`contract` 覆盖不到的边界仍未知
- ⚠️ 备份与恢复**不在本仓库范围内**：那是数据库维护者的事，用 `pg_dump` / PITR 或托管 PG 自带能力

细节与缺口清单：[`docs/status.md`](docs/status.md)。

---

## 目录

```
go-server/          运行时：Go 后端（代码、镜像、脚本、测试）
docs/               所有文档（索引在 docs/README.md）
contract/           契约：golden 快照、场景、SPEC、Go adapter
releases/           从上游生成的工件（SQL + 14 个函数），按上游版本分目录
tracking/           上游锁定点（REF）与版本追踪表
scripts/            仓库级校验（编码、密钥、产物）
docker/             工件镜像内的部署 CLI
env/                环境变量示例
```

`docs/` 内部分层：`users/`（怎么用）、`design/`（为什么这么做）、`maintainers/`（怎么跟上游、怎么发布）、`agents/`（给 AI 的剧本）。

---

## 上游与许可

- 上游：<https://github.com/xiufengsun/TokenTracker>（MIT），当前锁定 **v1.4.12 / `8d32a956`**
- 本仓库：<https://github.com/QuietSugar/token-tracker-self-hosting>（公有仓库，**不要把任何凭据提交进来**）
- 上游源码在本仓库只读；我们只生成工件、只写自己的实现与记录
