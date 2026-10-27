package store

import (
	"strconv"
	"strings"
)

// PostgreSQL 用 `$1..$n` 占位符，而业务代码统一写 `?`（可读性更好、也便于
// 手写和拼接）。这里做单向改写：所有 SQL 在进入 database/sql 之前都会经过
// rewritePlaceholders，因此业务层不需要关心占位符形态。
//
// 改写是纯文本的，但足够保守：跳过字符串字面量、双引号标识符、行/块注释和
// 美元引号字符串，所以 `LIKE '%?%'`、注释里的问号都不会被误改。

// rewritePlaceholders 是 RewritePlaceholders 的内部入口：
// 没有 `?` 的语句原样返回，避免无谓的字符串构造。
func rewritePlaceholders(query string) string {
	if !strings.Contains(query, "?") {
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
