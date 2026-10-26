# 长期维护契约（Maintenance Contract）

> **本文件是长期维护的最高优先级说明。任何接手本仓库的 Agent（包括上下文重置后的我）必须先读它。**
> 核心原则：**状态存在仓库里，不存在对话记忆里。**

---

## 0. 会话启动协议（每次维护会话的前两条命令）

```sh
cd /path/to/token-tracker-self-hosting
./scripts/bootstrap.sh        # 第 0 步：恢复 remote 与提交身份
./scripts/session-start.sh    # 第 1 步：恢复上下文状态
```

> ⚠️ **为什么需要 `bootstrap.sh`**：本维护环境的工作区快照**不保存 `.git/config` 与 `~/.gitconfig`**。
> 实测：每个新会话里 `git remote -v` 为空、`git commit` 报 `Author identity unknown`，
> 但提交历史 / refs / index 完好。所以每次开工必须先自举配置，再谈维护。
> 在普通机器上 clone 的仓库不会有这个问题，脚本可安全重复运行（幂等）。

`session-start.sh` 会输出：锁定点、版本追踪表、最近提交、已有产物、未完成待办、上游状态、安全检查结果。

**然后按顺序读这 5 处，即可恢复完整上下文（无需用户重新解释背景）：**

1. 本文件 `MAINTENANCE.md` — 角色、规则、SOP
2. `tracking/REF` — 当前锁定的上游 commit
3. `tracking/upstream.md` — 版本追踪表（单一事实来源）+ 契约判定规则
4. 最新 `releases/<ver>/review.md` 与 `acceptance.md` — 上次评审与验收结论
5. `docs/maintainer-prompt.md` — 原始维护提示词（职责与硬性规则）

> 如果某次会话只说「检查上游」或「升级」，直接按第 3 节 SOP 执行，不要反问基础信息。

---

## 1. 角色与边界

**我是这个仓库的长期维护 Agent。** 仓库：<https://github.com/QuietSugar/token-tracker-self-hosting.git>（**public**）。

| 我负责 | 我不负责 |
|---|---|
| 跟踪上游 `xiufengsun/TokenTracker` main | InsForge 平台搭建（VPS / Docker / HTTPS / OAuth） |
| 判定自托管契约是否变化 | 执行 psql / 应用 SQL |
| 生成基线 SQL 与 14 个私有函数 | 上传函数到 worker |
| 输出升级评审、执行顺序、回滚方案 | 写 `~/.tokentracker/config.json` |
| 维护版本追踪、评审/验收记录、CHANGELOG | 连接或操作用户的实例 |
| 保证产物可复现（SHA-256） | 持有或使用真实凭据 |

**关于"长期"的现实约束**：我无法主动定时运行或后台常驻。每次循环需要用户一句话触发（例如「检查上游」「升级到最新版」「生成本版产物」）。触发后我应能完整执行，不要求用户重新交代背景。若用户希望自动化，可在 GitHub Actions 里加一个定时 `upstream.sh review` 的只读检查（见第 7 节）。

---

## 2. 触发条件

- 上游发布新版本（用户告知，或 `upstream.sh review` 发现新提交）
- 用户说：检查上游 / 有更新吗 / 升级 / 生成产物 / 做评审 / 验收
- 用户想复核某次部署或回滚
- 安全相关：疑似凭据误提交 → 立即走 `SECURITY.md`

## 2.1 推送认证（GitHub App）

**默认且唯一的推送方式**：GitHub App 的 installation token，不用 PAT。

| 项 | 值 |
|---|---|
| 配置文件 | `~/.config/tokentracker-gh-app/config.env`（仓库之外，永不入库） |
| 私钥 | `~/.config/tokentracker-gh-app/private-key.pem`（chmod 600，仓库之外） |
| 换取 token | `node scripts/gh-app-token.cjs`（JWT → installation token，1 小时有效） |
| 推送 | `./scripts/push-with-app.sh -u origin main` |
| 配置指南 | [`docs/github-app-setup.md`](docs/github-app-setup.md) |

必需的 App 权限：**Contents: R/W** + **Workflows: R/W**（后者决定能否推送 `.github/workflows/`；PAT 就是因为缺它而被拒）。Metadata: Read 是自动的。

推送前必跑 `./scripts/check-secrets.sh`。私钥与 token 都不得进入仓库或聊天记录；疑似泄露时先轮换私钥（立即失效），再清历史。

提交身份（`hall <sugarjellyfish@gmail.com>`）与推送凭据无关，由 `bootstrap.sh` 设置；两者可以独立更换。

---

## 3. 标准循环（SOP）

```
[触发]
  │
  ├─(A) 每次触发都做 ────────────────────────────────
  │   0. ./scripts/bootstrap.sh         （恢复 remote / 提交身份）
  │   1. ./scripts/session-start.sh     （恢复上下文）
  │   2. ./scripts/upstream.sh review
  │   3. 更新 tracking/upstream.md：
  │      两个明确结论 —— ① 自托管契约是否变化 ② 客户端是否值得升级
  │
  ├─(B) 契约未变 ───────────────────────────────────
  │   4. 只记录结论（CHANGELOG + 一行 commit），后端不动
  │      评估客户端升级价值（src/ 与 dashboard/src/ 的变化）
  │      结束。
  │
  └─(C) 契约变化 ───────────────────────────────────
      4. ./scripts/upstream.sh pin <新commit> <新版本>
         （并把上游 checkout 移到该 commit）
      5. 写 releases/<ver>/review.md（用 _template/review.md）
         - diff 新旧 manifest-report.md：步骤数、新增步骤、旧步骤 checksum
         - diff 函数产物与 functions.json
         - 高亮依赖版本变化
         - 输出执行顺序与回滚方案
      6. ./scripts/build.sh
      7. ./scripts/verify.sh releases/<ver>
      8. 由人在 VPS 部署；结果写 releases/<ver>/acceptance.md
      9. 更新 CHANGELOG，commit（message 带上上游 commit SHA）
     10. ./scripts/check-secrets.sh && ./scripts/push-with-app.sh -u origin main
```

### 硬停止条件（出现即停，不要绕过）

- `install.cjs` 报 `Installed step has changed` → 上游改了旧步骤 SQL，违反"只增不改"契约，必须重新评审。
- `build-functions.cjs` 报依赖版本不一致 → 先审查依赖变更，不要强行放宽校验。
- `check-secrets.sh` 未通过 → 不推送（公有仓库）。
- 旧步骤 checksum 出现任何变化 → 停止，高亮兼容性影响。

---

## 4. 每次循环必须留下的记录

| 文件 | 内容 |
|---|---|
| `tracking/upstream.md` | 版本追踪表新增一行 + 两个结论 |
| `releases/<ver>/review.md` | 升级评审（diff、影响、执行顺序、回滚、责任划分） |
| `releases/<ver>/acceptance.md` | 验收结果与取证方式（**不贴原始日志/截图**） |
| `CHANGELOG.md` | 本运维仓库自身的变更 |
| git commit | 产物与记录一起提交，message 带上上游 commit SHA |

**没有记录的维护等于没做。** 公有仓库里，这些记录也是给未来接手者（或失忆的我自己）看的。

---

## 5. 决策树速查

| 现象 | 结论 | 动作 |
|---|---|---|
| 契约路径 diff 为空 | 后端契约未变 | 只评估客户端，记录结论 |
| `manifest.cjs` 的 `steps()` 增加 | 正常升级 | 生成新产物，重跑完整 SQL |
| `manifest.cjs` 的 `steps()` 减少 / 旧步骤 SQL 变化 | **异常** | 停止，评审兼容性 |
| `privateFunctions` 变化 | 函数契约变化 | 评审 + 重新部署函数 |
| 仅 edge-patches 新增定价条目 | 签名不变 | 通常无需重部署；需要新定价才重新构建 |
| 依赖锁定版本变化 | 构建链变化 | 高亮，先验证再部署 |
| 上游无新提交 | 无动作 | 记录一行即可 |

契约路径（判定命令见 `upstream.sh review`）：
`scripts/self-host`、`docs/self-hosting*`、`dashboard/edge-patches/cloud`、`scripts/build-cloud-functions.cjs`、`migrations`。

---

## 6. 硬性规则（继承 + 公有仓库强化）

1. **只读优先**：未获允许不改上游源码、不执行部署、不连接实例。
2. **命令必须真实**：每个结论给依据（源码位置、commit SHA、测试输出）。失败即原样贴错，不用"应该成功"代替。
3. **不混入云端功能**：付费 webhook、社区排行榜、`device-usage-reset` 等不纳入自托管。
4. **步骤只增不改**：升级 = 新增步骤；旧步骤 SQL 绝不可改。
5. **UTF-8 无 BOM / LF**：所有生成与修改的文本文件都要通过 `check-encoding.sh`。
6. **公有仓库**：推送前必跑 `check-secrets.sh`；不提交任何真实域名、密钥、日志、dump、客户端 config。
7. **产物入库且不删旧版**：`releases/<旧版本>/` 是回滚时唯一的已知函数来源。
8. **凭据轮换优先**：疑似泄露先轮换，再清历史（见 `SECURITY.md`）。

---

## 7. 可选的自动化（未来增强）

当前 `upstream.sh review` 是**只读**的，适合放在 CI 定时任务里：

```yaml
# .github/workflows/upstream-watch.yml（示意，尚未创建）
on:
  schedule:
    - cron: '0 6 * * 1'   # 每周一 06:00 UTC
  workflow_dispatch:
jobs:
  check:
    steps:
      - checkout 上游（xiufengsun/TokenTracker）+ 本仓库
      - 运行 upstream.sh review，把契约 diff 作为 artifact
      - 有变化时开一个 issue 提醒维护者
```

注意：CI 只做**检查与提醒**，不自动 `pin`、不自动部署——决策权在人。

---

## 8. 灾难恢复 / 交接

如果对话上下文完全丢失、换模型、或换人接手：

1. `git clone <远程>` 或直接用 `tokentracker-selfhost.bundle` 恢复。
2. 运行 `./scripts/bootstrap.sh`（新环境必做，恢复 remote 与提交身份）。
3. 运行 `./scripts/session-start.sh`。
4. 按第 0 节读 5 处文件。
5. `tracking/REF` 给出构建点；`tracking/upstream.md` 给出历史决策；`releases/` 给出所有历史产物。
6. 需要重建产物：把上游 checkout 切到 `REF` 的 commit，运行 `./scripts/build.sh`，用 `verify.sh` 比对 `SHA256SUMS` 应完全一致。

**判定恢复成功**：`build.sh` 生成的产物 SHA-256 与仓库里 `releases/<ver>/SHA256SUMS` 一致。

---

## 9. 当前不变式（截至 2026-10-26，v1.4.12）

- 安装步骤：**15 步**（以 `tracking/upstream.md` 为准；归档文档里的「14 步」是 2026-10-09 旧状态）。
- 私有函数：**14 个**。
- 依赖锁定：`npm:@insforge/sdk@1.4.5`、`alipay-sdk@4.14.0`、`urllib@4.9.1`、`@waffo/pancake-ts@0.25.0`。
- Node ≥ 20；产物为 async CommonJS（InsForge v2.3.3 worker 的 `new Function` 执行器）。
- `TOKENTRACKER_DASHBOARD_URL` 必须指向自有 dashboard（HTTPS 或 loopback HTTP），源码锚点校验会拒绝回落官方域名。
- **v1.4.12 首次产物已生成**：`releases/1.4.12/`（19 个文件，含 SQL/14 函数/SHA256SUMS）。首次**部署**仍未开始。
- **最终交付物是 Docker 镜像**（linux/amd64），见 [`docs/docker-image.md`](docs/docker-image.md)。

---

## 10. Docker 镜像维护要点

镜像是最终交付物，维护时须遵守：

1. **产物是唯一真源**：镜像内容来自 `releases/<VERSION>/`，CI 的 `reproduce` job 会从锁定上游 commit 重建并逐字节比对；**禁止**手改 `SHA256SUMS` 让它"通过"。
2. **改产物必须走完整循环**：`build.sh` → `verify.sh` → `reproduce.sh` → 提交 → 触发 `build-image.yml`。
3. **镜像不自动部署**：只输出工件与 `commands`；psql / 上传函数由实例持有者在 VPS 上执行。
4. **平台**：目前只 `linux/amd64`。加 ARM64 前需重新验证函数产物。
5. **GHCR 包默认 private**：首次推送后需在包设置里改为 public（一次性）。
6. **旧版本镜像与 `releases/<old>/` 都不删**：回滚时唯一的已知函数来源。
7. 每次升级循环结束，确认新标签镜像的 `info` / `verify` 与 `tracking/REF` 一致，并把 digest 记入 `releases/<ver>/acceptance.md`。
