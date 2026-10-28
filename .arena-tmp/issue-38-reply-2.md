## 后续实测的两个问题都已修，新镜像可用

先说结论：你那条「后续实测」里的两件事，**一件是我们的 bug（已修）**，一件是上游客户端的（服务端兜住了）。

```sh
docker compose pull && docker compose up -d      # go 镜像 :experimental 已更新
```

镜像：`ghcr.io/quietsugar/token-tracker-self-hosting-go:experimental`（= main `86413e6`），
另有 `:experimental-86413e6`。升级会自动补两个列（additive step 3），**已有会话和用量不受影响**，
不需要删库重来。

---

### 1. 云服务页「登录状态需要刷新」——已修（服务端）

你没读错客户端，机制判断也对，补一个关键细节：**不只是「没做到各持一份」，而是同一份 token 被并发用**。

`/api/auth/refresh` 是轮换语义（旧行立刻 `revoked_at`，发新行）。webview 里几个组件几乎同时 mint 时：
先到的 200、后到的撞 `REFRESH_TOKEN_REUSED` 401；前端把 401 当鉴权失效 → 重试 → 又撞 → 就是你在日志里看到的
200/401 高频交替。CLI relay 每 60s 轮换一次全部 200，正好和 webview 的 401 时间线错开，所以 relay 侧看不出问题。

客户端没有 single-flight，这个我们改不了，所以由服务端兜住：

- **轮换加 60 秒宽限期**：因*轮换*而失效的旧 token，60s 内再用仍可换一份新会话，响应头
  `X-TokenTracker-Refresh: grace`。并发里每一个响应拿到的 token 都是可用的。
- 判据只看新加的 `rotated_at`，不看 `revoked_at` —— 因为登出、泄露处置也写 `revoked_at`，那些**没有**宽限。
- **超出宽限期仍是 401**，并带上你要求的那个标记：

  ```
  HTTP/1.1 401 Unauthorized
  X-TokenTracker-Auth-Error: refresh_token_reused
  Cache-Control: no-store
  {"code":"REFRESH_TOKEN_REUSED", ...}
  ```

  这样客户端能区分「重试无用，需要重新登录」和「重试即可」。宽限期这一侧用的是 `X-TokenTracker-Refresh: grace`。
- 严格模式不变：`TT_AUTH_REVOKE_ON_REUSE=true` 一次重放即拒绝并撤销该用户全部会话。

顺带修了一个被宽限期放大的老问题：**用「已经被换掉的旧 token」登出等于没登出**（原来的 `WHERE … AND revoked_at IS NULL`
什么都撤不到，而并发 mint 里没抢到先到的那个组件手里正好是旧 token）。现在 `authLogout` 顺着新加的 `parent_id`
递归撤销整条接替链，并清掉链上的 `rotated_at`，登出不会又被宽限期救活。

验证：

- 真二进制 + 真 PG，**6 个并发请求同一份 refresh token → 6×200**（修复前 1×200 + 5×401）；
- 用旧 token 登出 → 6 份接替者全部 401；
- 单线程连续轮换 3 次正常；
- 升级路径实测：先用 main 旧二进制跑到 step 2，再换新二进制启动 → 自动补列、owner 与已有会话都在；
- 单测 `TestAuthRefreshGraceWindow` / `TestAuthRefreshGraceBoundaries`，`go test -race ./...` 全绿。

**代价（已写进 `docs/design/auth.md`）**：宽限窗口内一份被偷走的旧 token 仍能换到新会话 —— 定位是局域网自用，
要零宽限就开严格模式。另外并发 mint 会多签几行会话，`/api/auth/sessions` 列表里能看到，这是「每个并发响应都必须可用」
的必然结果（改成原地重签同一行，先拿到响应的组件下一次刷新就会失效，等于把 bug 挪个位置）。

至于「GUI 对 self_hosted 实例应隐藏云服务页」——同意这是上游的产品问题，不在本仓库范围。如果你愿意，可以把上面这段
整理成上游 issue，我这边可以提供日志时间线。

---

### 2. 顺带：契约在 CI 上的偶发红

你可能会看到 main 上 `go-server` 流水线某次 postgres 16 矩阵失败（退出码 2、没有 `report.md`）。那与鉴权无关：
契约适配器的端口分配用了「随机但不探测占用」，并发两个用例撞端口时 Go 进程 bind 失败，被记成 `runnerError`。
已改成内核分配端口 + 重试（#40），此后 main 的矩阵连绿。

---

issue 我保持打开，你实测完再决定关不关。GUI 那边如果还有别的端点异常，把 `TT_ACCESS_LOG=1` 的日志贴上来。
