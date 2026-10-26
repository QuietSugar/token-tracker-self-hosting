#!/usr/bin/env node
/**
 * 参考实现适配器（PG + TypeScript/Deno 打包产物）。
 * 在 harness 之上补齐 runner 需要的 op：rerunInstall / manifest / query 参数化。
 */
"use strict";
const path = require("node:path");
const fs = require("node:fs");
const harness = require("../lib/harness.cjs");

const ROOT = path.resolve(__dirname, "../..");

class ReferenceAdapter {
  constructor(h, opts) {
    this.h = h;
    this.opts = opts;
    this._install = null;
    this._manifestData = null;
  }
  info() { return { ...this.h.info(), frozenNow: harness.CONTRACT_NOW }; }
  close() { return this.h.close(); }
  userWithId(id) { return this.h.userWithId(id); }
  user(label) { return this.h.user(label); }
  issue(owner, name, extra) { return this.h.issue(owner, name, extra); }
  token(sub, role, exp) { return this.h.token(sub, role, exp); }
  query(sql, params = []) { return this.h.query(sql, params); }
  rpc(name, args) { return this.h.rpc(name, args); }
  async rerunInstall() {
    if (!this._install) {
      this._install = require(path.join(harness.UPSTREAM, "scripts/self-host/install.cjs")).install;
    }
    await this._install(this.h.instance.db);
  }
  async manifest() {
    if (!this._manifestData) {
      const v = fs.readFileSync(path.join(ROOT, "tracking/REF"), "utf8").match(/^VERSION=(.*)$/m)[1];
      const f = JSON.parse(fs.readFileSync(path.join(ROOT, `releases/${v}/functions/functions.json`), "utf8"));
      this._manifestData = {
        functions: f.functions,
        publicSlugs: f.functions.filter(x => x.public).map(x => x.slug),
        excluded: f.excluded,
        serverSecrets: f.serverSecrets,
        dashboardBuildVariables: f.dashboardBuildVariables,
        mode: f.mode,
        schemaVersion: f.schemaVersion,
      };
    }
    return this._manifestData;
  }
  async request(slug, opts = {}) {
    // 支持 as: "device:N" 选择第 N 个设备
    let as = opts.as;
    const m = typeof as === "string" && as.match(/^device:(\d+)$/);
    if (m) {
      const i = Number(m[1]);
      const tok = this.h.devices[i]?.token || "unknown-token";
      as = tok;
    }
    return this.h.request(slug, { ...opts, as });
  }
}

async function start(opts = {}) {
  const h = await harness.start(opts);
  return new ReferenceAdapter(h, opts);
}

module.exports = { start, name: "reference", engine: "postgresql-pglite", language: "typescript-deno-cjs" };
