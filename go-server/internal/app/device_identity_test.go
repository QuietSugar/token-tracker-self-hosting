package app

import (
	"encoding/json"
	"testing"
)

// 回归：两台不同机器各自 device-login，必须落在**两个**设备行上。
//
// 背景（真实事故）：deviceFor 曾经用 `machine_id=? OR (platform=? AND device_name=?)`
// 判重，而 device flow 的设备行又统一叫 ("Device Flow","cli")，于是第二台机器
// 命中第一台的设备行——它上传的用量全部记到第一台机器名下
// （跨设备汇总里旧机器虚高、新机器偏少，总量无损）。
func TestDeviceFlowGivesEachMachineItsOwnDevice(t *testing.T) {
	s, db := testServer(t)
	h := s.Handler()
	owner, _ := s.ensureOwner("test")

	flow := func(machineID, clientInfo string) (deviceID, name, platform string) {
		w := requestJSON(t, h, "POST", "/functions/tokentracker-device-flow-authorize", "",
			map[string]any{"client_info": clientInfo, "machine_id": machineID})
		if w.Code != 200 {
			t.Fatalf("authorize status=%d body=%s", w.Code, w.Body.String())
		}
		var a struct {
			UserCode string `json:"user_code"`
		}
		_ = json.Unmarshal(w.Body.Bytes(), &a)
		if _, err := s.approveDeviceCode(owner, a.UserCode); err != nil {
			t.Fatalf("approve: %v", err)
		}
		if err := db.QueryRow(`SELECT d.id, d.device_name, COALESCE(d.platform,'') FROM devices d
			JOIN device_codes dc ON dc.device_id = d.id WHERE dc.user_code=?`, a.UserCode).
			Scan(&deviceID, &name, &platform); err != nil {
			t.Fatal(err)
		}
		return
	}

	d1, n1, p1 := flow("11111111-aaaa-4aaa-8aaa-111111111111", "linux-x64 vm128")
	d2, n2, p2 := flow("22222222-bbbb-4bbb-8bbb-222222222222", "linux-x64 hp")
	if d1 == d2 {
		t.Fatalf("两台不同机器共用了设备行 %s：%q 的用量会被记到另一台名下", d1, n2)
	}
	// 设备名取 client_info 里的 hostname，平台与官方一致（cli-device-flow）。
	if n1 != "vm128" || p1 != "cli-device-flow" {
		t.Fatalf("vm128 设备行 = %q/%q，期望 vm128/cli-device-flow", n1, p1)
	}
	if n2 != "hp" || p2 != "cli-device-flow" {
		t.Fatalf("hp 设备行 = %q/%q，期望 hp/cli-device-flow", n2, p2)
	}
	// 两台机器各自的 machine 行也要分开。
	var machines int
	if err := db.QueryRow(`SELECT count(*) FROM cloud_machines WHERE user_id=?`, owner).Scan(&machines); err != nil {
		t.Fatal(err)
	}
	if machines != 2 {
		t.Fatalf("cloud_machines 行数=%d，期望 2", machines)
	}
}

// 同一台机器重复 device-login 仍必须复用同一行（只是换 token）。
func TestDeviceFlowReusesRowForSameMachine(t *testing.T) {
	s, db := testServer(t)
	h := s.Handler()
	owner, _ := s.ensureOwner("test")

	login := func() string {
		w := requestJSON(t, h, "POST", "/functions/tokentracker-device-flow-authorize", "",
			map[string]any{"client_info": "linux-x64 hp", "machine_id": "33333333-cccc-4ccc-8ccc-333333333333"})
		var a struct {
			UserCode string `json:"user_code"`
		}
		_ = json.Unmarshal(w.Body.Bytes(), &a)
		if _, err := s.approveDeviceCode(owner, a.UserCode); err != nil {
			t.Fatal(err)
		}
		var id string
		if err := db.QueryRow(`SELECT device_id FROM device_codes WHERE user_code=?`, a.UserCode).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	first, second := login(), login()
	if first != second {
		t.Fatalf("同一机器两次登录得到两个设备行：%s / %s", first, second)
	}
	var n int
	if err := db.QueryRow(`SELECT count(*) FROM devices WHERE user_id=?`, owner).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("设备行数=%d，期望 1", n)
	}
}

// device-token-issue：同名同平台但**不同机器**时不能顶替别人的设备行。
// 这里会自动改名新建（"nas" → "nas #m-b"），因为报错会让用户"再也登录不上"。
func TestDeviceIssueDoesNotStealAnotherMachinesRow(t *testing.T) {
	s, db := testServer(t)
	h := s.Handler()
	owner, _ := s.ensureOwner("test")
	jwt := s.signJWT(owner, "authenticated", s.now.Unix()+3600)

	first := requestJSON(t, h, "POST", "/functions/tokentracker-device-token-issue", jwt, map[string]any{
		"device_name": "nas", "platform": "linux", "machine_id": "machine-aaaa",
	})
	if first.Code != 200 {
		t.Fatalf("首次接入 status=%d body=%s", first.Code, first.Body.String())
	}
	var issued struct {
		DeviceID string `json:"device_id"`
	}
	_ = json.Unmarshal(first.Body.Bytes(), &issued)
	if _, err := db.Exec(`INSERT INTO hourly(user_id,device_id,hour_start,source,model,total_tokens,
		billable_total_tokens,conversations) VALUES(?,?,?,?,?,?,?,?)`,
		owner, issued.DeviceID, "2026-10-20T10:00:00Z", "codex", "gpt-6", 100, 100, 1); err != nil {
		t.Fatal(err)
	}

	// 另一台机器，同平台同名字：必须拿到**另一个**设备行，且名字被区分开。
	second := requestJSON(t, h, "POST", "/functions/tokentracker-device-token-issue", jwt, map[string]any{
		"device_name": "nas", "platform": "linux", "machine_id": "machine-bbbb",
	})
	if second.Code != 200 {
		t.Fatalf("第二台机器接入 status=%d body=%s", second.Code, second.Body.String())
	}
	var issued2 struct {
		DeviceID string `json:"device_id"`
	}
	_ = json.Unmarshal(second.Body.Bytes(), &issued2)
	if issued2.DeviceID == issued.DeviceID {
		t.Fatalf("第二台机器拿到了第一台的设备行 %s", issued.DeviceID)
	}
	var name2, mid2 string
	if err := db.QueryRow(`SELECT device_name, COALESCE(machine_id,'') FROM devices WHERE id=?`,
		issued2.DeviceID).Scan(&name2, &mid2); err != nil {
		t.Fatal(err)
	}
	if name2 != "nas #machine" || mid2 != "machine-bbbb" {
		t.Fatalf("第二台设备行 = %q/%q，期望 nas #machine/machine-bbbb", name2, mid2)
	}
	// 第一台的设备与用量都没被动过。
	var tokens int64
	if err := db.QueryRow(`SELECT total_tokens FROM hourly WHERE user_id=? AND device_id=?`,
		owner, issued.DeviceID).Scan(&tokens); err != nil {
		t.Fatal(err)
	}
	if tokens != 100 {
		t.Fatalf("原有设备用量被改动：%d", tokens)
	}
}

// 老库兼容：machine_id 为空的历史设备行可以被这台机器认领，不额外建新行。
func TestDeviceIssueAdoptsLegacyRowWithoutMachineID(t *testing.T) {
	s, db := testServer(t)
	h := s.Handler()
	owner, _ := s.ensureOwner("test")
	jwt := s.signJWT(owner, "authenticated", s.now.Unix()+3600)

	const legacyID = "55555555-eeee-4eee-8eee-555555555555"
	if _, err := db.Exec(`INSERT INTO devices(id,user_id,device_name,platform,machine_id,created_at)
		VALUES(?,?,?,?,NULL,?)`, legacyID, owner, "nas", "linux", s.nowISO()); err != nil {
		t.Fatal(err)
	}
	w := requestJSON(t, h, "POST", "/functions/tokentracker-device-token-issue", jwt, map[string]any{
		"device_name": "nas", "platform": "linux", "machine_id": "m-legacy",
	})
	if w.Code != 200 {
		t.Fatalf("认领历史行 status=%d body=%s", w.Code, w.Body.String())
	}
	var resp struct {
		DeviceID string `json:"device_id"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.DeviceID != legacyID {
		t.Fatalf("应认领历史行 %s，实际 %s", legacyID, resp.DeviceID)
	}
	var mid string
	if err := db.QueryRow(`SELECT COALESCE(machine_id,'') FROM devices WHERE id=?`, legacyID).Scan(&mid); err != nil {
		t.Fatal(err)
	}
	if mid != "m-legacy" {
		t.Fatalf("machine_id 未回填：%q", mid)
	}
}

// deviceFlowIdentity 的取名规则（与官方 device-flow-poll 的 issueDeviceToken 对齐）。
func TestDeviceFlowIdentity(t *testing.T) {
	cases := []struct{ info, machine, wantName string }{
		{"linux-x64 hp", "m-1", "hp"},
		{"darwin-arm64 书房的Mac", "m-2", "书房的Mac"},
		{"linux-x64", "abcdef1234567890", "TokenTracker CLI (linux-x64) #abcdef12"},
		{"", "", "TokenTracker CLI"},
	}
	for _, c := range cases {
		name, platform := deviceFlowIdentity(c.info, c.machine)
		if name != c.wantName {
			t.Fatalf("client_info=%q machine=%q → name=%q，期望 %q", c.info, c.machine, name, c.wantName)
		}
		if platform != "cli-device-flow" {
			t.Fatalf("platform=%q，期望 cli-device-flow", platform)
		}
	}
	// 超长 hostname 按字符截断到 128，不切坏多字节字符。
	long := "linux-x64 " + repeatRune('名', 200)
	name, _ := deviceFlowIdentity(long, "m")
	if got := len([]rune(name)); got != 128 {
		t.Fatalf("长名字截断后 %d 字符，期望 128", got)
	}
}

func repeatRune(r rune, n int) string {
	out := make([]rune, n)
	for i := range out {
		out[i] = r
	}
	return string(out)
}
