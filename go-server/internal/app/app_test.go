package app

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/QuietSugar/tokentracker-selfhost-go/internal/store"
	_ "github.com/lib/pq"
)

// ttTestDSN 是测试库连接串。存储层只支持 PostgreSQL，所以没有"零依赖默认值"：
// 未设置时直接失败并给出起库命令，而不是悄悄跳过测试。
const ttTestDSNEnv = "TT_TEST_DATABASE_URL"

func requireTestDSN(t *testing.T) string {
	t.Helper()
	dsn := os.Getenv(ttTestDSNEnv)
	if dsn == "" {
		t.Fatalf("%s is not set: the store layer is PostgreSQL-only.\n"+
			"  go-server/scripts/test-with-pg.sh            # 起一个临时 PG 并打印 DSN\n"+
			"  export TT_TEST_DATABASE_URL=postgres://tokentracker:tokentracker-dev@127.0.0.1:55432/tokentracker?sslmode=disable\n"+
			"  go test -race ./...", ttTestDSNEnv)
	}
	return dsn
}

// testDB 返回一个隔离的存储层实例：每个测试用独立 schema（tt_test_<hex>），
// 结束时 DROP SCHEMA CASCADE，因此测试可以并发跑同一个库。
func testDB(t *testing.T) *store.DB {
	t.Helper()
	ctx := context.Background()
	db, err := store.Open(ctx, store.Config{
		DSN:               requireTestDSN(t),
		Schema:            "tt_test_" + strings.ToLower(randomHex(6)),
		DropSchemaOnClose: true,
	})
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := store.Install(ctx, db); err != nil {
		t.Fatal(err)
	}
	return db
}

func testServer(t *testing.T) (*Server, *store.DB) {
	t.Helper()
	// 冻结时钟：生产默认用真实时间（见 New），但测试里的断言写着具体日期，
	// 必须让"今天"是确定的，否则用例会随运行日期漂移。
	t.Setenv("TT_NOW", "2026-10-26T00:00:00Z")
	db := testDB(t)
	return New(db), db
}
func requestJSON(t *testing.T, h http.Handler, method, path, token string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatal(err)
		}
	}
	r := httptest.NewRequest(method, path, &buf)
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	if body != nil {
		r.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestJWTRejectsForgeryAndExpiry(t *testing.T) {
	s, _ := testServer(t)
	tok := s.signJWT("user-1", "authenticated", s.now.Unix()+60)
	if _, _, ok := s.verifyJWT(tok); !ok {
		t.Fatal("valid token rejected")
	}
	if _, _, ok := s.verifyJWT(tok[:len(tok)-3] + "xxx"); ok {
		t.Fatal("forged token accepted")
	}
	expired := s.signJWT("user-1", "authenticated", s.now.Unix()-1)
	if _, _, ok := s.verifyJWT(expired); ok {
		t.Fatal("expired token accepted")
	}
}

func TestDeviceFlowAndIngestWholeRowCorrection(t *testing.T) {
	s, db := testServer(t)
	h := s.Handler()
	uid := "11111111-1111-4111-8111-111111111111" // 普通随机账户（无特殊含义）
	if _, err := db.Exec(`INSERT INTO auth_users(id,email) VALUES(?,?)`, uid, "a@local.test"); err != nil {
		t.Fatal(err)
	}
	// device token issue
	w := requestJSON(t, h, "POST", "/functions/tokentracker-device-token-issue", s.signJWT(uid, "authenticated", s.now.Unix()+3600), map[string]any{
		"device_name": "test", "platform": "test", "machine_id": "m1",
	})
	if w.Code != 200 {
		t.Fatalf("issue status=%d body=%s", w.Code, w.Body.String())
	}
	var issue map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &issue)
	token, _ := issue["token"].(string)
	if token == "" {
		t.Fatal("missing token")
	}
	row := map[string]any{"hour_start": "2026-10-01T12:00:00Z", "source": "codex", "model": "gpt-6", "input_tokens": 100, "total_tokens": 100, "billable_total_tokens": 100, "conversation_count": 1}
	for _, n := range []int{100, 60} {
		row["input_tokens"] = n
		row["total_tokens"] = n
		row["billable_total_tokens"] = n
		u := requestJSON(t, h, "POST", "/functions/tokentracker-ingest", token, map[string]any{"buckets": []any{row}})
		if u.Code != 200 {
			t.Fatalf("ingest status=%d body=%s", u.Code, u.Body.String())
		}
	}
	var total int
	if err := db.QueryRow(`SELECT sum(total_tokens) FROM hourly WHERE user_id=?`, uid).Scan(&total); err != nil {
		t.Fatal(err)
	}
	if total != 60 {
		t.Fatalf("whole-row correction total=%d, want 60", total)
	}
}

func TestOwnerIsolationAndUnknownAccount(t *testing.T) {
	s, _ := testServer(t)
	h := s.Handler()
	w := requestJSON(t, h, "GET", "/functions/tokentracker-account-summary?from=2026-10-01&to=2026-10-01", "", nil)
	if w.Code != 401 {
		t.Fatalf("anonymous account read status=%d", w.Code)
	}
	service := s.signJWT("service", "project_admin", s.now.Unix()+3600)
	w = requestJSON(t, h, "POST", "/api/database/rpc/cloud_create_order", service, map[string]any{})
	if w.Code != 500 {
		t.Fatalf("self-hosted paid order status=%d", w.Code)
	}
}

// TestDeviceIssueCreatesAccountOnFirstUse 覆盖「自托管没有注册流程」的真实路径：
// 一个全新的 sub（数据库里没有 auth_users 行）直接调 device-token-issue，
// 必须自动建账并签发成功，随后的 ingest 与 summary 都要能看到数据。
// 回归背景：device-token-issue 曾因 devices.user_id 外键失败，
// 表现为「服务装好了却传不上去」；契约用例都先建了用户，所以没覆盖到。
func TestDeviceIssueCreatesAccountOnFirstUse(t *testing.T) {
	s, db := testServer(t)
	h := s.Handler()
	uid := "22222222-2222-4222-8222-222222222222" // 故意不预先 INSERT auth_users

	w := requestJSON(t, h, "POST", "/functions/tokentracker-device-token-issue",
		s.signJWT(uid, "authenticated", s.now.Unix()+3600),
		map[string]any{"device_name": "desktop", "platform": "linux", "machine_id": "m1"})
	if w.Code != 200 {
		t.Fatalf("device-token-issue 首次使用状态=%d body=%s", w.Code, w.Body.String())
	}
	var issue map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &issue)
	devTok, _ := issue["token"].(string)
	if devTok == "" {
		t.Fatal("缺少 device token")
	}

	var n int
	if err := db.QueryRow(`SELECT count(*) FROM auth_users WHERE id=?`, uid).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("auth_users 自动建账后应有 1 行，实际 %d", n)
	}

	row := map[string]any{
		"hour_start": "2026-10-20T10:00:00Z", "source": "codex", "model": "gpt-6",
		"input_tokens": 1234, "total_tokens": 1234, "billable_total_tokens": 1234, "conversation_count": 1,
	}
	if u := requestJSON(t, h, "POST", "/functions/tokentracker-ingest", devTok, map[string]any{"buckets": []any{row}}); u.Code != 200 {
		t.Fatalf("ingest 状态=%d body=%s", u.Code, u.Body.String())
	}
	w = requestJSON(t, h, "GET",
		"/functions/tokentracker-account-summary?from=2026-10-20&to=2026-10-20",
		s.signJWT(uid, "authenticated", s.now.Unix()+3600), nil)
	if w.Code != 200 {
		t.Fatalf("summary 状态=%d body=%s", w.Code, w.Body.String())
	}
	var summary struct {
		Totals struct {
			TotalTokens int64 `json:"total_tokens"`
		} `json:"totals"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &summary)
	if summary.Totals.TotalTokens != 1234 {
		t.Fatalf("summary total_tokens=%d, want 1234", summary.Totals.TotalTokens)
	}

	// 认证语义不变：无 token 仍然 401
	if u := requestJSON(t, h, "GET",
		"/functions/tokentracker-account-summary?from=2026-10-20&to=2026-10-20", "", nil); u.Code != 401 {
		t.Fatalf("无 token 状态=%d, want 401", u.Code)
	}
}

// TestDeviceIssueIsRepeatableForSameDevice 覆盖「客户端重装 / 重新登录」：
// 同一 (user, platform, device_name, machine_id) 反复调 device-token-issue，
// 必须每次 200 且复用同一个 device 行（不能撞 devices 的唯一索引返回 500），
// 也不能在 cloud_machines 里堆出多台同名机器。
func TestDeviceIssueIsRepeatableForSameDevice(t *testing.T) {
	s, db := testServer(t)
	h := s.Handler()
	uid := "33333333-3333-4333-8333-333333333333"
	jwt := s.signJWT(uid, "authenticated", s.now.Unix()+3600)
	body := map[string]any{"device_name": "desktop", "platform": "linux", "machine_id": "m-same"}

	var ids []string
	var tokens []string
	for i := 0; i < 3; i++ {
		w := requestJSON(t, h, "POST", "/functions/tokentracker-device-token-issue", jwt, body)
		if w.Code != 200 {
			t.Fatalf("第 %d 次 device-token-issue 状态=%d body=%s", i+1, w.Code, w.Body.String())
		}
		var resp map[string]any
		_ = json.Unmarshal(w.Body.Bytes(), &resp)
		id, _ := resp["device_id"].(string)
		tok, _ := resp["token"].(string)
		if id == "" || tok == "" {
			t.Fatalf("第 %d 次响应缺字段: %s", i+1, w.Body.String())
		}
		ids = append(ids, id)
		tokens = append(tokens, tok)
	}

	for i := 1; i < len(ids); i++ {
		if ids[i] != ids[0] {
			t.Fatalf("同一设备应复用 device_id：%v", ids)
		}
	}
	if tokens[0] == tokens[1] || tokens[1] == tokens[2] {
		t.Fatal("每次应签发新的 device token（旧 token 不被复用）")
	}

	var devices, machines, activeTokens int
	if err := db.QueryRow(`SELECT count(*) FROM devices WHERE user_id=? AND revoked_at IS NULL`, uid).Scan(&devices); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT count(*) FROM cloud_machines WHERE user_id=? AND status='active'`, uid).Scan(&machines); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT count(*) FROM device_tokens WHERE user_id=? AND revoked_at IS NULL`, uid).Scan(&activeTokens); err != nil {
		t.Fatal(err)
	}
	if devices != 1 {
		t.Fatalf("active devices=%d，want 1（应复用设备行）", devices)
	}
	if machines != 1 {
		t.Fatalf("active cloud_machines=%d，want 1（不应重复插入同名机器）", machines)
	}
	if activeTokens != 3 {
		t.Fatalf("active device_tokens=%d，want 3（每次登录各签一个）", activeTokens)
	}

	// 最后签发的 token 依然可用
	if w := requestJSON(t, h, "POST", "/functions/tokentracker-ingest", tokens[2], map[string]any{
		"buckets": []any{map[string]any{
			"hour_start": "2026-10-20T10:00:00Z", "source": "codex", "model": "gpt-6",
			"input_tokens": 7, "total_tokens": 7, "billable_total_tokens": 7, "conversation_count": 1,
		}},
	}); w.Code != 200 {
		t.Fatalf("用最新 token 上传状态=%d body=%s", w.Code, w.Body.String())
	}
	// account-devices 返回「按设备」的官方形状：一台设备一行，带 id
	w := requestJSON(t, h, "GET",
		"/functions/tokentracker-account-devices?from=2026-10-20&to=2026-10-20", jwt, nil)
	if w.Code != 200 {
		t.Fatalf("account-devices 状态=%d", w.Code)
	}
	var dev struct {
		Devices []struct {
			ID         string `json:"id"`
			DeviceName string `json:"device_name"`
			TotalToken int64  `json:"total_tokens"`
		} `json:"devices"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &dev)
	if len(dev.Devices) != 1 || dev.Devices[0].TotalToken != 7 {
		t.Fatalf("account-devices 聚合异常：%s", w.Body.String())
	}
	if dev.Devices[0].ID == "" || dev.Devices[0].DeviceName == "" {
		t.Fatalf("account-devices 应返回设备身份：%s", w.Body.String())
	}
}

// ---------- 官方客户端（tokentracker CLI v1.4.x）兼容性 ----------

// 客户端会校验 verification_uri 必须与它自己的 dashboardUrl 同源、路径为 /device，
// 否则 device-login 直接报「Device authorization returned a different dashboard」。
// 自托管没配 TT_DASHBOARD_URL 时，必须用请求自身的 Host/scheme 推导。
func TestDeviceAuthorizeAnchorsVerificationURIToRequestHost(t *testing.T) {
	s, _ := testServer(t)
	s.dashboard = "" // 模拟「没配 TT_DASHBOARD_URL」
	h := s.Handler()

	for _, tc := range []struct {
		host, proto, want string
	}{
		{"192.168.1.10:8080", "", "http://192.168.1.10:8080/device"},
		{"tt.example.lan", "https", "https://tt.example.lan/device"},
	} {
		r := httptest.NewRequest("POST", "/functions/tokentracker-device-flow-authorize", strings.NewReader(`{}`))
		r.Host = tc.host
		if tc.proto != "" {
			r.Header.Set("X-Forwarded-Proto", tc.proto)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 200 {
			t.Fatalf("authorize status=%d body=%s", w.Code, w.Body.String())
		}
		var resp struct {
			VerificationURI         string `json:"verification_uri"`
			VerificationURIComplete string `json:"verification_uri_complete"`
			UserCode                string `json:"user_code"`
		}
		_ = json.Unmarshal(w.Body.Bytes(), &resp)
		if resp.VerificationURI != tc.want {
			t.Fatalf("host=%s proto=%s verification_uri=%q want %q", tc.host, tc.proto, resp.VerificationURI, tc.want)
		}
		if !strings.HasPrefix(resp.VerificationURIComplete, tc.want+"?user_code=") {
			t.Fatalf("verification_uri_complete=%q", resp.VerificationURIComplete)
		}
	}

	// 显式配置时以配置为准（契约测试依赖这个锚定语义）
	s.dashboard = "https://private.example.test"
	w := requestJSON(t, h, "POST", "/functions/tokentracker-device-flow-authorize", "", nil)
	var resp struct {
		VerificationURI string `json:"verification_uri"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.VerificationURI != "https://private.example.test/device" {
		t.Fatalf("configured dashboard ignored: %q", resp.VerificationURI)
	}
}

// TT_DEVICE_APPROVE=auto：authorize 即批准，客户端第一轮 poll 就拿到可用的 device token
// —— 这正是「官方客户端 + 局域网自用、没有网页可点」的场景。
func TestDeviceAutoApproveGivesUsableToken(t *testing.T) {
	s, _ := testServer(t)
	s.deviceApprove = "auto"
	h := s.Handler()

	w := requestJSON(t, h, "POST", "/functions/tokentracker-device-flow-authorize", "",
		map[string]any{"client_info": "linux-x64 nas", "machine_id": "machine-auto"})
	if w.Code != 200 {
		t.Fatalf("authorize status=%d body=%s", w.Code, w.Body.String())
	}
	var auth struct {
		DeviceCode string `json:"device_code"`
		UserCode   string `json:"user_code"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &auth)

	p := requestJSON(t, h, "POST", "/functions/tokentracker-device-flow-poll", "",
		map[string]any{"device_code": auth.DeviceCode})
	var poll struct {
		Status      string `json:"status"`
		UserID      string `json:"user_id"`
		DeviceToken string `json:"device_token"`
	}
	_ = json.Unmarshal(p.Body.Bytes(), &poll)
	owner, err := s.ownerSub()
	if err != nil || owner == "" {
		t.Fatalf("owner not created by auto approve: owner=%q err=%v", owner, err)
	}
	if poll.Status != "approved" || poll.UserID != owner || poll.DeviceToken == "" {
		t.Fatalf("poll=%s (status=%q user=%q owner=%q token=%q)", p.Body.String(), poll.Status, poll.UserID, owner, poll.DeviceToken)
	}
	// 归属必须落在 owner 上，不能是另一个账户
	var deviceOwners int
	if err := s.db.QueryRow(`SELECT count(*) FROM devices WHERE user_id=?`, owner).Scan(&deviceOwners); err != nil {
		t.Fatal(err)
	}
	if deviceOwners != 1 {
		t.Fatalf("devices under owner=%d want 1 (设备必须归属 owner 账户)", deviceOwners)
	}

	// 拿到的 token 必须真的能上传（客户端下一步就是 ingest）
	row := map[string]any{"hour_start": "2026-10-26T09:00:00Z", "source": "claude", "model": "sonnet-4.5",
		"input_tokens": 11, "total_tokens": 11, "billable_total_tokens": 11, "conversation_count": 1}
	u := requestJSON(t, h, "POST", "/functions/tokentracker-ingest", poll.DeviceToken, map[string]any{"hourly": []any{row}})
	if u.Code != 200 {
		t.Fatalf("ingest status=%d body=%s", u.Code, u.Body.String())
	}
	if !strings.Contains(u.Body.String(), `"inserted":1`) {
		t.Fatalf("ingest body=%s", u.Body.String())
	}
}

// TT_DEVICE_APPROVE=page：/device 页面 + 表单批准（无 JWT），默认配置下该端点必须 403。
func TestDeviceApprovalPage(t *testing.T) {
	s, _ := testServer(t)
	s.deviceApprove = "page"
	h := s.Handler()

	authRes := requestJSON(t, h, "POST", "/functions/tokentracker-device-flow-authorize", "", map[string]any{"machine_id": "m-page"})
	var auth struct {
		DeviceCode string `json:"device_code"`
		UserCode   string `json:"user_code"`
	}
	_ = json.Unmarshal(authRes.Body.Bytes(), &auth)

	g := httptest.NewRequest("GET", "/device?user_code="+auth.UserCode, nil)
	gw := httptest.NewRecorder()
	h.ServeHTTP(gw, g)
	if gw.Code != 200 || !strings.Contains(gw.Body.String(), auth.UserCode) {
		t.Fatalf("device page status=%d body=%s", gw.Code, gw.Body.String())
	}

	form := "user_code=" + auth.UserCode
	p := httptest.NewRequest("POST", "/device/approve", strings.NewReader(form))
	p.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	pw := httptest.NewRecorder()
	h.ServeHTTP(pw, p)
	if pw.Code != 200 {
		t.Fatalf("approve status=%d body=%s", pw.Code, pw.Body.String())
	}

	poll := requestJSON(t, h, "POST", "/functions/tokentracker-device-flow-poll", "", map[string]any{"device_code": auth.DeviceCode})
	if !strings.Contains(poll.Body.String(), `"status":"approved"`) {
		t.Fatalf("poll after page approval: %s", poll.Body.String())
	}

	// 默认模式（jwt）下不允许匿名批准
	s.deviceApprove = "jwt"
	pw2 := httptest.NewRecorder()
	h.ServeHTTP(pw2, p)
	if pw2.Code != http.StatusForbidden {
		t.Fatalf("jwt mode approve status=%d want 403", pw2.Code)
	}
}

// 重复批准同一个 user_code 不能换 token（客户端/浏览器重试是常态）。
func TestApproveDeviceCodeIsIdempotent(t *testing.T) {
	s, _ := testServer(t)
	h := s.Handler()
	authRes := requestJSON(t, h, "POST", "/functions/tokentracker-device-flow-authorize", "", map[string]any{"machine_id": "m-idem"})
	var auth struct {
		DeviceCode string `json:"device_code"`
		UserCode   string `json:"user_code"`
	}
	_ = json.Unmarshal(authRes.Body.Bytes(), &auth)

	uid := "44444444-4444-4444-8444-444444444444"
	first := requestJSON(t, h, "POST", "/functions/tokentracker-device-flow-grant", s.signJWT(uid, "authenticated", s.now.Unix()+3600),
		map[string]any{"user_code": auth.UserCode})
	if first.Code != 200 {
		t.Fatalf("grant status=%d body=%s", first.Code, first.Body.String())
	}
	second := requestJSON(t, h, "POST", "/functions/tokentracker-device-flow-grant", s.signJWT(uid, "authenticated", s.now.Unix()+3600),
		map[string]any{"user_code": auth.UserCode})
	if second.Code != 200 {
		t.Fatalf("re-grant status=%d body=%s", second.Code, second.Body.String())
	}
	var n int
	if err := s.db.QueryRow(`SELECT count(*) FROM device_tokens WHERE user_id=?`, uid).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("device_tokens=%d want 1（重复批准不应再签发）", n)
	}
}
