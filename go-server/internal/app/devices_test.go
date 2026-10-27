package app

// devices_test.go —— 「同一账户下多台设备可区分」的回归测试。
//
// 对应官方 dashboard 的 device 维度：
//   - tokentracker-account-devices 返回每台设备一行（id / device_name / platform / total_tokens）；
//   - 其它 account-* 端点接受 &device_id=<uuid> 只统计该设备；形状不对就当没传；
//   - 别人的 device_id 查不到任何东西（租户隔离靠 SQL 里的 user_id）；
//   - tokentracker-device-rename 用官方的 {device_id, device_name} 字段，重名 409。

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// seedTwoDevices 造出「一个账户 + 两台设备」的现场，返回 (jwt, devA, devB)。
func seedTwoDevices(t *testing.T) (*Server, http.Handler, string, string, string) {
	t.Helper()
	s, db := testServer(t)
	s.deviceApprove = "auto"
	h := s.Handler()
	owner, err := s.ensureOwner("test")
	if err != nil {
		t.Fatal(err)
	}
	jwt := s.signJWT(owner, "authenticated", s.now.Unix()+3600)

	mk := func(id, name, platform string) string {
		if _, err := db.Exec(`INSERT INTO devices(id,user_id,device_name,platform,machine_id,created_at)
			VALUES(?,?,?,?,?,?)`, id, owner, name, platform, "m-"+id, s.nowISO()); err != nil {
			t.Fatal(err)
		}
		return id
	}
	devA := mk("aaaaaaaa-1111-4111-8111-111111111111", "MacBook", "darwin")
	devB := mk("bbbbbbbb-2222-4222-8222-222222222222", "nas", "linux")
	add := func(dev, hour string, tokens int64) {
		if _, err := db.Exec(`INSERT INTO hourly(user_id,device_id,hour_start,source,model,
			total_tokens,billable_total_tokens,conversations) VALUES(?,?,?,?,?,?,?,?)`,
			owner, dev, hour, "claude", "sonnet-4.5", tokens, tokens, 1); err != nil {
			t.Fatal(err)
		}
	}
	add(devA, "2026-10-20T10:00:00Z", 700)
	add(devA, "2026-10-20T11:00:00Z", 300)
	add(devB, "2026-10-20T12:00:00Z", 50)
	return s, h, jwt, devA, devB
}

func getJSON(t *testing.T, h http.Handler, path, token string, out any) *httptest.ResponseRecorder {
	t.Helper()
	w := requestJSON(t, h, "GET", path, token, nil)
	if out != nil {
		if err := json.Unmarshal(w.Body.Bytes(), out); err != nil {
			t.Fatalf("解析 %s 失败：%v body=%s", path, err, w.Body.String())
		}
	}
	return w
}

// account-devices 必须是「每台设备一行」，按用量降序，并带 id/device_name/platform。
func TestAccountDevicesListsEachDevice(t *testing.T) {
	_, h, jwt, devA, devB := seedTwoDevices(t)
	var res struct {
		From    string `json:"from"`
		To      string `json:"to"`
		Devices []struct {
			ID         string  `json:"id"`
			DeviceName string  `json:"device_name"`
			Platform   *string `json:"platform"`
			Total      int64   `json:"total_tokens"`
			CreatedAt  string  `json:"created_at"`
		} `json:"devices"`
		AccountSources []any `json:"account_sources"`
	}
	w := getJSON(t, h, "/functions/tokentracker-account-devices?from=2026-10-20&to=2026-10-20", jwt, &res)
	if w.Code != 200 {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	if len(res.Devices) != 2 {
		t.Fatalf("devices=%+v，期望 2 台", res.Devices)
	}
	if res.Devices[0].ID != devA || res.Devices[0].Total != 1000 || res.Devices[0].DeviceName != "MacBook" {
		t.Fatalf("第一行应是 devA/1000：%+v", res.Devices[0])
	}
	if res.Devices[1].ID != devB || res.Devices[1].Total != 50 {
		t.Fatalf("第二行应是 devB/50（按用量降序）：%+v", res.Devices[1])
	}
	if res.Devices[0].Platform == nil || *res.Devices[0].Platform != "darwin" {
		t.Fatalf("platform 丢失：%+v", res.Devices[0])
	}
	if res.Devices[0].CreatedAt == "" {
		t.Fatal("created_at 丢失")
	}
	if res.AccountSources == nil || len(res.AccountSources) != 0 {
		t.Fatalf("account_sources 应为空数组：%+v", res.AccountSources)
	}
	// 每台设备之和 == 账户总量（device 维度不会重复计数）
	var sum struct {
		Totals struct {
			TotalTokens int64 `json:"total_tokens"`
		} `json:"totals"`
	}
	getJSON(t, h, "/functions/tokentracker-account-summary?from=2026-10-20&to=2026-10-20", jwt, &sum)
	if sum.Totals.TotalTokens != res.Devices[0].Total+res.Devices[1].Total {
		t.Fatalf("设备之和 %d != 账户总量 %d", res.Devices[0].Total+res.Devices[1].Total, sum.Totals.TotalTokens)
	}
}

// device_id 过滤：summary / daily / model-breakdown / monthly / heatmap 都要跟着变。
func TestDeviceIdFilterAppliesToEveryAccountEndpoint(t *testing.T) {
	_, h, jwt, devA, devB := seedTwoDevices(t)
	base := "/functions/tokentracker-account-summary?from=2026-10-20&to=2026-10-20"

	var all, aOnly, bOnly struct {
		Totals struct {
			TotalTokens int64 `json:"total_tokens"`
		} `json:"totals"`
	}
	getJSON(t, h, base, jwt, &all)
	getJSON(t, h, base+"&device_id="+devA, jwt, &aOnly)
	getJSON(t, h, base+"&device_id="+devB, jwt, &bOnly)
	if all.Totals.TotalTokens != 1050 || aOnly.Totals.TotalTokens != 1000 || bOnly.Totals.TotalTokens != 50 {
		t.Fatalf("summary 过滤异常：all=%d a=%d b=%d",
			all.Totals.TotalTokens, aOnly.Totals.TotalTokens, bOnly.Totals.TotalTokens)
	}

	var daily struct {
		Data []struct {
			TotalTokens int64 `json:"total_tokens"`
		} `json:"data"`
	}
	getJSON(t, h, "/functions/tokentracker-account-daily?from=2026-10-20&to=2026-10-20&device_id="+devB, jwt, &daily)
	if len(daily.Data) != 1 || daily.Data[0].TotalTokens != 50 {
		t.Fatalf("daily 未按设备过滤：%+v", daily.Data)
	}

	var mb struct {
		Sources []struct {
			Totals struct {
				TotalTokens int64 `json:"total_tokens"`
			} `json:"totals"`
		} `json:"sources"`
	}
	getJSON(t, h, "/functions/tokentracker-account-model-breakdown?from=2026-10-20&to=2026-10-20&device_id="+devB, jwt, &mb)
	if len(mb.Sources) != 1 || mb.Sources[0].Totals.TotalTokens != 50 {
		t.Fatalf("model-breakdown 未按设备过滤：%+v", mb.Sources)
	}

	var monthly struct {
		Data []struct {
			TotalTokens int64 `json:"total_tokens"`
		} `json:"data"`
	}
	getJSON(t, h, "/functions/tokentracker-account-monthly?from=2026-10-01&to=2026-10-31&device_id="+devB, jwt, &monthly)
	if len(monthly.Data) != 1 || monthly.Data[0].TotalTokens != 50 {
		t.Fatalf("monthly 未按设备过滤：%+v", monthly.Data)
	}

	var heat struct {
		ActiveDays int `json:"active_days"`
	}
	getJSON(t, h, "/functions/tokentracker-account-heatmap?from=2026-10-20&to=2026-10-20&device_id="+devB, jwt, &heat)
	if heat.ActiveDays != 1 {
		t.Fatalf("heatmap 未按设备过滤：active_days=%d", heat.ActiveDays)
	}
	// heatmap 不看 device_id 的话，devA 那两天也会算进来
	var heatAll struct {
		ActiveDays int `json:"active_days"`
	}
	getJSON(t, h, "/functions/tokentracker-account-heatmap?from=2026-10-20&to=2026-10-20", jwt, &heatAll)
	if heatAll.ActiveDays != 1 {
		t.Fatalf("同一天两设备应仍是 1 个活跃日：%d", heatAll.ActiveDays)
	}
}

// 非法 / 不属于自己的 device_id：前者当没传（官方行为），后者查出来是空。
func TestDeviceIdFilterIgnoresBadShapeAndForeignIds(t *testing.T) {
	_, h, jwt, _, _ := seedTwoDevices(t)
	base := "/functions/tokentracker-account-summary?from=2026-10-20&to=2026-10-20"

	var res struct {
		Totals struct {
			TotalTokens int64 `json:"total_tokens"`
		} `json:"totals"`
	}
	// 形状不对 → 忽略过滤，返回全量
	getJSON(t, h, base+"&device_id=not-a-uuid", jwt, &res)
	if res.Totals.TotalTokens != 1050 {
		t.Fatalf("非法 device_id 应被忽略，实际 %d", res.Totals.TotalTokens)
	}
	// 形状合法但不是自己的设备 → 空
	getJSON(t, h, base+"&device_id=cccccccc-3333-4333-8333-333333333333", jwt, &res)
	if res.Totals.TotalTokens != 0 {
		t.Fatalf("别人的 device_id 应查不到数据，实际 %d", res.Totals.TotalTokens)
	}
}

// 撤销的设备不出现在列表里（官方语义），但历史用量仍计入账户总量。
func TestRevokedDeviceHiddenFromListButUsageKept(t *testing.T) {
	s, h, jwt, _, devB := seedTwoDevices(t)
	if _, err := s.db.Exec(`UPDATE devices SET revoked_at=? WHERE id=?`, s.nowISO(), devB); err != nil {
		t.Fatal(err)
	}
	var res struct {
		Devices []struct {
			ID string `json:"id"`
		} `json:"devices"`
	}
	getJSON(t, h, "/functions/tokentracker-account-devices?from=2026-10-20&to=2026-10-20", jwt, &res)
	if len(res.Devices) != 1 || res.Devices[0].ID == devB {
		t.Fatalf("撤销的设备不该出现在列表里：%+v", res.Devices)
	}
	var sum struct {
		Totals struct {
			TotalTokens int64 `json:"total_tokens"`
		} `json:"totals"`
	}
	getJSON(t, h, "/functions/tokentracker-account-summary?from=2026-10-20&to=2026-10-20", jwt, &sum)
	if sum.Totals.TotalTokens != 1050 {
		t.Fatalf("撤销设备的历史用量仍应计入总量，实际 %d", sum.Totals.TotalTokens)
	}
}

// account-devices 缺参数时与官方一致：400 Missing from/to（不再编造默认日期）。
func TestAccountDevicesRequiresFromTo(t *testing.T) {
	_, h, jwt, _, _ := seedTwoDevices(t)
	w := requestJSON(t, h, "GET", "/functions/tokentracker-account-devices", jwt, nil)
	if w.Code != 400 || !strings.Contains(w.Body.String(), "Missing from/to") {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}

// 官方 dashboard 的重命名请求体是 {device_id, device_name}；重名返回 409。
func TestDeviceRenameUsesOfficialFieldNames(t *testing.T) {
	s, h, jwt, devA, devB := seedTwoDevices(t)
	w := requestJSON(t, h, "POST", "/functions/tokentracker-device-rename", jwt,
		map[string]any{"device_id": devA, "device_name": "书房 MacBook"})
	if w.Code != 200 {
		t.Fatalf("rename status=%d body=%s", w.Code, w.Body.String())
	}
	var res struct {
		OK         bool   `json:"ok"`
		DeviceID   string `json:"device_id"`
		DeviceName string `json:"device_name"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &res)
	if !res.OK || res.DeviceID != devA || res.DeviceName != "书房 MacBook" {
		t.Fatalf("响应形状不对：%s", w.Body.String())
	}
	var name string
	if err := s.db.QueryRow(`SELECT device_name FROM devices WHERE id=?`, devA).Scan(&name); err != nil {
		t.Fatal(err)
	}
	if name != "书房 MacBook" {
		t.Fatalf("库里名字没改：%q", name)
	}

	// 撞另一台在用设备的平台+名字 → 409（不是 500）
	if _, err := s.db.Exec(`UPDATE devices SET device_name='nas' WHERE id=?`, devB); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`UPDATE devices SET platform='linux' WHERE id=?`, devA); err != nil {
		t.Fatal(err)
	}
	w = requestJSON(t, h, "POST", "/functions/tokentracker-device-rename", jwt,
		map[string]any{"device_id": devA, "device_name": "nas"})
	if w.Code != 409 {
		t.Fatalf("重名应 409，实际 %d body=%s", w.Code, w.Body.String())
	}

	// 别人的设备 / 不存在 → 404
	w = requestJSON(t, h, "POST", "/functions/tokentracker-device-rename", jwt,
		map[string]any{"device_id": "dddddddd-4444-4444-8444-444444444444", "device_name": "x"})
	if w.Code != 404 {
		t.Fatalf("不存在的设备应 404，实际 %d", w.Code)
	}
	// 缺字段 → 400
	w = requestJSON(t, h, "POST", "/functions/tokentracker-device-rename", jwt,
		map[string]any{"device_id": devA})
	if w.Code != 400 {
		t.Fatalf("缺 device_name 应 400，实际 %d", w.Code)
	}
}

// RPC account_usage_grouped 也要认 p_device_id（官方 dashboard 的按设备取数路径）。
func TestUsageGroupedRPCRespectsDeviceId(t *testing.T) {
	s, _, _, devA, _ := seedTwoDevices(t)
	p := func(v any) any { return v }
	res := s.usageGrouped(map[string]any{
		"p_user_id":    mustOwner(t, s),
		"p_device_id":  devA,
		"p_from":       "2026-10-20T00:00:00Z",
		"p_to":         "2026-10-20T23:59:59Z",
		"p_trunc":      "day",
		"p_tz":         "UTC",
		"p_offset_min": p(0),
	})
	var sum int64
	for _, row := range res {
		v, _ := row["total_tokens"].(int64)
		sum += v
	}
	if sum != 1000 {
		t.Fatalf("p_device_id 过滤异常：sum=%d rows=%v", sum, fmt.Sprint(res))
	}
}

func mustOwner(t *testing.T, s *Server) string {
	t.Helper()
	uid, err := s.ownerSub()
	if err != nil || uid == "" {
		t.Fatalf("ownerSub: %q %v", uid, err)
	}
	return uid
}
