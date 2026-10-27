package app

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/QuietSugar/tokentracker-selfhost-go/internal/store"
	_ "github.com/lib/pq"
	_ "modernc.org/sqlite"
)

// testDB 返回一个隔离的存储层实例：
//   - 默认用临时目录里的 SQLite 文件（每个测试独立）；
//   - 设置了 TT_TEST_DATABASE_URL（postgres://...）时，跑在真实 PostgreSQL 上，
//     每个测试用独立 schema（tt_test_<hex>）并在结束时 DROP SCHEMA CASCADE。
//
// 同一批测试因此在两种引擎上都执行，assertEquals 的语义必须一致。
func testDB(t *testing.T) *store.DB {
	t.Helper()
	ctx := context.Background()
	if dsn := os.Getenv("TT_TEST_DATABASE_URL"); dsn != "" {
		db, err := store.Open(ctx, store.Config{
			Dialect:           store.Postgres,
			DSN:               dsn,
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
		t.Logf("test using PostgreSQL schema %s", db.Dialect())
		return db
	}
	db, err := store.Open(ctx, store.Config{DSN: filepath.Join(t.TempDir(), "test.db")})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := store.Install(ctx, db); err != nil {
		t.Fatal(err)
	}
	return db
}

func testServer(t *testing.T) (*Server, *store.DB) {
	t.Helper()
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
	uid := "11111111-1111-4111-8111-111111111111"
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
	// account-devices 这里返回的是「按 source 聚合」，同一份数据只应出现一个 source
	w := requestJSON(t, h, "GET",
		"/functions/tokentracker-account-devices?from=2026-10-20&to=2026-10-20", jwt, nil)
	if w.Code != 200 {
		t.Fatalf("account-devices 状态=%d", w.Code)
	}
	var dev struct {
		Devices []struct {
			Source     string `json:"source"`
			TotalToken int64  `json:"total_tokens"`
		} `json:"devices"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &dev)
	if len(dev.Devices) != 1 || dev.Devices[0].TotalToken != 7 {
		t.Fatalf("account-devices 聚合异常：%s", w.Body.String())
	}
}
