# syntax=docker/dockerfile:1.7
# TokenTracker 自托管 Go 后端实验镜像（linux/amd64 + linux/arm64）。
#
# 只支持 PostgreSQL：用 TT_DATABASE_URL 给一个 postgres://... 连接串。
# （SQLite 支持已移除，归档 tag `sqlite-final`。）
#
# 注意：这是 Go 迁移实验镜像，不替代现有 InsForge/PostgreSQL 镜像。
# 只承诺 contract/golden 用例明示覆盖的行为；见 docs/status.md。

FROM golang@sha256:68932fa6d4d4059845c8f40ad7e654e626f3ebd3706eef7846f319293ab5cb7a AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG VERSION=experimental
ARG VCS_REF=unknown
ARG TARGETARCH=amd64
RUN CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH} go build \
    -trimpath -ldflags="-s -w -X main.version=${VERSION} -X main.vcsRef=${VCS_REF}" \
    -o /out/tokentracker-server ./cmd/server

FROM alpine@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc
ARG VERSION=experimental
ARG VCS_REF=unknown
# 多平台构建时必须是实际架构；写死会给出错误的镜像元数据。
ARG TARGETARCH=amd64
LABEL org.opencontainers.image.title="TokenTracker Go experimental backend (PostgreSQL)" \
      org.opencontainers.image.description="Experimental Go vertical slice on PostgreSQL; not a production GA replacement for InsForge" \
      org.opencontainers.image.source="https://github.com/QuietSugar/token-tracker-self-hosting" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.version="${VERSION}" \
      dev.tokentracker.status="experimental-vertical-slice" \
      dev.tokentracker.platform="linux/${TARGETARCH}"
RUN addgroup -g 10001 -S tokentracker \
 && adduser -u 10001 -S -G tokentracker -h /app tokentracker
COPY --from=build --chown=tokentracker:tokentracker /out/tokentracker-server /usr/local/bin/tokentracker-server
USER 10001:10001
WORKDIR /app
ENV TT_DATABASE_URL= \
    TT_LISTEN_ADDR=0.0.0.0:8080 \
    TT_DASHBOARD_URL= \
    TT_JWT_SECRET= \
    TT_NOW=
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/tokentracker-server"]
