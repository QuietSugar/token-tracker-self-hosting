package store

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"

	_ "github.com/lib/pq"
	_ "modernc.org/sqlite"
)

// testDB 返回隔离的存储层实例：默认临时 SQLite 文件；
// 设置 TT_TEST_DATABASE_URL 时使用真实 PostgreSQL 的独立 schema。
func testDB(t *testing.T) *DB {
	t.Helper()
	ctx := context.Background()
	if dsn := os.Getenv("TT_TEST_DATABASE_URL"); dsn != "" {
		db, err := Open(ctx, Config{
			Dialect:           Postgres,
			DSN:               dsn,
			Schema:            "tt_store_" + strings.ToLower(randHex(6)),
			DropSchemaOnClose: true,
		})
		if err != nil {
			t.Fatalf("open postgres: %v", err)
		}
		t.Cleanup(func() { _ = db.Close() })
		return db
	}
	db, err := Open(ctx, Config{DSN: filepath.Join(t.TempDir(), "test.db")})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func randHex(n int) string {
	b := make([]byte, (n+1)/2)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)[:n]
}

func TestInstallIsIdempotentAndUsesOwnMigrationLedger(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	for i := 0; i < 2; i++ { // 第二次安装必须幂等
		if err := Install(ctx, db); err != nil {
			t.Fatalf("install #%d: %v", i+1, err)
		}
	}
	var version, count int
	var checksum string
	if err := db.QueryRow(`SELECT max(version),count(*),max(checksum) FROM schema_migrations`).Scan(&version, &count, &checksum); err != nil {
		t.Fatal(err)
	}
	if version != SchemaVersion || count != 1 || len(checksum) != 64 {
		t.Fatalf("schema migration ledger = version %d/count %d/checksum len %d, want %d/1/64",
			version, count, len(checksum), SchemaVersion)
	}
	if checksum != SchemaChecksum(db.Dialect()) {
		t.Fatalf("ledger checksum %s != rendered schema checksum %s", checksum, SchemaChecksum(db.Dialect()))
	}
	if _, err := db.Query(`SELECT * FROM self_host_installations`); err == nil {
		t.Fatal("must not fabricate the PostgreSQL-only 15-step migration ledger")
	}
}

func TestInstallRefusesSchemaChecksumDrift(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	if err := Install(ctx, db); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE schema_migrations SET checksum='tampered' WHERE version=?`, SchemaVersion); err != nil {
		t.Fatal(err)
	}
	if err := Install(ctx, db); err == nil {
		t.Fatal("expected checksum drift to be refused")
	}
}

func TestInstallCreatesFreePoliciesAndOwnerForeignKeys(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	if err := Install(ctx, db); err != nil {
		t.Fatal(err)
	}
	rows, err := db.Query(`SELECT environment,hosting_mode,phase FROM cloud_policy ORDER BY environment`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var envs []string
	for rows.Next() {
		var e, m, p string
		if err := rows.Scan(&e, &m, &p); err != nil {
			t.Fatal(err)
		}
		if m != "self_hosted" || p != "active" {
			t.Fatalf("policy %s=%s/%s", e, m, p)
		}
		envs = append(envs, e)
	}
	if len(envs) != 2 || envs[0] != "live" || envs[1] != "sandbox" {
		t.Fatalf("environments=%v", envs)
	}
}

// 外键 + ON DELETE CASCADE 在两种引擎上都必须真实生效
// （SQLite 依赖 PRAGMA foreign_keys=ON，PostgreSQL 默认开启）。
func TestForeignKeysCascadeOnBothEngines(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	if err := Install(ctx, db); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO auth_users(id,email) VALUES(?,?)`, "u1", "u1@local.test"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO devices(id,user_id,device_name,platform,machine_id,created_at) VALUES(?,?,?,?,?,?)`,
		"d1", "u1", "laptop", "test", "m1", "2026-10-26T00:00:00Z"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO hourly(user_id,device_id,hour_start,source,model,total_tokens)
		VALUES(?,?,?,?,?,?)`, "u1", "d1", "2026-10-26T00:00:00Z", "codex", "gpt-6", 5); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`DELETE FROM auth_users WHERE id=?`, "u1"); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := db.QueryRow(`SELECT count(*) FROM hourly`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("hourly rows after account deletion = %d, want 0 (cascade)", n)
	}
	// 引用不存在的用户必须被拒绝
	if _, err := db.Exec(`INSERT INTO devices(id,user_id,device_name,created_at) VALUES(?,?,?,?)`,
		"d2", "missing-user", "x", "2026-10-26T00:00:00Z"); err == nil {
		t.Fatal("expected foreign key violation for unknown user")
	}
}

// 布尔列在 SQLite 是 INTEGER、在 PG 是 boolean；渲染结果必须各自正确。
func TestSchemaRendersEngineSpecificBooleans(t *testing.T) {
	sqlite := SchemaSQL(SQLite)
	if !strings.Contains(sqlite, "PRAGMA foreign_keys = ON;") {
		t.Fatal("sqlite DDL must keep the foreign_keys pragma")
	}
	if !strings.Contains(sqlite, "is_current INTEGER NOT NULL DEFAULT 0") {
		t.Fatal("sqlite DDL must render is_current as INTEGER")
	}
	pg := SchemaSQL(Postgres)
	if strings.Contains(pg, "PRAGMA") {
		t.Fatal("postgres DDL must not contain PRAGMA statements")
	}
	if !strings.Contains(pg, "is_current boolean NOT NULL DEFAULT false") {
		t.Fatal("postgres DDL must render is_current as boolean")
	}
	if !strings.Contains(pg, "enabled boolean NOT NULL DEFAULT false") {
		t.Fatal("postgres DDL must render enabled as boolean")
	}
	if SchemaChecksum(SQLite) == SchemaChecksum(Postgres) {
		t.Fatal("per-engine checksums must differ")
	}
}

// 引入 PostgreSQL 支持后，SQLite 渲染结果必须逐字节保持原样：
// 否则已部署的 SQLite 实例会因为 checksum drift 拒绝启动。
func TestSQLiteSchemaStaysByteCompatibleWithV1(t *testing.T) {
	const legacyV1Checksum = "88f2602f1da545faf205fd76ef1a2927f490ea8ebfd8641e9e34d0b022de69df"
	if got := SchemaChecksum(SQLite); got != legacyV1Checksum {
		t.Fatalf("sqlite schema checksum drifted: %s != %s\n%s", got, legacyV1Checksum, SchemaSQL(SQLite))
	}
}

func TestSplitStatements(t *testing.T) {
	stmts := splitStatements(SchemaSQL(Postgres))
	if len(stmts) < 10 {
		t.Fatalf("split produced %d statements, want >= 10", len(stmts))
	}
	for _, s := range stmts {
		if strings.Contains(s, ";") {
			t.Fatalf("statement still contains a semicolon: %q", s)
		}
	}
	if got := splitStatements("SELECT 1; -- trailing comment only"); len(got) != 1 {
		t.Fatalf("comment-only tail must be dropped, got %v", got)
	}
	if got := splitStatements("SELECT 'a;b'"); len(got) != 1 {
		t.Fatalf("semicolon inside string literal must not split: %v", got)
	}
}

func TestRewritePlaceholders(t *testing.T) {
	cases := []struct{ in, want string }{
		{`SELECT * FROM t WHERE a=? AND b=?`, `SELECT * FROM t WHERE a=$1 AND b=$2`},
		{`SELECT * FROM t`, `SELECT * FROM t`},
		{`SELECT 'literal ?' FROM t WHERE a=?`, `SELECT 'literal ?' FROM t WHERE a=$1`},
		{`SELECT 'it''s ?' FROM t WHERE a=?`, `SELECT 'it''s ?' FROM t WHERE a=$1`},
		{`SELECT "weird ?" FROM t WHERE a=?`, `SELECT "weird ?" FROM t WHERE a=$1`},
		{"SELECT 1 -- why ?\nFROM t WHERE a=?", "SELECT 1 -- why ?\nFROM t WHERE a=$1"},
		{`SELECT /* ? */ 1 FROM t WHERE a=?`, `SELECT /* ? */ 1 FROM t WHERE a=$1`},
		{`SELECT $tag$ ? $tag$ FROM t WHERE a=?`, `SELECT $tag$ ? $tag$ FROM t WHERE a=$1`},
		{`SELECT count(*) FROM t`, `SELECT count(*) FROM t`},
		{`INSERT INTO t(a,b) VALUES(?,?)`, `INSERT INTO t(a,b) VALUES($1,$2)`},
	}
	for _, c := range cases {
		if got := RewritePlaceholders(c.in); got != c.want {
			t.Errorf("RewritePlaceholders(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestDetectDialectAndParse(t *testing.T) {
	for _, dsn := range []string{"postgres://u:p@h:5432/db", "postgresql://u@h/db"} {
		if d, err := DetectDialect(dsn); err != nil || d != Postgres {
			t.Fatalf("DetectDialect(%q) = %v,%v", dsn, d, err)
		}
	}
	for _, dsn := range []string{"tokentracker.db", "/var/lib/tt/tt.db", "file:tt.db"} {
		if d, err := DetectDialect(dsn); err != nil || d != SQLite {
			t.Fatalf("DetectDialect(%q) = %v,%v", dsn, d, err)
		}
	}
	if _, err := DetectDialect("mysql://u@h/db"); err == nil {
		t.Fatal("unsupported scheme must be rejected")
	}
	if d, err := ParseDialect("postgresql"); err != nil || d != Postgres {
		t.Fatal("ParseDialect(postgresql) should map to postgres")
	}
	if d, err := ParseDialect(""); err != nil || d != "" {
		t.Fatalf("ParseDialect(empty) = %q,%v; want unspecified (infer from DSN)", d, err)
	}
	if _, err := ParseDialect("oracle"); err == nil {
		t.Fatal("unsupported engine name must be rejected")
	}
}

func TestInsertIgnoreRendering(t *testing.T) {
	if got := (Dialect(SQLite)).DriverName(); got != "sqlite" {
		t.Fatalf("sqlite driver name = %s", got)
	}
	if got := (Dialect(Postgres)).DriverName(); got != "postgres" {
		t.Fatalf("postgres driver name = %s", got)
	}
	db := &DB{dialect: SQLite}
	if got := db.InsertIgnore("t(a) VALUES(?)"); got != "INSERT OR IGNORE INTO t(a) VALUES(?)" {
		t.Fatalf("sqlite insert-ignore = %s", got)
	}
	db = &DB{dialect: Postgres}
	if got := db.InsertIgnore("t(a) VALUES(?)"); got != "INSERT INTO t(a) VALUES(?) ON CONFLICT DO NOTHING" {
		t.Fatalf("postgres insert-ignore = %s", got)
	}
}

func TestWithSearchPath(t *testing.T) {
	got, err := withSearchPath("postgres://u:p@h:5432/db?sslmode=disable", "tt_test")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(got, "search_path=tt_test") || !strings.Contains(got, "sslmode=disable") {
		t.Fatalf("search_path not injected: %s", got)
	}
	kv, err := withSearchPath("host=/tmp/pgdata user=postgres", "tt_test")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(kv, " search_path=tt_test") {
		t.Fatalf("key=value DSN not annotated: %s", kv)
	}
	if err := validIdentifier("bad-name"); err == nil {
		t.Fatal("invalid schema name must be rejected")
	}
	if err := validIdentifier("tt_test_abc"); err != nil {
		t.Fatal(err)
	}
}

// 增量迁移：新表只加不改，老实例升级后终态与新实例一致。
func TestAdditiveMigrationsApplyAndAreIdempotent(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	for i := 0; i < 2; i++ {
		if err := Install(ctx, db); err != nil {
			t.Fatalf("install #%d: %v", i+1, err)
		}
	}
	steps := AdditiveSteps()
	if len(steps) == 0 {
		t.Fatal("expected at least one additive step")
	}
	var count int
	if err := db.QueryRow(`SELECT count(*) FROM schema_additions`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != len(steps) {
		t.Fatalf("schema_additions rows=%d want %d", count, len(steps))
	}
	for _, tbl := range []string{"auth_credentials", "auth_sessions"} {
		var n int
		if err := db.QueryRow(`SELECT count(*) FROM ` + tbl).Scan(&n); err != nil {
			t.Fatalf("%s missing after install: %v", tbl, err)
		}
	}
}

// 模拟「上一个版本已经装过」的库：清掉增量账本与新增表后再 Install，
// 必须把缺的 step 补上（老用户升级不失败）。
func TestAdditiveMigrationsUpgradeExistingInstall(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	if err := Install(ctx, db); err != nil {
		t.Fatal(err)
	}
	for _, stmt := range []string{
		`DROP TABLE IF EXISTS auth_sessions`,
		`DROP TABLE IF EXISTS auth_credentials`,
		`DROP INDEX IF EXISTS auth_credentials_email`,
		`DELETE FROM schema_additions`,
	} {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatalf("%s: %v", stmt, err)
		}
	}
	var pre int
	if err := db.QueryRow(`SELECT count(*) FROM auth_sessions`).Scan(&pre); err == nil {
		t.Fatal("precondition failed: table should be gone")
	}
	if err := Install(ctx, db); err != nil {
		t.Fatalf("upgrade install: %v", err)
	}
	var post int
	if err := db.QueryRow(`SELECT count(*) FROM auth_sessions`).Scan(&post); err != nil {
		t.Fatalf("upgrade did not create auth_sessions: %v", err)
	}
	var n int
	if err := db.QueryRow(`SELECT count(*) FROM schema_additions`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != len(AdditiveSteps()) {
		t.Fatalf("additions=%d want %d", n, len(AdditiveSteps()))
	}
}

// 已发布的 step 被改动必须拒绝启动（和 core schema 的 drift 保护同等强度）。
func TestAdditiveMigrationChecksumDriftRefused(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	if err := Install(ctx, db); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE schema_additions SET checksum='tampered' WHERE version=?`, AdditiveSteps()[0]); err != nil {
		t.Fatal(err)
	}
	if err := Install(ctx, db); err == nil {
		t.Fatal("expected additive checksum drift to be refused")
	}
}
