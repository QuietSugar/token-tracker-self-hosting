#!/usr/bin/env bash
# 录制黄金快照：用参考实现（PG + TypeScript）跑全部契约用例。
# 用法: ./contract/scripts/record.sh [--out DIR] [--seed SEED] [--only CASE_ID]
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

export CONTRACT_CONCURRENCY="${CONTRACT_CONCURRENCY:-1}"
export CONTRACT_NOW="${CONTRACT_NOW:-2026-10-26T00:00:00Z}"

echo "=== 契约录制 ==="
./contract/scripts/setup-upstream.sh
echo

VERSION="$(sed -n 's/^VERSION=//p' tracking/REF | head -1)"
OUT="${1:-$ROOT/contract/golden/$VERSION}"
shift 2>/dev/null || true

node contract/lib/recorder.cjs --out "$OUT" "$@"
echo
echo "=== 校验录制结果 ==="
(cd "$OUT" && sha256sum -c SHA256SUMS | tail -3)
echo
echo "✓ 录制完成。下一步：./contract/scripts/self-test.sh"
