# 部署

面向长期运行：一台 NAS / mini PC / 树莓派，局域网自用。
只想先看看能不能跑，去 [`quickstart.md`](quickstart.md)。

## 0. 先定三件事

| 决定 | 选项 | 建议 |
|---|---|---|
| **怎么跑** | Docker Compose（含 PG）/ 裸机二进制 + systemd / 已有 PG 只跑服务 | 家里没有 PG 就用 compose，一个文件全包 |
| **监听在哪** | `127.0.0.1:8080`（前面放反代）/ `0.0.0.0:8080`（局域网直连） | 只要接官方客户端就必须走反代拿 `https://`，见 [`official-client.md`](official-client.md) |
| **账户怎么来** | 启动时给 `TT_AUTH_EMAIL`/`TT_AUTH_PASSWORD` / 首次注册 / 只用脚本签 JWT | 想要跨设备视图就必须有账户（前两种） |

---

## 1. Docker Compose

```sh
cd go-server
export POSTGRES_PASSWORD="$(openssl rand -hex 24)"
export TT_JWT_SECRET="$(openssl rand -hex 32)"
docker compose -f docker-compose.postgres-go.example.yml up -d
```

这个 compose 里已经做了：

- PostgreSQL 15 + 数据卷 `tokentracker-pgdata`，PG **不发布端口**到宿主机
- 服务容器 `read_only`、`cap_drop: [ALL]`、`no-new-privileges`、`tmpfs: /tmp`
- 端口只绑 `127.0.0.1:${TT_PORT:-8080}`
- 健康检查打 `/health`

想加 owner 账户密码，在 compose 的 `tokentracker-go.environment` 里补两行再 `up -d`：

```yaml
      TT_AUTH_EMAIL: me@lan.test
      TT_AUTH_PASSWORD: "换成一个长密码"
```

（幂等：重启不会覆盖已存在的密码。）

镜像：`ghcr.io/quietsugar/token-tracker-self-hosting-go:experimental`。
**不发布 `latest`**；要固定用 `:experimental-<short_sha>`。GHCR 包默认私有，公开或先 `docker login`。

### 用外部 PostgreSQL（NAS 套件 / 托管 PG）

不要那个 compose，直接跑容器或二进制，把 `TT_DATABASE_URL` 指过去：

```text
postgres://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require
```

- 内网 / 同机：`sslmode=disable`；托管 PG：`sslmode=verify-full`
- 账号权限：目标库/schema 上 `CREATE`（首次建表）+ 之后 `SELECT/INSERT/UPDATE/DELETE`。不需要 superuser，不需要扩展。
- 连接池默认 16 连接、`ConnMaxLifetime=30m`；启动时最多等数据库 30 秒。

---

## 2. 裸机 + systemd

```sh
cd go-server
CGO_ENABLED=0 go build -trimpath -o bin/tokentracker-server ./cmd/server
sudo install -m 0755 bin/tokentracker-server /usr/local/bin/
sudo useradd --system --home /var/lib/tokentracker tokentracker
sudo install -d -o tokentracker -g tokentracker -m 0700 /var/lib/tokentracker
sudo install -o root -g tokentracker -m 0640 /dev/null /etc/token-tracker/env   # 填入变量
```

```ini
# /etc/systemd/system/tokentracker.service
[Unit]
Description=TokenTracker Go backend
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
User=tokentracker
Group=tokentracker
EnvironmentFile=/etc/token-tracker/env
ExecStart=/usr/local/bin/tokentracker-server
Restart=on-failure
RestartSec=3
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
sudo systemctl daemon-reload && sudo systemctl enable --now tokentracker
journalctl -u tokentracker -f
```

服务本身不落盘（数据都在 PG），`StateDirectory` 只是兜底。

---

## 3. 反向代理与 TLS

服务**不做 TLS**。要 `https://` 就放个反代在前面，并把服务绑回 `127.0.0.1`。

**Caddy（最省事，自动证书）**

```caddyfile
tt.lan {
    reverse_proxy 127.0.0.1:8080
    encode gzip
}
```

**nginx（自签或内网 CA）**

```nginx
server {
    listen 8443 ssl;
    server_name tt.lan;
    ssl_certificate     /etc/tt/srv.pem;
    ssl_certificate_key /etc/tt/srv.key;

    client_max_body_size 2m;          # 上传上限：单次 ≤1 MiB body / ≤500 buckets
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host              $host:$server_port;
        proxy_set_header X-Forwarded-Proto $scheme;   # 必须，否则设备授权页地址会推导成 http
        proxy_set_header X-Forwarded-For   $remote_addr;
        proxy_read_timeout 30s;
    }
    location ~ ^/_test { return 404; }   # 兜底，正常也不该开
}
```

`X-Forwarded-Proto` 必须透传：设备授权的 `verification_uri` 是按 `Host` + 这个头推导的，推导错了官方客户端会报
`Device authorization returned a different dashboard`。

**反代把 `Authorization` 吃掉了怎么办**：有些 SSO / 网关会把它当自己的凭据消费掉，表现是"密码能登录、一读数据全是 401"。
服务端额外接受 `X-TokenTracker-Token: Bearer <jwt>`（内建看板两个头都发）。确认方法：`TT_ACCESS_LOG=true` 起服务，
请求行会显示 `auth=no`。详见 [`troubleshooting.md`](troubleshooting.md)。

---

## 4. 配置参考

| 变量 | 默认 | 说明 |
|---|---|---|
| `TT_JWT_SECRET` | **必填** | HS256 密钥，**≥32 字节**，否则拒绝启动。签发 JWT 时必须同一个值。 |
| `TT_DATABASE_URL` | **必填** | `postgres://…`。没有默认值；给 SQLite 路径会拒绝启动并提示迁移。 |
| `TT_LISTEN_ADDR` | `127.0.0.1:8080` | 监听地址。容器里用 `0.0.0.0:8080`。 |
| `TT_DASHBOARD_URL` | 空 = 按请求推导 | 设备授权页的前缀。**建议留空**（用 `Host` + `X-Forwarded-Proto` 推导，保证与客户端 `base_url` 同源）。 |
| `TT_DEVICE_APPROVE` | `page` | 设备批准方式：`page`（浏览器点，与官方一致）/ `auto`（无头机器零交互）/ `jwt`（脚本或带 JWT 的 grant）。见 [`devices.md`](devices.md)。 |
| `TT_AUTH_EMAIL` / `TT_AUTH_PASSWORD` | – | 引导 owner 账户（幂等，不覆盖已存在密码）。 |
| `TT_ACCESS_TOKEN_TTL` | `3600` | access token 有效期（秒）。 |
| `TT_REFRESH_TOKEN_TTL` | `7776000` | refresh token 有效期（90 天），也是 cookie Max-Age。 |
| `TT_AUTH_ALLOW_SIGNUP` | `false` | 已有 owner 后是否允许 `POST /api/auth/users` 自助注册。 |
| `TT_AUTH_ALLOWED_ORIGINS` | 空 = 回显任意 Origin | `/api/auth/*` 允许的跨域来源（逗号分隔）。 |
| `TT_AUTH_COOKIE_SECURE` | `auto` | cookie 的 `Secure`：直连看 TLS、反代看 `X-Forwarded-Proto`。 |
| `TT_AUTH_REVOKE_ON_REUSE` | `false` | 旧 refresh token 被重放时是否撤销该用户全部会话（默认只拒绝，避免并发刷新误伤）。 |
| `TT_POSTGRES_SCHEMA` | 默认 search_path | 把表放进指定 schema（多实例共库 / 测试隔离）。 |
| `TT_POSTGRES_SCHEMA_EPHEMERAL` | `false` | 退出时 `DROP SCHEMA … CASCADE`。**只用于测试。** |
| `TT_ACCESS_LOG` | `false` | 每请求一行访问日志：`access: GET /path 200 auth=yes origin=-`。 |
| `TT_NOW` | 真实时间 | 冻结时钟（RFC3339）。**仅测试**用。 |
| `TT_ENABLE_TEST_ENDPOINTS` | `false` | 打开 `/_test/*`（含可执行任意 SQL 的 `/_test/sql`）。**生产必须关闭。** |

已移除：`TT_DATABASE_PATH`、`TT_DATABASE_DRIVER`（SQLite 时代变量，设了会打一行警告然后忽略）。

### JWT 约定

- HS256；payload 至少含 `sub`（用户 UUID）、`role`、`exp`。
- `role="authenticated"` 用于账户与设备操作；`role="project_admin"` 才能调 `/api/database/rpc/*`。
- 过期 / 签名不符 / 结构错误 → 401。
- 上传用量用的是 **device token**（不是 JWT），服务端只存 SHA-256。

---

## 5. 健康检查与日志

- `GET /health` → `{"ok":true,"engine":"postgres","version":"…","ref":"…"}`。**不查数据库**，只证明进程和路由活着。
- 想知道数据库通不通：看启动日志，或请求一个需要 DB 的只读端点（401 也说明进程在跑）。
- 日志只有一行启动日志 + 错误响应体，不写文件。用 `docker logs` / `journalctl` 收。
- 建议监控：`/health` 200、容器重启次数、PG 连接数、磁盘剩余。

---

## 6. 升级

```sh
cd go-server
docker compose -f docker-compose.postgres-go.example.yml pull tokentracker-go
docker compose -f docker-compose.postgres-go.example.yml up -d tokentracker-go
```

- schema 安装是幂等的：老库不会被重建；新增表走 `schema_additions` 账本，不会因为 checksum 变化而 drift。
- **没有自动回滚**，也没有版本降级保证。升级前请自己备份数据库（`pg_dump` 即可，备份策略不在本仓库范围）。
- 启动即退并报 `schema migration 1 checksum drift`：说明你连上了被别人改过表结构的库。换回对应版本的镜像，别手改表。

---

## 7. 卸载

```sh
docker compose -f docker-compose.postgres-go.example.yml down      # 保留数据卷
docker compose -f docker-compose.postgres-go.example.yml down -v   # ⚠️ 连数据一起删
```

裸机：`systemctl disable --now tokentracker`，再删 `/usr/local/bin/tokentracker-server`、`/etc/token-tracker/`（数据在 PG 里，按你平时的方式处理）。

## 8. 备份

**不在本仓库范围**。数据全在一个 PostgreSQL 库里，用 `pg_dump` / 物理备份 / 托管 PG 自带能力，按你自己的节奏和保留策略来。
唯一提醒：升级和迁移之前先备一份。
