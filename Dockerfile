# syntax=docker/dockerfile:1.7
# TokenTracker 自托管部署工件镜像（linux/amd64）
#
# 设计：镜像 = 已审计的应用侧产物 + 部署 CLI。
#   - 产物来自本仓库 releases/<VERSION>/，由 GitHub Actions 的 reproduce job 从
#     锁定上游 commit 重建并逐字节校验后，才允许进入镜像。
#   - 镜像不连接用户实例、不执行 psql、不上传函数；只输出工件与可执行命令。
#   - 基础镜像固定 Node 20，非 root 运行。
#
# 构建（由 .github/workflows/build-image.yml 调用）：
#   docker build --build-arg VERSION=1.4.12 --build-arg UPSTREAM_COMMIT=<sha> \
#     --build-arg SOURCE_DATE_EPOCH=<epoch> --build-arg VCS_REF=<sha> -t <image> .

ARG NODE_VERSION=20

# ---------------------------------------------------------------- prepare
FROM node:${NODE_VERSION}-alpine AS prepare
WORKDIR /prepare
COPY releases/ /releases/
ARG VERSION
RUN test -n "$VERSION" || { echo "VERSION build-arg is required" >&2; exit 1; } \
 && test -f "/releases/${VERSION}/SHA256SUMS" || { echo "missing audited release: ${VERSION}" >&2; exit 1; } \
 && mkdir -p /opt/tokentracker/artifacts \
 && cp -a "/releases/${VERSION}/." /opt/tokentracker/artifacts/ \
 && rm -f /opt/tokentracker/artifacts/SHA256SUMS.tmp \
 && find /opt/tokentracker/artifacts -type d -exec chmod 755 {} \; \
 && find /opt/tokentracker/artifacts -type f -exec chmod 644 {} \;

# ---------------------------------------------------------------- verify
# 硬门槛：镜像内产物必须与仓库审计的 SHA256SUMS 逐字节一致，
# 且 14 个函数 / 15 步清单 / UTF-8 编码全部通过。任一项失败则构建中止。
FROM prepare AS verify
WORKDIR /opt/tokentracker/artifacts
RUN sha256sum -c SHA256SUMS \
 && test -f functions/functions.json \
 && test -f tokentracker-install.sql \
 && test -f tokentracker-migration.sql \
 && test -f manifest-report.md \
 && node -e '
   const fs=require("node:fs"),path=require("node:path");
   const m=JSON.parse(fs.readFileSync("functions/functions.json","utf8"));
   if(!Array.isArray(m.functions)||m.functions.length!==14) throw Error("functions.json must list 14 entries");
   if(m.mode!=="self_hosted") throw Error("unexpected manifest mode");
   for(const f of m.functions){ if(!fs.existsSync(path.join("functions",f.file))) throw Error("missing "+f.file); }
   const ex=[".md",".sql",".js",".json",".txt"];
   function walk(d){ for(const e of fs.readdirSync(d,{withFileTypes:true})){ const p=path.join(d,e.name);
     if(e.isDirectory()) walk(p); else if(ex.includes(path.extname(e.name))){ const b=fs.readFileSync(p);
       if(b[0]===0xef&&b[1]===0xbb&&b[2]===0xbf) throw Error("BOM: "+p);
       new TextDecoder("utf-8",{fatal:true}).decode(b); } } }
   walk(".");
   console.log("artifact verify: OK (14 functions, 15 steps, UTF-8, checksums)");
 '

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
      org.opencontainers.image.documentation="https://github.com/QuietSugar/token-tracker-self-hosting/blob/main/docs/docker-image.md" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="TokenTracker self-hosting maintenance" \
      org.opencontainers.image.base.name="node:20-alpine" \
      dev.tokentracker.version="${VERSION}" \
      dev.tokentracker.upstream.commit="${UPSTREAM_COMMIT}" \
      dev.tokentracker.vcs.ref="${VCS_REF}" \
      dev.tokentracker.platform="linux/amd64" \
      dev.tokentracker.artifact.functions="14" \
      dev.tokentracker.artifact.steps="15"

# tini 用于正确转发信号；su-exec 无需（非 root 直接运行）
RUN apk add --no-cache tini ca-certificates \
 && addgroup -g 10001 -S tokentracker \
 && adduser -u 10001 -S -G tokentracker -h /opt/tokentracker tokentracker

WORKDIR /opt/tokentracker
COPY --from=verify --chown=tokentracker:tokentracker /opt/tokentracker/artifacts/ ./artifacts/
COPY docker/tokentracker.cjs /usr/local/bin/tokentracker
COPY docker/DEPLOY.md ./DEPLOY.md

RUN chmod 755 /usr/local/bin/tokentracker \
 && node -e '
   const fs=require("node:fs"),os=require("node:os");
   const epoch=Number(process.env.SOURCE_DATE_EPOCH||0)||Math.floor(Date.now()/1000);
   const info={
     schemaVersion:1,
     product:"tokentracker-selfhost-artifacts",
     version:process.env.VERSION||"unknown",
     upstream:{repository:"https://github.com/xiufengsun/TokenTracker.git",commit:process.env.UPSTREAM_COMMIT||"unknown"},
     vcsRef:process.env.VCS_REF||"unknown",
     builtAt:new Date(epoch*1000).toISOString().replace(/\.\d{3}Z$/,"Z"),
     platform:"linux/amd64",
     node:process.version,
     contents:{installSteps:15,privateFunctions:14},
     sourceDateEpoch:epoch
   };
   fs.writeFileSync("/opt/tokentracker/BUILD.json",JSON.stringify(info,null,2)+"\n",{mode:0o644});
   fs.chownSync("/opt/tokentracker/BUILD.json",10001,10001);
 ' \
 && chown -R tokentracker:tokentracker /opt/tokentracker

USER 10001:10001
ENV TT_ARTIFACTS=/opt/tokentracker/artifacts \
    TT_BUILD_INFO=/opt/tokentracker/BUILD.json

ENTRYPOINT ["/sbin/tini","--","/usr/local/bin/tokentracker"]
CMD ["info"]

# 不设 HEALTHCHECK：这是短命的 CLI 工件容器，没有常驻服务可探活。
# 完整性由构建期 verify 阶段 + `tokentracker verify` 命令保证。
