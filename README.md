# TokenTracker 自托管运维仓库

> 这个仓库**不是**上游代码的 fork，也不包含上游源码。
> 它是「以官方开源仓库为唯一上游，长期维护自有 InsForge 私有同步后端」的**控制平面 / 运维记录仓库**。

- 上游：<https://github.com/xiufengsun/TokenTracker>（MIT）
- 远程：<https://github.com/QuietSugar/token-tracker-self-hosting.git> — **PUBLIC（公有仓库）**
- 职责边界：InsForge 平台（VPS、Docker、HTTPS、OAuth、worker）由实例持有者负责；本仓库只维护**应用侧**——基线 SQL、14 个私有函数、客户端指向配置、升级评审与验收记录。
- 状态：**技术预览**（依据上游 `docs/self-hosting-status.md`）。

## 你是来看什么的？（先选一条，其余内容可以跳过）

| 我只想… | 走这条 | 需要什么 |
|---|---|---|
| **把用量存在自己机器上，跑起来看看** | [`go-server/README.md`](go-server/README.md) §1「60 秒快速开始」：`docker pull` → `/health` → 用脚本签个 token → 传一条用量并读回来 | 一台 Linux + Docker。**5 分钟，不需要账号，也不需要本页下面的任何维护流程** |
| **继续用官方客户端，只是把后端换成自己的** | [`docs/official-client.md`](docs/official-client.md)：三条出路（localhost 最省事 / 反代 + 私有 CA / 域名 HTTPS） | 同上 + 官方 v1.4.12 客户端 |
| **让 dashboard / 菜单栏显示跨设备汇总** | [`docs/oauth-selfhosted.md`](docs/oauth-selfhosted.md)：`/api/auth/*` 与 owner 账户 | 同上，再加一个本地邮箱密码 |
| **参与维护 / 升级上游 / 看设计取舍** | 本页下半部分 + [`MAINTENANCE.md`](MAINTENANCE.md) + [`docs/go-postgres.md`](docs/go-postgres.md) | 读得懂本文即可 |

> ✅ **纯使用不需要**：GitHub App 初始化（那只用于本仓库推送 / 开 issue）、`MAINTENANCE.md`
> 的会话启动协议、上游 checkout、`tracking/REF`、`bootstrap.sh` / `session-start.sh`。
> 下面「维护者」相关的章节都是**可选的**，与「把服务跑起来」无关。
>
> 📦 **当前可用的部署形态**（详见各文档）：
> - **Go 后端（推荐上手）**：单二进制 + 单镜像，只需要一个 PostgreSQL，实验性但客户端已实测。
> - **InsForge + PostgreSQL 工件镜像**：正式交付物，携带已审计 SQL 与 14 个私有函数。

---

## 维护者须知

> ⚠️ **本仓库是公有的**：任何 `git push` 后内容立即对全网可见，且无法真正撤回。安全约定见下方「公有仓库安全约定」与 [`SECURITY.md`](SECURITY.md)。
>
> 🤖 **本仓库由 Agent 长期维护**。首次跨环境接手先读 [`docs/HANDOFF.md`](docs/HANDOFF.md)，再按 [`MAINTENANCE.md`](MAINTENANCE.md) 的会话启动协议恢复详细状态。
>
> 🐳 **正式交付物**是 Docker 工件镜像（linux/amd64）：携带已审计 SQL 与 14 个私有函数，面向 InsForge + PostgreSQL。另有**实验性 Go 后端镜像（PostgreSQL）**，通过 33 个行为契约 + 2 个 PG 专属 SKIP；尚未达到生产 GA。
>
> 定位是**局域网自用**（单账户 owner、账号体系默认关闭、不做第三方登录）。使用与运维看 [`go-server/README.md`](go-server/README.md)，设计与取舍看 [`docs/go-postgres.md`](docs/go-postgres.md)，缺口看 [`go-server/STATUS.md`](go-server/STATUS.md)。

---

## 当前状态

**v1.4.12 正式 InsForge 工件已生成；本地真实标准环境已验收。公共 VPS 部署尚未开始。另有 Go 实验性垂直切片（PostgreSQL，非 GA）。**

- [x] 归档维护提示词、可复用提示词、总体规划
- [x] 锁定首个上游构建点：v1.4.12 / `8d32a956181bf52fae449c89b8f6520253566283`
- [x] 建立版本追踪、产物校验、编码检查机制
- [x] 面向 public 远程仓库加固（密钥扫描 + CI）
- [x] 建立长期维护契约与会话启动协议（`MAINTENANCE.md` / `session-start.sh`）
- [x] **首次实施**：生成 v1.4.12 基线 SQL 与 14 个私有函数产物（`releases/1.4.12/`）
- [x] 建立 Docker 镜像交付链（Dockerfile / CLI / GHCR 构建流水线 / 可复现性硬门槛）
- [x] **本地标准栈验收**：官方 InsForge v2.3.3 + PG 15.18，15 步 SQL / 幂等重装 / L3 并发测试 5 PASS
- [ ] **首次公共 VPS 部署**：配置自己的域名、密钥，上传 14 个函数（未连接/操作任何用户实例）
- [ ] **VPS 验收**：按 [`docs/runbook.md`](docs/runbook.md) 逐项打勾
- [x] 建立 Go 实验后端（PostgreSQL）：33 行为 PASS / 2 PG 专属 SKIP；尚不作生产替代
- [x] Go 后端支持 PostgreSQL：同一份代码/镜像，PG 上同样 33 PASS（CI 覆盖 PG 15/16）
- [x] **官方客户端接入实测**（v1.4.12 CLI：`device-login` / `sync` / `doctor` 全通，见 [`docs/official-client.md`](docs/official-client.md)）
- [x] **认证层 `/api/auth/*`**（同 InsForge 流程）：登录 / 刷新轮换 / 撤销 / 跨设备 account 视图，见 [`docs/oauth-selfhosted.md`](docs/oauth-selfhosted.md)
- [x] **账户归属收敛**：`auth_owner` 单例，`device-login` 与登录同一账户；「默认账户 UUID」概念及其兼容代码全部删除（§4.5）
- [x] **多设备维度**（对齐官方 dashboard）：`account-devices` 按设备返回，`account-*` 支持 `device_id` 过滤，设备可重命名（§4.6）
- [x] **与官方模块逐个对拍**：本地日/时区归日、heatmap `format=compact`、设备管理卡（暂停/恢复/最后活跃）（§4.6）
- [ ] 完成 Go 后端剩余数据模型、安全、运维后再评估 GA
- [x] 决定移除 SQLite，只保留 PostgreSQL（决定记录见 [`docs/go-postgres.md`](docs/go-postgres.md) §5，归档点 tag `sqlite-final`）

---

## 为什么用独立仓库

1. **上游 checkout 保持只读**。我们不在上游工作区里写自己的记录，避免每次 `git pull` 产生冲突或误提交。
2. **规划文档需要有自己的家**。上游仓库里并不存在 `docs/self-hosting-update-plan.md`——它是我们自己的资产（见 `docs/update-plan.md`）。独立仓库正好解决这个矛盾。
3. **解耦节奏**。运维资产（评审、SHA-256 清单、验收证据）有自己的历史和审阅节奏，不必跟上游发布同频。
4. **可复现**。每份产物都绑定到 `tracking/REF` 中锁定的 commit SHA，任何时候都能重新生成并校验。

---

## 核心原则

1. 上游源码只读；本仓库**永不**修改上游代码。
2. 所有产物从锁定的 commit 生成，附 SHA-256 清单，可复现、可审计。
3. **步骤清单只增不改**：升级 = 新增步骤，绝不修改已安装步骤。installer 会对旧步骤 checksum 不匹配直接报错——这是保护机制，不是要绕过的障碍。
4. **凭据永不入库**：只提交 `.example` 模板；真实值放本地被忽略的文件。
5. 云端付费 webhook、社区排行榜、`device-usage-reset` 等函数**不混入**自托管 14 函数清单。
6. Agent 不连接或操作用户的真实实例，不在用户 VPS 执行 psql、不上传函数、不写 `~/.tokentracker/config.json`；经用户明确授权，可在隔离本地标准环境执行 SQL/L3 验收。
7. 所有文本文件 **UTF-8 无 BOM**，统一 LF 行尾（`check-encoding.sh` / `verify.sh` 会检查）。
8. **每次推送前跑 `check-secrets.sh`**；CI 也会在 push / PR 时重复检查。

---

## 公有仓库安全约定

远程是 **public**，所以以下不是"建议"而是硬性要求：

| 规则 | 落地方式 |
|---|---|
| 不提交任何真实密钥、token、cookie、dump | `.gitignore` + `scripts/check-secrets.sh` + CI |
| 不提交真实域名 / IP / VPS 信息 / 客户端 config | 文档与模板一律用 `your-domain.example` 等占位符 |
| 不提交验收日志原文、截图、HTTP 抓包 | `acceptance.md` 只写结论与取证方式，原始证据留本地 |
| 不把 `env/server.env` 加入版本控制 | 该文件被忽略；只提交 `env/server.env.example` |
| 提交前自检 | `./scripts/check-secrets.sh && git diff --cached --stat` |
| CI 兜底 | `.github/workflows/verify.yml`（密钥扫描 + 编码 + 产物校验） |

**公开展示的内容范围**（让访问者知道会看到什么）：上游版本追踪、自托管架构与工作流、占位符形式的变量名与示例域名、14 个函数名与步骤清单、模板化的评审/验收表格。**不包含**：真实域名、实例地址、任何密钥、VPS 细节、部署日志。

> 归档的三份规划文档是原样保留的，其中两处提到「本机 version-fox 默认 14.21.3」——这是维护者本机 Node 环境的描述，不构成凭据，但公开可见。若介意可删掉这两个括号内的短句。

---

## 目录结构

```
tokentracker-selfhost/
├── README.md                    # 本文件：定位、状态、原则、工作流
├── MAINTENANCE.md               # 长期维护契约 / 会话启动协议 / SOP（先读它）
├── SECURITY.md                  # 凭据处理与误提交处置
├── CHANGELOG.md                 # 本运维仓库自身的变更记录
├── Dockerfile                   # 多阶段构建：产物校验 + CLI 载体（linux/amd64）
├── .dockerignore                # build context 白名单，排除凭据
├── docker/
│   ├── tokentracker.cjs         # 镜像内部署 CLI（info/verify/sql/export/commands）
│   └── DEPLOY.md                # 镜像自带部署说明
├── docker-compose.example.yml   # 一次性导出产物的 compose 示例
├── .github/workflows/
│   ├── verify.yml               # CI：密钥/编码/产物/脚本校验
│   └── build-image.yml          # CI：可复现性 + GHCR 镜像构建推送
├── docs/
│   ├── maintainer-prompt.md     # 维护 Agent 的系统提示词（归档自 uploads/）
│   ├── prompts.md               # 可复用提示词 A/B/C/D
│   ├── update-plan.md           # 总体规划与交接
│   ├── runbook.md               # 首次实施 / 升级 / 回滚操作手册
│   ├── github-app-setup.md      # GitHub App 认证配置
│   ├── docker-image.md          # Docker 镜像交付设计与使用
│   ├── database-choice.md       # 为什么正式 InsForge 路径硬依赖 PostgreSQL
│   └── go-postgres.md           # 为什么只用 PostgreSQL、验收证据与「删掉 SQLite」的决定记录
├── contract/                    # 契约测试体系（为 Go 改造做一致性基准）
│   ├── README.md / SPEC.md      # 体系说明 / 实现者契约规范
│   ├── scenarios/               # 35 个语言无关用例（8 组）
│   ├── golden/1.4.12/           # 录制的行为快照 + L1 静态契约 + 校验和
│   ├── lib/                     # 归一化 / 执行器 / 对比器 / 录制器 / 进程池
│   ├── adapters/                # 参考实现 + Go 实验 adapter（postgres）
│   ├── scripts/                 # record / verify / self-test / benchmark
│   └── RESULTS.md               # 当前结果摘要与改造者下一步
├── go-server/                   # 实验性 Go 后端垂直切片（PostgreSQL，非生产 GA）
│   ├── README.md                # 使用者手册：部署 / 配置 / 备份恢复 / 升级 / 排错
│   ├── STATUS.md                # 支持范围 / 缺口 / 验收门槛（先读）
│   ├── scripts/                 # full-test.sh（全量测试）/ backup.sh（备份恢复）
│   ├── Dockerfile               # linux/amd64 实验镜像
│   └── internal/{app,store}/    # Go HTTP / 存储层（方言适配，双引擎）
├── tracking/
│   ├── REF                      # 当前锁定的上游 commit（单一构建点）
│   └── upstream.md              # 版本追踪表（每次拉取后更新，单一事实来源）
├── env/
│   ├── README.md                # env/ 目录说明
│   └── server.env.example       # 服务端环境变量模板（占位符，无真实值）
├── scripts/
│   ├── bootstrap.sh             # 每次会话第 0 步：恢复 remote / 提交身份 / 检查 App 凭据
│   ├── session-start.sh         # 每次会话第 1 步：恢复完整上下文
│   ├── upstream.sh              # 只读检查上游：status / fetch / review / pin
│   ├── build.sh                 # 从锁定点生成产物到 releases/<version>/
│   ├── summarize.cjs            # 输出步骤 SHA-256 与 functions.json 摘要
│   ├── verify.sh                # 校验 SHA256SUMS + 编码 + 函数数量
│   ├── check-secrets.sh         # 推送前密钥扫描（public gate）
│   ├── check-encoding.sh        # UTF-8 / 无 BOM 检查
│   ├── gh-app-token.cjs         # GitHub App JWT → installation token
│   └── push-with-app.sh         # 用 App token 推送（GIT_ASKPASS 注入）
├── .github/workflows/
│   ├── verify.yml               # 密钥/编码/产物/contract L1 gate
│   ├── build-image.yml          # 正式工件镜像 GHCR build
│   ├── contract.yml             # Golden 可复现 + PG/TS self-test + Go candidate
│   ├── go-server.yml            # Go unit + 契约（PG 15/16 矩阵）
│   └── build-go-image.yml       # Go 实验镜像 build（含真 PG smoke，通过才推送）
└── releases/
    ├── _template/               # review.md / acceptance.md 模板
    └── 1.4.12/                  # 已生成 SQL + 14 函数 + 校验和 + 记录
```

上游源码 checkout **不在此仓库内**。默认约定它位于同级目录 `../TokenTracker`；可用环境变量 `UPSTREAM_DIR` 覆盖。

---

## 标准工作流

### 每次上游发布后

```sh
# 1) 只读检查：拉取上游、列出新提交、判断自托管契约是否变化
./scripts/upstream.sh review

# 2) 更新 tracking/upstream.md 的版本追踪表（两个明确结论：
#    自托管契约是否变化 / 客户端是否值得升级）

# 3a) 契约未变  -> 只评估客户端升级，本仓库记录一行结论即可
# 3b) 契约变化  -> 按 docs/prompts.md 提示词 B 做升级评审：
#                   写 releases/<new>/review.md，锁定新 commit，生成新产物
./scripts/upstream.sh pin <commit> <version>
./scripts/build.sh

# 4) 校验产物
./scripts/verify.sh releases/<version>

# 5) 由人在 VPS 上部署，按 docs/runbook.md 执行 + 验收，结果写 releases/<version>/acceptance.md
```

### 首次实施（0 → 1）

见 [`docs/runbook.md`](docs/runbook.md) 第 1–4 节。当前锁定点已是 v1.4.12，直接 `./scripts/build.sh` 即可生成首批产物。

---

## 长期维护

本仓库由 Agent 长期维护，完整契约见 [`MAINTENANCE.md`](MAINTENANCE.md)。要点：

- **状态在仓库里，不在对话记忆里**。每次会话先跑 `./scripts/bootstrap.sh`（沙箱快照不保存 `.git/config`），再跑 `./scripts/session-start.sh`，然后读 `MAINTENANCE.md` → `tracking/REF` → `tracking/upstream.md` → 最新 `releases/<ver>/review.md` + `acceptance.md`，即可恢复全部上下文。
- **触发**：用户说「检查上游 / 升级 / 生成产物 / 做评审」即启动标准循环；Agent 不会主动定时运行（可用 CI 定时只读检查 + 开 issue 提醒）。
- **每次循环必须留痕**：版本追踪表一行 + `review.md` + `acceptance.md` + `CHANGELOG.md` + 带上游 SHA 的 commit。没有记录的维护等于没做。
- **硬停止条件**：旧步骤 checksum 变化、依赖锁定不一致、密钥扫描未通过——出现即停并报告，不绕过。
- **灾难恢复**：用 bundle 或 clone 恢复仓库 → `session-start.sh` → 把上游切到 `REF` 的 commit → `build.sh` 重建产物，SHA-256 应与 `SHA256SUMS` 完全一致。

---

## 命令速查

| 命令 | 作用 | 是否修改外部状态 |
|---|---|---|
| `./scripts/bootstrap.sh` | **每次会话第 0 步**：恢复 `origin` 与提交身份 | 只改 `.git/config` |
| `./scripts/session-start.sh` | **每次会话第 1 步**：恢复状态、待办、安全检查 | 否 |
| `./scripts/upstream.sh status` | 显示锁定点与本地 checkout 状态 | 否 |
| `./scripts/upstream.sh fetch` | 拉取上游 main 到 FETCH_HEAD | 仅更新上游 git refs |
| `./scripts/upstream.sh review` | 拉取 + 新提交列表 + 契约 diff + 结论 | 仅更新上游 git refs |
| `./scripts/upstream.sh pin <sha> <ver>` | 更新 `tracking/REF` | 改本仓库文件 |
| `./scripts/build.sh` | 生成 SQL + 14 函数 + 摘要 + SHA256SUMS | 写 `releases/<ver>/`，上游 `npm ci` |
| `./scripts/verify.sh releases/<ver>` | 校验产物完整性/编码/函数数量 | 否 |
| `./scripts/check-secrets.sh` | **推送前**密钥扫描 | 否 |
| `./scripts/check-encoding.sh` | UTF-8 / 无 BOM 检查 | 否 |
| `./scripts/gh-app-token.cjs` | GitHub App 换取 installation token | 写 /tmp token 文件 |
| `./scripts/push-with-app.sh -u origin main` | 用 App token 推送 | 推远程 |
| `./scripts/reproduce.sh` | 从上游 commit 重建产物并逐字节校验 | 写 /tmp 临时目录 |
| `./contract/scripts/record.sh` | 录制契约黄金快照（PG+TS 参考实现） | 写 `contract/golden/` |
| `./contract/scripts/self-test.sh` | 契约体系自测（必须 100% PASS） | 写报告 |
| `CONTRACT_ADAPTER=... ./contract/scripts/verify.sh` | 对 Go 实现跑一致性验证（postgres adapter，需一个 PG） | 写报告 |
| `./contract/scripts/benchmark.sh` | 性能基准 | 写报告 |
| `docker run --rm <image> commands` | 输出 VPS 上要执行的完整部署命令 | 否 |

---

## 已知偏差（重要）

- 归档的三份文档以及上游 `docs/self-hosting-backend.md` 都写「当前 14 步」，那是 **2026-10-09** 的状态。在 v1.4.12 上实际执行 `manifest.steps()` 得到 **15 步**（8 个固定 id + 7 个 `cloud-*` 迁移，新增了 `13-machine-alias-cascade`）。**本仓库以 `tracking/upstream.md` 的 15 步为准**，归档文档保持原样以便追溯。
- `privateFunctions` 确认为 **14 个**，与文档一致。
- 构建依赖锁定：`npm:@insforge/sdk@1.4.5`、`alipay-sdk@4.14.0`、`urllib@4.9.1`、`@waffo/pancake-ts@0.25.0`。
- 当前工作区的上游 checkout 有 10 个文件显示 `M`，但 `git diff --numstat` 全为 0——只是沙箱/挂载导致的可执行位丢失（100755→100644），内容零改动，不影响 `node` 脚本。`upstream.sh status` 会区分内容与权限位变更。

## 首次维护提示（与「使用」无关）

> 这一节讲的是**在本仓库提交/推送**的准备工作。只想跑服务的话看 `go-server/README.md`。

- 初始提交使用了占位 git 身份（`TokenTracker Selfhost Maintainer <selfhost@localhost>`）。因为远程是 **public**，这个 author 邮箱会公开显示在提交历史里。想改成自己的 GitHub 身份（尚未推送时可安全 amend）：
  ```sh
  git config user.name "你的名字"
  git config user.email "你的 GitHub noreply 邮箱"
  git commit --amend --reset-author --no-edit
  ```
- `UPSTREAM_DIR` 默认指向同级 `../TokenTracker`；若上游 checkout 在别处，设置该环境变量即可。

---

## 远程仓库与推送

远程已配置为 `origin`：<https://github.com/QuietSugar/token-tracker-self-hosting.git>（**public**）。

**认证使用 GitHub App，不用 PAT**。完整配置步骤见 [`docs/github-app-setup.md`](docs/github-app-setup.md)——需要 `Contents: R/W` 和 `Workflows: R/W` 两个权限（缺后者无法推送 `.github/workflows/`）。

配置好 `~/.config/tokentracker-gh-app/` 后：

```sh
./scripts/bootstrap.sh                      # 恢复 remote 与提交身份
./scripts/check-secrets.sh                  # 必须：公有仓库强制关卡
./scripts/push-with-app.sh --dry-run         # 验证 App 认证（不推送）
./scripts/push-with-app.sh -u origin main    # 实际推送
```

`push-with-app.sh` 用 `GIT_ASKPASS` 注入 1 小时有效的 installation token：**不写进 URL、不写 `.git/config`、不落 shell 历史、输出自动脱敏**，推送后立即删除临时文件。

推送后 CI（`.github/workflows/verify.yml`）会自动跑一遍密钥扫描、编码检查和产物校验。建议同时在 GitHub 仓库设置里开启：

- **Secret scanning** + **Push protection**（Settings → Code security and analysis）
- **Branch protection** 保护 `main`（要求 PR / CI 通过）
- **Dependabot alerts**

若当前环境没有 GitHub 凭据，可用离线搬运：仓库根目录旁提供 `tokentracker-selfhost.bundle`（`git bundle create` 生成，含完整历史）：

```sh
git clone /path/to/tokentracker-selfhost.bundle token-tracker-self-hosting
cd token-tracker-self-hosting
git remote set-url origin https://github.com/QuietSugar/token-tracker-self-hosting.git
git push -u origin main
```
