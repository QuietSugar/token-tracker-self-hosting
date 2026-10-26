#!/usr/bin/env bash
# 校验一个 release 目录：SHA-256 完整性、UTF-8 无 BOM、函数清单与文件数。
# 用法: ./scripts/verify.sh releases/1.4.12
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-}"
[ -n "$TARGET" ] || { echo "用法: verify.sh <release-dir>  例如 verify.sh releases/1.4.12"; exit 1; }
[ -d "$TARGET" ] || { echo "目录不存在: $TARGET"; exit 1; }
cd "$TARGET" || exit 1

echo "=== 校验目标 ==="
echo "$(pwd)"
echo

echo "=== [1/3] SHA-256 完整性 ==="
[ -f SHA256SUMS ] || { echo "缺少 SHA256SUMS"; exit 1; }
sha256sum -c SHA256SUMS
echo

echo "=== [2/3] 文本编码（UTF-8 / 无 BOM）==="
bash "$ROOT/scripts/check-encoding.sh" "$(pwd)"
echo

echo "=== [3/3] 函数产物 ==="
node -e '
const fs = require("node:fs");
const p = "functions/functions.json";
if (!fs.existsSync(p)) { console.error("缺少 functions/functions.json"); process.exit(1); }
const m = JSON.parse(fs.readFileSync(p, "utf8"));
const list = m.functions || [];
console.log("mode           :", m.mode);
console.log("schemaVersion  :", m.schemaVersion);
console.log("函数数量       :", list.length);
if (list.length !== 14) { console.error("期望 14 个私有函数"); process.exit(1); }
const missing = list.filter(f => !fs.existsSync("functions/" + f.file));
if (missing.length) { console.error("缺失函数文件:", missing.map(f => f.file).join(", ")); process.exit(1); }
const publicFns = list.filter(f => f.public).map(f => f.slug);
console.log("公开入口       :", publicFns.join(", ") || "(无)");
console.log("excluded       :", (m.excluded || []).join("; "));
'
echo
echo "✓ 全部校验通过：$(pwd)"
