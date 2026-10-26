#!/usr/bin/env bash
# 环境自举：恢复 git 的本地配置（remote / 提交身份）。
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
NAME="${SELFHOST_GIT_NAME:-TokenTracker Selfhost Maintainer}"
EMAIL="${SELFHOST_GIT_EMAIL:-selfhost@localhost}"

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

if [ "$NAME" = "TokenTracker Selfhost Maintainer" ]; then
  echo
  echo "提示: 这是占位身份，会显示在 public 提交历史里。想改用自己的："
  echo "  SELFHOST_GIT_NAME=\"你的名字\" SELFHOST_GIT_EMAIL=\"你的邮箱\" ./scripts/bootstrap.sh"
  echo "  （尚未推送前可用 git commit --amend --reset-author --no-edit 修正已有提交）"
fi

echo
echo "下一步: ./scripts/session-start.sh"
