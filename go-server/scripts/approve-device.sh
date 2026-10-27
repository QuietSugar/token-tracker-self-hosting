#!/usr/bin/env bash
# 批准一个 `tracker device-login` 的 user_code（TT_DEVICE_APPROVE=jwt 默认模式用）。
#
# 用法:
#   ./approve-device.sh ABCD-EFGH
#   ./approve-device.sh ABCD-EFGH --base https://tt.lan
#   ./approve-device.sh ABCD-EFGH --sub <user id>     # 远程机器：显式指定账户
#   TT_JWT_SECRET=... ./approve-device.sh ABCD-EFGH        # 未导出 secret 时用它内部签 token
#
# 为什么需要：官方客户端的 device-login 会打印一个 user_code 等你批准；
# 自托管没有官方 dashboard 页面时（TT_DEVICE_APPROVE=jwt），就在这里批。
# 想彻底免这一步，用 TT_DEVICE_APPROVE=auto 或 =page（见 README §3.6）。
set -euo pipefail

URL=""; CODE=""
BASE="${TT_BASE_URL:-http://127.0.0.1:8080}"
SUB=""   # 留空 = 由 issue-token.sh 解析本机 owner 账户
TOKEN="${TT_JWT:-}"

while [ $# -gt 0 ]; do
  case "$1" in
    --base) BASE="${2:?}"; shift 2 ;;
    --sub)  SUB="${2:?}"; shift 2 ;;
    --token) TOKEN="${2:?}"; shift 2 ;;
    -h|--help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "未知参数: $1" >&2; exit 2 ;;
    *) CODE="$1"; shift ;;
  esac
done

[ -n "$CODE" ] || { echo "用法: $0 <USER-CODE> [--base URL] [--sub UUID] [--token JWT]" >&2; exit 2; }
BASE="${BASE%/}"

if [ -z "$TOKEN" ]; then
  HERE="$(cd "$(dirname "$0")" && pwd)"
  if [ -n "$SUB" ]; then
    TOKEN="$("$HERE/issue-token.sh" --sub "$SUB" --base "$BASE" --json)"
  else
    TOKEN="$("$HERE/issue-token.sh" --base "$BASE" --json)"
  fi
fi

RESP="$(curl -fsS -X POST "$BASE/functions/tokentracker-device-flow-grant" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"user_code\":\"$CODE\"}")" || {
  echo "批准失败：请确认 user_code 正确、未过期（15 分钟），且服务端 TT_JWT_SECRET 与本脚本一致。" >&2
  exit 1
}

echo "$RESP" | python3 -c 'import json,sys;d=json.load(sys.stdin);print("已批准：status=%s sub=%s client=%s"%(d.get("status"),"默认账户",d.get("client_info","")) )' 2>/dev/null \
  || echo "$RESP"
echo "回到终端，device-login 会在一轮轮询（≤5 秒）内完成。"
