#!/usr/bin/env bash
# TokenTracker Go 后端备份 / 恢复助手（PostgreSQL）。
#
# ⚠️ 本脚本只做「一致的逻辑备份」，不含 PITR / WAL 归档 / 异地复制。
#    真正的容灾仍需要你在部署侧配置（对象存储、pgBackRest、云快照等）。
#
# 用法:
#   ./backup.sh postgres --dsn 'postgres://tt:***@127.0.0.1:5432/tt' --out /backup [--schema public]
#   ./backup.sh restore-postgres --backup /backup/tt-pg-20261027T120000Z.dump --dsn ...
#   ./backup.sh prune --out /backup --keep 14
#
# 为什么只有 PostgreSQL：2026-10 起 SQLite 支持已移除（归档 tag `sqlite-final`）。
# 如果你还有 SQLite 老库，请在 `sqlite-final` 那个 tag 上用 1.4.12 上游 CLI 或
# `import-usage.py` 导出 CSV/JSONL，再导入本服务。
#
# PostgreSQL 说明：使用 pg_dump 自定义格式（-Fc），restore 用 pg_restore --clean。
set -euo pipefail

usage() { sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }
die() { echo "错误: $*" >&2; exit 1; }
log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

cmd="${1:-}"; shift || usage

OUT="."; DSN=""; BACKUP=""; KEEP=""; SCHEMA=""
while [ $# -gt 0 ]; do
  case "$1" in
    --out)      OUT="${2:?}"; shift 2 ;;
    --dsn)      DSN="${2:?}"; shift 2 ;;
    --backup)   BACKUP="${2:?}"; shift 2 ;;
    --keep)     KEEP="${2:?}"; shift 2 ;;
    --schema)   SCHEMA="${2:?}"; shift 2 ;;
    -h|--help)  usage ;;
    *) die "未知参数 $1（SQLite 相关参数已随引擎一起移除，见 tag sqlite-final）" ;;
  esac
done

stamp() { date -u +%Y%m%dT%H%M%SZ; }

backup_postgres() {
  [ -n "$DSN" ] || die "缺少 --dsn"
  command -v pg_dump >/dev/null 2>&1 || die "缺少 pg_dump（请安装与服务端同主版本的 postgresql-client）"
  mkdir -p "$OUT"
  local target="$OUT/tt-pg-$(stamp).dump"
  log "pg_dump -Fc（自定义格式，可并行/选择性恢复）"
  local extra=()
  [ -n "$SCHEMA" ] && extra+=(--schema="$SCHEMA")
  pg_dump --no-owner --no-privileges "${extra[@]}" -Fc -f "$target" "$DSN"
  chmod 600 "$target"
  log "备份完成: $target ($(du -h "$target" | cut -f1))"
  log "校验: pg_restore --list '$target' | head"
  echo "$target"
}

restore_postgres() {
  [ -n "$BACKUP" ] || die "缺少 --backup"
  [ -n "$DSN" ] || die "缺少 --dsn"
  [ -f "$BACKUP" ] || die "$BACKUP 不存在"
  command -v pg_restore >/dev/null 2>&1 || die "缺少 pg_restore"
  log "⚠️  --clean 会先删除同名对象，请确认目标库是预期实例"
  pg_restore --clean --if-exists --no-owner --no-privileges -d "$DSN" "$BACKUP"
  log "恢复完成；随后重启服务以重建连接池，并检查 /health"
}

prune() {
  [ -n "$KEEP" ] || die "缺少 --keep（保留天数）"
  [ -d "$OUT" ] || die "$OUT 不存在"
  log "删除 $OUT 中 $KEEP 天前的备份"
  find "$OUT" -maxdepth 1 -type f -name 'tt-pg-*.dump' -mtime "+$KEEP" -print -delete
}

case "$cmd" in
  postgres)         backup_postgres ;;
  restore-postgres) restore_postgres ;;
  prune)            prune ;;
  sqlite|restore-sqlite)
    die "SQLite 支持已移除（归档 tag sqlite-final）；本服务只备份 PostgreSQL" ;;
  *) usage ;;
esac
