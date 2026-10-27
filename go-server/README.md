# TokenTracker Go 自托管后端 — 部署与运维手册

> **状态：experimental（实验性）。** 请先读 [STATUS.md](STATUS.md) 的「仍然缺什么」再决定是否接真实用户。
> 本文只讲**怎么把它跑起来、备份、升级、排错**；设计与取舍见 [../docs/go-postgres.md](../docs/go-postgres.md)。

---

## 0. 它是什么、不是什么

| | |
|---|---|
| ✅ 是 | 一个**独立**的 Go HTTP 服务，实现了 TokenTracker v1.4.12 的 14 个私有函数核心路径：设备授权、设备 token、用量上传（整行修正/幂等）、账户 summary/daily/hourly/monthly/heatmap/model-breakdown/devices、自托管免费策略、billing catalog。 |
| ✅ 是 | 同一份二进制、同一个镜像，**两种数据库**：SQLite（零依赖单文件）或 PostgreSQL（推荐）。 |
| ❌ 不是 | InsForge + PostgREST 的替代品。**没有** signup/signin/OAuth/password reset，不会提供 InsForge SDK/PostgREST 兼容 API。 |
| ❌ 不是 | 生产 GA。没有速率限制、审计日志、多实例 advisory lock、完整 24 表映射、备份自动化。 |

**认证怎么来？** 服务只**验证** JWT（HS256，`TT_JWT_SECRET` 签发），不负责发放。
也就是说：**你必须自己在前面放一个签发 JWT 的认证层**（现有 dashboard/客户端后端的登录取 token 逻辑），
把 `Authorization: Bearer <jwt>` 转发给本服务。设备侧则用本服务签发的 device token。

---

## 1. 60 秒快速开始

### 1.1 Docker Compose + PostgreSQL（推荐）

```sh
git clone https://github.com/QuietSugar/token-tracker-self-hosting.git
cd token-tracker-self-hosting/go-server

export POSTGRES_PASSWORD="$(openssl rand -hex 24)"
export TT_JWT_SECRET="$(openssl rand -hex 32)"     # ≥32 字节，必须保密且与你的认证层一致
export TT_DASHBOARD_URL="https://你的-dashboard-域名"

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

### 1.4 用已发布的镜像

```sh
docker pull ghcr.io/quietsugar/token-tracker-self-hosting-go:experimental
# 固定到某个 commit 更安全：
docker pull ghcr.io/quietsugar/token-tracker-self-hosting-go:experimental-<short_sha>
```

同一个镜像也可用旧名字拉取（兼容早期 compose 文件）：
`ghcr.io/quietsugar/token-tracker-self-hosting-sqlite-go:experimental`。

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
| `TT_DASHBOARD_URL` | `https://private.example.test` | 设备授权返回的 `verification_uri` / `verification_uri_complete` 前缀。 |
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
- [ ] 服务只绑定 `127.0.0.1`，公网流量经反代 + TLS
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

1. **没有注册/登录**：必须自备 JWT 签发层（见 §0）。
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
