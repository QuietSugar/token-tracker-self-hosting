#!/usr/bin/env bash
# Go 后端全量测试流程（本地 / CI 用同一套）。
#
# 覆盖：
#   L0  gofmt / go vet / CGO=0 构建
#   L1  go test -race（真实 PostgreSQL；需 TT_TEST_DATABASE_URL）
#   L2  契约 go-postgres（33 用例 + 2 PG 专属 SKIP）
#   L3  Docker 镜像 smoke（需 docker；可选）
#
# 存储层只支持 PostgreSQL，没有"零依赖默认引擎"。没给库时 L1/L2 记为 SKIP，
# 而不是偷偷跑一个别的引擎。
#
# 用法:
#   cd go-server && ./scripts/test-with-pg.sh --full     # 起临时 PG 并跑全量
#   TT_TEST_DATABASE_URL='postgres://user:pass@127.0.0.1:5432/db?sslmode=disable' ./scripts/full-test.sh
#   SKIP_DOCKER=1 ./scripts/full-test.sh
#
# 退出码：0 = 全部通过（跳过项会明确列出）；非 0 = 有失败。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GO_DIR="$ROOT/go-server"
BIN="$GO_DIR/bin/tokentracker-server"
PG_URL="${TT_POSTGRES_URL:-${TT_TEST_DATABASE_URL:-}}"
RESULTS=()
FAILED=0

ts() { date -u +%H:%M:%SZ; }
step() { printf '\n\033[1m== [%s] %s\033[0m\n' "$(ts)" "$*"; }
record() { # record <name> <status>
  RESULTS+=("$2|$1")
  if [ "$2" = "FAIL" ]; then FAILED=1; fi
}
run() { # run <name> <cmd...>
  local name="$1"; shift
  if "$@"; then record "$name" "PASS"; else record "$name" "FAIL"; fi
}

cd "$GO_DIR" || exit 1
echo "仓库: $ROOT"
echo "Go:   $(go version 2>/dev/null || echo '未安装')"
echo "PG:   ${PG_URL:-<未提供，将跳过真实 PostgreSQL 项>}"

# ---------------------------------------------------------------- L0
step "L0 gofmt"
FMT="$(gofmt -l . 2>&1)"
if [ -n "$FMT" ]; then
  echo "$FMT"
  record "gofmt" "FAIL"
else
  echo "全部文件已格式化"; record "gofmt" "PASS"
fi

step "L0 go vet"
run "go vet" go vet ./...

step "L0 build (CGO_ENABLED=0, linux/amd64)"
mkdir -p bin
if CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -o "$BIN" ./cmd/server; then
  record "build" "PASS"
else
  record "build" "FAIL"
fi

# ---------------------------------------------------------------- L1/L2
if [ -n "$PG_URL" ]; then
  step "L1 go test -race（PostgreSQL）"
  if TT_TEST_DATABASE_URL="$PG_URL" go test -race -count=1 ./...; then
    record "go test -race (postgres)" "PASS"
  else
    record "go test -race (postgres)" "FAIL"
  fi
else
  step "L1 go test -race（PostgreSQL）"
  echo "  跳过：未设置 TT_TEST_DATABASE_URL（用 ./scripts/test-with-pg.sh 起库，或导出连接串）"
  record "go test -race (postgres)" "SKIP"
fi

# ---------------------------------------------------------------- L2
cd "$ROOT" || exit 1
export CONTRACT_CONCURRENCY="${CONTRACT_CONCURRENCY:-2}"
export GO_SERVER_BIN="$BIN"

if [ -n "$PG_URL" ]; then
  step "L2 契约 go-postgres"
  if GO_POSTGRES_URL="$PG_URL" CONTRACT_ADAPTER=./contract/adapters/go-postgres.cjs \
       ./contract/scripts/verify.sh >/tmp/tt-contract-postgres.log 2>&1; then
    grep -E '^\[L2\]' /tmp/tt-contract-postgres.log || true
    record "契约 go-postgres" "PASS"
  else
    tail -40 /tmp/tt-contract-postgres.log
    record "契约 go-postgres" "FAIL"
  fi
else
  record "契约 go-postgres" "SKIP"
fi

# ---------------------------------------------------------------- L3
step "L3 Docker 镜像 smoke（PostgreSQL）"
if [ -z "$PG_URL" ]; then
  echo "未设置 TT_TEST_DATABASE_URL，跳过"; record "docker smoke" "SKIP"
elif [ -n "${SKIP_DOCKER:-}" ]; then
  echo "SKIP_DOCKER 已设置，跳过"; record "docker smoke" "SKIP"
elif ! command -v docker >/dev/null 2>&1; then
  echo "未安装 docker，跳过"; record "docker smoke" "SKIP"
elif ! docker info >/dev/null 2>&1; then
  echo "docker daemon 不可用，跳过"; record "docker smoke" "SKIP"
else
  IMG="tokentracker-go:full-test"
  if docker build -q -f go-server/Dockerfile -t "$IMG" go-server >/tmp/tt-docker-build.log 2>&1; then
    docker rm -f tt-fulltest >/dev/null 2>&1 || true
    # host 网络：容器里的 127.0.0.1 直接指向宿主机上的 PG。
    docker run -d --name tt-fulltest --network host \
      -e TT_JWT_SECRET=full-test-secret-at-least-32-bytes!! \
      -e TT_DATABASE_URL="$PG_URL" \
      -e TT_POSTGRES_SCHEMA=full_test \
      -e TT_LISTEN_ADDR=0.0.0.0:18099 "$IMG" >/dev/null
    ok=1
    for _ in $(seq 1 90); do
      curl -fsS http://127.0.0.1:18099/health >/dev/null 2>&1 && { ok=0; break; }
      [ "$(docker inspect -f '{{.State.Running}}' tt-fulltest 2>/dev/null || echo false)" = "true" ] || break
      sleep 1
    done
    if [ "$ok" = 0 ] \
       && [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18099/_test/sql)" = "404" ] \
       && [ "$(docker exec tt-fulltest id -u)" = "10001" ] \
       && docker logs tt-fulltest 2>&1 | grep -q 'engine=postgres'; then
      echo "health 200 / _test/sql 404 / uid 10001 / engine=postgres"
      record "docker smoke" "PASS"
    else
      docker logs tt-fulltest | tail -20
      record "docker smoke" "FAIL"
    fi
    docker rm -f tt-fulltest >/dev/null 2>&1 || true
  else
    tail -20 /tmp/tt-docker-build.log
    record "docker smoke" "FAIL"
  fi
fi

# ---------------------------------------------------------------- 汇总
printf '\n\033[1m===== 全量测试结果 =====\033[0m\n'
for r in "${RESULTS[@]}"; do
  printf '  %-6s %s\n' "${r%%|*}" "${r#*|}"
done
printf '\n详细日志: /tmp/tt-contract-postgres.log\n'
if [ "$FAILED" = 0 ]; then
  echo "结论: 全部通过（SKIP 项已列明）"
  exit 0
fi
echo "结论: 存在失败项"
exit 1
