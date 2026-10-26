#!/usr/bin/env bash
# 推送前密钥扫描 —— 公有仓库的强制关卡。
# 用法: ./scripts/check-secrets.sh   （在 git add / git push 前运行）
# 命中即非零退出；不要为了"过检查"而放宽这里，除非确认是误报。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
fail=0
blocked() { echo "BLOCKED: $*" >&2; fail=1; }

echo "=== 密钥扫描（public repo gate）==="

# 1) 不允许被 git 跟踪的敏感文件名
while IFS= read -r f; do
  case "$f" in
    *.key|*.pem|*.p12|*.pfx|*.secret|*.env|*/secrets/*|*credentials*|*tokentracker-config.json|*/config.json)
      blocked "敏感文件被跟踪: $f" ;;
  esac
done < <(git ls-files 2>/dev/null || true)

# 2) 已知密钥格式（高置信度，几乎不会误报）
patterns=(
  'ghp_[A-Za-z0-9]{20,}'
  'gho_[A-Za-z0-9]{20,}'
  'ghu_[A-Za-z0-9]{20,}'
  'ghs_[A-Za-z0-9]{20,}'
  'github_pat_[A-Za-z0-9_]{20,}'
  'sk-[A-Za-z0-9]{24,}'
  'sk-ant-[A-Za-z0-9_-]{20,}'
  'AKIA[0-9A-Z]{16}'
  'ASIA[0-9A-Z]{16}'
  'xox[baprs]-[A-Za-z0-9-]{10,}'
  'glpat-[A-Za-z0-9_-]{20,}'
  '-----BEGIN (RSA |OPENSSH |EC |DSA |PGP )?PRIVATE KEY-----'
  'eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}'
)
for p in "${patterns[@]}"; do
  hits="$(grep -rInE "$p" --exclude-dir=.git . 2>/dev/null || true)"
  if [ -n "$hits" ]; then
    echo "$hits" | head -5 >&2
    blocked "匹配密钥格式: $p"
  fi
done

# 3) 环境变量赋值中疑似真实值（排除占位符与示例）
while IFS= read -r hit; do
  [ -z "$hit" ] && continue
  echo "$hit" >&2
  blocked "疑似真实凭据赋值（请改为 <placeholder>）"
done < <(grep -rInE \
  '^[A-Z_]*(KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)[A-Z_]*="?[A-Za-z0-9+/_-]{24,}"?[[:space:]]*$' \
  --exclude-dir=.git . 2>/dev/null \
  | grep -viE 'your[-_]|<|example|placeholder|xxxx|\$\{|\*\*\*' || true)

# 4) 提醒：env/ 下只允许模板
unexpected="$(find env -maxdepth 1 -type f ! -name '*.example' ! -name 'README.md' -printf '%f\n' 2>/dev/null || true)"
if [ -n "$unexpected" ]; then
  echo "$unexpected" >&2
  blocked "env/ 下出现非模板文件（应被 .gitignore 忽略）"
fi

# 5) 检查 .gitignore 确实挡住了典型凭据文件
for probe in env/server.env secrets.key backup.env; do
  if ! git check-ignore -q "$probe" 2>/dev/null; then
    blocked ".gitignore 未忽略: $probe"
  fi
done

if [ "$fail" -ne 0 ]; then
  echo
  echo "❌ 扫描未通过。公有仓库中任何提交都会立即公开，请先处理上述项（必要时轮换密钥）。" >&2
  exit 1
fi
echo "✓ 未发现疑似凭据；典型凭据路径已被 .gitignore 覆盖"
