#!/usr/bin/env node
/**
 * 归一化：把响应里的非语义差异（UUID、随机 token、时间戳、浮点、头顺序）消除，
 * 生成稳定的结构化表示，供跨实现逐字段对比。
 *
 * 设计要点：
 *  - 映射是"按出现顺序"的：同一个 UUID 在任何位置都映射到同一个占位符；
 *    这样两边实现只要"结构相同、值之间引用关系相同"就能匹配，
 *    而不要求生成同样的具体 UUID。
 *  - 归一化是可逆诊断的：返回 {value, map}，报告里可以看到原始模式的对应关系。
 */
"use strict";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_TOKEN_RE = /^[0-9a-f]{40,128}$/i;
const DEVICE_CODE_RE = /^[A-Z0-9]{4}(-[A-Z0-9]{4}){2,7}$/;
const ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 无序集合字段：数组元素按稳定键排序（路径末段匹配）
// 只排序"SQL 无 ORDER BY 的无序结果集"。
// 时间序列 / 排行榜 / 分桶数组必须保留顺序，否则会掩盖真实排序差异。
const UNORDERED_KEYS = new Set([
  "machines", "aliases", "codes", "grants", "orders", "payments",
  "providers", "policies", "rows", "items", "permissions",
]);

// 稳定排序用的候选键：优先"业务语义键"（输入确定），
// 绝不使用 DB 生成的 UUID 作为排序依据——那些值每次运行都不同。
const SORT_KEYS = ["name", "label", "title", "key", "slug", "model", "source",
  "day", "date", "hour", "bucket", "month", "step", "code", "status", "environment"];

function sortKeyFor(v) {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const k of SORT_KEYS) {
      if (typeof v[k] === "string" || typeof v[k] === "number") return `${k}=${String(v[k])}`;
    }
    // 退化：只取非 UUID / 非时间戳的标量字段拼成键
    const parts = [];
    for (const k of Object.keys(v).sort()) {
      const val = v[k];
      if (typeof val === "string" && !UUID_RE.test(val) && !ISO_TS_RE.test(val)) parts.push(`${k}=${val}`);
      else if (typeof val === "number" || typeof val === "boolean") parts.push(`${k}=${val}`);
    }
    return parts.join("|");
  }
  try { return JSON.stringify(stableSortObject(v)); } catch { return String(v); }
}
function stableKey(v) {
  try { return JSON.stringify(stableSortObject(v)); } catch { return String(v); }
}
function stableSortObject(o) {
  if (Array.isArray(o)) return o.map(stableSortObject);
  if (o && typeof o === "object") {
    const out = {};
    for (const k of Object.keys(o).sort()) out[k] = stableSortObject(o[k]);
    return out;
  }
  return o;
}
function stableStringify(v) { return JSON.stringify(stableSortObject(v)); }

// 确定性锚点字段：这些值必须原样保留，不能被当成随机 secret 归一化。
const ANCHOR_KEYS = new Set([
  "checksum", "sha256", "hash", "digest", "step", "id", "slug", "status",
  "pricing_tier", "hosting_mode", "environment", "phase", "role", "source", "model",
  "content-type", "cache-control", "content-encoding",
]);
// 日期类键：值可能是"业务输入日期"（保留）或"滚动窗口日期"（相对化）。
// 统一走 _relativeDate：以冻结时钟为基准转成 @reldate，跨天可复现。
const DATE_KEYS = new Set(["from", "to", "day", "date", "hour", "bucket", "week_start", "month", "expires_at"]);
// 敏感字段：即使值看起来不像 token 也归一化。
const SECRET_KEYS = new Set([
  "token", "device_token", "device_code", "user_code", "jwt", "apikey",
  "service_role_key", "anon_key", "password", "secret", "authorization", "signature",
]);

class Normalizer {
  constructor(opts = {}) {
    this.seed = opts.seed || "tokentracker-contract-v1";
    this.keepDates = opts.keepDates !== false;
    this.keepContentLength = !!opts.keepContentLength;
    // 冻结的参考时钟：所有"当前时间"派生的日期都转成相对偏移，保证跨天可复现。
    this.referenceNow = opts.referenceNow ? new Date(opts.referenceNow) : null;
    this.maps = { uuid: new Map(), secret: new Map(), ts: new Map(), rel: new Map() };
    this.counters = { uuid: 0, secret: 0, ts: 0, rel: 0 };
    this.seen = new WeakSet();
  }
  _map(kind, raw, prefix) {
    const m = this.maps[kind];
    if (!m.has(raw)) { this.counters[kind]++; m.set(raw, `${prefix}:${this.counters[kind]}`); }
    return m.get(raw);
  }
  _relativeDate(s) {
    if (!this.referenceNow) return null;
    const d = new Date(s + "T00:00:00Z");
    if (Number.isNaN(d.getTime())) return null;
    const days = Math.round((d - this.referenceNow) / 86400000);
    // 只归一化"靠近现在"的窗口日期；业务输入日期（如 2026-10-01）若恰好落在窗口内
    // 也会转，但这对两边实现是同样的规则，不影响一致性判定。
    if (days > 365 || days < -365) return null;
    return this._map("rel", `@days${days >= 0 ? "+" : ""}${days}`, "@reldate");
  }
  _string(s, path, keyHint) {
    const key = (keyHint || "").toLowerCase();
    if (ANCHOR_KEYS.has(key)) return s;                 // 确定性锚点，原样保留
    if (SECRET_KEYS.has(key)) return this._map("secret", s, "@secret");
    // URL 里内嵌的 user_code / device_code 必须归一化，否则每次录制都不同
    if (/[?&](?:user_code|device_code|code)=/i.test(s)) {
      return s.replace(/([?&](?:user_code|device_code|code)=)([^&#\s]+)/gi,
        (_, p, code) => p + this._map("secret", code, "@code"));
    }
    if (DATE_KEYS.has(key)) {
      const rel = this._relativeDate(s);
      if (rel) return rel;
      if (ISO_TS_RE.test(s)) return this._map("ts", s, "@ts");
      return s;
    }
    if (UUID_RE.test(s) && !/^[0-9a-f]{8}-/.test(s)) return this._map("uuid", s, "@uuid");
    if (UUID_RE.test(s)) return this._map("uuid", s, "@uuid");
    if (HEX_TOKEN_RE.test(s)) return this._map("secret", s, "@secret");
    if (DEVICE_CODE_RE.test(s)) return this._map("secret", s, "@secret");
    if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(s)) return this._map("secret", s, "@jwt");
    if (ISO_TS_RE.test(s)) {
      if (this.keepDates && /T00:00:00(\.000)?Z$/.test(s)) return s;
      return this._map("ts", s, "@ts");
    }
    if (DATE_RE.test(s)) {
      const rel = this._relativeDate(s);
      if (rel) return rel;
      return s;
    }
    return s;
  }
  _number(n) {
    if (Number.isNaN(n)) return "@nan";
    if (n === Infinity) return "@inf";
    if (n === -Infinity) return "@-inf";
    if (Object.is(n, -0)) return 0;
    // 统一浮点精度，避免 0.30000000000000004 vs 0.3
    return Number(n.toFixed(6));
  }
  walk(v, path = "$", keyHint = null) {
    if (v === null || v === undefined) return null;
    if (typeof v === "string") return this._string(v, path, keyHint);
    if (typeof v === "number") return this._number(v);
    if (typeof v === "boolean") return v;
    if (typeof v === "bigint") return v.toString();
    if (Array.isArray(v)) {
      // 无序集合：先按"原始值"排序，再做归一化。
      // 关键：不能在归一化后排序——UUID 占位符是按出现顺序分配的，
      // 用含占位符的键去排会保留原始随机顺序（实测踩过这个坑）。
      let source = v;
      if (keyHint && UNORDERED_KEYS.has(keyHint)) {
        source = [...v].sort((a, b) => sortKeyFor(a).localeCompare(sortKeyFor(b)));
      }
      return source.map((x, i) => this.walk(x, `${path}[${i}]`, keyHint));
    }
    if (typeof v === "object") {
      if (this.seen.has(v)) return "@circular";
      this.seen.add(v);
      const out = {};
      for (const k of Object.keys(v)) out[k] = this.walk(v[k], `${path}.${k}`, k);
      this.seen.delete(v);
      return out;
    }
    return String(v);
  }
  summary() {
    const out = {};
    for (const k of Object.keys(this.maps)) out[k] = this.maps[k].size;
    if (this.referenceNow) out.referenceNow = this.referenceNow.toISOString();
    return out;
  }
}

/** 归一化 HTTP 头：只保留语义相关头，值小写化（除 content-type 里的 charset） */
function normalizeHeaders(headers = {}, opts = {}) {
  const keep = new Set([
    "content-type", "cache-control", "content-encoding", "vary",
    "access-control-allow-origin", "access-control-allow-headers",
    "access-control-allow-methods", "www-authenticate", "location",
    "x-content-type-options", "etag",
  ]);
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    const lk = k.toLowerCase();
    if (!keep.has(lk)) continue;
    if (lk === "content-length" && !opts.keepContentLength) continue;
    let val = Array.isArray(v) ? v.join(", ") : String(v);
    if (lk === "content-type") val = val.split(";")[0].trim().toLowerCase();
    out[lk] = val;
  }
  return out;
}

/** 归一化一次完整响应 */
function normalizeResponse(resp, opts = {}) {
  const n = new Normalizer(opts);
  let body = resp.body;
  // body 可能是字符串（非 JSON）
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { /* 保留原字符串 */ }
  }
  return {
    status: resp.status,
    headers: normalizeHeaders(resp.headers || {}, opts),
    body: n.walk(body, "$.body"),
    _norm: n.summary(),
  };
}

/** 稳定序列化（用于哈希） */
function stable(v) { return stableStringify(v); }

module.exports = { Normalizer, normalizeResponse, normalizeHeaders, stable, stableStringify, stableSortObject };
