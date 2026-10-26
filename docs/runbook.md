# 自托管操作手册（Runbook）

> 适用对象：实例持有者（人） + 维护 Agent。
> 前置阅读：[`maintainer-prompt.md`](maintainer-prompt.md)、[`prompts.md`](prompts.md)、[`update-plan.md`](update-plan.md)。
> 平台侧（VPS / Docker / InsForge 初始化 / HTTPS / OAuth）不在本文范围，由实例持有者负责。

---

## 0. 前置条件

| 项 | 要求 | 检查 |
|---|---|---|
| Node | ≥ 20（根 `package.json` engines） | `node -v` |
| 上游 checkout | 与 `tracking/REF` 的 COMMIT 完全一致 | `./scripts/upstream.sh status` |
| 依赖 | 根目录 `npm ci` 完成 | `test -d ../TokenTracker/node_modules/alipay-sdk` |
| InsForge 平台 | 官方 v2.3.3 栈，PostgreSQL 15.18，auth schema 与 `anon`/`authenticated`/`project_admin` 角色就绪 | 平台侧 |
| 域名 | API 与 dashboard 均有 HTTPS；dashboard 域名必须是自有域名 | — |

> 备份恢复注意：PostgreSQL 15.18 必须配套 **15 系** `pg_dump`/`pg_restore`；官方镜像默认 18.4 会因 `transaction_timeout` 失败。

---

## 1. 首次实施：生成产物（Agent 可做，不接触实例）

```sh
cd /path/to/tokentracker-selfhost
./scripts/upstream.sh status          # 确认锁定点一致
./scripts/build.sh                    # 生成到 releases/<VERSION>/
./scripts/verify.sh releases/<VERSION>
```

`build.sh` 会产出：

```
releases/1.4.12/
├── tokentracker-install.sql          # 独立事务 + 安装锁；幂等；首次安装用这个
├── tokentracker-migration.sql        # 不带事务包装；平台迁移通道/升级用
├── functions/                        # 14 个 async CommonJS 函数 + functions.json
│   ├── tokentracker-device-flow-authorize.js
│   ├── ...
│   └── functions.json
├── manifest-report.md                # 15 步 id + 每步 sha256(sql) + 函数清单
└── SHA256SUMS                        # 全部产物的校验和
```

产物校验通过后：

```sh
git add releases/1.4.12 tracking/upstream.md
git commit -m "build: v1.4.12 baseline artifacts from 8d32a956"
```

**约束**：Agent 到此为止。不执行 psql、不上传函数、不写 `~/.tokentracker/config.json`。

---

## 2. 首次部署（人，在 VPS 上执行）

按顺序，**先 SQL 后函数**：

1. **备份**（即使是空库）：`pg_dump` 存一份可回滚副本，确认 15 系工具版本。
2. **应用基线 SQL**：
   ```sh
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f releases/1.4.12/tokentracker-install.sql
   ```
   预期：事务提交，`public.tokentracker_self_host_installations` 出现 **15 行**；`hosting_mode='self_hosted'`。
   取证：保存 psql 输出与 `SELECT step, checksum FROM public.tokentracker_self_host_installations ORDER BY step;`。
3. **配置服务端环境变量**：按 `env/server.env.example` 填入真实值（权限 600），重启 worker。
4. **上传 14 个函数**：按 `functions/functions.json` 的映射逐一部署到自有 InsForge worker。
   取证：部署后返回状态、`functions.json` 内容。
5. **不要部署**付费 webhook / 社区排行榜 / `device-usage-reset` 等云端函数。

### 回滚

- SQL 是单事务，失败会自动回滚；若需整体回退，用第 1 步的备份恢复。
- 函数侧：保留上一版 `releases/<旧版本>/functions/` 以便重新上传。

---

## 3. 客户端指向自托管（官方产物免自建）

解析优先级（`src/lib/runtime-config.js`）：CLI 参数 → `~/.tokentracker/config.json` → 环境变量 → 官方默认。

```sh
npx tokentracker init --base-url https://api.your-domain.example \
  --anon-key <anon_key> --dashboard-url https://dashboard.your-domain.example
```

或编辑 `~/.tokentracker/config.json`（权限 600）：

```json
{
  "baseUrl": "https://api.your-domain.example",
  "anonKey": "<anon_key>",
  "dashboardUrl": "https://dashboard.your-domain.example"
}
```

环境变量方式：`TOKENTRACKER_INSFORGE_BASE_URL`、`TOKENTRACKER_INSFORGE_ANON_KEY`、`TOKENTRACKER_DASHBOARD_URL`。

- 切换实例会清除旧实例的 device token / JWT，需**重新授权**。
- 验证：`tokentracker sync` 上传、`tokentracker status --json` 查看成功字段。
- 桌面壳（Windows / macOS / Linux）只启动内置 CLI + 打开 localhost，自动复用 CLI 配置，无需单独配置后端地址。

---

## 4. 首次验收

复制 [`../releases/_template/acceptance.md`](../releases/_template/acceptance.md) 到 `releases/1.4.12/acceptance.md`，逐项执行并记录取证。核心项：

- [ ] 真实 HTTPS 域名下注册 / 登录 / 登出 / 刷新会话
- [ ] 双账号 RLS 隔离（客户端角色执行私有函数应被拒绝）
- [ ] 同一账号两台设备授权互不覆盖；重传幂等、修正去重生效
- [ ] 本地与云上一致（device / provider / model / 时区 / cost）
- [ ] 断网 / 暂停设备 / 后端离线可恢复，不丢本地队列
- [ ] 浏览器与原生流量**只走自有实例**，不回流官方后端 / 排行榜
- [ ] 备份恢复演练（15 系工具）
- [ ] 升级演练：新增步骤 → 校验幂等与数据保留

> 上游状态文档明确：公共 VPS HTTPS、OAuth、Windows 原生回调三类**尚未验收**。首次上线时这几项要自己过一遍。

---

## 5. 跟随上游升级循环

```sh
# (1) 只读检查
./scripts/upstream.sh review

# (2) 判定（写进 releases/<new>/review.md）
#   契约未变 -> 只记录结论 + 评估客户端升级，后端不动
#   契约变化 -> 继续下面步骤

# (3) 锁定新构建点
./scripts/upstream.sh pin <新commit全SHA> <新版本>

# (4) 把上游 checkout 移到新 commit（人执行或确认）
git -C ../TokenTracker checkout main && git -C ../TokenTracker pull --ff-only origin main

# (5) 生成新产物 + 校验
./scripts/build.sh
./scripts/verify.sh releases/<新版本>

# (6) 对比新旧：
#   - diff manifest-report.md（哪些步骤新增、哪些 checksum 变化）
#   - diff functions/*.js 与 functions.json（哪些函数变化）
#   - 高亮依赖版本变化
```

**升级执行顺序（人在 VPS）**：备份 → 应用新 `tokentracker-install.sql`（或 `--migration` 版）→ 校验 `tokentracker_self_host_installations` 新增行 → 重新上传变化的函数 → 验收 → 记录 `acceptance.md`。

installer 会跳过 checksum 一致的旧步骤、只执行新增步骤；**若旧步骤 SQL 被改动会报错回滚**，此时必须停下评审，不要绕过。

**回滚**：数据库用备份恢复；函数用上一版 `releases/<旧版本>/functions/` 重新上传；客户端可回退版本（注意 config 里的实例指向不变）。

---

## 6. 每次循环必须留下的记录

1. `tracking/upstream.md` — 版本追踪表新增一行 + 两个结论。
2. `releases/<version>/review.md` — 升级评审（diff、影响、执行顺序、回滚）。
3. `releases/<version>/acceptance.md` — 验收结果 + 取证。
4. `CHANGELOG.md` — 本运维仓库自身的变更。
5. `git commit` — 产物与记录一起提交，commit message 带上上游 commit SHA。
