# 五分钟快速启动

目标：启动一个后端，并在浏览器中看到一条真实用量。无需账户，也无需官方客户端。

两种方式，任选其一：

- **A. Docker Compose**（推荐）—— 同时启动 PostgreSQL，一条命令完成。
- **B. 直接运行二进制**—— 已有 PostgreSQL，或需要用 systemd 管理。

前置准备：

```sh
export TT_JWT_SECRET="$(openssl rand -hex 32)"   # ≥32 字节；签发 token 时要同一个值
```

> 请生成一次并妥善保存；更换该值会使所有已签发的 token 立即失效。

---

## A. Docker Compose

```sh
git clone https://github.com/QuietSugar/token-tracker-self-hosting.git
cd token-tracker-self-hosting/go-server

export POSTGRES_PASSWORD="$(openssl rand -hex 24)"
docker compose -f docker-compose.postgres-go.example.yml up -d
```

等待就绪（约 10 秒；首次启动需初始化数据目录）：

```sh
curl -fsS http://127.0.0.1:8080/health
# {"engine":"postgres","ok":true,"ref":"…","version":"experimental-…"}
```

`"ok":true` 表示服务已启动。日志中应包含一行：

```
TokenTracker Go server listening on 0.0.0.0:8080 (engine=postgres, dsn=postgres://tokentracker:***@…)
```

## B. 直接运行二进制

```sh
cd go-server
mkdir -p bin
CGO_ENABLED=0 go build -trimpath -o bin/tokentracker-server ./cmd/server

TT_JWT_SECRET="$TT_JWT_SECRET" \
TT_DATABASE_URL='postgres://tokentracker:密码@127.0.0.1:5432/tokentracker?sslmode=disable' \
TT_LISTEN_ADDR=127.0.0.1:8080 \
./bin/tokentracker-server
```

需要 Go 1.24 及以上版本。产物为静态链接，数据库连接使用纯 TCP，无需安装 PostgreSQL 客户端库。

数据库仅需满足三点：可连接、库已存在、账号在该 schema 上具备 `CREATE` 权限（首次建表）。不需要 superuser，也不需要安装扩展。

---

## 写入一条用量并读取

服务端仅接受两种凭据：**JWT**（读取账户数据）与 **device token**（上传用量）。局域网自用无需先建账户，可用脚本签发 JWT：

```sh
TOKEN=$(./scripts/issue-token.sh --json)          # 默认取本机 owner；第一次会自动认领
```

流程为：签发 device token → 上传一个小时的用量 → 使用 JWT 读回。

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

重复上传同一行不会重复计数（主键 `user_id+device_id+hour_start+source+model`，整行替换）。如需删除这条测试数据，直接删除库中的行或重建 schema 即可。

---

## 在浏览器中查看

打开 <http://127.0.0.1:8080/>：

- 已配置 owner 账户密码 → 直接登录（启动时设置 `TT_AUTH_EMAIL` / `TT_AUTH_PASSWORD`）
- 未配置 → 选择「直接粘贴 JWT」，粘贴上方 `$TOKEN`

页面中应显示上述 1234 tokens。细节见 [`dashboard.md`](dashboard.md)。

---

## 后续步骤

- 长期部署（反向代理、systemd、环境变量全表、升级）：[`deploy.md`](deploy.md)
- 接入官方客户端：[`official-client.md`](official-client.md)
- 导入历史数据：[`importing.md`](importing.md)
- 故障排查：[`troubleshooting.md`](troubleshooting.md)
