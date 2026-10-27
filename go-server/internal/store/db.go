package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// driverName 是 database/sql 的驱动注册名（github.com/lib/pq）。
// 存储层只支持 PostgreSQL；SQLite 支持已于 2026-10 移除（归档 tag `sqlite-final`）。
const driverName = "postgres"

// Config 是打开存储层所需的全部参数。
type Config struct {
	// DSN 是 PostgreSQL 连接串：URL（postgres://…）或 lib/pq 的 key=value 形式。
	DSN string
	// Schema 把表建在指定 schema 里（启动时 CREATE SCHEMA IF NOT EXISTS，并把
	// search_path 限定到该 schema）。给测试/多实例共用同一个数据库做隔离，
	// 留空则用默认 search_path。
	Schema string
	// DropSchemaOnClose 在 Close 时 DROP SCHEMA ... CASCADE（仅配合 Schema 使用）。
	DropSchemaOnClose bool
	// ConnectTimeout 是等待数据库就绪的最长时间（容器启动顺序不定的场景，默认 30s）。
	ConnectTimeout time.Duration
	// MaxOpenConns 覆盖默认连接数（默认 16）。
	MaxOpenConns int
}

// DB 是 database/sql 的薄包装：业务代码写 `?` 占位符，这里统一改写成 `$n`。
type DB struct {
	sql    *sql.DB
	schema string
	drop   bool
}

// ValidateDSN 校验连接串形态。
//
// 历史版本接受 SQLite 文件路径（`tokentracker.db`、`/var/lib/tt/tt.db`、`file:…`）。
// 这个能力已移除，所以这里对被误用的路径给出**迁移提示**，而不是含糊的
// "unsupported engine"——照着旧文档操作的人需要知道该改什么。
func ValidateDSN(dsn string) error {
	l := strings.ToLower(strings.TrimSpace(dsn))
	switch {
	case l == "":
		return errors.New("TT_DATABASE_URL is required, e.g. postgres://tokentracker:secret@127.0.0.1:5432/tokentracker?sslmode=disable")
	case strings.HasPrefix(l, "postgres://"), strings.HasPrefix(l, "postgresql://"):
		return nil
	case strings.HasPrefix(l, "host="), strings.HasPrefix(l, "user="), strings.Contains(l, " dbname="):
		return nil // lib/pq 的 key=value 形式
	case strings.Contains(l, "://"):
		return fmt.Errorf("unsupported database DSN scheme %q: this server only supports PostgreSQL (postgres://…)", strings.SplitN(l, "://", 2)[0]+"://")
	}
	return fmt.Errorf("SQLite support was removed (archived at tag `sqlite-final`); set TT_DATABASE_URL to a PostgreSQL DSN such as postgres://tokentracker:secret@127.0.0.1:5432/tokentracker?sslmode=disable (got %q)", dsn)
}

// Open 打开数据库、校验连通性并（可选）准备 schema。
func Open(ctx context.Context, cfg Config) (*DB, error) {
	if err := ValidateDSN(cfg.DSN); err != nil {
		return nil, err
	}
	target := cfg.DSN

	if cfg.Schema != "" {
		if err := validIdentifier(cfg.Schema); err != nil {
			return nil, err
		}
		// 先在不带 search_path 的连接上建 schema，再带 search_path 打开业务连接。
		admin, err := sql.Open(driverName, target)
		if err != nil {
			return nil, err
		}
		if err := waitReady(ctx, admin, connectTimeout(cfg)); err != nil {
			admin.Close()
			return nil, err
		}
		_, err = admin.ExecContext(ctx, "CREATE SCHEMA IF NOT EXISTS "+cfg.Schema)
		admin.Close()
		if err != nil {
			return nil, fmt.Errorf("create schema: %w", err)
		}
		if target, err = withSearchPath(target, cfg.Schema); err != nil {
			return nil, err
		}
	}

	sqlDB, err := sql.Open(driverName, target)
	if err != nil {
		return nil, err
	}
	max := cfg.MaxOpenConns
	if max <= 0 {
		max = 16
	}
	sqlDB.SetMaxOpenConns(max)
	sqlDB.SetMaxIdleConns(max / 4)
	sqlDB.SetConnMaxLifetime(30 * time.Minute)
	sqlDB.SetConnMaxIdleTime(5 * time.Minute)
	if err := waitReady(ctx, sqlDB, connectTimeout(cfg)); err != nil {
		sqlDB.Close()
		return nil, err
	}
	return &DB{sql: sqlDB, schema: cfg.Schema, drop: cfg.DropSchemaOnClose}, nil
}

// connectTimeout：允许容器先启动应用，默认最多等 30s。
func connectTimeout(cfg Config) time.Duration {
	if cfg.ConnectTimeout > 0 {
		return cfg.ConnectTimeout
	}
	return 30 * time.Second
}

// waitReady 轮询 Ping 直到成功或超时（PostgreSQL 容器可能比应用晚就绪）。
func waitReady(ctx context.Context, db *sql.DB, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for {
		pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		err := db.PingContext(pingCtx)
		cancel()
		if err == nil {
			return nil
		}
		if timeout <= 0 || time.Now().After(deadline) {
			return fmt.Errorf("database not reachable: %w", err)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}
	}
}

var identifierRE = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,62}$`)

func validIdentifier(s string) error {
	if !identifierRE.MatchString(s) {
		return fmt.Errorf("invalid schema name %q (want [A-Za-z_][A-Za-z0-9_]*)", s)
	}
	return nil
}

// withSearchPath 把 search_path 追加到 PostgreSQL 连接串（URL 或 key=value 两种写法）。
// lib/pq 会把未知 query 参数当作会话 GUC 传给服务端。
func withSearchPath(dsn, schema string) (string, error) {
	if strings.Contains(dsn, "://") {
		u, err := url.Parse(dsn)
		if err != nil {
			return "", fmt.Errorf("parse postgres DSN: %w", err)
		}
		q := u.Query()
		q.Set("search_path", schema)
		u.RawQuery = q.Encode()
		return u.String(), nil
	}
	return dsn + " search_path=" + schema, nil
}

// SQLDB 暴露底层 *sql.DB（仅用于本包之外的底层操作，例如健康检查）。
// 注意：绕过包装层就没有占位符改写，业务 SQL 不要走这里。
func (d *DB) SQLDB() *sql.DB { return d.sql }

// InsertIgnore 渲染「主键冲突时忽略」的幂等插入。
// head 形如 `auth_users(id,email) VALUES(?,?)`（不含 INSERT 关键字）。
func (d *DB) InsertIgnore(head string) string {
	return "INSERT INTO " + head + " ON CONFLICT DO NOTHING"
}

func (d *DB) Exec(query string, args ...any) (sql.Result, error) {
	return d.sql.Exec(rewritePlaceholders(query), args...)
}

func (d *DB) ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error) {
	return d.sql.ExecContext(ctx, rewritePlaceholders(query), args...)
}

func (d *DB) Query(query string, args ...any) (*sql.Rows, error) {
	return d.sql.Query(rewritePlaceholders(query), args...)
}

func (d *DB) QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	return d.sql.QueryContext(ctx, rewritePlaceholders(query), args...)
}

func (d *DB) QueryRow(query string, args ...any) *sql.Row {
	return d.sql.QueryRow(rewritePlaceholders(query), args...)
}

func (d *DB) QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row {
	return d.sql.QueryRowContext(ctx, rewritePlaceholders(query), args...)
}

func (d *DB) Begin() (*Tx, error) { return d.BeginTx(context.Background(), nil) }

func (d *DB) BeginTx(ctx context.Context, opts *sql.TxOptions) (*Tx, error) {
	tx, err := d.sql.BeginTx(ctx, opts)
	if err != nil {
		return nil, err
	}
	return &Tx{tx: tx}, nil
}

func (d *DB) PingContext(ctx context.Context) error { return d.sql.PingContext(ctx) }

// Close 关闭连接池；配置了 DropSchemaOnClose 时先删除临时 schema。
func (d *DB) Close() error {
	if d.drop && d.schema != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		_, _ = d.sql.ExecContext(ctx, "DROP SCHEMA IF EXISTS "+d.schema+" CASCADE")
		cancel()
	}
	return d.sql.Close()
}

// Tx 是带占位符改写的事务包装。
type Tx struct {
	tx *sql.Tx
}

func (t *Tx) Exec(query string, args ...any) (sql.Result, error) {
	return t.tx.Exec(rewritePlaceholders(query), args...)
}

func (t *Tx) ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error) {
	return t.tx.ExecContext(ctx, rewritePlaceholders(query), args...)
}

func (t *Tx) Query(query string, args ...any) (*sql.Rows, error) {
	return t.tx.Query(rewritePlaceholders(query), args...)
}

func (t *Tx) QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	return t.tx.QueryContext(ctx, rewritePlaceholders(query), args...)
}

func (t *Tx) QueryRow(query string, args ...any) *sql.Row {
	return t.tx.QueryRow(rewritePlaceholders(query), args...)
}

func (t *Tx) QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row {
	return t.tx.QueryRowContext(ctx, rewritePlaceholders(query), args...)
}

func (t *Tx) Commit() error   { return t.tx.Commit() }
func (t *Tx) Rollback() error { return t.tx.Rollback() }
