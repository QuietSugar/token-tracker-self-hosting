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

  // dashboard/edge-patches/tokentracker-account-hourly.ts
  var tokentracker_account_hourly_exports = {};
  __export(tokentracker_account_hourly_exports, {
    default: () => tokentracker_account_hourly_default
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

  // dashboard/edge-patches/tokentracker-account-hourly.ts
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
  var GROUPED_ROWS_TTL_MS = 3e4;
  var GROUPED_ROWS_STALE_IF_ERROR_MS = 5 * 6e4;
  var groupedRowsCache = /* @__PURE__ */ new Map();
  var groupedRowsInFlight = /* @__PURE__ */ new Map();
  async function fetchGroupedRows(client, userId, requestedDeviceId, fromIso, toIso, trunc, tz, tzOffsetMinutes) {
    const cacheKey = JSON.stringify([userId, requestedDeviceId, fromIso, toIso, trunc, tz, tzOffsetMinutes]);
    const cached = groupedRowsCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < GROUPED_ROWS_TTL_MS) return cached.rows;
    const existing = groupedRowsInFlight.get(cacheKey);
    if (existing) return existing;
    const pending = (async () => {
      try {
        const { data, error } = await client.database.rpc("account_usage_grouped_cached", {
          p_user_id: userId,
          p_device_id: requestedDeviceId,
          p_from: fromIso,
          p_to: toIso,
          p_trunc: trunc,
          p_tz: tz,
          p_offset_min: tzOffsetMinutes
        });
        if (error) throw new Error(error.message);
        const rows = Array.isArray(data) ? data : [];
        groupedRowsCache.set(cacheKey, { fetchedAt: Date.now(), rows });
        if (groupedRowsCache.size > 64) {
          const oldest = groupedRowsCache.keys().next().value;
          if (oldest) groupedRowsCache.delete(oldest);
        }
        return rows;
      } catch (error) {
        const stale = groupedRowsCache.get(cacheKey);
        if (stale && Date.now() - stale.fetchedAt < GROUPED_ROWS_STALE_IF_ERROR_MS) return stale.rows;
        throw error;
      }
    })().finally(() => groupedRowsInFlight.delete(cacheKey));
    groupedRowsInFlight.set(cacheKey, pending);
    return pending;
  }
  async function tokentracker_account_hourly_default(req) {
    if (req.method === "OPTIONS")
      return new Response(null, { status: 204, headers: corsHeaders });
    if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
    const url = new URL(req.url);
    const day = url.searchParams.get("day") || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const tz = String(url.searchParams.get("tz") || "").trim();
    const rawOffset = Number(url.searchParams.get("tz_offset_minutes"));
    const tzCtx = {
      timeZone: tz || null,
      offsetMinutes: Number.isFinite(rawOffset) ? Math.trunc(rawOffset) : null
    };
    const baseUrl = Deno.env.get("INSFORGE_BASE_URL");
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
      cloudAccess = await cloudReadAccess(client, userId, "hourly");
    } catch {
      return json({ error: "Cloud access unavailable", code: "cloud_access_unavailable" }, 503);
    }
    if (!cloudAccess.ok) return cloudFailure(cloudAccess, corsHeaders);
    const historyFailure = cloudHistoryFailure(cloudAccess, day);
    if (historyFailure) return cloudFailure(historyFailure, corsHeaders);
    const rawDeviceId = url.searchParams.get("device_id");
    const requestedDeviceId = rawDeviceId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawDeviceId) ? rawDeviceId : null;
    const dayDate = /* @__PURE__ */ new Date(`${day}T00:00:00Z`);
    const start = new Date(dayDate);
    start.setUTCDate(start.getUTCDate() - 1);
    const end = new Date(dayDate);
    end.setUTCDate(end.getUTCDate() + 2);
    const rangeStart = start.toISOString();
    const rangeEnd = end.toISOString();
    let rows;
    try {
      rows = await fetchGroupedRows(client, userId, requestedDeviceId, rangeStart, rangeEnd, "hour", tzCtx.timeZone, tzCtx.offsetMinutes);
    } catch (e) {
      return json({ error: e.message }, 500);
    }
    const byHour = /* @__PURE__ */ new Map();
    for (const row of rows) {
      if (row.bucket.slice(0, 10) !== day) continue;
      const hourKey = row.bucket;
      let bucket = byHour.get(hourKey);
      if (!bucket) {
        bucket = {
          hour: hourKey,
          total_tokens: 0,
          billable_total_tokens: 0,
          input_tokens: 0,
          output_tokens: 0,
          cached_input_tokens: 0,
          cache_creation_input_tokens: 0,
          reasoning_output_tokens: 0,
          conversation_count: 0,
          models: {}
        };
        byHour.set(hourKey, bucket);
      }
      const tt = Number(row.total_tokens) || 0;
      bucket.total_tokens += tt;
      bucket.billable_total_tokens += tt;
      bucket.input_tokens += Number(row.input_tokens) || 0;
      bucket.output_tokens += Number(row.output_tokens) || 0;
      bucket.cached_input_tokens += Number(row.cached_input_tokens) || 0;
      bucket.cache_creation_input_tokens += Number(row.cache_creation_input_tokens) || 0;
      bucket.reasoning_output_tokens += Number(row.reasoning_output_tokens) || 0;
      bucket.conversation_count += Number(row.conversations) || 0;
      const mdl = String(row.model || "unknown");
      bucket.models[mdl] = (bucket.models[mdl] || 0) + tt;
    }
    const data = Array.from(byHour.values()).sort((a, b) => a.hour.localeCompare(b.hour));
    return json({ day, data });
  }
  return __toCommonJS(tokentracker_account_hourly_exports);
})();

    return await __selfHostHandler.default(req);
  })(Deno);
};
