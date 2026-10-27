# TokenTracker Go 自托管后端 — 部署与运维手册

> **状态：experimental（实验性）。** 请先读 [STATUS.md](STATUS.md) 的「仍然缺什么」再决定是否接真实用户。
> 本文只讲**怎么把它跑起来、备份、升级、排错**；设计与取舍见 [../docs/go-postgres.md](../docs/go-postgres.md)。

---

## 0. 定位：局域网自用

这个后端的目标场景是**自己部署在局域网、自己用**：一台 mini PC / NAS / 树莓派，
单实例、几个自己的设备往上传统计数据。因此：

- **不做注册/登录**。没有 signup / signin / OAuth / 找回密码——这是**设计选择，不是缺口**。
  服务只**验证** JWT（HS256，密钥 `TT_JWT_SECRET`），token 用附带的脚本自己签（见 §1.0）。
- **不做多租户隔离**。你签出来的 token 归一个固定 `sub`，所有设备都属于这个账户。
- **不假设有公网入口**。默认只监听 `127.0.0.1` / 局域网地址，不要求域名、证书、反向代理。
- **不做计费**。付费/试用 RPC 明确拒绝，自托管策略固定为免费可用。

| | |
|---|---|
| ✅ 是 | 独立的 Go HTTP 服务，实现 TokenTracker v1.4.12 的 14 个私有函数核心路径：设备 token、用量上传（整行修正/幂等）、账户 summary/daily/hourly/monthly/heatmap/model-breakdown/devices、自托管免费策略、billing catalog。 |
| ✅ 是 | 同一份二进制、同一个镜像，**两种数据库**：PostgreSQL（推荐）或 SQLite（零依赖单文件）。 |
| ❌ 不是 | 公网多用户服务，也不是 InsForge + PostgREST 的替代品（不提供 InsForge SDK 兼容 API）。 |
| ❌ 不是 | 生产 GA。没有速率限制、审计日志、多副本锁；见 [STATUS.md](STATUS.md)。 |

> 将来若要接正式认证（账号体系 / 多用户），改动点是明确的：在 `Server.auth()`
> 与 ingest 的 device token 校验处接入即可，本仓库不预留死配置项，避免增加维护面。
> 现在不加，是因为局域网自用加认证只会带来额外摩擦。

---

## 1. 60 秒快速开始

### 1.0 先拿到 token（没有登录，用脚本签）

服务只验证 JWT，所以第一次使用只需要签一个 token：

```sh
export TT_JWT_SECRET="$(openssl rand -hex 32)"   # 与服务端必须完全一致，≥32 字节

cd go-server
./scripts/issue-token.sh                          # 打印 token + curl 示例（默认 365 天）
./scripts/issue-token.sh --json                   # 只输出 token，方便脚本取值
./scripts/issue-token.sh --role project_admin     # 需要调 /api/database/rpc/* 时
```

- 默认 `sub` 是固定的 `11111111-1111-4111-8111-111111111111`，**首次使用会自动建账户行**，
  所以不需要任何注册步骤；也可以 `--sub <你自己编的 UUID>` 换一个。
- token 等于该账户的全部读写权限：别提交到 git、别贴到聊天里。
- 轮换：换掉 `TT_JWT_SECRET` 并重启服务，旧 token 立即全部失效。
- 这个脚本不参与服务端逻辑，将来接入正式认证后可以直接弃用。

拿到 token 后的完整最小流程（局域网内、服务已启动）：

```sh
TOKEN=$(./scripts/issue-token.sh --json)

# 1) 换设备 token（上传用量用它，不是 JWT；首次会自动建账户）
DEV=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"device_name":"desktop","platform":"linux","machine_id":"m-local"}' \
  http://127.0.0.1:8080/functions/tokentracker-device-token-issue)
DTOK=$(echo "$DEV" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')

# 2) 上传一个小时的用量
curl -s -X POST -H "Authorization: Bearer $DTOK" -H 'Content-Type: application/json' \
  -d '{"buckets":[{"hour_start":"2026-10-20T10:00:00Z","source":"codex","model":"gpt-6",
       "input_tokens":1234,"total_tokens":1234,"billable_total_tokens":1234,"conversation_count":1}]}' \
  http://127.0.0.1:8080/functions/tokentracker-ingest

# 3) 读回来
curl -s -H "Authorization: Bearer $TOKEN" \
  'http://127.0.0.1:8080/functions/tokentracker-account-summary?from=2026-10-20&to=2026-10-20'
```

### 1.1 Docker Compose + PostgreSQL（推荐）

```sh
git clone https://github.com/QuietSugar/token-tracker-self-hosting.git
cd token-tracker-self-hosting/go-server

export POSTGRES_PASSWORD="$(openssl rand -hex 24)"
export TT_JWT_SECRET="$(openssl rand -hex 32)"     # ≥32 字节；签 token 时用同一个值
export TT_DASHBOARD_URL="http://192.168.1.10:8080"  # 设备授权页地址，仅网页授权流程才用到

docker compose -f docker-compose.postgres-go.example.yml up -d
curl -fsS http://127.0.0.1:8080/health && echo OK
docker compose -f docker-compose.postgres-go.example.yml logs -f tokentracker-go
# 期望日志：TokenTracker Go server listening on 0.0.0.0:8080 (engine=postgres, dsn=postgres://tokentracker:***@tokentracker-postgres:5432/tokentracker?sslmode=disable)
```

### 1.2 Docker Compose + SQLite（单机零依赖）

```sh
export TT_JWT_SECRET="$(openssl rand -hex 32)"
export TT_DASHBOARD_URL="https://你的-dashboard-域名"
docker compose -f docker-compose.sqlite-go.example.yml up -d
curl -fsS http://127.0.0.1:8080/health && echo OK
docker compose -f docker-compose.sqlite-go.example.yml logs | grep engine=sqlite
```

### 1.3 直接跑二进制（不用 Docker）

```sh
cd go-server
CGO_ENABLED=0 go build -trimpath -o bin/tokentracker-server ./cmd/server

# SQLite
TT_JWT_SECRET=$(openssl rand -hex 32) \
TT_DATABASE_PATH=/var/lib/tokentracker/tokentracker.db \
TT_LISTEN_ADDR=127.0.0.1:8080 \
./bin/tokentracker-server

# PostgreSQL
TT_JWT_SECRET=$(openssl rand -hex 32) \
TT_DATABASE_URL='postgres://tokentracker:密码@127.0.0.1:5432/tokentracker?sslmode=disable' \
TT_LISTEN_ADDR=127.0.0.1:8080 \
./bin/tokentracker-server
```

二进制是 `CGO=0` 静态链接，任何 Linux/amd64、linux/arm64 主机可直接运行，无需 SQLite 库。

### 1.4 用已发布的镜像（推荐）

```sh
docker pull ghcr.io/quietsugar/token-tracker-self-hosting-go:experimental
# 固定到某个提交更安全（tag 见构建 run 的 job summary）：
docker pull ghcr.io/quietsugar/token-tracker-self-hosting-go:experimental-<short_sha>
```

- 同一镜像也以旧名发布，兼容早期 compose：
  `ghcr.io/quietsugar/token-tracker-self-hosting-sqlite-go:experimental`。
- 平台：`linux/amd64` + `linux/arm64`（arm64 仅由 CI 构建，未在真机验收）。
- 不发布 `latest`：实验镜像不应成为隐式默认，请显式 pin `experimental-<sha>`。
- **首次使用**：GHCR 包默认 private，需要在 GitHub「Packages → token-tracker-self-hosting-go →
  Package settings → Change visibility → Public」改为公开，否则 `docker pull` 会 401。私有也可以，
  但要先 `docker login ghcr.io -u <你的账号> -p <PAT with read:packages>`。
- 验证来源（SLSA provenance，CI 推送时生成）：

  ```sh
  gh attestation verify oci://ghcr.io/quietsugar/token-tracker-self-hosting-go:experimental \
    --repo QuietSugar/token-tracker-self-hosting
  ```

每次镜像构建都会在推送**之前**跑容器 smoke：SQLite 模式（health、`/_test/sql` 404、uid 10001、
DB/WAL/SHM 0600、优雅停服后数据落盘、重启后无 checksum drift、弱 secret 拒绝启动）与
PostgreSQL 模式（连真实 PG 建 schema、health 200、日志脱敏、`/_test/sql` 404）。smoke 不通过不会产生 tag。

---

## 2. 配置参考

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `TT_JWT_SECRET` | **必填** | HS256 密钥，**≥32 字节**，否则拒绝启动。必须与你签发 JWT 的认证层一致。 |
| `TT_DATABASE_URL` | – | `postgres://…`（或 `postgresql://`、lib/pq 的 `host=… user=…` 形式）→ PostgreSQL；其他值 → SQLite 文件路径。**优先级最高**。 |
| `TT_DATABASE_PATH` | `tokentracker.db` | 仅 SQLite 文件路径（旧变量，保留兼容）。与 `TT_DATABASE_URL` 同时设置时后者生效并打警告。 |
| `TT_DATABASE_DRIVER` | 按 DSN 推断 | `sqlite` / `postgres`。一般不用设。 |
| `TT_POSTGRES_SCHEMA` | 默认 search_path | 仅 PG：把表放进指定 schema（多实例共用一个库、或测试隔离）。启动时 `CREATE SCHEMA IF NOT EXISTS`。 |
| `TT_POSTGRES_SCHEMA_EPHEMERAL` | `false` | 仅 PG：进程退出时 `DROP SCHEMA … CASCADE`。**只用于测试，别在生产开。** |
| `TT_LISTEN_ADDR` | `127.0.0.1:8080` | 监听地址。容器里用 `0.0.0.0:8080`。 |
| `TT_DASHBOARD_URL` | 空 = 按请求推导 | 设备授权返回的 `verification_uri` / `verification_uri_complete` 前缀。**留空时**用 `X-Forwarded-Proto` + `Host` 推导（推荐，官方客户端要求它与客户端 `base_url` 同源）。 |
| `TT_DEVICE_APPROVE` | `jwt` | 设备授权怎么被批准：`jwt`（POST `device-flow-grant` 带 JWT）/ `page`（访问 `/device` 点按钮，无认证）/ `auto`（申请即批准，官方客户端 `device-login` 零交互）。详见 [`../docs/official-client.md`](../docs/official-client.md)。 |
| `TT_DEFAULT_ACCOUNT` | `11111111-1111-4111-8111-111111111111` | `page` / `auto` 批准时归属的账户 sub（与 `scripts/issue-token.sh` 默认值一致）。 |
| `TT_AUTH_EMAIL` / `TT_AUTH_PASSWORD` | – | 启动时若库里还没有账户，用它创建 owner（幂等，不覆盖已有密码）。官方客户端/dashboard 的登录框就用这一组。 |
| `TT_ACCESS_TOKEN_TTL` | `3600` | access token（HS256 JWT）有效期，秒。 |
| `TT_REFRESH_TOKEN_TTL` | `7776000` | refresh token 有效期（90 天），也是 cookie Max-Age。 |
| `TT_AUTH_ALLOW_SIGNUP` | `false` | 已有 owner 后是否还允许 `POST /api/auth/users` 自助注册。 |
| `TT_AUTH_ALLOWED_ORIGINS` | 空 = 回显任意 Origin | `/api/auth/*` 允许的跨域来源（逗号分隔）。带 cookie 的跨域不能用 `*`。 |
| `TT_AUTH_COOKIE_SECURE` | `auto` | cookie 的 `Secure`：`auto`（直连看 TLS、反代看 `X-Forwarded-Proto`）/ `true` / `false`。 |
| `TT_AUTH_REVOKE_ON_REUSE` | `false` | 旧 refresh token 被重放时是否撤销该用户全部会话（默认只拒绝，避免并发刷新误伤）。 |
| `TT_NOW` | 真实时间 | 冻结时钟（RFC3339）。**仅测试**用。 |
| `TT_ENABLE_TEST_ENDPOINTS` | `false` | 打开 `/_test/*`（含**可执行任意 SQL** 的 `/_test/sql`）。**生产必须保持 false。** |

### 2.1 JWT 约定

- 算法 HS256，header `{"alg":"HS256"}`，payload 至少含 `sub`（用户 UUID）、`role`、`exp`。
- `role="project_admin"` 才允许调用 `/api/database/rpc/*`（服务端角色）。
- `role="authenticated"` 用于普通账户与设备操作。
- 过期、签名不符、结构错误 → 401。
- 设备侧上传用量用 **device token**（不是 JWT），由 `tokentracker-device-token-issue` 或设备授权流程签发，服务端只存 SHA-256。

### 2.2 PostgreSQL 连接串要点

```text
postgres://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require
```
- 容器内网 / 本机：`sslmode=disable`；云托管（RDS/Neon/Cloud SQL）：`sslmode=verify-full` 更安全。
- 服务默认池：16 连接（`MaxOpenConns`），`ConnMaxLifetime=30m`。
- 启动时最多等 30 秒数据库就绪（compose 里第一次启动不会因为 PG 慢而崩）。
- 需要的最少权限：目标 schema 上 `CREATE`（首次安装建表），之后 `SELECT/INSERT/UPDATE/DELETE`。
  **不需要** superuser，不需要扩展（不用 `pgcrypto`/`uuid-ossp`，ID 由 Go 生成）。

---

## 3. 反向代理与 TLS

服务本身**不做 TLS**。请把 `TT_LISTEN_ADDR=127.0.0.1:8080`（或 compose 里 `127.0.0.1:8080:8080`）只绑本机，前面放反向代理。

**Caddy（自动 HTTPS，最省事）**

```caddyfile
api.your-domain.example {
    reverse_proxy 127.0.0.1:8080
    encode gzip
}
```

**nginx**

```nginx
server {
    listen 443 ssl http2;
    server_name api.your-domain.example;
    ssl_certificate     /etc/letsencrypt/live/api.your-domain.example/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.your-domain.example/privkey.pem;

    client_max_body_size 2m;   # 上传上限：单次最多 1 MiB body / 500 个 bucket
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 30s;
    }
}
```

**不要**把 `/_test/*` 暴露到公网：生产环境 `TT_ENABLE_TEST_ENDPOINTS` 必须未设置/false，
即使误开，也建议在反代层直接 `location ~ ^/_test { return 404; }`。

**CORS**：服务对所有 `/functions/*` 返回 `Access-Control-Allow-Origin: *`（与参考实现一致）。
如果你要限制来源，请在反代层改写该响应头。

---

## 3.5 把已有用量数据导进来（`import-usage.py`）

服务端只提供「按小时桶」的上传接口，不做客户端适配。**如果你不是用官方客户端自动上报**，
而是本地已经有导出好的用量（CSV / JSONL / 客户端历史），用这个脚本导入。

### 3.5.1 三步导入

```sh
cd go-server

# 1) 先空跑，检查列映射和时间解析对不对（不发任何请求）
./scripts/import-usage.py --base http://192.168.1.10:8080 \
  --jwt "$(./scripts/issue-token.sh --json)" \
  --device-name nas --input ~/usage.csv --dry-run

# 2) 真导
./scripts/import-usage.py --base http://192.168.1.10:8080 \
  --jwt "$(./scripts/issue-token.sh --json)" \
  --device-name nas --input ~/usage.csv

# 3) 核对
curl -s -H "Authorization: Bearer $(./scripts/issue-token.sh --json)" \
  'http://192.168.1.10:8080/functions/tokentracker-account-summary?from=2026-10-01&to=2026-10-31'
```

已经拿到 device token 的话可以跳过 JWT，直接 `--device-token "$DTOK"`。

### 3.5.2 支持什么输入

| 格式 | 说明 |
|---|---|
| CSV / TSV | 第一行是表头；列名支持别名（见下表），大小写/下划线/空格不敏感 |
| JSONL / NDJSON | 每行一个对象，键名同 API 或别名 |
| JSON | 一个数组；也接受 `{"buckets":[...]}`、`{"data":[...]}` 之类的包裹 |

列名别名（任一出现即可）：

| API 字段 | 可用列名 |
|---|---|
| `hour_start` | `timestamp` `time` `datetime` `date` `hour` `hour_bucket` `ts` |
| `source` | `provider` `tool` `app` `client` `agent` |
| `model` | `model_name` |
| `input_tokens` | `input` `prompt_tokens` `prompt` |
| `output_tokens` | `output` `completion_tokens` `completion` |
| `cached_input_tokens` | `cached_tokens` `cache_read_tokens` `cached` |
| `cache_creation_input_tokens` | `cache_write_tokens` |
| `reasoning_output_tokens` | `reasoning_tokens` `reasoning` |
| `total_tokens` | `total` `tokens` |
| `billable_total_tokens` | `billable` `billable_tokens` |
| `total_cost_usd` | `cost_usd` `cost` `usd`（可带 `$`） |
| `conversation_count` | `conversations` `sessions` `requests` `request_count` |

示例 CSV（这份就是脚本自测用的输入）：

```csv
timestamp,provider,model,prompt_tokens,completion_tokens,cached_tokens,reasoning,cost
2026-10-18 09:15:00,codex,gpt-6,12000,3400,8000,0,0.42
2026-10-18T23:30:00+08:00,claude,sonnet-4,5000,900,0,0,0.12
```

### 3.5.3 会对数据做什么

- **时间归一化**：各种写法（带时区偏移、`2026-10-18 09:15`、epoch 秒/毫秒）统一转成
  **UTC 整点**（`2026-10-18T09:00:00Z`）。服务端按字符串比较时间，非 UTC 会导致汇总查不到，
  这一步由脚本保证。
- **缺字段兜底**：`total_tokens` 缺失时按 `input+output+reasoning+cache_creation` 计算；
  `billable_total_tokens` 留 0（服务端按 total 处理）；`source`/`model` 缺失给默认值并在统计里体现。
- **按主键去重**：主键是 `(user, device, hour_start, source, model)`。同一批里重复的只保留最后一条；
  与库里已有行重复时**整行替换**，所以**脚本可以反复重跑，不会重复计数**。
- **自动分批**：每批默认 200 条（可 `--batch`，上限 500），并按 ≤512KB 切分，符合服务端限制。
- **失败重试**：网络/5xx 自动退避重试 4 次；401/400/413 立即报错退出。

### 3.5.4 设备与 token

- `--jwt` 模式会自动申请 device token，并缓存到
  `~/.cache/token-tracker/device-tokens.json`（权限 0600，按 `服务地址+设备名` 索引），
  所以**重跑不会因为「同名设备已存在」而失败**；`--no-cache` 可禁用，`--token-cache` 可改路径。
- 默认 `machine_id = import-<设备名>`；一台机器建议固定用一个 `--device-name`（如 `nas`、`desktop`）。
- 多个来源机（如 NAS + 笔记本）用不同 `--device-name`，汇总时都会归到同一个账户。

### 3.5.5 常见报错

| 报错 | 原因 | 处理 |
|---|---|---|
| `没有可导入的数据` | 时间列没被识别，或 `--since/--until` 过滤空了 | 先 `--dry-run` 看列解析；列名用 §3.5.2 的别名 |
| `申请 device token 失败（HTTP 500）… unique` | 同名设备/同 machine_id 已存在（旧版本） | 升级到 ≥ 本次发布后不再出现；或换 `--device-name` |
| `HTTP 401: Unauthorized` | JWT 与 `TT_JWT_SECRET` 不一致，或 device token 被撤销 | 重新 `issue-token.sh`；脚本会自动重签一次 |
| `HTTP 413: Upload too large` | 单批超限 | 调小 `--batch` |
| 导入成功但 summary 是 0 | `from/to` 选的日期不含数据 | 用脚本提示里打印的日期区间再查 |

### 3.5.6 想长期自动推送？

把同一份导出逻辑做成定时任务即可，脚本天然幂等：

```cron
# 每小时导入一次最近的用量（重复上传是整行替换，不会重复计数）
17 * * * * cd /opt/token-tracker/go-server && ./scripts/import-usage.py \
  --base http://192.168.1.10:8080 --device-name nas \
  --jwt "$(cat /etc/token-tracker/jwt)" --input /var/lib/usage/export.csv \
  >> /var/log/tt-import.log 2>&1
```

> 注意 `--jwt` 用文件里的长期 token 时，请把该文件设为 `0600`。

---

## 3.6 用官方客户端连上来（替代官方云服务）

这是本项目**最主要的使用方式**：官方 TokenTracker 客户端（CLI / 菜单栏 App）照常安装使用，
只把它的 `base_url` 指向你自托管的这个服务。官方云要收费之后，这条路让你继续有云端同步。

**三步**（完整说明与排错见 [`docs/official-client.md`](../docs/official-client.md)）：

```sh
# ① 服务端：打开"零交互设备批准"，让客户端 device-login 直接过
TT_DEVICE_APPROVE=auto ./bin/tokentracker-server

# ② 客户端：一个 anon key（公开、无权限，只用来通过客户端的前置校验）
ANON=$(./scripts/issue-token.sh --role anon --json)
tracker init --base-url http://localhost:8080 --anon-key "$ANON"
tracker device-login --base-url http://localhost:8080 --anon-key "$ANON"

# ③ 之后照常用：tracker sync / 菜单栏 App 都指向你自己的服务
tracker sync
```

⚠️ **客户端硬性要求**：`base_url` 只能是 `https://…` 或 `http://localhost`（`127.0.0.1`/`::1`）。
局域网 IP 走明文 HTTP 会被客户端自己拒掉 —— 见 `docs/official-client.md` §2 的三条出路
（单机用 localhost 最简单；局域网用反代 + 私有 CA + `NODE_EXTRA_CA_CERTS`，已实测）。

| 能力 | 官方客户端 ↔ 本服务 |
|---|---|
| `device-login` 拿 device token | ✅ 实测通过（`auto`/`page`/`jwt` 三种批准模式） |
| `sync` 上传用量（≤500 桶/批、幂等） | ✅ 实测通过，重传不重复计数 |
| 菜单栏/仪表盘的**本机**用量视图 | ✅ 客户端自己算，与服务端无关 |
| `account-*` **跨设备汇总**视图 | ❌ 需要 InsForge OAuth refresh token（官方 dashboard 登录才有）；本服务只用 JWT + device token，跨设备汇总请直接查 §2 的 `account-summary` 或见 `docs/official-client.md` §5 |
| `tokentracker-telemetry` | ⚪ 本服务返回 404，客户端忽略，无影响 |

---

## 3.7 登录与「跨设备」视图（`/api/auth/*`）

官方客户端的跨设备汇总不是走 `/functions/*`，而是先要一个 access token：

```
dashboard 登录  →  POST /api/auth/sessions        {email,password}
                     ↓ accessToken(1h) / refreshToken(90d) / csrfToken + 两个 cookie
本地 CLI relay  →  POST /api/auth/refresh?client_type=mobile  {refresh_token}   （轮换）
                     ↓ accessToken
popover        →  GET  /functions/tokentracker-account-*    Authorization: Bearer …
```

这些端点已实现（流程同 InsForge，代码自写），细节与安全语义见
[`../docs/oauth-selfhosted.md`](../docs/oauth-selfhosted.md)。

```sh
# 第一次部署：把 owner 账户钉下来，客户端就能登录了
TT_AUTH_EMAIL=me@lan.test TT_AUTH_PASSWORD='至少8位' \
TT_DEVICE_APPROVE=auto ./bin/tokentracker-server

# 自检：登录 → 轮换 → 撤销 → 读 account-summary
./scripts/check-oauth.sh me@lan.test '至少8位' https://tt.lan
```

**没有**第三方 OAuth、邮件验证、找回密码、多账户后台——自托管定位下这些是负担。
账号体系只有在"想让官方 dashboard / 菜单栏的跨设备视图工作"时才需要；
只想上传用量的话，`device-login` + `device token` 就够了（见 §3.6）。

---

## 4. 备份与恢复

原则：**先备份，再升级**。服务无状态（状态全在数据库里），恢复 = 恢复数据库 + 重启容器。

### 4.1 用自带脚本

```sh
# SQLite（在线一致快照；缺 sqlite3 时退化为文件复制并提示先停服务）
./go-server/scripts/backup.sh sqlite --data-dir /var/lib/tokentracker --out /backup

# PostgreSQL（pg_dump 自定义格式）
./go-server/scripts/backup.sh postgres \
  --dsn "postgres://tokentracker:密码@127.0.0.1:5432/tokentracker?sslmode=disable" \
  --out /backup [--schema public]

# 清理 7 天前的备份
./go-server/scripts/backup.sh prune --out /backup --keep 7
```

Compose 部署时数据目录是 named volume，取路径：

```sh
docker volume inspect go-server_tokentracker-data --format '{{ .Mountpoint }}'
# PG: go-server_tokentracker-pgdata
```

PG 也可以直接用容器里的 pg_dump：

```sh
docker compose exec -T tokentracker-postgres \
  pg_dump -U tokentracker -d tokentracker --no-owner --no-privileges -Fc \
  > /backup/tt-pg-$(date -u +%Y%m%dT%H%M%SZ).dump
```

### 4.2 恢复

SQLite（脚本会打印逐步命令并要求你手工确认）：

```sh
./go-server/scripts/backup.sh restore-sqlite --backup /backup/tt-sqlite-YYYY.db --data-dir /var/lib/tokentracker
```

PostgreSQL：

```sh
./go-server/scripts/backup.sh restore-postgres \
  --backup /backup/tt-pg-YYYY.dump \
  --dsn "postgres://tokentracker:密码@127.0.0.1:5432/tokentracker?sslmode=disable"
# 然后重启服务，确认 /health 200
```

### 4.3 恢复后必须确认

1. `curl -fsS http://127.0.0.1:8080/health` → `{"ok":true}`
2. 启动日志没有 `checksum drift` 报错
3. 用真实账户请求一次 summary，数据与备份时间点一致

> `schema_migrations` 里的 checksum 与**该引擎渲染后的 DDL**绑定：
> 恢复一个旧版本备份到新版本二进制时，如果中间升级过 schema，会看到
> `schema migration 1 checksum drift`。这时要用**与备份同版本**的镜像启动，或按升级说明先迁移。

### 4.4 定时备份（crontab 示例）

```cron
# 每天 03:17 备份 + 保留 14 天
17 3 * * * /opt/token-tracker/go-server/scripts/backup.sh postgres \
  --dsn "$(cat /etc/token-tracker/dsn)" --out /backup >> /var/log/tt-backup.log 2>&1
45 3 * * * /opt/token-tracker/go-server/scripts/backup.sh prune --out /backup --keep 14
```

备份文件里含完整用量历史与设备身份，请落地到加密盘 / 私有对象存储，权限 `0600`。

---

## 5. 升级

镜像 tag 策略（实验通道，**不会**覆盖正式 InsForge 工件镜像）：

| tag | 含义 |
|---|---|
| `experimental` | 最新实验构建（浮动，会变） |
| `experimental-<short_sha>` | 某个 commit 的构建（推荐 pin 这个） |
| `sha-<short_sha>` | 同上，纯 sha 形式 |

```sh
cd go-server
./scripts/backup.sh postgres --dsn "$DSN" --out /backup
docker compose pull tokentracker-go
docker compose up -d tokentracker-go        # 只重建服务，不动数据库
docker compose logs --tail=50 tokentracker-go
curl -fsS http://127.0.0.1:8080/health
```

- schema 安装是**幂等**的：启动时 `CREATE TABLE IF NOT EXISTS` + 写迁移账本。
- 升级失败回滚：`docker compose up -d` 前把镜像 tag 改回旧的 `experimental-<old_sha>`，
  数据层通常无需回滚（当前 schema v1 尚未变更）。
- **注意**：目前 schema 只有 version 1，没有"增量迁移脚本"机制。将来版本升级如果需要改列，
  会先在 STATUS.md/CHANGELOG 注明迁移步骤，再改 checksum。

---

## 6. 运维与监控

### 6.1 systemd（裸机部署）

```ini
# /etc/systemd/system/tokentracker.service
[Unit]
Description=TokenTracker Go backend
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
User=tokentracker
Group=tokentracker
EnvironmentFile=/etc/token-tracker/env       # 权限 0600，内含 TT_JWT_SECRET 等
ExecStart=/usr/local/bin/tokentracker-server
Restart=on-failure
RestartSec=3
# 加固
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/tokentracker
StateDirectory=tokentracker
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

```sh
sudo install -m 0755 go-server/bin/tokentracker-server /usr/local/bin/
sudo useradd --system --home /var/lib/tokentracker tokentracker
sudo install -d -o tokentracker -g tokentracker -m 0700 /var/lib/tokentracker
sudo install -o root -g tokentracker -m 0640 /dev/null /etc/token-tracker/env   # 填入变量
sudo systemctl daemon-reload && sudo systemctl enable --now tokentracker
```

### 6.2 健康检查

- `GET /health` → `{"ok":true}`（进程存活 + 路由就绪；**不查数据库**）。
- 想知道数据库是否可用：看启动日志，或直接请求一个需要 DB 的只读接口（未认证返回 401 也说明进程在跑）。
- Docker 里已内置 `HEALTHCHECK`（compose 用 `wget`），`docker ps` 会显示 `healthy`。

### 6.3 日志

单行启动日志（含引擎与脱敏 DSN），其余错误通过 HTTP 响应体返回，不写文件。
用 `docker logs` / `journalctl -u tokentracker` 收集即可。密码在日志中显示为 `user:***@host`。

**建议监控的最小指标**：`/health` 200、容器重启次数、PG 连接数、磁盘剩余、备份文件是否按时生成。

---

## 7. 安全清单（上线前逐项打勾）

- [ ] `TT_JWT_SECRET` 由 `openssl rand -hex 32` 生成，只存在 `EnvironmentFile`/secret 里，权限 `0600`，未提交 git
- [ ] 服务只绑定 `127.0.0.1` 或内网地址；**不做端口转发/公网映射**
- [ ] HTTPS：纯内网可信环境可以不启用（token 会在局域网内明文传输）；一旦要跨网络访问，请自行加 TLS 反代
- [ ] `TT_ENABLE_TEST_ENDPOINTS` 未设置（或为 `false`）；反代对 `/_test` 直接 404
- [ ] PostgreSQL：独立低权限账号（只在目标库/schema 上有 DML+DDL），不从公网暴露 5432
- [ ] SQLite：数据目录 `0700`，DB 文件 `0600`（服务默认 umask 077 已保证）
- [ ] 容器：`read_only` + `cap_drop: [ALL]` + `no-new-privileges` + 非 root（uid 10001），compose 示例已配
- [ ] 备份能落地、能恢复（演练过一次），备份文件加密/限权
- [ ] 主机防火墙只开 22/80/443
- [ ] 知道「没有速率限制」这件事，必要时在反代层加 `limit_req`

---

## 8. 故障排查

| 现象 | 原因 | 处理 |
|---|---|---|
| 启动即退：`TT_JWT_SECRET is required and must be at least 32 bytes` | 密钥未设/太短 | 生成 ≥32 字节随机值 |
| 启动即退：`database not reachable …` | PG 未就绪/连接串或 `sslmode` 错/网络不通 | `pg_isready`、检查 DSN、防火墙；服务会重试 30s 再放弃 |
| 启动即退：`schema migration 1 checksum drift` | 用新版本二进制连了旧 schema 的库（或有人手改了表） | 用与备份/旧数据同版本的镜像启动；不要手改表结构 |
| 启动即退：`store: Config.Schema is PostgreSQL-only` | 给 SQLite 设了 `TT_POSTGRES_SCHEMA` | 去掉该变量 |
| `sql: unknown driver "postgres"` | 用了自行裁剪的构建，缺少驱动 import | 用官方镜像或完整 `go build ./cmd/server` |
| 401 一直返回 | JWT 密钥与签发方不一致 / `exp` 过期 / 缺 `role` | 用 jwt.io 解 payload 对比 `TT_JWT_SECRET` |
| 403 `server role required` | 调了 `/api/database/rpc/*` 但 JWT `role` 不是 `project_admin` | 用服务角色 token，或改用 `/functions/*` |
| 上传报 `Upload too large` / `Too many buckets` | 单次 body >1 MiB / >500 桶 | 客户端分批 |
| SQLite `database is locked` | 多个进程/网络文件系统访问同一个 DB | 只跑单实例、数据放本地盘 |
| 容器 `read_only` 下启动失败 | `/tmp` 不可写 | compose 已加 `tmpfs: /tmp`，自行部署时别忘 |
| PG 重启后连不上 | 连接池里是死连接 | 正常会在 `ConnMaxLifetime` 内自然恢复；立即恢复用 `docker compose restart tokentracker-go` |

---

## 9. 已知限制（会影响你的架构决策）

1. **没有注册/登录**：按 §1.0 用脚本签 token。这是定位选择，不是待补功能。
2. **没有 InsForge/PostgREST 兼容 API**：dashboard 若硬编码 InsForge endpoint，需要改 base URL/路由。
3. **只有 14 张表**（PG 参考清单 24 张）：session states、赠送码审计、支付/Waffo 审计等未实现。
   自托管模式下这些功能是有意排除的（付费 RPC 返回明确拒绝）。
4. **单实例语义**：ingest 的整行修正靠进程内互斥；PG 上跑多副本前必须补 advisory lock。
5. **没有速率限制 / 审计日志 / 指标导出**。
6. **SQLite 与 PostgreSQL 之间没有自动数据迁移工具**：切换引擎目前等于重新上传用量
   （设备与设备 token 需重新签发）。若需要，可以基于 `/functions/tokentracker-ingest` 写一个搬数脚本，
   但要自己处理 device token 的重新签发。
7. **没有 schema 增量迁移**（只有 version 1）：升级前必须备份。
8. **只有 linux/amd64 做过本地 smoke**；arm64 由 CI 构建但未在真机验收。

---

## 10. 想自己验证一遍？

```sh
cd go-server
go test -race ./...                                          # SQLite
TT_TEST_DATABASE_URL='postgres://…?sslmode=disable' go test -race ./...   # 真实 PostgreSQL
go vet ./...

cd ..
CONTRACT_ADAPTER=./contract/adapters/go-sqlite.cjs ./contract/scripts/verify.sh
GO_POSTGRES_URL='postgres://…?sslmode=disable' \
  CONTRACT_ADAPTER=./contract/adapters/go-postgres.cjs ./contract/scripts/verify.sh
# 两条基线都是 33 PASS / 0 FAIL / 2 SKIP
```

镜像 smoke（不需要本地 Go）：`docker compose -f docker-compose.postgres-go.example.yml up -d` 后按 §1.1 检查。

---

## 11. 卸载

```sh
docker compose -f docker-compose.postgres-go.example.yml down          # 保留数据卷
docker compose -f docker-compose.postgres-go.example.yml down -v       # ⚠️ 连同数据一起删除
```

裸机：`systemctl disable --now tokentracker`，删除 `/usr/local/bin/tokentracker-server`、
`/etc/token-tracker/`、`/var/lib/tokentracker/`（**先确认备份**）。
