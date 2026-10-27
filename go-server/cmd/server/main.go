// TokenTracker 自托管后端（Go）。只支持 PostgreSQL。
//
// 启动：
//
//	TT_DATABASE_URL='postgres://tt:tt@127.0.0.1:5432/tt?sslmode=disable' \
//	  TT_JWT_SECRET=... ./tokentracker-server
//
// 端点见 internal/app/app.go；部署与运维见 go-server/README.md。
// （SQLite 支持已移除，归档在 tag `sqlite-final`。）
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
	_ "time/tzdata" // Embed IANA time-zone database; runtime image stays package-free.

	"github.com/QuietSugar/tokentracker-selfhost-go/internal/app"
	"github.com/QuietSugar/tokentracker-selfhost-go/internal/store"
	_ "github.com/lib/pq"  // registers the "postgres" driver
)

// Build metadata is injected by Docker -ldflags.
var version = "dev"
var vcsRef = "unknown"

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	// 数据都在 PostgreSQL 里，进程本身不落盘；保留 0077 只是兜底：
	// 万一将来写了临时文件/日志，也不会因为宿主 umask 宽松而变成 world-readable。
	syscall.Umask(0077)

	secret := os.Getenv("TT_JWT_SECRET")
	if len(secret) < 32 {
		return errors.New("TT_JWT_SECRET is required and must be at least 32 bytes; refusing insecure default")
	}
	addr := os.Getenv("TT_LISTEN_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8080"
	}
	cfg, err := databaseConfig()
	if err != nil {
		return err
	}

	ctx := context.Background()
	db, err := store.Open(ctx, cfg)
	if err != nil {
		return err
	}
	defer db.Close()
	if err := store.Install(ctx, db); err != nil {
		return err
	}

	srv := app.New(db)
	// 可选：用 TT_AUTH_EMAIL/TT_AUTH_PASSWORD 引导 owner 账户（官方 dashboard/客户端能直接登录）。
	if created, email, err := srv.EnsureAuthBootstrap(); err != nil {
		return err
	} else if created {
		log.Printf("auth: created owner account %s", email)
	} else if email != "" {
		log.Printf("auth: owner account %s already exists (password left untouched)", email)
	}
	httpSrv := &http.Server{
		Addr:              addr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	// engine=postgres 是镜像 smoke 的断言锚点，不要改这段字面量。
	log.Printf("TokenTracker Go server listening on %s (engine=postgres, dsn=%s)",
		addr, describeDSN(cfg.DSN))

	errCh := make(chan error, 1)
	go func() {
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	select {
	case err := <-errCh:
		return err
	case sig := <-stop:
		log.Printf("received %s, shutting down", sig)
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return httpSrv.Shutdown(shutdownCtx)
}

// databaseConfig 解析连接串：
//
//	TT_DATABASE_URL    PostgreSQL 连接串（唯一必填项，没有默认值）
//	TT_POSTGRES_SCHEMA 把表建在指定 schema 里（测试/多实例隔离）
//	TT_POSTGRES_SCHEMA_EPHEMERAL=true  退出时 DROP SCHEMA CASCADE（配合上一项）
//
// 旧变量 TT_DATABASE_PATH / TT_DATABASE_DRIVER 已随 SQLite 支持一起移除；
// 如果还有人设着，启动时提示一句而不是静默忽略。
func databaseConfig() (store.Config, error) {
	for _, legacy := range []string{"TT_DATABASE_PATH", "TT_DATABASE_DRIVER"} {
		if os.Getenv(legacy) != "" {
			log.Printf("warning: %s is no longer supported (SQLite removed); set TT_DATABASE_URL to a postgres:// DSN instead", legacy)
		}
	}
	dsn := os.Getenv("TT_DATABASE_URL")
	cfg := store.Config{DSN: dsn}
	if err := store.ValidateDSN(dsn); err != nil {
		return store.Config{}, err
	}
	if schema := os.Getenv("TT_POSTGRES_SCHEMA"); schema != "" {
		cfg.Schema = schema
		cfg.DropSchemaOnClose = strings.EqualFold(os.Getenv("TT_POSTGRES_SCHEMA_EPHEMERAL"), "true")
	}
	return cfg, nil
}

// describeDSN 隐藏 DSN 里的密码，日志里只出现安全形态。
func describeDSN(dsn string) string {
	if i := strings.Index(dsn, "://"); i >= 0 {
		rest := dsn[i+3:]
		if at := strings.LastIndex(rest, "@"); at >= 0 {
			if colon := strings.Index(rest[:at], ":"); colon >= 0 {
				rest = rest[:colon] + ":***" + rest[at:]
			}
		}
		return dsn[:i+3] + rest
	}
	return "postgres(key=value)"
}
