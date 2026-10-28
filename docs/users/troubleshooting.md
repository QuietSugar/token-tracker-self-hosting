# 故障排查

按观察到的现象查找。每条均给出「怎么确认」与「怎么办」；无法定位时先查看日志。

**首先执行以下两条**：

```sh
curl -s http://127.0.0.1:8080/health                     # {"ok":true,"engine":"postgres",…}
docker compose -f docker-compose.postgres-go.example.yml logs --tail 50 tokentracker-go
# 或 journalctl -u tokentracker -n 50
```

---

## 启动失败

| 现象 | 原因 | 处理 |
|---|---|---|
| `TT_JWT_SECRET is required and must be at least 32 bytes` | 密钥未设置或长度不足 | `openssl rand -hex 32` |
| `TT_DATABASE_URL … required` / 提示 SQLite 已移除 | 未提供 PG 连接串，或提供了文件路径 | 只支持 `postgres://…`，见 [`deploy.md`](deploy.md) §4 |
| `database not reachable …` | PG 未启动 / DSN 错误 / `sslmode` 错误 / 网络不通 | `pg_isready -h … -U …`；服务会重试 30 秒后退出 |
| `schema migration 1 checksum drift` | 新版本二进制连接了表结构被外部修改的库 | 换回对应版本镜像；不要手工修改表结构 |
| `sql: unknown driver "postgres"` | 使用了裁剪过的构建 | 使用官方镜像，或执行 `go build ./cmd/server` |
| 容器无法启动，`read_only` 相关报错 | `/tmp` 不可写 | compose 已配置 `tmpfs: /tmp`；自行编写 compose 时需一并配置 |
| 端口被占用 | 8080 端口已被占用 | 修改 `TT_PORT`（compose）或 `TT_LISTEN_ADDR` |

---

## 认证 / 401

| 现象 | 原因 | 处理 |
|---|---|---|
| 所有请求 401 | JWT 与 `TT_JWT_SECRET` 不一致 / 已过期 / 结构错误 | 用 jwt.io 解析 payload，查看 `exp` 与 `sub`；确认签发方使用同一 secret |
| **密码可登录，但所有 `/functions/*` 均 401** | 反向代理 / SSO / 网关将 `Authorization` 头当作自身凭据消费 | 见下文 |
| `403 server role required` | 调用 `/api/database/rpc/*` 但 token 不是 `project_admin` | 使用服务角色 token，或改用 `/functions/*` |
| `401` 但仅部分端点 | 各端点鉴权方式不同：`device-flow-authorize/poll` 为公开端点，`ingest` 需要 device token，其余需要 JWT | 按端点区分处理 |
| 看板登录后立即返回登录页 | access token 一小时后过期且 refresh 失败 | 页面会列出具体请求与状态码；查看日志中的 `/api/auth/refresh` |

**确认是否为代理吞掉认证头**：

```sh
TT_ACCESS_LOG=true docker compose … up -d
# 日志：access: GET /functions/tokentracker-account-summary 401 auth=no origin=https://tt.lan ua="…"
#                                              ↑ auth=no 表示请求到达服务端时已无 Authorization
```

`auth=` 的取值：`yes`（携带 Bearer）、`no`（未携带）、`device-hash`（携带客户端自身的 device-token 哈希头）。

解决方式：让代理透传 `Authorization`；或改用 `X-TokenTracker-Token: Bearer <jwt>`（服务端同样接受，内建看板同时发送两个请求头）。
另需注意，部分网关会**改写** `Authorization`（例如替换为其自身的 JWT），属于同一类问题。

---

## 无数据 / 数字不符

| 现象 | 原因 | 处理 |
|---|---|---|
| 上传返回 `inserted: 0` | 桶缺失 `hour_start` / `source` / `model`，或全部被判为无效 | 检查请求体；`skipped` 会同时给出数量 |
| `No usage buckets provided` (400) | 请求中确实不含用量桶 | 旧版客户端遇到「仅含 `account_session_states` 的批次」会陷入循环，请升级服务端（本版本对该情况返回 200） |
| `Upload too large` / `Too many buckets` | 单次 body >1 MiB / >500 桶 | 客户端会自动分批；自行编写脚本时需注意 |
| **「当日有数据但查询为空」** | 缺少 `tz` / `tz_offset_minutes`，按 UTC 归日 | 补上时区参数，或查看看板（自动携带浏览器时区） |
| 周期内数据缺失 | 使用的是「本月」等固定窗口 | 切换到「全部」或传入更早的 `from` |
| 某台设备显示「无用量」 | 该时间范围内确实没有上传 | 切换到「全部」查看；或确认其 device token 未被暂停 |
| 汇总低于预期 | 有设备被暂停（token 被撤销），历史仍在但不再增长 | 通过 `billing?action=devices` 查看状态，并用 `resume-device` 恢复 |
| 数字重复 | 同一批数据以两种时间戳形式（`…T00:30:00.000Z` 与 `…T00:30:00Z`）各上传了一次 | 见 [`importing.md`](importing.md) 结尾的三项原因 |

---

## 官方客户端

| 症状 | 原因 | 处理 |
|---|---|---|
| `InsForge URL must use HTTPS, or HTTP on localhost…` | `base_url` 为局域网 IP 的明文 http | 改用 `https://` 或 localhost，见 [`official-client.md`](official-client.md) §2 |
| `UNABLE_TO_VERIFY_LEAF_SIGNATURE` | 未将私有 CA 告知 Node | `export NODE_EXTRA_CA_CERTS=/path/to/ca.pem` |
| `Device authorization returned a different dashboard` | 服务端推导出的 `verification_uri` 与客户端 `base_url` 不同源（反向代理未透传 `Host` / `X-Forwarded-Proto`） | 修正反向代理；或将 `TT_DASHBOARD_URL` 设为与 `base_url` 完全一致 |
| `device-login` 持续处于 pending | 尚未批准（默认 `page` 模式等待浏览器确认；`jwt` 模式等待 `approve-device.sh`） | 打开客户端输出的 `/device?user_code=…` 并确认批准；无头机器改用 `TT_DEVICE_APPROVE=auto` |
| `/device` 页面无法打开 | `TT_DASHBOARD_URL` 被固定为不可达地址 | 留空，由请求推导 |
| `sync` 输出 `skipped (no device token)` | 尚未执行 `device-login`（更换 `base_url` 会清除 token） | 重新执行 `device-login` |
| `sync` 持续失败、`HTTP 400` | 见上一节的 `No usage buckets provided`；旧版服务端会使队列阻塞 | 升级服务端；阻塞的队列可用 `replay-queue.py` 重放 |
| 跨设备视图为空 | 无 owner 账户或未登录 | 见 [`official-client.md`](official-client.md) §4 |
| `doctor` 报告失败项 | 先确认其报告的是哪个端点 | 多为 404（telemetry 可忽略）或 TLS 问题 |

---

## 看板

| 现象 | 原因 | 处理 |
|---|---|---|
| 打开 `/` 为空白 / 白屏 | 浏览器扩展或代理修改了 CSP | 查看控制台；页面无外部资源，正常情况下不应白屏 |
| 登录提示「登录已失效」并带一段 `HTTP 401` | 见「认证 / 401」一节，页面会列出具体端点与状态码 | 先查看括号内的信息 |
| 设备下拉列表中缺少某台设备 | 该设备已被暂停（撤销） | 通过 `billing?action=devices` 查看，并用 `resume-device` 恢复 |
| 数字与官方 dashboard 不一致 | 时区不同 / 官方 dashboard 连接的是官方云 | 内建看板自动携带浏览器时区；确认两边 `base_url` 指向同一服务 |

---

## 数据库 / 升级

| 现象 | 原因 | 处理 |
|---|---|---|
| PG 重启后无法连接 | 连接池中存在失效连接 | 会在 `ConnMaxLifetime`（30m）内自愈；需立即恢复时重启服务容器 |
| 升级后报 checksum drift | 新镜像的 core DDL 与库中记录不一致 | 使用与库同版本的镜像；本项目的 core schema 变更会同步更新 checksum 与测试 |
| 多副本同时写同一主键导致数据丢失 | 缺少 `pg_advisory_xact_lock`（已知缺口） | **采用单实例部署**；启用多副本前需补充锁 |

## 仍无法解决时

请一并提供以下信息（**请勿贴出 token / 密码**）：

1. `curl -s http://127.0.0.1:8080/health` 的输出
2. 启动日志那两行（含 `engine=postgres` 与脱敏 DSN）
3. 出现问题的请求：方法 + 路径 + 状态码 + 响应体
4. `TT_ACCESS_LOG=true` 下那一行 `access: …`（可判断代理是否吞掉认证头）
