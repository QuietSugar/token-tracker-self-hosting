package app

import (
	"encoding/json"
	"testing"
)

// 官方 GUI 的榜单页会用这个端点；自托管没有社区数据，必须回**空态**而不是 404。
//
// 404 的后果不是"少一块内容"：客户端 api.ts 对非 2xx 一律 throw，
// LeaderboardPage 只在 error 且无 entries 时渲染一行红字，于是整页是
// 「Error: Request failed with HTTP 404」。这条用例把这个坑钉住。
func TestLeaderboardEmptyState(t *testing.T) {
	s, _ := testServer(t)
	h := s.Handler()

	for _, period := range []string{"", "week", "month", "total", "bogus"} {
		path := "/functions/tokentracker-leaderboard"
		if period != "" {
			path += "?period=" + period
		}
		// 不带 Authorization：客户端打榜单时刻意不带 token（公开读）。
		w, _ := httpDo(t, h, "GET", path, nil, nil, nil)
		if w.Code != 200 {
			t.Fatalf("period=%q status=%d body=%s", period, w.Code, w.Body.String())
		}
		var got struct {
			Entries      []any   `json:"entries"`
			Me           any     `json:"me"`
			TotalEntries int     `json:"total_entries"`
			TotalPages   int     `json:"total_pages"`
			Period       string  `json:"period"`
			From         any     `json:"from"`
			GeneratedAt  any     `json:"generated_at"`
			SelfHosted   bool    `json:"self_hosted"`
			Source       *string `json:"source"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
			t.Fatalf("period=%q 响应不是合法 JSON: %v (%s)", period, err, w.Body.String())
		}
		// 空态：不能有编造的条目，也不能有"当前用户排名"
		if len(got.Entries) != 0 || got.Me != nil {
			t.Fatalf("period=%q 不该编造榜单内容: %s", period, w.Body.String())
		}
		if got.TotalEntries != 0 || got.TotalPages != 0 || got.From != nil || got.GeneratedAt != nil {
			t.Fatalf("period=%q 计数应为 0 / 时间应为 null: %s", period, w.Body.String())
		}
		// 自证：抓包能看出这不是上游数据
		if !got.SelfHosted || got.Source == nil || *got.Source != "unavailable" {
			t.Fatalf("period=%q 缺少自托管标记: %s", period, w.Body.String())
		}
		want := period
		if want == "" || want == "bogus" {
			want = "week"
		}
		if got.Period != want {
			t.Fatalf("period 回显 %q，期望 %q", got.Period, want)
		}
		// 关键响应头：浏览器跨域读它，缺了就是 CORS 失败
		if o := w.Header().Get("Access-Control-Allow-Origin"); o != "*" {
			t.Fatalf("period=%q 缺 Allow-Origin（得到 %q）", period, o)
		}
		if w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("period=%q 缺 no-store", period)
		}
	}
}

// 空态端点不能变成"什么 slug 都回 200"的兜底。
//
// 未安装的 slug 仍按原语义走：先鉴权（无凭据 401），认证后 404 `Function not installed`。
// 两道都不放过 200，否则等于把所有未实现的函数都伪装成"可用但没数据"。
func TestUnknownFunctionStillNotFound(t *testing.T) {
	s, _ := testServer(t)
	h := s.Handler()
	mustSignUp(t, h, "lb-unknown@example.com", "correct horse battery")
	wLogin, _ := httpDo(t, h, "POST", "/api/auth/sessions",
		map[string]any{"email": "lb-unknown@example.com", "password": "correct horse battery"}, nil, nil)
	if wLogin.Code != 200 {
		t.Fatalf("sign-in status=%d body=%s", wLogin.Code, wLogin.Body.String())
	}
	var sess struct {
		AccessToken string `json:"accessToken"`
	}
	_ = json.Unmarshal(wLogin.Body.Bytes(), &sess)

	for _, slug := range []string{
		"tokentracker-community-models",
		"tokentracker-leaderboard-profile",
		"tokentracker-telemetry",
		"tokentracker-nope",
	} {
		// 无凭据：这些 slug 不是公开入口，仍是 401（顺带确认 leaderboard 的公开规则没有扩散）
		wAnon, _ := httpDo(t, h, "GET", "/functions/"+slug, nil, nil, nil)
		if wAnon.Code != 401 {
			t.Fatalf("%s 无凭据应 401，得到 %d（body=%s）", slug, wAnon.Code, wAnon.Body.String())
		}
		// 带凭据：404 `Function not installed`，不是 200 空态
		wAuth, _ := httpDo(t, h, "GET", "/functions/"+slug, nil,
			map[string]string{"Authorization": "Bearer " + sess.AccessToken}, nil)
		if wAuth.Code != 404 {
			t.Fatalf("%s 认证后应 404，得到 %d（body=%s）", slug, wAuth.Code, wAuth.Body.String())
		}
	}
}

// 预检仍然在鉴权之前短路，且不影响真请求的鉴权边界（回归 #38）。
func TestLeaderboardPreflightAndAuthBoundary(t *testing.T) {
	s, _ := testServer(t)
	h := s.Handler()

	w, _ := httpDo(t, h, "OPTIONS", "/functions/tokentracker-leaderboard", nil,
		map[string]string{"Origin": "http://127.0.0.1:17680", "Access-Control-Request-Method": "GET"}, nil)
	if w.Code != 204 {
		t.Fatalf("预检 status=%d", w.Code)
	}
	if hdr := w.Header().Get("Access-Control-Allow-Headers"); hdr != "Content-Type, Authorization, apikey" {
		t.Fatalf("预检 Allow-Headers=%q", hdr)
	}

	// 榜单公开可读，但**别的**账户读端点不能因为这条公开规则被放开。
	w2, _ := httpDo(t, h, "GET", "/functions/tokentracker-account-summary?from=2026-10-01&to=2026-10-02", nil, nil, nil)
	if w2.Code != 401 {
		t.Fatalf("account-summary 无凭据应 401，得到 %d", w2.Code)
	}
}
