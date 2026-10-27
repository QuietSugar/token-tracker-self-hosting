#!/usr/bin/env bash
# 与上游的只读交互：查看锁定点、拉取上游、评审契约变化、锁定新 commit。
# 本脚本不修改上游工作区文件，只更新上游 git 的 FETCH_HEAD / objects。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REF_FILE="$ROOT/tracking/REF"
UPSTREAM_DIR="${UPSTREAM_DIR:-$(dirname "$ROOT")/TokenTracker}"

die() { echo "ERROR: $*" >&2; exit 1; }
ref() { sed -n "s/^$1=//p" "$REF_FILE" | head -1; }

[ -f "$REF_FILE" ] || die "缺少 $REF_FILE"
REPO_URL="$(ref REPO_URL)"
BRANCH="$(ref BRANCH)"
VERSION="$(ref VERSION)"
COMMIT="$(ref COMMIT)"
[ -n "$REPO_URL" ] && [ -n "$COMMIT" ] || die "tracking/REF 内容不完整"

# 契约路径（判定规则见 docs/maintainers/upstream.md）
CONTRACT_PATHS=(scripts/self-host 'docs/self-hosting*' dashboard/edge-patches/cloud scripts/build-cloud-functions.cjs migrations)

need_upstream() {
  [ -d "$UPSTREAM_DIR/.git" ] || die "找不到上游 checkout: $UPSTREAM_DIR（可设环境变量 UPSTREAM_DIR 覆盖）"
}

cmd_status() {
  echo "=== 锁定点 (tracking/REF) ==="
  echo "REPO      : $REPO_URL"
  echo "BRANCH    : $BRANCH"
  echo "VERSION   : $VERSION"
  echo "COMMIT    : $COMMIT"
  echo "PINNED_AT : $(ref PINNED_AT)"
  echo
  need_upstream
  local head dirty content_changes mode_changes
  head="$(git -C "$UPSTREAM_DIR" rev-parse HEAD)"
  dirty="$(git -C "$UPSTREAM_DIR" status --porcelain | wc -l | tr -d ' ')"
  # --numstat 对纯权限位变更输出 "0\t0\tfile"，必须过滤掉再计数
  content_changes="$(git -C "$UPSTREAM_DIR" diff --numstat \
    | awk '$1!="0" || $2!="0" {n++} END {print n+0}')"
  mode_changes="$(git -C "$UPSTREAM_DIR" diff --summary | wc -l | tr -d ' ')"
  echo "=== 本地上游 checkout ==="
  echo "DIR       : $UPSTREAM_DIR"
  echo "HEAD      : $head"
  echo "WORKTREE  : $dirty 个变更（内容变更 $content_changes / 仅权限位 $mode_changes）"
  if [ "$content_changes" != "0" ]; then
    echo "注意      : 上游工作区有内容改动，生成产物前请确认其来源（可能污染可复现性）"
  elif [ "$mode_changes" != "0" ]; then
    echo "注意      : 仅文件权限位不同（常见于沙箱/挂载），不影响 node 脚本执行"
  fi
  if [ "$head" = "$COMMIT" ]; then
    echo "结果      : 一致 ✓（可以 build.sh）"
  else
    echo "结果      : 不一致 ✗（build.sh 会拒绝生成产物；请先 checkout 到锁定点）"
  fi
}

cmd_fetch() {
  need_upstream
  echo "拉取 $REPO_URL ($BRANCH) ..."
  # 用显式 URL 而非 remote 名：某些 checkout 没有 .git/config 里的 origin
  git -C "$UPSTREAM_DIR" fetch --no-tags "$REPO_URL" "$BRANCH"
  echo "FETCH_HEAD=$(git -C "$UPSTREAM_DIR" rev-parse FETCH_HEAD)"
}

cmd_review() {
  need_upstream
  cmd_fetch
  local new old count diffstat
  new="$(git -C "$UPSTREAM_DIR" rev-parse FETCH_HEAD)"
  old="$COMMIT"
  echo
  echo "=== 锁定点 ==="
  echo "$old  ($VERSION)"
  echo "=== 上游最新 ($BRANCH) ==="
  echo "$new"
  if [ "$new" = "$old" ]; then
    echo
    echo "结论：上游无新提交，本仓库无需动作。"
    return 0
  fi
  count="$(git -C "$UPSTREAM_DIR" rev-list --count "$old..$new" 2>/dev/null || echo '?')"
  echo
  echo "=== 新增提交 $old..$new（共 $count 个，最多列 50）==="
  git -C "$UPSTREAM_DIR" log --oneline "$old..$new" | head -50
  echo
  echo "=== 自托管契约 diff（判定依据）==="
  diffstat="$(git -C "$UPSTREAM_DIR" diff --stat "$old" "$new" -- "${CONTRACT_PATHS[@]}")"
  if [ -z "$diffstat" ]; then
    echo "(空)"
    echo
    echo "结论：自托管后端契约未变 → 后端无需动作；只需评估客户端是否值得升级。"
  else
    echo "$diffstat"
    echo
    echo "结论：自托管契约可能变化 → 按 docs/maintainers/upstream.md §3 做升级评审。"
    echo
    echo "--- manifest.cjs 差异（steps/privateFunctions）---"
    git -C "$UPSTREAM_DIR" diff "$old" "$new" -- scripts/self-host/manifest.cjs | head -100 || true
  fi
  echo
  echo "=== 客户端侧变化规模（参考）==="
  git -C "$UPSTREAM_DIR" diff --stat "$old" "$new" -- src dashboard/src | tail -8 || true
  echo
  echo "提醒：评审后请更新 docs/maintainers/upstream.md 的版本追踪表（两个结论）。"
}

cmd_pin() {
  local sha="${1:-}" ver="${2:-}"
  [ -n "$sha" ] && [ -n "$ver" ] || die "用法: upstream.sh pin <commit-sha> <version>"
  need_upstream
  git -C "$UPSTREAM_DIR" cat-file -e "$sha^{commit}" 2>/dev/null || die "上游不存在该 commit: $sha"
  local full today
  full="$(git -C "$UPSTREAM_DIR" rev-parse "$sha^{commit}")"
  today="$(date +%F)"
  sed -i \
    -e "s/^VERSION=.*/VERSION=$ver/" \
    -e "s/^COMMIT=.*/COMMIT=$full/" \
    -e "s/^PINNED_AT=.*/PINNED_AT=$today/" \
    -e "s/^PINNED_BY=.*/PINNED_BY=upstream.sh pin/" \
    "$REF_FILE"
  echo "已更新 tracking/REF: VERSION=$ver COMMIT=$full"
  echo "下一步：把上游 checkout 移到该 commit（git -C \"$UPSTREAM_DIR\" checkout main && pull --ff-only），再 ./scripts/build.sh"
}

usage() {
  cat <<'EOF'
用法: ./scripts/upstream.sh <command>

  status            显示锁定点与本地上游 checkout 是否一致（只读）
  fetch             拉取上游 main 到 FETCH_HEAD（不切换工作区）
  review            fetch + 新提交列表 + 自托管契约 diff + 结论（只读评审）
  pin <sha> <ver>   更新 tracking/REF 到新的上游构建点

环境变量:
  UPSTREAM_DIR      上游 checkout 路径，默认 ../TokenTracker

示例:
  ./scripts/upstream.sh review
  ./scripts/upstream.sh pin 8d32a956181bf52fae449c89b8f6520253566283 1.4.12
EOF
}

case "${1:-help}" in
  status)  cmd_status ;;
  fetch)   cmd_fetch ;;
  review)  cmd_review ;;
  pin)     shift; cmd_pin "$@" ;;
  help|-h|--help|*) usage ;;
esac
