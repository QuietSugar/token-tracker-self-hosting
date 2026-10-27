#!/usr/bin/env bash
# 对候选实现（Go + PostgreSQL）跑契约测试并对比 golden。
#
# 用法:
#   CONTRACT_ADAPTER=./contract/adapters/go-postgres.cjs ./contract/scripts/verify.sh
#   ./contract/scripts/verify.sh --static-only      # 只校验静态契约（无需运行时）
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
export CONTRACT_CONCURRENCY="${CONTRACT_CONCURRENCY:-1}"
export CONTRACT_NOW="${CONTRACT_NOW:-2026-10-26T00:00:00Z}"

ADAPTER="${CONTRACT_ADAPTER:-./contract/adapters/reference.cjs}"
echo "=== 契约一致性验证 ==="
echo "adapter: $ADAPTER"

if [ "$ADAPTER" = "./contract/adapters/reference.cjs" ]; then
  ./contract/scripts/setup-upstream.sh
  echo
fi

node contract/lib/verify.cjs --adapter "$ADAPTER" \
  --report "$ROOT/contract/report.md" --json "$@"
