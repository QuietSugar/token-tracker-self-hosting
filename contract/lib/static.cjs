#!/usr/bin/env node
/**
 * L1 静态契约提取：不依赖运行时，从 releases/<version>/ 提取实现者规格书。
 * 这是 Go+SQLite 改造的"要建什么"清单。
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const REPO = path.resolve(ROOT, "..");

function sha256(s) { return crypto.createHash("sha256").update(s).digest("hex"); }

function extractStatic({ version, commit } = {}) {
  const ref = fs.readFileSync(path.join(REPO, "tracking/REF"), "utf8");
  version = version || ref.match(/^VERSION=(.*)$/m)[1].trim();
  commit = commit || ref.match(/^COMMIT=(.*)$/m)[1].trim();
  const dir = path.join(REPO, "releases", version);
  const sql = fs.readFileSync(path.join(dir, "tokentracker-install.sql"), "utf8");
  const migrationSql = fs.readFileSync(path.join(dir, "tokentracker-migration.sql"), "utf8");
  const report = fs.readFileSync(path.join(dir, "manifest-report.md"), "utf8");
  const functions = JSON.parse(fs.readFileSync(path.join(dir, "functions/functions.json"), "utf8"));
  const sums = fs.readFileSync(path.join(dir, "SHA256SUMS"), "utf8").trim().split("\n");

  // 步骤 id + checksum + 字节数（来自 manifest-report.md 表格）
  const steps = [];
  const stepRe = /^\|\s*(\d+)\s*\|\s*`?([^`|]+?)`?\s*\|\s*`?([a-f0-9]{64})`?\s*\|\s*(\d+)\s*\|/gm;
  let m;
  while ((m = stepRe.exec(report))) {
    steps.push({ index: Number(m[1]), id: m[2].trim(), checksum: m[3], bytes: Number(m[4]) });
  }

  // SQL 对象清单
  const objects = { tables: [], views: [], functions: [], indexes: [], triggers: [], policies: [], grants: 0 };
  const push = (re, key, transform) => {
    let x; while ((x = re.exec(sql))) objects[key].push(transform ? transform(x) : x[1]);
  };
  push(/CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?([a-z_][a-z0-9_]*)/gi, "tables");
  push(/CREATE (?:OR REPLACE )?VIEW (?:public\.)?([a-z_][a-z0-9_]*)/gi, "views");
  push(/CREATE (?:OR REPLACE )?FUNCTION (?:public\.)?([a-z_][a-z0-9_]*)\s*\(([^)]*)\)/gi, "functions",
    x => ({ name: x[1], args: x[2].replace(/\s+/g, " ").trim() }));
  push(/CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?(?:public\.)?([a-z_][a-z0-9_]*)/gi, "indexes");
  push(/CREATE TRIGGER ([a-z_][a-z0-9_]*)/gi, "triggers");
  push(/CREATE POLICY ([a-z_][a-z0-9_]*)/gi, "policies");
  objects.grants = (sql.match(/\bGRANT\b/gi) || []).length;
  for (const k of ["tables", "views", "indexes", "triggers", "policies"]) objects[k] = [...new Set(objects[k])].sort();
  objects.functions = objects.functions
    .filter((v, i, a) => a.findIndex(x => x.name === v.name) === i)
    .sort((a, b) => a.name.localeCompare(b.name));

  // 依赖锁定（manifest-report.md 的依赖段）
  const deps = {};
  for (const line of report.split("\n")) {
    const d = line.match(/`?npm:[^`\s]+@([0-9][^`\s]*)`?\s*[\|—-]?\s*`?([a-z@/-]+@?[\d.]+)?/i);
    if (d) deps[d[1]] = d[2] || "see report";
  }

  return {
    schemaVersion: 1,
    upstream: { version, commit, repository: "https://github.com/xiufengsun/TokenTracker.git" },
    artifacts: {
      installSql: { bytes: Buffer.byteLength(sql), sha256: sha256(sql), startsWith: sql.slice(0, 60), endsWith: sql.slice(-40) },
      migrationSql: { bytes: Buffer.byteLength(migrationSql), sha256: sha256(migrationSql), startsWith: migrationSql.slice(0, 60) },
      sha256sums: sums.map(l => l.trim()).filter(Boolean),
    },
    steps: { count: steps.length, items: steps },
    functions: {
      count: functions.functions.length,
      publicSlugs: functions.functions.filter(f => f.public).map(f => f.slug),
      slugs: functions.functions.map(f => f.slug),
      items: functions.functions,
      serverSecrets: functions.serverSecrets,
      dashboardBuildVariables: functions.dashboardBuildVariables,
      excluded: functions.excluded,
      mode: functions.mode,
    },
    sqlObjects: objects,
    pgFeatureCounts: {
      jsonb: (sql.match(/\bjsonb\b/gi) || []).length,
      timestamptz: (sql.match(/\btimestamptz\b/gi) || []).length,
      plpgsqlFunctions: (sql.match(/CREATE (?:OR REPLACE )?FUNCTION/gi) || []).length,
      triggers: (sql.match(/CREATE TRIGGER/gi) || []).length,
      rlsPolicies: (sql.match(/CREATE POLICY/gi) || []).length,
      rlsEnable: (sql.match(/ENABLE ROW LEVEL SECURITY/gi) || []).length,
      advisoryLocks: (sql.match(/pg_advisory_xact_lock/gi) || []).length,
      authUid: (sql.match(/auth\.uid\(\)/gi) || []).length,
      grants: (sql.match(/\bGRANT\b/gi) || []).length,
      onConflict: (sql.match(/ON CONFLICT/gi) || []).length,
      cte: (sql.match(/\bWITH\b/gi) || []).length,
      securityDefiner: (sql.match(/SECURITY DEFINER/gi) || []).length,
    },
    dependencies: {
      "npm:@insforge/sdk@1.4.5": "1.4.5",
      "alipay-sdk": "4.14.0",
      "urllib": "4.9.1",
      "@waffo/pancake-ts": "0.25.0",
      note: "见 manifest-report.md 的依赖锁定段；Go 实现需登记等价依赖。",
    },
    platform: { insforge: "v2.3.3", postgres: "15.18", deno: "2.0.6", node: ">=20" },
  };
}

module.exports = { extractStatic };
if (require.main === module) {
  console.log(JSON.stringify(extractStatic(), null, 2));
}
