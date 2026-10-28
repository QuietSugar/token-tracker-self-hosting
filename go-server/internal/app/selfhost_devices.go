package app

// selfhost_devices.go —— 内建看板专用的设备清单端点。
//
// 为什么单独开一个端点，而不是给官方 `tokentracker-account-devices` 加字段：
//
//	那个端点是对上游行为的镜像，契约 golden 逐字段对拍。往里加 last_seen_at /
//	status 不会让 golden 变红（相关用例里 devices 都是空数组），但从此上游 diff
//	永远会多出一条噪音。看板需要的信息本来就是「自托管的部署视图」，
//	放回自托管的命名空间里，两边都不脏。
//
// 它只读、只返回当前登录账户自己的设备，没有写操作。

import (
	"database/sql"
	"net/http"
	"strings"
)

// selfHostAPI 挂在 /api/selfhost/ 下（不是官方接口，页面专用）。
func (s *Server) selfHostAPI(w http.ResponseWriter, r *http.Request) {
	// 先鉴权再路由：未认证时任何方法/路径一律 401，不暴露"这个端点存在哪些方法"。
	sub, _, _, ok := s.auth(r)
	if !ok {
		writeJSON(w, 401, map[string]any{"error": "Unauthorized"})
		return
	}
	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/selfhost/"), "/")
	switch {
	case path == "devices" && r.Method == http.MethodGet:
		s.selfHostDevices(w, sub)
	case path == "devices":
		w.Header().Set("Allow", "GET")
		writeJSON(w, 405, map[string]any{"error": "method not allowed"})
	default:
		writeJSON(w, 404, map[string]any{"error": "not found"})
	}
}

// selfHostDevices 返回「设备 + 它所属机器的最新状态」。
//
//	GET /api/selfhost/devices          需要 JWT（与 /functions/* 同一套鉴权）
//	→ {"devices":[{id, device_name, platform, machine_id, status,
//	               created_at, last_seen_at, active_tokens}]}
//
// last_seen_at 的语义要说清楚：它只在**确实有用量桶写入**时由 ingest 刷新，
// 不是"最后一次 HTTP 通信"。客户端 sync 了但没有新数据时通常不发请求，
// 所以这个值表示「最后一次有新用量的时间」。
//
// 已撤销（revoked_at 非空）的设备不返回——与 account-devices 一致：
// 撤销的设备在你的设备清单里已经不存在了，历史用量仍计入账户总量。
func (s *Server) selfHostDevices(w http.ResponseWriter, sub string) {
	// 一台机器可能因为历史原因存在多行（本项目已修掉产生路径，但老库里可能还有），
	// 这里取最新那一行，避免 LEFT JOIN 把一台设备放大成多行。
	const machineSub = `(SELECT m.%s FROM cloud_machines m
		WHERE m.user_id=d.user_id AND m.machine_id=d.machine_id AND m.machine_id IS NOT NULL
		  AND m.status<>'merged'
		ORDER BY m.created_at DESC, m.id DESC LIMIT 1)`
	q := `SELECT d.id, d.device_name, COALESCE(d.platform,''), COALESCE(d.machine_id,''), d.created_at,
		(SELECT count(*) FROM device_tokens t WHERE t.device_id=d.id AND t.revoked_at IS NULL),
		COALESCE(` + strings.Replace(machineSub, "%s", "status", 1) + `,''),
		` + strings.Replace(machineSub, "%s", "last_seen_at", 1) + `
		FROM devices d
		WHERE d.user_id=? AND d.revoked_at IS NULL
		ORDER BY d.created_at, d.id`

	rows, err := s.db.Query(q, sub)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": err.Error()})
		return
	}
	defer rows.Close()

	devices := []map[string]any{}
	for rows.Next() {
		var (
			id, name, platform, machineID, createdAt, status string
			tokens                                           int
			lastSeen                                         sql.NullString
		)
		if rows.Scan(&id, &name, &platform, &machineID, &createdAt, &tokens, &status, &lastSeen) != nil {
			continue
		}
		devices = append(devices, map[string]any{
			"id": id, "device_name": name, "platform": nullStr(platform),
			"machine_id": nullStr(machineID), "status": nullStr(status),
			"created_at": createdAt, "last_seen_at": nullStr(lastSeen.String),
			"active_tokens": tokens,
		})
	}
	if err := rows.Err(); err != nil {
		writeJSON(w, 500, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"devices": devices})
}
