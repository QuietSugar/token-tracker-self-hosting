#!/usr/bin/env bash
# 从 tracking/REF 锁定的上游 commit 生成自托管产物到 releases/<VERSION>/。
# 不执行 psql、不上传函数、不写客户端 config。
# 覆盖已有产物请显式设置 FORCE=1。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REF_FILE="$ROOT/tracking/REF"
UPSTREAM_DIR="${UPSTREAM_DIR:-$(dirname "$ROOT")/TokenTracker}"
FORCE="${FORCE:-0}"

die() { echo "ERROR: $*" >&2; exit 1; }
ref() { sed -n "s/^$1=//p" "$REF_FILE" | head -1; }

VERSION="$(ref VERSION)"
COMMIT="$(ref COMMIT)"
[ -n "$VERSION" ] && [ -n "$COMMIT" ] || die "tracking/REF 内容不完整"
OUT="$ROOT/releases/$VERSION"

echo "=== 产物构建 ==="
echo "版本   : $VERSION"
echo "锁定点 : $COMMIT"
echo "输出   : $OUT"
echo

# 1) Node >= 20
node -e 'const m=+process.versions.node.split(".")[0]; if(m<20){console.error("需要 Node >= 20，当前 "+process.version);process.exit(1)}' \
  || die "Node 版本不满足"
echo "[1/6] Node $(node -v) ✓"

# 2) 上游 checkout 必须正好在锁定点
[ -d "$UPSTREAM_DIR/.git" ] || die "找不到上游 checkout: $UPSTREAM_DIR"
ACTUAL="$(git -C "$UPSTREAM_DIR" rev-parse HEAD)"
[ "$ACTUAL" = "$COMMIT" ] || die "上游 HEAD ($ACTUAL) 与锁定点 ($COMMIT) 不一致；请先 checkout 到锁定点"
echo "[2/6] 上游 HEAD 与锁定点一致 ✓"

# 3) 输出目录（防止静默覆盖已有审计产物）
if [ -f "$OUT/SHA256SUMS" ] && [ "$FORCE" != "1" ]; then
  die "产物已存在：$OUT/SHA256SUMS。确认要覆盖请设置 FORCE=1"
fi
mkdir -p "$OUT/functions"
# 清理旧函数文件，避免上游删函数后残留
find "$OUT/functions" -mindepth 1 -maxdepth 1 -type f -delete
echo "[3/6] 输出目录就绪 ✓"

# 4) 依赖（build-functions.cjs 会校验版本与 package-lock.json）
if [ ! -d "$UPSTREAM_DIR/node_modules/alipay-sdk" ] || \
   [ ! -d "$UPSTREAM_DIR/node_modules/@waffo/pancake-ts" ] || \
   [ ! -d "$UPSTREAM_DIR/node_modules/urllib" ]; then
  echo "[4/6] 安装上游根依赖 npm ci ..."
  (cd "$UPSTREAM_DIR" && npm ci)
else
  echo "[4/6] 上游依赖已存在 ✓"
fi

# 5) 生成产物
echo "[5/6] 生成 SQL 与 14 个私有函数 ..."
# 可复现：用上游 commit 时间作为 SOURCE_DATE_EPOCH，让 CI 构建产物与本地逐字节一致
export SOURCE_DATE_EPOCH="$(git -C "$UPSTREAM_DIR" log -1 --format=%ct "$COMMIT")"
export TT_VERSION="$VERSION"
(cd "$UPSTREAM_DIR" && node scripts/self-host/install.cjs --sql "$OUT/tokentracker-install.sql")
(cd "$UPSTREAM_DIR" && node scripts/self-host/install.cjs --migration "$OUT/tokentracker-migration.sql")
(cd "$UPSTREAM_DIR" && node scripts/self-host/build-functions.cjs "$OUT/functions")
# 统一权限，保证容器内以非 root 用户也能读取（OCI 层权限可复现）
chmod 644 "$OUT"/tokentracker-*.sql "$OUT"/functions/*.js "$OUT"/functions/functions.json
node "$ROOT/scripts/summarize.cjs" "$UPSTREAM_DIR" "$OUT" > "$OUT/manifest-report.md"

# 6) 校验和（排除 SHA256SUMS 自身；路径相对 releases/<ver>/ 便于 sha256sum -c）
(cd "$OUT" && find . -type f ! -name SHA256SUMS -printf '%P\0' \
  | sort -z | xargs -0 sha256sum > SHA256SUMS)
echo "[6/6] SHA256SUMS 已生成 ✓"
echo
echo "=== 产物 ==="
(cd "$OUT" && cat SHA256SUMS)
echo
echo "=== 步骤与函数摘要（详见 manifest-report.md）==="
grep -E '安装步骤数|私有函数数' "$OUT/manifest-report.md" || true
echo
echo "完成。下一步：./scripts/verify.sh releases/$VERSION && git add releases/$VERSION && git commit"
