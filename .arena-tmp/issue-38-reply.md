确认是 bug，已修并合并（#39，commit `75e9b00`）。镜像已出：

```
ghcr.io/quietsugar/token-tracker-self-hosting-go:experimental            # 指向最新 main（含本次修复）
ghcr.io/quietsugar/token-tracker-self-hosting-go:experimental-75e9b00
ghcr.io/quietsugar/token-tracker-self-hosting-go:sha-75e9b00
```

```sh
docker compose pull && docker compose up -d
```

## 你的定位完全正确

`functions()` 的顺序是 `applyCORS` → `s.auth()`，**OPTIONS 预检也走了鉴权**，无 JWT 直接 401。
`/api/auth/*` 的入口（`authAPI`）早就在鉴权之前对 `OPTIONS` 短路回 204，`/functions/*` 漏了这一步。

浏览器对带 `Authorization` 的跨域请求必发预检；预检 401 → 真请求根本不发。所以 GUI 是
「密码登录成功（`/api/auth/*` 有短路）→ 其余全部连不上」，而 CLI 走本地 relay（Node，不受 CORS 约束），
契约客户端也不发预检 —— 两个盲区叠加，才让这个洞一直留到现在。

## 改了什么

```go
applyCORS(w, slug)
if r.Method == http.MethodOptions {   // 新增：鉴权之前短路
    w.WriteHeader(http.StatusNoContent)
    return
}
```

- 与 `/api/auth/*` 一致：**204 + 保留 `applyCORS` 按 slug 设好的头**（billing 的 `Allow-Headers`
  含 `apikey`、ingest 的含 `x-tokentracker-device-token-hash`，都原样保留）；
- **真请求不受影响**：预检只回 204 空响应，无凭据的 GET/POST 仍然 401（有回归用例钉住）；
- 顺带把 `/api/selfhost/*`（内建看板的设备清单端点）也放行预检 —— 同源本来用不到，
  但从别处打开看板、或反代换域名时会踩同一个坑。

## 你实例上要做的两件事

1. **升到 `75e9b00` 或更新的镜像**（上面那组 tag）。
2. **删掉 nginx 里那段 OPTIONS 兜底**：

   ```nginx
   # 删除
   if ($request_method = OPTIONS) { return 204; }
   ```

   留着不会报错，但它只补了你手写的那几个头，会盖掉服务端按端点设置的
   `Access-Control-Allow-Headers`（比如 ingest 的 device-token 头、billing 的 `apikey`）。
   升级后让服务端自己回预检更准确。反代只需照旧透传 `Host` / `X-Forwarded-Proto` / `Authorization`。

## 验证

- 新增 `go-server/internal/app/cors_preflight_test.go`：逐 slug 断言 204 + `Allow-Origin`/`Allow-Methods`；
  billing 与 ingest 的 `Allow-Headers` 各自原样保留；`/api/selfhost/devices` 同样 204；
  并断言预检放行后无凭据的真请求仍然 401。
- 实跑（真二进制 + PG），按你给的复现命令：

  ```
  $ curl -X OPTIONS /functions/tokentracker-billing -H "Origin: http://127.0.0.1:17680" \
      -H "Access-Control-Request-Method: GET" -H "Access-Control-Request-Headers: authorization" -i
  HTTP/1.1 204 No Content
  Access-Control-Allow-Headers: Content-Type, Authorization, apikey
  Access-Control-Allow-Methods: GET, POST, OPTIONS
  Access-Control-Allow-Origin: *
  Cache-Control: no-store
  ```

  billing / leaderboard / account-summary / account-devices / ingest / device-flow-authorize / device-rename
  七个入口全部 204；带 JWT 的真请求 200，无凭据仍 401。
- 契约 33 PASS / 0 FAIL / 2 SKIP，`go test -race ./...` 全绿。

## 你「附带观察」的解释

GUI 的请求确实是分流的：本机 relay（`127.0.0.1:17680`，Node 进程代理到 `base_url`）不受 CORS 约束，
所以一部分页面正常；由 webview **直连** `base_url` 的那部分才吃预检。修好之后两条链路都能通，
不需要关心某个端点走哪条。如果升级后仍有端点异常，把 `TT_ACCESS_LOG=1` 的日志贴上来，我看具体是哪条链路。

## 一点补充（同一批改动里修的另一件事）

合并后 main 的 `go-server` 流水线在 postgres 16 矩阵上偶发失败（退出码 2，无断言差异）——
是契约适配器的端口分配用了「随机但不探测占用」，并发两个 case 撞端口导致 Go 进程 bind 失败。
已在 #40 修掉（内核分配端口 + 重试），与此 bug 无关，仅说明一下以免你看到红色记录以为契约不稳。
