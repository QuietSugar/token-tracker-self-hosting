#!/usr/bin/env node
/**
 * 参考实现运行器：包装上游 test/helpers/self-host-fixture.cjs，
 * 提供确定性输入（固定种子生成的 UUID / machine_id / 用量数据）与统一请求接口。
 *
 * 只读上游 checkout；测试依赖（@insforge/sdk）装在临时目录并通过 NODE_PATH 注入。
 */
"use strict";
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "../..");
const UPSTREAM = process.env.UPSTREAM_DIR || path.resolve(ROOT, "../TokenTracker");
const SEED = process.env.CONTRACT_SEED || "tokentracker-contract-v1";
// 冻结时钟：让所有"当前时间"派生的窗口日期在录制/回放间一致。
// 默认 2026-10-26T00:00:00Z（与锁定上游 commit 同日，可经 CONTRACT_NOW 覆盖）。
const CONTRACT_NOW = process.env.CONTRACT_NOW || "2026-10-26T00:00:00Z";
const FROZEN_MS = Date.parse(CONTRACT_NOW);

/** 在 fixture 启动前安装 Date shim；返回恢复函数。
 *  只影响 `new Date()` / `Date.now()`，不影响显式传参的 new Date(x)。 */
function installClock() {
  const RealDate = globalThis.Date;
  function FrozenDate(...args) {
    if (args.length === 0) return new RealDate(FROZEN_MS);
    return new RealDate(...args);
  }
  FrozenDate.prototype = RealDate.prototype;
  FrozenDate.now = () => FROZEN_MS;
  FrozenDate.parse = RealDate.parse;
  FrozenDate.UTC = RealDate.UTC;
  Object.setPrototypeOf(FrozenDate, RealDate);
  globalThis.Date = FrozenDate;
  return () => { globalThis.Date = RealDate; };
}

function requireUpstream(name) {
  const p = path.join(UPSTREAM, name);
  if (!fs.existsSync(p)) throw Error(`上游文件不存在: ${p}（设 UPSTREAM_DIR 指向上游 checkout）`);
  return require(p);
}

/** 确定性伪随机：同样的 seed+label 永远得到同样的值 */
function derived(label, index = 0) {
  return crypto.createHash("sha256").update(`${SEED}|${label}|${index}`).digest();
}
function uuid(label, index = 0) {
  const b = derived(label, index);
  b[6] = (b[6] & 0x0f) | 0x40;  // v4
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.subarray(0, 16).toString("hex");
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
}
function hexToken(label, index = 0, len = 64) {
  return derived(label, index).toString("hex") + derived(label, index + 1000).toString("hex");
}

/** 标准用量行（与上游测试的 row() 一致） */
function usageRow(tokens, overrides = {}) {
  return {
    hour_start: "2026-10-01T12:00:00Z",
    source: "codex",
    model: "gpt-6",
    input_tokens: tokens,
    output_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: tokens,
    billable_total_tokens: tokens,
    total_cost_usd: 0,
    conversation_count: 1,
    ...overrides,
  };
}

class ReferenceHarness {
  constructor(instance, opts = {}) {
    this.instance = instance;
    this.seed = opts.seed || SEED;
    this.users = [];
    this.devices = [];
    this.codes = [];
    this._counter = 0;
  }
  _next() { return ++this._counter; }

  /** 创建用户，返回确定性 UUID */
  async user(label) {
    const id = uuid(`user:${label || this._next()}`, this._next());
    await this.instance.db.query("INSERT INTO auth.users VALUES($1)", [id]);
    this.users.push(id);
    return id;
  }
  /** 用已有 UUID 创建用户（用于跨实现共享输入） */
  async userWithId(id) {
    await this.instance.db.query("INSERT INTO auth.users VALUES($1) ON CONFLICT DO NOTHING", [id]);
    this.users.push(id);
    return id;
  }
  token(sub, role = "authenticated", exp = Math.floor(Date.now() / 1000) + 3600) {
    return this.instance.token(sub, role, exp);
  }
  /** 签发 device token，返回响应体 */
  async issue(owner, name, extra = {}) {
    const r = await this.instance.request("tokentracker-device-token-issue", {
      device_name: name,
      platform: "test",
      machine_id: extra.machine_id || uuid(`machine:${name}`, this._next()),
      ...extra,
    }, owner);
    if (r.response.status === 200) this.devices.push(r.data);
    return { status: r.response.status, headers: Object.fromEntries(r.response.headers), body: r.data };
  }
  /** 设备授权流程 */
  async deviceFlow(owner, opts = {}) {
    const authorize = await this.instance.request("tokentracker-device-flow-authorize", {
      client_info: opts.client_info || "Contract CLI",
      machine_id: opts.machine_id || uuid("device-flow-machine", this._next()),
    });
    const a = { status: authorize.response.status, headers: Object.fromEntries(authorize.response.headers), body: authorize.data };
    this.codes.push(a.body);
    return a;
  }
  /** 通用函数请求 */
  async request(slug, { method, query, headers, body, token, as } = {}) {
    const q = query ? "?" + new URLSearchParams(query).toString() : "";
    const auth = token || (as && as !== "anon" ? this._identity(as) : undefined);
    const response = await fetch(this.instance.base + "/functions/" + slug + q, {
      method: method || (body === undefined ? "GET" : "POST"),
      headers: {
        ...(auth ? { Authorization: "Bearer " + auth } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(headers || {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: response.status, headers: Object.fromEntries(response.headers), body: parsed };
  }
  /** 直接 SQL 查询（仅参考实现；用于状态断言） */
  async query(sql, params = []) {
    const r = await this.instance.db.query(sql, params);
    return r.rows;
  }
  /** RPC（走 HTTP，模拟 SDK 调用） */
  async rpc(name, args = {}) {
    const response = await fetch(this.instance.base + "/api/database/rpc/" + name, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + this.instance.env.INSFORGE_SERVICE_ROLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
    });
    return { status: response.status, headers: Object.fromEntries(response.headers), body: await response.json() };
  }
  _identity(as) {
    if (!as || as === "anon") return undefined;
    if (as === "service") return this.instance.env.INSFORGE_SERVICE_ROLE_KEY;
    if (as === "forged") {
      const t = this.token(this.users[0] || uuid("forged"), "authenticated");
      return t.slice(0, -3) + "xxx";
    }
    if (as === "expired") return this.token(this.users[0] || uuid("expired"), "authenticated", Math.floor(Date.now()/1000) - 3600);
    if (as === "owner") return this.token(this.users[0]);
    if (as === "stranger") return this.token(this.users[1] || uuid("stranger"));
    if (as === "device") return this.devices[0]?.token || "unknown-token";
    if (as === "unknown-token") return "unknown-token";
    return as;  // 原样 token 字符串
  }
  info() {
    return {
      name: "reference",
      engine: "postgresql-pglite",
      language: "typescript-deno-cjs",
      upstreamVersion: fs.existsSync(path.join(ROOT, "tracking/REF"))
        ? fs.readFileSync(path.join(ROOT, "tracking/REF"), "utf8").match(/^VERSION=(.*)$/m)?.[1] : "unknown",
      seed: this.seed,
    };
  }
  async close() {
    try { await this.instance.close(); }
    finally { if (this._restoreClock) { this._restoreClock(); this._restoreClock = null; } }
  }
}

async function start(opts = {}) {
  const { fixture } = requireUpstream("test/helpers/self-host-fixture.cjs");
  const restore = installClock();
  let instance;
  try {
    instance = await fixture();
  } finally {
    // fixture() 内部启动 server 时就已捕获 env；handler 在请求时才读取时间，
    // 所以 shim 需要在整个生命周期内保留，由 close() 恢复。
  }
  const h = new ReferenceHarness(instance, opts);
  h._restoreClock = restore;
  return h;
}

module.exports = { start, ReferenceHarness, usageRow, uuid, hexToken, derived, SEED, UPSTREAM, CONTRACT_NOW, FROZEN_MS, installClock };
