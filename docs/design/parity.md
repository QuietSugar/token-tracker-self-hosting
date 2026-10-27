# 设计：什么是"和官方等价"

> 结论：**等价 = 33 个契约场景逐字段通过**，不是"看起来能用"。这份文件说明等价的范围、怎么判、哪些地方有意不等价。
> 判定工具在 [`../maintainers/contract.md`](../maintainers/contract.md)。现状见 [`../status.md`](../status.md)。

## 1. 为什么用契约，而不是"照抄代码"

上游后端是 PostgreSQL + TypeScript（Deno）函数。用另一种语言重写时，最容易出错的不是"功能有没有"，
而是**语义漂移**：时区/夏令时边界差一小时、浮点与整数舍入、`null` 与 `0`、错误码与错误文案、CORS 头、
幂等与整行修正、权限边界、排序、空数组 vs `null`。

这些看代码看不出来。所以做法是：**把上游实现当黑盒录制真实响应**，我们的实现跑同一批用例逐字段对比。
录到的不是 mock：参考实现跑的是上游真实的 15 步安装 SQL + 真实的 14 个打包函数（在 PGlite 上）。

## 2. 三层验证

| 层 | 验什么 | 手段 |
|---|---|---|
| **L1 静态契约** | 安装步骤、函数清单、表/索引/触发器/策略/GRANT 的数量与名字 | `golden/<ver>/static.json` 对拍 |
| **L2 用例契约** | 35 个场景 / 82 步的 HTTP 请求-响应（状态码、body、关键头） | `contract/scenarios/*.json` → 归一化 → 与 golden 逐字段 diff |
| **L3 并发语义** | PGlite 是单连接，证明不了锁与并发 | 真实 PG 上的 advisory lock 互斥、8 连接并发重装（见 `contract/L3-RESULTS.md`） |

L1+L2 在 CI 里对**我们的实现**跑；2 个 SKIP 是上游 PG 专属的"15 步安装账本"用例 ——
我们不伪造成那个账本，用 `schema_migrations(version=1, checksum=sha256(core DDL))` 做自己的 drift gate。
这是**实现边界不同，不是缺功能**。

## 3. 等价的范围

`/functions/*` 的 14 个 slug 固定、不可改名：

```
device-flow-authorize  device-flow-poll   device-flow-grant   device-token-issue
device-rename          ingest
account-summary  account-daily  account-hourly  account-monthly
account-heatmap  account-model-breakdown      account-devices
billing
```

公开入口只有 `authorize` 和 `poll`；其余拒绝未认证请求。未注册的 slug（例如上游客户端会打的
`tokentracker-telemetry`）返回 404 —— 客户端忽略它，不影响任何流程。

数据面：主键 `(user_id, device_id, hour_start, source, model)`，重复上传**整行替换**；时区按
`tz` / `tz_offset_minutes` 归本地日；heatmap 支持 `format=compact`。这些都由用例锁住。

## 4. 有意不等价的地方

| 项 | 官方 | 我们 | 理由 |
|---|---|---|---|
| 付费 / 试用 / 赠送码 | 完整计费链路 | `billing` 只保留 `account`/`devices`/`remove-device`/`resume-device`；无支付行、无套餐 | 自托管模式下上游自己也把付费排除在自托管清单外 |
| 表数量 | 24 张 | 16 张业务表 + 2 张账本 | session states、赠送码审计、支付审计未实现 |
| 0 用量设备 | dashboard 前端把当前周期无用量的设备藏掉 | **照列并标"无用量"** | 藏起来看起来像设备丢了 |
| `streak_days` | 上游实现里恒为 0 | 也恒为 0 | 不"修正"上游的 bug，等价优先 |
| heatmap 星期对齐 | 上游自己前后不一致 | 原样跟随 | 同上 |
| 第三方 OAuth / 邮件 / 找回密码 | 有 | 无 | 单使用者场景是负担 |
| 遥测 | 上报 | 404 | 不收集 |

凡是上面没有列出的差异，跑契约就会 FAIL。**有意偏差必须登记**在 `contract/waivers.json`
（`case` / `path` / `reason` / `approvedBy` / `date`），当前该列表为空 —— 也就是说，
除了"我们不做那些功能"和两条 UI 呈现差异，行为上没有已知偏差。

## 5. 不做的三件事及理由

1. **不 patch 官方客户端。** 客户端的校验（`base_url` 只能 https 或 localhost）也不改。
   我们要么满足它，要么承认它的限制（[`../users/official-client.md`](../users/official-client.md) §2）。
2. **不把数据同步回官方云。** 这个服务是终点，不是中转。
3. **不为了"更像官方"而实现用不到的表和端点。** 每多一张表就多一份升级与迁移负担，
   而它们服务的功能（付费、多租户）我们明确不做。

## 6. 什么时候重录 golden

只有**上游契约变了**才重录，不是我们改代码就重录：

- 上游 `scripts/self-host/` 或 `dashboard/edge-patches/cloud` 的 diff 非空；
- `manifest.cjs` 的 `steps()` 或 `privateFunctions` 变了。

流程见 [`../maintainers/upstream.md`](../maintainers/upstream.md)。**为了让测试变绿而重录 golden 是作弊** ——
那是把 bug 写进基准。
