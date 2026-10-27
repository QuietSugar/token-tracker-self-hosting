# syntax=docker/dockerfile:1.7
# TokenTracker 自托管部署工件镜像（linux/amd64）
#
# 设计：镜像 = 已审计的应用侧产物 + 部署 CLI。
#   - 产物来自本仓库 releases/<VERSION>/，由 GitHub Actions 的 reproduce job 从
#     锁定上游 commit 重建并逐字节校验后，才允许进入镜像。
#   - 镜像不连接用户实例、不执行 psql、不上传函数；只输出工件与可执行命令。
#   - Node 逻辑一律放在独立 .cjs 文件里：Dockerfile 的 RUN 里写多行
#     `node -e '...'` 会被 parser 误判为 Dockerfile 指令（已踩过坑）。
#
# 构建（由 .github/workflows/build-image.yml 调用）：
#   docker build --build-arg VERSION=1.4.12 --build-arg UPSTREAM_COMMIT=<sha> \
#     --build-arg SOURCE_DATE_EPOCH=<epoch> --build-arg VCS_REF=<sha> -t <image> .

ARG NODE_VERSION=20

# ---------------------------------------------------------------- prepare
FROM node:${NODE_VERSION}-alpine AS prepare
WORKDIR /prepare
COPY releases/ /releases/
COPY docker/verify-artifacts.cjs /usr/local/lib/tokentracker/verify-artifacts.cjs
ARG VERSION
RUN test -n "$VERSION" || { echo "VERSION build-arg is required" >&2; exit 1; } \
 && test -f "/releases/${VERSION}/SHA256SUMS" || { echo "missing audited release: ${VERSION}" >&2; exit 1; } \
 && mkdir -p /opt/tokentracker/artifacts \
 && cp -a "/releases/${VERSION}/." /opt/tokentracker/artifacts/ \
 && find /opt/tokentracker/artifacts -type d -exec chmod 755 {} \; \
 && find /opt/tokentracker/artifacts -type f -exec chmod 644 {} \;

# ---------------------------------------------------------------- verify
# 硬门槛：镜像内产物必须与仓库审计的 SHA256SUMS 逐字节一致，
# 且 14 个函数 / 步骤清单 / UTF-8 编码全部通过。任一项失败则构建中止。
FROM prepare AS verify
WORKDIR /opt/tokentracker/artifacts
RUN sha256sum -c SHA256SUMS \
 && node /usr/local/lib/tokentracker/verify-artifacts.cjs

# ---------------------------------------------------------------- runtime
FROM node:${NODE_VERSION}-alpine AS runtime

ARG VERSION=unknown
ARG UPSTREAM_COMMIT=unknown
ARG SOURCE_DATE_EPOCH=0
ARG VCS_REF=unknown

LABEL org.opencontainers.image.title="TokenTracker self-hosting artifacts" \
      org.opencontainers.image.description="Audited SQL baseline and 14 private functions for a self-hosted TokenTracker/InsForge instance. Artifact carrier and deployment CLI; does not run the InsForge platform." \
      org.opencontainers.image.source="https://github.com/QuietSugar/token-tracker-self-hosting" \
      org.opencontainers.image.url="https://github.com/QuietSugar/token-tracker-self-hosting" \
      org.opencontainers.image.documentation="https://github.com/QuietSugar/token-tracker-self-hosting/blob/main/docs/maintainers/release.md" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="TokenTracker self-hosting maintenance" \
      org.opencontainers.image.base.name="node:20-alpine" \
      dev.tokentracker.version="${VERSION}" \
      dev.tokentracker.upstream.commit="${UPSTREAM_COMMIT}" \
      dev.tokentracker.vcs.ref="${VCS_REF}" \
      dev.tokentracker.platform="linux/amd64" \
      dev.tokentracker.artifact.functions="14" \
      dev.tokentracker.artifact.steps="15"

RUN apk add --no-cache tini ca-certificates \
 && addgroup -g 10001 -S tokentracker \
 && adduser -u 10001 -S -G tokentracker -h /opt/tokentracker tokentracker

WORKDIR /opt/tokentracker
COPY --from=verify --chown=tokentracker:tokentracker /opt/tokentracker/artifacts/ ./artifacts/
COPY docker/tokentracker.cjs /usr/local/bin/tokentracker
COPY docker/DEPLOY.md ./DEPLOY.md
COPY docker/write-build-info.cjs /usr/local/lib/tokentracker/write-build-info.cjs

RUN chmod 755 /usr/local/bin/tokentracker \
 && node /usr/local/lib/tokentracker/write-build-info.cjs \
 && chown -R tokentracker:tokentracker /opt/tokentracker

USER 10001:10001
ENV TT_ARTIFACTS=/opt/tokentracker/artifacts \
    TT_BUILD_INFO=/opt/tokentracker/BUILD.json

ENTRYPOINT ["/sbin/tini","--","/usr/local/bin/tokentracker"]
CMD ["info"]

# 不设 HEALTHCHECK：这是短命的 CLI 工件容器，没有常驻服务可探活。
# 完整性由构建期 verify 阶段 + `tokentracker verify` 命令保证。
