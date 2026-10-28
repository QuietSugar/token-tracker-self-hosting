package app

// oauth.go —— 与 InsForge **同流程**的自托管认证实现（oauth / session 两条路）。
//
// 为什么需要它：官方客户端的「跨设备 account 视图」是这样走的
//
//	菜单栏 popover
//	  → 本地 CLI(127.0.0.1:7680)，把浏览器的登录 cookie 转存为 relay cookies
//	  → POST {base}/api/auth/refresh?client_type=mobile  {refresh_token}
//	  → GET  {base}/functions/tokentracker-account-*     Authorization: Bearer <accessToken>
//
// 之前只实现了 `/functions/*`，没有 `/api/auth/*`，这条链在第一步就断了，
// 于是 account 视图永远退回"仅本机"。本文件补齐最小流程。
//
// 与 InsForge 对齐的**流程与形状**（不是它的实现）：
//
//	1. 注册/登录  → 一次性给 access token(短) + refresh token(长) + csrf token
//	2. access token 是我们自己的 HS256 JWT（sub=用户 id，role=authenticated），
//	   它同时就是 /functions/* 的 Authorization 凭据 —— 不需要第二套验签。
//	3. 刷新 → POST /api/auth/refresh：轮换 refresh token（旧的立即失效），
//	   browser 模式（cookie）必须带 X-CSRF-Token；mobile 模式（body refresh_token）不需要 CSRF。
//	4. 撤销 → POST /api/auth/logout：把该 refresh token 标记 revoked。
//	   再次使用已撤销的 token 视为泄露信号：撤销该用户全部会话。
//
// 存储：只存 refresh/csrf 的 SHA-256；密码只存 PBKDF2-HMAC-SHA256。
// 表在 store 的 additive migration #1（auth_credentials / auth_sessions）。
//
// 明确不做（自托管定位）：OAuth 第三方登录、邮件验证/找回密码、多用户管理后台。

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	refreshCookieName = "insforge_refresh_token"
	csrfCookieName    = "insforge_csrf_token"
	pbkdf2Iterations  = 120_000
)

// authConfig 是认证相关的运行时配置（全部有安全默认值）。
type authConfig struct {
	accessTTL  time.Duration
	refreshTTL time.Duration
	allowNew   bool     // 已有 owner 后是否还允许自助注册
	origins    []string // 非空时只允许这些 Origin 带凭据跨域
	cookieMode string   // auto | true | false
	// revokeOnReuse：检测到已轮换的 refresh token 被重放时，撤销该用户全部会话。
	// 默认 false —— 并发刷新比"泄露"常见得多（见 authRefresh 的注释）。
	revokeOnReuse bool
}

func loadAuthConfig() authConfig {
	return authConfig{
		accessTTL:     time.Duration(envInt("TT_ACCESS_TOKEN_TTL", 3600)) * time.Second,
		refreshTTL:    time.Duration(envInt("TT_REFRESH_TOKEN_TTL", 90*24*3600)) * time.Second,
		allowNew:      os.Getenv("TT_AUTH_ALLOW_SIGNUP") == "true",
		origins:       splitCSV(os.Getenv("TT_AUTH_ALLOWED_ORIGINS")),
		cookieMode:    strings.ToLower(envOr("TT_AUTH_COOKIE_SECURE", "auto")),
		revokeOnReuse: os.Getenv("TT_AUTH_REVOKE_ON_REUSE") == "true",
	}
}

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return def
}

func splitCSV(s string) []string {
	var out []string
	for _, part := range strings.Split(s, ",") {
		if p := strings.TrimSpace(part); p != "" {
			out = append(out, strings.TrimSuffix(p, "/"))
		}
	}
	return out
}

// ---------- 路由 ----------

// authAPI 是 /api/auth/ 的总入口。用绝对路径分发（与 InsForge SDK 的调用一一对应）。
func (s *Server) authAPI(w http.ResponseWriter, r *http.Request) {
	s.applyAuthCORS(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	path := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/api/auth/"), "/")
	switch {
	case path == "users" && r.Method == http.MethodPost:
		s.authSignUp(w, r)
	case path == "sessions" && r.Method == http.MethodPost:
		s.authSignIn(w, r)
	case path == "sessions/current" && r.Method == http.MethodGet:
		s.authCurrentSession(w, r)
	case path == "sessions" && r.Method == http.MethodGet:
		s.authListSessions(w, r)
	case path == "refresh" && r.Method == http.MethodPost:
		s.authRefresh(w, r)
	case path == "logout" && r.Method == http.MethodPost:
		s.authLogout(w, r)
	case path == "public-config" && r.Method == http.MethodGet:
		s.authPublicConfig(w, r)
	case path == "profiles/current" && r.Method == http.MethodGet:
		s.authProfile(w, r)
	case path == "owner" && r.Method == http.MethodGet:
		s.authOwnerInfo(w, r)
	default:
		writeJSON(w, 404, map[string]any{"error": "Not found", "code": "NOT_FOUND"})
	}
}

// applyAuthCORS：带 cookie 的跨域请求不能用 `*`，必须回显 Origin + 允许凭据。
// 默认回显任何 Origin（局域网自用）；设 TT_AUTH_ALLOWED_ORIGINS 可收紧。
func (s *Server) applyAuthCORS(w http.ResponseWriter, r *http.Request) {
	origin := strings.TrimSuffix(r.Header.Get("Origin"), "/")
	if origin == "" {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		return
	}
	allowed := len(s.authCfg.origins) == 0
	for _, o := range s.authCfg.origins {
		if o == origin {
			allowed = true
			break
		}
	}
	if !allowed {
		return
	}
	w.Header().Set("Access-Control-Allow-Origin", origin)
	w.Header().Set("Access-Control-Allow-Credentials", "true")
	w.Header().Set("Vary", "Origin")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, apikey, X-CSRF-Token, X-Requested-With")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Max-Age", "600")
}

// ---------- 注册 / 登录 ----------

func (s *Server) authSignUp(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		Name     string `json:"name"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&b) != nil {
		authFail(w, 400, "INVALID_BODY", "Request body must be JSON with email and password")
		return
	}
	email := normalizeEmail(b.Email)
	if !validEmail(email) || len(b.Password) < 8 {
		authFail(w, 400, "INVALID_CREDENTIALS_FORMAT", "A valid email and a password of at least 8 characters are required")
		return
	}
	var owners int
	if err := s.db.QueryRow(`SELECT count(*) FROM auth_credentials`).Scan(&owners); err != nil {
		authFail(w, 500, "INTERNAL", err.Error())
		return
	}
	if owners > 0 && !s.authCfg.allowNew {
		authFail(w, 403, "SIGNUP_DISABLED",
			"This instance already has an owner account; sign-up is closed. Set TT_AUTH_ALLOW_SIGNUP=true to allow more accounts.")
		return
	}
	// owner 已存在但还没有密码（例如先跑过 device-login）→ 把凭据挂到它身上，
	// 不再另建账户，否则又会出现"设备在一个账户、数据在另一个账户"。
	uid, err := s.adoptableOwner()
	if err != nil {
		authFail(w, 500, "INTERNAL", err.Error())
		return
	}
	fresh := uid == ""
	if fresh {
		uid = newID()
		if err := s.ensureAccount(uid); err != nil {
			authFail(w, 500, "INTERNAL", err.Error())
			return
		}
	}
	if _, err := s.db.Exec(`UPDATE auth_users SET email=? WHERE id=?`, email, uid); err != nil {
		authFail(w, 500, "INTERNAL", err.Error())
		return
	}
	if _, err := s.db.Exec(`INSERT INTO auth_credentials(user_id,email,password_hash,created_at) VALUES(?,?,?,?)`,
		uid, email, hashPassword(b.Password), s.nowISO()); err != nil {
		authFail(w, 409, "EMAIL_TAKEN", "That email is already registered on this instance")
		return
	}
	if fresh {
		if err := s.claimOwner(uid, "signup"); err != nil {
			authFail(w, 500, "INTERNAL", err.Error())
			return
		}
	}
	s.respondWithSession(w, r, uid, "browser", "")
}

func (s *Server) authSignIn(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&b) != nil {
		authFail(w, 400, "INVALID_BODY", "Request body must be JSON with email and password")
		return
	}
	email := normalizeEmail(b.Email)
	var uid, stored string
	err := s.db.QueryRow(`SELECT user_id,password_hash FROM auth_credentials WHERE email=?`, email).Scan(&uid, &stored)
	if err != nil || !verifyPassword(stored, b.Password) {
		// 不区分「邮箱不存在」与「密码错」，避免枚举账号。
		authFail(w, 401, "INVALID_CREDENTIALS", "Invalid email or password")
		return
	}
	s.respondWithSession(w, r, uid, "browser", "")
}

// respondWithSession 签发一对 token 并回写 cookie（browser 模式）。
// parent 是「这一份换掉的是哪一行」，登入时为 ""，轮换/宽限期为被换掉行的 id。
func (s *Server) respondWithSession(w http.ResponseWriter, r *http.Request, uid, client, parent string) {
	refresh, csrf, err := s.newSession(uid, client, parent)
	if err != nil {
		authFail(w, 500, "INTERNAL", err.Error())
		return
	}
	user, err := s.userPayload(uid)
	if err != nil {
		authFail(w, 500, "INTERNAL", err.Error())
		return
	}
	if client == "browser" {
		s.setAuthCookies(w, r, refresh, csrf)
	}
	writeJSON(w, 200, map[string]any{
		"accessToken":  s.signJWT(uid, "authenticated", s.now.Add(s.authCfg.accessTTL).Unix()),
		"refreshToken": refresh,
		"csrfToken":    csrf,
		"user":         user,
	})
}

// ---------- 刷新 / 撤销 ----------

func (s *Server) authRefresh(w http.ResponseWriter, r *http.Request) {
	// mobile 模式：body 里带 refresh_token（官方客户端的 performMint 就这么调）。
	// browser 模式：refresh token 在 httpOnly cookie 里，另需 X-CSRF-Token。
	var b struct {
		RefreshToken string `json:"refresh_token"`
		RefreshCamel string `json:"refreshToken"`
	}
	_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&b)
	bodyToken := firstNonEmpty(b.RefreshToken, b.RefreshCamel)
	mobile := r.URL.Query().Get("client_type") == "mobile" || bodyToken != ""

	token := bodyToken
	client := "mobile"
	if !mobile {
		client = "browser"
		token = cookieValue(r, refreshCookieName)
	}
	if token == "" {
		authFail(w, 401, "AUTH_UNAUTHORIZED", "Missing refresh token")
		return
	}

	var id, uid, csrfHash, expiresAt string
	var revoked, rotatedAt sql.NullString
	err := s.db.QueryRow(`SELECT id,user_id,csrf_hash,expires_at,revoked_at,rotated_at FROM auth_sessions WHERE token_hash=?`,
		tokenHash(token)).Scan(&id, &uid, &csrfHash, &expiresAt, &revoked, &rotatedAt)
	if err != nil {
		authFail(w, 401, "AUTH_UNAUTHORIZED", "Invalid refresh token")
		return
	}
	if revoked.Valid {
		// 已撤销/已轮换的 token 又被使用。
		//
		// 默认只拒绝，**不**全量撤销：官方客户端有两条并发的取数路径
		// （popover 的 account 视图 + dashboard 自己的刷新），它们各自持有一份
		// relay 里读到的 refresh token；把一次并发当成"令牌泄露"会让用户莫名其妙被登出。
		// 需要更严的策略时设 TT_AUTH_REVOKE_ON_REUSE=true（泄露处置场景）。
		if s.authCfg.revokeOnReuse {
			_, _ = s.db.Exec(`UPDATE auth_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL`,
				s.nowISO(), uid)
			authFail(w, 401, "REFRESH_TOKEN_REUSED", "Refresh token was already rotated or revoked")
			return
		}
		// 宽限期：因**轮换**而失效的 token，在 refreshGrace 之内再用一次不算重放。
		//
		// 为什么需要（真实故障，issue #38 后续实测）：桌面 GUI 的 webview 里多个组件
		// 并发拿同一份 refresh token 去 mint，轮换是"旧的立刻失效、发新的"，先到的那个
		// 成功、后到的命中 revoked_at → 401 → 前端当成鉴权失效 → 重试 → 再撞，页面卡在
		// 「登录状态需要刷新」并循环。客户端没有做 single-flight，这一点我们改不了。
		//
		// 三种失效必须区分开，所以只看 rotated_at 而不看 revoked_at：
		//   - 轮换（这里）：宽限期内再签一份新会话，等价于"两个组件各拿一份"；
		//   - 登出：立即失效，不给宽限；
		//   - 泄露处置（revokeOnReuse=true）：走上面的硬拒绝。
		//
		// 代价：这段时间内一份被偷走的旧 token 仍可换到新会话。定位是局域网单实例自用，
		// 且只要 rotate 时不留原文（本服务只存 SHA-256）就够；要零宽限请开严格模式。
		if rotatedAt.Valid && s.withinRefreshGrace(rotatedAt.String) {
			if client == "browser" {
				got := r.Header.Get("X-CSRF-Token")
				if got == "" || subtle.ConstantTimeCompare([]byte(tokenHash(got)), []byte(csrfHash)) != 1 {
					authFail(w, 403, "INVALID_CSRF_TOKEN", "Missing or invalid CSRF token")
					return
				}
			}
			w.Header().Set("X-TokenTracker-Refresh", "grace")
			s.respondWithSession(w, r, uid, client, id)
			return
		}
		// 过期太久的旧 token：明确告诉调用方"重试没用"。
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-TokenTracker-Auth-Error", "refresh_token_reused")
		authFail(w, 401, "REFRESH_TOKEN_REUSED", "Refresh token was already rotated or revoked")
		return
	}
	if expiresAt < s.nowISO() {
		authFail(w, 401, "AUTH_UNAUTHORIZED", "Refresh token expired")
		return
	}
	if client == "browser" {
		got := r.Header.Get("X-CSRF-Token")
		if got == "" || subtle.ConstantTimeCompare([]byte(tokenHash(got)), []byte(csrfHash)) != 1 {
			authFail(w, 403, "INVALID_CSRF_TOKEN", "Missing or invalid CSRF token")
			return
		}
	}
	// 轮换：旧的立即失效（同时记 rotated_at，供宽限期判定），新的接替（client 类型不变）。
	if _, err := s.db.Exec(`UPDATE auth_sessions SET revoked_at=?, rotated_at=? WHERE id=? AND revoked_at IS NULL`,
		s.nowISO(), s.nowISO(), id); err != nil {
		authFail(w, 500, "INTERNAL", err.Error())
		return
	}
	s.respondWithSession(w, r, uid, client, id)
}

func (s *Server) authLogout(w http.ResponseWriter, r *http.Request) {
	var b struct {
		RefreshToken string `json:"refresh_token"`
		RefreshCamel string `json:"refreshToken"`
	}
	_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&b)
	token := firstNonEmpty(b.RefreshToken, b.RefreshCamel, cookieValue(r, refreshCookieName))
	if token != "" {
		h := tokenHash(token)
		// 先撤销这一行；如果它已经被轮换掉（客户端手里是旧 token，比如并发 mint 里
		// 没抢到"先到"的那个），再顺着 parent_id 撤销接替者，否则点了登出等于没登出。
		_, _ = s.db.Exec(`UPDATE auth_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL`,
			s.nowISO(), h)
		// 顺着 parent_id 递归撤掉整条接替链（并发 mint 下可能不止一层）。
		// rotated_at 一并清空：它与 revoked_at 一起表示"这是轮换留下的旧行"，
		// 留着就会让宽限期把一次明确的登出又变回可用（见 authRefresh 的宽限期分支）。
		const chain = `WITH RECURSIVE chain AS (
			SELECT id FROM auth_sessions WHERE token_hash=?
			UNION ALL
			SELECT c.id FROM auth_sessions c JOIN chain ON c.parent_id = chain.id
		)`
		// 两条语句而不是一条：链上中间那些行往往已经被轮换撤销过，
		// 一条带 revoked_at IS NULL 的 UPDATE 会跳过它们、把 rotated_at 留下。
		_, _ = s.db.Exec(chain+` UPDATE auth_sessions SET rotated_at=NULL WHERE id IN (SELECT id FROM chain)`, h)
		_, _ = s.db.Exec(chain+` UPDATE auth_sessions SET revoked_at=?
			WHERE revoked_at IS NULL AND id IN (SELECT id FROM chain)`, h, s.nowISO())
	}
	s.clearAuthCookies(w, r)
	writeJSON(w, 200, map[string]any{"success": true})
}

// ---------- 读取当前用户 ----------

func (s *Server) authCurrentSession(w http.ResponseWriter, r *http.Request) {
	sub, _, _, ok := s.auth(r)
	if !ok {
		authFail(w, 401, "AUTH_UNAUTHORIZED", "Authentication required")
		return
	}
	user, err := s.userPayload(sub)
	if err != nil {
		authFail(w, 401, "AUTH_UNAUTHORIZED", "Session user no longer exists")
		return
	}
	writeJSON(w, 200, map[string]any{"user": user})
}

func (s *Server) authProfile(w http.ResponseWriter, r *http.Request) {
	sub, _, _, ok := s.auth(r)
	if !ok {
		authFail(w, 401, "AUTH_UNAUTHORIZED", "Authentication required")
		return
	}
	user, err := s.userPayload(sub)
	if err != nil {
		authFail(w, 401, "AUTH_UNAUTHORIZED", "Session user no longer exists")
		return
	}
	writeJSON(w, 200, map[string]any{"profile": nil, "user": user})
}

// authListSessions：客户端"已登录设备"页会读它；自托管只需要能返回结构。
func (s *Server) authListSessions(w http.ResponseWriter, r *http.Request) {
	sub, _, _, ok := s.auth(r)
	if !ok {
		authFail(w, 401, "AUTH_UNAUTHORIZED", "Authentication required")
		return
	}
	rows, err := s.db.Query(`SELECT id,client,created_at,expires_at,revoked_at FROM auth_sessions
		WHERE user_id=? ORDER BY created_at DESC`, sub)
	if err != nil {
		authFail(w, 500, "INTERNAL", err.Error())
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, client, created, expires string
		var revoked sql.NullString
		if err := rows.Scan(&id, &client, &created, &expires, &revoked); err != nil {
			authFail(w, 500, "INTERNAL", err.Error())
			return
		}
		item := map[string]any{"id": id, "clientType": client, "createdAt": created, "expiresAt": expires}
		if revoked.Valid {
			item["revokedAt"] = revoked.String
		}
		items = append(items, item)
	}
	writeJSON(w, 200, map[string]any{"sessions": items})
}

func (s *Server) authPublicConfig(w http.ResponseWriter, r *http.Request) {
	var owners int
	_ = s.db.QueryRow(`SELECT count(*) FROM auth_credentials`).Scan(&owners)
	writeJSON(w, 200, map[string]any{
		"emailSignIn":       true,
		"emailSignUp":       owners == 0 || s.authCfg.allowNew,
		"passwordMinLength": 8,
		"oauthProviders":    []string{},
		"selfHosted":        true,
	})
}

// ---------- 内部工具 ----------

// newSession 落库一条 refresh 会话（轮换时调用方负责先撤销旧行）。
func (s *Server) newSession(uid, client, parent string) (refresh, csrf string, err error) {
	refresh = randomHex(32)
	csrf = randomHex(16)
	var parentCol any
	if parent != "" {
		parentCol = parent // 登录签发时留 NULL，避免写一堆无意义的空串
	}
	_, err = s.db.Exec(`INSERT INTO auth_sessions(id,user_id,token_hash,csrf_hash,client,created_at,expires_at,parent_id)
		VALUES(?,?,?,?,?,?,?,?)`,
		newID(), uid, tokenHash(refresh), tokenHash(csrf), client,
		s.nowISO(), s.now.Add(s.authCfg.refreshTTL).UTC().Format(time.RFC3339), parentCol)
	return refresh, csrf, err
}

func (s *Server) userPayload(uid string) (map[string]any, error) {
	var email string
	if err := s.db.QueryRow(`SELECT email FROM auth_users WHERE id=?`, uid).Scan(&email); err != nil {
		return nil, err
	}
	return map[string]any{
		"id":            uid,
		"email":         email,
		"name":          "",
		"emailVerified": true,
		"profile":       nil,
		"createdAt":     s.nowISO(),
	}, nil
}

func (s *Server) secureCookies(r *http.Request) bool {
	switch s.authCfg.cookieMode {
	case "true":
		return true
	case "false":
		return false
	}
	if r.TLS != nil {
		return true
	}
	return strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

func (s *Server) setAuthCookies(w http.ResponseWriter, r *http.Request, refresh, csrf string) {
	secure := ""
	if s.secureCookies(r) {
		secure = "; Secure"
	}
	maxAge := int(s.authCfg.refreshTTL.Seconds())
	// refresh：HttpOnly（JS 读不到，只能靠 SDK 的凭据转发）
	http.SetCookie(w, &http.Cookie{
		Name: refreshCookieName, Value: refresh, Path: "/", HttpOnly: true,
		SameSite: http.SameSiteLaxMode, MaxAge: maxAge, Secure: secure != "",
	})
	// csrf：必须可被 JS 读取（SDK 的 getCsrfToken 从 document.cookie 取），所以不设 HttpOnly
	http.SetCookie(w, &http.Cookie{
		Name: csrfCookieName, Value: csrf, Path: "/",
		SameSite: http.SameSiteLaxMode, MaxAge: maxAge, Secure: secure != "",
	})
}

func (s *Server) clearAuthCookies(w http.ResponseWriter, r *http.Request) {
	for _, name := range []string{refreshCookieName, csrfCookieName} {
		http.SetCookie(w, &http.Cookie{
			Name: name, Value: "", Path: "/", HttpOnly: name == refreshCookieName,
			SameSite: http.SameSiteLaxMode, MaxAge: -1,
		})
	}
}

func cookieValue(r *http.Request, name string) string {
	c, err := r.Cookie(name)
	if err != nil {
		return ""
	}
	if v, err := urlQueryUnescape(c.Value); err == nil {
		return v
	}
	return c.Value
}

// urlQueryUnescape 处理 cookie 里被 encodeURIComponent 过的值（%2D 之类）。
func urlQueryUnescape(s string) (string, error) {
	if !strings.Contains(s, "%") {
		return s, nil
	}
	return decodePercent(s)
}

// authFail 统一错误形状：InsForge SDK 读 `error` + `code`，据此决定是否触发刷新。
// refreshGrace 是「因轮换失效的 refresh token 仍可再换一次」的宽限窗口。
//
// 60 秒足够覆盖客户端里多个组件并发 mint 的抖动（它们几乎同时发出），
// 也覆盖 relay 每 60s 轮换一次的节拍；再长就把轮换的意义稀释掉了。
const refreshGrace = 60 * time.Second

// withinRefreshGrace 判断 rotated_at 是否落在宽限期内。时间戳是服务端自己写的 RFC3339，
// 解析失败按「不在宽限期」处理（宁可拒绝，也不要因为脏数据放行）。
func (s *Server) withinRefreshGrace(rotatedAt string) bool {
	t, err := time.Parse(time.RFC3339Nano, rotatedAt)
	if err != nil {
		t, err = time.Parse(time.RFC3339, rotatedAt)
		if err != nil {
			return false
		}
	}
	return s.now.Sub(t) >= 0 && s.now.Sub(t) <= refreshGrace
}

func authFail(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, map[string]any{"error": msg, "code": code, "statusCode": status, "message": msg})
}

func normalizeEmail(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

func validEmail(s string) bool {
	at := strings.IndexByte(s, '@')
	if at < 1 || at == len(s)-1 {
		return false
	}
	if strings.ContainsAny(s, " \t\r\n<>") {
		return false
	}
	return strings.Contains(s[at+1:], ".")
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

// ---------- 密码哈希（PBKDF2-HMAC-SHA256，标准库实现，避免额外依赖） ----------

func hashPassword(password string) string {
	salt := make([]byte, 16)
	_, _ = rand.Read(salt)
	dk := pbkdf2SHA256([]byte(password), salt, pbkdf2Iterations, 32)
	return fmt.Sprintf("pbkdf2_sha256$%d$%s$%s", pbkdf2Iterations,
		base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(dk))
}

func verifyPassword(stored, password string) bool {
	parts := strings.Split(stored, "$")
	if len(parts) != 4 || parts[0] != "pbkdf2_sha256" {
		return false
	}
	iter, err := strconv.Atoi(parts[1])
	if err != nil || iter <= 0 || iter > 5_000_000 {
		return false
	}
	salt, err1 := base64.RawStdEncoding.DecodeString(parts[2])
	want, err2 := base64.RawStdEncoding.DecodeString(parts[3])
	if err1 != nil || err2 != nil {
		return false
	}
	got := pbkdf2SHA256([]byte(password), salt, iter, len(want))
	return subtle.ConstantTimeCompare(got, want) == 1
}

// pbkdf2SHA256 是 RFC 8018 PBKDF2 的最小实现（够用即可，不引入 x/crypto）。
func pbkdf2SHA256(password, salt []byte, iter, keyLen int) []byte {
	hashLen := sha256.Size
	blocks := (keyLen + hashLen - 1) / hashLen
	out := make([]byte, 0, blocks*hashLen)
	var idx [4]byte
	for block := 1; block <= blocks; block++ {
		binary.BigEndian.PutUint32(idx[:], uint32(block))
		mac := hmac.New(sha256.New, password)
		mac.Write(salt)
		mac.Write(idx[:])
		u := mac.Sum(nil)
		t := make([]byte, len(u))
		copy(t, u)
		for i := 1; i < iter; i++ {
			mac = hmac.New(sha256.New, password)
			mac.Write(u)
			u = mac.Sum(nil)
			for j := range t {
				t[j] ^= u[j]
			}
		}
		out = append(out, t...)
	}
	return out[:keyLen]
}

// ---------- 首次启动的 owner 引导 ----------

// EnsureAuthBootstrap 在启动时调用：如果配置了 TT_AUTH_EMAIL / TT_AUTH_PASSWORD
// 且库里还没有任何凭据，就创建这个 owner 账户。
//
// 为什么需要：官方客户端/dashboard 的登录框需要一组已知的邮箱密码；
// 自托管没有注册后台，用环境变量把"这台机器的所有者"钉下来最省事。
// 不配置也完全能用：第一个访问 /api/auth/users（注册）的人成为 owner。
//
// 返回是否新建了账户；密码不打印、不落日志（只回报邮箱与 user id）。
func (s *Server) EnsureAuthBootstrap() (created bool, email string, err error) {
	emailRaw := os.Getenv("TT_AUTH_EMAIL")
	pass := os.Getenv("TT_AUTH_PASSWORD")
	if emailRaw == "" || pass == "" {
		return false, "", nil
	}
	email = normalizeEmail(emailRaw)
	if !validEmail(email) || len(pass) < 8 {
		return false, "", errors.New("TT_AUTH_EMAIL must be a valid email and TT_AUTH_PASSWORD at least 8 characters")
	}
	var stored string
	err = s.db.QueryRow(`SELECT password_hash FROM auth_credentials WHERE email=?`, email).Scan(&stored)
	switch {
	case err == nil:
		return false, email, nil // 已存在：不覆盖密码（避免重启把用户改过的密码打回去）
	case !errors.Is(err, sql.ErrNoRows):
		return false, "", err
	}
	// owner 可能已经因为 device-login 而存在（还没有密码）：把凭据挂上去，
	// 而不是新建一个账户 —— 否则设备的用量与登录后的账户会分裂。
	uid, err := s.adoptableOwner()
	if err != nil {
		return false, "", err
	}
	fresh := uid == ""
	if fresh {
		uid = newID()
		if err := s.ensureAccount(uid); err != nil {
			return false, "", err
		}
	} else {
		var existing string
		if err := s.db.QueryRow(`SELECT email FROM auth_users WHERE id=?`, uid).Scan(&existing); err != nil {
			return false, "", err
		}
		if existing != "" && normalizeEmail(existing) != email {
			return false, "", fmt.Errorf("owner account already uses %s; refusing to add %s as a second identity", existing, email)
		}
	}
	if _, err := s.db.Exec(`UPDATE auth_users SET email=? WHERE id=?`, email, uid); err != nil {
		return false, "", err
	}
	if _, err := s.db.Exec(`INSERT INTO auth_credentials(user_id,email,password_hash,created_at) VALUES(?,?,?,?)`,
		uid, email, hashPassword(pass), s.nowISO()); err != nil {
		return false, "", err
	}
	if fresh {
		if err := s.claimOwner(uid, "bootstrap"); err != nil {
			return false, "", err
		}
	}
	return true, email, nil
}

// decodePercent 解 %XX（只用于 cookie 值，等价于 URL 解码但不受 '+' 影响）。
func decodePercent(s string) (string, error) {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		if s[i] != '%' {
			b.WriteByte(s[i])
			continue
		}
		if i+2 >= len(s) {
			return "", errors.New("truncated escape")
		}
		v, err := hex.DecodeString(s[i+1 : i+3])
		if err != nil {
			return "", err
		}
		b.WriteByte(v[0])
		i += 2
	}
	return b.String(), nil
}

// ---------- owner 身份 ----------

// authOwnerInfo 让本机脚本知道"设备与数据归属哪个账户"。
//
// 为什么需要：以前那个 sub 是写死的常量，脚本无需询问；现在 owner 可能是
// 注册/引导/历史认领决定的随机 id。限制为**仅回环地址**可读（不含任何凭据，
// 只是本机自用时的身份查询）；远程机器请用 --sub / JWT 里的 sub。
func (s *Server) authOwnerInfo(w http.ResponseWriter, r *http.Request) {
	if !isLoopbackRequest(r) {
		authFail(w, 403, "LOCAL_ONLY", "owner lookup is only available from 127.0.0.1/::1 on the server host")
		return
	}
	info, err := s.ownerInfo()
	if err != nil {
		authFail(w, 500, "INTERNAL", err.Error())
		return
	}
	writeJSON(w, 200, info)
}

// isLoopbackRequest 判断请求是否来自本机（直连回环，或反代自回环且未带 X-Forwarded-For）。
func isLoopbackRequest(r *http.Request) bool {
	if r.Header.Get("X-Forwarded-For") != "" {
		return false
	}
	host := r.RemoteAddr
	if i := strings.LastIndexByte(host, ':'); i >= 0 {
		host = host[:i]
	}
	host = strings.Trim(host, "[]")
	return host == "127.0.0.1" || host == "::1" || host == "localhost"
}
