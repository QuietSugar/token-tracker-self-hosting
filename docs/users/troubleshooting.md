# 排错

按你看到的东西查。每条都写清「怎么确认」和「怎么办」，猜不出来就先看日志。

**第一步永远是这两条**：

```sh
curl -s http://127.0.0.1:8080/health                     # {"ok":true,"engine":"postgres",…}
docker compose -f docker-compose.postgres-go.example.yml logs --tail 50 tokentracker-go
# 或 journalctl -u tokentracker -n 50
```

---

## 起不来

| 现象 | 原因 | 处理 |
|---|---|---|
| `TT_JWT_SECRET is required and must be at least 32 bytes` | 密钥没设或太短 | `openssl rand -hex 32` |
| `TT_DATABASE_URL … required` / 提示 SQLite 已移除 | 没给 PG 连接串，或给了文件路径 | 只支持 `postgres://…`，见 [`deploy.md`](deploy.md) §4 |
| `database not reachable …` | PG 没起来 / DSN 错 / `sslmode` 错 / 网络不通 | `pg_isready -h … -U …`；服务会重试 30 秒再退出 |
| `schema migration 1 checksum drift` | 用新版本二进制连了被别人改过表结构的库 | 换回对应版本镜像；别手改表 |
| `sql: unknown driver "postgres"` | 用了裁剪过的构建 | 用官方镜像，或 `go build ./cmd/server` |
| 容器里起不来，`read_only` 相关报错 | `/tmp` 不可写 | compose 已给 `tmpfs: /tmp`；自己写 compose 别忘 |
| 端口被占 | 8080 已有服务 | 改 `TT_PORT`（compose）或 `TT_LISTEN_ADDR` |

---

## 认证 / 401

| 现象 | 原因 | 处理 |
|---|---|---|
| 所有请求 401 | JWT 与 `TT_JWT_SECRET` 不一致 / 过期 / 结构错 | 用 jwt.io 解 payload 看 `exp` 和 `sub`；确认签发方用的是同一个 secret |
| **密码能登录，但所有 `/functions/*` 都 401** | 反向代理 / SSO / 网关把 `Authorization` 头当自己的凭据吃掉了 | 见下 |
| `403 server role required` | 调 `/api/database/rpc/*` 但 token 不是 `project_admin` | 用服务角色 token，或改用 `/functions/*` |
| `401` 但只有某些端点 | 不同端点鉴权不同：`device-flow-authorize/poll` 是公开的，`ingest` 要 device token，其余要 JWT | 对号入座 |
| 看板登录后立刻回登录页 | access token 1 小时过期且 refresh 失败 | 页面会显示是哪个请求、什么状态码；看日志里 `/api/auth/refresh` |

**确认是不是代理吃掉了认证头**：

```sh
TT_ACCESS_LOG=true docker compose … up -d
# 日志：access: GET /functions/tokentracker-account-summary 401 auth=no origin=https://tt.lan
#                                              ↑ auth=no 说明请求到服务端时已经没有 Authorization
```

解决：让代理透传 `Authorization`；或改用 `X-TokenTracker-Token: Bearer <jwt>`（服务端同样接受，内建看板两个头都发）。
另外注意有些网关会**改写** `Authorization`（比如换成它自己的 JWT），那也是同一类问题。

---

## 没数据 / 数字对不上

| 现象 | 原因 | 处理 |
|---|---|---|
| 上传返回 `inserted: 0` | 桶缺 `hour_start`/`source`/`model`，或全被判为无效 | 检查请求体；`skipped` 会同时给出数量 |
| `No usage buckets provided` (400) | 请求里真的没有用量桶 | 客户端旧版本遇到"只有 `account_session_states` 的批次"会死循环，升级服务端（本版对这种情况回 200） |
| `Upload too large` / `Too many buckets` | 单次 body >1 MiB / >500 桶 | 客户端会自己分批；自己写脚本时注意 |
| **"今天有数据但查不到"** | 漏了 `tz` / `tz_offset_minutes`，按 UTC 归日了 | 加上时区参数，或看看板（会自动带浏览器时区） |
| 周期里少一截 | 用的是「本月」等固定窗口 | 换成「全部」或传更早的 `from` |
| 某台设备显示「无用量」 | 该时间范围内它确实没上传过 | 切到「全部」看看；或确认它的 device token 没被暂停 |
| 汇总比预期少 | 有设备被暂停（token 被撤销），历史还在但不再增长 | `billing?action=devices` 看状态，`resume-device` 恢复 |
| 数字是双份 | 同一批数据用了两种时间戳形状（`…T00:30:00.000Z` 与 `…T00:30:00Z`）各传了一遍 | 见 [`importing.md`](importing.md) 结尾的三个原因 |

---

## 官方客户端

| 症状 | 原因 | 处理 |
|---|---|---|
| `InsForge URL must use HTTPS, or HTTP on localhost…` | `base_url` 是局域网 IP 的明文 http | 换 `https://` 或 localhost，见 [`official-client.md`](official-client.md) §2 |
| `UNABLE_TO_VERIFY_LEAF_SIGNATURE` | 私有 CA 没告诉 Node | `export NODE_EXTRA_CA_CERTS=/path/to/ca.pem` |
| `Device authorization returned a different dashboard` | 服务端推导出的 `verification_uri` 与客户端 `base_url` 不同源（反代没透传 `Host` / `X-Forwarded-Proto`） | 修反代；或 `TT_DASHBOARD_URL` 设成与 `base_url` 完全一致 |
| `device-login` 一直 pending | 还没人批准（默认 `page` 等你去浏览器点；`jwt` 等 `approve-device.sh`） | 打开客户端打印的 `/device?user_code=…` 点批准；无头机器改 `TT_DEVICE_APPROVE=auto` |
| `/device` 页面打不开 | `TT_DASHBOARD_URL` 写死成了不可达的地址 | 留空让它按请求推导 |
| `sync` 说 `skipped (no device token)` | 还没 `device-login`（换过 `base_url` 会清 token） | 重新 `device-login` |
| `sync` 一直失败、`HTTP 400` | 见上一节 `No usage buckets provided`；旧服务端会卡死队列 | 升级服务端；卡住的队列可用 `replay-queue.py` 重放 |
| 跨设备视图是空的 | 没有 owner 账户 / 没登录 | 见 [`official-client.md`](official-client.md) §4 |
| `doctor` 有失败项 | 先看它报的是哪个端点 | 多半是 404（telemetry 忽略）或 TLS |

---

## 看板

| 现象 | 原因 | 处理 |
|---|---|---|
| 打开 `/` 是空白/白屏 | 浏览器扩展或代理改了 CSP | 看控制台；页面零外部资源，正常不该白屏 |
| 登录说「登录已失效」并带一段 `HTTP 401` | 见「认证 / 401」那一节，页面会把具体端点和状态码写出来 | 先看那段括号 |
| 设备下拉里没有某台设备 | 它被暂停（撤销）了 | `billing?action=devices` 看，`resume-device` 恢复 |
| 数字和官方 dashboard 不一致 | 时区不同 / 官方 dashboard 连的是官方云 | 内建看板自动带浏览器时区；确认两边 base_url 指同一服务 |

---

## 数据库 / 升级

| 现象 | 原因 | 处理 |
|---|---|---|
| PG 重启后连不上 | 连接池里是死连接 | 会在 `ConnMaxLifetime`(30m) 内自愈；要立刻恢复就重启服务容器 |
| 升级后报 checksum drift | 新镜像的 core DDL 与库里记录不一致 | 用与库同版本的镜像；本项目的 core schema 变更会同时改 checksum 与测试 |
| 多副本同时写同一主键丢数据 | 没有 `pg_advisory_xact_lock`（已知缺口） | **单实例部署**；多副本前要补锁 |

## 还是解决不了

把这几样一起拿出来（**别贴 token/密码**）：

1. `curl -s http://127.0.0.1:8080/health` 的输出
2. 启动日志那两行（含 `engine=postgres` 与脱敏 DSN）
3. 出问题的请求：方法 + 路径 + 状态码 + 响应体
4. `TT_ACCESS_LOG=true` 下那一行 `access: …`（能看出代理有没有吃掉认证头）
