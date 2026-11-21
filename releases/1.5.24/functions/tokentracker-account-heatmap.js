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

  // dashboard/edge-patches/tokentracker-account-heatmap.ts
  var tokentracker_account_heatmap_exports = {};
  __export(tokentracker_account_heatmap_exports, {
    default: () => tokentracker_account_heatmap_default
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

  // dashboard/edge-patches/tokentracker-account-heatmap.ts
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
  function zonedDayKey(hourStart, tz, offsetMinutes) {
    if (tz) {
      try {
        const parts = new Intl.DateTimeFormat("en-CA", {
          timeZone: tz,
          year: "numeric",
          month: "2-digit",
          day: "2-digit"
        }).formatToParts(new Date(hourStart));
        const y = parts.find((p) => p.type === "year")?.value;
        const m = parts.find((p) => p.type === "month")?.value;
        const d = parts.find((p) => p.type === "day")?.value;
        if (y && m && d) return `${y}-${m}-${d}`;
      } catch {
      }
    }
    if (offsetMinutes != null && Number.isFinite(offsetMinutes)) {
      const shifted = new Date(new Date(hourStart).getTime() + offsetMinutes * 6e4);
      return shifted.toISOString().slice(0, 10);
    }
    return hourStart.slice(0, 10);
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
  function expandModelPairs(pairs, modelNames) {
    if (pairs === null) return null;
    const entries = [];
    for (let i = 0; i < pairs.length; i += 2) {
      entries.push([modelNames[Number(pairs[i])], pairs[i + 1]]);
    }
    return Object.fromEntries(entries);
  }
  function decodeHeatmapWire(data) {
    const payload = data ?? {};
    const modelNames = Array.isArray(payload.model_names) ? payload.model_names : [];
    return (Array.isArray(payload.days) ? payload.days : []).map(
      ([day, total, pairs]) => [day, total, expandModelPairs(pairs, modelNames)]
    );
  }
  var COMPACT_TTL_MS = 3e4;
  var COMPACT_STALE_IF_ERROR_MS = 5 * 6e4;
  var compactCache = /* @__PURE__ */ new Map();
  var compactInFlight = /* @__PURE__ */ new Map();
  async function fetchHeatmapCompact(client, userId, requestedDeviceId, fromIso, toIso, rangeFrom, rangeTo, tz, tzOffsetMinutes) {
    const cacheKey = JSON.stringify([userId, requestedDeviceId, fromIso, toIso, rangeFrom, rangeTo, tz, tzOffsetMinutes]);
    const cached = compactCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < COMPACT_TTL_MS) return cached.days;
    const existing = compactInFlight.get(cacheKey);
    if (existing) return existing;
    const pending = (async () => {
      try {
        const { data, error } = await client.database.rpc("account_heatmap_wire", {
          p_user_id: userId,
          p_device_id: requestedDeviceId,
          p_from: fromIso,
          p_to: toIso,
          p_tz: tz,
          p_offset_min: tzOffsetMinutes,
          p_range_from: rangeFrom,
          p_range_to: rangeTo
        });
        if (error) throw new Error(error.message);
        const days = decodeHeatmapWire(data);
        compactCache.set(cacheKey, { fetchedAt: Date.now(), days });
        if (compactCache.size > 64) {
          const oldest = compactCache.keys().next().value;
          if (oldest) compactCache.delete(oldest);
        }
        return days;
      } catch (error) {
        const stale = compactCache.get(cacheKey);
        if (stale && Date.now() - stale.fetchedAt < COMPACT_STALE_IF_ERROR_MS) return stale.days;
        throw error;
      }
    })().finally(() => compactInFlight.delete(cacheKey));
    compactInFlight.set(cacheKey, pending);
    return pending;
  }
  async function tokentracker_account_heatmap_default(req) {
    if (req.method === "OPTIONS")
      return new Response(null, { status: 204, headers: corsHeaders });
    if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
    const url = new URL(req.url);
    const weeksRaw = parseInt(url.searchParams.get("weeks") || "52", 10);
    const weeks = Number.isFinite(weeksRaw) ? Math.min(Math.max(weeksRaw, 1), 104) : 52;
    const tz = url.searchParams.get("tz") || null;
    const tzOffsetRaw = url.searchParams.get("tz_offset_minutes");
    const tzOffsetMinutes = tzOffsetRaw != null && tzOffsetRaw !== "" ? Number(tzOffsetRaw) : null;
    const toParam = url.searchParams.get("to") || "";
    const weekStartsOnRaw = (url.searchParams.get("week_starts_on") || "sun").toLowerCase();
    const weekStartsOn = weekStartsOnRaw === "mon" ? "mon" : "sun";
    const wantsCompact = url.searchParams.get("format") === "compact";
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
      cloudAccess = await cloudReadAccess(client, userId, "daily");
    } catch {
      return json({ error: "Cloud access unavailable", code: "cloud_access_unavailable" }, 503);
    }
    if (!cloudAccess.ok) return cloudFailure(cloudAccess, corsHeaders);
    const rawDeviceId = url.searchParams.get("device_id");
    const requestedDeviceId = rawDeviceId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawDeviceId) ? rawDeviceId : null;
    const toStr = toParam || zonedDayKey((/* @__PURE__ */ new Date()).toISOString(), tz, tzOffsetMinutes);
    const end = /* @__PURE__ */ new Date(`${toStr}T00:00:00Z`);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - weeks * 7 + 1);
    const historyFailure = cloudHistoryFailure(cloudAccess, toStr);
    if (historyFailure) return cloudFailure(historyFailure, corsHeaders);
    if (cloudAccess.available_from && start.toISOString().slice(0, 10) < cloudAccess.available_from) {
      start.setTime(Date.parse(`${cloudAccess.available_from}T00:00:00Z`));
    }
    const from = start.toISOString().slice(0, 10);
    const to = toStr;
    const startDate = /* @__PURE__ */ new Date(`${from}T00:00:00Z`);
    startDate.setUTCDate(startDate.getUTCDate() - 1);
    const nextDay = /* @__PURE__ */ new Date(`${to}T00:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 2);
    const rangeStart = startDate.toISOString();
    const rangeEnd = nextDay.toISOString();
    let compactDays;
    try {
      compactDays = await fetchHeatmapCompact(client, userId, requestedDeviceId, rangeStart, rangeEnd, from, to, tz, tzOffsetMinutes);
    } catch (e) {
      return json({ error: e.message }, 500);
    }
    const byDay = /* @__PURE__ */ new Map();
    for (const [day, total, models] of compactDays) {
      const tt = Number(total) || 0;
      const mdl = {};
      if (models) for (const name of Object.keys(models)) mdl[name] = Number(models[name]) || 0;
      byDay.set(day, { total_tokens: tt, billable_total_tokens: tt, models: mdl });
    }
    const allValues = Array.from(byDay.values()).map((d) => d.billable_total_tokens).filter((v) => v > 0);
    const maxValue = allValues.length > 0 ? Math.max(...allValues) : 0;
    const calcLevel = (v) => {
      if (v <= 0) return 0;
      if (maxValue === 0) return 1;
      const r = v / maxValue;
      if (r <= 0.25) return 1;
      if (r <= 0.5) return 2;
      if (r <= 0.75) return 3;
      return 4;
    };
    const cells = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      const day = cursor.toISOString().slice(0, 10);
      const data = byDay.get(day);
      const billable = data?.billable_total_tokens || 0;
      cells.push({
        day,
        total_tokens: data?.total_tokens || 0,
        billable_total_tokens: billable,
        level: calcLevel(billable),
        models: data?.models || null
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    const activeDays = cells.filter((c) => c.billable_total_tokens > 0).length;
    if (wantsCompact) {
      const modelNames = [];
      const modelIndex = /* @__PURE__ */ new Map();
      const days = cells.filter((c) => c.models !== null).map((c) => {
        const pairs = [];
        for (const name of Object.keys(c.models)) {
          let idx = modelIndex.get(name);
          if (idx === void 0) {
            idx = modelNames.length;
            modelNames.push(name);
            modelIndex.set(name, idx);
          }
          pairs.push(idx, c.models[name]);
        }
        return [c.day, c.total_tokens, pairs];
      });
      return json({
        format: "compact",
        from,
        to,
        week_starts_on: weekStartsOn,
        active_days: activeDays,
        streak_days: 0,
        max_value: maxValue,
        model_names: modelNames,
        days
      });
    }
    const weeksArr = [];
    for (let i = 0; i < cells.length; i += 7) {
      weeksArr.push(cells.slice(i, i + 7));
    }
    return json({
      from,
      to,
      week_starts_on: weekStartsOn,
      active_days: activeDays,
      streak_days: 0,
      weeks: weeksArr
    });
  }
  return __toCommonJS(tokentracker_account_heatmap_exports);
})();

    return await __selfHostHandler.default(req);
  })(Deno);
};
