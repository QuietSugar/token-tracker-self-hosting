package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// httpDo 发一个请求，保留 Set-Cookie（requestJSON 用 httptest.NewRecorder，不带 cookie jar）。
func httpDo(t *testing.T, h http.Handler, method, path string, body any, headers map[string]string, cookies []*http.Cookie) (*httptest.ResponseRecorder, []*http.Cookie) {
	t.Helper()
	var rdr *strings.Reader
	if body != nil {
		buf, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		rdr = strings.NewReader(string(buf))
	} else {
		rdr = strings.NewReader("")
	}
	r := httptest.NewRequest(method, path, rdr)
	if body != nil {
		r.Header.Set("Content-Type", "application/json")
	}
	for k, v := range headers {
		r.Header.Set(k, v)
	}
	for _, c := range cookies {
		r.AddCookie(c)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w, w.Result().Cookies()
}

func cookieByName(cs []*http.Cookie, name string) *http.Cookie {
	for _, c := range cs {
		if c.Name == name {
			return c
		}
	}
	return nil
}

// mustSignUp 注册本机的第一个用户（等价于"初始化所有者"），失败即终止用例。
func mustSignUp(t *testing.T, h http.Handler, email, password string) {
	t.Helper()
	w, _ := httpDo(t, h, "POST", "/api/auth/users",
		map[string]any{"email": email, "password": password}, nil, nil)
	if w.Code != 200 {
		t.Fatalf("sign-up %s status=%d body=%s", email, w.Code, w.Body.String())
	}
}

// 注册 → 登录 → 刷新轮换 → 老 token 只在 60s 宽限内可复用。这就是 InsForge 的会话流程。
func TestAuthSignUpSignInRefreshRotation(t *testing.T) {
	s, db := testServer(t)
	h := s.Handler()

	// 1) 第一个用户永远可以注册（等价于"初始化这台机器的所有者"）
	w, cookies := httpDo(t, h, "POST", "/api/auth/users",
		map[string]any{"email": "Owner@Example.com", "password": "correct horse battery"}, nil, nil)
	if w.Code != 200 {
		t.Fatalf("sign-up status=%d body=%s", w.Code, w.Body.String())
	}
	var up struct {
		AccessToken  string         `json:"accessToken"`
		RefreshToken string         `json:"refreshToken"`
		CSRFToken    string         `json:"csrfToken"`
		User         map[string]any `json:"user"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &up)
	if up.AccessToken == "" || up.RefreshToken == "" || up.CSRFToken == "" || up.User["id"] == "" {
		t.Fatalf("sign-up payload incomplete: %s", w.Body.String())
	}
	if up.User["email"] != "owner@example.com" {
		t.Fatalf("email not normalized: %v", up.User["email"])
	}
	// 官方 SDK 通过 cookie 走浏览器模式，两个 cookie 都必须下发
	rc, cc := cookieByName(cookies, refreshCookieName), cookieByName(cookies, csrfCookieName)
	if rc == nil || !rc.HttpOnly || cc == nil || cc.HttpOnly {
		t.Fatalf("cookies wrong: refresh=%+v csrf=%+v", rc, cc)
	}

	// 2) 同一个 email 再注册 → 409（已有 owner，注册关闭）
	w2, _ := httpDo(t, h, "POST", "/api/auth/users",
		map[string]any{"email": "owner@example.com", "password": "another password"}, nil, nil)
	if w2.Code != 403 && w2.Code != 409 {
		t.Fatalf("second sign-up status=%d body=%s", w2.Code, w2.Body.String())
	}

	// 3) 登录（大小写不敏感）
	w3, c3 := httpDo(t, h, "POST", "/api/auth/sessions",
		map[string]any{"email": "OWNER@example.com", "password": "correct horse battery"}, nil, nil)
	if w3.Code != 200 {
		t.Fatalf("sign-in status=%d body=%s", w3.Code, w3.Body.String())
	}

	// 4) 密码错 → 401，且不泄露"账号是否存在"
	w4, _ := httpDo(t, h, "POST", "/api/auth/sessions",
		map[string]any{"email": "owner@example.com", "password": "wrong password"}, nil, nil)
	if w4.Code != 401 || !strings.Contains(w4.Body.String(), "Invalid email or password") {
		t.Fatalf("bad password status=%d body=%s", w4.Code, w4.Body.String())
	}

	// 5) browser 模式刷新：缺 CSRF → 403；带对 → 200 且 refresh token 轮换
	refreshTok := cookieByName(c3, refreshCookieName).Value
	csrfTok := cookieByName(c3, csrfCookieName).Value
	wNoCSRF, _ := httpDo(t, h, "POST", "/api/auth/refresh", nil,
		nil, []*http.Cookie{{Name: refreshCookieName, Value: refreshTok}})
	if wNoCSRF.Code != 403 {
		t.Fatalf("refresh without csrf status=%d body=%s", wNoCSRF.Code, wNoCSRF.Body.String())
	}
	w5, c5 := httpDo(t, h, "POST", "/api/auth/refresh", nil,
		map[string]string{"X-CSRF-Token": csrfTok}, []*http.Cookie{{Name: refreshCookieName, Value: refreshTok}})
	if w5.Code != 200 {
		t.Fatalf("refresh status=%d body=%s", w5.Code, w5.Body.String())
	}
	newRefresh := cookieByName(c5, refreshCookieName).Value
	if newRefresh == "" || newRefresh == refreshTok {
		t.Fatalf("refresh token was not rotated (%q → %q)", refreshTok, newRefresh)
	}

	// 6) 旧 refresh token 在宽限期内再用 → 200（并发 mint 不该被判成重放，见 issue #38）
	w6, c6 := httpDo(t, h, "POST", "/api/auth/refresh", nil,
		map[string]string{"X-CSRF-Token": csrfTok}, []*http.Cookie{{Name: refreshCookieName, Value: refreshTok}})
	if w6.Code != 200 {
		t.Fatalf("grace reuse status=%d body=%s", w6.Code, w6.Body.String())
	}
	if got := w6.Header().Get("X-TokenTracker-Refresh"); got != "grace" {
		t.Fatalf("grace reuse header=%q，期望 grace", got)
	}
	// 幂等：宽限期把**同一个**接替者再给一次，不另签（issue #47）。
	if graceTok := cookieByName(c6, refreshCookieName).Value; graceTok != newRefresh {
		t.Fatalf("宽限期应返回同一份接替 token（得到 %q，期望 %q）", graceTok, newRefresh)
	}
	// 6b) 超出宽限期再用 → 401，并带上"重试无用"的标记头
	if _, err := db.Exec(`UPDATE auth_sessions SET rotated_at=? WHERE token_hash=?`,
		"2026-10-25T00:00:00Z", tokenHash(refreshTok)); err != nil {
		t.Fatal(err)
	}
	w6b, _ := httpDo(t, h, "POST", "/api/auth/refresh", nil,
		map[string]string{"X-CSRF-Token": csrfTok}, []*http.Cookie{{Name: refreshCookieName, Value: refreshTok}})
	if w6b.Code != 401 || !strings.Contains(w6b.Body.String(), "REFRESH_TOKEN_REUSED") {
		t.Fatalf("stale reuse status=%d body=%s", w6b.Code, w6b.Body.String())
	}
	if got := w6b.Header().Get("X-TokenTracker-Auth-Error"); got != "refresh_token_reused" {
		t.Fatalf("stale reuse 缺标记头（得到 %q）", got)
	}
	// 默认**不**连带撤销：新的 refresh token 仍然可用（并发刷新不该导致登出）
	w7, _ := httpDo(t, h, "POST", "/api/auth/refresh", nil,
		map[string]string{"X-CSRF-Token": cookieByName(c5, csrfCookieName).Value},
		[]*http.Cookie{{Name: refreshCookieName, Value: newRefresh}})
	if w7.Code != 200 {
		t.Fatalf("rotated token must still work by default: status=%d body=%s", w7.Code, w7.Body.String())
	}
}

// 官方客户端做跨设备汇总时走的就是这条路：
// POST /api/auth/refresh?client_type=mobile {refresh_token} → accessToken
// 然后用它打 /functions/tokentracker-account-*。
func TestAuthMobileRefreshUnlocksAccountFunctions(t *testing.T) {
	s, _ := testServer(t)
	h := s.Handler()

	w, _ := httpDo(t, h, "POST", "/api/auth/users",
		map[string]any{"email": "nas@local.test", "password": "lan-only-pass"}, nil, nil)
	if w.Code != 200 {
		t.Fatalf("sign-up status=%d body=%s", w.Code, w.Body.String())
	}
	var up struct {
		RefreshToken string `json:"refreshToken"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &up)

	// 无 CSRF、无 cookie，只靠 body 里的 refresh_token（mobile 模式）
	wm, _ := httpDo(t, h, "POST", "/api/auth/refresh?client_type=mobile",
		map[string]any{"refresh_token": up.RefreshToken}, nil, nil)
	if wm.Code != 200 {
		t.Fatalf("mobile refresh status=%d body=%s", wm.Code, wm.Body.String())
	}
	var minted struct {
		AccessToken  string `json:"accessToken"`
		RefreshToken string `json:"refreshToken"`
		User         struct {
			ID string `json:"id"`
		} `json:"user"`
	}
	_ = json.Unmarshal(wm.Body.Bytes(), &minted)
	if minted.AccessToken == "" || minted.RefreshToken == "" || minted.User.ID == "" {
		t.Fatalf("mobile refresh payload: %s", wm.Body.String())
	}

	// 这个 accessToken 必须能直接读 account-*（和 JWT 是同一套验签）
	sum := requestJSON(t, h, "GET",
		"/functions/tokentracker-account-summary?from=2026-10-01&to=2026-10-31", minted.AccessToken, nil)
	if sum.Code != 200 {
		t.Fatalf("account-summary with minted access token status=%d body=%s", sum.Code, sum.Body.String())
	}

	// sessions/current 也能认它
	cur := requestJSON(t, h, "GET", "/api/auth/sessions/current", minted.AccessToken, nil)
	if cur.Code != 200 || !strings.Contains(cur.Body.String(), "nas@local.test") {
		t.Fatalf("sessions/current status=%d body=%s", cur.Code, cur.Body.String())
	}
}

func TestAuthLogoutRevokesAndClearsCookies(t *testing.T) {
	s, _ := testServer(t)
	h := s.Handler()
	w, cookies := httpDo(t, h, "POST", "/api/auth/users",
		map[string]any{"email": "bye@local.test", "password": "please-sign-out"}, nil, nil)
	if w.Code != 200 {
		t.Fatalf("sign-up status=%d", w.Code)
	}
	refreshTok := cookieByName(cookies, refreshCookieName).Value
	csrfTok := cookieByName(cookies, csrfCookieName).Value

	out, outCookies := httpDo(t, h, "POST", "/api/auth/logout", nil, nil,
		[]*http.Cookie{{Name: refreshCookieName, Value: refreshTok}})
	if out.Code != 200 {
		t.Fatalf("logout status=%d body=%s", out.Code, out.Body.String())
	}
	if c := cookieByName(outCookies, refreshCookieName); c == nil || c.MaxAge >= 0 {
		t.Fatalf("logout must expire the refresh cookie: %+v", c)
	}
	// 撤销后用同一个 refresh token 刷新必须失败
	after, _ := httpDo(t, h, "POST", "/api/auth/refresh", nil,
		map[string]string{"X-CSRF-Token": csrfTok}, []*http.Cookie{{Name: refreshCookieName, Value: refreshTok}})
	if after.Code != 401 {
		t.Fatalf("refresh after logout status=%d body=%s", after.Code, after.Body.String())
	}
}

// cookie 里的 %XX 编码（SDK / encodeURIComponent）必须先解码再查库，否则永远 401。
func TestAuthRefreshAcceptsPercentEncodedCookie(t *testing.T) {
	s, _ := testServer(t)
	h := s.Handler()
	w, _ := httpDo(t, h, "POST", "/api/auth/users",
		map[string]any{"email": "enc@local.test", "password": "encoded-cookie"}, nil, nil)
	if w.Code != 200 {
		t.Fatalf("sign-up status=%d", w.Code)
	}
	var up struct {
		RefreshToken string `json:"refreshToken"`
		CSRFToken    string `json:"csrfToken"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &up)
	// 手工百分号编码一次（模拟浏览器把 % 转义）
	encoded := strings.ReplaceAll(up.RefreshToken, "a", "%61")
	r, _ := httpDo(t, h, "POST", "/api/auth/refresh", nil,
		map[string]string{"X-CSRF-Token": up.CSRFToken},
		[]*http.Cookie{{Name: refreshCookieName, Value: encoded}})
	if r.Code != 200 {
		t.Fatalf("percent-encoded cookie rejected: status=%d body=%s", r.Code, r.Body.String())
	}
}

// 并发 mint 的宽限期：同一份 refresh token 被多个组件同时取用时，后到的那个不该 401。
// 客户端没有 single-flight（issue #38 的真实故障），所以这条由服务端兜住。
func TestAuthRefreshGraceWindow(t *testing.T) {
	s, _ := testServer(t)
	h := s.Handler()
	mustSignUp(t, h, "grace@example.com", "correct horse battery")

	w, _ := httpDo(t, h, "POST", "/api/auth/sessions",
		map[string]any{"email": "grace@example.com", "password": "correct horse battery"}, nil, nil)
	if w.Code != 200 {
		t.Fatalf("sign-in status=%d body=%s", w.Code, w.Body.String())
	}
	var sess struct {
		RefreshToken string `json:"refreshToken"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &sess)
	orig := sess.RefreshToken

	// 第一次刷新：正常轮换
	mintMobile := func(tok string) *httptest.ResponseRecorder {
		r, _ := httpDo(t, h, "POST", "/api/auth/refresh?client_type=mobile",
			map[string]any{"refresh_token": tok}, nil, nil)
		return r
	}
	w1 := mintMobile(orig)
	if w1.Code != 200 {
		t.Fatalf("first mint status=%d body=%s", w1.Code, w1.Body.String())
	}
	var first struct {
		RefreshToken string `json:"refreshToken"`
	}
	_ = json.Unmarshal(w1.Body.Bytes(), &first)

	// 第二次用同一份旧 token：宽限期内 → 仍然 200，且带回标记头
	w2 := mintMobile(orig)
	if w2.Code != 200 {
		t.Fatalf("grace mint status=%d body=%s", w2.Code, w2.Body.String())
	}
	if got := w2.Header().Get("X-TokenTracker-Refresh"); got != "grace" {
		t.Fatalf("grace mint header=%q，期望 grace", got)
	}
	var second struct {
		RefreshToken string `json:"refreshToken"`
	}
	_ = json.Unmarshal(w2.Body.Bytes(), &second)
	// 幂等：宽限期**不再另签一份**，而是把同一个接替者再给一次（issue #47）。
	// 否则 N 路并发各得一份、客户端只有一个存储位，落盘的很可能是链中间那份。
	if second.RefreshToken != first.RefreshToken {
		t.Fatalf("宽限期应返回同一份接替 token（得到 %q，期望 %q）", second.RefreshToken, first.RefreshToken)
	}

	// 用"已经被换掉的旧 token"登出（并发 mint 里没抢到先到的那个组件就是这种情况）：
	// 接替者必须一并失效，否则点了登出等于没登出。
	wOut, _ := httpDo(t, h, "POST", "/api/auth/logout",
		map[string]any{"refresh_token": orig}, nil, nil)
	if wOut.Code != 200 {
		t.Fatalf("logout status=%d body=%s", wOut.Code, wOut.Body.String())
	}
	if r := mintMobile(first.RefreshToken); r.Code != 401 {
		t.Fatalf("登出后 successor 仍可用: status=%d body=%s", r.Code, r.Body.String())
	}
}

// issue #47 的核心：客户端一次开页面会并发提交 N 个相同的 refresh 请求。
// 服务端必须让它们收敛到**同一份**新 token，否则客户端只有一个存储位，互相覆盖后
// 留下的常常是链中间那份已轮换的 token，下次请求就取不到 token → 不带 Authorization。
func TestAuthRefreshConcurrentMintIsIdempotent(t *testing.T) {
	s, db := testServer(t)
	h := s.Handler()
	mustSignUp(t, h, "burst@example.com", "correct horse battery")

	w, _ := httpDo(t, h, "POST", "/api/auth/sessions",
		map[string]any{"email": "burst@example.com", "password": "correct horse battery"}, nil, nil)
	var sess struct {
		RefreshToken string `json:"refreshToken"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &sess)
	orig := sess.RefreshToken

	const n = 20
	tokens := make([]string, n)
	codes := make([]int, n)
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			// 不用 httpDo：它内部会碰 *testing.T（Helper/Fatal），在 goroutine 里不安全。
			req := httptest.NewRequest("POST", "/api/auth/refresh?client_type=mobile",
				strings.NewReader(`{"refresh_token":"`+orig+`"}`))
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			r := rec
			codes[i] = r.Code
			var body struct {
				RefreshToken string `json:"refreshToken"`
			}
			_ = json.Unmarshal(r.Body.Bytes(), &body)
			tokens[i] = body.RefreshToken
		}(i)
	}
	wg.Wait()

	for i := 0; i < n; i++ {
		if codes[i] != 200 {
			t.Fatalf("burst[%d] status=%d，期望全部 200", i, codes[i])
		}
		if tokens[i] != tokens[0] {
			t.Fatalf("burst[%d] token=%q 与 burst[0]=%q 不同：并发刷新必须幂等", i, tokens[i], tokens[0])
		}
	}

	// 链不能膨胀：旧 token 那一层只该有**一个**子会话。
	var children int
	if err := db.QueryRow(`SELECT count(*) FROM auth_sessions WHERE parent_id=
		(SELECT id FROM auth_sessions WHERE token_hash=?)`, tokenHash(orig)).Scan(&children); err != nil {
		t.Fatal(err)
	}
	if children != 1 {
		t.Fatalf("旧 token 下挂了 %d 个子会话，期望 1", children)
	}

	// 收敛后的 token 必须是可用的。
	r, _ := httpDo(t, h, "POST", "/api/auth/refresh?client_type=mobile",
		map[string]any{"refresh_token": tokens[0]}, nil, nil)
	if r.Code != 200 {
		t.Fatalf("收敛后的 token 不可用: status=%d body=%s", r.Code, r.Body.String())
	}
}

// 客户端手里若是链中间那份已轮换的 token（历史并发签出的重复品就会这样），
// 宽限期内要能沿链把它带回**当前存活**的那一份，而不是 401、也不是再签一份。
func TestAuthRefreshFollowsRotatedChainToLiveToken(t *testing.T) {
	s, _ := testServer(t)
	h := s.Handler()
	mustSignUp(t, h, "chain@example.com", "correct horse battery")

	w, _ := httpDo(t, h, "POST", "/api/auth/sessions",
		map[string]any{"email": "chain@example.com", "password": "correct horse battery"}, nil, nil)
	var sess struct {
		RefreshToken string `json:"refreshToken"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &sess)

	mint := func(tok string) (int, string) {
		r, _ := httpDo(t, h, "POST", "/api/auth/refresh?client_type=mobile",
			map[string]any{"refresh_token": tok}, nil, nil)
		var body struct {
			RefreshToken string `json:"refreshToken"`
		}
		_ = json.Unmarshal(r.Body.Bytes(), &body)
		return r.Code, body.RefreshToken
	}

	code, gen1 := mint(sess.RefreshToken) // 第一层
	if code != 200 {
		t.Fatalf("gen1 status=%d", code)
	}
	code, gen2 := mint(gen1) // 第二层：gen1 随之失效
	if code != 200 {
		t.Fatalf("gen2 status=%d", code)
	}
	// 拿中间的 gen1（已被轮换）去刷新 → 必须给回 gen2，而不是又造一份
	code, got := mint(gen1)
	if code != 200 {
		t.Fatalf("中间 token status=%d，宽限期内应命中间接替者", code)
	}
	if got != gen2 {
		t.Fatalf("中间 token 得到 %q，期望链尾 %q", got, gen2)
	}
	// 再走一层后回到更早的 gen1，应继续追到新的链尾
	code, gen3 := mint(got)
	if code != 200 {
		t.Fatalf("gen3 status=%d", code)
	}
	code, got = mint(gen1)
	if code != 200 || got != gen3 {
		t.Fatalf("回到链尾失败: status=%d token=%q 期望 %q", code, got, gen3)
	}
}

// 宽限期必须能被严格模式关掉，且不会被"过期的旧 token"钻空子。
func TestAuthRefreshGraceBoundaries(t *testing.T) {
	s, db := testServer(t)
	h := s.Handler()
	mustSignUp(t, h, "strict@example.com", "correct horse battery")

	w, _ := httpDo(t, h, "POST", "/api/auth/sessions",
		map[string]any{"email": "strict@example.com", "password": "correct horse battery"}, nil, nil)
	var sess struct {
		RefreshToken string `json:"refreshToken"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &sess)
	orig := sess.RefreshToken

	mint := func(tok string) *httptest.ResponseRecorder {
		r, _ := httpDo(t, h, "POST", "/api/auth/refresh?client_type=mobile",
			map[string]any{"refresh_token": tok}, nil, nil)
		return r
	}
	if r := mint(orig); r.Code != 200 {
		t.Fatalf("mint status=%d body=%s", r.Code, r.Body.String())
	}
	// 把 rotated_at 拨到宽限期之外（1 小时前）→ 必须 401 + 标记头
	if _, err := db.Exec(`UPDATE auth_sessions SET rotated_at=? WHERE token_hash=?`,
		"2026-10-25T23:00:00Z", tokenHash(orig)); err != nil {
		t.Fatal(err)
	}
	r := mint(orig)
	if r.Code != 401 || !strings.Contains(r.Body.String(), "REFRESH_TOKEN_REUSED") {
		t.Fatalf("beyond grace status=%d body=%s", r.Code, r.Body.String())
	}
	if got := r.Header().Get("X-TokenTracker-Auth-Error"); got != "refresh_token_reused" {
		t.Fatalf("缺少 X-TokenTracker-Auth-Error（得到 %q）", got)
	}
	if got := r.Header().Get("X-TokenTracker-Refresh"); got != "" {
		t.Fatalf("beyond grace 不该带 grace 标记（得到 %q）", got)
	}
}

func TestAuthBootstrapOwnerFromEnv(t *testing.T) {
	s, _ := testServer(t)
	t.Setenv("TT_AUTH_EMAIL", "root@lan.test")
	t.Setenv("TT_AUTH_PASSWORD", "bootstrap-pass-1")
	created, email, err := s.EnsureAuthBootstrap()
	if err != nil || !created || email != "root@lan.test" {
		t.Fatalf("bootstrap: created=%v email=%q err=%v", created, email, err)
	}
	// 第二次不再创建（也不会覆盖密码）
	again, _, err := s.EnsureAuthBootstrap()
	if err != nil || again {
		t.Fatalf("bootstrap must be idempotent: created=%v err=%v", again, err)
	}
	// 能直接用 bootstrap 的密码登录
	w, _ := httpDo(t, s.Handler(), "POST", "/api/auth/sessions",
		map[string]any{"email": "root@lan.test", "password": "bootstrap-pass-1"}, nil, nil)
	if w.Code != 200 {
		t.Fatalf("bootstrap sign-in status=%d body=%s", w.Code, w.Body.String())
	}
	// 注册在已有 owner 后关闭
	w2, _ := httpDo(t, s.Handler(), "POST", "/api/auth/users",
		map[string]any{"email": "other@lan.test", "password": "another-pass-1"}, nil, nil)
	if w2.Code != 403 {
		t.Fatalf("sign-up should be closed, status=%d body=%s", w2.Code, w2.Body.String())
	}
}

func TestAuthCORSWithCredentials(t *testing.T) {
	s, _ := testServer(t)
	h := s.Handler()
	r := httptest.NewRequest("OPTIONS", "/api/auth/refresh", nil)
	r.Header.Set("Origin", "http://127.0.0.1:7680")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 204 {
		t.Fatalf("preflight status=%d", w.Code)
	}
	if w.Header().Get("Access-Control-Allow-Origin") != "http://127.0.0.1:7680" ||
		w.Header().Get("Access-Control-Allow-Credentials") != "true" {
		t.Fatalf("CORS headers: %v", w.Header())
	}
	if !strings.Contains(w.Header().Get("Access-Control-Allow-Headers"), "X-CSRF-Token") {
		t.Fatalf("CSRF header must be allowed: %q", w.Header().Get("Access-Control-Allow-Headers"))
	}
}

func TestPasswordHashRoundTrip(t *testing.T) {
	h := hashPassword("s3cret-pass")
	if !strings.HasPrefix(h, "pbkdf2_sha256$") {
		t.Fatalf("hash format: %s", h)
	}
	if !verifyPassword(h, "s3cret-pass") {
		t.Fatal("correct password rejected")
	}
	if verifyPassword(h, "s3cret-pas") || verifyPassword(h, "") || verifyPassword("garbage", "x") {
		t.Fatal("wrong password accepted")
	}
	if hashPassword("s3cret-pass") == h {
		t.Fatal("hash must be salted")
	}
}
