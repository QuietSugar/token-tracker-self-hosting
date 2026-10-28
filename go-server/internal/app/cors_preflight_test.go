package app

import (
	"testing"
)

// 回归：/functions/* 的 CORS 预检必须放行。
//
// 背景（真实故障）：官方桌面 GUI（Tauri/WebView2）的 webview 直连 base_url 调 /functions/*，
// 带 Authorization 头的跨域请求会先发 OPTIONS 预检。预检以前也走 s.auth()，
// 无 JWT 直接 401 → 浏览器不发真正的请求 → GUI 显示「连接中断 / 机器列表不显示」。
// CLI 走本地 relay（Node，不受 CORS 约束），契约客户端也不发预检，所以这个洞长期没被发现。
func TestFunctionsCORSPreflightIsAllowed(t *testing.T) {
	s, _ := testServer(t)
	h := s.Handler()

	// 覆盖三类：需要 JWT 的、公开的、用 device token 的。
	slugs := []string{
		"tokentracker-billing",
		"tokentracker-account-summary",
		"tokentracker-account-devices",
		"tokentracker-device-flow-authorize",
		"tokentracker-ingest",
	}
	for _, slug := range slugs {
		w := requestJSON(t, h, "OPTIONS", "/functions/"+slug, "", nil)
		if w.Code != 204 {
			t.Fatalf("%s 预检 status=%d，期望 204（body=%s）", slug, w.Code, w.Body.String())
		}
		if got := w.Header().Get("Access-Control-Allow-Origin"); got != "*" {
			t.Fatalf("%s 预检缺少 Access-Control-Allow-Origin（得到 %q）", slug, got)
		}
		if got := w.Header().Get("Access-Control-Allow-Methods"); got == "" {
			t.Fatalf("%s 预检缺少 Access-Control-Allow-Methods", slug)
		}
	}

	// 预检必须带上该 slug 自己的 Allow-Headers（billing 要 Authorization + apikey）。
	w := requestJSON(t, h, "OPTIONS", "/functions/tokentracker-billing", "", nil)
	if got := w.Header().Get("Access-Control-Allow-Headers"); got != "Content-Type, Authorization, apikey" {
		t.Fatalf("billing 预检 Allow-Headers=%q，期望按 corsProfiles 输出", got)
	}
	// ingest 的头集合与账户类不同，也要保留。
	w = requestJSON(t, h, "OPTIONS", "/functions/tokentracker-ingest", "", nil)
	if got := w.Header().Get("Access-Control-Allow-Headers"); got != "Content-Type, Authorization, apikey, x-tokentracker-device-token-hash" {
		t.Fatalf("ingest 预检 Allow-Headers=%q", got)
	}

	// 看板自己的端点（/api/selfhost/*）同样要放行预检。
	w = requestJSON(t, h, "OPTIONS", "/api/selfhost/devices", "", nil)
	if w.Code != 204 {
		t.Fatalf("/api/selfhost/devices 预检 status=%d，期望 204", w.Code)
	}
	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("/api/selfhost/devices 预检缺少 Access-Control-Allow-Origin（得到 %q）", got)
	}

	// 预检放行不能顺带把真请求也放行：无凭据的 GET 仍然 401。
	if r := requestJSON(t, h, "GET", "/functions/tokentracker-account-summary?from=2026-10-01&to=2026-10-02", "", nil); r.Code != 401 {
		t.Fatalf("无凭据 GET status=%d，期望 401", r.Code)
	}
	if r := requestJSON(t, h, "GET", "/api/selfhost/devices", "", nil); r.Code != 401 {
		t.Fatalf("无凭据 GET /api/selfhost/devices status=%d，期望 401", r.Code)
	}
}
