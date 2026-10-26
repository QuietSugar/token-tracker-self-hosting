#!/usr/bin/env bash
# 用 GitHub App 的 installation token 推送。
# token 通过 GIT_ASKPASS 注入单次 push 进程：不进 URL、不写 .git/config、不落 shell 历史。
#
# 用法:
#   ./scripts/push-with-app.sh --dry-run          # 只验证配置并换取 token，不推送
#   ./scripts/push-with-app.sh -u origin main     # 实际推送（参数原样传给 git push）
#
# 配置文件（在仓库之外，绝不入库）：
#   ~/.config/tokentracker-gh-app/config.env
#     GH_APP_ID=123456                 # 或 GH_APP_CLIENT_ID=Iv23...
#     GH_INSTALLATION_ID=87654321
#     GH_APP_PRIVATE_KEY_PATH=/home/user/.config/tokentracker-gh-app/private-key.pem
#   ~/.config/tokentracker-gh-app/private-key.pem   (chmod 600)
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="${GH_APP_CONFIG:-$HOME/.config/tokentracker-gh-app/config.env}"

[ -f "$CONFIG" ] || { echo "ERROR: 缺少配置文件 $CONFIG（见 docs/github-app-setup.md §6）" >&2; exit 1; }
# shellcheck disable=SC1090
set -a; . "$CONFIG"; set +a
export GH_APP_ID="${GH_APP_ID:-${GH_APP_CLIENT_ID:-}}"
export GH_INSTALLATION_ID="${GH_INSTALLATION_ID:-}"
export GH_APP_PRIVATE_KEY_PATH="${GH_APP_PRIVATE_KEY_PATH:-}"

for pair in "GH_APP_ID:$GH_APP_ID" "GH_INSTALLATION_ID:$GH_INSTALLATION_ID" "GH_APP_PRIVATE_KEY_PATH:$GH_APP_PRIVATE_KEY_PATH"; do
  key="${pair%%:*}"; val="${pair#*:}"
  [ -n "$val" ] || { echo "ERROR: 配置项 $key 为空" >&2; exit 1; }
done
[ -f "$GH_APP_PRIVATE_KEY_PATH" ] || { echo "ERROR: 私钥文件不存在: $GH_APP_PRIVATE_KEY_PATH" >&2; exit 1; }
perm="$(stat -c '%a' "$GH_APP_PRIVATE_KEY_PATH" 2>/dev/null || echo '?')"
[ "$perm" = "600" ] || echo "WARN: 私钥权限为 $perm，建议 chmod 600" >&2

TMPD="$(mktemp -d)"; chmod 700 "$TMPD"
TOKEN_FILE="$TMPD/token"; ASKPASS="$TMPD/askpass.sh"
cleanup() { rm -rf "$TMPD"; }
trap cleanup EXIT INT TERM

echo "=== 换取 installation token ==="
node "$ROOT/scripts/gh-app-token.cjs" "$TOKEN_FILE" || exit 1
[ -s "$TOKEN_FILE" ] || { echo "ERROR: token 文件为空" >&2; exit 1; }

cat > "$ASKPASS" <<'EOF'
#!/bin/sh
case "$1" in
  *Username*|*username*) printf '%s\n' 'x-access-token' ;;
  *Password*|*password*) tr -d '\r\n' < "$TT_TOKEN_FILE"; printf '\n' ;;
  *) printf '\n' ;;
esac
EOF
chmod 700 "$ASKPASS"
export TT_TOKEN_FILE="$TOKEN_FILE"

if [ "${1:-}" = "--dry-run" ]; then
  echo "✓ dry-run 完成：App 认证可用，未执行 push。"
  exit 0
fi

echo "=== git push ==="
REDACT='s/(ghs_|ghu_|ghr_|github_pat_|ghp_|gho_)[A-Za-z0-9_.=-]{20,}/***REDACTED***/g'
GIT_ASKPASS="$ASKPASS" GIT_TERMINAL_PROMPT=0 \
  git -C "$ROOT" -c core.askPass="$ASKPASS" push "$@" 2>&1 \
  | sed -E "$REDACT"
rc=${PIPESTATUS[0]}
echo "push_exit=$rc"
exit "$rc"
