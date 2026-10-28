# 给 AI 的部署剧本

你是被叫来把 TokenTracker 自托管后端装到某台机器上的 agent。按这个剧本走：**每一步都有验证门，过不了不许往下走**。
下面的命令可以直接执行，但**先读 §0**——有几种情况你必须停下问人。

事实性的完整说明在 [`../users/deploy.md`](../users/deploy.md)，这里只给"做什么 + 怎么确认做成了"。
冲突时以 `users/deploy.md` 和**代码**为准，不是以本文件为准。

---

## §0 开干之前：五个问题，缺一个就停

问人（一次问完，别挤牙膏）：

1. **装在哪台机器？** 它的 CPU 架构是什么（`uname -m`：`x86_64` / `aarch64`）？有没有 Docker？
2. **PostgreSQL 怎么办？** 用 compose 自带的，还是连已有的外部 PG（版本 ≥14，能建库）？
3. **你要接官方客户端吗？** 要的话，客户端在哪些机器上，它们能不能用 `https://` 访问这台机器（客户端拒绝局域网明文 http）？
4. **用哪个地址访问？** 局域网域名/IP + 端口。这决定了反代与证书怎么做。
5. **这台机器上原来有数据吗？** 有没有旧的 SQLite 实例或旧 PG 库需要处理？

**停手条件（先问，不要自己决定）**：

- 需要**删除或重建**已有数据库 / 卷 / 目录；
- 需要暴露到公网（本项目定位是局域网自用；`TT_DEVICE_APPROVE=page|auto` 在公网等于开放接入）；
- 需要在别人的生产机器上改防火墙 / 装证书 / 重启已有服务；
- 有人给了你一个"现成的 DSN"，但你不确定它指向哪个库 —— **先 `SELECT current_database()`**；
- 你打算改官方客户端（**不许改**，见 [`../users/official-client.md`](../users/official-client.md) §2）。

---

## §1 判定路线

```
有 Docker？
├── 有  ──→ 路线 A：compose（自带 PG 或外部 PG）      §2
└── 没有 ──→ 有 root / systemd？
              ├── 有  ──→ 路线 B：二进制 + systemd    §3
              └── 没有 ──→ 停。问人要权限，别用 nohup 糊一个进程。
```

- **外部 PG**：两条路线都要做 §4 的检查。
- **客户端要连**：无论哪条路线，最后都要过 §5（TLS / 反代）。
- **要给 AI 自己用（无浏览器）**：§6 的 `TT_DEVICE_APPROVE=auto`。

---

## §2 路线 A：compose

```sh
# 1) 取仓库（只要 go-server 目录也够）
git clone --depth 1 <repo> && cd <repo>/go-server

# 2) 生成密钥与密码（别复用别处的）
printf 'TT_JWT_SECRET=%s\nPOSTGRES_PASSWORD=%s\n' \
  "$(openssl rand -hex 32)" "$(openssl rand -hex 16)" > .env
chmod 600 .env

# 3) 固定镜像版本（不要用浮动 tag，便于回滚与排查）
docker pull ghcr.io/quietsugar/token-tracker-self-hosting-go:experimental-<short_sha>
# 然后把 compose 里的 image: 改成这个 tag

# 4) 起
docker compose -f docker-compose.postgres-go.example.yml up -d
```

**验证门 A1** — 两个容器都 healthy：

```sh
docker compose -f docker-compose.postgres-go.example.yml ps
# 期望：tokentracker-postgres (healthy)、tokentracker-go (healthy)
```

**验证门 A2** — 服务活着：

```sh
curl -s http://127.0.0.1:8080/health
# 期望：{"ok":true,"engine":"postgres","version":"…","ref":"…"}
```

> `/health` **不查数据库**。它返回 ok 但库是坏的，也能看到——库的问题在启动日志里
> （`database not reachable` 会重试 30 秒后退出，容器会一直重启）。

**验证门 A3** — 数据面能写能读（必做，别只信 health）：

```sh
cd go-server
# .env 里是 KEY=VALUE；必须只取等号后面的部分，否则签出来的 JWT 校验不过
export TT_JWT_SECRET="$(sed -n 's/^TT_JWT_SECRET=//p' .env | head -1)"
TOKEN=$(./scripts/issue-token.sh --base http://127.0.0.1:8080 --json)
DTOK=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"device_name":"smoke","platform":"linux","machine_id":"m-smoke"}' \
  http://127.0.0.1:8080/functions/tokentracker-device-token-issue | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])')
curl -s -X POST -H "Authorization: Bearer $DTOK" -H 'Content-Type: application/json' \
  -d '{"buckets":[{"hour_start":"2026-10-20T10:00:00Z","source":"codex","model":"gpt-6","input_tokens":1234,"total_tokens":1234,"billable_total_tokens":1234}]}' \
  http://127.0.0.1:8080/functions/tokentracker-ingest
# 期望：{"ok":true,"inserted":1,"skipped":0,…}
curl -s -H "Authorization: Bearer $TOKEN" \
  'http://127.0.0.1:8080/functions/tokentracker-account-summary?from=2026-10-01&to=2026-10-31&tz=Asia/Shanghai'
# 期望：total_tokens ≥ 1234
```

这一步过了，"装好了"才算成立。之后把 `smoke` 设备停掉（历史留着无妨），或者留着当哨兵：

```sh
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"machine_id":"m-smoke"}' \
  'http://127.0.0.1:8080/functions/tokentracker-billing?action=remove-device'
```

注意 body 是 **`machine_id`**（签发时给的那个），不是 `device_id`。

---

## §3 路线 B：二进制 + systemd

前提：Linux、root、PG 已在跑。

```sh
# 1) 编二进制（仓库不发预编译产物，只有 GHCR 镜像；需要 Go ≥1.24）
cd go-server
mkdir -p bin
CGO_ENABLED=0 go build -trimpath -o bin/tokentracker-server ./cmd/server
install -m 0755 bin/tokentracker-server /usr/local/bin/

# 2) 服务用户 + 配置（env 必须让服务用户读得到）
useradd --system --no-create-home --shell /usr/sbin/nologin tokentracker || true
install -d -m 0750 -g tokentracker /etc/token-tracker
cat > /etc/token-tracker/env <<EOF
TT_LISTEN_ADDR=127.0.0.1:8080
TT_DATABASE_URL=postgres://tokentracker:PASS@127.0.0.1:5432/tokentracker?sslmode=disable
TT_JWT_SECRET=$(openssl rand -hex 32)
EOF
chown root:tokentracker /etc/token-tracker/env
chmod 0640 /etc/token-tracker/env

# 3) systemd 单元
cat > /etc/systemd/system/tokentracker.service <<'EOF'
[Unit]
Description=TokenTracker self-hosted backend
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
User=tokentracker
EnvironmentFile=/etc/token-tracker/env
ExecStart=/usr/local/bin/tokentracker-server
Restart=on-failure
RestartSec=3
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload && systemctl enable --now tokentracker
```

**验证门 B1**：`systemctl status tokentracker` 是 `active (running)`，且 `journalctl -u tokentracker -n 30` 里有
`engine=postgres` 和监听的地址，没有 `database not reachable`。

**验证门 B2**：和 A2 一样 `curl /health`（如果监听 127.0.0.1 就在本机 curl）。

**验证门 B3**：和 A3 一样跑通写入 + 读回。**没有 B3 不算装完。**

---

## §4 外部 PG 检查（两条路线共用）

在**服务端机器**上执行（别在客户端机器上）：

```sh
psql "$TT_DATABASE_URL" -c 'select current_database(), version();'
psql "$TT_DATABASE_URL" -c '\dt'
```

- 版本要 ≥14。看到 `permission denied for schema public` → 给建库用户 schema 权限，或改 `TT_POSTGRES_SCHEMA` 到专用 schema。
- **空库是对的**：服务端自己建表（core DDL + 迁移账本）。表已经存在且是别的应用的 → 停，问人。
- 想让服务端用独立 schema 做隔离：`TT_POSTGRES_SCHEMA=tt`（别和 `_test`、`public` 混用）。
- 连接串带 `sslmode` 要对（同机通常 `disable`，跨机按 PG 配置）。

---

## §5 官方客户端要连（TLS / 反代）

**这一步最容易翻车，先理解约束**：官方客户端只接受 `https://` 或 `http://localhost`。局域网明文 http 的
`http://192.168.x.x:8080` 会被客户端直接拒绝，**服务端无法绕过**（也不该绕过）。

三条出路（细节和实测命令见 [`../users/official-client.md`](../users/official-client.md) §2）：

| 情况 | 做法 |
|---|---|
| 客户端与服务端在同一台机器 | 不做 TLS，客户端用 `http://localhost:8080` |
| 客户端在别的机器、能用 SSH | `ssh -N -L 8080:server:8080 user@server`，客户端照样用 localhost |
| 必须局域网直连 | 反代 + 证书（Let's Encrypt 或私有 CA + `NODE_EXTRA_CA_CERTS`） |

反代的三个硬要求（漏一个就出 `Device authorization returned a different dashboard`）：

```nginx
proxy_set_header Host              $host:$server_port;
proxy_set_header X-Forwarded-Proto https;
proxy_set_header X-Forwarded-For   $remote_addr;
proxy_pass http://127.0.0.1:8080;
```

- `Authorization` 头**必须透传**（有些网关/SSO 会吃掉它，表现为"密码能登录但所有 API 401"）。
  排查：`TT_ACCESS_LOG=true`，日志里 `auth=no` 就是被吃了。
- `TT_DASHBOARD_URL` **默认留空**，让服务端按请求的 Host + `X-Forwarded-Proto` 推导设备授权页地址。
  只有反代把 Host 改得面目全非时才显式设置成与客户端 `base_url` 完全一致。
- nginx 的 `client_max_body_size` 至少 `2m`（上传单次 body 上限 1 MiB）。
- **不要自己给 `OPTIONS` 返回 204**：服务端已在 `/functions/*`、`/api/selfhost/*`、`/api/auth/*`
  的鉴权之前放行预检（2026-10-28 修复）。旧版本才需要在反代层绕（`if ($request_method = OPTIONS) { return 204; }`），
  升级后那段配置可以删掉——留着反而会盖掉服务端按端点设置的 `Access-Control-Allow-Headers`。

**验证门 C1** — 从**客户端机器**上：

```sh
curl -s https://<你的地址>/health          # 要真的走 https 且证书可信
```

**验证门 C2** — 客户端三连：

```sh
tracker init         --base-url https://<地址> --anon-key "$ANON"
tracker device-login --base-url https://<地址> --anon-key "$ANON"   # 需要浏览器点批准
tracker doctor                                                       # ok 12 | fail 0
tracker sync                                                         # inserted > 0
```

`$ANON` 在服务端生成：`./scripts/issue-token.sh --role anon --json`。

---

## §6 无头机器 / AI 自己接入

默认 `TT_DEVICE_APPROVE=page` 需要有人打开浏览器点"批准"。没有浏览器时：

- 设 `TT_DEVICE_APPROVE=auto`，`device-login` 零交互完成（局域网自用的取舍；**公网绝对不要**）；
- 或保持 `page`/`jwt`，在服务端机器上跑 `./scripts/approve-device.sh ABCD-EFGH --base https://<地址>`。

接完直接用 device token 上传（不依赖客户端）：

```sh
curl -s -X POST -H "Authorization: Bearer <device-token>" -H 'Content-Type: application/json' \
  -d '{"buckets":[{"hour_start":"2026-10-20T11:00:00Z","source":"codex","model":"gpt-6",
       "input_tokens":10,"total_tokens":10,"billable_total_tokens":10}]}' \
  https://<地址>/functions/tokentracker-ingest
```

---

## §7 失败分支

| 卡住的地方 | 先查 | 再查 |
|---|---|---|
| 容器起来就退 | `docker compose logs tokentracker-go` 的**第一行错误** | `TT_JWT_SECRET` ≥32 字节；`TT_DATABASE_URL` 是 `postgres://` 不是文件路径 |
| health 通但写不进去 | 日志里有没有 `insert` 相关错误 | PG 权限 / schema；`psql` 手工插一行同一张表 |
| 所有 `/functions/*` 401 | `TT_ACCESS_LOG=true` 看 `auth=no` | 代理是否吃/改 `Authorization`；改用 `X-TokenTracker-Token` 头验证 |
| `device-login` pending | 谁去批准了？`page` 需要浏览器，`jwt` 需要脚本 | 设备代码是否过期；`TT_DEVICE_APPROVE` 是不是你以为的那个值 |
| `different dashboard` | 反代 `Host`/`X-Forwarded-Proto` | `TT_DASHBOARD_URL` 是否与 `base_url` 完全一致（含端口） |
| 客户端 TLS 失败 | 证书链是否完整、SAN 是否含访问用的名字 | `NODE_EXTRA_CA_CERTS` 指向的是 **CA 证书**不是服务端证书 |
| 数据对不上 | 时区参数 `tz` 有没有带 | 是不是同一实例（看 `account-summary` 的 base 地址） |
| 升级后 `checksum drift` | 镜像版本与库不匹配 | 回滚镜像；不许手改迁移账本 |

完整排错表：[`../users/troubleshooting.md`](../users/troubleshooting.md)。

---

## §8 交付清单（装完向人汇报这些）

1. 访问地址 + 反代方式（用的哪条出路）
2. 镜像 tag / 二进制版本（`/health` 里的 `version`、`ref`）
3. PG 位置与库名（不贴密码）
4. 数据面验证结果：A3/B3 那三条命令的输出
5. 客户端接入情况：哪些机器、走 `page` 还是 `auto`、`doctor` 结果
6. 你**没有**做的事：备份（本项目不负责）、公网暴露、改客户端
