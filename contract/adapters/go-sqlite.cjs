#!/usr/bin/env node
/**
 * Go + SQLite 实现的真实 adapter。
 * 每个 case 起一个全新的 Go 进程 + 全新 SQLite 文件，保证隔离。
 *
 * 与参考实现的接口对齐：
 *   /_test/*  测试辅助（建用户/设备、SQL 探针、manifest、重装）
 *   /functions/<slug>  14 个私有函数
 *   /api/database/rpc/<fn>  SQL 函数 RPC
 */
"use strict";
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REPO = path.resolve(__dirname, "../..");
const GO_BIN = process.env.GO_SERVER_BIN || path.join(REPO, "go-server/bin/tokentracker-server");
const SECRET = process.env.TT_JWT_SECRET || "contract-test-secret-32-bytes-min!!";
const DASHBOARD = process.env.TT_DASHBOARD_URL || "https://private.example.test";
const NOW = process.env.CONTRACT_NOW || "2026-10-26T00:00:00Z";

async function fetchJson(url, init) {
  const r = await fetch(url, init);
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, headers: Object.fromEntries(r.headers), body };
}

class GoSqliteAdapter {
  constructor(base, proc, tmpDir, seed) {
    this.base = base; this.proc = proc; this.tmpDir = tmpDir; this.seed = seed;
    this.users = []; this.devices = [];
    this._serviceKey = this.token("contract-service", "project_admin");
  }
  info() {
    return { name: "go-sqlite", engine: "sqlite", language: "golang",
      note: "垂直切片：覆盖设备流/上传/账户读取/策略/认证；付费 webhook 等有意排除" };
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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-go-sqlite-"));
  const dbFile = path.join(tmpDir, "tokentracker.db");
  const port = freePort();
  const base = `http://127.0.0.1:${port}`;

  const proc = spawn(GO_BIN, [], {
    env: {
      ...process.env,
      TT_DATABASE_PATH: dbFile,
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
  return new GoSqliteAdapter(base, proc, tmpDir, opts.seed);
}

module.exports = {
  start,
  name: "go-sqlite",
  engine: "sqlite",
  language: "golang",
  // PG SQL ledger/checksum refusal is not a public behavior shared with SQLite.
  // Go uses schema_migrations(version=1); do not fake 15 PostgreSQL steps/checksums.
  capabilities: {
    skip: ["install/ledger-15-steps", "install/checksum-drift-refused"],
    reasons: {
      "install/ledger-15-steps": "PostgreSQL-specific manifest ledger; Go/SQLite has schema_migrations(version=1).",
      "install/checksum-drift-refused": "PG migration checksum immutability is implementation-specific; SQLite migration versioning is tested separately.",
    },
  },
};
