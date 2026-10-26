#!/usr/bin/env node
/**
 * Go + SQLite 实现的 Adapter 模板（骨架，待实现）。
 *
 * 你的任务：让 Go 服务提供与参考实现相同的 HTTP 接口，然后在这个文件里
 * 把 runner 的 op 映射到你的服务（或起一个进程/容器）。
 *
 * 两种接法（任选）：
 *   A) Go 服务已监听 http://127.0.0.1:PORT —— 直接把 BASE_URL 指过去，
 *      并把 query/rpc/数据库状态断言改写成 Go 侧等价查询。
 *   B) 每次 start() 起一个新的 Go 进程 + 全新 SQLite 文件 —— 隔离性最好。
 *
 * 必须实现的 Adapter 接口（见 SPEC.md §1.1）：
 *   start(config) -> Adapter
 *   .info() / .userWithId(id) / .issue(owner,name,extra) / .token(...)
 *   .request(slug,{method,query,headers,body,as,token})
 *   .rpc(name,args) / .query(sql,params) / .manifest() / .rerunInstall() / .close()
 *
 * 关键：输入必须确定性。runner 用 CONTRACT_SEED 派生 UUID / machine_id；
 * 你的实现要用同样的算法（见 lib/harness.cjs 的 uuid()），或直接接收 runner 传来的值。
 */
"use strict";
const { spawn } = require("node:child_process");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const GO_BIN = process.env.GO_SERVER_BIN || path.resolve(__dirname, "../../../go-server/bin/tokentracker-server");
const PORT = Number(process.env.GO_SERVER_PORT || 0); // 0 = 自动分配

async function fetchJson(url, init) {
  const r = await fetch(url, init);
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, headers: Object.fromEntries(r.headers), body };
}

class GoSqliteAdapter {
  constructor(base, proc, dbFile, tmpDir, seed) {
    this.base = base; this.proc = proc; this.dbFile = dbFile;
    this.tmpDir = tmpDir; this.seed = seed;
    this.users = []; this.devices = [];
  }
  info() {
    return { name: "go-sqlite", engine: "sqlite", language: "golang",
      note: "候选实现；必须与 golden 逐字段一致" };
  }
  async close() {
    if (this.proc) { this.proc.kill("SIGTERM"); await new Promise(r => setTimeout(r, 100)); }
    try { fs.rmSync(this.tmpDir, { recursive: true, force: true }); } catch {}
  }

  // ---- 身份与实体 -------------------------------------------------------
  async userWithId(id) {
    this.users.push(id);
    return fetchJson(this.base + "/_test/users", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  }
  user(label) { return this.userWithId(require("../lib/harness.cjs").uuid(String(label))); }
  token(sub, role = "authenticated", exp) {
    // 必须与参考实现的 HS256 JWT 完全一致（header/payload/secret）。
    // 建议在 Go 侧实现同样的签名，并从 _test/config 暴露 secret。
    throw Error("TODO: 实现 token() —— 用与参考实现相同的 JWT secret 签发 HS256 token");
  }
  async issue(owner, name, extra = {}) {
    const r = await fetchJson(this.base + "/_test/devices", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ owner, name, platform: extra.platform || "test", machine_id: extra.machine_id }),
    });
    if (r.status === 200) this.devices.push(r.body);
    return r;
  }

  // ---- 核心接口 ---------------------------------------------------------
  async request(slug, { method, query, headers = {}, body, as, token } = {}) {
    const q = query ? "?" + new URLSearchParams(query).toString() : "";
    let auth;
    if (token) auth = token;
    else if (as && as !== "anon") auth = this._resolveIdentity(as);
    return fetchJson(this.base + "/functions/" + slug + q, {
      method: method || (body === undefined ? "GET" : "POST"),
      headers: {
        ...(auth ? { Authorization: "Bearer " + auth } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }
  _resolveIdentity(as) {
    // 与 reference adapter 的 _identity 语义一致
    if (as === "service") return this._serviceKey;
    if (as === "owner") return this.token(this.users[0]);
    if (as === "stranger") return this.token(this.users[1]);
    if (as === "device") return this.devices[0]?.token || "unknown-token";
    if (as === "forged") return this.token(this.users[0]).slice(0, -3) + "xxx";
    if (as === "expired") return this.token(this.users[0], "authenticated", 1);
    if (as === "unknown-token") return "unknown-token";
    return as;  // 已是 token 字符串
  }
  async rpc(name, args = {}) {
    return fetchJson(this.base + "/api/database/rpc/" + name, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + this._serviceKey },
      body: JSON.stringify(args),
    });
  }
  async query(sql, params = []) {
    // SQLite 没有 pg_catalog / has_table_privilege 等。
    // 两种做法：
    //  1) 在 Go 侧把 PG 风格的探针 SQL 翻译成 SQLite 等价查询（推荐，见 mapping.json）；
    //  2) 对无法翻译的查询返回 declareUnsupported()，并在 capabilities.json 里登记 SKIP。
    const r = await fetchJson(this.base + "/_test/sql", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql, params }),
    });
    if (r.status !== 200) throw Error(r.body?.error || "query failed");
    return Array.isArray(r.body) ? r.body : (r.body.rows || []);
  }
  async manifest() {
    return fetchJson(this.base + "/_test/manifest").then(r => r.body);
  }
  async rerunInstall() {
    const r = await fetchJson(this.base + "/_test/install", { method: "POST" });
    if (r.status !== 200) throw Error(r.body?.error || "install failed");
  }
}

async function start(opts = {}) {
  if (!fs.existsSync(GO_BIN)) {
    throw Error(`Go 服务未找到: ${GO_BIN}\n设 GO_SERVER_BIN 指向编译好的二进制。参见 SPEC.md §6 实现者清单。`);
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-go-sqlite-"));
  const dbFile = path.join(tmpDir, "tokentracker.db");
  const port = PORT || (30000 + Math.floor(Math.random() * 10000));
  const base = `http://127.0.0.1:${port}`;

  const proc = spawn(GO_BIN, [], {
    env: {
      ...process.env,
      TT_DATABASE_PATH: dbFile,
      TT_LISTEN_ADDR: `127.0.0.1:${port}`,
      TT_JWT_SECRET: process.env.TT_JWT_SECRET || "contract-test-secret",
      TT_DASHBOARD_URL: "https://private.example.test",
      TT_BILLING_ENVIRONMENT: "live",
      // 必须支持冻结时钟，否则 rolling 窗口会随真实日期漂移
      TT_NOW: process.env.CONTRACT_NOW || "2026-10-26T00:00:00Z",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  proc.stderr.on("data", d => { stderr += d; });

  // 等待就绪
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(base + "/_test/health", { signal: AbortSignal.timeout(1000) });
      if (r.ok) break;
    } catch {}
    if (proc.exitCode !== null) throw Error(`Go 服务提前退出 (${proc.exitCode}): ${stderr.slice(-500)}`);
    await new Promise(r => setTimeout(r, 100));
  }

  const a = new GoSqliteAdapter(base, proc, dbFile, tmpDir, opts.seed);
  a._serviceKey = process.env.TT_SERVICE_KEY || "contract-service-key";
  return a;
}

module.exports = { start, name: "go-sqlite", engine: "sqlite", language: "golang",
  note: "模板：需实现 Go 服务端点后才能真正跑契约测试" };
