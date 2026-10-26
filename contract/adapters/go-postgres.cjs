#!/usr/bin/env node
/**
 * Go + PostgreSQL 实现的真实 adapter。
 * 每个 case 起一个全新的 Go 进程 + 一个全新的 PostgreSQL schema
 * （TT_POSTGRES_SCHEMA + TT_POSTGRES_SCHEMA_EPHEMERAL），退出时 DROP SCHEMA CASCADE。
 *
 * 与 go-sqlite.cjs 面对的是同一份 Go 代码、同一批 golden，只有引擎不同：
 * 这是「同一实现、两种引擎行为一致」的交叉验证。
 *
 * 用法:
 *   GO_POSTGRES_URL='postgres://user:pass@host:5432/db?sslmode=disable' \
 *     CONTRACT_ADAPTER=./contract/adapters/go-postgres.cjs ./contract/scripts/verify.sh
 *
 * 与参考实现的接口对齐：
 *   /_test/*  测试辅助（建用户/设备、SQL 探针、manifest、重装）
 *   /functions/<slug>  14 个私有函数
 *   /api/database/rpc/<fn>  SQL 函数 RPC
 */
"use strict";
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REPO = path.resolve(__dirname, "../..");
const GO_BIN = process.env.GO_SERVER_BIN || path.join(REPO, "go-server/bin/tokentracker-server");
const SECRET = process.env.TT_JWT_SECRET || "contract-test-secret-32-bytes-min!!";
const DASHBOARD = process.env.TT_DASHBOARD_URL || "https://private.example.test";
const NOW = process.env.CONTRACT_NOW || "2026-10-26T00:00:00Z";
const PG_URL = process.env.GO_POSTGRES_URL || process.env.TT_TEST_DATABASE_URL || "";

async function fetchJson(url, init) {
  const r = await fetch(url, init);
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, headers: Object.fromEntries(r.headers), body };
}

class GoPostgresAdapter {
  constructor(base, proc, tmpDir, seed, schema) {
    this.base = base; this.proc = proc; this.tmpDir = tmpDir; this.seed = seed; this.schema = schema;
    this.users = []; this.devices = [];
    this._serviceKey = this.token("contract-service", "project_admin");
  }
  info() {
    return { name: "go-postgres", engine: "postgres", language: "golang",
      note: "同一份 Go 垂直切片跑在真实 PostgreSQL 上；付费 webhook 等有意排除" };
  }
  async close() {
    if (this.proc && this.proc.exitCode === null) {
      this.proc.kill("SIGTERM");
      await new Promise(r => setTimeout(r, 60));
      if (this.proc.exitCode === null) this.proc.kill("SIGKILL");
    }
    try { fs.rmSync(this.tmpDir, { recursive: true, force: true }); } catch {}
  }

  async userWithId(id) {
    this.users.push(id);
    return fetchJson(this.base + "/_test/users", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  }
  user(label) { return this.userWithId(require("../lib/harness.cjs").uuid(String(label))); }

  token(sub, role = "authenticated", exp) {
    // 与参考实现完全相同的 HS256 签名
    const crypto = require("node:crypto");
    const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
    const h = b64({ alg: "HS256" });
    const e = exp !== undefined ? exp : Math.floor(Date.parse(NOW) / 1000) + 3600;
    const p = b64({ sub, role, exp: e });
    const m = `${h}.${p}`;
    const sig = crypto.createHmac("sha256", SECRET).update(m).digest("base64url");
    return `${m}.${sig}`;
  }

  async issue(owner, name, extra = {}) {
    const r = await fetchJson(this.base + "/_test/devices", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ owner, name, platform: extra.platform || "test", machine_id: extra.machine_id }),
    });
    if (r.status === 200) this.devices.push(r.body);
    return r;
  }

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
    if (as === "service") return this._serviceKey;
    if (as === "owner") return this.token(this.users[0]);
    if (as === "stranger") return this.token(this.users[1]);
    if (as === "device") return this.devices[0]?.token || "unknown-token";
    const deviceMatch = typeof as === "string" && as.match(/^device:(\d+)$/);
    if (deviceMatch) return this.devices[Number(deviceMatch[1])]?.token || "unknown-token";
    if (as === "forged") return this.token(this.users[0]).slice(0, -3) + "xxx";
    if (as === "expired") return this.token(this.users[0], "authenticated", 1);
    if (as === "unknown-token") return "unknown-token";
    return as;
  }
  async rpc(name, args = {}) {
    return fetchJson(this.base + "/api/database/rpc/" + name, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + this._serviceKey },
      body: JSON.stringify(args),
    });
  }
  async query(sql, params = []) {
    const r = await fetchJson(this.base + "/_test/sql", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql, params }),
    });
    if (r.body && r.body.error && !Array.isArray(r.body)) {
      throw Error(r.body.error);
    }
    return Array.isArray(r.body) ? r.body : [];
  }
  async manifest() {
    const r = await fetchJson(this.base + "/_test/manifest");
    return r.body;
  }
  async rerunInstall() {
    const r = await fetchJson(this.base + "/_test/install", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    if (r.body && r.body.error) throw Error(r.body.error);
  }
}

function freePort() {
  return 32000 + Math.floor(Math.random() * 15000);
}

async function start(opts = {}) {
  if (!fs.existsSync(GO_BIN)) {
    throw Error(`Go 服务未编译: ${GO_BIN}\n运行: cd go-server && go build -o bin/tokentracker-server ./cmd/server`);
  }
  if (!PG_URL) {
    throw Error("需要 GO_POSTGRES_URL（或 TT_TEST_DATABASE_URL）指向一个可用的 PostgreSQL");
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-go-postgres-"));
  // 每个 case 一个独立 schema：等价于 go-sqlite 的「每个 case 一个全新数据库文件」。
  const schema = "tt_case_" + crypto.randomBytes(6).toString("hex");
  const port = freePort();
  const base = `http://127.0.0.1:${port}`;

  const proc = spawn(GO_BIN, [], {
    env: {
      ...process.env,
      TT_DATABASE_URL: PG_URL,
      TT_POSTGRES_SCHEMA: schema,
      TT_POSTGRES_SCHEMA_EPHEMERAL: "true",
      TT_LISTEN_ADDR: `127.0.0.1:${port}`,
      TT_JWT_SECRET: SECRET,
      TT_DASHBOARD_URL: DASHBOARD,
      TT_ENABLE_TEST_ENDPOINTS: "true",
      TT_BILLING_ENVIRONMENT: "live",
      TT_NOW: NOW,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  proc.stderr.on("data", d => { stderr += d; });

  const deadline = Date.now() + 20000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(base + "/_test/health", { signal: AbortSignal.timeout(800) });
      if (r.ok) { ready = true; break; }
    } catch {}
    if (proc.exitCode !== null) {
      throw Error(`Go 服务提前退出 (${proc.exitCode}): ${stderr.slice(-600)}`);
    }
    await new Promise(r => setTimeout(r, 60));
  }
  if (!ready) {
    proc.kill("SIGKILL");
    throw Error(`Go 服务 20s 内未就绪: ${stderr.slice(-600)}`);
  }
  return new GoPostgresAdapter(base, proc, tmpDir, opts.seed, schema);
}

module.exports = {
  start,
  name: "go-postgres",
  engine: "postgres",
  language: "golang",
  // 与 go-sqlite 相同：Go 用 schema_migrations(version=1)，
  // 不伪造 PostgreSQL 的 15-step 安装账本与 step checksum。
  capabilities: {
    skip: ["install/ledger-15-steps", "install/checksum-drift-refused"],
    reasons: {
      "install/ledger-15-steps": "PG 专属安装账本；Go 用 schema_migrations(version=1)，不伪造 15 step。",
      "install/checksum-drift-refused": "PG step checksum 不变性属于安装器职责；Go 用 schema_migrations checksum 单独测试。",
    },
  },
};
