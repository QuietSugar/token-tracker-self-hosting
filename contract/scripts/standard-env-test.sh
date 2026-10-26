#!/usr/bin/env bash
# L3 并发/锁语义测试：只能在真实多连接 PostgreSQL 上跑，PGlite 无法覆盖。
# 前置：./contract/scripts/standard-env.sh up
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="${STANDARD_ENV_DIR:-$HOME/insforge-standard}"
CRED="$WORK/credentials.env"
REPORT="$ROOT/contract/L3-RESULTS.md"

[ -f "$CRED" ] || { echo "ERROR: 先运行 ./contract/scripts/standard-env.sh up" >&2; exit 1; }
. "$CRED"; export PGPASSWORD
PGCONN="psql -h 127.0.0.1 -p 55432 -U postgres -d insforge"
L3_ENVIRONMENT="${L3_ENVIRONMENT:-official InsForge v2.3.3 four-container stack}"
SQL="$ROOT/releases/$(sed -n 's/^VERSION=//p' "$ROOT/tracking/REF" | head -1)/tokentracker-install.sql"

echo "=== L3 真实并发 / 锁语义测试 ==="
PGVER=$($PGCONN -tAc "SHOW server_version;" | cut -d' ' -f1)
echo "PostgreSQL: $PGVER"
echo

# --- T1: 跨连接 advisory lock 互斥 ---
echo "[T1] 跨连接 advisory lock 互斥"
( $PGCONN -q -c "BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('tokentracker:self-host-install',0)); SELECT pg_sleep(3); COMMIT;" >/dev/null 2>&1 ) &
P1=$!
sleep 0.5
T0=$(date +%s%N)
$PGCONN -q -c "BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('tokentracker:self-host-install',0)); COMMIT;" >/dev/null 2>&1
T1=$(date +%s%N)
wait $P1
WAIT_MS=$(( (T1-T0)/1000000 ))
echo "  会话2 等待 ${WAIT_MS}ms（期望 ≥2000ms）"
T1_PASS=false; [ "$WAIT_MS" -ge 2000 ] && T1_PASS=true

# --- T2: 8 连接并发重装（幂等 + 安装锁） ---
echo "[T2] 8 连接并发执行 install.sql"
for i in $(seq 1 8); do
  ( $PGCONN -v ON_ERROR_STOP=1 -f "$SQL" >/tmp/l3-concurrent-$i.log 2>&1; echo $? > /tmp/l3-concurrent-$i.rc ) &
done
wait || true   # set -e 下 wait 的无参返回值会触发退出；结果已在 .rc 文件里判定
RCS=$(for i in $(seq 1 8); do cat /tmp/l3-concurrent-$i.rc; done | tr '\n' ' ')
ERRS=$(grep -l ERROR /tmp/l3-concurrent-*.log 2>/dev/null | wc -l || true)
STEPS=$($PGCONN -tAc "SELECT count(*) FROM public.tokentracker_self_host_installations;")
echo "  退出码: $RCS"
echo "  错误数: $ERRS"
echo "  步骤数: $STEPS"
T2_PASS=false
[ "$(echo "$RCS" | tr -d ' 0')" = "" ] && [ "$ERRS" -eq 0 ] && [ "$STEPS" = "15" ] && T2_PASS=true

# --- T3: 安装前后 checksum 不变 ---
echo "[T3] 并发后 checksum 与 golden 一致"
CK1=$($PGCONN -tAc "SELECT checksum FROM public.tokentracker_self_host_installations WHERE step='01-private-baseline';")
CK_GOLDEN=$(cd "$ROOT/releases/$(sed -n 's/^VERSION=//p' "$ROOT/tracking/REF" | head -1)" && sha256sum <(sed -n 's/^| 1 | `01-private-baseline` | `\([a-f0-9]\{64\}\)`.*/\1/p' manifest-report.md) 2>/dev/null | cut -d' ' -f1 || true)
echo "  实际:   $CK1"
echo "  golden: $(grep -m1 '01-private-baseline' "$ROOT/releases/1.4.12/manifest-report.md" | grep -oE '[a-f0-9]{64}' | head -1)"
CK_EXPECT=$(grep -m1 '01-private-baseline' "$ROOT/releases/1.4.12/manifest-report.md" | grep -oE '[a-f0-9]{64}' | head -1)
T3_PASS=false; [ "$CK1" = "$CK_EXPECT" ] && T3_PASS=true

# --- T4: RLS 权限矩阵（真实角色） ---
echo "[T4] RLS / 角色权限矩阵"
PERMS=$($PGCONN -tAc "SELECT has_table_privilege('anon','tokentracker_hourly','SELECT'), has_table_privilege('authenticated','tokentracker_hourly','SELECT'), has_function_privilege('authenticated','cloud_ingest_usage(text,text,jsonb,jsonb,text)','EXECUTE'), has_function_privilege('authenticated','account_summary_wire(uuid,uuid,timestamptz,timestamptz,text,integer,text,text)','EXECUTE');" 2>&1)
echo "  anon_read|user_read|direct_upload|direct_private_read = $PERMS"
T4_PASS=false; [ "$PERMS" = "f|f|f|f" ] && T4_PASS=true

# --- T5: 真实并发写入不重复（ON CONFLICT 语义）---
echo "[T5] 并发写入幂等性（同一用户同一小时 10 次并发 upsert）"
UID_TEST=$($PGCONN -tAc "SELECT gen_random_uuid();")
# 真实 InsForge 的 auth.users.email 是 NOT NULL（PGlite fixture 里是简化表，无此约束）
$PGCONN -q -c "INSERT INTO auth.users(id,email) VALUES ('$UID_TEST'::uuid, 'l3-$UID_TEST@local.test') ON CONFLICT DO NOTHING;" 2>/dev/null || true
DEV=$($PGCONN -tAc "INSERT INTO public.tokentracker_devices(user_id,device_name,platform,machine_id) VALUES ('$UID_TEST'::uuid,'L3','test','l3-machine') RETURNING id;" | tr -d '\r' | grep -oE '^[0-9a-f-]{36}$')
# 注意：真实 schema 有 6 个 NOT NULL token 列，必须提供完整行
# （与上游 test/self-host-backend.test.js 的 row() 保持一致）
INSERT_SQL="INSERT INTO public.tokentracker_hourly
  (user_id,device_id,hour_start,source,model,input_tokens,cached_input_tokens,
   cache_creation_input_tokens,output_tokens,reasoning_output_tokens,
   total_tokens,billable_total_tokens,conversations,total_cost_usd)
  VALUES ('$UID_TEST'::uuid,'$DEV'::uuid,'2026-10-01T12:00:00Z','codex','gpt-6',
   100,0,0,0,0,100,100,1,0)
  ON CONFLICT (user_id,device_id,hour_start,source,model)
  DO UPDATE SET total_tokens=EXCLUDED.total_tokens, conversations=EXCLUDED.conversations;"
for i in $(seq 1 10); do
  ( $PGCONN -q -c "$INSERT_SQL" >/tmp/l3-upsert-$i.log 2>&1; echo $? > /tmp/l3-upsert-$i.rc ) &
done
wait || true
ROWS=$($PGCONN -tAc "SELECT count(*) FROM public.tokentracker_hourly WHERE user_id='$UID_TEST'::uuid;")
TOTAL=$($PGCONN -tAc "SELECT sum(total_tokens) FROM public.tokentracker_hourly WHERE user_id='$UID_TEST'::uuid;")
UPSERT_RCS=$(for i in $(seq 1 10); do cat /tmp/l3-upsert-$i.rc 2>/dev/null || echo 99; done | tr '\n' ' ')
UPSERT_ERRS=$(grep -l ERROR /tmp/l3-upsert-*.log 2>/dev/null | wc -l || true)
echo "  行数: $ROWS (期望1)  总计: $TOTAL (期望100)"
echo "  并发退出码: $UPSERT_RCS | 错误日志数: $UPSERT_ERRS"
T5_PASS=false; [ "$ROWS" = "1" ] && [ "$TOTAL" = "100" ] && [ "$UPSERT_ERRS" -eq 0 ] && [ "$(echo "$UPSERT_RCS" | tr -d ' 0')" = "" ] && T5_PASS=true
# 清理测试数据
$PGCONN -q -c "DELETE FROM auth.users WHERE id='$UID_TEST'::uuid;" 2>/dev/null || true

# --- 报告 ---
PASS=0; FAIL=0
for r in $T1_PASS $T2_PASS $T3_PASS $T4_PASS $T5_PASS; do [ "$r" = true ] && PASS=$((PASS+1)) || FAIL=$((FAIL+1)); done
cat > "$REPORT" <<EOF
# L3 真实并发语义测试结果

生成时间：$(date -u +%Y-%m-%dT%H:%M:%SZ)
环境：$L3_ENVIRONMENT，PostgreSQL **$PGVER**（真实多连接服务端）

| 测试 | 内容 | 结果 |
|---|---|---|
| T1 | 跨连接 advisory lock 互斥（会话2 等待 ${WAIT_MS}ms） | $([ "$T1_PASS" = true ] && echo ✅ PASS || echo ❌ FAIL) |
| T2 | 8 连接并发重装（退出码 $RCS，错误 $ERRS，步骤 $STEPS） | $([ "$T2_PASS" = true ] && echo ✅ PASS || echo ❌ FAIL) |
| T3 | 并发后 checksum 与 golden 一致 | $([ "$T3_PASS" = true ] && echo ✅ PASS || echo ❌ FAIL) |
| T4 | RLS / 角色权限矩阵（$PERMS） | $([ "$T4_PASS" = true ] && echo ✅ PASS || echo ❌ FAIL) |
| T5 | 10 并发 upsert 幂等（$ROWS 行 / $TOTAL tokens；rc=$UPSERT_RCS；errors=$UPSERT_ERRS） | $([ "$T5_PASS" = true ] && echo ✅ PASS || echo ❌ FAIL) |

**合计：$PASS PASS / $FAIL FAIL**

> 这一层是 PGlite（单连接 WASM）无法覆盖的。契约测试体系的 L1/L2 用 PGlite
> 做可复现的行为录制；L3 用真实 PostgreSQL 做并发/锁语义验证。两者互补。
EOF

echo
echo "=== 结果: $PASS PASS / $FAIL FAIL ==="
cat "$REPORT"
[ "$FAIL" -eq 0 ]
