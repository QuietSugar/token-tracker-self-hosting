package store

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func TestInstallIsIdempotentAndUsesSQLiteMigrationLedger(t *testing.T) {
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := Install(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	if err := Install(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	var version, count int
	var checksum string
	if err := db.QueryRow(`SELECT max(version),count(*),max(checksum) FROM schema_migrations`).Scan(&version, &count, &checksum); err != nil {
		t.Fatal(err)
	}
	if version != 1 || count != 1 || len(checksum) != 64 {
		t.Fatalf("schema migration ledger = version %d/count %d/checksum len %d, want 1/1/64", version, count, len(checksum))
	}
	if _, err := db.Query(`SELECT * FROM self_host_installations`); err == nil {
		t.Fatal("must not fabricate the PostgreSQL-only 15-step migration ledger")
	}
}

func TestInstallRefusesSQLiteSchemaChecksumDrift(t *testing.T) {
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := Install(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE schema_migrations SET checksum='tampered' WHERE version=1`); err != nil {
		t.Fatal(err)
	}
	if err := Install(context.Background(), db); err == nil {
		t.Fatal("expected checksum drift to be refused")
	}
}

func TestInstallCreatesFreePoliciesAndOwnerForeignKeys(t *testing.T) {
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := Install(context.Background(), db); err != nil {
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
