# 当前状态

> 结论型文档：这里只放**现在成立的事实**。设计推理见 `design/`，操作步骤见 `users/`。
> 最后核对：2026-10-27（上游 v1.4.12 / `8d32a956`）

## 一句话

能跑、能接真实官方客户端、契约用例全过；**不是生产 GA**——缺的是并发、审计、监控这类"多用户/多副本才需要"的东西，而本项目的定位是局域网单实例自用。

## 已验证（有证据）

| 能力 | 证据 |
|---|---|
| 官方客户端 v1.4.12：`init` / `device-login` / `sync` / `doctor` | 手工实测，见 [`users/official-client.md`](users/official-client.md) |
| 跨设备汇总视图（`/api/auth/*` → `account-*`） | 实测 7500 tokens；`scripts/check-oauth.sh` 一键自检 |
| 用量上传：整行修正、幂等重传、多设备隔离 | 契约用例 + `-race` 单测 |
| `account-summary/daily/hourly/monthly/heatmap/model-breakdown/devices` | 契约 golden 对拍，33 PASS |
| 时区（`tz` / `tz_offset_minutes`）与 heatmap `format=compact` | 与官方模块对拍的回归用例 |
| 设备维度：按设备汇总、`device_id` 过滤、重命名、暂停/恢复 | 同上 |
| 内建只读看板（`GET /`） | 单测 + 实跑（零外联、CSP 白名单） |
| 镜像 `ghcr.io/quietsugar/token-tracker-self-hosting-go:experimental` | CI 推送前强制跑真实 PG 冒烟 |
| PostgreSQL 15 / 16 | CI 矩阵均跑单测 + 契约 |

**测试基线**：`go test -race ./...` 全绿，`go vet` 干净，契约 **33 PASS / 0 FAIL / 2 SKIP**。

两个 SKIP 不是"没做到"，是**实现边界不同**：我们不伪造成 "PostgreSQL 15 步迁移账本"，用自己
的 `schema_migrations(version=1, checksum=sha256(core DDL))` 做 drift gate。详见 `maintainers/contract.md`（迁移中）。

## 未验证

- **arm64**：CI 构建了镜像，没在真机上跑过（验收记录只有 linux/amd64）。
- **大基数/长历史**：几个月的真实数据没有压测；heatmap / model-breakdown 没有分页，靠一次性全取。
- **托管 PG**（RDS/Neon/Cloud SQL）：只在本地 PG 上验证过，`sslmode=verify-full` 的链路没跑过。
- **Windows / macOS 服务端**：二进制是静态 CGO=0，理论上能跑，没验收。
- **多副本**：明确不支持（见下）。

## 已知缺口（会影响你的决策）

1. **多实例写并发不安全**：`ingest` 的整行修正靠进程内互斥；多副本同时写同一主键没有 `pg_advisory_xact_lock`，可能互相覆盖。**单实例部署没有这个问题。**
2. **只有 16 张业务表**（上游 PG 参考清单 24 张）：session states、赠送码审计、支付/账单审计未实现——自托管模式下这些功能本就排除。
3. **没有速率限制、审计日志、指标导出**。局域网自用的取舍。
4. **schema 只有 version 1 + 增量 additions**：升级不需要重建库，但也没有自动回滚；升级前请自备数据库备份（备份不在本仓库范围）。
5. **`/_test/*` 端点**（含可执行任意 SQL 的 `/_test/sql`）只在 `TT_ENABLE_TEST_ENDPOINTS=true` 时挂载，**生产必须保持关闭**。
6. **契约覆盖之外的行为未知**：契约只锁了 33 个场景，边界语义（极端时区、超大 batch、异常时间戳）没穷举。

## 已知偏差（与官方行为有意不同，或暂时不同）

细节与理由见 `design/parity.md`（迁移中）。会影响用户观感的两条先写在这：

- **看板不隐藏 0 用量设备**：官方 dashboard 会把当前周期没有用量的设备从下拉里藏掉，我们照列并标「无用量」，否则看起来像设备丢了。
- **`streak_days` 恒为 0**、heatmap 的星期对齐按上游实现原样跟随（上游自己这两处就不一致，我们不做"修正"）。

## 非目标（不做，别再问）

- 付费 / 试用 / 赠送码 / 社区排行榜
- 多租户、第三方 OAuth、邮件验证、找回密码、多账户管理后台
- 修改或 patch 官方客户端
- 把数据同步回官方云（本服务是终点，不是中转）
- 备份 / 恢复方案（数据库维护者的职责）

## 与「标准」的关系

本仓库同时维护**上游工件线**（`releases/`、`contract/`）：它定义"官方行为长什么样"，Go 后端照着它实现。上游发布 → 重新生成工件 → diff → 同步实现 → 跑契约 → 发镜像。这条循环写在 `maintainers/upstream.md`（迁移中）。
