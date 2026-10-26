#!/usr/bin/env bash
# 环境自举：恢复 git 的本地配置（remote / 提交身份），并检查 GitHub App 凭据是否就绪。
#
# 背景：本仓库的维护环境（沙箱工作区）快照不包含 .git/config 与 ~/.gitconfig，
#       因此每个新会话都会丢失 remote 与 user.name/user.email，但提交历史与 refs 仍在。
#       这个脚本把它们补回来。它只改 .git/config，不改任何被跟踪的文件。
#
# 用法:
#   ./scripts/bootstrap.sh
#   SELFHOST_GIT_NAME="Your Name" SELFHOST_GIT_EMAIL="you@example.com" ./scripts/bootstrap.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

REMOTE_URL="https://github.com/QuietSugar/token-tracker-self-hosting.git"
# 提交身份：与推送凭据（GitHub App）无关，仅决定 commit 的 author/committer。
NAME="${SELFHOST_GIT_NAME:-hall}"
EMAIL="${SELFHOST_GIT_EMAIL:-sugarjellyfish@gmail.com}"
APP_CONFIG="${GH_APP_CONFIG:-$HOME/.config/tokentracker-gh-app/config.env}"

echo "=== 环境自举 ==="

if current="$(git remote get-url origin 2>/dev/null)"; then
  if [ "$current" = "$REMOTE_URL" ]; then
    echo "[ok]   origin 已指向 $REMOTE_URL"
  else
    echo "[warn] origin 当前为 $current（与预期不同，未改动）"
    echo "       如需重置: git remote set-url origin $REMOTE_URL"
  fi
else
  git remote add origin "$REMOTE_URL"
  echo "[fix]  已添加 origin: $REMOTE_URL"
fi

git config user.name "$NAME"
git config user.email "$EMAIL"
echo "[ok]   提交身份: $NAME <$EMAIL>"

echo
echo "=== GitHub App 凭据 ==="
if [ -f "$APP_CONFIG" ]; then
  echo "[ok]   配置文件存在: $APP_CONFIG"
  key="$(sed -n 's/^GH_APP_PRIVATE_KEY_PATH=//p' "$APP_CONFIG" | head -1)"
  if [ -n "$key" ] && [ -f "$key" ]; then
    echo "[ok]   私钥存在: $key (权限 $(stat -c '%a' "$key" 2>/dev/null || echo '?'))"
  else
    echo "[warn] 私钥缺失，检查 $APP_CONFIG 里的 GH_APP_PRIVATE_KEY_PATH"
  fi
  echo "       推送: ./scripts/push-with-app.sh -u origin main"
else
  echo "[warn] 未配置 GitHub App 凭据，暂时无法推送。"
  echo "       配置方式见 docs/github-app-setup.md §6"
fi

echo
echo "下一步: ./scripts/session-start.sh"
