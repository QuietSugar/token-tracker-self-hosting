# 当前状态

> 结论型文档：这里只放**现在成立的事实**。设计推理见 `design/`（[索引](README.md#design--为什么这么做)），操作步骤见 `users/`（[索引](README.md#users--怎么用)）。
> 最后核对：2026-10-28（上游 v1.5.0 / `b2c2eb85`）

## 概览

服务可运行、可接入真实官方客户端、契约用例全部通过；**尚未达到生产 GA** —— 缺少的是并发、审计、监控这类「多用户 / 多副本才需要」的能力，而本项目定位为局域网单实例自用。

## 已验证（有证据）

| 能力 | 证据 |
|---|---|
| 官方客户端：`init` / `device-login` / `sync` / `doctor`（1.4.15 实测；1.5.0 契约逐字节相同） | 手工实测，见 [`users/official-client.md`](users/official-client.md) |
| 跨设备汇总视图（`/api/auth/*` → `account-*`） | 实测 7500 tokens；`scripts/check-oauth.sh` 一键自检 |
| 用量上传：整行修正、幂等重传、多设备隔离 | 契约用例 + `-race` 单测 |
| `account-summary/daily/hourly/monthly/heatmap/model-breakdown/devices` | 契约 golden 对拍（基线 1.5.0），33 PASS / 2 SKIP |
| 时区（`tz` / `tz_offset_minutes`）与 heatmap `format=compact` | 与官方模块对拍的回归用例 |
| 设备维度：按设备汇总、`device_id` 过滤、重命名、暂停/恢复 | 同上 |
| CORS 预检（`OPTIONS /functions/*`、`/api/selfhost/*`）返回 204 + 该端点的 CORS 头 | 单测（billing/account/ingest/device-flow 各 slug 的头集合逐一断言，且预检放行后真请求仍 401）+ 实跑 curl 复现命令 |
| 并发刷新（多个组件同时用同一份 refresh token mint） | 单测：宽限期内 200 + `X-TokenTracker-Refresh: grace`、两份新 token 都可用、超期 401 + `X-TokenTracker-Auth-Error`；实跑 6 并发同一 token 全 200，用旧 token 登出后 6 份接替者全部 401 |
| 未实现的接口返回 404 而非 401（先于鉴权） | 单测：7 个未实现 slug × 带/不带凭据全部 404 且保留 CORS 头；同用例断言已实现端点无凭据仍 401 + 实跑 curl |
| 社区榜单空态（`GET /functions/tokentracker-leaderboard`，公开） | 单测：三个 tab + 非法 period 均 200、`entries` 恒空、带 `self_hosted`/`source` 标记；同一用例断言其它未安装 slug 仍 401/404 + 实跑 curl |
| 内建看板（`GET /`），用量只读 | 单测 + 实跑（无外部请求、CSP 白名单） |
| 看板内重命名设备（同步 `devices` 与 `cloud_machines`） | 单测 + 实跑（重名 409、空名 400）+ jsdom 交互验证 |
| device token 长期有效（无 TTL，只有撤销能失效） | 单测：七年前签发的 token 仍可上传；并断言 `device_tokens` 表里不存在过期列 |
| 设备归属：不同机器各自成行、不串用量 | 单测 5 例（两台不同 `machine_id`/`client_info` 必须两行、同机重登复用、同名不同机加后缀、老行认领、`client_info` 取名规则）+ 实跑（两台机器各报一条，`hourly.device_id` 各自正确）|
| 看板「最后同步」列（`last_seen_at`） | `GET /api/selfhost/devices` 单测覆盖四种形态（有值 / 从未同步 / 已撤销不返回 / 重复机器行去重）+ 实跑 + jsdom 渲染验证 |
| 镜像 `ghcr.io/quietsugar/token-tracker-self-hosting-go:experimental` | CI 推送前强制执行真实 PG 冒烟测试 |
| PostgreSQL 15 / 16 | CI 矩阵均跑单测 + 契约 |
| 容器加固参数（`read_only` / `cap_drop: ALL` / 非 root `10001` / `no-new-privileges` / `tmpfs`） | CI 每次以与 `docker-compose.postgres-go.example.yml` 相同的参数启动容器，断言非 root、`/health` 200、看板 200 |

**测试基线**：`go test -race ./...` 全绿，`go vet` 干净，契约 **33 PASS / 0 FAIL / 2 SKIP**。

两个 SKIP 并非未实现，而是**实现边界不同**：本项目不伪造 "PostgreSQL 15 步迁移账本"，改用自身的
`schema_migrations(version=1, checksum=sha256(core DDL))` 作为 drift gate。详见 [`maintainers/contract.md`](maintainers/contract.md)。

## 未验证

- **arm64**：CI 现已在 QEMU 下实际启动一次（arm64 镜像 + 真实 PG → `/health` 200），manifest 亦断言双架构；
  但**未在真机 arm64 上运行过**（验收记录仅含 linux/amd64）。首次在 NAS / 小主机上部署时请自行做一次冒烟验证。
- **大基数 / 长历史**：尚未对几个月的真实数据做压测；heatmap / model-breakdown 未分页，依赖一次性全量读取。
- **托管 PG**（RDS / Neon / Cloud SQL）：仅在本地 PG 上验证，`sslmode=verify-full` 链路未运行过。
- **Windows / macOS 服务端**：二进制为静态链接（CGO=0），理论上可运行，尚未验收。
- **多副本**：明确不支持（见下）。

## 已知缺口（影响使用决策）

1. **多实例写并发不安全**：`ingest` 的整行修正依赖进程内互斥；多副本同时写同一主键时缺少 `pg_advisory_xact_lock`，可能相互覆盖。**单实例部署不受影响。**
2. **仅有 16 张业务表**（上游 PG 参考清单为 24 张）：session states、赠送码审计、支付 / 账单审计未实现 —— 自托管模式下这些功能本就不在范围内。
3. **没有速率限制、审计日志、指标导出**。这是局域网自用场景下的取舍。
4. **schema 仅有 version 1 与增量 additions**：升级无需重建库，但不支持自动回滚；升级前请自备数据库备份（备份不在本仓库范围内）。
5. **`/_test/*` 端点**（含可执行任意 SQL 的 `/_test/sql`）仅在 `TT_ENABLE_TEST_ENDPOINTS=true` 时挂载，**生产环境必须保持关闭**（仅 `/_test/health` 无条件存在，且不接触数据）。
6. **契约覆盖之外的行为未知**：契约仅锁定 33 个场景，边界语义（极端时区、超大 batch、异常时间戳）未穷举。
7. **暂停不是"硬"状态**：`ingest` 不检查机器 `status`，客户端重新 `device-login` 之后仍能上传。
   本项目按「设备长期在线」使用、不在看板暴露暂停，因此不受影响；依赖「暂停必须拦死上传」的场景
   需要先补这项判断。（`machineFor` 的判重已改为不看 `status`，所以重新接入不会再产生重复机器行。）
8. **存量数据的归属错误不会自动修正**：2026-10-28 之前通过 `device-login` 接入的第二台及以后的机器，
   其用量可能记在别的设备行上（账户总量正确）。修复步骤见
   [`users/devices.md` §6](users/devices.md#6-用量记错了设备怎么办老数据修复)：推荐「删掉被污染设备行的用量 +
   各机器重放本地队列」（`queue.jsonl` 是 append-only 全量桶，重放即精确重建），队列丢失时才按范围搬迁。
   升级本身不改任何历史用量。
9. **暂停 / 恢复仅在 device token 层生效**：暂停会撤销 token，恢复会将其还原；已登录的 `auth_sessions`
   （dashboard 登录态）不受影响 —— 设备暂停不等于使登录会话失效。

## 已知偏差（与官方行为有意不同，或暂时不同）

细节与理由见 [`design/parity.md`](design/parity.md)。其中影响使用者观感的两条列在此处：

- **看板不隐藏 0 用量设备**：官方 dashboard 会将当前周期无用量设备从下拉列表中隐藏，本项目照常列出并标注「无用量」，否则易被误认为设备丢失。
- **`streak_days` 恒为 0**，heatmap 的星期对齐按上游实现原样跟随（上游自身在这两处并不一致，本项目不做「修正」）。

## 非目标

- 付费 / 试用 / 赠送码 / 社区排行榜
- 多租户、第三方 OAuth、邮件验证、找回密码、多账户管理后台
- 修改或 patch 官方客户端
- 把数据同步回官方云（本服务是终点，不是中转）
- 备份 / 恢复方案（数据库维护者的职责）

## 与「标准」的关系

本仓库同时维护**上游工件线**（`releases/`、`contract/`）：它定义「官方行为」的基准，Go 后端据此实现。流程为：上游发布 → 重新生成工件 → diff → 同步实现 → 运行契约 → 发布镜像。该循环记录于 [`maintainers/upstream.md`](maintainers/upstream.md)。
