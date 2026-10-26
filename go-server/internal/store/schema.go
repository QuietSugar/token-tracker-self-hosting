// Package store 提供 TokenTracker 自托管后端的 SQLite 存储层。
//
// 设计原则：
//   - 不依赖 PG 的 RLS / PL/pgSQL / advisory lock / timestamptz；
//     这些语义在 Go 应用层实现（见 handlers.go 与 server.go）。
//   - 时间统一存 RFC3339 UTC 文本；jsonb 存 TEXT（JSON）。
//   - 所有写操作用事务 + BEGIN IMMEDIATE 模拟 PG 的 advisory_xact_lock 串行化。
package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
)

// Schema 是 15 步 PG 基线在 SQLite 里的等价核心子集。
// 完整映射见 ../../contract/mapping.json（当前只实现核心路径所需的表）。
const Schema = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

-- SQLite 自身的迁移账本（不冒充 PG 的 15-step SQL 安装账本）。
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

-- 平台 auth schema 的最小等价（InsForge 在 PG 里自建）
CREATE TABLE IF NOT EXISTS auth_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL DEFAULT ''
);

-- 策略（对应 public.tokentracker_cloud_policy）
CREATE TABLE IF NOT EXISTS cloud_policy (
  environment TEXT PRIMARY KEY,
  hosting_mode TEXT NOT NULL DEFAULT 'self_hosted',
  phase TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  device_name TEXT NOT NULL,
  platform TEXT,
  machine_id TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS devices_machine_unique
  ON devices(user_id, machine_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS devices_active_unique
  ON devices(user_id, platform, device_name) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS device_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS device_codes (
  device_code TEXT PRIMARY KEY,
  user_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  user_id TEXT REFERENCES auth_users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  approved_at TEXT,
  client_info TEXT,
  machine_id TEXT,
  device_token TEXT,
  device_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cloud_machines (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  machine_id TEXT,
  platform TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  last_seen_at TEXT,
  is_current INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cloud_machine_aliases (
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  machine_id TEXT NOT NULL,
  PRIMARY KEY(user_id, alias)
);

-- 用量小时表（对应 public.tokentracker_hourly）
CREATE TABLE IF NOT EXISTS hourly (
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  hour_start TEXT NOT NULL,
  source TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  billable_total_tokens INTEGER,
  conversations INTEGER NOT NULL DEFAULT 0,
  total_cost_usd TEXT NOT NULL DEFAULT '0',
  PRIMARY KEY(user_id, device_id, hour_start, source, model)
);
CREATE INDEX IF NOT EXISTS hourly_user_time ON hourly(user_id, hour_start);

-- 聚合缓存（对应 public.tokentracker_account_usage_cache）
CREATE TABLE IF NOT EXISTS usage_cache (
  cache_key TEXT PRIMARY KEY,
  result TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS usage_cache_owner ON usage_cache(cache_key);

-- 支付/订单表存在但为空（API 兼容性；自托管模式不产生任何行）
CREATE TABLE IF NOT EXISTS cloud_payments (id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS cloud_orders (id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS cloud_payment_providers (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS cloud_catalog (id TEXT PRIMARY KEY);
`

// Install 建表并写入安装账本；可重复调用（幂等）。
// PostgreSQLReferenceSteps 仅是参考映射（由 static.json 生成），不进入 SQLite migration ledger。
func Install(ctx context.Context, db *sql.DB) error {
	if _, err := db.ExecContext(ctx, Schema); err != nil {
		return fmt.Errorf("schema: %w", err)
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// SQLite 自身的迁移 checksum：与 PG 的 15-step SQL checksum 不同，
	// 但同样保证“已应用 schema 被意外改写时 fail closed”。
	sum := sha256.Sum256([]byte(Schema))
	checksum := hex.EncodeToString(sum[:])
	var prior string
	err = tx.QueryRowContext(ctx, `SELECT checksum FROM schema_migrations WHERE version=1`).Scan(&prior)
	if err == nil && prior != checksum {
		return fmt.Errorf("SQLite schema migration 1 checksum drift: installed=%s current=%s", prior, checksum)
	}
	if err != nil && err != sql.ErrNoRows {
		return err
	}
	if err == sql.ErrNoRows {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO schema_migrations(version,checksum,applied_at) VALUES(1,?,?)`,
			checksum, "2026-10-26T00:00:00Z"); err != nil {
			return err
		}
	}
	for _, env := range []string{"live", "sandbox"} {
		if _, err := tx.ExecContext(ctx,
			`INSERT OR IGNORE INTO cloud_policy(environment,hosting_mode,phase) VALUES(?,'self_hosted','active')`,
			env); err != nil {
			return err
		}
	}
	return tx.Commit()
}
