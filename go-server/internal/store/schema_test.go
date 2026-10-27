package store

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"os"
	"strings"
	"testing"

	_ "github.com/lib/pq"
)

// testDB 返回隔离的存储层实例：每个测试一个独立 PostgreSQL schema。
// 存储层只支持 PostgreSQL，未设置 TT_TEST_DATABASE_URL 时直接失败
// （失败信息里带起库命令，见 go-server/scripts/test-with-pg.sh）。
func testDB(t *testing.T) *DB {
	t.Helper()
	dsn := os.Getenv("TT_TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatalf("TT_TEST_DATABASE_URL is not set: the store layer is PostgreSQL-only.\n"+
			"  go-server/scripts/test-with-pg.sh            # 起一个临时 PG 并打印 DSN\n"+
			"  export TT_TEST_DATABASE_URL=postgres://tokentracker:tokentracker-dev@127.0.0.1:55432/tokentracker?sslmode=disable")
	}
	db, err := Open(context.Background(), Config{
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
	if checksum != SchemaChecksum() {
		t.Fatalf("ledger checksum %s != core DDL checksum %s", checksum, SchemaChecksum())
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

// 外键 + ON DELETE CASCADE 必须真实生效（不能只写在 DDL 里）。
func TestForeignKeysCascade(t *testing.T) {
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

// core DDL 必须是 PostgreSQL 方言：布尔列用 boolean、不能残留任何方言占位符。
func TestSchemaIsPostgresDialect(t *testing.T) {
	ddl := SchemaSQL()
	if strings.Contains(ddl, "{{") {
		t.Fatal("core DDL still contains template placeholders")
	}
	if strings.Contains(ddl, "PRAGMA") {
		t.Fatal("core DDL must not contain PRAGMA statements")
	}
	for _, want := range []string{
		"is_current boolean NOT NULL DEFAULT false",
		"enabled boolean NOT NULL DEFAULT false",
	} {
		if !strings.Contains(ddl, want) {
			t.Fatalf("core DDL missing %q", want)
		}
	}
	if len(SchemaChecksum()) != 64 {
		t.Fatalf("checksum = %q, want 64 hex chars", SchemaChecksum())
	}
}

// core DDL 的 checksum 是 fail-closed 的证据：改动任何字符都会让已部署实例
// 拒绝启动，所以这里把当前值钉死。新增表请走 additiveSteps，不要改 schemaBody。
func TestSchemaChecksumIsPinned(t *testing.T) {
	const pinned = "c5fe0bf2129c2d0357b2bb90ba4e77535ceccaa830e0ef47d972322651a04497"
	if got := SchemaChecksum(); got != pinned {
		t.Fatalf("core DDL checksum drifted: %s != %s\n"+
			"如果你确实要改 core DDL，请同时：①把 additive 迁移写好 ②更新这里与文档 "+
			"③确认没有已部署实例（否则它们会启动即失败）", got, pinned)
	}
}

func TestSplitStatements(t *testing.T) {
	stmts := splitStatements(SchemaSQL())
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

func TestValidateDSN(t *testing.T) {
	for _, dsn := range []string{
		"postgres://u:p@h:5432/db",
		"postgresql://u@h/db",
		"host=127.0.0.1 user=tt dbname=tt sslmode=disable", // lib/pq key=value
	} {
		if err := ValidateDSN(dsn); err != nil {
			t.Fatalf("ValidateDSN(%q) = %v, want nil", dsn, err)
		}
	}
	// SQLite 支持已移除：文件路径必须被拒绝，且错误信息要能指引迁移。
	for _, dsn := range []string{"tokentracker.db", "/var/lib/tt/tt.db", "file:tt.db"} {
		err := ValidateDSN(dsn)
		if err == nil {
			t.Fatalf("ValidateDSN(%q) must be rejected (SQLite support removed)", dsn)
		}
		if !strings.Contains(err.Error(), "SQLite support was removed") || !strings.Contains(err.Error(), "sqlite-final") {
			t.Fatalf("ValidateDSN(%q) error lacks migration hint: %v", dsn, err)
		}
	}
	if err := ValidateDSN("mysql://u@h/db"); err == nil || !strings.Contains(err.Error(), "only supports PostgreSQL") {
		t.Fatalf("mysql DSN should be rejected with a clear message, got %v", err)
	}
	if err := ValidateDSN(""); err == nil {
		t.Fatal("empty DSN must be rejected")
	}
}

func TestInsertIgnoreRendering(t *testing.T) {
	db := &DB{}
	if got := db.InsertIgnore("t(a) VALUES(?)"); got != "INSERT INTO t(a) VALUES(?) ON CONFLICT DO NOTHING" {
		t.Fatalf("insert-ignore = %s", got)
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
