# TokenTracker 自托管运维仓库

> 这个仓库**不是**上游代码的 fork，也不包含上游源码。
> 它是「以官方开源仓库为唯一上游，长期维护自有 InsForge 私有同步后端」的**控制平面 / 运维记录仓库**。

- 上游：<https://github.com/xiufengsun/TokenTracker>（MIT）
- 职责边界：InsForge 平台（VPS、Docker、HTTPS、OAuth、worker）由实例持有者负责；本仓库只维护**应用侧**——基线 SQL、14 个私有函数、客户端指向配置、升级评审与验收记录。
- 状态：**技术预览**（依据上游 `docs/self-hosting-status.md`）。

---

## 当前状态

**计划阶段。首次实施尚未开始。**

- [x] 归档维护提示词、可复用提示词、总体规划
- [x] 锁定首个上游构建点：v1.4.12 / `8d32a956181bf52fae449c89b8f6520253566283`
- [x] 建立版本追踪、产物校验、编码检查机制
- [ ] **首次实施**：生成基线 SQL 与 14 个私有函数产物
- [ ] **首次部署**：应用 SQL、上传函数、配置服务端环境变量（由人在 VPS 上执行）
- [ ] **首次验收**：按 [`docs/runbook.md`](docs/runbook.md) 逐项打勾
- [ ] 进入「跟随上游」的稳定循环

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
6. Agent 不连接实例、不执行 psql、不上传函数、不写 `~/.tokentracker/config.json`；这些由人在 VPS 上执行。
7. 所有文本文件 **UTF-8 无 BOM**，统一 LF 行尾（`scripts/verify.sh` 会检查）。

---

## 目录结构

```
tokentracker-selfhost/
├── README.md                    # 本文件：定位、状态、原则、工作流
├── SECURITY.md                  # 凭据处理与误提交处置
├── CHANGELOG.md                 # 本运维仓库自身的变更记录
├── docs/
│   ├── maintainer-prompt.md     # 维护 Agent 的系统提示词（归档自 uploads/）
│   ├── prompts.md               # 可复用提示词 A/B/C/D
│   ├── update-plan.md           # 总体规划与交接
│   └── runbook.md               # 首次实施 / 升级 / 回滚操作手册
├── tracking/
│   ├── REF                      # 当前锁定的上游 commit（单一构建点）
│   └── upstream.md              # 版本追踪表（每次拉取后更新，单一事实来源）
├── env/
│   └── server.env.example       # 服务端环境变量模板（占位符，无真实值）
├── scripts/
│   ├── upstream.sh              # 只读检查上游：status / fetch / review / pin
│   ├── build.sh                 # 从锁定点生成产物到 releases/<version>/
│   ├── summarize.cjs            # 输出步骤 SHA-256 与 functions.json 摘要
│   └── verify.sh                # 校验 SHA256SUMS + 编码 + 函数数量
└── releases/
    ├── _template/               # review.md / acceptance.md 模板
    └── v1.4.12/                 # （首次实施后生成）SQL + 14 函数 + 校验和 + 记录
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

## 命令速查

| 命令 | 作用 | 是否修改外部状态 |
|---|---|---|
| `./scripts/upstream.sh status` | 显示锁定点与本地 checkout 状态 | 否 |
| `./scripts/upstream.sh fetch` | 拉取上游 main 到 FETCH_HEAD | 仅更新上游 git refs |
| `./scripts/upstream.sh review` | 拉取 + 新提交列表 + 契约 diff + 结论 | 仅更新上游 git refs |
| `./scripts/upstream.sh pin <sha> <ver>` | 更新 `tracking/REF` | 改本仓库文件 |
| `./scripts/build.sh` | 生成 SQL + 14 函数 + 摘要 + SHA256SUMS | 写 `releases/<ver>/`，上游 `npm ci` |
| `./scripts/verify.sh releases/<ver>` | 校验产物完整性/编码/函数数量 | 否 |

---

## 已知偏差（重要）

- 归档的三份文档以及上游 `docs/self-hosting-backend.md` 都写「当前 14 步」，那是 **2026-10-09** 的状态。在 v1.4.12 上实际执行 `manifest.steps()` 得到 **15 步**（8 个固定 id + 7 个 `cloud-*` 迁移，新增了 `13-machine-alias-cascade`）。**本仓库以 `tracking/upstream.md` 的 15 步为准**，归档文档保持原样以便追溯。
- `privateFunctions` 确认为 **14 个**，与文档一致。
- 构建依赖锁定：`npm:@insforge/sdk@1.4.5`、`alipay-sdk@4.14.0`、`urllib@4.9.1`、`@waffo/pancake-ts@0.25.0`。
- 当前工作区的上游 checkout 有 10 个文件显示 `M`，但 `git diff --numstat` 全为 0——只是沙箱/挂载导致的可执行位丢失（100755→100644），内容零改动，不影响 `node` 脚本。`upstream.sh status` 会区分内容与权限位变更。

## 首次使用提示

- 初始提交使用了占位 git 身份；推送到你自己的远程前请设置：`git config user.name "..."` / `git config user.email "..."`。
- `UPSTREAM_DIR` 默认指向同级 `../TokenTracker`；若上游 checkout 在别处，设置该环境变量即可。

---

## 关联远程仓库（可选，由你决定）

本仓库目前只有本地初始提交。要推送到 GitHub / Gitea：

```sh
git remote add origin <你的私有仓库 URL>   # 建议私有
git push -u origin main
```

推送前先运行 `git log --oneline` 和 `git ls-files` 确认没有凭据文件。
