#!/usr/bin/env node
/**
 * 验证器：对某个 adapter 跑全部用例 → 与 golden 对比 → 生成报告 → 按结果退出。
 *
 * 用法: node contract/lib/verify.cjs [--adapter PATH] [--golden DIR] [--report FILE] [--json]
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { runPool } = require("./pool.cjs");
const { loadScenarios } = require("./runner.cjs");
const { compareAll, renderMarkdown } = require("./compare.cjs");
const { CONTRACT_NOW } = require("./harness.cjs");
const { extractStatic } = require("./static.cjs");
const { stable } = require("./normalize.cjs");

const ROOT = path.resolve(__dirname, "..");
const REPO = path.resolve(ROOT, "..");

function parseArgs() {
  const a = process.argv.slice(2), o = { adapter: null, golden: null, report: null, json: false, staticOnly: false };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--adapter") o.adapter = a[++i];
    else if (a[i] === "--golden") o.golden = a[++i];
    else if (a[i] === "--report") o.report = a[++i];
    else if (a[i] === "--json") o.json = true;
    else if (a[i] === "--static-only") o.staticOnly = true;
  }
  return o;
}

async function main() {
  const args = parseArgs();
  const ref = fs.readFileSync(path.join(REPO, "tracking/REF"), "utf8");
  const version = ref.match(/^VERSION=(.*)$/m)[1].trim();
  const goldenDir = args.golden || path.join(ROOT, "golden", version);
  const adapterPath = path.resolve(args.adapter || process.env.CONTRACT_ADAPTER
    || path.join(ROOT, "adapters/reference.cjs"));
  const adapter = require(adapterPath);

  console.log("=== 契约一致性验证 ===");
  console.log("golden     :", goldenDir);
  console.log("adapter    :", adapter.name, "from", adapterPath);
  console.log("frozen now :", CONTRACT_NOW);
  console.log();

  // ---------- L1 静态契约 ----------
  const goldenStatic = JSON.parse(fs.readFileSync(path.join(goldenDir, "static.json"), "utf8"));
  const currentStatic = extractStatic({ version });
  const staticDiff = (() => {
    // 只比较实现者必须遵守的确定性部分
    const keys = ["steps", "functions", "sqlObjects", "pgFeatureCounts", "artifacts"];
    const out = [];
    for (const k of keys) {
      if (stable(goldenStatic[k]) !== stable(currentStatic[k])) out.push(k);
    }
    return out;
  })();
  console.log(`[L1] 静态契约: ${staticDiff.length === 0 ? "✓ 一致" : "✗ 差异 " + staticDiff.join(", ")}`);

  if (args.staticOnly) {
    process.exit(staticDiff.length === 0 ? 0 : 1);
  }

  // ---------- L2 行为契约 ----------
  const { index, groups } = loadScenarios();
  const allCases = [];
  for (const g of groups) for (const c of g.cases) allCases.push({ ...c, group: g.group });

  const concurrency = Number(process.env.CONTRACT_CONCURRENCY || 1);
  const candidateCases = await runPool(allCases, {
    seed: index.seed,
    adapterPath,
    concurrency,
    normalize: { referenceNow: CONTRACT_NOW },
    timeoutMs: Number(process.env.CONTRACT_CASE_TIMEOUT || 180000),
    onProgress: (done, total, id) => {
      if (done % 10 === 0 || done === total) console.log(`  [${done}/${total}] ${id}`);
    },
  });

  const runnerErrors = candidateCases.filter(c => c.steps.some(s => s.response.body?.runnerError));
  if (runnerErrors.length) {
    console.error(`\n✗ ${runnerErrors.length} 个用例执行失败（workerError），不生成一致性结论：`);
    for (const c of runnerErrors.slice(0, 10)) {
      const e = c.steps.find(s => s.response.body?.runnerError);
      console.error(`  - ${c.id}: ${e.response.body.runnerError.slice(0, 160)}`);
    }
    console.error("\n若是 PGlite OOM，设 CONTRACT_CONCURRENCY=1 重试。");
    process.exit(2);
  }

  const goldenCases = fs.readdirSync(goldenDir)
    .filter(f => f.endsWith(".case.json"))
    .map(f => JSON.parse(fs.readFileSync(path.join(goldenDir, f), "utf8")));

  const waiversFile = process.env.CONTRACT_WAIVERS || path.join(ROOT, "waivers.json");
  const capabilitiesFile = process.env.CONTRACT_CAPABILITIES || path.join(ROOT, "capabilities.json");
  const cmp = compareAll(goldenDir, candidateCases, { waiversFile, capabilitiesFile });
  const report = {
    generatedAt: new Date().toISOString(),
    golden: { dir: goldenDir, version, recordedAt: JSON.parse(fs.readFileSync(path.join(goldenDir, "_meta.json"), "utf8")).recordedAt },
    implementation: { name: adapter.name, engine: adapter.engine, language: adapter.language },
    staticContract: { result: staticDiff.length === 0 ? "PASS" : "FAIL", differingSections: staticDiff },
    ...cmp,
  };

  const md = renderMarkdown(report, { title: `契约一致性报告 — ${adapter.name} vs ${version} golden` });
  const reportFile = args.report || path.join(ROOT, "report.md");
  fs.writeFileSync(reportFile, md);
  if (args.json) fs.writeFileSync(reportFile.replace(/\.md$/, ".json"), JSON.stringify(report, null, 2) + "\n");

  console.log();
  console.log(`[L2] 行为契约: ${cmp.summary.pass} PASS / ${cmp.summary.fail} FAIL / ${cmp.summary.skip} SKIP / ${cmp.summary.waived} waived`);
  console.log(`报告: ${reportFile}`);
  const fail = cmp.summary.fail > 0 || staticDiff.length > 0;
  if (fail) {
    console.log("\n失败用例:");
    for (const r of report.results.filter(x => x.result === "FAIL" || x.result === "MISSING").slice(0, 15)) {
      console.log(`  - ${r.id}: ${r.failureCount} 处差异`);
      for (const d of (r.diffs || []).filter(x => !x.waived).slice(0, 3)) {
        console.log(`      ${d.path}: ${JSON.stringify(d.expected)?.slice(0, 80)} != ${JSON.stringify(d.actual)?.slice(0, 80)}`);
      }
    }
  }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error("VERIFY FAILED:", e); process.exit(2); });
