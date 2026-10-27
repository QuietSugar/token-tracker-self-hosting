#!/usr/bin/env bash
# TokenTracker Go 后端备份 / 恢复助手（SQLite 与 PostgreSQL 两种引擎）。
#
# ⚠️ 本脚本只做「一致的逻辑备份」，不含 PITR / WAL 归档 / 异地复制。
#    真正的容灾仍需要你在部署侧配置（对象存储、pgBackRest、云快照等）。
#
# 用法:
#   ./backup.sh sqlite  --data-dir /var/lib/docker/volumes/tt/_data --out /backup
#   ./backup.sh postgres --dsn 'postgres://tt:***@127.0.0.1:5432/tt' --out /backup [--schema public]
#   ./backup.sh restore-sqlite   --backup /backup/tt-sqlite-20261027T120000Z.db --data-dir ...
#   ./backup.sh restore-postgres --backup /backup/tt-pg-20261027T120000Z.dump --dsn ...
#
# SQLite 说明：使用 `sqlite3 .backup`（在线一致快照），本地没有 sqlite3 时退化为
#   「复制前 checkpoint + 复制 db/wal/shm」。复制正在写入的库有风险，脚本会明确提示。
# PostgreSQL 说明：使用 pg_dump 自定义格式（-Fc），restore 用 pg_restore --clean。
set -euo pipefail

usage() { sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }
die() { echo "错误: $*" >&2; exit 1; }
log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

cmd="${1:-}"; shift || usage

DATA_DIR=""; OUT="."; DSN=""; BACKUP=""; KEEP=""; SCHEMA=""
while [ $# -gt 0 ]; do
  case "$1" in
    --data-dir) DATA_DIR="${2:?}"; shift 2 ;;
    --out)      OUT="${2:?}"; shift 2 ;;
    --dsn)      DSN="${2:?}"; shift 2 ;;
    --backup)   BACKUP="${2:?}"; shift 2 ;;
    --keep)     KEEP="${2:?}"; shift 2 ;;
    --schema)   SCHEMA="${2:?}"; shift 2 ;;
    -h|--help)  usage ;;
    *) die "未知参数 $1" ;;
  esac
done

stamp() { date -u +%Y%m%dT%H%M%SZ; }

backup_sqlite() {
  [ -n "$DATA_DIR" ] || die "缺少 --data-dir（SQLite 数据目录，含 tokentracker.db）"
  [ -f "$DATA_DIR/tokentracker.db" ] || die "$DATA_DIR/tokentracker.db 不存在"
  mkdir -p "$OUT"
  local target="$OUT/tt-sqlite-$(stamp).db"
  if command -v sqlite3 >/dev/null 2>&1; then
    log "使用 sqlite3 .backup 做在线一致快照"
    sqlite3 "$DATA_DIR/tokentracker.db" ".backup '$target'"
  else
    log "⚠️  未找到 sqlite3：退化为文件复制（请先停服务以避免半写状态）"
    log "   停服务: docker compose stop tokentracker-go / systemctl stop tokentracker"
    cp -p "$DATA_DIR/tokentracker.db" "$target"
    [ -f "$DATA_DIR/tokentracker.db-wal" ] && cp -p "$DATA_DIR/tokentracker.db-wal" "$target-wal"
    [ -f "$DATA_DIR/tokentracker.db-shm" ] && cp -p "$DATA_DIR/tokentracker.db-shm" "$target-shm"
  fi
  chmod 600 "$target"
  # 校验：能读出 schema 版本与表数量
  if command -v sqlite3 >/dev/null 2>&1; then
    local ver tables
    ver="$(sqlite3 "$target" 'select max(version) from schema_migrations;')"
    tables="$(sqlite3 "$target" 'select count(*) from sqlite_master where type="table";')"
    log "备份完成: $target (schema version=$ver, tables=$tables, $(du -h "$target" | cut -f1))"
  else
    log "备份完成: $target ($(du -h "$target" | cut -f1))"
  fi
  echo "$target"
}

restore_sqlite() {
  [ -n "$BACKUP" ] || die "缺少 --backup"
  [ -n "$DATA_DIR" ] || die "缺少 --data-dir"
  [ -f "$BACKUP" ] || die "$BACKUP 不存在"
  die "恢复会覆盖现有数据，请手动执行并先确认服务已停止：
  systemctl stop tokentracker   # 或 docker compose stop tokentracker-go
  cp -p '$DATA_DIR/tokentracker.db' '$DATA_DIR/tokentracker.db.before-restore'
  rm -f '$DATA_DIR/tokentracker.db-wal' '$DATA_DIR/tokentracker.db-shm'
  cp -p '$BACKUP' '$DATA_DIR/tokentracker.db'
  chown 10001:10001 '$DATA_DIR/tokentracker.db' && chmod 600 '$DATA_DIR/tokentracker.db'
  systemctl start tokentracker  # 或 docker compose up -d
  curl -fsS http://127.0.0.1:8080/health"
}

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
  find "$OUT" -maxdepth 1 -type f \( -name 'tt-sqlite-*.db*' -o -name 'tt-pg-*.dump' \) -mtime "+$KEEP" -print -delete
}

case "$cmd" in
  sqlite)           backup_sqlite ;;
  postgres)         backup_postgres ;;
  restore-sqlite)   restore_sqlite ;;
  restore-postgres) restore_postgres ;;
  prune)            prune ;;
  *) usage ;;
esac
