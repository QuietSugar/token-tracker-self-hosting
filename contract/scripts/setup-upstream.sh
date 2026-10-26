#!/usr/bin/env bash
# 准备上游 checkout 与测试依赖。CI 与本地共用。
# 只读上游源码；测试专用依赖（@insforge/sdk）通过 npm install --no-save 装到上游 node_modules。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UPSTREAM="${UPSTREAM_DIR:-$(dirname "$ROOT")/TokenTracker}"
REF="$ROOT/tracking/REF"

ref() { sed -n "s/^$1=//p" "$REF" | head -1; }
COMMIT="$(ref COMMIT)"
[ -n "$COMMIT" ] || { echo "ERROR: tracking/REF 缺少 COMMIT" >&2; exit 1; }

echo "=== 准备上游测试环境 ==="
echo "目录  : $UPSTREAM"
echo "锁定点: $COMMIT"

if [ ! -d "$UPSTREAM/.git" ]; then
  echo "[1/3] 克隆上游 ..."
  git clone -q https://github.com/xiufengsun/TokenTracker.git "$UPSTREAM"
else
  echo "[1/3] 上游 checkout 已存在"
fi

HEAD="$(git -C "$UPSTREAM" rev-parse HEAD)"
if [ "$HEAD" != "$COMMIT" ]; then
  echo "[2/3] 切换到锁定 commit ..."
  git -C "$UPSTREAM" fetch -q --depth=1 origin "$COMMIT"
  git -C "$UPSTREAM" checkout -q FETCH_HEAD
fi
ACTUAL="$(git -C "$UPSTREAM" rev-parse HEAD)"
[ "$ACTUAL" = "$COMMIT" ] || { echo "ERROR: 上游 HEAD $ACTUAL != $COMMIT" >&2; exit 1; }

echo "[3/3] 安装依赖 ..."
if [ ! -d "$UPSTREAM/node_modules/esbuild" ]; then
  (cd "$UPSTREAM" && npm ci --no-audit --no-fund)
fi
# @insforge/sdk 是 Deno 的 npm: 运行时依赖，上游 lockfile 里没有；测试 fixture 需要它。
# --no-save 保证不改上游 package.json / package-lock.json。
if [ ! -d "$UPSTREAM/node_modules/@insforge/sdk" ]; then
  (cd "$UPSTREAM" && npm install --no-save --no-audit --no-fund --ignore-scripts @insforge/sdk@1.4.5)
fi
node -e "require('$UPSTREAM/node_modules/@insforge/sdk')" 2>/dev/null \
  || { echo "WARN: SDK require 失败（fixture 用 esbuild alias 到 dist/index.mjs，可能正常）"; }

echo "✓ 上游测试环境就绪"
echo "  Node: $(node -v)"
echo "  SDK : $(cat "$UPSTREAM/node_modules/@insforge/sdk/package.json" | python3 -c 'import sys,json;print(json.load(sys.stdin)["version"])')"
