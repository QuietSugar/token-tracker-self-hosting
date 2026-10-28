# 变更记录

记录**本仓库自身**的变化（上游版本见 [`docs/maintainers/upstream.md`](docs/maintainers/upstream.md)）。
只写使用者能感知的东西；内部重构与文档搬家不在此列。当前处于实验通道，未发正式版。

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
