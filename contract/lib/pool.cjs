#!/usr/bin/env node
/**
 * 有界进程池：每个 case 在独立子进程里跑，避免 PGlite WASM 堆累积导致 OOM。
 * 并发度默认 1：实测并发 2 时两个 PGlite 实例峰值超过 1.5GB 可用内存，
 * 4 个重用例会被内核 OOM kill。CI runner（7GB）可安全设 CONTRACT_CONCURRENCY=3。
 */
"use strict";
const { fork } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const WORKER = path.join(__dirname, "worker.cjs");

function runOne(caseIndex, scenariosFile, adapterPath, timeoutMs = 180000, normalize = {}) {
  return new Promise((resolve, reject) => {
    const child = fork(WORKER, [String(caseIndex), scenariosFile, adapterPath || "", JSON.stringify(normalize)], {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      execArgv: ["--max-old-space-size=1024"],
      env: { ...process.env, CONTRACT_SEED: process.env.CONTRACT_SEED || "tokentracker-contract-v1" },
    });
    let out = "", err = "", done = false;
    const timer = setTimeout(() => {
      if (!done) { try { child.kill("SIGKILL"); } catch {} reject(new Error(`case ${caseIndex} timeout ${timeoutMs}ms`)); }
    }, timeoutMs);
    child.stdout.on("data", d => { out += d; });
    child.stderr.on("data", d => { err += d; });
    child.on("error", e => { clearTimeout(timer); reject(e); });
    child.on("close", code => {
      clearTimeout(timer);
      if (done) return;
      done = true;
      try {
        const parsed = JSON.parse(out);
        if (!parsed.ok) return reject(new Error(parsed.error + (err ? ` | stderr: ${err.slice(-300)}` : "")));
        resolve(parsed.result);
      } catch (e) {
        reject(new Error(`case ${caseIndex} bad worker output (exit ${code}): ${out.slice(0, 200)} | stderr: ${err.slice(-400)}`));
      }
    });
  });
}

async function runPool(cases, { seed, adapterPath, concurrency = 1, onProgress, timeoutMs, normalize = {} } = {}) {
  const tmp = path.join(os.tmpdir(), `contract-cases-${process.pid}.json`);
  fs.writeFileSync(tmp, JSON.stringify({ seed, cases }));
  const results = new Array(cases.length);
  let next = 0, done = 0;
  const workers = Array.from({ length: Math.min(concurrency, cases.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= cases.length) return;
      try {
        results[i] = await runOne(i, tmp, adapterPath, timeoutMs, normalize);
      } catch (e) {
        results[i] = { id: cases[i].id, group: cases[i].group, tags: cases[i].tags || [],
          seed, steps: [{ op: "worker", response: { status: 0, headers: {}, body: { runnerError: e.message } } }],
          _workerError: e.message };
      }
      done++;
      if (onProgress) onProgress(done, cases.length, cases[i].id);
    }
  });
  await Promise.all(workers);
  try { fs.unlinkSync(tmp); } catch {}
  return results;
}

module.exports = { runPool, runOne };
