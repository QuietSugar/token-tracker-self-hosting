package app

import (
	"log"
	"net/http"
	"os"
	"strings"
)

// accessLogEnabled 是排查"浏览器到底把请求发到哪儿了"的开关。
//
// 为什么需要它：自托管部署常见的一类问题是**中间那一层**（反向代理、SSO、
// 内网网关、预览隧道）把 `Authorization` 头吃掉或改写了，表现就是"密码能登录、
// 一读数据就 401"。默认日志只记启动那一行，看不出来。设 TT_ACCESS_LOG=true
// 后每个请求记一行：方法、路径、状态码、有没有带 Authorization、来源 Origin。
//
// 默认关闭：内网自用不需要长期留访问日志（而且这属于用户自己该决定的事）。
func accessLogEnabled() bool {
	return strings.EqualFold(os.Getenv("TT_ACCESS_LOG"), "true") ||
		os.Getenv("TT_ACCESS_LOG") == "1"
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func (s *Server) withAccessLog(next http.Handler) http.Handler {
	if !accessLogEnabled() {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec := &statusRecorder{ResponseWriter: w, status: 200}
		next.ServeHTTP(rec, r)
		auth := "no"
		if strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
			auth = "yes"
		} else if r.Header.Get("x-tokentracker-device-token-hash") != "" {
			auth = "device-hash"
		}
		origin := r.Header.Get("Origin")
		if origin == "" {
			origin = "-"
		}
		log.Printf("access: %s %s %d auth=%s origin=%s ua=%q",
			r.Method, r.URL.Path, rec.status, auth, origin, clip(r.UserAgent(), 60))
	})
}

func clip(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
