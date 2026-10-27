#!/usr/bin/env bash
# 用一次性 PostgreSQL 跑 Go 测试。
#
# 为什么需要它：存储层只支持 PostgreSQL（SQLite 支持已移除，归档 tag `sqlite-final`），
# 所以 `go test ./...` 没有"零依赖默认引擎"，必须有可连的库。
#
# 用法:
#   ./scripts/test-with-pg.sh                # 起库并打印 DSN（供你手动 export）
#   ./scripts/test-with-pg.sh --full         # 起库并直接跑 scripts/full-test.sh
#   ./scripts/test-with-pg.sh --down         # 停掉并删除临时库
#
# 连接串默认 postgres://tokentracker:tokentracker-dev@127.0.0.1:55432/tokentracker?sslmode=disable
# 可用 TT_TEST_PG_PORT / TT_TEST_PG_IMAGE 覆盖。CI 里不用这个脚本（用 service 容器）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAME="${TT_TEST_PG_NAME:-tt-test-pg}"
PORT="${TT_TEST_PG_PORT:-55432}"
IMAGE="${TT_TEST_PG_IMAGE:-postgres:16-alpine}"
PASS="${TT_TEST_PG_PASSWORD:-tokentracker-dev}"
DSN="postgres://tokentracker:${PASS}@127.0.0.1:${PORT}/tokentracker?sslmode=disable"

die() { echo "错误: $*" >&2; exit 1; }

need_docker() {
  command -v docker >/dev/null 2>&1 || die "需要 docker（或自己起一个 PostgreSQL 并 export TT_TEST_DATABASE_URL）。也可以：pip install pgserver 后用它起库"
  docker info >/dev/null 2>&1 || die "docker daemon 不可用（或自己起一个 PostgreSQL 并 export TT_TEST_DATABASE_URL）"
}

start() {
  need_docker
  if [ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null || echo false)" = "true" ]; then
    echo "复用已有容器 $NAME"
  else
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    docker run -d --name "$NAME" \
      -e POSTGRES_USER=tokentracker -e POSTGRES_PASSWORD="$PASS" -e POSTGRES_DB=tokentracker \
      -p "127.0.0.1:${PORT}:5432" "$IMAGE" >/dev/null
    echo "启动 $IMAGE（容器 $NAME，端口 $PORT）"
  fi
  for _ in $(seq 1 60); do
    if docker exec "$NAME" pg_isready -U tokentracker -d tokentracker >/dev/null 2>&1; then break; fi
    sleep 1
  done
  docker exec "$NAME" pg_isready -U tokentracker -d tokentracker >/dev/null 2>&1 \
    || die "PostgreSQL 未就绪：docker logs $NAME"
  echo "就绪: $DSN"
}

case "${1:-}" in
  --down)
    need_docker
    docker rm -f "$NAME" >/dev/null 2>&1 && echo "已删除容器 $NAME" || echo "容器 $NAME 不存在"
    ;;
  --full)
    start
    cd "$ROOT"
    TT_TEST_DATABASE_URL="$DSN" TT_POSTGRES_URL="$DSN" ./scripts/full-test.sh
    ;;
  "")
    start
    cat <<TIP

接下来：
  export TT_TEST_DATABASE_URL='$DSN'
  go test -race ./...
  cd .. && GO_POSTGRES_URL='$DSN' CONTRACT_ADAPTER=./contract/adapters/go-postgres.cjs ./contract/scripts/verify.sh
跑完清理： ./scripts/test-with-pg.sh --down
TIP
    ;;
  *) die "未知参数 $1（可用：--full / --down / 无参数）" ;;
esac
