# 跟进上游

上游是 `https://github.com/xiufengsun/TokenTracker.git`（客户端 + 它自己的自托管后端）。
本仓库锁定一个 commit，从它生成产物、并照着它实现 Go 后端。

**锁定点是唯一真相**：[`../../tracking/REF`](../../tracking/REF) 里的 `VERSION` + `COMMIT`。
`scripts/build.sh`、`scripts/upstream.sh`、CI 都读它，别在别处硬编码版本号。

## 1. 当前锁定

| 项 | 值 |
|---|---|
| 版本 | **1.5.0** |
| commit | `b2c2eb8545cee15d517f4fd6e783191c2ba30117` |
| 自托管清单 | 15 步安装 + 14 个私有函数（与 1.4.12 相同） |
| 1.4.15 → 1.5.0 | 安装 / 迁移 SQL、14 个函数 bundle、`functions.json` **全部逐字节相同**；唯一落在契约路径下的变更是 `edge-patches/tokentracker-leaderboard-profile.ts`（我们没实现该函数）；**35 个行为用例 + `static.json` 依赖版本逐字节相同** → **后端无需动作** |

## 2. 版本追踪表（跟着 REF 走）

| 上游版本 | commit | 清单 | 变化 | 结论 |
|---|---|---|---|---|
| 1.3.9 | `626f5601` | 14 步 | 规划起点 | 历史基线 |
| 1.3.14 | `b19d27b0` | 15 步 | 新增 `13-machine-alias-cascade`；model-breakdown 加 CompressionStream 兼容 | 重新生成 SQL + 函数，升级部署 |
| 1.4.7 | `12f8a479` | 15 步 | 无清单变化；云端新增 `device-usage-reset`（**不纳入自托管**，上游设计如此） | 客户端升级即可 |
| 1.4.12 | `8d32a956` | 15 步 | 契约 diff 空 | 后端无需动作 |
| 1.4.13 | `2f19cd46` | 15 步 | Qoder 解析器修复（客户端侧） | 后端无需动作 |
| 1.4.14 | `9dc925d8` | 15 步 | macOS 菜单栏、sessions 页 UI；本地 API 后台读取 | 后端无需动作 |
| **1.4.15** | `4cf3e212` | 15 步 | 定价表新增 `gpt-6.1-terra`（3 个 `account-*` bundle 变，行为用例不变）；Grok 配额、sessions 效率列 | **后端无需动作**；行为契约已在 1.4.15 golden 上重跑（33 PASS / 2 SKIP） |
| **1.5.0** | `b2c2eb85` | 15 步 | 契约路径下仅 `leaderboard-profile`（榜单资料卡 `totals` 改用 lifetime snapshot，新增 `source` 字段）——**不在我们的 14 个函数内**；其余为客户端侧（sessions 页支持 DeepSeek Harness、zcode 重置卡倒计时、限额面板） | **后端无需动作**：产物与 1.4.15 逐字节相同；重录的 1.5.0 golden 与 1.4.15 golden 逐字节相同（仅版本号与时间戳不同）；Go 契约 33 PASS / 2 SKIP |

> 1.5.0 的安装 SQL 与 1.4.12 / 1.4.15 逐字节相同，所以 [`contract/L3-RESULTS.md`](../../contract/L3-RESULTS.md)
> 里那次真实四容器栈的并发结果（1.4.15 基线）对 1.5.0 同样成立，不必重跑。

> 关于"14 步"：上游文档与早期归档写"14 application steps"，那是 2026-10-09 的快照
> （缺 `13-machine-alias-cascade`）。以 `require('./scripts/self-host/manifest.cjs').steps()` 的实际输出为准 —— **15 步**。
> `privateFunctions` 是 **14 个**，与文档一致。

## 3. 上游发版后怎么做

前提：有一份上游 checkout（默认 `../TokenTracker`，可用 `UPSTREAM_DIR` 覆盖）。

```sh
./scripts/upstream.sh status            # 锁定点是什么、上游 HEAD 在哪
./scripts/upstream.sh fetch             # 只读拉取
./scripts/upstream.sh review <new-sha>  # 契约路径 diff + 两个结论
```

`review` 判定的路径（已固化进脚本）：

```
scripts/self-host  'docs/self-hosting*'
dashboard/edge-patches        scripts/build-cloud-functions.cjs  migrations
```

> `dashboard/edge-patches` 必须整目录收：`account-*` 的模型定价表在
> `edge-patches/tokentracker-account-*.ts` 里，不在 `cloud/` 子目录下。早先只盯 `cloud/`，
> 1.4.15 评审时被误报过「契约 diff 空」——实际有 3 个函数的 bundle 变了。

| diff 结果 | 结论 | 动作 |
|---|---|---|
| 为空 | 自托管契约未变 | 只看 `src/`、`dashboard/src/` 评估客户端是否值得升级；后端不动 |
| `steps()` 或 `privateFunctions` 变了 | **升级信号** | `pin` 新 commit → `build.sh` → 看产物 diff → 同步 Go 实现 → 跑契约 → 发镜像 |
| 只有 edge-patches 新增模型定价 | 函数签名不变、行为用例不变 | 产物里 3 个 `account-*` bundle 会变；Go 后端不含定价表（`pricing.status=unpriced`，成本取客户端上传值）→ **后端不动**，只需重录 golden 并重建产物 |

锁定新版本：

```sh
./scripts/upstream.sh pin <commit> <version>   # 改 tracking/REF 并留 PINNED_AT
./scripts/build.sh                             # 生成 releases/<version>/；覆盖已有产物要 FORCE=1
./scripts/verify.sh releases/<version>         # SHA256 + 编码 + 函数数量
```

然后更新本文件的版本追踪表，`git add releases/<version> tracking/REF docs/maintainers/upstream.md` 并提交。

## 4. 为什么产物线不能退役

它**是标准**，不是历史包袱：官方客户端一更新就可能出现新 API，我们的后端要跟着更新。
所以每次上游更新都要重新生成产物、diff、再同步 Go 实现 —— 这条循环是维护的核心，
不是"迁移完就可以扔掉的一次性脚手架"。

## 5. 升级的硬约束（工件线）

上游安装器把每步 `sha256(step.sql)` 记进 `public.tokentracker_self_host_installations`：

- 已安装且 checksum 一致 → 跳过；
- 新增步骤 → 执行并登记；
- 已安装但 checksum 不一致 → `RAISE EXCEPTION` 整体回滚。

所以：**升级 = 用新 commit 重新生成完整 SQL 并重跑**，不是手写增量迁移；**旧步骤 SQL 绝不可改**。
`install.cjs --migration` 生成的是不带事务包装的迁移版，供平台迁移通道用。

## 6. 依赖锁定

参考实现构建时钉住的依赖，录在 `contract/golden/<ver>/static.json` 的 `dependencies` 里
（当前：`@insforge/sdk@1.4.5`、`alipay-sdk@4.14.0`、`urllib@4.9.1`、`@waffo/pancake-ts@0.25.0`）。
我们自己的 Go 依赖只有 `github.com/lib/pq`（`go.mod`）。

升级评审必须高亮任何依赖版本变化；`static.json` 变了就是 golden 变了，要按 [`contract.md`](contract.md) §5 解释。

## 7. 客户端行为的取证方式

要判断"客户端会不会这么做"，读上游 `src/`，不要猜。已知的关键点（本项目据此设计）：

| 位置 | 行为 |
|---|---|
| `src/lib/runtime-config.js` → `normalizeInstanceBaseUrl()` | `base_url` 只接受 `https:` 或 `http://localhost` |
| `src/commands/init.js` | 换了 `baseUrl`/`anonKey` → `resetInstanceState()` + 清 device token |
| `resetInstanceState()` | `queue.state.json` 写回 `{offset:0}`，清 relay cookie / 限流状态；**不动 `queue.jsonl`** |
| `src/commands/sync.js` | 按 `offset` 续传；批 200 桶、单次上限 500、预算 90s；`--drain` 100 批 |
| `docs/PRIVACY.md` | 只有 `tracker/queue.jsonl` 会外传；`project.queue.jsonl`、`session.queue.jsonl` 永不外传 |

沙箱里 `curl raw.githubusercontent.com` 可能被拦，用 GitHub contents API 或网页抓取。
