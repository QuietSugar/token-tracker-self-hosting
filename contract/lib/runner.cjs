#!/usr/bin/env node
/**
 * 通用场景执行器：把 scenarios/*.json 里的语言无关用例，转成对某个 adapter 的调用。
 * 录制（reference）与回放（go-sqlite）共用这一份代码——这是公平性的关键。
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { usageRow, uuid, derived } = require("./harness.cjs");
const { normalizeResponse } = require("./normalize.cjs");

const ROOT = path.resolve(__dirname, "..");
const SCENARIOS = path.join(ROOT, "scenarios");

function loadScenarios() {
  const index = JSON.parse(fs.readFileSync(path.join(SCENARIOS, "index.json"), "utf8"));
  const groups = [];
  for (const g of index.groups.filter(x => x.enabled)) {
    groups.push(JSON.parse(fs.readFileSync(path.join(SCENARIOS, g.file), "utf8")));
  }
  return { index, groups };
}

/** 用例上下文：确定性生成的实体与最近响应 */
class Context {
  constructor(adapter, seed) {
    this.a = adapter;
    this.seed = seed || "tokentracker-contract-v1";
    this.users = [];
    this.devices = [];
    this.responses = [];
    this.first = {};
    this.last = {};
    // flow：跨步骤累积的流程变量。poll 之类只返回 {status} 的响应不应覆盖
    // authorize 返回的 device_code / user_code，否则后续 grant 会失败。
    this.flow = {};
    this.savedChecksum = null;
    this.n = 0;
  }
  _uuid(label) { return uuid(label, ++this.n); }
  _machine(i) { return this._uuid(`machine:${i}`); }
  _usage(tokens, overrides) {
    return usageRow(tokens, overrides);
  }
  resolve(v) {
    if (v === null || v === undefined) return v;
    if (typeof v === "string") {
      if (v === "@ownerId") return this.users[0];
      if (v === "@strangerId") return this.users[1];
      if (v.startsWith("@uuid:")) return this._uuid(v.slice(6));
      if (v.startsWith("@machine:")) return this._uuid("machine:" + v.slice(9));
      if (v.startsWith("@machineId:")) {
        const i = Number(v.slice(11)) || 0;
        return this.devices[i]?.machine_id || this._uuid("machine:" + i);
      }
      if (v.startsWith("@usage:")) return this._usage(Number(v.slice(7)) || 100);
      if (v.startsWith("@oversize:")) {
        const target = Number(v.slice(10)) || 1200000;
        const row = this._usage(1);
        return Array(Math.ceil(target / 200)).fill(row);
      }
      if (v.startsWith("@token:")) {
        const i = Number(v.slice(7)) || 0;
        return this.devices[i]?.token || "unknown-token";
      }
      if (v === "@deviceToken") return this.devices[0]?.token || "unknown-token";
      return v;
    }
    if (Array.isArray(v)) return v.map(x => this.resolve(x));
    if (typeof v === "object") {
      const out = {};
      for (const [k, val] of Object.entries(v)) out[k] = this.resolve(val);
      return out;
    }
    return v;
  }
  resolveArgs(args) {
    if (!args) return {};
    const out = {};
    for (const [k, v] of Object.entries(args)) out[k] = this.resolve(v);
    return out;
  }
  bodyFrom(spec, wrap) {
    const key = wrap || "device_code";
    let value;
    if (spec.startsWith("flow.")) value = this.flow[spec.slice(5)];
    else if (spec.startsWith("last.")) value = this.last[spec.slice(5)];
    else if (spec.startsWith("first.")) value = this.first[spec.slice(6)];
    else value = spec === "last" ? this.last : spec === "first" ? this.first : this.flow;
    return { [key]: value };
  }
  /** 解析 as 里的动态引用（如 "last.device_token" / "flow.device_token"） */
  resolveAs(as) {
    if (typeof as !== "string") return as;
    if (as.startsWith("flow.")) return this.flow[as.slice(5)] || as;
    if (as.startsWith("last.")) return this.last[as.slice(5)] || as;
    if (as.startsWith("first.")) return this.first[as.slice(6)] || as;
    return as;
  }
  record(resp) {
    this.responses.push(resp);
    const body = resp.body && typeof resp.body === "object" && !Array.isArray(resp.body)
      ? resp.body : { value: resp.body };
    this.last = body;
    if (!Object.keys(this.first).length) this.first = body;
    // 只在新值非 null/undefined 时累积，避免空响应抹掉已有流程变量
    for (const [k, v] of Object.entries(body)) {
      if (v !== null && v !== undefined && this.flow[k] === undefined) this.flow[k] = v;
    }
    return resp;
  }
}

async function setupGiven(ctx, given = {}) {
  const nUsers = given.users || 0;
  for (let i = 0; i < nUsers; i++) {
    const id = ctx._uuid(`user:${i}`);
    await ctx.a.userWithId(id);
    ctx.users.push(id);
  }
  const nDevices = given.devices || 0;
  for (let i = 0; i < nDevices; i++) {
    const r = await ctx.a.issue(ctx.users[0], `Device ${i}`, { machine_id: ctx._machine(i) });
    const d = r.body || {};
    ctx.devices.push({ ...d, machine_id: d.machine_id || ctx._machine(i) });
  }
  if (given.usage && given.usage.length) {
    for (const t of given.usage) {
      await ctx.a.request("tokentracker-ingest", {
        as: "device", body: { buckets: [ctx._usage(t)] },
      });
    }
  }
}

async function executeStep(ctx, step) {
  const op = step.op;
  let resp;

  switch (op) {
    case "query": {
      try {
        const rows = await ctx.a.query(ctx.resolve(step.sql));
        resp = { status: 200, headers: {}, body: { rows } };
      } catch (e) {
        resp = step.expectOptional
          ? { status: 200, headers: {}, body: { error: e.message } }
          : (() => { throw e; })();
      }
      break;
    }
    case "request": {
      let body = step.body;
      if (step.bodyFrom) body = ctx.bodyFrom(step.bodyFrom, step.bodyWrap);
      body = ctx.resolve(body);
      const query = step.query ? ctx.resolve(step.query) : undefined;
      resp = await ctx.a.request(step.call, {
        method: step.method, query, body,
        as: ctx.resolveAs(step.as),
        token: ctx.resolveAs(step.token),
        headers: step.headers,
      });
      break;
    }
    case "rpc": {
      resp = await ctx.a.rpc(step.call, ctx.resolveArgs(step.args));
      break;
    }
    case "ingest": {
      const rows = step.rows || [ctx._usage(step.tokens || 100, step.overrides)];
      resp = await ctx.a.request("tokentracker-ingest", {
        as: step.device !== undefined ? `device:${step.device}` : "device",
        body: { buckets: ctx.resolve(rows) },
      });
      break;
    }
    case "ingestBatch": {
      const rows = Array.from({ length: step.count || 80 }, (_, i) =>
        ctx._usage((step.baseTokens || 100) + i, { model: `${step.modelPrefix || "model-"}${i}` }));
      resp = await ctx.a.request("tokentracker-ingest", { as: "device", body: { buckets: rows } });
      break;
    }
    case "rerunInstall": {
      try {
        await ctx.a.rerunInstall();
        resp = { status: 200, headers: {}, body: { ok: true } };
      } catch (e) {
        if (step.expectError) resp = { status: 200, headers: {}, body: { error: e.message } };
        else throw e;
      }
      break;
    }
    case "tamperChecksum": {
      const rows = await ctx.a.query(`SELECT checksum FROM public.tokentracker_self_host_installations WHERE step='${step.step || "01-private-baseline"}'`);
      ctx.savedChecksum = rows[0]?.checksum;
      await ctx.a.query(`UPDATE public.tokentracker_self_host_installations SET checksum='changed-contract-test' WHERE step='${step.step || "01-private-baseline"}'`);
      resp = { status: 200, headers: {}, body: { tampered: true } };
      break;
    }
    case "restoreChecksum": {
      if (ctx.savedChecksum) {
        await ctx.a.query(`UPDATE public.tokentracker_self_host_installations SET checksum='${ctx.savedChecksum}' WHERE step='01-private-baseline'`);
      }
      resp = { status: 200, headers: {}, body: { restored: true } };
      break;
    }
    case "manifest": {
      resp = { status: 200, headers: {}, body: await ctx.a.manifest() };
      break;
    }
    case "issueMany": {
      const statuses = [], memberships = [];
      for (let i = 0; i < (step.count || 7); i++) {
        const r = await ctx.a.issue(ctx.users[0], `Free host ${i}`, { machine_id: ctx._machine(100 + i) });
        statuses.push(r.status);
        memberships.push(r.body?.membership?.status ?? null);
      }
      resp = { status: 200, headers: {}, body: { statuses, memberships } };
      break;
    }
    case "deleteUser": {
      await ctx.a.query(`DELETE FROM auth.users WHERE id=$1`, [ctx.users[step.index || 0]]);
      resp = { status: 200, headers: {}, body: { deleted: true } };
      break;
    }
    case "assertNot": {
      const src = step.path === "last.verification_uri" ? ctx.last.verification_uri : ctx.resolve(step.path);
      const ok = typeof src === "string" && !src.includes(step.contains);
      resp = { status: 200, headers: {}, body: { assertion: "assertNot", passed: ok, value: src } };
      break;
    }
    default:
      throw Error(`未知 op: ${op} (case step ${JSON.stringify(step).slice(0, 120)})`);
  }

  ctx.record(resp);
  return resp;
}

async function runCase(adapter, caseDef, opts = {}) {
  // 每个 case 一个隔离实例，避免状态串扰
  const ctx = new Context(adapter, opts.seed);
  await setupGiven(ctx, caseDef.given);
  const steps = [];
  for (const step of caseDef.steps || []) {
    const t0 = Date.now();
    try {
      const resp = await executeStep(ctx, step);
      steps.push({
        op: step.op,
        call: step.call || step.sql?.slice(0, 60),
        // 不写 durationMs：性能数据属于 benchmark，不该污染行为快照的可复现性。
        response: normalizeResponse(resp, opts.normalize),
      });
    } catch (e) {
      steps.push({ op: step.op, call: step.call,
        response: { status: 0, headers: {}, body: { runnerError: e.message } } });
      if (!opts.continueOnError) throw e;
    }
  }
  return {
    id: caseDef.id,
    tags: caseDef.tags || [],
    group: caseDef.group,
    seed: ctx.seed,
    steps,
  };
}

async function runAll(adapterFactory, opts = {}) {
  const { index, groups } = loadScenarios();
  const results = [];
  const started = Date.now();
  for (const group of groups) {
    for (const c of group.cases) {
      const adapter = await adapterFactory();
      try {
        const r = await runCase(adapter, { ...c, group: group.group }, { seed: index.seed, ...opts });
        results.push(r);
      } finally {
        await adapter.close();
      }
    }
  }
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    seed: index.seed,
    implementation: results[0] ? undefined : undefined,
    durationMs: Date.now() - started,
    caseCount: results.length,
    cases: results,
  };
}

module.exports = { loadScenarios, runAll, runCase, Context, executeStep, setupGiven };
