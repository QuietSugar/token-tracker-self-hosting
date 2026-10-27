# 用官方客户端连接自托管服务（替代官方云）

> 目标：**继续用官方 TokenTracker 客户端**（CLI、菜单栏 App、托盘），只把它上报/同步的
> 后端换成本仓库的 Go 服务。官方云开始收费后，这条路让你保持"数据在自己手里"。
>
> 验证基准：上游 `xiufengsun/TokenTracker` **v1.4.12**（commit `8d32a95`），
> 与本服务端逐条实测，结论在 §1 与 §5。上游源码只读，本仓库不改客户端。

---

## 1. 结论先看（实测）

| 客户端行为 | 走到的端点 | 本服务 | 实测 |
|---|---|---|---|
| `tracker init` | 无网络（首次 sync 除外） | — | ✅ |
| `tracker device-login` | `POST /functions/tokentracker-device-flow-authorize`<br>`POST /functions/tokentracker-device-flow-poll` | ✅ | ✅ 拿到 device token |
| `tracker sync` | `POST /functions/tokentracker-ingest` | ✅ | ✅ `inserted=2`，重传仍 7500 tokens |
| `tracker doctor` | 探活 `base_url` | ✅ | ✅ 12 项 OK |
| 菜单栏/托盘**本机**视图 | 本地 CLI 的 `localhost:7680` | 不涉及 | ✅ |
| 跨设备汇总（account 视图） | `/api/auth/sessions` → `/api/auth/refresh` → `account-*` | ✅ | ✅ `X-TokenTracker-Account-View: 1`，7500 tokens |
| 匿名遥测 | `POST /functions/tokentracker-telemetry` | 404 | ⚪ 客户端忽略 |

**能替代的部分**：设备接入 + 用量上传 + 数据留存（这就是"官方云收费"真正卡住的地方），
以及 dashboard / 菜单栏的**跨设备聚合视图**——本服务自建了同流程的 `/api/auth/*`，见 §5。

**不能替代的部分**：第三方 OAuth 登录、社区排行榜、付费/赠送码（自托管下这些有意不做）。

---

## 2. 客户端的硬性限制：`base_url` 只能是 HTTPS 或 localhost

源码位置：`src/lib/runtime-config.js` → `normalizeInstanceBaseUrl()`。

```js
if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return null;
```

也就是：

- `https://任意域名` ✅
- `http://localhost:8080`、`http://127.0.0.1:8080`、`http://[::1]:8080` ✅
- `http://192.168.1.10:8080` ❌ → 客户端直接抛
  `InsForge URL must use HTTPS, or HTTP on localhost, without credentials, query or fragment.`

> 这不是本服务端的问题，是客户端**自己**的校验，改不了（也不该改——用户说"尽量少改主体程序"）。
> 所以局域网部署必须给它一个 `https://` 入口。

### 三条出路

| 场景 | 做法 | 成本 |
|---|---|---|
| **A. 单机自用**（服务端与客户端同一台机器） | `--base-url http://localhost:8080`，不做任何 TLS | ★ 最低 |
| **B. 局域网（NAS/小主机）** | 反代 + 私有 CA，客户端设 `NODE_EXTRA_CA_CERTS` | ★★（下面给完整命令，已实测） |
| **C. 有公网域名** | Caddy/nginx + Let's Encrypt，`--base-url https://tt.example.com` | ★★（证书自动） |

### B 的具体做法（已实测通过）

1. 生成 CA 与服务端证书（`tt.lan` 换成你的局域网域名/IP，必须写进 SAN）：

```sh
openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.pem -days 3650 -subj "/CN=TT LAN CA"
openssl req -newkey rsa:2048 -nodes -keyout srv.key -out srv.csr -subj "/CN=tt.lan"
printf "subjectAltName=DNS:tt.lan,IP:192.168.1.10\n" > san.cnf
openssl x509 -req -in srv.csr -CA ca.pem -CAkey ca.key -CAcreateserial -out srv.pem -days 3650 -extfile san.cnf
```

2. 反代（Caddy 用内部 CA 更省事；nginx 示例）：

```nginx
server {
  listen 8443 ssl;
  server_name tt.lan;
  ssl_certificate     /etc/tt/srv.pem;
  ssl_certificate_key /etc/tt/srv.key;
  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host:$server_port;
    proxy_set_header X-Forwarded-Proto https;   # ← 必须，否则服务端推导出的 origin 是 http
    proxy_set_header X-Forwarded-For $remote_addr;
  }
}
```

3. 每台客户端机器：

```sh
export NODE_EXTRA_CA_CERTS=/path/to/ca.pem     # Node 自带 CA 库，不读系统证书
tracker init --base-url https://tt.lan:8443 --anon-key "$ANON"
```

实测（Node 22 + 官方 CLI）：不设 `NODE_EXTRA_CA_CERTS` 时 `fetch` 报
`UNABLE_TO_VERIFY_LEAF_SIGNATURE`；设上之后 init / device-login / sync 全部通过。

> 懒人替代方案：把服务端绑在客户端所在机器（`127.0.0.1:8080`），或用 SSH 端口转发
> `ssh -N -L 8080:nas:8080 user@nas`，客户端就用 `http://localhost:8080` —— 完全绕开证书。

---

## 3. `--anon-key` 是什么，为什么必须要

客户端对**自定义** `base_url` 强制要求一个"公开 anon key"（源码 `isPublicAnonKey()`）：
要么是 payload 里 `role=anon` 的 JWT，要么是 `anon_<40|64 hex>`。它只用两个地方：

- 作为 `apikey` 请求头附带（本服务端**忽略**它，不做任何鉴权）；
- 防止你把管理员密钥塞进客户端。

所以随便签一个 `role=anon` 的 JWT 就行：

```sh
ANON=$(./go-server/scripts/issue-token.sh --role anon --json)
```

第一次用 `--anon-key` 之后，客户端会把它写进 `~/.tokentracker/tracker/config.json`，后续命令不用再传。

---

## 4. 设备授权怎么被批准（三选一）

官方流程是"客户端申请 → 你在 dashboard 点批准"。自托管没有 dashboard，所以服务端提供三种模式，
用 `TT_DEVICE_APPROVE` 选：

| 模式 | 行为 | 适合 |
|---|---|---|
| `auto`（**推荐**） | `authorize` 立刻批准到 **owner 账户**（没有就先建一个空的并钉住），客户端第一轮 poll 就拿到 token | 家里/局域网自用，没人想点按钮 |
| `page` | 客户端打印 `http(s)://<host>/device?user_code=…`，打开点"批准" | 想让"批准"仍然是个动作 |
| `jwt`（默认） | `POST /functions/tokentracker-device-flow-grant` 带 JWT，或用 `scripts/approve-device.sh` | 想保留审批边界 |

```sh
# auto
TT_DEVICE_APPROVE=auto ./bin/tokentracker-server

# page：浏览器打开客户端打印的 URL，或
open "https://tt.lan:8443/device"      # 输入 ABCD-EFGH 点批准

# jwt：
./scripts/approve-device.sh ABCD-EFGH --base https://tt.lan:8443
```

> ⚠️ `auto` 与 `page` **都等于"任何能访问本服务的人都能接入这台机器的 owner 账户"**。
> 这是"局域网自用、不开放自助注册"定位下的有意取舍；**不要**把带这两个模式的实例暴露到公网。
> 需要收紧时改用默认的 `TT_DEVICE_APPROVE=jwt`：批准请求必须带有效 JWT（owner 登录拿到的
> access token，或你用 `scripts/issue-token.sh` 自签的 token），没有凭据的人拿不到 device token。

服务端会把 device token 绑到 `machine_id`（客户端用它自己的机器指纹上报），
同一台机器重复 `device-login` 会**复用同一台设备行、发新 token**，不会积累重复设备。

**设备归属谁？** 一律归属这台机器的 **owner 账户** —— 也就是你之后登录/注册的那个账户，
不再是过去那个写死的 UUID。先 `device-login` 还是先登录都行，最终是同一个账户
（规则与迁移见 [`oauth-selfhosted.md`](oauth-selfhosted.md) §4.5）。

---

## 5. 跨设备汇总视图（已经能用了）

菜单栏 App 的 "account / 跨设备" 视图走的是另一条链：

```
popover → 本地 CLI(127.0.0.1:7680) → 用登录留下的 refresh token
                                  → POST {base_url}/api/auth/refresh?client_type=mobile
                                  → GET  {base_url}/functions/tokentracker-account-*
```

**这一层现在已实现**（流程与 InsForge 一致，代码是 Go 自己写的，详见
[`oauth-selfhosted.md`](oauth-selfhosted.md)）：

1. 在 dashboard（或本地 CLI 上的登录框）用邮箱密码登录：`POST /api/auth/sessions`；
2. 本地 CLI 的 cookie relay 自动捕获 `insforge_refresh_token` / `insforge_csrf_token`；
3. popover 读 `?account=1` → 本地 CLI 铸 access token（`/api/auth/refresh?client_type=mobile`）
   → 打 `account-*` → 响应头 `X-TokenTracker-Account-View: 1`，数据来自你的服务器。

实测（官方 v1.4.12 的真实模块，两种方式都验过）：

```
cloud-account.fetchAccountUsage 直接调用:
  ✓ summary: total_tokens=7500
  ✓ daily / hourly / monthly / heatmap / model-breakdown 全部返回数据
  ✓ 轮换链 mint#1 → mint#2 OK

走本地 CLI 的完整链路:
  POST 127.0.0.1:7680/api/auth/sessions         → 200，relay 捕获两个 cookie
  POST /functions/tokentracker-cloud-sync-pref  → {"ok":true,"enabled":true}
  GET  /functions/tokentracker-usage-summary?account=1&from=…&to=…
       → total_tokens=7500 cost=0.161000
       → X-TokenTracker-Account-View: 1
```

前提条件（缺一就会静默降级回本机视图，响应头 `X-TokenTracker-Account-View: 0`）：

- 服务端建好了 owner 账户：`TT_AUTH_EMAIL` + `TT_AUTH_PASSWORD` 启动一次，或首次
  `POST /api/auth/users` 注册；
- 你在 dashboard 里**打开云同步**（`cloud-sync-pref = true`），这是客户端自己的偏好；
- 登录发生在**本地 CLI 的页面**（127.0.0.1:7680）上，否则 relay 拿不到 cookie。

### 多台设备的区分（device 维度）

一个账户下挂了几台机器时，dashboard 的设备下拉框/设备卡片走的是
`GET /functions/tokentracker-account-devices`，并给其它 `account-*` 请求带上
`&device_id=<id>`。这两个行为都已按官方形状实现（见 [`oauth-selfhosted.md`](oauth-selfhosted.md) §4.6）：

```
GET /functions/tokentracker-account-devices?from=…&to=…
→ {"devices":[{"id":"b7a5…","device_name":"MacBook","platform":"darwin",
               "created_at":"…","total_tokens":1200}, …],"account_sources":[]}

GET /functions/tokentracker-account-summary?from=…&to=…&device_id=b7a5…
→ 只统计这台设备（summary/daily/hourly/monthly/heatmap/model-breakdown 都支持）
```

"重命名设备"用官方的 `{device_id, device_name}`，重名返回 409。

仍然没有的：第三方 OAuth 登录、邮件验证/找回密码、多账户后台（见 oauth-selfhosted.md §3）。

## 6. 端到端验收清单（可照抄）

```sh
# ── 服务端（NAS 示例，PG + 局域网 https）────────────────────────────
export TT_JWT_SECRET="$(openssl rand -hex 32)"        # 存好，客户端/脚本都要用
export TT_DATABASE_URL='postgres://tt:pw@127.0.0.1:5432/tt?sslmode=disable'
export TT_LISTEN_ADDR=127.0.0.1:8080
export TT_DEVICE_APPROVE=auto
./bin/tokentracker-server

# ── 客户端机器 ────────────────────────────────────────────────────
export NODE_EXTRA_CA_CERTS=/path/to/ca.pem
ANON=$(./scripts/issue-token.sh --role anon --json)   # 在服务端机器上生成
tracker init --base-url https://tt.lan:8443 --anon-key "$ANON"
tracker device-login --base-url https://tt.lan:8443 --anon-key "$ANON"
tracker doctor                                        # 期望 Summary: ok 12 | fail 0
tracker sync                                          # 期望 Uploaded: N inserted, 0 skipped

# ── 在服务端核对数据真的到了 ──────────────────────────────────────
curl -s -H "Authorization: Bearer $(./scripts/issue-token.sh --json)" \
  'http://127.0.0.1:8080/functions/tokentracker-account-summary?from=2026-10-01&to=2026-10-31' \
  | python3 -m json.tool | head -20
```

实测记录（本仓库 CI 之外的手工验证，2026-10-27）：

```
init            → Setup complete!
device-login    → Approved. device token written to ~/.tokentracker/tracker/config.json   （零交互，auto 模式）
sync            → Uploaded: 2 inserted, 0 skipped
account-summary → total_tokens= 7500
重传同一批       → 仍 7500（按 (user,device,hour,source,model) 整行替换）
客户端实际请求   → device-flow-authorize / device-flow-poll / ingest / telemetry(404) / account-summary
```

---

## 7. 排错

| 症状 | 原因 | 处理 |
|---|---|---|
| `Device authorization returned a different dashboard` | 服务端返回的 `verification_uri` 与客户端 `dashboardUrl` 不同源 | 留空 `TT_DASHBOARD_URL`（按请求推导，默认行为），并让反代传 `Host` + `X-Forwarded-Proto`；或显式设成与客户端 `base_url` 一模一样 |
| `InsForge URL must use HTTPS, or HTTP on localhost` | 用了局域网 IP + 明文 HTTP | 按 §2 上 https，或改用 `localhost` |
| `UNABLE_TO_VERIFY_LEAF_SIGNATURE` / `self-signed certificate` | Node 不信任你的私有 CA | `export NODE_EXTRA_CA_CERTS=/path/to/ca.pem`（不是系统证书） |
| `A custom InsForge URL requires its own public anon key` | 没给 `--anon-key` | `--anon-key "$(./scripts/issue-token.sh --role anon --json)"` |
| `tracker doctor` 里 `network.base_url` 显示 404 | 根路径没有路由，属正常 | 忽略；只会显示 `HTTP 404 (reachable)` |
| `sync` 报 401 / `CLOUD_DEVICE_TOKEN_REJECTED` | 服务端换了 `TT_JWT_SECRET` 或换了实例 | 重新 `tracker device-login` |
| account 视图还是本机数据 | 响应头 `X-TokenTracker-Account-View: 0`，看 `X-TokenTracker-Account-Fallback` | `signed_out`→先登录（`TT_AUTH_EMAIL/PASSWORD` 或注册）；`cloud_sync_off`→dashboard 打开云同步；`transient-upstream`→看服务端日志 |
| `device-login` 一直 pending | 模式是 `page`/`jwt`，还没人批准 | 批准一次，或改 `TT_DEVICE_APPROVE=auto` |
