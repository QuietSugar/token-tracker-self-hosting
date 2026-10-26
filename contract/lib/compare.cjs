#!/usr/bin/env node
/**
 * 对比器：把候选实现的归一化响应与 golden 逐字段比较，生成结构化 diff 与报告。
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { stable } = require("./normalize.cjs");

const ROOT = path.resolve(__dirname, "..");

function loadWaivers(file) {
  if (!file || !fs.existsSync(file)) return [];
  const d = JSON.parse(fs.readFileSync(file, "utf8"));
  return (d.waivers || []).map(w => ({ ...w, _pattern: new RegExp(
    "^" + w.case.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*") + "$") }));
}
function isWaived(waivers, caseId, fieldPath) {
  return waivers.some(w => w._pattern.test(caseId) && (!w.path || w.path === fieldPath || fieldPath.startsWith(w.path + ".")));
}

/** 递归生成结构化差异 */
function diffValues(expected, actual, base = "$", out = []) {
  if (expected === actual) return out;
  if (typeof expected !== typeof actual || expected === null || actual === null ||
      typeof expected !== "object" || typeof actual !== "object") {
    out.push({ path: base, expected, actual }); return out;
  }
  if (Array.isArray(expected) !== Array.isArray(actual)) {
    out.push({ path: base, expected: `<${Array.isArray(expected) ? "array" : "object"}>`,
      actual: `<${Array.isArray(actual) ? "array" : "object"}>` });
    return out;
  }
  if (Array.isArray(expected)) {
    if (expected.length !== actual.length) {
      out.push({ path: base + ".length", expected: expected.length, actual: actual.length });
    }
    const n = Math.min(expected.length, actual.length);
    for (let i = 0; i < n; i++) diffValues(expected[i], actual[i], `${base}[${i}]`, out);
    return out;
  }
  for (const k of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
    if (!(k in expected)) out.push({ path: `${base}.${k}`, expected: "<absent>", actual: stable(actual[k]) });
    else if (!(k in actual)) out.push({ path: `${base}.${k}`, expected: stable(expected[k]), actual: "<absent>" });
    else diffValues(expected[k], actual[k], `${base}.${k}`, out);
  }
  return out;
}

function compareCase(golden, candidate, waivers = []) {
  const diffs = [];
  // 计时字段不参与一致性判定
  const strip = c => ({ ...c, steps: (c.steps || []).map(({ _elapsedMs, ...s }) => s) });
  candidate = strip(candidate);
  const gSteps = golden.steps || [], cSteps = candidate.steps || [];
  if (gSteps.length !== cSteps.length) {
    diffs.push({ path: "$.steps.length", expected: gSteps.length, actual: cSteps.length });
  }
  const n = Math.min(gSteps.length, cSteps.length);
  for (let i = 0; i < n; i++) {
    const g = gSteps[i].response, c = cSteps[i].response;
    for (const field of ["status", "headers", "body"]) {
      const d = diffValues(g?.[field], c?.[field], `$.steps[${i}].${field}`);
      for (const item of d) {
        if (isWaived(waivers, golden.id, item.path)) item.waived = true;
        diffs.push(item);
      }
    }
  }
  const failures = diffs.filter(d => !d.waived);
  return {
    id: golden.id,
    group: golden.group,
    tags: golden.tags || [],
    result: failures.length === 0 ? "PASS" : "FAIL",
    diffCount: diffs.length,
    failureCount: failures.length,
    waiverCount: diffs.length - failures.length,
    diffs: diffs.slice(0, 50),   // 防止报告爆炸
  };
}

function compareAll(goldenDir, candidateCases, { waiversFile, capabilitiesFile } = {}) {
  const waivers = loadWaivers(waiversFile);
  const capabilities = capabilitiesFile && fs.existsSync(capabilitiesFile)
    ? JSON.parse(fs.readFileSync(capabilitiesFile, "utf8")) : { skip: [] };
  const skipSet = new Set(capabilities.skip || []);

  const goldenFiles = fs.readdirSync(goldenDir).filter(f => f.endsWith(".case.json"));
  const results = [];
  const byId = new Map(candidateCases.map(c => [c.id, c]));

  for (const f of goldenFiles.sort()) {
    const golden = JSON.parse(fs.readFileSync(path.join(goldenDir, f), "utf8"));
    const candidate = byId.get(golden.id);
    if (!candidate) {
      results.push({ id: golden.id, group: golden.group, result: "MISSING", failureCount: 1, diffs: [{ path: "$", expected: "case", actual: "<not produced>" }] });
      continue;
    }
    if (skipSet.has(golden.id)) {
      results.push({ id: golden.id, group: golden.group, result: "SKIP", failureCount: 0,
        reason: capabilities.reasons?.[golden.id] || "declared in capabilities.json", diffs: [] });
      continue;
    }
    results.push(compareCase(golden, candidate, waivers));
  }

  const summary = {
    total: results.length,
    pass: results.filter(r => r.result === "PASS").length,
    fail: results.filter(r => r.result === "FAIL" || r.result === "MISSING").length,
    skip: results.filter(r => r.result === "SKIP").length,
    waived: results.reduce((n, r) => n + (r.waiverCount || 0), 0),
    diffs: results.reduce((n, r) => n + (r.failureCount || 0), 0),
  };
  return { summary, results, waivers: waivers.map(({ _pattern, ...w }) => w) };
}

function renderMarkdown(report, { title = "契约一致性报告" } = {}) {
  const s = report.summary;
  const lines = [
    `# ${title}`,
    "",
    `生成时间：${report.generatedAt}`,
    "",
    "| 指标 | 值 |",
    "|---|---:|",
    `| 用例总数 | ${s.total} |`,
    `| ✅ PASS | ${s.pass} |`,
    `| ❌ FAIL | ${s.fail} |`,
    `| ⏭ SKIP | ${s.skip} |`,
    `| 📋 已登记偏差 | ${s.waived} |`,
    `| 差异字段数 | ${s.diffs} |`,
    "",
    `**结论：${s.fail === 0 ? "通过" : "未通过"}**`,
    "",
  ];
  if (s.fail > 0) {
    lines.push("## 失败用例", "");
    for (const r of report.results.filter(x => x.result === "FAIL" || x.result === "MISSING")) {
      lines.push(`### \`${r.id}\` — ${r.failureCount} 处差异`, "");
      lines.push("| 路径 | 期望 | 实际 |");
      lines.push("|---|---|---|");
      for (const d of (r.diffs || []).filter(x => !x.waived).slice(0, 20)) {
        const e = JSON.stringify(d.expected), a = JSON.stringify(d.actual);
        lines.push(`| \`${d.path}\` | ${e?.slice(0, 160)} | ${a?.slice(0, 160)} |`);
      }
      lines.push("");
    }
  }
  if (s.skip > 0) {
    lines.push("## 跳过用例", "");
    for (const r of report.results.filter(x => x.result === "SKIP")) lines.push(`- \`${r.id}\`: ${r.reason}`);
    lines.push("");
  }
  if (report.waivers?.length) {
    lines.push("## 已登记偏差", "");
    for (const w of report.waivers) lines.push(`- \`${w.case}\` / \`${w.path || "*"}\`: ${w.reason}`);
    lines.push("");
  }
  lines.push("## 全量结果", "", "| 用例 | 结果 | 差异 |", "|---|---|---:|");
  for (const r of report.results) lines.push(`| \`${r.id}\` | ${r.result} | ${r.failureCount || 0} |`);
  lines.push("");
  return lines.join("\n");
}

module.exports = { compareAll, compareCase, diffValues, renderMarkdown };
