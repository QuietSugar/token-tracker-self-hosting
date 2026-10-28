# 接入官方客户端

这是本项目的主要用法：**正常安装官方 TokenTracker 客户端，仅将 `base_url` 指向自建服务**。

## 1. 可替代的能力范围

| 客户端行为 | 走到的端点 | 本服务 | 实测 |
|---|---|---|---|
| `tracker init` | 无网络（首次 sync 除外） | — | ✅ |
| `tracker device-login` | `device-flow-authorize` → `device-flow-poll` | ✅ | ✅ 拿到 device token |
| `tracker sync` | `tokentracker-ingest` | ✅ | ✅ `inserted=2`，重传不翻倍 |
| `tracker doctor` | 探活 `base_url` | ✅ | ✅ 12 项 OK |
| 菜单栏 / 托盘的**本机**用量视图 | 客户端自己算（本地 `localhost:7680`） | 不涉及 | ✅ |
| 跨设备汇总视图 | `/api/auth/sessions` → `/api/auth/refresh` → `account-*` | ✅ | ✅ 7500 tokens |
| 匿名遥测 | `tokentracker-telemetry` | 返回 404 | ⚪ 客户端忽略，无影响 |

**不能替代**：第三方 OAuth 登录、社区排行榜、付费 / 赠送码（自托管模式下有意不做）。

---

## 2. 硬性前提：`base_url` 只能是 HTTPS 或 localhost

该校验由**客户端自身**执行（`src/lib/runtime-config.js` → `normalizeInstanceBaseUrl()`）：

```js
if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return null;
```

- `https://任意域名` ✅ · `http://localhost:8080` ✅ · `http://127.0.0.1` ✅ · `http://[::1]` ✅
- `http://192.168.1.10:8080` ❌ → `InsForge URL must use HTTPS, or HTTP on localhost, without credentials, query or fragment.`

该校验无法在服务端修改（也不应修改 —— 不改官方客户端是本项目的硬约束）。因此局域网部署必须为其提供 `https://` 入口。

### 三种方案

| 场景 | 做法 | 成本 |
|---|---|---|
| **A. 单机自用**（服务端与客户端同机） | `--base-url http://localhost:8080`，不启用 TLS | ★ 成本最低 |
| **B. 局域网（NAS / 小主机）** | 反向代理 + 私有 CA，客户端设置 `NODE_EXTRA_CA_CERTS` | ★★ 完整命令见下文 |
| **C. 有域名** | Caddy / nginx + Let's Encrypt，`--base-url https://tt.example.com` | ★★ 证书自动签发 |

**简化方案**：SSH 端口转发，客户端仍使用 `http://localhost:8080`，完全绕过证书：

```sh
ssh -N -L 8080:nas:8080 user@nas
```

### 方案 B 的具体步骤（已实测）

```sh
# 1) 私有 CA + 服务端证书（SAN 必须写你的局域网域名/IP）
openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.pem -days 3650 -subj "/CN=TT LAN CA"
openssl req -newkey rsa:2048 -nodes -keyout srv.key -out srv.csr -subj "/CN=tt.lan"
printf "subjectAltName=DNS:tt.lan,IP:192.168.1.10\n" > san.cnf
openssl x509 -req -in srv.csr -CA ca.pem -CAkey ca.key -CAcreateserial -out srv.pem -days 3650 -extfile san.cnf
```

nginx 侧配置（`X-Forwarded-Proto` 必须透传，见 [`deploy.md`](deploy.md) §3）：

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

在每台客户端机器上：

```sh
export NODE_EXTRA_CA_CERTS=/path/to/ca.pem      # Node 用自己的 CA 库，不读系统证书
```

实测：未设置时报 `UNABLE_TO_VERIFY_LEAF_SIGNATURE`；设置后 `init` / `device-login` / `sync` 全部通过。

---

## 3. 接入：三条命令

先生成一个 anon key（公开、无权限，仅用于通过客户端的前置校验；在服务端机器上生成）：

```sh
ANON=$(./scripts/issue-token.sh --role anon --json)
```

客户端会自行校验该 key 是否为「公开 anon key」（`anon_<hex>` 形式，或携带 `role=anon` 的 JWT），
以 `ik_` 开头的服务密钥会被直接拒绝。上述命令签发的即为 `role=anon` 的 JWT，可通过该校验。

然后在那台客户端机器上：

```sh
tracker init         --base-url https://tt.lan:8443 --anon-key "$ANON"
tracker device-login --base-url https://tt.lan:8443 --anon-key "$ANON"   # 在浏览器中确认「批准」
tracker sync
```

- `--anon-key` 只需提供一次，之后客户端记录在 `~/.tokentracker/tracker/config.json`。
- `device-login` 的批准方式、`/device` 页面、手工签发 token：[`devices.md`](devices.md)。
- 客户端 `doctor` 的期望输出为 `Summary: ok 12 | fail 0`。

---

## 4. 升级客户端

自建服务是**按上游契约实现**的，所以客户端可以一直跟着上游升级；升级客户端**不需要**动服务端，
也不需要重新 `device-login`（`base_url`、`--anon-key`、device token 都留在
`~/.tokentracker/tracker/config.json` 里，升级不会清）。

### CLI

```sh
npx tokentracker-cli -v          # 临时用最新版，不落地
npm i -g tokentracker-cli@latest # 全局安装的场景
brew upgrade xiufengsun/tokentracker/tokentracker   # Homebrew（CLI）
```

### 桌面 App

- **macOS / Windows 有内置更新检查**：App 会周期性查 GitHub 的最新 release，可在设置里关掉
  （`UpdateChecker.autoUpdateEnabled`）。没等到提示就直接装覆盖即可。
- **Linux** 没有内置更新：重新下 AppImage（`chmod +x` 覆盖）或用发行版包。
- 所有平台都可以直接下载最新一版：[releases/latest](https://github.com/xiufengsun/TokenTracker/releases/latest)
  （`TokenTrackerBar.dmg` / `TokenTracker-Setup.exe` / `TokenTracker-linux-x86_64.AppImage`）。

> 桌面 App 自带一份客户端代码，与全局安装的 CLI 是两条线；只升级其中一个时版本号可能不一致，
> `tracker -v` 看的是 CLI。

### 升级后自检

```sh
tracker -v                       # 版本号
tracker doctor                   # Summary: ok 12 | fail 0
```

`doctor` 里若只有遥测（`tokentracker-telemetry`）报 404，可以忽略——自托管不做遥测，
且从本版本起**所有未实现的接口都回 404**（不会再被客户端误判成"登录失效"）。

### 服务端与客户端版本的关系

服务端不需要跟客户端版本号一致：契约基线（`contract/golden/<ver>`）锁的是**接口行为**。
上游升级时维护者跑 `./scripts/upstream.sh review`，只有 `steps()` / `privateFunctions` 变了才需要动服务端
（见 [`../maintainers/upstream.md`](../maintainers/upstream.md)）。当前后端在 1.5.0 基线上 33 PASS / 2 SKIP。

---

## 5. 跨设备汇总视图（dashboard / 菜单栏）

该视图不通过 `/functions/*`，而是先获取 access token：

```
dashboard 登录   →  POST /api/auth/sessions                     {email,password}
                     ↓ accessToken(1h) / refreshToken(90d) / csrfToken + cookie
本地 CLI relay  →  POST /api/auth/refresh?client_type=mobile    {refresh_token}（轮换）
                     ↓ accessToken
popover / 页面  →  GET  /functions/tokentracker-account-*       Authorization: Bearer …
```

前提是**已创建 owner 账户并登录**（`TT_AUTH_EMAIL` / `TT_AUTH_PASSWORD`，或首次注册）。仅查看本机用量时无需此步骤。

自检：

```sh
./scripts/check-oauth.sh          # 登录 → 轮换 → 旧 token 拒绝 → 撤销 → 读 account
```

---

## 6. 从官方云切换到自建：首次 sync 的行为

**客户端会将本地队列中的历史全部重放，但重放范围仅为「本地队列中仍然存在的记录」，不包含云端历史。**

### 5.1 客户端会主动把上传进度归零

`src/commands/init.js`：

```js
const changedInstance = normalizeInstanceBaseUrl(previousRuntime.baseUrl) !== runtime.baseUrl ||
  previousRuntime.anonKey !== runtime.anonKey;
if (changedInstance) { resetInstanceState(trackerDir); deviceToken = null; deviceId = null; }
```

`resetInstanceState`（`src/lib/runtime-config.js`）将 `queue.state.json` 写为 `{offset: 0}`，并删除 relay cookie /
cloud token / 限流状态；**`queue.jsonl` 不受影响**（append-only，已上传过的行仍保留）。

`offset` 表示「队列文件已上传到的字节位置」，`sync` 从此处向后发送 —— 归零即从文件头重放。
上游自身的数据迁移也采用同一方式：ingest 为整行 upsert，重放是幂等的。

### 5.2 重放范围

| 会被上传 | 不会被上传 |
|---|---|
| `tracker/queue.jsonl` 的半小时桶（source / model / token 数 / 时间） | `project.queue.jsonl`、`session.queue.jsonl`（按设计永不外传） |
| 队列里的 `account_session_state` 控制记录（服务端收下并忽略） | **官方云端独有的历史**：别的设备上报的、或本地日志已被工具自己清理掉的（例如 Claude Code 默认只留约 30 天 transcripts） |
| 客户端重新解析本地日志得到的桶 | 计费 / 套餐 / 结账记录（自托管没有这些表） |

因此「云端有 12 个月、切换后只剩 3 个月」属于正常现象：**仅本地队列中存在的记录才会被上传**。
云端那段数据只能从官方 dashboard 导出后经 [`importing.md`](importing.md) 导入。

### 5.3 推荐操作顺序

```sh
cp -a ~/.tokentracker ~/.tokentracker.bak        # 切换前留一份备份
export NODE_EXTRA_CA_CERTS=/path/to/ca.pem       # 局域网 https 才需要
ANON=$(./scripts/issue-token.sh --role anon --json)
tracker init --base-url https://tt.lan:8443 --anon-key "$ANON"
tracker device-login --base-url https://tt.lan:8443 --anon-key "$ANON"
tracker sync --drain                             # 反复跑，直到没有 pending
```

更换实例会清除 device token，**必须先执行 `device-login`**；缺少该步骤时 `sync` 只会打印
`Uploaded: skipped (no device token)`，易被误解为「没有数据」。

### 5.4 单次未传完的处理

每批 200 桶；普通 `tracker sync` 最多 5 批，`--drain` 最多 100 批。历史较多时重复执行，直到输出中不再出现 `Remaining: … pending`。

查看进度（`offset` 追上文件字节数即传输完毕）：

```sh
python3 -c "import json,os;p=os.path.expanduser('~/.tokentracker/tracker/queue.state.json');print('offset',json.load(open(p))['offset'])"
stat -c %s ~/.tokentracker/tracker/queue.jsonl      # macOS: stat -f %z
```

### 5.5 重放的幂等性

重放是安全的：主键为 `(user_id, device_id, hour_start, source, model)`，重复上传为**整行替换**而非累加。
实测同一队列（374 桶 / 909,911 tokens）重放两遍，总量仍为 909,911。

⚠️ 不要用其他工具将同一批数据「规整」后重新导入：服务端的键是时间戳字符串，
`2026-10-20T00:30:00.000Z`（客户端形式）与 `2026-10-20T00:30:00Z` 会被视为**两行**。
[`importing.md`](importing.md) 中的 `import-usage.py` 会将时间归整到整点，请勿用它重新导入客户端已上传过的同一批桶。

### 5.6 客户端无法重放时的兜底方案

客户端已推进 offset 但目标后端未保留数据、更换机器迁移历史、或需核对是否传输完整时，
使用 [`importing.md`](importing.md) 中的 `replay-queue.py`。

---

## 7. 验收清单

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

再打开 `http://127.0.0.1:8080/` 核对看板中的数字是否一致（[`dashboard.md`](dashboard.md)）。

---

## 8. 故障处理

参见 [`troubleshooting.md`](troubleshooting.md)。客户端侧常见问题如下：

| 症状 | 原因 | 处理 |
|---|---|---|
| `InsForge URL must use HTTPS…` | 使用局域网 IP 的明文 http | 参见 §2 三种方案 |
| `UNABLE_TO_VERIFY_LEAF_SIGNATURE` | 未将私有 CA 告知 Node | `export NODE_EXTRA_CA_CERTS=/path/to/ca.pem` |
| `Device authorization returned a different dashboard` | `verification_uri` 与 `base_url` 不同源（多为反向代理未透传 `Host` / `X-Forwarded-Proto`） | 修正反向代理；或将 `TT_DASHBOARD_URL` 设为与 `base_url` 完全一致 |
