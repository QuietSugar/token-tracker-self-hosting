// Package store 提供 TokenTracker 自托管后端的存储层。
//
// 设计原则：
//   - 同一套 Go 业务代码跑在两种引擎上（SQLite / PostgreSQL）：
//     占位符、幂等插入、布尔字面量、DDL 都由本包按 Dialect 渲染。
//   - 不依赖 PG 的 RLS / PL/pgSQL / advisory lock / timestamptz；
//     这些语义在 Go 应用层实现（见 app 包的 handlers 与 sync.Mutex）。
//   - 两种引擎的列类型保持可互换：时间存 RFC3339 UTC 文本，金额存十进制文本，
//     识别列存 TEXT。这样跨引擎的 Scan 目标、排序（ISO 文本即时间序）、
//     LIKE/比较语义完全一致，业务层不需要任何方言分支。
//     代价是 PG 侧没有 timestamptz/numeric 的原生类型校验；理由与迁移路线见
//     docs/go-postgres.md。
//   - SQLite 的写操作用事务 + 单连接模拟 PG 的 advisory_xact_lock 串行化。
package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
)

// SchemaVersion 是逻辑 schema 的版本号；SQLite 与 PostgreSQL 共用同一版本号。
// 迁移账本里记录的 checksum 是「该引擎渲染后的 DDL」的 sha256，
// 因此同一个 version 在两种引擎上 checksum 不同（这是预期行为）。
const SchemaVersion = 1

// appliedAt 固定值：保持契约/测试输出可复现，不使用 wall clock。
const appliedAt = "2026-10-26T00:00:00Z"

// sqlitePreamble 只对 SQLite 执行：WAL、外键、锁等待。
// PostgreSQL 不需要等价设置（外键默认强制、没有写者串行化问题）。
const sqlitePreamble = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
`

// schemaBody 是两种引擎共用的逻辑 schema，含三个占位符：
//
//	{{ENGINE}} 引擎名（只出现在注释里）
//	{{BOOL}}   布尔列类型（SQLite: INTEGER，PostgreSQL: boolean）
//	{{FALSE}}  布尔假值（SQLite: 0，PostgreSQL: false）
//
// 其余列类型（TEXT / INTEGER）在两种引擎里都合法，故意不做改写。
const schemaBody = `
-- {{ENGINE}} 自身的迁移账本（不冒充 PG 的 15-step SQL 安装账本）。
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
  is_current {{BOOL}} NOT NULL DEFAULT {{FALSE}},
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
CREATE TABLE IF NOT EXISTS cloud_payment_providers (id TEXT PRIMARY KEY, enabled {{BOOL}} NOT NULL DEFAULT {{FALSE}});
CREATE TABLE IF NOT EXISTS cloud_catalog (id TEXT PRIMARY KEY);
`

// SchemaSQL 渲染指定引擎的完整 DDL（幂等：全部 IF NOT EXISTS）。
func SchemaSQL(d Dialect) string {
	engine, boolean, falseLiteral := "SQLite", "INTEGER", "0"
	preamble := sqlitePreamble
	if d == Postgres {
		engine, boolean, falseLiteral = "PostgreSQL", "boolean", "false"
		preamble = ""
	}
	return preamble + strings.NewReplacer(
		"{{ENGINE}}", engine,
		"{{BOOL}}", boolean,
		"{{FALSE}}", falseLiteral,
	).Replace(schemaBody)
}

// SchemaChecksum 是渲染后 DDL 的 sha256（十六进制）。
func SchemaChecksum(d Dialect) string {
	sum := sha256.Sum256([]byte(SchemaSQL(d)))
	return hex.EncodeToString(sum[:])
}

// splitStatements 按顶层分号切分 DDL。
// 本包的 DDL 不含函数体/美元引号/字符串里的分号，因此逐字符扫描即可；
// 切分的目的只是让每个语句的错误可定位，而不是实现通用 SQL 解析器。
func splitStatements(query string) []string {
	var out []string
	var cur strings.Builder
	inSingle, inDouble := false, false
	for i := 0; i < len(query); i++ {
		c := query[i]
		switch {
		case inSingle:
			cur.WriteByte(c)
			if c == '\'' {
				inSingle = false
			}
			continue
		case inDouble:
			cur.WriteByte(c)
			if c == '"' {
				inDouble = false
			}
			continue
		}
		switch c {
		case '\'':
			inSingle = true
		case '"':
			inDouble = true
		case '-':
			if i+1 < len(query) && query[i+1] == '-' { // 行注释，直接吞到行尾
				for ; i < len(query) && query[i] != '\n'; i++ {
					cur.WriteByte(query[i])
				}
				if i < len(query) {
					cur.WriteByte('\n')
				}
				continue
			}
		case ';':
			if s := trimBlankSQL(cur.String()); s != "" {
				out = append(out, s)
			}
			cur.Reset()
			continue
		}
		cur.WriteByte(c)
	}
	if s := trimBlankSQL(cur.String()); s != "" {
		out = append(out, s)
	}
	return out
}

// trimBlankSQL 去掉首尾空白；如果剩余内容只有注释则返回空串
// （只含注释的语句在 PostgreSQL 上会报空查询错误）。
func trimBlankSQL(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		switch {
		case s[i] == '-' && i+1 < len(s) && s[i+1] == '-':
			i = skipLineComment(s, i) - 1
		case s[i] == '/' && i+1 < len(s) && s[i+1] == '*':
			i = skipBlockComment(s, i) - 1
		default:
			b.WriteByte(s[i])
		}
	}
	if strings.TrimSpace(b.String()) == "" {
		return ""
	}
	return s
}

// Install 建表并写入迁移账本；可重复调用（幂等）。
// PostgreSQLReferenceSteps 仅是审计映射（见 checksums.go），不进入本账本。
func Install(ctx context.Context, db *DB) error {
	for _, stmt := range splitStatements(SchemaSQL(db.Dialect())) {
		if _, err := db.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("schema: %w", err)
		}
	}
	checksum := SchemaChecksum(db.Dialect())
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// checksum 与引擎绑定：已应用的 schema 被意外改写（或把另一引擎的账本
	// 搬过来）时 fail closed。
	var prior string
	err = tx.QueryRowContext(ctx, `SELECT checksum FROM schema_migrations WHERE version=?`, SchemaVersion).Scan(&prior)
	switch {
	case err == nil && prior != checksum:
		return fmt.Errorf("%s schema migration %d checksum drift: installed=%s current=%s", db.Dialect(), SchemaVersion, prior, checksum)
	case err == nil:
		// 已安装且 checksum 一致：无需写入
	case errors.Is(err, sql.ErrNoRows):
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO schema_migrations(version,checksum,applied_at) VALUES(?,?,?)`,
			SchemaVersion, checksum, appliedAt); err != nil {
			return err
		}
	default:
		return err
	}
	for _, env := range []string{"live", "sandbox"} {
		if _, err := tx.ExecContext(ctx,
			db.InsertIgnore(`cloud_policy(environment,hosting_mode,phase) VALUES(?,'self_hosted','active')`),
			env); err != nil {
			return err
		}
	}
	return tx.Commit()
}
