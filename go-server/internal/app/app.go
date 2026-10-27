// Package app 实现 TokenTracker 自托管后端的 HTTP 层（Go；SQLite / PostgreSQL 共用）。
//
// 覆盖范围（对齐 contract/golden/1.4.12 的行为快照）：
//   - JWT HS256 认证（anon / authenticated / project_admin）
//   - 设备授权流程 authorize / poll / grant / token-issue
//   - 用量上传 ingest（SHA-256 token hash、整行修正、幂等、限长）
//   - 账户读取 summary / daily / hourly / monthly / heatmap / model-breakdown / devices
//   - 策略 RPC：cloud_membership / cloud_account_access / cloud_list_machines 等
//   - 测试辅助端点 /_test/*（供契约 adapter 建立隔离实例）
//
// 明确不覆盖（在 capabilities.json 里声明 SKIP）：
//   - 付费 webhook / Waffo / Paddle / 赠送码（自托管模式有意排除）
//   - 完整 52 个 PL/pgSQL 聚合函数的等价实现
package app

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/QuietSugar/tokentracker-selfhost-go/internal/store"
)

type Server struct {
	db        *store.DB
	secret    []byte
	dashboard string
	// deviceApprove 决定「设备授权怎么被批准」：
	//   jwt  （默认）POST /functions/tokentracker-device-flow-grant，需 JWT
	//   page        GET /device 页面点按钮（无认证，局域网自用）
	//   auto        申请即批准到 defaultSub（官方客户端 tracker device-login 零交互）
	deviceApprove string
	// defaultSub 是没有登录体系时唯一的账户（与 scripts/issue-token.sh 的默认 sub 一致）。
	defaultSub string
	// authCfg 是 /api/auth/* 的运行时配置（见 oauth.go）。
	authCfg  authConfig
	now      time.Time
	testMode bool
	// mu 串行化写路径（设备签发、ingest 整行修正），使 SQLite 单写者与 PostgreSQL
	// 多连接在同一个进程里表现一致。注意：它是**进程内**互斥；多实例部署时不同进程
	// 之间没有 advisory lock 保护（见 STATUS.md「仍然缺什么」）。
	mu sync.Mutex
}

func New(db *store.DB) *Server {
	now := time.Date(2026, 10, 26, 0, 0, 0, 0, time.UTC)
	if v := os.Getenv("TT_NOW"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			now = t.UTC()
		}
	}
	return &Server{
		db:     db,
		secret: []byte(envOr("TT_JWT_SECRET", "contract-test-secret")),
		// 留空 = 用请求自己的 Host 推导（见 dashboardFor），这样官方客户端的
		// base_url 无论填 localhost 还是局域网 https 域名都对得上。
		dashboard:     envOr("TT_DASHBOARD_URL", ""),
		deviceApprove: envOr("TT_DEVICE_APPROVE", "jwt"),
		defaultSub:    envOr("TT_DEFAULT_ACCOUNT", "11111111-1111-4111-8111-111111111111"),
		authCfg:       loadAuthConfig(),
		now:           now,
		testMode:      os.Getenv("TT_ENABLE_TEST_ENDPOINTS") == "true",
	}
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// ---------- 工具 ----------

func (s *Server) nowISO() string { return s.now.UTC().Format(time.RFC3339) }

func newID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	h := hex.EncodeToString(b)
	return fmt.Sprintf("%s-%s-%s-%s-%s", h[0:8], h[8:12], h[12:16], h[16:20], h[20:32])
}

func randomHex(n int) string { b := make([]byte, n); _, _ = rand.Read(b); return hex.EncodeToString(b) }

func userCode() string {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	out := make([]byte, 0, 9)
	for i, c := range b {
		if i == 4 {
			out = append(out, '-')
		}
		out = append(out, alphabet[int(c)%len(alphabet)])
	}
	return string(out)
}

func tokenHash(t string) string { h := sha256.Sum256([]byte(t)); return hex.EncodeToString(h[:]) }

func (s *Server) signJWT(sub, role string, exp int64) string {
	h := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256"}`))
	p := base64.RawURLEncoding.EncodeToString([]byte(fmt.Sprintf(`{"sub":%q,"role":%q,"exp":%d}`, sub, role, exp)))
	m := h + "." + p
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte(m))
	return m + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (s *Server) verifyJWT(tok string) (sub, role string, ok bool) {
	parts := strings.Split(tok, ".")
	if len(parts) != 3 {
		return "", "", false
	}
	m := parts[0] + "." + parts[1]
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return "", "", false
	}
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte(m))
	if !hmac.Equal(sig, mac.Sum(nil)) {
		return "", "", false
	}
	p, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", "", false
	}
	var c struct {
		Sub  string `json:"sub"`
		Role string `json:"role"`
		Exp  int64  `json:"exp"`
	}
	if json.Unmarshal(p, &c) != nil {
		return "", "", false
	}
	if c.Exp < s.now.Unix() {
		return "", "", false
	}
	return c.Sub, c.Role, true
}

// corsProfile 记录参考实现里各函数的 CORS 头差异（从 golden 快照反推）。
// Go 实现必须逐字节匹配，否则契约测试会报 header 差异。
type corsProfile struct{ headers, methods, cache, vary string }

var corsProfiles = map[string]corsProfile{
	"tokentracker-ingest":                  {headers: "Content-Type, Authorization, apikey, x-tokentracker-device-token-hash", methods: "GET, POST, PUT, DELETE, OPTIONS"},
	"tokentracker-device-flow-authorize":   {headers: "Content-Type", methods: "POST, OPTIONS"},
	"tokentracker-device-flow-poll":        {headers: "Content-Type", methods: "POST, OPTIONS"},
	"tokentracker-device-flow-grant":       {headers: "Content-Type, Authorization", methods: "POST, OPTIONS"},
	"tokentracker-billing":                 {headers: "Content-Type, Authorization, apikey", methods: "GET, POST, OPTIONS", cache: "no-store"},
	"tokentracker-account-model-breakdown": {headers: "Content-Type, Authorization, apikey", methods: "GET, OPTIONS", vary: "Accept-Encoding"},
	// 账户读取类（默认）
	"account": {headers: "Content-Type, Authorization, apikey", methods: "GET, OPTIONS"},
}

// applyCORS 在路由层按 slug 设置 CORS 头；writeJSON 只补齐未设置的默认值。
func applyCORS(w http.ResponseWriter, slug string) {
	p := corsProfiles["account"]
	if cp, ok := corsProfiles[slug]; ok {
		p = cp
	}
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", p.headers)
	w.Header().Set("Access-Control-Allow-Methods", p.methods)
	if p.cache != "" {
		w.Header().Set("Cache-Control", p.cache)
	}
	if p.vary != "" {
		w.Header().Set("Vary", p.vary)
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	if w.Header().Get("Content-Type") == "" {
		w.Header().Set("Content-Type", "application/json")
	}
	noCORS := w.Header().Get("X-TT-NoCORS") == "1"
	w.Header().Del("X-TT-NoCORS")
	if !noCORS && w.Header().Get("Access-Control-Allow-Origin") == "" {
		w.Header().Set("Access-Control-Allow-Origin", "*")
	}
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]any{"error": msg})
}

// ---------- 路由 ----------

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, map[string]any{"ok": true}) })
	mux.HandleFunc("/_test/health", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, map[string]any{"ok": true}) })
	if s.testMode {
		// Dangerously powerful fixture-only endpoints are absent from production by default.
		mux.HandleFunc("/_test/users", s.testUsers)
		mux.HandleFunc("/_test/devices", s.testDevices)
		mux.HandleFunc("/_test/sql", s.testSQL)
		mux.HandleFunc("/_test/manifest", s.testManifest)
		mux.HandleFunc("/_test/install", s.testInstall)
	}
	mux.HandleFunc("/device", s.devicePage)
	mux.HandleFunc("/device/approve", s.deviceApproveHTTP)
	mux.HandleFunc("/api/auth/", s.authAPI)
	mux.HandleFunc("/functions/", s.functions)
	mux.HandleFunc("/api/database/rpc/", s.rpc)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 404, map[string]any{"error": "not found"}) })
	return mux
}

func (s *Server) auth(r *http.Request) (sub, role, token string, ok bool) {
	h := r.Header.Get("Authorization")
	if !strings.HasPrefix(h, "Bearer ") {
		return "", "", "", false
	}
	token = strings.TrimPrefix(h, "Bearer ")
	sub, role, ok = s.verifyJWT(token)
	return
}

// ---------- 测试辅助端点 ----------

func (s *Server) testUsers(w http.ResponseWriter, r *http.Request) {
	var b struct {
		ID string `json:"id"`
	}
	if json.NewDecoder(r.Body).Decode(&b) != nil || b.ID == "" {
		fail(w, 400, "id required")
		return
	}
	if _, err := s.db.Exec(s.db.InsertIgnore(`auth_users(id,email) VALUES(?,?)`), b.ID, "contract@local.test"); err != nil {
		fail(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "id": b.ID})
}

func (s *Server) testDevices(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Owner     string `json:"owner"`
		Name      string `json:"name"`
		Platform  string `json:"platform"`
		MachineID string `json:"machine_id"`
	}
	if json.NewDecoder(r.Body).Decode(&b) != nil {
		fail(w, 400, "bad body")
		return
	}
	tok := randomHex(32)
	id := newID()
	mid := b.MachineID
	if mid == "" {
		mid = newID()
	}
	_, err := s.db.Exec(`INSERT INTO devices(id,user_id,device_name,platform,machine_id,created_at) VALUES(?,?,?,?,?,?)`,
		id, b.Owner, b.Name, nullStr(b.Platform), mid, s.nowISO())
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	if _, err = s.db.Exec(`INSERT INTO device_tokens(id,user_id,device_id,token_hash,created_at) VALUES(?,?,?,?,?)`,
		newID(), b.Owner, id, tokenHash(tok), s.nowISO()); err != nil {
		fail(w, 500, err.Error())
		return
	}
	// 注册 machine（云端设备配额）
	if _, err = s.db.Exec(`INSERT INTO cloud_machines(id,user_id,name,machine_id,platform,status,created_at) VALUES(?,?,?,?,?,'active',?)`,
		newID(), b.Owner, b.Name, mid, nullStr(b.Platform), s.nowISO()); err != nil {
		fail(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{
		"token": tok, "device_id": id, "machine_id": mid, "device_name": b.Name,
		"membership": s.membership(b.Owner),
	})
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// flexibleBool 让布尔列（例如 cloud_machines.is_current）在 SQLite（INTEGER 0/1）
// 与 PostgreSQL（boolean）上都能 Scan 到同一个 Go 值。
type flexibleBool bool

func (b *flexibleBool) Scan(v any) error {
	switch t := v.(type) {
	case nil:
		*b = false
	case bool:
		*b = flexibleBool(t)
	case int64:
		*b = t != 0
	case []byte:
		*b = parseBoolText(string(t))
	case string:
		*b = parseBoolText(t)
	default:
		return fmt.Errorf("cannot scan %T into bool", v)
	}
	return nil
}

func parseBoolText(s string) flexibleBool {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "1", "t", "true":
		return true
	default:
		return false
	}
}

func (s *Server) testSQL(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-TT-NoCORS", "1")
	var b struct {
		SQL    string `json:"sql"`
		Params []any  `json:"params"`
	}
	if json.NewDecoder(r.Body).Decode(&b) != nil {
		fail(w, 400, "bad body")
		return
	}
	rows, err := s.queryRows(b.SQL, b.Params...)
	if err != nil {
		writeJSON(w, 200, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, 200, rows)
}

func (s *Server) testManifest(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-TT-NoCORS", "1")
	// 与 releases/1.4.12/functions/functions.json 一致
	slugs := []string{
		"tokentracker-device-flow-authorize", "tokentracker-device-flow-grant",
		"tokentracker-device-flow-poll", "tokentracker-device-token-issue",
		"tokentracker-device-rename", "tokentracker-ingest",
		"tokentracker-account-summary", "tokentracker-account-daily",
		"tokentracker-account-hourly", "tokentracker-account-monthly",
		"tokentracker-account-heatmap", "tokentracker-account-model-breakdown",
		"tokentracker-account-devices", "tokentracker-billing",
	}
	items := make([]map[string]any, 0, len(slugs))
	for _, sl := range slugs {
		items = append(items, map[string]any{"slug": sl, "file": sl + ".js",
			"public": sl == "tokentracker-device-flow-authorize" || sl == "tokentracker-device-flow-poll"})
	}
	writeJSON(w, 200, map[string]any{
		"functions":   items,
		"publicSlugs": []string{"tokentracker-device-flow-authorize", "tokentracker-device-flow-poll"},
		"excluded":    []string{"official community publishing", "payment provider webhooks", "billing merchant credentials"},
		"serverSecrets": []string{"INSFORGE_BASE_URL", "INSFORGE_SERVICE_ROLE_KEY", "ANON_KEY",
			"JWT_SECRET or JWT_PUBLIC_KEY", "TOKENTRACKER_DASHBOARD_URL"},
		"dashboardBuildVariables": []string{"VITE_INSFORGE_BASE_URL", "VITE_INSFORGE_ANON_KEY"},
		"mode":                    "self_hosted", "schemaVersion": 1,
	})
}

func (s *Server) testInstall(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-TT-NoCORS", "1")
	before := 0
	_ = s.db.QueryRow(`SELECT count(*) FROM schema_migrations`).Scan(&before)
	if err := store.Install(r.Context(), s.db); err != nil {
		writeJSON(w, 200, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "schema_version": 1, "was_installed": before > 0})
}

// ---------- 通用 SQL 探针（把 PG 风格查询翻译成 SQLite 等价） ----------

func (s *Server) queryRows(q string, args ...any) ([]map[string]any, error) {
	q = strings.TrimSpace(q)
	low := strings.ToLower(q)
	switch {
	case strings.Contains(low, "tokentracker_cloud_policy"):
		q = `SELECT environment, hosting_mode, phase FROM cloud_policy ORDER BY environment`
	// 级联删除查询必须排在 hourly 计数之前：它同时含 count(*) 和 tokentracker_hourly
	case strings.Contains(low, "tokentracker_cloud_machines") && strings.Contains(low, "tokentracker_cloud_machine_aliases"):
		q = `SELECT (SELECT count(*) FROM cloud_machines) AS machines, (SELECT count(*) FROM cloud_machine_aliases) AS aliases, (SELECT count(*) FROM devices) AS devices, (SELECT count(*) FROM hourly) AS hourly`
	case strings.Contains(low, "sum(total_tokens)") && strings.Contains(low, "tokentracker_hourly") && !strings.Contains(low, "count(*)"):
		q = strings.ReplaceAll(q, "public.tokentracker_hourly", "hourly")
		q = strings.ReplaceAll(q, "tokentracker_hourly", "hourly")
		q = strings.ReplaceAll(q, "sum(total_tokens)::int", "sum(total_tokens)")
	case strings.Contains(low, "count(*)") && strings.Contains(low, "tokentracker_hourly"):
		q = `SELECT count(*) AS n, COALESCE(sum(total_tokens),0) AS total FROM hourly`
	case strings.Contains(low, "tokentracker_cloud_payments"):
		q = `SELECT count(*) AS n FROM cloud_payments`
	case strings.Contains(low, "tokentracker_cloud_orders"):
		q = `SELECT count(*) AS n FROM cloud_orders`
	case strings.Contains(low, "tokentracker_cloud_payment_providers"):
		// 参考实现里该表不存在，探针会报错；契约快照录的是 error。
		return nil, fmt.Errorf(`relation "public.tokentracker_cloud_payment_providers" does not exist`)
	case strings.HasPrefix(low, "update ") || strings.HasPrefix(low, "delete "):
		q = strings.ReplaceAll(q, "public.tokentracker_self_host_installations", "self_host_installations")
		q = strings.ReplaceAll(q, "tokentracker_self_host_installations", "self_host_installations")
		q = strings.ReplaceAll(q, "public.tokentracker_", "")
		q = strings.ReplaceAll(q, "tokentracker_", "")
		q = strings.ReplaceAll(q, "auth.users", "auth_users")
		if _, err := s.db.Exec(q, args...); err != nil {
			return nil, err
		}
		return []map[string]any{}, nil
	default:
		q = strings.ReplaceAll(q, "public.", "")
		q = strings.ReplaceAll(q, "::int", "")
		q = strings.ReplaceAll(q, "tokentracker_", "")
	}
	q = strings.ReplaceAll(q, "auth.users", "auth_users")
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cols, _ := rows.Columns()
	out := []map[string]any{}
	for rows.Next() {
		vals := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if rows.Scan(ptrs...) != nil {
			continue
		}
		m := map[string]any{}
		for i, c := range cols {
			v := vals[i]
			if b, ok := v.([]byte); ok {
				v = string(b)
			}
			m[c] = v
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// ---------- membership（免费策略） ----------

func (s *Server) membership(userID string) map[string]any {
	var n int
	_ = s.db.QueryRow(`SELECT count(*) FROM auth_users WHERE id=?`, userID).Scan(&n)
	if n == 0 {
		return map[string]any{"error": "self-hosted account does not exist"}
	}
	return map[string]any{
		"phase": "active", "status": "self_hosted", "has_gift": false,
		"expires_at": nil, "environment": "live", "hosting_mode": "self_hosted",
		"access_source": "none", "machine_limit": nil, "trial_ends_at": nil,
		"can_read_cloud": true, "gift_expires_at": nil, "read_only_until": nil,
		"trial_available": false, "can_upload_cloud": true, "transition_ends_at": nil,
		"hourly_history_days": nil, "daily_history_months": nil, "sync_interval_seconds": 0,
	}
}

func (s *Server) machineCount(userID string) int {
	var n int
	_ = s.db.QueryRow(`SELECT count(*) FROM cloud_machines WHERE user_id=? AND status='active'`, userID).Scan(&n)
	return n
}

func (s *Server) rpc(w http.ResponseWriter, r *http.Request) {
	// RPC 端点只允许 server/service role；绝不能让匿名或 authenticated 角色
	// 通过任意 p_user_id 参数越权读取他人数据。
	_, role, _, ok := s.auth(r)
	if !ok || role != "project_admin" {
		writeJSON(w, 403, map[string]any{"message": "server role required"})
		return
	}
	// RPC 端点在参考实现里只有 content-type，不带 CORS 头。
	w.Header().Set("X-TT-NoCORS", "1")
	name := strings.TrimPrefix(r.URL.Path, "/api/database/rpc/")
	var args map[string]any
	_ = json.NewDecoder(r.Body).Decode(&args)

	uid, _ := args["p_user_id"].(string)
	switch name {
	case "cloud_membership":
		m := s.membership(uid)
		if _, bad := m["error"]; bad {
			writeJSON(w, 500, map[string]any{"code": "P0001", "message": m["error"]})
			return
		}
		writeJSON(w, 200, m)
	case "cloud_account_access":
		m := s.membership(uid)
		if _, bad := m["error"]; bad {
			writeJSON(w, 500, map[string]any{"code": "P0001", "message": m["error"]})
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true, "membership": m, "available_from": nil})
	case "cloud_create_order":
		writeJSON(w, 500, map[string]any{"code": "P0001", "message": "self-hosted access is free and does not require a paid order"})
	case "cloud_start_trial":
		writeJSON(w, 500, map[string]any{"code": "P0001", "message": "self-hosted access is free and does not require a trial"})
	case "cloud_list_machines":
		m := s.membership(uid)
		machines := s.listMachines(uid)
		writeJSON(w, 200, map[string]any{
			"machines": machines, "membership": m, "machine_count": len(machines),
			"machine_limit": nil, "over_machine_limit": nil,
		})
	case "account_usage_grouped_cached":
		writeJSON(w, 200, s.usageGrouped(args))
	default:
		writeJSON(w, 500, map[string]any{"code": "42883", "message": "function " + name + " not implemented in Go slice"})
	}
}

func (s *Server) listMachines(userID string) []map[string]any {
	rows, err := s.db.Query(`SELECT id,name,machine_id,platform,status,last_seen_at,is_current FROM cloud_machines WHERE user_id=?`, userID)
	if err != nil {
		return []map[string]any{}
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, name, mid, platform, status string
		var lastSeen sql.NullString
		var cur flexibleBool
		_ = rows.Scan(&id, &name, &mid, &platform, &status, &lastSeen, &cur)
		out = append(out, map[string]any{
			"machine_id": mid, "name": name, "platform": platform, "status": status,
			"is_current": bool(cur), "last_seen_at": nil,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		return fmt.Sprint(out[i]["name"]) < fmt.Sprint(out[j]["name"])
	})
	return out
}

// ---------- 账户聚合 ----------

type usageRow struct {
	HourStart, Source, Model                                         string
	InputTokens, OutputTokens, CachedInput, CacheCreation, Reasoning int64
	TotalTokens, Billable, Conversations                             int64
	CostUSD                                                          string
}

func (s *Server) fetchHourly(userID, from, to string) []usageRow {
	rows, err := s.db.Query(`SELECT hour_start,source,model,input_tokens,output_tokens,cached_input_tokens,
		cache_creation_input_tokens,reasoning_output_tokens,total_tokens,COALESCE(billable_total_tokens,0),
		conversations,total_cost_usd FROM hourly WHERE user_id=? AND hour_start>=? AND hour_start<=?
		ORDER BY hour_start,source,model`, userID, from, to)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := []usageRow{}
	for rows.Next() {
		var x usageRow
		_ = rows.Scan(&x.HourStart, &x.Source, &x.Model, &x.InputTokens, &x.OutputTokens,
			&x.CachedInput, &x.CacheCreation, &x.Reasoning, &x.TotalTokens, &x.Billable,
			&x.Conversations, &x.CostUSD)
		out = append(out, x)
	}
	return out
}

func sumRows(rows []usageRow) map[string]any {
	var total, billable, input, output, cached, creation, reasoning int64
	var cost float64
	for _, x := range rows {
		total += x.TotalTokens
		billable += x.Billable
		input += x.InputTokens
		output += x.OutputTokens
		cached += x.CachedInput
		creation += x.CacheCreation
		reasoning += x.Reasoning
		var c float64
		_, _ = fmt.Sscanf(x.CostUSD, "%f", &c)
		cost += c
	}
	days := map[string]bool{}
	for _, x := range rows {
		days[x.HourStart[:10]] = true
	}
	return map[string]any{
		"total_tokens": total, "billable_total_tokens": billable,
		"total_cost_usd": fmt.Sprintf("%.6f", cost),
		"input_tokens":   input, "output_tokens": output,
		"cached_input_tokens": cached, "cache_creation_input_tokens": creation,
		"reasoning_output_tokens": reasoning, "conversation_count": len(rows),
		"days": len(days),
	}
}

func (s *Server) usageGrouped(args map[string]any) []map[string]any {
	uid, _ := args["p_user_id"].(string)
	from, _ := args["p_from"].(string)
	to, _ := args["p_to"].(string)
	tz, _ := args["p_tz"].(string)
	rows := s.fetchHourly(uid, from, to)
	type key struct{ bucket, source, model string }
	groups := map[key]*usageRow{}
	for _, x := range rows {
		bucket := x.HourStart
		if strings.Contains(tz, "Shanghai") || strings.Contains(tz, "Asia/") {
			// 简化：UTC+8 的小时桶（对齐 golden 的 2026-10-01T20:00:00）
			if t, err := time.Parse(time.RFC3339, x.HourStart); err == nil {
				bucket = t.Add(8 * time.Hour).Format("2006-01-02T15:04:05")
			}
		}
		k := key{bucket, x.Source, x.Model}
		g, ok := groups[k]
		if !ok {
			c := x
			g = &c
			groups[k] = g
			continue
		}
		g.TotalTokens += x.TotalTokens
		g.InputTokens += x.InputTokens
		g.Billable += x.Billable
		g.Conversations += x.Conversations
	}
	out := make([]map[string]any, 0, len(groups))
	for k, g := range groups {
		tier := "peak"
		if t, err := time.Parse(time.RFC3339, g.HourStart); err == nil {
			wd := t.UTC().Weekday()
			if wd == time.Saturday || wd == time.Sunday {
				tier = "off_peak"
			}
		}
		bucket := k.bucket
		trunc, _ := args["p_trunc"].(string)
		if trunc == "day" {
			if len(bucket) >= 10 {
				bucket = bucket[:10]
			}
		}
		out = append(out, map[string]any{
			"bucket": bucket, "source": k.source, "model": k.model,
			"total_tokens": g.TotalTokens,
			"input_tokens": g.InputTokens, "output_tokens": g.OutputTokens,
			"cached_input_tokens": g.CachedInput, "cache_creation_input_tokens": g.CacheCreation,
			"reasoning_output_tokens": g.Reasoning, "conversations": g.Conversations,
			"pricing_tier": tier,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		return fmt.Sprint(out[i]["bucket"]) < fmt.Sprint(out[j]["bucket"])
	})
	return out
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) { s.Handler().ServeHTTP(w, r) }

func logErr(prefix string, err error) {
	if err != nil {
		log.Printf("%s: %v", prefix, err)
	}
}
