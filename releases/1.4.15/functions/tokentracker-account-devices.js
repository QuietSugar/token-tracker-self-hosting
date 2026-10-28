module.exports = async function(req) {
  return await (async (__selfHostPlatformDeno) => {
    const Deno = { env: { get(key) {
      if (key === "INSFORGE_BASE_URL") return __selfHostPlatformDeno.env.get("INSFORGE_INTERNAL_URL") || __selfHostPlatformDeno.env.get(key);
      if (key === "INSFORGE_SERVICE_ROLE_KEY") return __selfHostPlatformDeno.env.get(key) || __selfHostPlatformDeno.env.get("API_KEY");
      return __selfHostPlatformDeno.env.get(key);
    } } };
    const __selfHostModules = { "npm:@insforge/sdk@1.4.5": { __esModule: true, ...await import("npm:@insforge/sdk@1.4.5") } };
    const require = specifier => {
      if (!Object.hasOwn(__selfHostModules,specifier)) throw new Error("Unknown self-host runtime module: " + specifier);
      return __selfHostModules[specifier];
    };
    
    "use strict";
var __selfHostHandler = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // dashboard/edge-patches/tokentracker-account-devices.ts
  var tokentracker_account_devices_exports = {};
  __export(tokentracker_account_devices_exports, {
    default: () => tokentracker_account_devices_default
  });
  var import_sdk = __require("npm:@insforge/sdk@1.4.5");

  // dashboard/edge-patches/cloud/access.ts
  function cloudEnvironment() {
    const value = Deno.env.get("TOKENTRACKER_BILLING_ENVIRONMENT") || "live";
    if (value !== "live" && value !== "sandbox") throw new Error("Invalid Cloud environment");
    return value;
  }
  async function cloudRpc(client, name, args) {
    const { data, error } = await client.database.rpc(name, { ...args, p_environment: cloudEnvironment() });
    if (error) throw new Error(error.message || "Cloud access unavailable");
    if (!data || typeof data !== "object" || typeof data.ok !== "boolean") {
      throw new Error("Invalid Cloud access response");
    }
    return data;
  }
  function cloudFailure(result, cors) {
    const retryAfter = Number(result.retry_after_seconds);
    return Response.json({ ...result, error: result.code || "cloud_access_denied" }, {
      status: result.status || 403,
      headers: {
        ...cors,
        "Cache-Control": "no-store",
        ...Number.isFinite(retryAfter) && retryAfter > 0 ? { "Retry-After": String(Math.ceil(retryAfter)) } : {}
      }
    });
  }
  async function cloudReadAccess(client, userId, kind) {
    return await cloudRpc(client, "cloud_account_access", { p_user_id: userId, p_kind: kind });
  }
  function cloudHistoryFailure(access, to) {
    return access.available_from && to < access.available_from ? {
      ...access,
      ok: false,
      code: "cloud_history_window_exceeded",
      status: 400,
      recovery_url: "https://www.tokentracker.cc/cloud"
    } : null;
  }

  // dashboard/edge-patches/tokentracker-account-devices.ts
  var corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey"
  };
  function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
  function b64urlToBytes(s) {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    const pad = (4 - b64.length % 4) % 4;
    const raw = atob(b64 + "=".repeat(pad));
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  async function verifiedUserIdFromJwt(authHeader) {
    if (!authHeader) return null;
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    try {
      const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
      const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
      const sig = b64urlToBytes(parts[2]);
      let ok = false;
      if (header.alg === "HS256") {
        const secret = Deno.env.get("JWT_SECRET");
        if (!secret) return null;
        const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
        ok = await crypto.subtle.verify("HMAC", key, sig, data);
      } else if (header.alg === "RS256") {
        const publicKeyPem = Deno.env.get("JWT_PUBLIC_KEY");
        if (!publicKeyPem) return null;
        const publicKeyDer = Uint8Array.from(atob(publicKeyPem.replace(/-----[^-]+-----|\s/g, "")), (char) => char.charCodeAt(0));
        const key = await crypto.subtle.importKey("spki", publicKeyDer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
        ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, data);
      } else return null;
      if (!ok) return null;
      const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
      if (typeof payload.exp === "number" && Date.now() / 1e3 > payload.exp) return null;
      const sub = payload.sub;
      if (typeof sub === "string" && sub.length > 0) return sub;
      const uid = payload.user_id;
      if (typeof uid === "string" && uid.length > 0) return uid;
    } catch {
    }
    return null;
  }
  var ACCOUNT_LEVEL_SOURCES = /* @__PURE__ */ new Set(["cursor", "trae-cn"]);
  async function sumDeviceTokens(client, userId, deviceId, fromIso, toIso, fromDay, toDay, tz, tzOffsetMinutes) {
    const { data, error } = await client.database.rpc("account_usage_grouped_cached", {
      p_user_id: userId,
      p_device_id: deviceId,
      p_from: fromIso,
      p_to: toIso,
      p_trunc: "day",
      p_tz: tz,
      p_offset_min: tzOffsetMinutes
    });
    if (error) {
      console.error(`account-devices: usage sum failed for device ${deviceId}: ${error.message}`);
      return 0;
    }
    const rows = Array.isArray(data) ? data : [];
    let sum = 0;
    for (const r of rows) {
      const day = String(r.bucket || "");
      if (day < fromDay || day > toDay) continue;
      if (ACCOUNT_LEVEL_SOURCES.has(String(r.source || ""))) continue;
      sum += Number(r.total_tokens) || 0;
    }
    return sum;
  }
  async function sumAccountSources(client, userId, fromIso, toIso, fromDay, toDay, tz, tzOffsetMinutes) {
    const { data, error } = await client.database.rpc("account_usage_grouped", {
      p_user_id: userId,
      p_device_ids: [],
      p_from: fromIso,
      p_to: toIso,
      p_trunc: "day",
      p_tz: tz,
      p_offset_min: tzOffsetMinutes
    });
    if (error) {
      console.error(`account-devices: account-source sum failed: ${error.message}`);
      return [];
    }
    const rows = Array.isArray(data) ? data : [];
    const bySource = /* @__PURE__ */ new Map();
    for (const r of rows) {
      const day = String(r.bucket || "");
      if (day < fromDay || day > toDay) continue;
      const source = String(r.source || "");
      if (!ACCOUNT_LEVEL_SOURCES.has(source)) continue;
      bySource.set(source, (bySource.get(source) || 0) + (Number(r.total_tokens) || 0));
    }
    return [...bySource.entries()].map(([source, total_tokens]) => ({ source, total_tokens })).filter((s) => s.total_tokens > 0).sort((a, b) => b.total_tokens - a.total_tokens);
  }
  async function tokentracker_account_devices_default(req) {
    if (req.method === "OPTIONS")
      return new Response(null, { status: 204, headers: corsHeaders });
    if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
    const url = new URL(req.url);
    let from = url.searchParams.get("from") || "";
    const to = url.searchParams.get("to") || "";
    if (!from || !to) return json({ error: "Missing from/to" }, 400);
    const MAX_RANGE_DAYS = 1095;
    const fromMs = Date.parse(`${from}T00:00:00Z`);
    const toMs = Date.parse(`${to}T00:00:00Z`);
    if (Number.isFinite(fromMs) && Number.isFinite(toMs) && toMs > fromMs) {
      const maxFromMs = toMs - MAX_RANGE_DAYS * 864e5;
      if (fromMs < maxFromMs) from = new Date(maxFromMs).toISOString().slice(0, 10);
    }
    const tz = url.searchParams.get("tz") || null;
    const tzOffsetRaw = url.searchParams.get("tz_offset_minutes");
    const tzOffsetMinutes = tzOffsetRaw != null && tzOffsetRaw !== "" ? Number(tzOffsetRaw) : null;
    const baseUrl = Deno.env.get("INSFORGE_BASE_URL");
    if (!baseUrl) return json({ error: "server misconfigured" }, 500);
    const incomingApiKey = req.headers.get("apikey") ?? req.headers.get("Apikey") ?? req.headers.get("x-api-key") ?? void 0;
    const anonKey = Deno.env.get("INSFORGE_ANON_KEY") ?? Deno.env.get("ANON_KEY") ?? incomingApiKey ?? void 0;
    const serviceRoleKey = Deno.env.get("INSFORGE_SERVICE_ROLE_KEY");
    if (!serviceRoleKey) return json({ error: "server misconfigured" }, 500);
    const client = (0, import_sdk.createClient)({
      baseUrl,
      edgeFunctionToken: serviceRoleKey,
      anonKey,
      ...anonKey ? { headers: { apikey: anonKey } } : {}
    });
    const userId = await verifiedUserIdFromJwt(req.headers.get("Authorization"));
    if (!userId) return json({ error: "Unauthorized" }, 401);
    let cloudAccess;
    try {
      cloudAccess = await cloudReadAccess(client, userId, "daily");
    } catch {
      return json({ error: "Cloud access unavailable", code: "cloud_access_unavailable" }, 503);
    }
    if (!cloudAccess.ok) return cloudFailure(cloudAccess, corsHeaders);
    const historyFailure = cloudHistoryFailure(cloudAccess, to);
    if (historyFailure) return cloudFailure(historyFailure, corsHeaders);
    if (cloudAccess.available_from && from < cloudAccess.available_from) from = cloudAccess.available_from;
    let devices;
    try {
      const { data, error } = await client.database.from("tokentracker_devices").select("id, device_name, platform, created_at").eq("user_id", userId).is("revoked_at", null);
      if (error) throw new Error(error.message);
      devices = data ?? [];
    } catch (e) {
      return json({ error: e.message }, 500);
    }
    const startDate = /* @__PURE__ */ new Date(`${from}T00:00:00Z`);
    startDate.setUTCDate(startDate.getUTCDate() - 1);
    const endDate = /* @__PURE__ */ new Date(`${to}T00:00:00Z`);
    endDate.setUTCDate(endDate.getUTCDate() + 2);
    const rangeStart = startDate.toISOString();
    const rangeEnd = endDate.toISOString();
    let withTotals;
    let accountSources;
    try {
      [withTotals, accountSources] = await Promise.all([
        Promise.all(
          devices.map(async (d) => ({
            ...d,
            total_tokens: await sumDeviceTokens(client, userId, d.id, rangeStart, rangeEnd, from, to, tz, tzOffsetMinutes)
          }))
        ),
        sumAccountSources(client, userId, rangeStart, rangeEnd, from, to, tz, tzOffsetMinutes)
      ]);
    } catch (e) {
      return json({ error: e.message }, 500);
    }
    withTotals.sort((a, b) => b.total_tokens - a.total_tokens);
    return json({ from, to, devices: withTotals, account_sources: accountSources });
  }
  return __toCommonJS(tokentracker_account_devices_exports);
})();

    return await __selfHostHandler.default(req);
  })(Deno);
};
