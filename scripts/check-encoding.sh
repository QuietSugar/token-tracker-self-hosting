#!/usr/bin/env bash
# 检查指定目录（默认整个仓库）内文本文件为 UTF-8 且无 BOM。
# 用法: ./scripts/check-encoding.sh [目录]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-$ROOT}"
cd "$TARGET" || { echo "目录不存在: $TARGET" >&2; exit 1; }

python3 - <<'PY'
import pathlib, sys
exts = {'.md','.sql','.js','.cjs','.mjs','.ts','.json','.sh','.txt','.example',
        '.yml','.yaml','.env','.toml','.cfg','.ini','.cjs','.html','.css','REF'}
bad, checked = [], 0
for p in sorted(pathlib.Path('.').rglob('*')):
    if not p.is_file():
        continue
    if '.git' in p.parts or p.name == 'SHA256SUMS':
        continue
    if p.suffix not in exts and p.name not in {'REF', 'SHA256SUMS'}:
        continue
    b = p.read_bytes()
    checked += 1
    if b.startswith(b'\xef\xbb\xbf'):
        bad.append(f'  BOM: {p}')
    try:
        b.decode('utf-8')
    except UnicodeDecodeError as e:
        bad.append(f'  非 UTF-8: {p} ({e})')
if bad:
    print('\n'.join(bad))
    sys.exit(1)
print(f'OK: {checked} 个文本文件均为 UTF-8 且无 BOM')
PY
