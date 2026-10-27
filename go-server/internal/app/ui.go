package app

import (
	_ "embed"
	"net/http"
	"strings"
)

// homeHTML 是 GET / 的内置只读看板。
//
// 为什么内置而不是另起前端工程：这个项目的定位是**内网自用**，用户装完
// 容器后最直接的动作就是浏览器打开 http://<host>:8080/。有一个页面总比
// 返回裸 404 JSON 强；但它必须是零构建、零外部请求（内网经常没有公网出口，
// 引 CDN 只会白屏），所以整个看板就是一个 HTML 文件——样式、脚本全内联，
// `go:embed` 打进二进制。
//
// 安全性：页面只调同源的 /api/auth/sessions 与 /functions/tokentracker-account-*，
// 不发第三方请求、不引外部字体、不写任何数据（只读）。token 放 sessionStorage，
// 关闭标签页即失效，不落盘、不进 cookie。
//
//go:embed web/index.html
var homeHTML []byte

// root 处理 "/"：
//   - 精确的 "/"（或 HEAD）→ 只读看板；
//   - 其它未注册路径 → 保持原来的 404 JSON（客户端与脚本依赖这个形状）。
func (s *Server) root(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		writeJSON(w, 404, map[string]any{"error": "not found"})
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		writeJSON(w, 405, map[string]any{"error": "method not allowed"})
		return
	}
	h := w.Header()
	h.Set("Content-Type", "text/html; charset=utf-8")
	// 看板里可能带有部署细节（版本、账号提示），不要被中间缓存留存。
	h.Set("Cache-Control", "no-store")
	h.Set("X-Content-Type-Options", "nosniff")
	// 零外部资源：任何外联都视为 bug，用 CSP 直接堵死，顺带防注入。
	// 不写 frame-ancestors：有些人会把这个页面放进内网门户/反向代理的 iframe 里看，
	// 而它是只读的、没有跨站写操作，限制嵌入没有收益。
	h.Set("Content-Security-Policy",
		"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; "+
			"img-src data:; connect-src 'self'; form-action 'self'; base-uri 'none'")
	h.Set("Referrer-Policy", "no-referrer")
	if r.Method == http.MethodHead {
		return
	}
	_, _ = w.Write(homeHTML)
}

// buildVersion / buildRef 由 cmd/server 用 -ldflags 注入的版本信息填充，
// 供 /health 暴露（镜像排查时第一件事就是问"你跑的是哪个版本"）。
var (
	buildVersion = "dev"
	buildRef     = "unknown"
)

// SetBuildInfo 只应在启动时调用一次。
func SetBuildInfo(version, ref string) {
	if version != "" {
		buildVersion = version
	}
	if ref != "" {
		buildRef = ref
	}
}

// health 是给编排/运维用的探针：ok 字段保持原样（镜像 smoke 与脚本都在断言它），
// 额外暴露 version/engine 便于"容器里到底是哪个镜像"的排查。
func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{
		"ok":      true,
		"engine":  "postgres",
		"version": buildVersion,
		"ref":     buildRef,
	})
}

// homeTitle 只用于测试/日志，避免把 HTML 里的界面文案散落在 Go 代码里。
func homeTitle() string {
	const marker = "<title>"
	s := string(homeHTML)
	i := strings.Index(s, marker)
	if i < 0 {
		return ""
	}
	rest := s[i+len(marker):]
	if j := strings.Index(rest, "</title>"); j >= 0 {
		return rest[:j]
	}
	return ""
}
