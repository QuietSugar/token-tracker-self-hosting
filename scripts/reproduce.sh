#!/usr/bin/env bash
# 从锁定上游 commit 重建产物，并与仓库内已审计的 releases/<VERSION>/ 逐字节比对。
# 这是 CI 的硬门槛：防止镜像产物与审计记录漂移（供应链完整性）。
#
# 用法:
#   ./scripts/reproduce.sh                       # 用默认 UPSTREAM_DIR
#   UPSTREAM_DIR=/path ./scripts/reproduce.sh    # 指定上游 checkout
#   KEEP=1 ./scripts/reproduce.sh                # 保留临时目录便于排查
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REF_FILE="$ROOT/tracking/REF"
UPSTREAM_DIR="${UPSTREAM_DIR:-$(dirname "$ROOT")/TokenTracker}"
KEEP="${KEEP:-0}"

die() { echo "ERROR: $*" >&2; exit 1; }
ref() { sed -n "s/^$1=//p" "$REF_FILE" | head -1; }

VERSION="$(ref VERSION)"
COMMIT="$(ref COMMIT)"
[ -n "$VERSION" ] && [ -n "$COMMIT" ] || die "tracking/REF 内容不完整"
AUDITED="$ROOT/releases/$VERSION"
[ -f "$AUDITED/SHA256SUMS" ] || die "找不到已审计产物: $AUDITED/SHA256SUMS"

echo "=== 可复现性校验 ==="
echo "版本     : $VERSION"
echo "锁定点   : $COMMIT"
echo "上游目录 : $UPSTREAM_DIR"
echo

[ -d "$UPSTREAM_DIR/.git" ] || die "找不到上游 checkout: $UPSTREAM_DIR"
HEAD="$(git -C "$UPSTREAM_DIR" rev-parse HEAD)"
[ "$HEAD" = "$COMMIT" ] || die "上游 HEAD ($HEAD) 与锁定点 ($COMMIT) 不一致"
echo "[1/5] 上游 commit 一致 ✓"

node -e 'const m=+process.versions.node.split(".")[0]; if(m<20){console.error("需要 Node >= 20，当前 "+process.version);process.exit(1)}' \
  || die "Node 版本不满足"
echo "[2/5] Node $(node -v) ✓"

if [ ! -d "$UPSTREAM_DIR/node_modules/esbuild" ] || \
   [ ! -d "$UPSTREAM_DIR/node_modules/alipay-sdk" ] || \
   [ ! -d "$UPSTREAM_DIR/node_modules/@waffo/pancake-ts" ]; then
  echo "[3/5] 安装上游依赖 npm ci ..."
  (cd "$UPSTREAM_DIR" && npm ci --no-audit --no-fund)
else
  echo "[3/5] 上游依赖已存在 ✓"
fi

TMP="$(mktemp -d)"
cleanup() { [ "$KEEP" = "1" ] || rm -rf "$TMP"; }
trap cleanup EXIT INT TERM
mkdir -p "$TMP/functions"

# 与 build.sh 完全相同的生成步骤 + 相同的可复现参数
export SOURCE_DATE_EPOCH="$(git -C "$UPSTREAM_DIR" log -1 --format=%ct "$COMMIT")"
export TT_VERSION="$VERSION"
(cd "$UPSTREAM_DIR" && node scripts/self-host/install.cjs --sql "$TMP/tokentracker-install.sql")
(cd "$UPSTREAM_DIR" && node scripts/self-host/install.cjs --migration "$TMP/tokentracker-migration.sql")
(cd "$UPSTREAM_DIR" && node scripts/self-host/build-functions.cjs "$TMP/functions")
chmod 644 "$TMP"/tokentracker-*.sql "$TMP"/functions/*.js "$TMP"/functions/functions.json
node "$ROOT/scripts/summarize.cjs" "$UPSTREAM_DIR" "$TMP" > "$TMP/manifest-report.md"
(cd "$TMP" && find . -type f ! -name SHA256SUMS -printf '%P\0' \
  | sort -z | xargs -0 sha256sum > SHA256SUMS)
echo "[4/5] 从上游源码重建完成（SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH）"

if ! diff -u "$AUDITED/SHA256SUMS" "$TMP/SHA256SUMS" > "$TMP/diff.txt"; then
  echo
  echo "✗ 产物与仓库审计记录不一致：" >&2
  cat "$TMP/diff.txt" >&2
  echo >&2
  echo "可能原因：上游 commit 变更、依赖版本漂移、脚本被修改。" >&2
  echo "禁止直接改 SHA256SUMS；应重新走评审并更新 releases/$VERSION/。" >&2
  [ "$KEEP" = "1" ] && echo "重建产物保留在: $TMP" >&2
  exit 1
fi
echo "[5/5] SHA256SUMS 逐字节一致 ✓"
echo
echo "✓ 可复现性校验通过：镜像将使用的产物可由 $COMMIT 完整重建。"
[ "$KEEP" = "1" ] && echo "临时目录: $TMP"
