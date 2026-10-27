package store

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// Config 是打开存储层所需的全部参数。
type Config struct {
	// Dialect 为空时由 DSN 推断（postgres:// => PostgreSQL，其余按 SQLite 文件处理）。
	Dialect Dialect
	// DSN：SQLite 是文件路径（或 file: URI）；PostgreSQL 是 URL 或 key=value 连接串。
	DSN string
	// Schema 仅用于 PostgreSQL：启动时 CREATE SCHEMA IF NOT EXISTS 并把 search_path
	// 限定到该 schema。给测试/多实例共用同一个数据库做隔离，留空则用默认 search_path。
	Schema string
	// DropSchemaOnClose 在 Close 时 DROP SCHEMA ... CASCADE（仅配合 Schema 使用）。
	DropSchemaOnClose bool
	// ConnectTimeout 是等待数据库就绪的最长时间（容器启动顺序不定的场景）。
	// 0 表示 PostgreSQL 等 30s、SQLite 只尝试一次。
	ConnectTimeout time.Duration
	// MaxOpenConns 覆盖默认连接数（SQLite 固定 1：单写者）。
	MaxOpenConns int
}

// DB 是带方言改写的 database/sql 包装：
// 业务代码只写 `?` 占位符，这里按引擎改写成 `$n` 或保持 `?`。
type DB struct {
	sql     *sql.DB
	dialect Dialect
	schema  string
	drop    bool
}

// Open 打开数据库、校验连通性并（可选）准备 PostgreSQL schema。
func Open(ctx context.Context, cfg Config) (*DB, error) {
	dialect := cfg.Dialect
	if dialect == "" {
		d, err := DetectDialect(cfg.DSN)
		if err != nil {
			return nil, err
		}
		dialect = d
	}
	if dialect != SQLite && dialect != Postgres {
		return nil, fmt.Errorf("unsupported database engine %q", dialect)
	}
	driver := dialect.DriverName()
	target := cfg.DSN

	if cfg.Schema != "" {
		if dialect != Postgres {
			return nil, fmt.Errorf("store: Config.Schema is PostgreSQL-only")
		}
		if err := validIdentifier(cfg.Schema); err != nil {
			return nil, err
		}
		// 先在不带 search_path 的连接上建 schema，再带 search_path 打开业务连接。
		admin, err := sql.Open(driver, target)
		if err != nil {
			return nil, err
		}
		if err := waitReady(ctx, admin, connectTimeout(cfg, dialect)); err != nil {
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

	sqlDB, err := sql.Open(driver, target)
	if err != nil {
		return nil, err
	}
	if dialect == SQLite {
		// SQLite 单写者：单连接 + 应用层 mutex 串行化（与迁移前的行为一致）。
		sqlDB.SetMaxOpenConns(1)
	} else {
		max := cfg.MaxOpenConns
		if max <= 0 {
			max = 16
		}
		sqlDB.SetMaxOpenConns(max)
		sqlDB.SetMaxIdleConns(max / 4)
		sqlDB.SetConnMaxLifetime(30 * time.Minute)
		sqlDB.SetConnMaxIdleTime(5 * time.Minute)
	}
	if err := waitReady(ctx, sqlDB, connectTimeout(cfg, dialect)); err != nil {
		sqlDB.Close()
		return nil, err
	}
	return &DB{sql: sqlDB, dialect: dialect, schema: cfg.Schema, drop: cfg.DropSchemaOnClose}, nil
}

// connectTimeout：PostgreSQL 允许容器先启动应用，默认最多等 30s；SQLite 只试一次。
func connectTimeout(cfg Config, d Dialect) time.Duration {
	if cfg.ConnectTimeout > 0 {
		return cfg.ConnectTimeout
	}
	if d == Postgres {
		return 30 * time.Second
	}
	return 0
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

// Dialect 返回该连接的引擎。
func (d *DB) Dialect() Dialect { return d.dialect }

// SQLDB 暴露底层 *sql.DB（仅用于本包之外的底层操作，例如健康检查）。
// 注意：绕过包装层就没有方言改写了，业务 SQL 不要走这里。
func (d *DB) SQLDB() *sql.DB { return d.sql }

// InsertIgnore 渲染「主键冲突时忽略」的幂等插入。
// head 形如 `auth_users(id,email) VALUES(?,?)`（不含 INSERT 关键字）。
func (d *DB) InsertIgnore(head string) string {
	if d.dialect == Postgres {
		return "INSERT INTO " + head + " ON CONFLICT DO NOTHING"
	}
	return "INSERT OR IGNORE INTO " + head
}

func (d *DB) Exec(query string, args ...any) (sql.Result, error) {
	return d.sql.Exec(bind(d.dialect, query), args...)
}

func (d *DB) ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error) {
	return d.sql.ExecContext(ctx, bind(d.dialect, query), args...)
}

func (d *DB) Query(query string, args ...any) (*sql.Rows, error) {
	return d.sql.Query(bind(d.dialect, query), args...)
}

func (d *DB) QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	return d.sql.QueryContext(ctx, bind(d.dialect, query), args...)
}

func (d *DB) QueryRow(query string, args ...any) *sql.Row {
	return d.sql.QueryRow(bind(d.dialect, query), args...)
}

func (d *DB) QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row {
	return d.sql.QueryRowContext(ctx, bind(d.dialect, query), args...)
}

func (d *DB) Begin() (*Tx, error) { return d.BeginTx(context.Background(), nil) }

func (d *DB) BeginTx(ctx context.Context, opts *sql.TxOptions) (*Tx, error) {
	tx, err := d.sql.BeginTx(ctx, opts)
	if err != nil {
		return nil, err
	}
	return &Tx{tx: tx, dialect: d.dialect}, nil
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

// Tx 是带方言改写的事务包装。
type Tx struct {
	tx      *sql.Tx
	dialect Dialect
}

func (t *Tx) Exec(query string, args ...any) (sql.Result, error) {
	return t.tx.Exec(bind(t.dialect, query), args...)
}

func (t *Tx) ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error) {
	return t.tx.ExecContext(ctx, bind(t.dialect, query), args...)
}

func (t *Tx) Query(query string, args ...any) (*sql.Rows, error) {
	return t.tx.Query(bind(t.dialect, query), args...)
}

func (t *Tx) QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	return t.tx.QueryContext(ctx, bind(t.dialect, query), args...)
}

func (t *Tx) QueryRow(query string, args ...any) *sql.Row {
	return t.tx.QueryRow(bind(t.dialect, query), args...)
}

func (t *Tx) QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row {
	return t.tx.QueryRowContext(ctx, bind(t.dialect, query), args...)
}

func (t *Tx) Commit() error   { return t.tx.Commit() }
func (t *Tx) Rollback() error { return t.tx.Rollback() }
