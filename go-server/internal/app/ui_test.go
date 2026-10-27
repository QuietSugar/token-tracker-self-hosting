package app

import (
	"encoding/json"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
)

// GET / 是内置只读看板：必须是 HTML、必须自带 CSP、必须不发外部请求。
func TestRootServesReadOnlyDashboard(t *testing.T) {
	s, _ := testServer(t)
	h := s.Handler()

	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/", nil))
	if w.Code != 200 {
		t.Fatalf("GET / status=%d body=%s", w.Code, w.Body.String())
	}
	if ct := w.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Fatalf("GET / content-type=%q, want text/html", ct)
	}
	if cc := w.Header().Get("Cache-Control"); cc != "no-store" {
		t.Fatalf("GET / cache-control=%q, want no-store", cc)
	}
	csp := w.Header().Get("Content-Security-Policy")
	if !strings.Contains(csp, "default-src 'none'") || !strings.Contains(csp, "connect-src 'self'") {
		t.Fatalf("CSP 太松或缺失: %q", csp)
	}
	body := w.Body.String()
	for _, want := range []string{
		`<title>`,
		"/api/auth/sessions",
		"/functions/tokentracker-account-summary",
		"/functions/tokentracker-account-devices",
		"/functions/tokentracker-account-heatmap",
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("看板缺少 %q（页面与端点约定脱节）", want)
		}
	}
	// 零外部资源：不允许出现 http(s):// 形式的 src/href。
	for _, bad := range []string{"src=\"http", "src='http", "href=\"http", "@import url(http", "cdn."} {
		if strings.Contains(body, bad) {
			t.Fatalf("看板引用了外部资源 %q —— 内网没有公网出口时会白屏", bad)
		}
	}
	if title := homeTitle(); !strings.Contains(title, "TokenTracker") {
		t.Fatalf("homeTitle()=%q", title)
	}
}

// HEAD / 只回头，不写 body。
func TestRootHeadHasNoBody(t *testing.T) {
	s, _ := testServer(t)
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, httptest.NewRequest("HEAD", "/", nil))
	if w.Code != 200 {
		t.Fatalf("HEAD / status=%d", w.Code)
	}
	if w.Body.Len() != 0 {
		t.Fatalf("HEAD / body=%d bytes, want 0", w.Body.Len())
	}
}

// 其它未注册路径保持原来的 404 JSON 形状（脚本与客户端依赖它）。
func TestUnknownPathStillJSON404(t *testing.T) {
	s, _ := testServer(t)
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, httptest.NewRequest("GET", "/nope", nil))
	if w.Code != 404 {
		t.Fatalf("GET /nope status=%d, want 404", w.Code)
	}
	if ct := w.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Fatalf("GET /nope content-type=%q, want application/json", ct)
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("GET /nope body not JSON: %v (%s)", err, w.Body.String())
	}
	if body["error"] != "not found" {
		t.Fatalf("GET /nope body=%v", body)
	}
}

// 非 GET/HEAD 的 "/" 明确 405，而不是静默 404。
func TestRootRejectsNonReadMethods(t *testing.T) {
	s, _ := testServer(t)
	w := requestJSON(t, s.Handler(), "POST", "/", "", map[string]any{})
	if w.Code != 405 {
		t.Fatalf("POST / status=%d body=%s", w.Code, w.Body.String())
	}
	if allow := w.Header().Get("Allow"); allow != "GET, HEAD" {
		t.Fatalf("POST / Allow=%q", allow)
	}
}

// 看板底部/按日明细依赖 account-daily 的费用字段：它必须真的累加，
// 而不是常数 0（dayAgg.TotalCostUSD 曾经是 int64 且从未赋值）。
func TestAccountDailySumsCost(t *testing.T) {
	s, db := testServer(t)
	h := s.Handler()
	uid := "22222222-2222-4222-8222-222222222222"
	if _, err := db.Exec(`INSERT INTO auth_users(id,email) VALUES(?,?)`, uid, "daily@local.test"); err != nil {
		t.Fatal(err)
	}
	jwt := s.signJWT(uid, "authenticated", s.now.Unix()+3600)
	w := requestJSON(t, h, "POST", "/functions/tokentracker-device-token-issue", jwt, map[string]any{
		"device_name": "daily", "platform": "linux", "machine_id": "m-daily",
	})
	if w.Code != 200 {
		t.Fatalf("issue status=%d body=%s", w.Code, w.Body.String())
	}
	var issue map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &issue)
	token, _ := issue["token"].(string)
	if token == "" {
		t.Fatal("missing device token")
	}
	for _, row := range []map[string]any{
		{"hour_start": "2026-10-02T01:00:00Z", "source": "claude", "model": "sonnet-4",
			"input_tokens": 10, "total_tokens": 10, "billable_total_tokens": 10, "total_cost_usd": "0.25"},
		{"hour_start": "2026-10-02T02:00:00Z", "source": "claude", "model": "sonnet-4",
			"input_tokens": 20, "total_tokens": 20, "billable_total_tokens": 20, "total_cost_usd": "0.75"},
	} {
		u := requestJSON(t, h, "POST", "/functions/tokentracker-ingest", token, map[string]any{"buckets": []any{row}})
		if u.Code != 200 {
			t.Fatalf("ingest status=%d body=%s", u.Code, u.Body.String())
		}
	}
	w = requestJSON(t, h, "GET", "/functions/tokentracker-account-daily?from=2026-10-02&to=2026-10-02&tz=UTC", jwt, nil)
	if w.Code != 200 {
		t.Fatalf("daily status=%d body=%s", w.Code, w.Body.String())
	}
	var resp struct {
		Data []struct {
			Day   string  `json:"day"`
			Cost  float64 `json:"total_cost_usd"`
			Total int64   `json:"total_tokens"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Data) != 1 {
		t.Fatalf("daily rows=%d, want 1 (%s)", len(resp.Data), w.Body.String())
	}
	if resp.Data[0].Total != 30 {
		t.Fatalf("daily total=%d, want 30", resp.Data[0].Total)
	}
	if resp.Data[0].Cost < 0.999 || resp.Data[0].Cost > 1.001 {
		t.Fatalf("daily cost=%v, want 1 (按日费用必须累加，不能恒为 0)", resp.Data[0].Cost)
	}
}

// 看板是只读的：页面里只允许两种"写"以外的调用——GET 用量端点，
// 以及唯一一个 POST（拿登录 session）。多出任何写端点都意味着页面越权。
func TestDashboardIsReadOnly(t *testing.T) {
	body := string(homeHTML)
	if n := strings.Count(body, "method:"); n != 1 {
		t.Fatalf("看板里有 %d 处显式 method:，只允许登录那一处", n)
	}
	if !strings.Contains(body, `method: "POST"`) {
		t.Fatal("唯一的 POST 应该用于建立登录会话")
	}
	for _, banned := range []string{
		"tokentracker-ingest", "device-token-issue", "remove-device",
		"resume-device", "device-rename", "cloud-billing",
	} {
		if strings.Contains(body, banned) {
			t.Fatalf("只读看板不应该引用写端点 %q", banned)
		}
	}
	// 页面用的每个 /functions/* 都必须能在服务器的已注册端点里找到，
	// 否则用户打开看板只会看到一片空白。
	registered := map[string]bool{
		"tokentracker-account-summary":         true,
		"tokentracker-account-daily":           true,
		"tokentracker-account-heatmap":         true,
		"tokentracker-account-model-breakdown": true,
		"tokentracker-account-devices":         true,
	}
	for _, m := range regexp.MustCompile(`api\("/functions/([a-z0-9-]+)"`).FindAllStringSubmatch(body, -1) {
		if !registered[m[1]] {
			t.Fatalf("看板调用了未注册/非只读端点 %q", m[1])
		}
	}
	calls := regexp.MustCompile(`api\("/functions/`).FindAllString(body, -1)
	if len(calls) != 5 {
		t.Fatalf("看板只调了 %d 个用量端点，预期 5 个（页面与后端契约不一致）", len(calls))
	}
}

// /health 必须保留 ok:true（编排与镜像 smoke 都在断言），并带上版本与引擎，
// 否则运维排查"容器里跑的是哪个镜像"只能靠猜。
func TestHealthExposesBuildInfo(t *testing.T) {
	s, _ := testServer(t)
	SetBuildInfo("1.2.3", "abc1234")
	defer SetBuildInfo("dev", "unknown")

	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, httptest.NewRequest("GET", "/health", nil))
	if w.Code != 200 {
		t.Fatalf("/health status=%d", w.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["ok"] != true {
		t.Fatalf("/health ok=%v, want true", body["ok"])
	}
	if body["engine"] != "postgres" {
		t.Fatalf("/health engine=%v, want postgres", body["engine"])
	}
	if body["version"] != "1.2.3" || body["ref"] != "abc1234" {
		t.Fatalf("/health version=%v ref=%v", body["version"], body["ref"])
	}
}
