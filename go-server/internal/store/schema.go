// Package store 提供 TokenTracker 自托管后端的存储层（PostgreSQL only）。
//
// 设计原则：
//   - 只有一个引擎。业务代码写 `?` 占位符，由本包统一改写成 `$n`；
//     不再有方言分支、双份 DDL、双份 checksum。
//   - 不依赖 PG 的 RLS / PL/pgSQL / advisory lock / timestamptz；
//     这些语义在 Go 应用层实现（见 app 包的 handlers 与 sync.Mutex）。
//   - 列类型刻意保持"文本化"：时间存 RFC3339 UTC 文本，金额存十进制文本，
//     识别列存 TEXT。排序（ISO 文本即时间序）、LIKE/比较语义因此在
//     Go 侧完全可预测。代价是 PG 侧没有 timestamptz/numeric 的原生类型校验；
//     理由见 docs/design/postgres.md。
//   - 2026-10 起不再支持 SQLite（归档点 tag `sqlite-final`）。
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

// SchemaVersion 是逻辑 schema 的版本号。
// 迁移账本里记录的 checksum 是 core DDL 的 sha256（与引擎无关，因为只有一个引擎）。
const SchemaVersion = 1

// appliedAt 固定值：保持契约/测试输出可复现，不使用 wall clock。
const appliedAt = "2026-10-26T00:00:00Z"

// schemaBody 是完整的 core DDL（PostgreSQL）。
//
// 注意：这段文本的 sha256 会被写进 schema_migrations 做 fail-closed 校验，
// 修改任何字符都会让已部署实例启动即拒绝（"checksum drift"）。
// 新增表/列请走下方 additiveSteps，不要改这里。
const schemaBody = `
-- PostgreSQL 自身的迁移账本（不冒充 PG 的 15-step SQL 安装账本）。
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
  is_current boolean NOT NULL DEFAULT false,
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
CREATE TABLE IF NOT EXISTS cloud_payment_providers (id TEXT PRIMARY KEY, enabled boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS cloud_catalog (id TEXT PRIMARY KEY);
`

// SchemaSQL 返回完整的 core DDL（幂等：全部 IF NOT EXISTS）。
func SchemaSQL() string { return schemaBody }

// SchemaChecksum 是 core DDL 的 sha256（十六进制）。
func SchemaChecksum() string {
	sum := sha256.Sum256([]byte(SchemaSQL()))
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

// ---------- 增量迁移（additive migrations） ----------
//
// 为什么不直接改 schemaBody：schemaBody 的 checksum 是「已安装 schema 未被篡改」的
// 证据（Install 里做 fail-closed 比对），改一行就会让所有已部署实例启动即失败。
// 也不动 SchemaVersion：它同时出现在 /_test/manifest 与 /_test/install 的响应里，
// 被契约 golden 逐字段比对（见 contract/scenarios/01-install.json）。
//
// 所以新增表走这里：每个 step 只做 CREATE ... IF NOT EXISTS 这类**可重放**的加法，
// 单独记一行 schema_additions(version, name, checksum)。老实例升级时只跑新 step，
// 新实例全量跑一遍，两者终态一致。
//
// 约定：step 一经发布**永不修改**（改动 = 新的 step），checksum 漂移视为篡改并拒绝启动。
var additiveSteps = []struct {
	Version int
	Name    string
	SQL     string
}{
	{1, "auth-sessions", `
-- 自托管的"账户密码凭据"（InsForge 的 auth.users 等价物；密码只存 PBKDF2 哈希）
CREATE TABLE IF NOT EXISTS auth_credentials (
  user_id TEXT PRIMARY KEY REFERENCES auth_users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS auth_credentials_email ON auth_credentials(email);

-- 刷新令牌（对应 InsForge 的 refresh session）：只存 SHA-256，支持轮换与撤销
CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  csrf_hash TEXT NOT NULL,
  client TEXT NOT NULL DEFAULT 'browser',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS auth_sessions_token ON auth_sessions(token_hash);
CREATE INDEX IF NOT EXISTS auth_sessions_user ON auth_sessions(user_id);
`},
	{2, "auth-owner", `
-- 「这台机器的所有者」单例。为什么需要它：
--   自托管没有平台账号表，device-login（设备授权）与 /api/auth/*（登录）原本各自
--   产生一个账户 id，同一台机器于是有两条互不相干的账户，跨设备汇总看不到对方。
--   auth_owner 把「归属」收敛成一个可解析的事实：slot=1 恒为唯一一行。
CREATE TABLE IF NOT EXISTS auth_owner (
  slot INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES auth_users(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`},
}

// SchemaLedgerVersion 是「core schema + 所有增量 step」的逻辑版本，仅用于日志与文档；
// 不参与契约响应（那用的是 SchemaVersion）。
func SchemaLedgerVersion() int {
	v := SchemaVersion
	for _, st := range additiveSteps {
		if st.Version > v {
			v = st.Version
		}
	}
	return v
}

// AdditiveSteps 返回已发布的增量 step 版本号（测试与文档用）。
func AdditiveSteps() []int {
	out := make([]int, 0, len(additiveSteps))
	for _, st := range additiveSteps {
		out = append(out, st.Version)
	}
	return out
}

// Install 建表并写入迁移账本；可重复调用（幂等）。
// PostgreSQLReferenceSteps 仅是审计映射（见 checksums.go），不进入本账本。
func Install(ctx context.Context, db *DB) error {
	for _, stmt := range splitStatements(SchemaSQL()) {
		if _, err := db.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("schema: %w", err)
		}
	}
	checksum := SchemaChecksum()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// 已应用的 schema 被意外改写时 fail closed（checksum 覆盖整段 DDL）。
	var prior string
	err = tx.QueryRowContext(ctx, `SELECT checksum FROM schema_migrations WHERE version=?`, SchemaVersion).Scan(&prior)
	switch {
	case err == nil && prior != checksum:
		return fmt.Errorf("schema migration %d checksum drift: installed=%s current=%s", SchemaVersion, prior, checksum)
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
	if err := tx.Commit(); err != nil {
		return err
	}
	return installAdditiveSteps(ctx, db)
}

// installAdditiveSteps 逐个应用 additiveSteps：已应用且 checksum 一致 → 跳过；
// 已应用但 checksum 不同 → 拒绝启动（fail closed）；未应用 → 执行并记账。
func installAdditiveSteps(ctx context.Context, db *DB) error {
	if _, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_additions (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
)`); err != nil {
		return fmt.Errorf("schema additions ledger: %w", err)
	}
	for _, st := range additiveSteps {
		checksum := additiveChecksum(st.Name, st.SQL)
		var prior string
		err := db.QueryRowContext(ctx, `SELECT checksum FROM schema_additions WHERE version=?`, st.Version).Scan(&prior)
		switch {
		case err == nil && prior != checksum:
			return fmt.Errorf("additive migration %d (%s) checksum drift: installed=%s current=%s",
				st.Version, st.Name, prior, checksum)
		case err == nil:
			continue // 已应用
		case !errors.Is(err, sql.ErrNoRows):
			return err
		}
		for _, stmt := range splitStatements(st.SQL) {
			if _, err := db.ExecContext(ctx, stmt); err != nil {
				return fmt.Errorf("schema addition %d (%s): %w", st.Version, st.Name, err)
			}
		}
		if _, err := db.ExecContext(ctx,
			`INSERT INTO schema_additions(version,name,checksum,applied_at) VALUES(?,?,?,?)`,
			st.Version, st.Name, checksum, appliedAt); err != nil {
			return err
		}
	}
	return nil
}

// additiveChecksum 只覆盖该 step 自己的名字与 SQL。
func additiveChecksum(name, sqlText string) string {
	sum := sha256.Sum256([]byte(name + "\x00" + sqlText))
	return hex.EncodeToString(sum[:])
}
