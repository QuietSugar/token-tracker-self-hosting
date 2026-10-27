package app

// ingest 的「队列语义」用例：官方客户端上传的是**队列批次**，不是干净的用量数组。
// 批次里可能只有控制记录（account_session_states），也可能掺着无法识别的行。
// 这些都不算错误——回 4xx 会让客户端的 upload offset 卡住，sync 永久失败。

import (
	"encoding/json"
	"testing"
)

// deviceTokenFor 用 owner 的 JWT 签一个 device token（走真实的 device-token-issue 端点，
// 这样设备行/机器行都按生产路径建好）。
func deviceTokenFor(t *testing.T, s *Server, uid, name, machineID string) string {
	t.Helper()
	w := requestJSON(t, s.Handler(), "POST", "/functions/tokentracker-device-token-issue",
		s.signJWT(uid, "authenticated", s.now.Unix()+3600),
		map[string]any{"device_name": name, "platform": "linux", "machine_id": machineID})
	if w.Code != 200 {
		t.Fatalf("device-token-issue status=%d body=%s", w.Code, w.Body.String())
	}
	var issue map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &issue); err != nil {
		t.Fatal(err)
	}
	tok, _ := issue["token"].(string)
	if tok == "" {
		t.Fatalf("device-token-issue 没给 token：%s", w.Body.String())
	}
	return tok
}

// 队列尾部只剩 account_session_states（TRAE / cursor 的会话去重记录）时，
// 客户端会发 hourly: [] + account_session_states: [...]。必须 200。
func TestIngestAcceptsSessionStateOnlyBatch(t *testing.T) {
	s, db := testServer(t)
	h := s.Handler()
	uid := "44444444-4444-4444-8444-444444444444"
	if _, err := db.Exec(`INSERT INTO auth_users(id,email) VALUES(?,?)`, uid, "queue@local.test"); err != nil {
		t.Fatal(err)
	}
	tok := deviceTokenFor(t, s, uid, "queue-tail", "m-queue-tail")

	w := requestJSON(t, h, "POST", "/functions/tokentracker-ingest", tok, map[string]any{
		"upload_id": "up-1",
		"hourly":    []any{},
		"account_session_states": []any{map[string]any{
			"source": "trae-cn", "session_id": "s-1", "model": "m",
			"bucket_start": "2026-10-20T02:00:00Z", "total_tokens": 10,
			"snapshot_verified_at": "2026-10-20T03:00:00Z",
		}},
	})
	if w.Code != 200 {
		t.Fatalf("states-only batch status=%d body=%s（客户端会因此卡住 offset）", w.Code, w.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["ok"] != true || body["inserted"] != float64(0) {
		t.Fatalf("body=%v", body)
	}
	// 真的什么都没写进去。
	var n int
	if err := db.QueryRow(`SELECT count(*) FROM hourly WHERE user_id=?`, uid).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("session state 记录不该落进 hourly：%d 行", n)
	}
}

// 空 body / 只有控制记录以外什么都没有，仍然是 400（这是客户端的 bug，不是队列语义）。
func TestIngestStillRejectsTrulyEmptyBatch(t *testing.T) {
	s, db := testServer(t)
	uid := "55555555-5555-4555-8555-555555555555"
	if _, err := db.Exec(`INSERT INTO auth_users(id,email) VALUES(?,?)`, uid, "empty@local.test"); err != nil {
		t.Fatal(err)
	}
	tok := deviceTokenFor(t, s, uid, "empty-batch", "m-empty")

	for _, body := range []map[string]any{{}, {"hourly": []any{}}, {"buckets": []any{}, "hourly": []any{}}} {
		w := requestJSON(t, s.Handler(), "POST", "/functions/tokentracker-ingest", tok, body)
		if w.Code != 400 {
			t.Fatalf("body=%v status=%d, want 400", body, w.Code)
		}
	}
}

// 一批里同时有可用行和不可用行：可用的要落库，其余计数进 skipped，整体 200。
func TestIngestCountsUnusableRowsAsSkipped(t *testing.T) {
	s, db := testServer(t)
	uid := "66666666-6666-4666-8666-666666666666"
	if _, err := db.Exec(`INSERT INTO auth_users(id,email) VALUES(?,?)`, uid, "mixed@local.test"); err != nil {
		t.Fatal(err)
	}
	tok := deviceTokenFor(t, s, uid, "mixed-batch", "m-mixed")

	w := requestJSON(t, s.Handler(), "POST", "/functions/tokentracker-ingest", tok, map[string]any{
		"hourly": []any{
			map[string]any{"hour_start": "2026-10-20T02:00:00Z", "source": "claude", "model": "sonnet-4",
				"total_tokens": 100, "billable_total_tokens": 100, "input_tokens": 100},
			// 缺 source/model 的控制记录形状（客户端不该发，但发来了也不能整批失败）
			map[string]any{"hour_start": "2026-10-20T03:00:00Z"},
		},
	})
	if w.Code != 200 {
		t.Fatalf("mixed batch status=%d body=%s", w.Code, w.Body.String())
	}
	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body["inserted"] != float64(1) || body["skipped"] != float64(1) {
		t.Fatalf("body=%v, want inserted=1 skipped=1", body)
	}
}
