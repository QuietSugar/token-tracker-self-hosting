package store

import (
	"fmt"
	"strconv"
	"strings"
)

// Dialect 是受支持的数据库引擎。业务代码只写一份 SQL（用 `?` 占位符），
// 由 Dialect 负责把它改写成目标引擎方言。
type Dialect string

const (
	// SQLite 是默认引擎：单文件、零运维、CGO=0（modernc.org/sqlite）。
	SQLite Dialect = "sqlite"
	// Postgres 是生产推荐引擎：多连接、真并发、可备份/PITR/HA。
	Postgres Dialect = "postgres"
)

func (d Dialect) String() string {
	if d == Postgres {
		return "postgres"
	}
	return "sqlite"
}

// DriverName 返回 database/sql 的驱动注册名。
// sqlite 由 modernc.org/sqlite 注册；postgres 由 github.com/lib/pq 注册。
func (d Dialect) DriverName() string {
	if d == Postgres {
		return "postgres"
	}
	return "sqlite"
}

// ParseDialect 解析显式指定的引擎名。
// 空字符串返回空 Dialect（表示「未指定，按 DSN 推断」），不是错误。
func ParseDialect(s string) (Dialect, error) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "":
		return "", nil
	case "sqlite", "sqlite3":
		return SQLite, nil
	case "postgres", "postgresql", "pg":
		return Postgres, nil
	}
	return "", fmt.Errorf("unsupported database engine %q (want sqlite or postgres)", s)
}

// DetectDialect 从连接串推断引擎。
func DetectDialect(dsn string) (Dialect, error) {
	l := strings.ToLower(strings.TrimSpace(dsn))
	switch {
	case l == "":
		return "", fmt.Errorf("empty database DSN")
	case strings.HasPrefix(l, "postgres://"), strings.HasPrefix(l, "postgresql://"):
		return Postgres, nil
	case strings.Contains(l, "://"):
		// 其它协议（mysql://、file:// 之类）不支持；避免把它们当成 SQLite 文件路径。
		if strings.HasPrefix(l, "file:") {
			return SQLite, nil
		}
		return "", fmt.Errorf("unsupported database DSN scheme (want postgres:// or a SQLite file path)")
	case strings.HasPrefix(l, "host="), strings.HasPrefix(l, "user="), strings.Contains(l, " dbname="):
		// lib/pq 的 key=value 形式
		return Postgres, nil
	}
	return SQLite, nil
}

// bind 把占位符改写成目标引擎需要的形态。
// SQLite 直接用 `?`；PostgreSQL 需要 `$1..$n`。
func bind(d Dialect, query string) string {
	if d != Postgres || !strings.Contains(query, "?") {
		return query
	}
	return RewritePlaceholders(query)
}

// RewritePlaceholders 把 `?` 占位符按出现顺序改写成 `$1`、`$2`……
// 跳过字符串字面量、双引号标识符、行/块注释和美元引号字符串，
// 因此 `LIKE '%?%'` 或注释里的问号不会被误改。
func RewritePlaceholders(query string) string {
	var b strings.Builder
	b.Grow(len(query) + 8)
	n := 0
	for i := 0; i < len(query); {
		switch c := query[i]; c {
		case '\'', '"':
			j := skipQuoted(query, i)
			b.WriteString(query[i:j])
			i = j
		case '-':
			if i+1 < len(query) && query[i+1] == '-' {
				j := skipLineComment(query, i)
				b.WriteString(query[i:j])
				i = j
				continue
			}
			b.WriteByte(c)
			i++
		case '/':
			if i+1 < len(query) && query[i+1] == '*' {
				j := skipBlockComment(query, i)
				b.WriteString(query[i:j])
				i = j
				continue
			}
			b.WriteByte(c)
			i++
		case '$':
			if j := skipDollarQuoted(query, i); j > i {
				b.WriteString(query[i:j])
				i = j
				continue
			}
			b.WriteByte(c)
			i++
		case '?':
			n++
			b.WriteByte('$')
			b.WriteString(strconv.Itoa(n))
			i++
		default:
			b.WriteByte(c)
			i++
		}
	}
	return b.String()
}

// skipQuoted 返回从 i 开始的引号字面量结束后的位置。
func skipQuoted(q string, i int) int {
	quote := q[i]
	for j := i + 1; j < len(q); j++ {
		if q[j] != quote {
			continue
		}
		if j+1 < len(q) && q[j+1] == quote { // 双写转义
			j++
			continue
		}
		return j + 1
	}
	return len(q)
}

// skipLineComment 返回行注释结束（换行符位置）的位置。
func skipLineComment(q string, i int) int {
	for j := i; j < len(q); j++ {
		if q[j] == '\n' {
			return j + 1
		}
	}
	return len(q)
}

// skipBlockComment 返回块注释结束后的位置。
func skipBlockComment(q string, i int) int {
	for j := i + 2; j+1 < len(q); j++ {
		if q[j] == '*' && q[j+1] == '/' {
			return j + 2
		}
	}
	return len(q)
}

// skipDollarQuoted 识别 $tag$...$tag$ 形式的美元引号字符串；
// 不是美元引号时返回 i（不做任何跳过）。
func skipDollarQuoted(q string, i int) int {
	j := i + 1
	for j < len(q) && (q[j] == '_' || q[j] >= 'a' && q[j] <= 'z' || q[j] >= 'A' && q[j] <= 'Z' || q[j] >= '0' && q[j] <= '9') {
		j++
	}
	if j >= len(q) || q[j] != '$' {
		return i
	}
	tag := q[i : j+1]
	if k := strings.Index(q[j+1:], tag); k >= 0 {
		return j + 1 + k + len(tag)
	}
	return len(q)
}
