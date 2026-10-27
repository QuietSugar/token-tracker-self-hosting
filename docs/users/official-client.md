# 官方客户端连上来

这是本项目的主要用法：**官方 TokenTracker 客户端照常安装，只把 `base_url` 指向你自己的服务**。

## 1. 哪些能力真的能替代

| 客户端行为 | 走到的端点 | 本服务 | 实测 |
|---|---|---|---|
| `tracker init` | 无网络（首次 sync 除外） | — | ✅ |
| `tracker device-login` | `device-flow-authorize` → `device-flow-poll` | ✅ | ✅ 拿到 device token |
| `tracker sync` | `tokentracker-ingest` | ✅ | ✅ `inserted=2`，重传不翻倍 |
| `tracker doctor` | 探活 `base_url` | ✅ | ✅ 12 项 OK |
| 菜单栏 / 托盘的**本机**用量视图 | 客户端自己算（本地 `localhost:7680`） | 不涉及 | ✅ |
| 跨设备汇总视图 | `/api/auth/sessions` → `/api/auth/refresh` → `account-*` | ✅ | ✅ 7500 tokens |
| 匿名遥测 | `tokentracker-telemetry` | 返回 404 | ⚪ 客户端忽略，无影响 |

**不能替代**：第三方 OAuth 登录、社区排行榜、付费/赠送码（自托管下有意不做）。

---

## 2. 硬性前提：`base_url` 只能是 HTTPS 或 localhost

这是**客户端自己**的校验（`src/lib/runtime-config.js` → `normalizeInstanceBaseUrl()`）：

```js
if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return null;
```

- `https://任意域名` ✅ · `http://localhost:8080` ✅ · `http://127.0.0.1` ✅ · `http://[::1]` ✅
- `http://192.168.1.10:8080` ❌ → `InsForge URL must use HTTPS, or HTTP on localhost, without credentials, query or fragment.`

这不是服务端能改的（也不该改——不改官方客户端是本项目的硬约束）。所以局域网部署必须给它一个 `https://` 入口。

### 三条出路

| 场景 | 做法 | 成本 |
|---|---|---|
| **A. 单机自用**（服务端与客户端同一台机器） | `--base-url http://localhost:8080`，不做 TLS | ★ 最低 |
| **B. 局域网（NAS / 小主机）** | 反代 + 私有 CA，客户端设 `NODE_EXTRA_CA_CERTS` | ★★ 下面给完整命令 |
| **C. 有域名** | Caddy/nginx + Let's Encrypt，`--base-url https://tt.example.com` | ★★ 证书自动 |

**懒人替代**：SSH 端口转发，客户端照样用 `http://localhost:8080`，完全绕开证书：

```sh
ssh -N -L 8080:nas:8080 user@nas
```

### B 的具体做法（已实测）

```sh
# 1) 私有 CA + 服务端证书（SAN 必须写你的局域网域名/IP）
openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.pem -days 3650 -subj "/CN=TT LAN CA"
openssl req -newkey rsa:2048 -nodes -keyout srv.key -out srv.csr -subj "/CN=tt.lan"
printf "subjectAltName=DNS:tt.lan,IP:192.168.1.10\n" > san.cnf
openssl x509 -req -in srv.csr -CA ca.pem -CAkey ca.key -CAcreateserial -out srv.pem -days 3650 -extfile san.cnf
```

nginx 侧（`X-Forwarded-Proto` 必须透传，见 [`deploy.md`](deploy.md) §3）：

```nginx
server {
  listen 8443 ssl;
  server_name tt.lan;
  ssl_certificate     /etc/tt/srv.pem;
  ssl_certificate_key /etc/tt/srv.key;
  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host:$server_port;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $remote_addr;
  }
}
```

每台客户端机器：

```sh
export NODE_EXTRA_CA_CERTS=/path/to/ca.pem      # Node 用自己的 CA 库，不读系统证书
```

实测：不设时报 `UNABLE_TO_VERIFY_LEAF_SIGNATURE`；设上之后 `init` / `device-login` / `sync` 全通。

---

## 3. 接入：三条命令

先拿一个 anon key（公开、无权限，只用来通过客户端的前置校验；在服务端机器上生成）：

```sh
ANON=$(./scripts/issue-token.sh --role anon --json)
```

然后在那台客户端机器上：

```sh
tracker init         --base-url https://tt.lan:8443 --anon-key "$ANON"
tracker device-login --base-url https://tt.lan:8443 --anon-key "$ANON"   # 浏览器点「批准」
tracker sync
```

- `--anon-key` 只需给一次，之后客户端记在 `~/.tokentracker/tracker/config.json`。
- `device-login` 的批准方式、`/device` 页面、手工签发 token：[`devices.md`](devices.md)。
- 客户端 `doctor` 期望 `Summary: ok 12 | fail 0`。

---

## 4. 跨设备汇总视图（dashboard / 菜单栏）

这条不是走 `/functions/*`，而是先要一个 access token：

```
dashboard 登录   →  POST /api/auth/sessions                     {email,password}
                     ↓ accessToken(1h) / refreshToken(90d) / csrfToken + cookie
本地 CLI relay  →  POST /api/auth/refresh?client_type=mobile    {refresh_token}（轮换）
                     ↓ accessToken
popover / 页面  →  GET  /functions/tokentracker-account-*       Authorization: Bearer …
```

前提是**建了 owner 账户并登录**（`TT_AUTH_EMAIL`/`TT_AUTH_PASSWORD`，或首次注册）。只想本机看用量的话不需要这一步。

自检：

```sh
./scripts/check-oauth.sh          # 登录 → 轮换 → 旧 token 拒绝 → 撤销 → 读 account
```

---

## 5. 从官方云切到自建：第一次 sync 会发生什么

**会把客户端本地队列里的历史全部重放过去，但重放的只是"本地队列里还有的"，不是云端的历史。**

### 5.1 客户端会主动把上传进度归零

`src/commands/init.js`：

```js
const changedInstance = normalizeInstanceBaseUrl(previousRuntime.baseUrl) !== runtime.baseUrl ||
  previousRuntime.anonKey !== runtime.anonKey;
if (changedInstance) { resetInstanceState(trackerDir); deviceToken = null; deviceId = null; }
```

`resetInstanceState`（`src/lib/runtime-config.js`）把 `queue.state.json` 写成 `{offset: 0}` 并删掉 relay cookie /
cloud token / 限流状态；**`queue.jsonl` 不动**（append-only，已上传过的行也留着）。

`offset` 是"队列文件已上传到第几个字节"，`sync` 从它往后发 —— 归零就是从文件头重放。
上游自己做数据迁移时用的也是这招：ingest 是整行 upsert，重放是幂等的。

### 5.2 重放范围

| 会被上传 | 不会被上传 |
|---|---|
| `tracker/queue.jsonl` 的半小时桶（source / model / token 数 / 时间） | `project.queue.jsonl`、`session.queue.jsonl`（按设计永不外传） |
| 队列里的 `account_session_state` 控制记录（服务端收下并忽略） | **官方云端独有的历史**：别的设备上报的、或本地日志已被工具自己清理掉的（例如 Claude Code 默认只留约 30 天 transcripts） |
| 客户端重新解析本地日志得到的桶 | 计费 / 套餐 / 结账记录（自托管没有这些表） |

所以"云端有 12 个月、切过来只剩 3 个月"是正常的：**本地队列里有才是真的有**。
云端那段只能从官方 dashboard 导出后走 [`importing.md`](importing.md)。

### 5.3 正确顺序

```sh
cp -a ~/.tokentracker ~/.tokentracker.bak        # 切之前留一份
export NODE_EXTRA_CA_CERTS=/path/to/ca.pem       # 局域网 https 才需要
ANON=$(./scripts/issue-token.sh --role anon --json)
tracker init --base-url https://tt.lan:8443 --anon-key "$ANON"
tracker device-login --base-url https://tt.lan:8443 --anon-key "$ANON"
tracker sync --drain                             # 反复跑，直到没有 pending
```

换实例会清掉 device token，**必须先 `device-login`**；少了这步 `sync` 只会打印
`Uploaded: skipped (no device token)`，看着像"没数据"。

### 5.4 一次传不完

每批 200 桶；普通 `tracker sync` 最多 5 批，`--drain` 是 100 批。历史多就多跑几次，直到输出里没有 `Remaining: … pending`。

看进度（`offset` 追上文件字节数就传完了）：

```sh
python3 -c "import json,os;p=os.path.expanduser('~/.tokentracker/tracker/queue.state.json');print('offset',json.load(open(p))['offset'])"
stat -c %s ~/.tokentracker/tracker/queue.jsonl      # macOS: stat -f %z
```

### 5.5 重放安全吗

安全：主键 `(user_id, device_id, hour_start, source, model)`，重复上传是**整行替换**不是累加。
实测同一队列（374 桶 / 909,911 tokens）重放两遍，总量仍是 909,911。

⚠️ 别用别的工具把同一批数据"规整"后再灌一遍：服务端的键是时间戳字符串，
`2026-10-20T00:30:00.000Z`（客户端形状）和 `2026-10-20T00:30:00Z` 是**两行**。
[`importing.md`](importing.md) 里的 `import-usage.py` 会归整到整点，别拿它重灌客户端已传过的同一批桶。

### 5.6 客户端不给你重放时的兜底

客户端已把 offset 推过去了但那个后端数据没留住、换机搬历史、想核对"传全没有" →
用 [`importing.md`](importing.md) 里的 `replay-queue.py`。

---

## 6. 验收清单

```sh
tracker init --base-url https://tt.lan:8443 --anon-key "$ANON"
tracker device-login --base-url https://tt.lan:8443 --anon-key "$ANON"   # 浏览器批准
tracker doctor                                                           # ok 12 | fail 0
tracker sync                                                             # Uploaded: N inserted, 0 skipped

# 在服务端核对
curl -s -H "Authorization: Bearer $(./scripts/issue-token.sh --json)" \
  'http://127.0.0.1:8080/functions/tokentracker-account-summary?from=2026-10-01&to=2026-10-31&tz=Asia/Shanghai' \
  | python3 -m json.tool | head -20
```

再打开 `http://127.0.0.1:8080/` 看看板里是不是同样的数字（[`dashboard.md`](dashboard.md)）。

---

## 7. 出问题

见 [`troubleshooting.md`](troubleshooting.md)。客户端侧的常见三条：

| 症状 | 原因 | 处理 |
|---|---|---|
| `InsForge URL must use HTTPS…` | 用了局域网 IP 的明文 http | 见 §2 三条出路 |
| `UNABLE_TO_VERIFY_LEAF_SIGNATURE` | 私有 CA 没告诉 Node | `export NODE_EXTRA_CA_CERTS=/path/to/ca.pem` |
| `Device authorization returned a different dashboard` | `verification_uri` 与 `base_url` 不同源（多为反代没透传 `Host`/`X-Forwarded-Proto`） | 修反代；或把 `TT_DASHBOARD_URL` 设成与 `base_url` 完全一致 |
