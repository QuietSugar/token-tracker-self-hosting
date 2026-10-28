#!/usr/bin/env bash
# 把误归属的用量从一个设备搬到另一个设备（数据修复工具）。
#
# 场景：device-login 曾经按 `machine_id OR (platform, device_name)` 判重，新机器会借用
# 已有设备行 → 它的用量记在旧机器名下。服务端已修（见 CHANGELOG），但**已经写错的
# 历史行不会自己搬家**，用本脚本搬。
#
# 只动 `hourly` 表（用量）。设备行、token、机器行都不碰——那是
# `tokentracker-device-rename` / `device-login` 的事。
#
# 用法：
#   # 0) 先看一眼现状（只读）
#   psql "$TT_DATABASE_URL" -f go-server/scripts/device-report.sql
#
#   # 1) 试运行：只统计，不写库（默认）
#   ./device-move-usage.sh --dsn "$TT_DATABASE_URL" --from vm128 --to hp
#
#   # 2) 确认后真搬
#   ./device-move-usage.sh --dsn "$TT_DATABASE_URL" --from vm128 --to hp --apply
#
#   # 只搬一段时间（例如误归属发生的那几天）
#   ./device-move-usage.sh --dsn "$TT_DATABASE_URL" --from vm128 --to hp \
#       --since 2026-10-01 --until 2026-10-28 --apply
#
#   # 撞主键时默认中止；确认可以把两边数值相加再合并就用 --merge=sum
#   ./device-move-usage.sh ... --merge=sum --apply
#
# 没有本地 psql 就用容器里的：
#   docker compose -f go-server/docker-compose.postgres-go.example.yml exec -T tokentracker-postgres \
#     psql -U tokentracker -d tokentracker -f - < go-server/scripts/device-report.sql
#   （本脚本需要 psql 在 PATH 上；容器场景可直接把下面的 SQL 抄进去执行）
#
# 退出码：0 成功 / 1 参数或环境错误 / 2 预检发现冲突且未指定 --merge
set -euo pipefail

usage() { sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }
die() { echo "错误: $*" >&2; exit 1; }

DSN=""
FROM=""
TO=""
SINCE=""
UNTIL=""
APPLY=0
MERGE="abort"
SCHEMA=""

# 支持 --key=value 与 --key value 两种写法（文档里两种都出现过）。
NORM=()
for a in "$@"; do
  if [[ "$a" == --*=* ]]; then
    NORM+=("${a%%=*}" "${a#*=}")
  else
    NORM+=("$a")
  fi
done
set -- "${NORM[@]}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dsn) DSN="${2:-}"; shift 2 ;;
    --from) FROM="${2:-}"; shift 2 ;;
    --to) TO="${2:-}"; shift 2 ;;
    --since) SINCE="${2:-}"; shift 2 ;;
    --until) UNTIL="${2:-}"; shift 2 ;;
    --merge) MERGE="${2:-}"; shift 2 ;;
    --schema) SCHEMA="${2:-}"; shift 2 ;;
    --apply) APPLY=1; shift ;;
    -h|--help) usage ;;
    *) die "未知参数 $1" ;;
  esac
done

[[ -n "$DSN" ]] || die "缺少 --dsn"
[[ -n "$FROM" ]] || die "缺少 --from（设备名或设备 id）"
[[ -n "$TO" ]] || die "缺少 --to（设备名或设备 id）"
[[ "$MERGE" == "abort" || "$MERGE" == "sum" ]] || die "--merge 只支持 abort|sum"
command -v psql >/dev/null 2>&1 || die "找不到 psql（可改用容器里的 psql，见文件头说明）"

# schema 走 PGOPTIONS，不要用 `SET search_path` 拼进 SQL：那会在 -At 输出里
# 多出一行 "SET"，把解析结果顶歪（踩过一次）。
PGOPT=""
[[ -n "$SCHEMA" ]] && PGOPT="-c search_path=$SCHEMA"
run_psql() { PGOPTIONS="$PGOPT" psql "$DSN" -v ON_ERROR_STOP=1 "$@"; }

# --from/--to 允许写设备名（唯一时）或设备 id。名字不唯一就让人用 id。
resolve() {
  local who="$1" ident="$2" out count
  out=$(run_psql -At -F$'\t' -c "
    SELECT id, device_name, COALESCE(machine_id,''), (revoked_at IS NOT NULL)
      FROM devices WHERE id = '$ident' OR device_name = '$ident'")
  count=$(printf '%s\n' "$out" | grep -c . || true)
  if [[ "$count" == "0" ]]; then
    die "$who：找不到设备 '$ident'"
  fi
  if [[ "$count" != "1" ]]; then
    echo "$who：'$ident' 匹配到多台设备，请改用设备 id：" >&2
    printf '%s\n' "$out" | sed 's/^/  /' >&2
    exit 1
  fi
  printf '%s\n' "$out"
}

read -r FROM_ID FROM_NAME FROM_MID FROM_REVOKED <<<"$(resolve "--from" "$FROM")"
read -r TO_ID TO_NAME TO_MID TO_REVOKED <<<"$(resolve "--to" "$TO")"

[[ "$FROM_ID" != "$TO_ID" ]] || die "--from 与 --to 是同一台设备"
[[ "$TO_REVOKED" == "f" ]] || die "目标设备 '$TO_NAME' 已撤销，先恢复它（resume-device）再搬"

# 同一条范围条件要出现在三处 SQL 里：两处有 JOIN（必须带别名限定），一处没有。
RANGE="TRUE"
RANGE_S="TRUE"
if [[ -n "$SINCE" ]]; then
  RANGE="$RANGE AND hour_start >= '$SINCE'"
  RANGE_S="$RANGE_S AND s.hour_start >= '$SINCE'"
fi
if [[ -n "$UNTIL" ]]; then
  RANGE="$RANGE AND hour_start < '$UNTIL'"
  RANGE_S="$RANGE_S AND s.hour_start < '$UNTIL'"
fi

echo "从 : $FROM_NAME  ($FROM_ID, machine_id=${FROM_MID:-(空)})"
echo "到 : $TO_NAME  ($TO_ID, machine_id=${TO_MID:-(空)})"
[[ -n "$SINCE$UNTIL" ]] && echo "范围: ${SINCE:-最早} .. ${UNTIL:-最晚}"
echo

# ---------- 预检 ----------
READ_Q="
WITH src AS (
  SELECT * FROM hourly WHERE device_id = '$FROM_ID' AND $RANGE
), conf AS (
  SELECT s.hour_start, s.source, s.model, s.total_tokens AS src_tokens, t.total_tokens AS dst_tokens
    FROM src s
    JOIN hourly t ON t.user_id = s.user_id AND t.device_id = '$TO_ID'
                 AND t.hour_start = s.hour_start AND t.source = s.source AND t.model = s.model
)
SELECT (SELECT count(*) FROM src),
       (SELECT COALESCE(sum(total_tokens),0) FROM src),
       (SELECT count(*) FROM conf),
       (SELECT COALESCE(sum(src_tokens),0) FROM conf);"

IFS=$'\t' read -r N_ROWS N_TOKENS N_CONF N_CONF_TOKENS <<<"$(run_psql -At -F$'\t' -c "$READ_Q")"

echo "待搬迁: $N_ROWS 行 / $N_TOKENS tokens"
echo "主键冲突: $N_CONF 行 / $N_CONF_TOKENS tokens（目标设备已有同一 (hour_start,source,model)）"

if [[ "$N_ROWS" == "0" ]]; then
  echo "没有要搬的行，退出。"
  exit 0
fi

if [[ "$N_CONF" != "0" && "$MERGE" == "abort" ]]; then
  cat >&2 <<EOF

预检发现 $N_CONF 行主键冲突，默认不搬（避免重复计数或覆盖）。
先看这几行：psql "\$TT_DATABASE_URL" -c "SELECT s.hour_start,s.source,s.model,s.total_tokens AS src,t.total_tokens AS dst
  FROM hourly s JOIN hourly t ON t.user_id=s.user_id AND t.device_id='$TO_ID'
   AND t.hour_start=s.hour_start AND t.source=s.source AND t.model=s.model
 WHERE s.device_id='$FROM_ID' AND $RANGE ORDER BY s.hour_start LIMIT 20;"

确认两边是"同一批数据的上报"时，用 --merge=sum（数值相加后合并），否则请先人工核对。
EOF
  exit 2
fi

if [[ "$APPLY" != "1" ]]; then
  echo
  echo "（试运行，未写库。确认后加 --apply）"
  exit 0
fi

# ---------- 搬迁 ----------
# 冲突行：SUM 合并（数值相加，费用转 numeric 后相加），再删源行；其余行直接改 device_id。
MERGE_SQL=""
if [[ "$N_CONF" != "0" ]]; then
  MERGE_SQL="
  WITH conf AS (
    SELECT s.user_id, s.hour_start, s.source, s.model,
           s.input_tokens, s.cached_input_tokens, s.cache_creation_input_tokens,
           s.output_tokens, s.reasoning_output_tokens, s.total_tokens, s.billable_total_tokens,
           s.conversations, s.total_cost_usd
      FROM hourly s
      JOIN hourly t ON t.user_id = s.user_id AND t.device_id = '$TO_ID'
                   AND t.hour_start = s.hour_start AND t.source = s.source AND t.model = s.model
     WHERE s.device_id = '$FROM_ID' AND $RANGE_S
  )
  UPDATE hourly t SET
    input_tokens                = t.input_tokens + c.input_tokens,
    cached_input_tokens         = t.cached_input_tokens + c.cached_input_tokens,
    cache_creation_input_tokens = t.cache_creation_input_tokens + c.cache_creation_input_tokens,
    output_tokens               = t.output_tokens + c.output_tokens,
    reasoning_output_tokens     = t.reasoning_output_tokens + c.reasoning_output_tokens,
    total_tokens                = t.total_tokens + c.total_tokens,
    billable_total_tokens       = COALESCE(t.billable_total_tokens,0) + COALESCE(c.billable_total_tokens,0),
    conversations               = t.conversations + c.conversations,
    total_cost_usd              = (COALESCE(NULLIF(t.total_cost_usd,'')::numeric,0)
                                   + COALESCE(NULLIF(c.total_cost_usd,'')::numeric,0))::text
   FROM conf c
  WHERE t.user_id = c.user_id AND t.device_id = '$TO_ID'
    AND t.hour_start = c.hour_start AND t.source = c.source AND t.model = c.model;

  DELETE FROM hourly s
   USING hourly t
   WHERE s.device_id = '$FROM_ID' AND $RANGE_S
     AND t.user_id = s.user_id AND t.device_id = '$TO_ID'
     AND t.hour_start = s.hour_start AND t.source = s.source AND t.model = s.model;"
fi

run_psql <<SQL
BEGIN;
$MERGE_SQL

UPDATE hourly SET device_id = '$TO_ID' WHERE device_id = '$FROM_ID' AND $RANGE;

-- 聚合缓存按 user 失效（与 ingest 里的处理一致）：直接改库不会触发那行代码。
DELETE FROM usage_cache WHERE cache_key LIKE '%' || (SELECT user_id FROM devices WHERE id = '$TO_ID') || '%';
COMMIT;

\echo '--- 搬迁后 ---'
SELECT d.device_name, count(h.*) AS buckets, COALESCE(sum(h.total_tokens),0) AS total_tokens
  FROM devices d LEFT JOIN hourly h ON h.device_id = d.id AND h.user_id = d.user_id
 WHERE d.id IN ('$FROM_ID', '$TO_ID') GROUP BY d.id ORDER BY d.device_name;
\echo '--- 全库总计（应与搬迁前一致） ---'
SELECT count(*) AS hourly_rows, COALESCE(sum(total_tokens),0) AS total_tokens FROM hourly;
SQL

echo
echo "完成。总量若与搬迁前一致（$N_TOKENS tokens 已从 $FROM_NAME 移到 $TO_NAME），说明没有丢数据。"
