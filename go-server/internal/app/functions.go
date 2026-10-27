package app

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

func (s *Server) functions(w http.ResponseWriter, r *http.Request) {
	slug := strings.TrimPrefix(r.URL.Path, "/functions/")
	if i := strings.IndexByte(slug, '?'); i >= 0 {
		slug = slug[:i]
	}
	applyCORS(w, slug)

	// 公开入口（无需 JWT）
	public := slug == "tokentracker-device-flow-authorize" || slug == "tokentracker-device-flow-poll"
	// ingest 使用 device token（SHA-256 hash），不是 JWT；由 handler 自己校验。
	// 参考实现也是这个语义：未认证时返回 "Missing bearer token" / "Unauthorized"。
	deviceTokenAuth := slug == "tokentracker-ingest"
	sub, role, _, authed := s.auth(r)
	if !public && !deviceTokenAuth && !authed {
		if slug == "tokentracker-billing" {
			fail(w, 401, "sign_in_required")
			return
		}
		fail(w, 401, "Unauthorized")
		return
	}

	switch slug {
	case "tokentracker-device-flow-authorize":
		s.deviceAuthorize(w, r)
	case "tokentracker-device-flow-poll":
		s.devicePoll(w, r)
	case "tokentracker-device-flow-grant":
		s.deviceGrant(w, r, sub)
	case "tokentracker-device-token-issue":
		s.deviceIssue(w, r, sub)
	case "tokentracker-device-rename":
		s.deviceRename(w, r, sub)
	case "tokentracker-ingest":
		s.ingest(w, r)
	case "tokentracker-account-summary":
		s.accountSummary(w, r, sub)
	case "tokentracker-account-daily":
		s.accountDaily(w, r, sub)
	case "tokentracker-account-hourly":
		s.accountHourly(w, r, sub)
	case "tokentracker-account-monthly":
		s.accountMonthly(w, r, sub)
	case "tokentracker-account-heatmap":
		s.accountHeatmap(w, r, sub)
	case "tokentracker-account-model-breakdown":
		s.accountModelBreakdown(w, r, sub)
	case "tokentracker-account-devices":
		s.accountDevices(w, r, sub)
	case "tokentracker-billing":
		s.billing(w, r, sub, role)
	default:
		writeJSON(w, 404, map[string]any{"error": "Function not installed"})
	}
}

// ---------- 设备授权 ----------

func (s *Server) deviceAuthorize(w http.ResponseWriter, r *http.Request) {
	var b struct {
		ClientInfo string `json:"client_info"`
		MachineID  string `json:"machine_id"`
	}
	_ = json.NewDecoder(r.Body).Decode(&b)
	dc := randomHex(32)
	uc := userCode()
	expires := s.now.Add(15 * time.Minute).UTC().Format(time.RFC3339)
	_, err := s.db.Exec(`INSERT INTO device_codes(device_code,user_code,status,expires_at,client_info,machine_id,created_at)
		VALUES(?,?,'pending',?,?,?,?)`, dc, uc, expires, nullStr(b.ClientInfo), nullStr(b.MachineID), s.nowISO())
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{
		"device_code": dc, "user_code": uc,
		"verification_uri":          s.dashboard + "/device",
		"verification_uri_complete": s.dashboard + "/device?user_code=" + uc,
		"expires_in":                900, "interval": 5,
	})
}

func (s *Server) devicePoll(w http.ResponseWriter, r *http.Request) {
	var b struct {
		DeviceCode string `json:"device_code"`
	}
	_ = json.NewDecoder(r.Body).Decode(&b)
	var status string
	var uid, tok, did, mid sql.NullString
	err := s.db.QueryRow(`SELECT status,user_id,device_token,device_id,machine_id FROM device_codes WHERE device_code=?`, b.DeviceCode).
		Scan(&status, &uid, &tok, &did, &mid)
	if err != nil {
		writeJSON(w, 404, map[string]any{"status": "unknown"})
		return
	}
	if status == "pending" {
		writeJSON(w, 200, map[string]any{"status": "pending"})
		return
	}
	if status == "approved" || status == "used" {
		writeJSON(w, 200, map[string]any{
			"status": status, "user_id": uid.String, "device_token": tok.String,
			"device_id": did.String, "machine_id": mid.String,
			"membership": s.membership(uid.String),
		})
		_, _ = s.db.Exec(`UPDATE device_codes SET status='used' WHERE device_code=?`, b.DeviceCode)
		return
	}
	writeJSON(w, 200, map[string]any{"status": status})
}

// ensureAccount 保证 auth_users 里有 sub 对应的账户行。
//
// 自托管部署没有注册流程（signup 属于外部认证层），而 devices.user_id 有外键约束，
// 所以首次使用某个 sub 时必须自动建账，否则 device-token-issue 会直接报
// FOREIGN KEY constraint failed —— 局域网自用场景下这就是「装好却传不上去」。
// 幂等：已存在则不做任何事；不改变任何认证语义（仍然只认签名有效的 JWT）。
func (s *Server) ensureAccount(sub string) error {
	if sub == "" {
		return nil
	}
	_, err := s.db.Exec(s.db.InsertIgnore(`auth_users(id,email) VALUES(?,?)`), sub, "")
	return err
}

func (s *Server) deviceGrant(w http.ResponseWriter, r *http.Request, sub string) {
	var b struct {
		UserCode string `json:"user_code"`
	}
	_ = json.NewDecoder(r.Body).Decode(&b)
	var dc string
	var mid sql.NullString
	var ci sql.NullString
	err := s.db.QueryRow(`SELECT device_code,machine_id,client_info FROM device_codes WHERE user_code=?`, b.UserCode).
		Scan(&dc, &mid, &ci)
	if err != nil {
		fail(w, 400, "Invalid user code")
		return
	}

	// 签发设备 token + 设备记录（与 deviceIssue 等价）
	if err := s.ensureAccount(sub); err != nil {
		fail(w, 500, err.Error())
		return
	}
	tok := randomHex(32)
	did := newID()
	actualMid := mid.String
	if actualMid == "" {
		actualMid = newID()
	}
	_, err = s.db.Exec(`INSERT INTO devices(id,user_id,device_name,platform,machine_id,created_at) VALUES(?,?,?,?,?,?)`,
		did, sub, "Device Flow", "cli", actualMid, s.nowISO())
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	_, err = s.db.Exec(`INSERT INTO device_tokens(id,user_id,device_id,token_hash,created_at) VALUES(?,?,?,?,?)`,
		newID(), sub, did, tokenHash(tok), s.nowISO())
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	_, _ = s.db.Exec(`UPDATE device_codes SET status='approved', user_id=?, approved_at=?, device_token=?, device_id=? WHERE device_code=?`,
		sub, s.nowISO(), tok, did, dc)
	writeJSON(w, 200, map[string]any{
		"ok": true, "status": "approved", "membership": s.membership(sub),
		"client_info": ci.String,
	})
}

func (s *Server) deviceIssue(w http.ResponseWriter, r *http.Request, sub string) {
	var b struct {
		DeviceName string `json:"device_name"`
		Platform   string `json:"platform"`
		MachineID  string `json:"machine_id"`
	}
	_ = json.NewDecoder(r.Body).Decode(&b)
	if b.DeviceName == "" {
		fail(w, 400, "device_name required")
		return
	}
	tok := randomHex(32)
	id := newID()
	mid := b.MachineID
	if mid == "" {
		mid = newID()
	}
	platform := b.Platform
	if platform == "" {
		platform = "test"
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureAccount(sub); err != nil {
		fail(w, 500, err.Error())
		return
	}
	_, err := s.db.Exec(`INSERT INTO devices(id,user_id,device_name,platform,machine_id,created_at) VALUES(?,?,?,?,?,?)`,
		id, sub, b.DeviceName, platform, mid, s.nowISO())
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	_, err = s.db.Exec(`INSERT INTO device_tokens(id,user_id,device_id,token_hash,created_at) VALUES(?,?,?,?,?)`,
		newID(), sub, id, tokenHash(tok), s.nowISO())
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	_, _ = s.db.Exec(`INSERT INTO cloud_machines(id,user_id,name,machine_id,platform,status,created_at) VALUES(?,?,?,?,?,'active',?)`,
		newID(), sub, b.DeviceName, mid, platform, s.nowISO())
	writeJSON(w, 200, map[string]any{
		"token": tok, "device_id": id, "machine_id": mid, "device_name": b.DeviceName,
		"membership": s.membership(sub),
	})
}

func (s *Server) deviceRename(w http.ResponseWriter, r *http.Request, sub string) {
	var b struct {
		DeviceID string `json:"device_id"`
		Name     string `json:"name"`
	}
	_ = json.NewDecoder(r.Body).Decode(&b)
	res, err := s.db.Exec(`UPDATE devices SET device_name=? WHERE id=? AND user_id=?`, b.Name, b.DeviceID, sub)
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		fail(w, 404, "Device not found")
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "device_id": b.DeviceID, "name": b.Name})
}

// ---------- 用量上传 ----------

type bucket struct {
	HourStart     string `json:"hour_start"`
	Source        string `json:"source"`
	Model         string `json:"model"`
	InputTokens   int64  `json:"input_tokens"`
	OutputTokens  int64  `json:"output_tokens"`
	CachedInput   int64  `json:"cached_input_tokens"`
	CacheCreation int64  `json:"cache_creation_input_tokens"`
	Reasoning     int64  `json:"reasoning_output_tokens"`
	TotalTokens   int64  `json:"total_tokens"`
	Billable      int64  `json:"billable_total_tokens"`
	CostUSD       any    `json:"total_cost_usd"`
	Conversations int64  `json:"conversation_count"`
}

func (s *Server) ingest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		fail(w, 405, "Method not allowed")
		return
	}
	tok := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if tok == "" {
		fail(w, 401, "Missing bearer token")
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 2<<20))
	if err != nil {
		fail(w, 400, "Invalid JSON body")
		return
	}
	if len(body) > 1<<20 {
		fail(w, 413, "Upload too large")
		return
	}
	// 校验 device token
	var userID, deviceID string
	err = s.db.QueryRow(`SELECT user_id,device_id FROM device_tokens WHERE token_hash=? AND revoked_at IS NULL`,
		tokenHash(tok)).Scan(&userID, &deviceID)
	if err != nil {
		fail(w, 401, "Unauthorized")
		return
	}
	var b struct {
		Buckets []bucket `json:"buckets"`
		Hourly  []bucket `json:"hourly"`
	}
	if json.Unmarshal(body, &b) != nil {
		fail(w, 400, "Invalid JSON body")
		return
	}
	rows := b.Buckets
	if len(rows) == 0 {
		rows = b.Hourly
	}
	if len(rows) == 0 {
		fail(w, 400, "No usage buckets provided")
		return
	}
	if len(rows) > 500 {
		fail(w, 400, "Too many buckets (max 500)")
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	inserted, skipped := 0, 0
	tx, err := s.db.Begin()
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	defer tx.Rollback()
	for _, x := range rows {
		if x.HourStart == "" || x.Source == "" || x.Model == "" {
			skipped++
			continue
		}
		// 整行修正：先删除同一主键的旧行，再插入（与 PG 的 whole-row correction 等价）
		_, _ = tx.Exec(`DELETE FROM hourly WHERE user_id=? AND device_id=? AND hour_start=? AND source=? AND model=?`,
			userID, deviceID, x.HourStart, x.Source, x.Model)
		cost := "0"
		if x.CostUSD != nil {
			cost = fmt.Sprintf("%v", x.CostUSD)
		}
		var billable any = x.Billable
		if x.Billable == 0 {
			billable = x.TotalTokens
		}
		_, err := tx.Exec(`INSERT INTO hourly(user_id,device_id,hour_start,source,model,
			input_tokens,output_tokens,cached_input_tokens,cache_creation_input_tokens,reasoning_output_tokens,
			total_tokens,billable_total_tokens,conversations,total_cost_usd)
			VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			userID, deviceID, x.HourStart, x.Source, x.Model,
			x.InputTokens, x.OutputTokens, x.CachedInput, x.CacheCreation, x.Reasoning,
			x.TotalTokens, billable, x.Conversations, cost)
		if err != nil {
			skipped++
			continue
		}
		inserted++
	}
	if tx.Commit() != nil {
		fail(w, 500, "commit failed")
		return
	}
	_, _ = s.db.Exec(`DELETE FROM usage_cache WHERE cache_key LIKE ?`, "%"+userID+"%")

	writeJSON(w, 200, map[string]any{
		"ok": true, "skipped": skipped, "inserted": inserted,
		"membership": s.membership(userID), "upload_scope": "cloud",
		"next_allowed_at": s.nowISO(), "sync_interval_seconds": 0,
	})
}

// ---------- 账户读取 ----------

func (s *Server) accountParams(r *http.Request) (from, to, tz string, ok bool) {
	q := r.URL.Query()
	from, to, tz = q.Get("from"), q.Get("to"), q.Get("tz")
	if from == "" || to == "" {
		return "", "", "", false
	}
	if len(from) != 10 || len(to) != 10 {
		// 非法日期：参考实现返回 500 Invalid time value
		return from, to, tz, true
	}
	if tz == "" {
		tz = "UTC"
	}
	return from, to, tz, true
}

func (s *Server) accountSummary(w http.ResponseWriter, r *http.Request, sub string) {
	from, to, _, ok := s.accountParams(r)
	if !ok {
		fail(w, 400, "Missing from/to")
		return
	}
	if _, err := time.Parse("2006-01-02", from); err != nil {
		// 参考实现解析错误路径只返回 Content-Type，没有 handler 的 CORS header。
		w.Header().Del("Access-Control-Allow-Origin")
		w.Header().Del("Access-Control-Allow-Headers")
		w.Header().Del("Access-Control-Allow-Methods")
		w.Header().Set("X-TT-NoCORS", "1")
		writeJSON(w, 500, map[string]any{"code": "SELF_HOST_SQL", "message": "Invalid time value"})
		return
	}
	rows := s.fetchHourly(sub, from+"T00:00:00Z", to+"T23:59:59Z")
	totals := sumRows(rows)
	days := totals["days"]
	delete(totals, "days")

	// rolling 窗口基于冻结时钟
	today := s.now.UTC().Format("2006-01-02")
	d7 := s.now.UTC().AddDate(0, 0, -6).Format("2006-01-02")
	d30 := s.now.UTC().AddDate(0, 0, -29).Format("2006-01-02")
	r7 := s.fetchHourly(sub, d7+"T00:00:00Z", today+"T23:59:59Z")
	r30 := s.fetchHourly(sub, d30+"T00:00:00Z", today+"T23:59:59Z")
	activeDays30 := map[string]bool{}
	for _, x := range r30 {
		activeDays30[x.HourStart[:10]] = true
	}
	var bill30, conv30 int64
	for _, x := range r30 {
		bill30 += x.Billable
		conv30 += x.Conversations
	}
	avg := int64(0)
	if len(activeDays30) > 0 {
		avg = bill30 / int64(len(activeDays30))
	}
	var bill7, conv7 int64
	activeDays7 := map[string]bool{}
	for _, x := range r7 {
		bill7 += x.Billable
		conv7 += x.Conversations
		activeDays7[x.HourStart[:10]] = true
	}

	writeJSON(w, 200, map[string]any{
		"from": from, "to": to, "days": days, "totals": totals,
		"rolling": map[string]any{
			"last_7d": map[string]any{
				"from": d7, "to": today, "active_days": len(activeDays7),
				"totals": map[string]any{"billable_total_tokens": bill7, "conversation_count": conv7},
			},
			"last_30d": map[string]any{
				"from": d30, "to": today, "active_days": len(activeDays30),
				"totals":             map[string]any{"billable_total_tokens": bill30, "conversation_count": conv30},
				"avg_per_active_day": avg,
			},
		},
	})
}

// dayKey 按 tz 把 UTC 小时转成本地日期键（简化：支持 UTC 与 +08:00 固定偏移）。
func dayKey(hourStart, tz string) string {
	t, err := time.Parse(time.RFC3339, hourStart)
	if err != nil {
		return hourStart[:10]
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		loc = time.UTC
	}
	return t.In(loc).Format("2006-01-02")
}

// dayAgg 严格对齐 golden 的 account-daily data[] 结构。
type dayAgg struct {
	Day           string           `json:"day"`
	TotalTokens   int64            `json:"total_tokens"`
	Billable      int64            `json:"billable_total_tokens"`
	TotalCostUSD  int64            `json:"total_cost_usd"`
	InputTokens   int64            `json:"input_tokens"`
	OutputTokens  int64            `json:"output_tokens"`
	CachedInput   int64            `json:"cached_input_tokens"`
	CacheCreation int64            `json:"cache_creation_input_tokens"`
	Reasoning     int64            `json:"reasoning_output_tokens"`
	Conversations int64            `json:"conversation_count"`
	Models        map[string]int64 `json:"models"`
}

func (s *Server) aggregateByDay(rows []usageRow, tz string) []dayAgg {
	type k struct{ day string }
	m := map[k]*dayAgg{}
	for _, x := range rows {
		d := dayKey(x.HourStart, tz)
		a, ok := m[k{d}]
		if !ok {
			a = &dayAgg{Day: d, Models: map[string]int64{}}
			m[k{d}] = a
		}
		a.TotalTokens += x.TotalTokens
		a.Billable += x.Billable
		a.InputTokens += x.InputTokens
		a.OutputTokens += x.OutputTokens
		a.CachedInput += x.CachedInput
		a.CacheCreation += x.CacheCreation
		a.Reasoning += x.Reasoning
		a.Conversations += x.Conversations
		a.Models[x.Model] += x.TotalTokens
	}
	out := make([]dayAgg, 0, len(m))
	for _, a := range m {
		out = append(out, *a)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Day < out[j].Day })
	return out
}

func (s *Server) accountDaily(w http.ResponseWriter, r *http.Request, sub string) {
	from, to, tz, ok := s.accountParams(r)
	if !ok {
		fail(w, 400, "Missing from/to")
		return
	}
	rows := s.fetchHourly(sub, from+"T00:00:00Z", to+"T23:59:59Z")
	writeJSON(w, 200, map[string]any{"from": from, "to": to, "data": s.aggregateByDay(rows, tz)})
}

func (s *Server) accountHourly(w http.ResponseWriter, r *http.Request, sub string) {
	// 参考实现对 hourly endpoint 默认使用“今天”（忽略 from/to）；契约快照锁定此行为。
	day := s.now.UTC().Format("2006-01-02")
	rows := s.fetchHourly(sub, day+"T00:00:00Z", day+"T23:59:59Z")
	data := []map[string]any{}
	for _, x := range rows {
		data = append(data, map[string]any{
			"hour": x.HourStart, "source": x.Source, "model": x.Model,
			"total_tokens": x.TotalTokens, "billable_total_tokens": x.Billable,
			"conversation_count": x.Conversations,
		})
	}
	writeJSON(w, 200, map[string]any{"day": day, "data": data})
}

func (s *Server) accountMonthly(w http.ResponseWriter, r *http.Request, sub string) {
	from, to, _, ok := s.accountParams(r)
	if !ok {
		fail(w, 400, "Missing from/to")
		return
	}
	rows := s.fetchHourly(sub, from+"T00:00:00Z", to+"T23:59:59Z")
	byMonth := map[string]int64{}
	for _, x := range rows {
		byMonth[x.HourStart[:7]] += x.TotalTokens
	}
	keys := make([]string, 0, len(byMonth))
	for k := range byMonth {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	data := []map[string]any{}
	for _, k := range keys {
		data = append(data, map[string]any{"month": k, "total_tokens": byMonth[k]})
	}
	writeJSON(w, 200, map[string]any{"from": from, "to": to, "data": data})
}

func (s *Server) accountHeatmap(w http.ResponseWriter, r *http.Request, sub string) {
	q := r.URL.Query()
	weeks := 52
	if raw := q.Get("weeks"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil {
			if n < 1 {
				n = 1
			}
			if n > 104 {
				n = 104
			}
			weeks = n
		}
	}
	to := q.Get("to")
	if to == "" {
		to = s.now.UTC().Format("2006-01-02")
	}
	end, err := time.Parse("2006-01-02", to)
	if err != nil {
		fail(w, 400, "Invalid to date")
		return
	}
	start := end.AddDate(0, 0, -weeks*7+1)
	from := start.Format("2006-01-02")
	weekStarts := q.Get("week_starts_on")
	if strings.ToLower(weekStarts) != "mon" {
		weekStarts = "sun"
	}
	rows := s.fetchHourly(sub, from+"T00:00:00Z", to+"T23:59:59Z")
	type daily struct {
		total, bill int64
		models      map[string]int64
	}
	byDay := map[string]*daily{}
	for _, x := range rows {
		day := dayKey(x.HourStart, "UTC")
		d := byDay[day]
		if d == nil {
			d = &daily{models: map[string]int64{}}
			byDay[day] = d
		}
		d.total += x.TotalTokens
		d.bill += x.Billable
		d.models[x.Model] += x.TotalTokens
	}
	max := int64(0)
	active := 0
	for _, d := range byDay {
		if d.bill > 0 {
			active++
			if d.bill > max {
				max = d.bill
			}
		}
	}
	cells := []map[string]any{}
	for day := start; !day.After(end); day = day.AddDate(0, 0, 1) {
		key := day.Format("2006-01-02")
		d := byDay[key]
		total, bill := int64(0), int64(0)
		var models any
		if d != nil {
			total, bill, models = d.total, d.bill, d.models
		}
		level := 0
		if bill > 0 {
			level = 1
			if max > 0 {
				ratio := float64(bill) / float64(max)
				if ratio > 0.75 {
					level = 4
				} else if ratio > 0.5 {
					level = 3
				} else if ratio > 0.25 {
					level = 2
				}
			}
		}
		cells = append(cells, map[string]any{"day": key, "total_tokens": total, "billable_total_tokens": bill, "level": level, "models": models})
	}
	weeksArr := [][]map[string]any{}
	for i := 0; i < len(cells); i += 7 {
		j := i + 7
		if j > len(cells) {
			j = len(cells)
		}
		weeksArr = append(weeksArr, cells[i:j])
	}
	writeJSON(w, 200, map[string]any{"from": from, "to": to, "week_starts_on": weekStarts, "active_days": active, "streak_days": 0, "weeks": weeksArr})
}

func (s *Server) accountModelBreakdown(w http.ResponseWriter, r *http.Request, sub string) {
	from, to, _, ok := s.accountParams(r)
	if !ok {
		fail(w, 400, "Missing from/to")
		return
	}
	rows := s.fetchHourly(sub, from+"T00:00:00Z", to+"T23:59:59Z")
	type agg struct {
		total, bill, input, output, cached, creation, reasoning int64
		cost                                                    float64
	}
	bySource := map[string]map[string]*agg{}
	for _, x := range rows {
		if bySource[x.Source] == nil {
			bySource[x.Source] = map[string]*agg{}
		}
		a := bySource[x.Source][x.Model]
		if a == nil {
			a = &agg{}
			bySource[x.Source][x.Model] = a
		}
		a.total += x.TotalTokens
		a.bill += x.Billable
		a.input += x.InputTokens
		a.output += x.OutputTokens
		a.cached += x.CachedInput
		a.creation += x.CacheCreation
		a.reasoning += x.Reasoning
		var c float64
		_, _ = fmt.Sscanf(x.CostUSD, "%f", &c)
		a.cost += c
	}
	sources := make([]string, 0, len(bySource))
	for k := range bySource {
		sources = append(sources, k)
	}
	sort.Strings(sources)
	outSources := []map[string]any{}
	for _, src := range sources {
		modelsMap := bySource[src]
		names := make([]string, 0, len(modelsMap))
		for n := range modelsMap {
			names = append(names, n)
		}
		// 参考实现按 total_tokens 降序；模型名作为稳定 tie-break。
		sort.Slice(names, func(i, j int) bool {
			if modelsMap[names[i]].total == modelsMap[names[j]].total {
				return names[i] < names[j]
			}
			return modelsMap[names[i]].total > modelsMap[names[j]].total
		})
		models := []map[string]any{}
		var sourceTotal agg
		for _, n := range names {
			a := modelsMap[n]
			tot := map[string]any{"total_tokens": a.total, "billable_total_tokens": a.bill, "input_tokens": a.input,
				"output_tokens": a.output, "cached_input_tokens": a.cached, "cache_creation_input_tokens": a.creation,
				"reasoning_output_tokens": a.reasoning, "total_cost_usd": fmt.Sprintf("%.6f", a.cost)}
			models = append(models, map[string]any{"model": n, "model_id": n,
				"pricing":     map[string]any{"status": "unpriced", "source": nil, "input": 0, "output": 0, "cache_read": 0, "cache_write": 0},
				"cost_source": "model_pricing", "totals": tot})
			sourceTotal.total += a.total
			sourceTotal.bill += a.bill
			sourceTotal.input += a.input
			sourceTotal.output += a.output
			sourceTotal.cached += a.cached
			sourceTotal.creation += a.creation
			sourceTotal.reasoning += a.reasoning
			sourceTotal.cost += a.cost
		}
		st := map[string]any{"total_tokens": sourceTotal.total, "billable_total_tokens": sourceTotal.bill, "input_tokens": sourceTotal.input,
			"output_tokens": sourceTotal.output, "cached_input_tokens": sourceTotal.cached, "cache_creation_input_tokens": sourceTotal.creation,
			"reasoning_output_tokens": sourceTotal.reasoning, "total_cost_usd": fmt.Sprintf("%.6f", sourceTotal.cost)}
		outSources = append(outSources, map[string]any{"source": src, "totals": st, "models": models})
	}
	writeJSON(w, 200, map[string]any{
		"from": from, "to": to, "days": 0, "sources": outSources,
		"pricing": map[string]any{"model": "per-model", "pricing_mode": "per_token_type", "source": "litellm", "effective_from": s.now.Format("2006-01-02")},
	})
}

func (s *Server) accountDevices(w http.ResponseWriter, r *http.Request, sub string) {
	from, to, _, ok := s.accountParams(r)
	if !ok {
		from, to = "2026-10-01", "2026-10-01"
	}
	rows := s.fetchHourly(sub, from+"T00:00:00Z", to+"T23:59:59Z")
	byDevice := map[string]int64{}
	for _, x := range rows {
		byDevice[x.Source] += x.TotalTokens
	}
	devices := []map[string]any{}
	for k, v := range byDevice {
		devices = append(devices, map[string]any{"source": k, "total_tokens": v})
	}
	sort.Slice(devices, func(i, j int) bool { return fmt.Sprint(devices[i]["source"]) < fmt.Sprint(devices[j]["source"]) })
	writeJSON(w, 200, map[string]any{
		"from": from, "to": to, "devices": devices, "account_sources": []any{},
	})
}

// ---------- billing ----------

func (s *Server) billing(w http.ResponseWriter, r *http.Request, sub, role string) {
	action := r.URL.Query().Get("action")
	if action == "" {
		action = "account"
	}
	switch action {
	case "catalog":
		writeJSON(w, 200, map[string]any{
			"environment":         "live",
			"policy":              map[string]any{"phase": "active", "launch_at": "2026-10-26T00:00:00.000Z", "hosting_mode": "self_hosted"},
			"prices":              []any{},
			"providers":           map[string]any{"waffo": false, "paddle": false, "wechat": false, "alipay": false},
			"checkout_verified":   false,
			"paddle_client_token": nil,
			"limits": map[string]any{"machines": nil, "sync_minutes": 0,
				"hourly_history_days": nil, "daily_history_months": nil, "trial_days": 0},
		})
	case "remove-device":
		var b struct {
			MachineID string `json:"machine_id"`
		}
		_ = json.NewDecoder(r.Body).Decode(&b)
		_, _ = s.db.Exec(`UPDATE device_tokens SET revoked_at=? WHERE token_hash IN
			(SELECT token_hash FROM device_tokens dt JOIN devices d ON d.id=dt.device_id WHERE d.machine_id=? AND d.user_id=?)`,
			s.nowISO(), b.MachineID, sub)
		_, _ = s.db.Exec(`UPDATE devices SET revoked_at=? WHERE machine_id=? AND user_id=?`, s.nowISO(), b.MachineID, sub)
		_, _ = s.db.Exec(`UPDATE cloud_machines SET status='paused' WHERE machine_id=? AND user_id=?`, b.MachineID, sub)
		writeJSON(w, 200, map[string]any{
			"ok": true, "machines": s.listMachines(sub), "membership": s.membership(sub),
			"machine_count": s.machineCount(sub), "machine_limit": nil, "over_machine_limit": nil,
		})
	case "account":
		fallthrough
	default:
		writeJSON(w, 200, map[string]any{
			"environment": "live", "membership": s.membership(sub),
			"machine_count": s.machineCount(sub), "payments": []any{},
			"subscriptions": []any{}, "pending_orders": []any{}, "conflict_orders": []any{},
			"gifts": []any{}, "redemption_restriction": nil, "gift_redemption_available": false,
		})
	}
}
