// TokenTracker 自托管后端（Go + SQLite 垂直切片）。
//
// 启动：
//
//	TT_DATABASE_PATH=/tmp/tt.db TT_LISTEN_ADDR=127.0.0.1:8080 ./tokentracker-server
//
// 端点见 internal/app/app.go。
package main

import (
	"context"
	"database/sql"
	"log"
	"net/http"
	"os"
	"syscall"
	_ "time/tzdata" // Embed IANA time-zone database; runtime image stays package-free.

	"github.com/QuietSugar/tokentracker-selfhost-go/internal/app"
	"github.com/QuietSugar/tokentracker-selfhost-go/internal/store"
	_ "modernc.org/sqlite"
)

// Build metadata is injected by Docker -ldflags.
var version = "dev"
var vcsRef = "unknown"

func main() {
	// SQLite DB / WAL / SHM files may contain the full usage history and device identities.
	// Default to owner-only permissions even if the host's umask is permissive.
	syscall.Umask(0077)
	secret := os.Getenv("TT_JWT_SECRET")
	if len(secret) < 32 {
		log.Fatal("TT_JWT_SECRET is required and must be at least 32 bytes; refusing insecure default")
	}
	dbPath := os.Getenv("TT_DATABASE_PATH")
	if dbPath == "" {
		dbPath = "tokentracker.db"
	}
	addr := os.Getenv("TT_LISTEN_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8080"
	}

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1) // SQLite 单写者；Go 层 mutex 负责串行化
	if err := store.Install(context.Background(), db); err != nil {
		log.Fatalf("install: %v", err)
	}

	srv := app.New(db)
	log.Printf("TokenTracker Go/SQLite server listening on %s (db=%s)", addr, dbPath)
	if err := http.ListenAndServe(addr, srv.Handler()); err != nil {
		log.Fatal(err)
	}
}
