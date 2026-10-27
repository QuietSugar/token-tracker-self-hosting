#!/usr/bin/env bash
# 打印一个可直接使用的 HS256 JWT（局域网自用场景的"登录替代品"）。
#
# 背景：Go 后端只**验证** JWT，不提供注册/登录。自用部署不需要账号体系，
#       用本脚本按 TT_JWT_SECRET 签一个长期 token 即可。
#       本脚本是独立工具，不参与服务端逻辑；将来接入正式认证后可直接弃用。
#
# 用法:
#   export TT_JWT_SECRET="$(openssl rand -hex 32)"      # 与服务端一致
#   ./issue-token.sh                                     # 365 天、authenticated、自动生成 sub
#   ./issue-token.sh --sub 11111111-1111-4111-8111-111111111111
#   ./issue-token.sh --role project_admin --days 30       # 调 /api/database/rpc/* 时用
#   ./issue-token.sh --json                               # 只输出 token，便于脚本取值
#
# 依赖：python3（几乎所有发行版自带）。没有 python3 时回退到 openssl。
set -euo pipefail

usage() { sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }

SUB=""; ROLE="authenticated"; DAYS="365"; JSON_ONLY="0"; SECRET="${TT_JWT_SECRET:-}"
# 固定一个默认账户 UUID，方便首次使用后多处复用同一账户
DEFAULT_SUB="11111111-1111-4111-8111-111111111111"

while [ $# -gt 0 ]; do
  case "$1" in
    --sub)    SUB="${2:?}"; shift 2 ;;
    --role)   ROLE="${2:?}"; shift 2 ;;
    --days)   DAYS="${2:?}"; shift 2 ;;
    --secret) SECRET="${2:?}"; shift 2 ;;
    --json)   JSON_ONLY="1"; shift ;;
    -h|--help) usage ;;
    *) echo "未知参数: $1" >&2; usage ;;
  esac
done

[ -n "$SUB" ] || SUB="$DEFAULT_SUB"
[ -n "$SECRET" ] || { echo "错误: 未设置 TT_JWT_SECRET（或用 --secret 传入）" >&2; exit 1; }
SECRET_LEN=$(printf '%s' "$SECRET" | wc -c | tr -d ' ')
[ "$SECRET_LEN" -ge 32 ] || { echo "错误: TT_JWT_SECRET 必须 ≥32 字节（当前 $SECRET_LEN）" >&2; exit 1; }
case "$ROLE" in
  authenticated|project_admin|anon) ;;
  *) echo "错误: --role 只能是 authenticated / project_admin / anon" >&2; exit 1 ;;
esac
case "$DAYS" in
  ''|*[!0-9]*) echo "错误: --days 必须是正整数" >&2; exit 1 ;;
esac

NOW=$(date +%s)
EXP=$((NOW + DAYS * 86400))

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

if command -v python3 >/dev/null 2>&1; then
  TOKEN=$(SECRET="$SECRET" SUB="$SUB" ROLE="$ROLE" EXP="$EXP" python3 - <<'PY'
import base64, hashlib, hmac, json, os

def b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")

secret = os.environ["SECRET"].encode()
header = {"alg": "HS256", "typ": "JWT"}
payload = {"sub": os.environ["SUB"], "role": os.environ["ROLE"], "exp": int(os.environ["EXP"])}
signing_input = b64(json.dumps(header, separators=(",", ":")).encode()) + "." + \
                b64(json.dumps(payload, separators=(",", ":")).encode())
sig = hmac.new(secret, signing_input.encode(), hashlib.sha256).digest()
print(signing_input + "." + b64(sig))
PY
)
else
  echo "提示: 未找到 python3，回退用 openssl 签名（结果等价）" >&2
  H=$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | b64url)
  P=$(printf '{"sub":"%s","role":"%s","exp":%s}' "$SUB" "$ROLE" "$EXP" | b64url)
  SIG=$(printf '%s.%s' "$H" "$P" | openssl dgst -sha256 -hmac "$SECRET" -binary | b64url)
  TOKEN="$H.$P.$SIG"
fi

if [ "$JSON_ONLY" = "1" ]; then
  printf '%s\n' "$TOKEN"
  exit 0
fi

cat <<EOF
✓ token 已生成（不写入磁盘，只打印）

sub   : $SUB
role  : $ROLE
过期  : $(date -u -d "@$EXP" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo "$EXP")

$TOKEN

用法示例（局域网内、已启动服务）：
  # 1) 账户摘要（首次会创建账户行，随后的上传/读取都归属这个 sub）
  curl -s -H "Authorization: Bearer \$TOKEN" \\
    'http://127.0.0.1:8080/functions/tokentracker-account-summary?from=2026-10-01&to=2026-10-31'

  # 2) 换一个设备 token（上传用量要用它，不是 JWT）
  curl -s -X POST -H "Authorization: Bearer \$TOKEN" -H 'Content-Type: application/json' \\
    -d '{"device_name":"desktop","platform":"linux","machine_id":"m-local"}' \\
    http://127.0.0.1:8080/functions/tokentracker-device-token-issue

  # 3) 调管理类 RPC 需要 project_admin：
  #    ./issue-token.sh --role project_admin

注意：
  - 拿到 token 就等于拿到该账户的全部读写权限，不要提交到 git、不要贴到群里。
  - 局域网未启用 HTTPS 时，token 在网络上为明文；仅在可信内网使用。
  - 轮换方式：换掉 TT_JWT_SECRET 并重启服务，所有旧 token 立即失效（客户端需重新配一次）。
EOF
