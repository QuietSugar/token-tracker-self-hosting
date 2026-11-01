已在 `7d293fc`（PR #48）修掉，**不自动关闭本 issue**，关不关由你决定。

## 根因确认

你给的现象和库内证据能对上，责任在服务端：

`POST /api/auth/refresh` 以前每次轮换都会 `newSession()` **生成一对随机 token**。客户端一次打开「云服务 / 会员」页会并发发 20+ 个相同 refresh token（GUI 的 webview 组件 + relay），于是服务端签出 20+ 份**互不相同**的子会话，全部挂在同一个 `parent_id` 下——这正是你库里看到的「25 条 `created_at` 同一秒、组成超长父子链」。

而客户端只有一个存储位，谁最后写谁赢，落盘的常常是链中间那份**已被后续轮换标记失效**的 token。之后客户端取不到可用凭据，`/functions/tokentracker-billing` 就变成**不带 `Authorization`** 的请求 → `401 auth=no` → 页面停在 `cloud.error.auth`。邮件重登录压不住，因为开一次页面又会分裂一次。

## 修法

1. **轮换出的 token 由父 token 派生**，不再随机：

   ```
   child_refresh = hex(HMAC-SHA256(TT_JWT_SECRET, "tt-refresh-v1\0" || sha256(parent)))
   child_csrf    = HMAC(同上，tt-csrf-v1) 的前 32 个 hex 字符
   ```

   同一个父 token 永远得到同一个子 token；并发插入靠 `auth_sessions(token_hash)` 唯一索引 +
   `ON CONFLICT DO NOTHING` 收敛成**一行**。所以 N 路拿到的 `refreshToken` 逐字节相同，谁最后写都无所谓。
   这仍然满足「库里只有哈希」：派生输入是旧 token 的 SHA-256，服务端不留原文，也不需要为宽限期
   新增缓存表。

2. **宽限期（60s）不再另签一份**，而是沿 `parent_id` 走到当前存活的那一份返回
   （`X-TokenTracker-Refresh: grace` 保留）。客户端手里是链中间的死 token，也能被带回活的。
   遇到「已撤销但没有 `rotated_at`」的行（登出 / `TT_AUTH_REVOKE_ON_REUSE` 的连带撤销）仍然拒绝，不复活。

3. **轮换时顺手清理 7 天前的死行**（`rotated_at` 早于 7 天），你那张 853 行的表不会再累积。

## 对你提的三点的处理

| 建议 | 处理 |
|---|---|
| ① refresh 幂等 | **采纳**，这是本次改动的核心 |
| ③ 宽限期优先复用已签出的子会话 | **采纳**（第 2 点） |
| ② 可配置宽容策略（`TT_AUTH_REFRESH_IDEMPOTENT_WINDOW` / `TT_AUTH_REFRESH_NO_ROTATE` / 会话保留天数） | **不加**。幂等之后窗口已没有调参价值，保留期也不需要运维关心；本项目刻意把环境变量控制在 21 个，一个没增 |

关于「把已签发的那一份原样再发一次」：本服务只存 refresh token 的 SHA-256（`docs/design/auth.md`），拿不回原文，所以不能用「缓存并回放明文」的做法，只能走派生——效果等价且不留明文。

## 升级注意

库结构不变（没有新的 additive step，启动自动补列的既有逻辑未动）。已有会话是同父随机 token 的兄弟行，升级后每一次刷新都会转成派生链、此后不再分裂；如果客户端手里那份旧 token 已经超过 60 秒宽限，需要重新登录一次——这一条无法避免，理由同上。

## 另外

`tokentracker-cli` v1.5.3 里 `cloud-account.js` 的 `USAGE_TO_ACCOUNT_SLUG` 只有 6 个 slug、缺 `devices`，这是**上游客户端**的问题，本仓库改不了，建议提到上游仓库。
