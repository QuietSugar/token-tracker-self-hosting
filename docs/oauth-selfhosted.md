# 自托管的认证流程（与 InsForge 同流程，实现自写）

> 目的：让官方客户端/dashboard 的**登录**与**跨设备 account 视图**在自托管后端上工作。
> 之前 `docs/official-client.md` §5 列的那条缺口（`/api/auth/refresh` 未实现 → account 视图退回本机）已补上。
>
> 这里说的是**流程与报文形状**与 InsForge 对齐，代码是 Go 自己写的（不引入对方任何实现）。

---

## 1. 为什么要这一层

官方客户端的"跨设备"数据不在 `/functions/*` 里，而在这条链上：

```
菜单栏 popover / dashboard
  │  ① 浏览器登录（在本地 CLI 的 127.0.0.1:7680 上，或直接对自托管域名）
  ▼
POST /api/auth/sessions        →  accessToken(短) + refreshToken(长) + csrfToken + Set-Cookie
  │  ② 本地 CLI 的 cookie relay 把 Set-Cookie 与响应体里的 refreshToken/csrfToken 存下来
  ▼
POST /api/auth/refresh?client_type=mobile  {refresh_token}
  │  ③ 换成新的 accessToken（并把 refreshToken 轮换一次）
  ▼
GET /functions/tokentracker-account-*   Authorization: Bearer <accessToken>
```

只实现 ①③ 的下游（`/functions/*`）是不够的：第 ② 步没有 `/api/auth/*` 就直接失败，
客户端会**静默降级**成"仅本机"，响应头里是 `X-TokenTracker-Account-View: 0`。

---

## 2. 实现的端点

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/auth/users` | 注册。**只在还没有任何账户时允许**（第一个用户 = 这台机器的所有者）；之后要放开得设 `TT_AUTH_ALLOW_SIGNUP=true` |
| `POST` | `/api/auth/sessions` | 登录（`{email,password}`）→ `{accessToken,refreshToken,csrfToken,user}` + 两个 cookie |
| `POST` | `/api/auth/refresh` | browser 模式（cookie + `X-CSRF-Token`）或 mobile 模式（`?client_type=mobile` + body `{refresh_token}`），**轮换** refresh token |
| `POST` | `/api/auth/logout` | 撤销当前 refresh token + 清 cookie |
| `GET` | `/api/auth/sessions/current` | 用 access token 取当前用户 |
| `GET` | `/api/auth/sessions` | 列出该用户的会话（已登录设备页用） |
| `GET` | `/api/auth/profiles/current` | 当前用户档案（自托管恒为 `null`，客户端会容忍） |
| `GET` | `/api/auth/public-config` | `{emailSignIn,emailSignUp,passwordMinLength,oauthProviders:[],selfHosted:true}` |
| `GET` | `/api/auth/owner` | 当前 owner 账户（**仅回环地址**；脚本用它解析 `--sub`） |

**access token 就是本服务原有的 HS256 JWT**（`sub`=用户 id，`role=authenticated`），
所以 `/functions/*` 的鉴权不需要第二套逻辑 —— 官方客户端拿到的 accessToken 能直接读 `account-*`。

### cookie 约定（必须和客户端一致）

| cookie | HttpOnly | 用途 |
|---|---|---|
| `insforge_refresh_token` | ✅ | 长期凭据；本地 CLI 的 relay 会把它转存并转发 |
| `insforge_csrf_token` | ❌（JS 必须能读） | SDK 的 `getCsrfToken()` 从 `document.cookie` 读它，刷新时放进 `X-CSRF-Token` |

`Secure` 自动判定：直连看 `r.TLS`，反代看 `X-Forwarded-Proto: https`；也可用
`TT_AUTH_COOKIE_SECURE=true|false` 强制。

---

## 3. 安全语义（以及为什么这么选）

| 机制 | 行为 | 理由 |
|---|---|---|
| 密码存储 | PBKDF2-HMAC-SHA256，12 万轮，随机 16 字节盐，格式 `pbkdf2_sha256$120000$salt$hash` | 标准库即可实现，不引入外部依赖 |
| refresh token | 只存 SHA-256；90 天有效 | 库被读走也拿不到可用 token |
| 轮换 | 每次刷新签发新的 refresh token，旧的立即 `revoked_at` | 限制被截获 token 的使用窗口 |
| 重放处理 | 旧 token 再用 → **401 `REFRESH_TOKEN_REUSED`**，默认不牵连其他会话 | 并发刷新（popover + dashboard 各持一份 relay token）比"泄露"常见得多；一刀切会让用户莫名登出。需要严格处置时设 `TT_AUTH_REVOKE_ON_REUSE=true`（撤销该用户全部会话） |
| CSRF | browser 模式必须带 `X-CSRF-Token` 且与该 session 的 csrf 匹配（常量时间比较） | cookie 会随跨站请求自动带上；mobile 模式没有 cookie，所以免 CSRF |
| 账号枚举 | 登录失败统一 `Invalid email or password`（401） | 不区分"用户不存在"与"密码错" |
| 注册 | 有 owner 后默认关闭 | 定位是「自己部署自己用」，不做开放注册 |
| CORS | `/api/auth/*` 回显 Origin + `Allow-Credentials: true`（带 cookie 时不能用 `*`） | 本地 CLI(7680) 与自托管域名通常不同源。要收紧就设 `TT_AUTH_ALLOWED_ORIGINS=https://tt.lan,http://127.0.0.1:7680` |

> 仍然**没有**第三方 OAuth（GitHub/Google 登录）、邮件验证、找回密码、多租户后台。
> 自托管定位下这些是负担而不是功能；需要时再从 `/api/auth/*` 往上加。

---

## 4. 配置

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `TT_AUTH_EMAIL` / `TT_AUTH_PASSWORD` | – | 给 owner 账户设邮箱密码（幂等，**不会**覆盖已有密码；owner 已存在时挂到它身上而不是新建账户） |
| `TT_ACCESS_TOKEN_TTL` | `3600` | access token 秒数 |
| `TT_REFRESH_TOKEN_TTL` | `7776000`（90 天） | refresh token 秒数（也是 cookie Max-Age） |
| `TT_AUTH_ALLOW_SIGNUP` | `false` | 有 owner 后是否仍允许自助注册 |
| `TT_AUTH_ALLOWED_ORIGINS` | 空（回显任意 Origin） | 逗号分隔的允许来源，收紧 CORS |
| `TT_AUTH_COOKIE_SECURE` | `auto` | `auto` / `true` / `false` |
| `TT_AUTH_REVOKE_ON_REUSE` | `false` | 重放旧 refresh token 时是否撤销该用户全部会话 |

首次部署最省事的组合：

```sh
TT_AUTH_EMAIL=me@lan.test TT_AUTH_PASSWORD='至少8位' \
TT_DEVICE_APPROVE=auto \
./bin/tokentracker-server
```

启动日志会打印 `auth: created owner account me@lan.test`（密码不打印、不入库明文）。

---

## 4.5 所有者账户：没有任何"默认账户"

### 以前那个 UUID 是怎么来的（历史，已删除）

最早这一层**根本不存在**（没有 `/api/auth/*`），但设备上报总得有个 user id，于是
`scripts/issue-token.sh` 里写死了一个常量 `11111111-1111-4111-8111-111111111111`，
后来的设备授权（`TT_DEVICE_APPROVE=auto|page`）服务端又照抄了一遍，起名
`TT_DEFAULT_ACCOUNT`。它**从来不是一个账户**，只是"没有账号体系时的占位字符串"，
一旦有真正的注册/登录，就变成第二个身份来源（设备数据在一个 id、登录在另一个 id，
跨设备汇总互相看不见）。

这套东西现在**整段删除**了：没有常量、没有 `TT_DEFAULT_ACCOUNT`、没有
`TT_OWNER_ACCOUNT`、也没有"认领旧数据"和 `merge-account` 之类的迁移路径 ——
项目按"每次部署都从空库开始"设计。

### 现在的规则

`auth_owner`（`slot=1` 单例，additive migration step `auth-owner`）是唯一真相，
按下面的顺序解析一次，然后固定下来：

| 顺序 | 规则 | source |
|---|---|---|
| 1 | `auth_owner` 已有行 | 原样 |
| 2 | 库里只有一个带密码凭据的账户 | `credentials` |
| 3 | 都没有 → **第一个出现的身份**成为 owner | `device` / `signup` / `bootstrap` / `first-use` |

"第一个出现的身份"指：设备批准、`POST /api/auth/users` 注册、`TT_AUTH_EMAIL` 启动引导，
或第一次带 JWT 的请求（`scripts/issue-token.sh` 的场景）。

解析出来之后：

- 设备批准（`auto`/`page`）一律归属 owner；owner 还不存在就先建一个空账户再钉住；
- 注册 / `TT_AUTH_EMAIL` 引导**挂到已有 owner 上**（不新建账户），所以"先 device-login
  再登录"和"先登录再 device-login"都收敛到同一个账户；
- 空库启动**不会**创建任何账户（有测试盯着）；
- `scripts/issue-token.sh` 不再猜 sub：它问 `GET /api/auth/owner`（仅回环可读）；
  还没有 owner 时它会生成一个随机 id 交给服务端认领，连不上服务端则直接报错。

### 查当前 owner（仅服务器本机）

```sh
curl -s http://127.0.0.1:8080/api/auth/owner
# {"user_id":"…","email":"me@lan.test","has_credentials":true,"source":"bootstrap"}
```

## 4.6 设备维度：一个账户下多台机器怎么区分

自托管最常见的一句抱怨是"两台机器加起来的数字对吗？我只看 NAS 那台呢？"
官方 dashboard 的做法是给每个 `account-*` 端点加 `device_id` 参数，并用
`tokentracker-account-devices` 列出设备清单——这里按同一套形状实现。

### 设备清单

```sh
curl -s -H "Authorization: Bearer $ACCESS" \
  'https://tt.lan/functions/tokentracker-account-devices?from=2026-10-01&to=2026-10-31'
```

```json
{
  "from": "2026-10-01",
  "to": "2026-10-31",
  "devices": [
    {"id": "b7a55a51-…", "device_name": "MacBook", "platform": "darwin",
     "created_at": "2026-10-26T00:00:00Z", "total_tokens": 1200},
    {"id": "d220e918-…", "device_name": "nas", "platform": "linux",
     "created_at": "2026-10-26T00:00:00Z", "total_tokens": 50}
  ],
  "account_sources": []
}
```

- 只列**未撤销**的设备（`revoked_at IS NULL`），按区间内用量降序；
- 各设备之和 == `account-summary` 的总量（同一套时间窗，不会重复计数）；
- `account_sources` 是官方给"账户级来源"（cursor / trae-cn 这种只能按账户取总数、
  没有设备归属的源）留的字段。自托管的每一行用量都带 `device_id`，所以它永远是 `[]`。

### 按设备过滤

```sh
curl -s -H "Authorization: Bearer $ACCESS" \
  'https://tt.lan/functions/tokentracker-account-summary?from=2026-10-01&to=2026-10-31&device_id=b7a55a51-…'
```

支持 `device_id` 的端点：`account-summary`（含 rolling 7/30 天）、`account-daily`、
`account-hourly`、`account-monthly`、`account-heatmap`、`account-model-breakdown`，
以及 RPC `account_usage_grouped` 的 `p_device_id` / `p_device_ids`。语义与官方一致：

| 传入 | 行为 |
|---|---|
| 自己某台设备的 id | 只统计该设备 |
| 形状不是 UUID（如 `abc`） | **当没传**，返回全量 |
| 形状合法但不是自己的设备 | 空结果（过滤条件带 `user_id`，看不到别人的数据） |

### 改设备名

dashboard 的"重命名这台设备"发的是官方的 `{device_id, device_name}`：

```sh
curl -s -X POST -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
  -d '{"device_id":"b7a55a51-…","device_name":"书房的 MacBook"}' \
  https://tt.lan/functions/tokentracker-device-rename
# → {"ok":true,"device_id":"…","device_name":"书房的 MacBook"}
```

只能改自己名下**未撤销**的设备；同一平台下与另一台在用设备重名 → `409`。

---

## 5. 数据落库

走**增量迁移**（`store` 的 additive steps，见 `internal/store/schema.go`）新增两张表，
不动已发布的 core schema（否则所有已部署实例启动时 checksum drift 会 fail closed）：

```sql
auth_credentials(user_id PK → auth_users, email UNIQUE, password_hash, created_at)
auth_sessions(id PK, user_id → auth_users, token_hash UNIQUE, csrf_hash,
              client, created_at, expires_at, revoked_at)
auth_owner(slot PK CHECK slot=1, user_id UNIQUE → auth_users, source, created_at)   -- 所有者单例
```

两个 step：`{1: auth-sessions}`、`{2: auth-owner}`。
升级行为：老库启动时只跑缺的 step，账本在 `schema_additions(version,name,checksum,applied_at)`。
已发布的 step 被改动 → 启动报 checksum drift（和 core schema 同等强度的保护）。

---

## 6. 自测（不需要官方客户端）

```sh
cd go-server
BASE=http://127.0.0.1:8080

# 登录 → 拿 refresh token
REFRESH=$(curl -s -c /tmp/c.txt -X POST -H 'Content-Type: application/json' \
  -d '{"email":"me@lan.test","password":"至少8位"}' $BASE/api/auth/sessions \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["refreshToken"])')

# mobile 模式换 access token（客户端 performMint 的做法）
ACCESS=$(curl -s -X POST -H 'Content-Type: application/json' \
  -d "{\"refresh_token\":\"$REFRESH\"}" "$BASE/api/auth/refresh?client_type=mobile" \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["accessToken"])')

# 用它读跨设备汇总
curl -s -H "Authorization: Bearer $ACCESS" \
  "$BASE/functions/tokentracker-account-summary?from=2026-10-01&to=2026-10-31"
```

仓库里还有一键脚本：`./scripts/check-oauth.sh`（登录 → 刷新 → 读 account-summary → 断言字段）。

---

## 7. 用官方客户端验证（已实测）

用上游 v1.4.12 的 **真实代码路径**（`src/lib/cloud-account.js` 的 `fetchAccountUsage`）
对着自托管服务跑：

```
✓ summary: total_tokens=7500
✓ daily / hourly / monthly / heatmap / model-breakdown: 全部返回数据
轮换链: mint#1 → mint#2 OK
```

再走本地 CLI 的完整链路（`tracker serve` → dashboard 登录 → popover 读 account）：

```
POST 127.0.0.1:7680/api/auth/sessions        → 200，relay 捕获到两个 cookie
POST /functions/tokentracker-cloud-sync-pref → {"ok":true,"enabled":true}
GET  127.0.0.1:7680/functions/tokentracker-usage-summary?account=1&from=…&to=…
     → total_tokens=7500 cost=0.161000
     → X-TokenTracker-Account-View: 1     ← 走了自托管服务，不再是"仅本机"
```

---

## 8. 排错

| 症状 | 原因 | 处理 |
|---|---|---|
| account 视图仍显示本机数据 | 响应头 `X-TokenTracker-Account-View: 0`，看 `X-TokenTracker-Account-Fallback` | `signed_out`→没登录；`cloud_sync_off`→dashboard 里打开云同步；`transient-upstream`→服务端/网络 |
| 登录 401 `Invalid email or password` | 没建 owner，或密码不符 | 首次可用 `POST /api/auth/users` 注册；或用 `TT_AUTH_EMAIL/TT_AUTH_PASSWORD` 启动一次 |
| 注册 403 `SIGNUP_DISABLED` | 已有 owner | 用 owner 登录；确实需要多账户才设 `TT_AUTH_ALLOW_SIGNUP=true` |
| 刷新 403 `INVALID_CSRF_TOKEN` | 浏览器模式缺 `X-CSRF-Token`，或 cookie 与 csrf 不是一对 | 清掉 `insforge_*` cookie 重新登录；mobile 模式请带 `?client_type=mobile` |
| 刷新 401 `REFRESH_TOKEN_REUSED` | 用了已被轮换掉的旧 token（常见于手工复用同一条） | 用响应里新下发的 `refreshToken`；客户端本来就会持久化轮换 |
| 浏览器里登录成功但 CLI 不认 | 登录没走本地 CLI 的代理（要 127.0.0.1:7680） | 从本地 dashboard 登录，或把 `dashboardUrl` 指到同一实例 |
| cookie 没设上 | 通过 `http` 访问局域网 IP 且设了 `TT_AUTH_COOKIE_SECURE=true` | 用 https，或设 `TT_AUTH_COOKIE_SECURE=false` |
