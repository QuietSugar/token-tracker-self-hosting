# 设计：身份与认证

> 一句话：**这台机器只有一个所有者**。设备、登录、脚本签出来的 token 最终都指向同一个账户。
> 操作步骤见 [`../users/devices.md`](../users/devices.md) 与 [`../users/official-client.md`](../users/official-client.md)。

## 1. 三种凭据，一个账户

| 凭据 | 谁签发 | 用途 | 形状 |
|---|---|---|---|
| **JWT** | `scripts/issue-token.sh` 或 `/api/auth/sessions` 登录 | 所有 `/functions/*`（`ingest` 除外）、看板、脚本 | HS256，`{sub, role, iat, exp}` |
| **device token** | `tokentracker-device-token-issue` 或 device flow | 只用于 `ingest` | 随机串，库内只存 SHA-256 |
| **refresh token** | `/api/auth/sessions` / `/api/auth/refresh` | 换新的 access token | 随机串，库内只存 SHA-256，90 天 |

access token 就是第一个 —— `/api/auth/*` 签出来的 token 和 `issue-token.sh` 签出来的是同一种东西，
所以 `/functions/*` 的鉴权没有第二套逻辑。

### 1.1 为什么脚本能签 JWT

Go 后端**只验证** JWT（用 `TT_JWT_SECRET` 校验 HS256 签名），不提供"拿密码换 token"之外的身份体系。
局域网自用场景里，"服务端上能读到 secret 的人"就等于"所有者"，所以脚本签一个长期 token 是合理的。

代价必须说清：**持有 `TT_JWT_SECRET` 就能伪造任何身份**。它只能待在服务端（`chmod 600` 的环境文件）。

### 1.2 `role` 的三个值

`anon` / `authenticated` / `project_admin`（对齐上游 PostgREST 语义）。
唯一用到区分的地方是 `/api/database/rpc/*` 要求 `project_admin`；`/functions/*` 只要求 `authenticated`。
`anon` 签出来是给客户端做前置校验用的（客户端要求 config 里有个非空 key），它读不到任何数据。

## 2. owner：没有"默认账户"

历史上曾有一个写死的 UUID（`1111…`）当"默认账户"，后来设备授权又抄了一遍，起名 `TT_DEFAULT_ACCOUNT`。
它从来不是账户，只是"没有账号体系时的占位字符串"，一旦有了登录就变成第二个身份来源（设备数据在一个 id、
登录在另一个 id，跨设备汇总互相看不见）。

现在**整段删除**：没有常量、没有 `TT_DEFAULT_ACCOUNT`、没有"认领旧数据"、没有 `merge-account`。
服务假定每次部署都从空库开始。

唯一真相是 `auth_owner(slot=1, user_id, source)` 这一行：

```
1. auth_owner 已存在          → 就是它
2. 库里只有一个带密码凭据的账户 → 认它（source=credentials）
3. 都没有                     → 还没有 owner；第一个出现的身份成为 owner
                                （source=device / signup / bootstrap / first-use）
```

所以「先 `device-login` 再接前端登录」和「先登录再 `device-login`」都收敛到同一个账户；
`issue-token.sh` 先签 token 导数据、之后再用 `TT_AUTH_EMAIL`/`TT_AUTH_PASSWORD` 建账户，也会**挂到同一个账户**
而不是新建第二个。解析出 owner 之后结果稳定，不会被后续配置悄悄改掉。

`GET /api/auth/owner`（**仅回环地址可读**）暴露这个 id，给 `issue-token.sh --sub` 用：
远程机器上签 token 必须知道 sub，猜一个只会把数据写到看不见的地方。

## 3. `/api/auth/*`：为什么必须有它

官方客户端的"跨设备"数据不走 `/functions/*`，而走：

```
浏览器登录  →  POST /api/auth/sessions        → accessToken(1h) + refreshToken(90d) + csrfToken + cookie
本地 CLI    →  POST /api/auth/refresh?client_type=mobile  {refresh_token}   （轮换）
popover     →  GET  /functions/tokentracker-account-*  Authorization: Bearer <accessToken>
```

只实现最后一层是不够的：第 ② 步没有 `/api/auth/*` 就直接失败，客户端会**静默降级**成"仅本机"，
响应头里是 `X-TokenTracker-Account-View: 0`。这是补上这一层的唯一理由 —— 不是要做一个认证系统。

实现的端点：`users`（注册）、`sessions`（登录）、`refresh`（轮换）、`logout`、`sessions/current`、
`sessions`（列表）、`profiles/current`、`public-config`、`owner`。**没有**第三方 OAuth、邮件验证、找回密码。

轮换的记账方式：`auth_sessions` 每签发一份 token 一行；轮换时旧行写 `revoked_at` + `rotated_at`，
新行用 `parent_id` 指回旧行。`rotated_at` 是宽限期的唯一依据（`revoked_at` 也可能来自登出或
泄露处置，那些必须立即失效）；`parent_id` 让「拿已被换掉的旧 token 登出」能顺着链撤掉全部接替者。
代价：并发 mint 会多签几行会话（各自的 90 天有效期），`/api/auth/sessions` 列表里能看到。

### 3.1 cookie 约定（必须和客户端逐字段一致）

| cookie | HttpOnly | 为什么 |
|---|---|---|
| `insforge_refresh_token` | ✅ | 长期凭据；本地 CLI 的 cookie relay 会转存并转发 |
| `insforge_csrf_token` | ❌ | SDK 的 `getCsrfToken()` 从 `document.cookie` 读，刷新时放进 `X-CSRF-Token` |

名字带 `insforge_` 是因为客户端按这个名字找 —— 这是**兼容形状**，不是依赖 InsForge。
`Secure` 自动判定：直连看 `r.TLS`，反代看 `X-Forwarded-Proto: https`，也可用 `TT_AUTH_COOKIE_SECURE` 强制。

## 4. 安全语义与取舍

| 机制 | 做法 | 为什么这么选 |
|---|---|---|
| 密码 | PBKDF2-HMAC-SHA256，12 万轮，16 字节随机盐，`pbkdf2_sha256$120000$salt$hash` | 标准库就够，不引第三方依赖 |
| refresh token | 只存 SHA-256；轮换时旧的立即 `revoked_at` | 库被读走也拿不到可用 token |
| 重放旧 refresh token | **轮换后 60 秒内**再用仍可换一份新会话（`X-TokenTracker-Refresh: grace`）；超过宽限期 → 401 `REFRESH_TOKEN_REUSED` + `X-TokenTracker-Auth-Error: refresh_token_reused`，**不牵连其他会话** | 客户端对 refresh 没有 single-flight，webview 里多个组件并发 mint 时后到的会命中已失效的旧 token（issue #38 的真实故障：页面卡在「登录状态需要刷新」）。宽限窗口覆盖并发抖动与 relay 每 60s 的节拍；登出与被判泄露的撤销**不走**宽限。要零宽限就 `TT_AUTH_REVOKE_ON_REUSE=true` |
| CSRF | browser 模式必须带 `X-CSRF-Token` 且与该会话匹配（常量时间比较） | cookie 会随跨站请求自动带上；mobile 模式没有 cookie，免 CSRF |
| 账号枚举 | 登录失败统一 `Invalid email or password` | 不区分"不存在"与"密码错" |
| 注册 | 有 owner 后默认关闭（`TT_AUTH_ALLOW_SIGNUP=false`） | 定位是"自己部署自己用" |
| CORS | `/api/auth/*` 回显 Origin + `Allow-Credentials: true`；可用 `TT_AUTH_ALLOWED_ORIGINS` 收紧。`/functions/*` 与 `/api/selfhost/*` 固定 `*` + 各 slug 的头集合 | 本地 CLI（`127.0.0.1:7680`）与自托管域名通常不同源；带 cookie 时不能用 `*` |
| 预检 | 所有带 CORS 的入口在鉴权**之前**对 `OPTIONS` 回 204（`/api/auth/*`、`/functions/*`、`/api/selfhost/*`） | 浏览器对带 `Authorization` 的跨域请求必发预检；预检返回 401 会让真请求永远发不出去（官方桌面 GUI 直连场景就是这样挂的） |

**不做的事**：限速、爆破防护、审计日志、异地登录检测。项目定位是局域网单实例自用，
这些在公网才有价值；真暴露到公网请在前面加一层网关。

## 5. 设备授权：三模式与它的真实边界

`device-flow-authorize` → 浏览器 `/device?user_code=…` 批准 → `device-flow-poll` 拿 device token，
与官方流程同形。

| `TT_DEVICE_APPROVE` | 批准动作 | 边界 |
|---|---|---|
| `page`（默认） | 打开页面点"批准"，无需登录 | 能访问服务**且**拿到 `user_code` 的人都能接入 |
| `auto` | 无需动作，authorize 即批准 | 同上，且更宽松；**只适合完全可信的局域网** |
| `jwt` | `scripts/approve-device.sh` 或带 JWT 调 `device-flow-grant` | 保留真正的审批边界 |

`user_code` 只出现在发起申请那台机器的终端里，是这套流程唯一的凭据 —— 官方 device flow 也是同一个模型，
区别只是官方那页要求先登录 dashboard。我们要的是"流程一样"，所以 `page` 不要求登录；
安全上真实的屏障是**不把它暴露到公网**。要审批边界就用 `jwt`。

设备行有 `(user_id, machine_id)` 与 `(user_id, platform, device_name)` 两个 partial unique index，
所以同一台机器重复接入是复用设备、换新 token，不会多出一台。

**暂停 / 恢复**（`billing?action=remove-device|resume-device`）是这条链上唯一的撤销入口：
暂停把该机器的设备行与 device token 一起标 `revoked_at`（上传立刻 401），恢复把同一份还原
（原来那个 token 继续可用）。恢复时如果发现这台机器上已经有活跃设备行（暂停期间客户端重新接入过），
就保留旧行的撤销状态——partial unique index 不允许两条活跃行，也没必要复活一个已经被替换的 token。

## 6. 相关代码

`internal/app/oauth.go`（`/api/auth/*`）、`owner.go`（owner 解析）、`devices.go`（device flow 与 device token）、
`internal/app/device_page.go`（`/device` 页面）。自检：`go-server/scripts/check-oauth.sh`。
