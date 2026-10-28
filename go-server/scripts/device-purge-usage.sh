#!/usr/bin/env bash
# 删掉一条设备行上的历史用量（数据修复助手，配合「删掉重放」流程）。
#
# 为什么需要：device-login 曾经会复用别的机器的设备行，导致多台机器的用量混在同一行里。
# 单看数据库分不开，但每台机器**自己**的 ~/.tokentracker/tracker/queue.jsonl 里有完整答案。
# 所以正确做法是：把这条被污染的设备行的用量删掉，再让每台机器把自己的队列重放回来
# —— 精确重建，不猜时间窗。本脚本只负责「安全地删」，重放用客户端 `sync` 或
# scripts/replay-queue.py。
#
# 完整步骤见 docs/users/devices.md §6.2。
#
# 用法：
#   # 1) 预览（默认，不写库）：会删哪些、多少量、全库总量多少
#   ./device-purge-usage.sh --dsn "$TT_DATABASE_URL" --device "Device Flow"
#
#   # 2) 备份 + 删除
#   ./device-purge-usage.sh --dsn "$TT_DATABASE_URL" --device "Device Flow" --apply
#
#   # 设备名有歧义时用 id
#   ./device-purge-usage.sh --dsn "$TT_DATABASE_URL" --device 19467088-… --apply
#
#   # 不想建备份表（删了就没了，只在确定能重放时用）
#   ./device-purge-usage.sh ... --no-backup --apply
#
# 备份表名：hourly_backup_<UTC 时间戳>，删除成功后脚本会告诉你表名；确认没问题再 DROP。
#
# 退出码：0 成功（含「没有可删的行」）/ 1 参数或环境错误
set -euo pipefail

usage() { sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }
die() { echo "错误: $*" >&2; exit 1; }

DSN=""
DEVICE=""
SCHEMA=""
APPLY=0
BACKUP=1

NORM=()
for a in "$@"; do
  if [[ "$a" == --*=* ]]; then NORM+=("${a%%=*}" "${a#*=}"); else NORM+=("$a"); fi
done
set -- "${NORM[@]}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dsn) DSN="${2:-}"; shift 2 ;;
    --device) DEVICE="${2:-}"; shift 2 ;;
    --schema) SCHEMA="${2:-}"; shift 2 ;;
    --no-backup) BACKUP=0; shift ;;
    --apply) APPLY=1; shift ;;
    -h|--help) usage ;;
    *) die "未知参数 $1" ;;
  esac
done

[[ -n "$DSN" ]] || die "缺少 --dsn"
[[ -n "$DEVICE" ]] || die "缺少 --device（设备名或设备 id）"
command -v psql >/dev/null 2>&1 || die "找不到 psql"

# schema 走 PGOPTIONS：`SET search_path` 会在 -At 输出里多一行 "SET"，把结果解析顶歪。
PGOPT=""
[[ -n "$SCHEMA" ]] && PGOPT="-c search_path=$SCHEMA"
run_psql() { PGOPTIONS="$PGOPT" psql "$DSN" -v ON_ERROR_STOP=1 "$@"; }

out=$(run_psql -At -F$'\t' -c "
  SELECT id, device_name, COALESCE(platform,''), COALESCE(machine_id,''),
         (SELECT count(*) FROM hourly h WHERE h.device_id = d.id),
         (SELECT COALESCE(sum(total_tokens),0) FROM hourly h WHERE h.device_id = d.id)
    FROM devices d WHERE d.id = '$DEVICE' OR d.device_name = '$DEVICE'")
count=$(printf '%s\n' "$out" | grep -c . || true)
[[ "$count" != "0" ]] || die "找不到设备 '$DEVICE'"
if [[ "$count" != "1" ]]; then
  echo "'$DEVICE' 匹配到多台设备，请改用设备 id：" >&2
  printf '%s\n' "$out" | sed 's/^/  /' >&2
  exit 1
fi
IFS=$'\t' read -r DEV_ID DEV_NAME DEV_PLATFORM DEV_MID N_ROWS N_TOKENS <<<"$out"

TOTAL=$(run_psql -At -c "SELECT COALESCE(sum(total_tokens),0) FROM hourly")
DB_ROWS=$(run_psql -At -c "SELECT count(*) FROM hourly")

echo "设备      : $DEV_NAME  ($DEV_ID)"
echo "platform  : ${DEV_PLATFORM:-(空)}"
echo "machine_id: ${DEV_MID:-(空)}"
echo "将删除    : $N_ROWS 行 / $N_TOKENS tokens"
echo "全库现在  : $DB_ROWS 行 / $TOTAL tokens"
echo "删除之后  : 全库应为 $((DB_ROWS - N_ROWS)) 行 / $((TOTAL - N_TOKENS)) tokens"
echo

if [[ "$N_ROWS" == "0" ]]; then
  echo "这条设备行没有用量，无需删除。"
  exit 0
fi

if [[ "$APPLY" != "1" ]]; then
  echo "（预览，未写库。确认后加 --apply）"
  echo "提示：删除前请确认每台机器都能重放自己的队列（docs/users/devices.md §6.2 第 3 步）。"
  exit 0
fi

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_SQL=""
if [[ "$BACKUP" == "1" ]]; then
  BACKUP_SQL="CREATE TABLE hourly_backup_$STAMP AS SELECT * FROM hourly WHERE device_id = '$DEV_ID';"
fi

run_psql <<SQL
BEGIN;
$BACKUP_SQL
DELETE FROM hourly WHERE device_id = '$DEV_ID';
-- 聚合缓存按 user 缓存，删完直接清空最省事（服务端 60 秒内会重建）。
DELETE FROM usage_cache;
COMMIT;
SQL

AFTER_ROWS=$(run_psql -At -c "SELECT count(*) FROM hourly")
AFTER_TOTAL=$(run_psql -At -c "SELECT COALESCE(sum(total_tokens),0) FROM hourly")

echo
echo "已删除 $N_ROWS 行 / $N_TOKENS tokens。"
echo "全库现在: $AFTER_ROWS 行 / $AFTER_TOTAL tokens"
if [[ "$BACKUP" == "1" ]]; then
  echo "备份表  : hourly_backup_$STAMP（确认重放无误后再 DROP TABLE）"
fi
cat <<'EOT'

下一步：在**每台**机器上重放它自己的本地队列，然后核对总量与归属。

  # 客户端原生（重新 init 会把 queue.state.json 的 offset 归零，下一次 sync 从文件头重传）
  tracker init --base-url https://<你的地址> --anon-key "$ANON"
  tracker sync

  # 或用仓库脚本（队列文件不在原位、客户端已卸载时）
  ./scripts/replay-queue.py --base https://<你的地址> --device-token "$DTOK" --dry-run
  ./scripts/replay-queue.py --base https://<你的地址> --device-token "$DTOK"

重放是幂等的（同键整行替换），多跑一次不会翻倍。
EOT
