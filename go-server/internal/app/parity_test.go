package app

// parity_test.go —— 与官方 dashboard 模块对拍的回归测试（时区 / heatmap compact / 机器列表）。
//
// 这些用例锁的是"官方客户端真实请求会得到什么"，来源是上游这几个 edge 函数：
//   - dashboard/edge-patches/tokentracker-account-heatmap.ts（zonedDayKey / format=compact）
//   - dashboard/edge-patches/tokentracker-account-summary.ts（rolling 锚在本地今天）
//   - dashboard/edge-patches/tokentracker-billing.ts + cloud_list_machines RPC
//   - dashboard/src/components/cloud/CloudMembershipCard.jsx（devices / resume-device）

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// seedZonedDay 造一台设备 + 两行用量：一行落在 UTC 前一天（本地日 = 目标日），
// 一行落在目标日本地白天。用来验证"按本地日归日"。
func seedZonedDay(t *testing.T) (*Server, http.Handler, string, string) {
	t.Helper()
	s, db := testServer(t)
	owner, err := s.ensureOwner("test")
	if err != nil {
		t.Fatal(err)
	}
	dev := "eeeeeeee-5555-4555-8555-555555555555"
	if _, err := db.Exec(`INSERT INTO devices(id,user_id,device_name,platform,machine_id,created_at)
		VALUES(?,?,?,?,?,?)`, dev, owner, "tokyo-laptop", "darwin", "m-tokyo", s.nowISO()); err != nil {
		t.Fatal(err)
	}
	add := func(hour string, tokens int64) {
		if _, err := db.Exec(`INSERT INTO hourly(user_id,device_id,hour_start,source,model,
			total_tokens,billable_total_tokens,conversations) VALUES(?,?,?,?,?,?,?,?)`,
			owner, dev, hour, "claude", "sonnet-4.5", tokens, tokens, 1); err != nil {
			t.Fatal(err)
		}
	}
	// 2026-10-19T16:30Z = 东京 2026-10-20 01:30；2026-10-20T03:00Z = 东京 12:00
	add("2026-10-19T16:30:00Z", 120)
	add("2026-10-20T03:00:00Z", 80)
	jwt := s.signJWT(owner, "authenticated", s.now.Unix()+3600)
	return s, s.Handler(), jwt, owner
}

// 东京时区的用户看 2026-10-20：UTC 前一天下午那 8 小时属于本地 10-20，必须算进来。
// （这就是官方 ±1 天放宽窗口 + 按本地日裁剪的语义；老实现会漏掉那 120 token。）
func TestAccountReadsAreTimezoneAware(t *testing.T) {
	_, h, jwt, _ := seedZonedDay(t)
	const tzQ = "&tz=Asia/Tokyo"

	var sum struct {
		Days   int `json:"days"`
		Totals struct {
			TotalTokens int64 `json:"total_tokens"`
		} `json:"totals"`
	}
	getJSON(t, h, "/functions/tokentracker-account-summary?from=2026-10-20&to=2026-10-20"+tzQ, jwt, &sum)
	if sum.Totals.TotalTokens != 200 {
		t.Fatalf("东京 10-20 应包含 UTC 前一天 16:30 的 120：实际 %d", sum.Totals.TotalTokens)
	}
	// 官方 days = COUNT(DISTINCT 本地日桶)：这两行在东京是同一天，不能算成 2
	if sum.Days != 1 {
		t.Fatalf("days 应为 1 个本地活跃日：实际 %d", sum.Days)
	}

	var daily struct {
		Data []struct {
			Day   string `json:"day"`
			Total int64  `json:"total_tokens"`
		} `json:"data"`
	}
	getJSON(t, h, "/functions/tokentracker-account-daily?from=2026-10-20&to=2026-10-20"+tzQ, jwt, &daily)
	if len(daily.Data) != 1 || daily.Data[0].Day != "2026-10-20" || daily.Data[0].Total != 200 {
		t.Fatalf("daily 按本地日聚合异常：%+v", daily.Data)
	}

	// UTC 视角下这两行分属两天
	getJSON(t, h, "/functions/tokentracker-account-daily?from=2026-10-19&to=2026-10-20&tz=UTC", jwt, &daily)
	if len(daily.Data) != 2 {
		t.Fatalf("UTC 视角应是两天：%+v", daily.Data)
	}

	// 固定偏移等价于 IANA 名字（客户端只发 tz_offset_minutes 的情况）
	var viaOffset struct {
		Totals struct {
			TotalTokens int64 `json:"total_tokens"`
		} `json:"totals"`
	}
	getJSON(t, h, "/functions/tokentracker-account-summary?from=2026-10-20&to=2026-10-20&tz_offset_minutes=540", jwt, &viaOffset)
	if viaOffset.Totals.TotalTokens != 200 {
		t.Fatalf("tz_offset_minutes=540 应与 Asia/Tokyo 一致：实际 %d", viaOffset.Totals.TotalTokens)
	}

	// 设备列表的每台总量也要用同一时间窗（各设备之和 == summary 总量）
	var devs struct {
		Devices []struct {
			Total int64 `json:"total_tokens"`
		} `json:"devices"`
	}
	getJSON(t, h, "/functions/tokentracker-account-devices?from=2026-10-20&to=2026-10-20"+tzQ, jwt, &devs)
	if len(devs.Devices) != 1 || devs.Devices[0].Total != 200 {
		t.Fatalf("devices 总量与 summary 不一致：%+v", devs.Devices)
	}
}

// heatmap：本地日归日 + `to` 缺省用本地今天 + format=compact 稀疏线格式。
func TestAccountHeatmapTimezoneAndCompact(t *testing.T) {
	_, h, jwt, _ := seedZonedDay(t)

	// to 缺省 = 调用方时区的"今天"；冻结时钟是 2026-10-26T00:00Z → 东京 10-26 09:00
	var heat struct {
		From       string `json:"from"`
		To         string `json:"to"`
		ActiveDays int    `json:"active_days"`
		Weeks      [][]struct {
			Day   string         `json:"day"`
			Total int64          `json:"total_tokens"`
			Level int            `json:"level"`
			Model map[string]int `json:"models"`
		} `json:"weeks"`
	}
	w := getJSON(t, h, "/functions/tokentracker-account-heatmap?weeks=2&to=2026-10-20&tz=Asia/Tokyo", jwt, &heat)
	if w.Code != 200 {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	if heat.To != "2026-10-20" || heat.ActiveDays != 1 {
		t.Fatalf("heatmap 头部字段异常：to=%s active=%d", heat.To, heat.ActiveDays)
	}
	var found bool
	for _, week := range heat.Weeks {
		for _, cell := range week {
			if cell.Day == "2026-10-20" {
				found = true
				if cell.Total != 200 {
					t.Fatalf("东京 10-20 应聚合两行 200：实际 %d", cell.Total)
				}
				if cell.Level != 4 {
					t.Fatalf("唯一有量的一天应为 level 4：%d", cell.Level)
				}
				if cell.Model["sonnet-4.5"] != 200 {
					t.Fatalf("models 分解异常：%+v", cell.Model)
				}
			}
		}
	}
	if !found {
		t.Fatal("没有 2026-10-20 这一格")
	}

	// to 缺省 = 调用方时区的"今天"（冻结时钟 2026-10-26T00:00Z → 东京 09:00 同日）
	getJSON(t, h, "/functions/tokentracker-account-heatmap?weeks=1&tz=Asia/Tokyo", jwt, &heat)
	if heat.To != "2026-10-26" {
		t.Fatalf("缺省 to 应为本地今天 2026-10-26：实际 %s", heat.To)
	}

	// compact：dashboard 默认就带 format=compact
	var compact struct {
		Format     string          `json:"format"`
		From       string          `json:"from"`
		To         string          `json:"to"`
		ActiveDays int             `json:"active_days"`
		MaxValue   int64           `json:"max_value"`
		ModelNames []string        `json:"model_names"`
		Days       [][]any         `json:"days"`
		Weeks      json.RawMessage `json:"weeks"`
	}
	w = getJSON(t, h,
		"/functions/tokentracker-account-heatmap?weeks=2&to=2026-10-20&tz=Asia/Tokyo&format=compact", jwt, &compact)
	if w.Code != 200 {
		t.Fatalf("compact status=%d body=%s", w.Code, w.Body.String())
	}
	if compact.Format != "compact" || compact.Weeks != nil {
		t.Fatalf("compact 不该带 weeks：%s", w.Body.String())
	}
	if compact.MaxValue != 200 || compact.ActiveDays != 1 {
		t.Fatalf("compact 头部异常：max=%d active=%d", compact.MaxValue, compact.ActiveDays)
	}
	if len(compact.Days) != 1 {
		t.Fatalf("compact 应只有 1 天有数据：%+v", compact.Days)
	}
	day, _ := compact.Days[0][0].(string)
	if day != "2026-10-20" {
		t.Fatalf("compact 日期 = %s", day)
	}
	if total, _ := compact.Days[0][1].(float64); int64(total) != 200 {
		t.Fatalf("compact 当日总量 = %v", compact.Days[0][1])
	}
	pairs, _ := compact.Days[0][2].([]any)
	if len(pairs) != 2 {
		t.Fatalf("compact 模型对 = %+v", compact.Days[0][2])
	}
	idx, _ := pairs[0].(float64)
	if int(idx) >= len(compact.ModelNames) || compact.ModelNames[int(idx)] != "sonnet-4.5" {
		t.Fatalf("compact 模型索引越界：%v names=%v", pairs[0], compact.ModelNames)
	}
	if tok, _ := pairs[1].(float64); int64(tok) != 200 {
		t.Fatalf("compact 模型 token = %v", pairs[1])
	}
}

// billing 的设备卡片：GET ?action=devices 必须给 machines/machine_count/membership，
// 且 is_current 认得调用方传进来的 current_machine_id；resume-device 能把暂停的机器恢复。
func TestBillingDevicesActionAndResume(t *testing.T) {
	s, db := testServer(t)
	owner, err := s.ensureOwner("test")
	if err != nil {
		t.Fatal(err)
	}
	h := s.Handler()
	jwt := s.signJWT(owner, "authenticated", s.now.Unix()+3600)
	if _, err := db.Exec(`INSERT INTO devices(id,user_id,device_name,platform,machine_id,created_at)
		VALUES(?,?,?,?,?,?)`, "ffffffff-6666-4666-8666-666666666666", owner, "书房 MacBook", "darwin", "m-a", s.nowISO()); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO cloud_machines(id,user_id,name,machine_id,platform,status,created_at)
		VALUES(?,?,?,?,?,'active',?)`, "11111111-2222-4333-8444-555555555555", owner, "旧名字", "m-a", "darwin", s.nowISO()); err != nil {
		t.Fatal(err)
	}

	type machine struct {
		MachineID  string  `json:"machine_id"`
		Name       string  `json:"name"`
		Platform   *string `json:"platform"`
		Status     string  `json:"status"`
		IsCurrent  bool    `json:"is_current"`
		LastSeenAt *string `json:"last_seen_at"`
	}
	var res struct {
		Machines   []machine `json:"machines"`
		MachineCnt int       `json:"machine_count"`
		MachineMax *int      `json:"machine_limit"`
		Membership struct {
			Status string `json:"status"`
		} `json:"membership"`
		OverLimit *bool `json:"over_machine_limit"`
	}
	w := getJSON(t, h, "/functions/tokentracker-billing?action=devices&current_machine_id=m-a", jwt, &res)
	if w.Code != 200 {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	if len(res.Machines) != 1 || res.MachineCnt != 1 {
		t.Fatalf("设备列表异常：%s", w.Body.String())
	}
	m := res.Machines[0]
	if m.Name != "书房 MacBook" {
		t.Fatalf("名字应取设备行（重命名后要能看见）：%q", m.Name)
	}
	if !m.IsCurrent {
		t.Fatal("is_current 应认 current_machine_id=m-a")
	}
	if m.Status != "active" || m.Platform == nil || *m.Platform != "darwin" {
		t.Fatalf("字段异常：%+v", m)
	}
	if res.Membership.Status != "self_hosted" || res.MachineMax != nil || res.OverLimit != nil {
		t.Fatalf("自托管应无配额：limit=%v over=%v", res.MachineMax, res.OverLimit)
	}

	// ingest 之后设备卡片要显示最后活跃时间
	if _, err := db.Exec(`INSERT INTO device_tokens(id,user_id,device_id,token_hash,created_at)
		VALUES(?,?,?,?,?)`, "tok-1", owner, "ffffffff-6666-4666-8666-666666666666", tokenHash("devtok"), s.nowISO()); err != nil {
		t.Fatal(err)
	}
	if u := requestJSON(t, h, "POST", "/functions/tokentracker-ingest", "devtok", map[string]any{
		"hourly": []any{map[string]any{"hour_start": "2026-10-20T10:00:00Z", "source": "claude",
			"model": "sonnet-4.5", "total_tokens": 5, "billable_total_tokens": 5}},
	}); u.Code != 200 {
		t.Fatalf("ingest status=%d body=%s", u.Code, u.Body.String())
	}
	getJSON(t, h, "/functions/tokentracker-billing?action=devices", jwt, &res)
	if res.Machines[0].LastSeenAt == nil {
		t.Fatal("ingest 之后 last_seen_at 应有值")
	}

	// remove-device → 暂停并撤销设备；resume-device → 恢复
	w = requestJSON(t, h, "POST", "/functions/tokentracker-billing?action=remove-device", jwt,
		map[string]any{"machine_id": "m-a"})
	if w.Code != 200 {
		t.Fatalf("remove-device status=%d body=%s", w.Code, w.Body.String())
	}
	var after struct {
		OK       bool      `json:"ok"`
		Machines []machine `json:"machines"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &after)
	if !after.OK || len(after.Machines) != 1 || after.Machines[0].Status != "paused" {
		t.Fatalf("暂停失败：%s", w.Body.String())
	}
	if after.Machines[0].IsCurrent {
		t.Fatal("状态变更后的列表不应标 is_current")
	}
	var revoked int
	if err := s.db.QueryRow(`SELECT count(*) FROM device_tokens WHERE revoked_at IS NOT NULL`).Scan(&revoked); err != nil {
		t.Fatal(err)
	}
	if revoked != 1 {
		t.Fatalf("暂停后设备 token 应被撤销：%d", revoked)
	}

	w = requestJSON(t, h, "POST", "/functions/tokentracker-billing?action=resume-device", jwt,
		map[string]any{"machine_id": "m-a"})
	if w.Code != 200 {
		t.Fatalf("resume-device status=%d body=%s", w.Code, w.Body.String())
	}
	_ = json.Unmarshal(w.Body.Bytes(), &after)
	if len(after.Machines) != 1 || after.Machines[0].Status != "active" {
		t.Fatalf("恢复失败：%s", w.Body.String())
	}

	// 不存在的机器 → 404；缺 machine_id → 400
	if r := requestJSON(t, h, "POST", "/functions/tokentracker-billing?action=remove-device", jwt,
		map[string]any{"machine_id": "nope"}); r.Code != 404 {
		t.Fatalf("未知机器应 404，实际 %d", r.Code)
	}
	if r := requestJSON(t, h, "POST", "/functions/tokentracker-billing?action=remove-device", jwt,
		map[string]any{}); r.Code != 400 {
		t.Fatalf("缺 machine_id 应 400，实际 %d", r.Code)
	}
}

// cloud_list_machines RPC 与 billing?action=devices 必须是同一份数据（官方 dashboard 两条路径）。
func TestCloudListMachinesRPCMatchesBilling(t *testing.T) {
	s, db := testServer(t)
	owner, err := s.ensureOwner("test")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO cloud_machines(id,user_id,name,machine_id,platform,status,created_at)
		VALUES(?,?,?,?,?,'active',?)`, "22222222-3333-4444-8555-666666666666", owner, "host", "m-b", "linux", s.nowISO()); err != nil {
		t.Fatal(err)
	}
	rec := s.rpcCall("cloud_list_machines", map[string]any{
		"p_user_id": owner, "p_environment": "live", "p_current_machine_id": "m-b",
	})
	var body struct {
		Machines []struct {
			MachineID string `json:"machine_id"`
			IsCurrent bool   `json:"is_current"`
		} `json:"machines"`
		MachineCnt int `json:"machine_count"`
	}
	if err := json.Unmarshal(rec, &body); err != nil {
		t.Fatalf("RPC 响应解析失败：%v body=%s", err, rec)
	}
	if body.MachineCnt != 1 || len(body.Machines) != 1 || !body.Machines[0].IsCurrent {
		t.Fatalf("RPC 列表异常：%s", rec)
	}
}

// rpcCall 直接驱动 RPC 分发（绕开 HTTP 鉴权），返回响应 JSON。
func (s *Server) rpcCall(name string, args map[string]any) []byte {
	body, _ := json.Marshal(args)
	r := httptest.NewRequest("POST", "/api/database/rpc/"+name, bytes.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+s.signJWT("svc", "project_admin", s.now.Unix()+3600))
	rec := httptest.NewRecorder()
	s.rpc(rec, r)
	return rec.Body.Bytes()
}
