#!/usr/bin/env node
/**
 * Worker：在独立进程里跑一个 case，通过 stdout 输出 JSON 结果。
 * PGlite 的 WASM 堆在 close() 后不会归还给 OS；每个 case 一个进程是唯一可靠的回收方式。
 *
 * 用法: node worker.cjs <case-index> <scenarios-json-path> [adapter-path]
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { runCase, loadScenarios } = require("./runner.cjs");

async function main() {
  const caseIndex = Number(process.argv[2]);
  const scenariosFile = process.argv[3];
  const adapterPath = process.argv[4] || process.env.CONTRACT_ADAPTER
    || path.join(__dirname, "../adapters/reference.cjs");
  const normalize = process.argv[5] ? JSON.parse(process.argv[5]) : {};

  const payload = JSON.parse(fs.readFileSync(scenariosFile, "utf8"));
  const caseDef = payload.cases[caseIndex];
  const adapter = require(path.resolve(adapterPath));
  const a = await adapter.start({ seed: payload.seed });
  try {
    // 用单调时钟：harness 冻结了 Date（含 Date.now()），不能用 Date 测耗时。
    const t0 = process.hrtime.bigint();
    const r = await runCase(a, caseDef, { seed: payload.seed, continueOnError: true, normalize });
    const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;
    // 计时写入 result，但 golden 录制时会剔除（保证快照可复现）
    r._elapsedMs = elapsedMs;
    process.stdout.write(JSON.stringify({ ok: true, result: r }));
  } finally {
    await a.close();
  }
}
main().catch(e => {
  process.stdout.write(JSON.stringify({ ok: false, error: e.message, stack: e.stack }));
  process.exit(1);
});
