#!/usr/bin/env node
/**
 * 生成自托管清单摘要（供升级评审与审计）。
 * 用法: node scripts/summarize.cjs <upstream-dir> <release-dir>
 *
 * checksum 与 scripts/self-host/install.cjs 完全一致：sha256(step.sql)，
 * 写入 public.tokentracker_self_host_installations。
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");

const upstream = process.argv[2] && path.resolve(process.argv[2]);
const out = process.argv[3] && path.resolve(process.argv[3]);
if (!upstream || !out) {
  console.error("用法: summarize.cjs <upstream-dir> <release-dir>");
  process.exit(1);
}

const manifest = require(path.join(upstream, "scripts/self-host/manifest.cjs"));
const steps = manifest.steps();
const digest = sql => createHash("sha256").update(sql).digest("hex");
const head = execFileSync("git", ["-C", upstream, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const functionsJson = path.join(out, "functions", "functions.json");
const fnManifest = fs.existsSync(functionsJson)
  ? JSON.parse(fs.readFileSync(functionsJson, "utf8"))
  : null;

// 可复现构建：时间取 SOURCE_DATE_EPOCH（上游 commit 时间），且不写入本地绝对路径
const epoch = process.env.SOURCE_DATE_EPOCH
  ? Number(process.env.SOURCE_DATE_EPOCH) * 1000
  : Date.now();
const generatedAt = new Date(epoch).toISOString().replace(/\.\d{3}Z$/, "Z");

const L = [];
L.push("# 自托管清单摘要");
L.push("");
L.push(`- 生成时间：${generatedAt}（SOURCE_DATE_EPOCH，可复现）`);
L.push(`- 构建版本：\`${process.env.TT_VERSION || "unknown"}\``);
L.push(`- 上游 HEAD：\`${head}\``);
L.push(`- 安装步骤数：**${steps.length}**`);
L.push(`- 私有函数数：**${manifest.privateFunctions.length}**`);
L.push("");
L.push("## 安装步骤");
L.push("");
L.push("| # | step id | sha256(step.sql) | bytes |");
L.push("|---|---|---|---|");
steps.forEach((s, i) => {
  L.push(`| ${i + 1} | \`${s.id}\` | \`${digest(s.sql)}\` | ${Buffer.byteLength(s.sql, "utf8")} |`);
});
L.push("");
L.push("> 这些 checksum 由 installer 写入 `public.tokentracker_self_host_installations`。");
L.push("> 重跑新版完整 SQL 时：已安装且 checksum 一致的步骤跳过；新增步骤执行；");
L.push("> **旧步骤 checksum 变化会直接报错并整体回滚** —— 因此旧步骤 SQL 绝不可改。");
L.push("");
L.push("## 私有函数清单");
L.push("");
manifest.privateFunctions.forEach((f, i) => L.push(`${i + 1}. \`${f}\``));
L.push("");
L.push("## functions.json");
L.push("");
L.push("```json");
L.push(fnManifest ? JSON.stringify(fnManifest, null, 2) : "(尚未生成)");
L.push("```");
L.push("");

console.log(L.join("\n"));
