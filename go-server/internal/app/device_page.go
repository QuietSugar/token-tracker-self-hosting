package app

import (
	"database/sql"
	"errors"
	"html"
	"net/http"
	"strings"
)

// dashboardFor 返回本次请求应该使用的 dashboard 基地址。
//
// 官方客户端（tokentracker CLI v1.4.x）在 device-login 时会严格校验：
// 服务端返回的 verification_uri 必须与客户端自己解析出的 dashboardUrl
// **同源且路径为 /device**，否则直接报
// 「Device authorization returned a different dashboard」。
// 自托管场景没有独立的 dashboard 域名，所以默认取请求自身：
//
//	scheme://Host，其中 scheme 优先信任 X-Forwarded-Proto（反代后是 https），
//	否则看 r.TLS，最后退回 http。
//
// 显式设置 TT_DASHBOARD_URL 时以它为准（契约测试就是这么跑的）。
func (s *Server) dashboardFor(r *http.Request) string {
	if s.dashboard != "" {
		return strings.TrimSuffix(s.dashboard, "/")
	}
	if r == nil {
		return "http://127.0.0.1:8080"
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	switch p := strings.ToLower(r.Header.Get("X-Forwarded-Proto")); p {
	case "http", "https":
		scheme = p
	}
	host := r.Host
	if host == "" {
		host = "127.0.0.1:8080"
	}
	return scheme + "://" + host
}

// devicePage 是 device-login 打印出来的那个 http(s)://<host>/device 页面。
//
// 这就是官方「客户端申请 → 你在网页点批准」里那个网页。自托管没有官方 dashboard，
// 所以由服务端自己提供，默认模式（TT_DEVICE_APPROVE=page）下它承担审批，
// 整个接入过程和官方**一模一样**：命令行跑 device-login → 浏览器打开它打印的
// 链接 → 点「批准」→ 终端自己完成，不需要任何额外脚本。
//
// 页面会显示申请方的 client_info / machine_id：官方那页也告诉你"哪台机器要接入"，
// 只凭一串代码就点批准等于闭眼放行。
func (s *Server) devicePage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	code := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("user_code")))
	h := w.Header()
	h.Set("Content-Type", "text/html; charset=utf-8")
	h.Set("Cache-Control", "no-store")
	h.Set("Referrer-Policy", "no-referrer")

	var hint, state string
	switch s.deviceApprove {
	case "auto":
		hint = "本机已开启自动批准（TT_DEVICE_APPROVE=auto），终端无需任何操作。"
	case "page":
		hint = "确认下面这台机器是你自己的，然后点「批准」。"
	default:
		hint = "本机使用 JWT 审批（TT_DEVICE_APPROVE=jwt）：请运行 scripts/approve-device.sh &lt;code&gt;，或带 JWT 调 device-flow-grant。"
	}

	var body strings.Builder
	body.WriteString(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>批准这台设备 · TokenTracker 自托管</title>
<style>
:root{color-scheme:light dark}
body{font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;max-width:34rem;margin:12vh auto;padding:0 1.25rem}
h1{font-size:1.35rem;margin:0 0 .35rem}
p{color:#666;margin:.4rem 0}
dl{display:grid;grid-template-columns:auto 1fr;gap:.35rem 1rem;margin:1.2rem 0;font-size:.95rem}
dt{color:#888}dd{margin:0;font-family:ui-monospace,monospace;word-break:break-all}
code{font:600 1.1rem/1 ui-monospace,monospace;background:rgba(127,127,127,.15);padding:.35rem .55rem;border-radius:.35rem}
form{margin:1.4rem 0}
input,button{font:inherit;padding:.6rem .8rem;border-radius:.5rem;border:1px solid rgba(127,127,127,.45)}
input{width:12rem;text-transform:uppercase;letter-spacing:.08em}
button{background:#2563eb;border-color:#2563eb;color:#fff;cursor:pointer}
.ok{color:#15803d;font-weight:600}.err{color:#b91c1c;font-weight:600}
</style></head><body>
<h1>批准这台设备</h1>
<p>TokenTracker 自托管后端。批准后，发起请求的那台机器会拿到一个 device token 并开始上报用量。</p>
`)
	body.WriteString("<p>" + hint + "</p>")

	if s.deviceApprove == "auto" {
		body.WriteString(`<p class="ok">已自动批准，可以回到终端了。</p>`)
	}

	// 代码有效时把申请方信息摊开：批准前至少能看出是不是自己的机器。
	var clientInfo, machineID, status, expiresAt sql.NullString
	known := false
	if code != "" {
		err := s.db.QueryRow(`SELECT client_info,machine_id,status,expires_at FROM device_codes WHERE user_code=?`, code).
			Scan(&clientInfo, &machineID, &status, &expiresAt)
		switch {
		case err == nil:
			known = true
			body.WriteString("<dl>")
			body.WriteString("<dt>设备代码</dt><dd><code>" + html.EscapeString(code) + "</code></dd>")
			if clientInfo.String != "" {
				body.WriteString("<dt>客户端</dt><dd>" + html.EscapeString(clientInfo.String) + "</dd>")
			}
			if machineID.String != "" {
				body.WriteString("<dt>机器</dt><dd>" + html.EscapeString(machineID.String) + "</dd>")
			}
			if expiresAt.String != "" {
				body.WriteString("<dt>有效期至</dt><dd>" + html.EscapeString(expiresAt.String) + "</dd>")
			}
			body.WriteString("</dl>")
			switch status.String {
			case "approved", "used":
				state = `<p class="ok">这个代码已经批准过了，回到终端即可。</p>`
			case "expired":
				state = `<p class="err">这个代码已过期，请在终端重新跑 device-login。</p>`
			}
		case errors.Is(err, sql.ErrNoRows):
			state = `<p class="err">没有这个代码，检查一下终端打印的是不是同一串。</p>`
		}
	} else {
		body.WriteString("<p>把终端里 <code>device-login</code> 打印的代码填进来。</p>")
	}
	body.WriteString(state)

	if s.deviceApprove == "page" && (state == "" || !known) {
		body.WriteString(`<form method="post" action="/device/approve">
  <input name="user_code" value="` + html.EscapeString(code) + `" placeholder="ABCD-EFGH" autocomplete="off" autofocus>
  <button type="submit">批准</button>
</form>`)
	}
	body.WriteString(`<p><a href="/">打开用量看板</a></p></body></html>`)
	_, _ = w.Write([]byte(body.String()))
}

// deviceApproveHTTP 处理 /device 表单提交（TT_DEVICE_APPROVE=page，默认模式）。
//
// 安全边界（明确写在这里，避免以后误以为它"有认证"）：
// 这个端点**没有登录**，等于「任何能访问本服务、并且知道 user_code 的人都能把设备
// 接进 owner 账户」。user_code 只在发起申请的那台机器的终端里出现，是这套流程里
// 唯一的凭据——官方 device flow 也是同一个模型，区别只是官方那页还要你先登录。
// 局域网自用定位下这是有意的取舍；要审批边界就改用 TT_DEVICE_APPROVE=jwt。
func (s *Server) deviceApproveHTTP(w http.ResponseWriter, r *http.Request) {
	if s.deviceApprove != "page" {
		http.Error(w, "device approval page is disabled (TT_DEVICE_APPROVE="+s.deviceApprove+")", http.StatusForbidden)
		return
	}
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	code := r.FormValue("user_code")
	owner, err := s.ensureOwner("device")
	if err != nil {
		http.Error(w, "批准失败："+err.Error(), http.StatusInternalServerError)
		return
	}
	if _, err := s.approveDeviceCode(owner, code); err != nil {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`<!doctype html><meta charset="utf-8"><body style="font:16px/1.6 system-ui;max-width:34rem;margin:12vh auto;padding:0 1.25rem">
<h1 style="font-size:1.35rem;color:#b91c1c">批准失败</h1><p>` + html.EscapeString(err.Error()) + `</p>
<p><a href="/device">返回</a></p></body>`))
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(`<!doctype html><meta charset="utf-8"><body style="font:16px/1.6 system-ui;max-width:34rem;margin:12vh auto;padding:0 1.25rem">
<h1 style="font-size:1.35rem;color:#15803d">已批准</h1><p>回到终端，<code>device-login</code> 会在一轮轮询内完成。</p>
<p><a href="/device">再接一台</a> · <a href="/">打开用量看板</a></p></body>`))
}
