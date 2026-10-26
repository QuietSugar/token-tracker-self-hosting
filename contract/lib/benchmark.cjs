#!/usr/bin/env node
/**
 * 性能基准：对参考实现（或候选实现）跑一组热路径用例，记录耗时分布。
 * 输出 JSON + Markdown 报告。不参与一致性判定（golden 里不含耗时）。
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { runPool } = require("./pool.cjs");
const { loadScenarios } = require("./runner.cjs");
const { CONTRACT_NOW } = require("./harness.cjs");

const ROOT = path.resolve(__dirname, "..");

/** 热路径用例：可重复执行的单步调用，用于测量延迟 */
const BENCH_SCENARIOS = [
  { id: "bench/account-summary-empty", group: "benchmark", tags: ["bench", "read"],
    given: { users: 1 }, steps: [
      { op: "request", call: "tokentracker-account-summary", as: "owner",
        query: { from: "2026-10-01", to: "2026-10-01", tz: "UTC" } } ] },
  { id: "bench/account-summary-populated", group: "benchmark", tags: ["bench", "read", "aggregation"],
    given: { users: 1, devices: 1, usage: [100, 250, 75, 420, 90] }, steps: [
      { op: "request", call: "tokentracker-account-summary", as: "owner",
        query: { from: "2026-10-01", to: "2026-10-01", tz: "UTC" } } ] },
  { id: "bench/ingest-single", group: "benchmark", tags: ["bench", "write"],
    given: { users: 1, devices: 1 }, steps: [
      { op: "ingest", tokens: 100 } ] },
  { id: "bench/ingest-batch-80", group: "benchmark", tags: ["bench", "write", "scale"],
    given: { users: 1, devices: 1 }, steps: [
      { op: "ingestBatch", count: 80, modelPrefix: "bench-model-", baseTokens: 100 } ] },
  { id: "bench/model-breakdown", group: "benchmark", tags: ["bench", "read", "aggregation"],
    given: { users: 1, devices: 1, usage: [100, 200] }, steps: [
      { op: "request", call: "tokentracker-account-model-breakdown", as: "owner",
        query: { from: "2026-10-01", to: "2026-10-01", tz: "UTC" } } ] },
  { id: "bench/device-flow-full", group: "benchmark", tags: ["bench", "auth"],
    given: { users: 1 }, steps: [
      { op: "request", call: "tokentracker-device-flow-authorize", as: "anon",
        body: { client_info: "Bench CLI", machine_id: "@machine:1" } },
      { op: "request", call: "tokentracker-device-flow-grant", as: "owner",
        bodyFrom: "flow.user_code", bodyWrap: "user_code" },
      { op: "request", call: "tokentracker-device-flow-poll", as: "anon",
        bodyFrom: "flow.device_code", bodyWrap: "device_code" } ] },
  { id: "bench/billing-account", group: "benchmark", tags: ["bench", "billing"],
    given: { users: 1 }, steps: [
      { op: "request", call: "tokentracker-billing", as: "owner", method: "GET",
        query: { action: "account" } } ] },
];

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, i)];
}

async function main() {
  const adapterPath = path.resolve(process.env.CONTRACT_ADAPTER || path.join(ROOT, "adapters/reference.cjs"));
  const iterations = Number(process.env.BENCH_ITERATIONS || 3);
  const adapter = require(adapterPath);
  const { index } = loadScenarios();

  console.log("=== 性能基准 ===");
  console.log("adapter   :", adapter.name);
  console.log("iterations:", iterations);
  console.log("注意：PGlite 单连接 WASM，绝对数值不代表生产 PostgreSQL。");
  console.log("      基准的价值在于**候选实现与参考实现的相对比值**。\n");

  const measurements = {};
  for (const s of BENCH_SCENARIOS) measurements[s.id] = [];

  for (let it = 1; it <= iterations; it++) {
    const results = await runPool(BENCH_SCENARIOS, {
      seed: index.seed, adapterPath, concurrency: 1,
      normalize: { referenceNow: CONTRACT_NOW }, timeoutMs: 180000,
    });
    for (const r of results) {
      const err = r.steps.some(s => s.response.body?.runnerError);
      if (err) { console.error(`  WARN ${r.id}: runnerError`); continue; }
      measurements[r.id].push(r._elapsedMs || 0);
    }
    process.stdout.write(`  iter ${it}/${iterations} done\n`);
  }

  const r1 = n => Math.round(n * 10) / 10;
  const stats = BENCH_SCENARIOS.map(s => {
    const raw = (measurements[s.id] || []).filter(x => x > 0).sort((a, b) => a - b);
    const vals = raw.map(r1);
    return {
      id: s.id, tags: s.tags, steps: s.steps.length, samples: vals.length,
      minMs: vals[0] || 0,
      p50Ms: r1(percentile(vals, 50)),
      p95Ms: r1(percentile(vals, 95)),
      maxMs: vals[vals.length - 1] || 0,
      meanMs: vals.length ? r1(vals.reduce((a, b) => a + b, 0) / vals.length) : 0,
    };
  });
  for (const k of Object.keys(measurements)) measurements[k] = measurements[k].map(r1);

  const report = {
    generatedAt: new Date().toISOString(),
    implementation: { name: adapter.name, engine: adapter.engine, language: adapter.language },
    iterations,
    environment: { node: process.version, platform: process.platform, arch: process.arch },
    disclaimer: "PGlite 单连接 WASM；仅用于跨实现相对比较，不是生产容量规划依据。",
    measurements,
    stats,
  };
  fs.writeFileSync(path.join(ROOT, "benchmark.json"), JSON.stringify(report, null, 2) + "\n");

  const lines = [
    "# 性能基准", "", `生成时间：${report.generatedAt}`, "",
    `实现：\`${adapter.name}\`（${adapter.engine} / ${adapter.language}）`, "",
    "> 注意：参考实现跑在 PGlite（单连接 WASM）上，绝对数值不代表生产 PostgreSQL。",
    "> 请用**候选实现 / 参考实现的比值**来判断性能回归。", "",
    "| 用例 | 步骤 | 样本 | min | p50 | p95 | max | mean |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
    ...stats.map(s => `| \`${s.id}\` | ${s.steps} | ${s.samples} | ${s.minMs} | ${s.p50Ms} | ${s.p95Ms} | ${s.maxMs} | ${s.meanMs} |`),
    "", "单位：毫秒（整个 case 的 wall time，含实例启动）。", "",
    "## 跨实现比较", "",
    "1. 先跑参考实现，保存 `contract/benchmark.json` 为 `benchmark.reference.json`。",
    "2. 再跑 Go+SQLite：`CONTRACT_ADAPTER=... ./contract/scripts/benchmark.sh`。",
    "3. 比较两份 `stats[].p50Ms` 的比值；>2x 视为需要调查的回归。", "",
    "## 复现", "", "```sh",
    "BENCH_ITERATIONS=3 ./contract/scripts/benchmark.sh", "```", "",
  ];
  fs.writeFileSync(path.join(ROOT, "BENCHMARK.md"), lines.join("\n"));
  console.log("\n✓ 基准报告: contract/BENCHMARK.md / contract/benchmark.json");
}
main().catch(e => { console.error("BENCH FAILED:", e); process.exit(1); });
