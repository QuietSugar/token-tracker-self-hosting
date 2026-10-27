#!/usr/bin/env bash
# 自检自托管的认证流程：登录 → 刷新（轮换）→ 用 access token 读跨设备汇总。
#
# 用法:
#   ./check-oauth.sh                       # 用 TT_AUTH_EMAIL/TT_AUTH_PASSWORD 或位置参数
#   ./check-oauth.sh me@lan.test '密码' https://tt.lan
#
# 退出码：0 = 全链路通；非 0 = 哪一步失败（脚本会打印响应体）。
set -euo pipefail

EMAIL="${1:-${TT_AUTH_EMAIL:-}}"
PASS="${2:-${TT_AUTH_PASSWORD:-}}"
BASE="${3:-${TT_BASE_URL:-http://127.0.0.1:8080}}"
BASE="${BASE%/}"

die() { echo "✗ $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "缺少依赖：$1"; }
need curl
need python3

[ -n "$EMAIL" ] && [ -n "$PASS" ] || die "用法: $0 <email> <password> [base-url]（或设 TT_AUTH_EMAIL/TT_AUTH_PASSWORD）"

py() { python3 -c "$1"; }

echo "→ $BASE/api/auth/public-config"
curl -fsS "$BASE/api/auth/public-config" | py 'import json,sys;d=json.load(sys.stdin);print("  emailSignIn=%s selfHosted=%s"%(d.get("emailSignIn"),d.get("selfHosted")))' \
  || die "public-config 不可达（服务没起来？地址错了？）"

echo "→ 登录"
SIGNIN=$(curl -fsS -c /tmp/tt-check-cookies.$$ -X POST -H 'Content-Type: application/json' \
  -d "$(EMAIL="$EMAIL" PASS="$PASS" py 'import json,os;print(json.dumps({"email":os.environ["EMAIL"],"password":os.environ["PASS"]}))')" \
  "$BASE/api/auth/sessions") || die "登录失败（邮箱/密码不对，或 owner 还没建）"
REFRESH=$(printf '%s' "$SIGNIN" | py 'import json,sys;print(json.load(sys.stdin)["refreshToken"])')
printf '%s' "$SIGNIN" | py 'import json,sys;d=json.load(sys.stdin);print("  user=%s accessToken=%dB csrf=%s"%(d["user"]["email"],len(d["accessToken"]),bool(d.get("csrfToken"))))'

echo "→ mobile 模式刷新（客户端 performMint 的做法）"
MINT=$(curl -fsS -X POST -H 'Content-Type: application/json' -d "{\"refresh_token\":\"$REFRESH\"}" \
  "$BASE/api/auth/refresh?client_type=mobile") || die "刷新失败"
ACCESS=$(printf '%s' "$MINT" | py 'import json,sys;print(json.load(sys.stdin)["accessToken"])')
NEWREFRESH=$(printf '%s' "$MINT" | py 'import json,sys;print(json.load(sys.stdin)["refreshToken"])')
[ "$NEWREFRESH" != "$REFRESH" ] || die "refresh token 没有被轮换（检查服务端版本）"
echo "  accessToken=${#ACCESS}B  refresh 已轮换 ✓"

echo "→ 旧 refresh token 应被拒绝"
CODE=$(curl -s -o /tmp/tt-check-old.$$ -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
  -d "{\"refresh_token\":\"$REFRESH\"}" "$BASE/api/auth/refresh?client_type=mobile")
[ "$CODE" = "401" ] || die "旧 token 仍可用（HTTP $CODE）——轮换语义没生效"
echo "  HTTP 401 ✓"

echo "→ 用 access token 读 account-summary"
FROM=$(date -u -d '30 days ago' +%Y-%m-%d 2>/dev/null || date -u -v-30d +%Y-%m-%d)
TO=$(date -u +%Y-%m-%d)
curl -fsS -H "Authorization: Bearer $ACCESS" \
  "$BASE/functions/tokentracker-account-summary?from=$FROM&to=$TO" \
  | py 'import json,sys;d=json.load(sys.stdin);t=d.get("totals",{});print("  %s → %s  total_tokens=%s cost=%s"%(d.get("from"),d.get("to"),t.get("total_tokens"),t.get("total_cost_usd")))' \
  || die "account-summary 读取失败"

echo "→ sessions/current"
curl -fsS -H "Authorization: Bearer $ACCESS" "$BASE/api/auth/sessions/current" \
  | py 'import json,sys;print("  ",json.load(sys.stdin)["user"]["email"])'

echo "→ 登出并确认 refresh 失效"
curl -fsS -X POST -H 'Content-Type: application/json' -d "{\"refresh_token\":\"$NEWREFRESH\"}" "$BASE/api/auth/logout" >/dev/null
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
  -d "{\"refresh_token\":\"$NEWREFRESH\"}" "$BASE/api/auth/refresh?client_type=mobile")
[ "$CODE" = "401" ] || die "登出后 refresh 仍可用（HTTP $CODE）"

rm -f /tmp/tt-check-cookies.$$ /tmp/tt-check-old.$$
echo
echo "✓ 全链路通：登录 / 轮换 / 撤销 / account 读取"
