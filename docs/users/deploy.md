# 部署

面向长期运行场景：一台 NAS / mini PC / 树莓派，局域网自用。
仅需验证能否运行，请参见 [`quickstart.md`](quickstart.md)。

## 0. 三项前置决策

| 决策 | 选项 | 建议 |
|---|---|---|
| **怎么跑** | Docker Compose（含 PG）/ 裸机二进制 + systemd / 已有 PG 只跑服务 | 若无现成的 PostgreSQL，推荐使用 compose（单文件包含全部组件） |
| **监听在哪** | `127.0.0.1:8080`（前面放反代）/ `0.0.0.0:8080`（局域网直连） | 只要接入官方客户端，就必须通过反向代理提供 `https://`，见 [`official-client.md`](official-client.md) |
| **账户怎么来** | 启动时给 `TT_AUTH_EMAIL`/`TT_AUTH_PASSWORD` / 首次注册 / 只用脚本签 JWT | 需要跨设备视图时必须具备账户（前两种方式） |

---

## 1. Docker Compose

```sh
cd go-server
export POSTGRES_PASSWORD="$(openssl rand -hex 24)"
export TT_JWT_SECRET="$(openssl rand -hex 32)"
docker compose -f docker-compose.postgres-go.example.yml up -d
```

该 compose 文件已包含以下配置：

- PostgreSQL 15 + 数据卷 `tokentracker-pgdata`，PG **不发布端口**到宿主机
- 服务容器 `read_only`、`cap_drop: [ALL]`、`no-new-privileges`、`tmpfs: /tmp`
- 端口仅绑定 `127.0.0.1:${TT_PORT:-8080}`
- 健康检查请求 `/health`

如需设置 owner 账户密码，在 compose 的 `tokentracker-go.environment` 中补充两行后重新 `up -d`：

```yaml
      TT_AUTH_EMAIL: me@lan.test
      TT_AUTH_PASSWORD: "替换为高强度密码"
```

（幂等：重启不会覆盖已存在的密码。）

镜像：`ghcr.io/quietsugar/token-tracker-self-hosting-go:experimental`。
**不发布 `latest`**；需要固定版本时使用 `:experimental-<short_sha>`。GHCR 包默认私有，可设为公开或先执行 `docker login`。

### 使用外部 PostgreSQL（NAS 套件 / 托管 PG）

不使用上述 compose，直接运行容器或二进制，并将 `TT_DATABASE_URL` 指向该实例：

```text
postgres://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require
```

- 内网 / 同机：`sslmode=disable`；托管 PG：`sslmode=verify-full`
- 账号权限：目标库 / schema 上具备 `CREATE`（首次建表），其后为 `SELECT/INSERT/UPDATE/DELETE`。不需要 superuser，也不需要扩展。
- 连接池默认 16 个连接、`ConnMaxLifetime=30m`；启动时最多等待数据库 30 秒。

---

## 2. 裸机 + systemd

```sh
cd go-server
mkdir -p bin
CGO_ENABLED=0 go build -trimpath -o bin/tokentracker-server ./cmd/server
sudo install -m 0755 bin/tokentracker-server /usr/local/bin/
sudo useradd --system --home /var/lib/tokentracker tokentracker
sudo install -d -o tokentracker -g tokentracker -m 0700 /var/lib/tokentracker
sudo install -o root -g tokentracker -m 0640 /dev/null /etc/token-tracker/env   # 填入环境变量
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

服务本身不写盘（数据均在 PostgreSQL 中），`StateDirectory` 仅作兜底。

---

## 3. 反向代理与 TLS

服务**不提供 TLS**。需要 `https://` 时，在前方部署反向代理，并将服务绑定回 `127.0.0.1`。

**Caddy（配置最简单，自动签发证书）**

```caddyfile
tt.lan {
    reverse_proxy 127.0.0.1:8080
    encode gzip
}
```

**nginx（自签证书或内网 CA）**

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
    location ~ ^/_test { return 404; }   # 兜底规则，正常情况下不应开启
}
```

`X-Forwarded-Proto` 必须透传：设备授权的 `verification_uri` 依据 `Host` 与该请求头推导，推导错误时官方客户端会报
`Device authorization returned a different dashboard`。

**反向代理吞掉 `Authorization` 的处理**：某些 SSO / 网关会将其作为自身凭据消费，表现为「密码可登录、读取数据全部 401」。
服务端额外接受 `X-TokenTracker-Token: Bearer <jwt>`（内建看板两个请求头同时发送）。确认方法：以 `TT_ACCESS_LOG=true` 启动服务，
请求行会显示 `auth=no`。详见 [`troubleshooting.md`](troubleshooting.md)。

---

## 4. 配置参考

| 变量 | 默认 | 说明 |
|---|---|---|
| `TT_JWT_SECRET` | **必填** | HS256 密钥，**≥32 字节**，否则拒绝启动。签发 JWT 时必须同一个值。 |
| `TT_DATABASE_URL` | **必填** | `postgres://…`。无默认值；提供 SQLite 路径会拒绝启动并提示迁移。 |
| `TT_LISTEN_ADDR` | `127.0.0.1:8080` | 监听地址。容器内使用 `0.0.0.0:8080`。 |
| `TT_DASHBOARD_URL` | 空 = 按请求推导 | 设备授权页前缀。**建议留空**（依据 `Host` 与 `X-Forwarded-Proto` 推导，保证与客户端 `base_url` 同源）。 |
| `TT_DEVICE_APPROVE` | `page` | 设备批准方式：`page`（浏览器确认，与官方一致）/ `auto`（无头机器，无交互）/ `jwt`（脚本或携带 JWT 的 grant）。见 [`devices.md`](devices.md)。 |
| `TT_AUTH_EMAIL` / `TT_AUTH_PASSWORD` | – | 引导 owner 账户（幂等，不覆盖已存在密码）。 |
| `TT_ACCESS_TOKEN_TTL` | `3600` | access token 有效期（秒）。 |
| `TT_REFRESH_TOKEN_TTL` | `7776000` | refresh token 有效期（90 天），也是 cookie Max-Age。 |
| `TT_AUTH_ALLOW_SIGNUP` | `false` | 已有 owner 后是否允许 `POST /api/auth/users` 自助注册。 |
| `TT_AUTH_ALLOWED_ORIGINS` | 空 = 回显任意 Origin | `/api/auth/*` 允许的跨域来源（逗号分隔）。 |
| `TT_AUTH_COOKIE_SECURE` | `auto` | cookie 的 `Secure`：直连时依据 TLS，经反向代理时依据 `X-Forwarded-Proto`。 |
| `TT_AUTH_REVOKE_ON_REUSE` | `false` | 已被轮换的 refresh token 再次出现时是否撤销该用户的全部会话。默认关闭：轮换后 60 秒内的再用按并发刷新处理（正常签发），超出才拒绝，避免多个客户端组件同时刷新时被误判成令牌泄露。 |
| `TT_POSTGRES_SCHEMA` | 默认 search_path | 将表创建在指定 schema（多实例共库 / 测试隔离）。 |
| `TT_POSTGRES_SCHEMA_EPHEMERAL` | `false` | 退出时执行 `DROP SCHEMA … CASCADE`。**仅用于测试。** |
| `TT_ACCESS_LOG` | `false` | 每个请求输出一行访问日志：`access: GET /path 200 auth=yes origin=-`。 |
| `TT_NOW` | 真实时间 | 冻结时钟（RFC3339）。**仅用于测试。** |
| `TT_ENABLE_TEST_ENDPOINTS` | `false` | 启用 `/_test/*`（含可执行任意 SQL 的 `/_test/sql`）。**生产环境必须关闭。** 仅 `/_test/health` 无条件挂载。 |

已移除：`TT_DATABASE_PATH`、`TT_DATABASE_DRIVER`（SQLite 时期变量；设置后会输出一行警告并忽略）。

### JWT 约定

- HS256；payload 至少含 `sub`（用户 UUID）、`role`、`exp`。
- `role="authenticated"` 用于账户与设备操作；`role="project_admin"` 才能调 `/api/database/rpc/*`。
- 过期 / 签名不符 / 结构错误 → 401。
- 上传用量使用 **device token**（非 JWT），服务端仅保存其 SHA-256。

---

## 5. 健康检查与日志

- `GET /health` → `{"ok":true,"engine":"postgres","version":"…","ref":"…"}`。**不查询数据库**，仅证明进程与路由可用。
- 如需确认数据库连通性：查看启动日志，或请求一个需要数据库的只读端点（返回 401 也说明进程在运行）。
- 日志仅包含一行启动日志与错误响应体，不写入文件。通过 `docker logs` / `journalctl` 收集。
- 建议监控：`/health` 200、容器重启次数、PG 连接数、磁盘剩余。

---

## 6. 升级

```sh
cd go-server
docker compose -f docker-compose.postgres-go.example.yml pull tokentracker-go
docker compose -f docker-compose.postgres-go.example.yml up -d tokentracker-go
```

- schema 安装是幂等的：已有库不会被重建；新增表通过 `schema_additions` 账本记录，不会因 checksum 变化而 drift。
- **不支持自动回滚**，也不保证版本降级。升级前请自行备份数据库（`pg_dump` 即可；备份策略不在本仓库范围内）。
- 启动即退出并报 `schema migration 1 checksum drift`：说明所连数据库的表结构已被外部修改。请换回与数据库版本对应的镜像，不要手工修改表结构。

---

## 7. 卸载

```sh
docker compose -f docker-compose.postgres-go.example.yml down      # 保留数据卷
docker compose -f docker-compose.postgres-go.example.yml down -v   # ⚠️ 同时删除数据
```

裸机：执行 `systemctl disable --now tokentracker`，再删除 `/usr/local/bin/tokentracker-server` 与 `/etc/token-tracker/`（数据位于 PostgreSQL 中，按既有方式处理）。

## 8. 备份

**不在本仓库范围内**。数据全部位于一个 PostgreSQL 库中，可使用 `pg_dump` / 物理备份 / 托管 PG 自带能力，按自身节奏与保留策略执行。
唯一提醒：升级与迁移前先备份一次。
