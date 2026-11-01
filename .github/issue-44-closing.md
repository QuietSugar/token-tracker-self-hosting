维护者确认已修好，关闭。

两个根因都在本仓库解决：

- `tokentracker-leaderboard` 现在回 **200 空态**（`entries: []`，公开、故意不要求 JWT）—— PR #43
- 其余未实现 slug（`leaderboard-profile`、`sessions`、`pets`…）回 **404 `Function not installed`，且在鉴权之前** —— PR #45

main 上 `go-server` 矩阵跑的是全量 `go test -race ./...`，含 `TestLeaderboardEmptyState`、`TestUnimplementedFunctionIs404BeforeAuth`、`TestLeaderboardPreflightAndAuthBoundary`；契约 golden 对这 7 个 slug 也按 404 断言。

如果之前给 `/functions/tokentracker-leaderboard` 加了 nginx 兜底（直接回 `200 {"entries":[]}`），现在可以删掉 —— 留着会遮住真实响应。
