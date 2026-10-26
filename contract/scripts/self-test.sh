#!/usr/bin/env bash
# 自测：用参考实现自己对比自己，应当 100% PASS。
# 这是整个测试体系的自洽性检查——如果这里失败，说明录制/归一化/对比链有 bug。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
export CONTRACT_CONCURRENCY="${CONTRACT_CONCURRENCY:-1}"
export CONTRACT_NOW="${CONTRACT_NOW:-2026-10-26T00:00:00Z}"

echo "=== 契约体系自测（reference vs reference golden）==="
./contract/scripts/setup-upstream.sh
echo
node contract/lib/verify.cjs \
  --adapter ./contract/adapters/reference.cjs \
  --report "$ROOT/contract/self-test-report.md" \
  --json
echo
echo "✓ 自测完成"
