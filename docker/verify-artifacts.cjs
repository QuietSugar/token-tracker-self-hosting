#!/usr/bin/env node
/**
 * 镜像构建期产物校验（在 Dockerfile 的 verify 阶段以 cwd=artifacts 运行）。
 * 独立文件是为了避免 Dockerfile 里多行 `node -e '...'` 被 parser 误判为指令。
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

function fail(msg) { console.error("artifact verify FAILED: " + msg); process.exit(1); }

for (const f of ["functions/functions.json", "tokentracker-install.sql",
                 "tokentracker-migration.sql", "manifest-report.md", "SHA256SUMS"]) {
  if (!fs.existsSync(f)) fail("missing " + f);
}

const m = JSON.parse(fs.readFileSync("functions/functions.json", "utf8"));
if (!Array.isArray(m.functions) || m.functions.length !== 14) fail("functions.json must list 14 entries");
if (m.mode !== "self_hosted") fail("unexpected manifest mode: " + m.mode);
for (const f of m.functions) {
  if (!fs.existsSync(path.join("functions", f.file))) fail("missing function file " + f.file);
}
const jsCount = fs.readdirSync("functions").filter(n => n.endsWith(".js")).length;
if (jsCount !== 14) fail("expected 14 .js files, got " + jsCount);

const report = fs.readFileSync("manifest-report.md", "utf8");
const steps = report.match(/安装步骤数：\*\*(\d+)\*\*/);
if (!steps) fail("manifest-report.md missing step count");
if (Number(steps[1]) < 15) fail("unexpected low step count: " + steps[1]);

const exts = [".md", ".sql", ".js", ".json", ".txt"];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!exts.includes(path.extname(e.name))) continue;
    const b = fs.readFileSync(p);
    if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) fail("BOM in " + p);
    try { new TextDecoder("utf-8", { fatal: true }).decode(b); }
    catch { fail("non-UTF8 in " + p); }
  }
}
walk(".");
console.log(`artifact verify: OK (${m.functions.length} functions, ${steps[1]} steps, UTF-8, checksums)`);
