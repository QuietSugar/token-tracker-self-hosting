package app

import (
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
// 为什么必须自己提供：客户端会把 verification_uri 原样展示给用户，
// 自托管没有官方 dashboard，这个 URL 原本是死链。
// 页面只做一件事：确认一个 user_code 属于「这台机器要接入」，然后批准。
func (s *Server) devicePage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	code := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("user_code")))
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")

	var hint string
	switch s.deviceApprove {
	case "auto":
		hint = "本机已开启自动批准（TT_DEVICE_APPROVE=auto），命令行无需任何操作。"
	case "page":
		hint = "把下面的代码填进首页的输入框，然后点「批准」。"
	default:
		hint = "本机使用 JWT 审批：请运行 ./scripts/approve-device.sh &lt;code&gt;（或带 JWT 调 device-flow-grant）。"
	}

	body := `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>批准这台设备 · TokenTracker 自托管</title>
<style>
:root{color-scheme:light dark}
body{font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;max-width:34rem;margin:12vh auto;padding:0 1.25rem}
h1{font-size:1.35rem;margin:0 0 .35rem}
p{color:#666;margin:.4rem 0}
code{font:600 1.1rem/1 ui-monospace,monospace;background:rgba(127,127,127,.15);padding:.35rem .55rem;border-radius:.35rem}
form{margin:1.4rem 0}
input,button{font:inherit;padding:.6rem .8rem;border-radius:.5rem;border:1px solid rgba(127,127,127,.45)}
input{width:12rem;text-transform:uppercase;letter-spacing:.08em}
button{background:#2563eb;border-color:#2563eb;color:#fff;cursor:pointer}
.ok{color:#15803d;font-weight:600}
.err{color:#b91c1c;font-weight:600}
</style></head><body>
<h1>批准这台设备</h1>
<p>TokenTracker 自托管后端。批准后，发起请求的那台机器会拿到一个 device token 并开始上报用量。</p>
`
	body += "<p>" + hint + "</p>"
	if s.deviceApprove == "auto" {
		body += `<p class="ok">` + "已自动批准，可以回到终端了。" + `</p>`
	}
	if code != "" {
		body += "<p>设备代码：<code>" + html.EscapeString(code) + "</code></p>"
	}
	if s.deviceApprove == "page" {
		body += `<form method="post" action="/device/approve">
  <input name="user_code" value="` + html.EscapeString(code) + `" placeholder="ABCD-EFGH" autocomplete="off" autofocus>
  <button type="submit">批准</button>
</form>`
	}
	body += "</body></html>"
	_, _ = w.Write([]byte(body))
}

// deviceApproveHTTP 处理 /device 表单提交（TT_DEVICE_APPROVE=page 时才有实际作用）。
//
// 安全边界（明确写在这里，避免以后误以为它"有认证"）：
// 这个端点**没有认证**，等于「任何能访问本服务的人都能把一台设备接进默认账户」。
// 它只在 TT_DEVICE_APPROVE=page 时启用；默认（jwt）直接 403。
// 局域网自用的定位下这是有意的取舍，公网暴露时不要开。
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
	if _, err := s.approveDeviceCode(s.defaultSub, code); err != nil {
		http.Error(w, "批准失败："+err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(`<!doctype html><meta charset="utf-8"><body style="font:16px/1.6 system-ui;max-width:34rem;margin:12vh auto;padding:0 1.25rem">
<h1 style="font-size:1.35rem">已批准</h1><p>回到终端，<code>device-login</code> 会在一轮轮询内完成。</p>
<p><a href="/device">再来一台</a></p></body>`))
}
