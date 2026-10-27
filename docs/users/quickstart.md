# 五分钟跑起来

目标：起一个后端，**在浏览器里看到一条真实用量**。不需要账户，不需要官方客户端。

两条路，选一条：

- **A. Docker Compose**（推荐）——连 PostgreSQL 一起起，一条命令。
- **B. 直接跑二进制**——已经有 PostgreSQL，或者你想用 systemd 管。

两个前提先准备好：

```sh
export TT_JWT_SECRET="$(openssl rand -hex 32)"   # ≥32 字节；签发 token 时要同一个值
```

> 生成一次就存好。换掉它 = 所有已签发的 token 立即失效。

---

## A. Docker Compose

```sh
git clone https://github.com/QuietSugar/token-tracker-self-hosting.git
cd token-tracker-self-hosting/go-server

export POSTGRES_PASSWORD="$(openssl rand -hex 24)"
docker compose -f docker-compose.postgres-go.example.yml up -d
```

等就绪（约 10 秒，第一次要初始化数据目录）：

```sh
curl -fsS http://127.0.0.1:8080/health
# {"engine":"postgres","ok":true,"ref":"…","version":"experimental-…"}
```

看到 `"ok":true` 就起来了。日志里应该有一行：

```
TokenTracker Go server listening on 0.0.0.0:8080 (engine=postgres, dsn=postgres://tokentracker:***@…)
```

## B. 直接跑二进制

```sh
cd go-server
CGO_ENABLED=0 go build -trimpath -o bin/tokentracker-server ./cmd/server

TT_JWT_SECRET="$TT_JWT_SECRET" \
TT_DATABASE_URL='postgres://tokentracker:密码@127.0.0.1:5432/tokentracker?sslmode=disable' \
TT_LISTEN_ADDR=127.0.0.1:8080 \
./bin/tokentracker-server
```

需要 Go 1.24+。产物是静态链接的，数据库连接走纯 TCP，不需要装 PG 客户端库。

数据库只要求三件事：能连、库存在、账号在该 schema 上有 `CREATE`（首次建表）。不需要 superuser，不需要装扩展。

---

## 塞一条用量进去，然后读回来

服务端只认两种凭据：**JWT**（读账户数据）和 **device token**（上传用量）。局域网自用不必先建账号，脚本签一个 JWT 就行：

```sh
TOKEN=$(./scripts/issue-token.sh --json)          # 默认取本机 owner；第一次会自动认领
```

然后：签一个 device token → 上传一个小时的用量 → 用 JWT 读回来。

```sh
DEV=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"device_name":"desktop","platform":"linux","machine_id":"m-local"}' \
  http://127.0.0.1:8080/functions/tokentracker-device-token-issue)
DTOK=$(echo "$DEV" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')

curl -s -X POST -H "Authorization: Bearer $DTOK" -H 'Content-Type: application/json' \
  -d '{"buckets":[{"hour_start":"2026-10-20T10:00:00Z","source":"codex","model":"gpt-6",
       "input_tokens":1234,"total_tokens":1234,"billable_total_tokens":1234,"conversation_count":1}]}' \
  http://127.0.0.1:8080/functions/tokentracker-ingest
# {"inserted":1,"ok":true,…}

curl -s -H "Authorization: Bearer $TOKEN" \
  'http://127.0.0.1:8080/functions/tokentracker-account-summary?from=2026-10-20&to=2026-10-20&tz=UTC'
# {"totals":{"total_tokens":1234,…},…}
```

重复上传同一行不会翻倍（主键 `user_id+device_id+hour_start+source+model`，整行替换）。想删掉这条测试数据，直接删库里的行或重建 schema 即可。

---

## 在浏览器里看

打开 <http://127.0.0.1:8080/>：

- 有 owner 账户密码 → 直接登录（`TT_AUTH_EMAIL` / `TT_AUTH_PASSWORD` 启动时设置）
- 没有 → 点「直接粘贴 JWT」，把上面 `$TOKEN` 贴进去

页面里应该能看到刚才那条 1234 tokens。细节见 [`dashboard.md`](dashboard.md)。

---

## 接下来

- 正式部署（反代、systemd、环境变量全表、升级）：[`deploy.md`](deploy.md)
- 让官方客户端连上来：[`official-client.md`](official-client.md)
- 把历史数据导进来：[`importing.md`](importing.md)
- 跑不通：[`troubleshooting.md`](troubleshooting.md)

## 想自己验一遍服务端

```sh
cd go-server
export TT_TEST_DATABASE_URL='postgres://…?sslmode=disable'
go test -race ./...

cd ..
CONTRACT_ADAPTER=./contract/adapters/go-postgres.cjs ./contract/scripts/verify.sh
# 33 PASS / 0 FAIL / 2 SKIP
```
