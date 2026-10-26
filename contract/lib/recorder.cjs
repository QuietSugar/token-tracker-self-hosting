#!/usr/bin/env node
/**
 * 录制器：用参考实现跑全部用例，生成 golden 快照。
 *
 * 用法: node contract/lib/recorder.cjs [--out DIR] [--seed SEED] [--only CASE_ID]
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { runAll, loadScenarios } = require("./runner.cjs");
const { normalizeResponse, stable } = require("./normalize.cjs");
const { extractStatic } = require("./static.cjs");
const { runPool } = require("./pool.cjs");
const { CONTRACT_NOW } = require("./harness.cjs");

const ROOT = path.resolve(__dirname, "..");
const REPO = path.resolve(ROOT, "..");

function sha256(s) { return crypto.createHash("sha256").update(s).digest("hex"); }

function parseArgs() {
  const a = process.argv.slice(2);
  const o = { out: null, seed: null, only: null, version: null };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--out") o.out = a[++i];
    else if (a[i] === "--seed") o.seed = a[++i];
    else if (a[i] === "--only") o.only = a[++i];
    else if (a[i] === "--version") o.version = a[++i];
  }
  return o;
}

async function main() {
  const args = parseArgs();
  const ref = fs.readFileSync(path.join(REPO, "tracking/REF"), "utf8");
  const version = args.version || ref.match(/^VERSION=(.*)$/m)[1].trim();
  const commit = ref.match(/^COMMIT=(.*)$/m)[1].trim();
  const outDir = args.out || path.join(ROOT, "golden", version);
  fs.mkdirSync(outDir, { recursive: true });

  const adapterPath = process.env.CONTRACT_ADAPTER || path.join(ROOT, "adapters/reference.cjs");
  const adapterModule = require(path.resolve(adapterPath));
  const seed = args.seed || loadScenarios().index.seed;

  console.log("=== 契约录制 ===");
  console.log("adapter :", adapterModule.name, "from", adapterPath);
  console.log("version :", version, "| commit:", commit);
  console.log("seed    :", seed);
  console.log("out     :", outDir);
  console.log();

  const t0 = Date.now();
  // 每个 case 独立子进程，避免 PGlite WASM 堆累积导致 OOM。
  const { index: loadedIndex, groups } = loadScenarios();
  const allCases = [];
  for (const g of groups) for (const c of g.cases) allCases.push({ ...c, group: g.group });
  const concurrency = Number(process.env.CONTRACT_CONCURRENCY || 1);
  const cases = await runPool(allCases, {
    seed,
    adapterPath,
    concurrency,
    normalize: { referenceNow: CONTRACT_NOW },
    timeoutMs: Number(process.env.CONTRACT_CASE_TIMEOUT || 180000),
    onProgress: (done, total, id) => {
      if (done % 5 === 0 || done === total) console.log(`  [${done}/${total}] ${id}`);
    },
  });
  const result = { cases };
  result.implementation = { name: adapterModule.name, engine: adapterModule.engine, language: adapterModule.language };
  result.upstream = { version, commit, repository: "https://github.com/xiufengsun/TokenTracker.git" };

  // 逐 case 写文件（便于 git diff 精确定位）
  const written = [];
  for (const c of result.cases) {
    if (args.only && c.id !== args.only) continue;
    const safe = c.id.replace(/[^a-zA-Z0-9._-]/g, "__");
    const file = `${safe}.case.json`;
    // 剔除耗时机能字段：golden 必须可复现
    const { _elapsedMs, ...clean } = c;
    const content = JSON.stringify(clean, null, 2) + "\n";
    fs.writeFileSync(path.join(outDir, file), content);
    written.push(file);
  }

  // 静态契约
  const staticData = extractStatic({ version, commit });
  fs.writeFileSync(path.join(outDir, "static.json"), JSON.stringify(staticData, null, 2) + "\n");
  written.push("static.json");

  // 元信息
  const meta = {
    schemaVersion: 1,
    product: "tokentracker-selfhost-contract-golden",
    upstream: result.upstream,
    implementation: result.implementation,
    seed,
    recordedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    caseCount: result.cases.length,
    stepCount: result.cases.reduce((n, c) => n + c.steps.length, 0),
    scenarioGroups: loadScenarios().groups.map(g => ({ group: g.group, cases: g.cases.length })),
    normalizeVersion: 1,
    runnerVersion: 1,
    note: "录制自上游 PGlite fixture（真实 SQL + 真实打包 handler 的 loopback HTTP 响应）。",
  };
  fs.writeFileSync(path.join(outDir, "_meta.json"), JSON.stringify(meta, null, 2) + "\n");
  written.push("_meta.json");

  // 索引（不含时间戳，保证可复现）
  const indexData = {
    version, commit, seed,
    cases: result.cases.map(c => ({ id: c.id, group: c.group, tags: c.tags, steps: c.steps.length })),
  };
  fs.writeFileSync(path.join(outDir, "index.json"), JSON.stringify(indexData, null, 2) + "\n");
  written.push("index.json");

  // SHA256SUMS（排除 _meta.json，因为它含录制时间）
  const sums = written.filter(f => f !== "_meta.json" && f !== "SHA256SUMS").sort().map(f => {
    const b = fs.readFileSync(path.join(outDir, f));
    return `${sha256(b)}  ${f}`;
  }).join("\n") + "\n";
  fs.writeFileSync(path.join(outDir, "SHA256SUMS"), sums);

  // 清理旧 case 文件（避免删除 golden 后残留）
  for (const f of fs.readdirSync(outDir)) {
    if (f.endsWith(".case.json") && !written.includes(f)) fs.unlinkSync(path.join(outDir, f));
  }

  console.log(`录制完成: ${result.cases.length} 用例 / ${meta.stepCount} 步骤 / ${Date.now() - t0}ms`);
  const failed = result.cases.filter(c => c.steps.some(s => s.response.body?.runnerError));
  if (failed.length) {
    console.error(`\n✗ 录制失败：${failed.length} 个用例含 runnerError（不写 golden，避免污染基准）：`);
    for (const c of failed) {
      const e = c.steps.find(s => s.response.body?.runnerError);
      console.error(`  - ${c.id}: ${e.response.body.runnerError.slice(0, 160)}`);
    }
    console.error("\n常见原因：并发过高导致 PGlite OOM。设 CONTRACT_CONCURRENCY=1 重试。");
    // 删除刚写的不完整产物
    for (const f of written) { try { fs.unlinkSync(path.join(outDir, f)); } catch {} }
    process.exit(1);
  }
  console.log(`\n输出: ${outDir}`);
  console.log(`SHA256SUMS:\n${sums.trim().split("\n").slice(0, 4).join("\n")}\n...`);
}
main().catch(e => { console.error("RECORD FAILED:", e); process.exit(1); });
