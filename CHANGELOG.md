# 变更记录

记录**本仓库自身**的变化（上游版本见 [`docs/maintainers/upstream.md`](docs/maintainers/upstream.md)）。
只写使用者能感知的东西；内部重构与文档搬家不在此列。当前处于实验通道，未发正式版。

## 2026-10-28 — 榜单页不再整页报错

- **`/functions/tokentracker-leaderboard` 现在返回空态（200）而不是 404**。官方桌面 GUI 的侧边栏
  无条件列出「榜单」，自托管没有社区数据，此前点进去整页是一行红字
  `Error: Request failed with HTTP 404`（客户端对列表接口的 404 没有特判）。
  现在返回 `entries: []` / `total_entries: 0`，页面显示中性的「No data」。
- **不编造任何榜单内容**：没有虚构用户、没有把自己包装成排名；响应里带
  `self_hosted: true` 与 `source: "unavailable"`，抓包一眼可辨。
- 只做这一个 slug。其它未安装的函数（`leaderboard-profile`、`community-models`、遥测等）
  行为不变：无凭据 401，认证后 404。榜单资料卡（`/u/<id>`）本来就是 404 → 客户端显示「没有这个人」，
  语义正确，不动。

## 2026-10-28 — 跟进上游 v1.5.0

- **锁定点升到上游 v1.5.0**（`b2c2eb85`），重新生成 `releases/1.5.0/` 并重录 `contract/golden/1.5.0/`。
- **后端无需改动**：安装 SQL / 迁移 SQL / 15 步清单 / 14 个函数 bundle / `functions.json`
  与 1.4.15 **逐字节相同**；35 个行为用例与 `static.json`（依赖版本）也逐字节相同。
  契约路径下唯一的变更是 `edge-patches/tokentracker-leaderboard-profile.ts`（榜单资料卡的
  `totals` 改用 lifetime snapshot 并新增 `source` 字段）——该函数不在自托管的 14 个函数内。
- 客户端建议升级到 v1.5.0：sessions 页支持 DeepSeek Harness 会话、zcode 重置卡倒计时、
  限额面板可折叠、榜单资料卡总额口径修正。
- 部署工件镜像默认 tag 随之升到 `1.5.0`（`docker-compose.example.yml`）。

## 2026-10-28 — 并发刷新不再把界面锁进「登录状态需要刷新」

- **refresh token 轮换加了 60 秒宽限期**：桌面 GUI 的 webview 里多个组件会**同时**拿同一份
  refresh token 去换新 token；轮换是「旧的立刻失效」，先到的成功、后到的 401，前端把 401 当成
  鉴权失效并重试，于是「云服务 / 会员状态」页卡在 `cloud.error.auth` 无限重试。
  现在**因轮换而失效的旧 token 在 60 秒内再用仍可换到一份新会话**（响应头 `X-TokenTracker-Refresh: grace`），
  客户端拿到哪一份都能用。
- **登出仍然立即生效**：用一份「已经被换掉的旧 token」登出时，会顺着接替链把并发签发出来的
  会话一并撤销（此前这种情况等于登出没生效）。登出不走宽限期。
- **过期太久的旧 token 仍按原样拒绝**（`401 REFRESH_TOKEN_REUSED`），并带上
  `X-TokenTracker-Auth-Error: refresh_token_reused`，让客户端能区分「重试无用，需要重新登录」。
- **严格模式不变**：`TT_AUTH_REVOKE_ON_REUSE=true` 时一次重放即拒绝并撤销该用户全部会话，不给宽限。
- 数据库：新增 additive step 3（`auth_sessions.rotated_at`、`auth_sessions.parent_id`）。
  老实例升级时启动自动补列，无需手工迁移，也不影响已有会话。

## 2026-10-28 — 修复 CORS 预检被 401 拦死（官方桌面 GUI 连不上）

- **`/functions/*` 的 CORS 预检（`OPTIONS`）现在返回 204 并保留该端点的 CORS 头**，
  不再走鉴权。此前预检也走 `s.auth()`，无 JWT 直接 401 —— 浏览器对带 `Authorization` 的跨域请求
  一定先发预检，预检失败后真正的请求根本不会发出，于是**官方桌面 GUI（Tauri/WebView2）直连
  `base_url` 的场景整体失效**：登录成功但显示「会员状态待确认 / 连接中断」，机器列表空白。
  CLI 走本地 relay（Node，不受 CORS 约束），契约客户端也不发预检，所以一直没暴露。
- **`/api/selfhost/*`（看板端点）同样放行预检**：同源访问本来用不到，但从别处打开看板
  或反代换域名时会踩同一个坑。
- 真请求不受影响：预检只回 204 空响应，无凭据的 GET/POST 仍然 401。
- 反代层为绕开此问题加的「`/functions/` OPTIONS 直接返回 204」不用再写了，可以删掉。

## 2026-10-28 — 跟进上游 v1.4.15

- **锁定点升到上游 v1.4.15**（`4cf3e212`），重新生成 `releases/1.4.15/` 并重录 `contract/golden/1.4.15/`。
- **后端无需改动**：安装 SQL / 迁移 SQL / 15 步清单 / 14 个函数签名与 1.4.12 逐字节相同；
  唯一变化是 3 个 `account-*` 函数内嵌的定价表新增 `gpt-6.1-terra`（本后端的定价状态本就是
  `unpriced`、成本取客户端上传值，因此不跟随）。35 个行为用例新旧 golden **逐字节相同**。
- **契约基线换成 1.4.15**：Go 后端在 1.4.15 golden 上重跑 33 PASS / 0 FAIL / 2 SKIP。
- **修掉评审脚本的盲区**：`./scripts/upstream.sh review` 原先只盯 `dashboard/edge-patches/cloud`，
  漏掉了 `edge-patches/tokentracker-account-*.ts`（定价表所在），1.4.15 这次就被误报成「契约 diff 空」。
  现在收整个 `dashboard/edge-patches`。
- 客户端建议升级到 v1.4.15（Qoder 追踪恢复、GPT-6.1 Terra 定价、sessions 页与 macOS 菜单栏改进）。
- 部署工件镜像默认 tag 随之升到 `1.4.15`（`docker-compose.example.yml`）。

## 2026-10-28 — 修复「用量记到别的设备名下」

- **修复归属错误**：`device-login` 过去按 `machine_id OR (platform, device_name)` 判重，而所有通过
  device flow 接入的设备行都固定叫 `Device Flow` / `cli` —— 于是**第二台机器的登录会复用第一台的设备行**，
  它上传的用量全部记在第一台名下（账户总量没错，但跨设备汇总里一台虚高、一台偏少）。
  现在判重只看 `machine_id`，不同机器各自建行。
- **设备名改为 hostname**：客户端 `client_info` 是 `${os.platform()}-${os.arch()} ${os.hostname()}`，
  服务端取 hostname 当设备名、`platform` 用官方的 `cli-device-flow`。设备列表里不再是一排同名 `Device Flow`。
- **重名不再顶替**：两台机器 hostname 相同时，后接入的那台自动改名 `hp #1a2b3c4d` 并照常接入——
  报错会让人「再也登录不上」，顶替会造成归属错乱，加后缀是唯一不牺牲可用性的做法。
- **老库兼容**：没有 `machine_id` 的历史设备行会被同名机器认领并回填，不会为同一台机器多建一行。
- **老数据修复手册**：已经写错的用量不会自己搬家。推荐做法是**删掉被污染设备行的用量 + 每台机器重放
  自己的本地队列**（`queue.jsonl` 是 append-only 的全量小时桶，重放即原样重建，归属精确、不靠猜），
  客户端侧只需重新 `init` 一次让 `offset` 归零再 `sync`，或用 `scripts/replay-queue.py` 代劳；
  本地队列已丢失时才退回按范围搬迁。见
  [`docs/users/devices.md` §6](docs/users/devices.md#6-用量记错了设备怎么办老数据修复)。
- **新增老数据修复工具**（已经写错的用量不会自己搬家）：
  `go-server/scripts/device-report.sql`（只读诊断：设备用量、可疑登录、汇总对账）与
  `go-server/scripts/device-move-usage.sh`（把用量从一台设备搬到另一台，支持时间范围、冲突时默认中止、
  `--merge=sum` 合并、搬完打印全库总计对账）。用法见 [`docs/users/devices.md`](docs/users/devices.md#6-用量记错了设备怎么办老数据修复)。

## 2026-10-28 — 看板显示「最后同步」

- 设备列表每行新增**最后同步**：`3 分钟前` / `2026-09-30` / `从未同步` 三种形态，超过 7 天淡化显示。
  语义是「最后一次有新用量上传」，不是「最后一次 HTTP 通信」——文档里写清了，避免误读成掉线。
- 新增只读端点 `GET /api/selfhost/devices`（需 JWT）：返回设备的
  `machine_id / status / created_at / last_seen_at / active_tokens`。放在自托管命名空间下，
  不给官方 `account-devices` 加字段，契约零变更。
- **修复**：`machineFor` 判重不再只看 `status='active'`。此前被暂停的机器在客户端重新接入时会再插一行，
  同一个 `machine_id` 出现两行、`billing?action=devices` 里变成两台同名设备；现在复用原行。

## 2026-10-28 — 设备凭据长期有效（无需续期）

- **明确并锁定**：device token **没有有效期**（服务端无过期列，客户端也不存），签发多年后仍可上传；
  唯一失效途径是撤销。新增两条回归用例（七年前的 token 仍能上传、表结构不得出现过期列）。
- 每次 `sync` 都会刷新设备的「最后活跃」（`cloud_machines.last_seen_at`），持续上传的机器永远在线，
  不存在"到期要重新 device-login"。
- 文档写清三样真正有期限的东西（`user_code` 15 分钟、看板 access 1 小时 / refresh 90 天轮换），均不影响上传。
- 使用模式收敛为「官方客户端长期 sync + 看板只做改名」：看板不提供暂停 / 恢复 / 删除，
  `docs/status.md` 记录暂停不是"硬"状态这一已知缺口。

## 2026-10-28 — 看板内改设备名

- **内建看板可以重命名设备**：设备列表每行多一个「改名」，行内编辑后回车 / 保存即写入，
  走官方的 `tokentracker-device-rename`（同一平台重名返回 409 并在页面提示）。
- **改名会同时更新官方 dashboard 看到的机器名**：名字落在 `devices.device_name` 与
  `cloud_machines.name` 两张表上，此前只改前者，导致 `billing?action=devices` 仍显示旧名。
- 客户端重新 `device-login` 或重签 token 不会把服务端改好的名字覆盖回去（按 `machine_id` 复用设备行）。
- 看板仍然是「用量只读」：`TestDashboardWritesAreAllowlisted` 把可写端点锁在白名单里（登录 / 续期 / 改名）。

## 2026-10-28 — 设备暂停/恢复

- **恢复后可以直接继续上传**：`resume-device` 现在会把暂停时撤销的设备与 device token 还原，
  那台机器用原来的 token 就能接着上报，不必重新 `device-login`（之前恢复只改状态，上传仍 401）。
- 暂停期间客户端如果自己重新接入过，恢复会保留旧行的撤销状态——不会出现两条活跃设备行，也不会复活被替换的 token。
- 暂停/恢复只影响 device token，不影响已登录的 dashboard 会话。

## 2026-10-27 — 文档重构

- 文档按读者分层：`docs/users/`（怎么用）、`docs/agents/`（AI 剧本）、`docs/design/`（为什么）、`docs/maintainers/`（怎么维护）。
- 新增 AI 剧本：部署（判定树 + 验证门 + 停手条件）与开发（仓库地图 + 四道门）。
- 每个事实只留一个出处，旧文档删除（git 历史可查）；`CHANGELOG` 精简为每版本 3–5 条。

## 2026-10-27 — 切库重放与队列卡死修复

- **修复**：队列尾部只剩 `account_session_states` 控制记录时，`tokentracker-ingest` 回 400 导致 `tracker sync` 永久卡住；现在收下并回 200（真正空的 body 仍 400）。
- **新增** `replay-queue.py`：把客户端 `queue.jsonl` 原样重放到本服务（保留原始时间戳，重放幂等）。
- 文档补齐「从官方云切到自建会发生什么」：客户端换地址会把上传 offset 归零重放本地队列，云端独有历史不在其中。

## 2026-10-27 — 新机接入与官方流程对齐

- `TT_DEVICE_APPROVE` 默认改为 `page`：`device-login` 后在浏览器打开 `/device?user_code=…` 点批准，与官方一致。
- 新增 `/device` 审批页（显示 `client_info`、`machine_id`、有效期）；无头机器可用 `auto`，需要审批边界用 `jwt` + `approve-device.sh`。

## 2026-10-27 — 内建只读看板与 `/health`

- `GET /` 提供只读用量看板（零外部请求、严格 CSP、`Cache-Control: no-store`），三种登录方式。
- `/health` 返回 `{ok, engine, version, ref}`（不查数据库）；`TT_ACCESS_LOG=true` 可看请求是否带认证头。

## 2026-10-27 — 只保留 PostgreSQL

- 删除 SQLite 支持，归档在 tag **`sqlite-final`**；`TT_DATABASE_URL` 成为必填项。
- 收益是保真度：唯一在用的引擎被真正测到，方言层、双份 CI、双份契约 adapter 一起消失。
- 代价：`go test` 不再能零依赖跑，需要先有 PG（`go-server/scripts/test-with-pg.sh`）；没有自动搬数工具。

## 2026-10-27 — 与官方逐个对拍

- 时区归日（`tz` / `tz_offset_minutes`）、heatmap `format=compact`、设备管理卡（`billing?action=devices|remove-device|resume-device`）对齐官方。
- 已知有意保留的差异：0 用量设备照列（不隐藏）、`streak_days` 与 heatmap 星期对齐原样跟随上游。

## 2026-10-27 — 多设备维度 + 删掉「默认账户」

- 所有读接口支持 `?device_id=`；`account-devices` 按设备汇总、不过滤 0 用量。
- `device-rename` 冲突回 409；同一台机器重复接入复用设备行、换新 token。
- 删除写死的「默认账户 UUID」及其兼容逻辑，服务假定每次部署从空库开始。

## 2026-10-27 — 账户归属收敛

- `auth_owner`（单例）成为唯一真相：先 `device-login` 还是先登录，都收敛到同一个账户；`TT_DEFAULT_ACCOUNT` 退场。
- `GET /api/auth/owner`（仅回环）供脚本解析 `--sub`。

## 2026-10-27 — 认证层 `/api/auth/*`

- 实现注册/登录/刷新/登出/会话列表/`public-config`/`owner`，流程与报文对齐官方。
- 官方客户端的跨设备汇总视图不再静默降级为「仅本机」；access token 就是本服务原有的 HS256 JWT。
- refresh token 轮换 + 只存 SHA-256；重放默认不牵连其他会话（`TT_AUTH_REVOKE_ON_REUSE` 可收紧）。

## 2026-10-27 — 官方客户端接入

- 实测 v1.4.12：`init` / `device-login` / `sync` / `doctor` 全通，`ingest` 重传不翻倍。
- 客户端硬约束写进文档：`base_url` 只接受 `https://` 或 `http://localhost`；局域网部署需要反代 + 证书或 SSH 转发。

## 2026-10-26 — Go 后端（PostgreSQL）与实验镜像

- 单二进制 + PostgreSQL 的替代实现，契约 **33 PASS / 0 FAIL / 2 SKIP**；CI 在 PG 15/16 上跑单测 + 契约。
- 镜像 `ghcr.io/quietsugar/token-tracker-self-hosting-go:experimental`（**不发 `latest`**），推送前强制真实 PG 冒烟。
- 工件线保持为「标准」：`tracking/REF` 锁上游 commit，`releases/` + `contract/` 定义官方行为；上游更新必须重新生成并 diff。

## 2026-10-26 — 契约测试体系与产物线

- 把上游后端当黑盒录制 golden（35 用例 / 82 步），作为任何替代实现的一致性基准。
- 从锁定 commit 生成自托管产物（15 步安装 SQL + 14 个函数 + SHA256SUMS），工件镜像携带产物与部署 CLI。
- 公有仓库守卫：密钥扫描 + 编码校验 + 产物校验和在每次 push/PR 上跑。
