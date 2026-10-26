#!/usr/bin/env node
/**
 * TokenTracker 自托管工件镜像的部署 CLI。
 *
 * 边界（重要）：本 CLI 只读取镜像内的已审计产物，输出到 stdout 或挂载目录。
 * 它不连接数据库、不调用 InsForge API、不上传函数、不持有任何凭据。
 * 真正执行 psql / 上传函数的是实例持有者，在 VPS 上按 `commands` 输出操作。
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const A = process.env.TT_ARTIFACTS || "/opt/tokentracker/artifacts";
const BUILD = process.env.TT_BUILD_INFO || "/opt/tokentracker/BUILD.json";

function die(msg) { console.error("ERROR: " + msg); process.exit(1); }
function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function exists(p) { return fs.existsSync(p); }

function loadBuild() {
  if (!exists(BUILD)) return { version: "unknown", upstream: { commit: "unknown" } };
  return readJson(BUILD);
}
function loadFunctions() {
  const p = path.join(A, "functions", "functions.json");
  if (!exists(p)) die("找不到 functions/functions.json —— 镜像不完整");
  return readJson(p);
}
function sums() {
  const p = path.join(A, "SHA256SUMS");
  if (!exists(p)) die("找不到 SHA256SUMS —— 镜像不完整");
  return fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map(line => {
    const m = line.match(/^([a-f0-9]{64})\s+\*?(.+)$/);
    return m ? { expected: m[1], file: m[2] } : null;
  }).filter(Boolean);
}

function cmdInfo() {
  const b = loadBuild();
  const f = loadFunctions();
  const stepMatch = (() => {
    const p = path.join(A, "manifest-report.md");
    if (!exists(p)) return null;
    const m = fs.readFileSync(p, "utf8").match(/安装步骤数：\*\*(\d+)\*\*/);
    return m ? m[1] : null;
  })();
  console.log("TokenTracker 自托管部署工件");
  console.log("─".repeat(48));
  console.log(`版本            : ${b.version}`);
  console.log(`上游 commit     : ${b.upstream?.commit ?? "unknown"}`);
  console.log(`上游仓库        : ${b.upstream?.repository ?? "-"}`);
  console.log(`构建时间        : ${b.builtAt ?? "-"}`);
  console.log(`平台 / Node     : ${b.platform ?? "linux/amd64"} / ${b.node ?? process.version}`);
  console.log(`VCS ref         : ${b.vcsRef ?? "-"}`);
  console.log(`安装步骤 / 函数 : ${stepMatch ?? "15"} / ${f.functions.length}`);
  console.log(`模式            : ${f.mode}`);
  console.log(`排除项          : ${(f.excluded || []).join("; ")}`);
  console.log();
  console.log("可用命令: info | verify | functions | sql | migration | export | commands | checksums");
  console.log("提示: docker run --rm <image> commands  查看在 VPS 上要执行的完整命令");
}

function cmdVerify(quiet) {
  const entries = sums();
  let bad = 0;
  for (const e of entries) {
    const p = path.join(A, e.file);
    if (!exists(p)) { if (!quiet) console.error(`MISSING  ${e.file}`); bad++; continue; }
    const actual = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
    if (actual !== e.expected) { if (!quiet) console.error(`FAILED   ${e.file}`); bad++; }
    else if (!quiet) console.log(`OK       ${e.file}`);
  }
  const f = loadFunctions();
  if (f.functions.length !== 14) { console.error("functions.json 不是 14 个函数"); bad++; }
  const jsCount = fs.readdirSync(path.join(A, "functions")).filter(n => n.endsWith(".js")).length;
  if (jsCount !== 14) { console.error(`函数文件数为 ${jsCount}，期望 14`); bad++; }
  if (bad) { console.error(`\n校验失败：${bad} 项`); process.exit(1); }
  if (!quiet) console.log(`\n✓ ${entries.length} 个产物校验通过，14 个函数齐全`);
}

function cmdFunctions(json) {
  const f = loadFunctions();
  if (json) { console.log(JSON.stringify(f, null, 2)); return; }
  console.log(`模式: ${f.mode}   schemaVersion: ${f.schemaVersion}`);
  console.log(`服务端密钥: ${(f.serverSecrets || []).join(", ")}`);
  console.log(`Dashboard 构建变量: ${(f.dashboardBuildVariables || []).join(", ")}`);
  console.log(`排除: ${(f.excluded || []).join("; ")}`);
  console.log();
  f.functions.forEach((x, i) => {
    console.log(`${String(i + 1).padStart(2)}. ${x.slug.padEnd(46)} ${x.public ? "[public]" : ""}`);
  });
}

function emitSql(name) {
  const p = path.join(A, name);
  if (!exists(p)) die(`找不到 ${name}`);
  // `docker run ... sql | head` 会提前关闭管道；忽略 EPIPE，避免 node 抛未处理异常
  process.stdout.on("error", err => {
    if (err.code === "EPIPE") process.exit(0);
    throw err;
  });
  process.stdout.write(fs.readFileSync(p));
}

function cmdExport(dest) {
  if (!dest) die("用法: export <目标目录>（需挂载可写 volume）");
  const target = path.resolve(dest);
  fs.mkdirSync(target, { recursive: true });
  // 只允许导出 artifacts 目录下的内容，避免路径穿越
  function copyDir(from, to) {
    fs.mkdirSync(to, { recursive: true });
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
      const s = path.join(from, e.name), d = path.join(to, e.name);
      if (e.isDirectory()) copyDir(s, d);
      else fs.copyFileSync(s, d);
    }
  }
  copyDir(A, target);
  fs.copyFileSync(BUILD, path.join(target, "BUILD.json"));
  console.log(`已导出到 ${target}`);
  console.log("下一步: 按 'commands' 输出在 VPS 上执行 SQL 与函数部署");
}

function cmdChecksums() {
  for (const e of sums()) console.log(`${e.expected}  ${e.file}`);
}

function cmdCommands() {
  const b = loadBuild();
  const f = loadFunctions();
  const ver = b.version;
  const img = process.env.TT_IMAGE || "ghcr.io/quietsugar/token-tracker-self-hosting";
  console.log("# 在 VPS 上执行（本镜像不连实例、不执行这些命令）");
  console.log(`# 镜像: ${img}:${ver}`);
  console.log();
  console.log("# 0) 前置：InsForge v2.3.3 平台已就绪，PostgreSQL 15.18，已备份数据库");
  console.log("#    备份工具必须是 15 系（官方镜像默认 18.4 会因 transaction_timeout 失败）");
  console.log();
  console.log("# 1) 导出全部产物到宿主机目录");
  console.log(`mkdir -p ./tokentracker-${ver}`);
  console.log(`docker run --rm -v "$PWD/tokentracker-${ver}:/out" ${img}:${ver} export /out`);
  console.log(`(cd tokentracker-${ver} && sha256sum -c SHA256SUMS)`);
  console.log();
  console.log("# 2) 应用基线 SQL（独立事务 + 安装锁；幂等）");
  console.log(`psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f ./tokentracker-${ver}/tokentracker-install.sql`);
  console.log("#    平台迁移通道请用 tokentracker-migration.sql（无事务包装）：");
  console.log(`#    cp ./tokentracker-${ver}/tokentracker-migration.sql <platform>/migrations/<新版本号>_tokentracker-self-host.sql`);
  console.log("#    npx -y @insforge/cli@0.2.8 db migrations up --all --yes --json");
  console.log();
  console.log("# 3) 校验安装清单（应为 15 行，与 manifest-report.md 的 checksum 一致）");
  console.log(`psql "$DATABASE_URL" -c "SELECT step,checksum FROM public.tokentracker_self_host_installations ORDER BY step;"`);
  console.log();
  console.log(`# 4) 通过自有 InsForge 管理界面按 functions/functions.json 上传 ${f.functions.length} 个函数`);
  console.log(`#    产物目录: ./tokentracker-${ver}/functions/`);
  console.log("#    公开入口: tokentracker-device-flow-authorize / -poll");
  console.log("#    不要部署付费 webhook、社区排行榜、device-usage-reset");
  console.log();
  console.log("# 5) 配置函数侧环境变量（值只存在于服务器，不进镜像）");
  console.log("#    INSFORGE_BASE_URL / INSFORGE_SERVICE_ROLE_KEY / ANON_KEY");
  console.log("#    JWT_SECRET(或 JWT_PUBLIC_KEY) / TOKENTRACKER_DASHBOARD_URL");
  console.log("#    TOKENTRACKER_BILLING_ENVIRONMENT=live");
  console.log("#    TOKENTRACKER_DASHBOARD_URL 必须是自有 HTTPS 域名（或 loopback HTTP）");
  console.log();
  console.log("# 6) 客户端指向自有实例");
  console.log("npx tokentracker init --base-url https://api.your-domain.example \\");
  console.log("  --anon-key <anon_key> --dashboard-url https://dashboard.your-domain.example");
  console.log("tokentracker status --json");
  console.log();
  console.log("# 7) 按 docs/runbook.md 与 releases/<ver>/acceptance.md 验收");
}

function usage() {
  console.log("用法: docker run --rm <image> <command> [args]");
  console.log();
  console.log("  info                 显示版本、上游 commit、产物摘要（默认）");
  console.log("  verify [--quiet]     校验内部 SHA256SUMS 与 14 个函数");
  console.log("  functions [--json]   列出 14 个私有函数与公开入口");
  console.log("  sql                  输出 tokentracker-install.sql 到 stdout");
  console.log("  migration            输出 tokentracker-migration.sql 到 stdout");
  console.log("  checksums            输出 SHA256SUMS");
  console.log("  export <dir>         导出全部产物到挂载目录");
  console.log("  commands             输出在 VPS 上要执行的完整命令清单");
  console.log();
  console.log("本镜像不连接实例、不执行 psql、不上传函数、不持有凭据。");
}

function main() {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd || "info") {
    case "info": cmdInfo(); break;
    case "verify": cmdVerify(args.includes("--quiet")); break;
    case "functions": cmdFunctions(args.includes("--json")); break;
    case "sql": emitSql("tokentracker-install.sql"); break;
    case "migration": emitSql("tokentracker-migration.sql"); break;
    case "checksums": cmdChecksums(); break;
    case "export": cmdExport(args[0]); break;
    case "commands": cmdCommands(); break;
    case "help": case "-h": case "--help": usage(); break;
    default: console.error(`未知命令: ${cmd}`); usage(); process.exit(2);
  }
}
main();
