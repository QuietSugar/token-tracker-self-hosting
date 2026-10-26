#!/usr/bin/env bash
# 启动"真实标准环境"：官方 InsForge v2.3.3 四容器栈 + 应用侧 15 步基线。
#
# 与 PGlite fixture 的区别：
#   - 真实 PostgreSQL 15.18 服务端（多进程、多连接、真实 advisory lock）
#   - 真实 PostgREST v12.2.12
#   - 真实 InsForge OSS v2.3.3 后端（自建 auth schema / 角色）
#   - 真实 Deno 2.0.6 function runtime
#   - 应用侧 15 步 SQL 通过真实 psql 客户端安装
#
# 用法: ./contract/scripts/standard-env.sh [up|down|status|test]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="${STANDARD_ENV_DIR:-$HOME/insforge-standard}"
COMPOSE_DIR="$WORK/deploy/docker-compose"
CRED="$WORK/credentials.env"
REPO_TAG="v2.3.3"
SQL="$ROOT/releases/$(sed -n 's/^VERSION=//p' "$ROOT/tracking/REF" | head -1)/tokentracker-install.sql"

cmd="${1:-up}"

case "$cmd" in
  up)
    echo "=== 启动真实标准环境 ==="
    echo "工作目录: $WORK"

    # 0) 前置工具
    for c in docker psql curl openssl unzip; do
      command -v "$c" >/dev/null || { echo "ERROR: 缺少 $c" >&2; exit 1; }
    done

    # 1) dockerd（沙箱内需显式启动；普通机器上通常已在跑）
    if ! docker info >/dev/null 2>&1; then
      echo "[1/7] 启动 dockerd ..."
      sudo -n dockerd --iptables=false --bridge=none --storage-driver=overlay2 \
        >"$WORK/dockerd.log" 2>&1 &
      for i in $(seq 1 20); do docker info >/dev/null 2>&1 && break; sleep 1; done
      docker info >/dev/null 2>&1 || { echo "ERROR: dockerd 启动失败" >&2; tail -20 "$WORK/dockerd.log"; exit 1; }
    else
      echo "[1/7] dockerd 已在运行"
    fi

    # 2) compose 插件
    if ! docker compose version >/dev/null 2>&1; then
      echo "[2/7] 安装 docker compose 插件 ..."
      sudo -n mkdir -p /usr/local/lib/docker/cli-plugins
      sudo -n curl -fsSL "https://github.com/docker/compose/releases/download/v2.30.3/docker-compose-linux-x86_64" \
        -o /usr/local/lib/docker/cli-plugins/docker-compose
      sudo -n chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
    else
      echo "[2/7] compose 插件已存在"
    fi

    # 3) 官方 v2.3.3 部署文件（固定 tag，不跟 main）
    if [ ! -d "$WORK/deploy" ]; then
      echo "[3/7] 获取 InsForge $REPO_TAG 官方部署文件 ..."
      mkdir -p "$WORK"
      git clone -q --depth 1 --branch "$REPO_TAG" https://github.com/InsForge/InsForge.git "$WORK/src"
      cp -a "$WORK/src/deploy" "$WORK/deploy"
      cp -a "$WORK/src/functions" "$WORK/functions"
    else
      echo "[3/7] 官方部署文件已存在"
    fi

    # 4) 固定每个镜像的 OCI digest（官方 compose 的 insforge:latest 与本仓库“pin digest”规则冲突）。
    # 这些 digest 是 2026-10-26 本次实际拉取并验收的 x86_64 镜像；更新版本时须重新评审。
    sed -i \
      -e 's|image: ghcr.io/insforge/postgres:v15.13.4|image: ghcr.io/insforge/postgres@sha256:23b767e82e17da08cec1dc0c1214e3002a06154e73a2cb4dfad30ab540405698|' \
      -e 's|image: postgrest/postgrest:v12.2.12|image: postgrest/postgrest@sha256:5f4ce744539bbba786b4e24dbbd95bdb2a956dcf568c5374995a0ff4a68f5bd2|' \
      -e 's|image: ghcr.io/insforge/insforge-oss:latest|image: ghcr.io/insforge/insforge-oss@sha256:a8d84d71b5ae3d076628d6f4d03961b49599a5d127e42739e983dfe3122259bd|' \
      -e 's|image: denoland/deno:alpine-2.0.6|image: denoland/deno@sha256:b64881926dcb3ba183b8767a4542aac69343dbc97008c22a60208cf07e4a21cc|' \
      "$COMPOSE_DIR/docker-compose.yml"

    # 5) 生成隔离凭据
    if [ ! -f "$CRED" ]; then
      echo "[4/7] 生成隔离凭据（仅本机，600 权限）..."
      JWT=$(openssl rand -hex 32); ENC=$(openssl rand -hex 32); PGPW=$(openssl rand -hex 16)
      ADM=$(openssl rand -hex 12); APIKEY="ik_$(openssl rand -hex 20)"; ANON="anon_$(openssl rand -hex 20)"
      cat > "$COMPOSE_DIR/.env" <<EOF
POSTGRES_USER=postgres
POSTGRES_PASSWORD=$PGPW
POSTGRES_DB=insforge
JWT_SECRET=$JWT
ENCRYPTION_KEY=$ENC
ROOT_ADMIN_USERNAME=admin@local.test
ROOT_ADMIN_PASSWORD=$ADM
ACCESS_API_KEY=$APIKEY
ACCESS_ANON_KEY=$ANON
API_BASE_URL=http://127.0.0.1:7130
VITE_API_BASE_URL=http://127.0.0.1:7130
POSTGRES_PORT=55432
POSTGREST_PORT=55430
APP_PORT=7130
AUTH_PORT=7131
DENO_PORT=7133
INSFORGE_TELEMETRY_DISABLED=1
EOF
      chmod 600 "$COMPOSE_DIR/.env"
      cat > "$CRED" <<EOF
PGPASSWORD=$PGPW
JWT_SECRET=$JWT
ACCESS_API_KEY=$APIKEY
ACCESS_ANON_KEY=$ANON
ROOT_ADMIN_PASSWORD=$ADM
EOF
      chmod 600 "$CRED"
    else
      echo "[4/7] 凭据已存在"
    fi

    # 6) 拉镜像（容器无外网时由宿主机代劳预热 Deno 依赖缓存）
    echo "[5/7] 拉取固定镜像 ..."
    for img in \
      ghcr.io/insforge/postgres:v15.13.4 \
      postgrest/postgrest:v12.2.12 \
      ghcr.io/insforge/insforge-oss:$REPO_TAG \
      denoland/deno:alpine-2.0.6; do
      docker image inspect "$img" >/dev/null 2>&1 || docker pull -q "$img"
    done

    echo "[6/7] 启动 4 个服务 ..."
    (cd "$COMPOSE_DIR" && docker compose --env-file .env up -d)

    # Deno 容器可能无法出外网下载 https://deno.land 依赖；预热 DENO_DIR 卷
    CACHE=$(docker volume inspect docker-compose_deno_cache --format '{{.Mountpoint}}' 2>/dev/null || true)
    if [ -n "$CACHE" ] && [ "$(find "$CACHE/remote" -type f 2>/dev/null | wc -l)" -lt 10 ]; then
      echo "  预热 Deno 远程依赖缓存（宿主机代下载）..."
      if ! command -v deno >/dev/null 2>&1; then
        curl -fsSL -o /tmp/deno.zip "https://github.com/denoland/deno/releases/download/v2.0.6/deno-x86_64-unknown-linux-gnu.zip"
        sudo -n mkdir -p /usr/local/deno && sudo -n unzip -oq /tmp/deno.zip -d /usr/local/deno
        sudo -n ln -sf /usr/local/deno/deno /usr/local/bin/deno
      fi
      sudo -n DENO_DIR="$CACHE" deno cache \
        https://deno.land/x/postgres@v0.17.0/mod.ts \
        https://deno.land/std@0.224.0/path/mod.ts \
        https://deno.land/std@0.224.0/encoding/base64.ts >/dev/null 2>&1 || true
      (cd "$COMPOSE_DIR" && docker compose --env-file .env restart deno >/dev/null)
    fi

    echo "[7/7] 等待服务就绪 ..."
    for i in $(seq 1 30); do
      A=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 3 http://127.0.0.1:7130/api/health 2>/dev/null || echo 000)
      D=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 3 http://127.0.0.1:7133/health 2>/dev/null || echo 000)
      [ "$A" = "200" ] && [ "$D" = "200" ] && break
      sleep 3
    done
    echo "  insforge/api/health=$A  deno/health=$D"

    # 应用侧 15 步基线（真实 psql 客户端）
    . "$CRED"; export PGPASSWORD
    PGVER=$(psql -h 127.0.0.1 -p 55432 -U postgres -d insforge -tAc "SHOW server_version;" 2>/dev/null | cut -d' ' -f1)
    echo "  PostgreSQL: $PGVER"
    echo "  应用 15 步基线 SQL ..."
    psql -h 127.0.0.1 -p 55432 -U postgres -d insforge -v ON_ERROR_STOP=1 -f "$SQL" >/dev/null
    STEPS=$(psql -h 127.0.0.1 -p 55432 -U postgres -d insforge -tAc \
      "SELECT count(*) FROM public.tokentracker_self_host_installations;")
    echo "  安装步骤数: $STEPS"
    echo
    echo "✓ 真实标准环境就绪"
    echo "  InsForge : http://127.0.0.1:7130  (apikey: 见 $CRED)"
    echo "  PostgREST: http://127.0.0.1:55430"
    echo "  Deno     : http://127.0.0.1:7133"
    echo "  PG       : 127.0.0.1:55432  (PostgreSQL $PGVER)"
    ;;

  status)
    . "$CRED"; export PGPASSWORD
    echo "=== 标准环境状态 ==="
    (cd "$COMPOSE_DIR" && docker compose --env-file .env ps --format '{{.Name}}\t{{.Status}}')
    echo
    echo "PG: $(psql -h 127.0.0.1 -p 55432 -U postgres -d insforge -tAc 'SHOW server_version;' 2>/dev/null | cut -d' ' -f1)"
    echo "步骤: $(psql -h 127.0.0.1 -p 55432 -U postgres -d insforge -tAc 'SELECT count(*) FROM public.tokentracker_self_host_installations;' 2>/dev/null)"
    ;;

  down)
    echo "=== 停止并清理标准环境 ==="
    (cd "$COMPOSE_DIR" && docker compose --env-file .env down -v) 2>&1 | tail -10
    echo "✓ 已清理（工作目录 $WORK 保留，含凭据文件）"
    ;;

  test)
    exec "$ROOT/contract/scripts/standard-env-test.sh"
    ;;

  *)
    echo "用法: $0 [up|down|status|test]" >&2; exit 2;;
esac
