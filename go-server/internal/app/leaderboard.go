package app

import "net/http"

// 社区榜单（`tokentracker-leaderboard`）的空态实现。
//
// 为什么会有这个端点：自托管的 14 个函数里**没有**榜单——上游把它归到
// functions.json 的 `excluded: official community publishing`（见 releases/<ver>/functions/functions.json），
// 官方自托管实例同样不装它。但官方桌面 GUI 的侧边栏是无条件列出「榜单」的
// （dashboard/src/ui/components/Sidebar.jsx 的 getNavGroups），点进去就 GET 一次
// /functions/tokentracker-leaderboard。
//
// 之前我们落进 default 分支返回 404 `{"error":"Function not installed"}`。
// 客户端的 api.ts 对非 2xx 一律 `throw new Error("Request failed with HTTP 404")`，
// 而 LeaderboardPage 只对 `leaderboard-profile` 的 404 做了特判（当作"没有这个人"），
// 对列表接口没有 → 页面正中一行红字「Error: Request failed with HTTP 404」。
// 这不是缺功能，是**拿错误码表达了一个正常的空状态**。
//
// 所以这里返回 200 + 合法的空载荷：页面显示中性的「No data」，落地页的社区统计
// （use-community-stats）拿到空 entries 后走它自己的静态文案分支，与官方"没有数据"一致。
//
// 三条边界，避免把 mock 做成"假数据"：
//   1. **不编造任何榜单条目**。entries 恒为空、me 恒为 null、total_entries 恒为 0；
//      不会凭空出现别的用户，也不会把自己的用量包装成排名。
//   2. 响应体带 `self_hosted: true` 与 `source: "unavailable"`，抓包一眼能看出这不是上游数据。
//   3. 只实现这一个 slug。上游客户端会打的其它社区端点（community-models、profile-likes、
//      public-visibility、leaderboard-refresh）仍然 404——它们要么客户端 `catch` 掉了，
//      要么在非官方实例上根本不发请求（见 docs/design/parity.md §4）。
//
// 公开可读、不鉴权：客户端发这个请求时**故意不带** Authorization
// （api.ts 的注释说明过原因：InsForge 网关对任何 JWT 问题都回 500，会把公开接口一起打挂）。
// 所以这里也不能要求 JWT，否则等于把官方的空态变成 401 红字。
func (s *Server) leaderboard(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		fail(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	// period 只做校验后原样回显：客户端的 tab（week / month / total）都指向同一份空数据，
	// 回显能让"切 tab 没变化"看起来合理，也方便抓包核对客户端确实发了什么。
	period := r.URL.Query().Get("period")
	switch period {
	case "week", "month", "total":
	default:
		period = "week"
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{
		"entries":       []any{},
		"me":            nil,
		"total_entries": 0,
		"total_pages":   0,
		"period":        period,
		"from":          nil,
		"to":            nil,
		"generated_at":  nil,
		"self_hosted":   true,
		"source":        "unavailable",
	})
}
