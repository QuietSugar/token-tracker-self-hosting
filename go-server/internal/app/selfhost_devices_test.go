package app

import (
	"encoding/json"
	"net/http"
	"testing"
)

type selfHostDevice struct {
	ID           string  `json:"id"`
	DeviceName   string  `json:"device_name"`
	Platform     *string `json:"platform"`
	MachineID    *string `json:"machine_id"`
	Status       *string `json:"status"`
	CreatedAt    string  `json:"created_at"`
	LastSeenAt   *string `json:"last_seen_at"`
	ActiveTokens int     `json:"active_tokens"`
}

func getSelfHostDevices(t *testing.T, h http.Handler, jwt string) (int, []selfHostDevice) {
	t.Helper()
	w := requestJSON(t, h, "GET", "/api/selfhost/devices", jwt, nil)
	if w.Code != 200 {
		return w.Code, nil
	}
	var res struct {
		Devices []selfHostDevice `json:"devices"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil {
		t.Fatalf("解析 /api/selfhost/devices 失败：%v body=%s", err, w.Body.String())
	}
	return w.Code, res.Devices
}

// 看板要显示的「最后同步」来自 cloud_machines.last_seen_at；没有机器行的设备
// 必须返回 null 而不是空串（页面用 null 判断"从未同步"）。
func TestSelfHostDevicesReportsLastSeen(t *testing.T) {
	s, db := testServer(t)
	h := s.Handler()
	owner, err := s.ensureOwner("test")
	if err != nil {
		t.Fatal(err)
	}
	jwt := s.signJWT(owner, "authenticated", s.now.Unix()+3600)

	const (
		devA = "11111111-aaaa-4aaa-8aaa-111111111111"
		devB = "22222222-bbbb-4bbb-8bbb-222222222222"
	)
	if _, err := db.Exec(`INSERT INTO devices(id,user_id,device_name,platform,machine_id,created_at)
		VALUES(?,?,?,?,?,?)`, devA, owner, "macbook", "darwin", "m-a", "2026-09-01T00:00:00Z"); err != nil {
		t.Fatal(err)
	}
	// devB 没有机器行：模拟「签发过 token 但从未上传过」的设备。
	if _, err := db.Exec(`INSERT INTO devices(id,user_id,device_name,platform,machine_id,created_at)
		VALUES(?,?,?,?,?,?)`, devB, owner, "nas", "linux", "m-b", "2026-09-02T00:00:00Z"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO cloud_machines(id,user_id,name,machine_id,platform,status,last_seen_at,created_at)
		VALUES(?,?,?,?,?,'active',?,?)`, newID(), owner, "macbook", "m-a", "darwin",
		"2026-10-26T00:00:00Z", "2026-09-01T00:00:00Z"); err != nil {
		t.Fatal(err)
	}
	for i, tok := range []string{"tok-a1", "tok-a2"} {
		created := "2026-09-01T00:00:00Z"
		if _, err := db.Exec(`INSERT INTO device_tokens(id,user_id,device_id,token_hash,created_at)
			VALUES(?,?,?,?,?)`, "tokid-"+string(rune('a'+i)), owner, devA, tokenHash(tok), created); err != nil {
			t.Fatal(err)
		}
	}

	code, devices := getSelfHostDevices(t, h, jwt)
	if code != 200 {
		t.Fatalf("status=%d", code)
	}
	if len(devices) != 2 {
		t.Fatalf("设备数=%d，期望 2（%+v）", len(devices), devices)
	}
	// 按 created_at 升序：devA 在前。
	a, b := devices[0], devices[1]
	if a.ID != devA || a.DeviceName != "macbook" || a.ActiveTokens != 2 {
		t.Fatalf("devA 字段不对：%+v", a)
	}
	if a.LastSeenAt == nil || *a.LastSeenAt != "2026-10-26T00:00:00Z" {
		t.Fatalf("devA.last_seen_at=%v，期望 2026-10-26T00:00:00Z", a.LastSeenAt)
	}
	if a.Status == nil || *a.Status != "active" {
		t.Fatalf("devA.status=%v", a.Status)
	}
	if a.Platform == nil || *a.Platform != "darwin" {
		t.Fatalf("devA.platform=%v", a.Platform)
	}
	if b.ID != devB || b.LastSeenAt != nil || b.Status != nil || b.ActiveTokens != 0 {
		t.Fatalf("devB 应为「从未同步」形态（last_seen/status 为 null）：%+v", b)
	}
}

// 撤销（暂停）过的设备不出现在清单里——与 account-devices 的语义一致。
func TestSelfHostDevicesHidesRevoked(t *testing.T) {
	s, db := testServer(t)
	h := s.Handler()
	owner, _ := s.ensureOwner("test")
	jwt := s.signJWT(owner, "authenticated", s.now.Unix()+3600)
	if _, err := db.Exec(`INSERT INTO devices(id,user_id,device_name,platform,machine_id,created_at,revoked_at)
		VALUES(?,?,?,?,?,?,?)`, "33333333-cccc-4ccc-8ccc-333333333333", owner, "gone", "linux", "m-gone",
		"2026-09-01T00:00:00Z", s.nowISO()); err != nil {
		t.Fatal(err)
	}
	code, devices := getSelfHostDevices(t, h, jwt)
	if code != 200 || len(devices) != 0 {
		t.Fatalf("已撤销设备不该出现：status=%d devices=%+v", code, devices)
	}
}

// 老库里同一 machine_id 可能有多行机器记录（见 machineFor 的注释）。端点必须
// 取最新那一行，而不是把一台设备放大成多行——否则页面会重复渲染同一台设备。
func TestSelfHostDevicesDedupesMachineRows(t *testing.T) {
	s, db := testServer(t)
	h := s.Handler()
	owner, _ := s.ensureOwner("test")
	jwt := s.signJWT(owner, "authenticated", s.now.Unix()+3600)
	if _, err := db.Exec(`INSERT INTO devices(id,user_id,device_name,platform,machine_id,created_at)
		VALUES(?,?,?,?,?,?)`, "44444444-dddd-4ddd-8ddd-444444444444", owner, "dup", "linux", "m-dup",
		"2026-09-01T00:00:00Z"); err != nil {
		t.Fatal(err)
	}
	for _, m := range []struct{ status, seen, created string }{
		{"paused", "2026-10-01T00:00:00Z", "2026-09-01T00:00:00Z"},
		{"active", "2026-10-25T00:00:00Z", "2026-10-20T00:00:00Z"}, // 更新的那一行
	} {
		if _, err := db.Exec(`INSERT INTO cloud_machines(id,user_id,name,machine_id,platform,status,last_seen_at,created_at)
			VALUES(?,?,?,?,?,?,?,?)`, newID(), owner, "dup", "m-dup", "linux", m.status, m.seen, m.created); err != nil {
			t.Fatal(err)
		}
	}
	code, devices := getSelfHostDevices(t, h, jwt)
	if code != 200 || len(devices) != 1 {
		t.Fatalf("重复机器行不该放大设备数：status=%d devices=%+v", code, devices)
	}
	if devices[0].Status == nil || *devices[0].Status != "active" {
		t.Fatalf("应取最新的机器行（active），实际 %v", devices[0].Status)
	}
	if devices[0].LastSeenAt == nil || *devices[0].LastSeenAt != "2026-10-25T00:00:00Z" {
		t.Fatalf("last_seen 应取最新行，实际 %v", devices[0].LastSeenAt)
	}
}

// 没有 JWT 一律 401：这是账户视图端点，不能匿名读到设备清单。
func TestSelfHostDevicesRequiresAuth(t *testing.T) {
	s, _ := testServer(t)
	for _, tok := range []string{"", "not-a-jwt"} {
		w := requestJSON(t, s.Handler(), "GET", "/api/selfhost/devices", tok, nil)
		if w.Code != 401 {
			t.Fatalf("token=%q status=%d，期望 401（body=%s）", tok, w.Code, w.Body.String())
		}
	}
	// 别的方法不给写的机会；未知子路径保持 404 JSON（脚本依赖这个形状）。
	w := requestJSON(t, s.Handler(), "POST", "/api/selfhost/devices", "", map[string]any{})
	if w.Code != 401 {
		t.Fatalf("POST 无凭据 status=%d，期望 401", w.Code)
	}
	s2, db := testServer(t)
	owner, _ := s2.ensureOwner("test")
	jwt := s2.signJWT(owner, "authenticated", s2.now.Unix()+3600)
	w = requestJSON(t, s2.Handler(), "POST", "/api/selfhost/devices", jwt, map[string]any{})
	if w.Code != 405 {
		t.Fatalf("POST 带凭据 status=%d，期望 405（只读端点）", w.Code)
	}
	w = requestJSON(t, s2.Handler(), "GET", "/api/selfhost/nope", jwt, nil)
	if w.Code != 404 {
		t.Fatalf("未知子路径 status=%d，期望 404", w.Code)
	}
	_ = db
}

// machineFor 的判重不能带 status：被暂停的机器在客户端重新接入时必须复用原行，
// 否则同一个 machine_id 会出现两行，官方 dashboard 里就成了两台同名设备。
func TestMachineForReusesPausedRow(t *testing.T) {
	s, db := testServer(t)
	h := s.Handler()
	owner, _ := s.ensureOwner("test")
	jwt := s.signJWT(owner, "authenticated", s.now.Unix()+3600)

	// 先接入一台机器，然后把它按「暂停」的状态标下去。
	w := requestJSON(t, h, "POST", "/functions/tokentracker-device-token-issue", jwt, map[string]any{
		"device_name": "nas", "platform": "linux", "machine_id": "m-paused",
	})
	if w.Code != 200 {
		t.Fatalf("首次接入 status=%d body=%s", w.Code, w.Body.String())
	}
	if _, err := db.Exec(`UPDATE cloud_machines SET status='paused' WHERE user_id=? AND machine_id='m-paused'`, owner); err != nil {
		t.Fatal(err)
	}

	// 客户端重新 device-login（= device-token-issue）：必须复用，不得新增机器行。
	w = requestJSON(t, h, "POST", "/functions/tokentracker-device-token-issue", jwt, map[string]any{
		"device_name": "nas", "platform": "linux", "machine_id": "m-paused",
	})
	if w.Code != 200 {
		t.Fatalf("重新接入 status=%d body=%s", w.Code, w.Body.String())
	}
	var n int
	if err := db.QueryRow(`SELECT count(*) FROM cloud_machines WHERE user_id=? AND machine_id='m-paused'`, owner).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("machine_id=m-paused 有 %d 行机器记录，期望 1（判重不能只看 active）", n)
	}
	var status string
	if err := db.QueryRow(`SELECT status FROM cloud_machines WHERE user_id=? AND machine_id='m-paused'`, owner).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "paused" {
		t.Fatalf("status=%q，重新接入不应自行改变状态（本项目不使用暂停，但也不该顺手改写）", status)
	}
}
