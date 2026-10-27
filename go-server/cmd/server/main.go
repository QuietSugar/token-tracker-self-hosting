// TokenTracker 自托管后端（Go）。同一份代码支持 SQLite 与 PostgreSQL。
//
// 启动（SQLite，默认）：
//
//	TT_DATABASE_PATH=/tmp/tt.db TT_JWT_SECRET=... ./tokentracker-server
//
// 启动（PostgreSQL）：
//
//	TT_DATABASE_URL='postgres://tt:tt@127.0.0.1:5432/tt?sslmode=disable' \
//	  TT_JWT_SECRET=... ./tokentracker-server
//
// 端点见 internal/app/app.go；引擎差异见 docs/go-postgres.md。
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

	"path/filepath"

	"github.com/QuietSugar/tokentracker-selfhost-go/internal/app"
	"github.com/QuietSugar/tokentracker-selfhost-go/internal/store"
	_ "github.com/lib/pq"  // registers the "postgres" driver
	_ "modernc.org/sqlite" // registers the "sqlite" driver (CGO=0)
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
	// SQLite DB / WAL / SHM files may contain the full usage history and device identities.
	// Default to owner-only permissions even if the host's umask is permissive.
	// (No-op for PostgreSQL, which stores data in the server's data directory.)
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

	log.Printf("TokenTracker Go server listening on %s (engine=%s, dsn=%s)",
		addr, db.Dialect(), describeDSN(db.Dialect(), cfg.DSN))

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

// databaseConfig 解析引擎与连接串：
//
//	TT_DATABASE_URL     postgres://... 或 SQLite 文件路径（优先）
//	TT_DATABASE_PATH    旧变量，等价于只给 SQLite 文件路径
//	TT_DATABASE_DRIVER  显式指定 sqlite / postgres（默认按 URL scheme 推断）
//	TT_POSTGRES_SCHEMA  仅 PostgreSQL：把表建在指定 schema 里（测试/多实例隔离）
//	TT_POSTGRES_SCHEMA_EPHEMERAL=true  退出时 DROP SCHEMA CASCADE（配合上一项）
func databaseConfig() (store.Config, error) {
	dsn := os.Getenv("TT_DATABASE_URL")
	path := os.Getenv("TT_DATABASE_PATH")
	if dsn != "" && path != "" {
		log.Printf("both TT_DATABASE_URL and TT_DATABASE_PATH are set; using TT_DATABASE_URL")
	}
	if dsn == "" {
		dsn = path
	}
	if dsn == "" {
		dsn = "tokentracker.db"
	}
	dialect, err := store.ParseDialect(os.Getenv("TT_DATABASE_DRIVER"))
	if err != nil {
		return store.Config{}, err
	}
	cfg := store.Config{Dialect: dialect, DSN: dsn}
	if schema := os.Getenv("TT_POSTGRES_SCHEMA"); schema != "" {
		cfg.Schema = schema
		cfg.DropSchemaOnClose = strings.EqualFold(os.Getenv("TT_POSTGRES_SCHEMA_EPHEMERAL"), "true")
	}
	if d, err := store.DetectDialect(dsn); err == nil && dialect != "" && dialect != d && dsn != "tokentracker.db" {
		// 只有显式给出 DSN 时才可能矛盾；显式 driver 优先，但要让运维看到。
		log.Printf("warning: TT_DATABASE_DRIVER=%s overrides DSN-inferred engine %s", dialect, d)
	}
	return cfg, nil
}

// describeDSN 隐藏 DSN 里的密码，日志里只出现安全形态。
func describeDSN(d store.Dialect, dsn string) string {
	if d == store.Postgres {
		if i := strings.Index(dsn, "://"); i >= 0 {
			rest := dsn[i+3:]
			if at := strings.LastIndex(rest, "@"); at >= 0 {
				if colon := strings.Index(rest[:at], ":"); colon >= 0 {
					rest = rest[:colon] + ":***" + rest[at:]
				}
			}
			return "postgres://" + rest
		}
		return "postgres(key=value)"
	}
	abs, err := filepath.Abs(dsn)
	if err != nil {
		return dsn
	}
	return abs
}
