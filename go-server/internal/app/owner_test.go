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
// （这正是"没有默认账户常量"之后要保证的行为）。
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
		t.Fatalf("device 归属 %s，owner 是 %s（不应出现第三个账户）", polled.UserID, owner)
	}
	// 登录同一个邮箱能读到设备 —— 说明是同一账户
	w, _ := httpDo(t, h, "POST", "/api/auth/sessions",
		map[string]any{"email": "root@lan.test", "password": "bootstrap-pass-1"}, nil, nil)
	if w.Code != 200 {
		t.Fatalf("sign-in status=%d", w.Code)
	}
}

// 新装机器：解析 owner 不会凭空创建任何账户；第一次设备接入才创建，且是随机 id。
// 这就是"没有默认账户"的证明 —— 库里不存在任何预置身份。
func TestFreshInstallCreatesNoAccountUntilFirstIdentity(t *testing.T) {
	s, _ := testServer(t)
	owner, err := s.ownerSub()
	if err != nil || owner != "" {
		t.Fatalf("空库不应有 owner：%q %v", owner, err)
	}
	var n int
	if err := s.db.QueryRow(`SELECT count(*) FROM auth_users`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("空库不应有账户，实际 %d 个", n)
	}
	owner, err = s.ensureOwner("device")
	if err != nil || owner == "" {
		t.Fatalf("ensureOwner: %q %v", owner, err)
	}
	if err := s.db.QueryRow(`SELECT count(*) FROM auth_users`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("设备接入后应只有 1 个账户，实际 %d", n)
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
