# 变更记录

本文件记录**本运维仓库自身**的变更，不记录上游发布（上游版本见 `tracking/upstream.md`）。

## 2026-10-27 — 切库重放：文档、`replay-queue.py`、ingest 卡队列修复

用户问「切到私有部署后第一次 sync 会把数据都同步过去吗」。读上游源码确认了答案，
顺手发现并修掉一个会让 sync **永久卡住**的问题。

### 答：会重放，但重放的是本地队列

`src/commands/init.js` 在 `baseUrl`/`anonKey` 变化时调 `resetInstanceState()`，它把
`queue.state.json` 的 `offset` 写成 0（`queue.jsonl` 不动）。`offset` 是"已上传到第几个字节"，
所以下一次 `sync` 从文件头重放。上游修旧 InsForge 项目迁移时用的就是这个手法。
限制也写清楚了：只重放本地队列里还有的桶；`project.queue.jsonl`/`session.queue.jsonl`
永不外传；云端独有历史（别的设备的、本地日志已被清理的）要另外导出导入。

### 修复：队列尾部只剩 `account_session_states` 时 sync 永久失败

客户端会把 TRAE / cursor 这类 account-level 来源的会话去重记录
（`kind: "account_session_state"`）和用量桶放在同一批上传；**队列尾部可能只剩这类记录**，
此时请求体是 `hourly: []` + `account_session_states: [...]`。服务端原来对"没有用量桶"
一律回 400 `No usage buckets provided` —— 客户端不会推进 offset，那一批被无限重试，
`tracker sync` 从此永久失败。

现在：有 `account_session_states` 就回 200（`inserted: 0`、`skipped: n`、
`account_session_states: "ignored"`），真正空的 body 仍是 400。
自托管没有 account-level 数据模型，这些记录没有地方可写，但**必须收下并放行**。

### 新增：`go-server/scripts/replay-queue.py`

把 `~/.tokentracker/tracker/queue.jsonl` 重放进自托管后端。用于客户端自动重放帮不上的三种情况：
换过地址但后端数据没留住、换机/换账号搬历史、核对"那次 sync 传全没有"。

与客户端行为对齐：跳过 `kind` 控制记录、缺 `source`/`model` 补 `codex`/`unknown`、
按键合并重复行、**时间戳原样保留**（服务端键是时间戳字符串，`…00:30:00.000Z` 与
`…00:30:00Z` 是两行，规整会造成双算），并打印客户端自己的 `offset` 进度。
支持 `--since/--until/--limit/--dry-run`、`--jwt` 自动签 device token。

实测：造 415 行 / 374 唯一桶（含毫秒时间戳、`:30` 桶、控制记录、39 行重复、1 行缺
source/model），重放后设备总量 909,911 tokens 与 dry-run 统计完全一致；**重放第二遍仍是
909,911**（整行替换，不累加）。

### 文档

- `docs/official-client.md` 新增 §7「从官方云切到自建：第一次 sync 会发生什么」
  （源码依据、重放范围表、正确顺序、`--drain` 与进度核对、重放安全性、`replay-queue.py`、
  控制记录那个坑），原「排错」顺延为 §8。
- `go-server/README.md`：§3.5.6 新增 `replay-queue.py`（原「长期自动推送」改 §3.5.7），
  §3.6 加一段「从官方云切过来会怎样」并链到 §7；§8 排错表补一行
  `HTTP 400: No usage buckets provided` 的历史原因。

## 2026-10-27 — 新机接入与官方流程对齐：默认 `TT_DEVICE_APPROVE=page`

### 之前的问题：多了一步官方没有的"手批"

`device-login` 本来就是官方 OAuth device flow（authorize → 浏览器批准 → poll 拿 token），
服务端也早就实现了三条批准路径。但**默认**是 `TT_DEVICE_APPROVE=jwt`：终端拿到 code 以后
没人能批，文档只能教你跑 `scripts/approve-device.sh`。于是新机接入看起来像"本项目自造的流程"，
而不是"官方客户端点一下就好"。

### 现在：默认就是官方那套

- 默认改为 `page`：`tracker device-login` 打印 `http(s)://<host>/device?user_code=…`，
  浏览器打开确认后点「批准」，终端自己完成。**不需要任何本项目自己的脚本。**
- `/device` 页面重做：显示申请方的 `client_info`、`machine_id`、有效期和当前状态
  （已批准 / 已过期 / 代码不存在分别给不同提示），批准前能确认是不是自己的机器；
  批准失败会回页面说明原因，而不是一个裸 400。
- `auto`（无头机器零交互）与 `jwt`（保留审批边界）照旧可用，只是不再是默认。
- 明确写下安全边界：`page`/`auto` 都等于"能访问本服务且拿到 user_code 的人可以把设备接进
  owner 账户"。user_code 只出现在发起申请那台机器的终端里，是这套流程唯一的凭据——官方
  device flow 也是同一模型，区别只是官方那页还要求先登录 dashboard。

### 文档

`go-server/README.md` §3.6 的"三步"删掉了 `TT_DEVICE_APPROVE=auto`（不再需要），
改成官方一致的两条命令 + 一张三模式对照表；§2 配置表默认值同步；
`docs/official-client.md` §4 与排错表同步。

## 2026-10-27 — 内建只读看板 + `/health` 带上版本 + 时钟修复

### 修复：服务端时钟被写死在 2026-10-26

`app.New` 里 `now` 的默认值是**硬编码**的 `2026-10-26T00:00:00Z`（本意是给契约快照用，
真正该冻结的场景由 `TT_NOW` 控制）。后果在真实部署里很具体：「今日」永远是空的、
heatmap 的 `to` 与 `rolling` 窗口全部错位、签出的 token `exp` 也停在过去。
现在默认 `time.Now().UTC()`，测试用 `TT_NOW` 显式冻结（`testServer` 已统一这么干），
契约 adapter 本来就传 `TT_NOW`，33 个场景照旧 PASS。文档 `TT_NOW` 一行写的一直是"真实时间"，
代码这次才对上。

### 修复 / 加固：401 排查与 `X-TokenTracker-Token`

- 看板在 access token（默认 1 小时）过期时，会用登录时拿到的 refresh token 自动续一次并重试
  （服务端每次刷新都轮换 refresh token，页面会存新的）；续不上才回登录页，并写明
  **哪个请求、什么状态码、返回了什么**——原来的"登录已失效，请重新登录。"什么线索都不给。
- 新增兜底头 `X-TokenTracker-Token`：有些反向代理/SSO/预览隧道会把 `Authorization` 当自己的
  凭据消费掉，局域网部署里典型症状就是"密码能登录、一读数据全是 401"。看板现在两个头都发，
  服务端任意一个都认（都没有仍然 401）。
- 新增 `TT_ACCESS_LOG=true`：每个请求一行 `access: GET /path 200 auth=yes origin=-`，
  一眼看出代理有没有把认证头吃掉。默认关闭（内网自用不该默认留访问日志）。

### 新增：`GET /` 是看板，不再是裸 404

之前浏览器打开服务根路径只得到 `{"error":"not found"}`，用户必须另外把官方 dashboard
跑起来（它依赖 `@insforge/sdk` 与外部分析脚本，内网没有公网出口时常常直接白屏）。
现在服务端自带一个**单文件**看板：`go-server/internal/app/web/index.html`，用 `go:embed`
打进二进制，零构建、零依赖、零外部请求。

- 登录走已有的 `POST /api/auth/sessions`（owner 邮箱密码），或粘贴 `issue-token.sh` 签的 JWT；
  token 只进 `sessionStorage`，关标签页即失效，不落盘、不写 cookie。
- 只读：页面只发 GET，唯一的 POST 是登录；设备重命名/删除等写操作仍然只在 CLI 与官方客户端。
- 内容：6 个统计卡、26 周热力图、按模型条形图、按设备列表、按日明细；
  周期「今日 / 近 7 天 / 本月 / 全部（近 24 个月）」。
- **刻意不学官方的 0 用量隐藏**：设备下拉与列表列出全部设备，0 用量标"无用量"。
- 响应头带 `Content-Security-Policy: default-src 'none'` + `connect-src 'self'`，
  外部资源在浏览器层面就引不进来；其它未注册路径仍然是原来的 404 JSON（脚本依赖该形状）。

### 修复：`/functions/tokentracker-account-daily` 的 `total_cost_usd` 恒为 0

`dayAgg.TotalCostUSD` 声明成 `int64` 且 `aggregateByDay` 从未给它赋值，于是按日费用一直是
`0`，把每行的 `total_cost_usd` 丢掉了。现在按行累加、输出前收敛到 6 位（与 summary 的
`%.6f` 口径一致）。契约 golden 里这些天本来就没有费用数据，所以仍是 `0`，33 个场景全部保持 PASS。

### 新增：`/health` 暴露 `engine` / `version` / `ref`

`main.version` 与 `main.vcsRef` 一直都在 `Dockerfile` 的 `-ldflags` 里注入，但没有任何代码
读它们——排查"容器跑的是哪个镜像"时这俩就白注入了。现在 `GET /health` 返回
`{"ok":true,"engine":"postgres","version":"experimental-<sha>","ref":"<full sha>"}`，
`ok` 字段保持原样（镜像 smoke 与脚本都在断言它）。

## 2026-10-27 — 删除 SQLite 支持，只保留 PostgreSQL

**先说归档点**：删除之前给当时的 `main` 打了 tag **`sqlite-final`**
（`1ec6984`），那是最后一个同时支持两个引擎的提交。需要"单文件零依赖"形态的人
从那里 checkout 即可；该分支不再维护，也没有到新版的搬数工具。

### 为什么删

不是"少维护一个引擎"这种账面理由，而是**保真度**：SQLite 分支的测试通过率不能证明
PostgreSQL 上的并发、类型严格性、约束语义正确，却让人误以为"两种引擎都验证过了"。
而这个项目从第一天起就只有 PG 上跑过真实数据。

同时它把成本摊到每一次改动上：方言层、DDL 双渲染、双份 CI、双份 compose、
双份契约 adapter、两套 checksum 语义的文档解释。

### 删除清单

| 面向 | 变化 |
|---|---|
| 依赖 | 删除 `modernc.org/{sqlite,libc,mathutil,memory}`；`go.sum` 45 行 → 2 行 |
| 代码 | 删 `store/dialect.go`（Dialect/ParseDialect/DetectDialect/bind）；新增 `store/placeholders.go`（只留 `?`→`$n` 改写）；`schemaBody` 把 `{{ENGINE}}/{{BOOL}}/{{FALSE}}` 烘焙成 PostgreSQL 字面量；删掉从未被引用的 `flexibleBool`/`parseBoolText`；`Config.Dialect` 字段移除 |
| 启动 | `TT_DATABASE_URL` 变**必填**；`TT_DATABASE_PATH`/`TT_DATABASE_DRIVER` 移除（设了会打警告）。DSN 给文件路径时报错带迁移提示：`SQLite support was removed (archived at tag sqlite-final)…` |
| 测试 | `testDB()` 不再有 SQLite 默认值，未设 `TT_TEST_DATABASE_URL` 直接失败并打印起库命令；新增 `scripts/test-with-pg.sh`（docker 一键起临时 PG，`--full` 跑全量）；`TestSchemaChecksumIsPinned` 钉死 core DDL 的 sha256；新增 `TestValidateDSN` 覆盖 SQLite 路径被拒绝 |
| CI | `go-server.yml` 删 sqlite job（保留 PG 15/16 矩阵）；`contract.yml` 删掉从未启用的 `candidate` job；`build-go-image.yml` 删 sqlite smoke 与兼容旧名 `-sqlite-go` 标签 |
| 镜像 | `Dockerfile` 去掉 `TT_DATABASE_PATH` 默认值、`/data` 卷与 sqlite 标签；`TT_DASHBOARD_URL` 默认改为空（空值按请求推导，避免占位域名让 device-login 失败） |
| 契约 | 删除 `adapters/go-sqlite.cjs` 与 `go-sqlite.example.cjs`；`capabilities.json` 实现名改 `go-postgres`；SPEC/mapping/scenarios 里的 "SQLite 等价实现"措辞改为实现中立 |
| 脚本 | `backup.sh` 只保留 PostgreSQL（`sqlite`/`restore-sqlite` 子命令改为明确报错）；`full-test.sh` 重排为 L0 build / L1 unit(PG) / L2 契约(PG) / L3 镜像 smoke(PG) |
| 文档 | `go-server/README.md`（§1.2 改成"没有 PostgreSQL 怎么办"、配置表、§9 第 6 条）、`STATUS.md`（新增「SQLite 去哪了」附录）、`docs/go-postgres.md`（重写为决定记录）、`docs/database-choice.md`、`docs/HANDOFF.md`、根 `README.md` 同步 |

### 顺带修掉的两处文档漂移

- `go-server/README.md` §9 写"只有 **14 张表**"，实际是 **16 张业务表 + 2 张账本**
  （`auth_credentials`/`auth_sessions`/`auth_owner` 是后来按 additive step 加的，数字没跟）。
- §9 第 7 条写"**没有 schema 增量迁移**（只有 version 1）"，与 `schema_additions`
  已上线两个 step 的事实矛盾——这句会让人以为升级必须重建库。

### 校验

- `go build ./...`、`go vet ./...`、`go test -race ./...`（真实 PostgreSQL 16）全过
- 契约 `CONTRACT_ADAPTER=./contract/adapters/go-postgres.cjs`：33 PASS / 0 FAIL / 2 SKIP（与删除前一致）
- `scripts/check-encoding.sh`、`scripts/check-secrets.sh` 通过
- 三个 workflow 用 YAML 解析器校验通过

---

## 2026-10-27 — 文档修正：3 个 issue（定位矛盾 / 4 项打磨 / 使用者入口）

三个 issue 的每条声明都逐条核实过，全部属实；顺带修了两处 issue 没列出的同类问题。

### 1. 定位表述与实现对齐（issue #11，6 处 + 额外 2 处）

`/api/auth/*` 合入后"不做注册登录"这批文字没跟着改，导致同一文档内自相矛盾：

| 位置 | 改法 |
|---|---|
| `go-server/README.md` §0 | 改为「一个账户（owner），不开放自助注册」+「不做第三方登录」；删掉"固定 sub"的旧说法 |
| `go-server/README.md` §0 引子 | "将来若要接正式认证…"整段重写为"账号体系可选，不是必需" |
| `go-server/README.md` §3.6 表格 | `account-*` 跨设备视图 ❌ → ✅，链到 §3.7 / `official-client.md` §5 |
| `go-server/README.md` §9 第 1 条 | 改为"账号体系默认关闭（首个身份成为 owner），不做第三方 OAuth/邮件/找回密码" |
| `go-server/README.md` §1.0 | "没有登录，用脚本签" → "不建账户，用脚本签"（脚本签 token 仍是合法用法，只是不再等同于"没有账号体系"） |
| `docs/official-client.md` §1 | "不能替代：跨设备聚合视图" → 归入「能替代」；不能替代的是第三方 OAuth / 排行榜 / 付费 |
| `docs/official-client.md` §4 | "接入默认账户" → "接入这台机器的 owner 账户"，并给出收紧到 `jwt` 模式的具体做法 |
| `go-server/STATUS.md` 头部 | 定位改为「单账户（owner）；账号体系默认关闭，不做第三方登录」 |
| `go-server/STATUS.md` §5 | "signup/signin 不做" 与 §6 矛盾 → 改为"不做 OAuth provider / 发信 / 密码重置 / 后台" |
| `go-server/STATUS.md` §6 标题 | "跨设备视图未接" → "均已验收" |
| `docs/go-postgres.md` 头部 | 定位短语同步 |
| **（额外）`go-server/STATUS.md` 交付清单** | "仍缺 `/api/auth/refresh`，跨设备视图不可用" —— issue 未列，但同样过时，已改 |

### 2. 四项打磨（issue #12）

1. `SECURITY.md` 第二个 `6.` → `7.`（编号重复）；
2. `go-server/README.md` §7：非 root **不是** compose 配的，而是镜像 `Dockerfile` 的
   `USER 10001:10001`；两个 compose 示例都**没有** `user:`。原文"compose 示例已配"会误导
   自己写 compose 的人，已改并加提醒；
3. `docs/go-postgres.md` §3："本机（沙箱）实测，Go 1.27 工具链" → "Go ≥1.24（以 `go.mod` 为准，
   验收时沙箱为 1.27）"，避免被当成版本要求；
4. **`TT_DASHBOARD_URL` 的坑，比 issue 描述的更深**：不只是 §1.1 的示例，两个 compose 示例里
   默认值就是 `${TT_DASHBOARD_URL:-https://your-dashboard.example}` —— 用户照抄、不设这个变量，
   设备授权就会返回一个占位域名的 `verification_uri`，客户端直接报
   `Device authorization returned a different dashboard`。已把 compose 默认改为**空字符串**
   （服务端按请求 `Host` + `X-Forwarded-Proto` 推导，这是既有行为且有单测
   `TestDeviceAuthorizeAnchorsVerificationURIToRequestHost` 覆盖），文档示例同步改为"留空"。

### 3. 使用者入口（issue #13）

根 `README.md` 原本整篇是维护者动线（`bootstrap.sh`、维护契约、上游追踪、GitHub App 推送），
访客找不到"我只是想跑起来"的路。现在：

- 顶部新增 **「你是来看什么的？」** 四行分流表：跑起来看 / 接官方客户端 / 要跨设备汇总 / 参与维护；
- 明确写出 **纯使用不需要** GitHub App、`MAINTENANCE.md` 会话协议、上游 checkout、`tracking/REF`；
- 原来混在开头的"定位/交付物"提示块收进新的 **「维护者须知」** 小节；
- 原「首次使用提示」（讲 git 提交身份 amend）改名为 **「首次维护提示（与「使用」无关）」**，
  避免被当成使用引导。

### 校验

- `scripts/check-encoding.sh`（UTF-8 无 BOM）、`scripts/check-secrets.sh` 全过；
- 两个 compose 文件用 YAML 解析器校验通过，`TT_DASHBOARD_URL` 默认值为空串；
- 全文 grep 确认已无"不做注册登录 / 没有登录 / 固定 sub / 接入默认账户"等过时表述。

---

## 2026-10-27 — 与官方模块逐个对拍：时区归日、heatmap compact、设备管理卡

上一轮把设备维度做出来了，这一轮把**官方客户端真实请求的每个参数**都对了一遍。
对拍对象是上游 `dashboard/edge-patches/*` 与 `dashboard/src/components/cloud/*`
（v1.4.14；account-* 相关文件自 v1.4.12 起未改动）。

### 1. 时区（`tz` / `tz_offset_minutes`）—— 原来会漏数据

以前所有 account-* 端点都按 **UTC 日**归日、按 UTC 窗口取数。对东京/北京用户来说，
本地凌晨 0–9 点产生的用量在 UTC 里还属于前一天，**查询当天时这段被整体漏掉**。
官方做法是窗口向两侧各放宽一天、再按本地日裁剪；现已照做：

| 位置 | 修正 |
|---|---|
| `account-summary` | 区间统计 + rolling 7/30 天都按本地日；rolling 锚点是**本地今天** |
| `account-summary.days` | 改成 `COUNT(DISTINCT 本地日)`（官方 RPC 定义），跨时区的行不再重复计天 |
| `-daily / -monthly / -model-breakdown / -heatmap` | 同一套本地日窗口 |
| `-devices` | 每台设备总量用同一窗口，"各设备之和 == 总量"在任何时区都成立 |
| `-hourly` | 缺省"今天"也改成调用方时区的今天 |

实测（东京，本地 2026-10-20）：`2026-10-19T16:30Z`（本地 10-20 01:30）的 120 tokens
现在会算进 10-20；旧实现查 `from=to=2026-10-20` 只看到 80。

### 2. heatmap 的 `format=compact`

dashboard / 菜单栏**默认**就给 heatmap 加 `&format=compact`，我们之前忽略了它（结果正确但
多传一倍以上流量，也缺 `max_value`）。现已实现稀疏线格式
`{format,from,to,week_starts_on,active_days,streak_days,max_value,model_names,days}`，
`days` 只含有数据的日期、模型名按索引引用；用官方 `expandHeatmapCompact()` 展开后与
dense 响应**逐格相同**（已用官方模块实测比对）。默认（不带 `format`）的 dense 输出保持原样。

### 3. 设备管理卡（billing）

dashboard 的"云端设备"卡片走 `tokentracker-billing?action=devices&current_machine_id=…`，
我们之前没有这一支（返回的是 account 的响应，卡片永远是空的）。现在：

- `?action=devices` 返回 `cloud_list_machines` 形状
  `{machines[{machine_id,name,platform,last_seen_at,is_current,status}], machine_count,
  machine_limit:null, membership, over_machine_limit:null}`；
- `name`/`platform` 取**设备行**，所以在设备卡片里改的名字立刻显示；
- `is_current` 认 `current_machine_id`（本机高亮）；
- `ingest` 时更新 `cloud_machines.last_seen_at`（"最后活跃"不再恒为未知）；
- `POST ?action=remove-device` / `?action=resume-device`（`{"machine_id":…}`）
  暂停 / 恢复；暂停同时撤销该机器的设备与 device token；
- RPC `cloud_list_machines` 与它共用同一实现（含 `p_current_machine_id`），
  `machine_count` 只数 active（与 golden 一致）。

### 测试

- 新增 `parity_test.go`（4 个用例）：东京/UTC 两种归日、`tz_offset_minutes` 等价、
  devices 与 summary 求和一致、heatmap 本地日 + `to` 缺省本地今天 + compact 结构、
  billing `devices`/`remove-device`/`resume-device`/`last_seen_at`、RPC 与 billing 同源。
- `go test -race ./...`：SQLite ✅ / PostgreSQL 16 ✅
- 契约：`go-sqlite`、`go-postgres` 均 **33 PASS / 0 FAIL / 2 SKIP**（含
  `cloud_list_machines` 与 `billing/device-revocation` 的机器列表 golden）

### 用官方模块对拍（不是自说自话）

`src/lib/cloud-account.js#fetchAccountUsage` + `src/lib/heatmap-compact.js` 直接打自部署服务：

```
✓ usage-summary / usage-daily / usage-heatmap 经官方模块拿到数据
✓ compact 展开 == 官方 dense 形状（逐格比较 day/total/level/models）
✓ 东京 10-20 聚合两行（含 UTC 前一天 16:30 的 120）
✓ 无数据格子 models=null
✓ billing?action=devices：机器列表 / 设备名取自设备行 / is_current / last_seen_at
✓ remove-device → paused，resume-device → active
```

### 文档

`docs/oauth-selfhosted.md` §4.6 扩写：新增"时区：为什么今天不是 UTC 的今天"、
"heatmap 的 `format=compact`"、"设备管理（billing）"三节；`go-server/README.md`
补时区 / compact / billing 行为；`STATUS.md`、根 `README.md` 同步。

---

## 2026-10-27 — 多设备维度对齐官方 + 彻底删掉「默认账户」的兼容包袱

两件事一起做，因为现在按「还没有任何真实部署」来设计：不留迁移路径，只保留最少的规则。

### 1. 设备维度（`device_id`）按官方实现

以前 `tokentracker-account-devices` 返回的是「按 source 聚合」，dashboard 的设备下拉框
因此没有意义（选谁都一样）。现在与官方 `dashboard/edge-patches/tokentracker-account-devices.ts`
同形状：

```json
{"from":"2026-10-01","to":"2026-10-31",
 "devices":[{"id":"…","device_name":"MacBook","platform":"darwin",
             "created_at":"…","total_tokens":1200}],
 "account_sources":[]}
```

- 只列未撤销设备，按区间用量降序；各设备之和 == `account-summary` 总量；
- `account-summary/-daily/-hourly/-monthly/-heatmap/-model-breakdown` 都支持
  `?device_id=<uuid>`（含 summary 的 rolling 7/30 天窗口）；
- 形状不是 UUID → 当没传；不是自己的设备 → 空结果（过滤条件带 `user_id`）；
- RPC `account_usage_grouped` 支持 `p_device_id` / `p_device_ids`（官方 dashboard 取数路径）；
- `tokentracker-device-rename` 改收官方的 `{device_id, device_name}`（同时兼容旧的 `name`），
  只改未撤销设备，同平台重名 → **409**（原来会 500）
- `account-devices` 缺 `from/to` → **400**（对齐官方，不再编造默认日期）

### 2. 删除 `TT_DEFAULT_ACCOUNT` 留下的全部兼容代码

上一轮把「默认账户」的语义去掉了，但还留着认领旧数据/钉住 id 的路径。既然没有真实部署，
这些全部删除：

| 删除 | 原用途 |
|---|---|
| `legacyDefaultSub` + `legacySubWithData()` | 认领历史 UUID 名下的数据（老库升级） |
| `TT_OWNER_ACCOUNT` / `TT_DEFAULT_ACCOUNT` | 钉住 owner id（配置常量进代码的入口） |
| `POST /api/auth/merge-account` + `mergeAccount()` | 收拾"两个账户"的存量分裂 |
| `issue-token.sh` 的 UUID 兜底 | 问不到 owner 时退回历史 UUID |

现在的 owner 规则只剩三条：`auth_owner` 已有 → 用；库里只有一个带密码账户 → 用；
都没有 → **第一个出现的身份**成为 owner。空库启动不创建任何账户（有测试盯）。

`scripts/issue-token.sh` 行为也跟着变：已有 owner 就用它；还没有 owner 就生成**随机** id
交给服务端认领；连不上服务端则**直接报错**（猜一个 id 只会把数据写到看不见的地方）。

### 测试

- 新增 `devices_test.go`（7 个用例）：设备列表形状/排序/求和一致、六个端点的 `device_id`
  过滤、非法与越权 id、撤销设备不列表但用量仍计入、缺参数 400、
  官方字段名重命名 + 重名 409、RPC `p_device_id`。
- 删除 `owner_test.go` 里的 legacy 认领与 merge-account 用例，新增「空库不建账户」。
- `go test -race ./...`：SQLite ✅ / PostgreSQL 16 ✅
- 契约：`go-sqlite`、`go-postgres` 均 **33 PASS / 0 FAIL / 2 SKIP**

### 实测（官方 v1.4.12 客户端 + 真实服务）

官方 CLI `device-login`（auto 批准，anon key 用 `issue-token.sh --role anon` 签）→
`/api/auth/owner` = `{"source":"device"}` → 用 CLI 存的 device token 真实 `ingest` →
之后注册 `owner@lan.test`，signup 返回的 user id 与 owner **完全相同**：

```
account-devices → devices:[{id: e98a566b…, device_name:"Device Flow", platform:"cli",
                            total_tokens:1050}]  account_sources:[]
account-summary                       → total_tokens=1050
account-summary&device_id=e98a566b…   → total_tokens=1050
account-daily&device_id=e98a566b…     → 1 天
device-rename {device_id, device_name:"书房的 Mac"} → 200 ok
auth_users=1  auth_owner=1(source=device)  devices=1  hourly=2 行 / 1050
```

同一台机器上多设备的情况另用一个脚本验（两台设备、两个 device token）：

```
device-token-issue ×2（laptop / nas）→ ingest 1000 / 50
account-devices → 2 行：laptop(darwin) 1000、nas(linux) 50，account_sources=[]
account-summary             all=1050
account-summary&device_id=laptop   devA=1000
device-rename {device_id, device_name:"书房 MacBook"} → ok
issue-token.sh（已有 owner）→ sub 与 /api/auth/owner 相同
```

### 文档

`docs/oauth-selfhosted.md` 新增 **§4.6 设备维度**、重写 **§4.5**（只剩三条规则，
明确写"没有 `TT_DEFAULT_ACCOUNT` / `TT_OWNER_ACCOUNT`，也没有迁移路径"）；
`docs/official-client.md` §5 补设备下拉框链路的实测形状；`go-server/README.md`
（环境变量表删一行、补设备维度说明）、`STATUS.md`、根 `README.md` 同步。

---

## 2026-10-27 — 账户归属收敛：device-login 与登录是同一个账户，`TT_DEFAULT_ACCOUNT` 退场

问题：上一轮引入 `/api/auth/*` 后，同一台机器有**两条账户**——
`device-login` 的数据落在配置常量 `11111111-1111-4111-8111-111111111111`，
登录拿到的 access token 属于随机 user id，于是跨设备汇总互相看不见。

### 移除「默认账户」这个概念

那个 UUID 从来不是账户，只是没有账号体系时的占位字符串（`issue-token.sh` 的 `DEFAULT_SUB`，
后来被服务端照抄成 `TT_DEFAULT_ACCOUNT`）。现在：

- 新增 `auth_owner` 单例表（`slot=1`），**唯一真相**；按优先级自动解析并固定：
  `auth_owner` → 唯一带密码账户 → 配置钉住的 id → 历史固定 sub（有数据）→ 第一个出现的身份。
- 设备批准（`auto`/`page`）一律归属 owner；`POST /api/auth/users` 与
  `TT_AUTH_EMAIL` 引导**挂到已有 owner 上**，不再新建第二个账户。
- 新装机器上那个 UUID **不会被创建**（有测试断言）。
- `TT_DEFAULT_ACCOUNT` 的"默认账户"语义删除；旧名仅作为 `TT_OWNER_ACCOUNT`
  的别名被读取（含义变成"把 owner id 钉死"，可选）。

### 新增端点

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/auth/owner` | 当前 owner（**仅回环地址**）。`scripts/issue-token.sh` 用它解析 `--sub` |
| POST | `/api/auth/merge-account` | 把无密码账户的数据并入 owner（收拾存量分裂；设备 token 原样保留） |

`scripts/issue-token.sh` / `approve-device.sh` 不再猜账户：优先 `--sub`/`TT_OWNER_ACCOUNT`，
否则问本机服务；连不上才退回历史 UUID 并打印明确提示。

### 实测（官方 v1.4.12 客户端 + 真实服务）

```
全新库 → device-login（先设备、后账号）→ sync: Uploaded 2 inserted
GET /api/auth/owner → {"user_id":"d717…","source":"device"}
注册 owner@lan.test → signup user_id = d717…   ← 与设备同一账户
account-summary     → total_tokens=7500 cost=0.161000
库里：auth_users=1 行、auth_owner=1 行、devices 的 user_id 与 owner 相同

另一条顺序（先 issue-token 导数据、再注册）：
owner source=first-use → 注册后 auth_users 仍只有 1 行
```

### 测试

- 新增 6 个回归测试：设备先/账号先都收敛、历史 UUID 认领（老库升级）、
  新装机器不创建历史 UUID、`/api/auth/owner` 仅回环、`merge-account`（越权/有密码拒绝/搬迁生效）。
- `go test -race ./...`：SQLite ✅ / PostgreSQL 16 ✅
- 契约：`go-sqlite`、`go-postgres` 均 **33 PASS / 0 FAIL / 2 SKIP**
- `check-oauth.sh` 全链路通过；`check-encoding.sh` / `check-secrets.sh` ✅

### 文档

`docs/oauth-selfhosted.md` 新增 §4.5（UUID 的来历、解析规则表、迁移与 merge-account）、
端点表与配置表更新；`official-client.md`、`go-server/README.md`、`STATUS.md`、`CHANGELOG.md` 同步。

---

## 2026-10-27 — 认证层：/api/auth/*（同 InsForge 流程，自写实现）

上一轮把「设备上报」跑通了，但官方客户端的**跨设备 account 视图**还挂在 `/api/auth/*` 上——
那条链第一步就 404，客户端于是静默降级成"仅本机"。这一轮补齐。

### 新增端点（流程与 InsForge 一致，代码是 Go 自己写的）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/users` | 注册（仅在还没有任何账户时允许，之后需 `TT_AUTH_ALLOW_SIGNUP=true`） |
| POST | `/api/auth/sessions` | 登录 → `accessToken`(1h) + `refreshToken`(90d) + `csrfToken` + Set-Cookie |
| POST | `/api/auth/refresh` | browser 模式（cookie + `X-CSRF-Token`）或 mobile 模式（`?client_type=mobile` + body `{refresh_token}`），**轮换** |
| POST | `/api/auth/logout` | 撤销 + 清 cookie |
| GET | `/api/auth/sessions/current`、`/sessions`、`/profiles/current`、`/public-config` | 会话与配置读取 |

- access token 复用本服务原有的 HS256 JWT（`sub` + `role=authenticated`），
  `/functions/*` 不需要第二套验签 —— 客户端铸出来的 token 能直接读 `account-*`。
- cookie 名与官方 SDK 对齐：`insforge_refresh_token`（HttpOnly）、`insforge_csrf_token`（JS 可读）。
- 密码 PBKDF2-HMAC-SHA256（12 万轮、随机盐，标准库实现，不引入依赖）；
  refresh/csrf 只存 SHA-256。
- 安全取舍：轮换后旧 token 重放 → 401 `REFRESH_TOKEN_REUSED`，**默认不牵连其他会话**
  （并发刷新比泄露常见得多）；要严格处置设 `TT_AUTH_REVOKE_ON_REUSE=true`。
  登录失败统一文案（防账号枚举）、带凭据的 CORS 回显 Origin（可用 `TT_AUTH_ALLOWED_ORIGINS` 收紧）。
- `TT_AUTH_EMAIL` / `TT_AUTH_PASSWORD` 可在启动时引导 owner 账户（幂等，不覆盖已存在密码）。

### 存储：增量迁移机制

新增表**不能**直接改 core schema（checksum drift 会让所有已部署实例启动失败），
也不能动 `SchemaVersion`（它出现在契约响应里）。所以加了 `schema_additions` 账本：
`{1: auth-sessions}` 建 `auth_credentials` / `auth_sessions`，老库只跑缺的 step，
已发布 step 被改动即 fail closed。

### 实测（官方 v1.4.12 的真实代码路径）

```
cloud-account.fetchAccountUsage → summary: total_tokens=7500；daily/hourly/monthly/heatmap/model-breakdown 均有数据
轮换链 mint#1 → mint#2 OK
走本地 CLI 全链路：127.0.0.1:7680/api/auth/sessions 登录 → relay 捕获 cookie →
  GET /functions/tokentracker-usage-summary?account=1 → total_tokens=7500 cost=0.161000
  → X-TokenTracker-Account-View: 1   （不再是"仅本机"）
```

### 测试与文档

- 新增 6 个认证测试（注册/登录/轮换/重放/登出/CSRF/CORS/密码哈希/owner 引导）+ 3 个增量迁移测试。
- `go test -race ./...`：SQLite ✅ / PostgreSQL 16 ✅；契约 33 PASS / 0 FAIL / 2 SKIP（两种引擎）。
- 新增 `docs/oauth-selfhosted.md`（流程图、端点表、cookie 约定、安全语义、配置、自测、排错）
  与 `scripts/check-oauth.sh`（一键自检）；`docs/official-client.md` §5 从"缺口"改为"已可用"。

---

## 2026-10-27 — 官方客户端接入（native-client E2E）

用户澄清：「真实数据」= **继续用官方客户端，只把后端换成本服务**（官方云要收费了）。
所以这一轮做的是客户端兼容，而不是导入脚本。

### 实测通过（上游 xiufengsun/TokenTracker v1.4.12，未改客户端一行）

| 客户端命令 | 结果 |
|---|---|
| `tracker init --base-url …` | ✅ |
| `tracker device-login` | ✅ 拿到 device token（`auto` 模式零交互；`page`/`jwt` 也可） |
| `tracker sync` | ✅ `Uploaded: 2 inserted`，重传后总量不变（7500） |
| `tracker doctor` | ✅ `ok 12 / fail 0` |

两条链路都验过：`http://localhost`（单机）与 `https://…` + 私有 CA（局域网，`NODE_EXTRA_CA_CERTS`）。

### 服务端改动

- `TT_DASHBOARD_URL` 默认改为**空 → 按请求推导**（`X-Forwarded-Proto` + `Host`）。
  客户端会校验 `verification_uri` 与自己的 `base_url` 同源、路径 `/device`，写死默认值会让
  局域网部署直接报 `Device authorization returned a different dashboard`。
- `TT_DEVICE_APPROVE` 三模式：`jwt`（默认，需 JWT 批准）/ `page`（`/device` 网页点批准，无认证）/
  `auto`（申请即批准到 `TT_DEFAULT_ACCOUNT`）。抽公共函数 `approveDeviceCode()`，重复批准幂等。
- 新增 `GET /device` 批准页与 `POST /device/approve`（仅 `page` 模式启用，其他模式 403）。
- 新增 `scripts/approve-device.sh`（`jwt` 模式的命令行批准）。
- 新增 4 个测试：origin 推导、auto 模式签发可用 token、`/device` 页面批准 + 默认 403、重复批准不重复签发。

### 文档

- 新增 **`docs/official-client.md`**：客户端硬性限制（`base_url` 只能 HTTPS 或 localhost，附源码位置与
  原始报错）、三条部署路线、anon key 为什么必须、设备批准三模式、跨设备视图缺口、验收清单、排错表。
- `go-server/README.md` §3.6 + §2 环境变量表；`docs/go-postgres.md` 指向新文档。

### 已知缺口（明确记录）

`/api/auth/refresh`（InsForge OAuth）未实现 → 客户端「跨设备 account 视图」在自托管下退回本机视图；
上传/留存/本机视图全部正常。补齐它是纯服务端工作，客户端无需改动。

---

## 2026-10-27 — 接入真实数据：导入脚本 + 设备重复签发修复

用户要"真实使用 go+postgres 版本、把真实数据接进去"。为此补上「数据怎么进来」这一段。

### 新增 `go-server/scripts/import-usage.py`（独立工具，不改主体程序）

- 输入：CSV/TSV（列名别名，大小写/下划线不敏感）、JSONL/NDJSON、JSON 数组（含 `{"buckets":[...]}` 包裹）。
- 时间归一化：带偏移/空格分隔/epoch 秒毫秒 → **UTC 整点**（服务端按字符串比较时间，非 UTC 会查不到）。
- 缺字段兜底：`total_tokens` 按 input+output+reasoning+cache_creation 计算；cost 支持 `$`/千分位。
- 去重与幂等：批内按 `(hour_start,source,model)` 去重；重跑靠服务端整行替换，不重复计数。
- 自动分批（默认 200，上限 500，≤512KB）、网络/5xx 退避重试 4 次、401 自动重签一次。
- device token 缓存 `~/.cache/token-tracker/device-tokens.json`（0600），重跑不会撞「同名设备已存在」。
- `--dry-run` / `--since` / `--until`（只给日期时 since 取 00:00、until 含当天）。
- 实测：CSV 5 行（1 行坏时间）→ 4 条入库，summary 41200 tokens / cost 1.07；
  重跑 3 次数据不变；1200 行自动去重为 600 键并分 2 批上传。

### 修复：同名设备重复签发

`device-token-issue`（以及设备授权 grant）在 `(user, machine_id)` 或 `(user, platform, device_name)`
已存在时直接 500（`UNIQUE constraint failed`）。客户端重装 / 重新登录 / 导入脚本重跑都会踩到。
改为复用已有 active 设备行 + 新签 token，`cloud_machines` 同样去重；契约用例未覆盖该场景，行为变更已记录。
回归测试 `TestDeviceIssueIsRepeatableForSameDevice`（3 次调用：同 device_id、3 个不同 token、1 台设备、1 台机器）。

### 文档

- `go-server/README.md` 新增 **§3.5 把已有用量数据导进来**：三步导入、格式与列名别名表、
  数据处理语义（时间归一化/去重/幂等）、设备与 token 缓存、常见报错、定时推送示例。

---

## 2026-10-27 — 定位澄清：局域网自用（不做注册登录）+ 首次使用可用性修复

用户明确：本项目定位是**自己部署到局域网、自己使用，不涉及注册登录**；主体程序尽量少改；HTTPS 不用管。

### 代码（2 处，均为非认证改动）

- **修复**：`device-token-issue` 与设备授权 `grant` 在 `auth_users` 无对应行时，
  因 `devices.user_id` 外键约束直接失败（`FOREIGN KEY constraint failed`），
  表现为「服务装好了却传不上去」。契约用例都会先建用户，所以从未覆盖到这条真实路径。
  新增幂等 `ensureAccount(sub)`，首次使用自动建账户行；**不改变任何认证语义**。
  回归测试：`TestDeviceIssueCreatesAccountOnFirstUse`（无预置账户 → 签发 → 上传 → 读回 1234 tokens → 无 token 仍 401）。
- 未新增 schema、未改契约/golden、未加任何认证开关；`TT_LOCAL_ACCOUNT` 等想法按用户要求**未实施**。

### 新增脚本（独立工具，不进主体程序）

- `go-server/scripts/issue-token.sh`：用 `TT_JWT_SECRET` 自签长期 JWT（默认 365 天、
  固定 `sub`、`--json` 只输出 token、`--role project_admin` 供 RPC 使用），并打印 curl 示例。
  这是「没有登录」场景的官方替代路径，将来接正式认证后可直接弃用。

### 文档

- `go-server/README.md`：§0 改为「定位：局域网自用」（无注册登录=设计选择、不多租户、
  不假设公网入口、不做计费），并说明将来接认证的接入点；新增 §1.0「先拿到 token」+ 完整最小流程
  （JWT → device token → ingest → summary，已实测跑通）。
- `go-server/STATUS.md`：signup/signin、InsForge/PostgREST 兼容、多副本锁、公网暴露能力
  从「生产阻断项」移入 **§5 非目标**；阻断项只留数据模型、聚合语义、安全/运维、行为矩阵、客户端 E2E。
- `docs/go-postgres.md`、根 `README.md`：补充定位前提。
- HTTPS：不写证书/反代教程，安全清单只保留一句「纯内网可信时可不启用，跨网络访问请自行加 TLS」。

### 验收

```
go vet / gofmt / CGO=0 build            PASS
go test -race（SQLite + PostgreSQL）    PASS（含新回归测试）
契约 go-sqlite / go-postgres            33 PASS / 0 FAIL / 2 SKIP（不变）
局域网最小流程手工验证                  JWT → device token → ingest → summary 看到数据
```

---

## 2026-10-27 — 首个 Go 实验镜像已发布（SQLite + PostgreSQL 双引擎）

- 全量测试（本地 + CI）全绿：

  | 项 | 结果 |
  |---|---|
  | `gofmt` / `go vet` / `CGO_ENABLED=0` build | PASS |
  | `go test -race`（SQLite） | PASS |
  | `go test -race`（PostgreSQL 16.2） | PASS |
  | 契约 `go-sqlite` | 33 PASS / 0 FAIL / 2 SKIP |
  | 契约 `go-postgres` | 33 PASS / 0 FAIL / 2 SKIP |
  | CI `go-server`（SQLite + PostgreSQL 15/16 矩阵） | PASS（[run](https://github.com/QuietSugar/token-tracker-self-hosting/actions/runs/40425780611)） |
  | 镜像 smoke（SQLite + PostgreSQL 双模式） | PASS（[run](https://github.com/QuietSugar/token-tracker-self-hosting/actions/runs/40426622276)） |
  | Docker 镜像构建 + 多平台推送 + provenance | PASS（[run](https://github.com/QuietSugar/token-tracker-self-hosting/actions/runs/40426828540)） |
  | 备份/恢复演练 | SQLite 快照可启动；PG `pg_dump -Fc` → drop → `pg_restore` 后 14 表 + checksum 一致 |

- 已发布镜像（实验通道）：`ghcr.io/quietsugar/token-tracker-self-hosting-go:experimental`、
  `:experimental-<short_sha>`、`:sha-<short_sha>`，以及兼容名
  `ghcr.io/quietsugar/token-tracker-self-hosting-sqlite-go:experimental`；平台 `linux/amd64` + `linux/arm64`；
  不发布 `latest`。digest 见构建 run 的 job summary；可用 `gh attestation verify` 校验来源。
- 镜像 smoke 曾经失败并修复（记录了踩坑，避免回归）：宿主机 runner 用户读不到容器内 uid 10001 的 0600 文件、
  WAL 模式下表名只在 `-wal` 里、`alpine` 的 busybox `grep` 行为差异 → 改为
  「优雅停服 → 主库大小 > 8KB → 重启 → health 200 → 无 checksum drift」。

---

## 2026-10-27 — Go 镜像流水线 + 面向使用者的运维文档 + 全量测试脚本

### 新增

- `.github/workflows/build-go-image.yml`：amd64 构建 → **容器 smoke（SQLite 模式 + PostgreSQL 模式）** →
  通过后才推送 `linux/amd64,linux/arm64` 镜像到 GHCR（SBOM + provenance）。
  镜像名 `ghcr.io/quietsugar/token-tracker-self-hosting-go:experimental[-<sha>]`，
  同时推送旧名 `-sqlite-go:experimental` 以兼容早期 compose；**不发布 `latest`**。
- `go-server/README.md`：使用者手册（快速开始、环境变量、JWT 约定、反代/TLS、备份恢复、升级、
  systemd、健康检查/日志、安全清单、故障排查表、已知限制、卸载）。
- `go-server/scripts/full-test.sh`：L0 gofmt/vet/build → L1 unit(SQLite) → L2 unit(PostgreSQL) →
  L3/L4 契约（两引擎）→ L5 Docker smoke；输出 PASS/FAIL/SKIP 汇总表。
- `go-server/scripts/backup.sh`：SQLite 在线快照、PostgreSQL `pg_dump -Fc`、恢复、按天清理。
- `go-server/.dockerignore`：构建上下文排除 `bin/`、`.db`、`.env` 等。

### 变更

- 两个 compose 示例改用新镜像名；sqlite 示例去掉内联 build（改为注释，默认拉镜像）。
- 文档同步：`go-server/STATUS.md`、`docs/go-postgres.md`、`docs/HANDOFF.md`、根 `README.md`。

### 验收（本地全量）

```
gofmt / go vet / CGO=0 build            PASS
go test -race（SQLite）                  PASS
go test -race（PostgreSQL 16.2）         PASS
契约 go-sqlite                          33 PASS / 0 FAIL / 2 SKIP
契约 go-postgres                        33 PASS / 0 FAIL / 2 SKIP
Docker 镜像 smoke                       本沙箱无 docker → SKIP（由 CI 强制）
备份/恢复演练                             SQLite 快照可启动；PG dump→drop→restore 后 14 表与 checksum 一致
```

---

## 2026-10-26 — Go 后端支持 PostgreSQL（双引擎，同一份代码）

用户要求：Go 版本支持 PostgreSQL；并问「支持 PG 是否更简单」「不再支持 SQLite 是否降低维护成本」。

### 实现

- `go-server/internal/store` 新增方言层：
  - `dialect.go`：`Dialect`（sqlite/postgres）、DSN 推断、`?`→`$n` 占位符改写
    （跳过字符串/标识符/注释/美元引号，表驱动单测覆盖）。
  - `db.go`：`DB`/`Tx` 包装（所有 SQL 自动按方言改写）、连接池
    （SQLite 单连接；PG 16 连接 + 30s 启动等待）、可选 PG schema 隔离、优雅关闭。
  - `schema.go`：DDL 仍是**唯一一份**，用 `{{ENGINE}}` / `{{BOOL}}` / `{{FALSE}}`
    三个占位符按引擎渲染；SQLite 的 `PRAGMA` 只在该引擎拼入。
- 启动配置：`TT_DATABASE_URL`（`postgres://…` 或 SQLite 路径）、`TT_DATABASE_DRIVER`、
  `TT_POSTGRES_SCHEMA[_EPHEMERAL]`；`TT_DATABASE_PATH` 保留兼容。启动日志脱敏密码。
- 幂等插入 `INSERT OR IGNORE` → `store.DB.InsertIgnore`（PG 走 `ON CONFLICT DO NOTHING`）；
  PG 布尔列由 `flexibleBool` 吸收。
- **不再支持 SQLite？未做此决定**：SQLite 渲染结果逐字节未变（checksum 不变，既有实例可原地升级），
  成本分析见 `docs/go-postgres.md` §5。

### 验收

- 新增 `contract/adapters/go-postgres.cjs`：每个用例起独立 schema（`tt_case_<hex>`），退出 `DROP SCHEMA CASCADE`。
- Go unit `-race`（SQLite）PASS；同一批测试切到真实 PostgreSQL 16.2 也 PASS。
- 契约：`go-sqlite` **33 PASS / 0 FAIL / 2 SKIP**；`go-postgres` **33 PASS / 0 FAIL / 2 SKIP**。
- 新增 `.github/workflows/go-server.yml`：SQLite 流水线 + PostgreSQL **15 / 16** 矩阵（unit + 契约）。

### 文档/配置

- 新增 `docs/go-postgres.md`（用法、架构、验证证据、运维差异、维护成本问答）。
- 新增 `go-server/docker-compose.postgres-go.example.yml`；`go-server/Dockerfile` 说明同一镜像双驱动。
- 更新 `go-server/STATUS.md`、`docs/database-choice.md`、`MAINTENANCE.md` §11、`contract/README.md`、`README.md`。

---

## 2026-10-26 — 真实标准环境 + Go/SQLite 垂直切片 + 文档现实审计

用户要求：① 运行真实标准环境；② 实现 SQLite + Go 版本；③ 按真实项目状态反审文档/规则。

### 1) 真实标准环境（不是 PGlite）

- 安装并启动官方 InsForge **v2.3.3** 四容器栈；PostgreSQL 实际 **15.18**、PostgREST v12.2.12、Deno 2.0.6。
- 从官方 compose 的 `insforge-oss:latest` 改为固定 v2.3.3 digest；四个镜像的 OCI digest 记录在 `contract/L3-RESULTS.md`。更新 `contract/scripts/standard-env.sh` 自动 pin digest。
- 容器网不能出公网 DNS（沙箱限制）；宿主机预热 Deno cache volume 后 Deno health=200。服务就绪：InsForge `/api/health`=200、Deno `/health`=200、PostgREST 可响应。
- 在真实 InsForge PG 15.18 上应用 `releases/1.4.12/tokentracker-install.sql`：15 步成功；原样二次重装成功且 ledger/checksum 不变。
- L3 真实多连接测试 **5 PASS / 0 FAIL**：advisory lock 竞争（等待约 2.5s）、8 并发重装（8/8 成功）、checksum、真实 role ACL、10 并发 upsert（1 行/100 tokens）。报告：`contract/L3-RESULTS.md`。
- 未连接任何用户 VPS/真实用户账号；这只是隔离验收环境，不代表公网部署验收。

### 2) Go + SQLite 实现（实验性垂直切片）

- 新增 `go-server/`：Go 1.24.4 + `modernc.org/sqlite@1.34.5`（纯 Go/CGO=0），真实 SQLite 文件、外键、WAL、事务、`schema_migrations(version, checksum)`。
- 实现 14 个函数路由的核心路径：HS256 JWT/device token、设备授权、token issue、ingest whole-row correction/idempotency、summary/daily/hourly/monthly/heatmap/model-breakdown/devices、自托管免费 policy/catalog、remove-device。
- 安全修正：production 强制 `TT_JWT_SECRET` ≥32 字节；Go RPC 只接受 project_admin JWT；危险 `/_test/*` 只在 `TT_ENABLE_TEST_ENDPOINTS=true` 时注册；DB/WAL/SHM 默认 0600；production container uid 10001。
- 纯 PG 的 15-step ledger/checksum **不再假装已在 SQLite 执行**。这两个 PG-specific 用例显式 SKIP；Go 自己有 schema checksum drift unit test。
- Go candidate 实测：**33 PASS / 0 FAIL / 2 SKIP**；`go test -race ./...`、`go vet ./...`、linux/amd64 CGO=0 build 全过。
- 新增 `go-server/Dockerfile`、compose 示例和 `.github/workflows/build-go-image.yml`（实验 `experimental` tag）；本机 build 成功，容器健康返回 200，生产默认 `/_test/sql` 返回 404。
- **性能仅作方向参考**（每 case wall-time 含实例启动，PGlite 是单连接 WASM）：当前测得 Go/SQLite 相对 PGlite fixture p50 约 10–21× 快；见 `contract/RESULTS.md`，不是生产吞吐结论。
- 完整缺口（24 PG 表映射、signup/signin/OAuth、session states、完整 pricing/aggregations、备份恢复、native/browser E2E、负载/安全审查）见 `go-server/STATUS.md`。**不标 GA、不接真实用户。**

### 3) 按真实情况修订文档/规则

- README 去掉过时的“首次实施尚未开始”；改为“正式 v1.4.12 工件已生成、本地标准栈已验收、用户公共 VPS 未部署”。
- `database-choice.md` 的 PostgreSQL 硬依赖结论收窄为“当前正式 InsForge/TS 路径”；新增实验 Go/SQLite 现状。
- `MAINTENANCE.md` 维护标准新增：正式/实验发布轨分离；真实 PG L3 门禁；Go migration 的 PG-only SKIP 规则；Go image 始终 experimental 直到生产阻断项通过。
- 新增 `docs/reality-review-2026-10-26.md`，记录本次逐项审视、证据和人工决定项。
- **契约测试曾有真实盲点，已修**：4 个 aggregation RPC scenario 用错参数名，之前 golden 只录了 42883；根据真实 PG `pg_get_function_arguments` 改正参数，增加 `expectStatus` 失败即停止；`account_usage_grouped_cached` 现在真实返回时区桶/缓存修正/off-peak 结果。
- 归一化升级到 v2：relative date 改成值驱动 `@relday±N`；JSON 对象按键序遍历，避免 Go/JS 插入顺序造成 UUID placeholder 差异；重录后的 golden 两次独立录制可复现。

### 验收结论

- 参考 PG/TS：35/35 PASS；两次 golden 可复现。
- Go/SQLite：33 PASS / 2 PG-specific SKIP / 0 FAIL。
- 真实 PostgreSQL 15.18 L3：5/5 PASS。
- 正式镜像路径与新实验后端分离；公共 VPS 部署未做。

## 2026-10-26 — 契约测试体系（为 Go+SQLite 改造做一致性基准）

用户目标：后续把数据库改成 SQLite、后端语言改成 Golang，需要尽可能多的测试保证两方一致，且全流程自动化。

**新增 `contract/`**（Golden Master / Characterization Tests）：

- **参考实现运行器**：直接复用上游 `test/helpers/self-host-fixture.cjs` —— PGlite 上安装 15 步基线，加载真实打包后的 14 个 async CommonJS handler，通过 loopback HTTP 提供函数与 PostgREST 风格端点。录到的是真实 SQL + 真实 handler 输出，不是 mock。
- **L1 静态契约** `lib/static.cjs`：从 `releases/1.4.12/` 提取 15 步 id+checksum、14 函数、24 表 / 52 SQL 函数 / 15 索引 / 8 触发器 / 4 RLS 策略 / 31 GRANT，以及 jsonb/timestamptz/advisory lock 等 PG 特性计数。写入 `golden/1.4.12/static.json`，作为 Go 改造施工图。
- **L2 行为契约**：35 个语言无关用例 / 82 步骤，8 组覆盖安装幂等、设备授权、上传与整行修正、7 个读接口、免费策略、认证与 RLS、时区/定价聚合、billing。归一化的 HTTP 响应快照。
- **归一化** `lib/normalize.cjs`：UUID/随机 token/时间戳/浮点/URL 内嵌 code/无序 SQL 结果集。修复三个真实缺陷：checksum 被误当 secret、`ctx.last` 覆盖导致 device-flow grant 失败、滚动窗口日期跨天漂移。
- **冻结时钟**：`CONTRACT_NOW=2026-10-26T00:00:00Z`，归一化把日期转成相对偏移；实测两个不同冻结时钟下输出一致。
- **进程池** `lib/pool.cjs`：PGlite 的 WASM 堆 `close()` 后不归还 OS，每 case 独立子进程是唯一可靠回收方式。并发 2 在 1.5GB 沙箱会 OOM（已实测），默认并发 1，CI 用 3。
- **对比器** `lib/compare.cjs`：结构化 diff（路径→期望/实际），支持 `waivers.json`（已登记偏差）与 `capabilities.json`（显式 SKIP，报告可见）。负向测试验证篡改能被检出。
- **自动化脚本**：`record.sh` / `verify.sh` / `self-test.sh` / `benchmark.sh` / `setup-upstream.sh`。
- **新 workflow** `.github/workflows/contract.yml`：L1 静态校验 → 重录 golden 并与仓库逐字节对比（可复现性硬门槛）→ 参考实现自测 → 候选实现 job（占位，待 Go 就绪）→ 每周性能基准。
- **Go+SQLite 交付模板**：`adapters/go-sqlite.example.cjs`、`SPEC.md §6` 检查清单、`mapping.json`（PG→SQLite 对象映射）、`capabilities.json`、`waivers.json`。

**验证结果**：
- 两次独立录制 `SHA256SUMS` **逐字节一致**。
- 自测 `35 PASS / 0 FAIL / 0 SKIP / 0 waived`（L1 静态契约也一致）。
- 基准：7 个热路径用例 3 轮采样，p50 从 174.9ms（空账户读）到 421.5ms（有数据聚合）。PGlite 绝对值不代表生产，用途是跨实现相对比值。

**已知限制**：PGlite 单连接，不能证明真实多连接 advisory lock 竞争（L3 待补）；详见 `contract/RESULTS.md`。

## 2026-10-26 — 数据库选型决策

用户询问「PG 数据库是必须的吗，有其他选择吗」。核实后新增 [`docs/database-choice.md`](docs/database-choice.md)：

- **PostgreSQL 引擎是硬依赖**，不能换成 MySQL/SQLite/MongoDB。依据：`releases/1.4.12/tokentracker-install.sql` 实测含 338 处 `jsonb`、82 处 PL/pgSQL 函数/触发器、33 处 `pg_advisory_xact_lock`、28 处 RLS、24 处 `auth.uid()`；第一行 preflight 就要求 InsForge 的 `auth.users`、`auth.uid()` 及三个 API 角色；14 个函数经 `@insforge/sdk` 走 PostgREST，而 PostgREST 只能连 PG。
- **可选的是 PG 的部署形态**：A 官方 Compose 内置 PG（推荐，v2.3.3 实测 15.18）／B 外部自建 PG（Pigsty 有模板，需自建角色与扩展）／C 托管 PG（Neon/RDS 等，无真 superuser 且有扩展白名单，高风险）／D PGlite（仅测试，单连接 alpha）／E 分布式 PG 兼容库（未验证）／F 重写平台（超出范围）。
- 澄清上游 `package.json` 里的 `pglite` / `sql.js` / `wa-sqlite` **只用于测试**，不是生产库；上游文档明确并发/锁测试必须在真实 PG 上跑。
- 明确本仓库 Docker 镜像不含数据库，对方案 A/B/C 都适用，只要目标 PG 已有 InsForge 的 `auth` schema 与角色。
- 同步更新 `docker/DEPLOY.md` 与 README 目录。

## 2026-10-26 — Docker 镜像交付 + 首次产物生成

用户明确：最终产物是 Docker 镜像，充分利用 GitHub 构建能力，目前只需 x86。

**首次实施完成**：`releases/1.4.12/`（19 个文件）——15 步基线 SQL、无事务版迁移 SQL、14 个 async CommonJS 私有函数、`functions.json`、`manifest-report.md`、`SHA256SUMS`。

**可复现性**：
- `summarize.cjs` 改用 `SOURCE_DATE_EPOCH`（上游 commit 时间），去掉报告里的本地绝对路径。
- `build.sh` 与新增的 `scripts/reproduce.sh` 用相同参数生成产物；实测两次构建 `SHA256SUMS` 逐字节一致。
- `reproduce.sh` 是 CI 硬门槛：从锁定上游 commit 重建，与仓库审计产物比对，不一致即失败。

**镜像**（linux/amd64）：
- 多阶段 `Dockerfile`：prepare → verify（构建期 `sha256sum -c` + 14 函数检查）→ runtime（`node:20-alpine`，非 root uid 10001，tini）。
- `docker/tokentracker.cjs` 部署 CLI：`info` / `verify` / `functions` / `sql` / `migration` / `checksums` / `export` / `commands`。只输出工件，不连实例、不执行 psql、不上传函数。
- 修复 `sql | head` 的 EPIPE 崩溃。
- `.dockerignore` 显式排除凭据；`docker-compose.example.yml` 提供一次性用法。
- OCI labels 记录上游 commit / 版本 / 平台；`BUILD.json` 含构建元数据。

**GitHub Actions** `.github/workflows/build-image.yml`：
- 触发：push(main，路径过滤) / PR（只构建不推送）/ `workflow_dispatch`（可覆盖上游 commit、控制是否推送）/ 每周定时回归。
- jobs：`meta`（读 REF）→ `reproduce`（可复现性硬门槛）→ `build`（buildx + GHA layer cache + SBOM + provenance + SLSA attestation + 冒烟测试）。
- 用内置 `GITHUB_TOKEN` + `packages: write` 推 GHCR，不需要 PAT；顶层权限仅 `contents: read`。
- 标签：`<version>`、`<version>-<short_sha>`、`latest`、`sha-<short>`。

**文档**：新增 [`docs/docker-image.md`](docs/docker-image.md) 与 `docker/DEPLOY.md`；README / MAINTENANCE 增加镜像章节。

**CI 上线过程（4 次迭代）**：
1. `badba45` 首跑失败 —— `reproduce.sh` 尾部 `[ ... ] && echo` 在成功时返回 1，CI 误判失败。改为 `if` + 显式 `exit 0`，并在 `verify.yml` 加退出码回归测试。
2. `a4e5125` Dockerfile 解析失败 —— 多行 `node -e '...'` 被 Dockerfile parser 当成指令。把 Node 逻辑抽成 `docker/verify-artifacts.cjs` 与 `docker/write-build-info.cjs`。
3. 同次构建**镜像已成功推送**，但 smoke test 的 `docker run ... sql | head -1` 在 `pipefail` 下 broken pipe。改为先重定向到文件；`export` 挂载目录加 `chmod 777`（容器 uid 10001）。
4. `8d7112e` 三个 job 全绿：`meta` → `reproduce` → `build`，冒烟测试含 `info`/`verify`/`functions`/`sql`/`export`+`sha256sum -c`/`commands`。

**产物**：`ghcr.io/quietsugar/token-tracker-self-hosting:1.4.12`（另有 `1.4.12-<short_sha>`、`latest`、`sha-<short>`），digest `sha256:6deb9ce1…`，包可见性 **public**，linux/amd64，含 SBOM 与 provenance attestation。

首次**部署**（VPS 上执行 SQL / 上传函数）仍未开始。

## 2026-10-26 — 首次推送成功（仓库正式上线）

- 用 GitHub App（App ID `5476780` / Installation `175378660`）的 installation token 推送 `main` 到 <https://github.com/QuietSugar/token-tracker-self-hosting.git>。
- 远程 `main` = `1949097`；`.github/workflows/verify.yml` 首次运行 **success**（密钥扫描 + 编码 + 脚本语法 + 产物校验通过）。
- 远程 29 个文件核对无 `.pem` / `.env` / 私钥类文件。
- 提交身份统一为 `hall <sugarjellyfish@gmail.com>`。
- 删除仅用于 PAT 无 workflow 权限场景的 `fallback-no-workflow` 备用分支及对应 bundle——完整历史已成功推送，不再需要。
- **首次实施（生成 SQL 与 14 个函数）仍未开始**；`releases/` 下暂无产物。

## 2026-10-26 — 改用 GitHub App 做长期推送认证

背景：fine-grained PAT 缺少 `workflow` 权限，推送 `.github/workflows/verify.yml` 被 GitHub 拒绝。用户希望长期维护，改用 GitHub App。

- 新增 [`docs/github-app-setup.md`](docs/github-app-setup.md)：完整的 GitHub App 创建/授权/安装/轮换指南，含必需的 `Contents: R/W` + `Workflows: R/W` 权限说明与官方参考链接。
- 新增 `scripts/gh-app-token.cjs`：用私钥签 RS256 JWT（`iat`/`exp`/`iss`）换取 1 小时 installation token；只写 600 权限的临时文件，stdout 不打印 token。
- 新增 `scripts/push-with-app.sh`：`GIT_ASKPASS` 注入 token 推送，输出脱敏，退出即清理临时文件；支持 `--dry-run`。
- `bootstrap.sh` / `session-start.sh`：检查 `~/.config/tokentracker-gh-app/` 凭据是否就绪。
- 提交身份设为 `hall <sugarjellyfish@gmail.com>`（可经 `SELFHOST_GIT_NAME` / `SELFHOST_GIT_EMAIL` 覆盖）。
- 查明仓库 owner 为 `QuietSugar`（User），与用户提供的用户名 `hall` 是两个不同账号；App 必须由有该仓库管理权限的账号安装。
- README / SECURITY.md / MAINTENANCE.md 同步更新推送方式与私钥保护规则。
- **首次实施仍未开始**；`releases/` 下暂无产物。

## 2026-10-26 — 建立长期维护机制

- 新增 `MAINTENANCE.md`：维护契约、会话启动协议、标准循环 SOP、决策树、硬停止条件、灾难恢复、当前不变式。明确「状态存在仓库里，不在对话记忆里」。
- 新增 `scripts/session-start.sh`：每次维护会话的状态快照命令，输出环境自检、锁定点、版本追踪、最近提交、已有产物、未完成待办、上游状态、安全检查结果。
- 新增 `scripts/bootstrap.sh`：实测发现工作区快照不保存 `.git/config` / `~/.gitconfig`，导致新会话丢失 `origin` 与提交身份（`git commit` 报 `Author identity unknown`）。该脚本幂等地恢复二者；`session-start.sh` 会增加环境自检提醒。
- 修正 `upstream.sh status` 误报：`git diff --numstat` 对纯权限位变更输出 `0  0  file`，之前被误计为内容变更。
- README 增加「长期维护」章节并在开头指向 `MAINTENANCE.md`；命令速查补充 `session-start.sh`。
- 约定：Agent 无法主动定时运行，由用户一句话触发；触发后应能完整执行而无需重新交代背景。
- **首次实施仍未开始**；`releases/` 下暂无产物。

## 2026-10-26 — 面向 public 远程仓库加固

远程确定为 <https://github.com/QuietSugar/token-tracker-self-hosting.git>（**公有仓库**）。

- 新增 `scripts/check-secrets.sh`：推送前密钥扫描（已知 token 格式、私钥块、疑似真实赋值、敏感文件名、`.gitignore` 覆盖验证）。
- 新增 `scripts/check-encoding.sh`：全仓 UTF-8 / 无 BOM 检查；`verify.sh` 改为复用它。
- 新增 `.github/workflows/verify.yml`：push / PR 时自动跑密钥扫描、编码检查、产物校验、脚本语法检查；只依赖官方 `actions/*`。
- README 新增「公有仓库安全约定」章节，明确公开内容范围与硬性规则。
- SECURITY.md 强调公有仓库 = 已泄露，误提交处置改为「先轮换再清历史」。
- 推送前全仓扫描结果：未发现真实凭据；域名均为 `your-domain.example` 类占位符。
- **首次实施仍未开始**；`releases/` 下暂无产物。

## 2026-10-26 — 仓库初始化（计划阶段）

- 创建独立运维仓库，与上游 TokenTracker checkout 分离。
- 归档三份规划文档到 `docs/`：维护提示词、可复用提示词、总体规划。
- 新增 `docs/runbook.md`：首次实施 / 升级 / 回滚操作手册。
- 建立 `tracking/REF`（锁定 v1.4.12 / `8d32a956181bf52fae449c89b8f6520253566283`）与 `tracking/upstream.md` 版本追踪表。
- 新增脚本：`upstream.sh`（只读上游检查）、`build.sh`（产物生成）、`summarize.cjs`（清单摘要）、`verify.sh`（完整性与编码校验）。
- 新增 `env/server.env.example`、`releases/_template/` 模板。
- 记录已知偏差：文档写 14 步，实际 `manifest.steps()` 为 15 步；以 `tracking/upstream.md` 为准。
- **首次实施尚未开始**：`releases/` 下暂无产物。
