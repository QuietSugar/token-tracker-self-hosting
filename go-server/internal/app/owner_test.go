package app

// owner_test.go —— 「device-login 与登录必须是同一个账户」的回归测试。
//
// 这一组用例锁住的是**收敛规则**（见 owner.go），而不是某个实现细节：
// 无论用户先 device-login 还是先注册/引导，设备、用量、access token 都必须
// 指向同一个 owner 账户，否则跨设备汇总会互相看不见。

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

// 先 device-login（auto 模式），再注册：必须是同一个账户，数据不分裂。
func TestDeviceFirstThenSignupConvergesToOneAccount(t *testing.T) {
	s, _ := testServer(t)
	s.deviceApprove = "auto"
	h := s.Handler()

	// ① 设备先接入
	authRes := requestJSON(t, h, "POST", "/functions/tokentracker-device-flow-authorize", "",
		map[string]any{"machine_id": "m-converge"})
	if authRes.Code != 200 {
		t.Fatalf("authorize status=%d", authRes.Code)
	}
	var auth struct {
		DeviceCode string `json:"device_code"`
	}
	_ = json.Unmarshal(authRes.Body.Bytes(), &auth)
	poll := requestJSON(t, h, "POST", "/functions/tokentracker-device-flow-poll", "",
		map[string]any{"device_code": auth.DeviceCode})
	var polled struct {
		UserID      string `json:"user_id"`
		DeviceToken string `json:"device_token"`
	}
	_ = json.Unmarshal(poll.Body.Bytes(), &polled)
	if polled.UserID == "" || polled.DeviceToken == "" {
		t.Fatalf("device login failed: %s", poll.Body.String())
	}

	// 设备先传一条用量
	row := map[string]any{"hour_start": "2026-10-26T09:00:00Z", "source": "claude", "model": "sonnet-4.5",
		"input_tokens": 42, "total_tokens": 42, "billable_total_tokens": 42, "conversation_count": 1}
	if u := requestJSON(t, h, "POST", "/functions/tokentracker-ingest", polled.DeviceToken,
		map[string]any{"hourly": []any{row}}); u.Code != 200 {
		t.Fatalf("ingest status=%d body=%s", u.Code, u.Body.String())
	}

	// ② 之后才注册（这就是"先跑设备、后才配登录"的真实顺序）
	w, _ := httpDo(t, h, "POST", "/api/auth/users",
		map[string]any{"email": "owner@lan.test", "password": "converge-pass"}, nil, nil)
	if w.Code != 200 {
		t.Fatalf("sign-up status=%d body=%s", w.Code, w.Body.String())
	}
	var up struct {
		AccessToken string `json:"accessToken"`
		User        struct {
			ID string `json:"id"`
		} `json:"user"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &up)

	// ③ 关键断言：注册得到的账户 == 设备归属的账户
	if up.User.ID != polled.UserID {
		t.Fatalf("账号分裂：device 归属 %s，注册得到 %s", polled.UserID, up.User.ID)
	}
	// ④ 用登录拿到的 access token 能看到设备传的那条用量（跨设备汇总）
	sum := requestJSON(t, h, "GET",
		"/functions/tokentracker-account-summary?from=2026-10-26&to=2026-10-26", up.AccessToken, nil)
	if sum.Code != 200 || !strings.Contains(sum.Body.String(), `"total_tokens":42`) {
		t.Fatalf("account-summary 看不到设备数据：status=%d body=%s", sum.Code, sum.Body.String())
	}
	// ⑤ 只有一个账户 + 一行 owner
	var users, owners int
	if err := s.db.QueryRow(`SELECT count(*) FROM auth_users`).Scan(&users); err != nil {
		t.Fatal(err)
	}
	if err := s.db.QueryRow(`SELECT count(*) FROM auth_owner`).Scan(&owners); err != nil {
		t.Fatal(err)
	}
	if users != 1 || owners != 1 {
		t.Fatalf("auth_users=%d auth_owner=%d，期望各有 1 条", users, owners)
	}
}

// 反向顺序：先 TT_AUTH_EMAIL 引导 owner，再 device-login → 设备必须落在同一个 owner 上
// （这正是移除 TT_DEFAULT_ACCOUNT 之后要保证的行为）。
func TestBootstrapThenDeviceLoginSameOwner(t *testing.T) {
	s, _ := testServer(t)
	s.deviceApprove = "auto"
	t.Setenv("TT_AUTH_EMAIL", "root@lan.test")
	t.Setenv("TT_AUTH_PASSWORD", "bootstrap-pass-1")
	if created, _, err := s.EnsureAuthBootstrap(); err != nil || !created {
		t.Fatalf("bootstrap: created=%v err=%v", created, err)
	}
	owner, err := s.ownerSub()
	if err != nil || owner == "" {
		t.Fatalf("owner after bootstrap: %q %v", owner, err)
	}
	h := s.Handler()
	authRes := requestJSON(t, h, "POST", "/functions/tokentracker-device-flow-authorize", "", map[string]any{"machine_id": "m-boot"})
	var auth struct {
		DeviceCode string `json:"device_code"`
	}
	_ = json.Unmarshal(authRes.Body.Bytes(), &auth)
	poll := requestJSON(t, h, "POST", "/functions/tokentracker-device-flow-poll", "", map[string]any{"device_code": auth.DeviceCode})
	var polled struct {
		UserID string `json:"user_id"`
	}
	_ = json.Unmarshal(poll.Body.Bytes(), &polled)
	if polled.UserID != owner {
		t.Fatalf("device 归属 %s，owner 是 %s（TT_DEFAULT_ACCOUNT 已移除，不应再出现第三个账户）", polled.UserID, owner)
	}
	// 登录同一个邮箱能读到设备 —— 说明是同一账户
	w, _ := httpDo(t, h, "POST", "/api/auth/sessions",
		map[string]any{"email": "root@lan.test", "password": "bootstrap-pass-1"}, nil, nil)
	if w.Code != 200 {
		t.Fatalf("sign-in status=%d", w.Code)
	}
}

// 老实例：数据在历史固定 sub 上、还没有账号 → 自动认领它做 owner（数据不丢）。
func TestLegacyDefaultAccountIsAdopted(t *testing.T) {
	s, db := testServer(t)
	// 造出"旧版本"的现场：账户 + 设备 + 用量都在那个固定 sub 下
	if err := s.ensureAccount(legacyDefaultSub); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO devices(id,user_id,device_name,platform,machine_id,created_at)
		VALUES(?,?,?,?,?,?)`, "dev-legacy", legacyDefaultSub, "old-host", "linux", "m-legacy", s.nowISO()); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO hourly(user_id,device_id,hour_start,source,model,total_tokens)
		VALUES(?,?,?,?,?,?)`, legacyDefaultSub, "dev-legacy", "2026-10-01T00:00:00Z", "codex", "gpt-6", 7); err != nil {
		t.Fatal(err)
	}

	owner, err := s.ownerSub()
	if err != nil || owner != legacyDefaultSub {
		t.Fatalf("legacy owner = %q err=%v，期望认领 %s", owner, err, legacyDefaultSub)
	}
	// 认领后再引导 owner：凭据必须挂到同一个账户，不会分裂
	t.Setenv("TT_AUTH_EMAIL", "legacy@lan.test")
	t.Setenv("TT_AUTH_PASSWORD", "legacy-pass-1")
	if created, _, err := s.EnsureAuthBootstrap(); err != nil || !created {
		t.Fatalf("bootstrap: %v %v", created, err)
	}
	var ownerAfter string
	if err := db.QueryRow(`SELECT user_id FROM auth_owner WHERE slot=1`).Scan(&ownerAfter); err != nil {
		t.Fatal(err)
	}
	if ownerAfter != legacyDefaultSub {
		t.Fatalf("owner 被 bootstrap 改成了 %s", ownerAfter)
	}
	var users int
	if err := db.QueryRow(`SELECT count(*) FROM auth_users`).Scan(&users); err != nil {
		t.Fatal(err)
	}
	if users != 1 {
		t.Fatalf("auth_users=%d，期望 1（不应新建第二个账户）", users)
	}
}

// 新装机器：库里没有那个历史 sub 时，它**不会**被创建 —— 这就是"移除魔法 UUID"的证明。
func TestFreshInstallDoesNotCreateLegacyAccount(t *testing.T) {
	s, _ := testServer(t)
	if _, err := s.ownerSub(); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := s.db.QueryRow(`SELECT count(*) FROM auth_users WHERE id=?`, legacyDefaultSub).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("新装机器不应出现 %s 这个账户", legacyDefaultSub)
	}
	// 第一次 device-login 才创建账户，且是随机 id
	owner, err := s.ensureOwner("device")
	if err != nil || owner == "" {
		t.Fatalf("ensureOwner: %q %v", owner, err)
	}
	if owner == legacyDefaultSub {
		t.Fatal("新装机器不应把历史 UUID 当 owner")
	}
}

// /api/auth/owner 只给回环地址；远程访问 403。
func TestOwnerEndpointIsLoopbackOnly(t *testing.T) {
	s, _ := testServer(t)
	owner, err := s.ensureOwner("test")
	if err != nil {
		t.Fatal(err)
	}
	w := requestJSON(t, s.Handler(), "GET", "/api/auth/owner", "", nil) // httptest 默认 192.0.2.1:1234
	if w.Code != 403 {
		t.Fatalf("非回环应 403，实际 %d body=%s", w.Code, w.Body.String())
	}

	r := httptest.NewRequest("GET", "/api/auth/owner", nil)
	r.RemoteAddr = "127.0.0.1:5555"
	rr := httptest.NewRecorder()
	s.Handler().ServeHTTP(rr, r)
	if rr.Code != 200 {
		t.Fatalf("回环应 200，实际 %d body=%s", rr.Code, rr.Body.String())
	}
	var info struct {
		UserID string `json:"user_id"`
		Source string `json:"source"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &info)
	if info.UserID != owner || info.Source == "" {
		t.Fatalf("owner info = %+v", info)
	}
}

// 收拾存量分裂：把没有密码的账户并入 owner（需要 owner 自己的 access token）。
func TestMergeAccountIntoOwner(t *testing.T) {
	s, db := testServer(t)
	h := s.Handler()
	// owner（有密码）
	w, _ := httpDo(t, h, "POST", "/api/auth/users",
		map[string]any{"email": "boss@lan.test", "password": "boss-pass-1"}, nil, nil)
	if w.Code != 200 {
		t.Fatalf("signup status=%d body=%s", w.Code, w.Body.String())
	}
	var up struct {
		AccessToken string `json:"accessToken"`
		User        struct {
			ID string `json:"id"`
		} `json:"user"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &up)
	owner := up.User.ID

	// 另一个没有密码的账户（模拟旧 device-login 留下的），带一台设备和用量
	if err := s.ensureAccount(legacyDefaultSub); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO devices(id,user_id,device_name,platform,machine_id,created_at)
		VALUES(?,?,?,?,?,?)`, "dev-old", legacyDefaultSub, "nas", "linux", "m-merge", s.nowISO()); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO hourly(user_id,device_id,hour_start,source,model,total_tokens)
		VALUES(?,?,?,?,?,?)`, legacyDefaultSub, "dev-old", "2026-10-20T00:00:00Z", "codex", "gpt-6", 900); err != nil {
		t.Fatal(err)
	}

	// 非 owner 不能调
	if r := requestJSON(t, h, "POST", "/api/auth/merge-account",
		s.signJWT("someone-else", "authenticated", s.now.Unix()+3600),
		map[string]any{"from_user_id": legacyDefaultSub}); r.Code != 403 {
		t.Fatalf("非 owner 合并应 403，实际 %d", r.Code)
	}

	res := requestJSON(t, h, "POST", "/api/auth/merge-account", up.AccessToken,
		map[string]any{"from_user_id": legacyDefaultSub})
	if res.Code != 200 {
		t.Fatalf("merge status=%d body=%s", res.Code, res.Body.String())
	}
	var merged struct {
		Moved map[string]int `json:"moved"`
	}
	_ = json.Unmarshal(res.Body.Bytes(), &merged)
	if merged.Moved["hourly"] != 1 || merged.Moved["devices"] != 1 {
		t.Fatalf("moved=%v", merged.Moved)
	}
	// 数据现在归 owner，源账户已删
	var n int
	if err := db.QueryRow(`SELECT count(*) FROM hourly WHERE user_id=?`, owner).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("owner hourly=%d want 1", n)
	}
	if err := db.QueryRow(`SELECT count(*) FROM auth_users WHERE id=?`, legacyDefaultSub).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatal("源账户应已删除")
	}
	// 合并后 owner 的 account-summary 能看到这台设备的数据
	sum := requestJSON(t, h, "GET",
		"/functions/tokentracker-account-summary?from=2026-10-20&to=2026-10-20", up.AccessToken, nil)
	if !strings.Contains(sum.Body.String(), `"total_tokens":900`) {
		t.Fatalf("合并后 summary 不可见：%s", sum.Body.String())
	}
	// 有密码的账户不能被合并（防误删）
	if err := s.ensureAccount("pw-user"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO auth_credentials(user_id,email,password_hash,created_at) VALUES(?,?,?,?)`,
		"pw-user", "pw@lan.test", hashPassword("pw-pass-123"), s.nowISO()); err != nil {
		t.Fatal(err)
	}
	if r := requestJSON(t, h, "POST", "/api/auth/merge-account", up.AccessToken,
		map[string]any{"from_user_id": "pw-user"}); r.Code != 409 {
		t.Fatalf("合并有密码账户应 409，实际 %d body=%s", r.Code, r.Body.String())
	}
}
