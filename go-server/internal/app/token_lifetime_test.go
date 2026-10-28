package app

import (
	"encoding/json"
	"strings"
	"testing"
)

// device token 没有有效期：表里只有 token_hash 与 revoked_at，没有任何 expires_at；
// 唯一能让它失效的操作是「撤销」（暂停设备 / 删除设备）。
//
// 这条用例把它钉死成契约：**七年前签发的 token 今天仍然能上传**。
// 如果将来有人给 device token 加 TTL，必须显式改掉这里，而不是让线上客户端
// 在某个没人在意的时刻突然开始 401（那会表现为 sync 静默失败）。
func TestDeviceTokenHasNoExpiry(t *testing.T) {
	s, db := testServer(t)
	h := s.Handler()
	owner, err := s.ensureOwner("test")
	if err != nil {
		t.Fatal(err)
	}

	const (
		devID = "eeeeeeee-5555-4555-8555-555555555555"
		tokA  = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
		old   = "2019-01-01T00:00:00Z" // 离测试冻结时钟（2026-10-26）七年多
	)
	if _, err := db.Exec(`INSERT INTO devices(id,user_id,device_name,platform,machine_id,created_at)
		VALUES(?,?,?,?,?,?)`, devID, owner, "old-nas", "linux", "m-old-nas", old); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO device_tokens(id,user_id,device_id,token_hash,created_at)
		VALUES(?,?,?,?,?)`, newID(), owner, devID, tokenHash(tokA), old); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO cloud_machines(id,user_id,name,machine_id,platform,status,created_at)
		VALUES(?,?,?,?,?,'active',?)`, newID(), owner, "old-nas", "m-old-nas", "linux", old); err != nil {
		t.Fatal(err)
	}

	w := requestJSON(t, h, "POST", "/functions/tokentracker-ingest", tokA, map[string]any{
		"buckets": []any{map[string]any{
			"hour_start": "2026-10-25T10:00:00Z", "source": "codex", "model": "gpt-6",
			"input_tokens": 42, "total_tokens": 42, "billable_total_tokens": 42,
		}},
	})
	if w.Code != 200 {
		t.Fatalf("七年前签发的 device token 仍应可上传，实际 %d body=%s", w.Code, w.Body.String())
	}
	var res struct {
		Inserted int `json:"inserted"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &res)
	if res.Inserted != 1 {
		t.Fatalf("inserted=%d，期望 1（%s）", res.Inserted, w.Body.String())
	}

	// 每次上传都会刷新「最后活跃」，这就是设备清单上看到的"续期"效果：
	// 只要客户端持续 sync，机器就一直是活的，不需要任何重新登录动作。
	var lastSeen string
	if err := db.QueryRow(`SELECT COALESCE(last_seen_at,'') FROM cloud_machines
		WHERE user_id=? AND machine_id='m-old-nas'`, owner).Scan(&lastSeen); err != nil {
		t.Fatal(err)
	}
	if lastSeen != s.nowISO() {
		t.Fatalf("last_seen_at=%q，期望被本次 ingest 刷新为 %q", lastSeen, s.nowISO())
	}

	// 撤销后立刻失效——这是 device token 唯一的失效途径，用测试固定住。
	if _, err := db.Exec(`UPDATE device_tokens SET revoked_at=? WHERE token_hash=?`, s.nowISO(), tokenHash(tokA)); err != nil {
		t.Fatal(err)
	}
	w = requestJSON(t, h, "POST", "/functions/tokentracker-ingest", tokA, map[string]any{
		"buckets": []any{map[string]any{
			"hour_start": "2026-10-25T11:00:00Z", "source": "codex", "model": "gpt-6",
			"input_tokens": 1, "total_tokens": 1, "billable_total_tokens": 1,
		}},
	})
	if w.Code != 401 {
		t.Fatalf("撤销后的 token 应 401，实际 %d", w.Code)
	}
}

// 结构防回归：device_tokens 里不该出现任何过期列。
// 一旦有人加 expires_at / ttl，这条会和上面的行为用例一起失败。
func TestDeviceTokensTableHasNoExpiryColumn(t *testing.T) {
	_, db := testServer(t)
	rows, err := db.Query(`SELECT column_name FROM information_schema.columns
		WHERE table_name='device_tokens' AND table_schema = ANY(current_schemas(false))`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var col string
		if err := rows.Scan(&col); err != nil {
			t.Fatal(err)
		}
		if strings.Contains(col, "expire") || strings.Contains(col, "ttl") {
			t.Fatalf("device_tokens 出现了过期列 %q：device token 应当永不过期（只有撤销能失效）", col)
		}
	}
}

// 接入流程里唯一的短有效期是 device code（user_code 的批准窗口 15 分钟），不是 device token。
// 这条用例防止把它误读成"token 会过期"，也防止有人在 authorize 响应里塞 token 有效期字段。
func TestDeviceCodeExpiryIsOnlyTheUserCode(t *testing.T) {
	s, _ := testServer(t)
	w := requestJSON(t, s.Handler(), "POST", "/functions/tokentracker-device-flow-authorize", "",
		map[string]any{"client_info": "expiry-check/1.0 (test)", "machine_id": "m-exp"})
	if w.Code != 200 {
		t.Fatalf("authorize status=%d body=%s", w.Code, w.Body.String())
	}
	var res struct {
		DeviceCode string `json:"device_code"`
		ExpiresIn  int    `json:"expires_in"`
		UserCode   string `json:"user_code"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &res)
	if res.ExpiresIn != 900 {
		t.Fatalf("expires_in=%d，期望 900（仅约束 user_code 的批准窗口）", res.ExpiresIn)
	}
	if strings.TrimSpace(res.DeviceCode) == "" || strings.TrimSpace(res.UserCode) == "" {
		t.Fatalf("响应缺少 device_code / user_code：%s", w.Body.String())
	}
	if strings.Contains(w.Body.String(), "token_expires") || strings.Contains(w.Body.String(), "refresh_expires") {
		t.Fatalf("authorize 响应不应包含 token 有效期字段：%s", w.Body.String())
	}
}
