#!/usr/bin/env bash
# 性能基准。可选：BENCH_ITERATIONS=5 CONTRACT_ADAPTER=... ./contract/scripts/benchmark.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
export CONTRACT_CONCURRENCY=1
export CONTRACT_NOW="${CONTRACT_NOW:-2026-10-26T00:00:00Z}"
./contract/scripts/setup-upstream.sh
echo
node contract/lib/benchmark.cjs
