## 两个诉求都已落地，拉新镜像即可

```sh
docker compose pull && docker compose up -d
```

镜像：`ghcr.io/quietsugar/token-tracker-self-hosting-go:experimental`
（= main `b7aadcc`，另有 `:experimental-b7aadcc`）。升级不需要动数据库，不用重新登录。

注意时间线：你这条 issue 是 `10:23:35Z` 提的，而修 leaderboard 的 #43 是 `10:20:21Z` 合并的 ——
差 3 分钟，所以你报的时候镜像里还没有它。

---

### 1. leaderboard 挂成公开空榜 —— 已做（#43）

你建议的第一条，实现如下：

```
GET /functions/tokentracker-leaderboard?period=total&limit=25&offset=0
Origin: http://127.0.0.1:17680
apikey: <anon>

HTTP/1.1 200 OK
Access-Control-Allow-Headers: Content-Type, Authorization, apikey
Access-Control-Allow-Methods: GET, OPTIONS
Access-Control-Allow-Origin: *
Cache-Control: no-store

{"entries":[],"me":null,"total_entries":0,"total_pages":0,"period":"total",
 "from":null,"to":null,"generated_at":null,"self_hosted":true,"source":"unavailable"}
```

- `entries` 恒空、`me` 恒 null，**不编造任何榜单条目**（自托管没有"全站"，编出来的数字只会误导）；
- `self_hosted: true` / `source: "unavailable"` 是给你的：抓包或截图时一眼能看出这不是上游数据；
- `period` 校验后回显（week/month/total，非法值归 week），方便核对客户端实际发了什么；
- 公开不鉴权 —— 正如你观察到的，客户端打榜单时**故意不带** `Authorization`（`api.ts` 里的注释：
  InsForge 网关对任何 JWT 问题都回 500），所以这里要求 JWT 就等于把空态变成 401 红字。

客户端侧正好命中它自己的空态分支（`copy("leaderboard.empty")` → "No data"），落地页的社区统计
拿到空 entries 后走静态文案分支。

### 2. 未实现函数回 404 而不是 401 —— 也做了（#45）

这条是根因，比单个端点更重要。之前 `functions()` 先鉴权再分发，所以"没实现"和"没登录"是同一个 401；
现在加了白名单，**未实现的 slug 在 `s.auth()` 之前直接回 404**：

- 未实现 → `404 {"error":"Function not installed"}`（客户端只会当成普通失败，不会归到 `authentication_required`）；
- 已实现但没凭据 → 仍 `401`（契约里 `ingest/unauthenticated-rejected`、`billing/unauthenticated` 锁着这条）。

覆盖你附注里担心的那类：`leaderboard-profile`、`community-models`、`public-visibility`、
`profile-likes`、`telemetry`、`sessions`、`pets`……以及**以后任何新增的上游端点**，都不会再被误判成登录失效。
`leaderboard-profile` 拿到 404 后，客户端有 `if (err?.status === 404) → 空态` 的特判，正好走
「查无此人 / 只有本地徽章」，与官方语义一致。

关于你写的「404 是否会被 GUI 更好处理未验证」——我读了 1.5.0 的源码确认了：

| 端点 | 客户端对 404 的处理 |
|---|---|
| `leaderboard-profile` | `useLeaderboardProfileData` 里 `err?.status === 404 → data: null`，渲染空态 |
| `community-models` | `useCommunityStats` 里 `.catch(() => null)`，静默降级 |
| `telemetry` | 完全忽略 |
| `leaderboard`（列表） | **无特判**，`fetchInsforgeFunction` 直接 throw → 这才是唯一会渲染成红字的那个，已改成 200 空态 |

### 3. 你的 nginx 临时规避可以删了

```nginx
# 删掉
location = /functions/tokentracker-leaderboard { return 200 '{"entries":[]}'; }
```

留着也能跑（和 #38 那次一样，只是多了一层不需要的兜底），但升级后服务端自己会给 200 空态，
反代保持纯 `proxy_pass` 更省事。

---

### 关于「客户端把 401 一律归类成鉴权失效」

这是上游客户端的一个设计缺陷（缺少"函数不存在"这一类错误），但短期不值得指望它改：
服务端侧按上面的规则回码，就已经让这个缺陷不会再被触发。如果你愿意，可以把这条连同
「self_hosted 实例应隐藏/降级云服务页」一起整理成上游 issue —— 我这边可以提供完整的时间线与响应码对照。

验证：`go vet` 干净、`go test -race ./...` 全绿，契约 33 PASS / 2 SKIP；实跑真二进制复现了你的请求形状
（上面那段 200 就是实测输出）。issue 保持打开，你验证后自行决定关闭。
