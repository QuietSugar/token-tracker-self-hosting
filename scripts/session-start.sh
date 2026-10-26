#!/usr/bin/env bash
# 每次维护会话的第一条命令：从仓库恢复完整上下文。
# 只读（除了 upstream.sh status 读取本地 git 状态），不联网、不修改任何东西。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

bar() { echo "────────────────────────────────────────────────────────"; }

echo
echo "╔══════════════════════════════════════════════════════╗"
echo "║  TokenTracker 自托管维护 — 会话状态快照               ║"
echo "╚══════════════════════════════════════════════════════╝"
echo "  时间: $(date -u '+%Y-%m-%d %H:%M UTC')   仓库: $(basename "$ROOT")"

echo; bar; echo "▌0. 环境自检（remote / 提交身份）"
if url="$(git remote get-url origin 2>/dev/null)"; then
  echo "  origin      : $url"
else
  echo "  ⚠️ origin 缺失 —— 先跑 ./scripts/bootstrap.sh"
fi
if name="$(git config user.name 2>/dev/null)" && email="$(git config user.email 2>/dev/null)" && [ -n "$name" ]; then
  echo "  提交身份    : $name <$email>"
else
  echo "  ⚠️ 提交身份缺失 —— 先跑 ./scripts/bootstrap.sh（否则 git commit 会失败）"
fi
app_cfg="${GH_APP_CONFIG:-$HOME/.config/tokentracker-gh-app/config.env}"
if [ -f "$app_cfg" ]; then
  echo "  GitHub App  : 已配置 ($app_cfg)"
  echo "                推送用 ./scripts/push-with-app.sh -u origin main"
else
  echo "  GitHub App  : ⚠️ 未配置（见 docs/github-app-setup.md）"
fi

echo; bar; echo "▌1. 当前锁定点 (tracking/REF)"
sed -n '/^[A-Z_]*=/p' tracking/REF

echo; bar; echo "▌2. 版本追踪表"
sed -n '/^| 上游版本/,/^$/p' tracking/upstream.md | head -12

echo; bar; echo "▌3. 本仓库最近提交"
git log --oneline -6

echo; bar; echo "▌4. 已生成的产物版本"
found=0
for d in releases/*/; do
  [ -d "$d" ] || continue
  case "$d" in *_template*) continue;; esac
  found=1
  if [ -f "${d}SHA256SUMS" ]; then
    echo "  $(basename "$d")  [有 SHA256SUMS ✓]"
  else
    echo "  $(basename "$d")  [无产物]"
  fi
done
[ "$found" = "0" ] && echo "  (尚无产物 — 首次实施未开始)"

echo; bar; echo "▌5. 未完成待办（README / releases 里的 [ ]）"
grep -rnE '^\s*- \[ \]' README.md releases/ --include='*.md' 2>/dev/null | head -20 || echo "  (无)"
echo "  提示: 完整待办见 README「当前状态」与 releases/<ver>/acceptance.md"

echo; bar; echo "▌6. 上游 checkout 状态（不联网）"
./scripts/upstream.sh status 2>&1 || echo "  (上游 checkout 不可用，设 UPSTREAM_DIR 指向它)"

echo; bar; echo "▌7. 安全检查"
./scripts/check-secrets.sh 2>&1 || echo "  ⚠️ 密钥扫描未通过 — 不要推送"

echo; bar; echo "▌8. 恢复上下文后该读什么"
cat <<'EOF'
  1) MAINTENANCE.md          角色 / 规则 / SOP（最高优先级）
  2) tracking/REF            锁定点
  3) tracking/upstream.md    版本追踪 + 契约判定规则
  4) releases/<最新>/review.md + acceptance.md
  5) docs/maintainer-prompt.md
EOF

echo; bar; echo "▌9. 常用下一步"
cat <<'EOF'
  检查上游  : ./scripts/upstream.sh review
  锁定新点  : ./scripts/upstream.sh pin <sha> <version>
  生成产物  : ./scripts/build.sh && ./scripts/verify.sh releases/<ver>
  推送前    : ./scripts/check-secrets.sh && git push
  完整 SOP  : MAINTENANCE.md 第 3 节
EOF
echo
