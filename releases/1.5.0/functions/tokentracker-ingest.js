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

  // dashboard/edge-patches/tokentracker-ingest.ts
  var tokentracker_ingest_exports = {};
  __export(tokentracker_ingest_exports, {
    default: () => tokentracker_ingest_default
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

  // dashboard/edge-patches/tokentracker-ingest.ts
  var corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-tokentracker-device-token-hash"
  };
  function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
  function isLeaderboardBlockedUser(userId) {
    return (Deno.env.get("LEADERBOARD_BLOCKED_USER_IDS") ?? "").split(",").some((candidate) => candidate.trim() === userId);
  }
  async function sha256Hex(input) {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  async function tokentracker_ingest_default(req) {
    if (req.method === "OPTIONS")
      return new Response(null, { status: 204, headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const authHeader = req.headers.get("Authorization");
    const deviceToken = authHeader?.replace(/^Bearer\s+/i, "");
    if (!deviceToken) return json({ error: "Missing bearer token" }, 401);
    if (Number(req.headers.get("Content-Length") || 0) > 1048576) return json({ error: "Upload too large" }, 413);
    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).byteLength > 1048576) return json({ error: "Upload too large" }, 413);
    let body = null;
    try {
      body = JSON.parse(rawBody);
    } catch {
    }
    if (!body) return json({ error: "Invalid JSON body" }, 400);
    const baseUrl = Deno.env.get("INSFORGE_BASE_URL");
    const serviceRoleKey = Deno.env.get("INSFORGE_SERVICE_ROLE_KEY");
    const incomingApiKey = req.headers.get("apikey") ?? req.headers.get("Apikey") ?? req.headers.get("x-api-key") ?? void 0;
    const anonKey = Deno.env.get("INSFORGE_ANON_KEY") ?? Deno.env.get("ANON_KEY") ?? incomingApiKey ?? void 0;
    if (!serviceRoleKey) return json({ error: "server misconfigured" }, 500);
    const client = (0, import_sdk.createClient)({
      baseUrl,
      edgeFunctionToken: serviceRoleKey,
      anonKey,
      ...anonKey ? { headers: { apikey: anonKey } } : {}
    });
    const tokenHash = await sha256Hex(deviceToken);
    const { data: tokenRow, error: tokenErr } = await client.database.from("tokentracker_device_tokens").select("user_id, device_id").eq("token_hash", tokenHash).is("revoked_at", null).maybeSingle();
    if (tokenErr) return json({ error: tokenErr.message }, 500);
    if (!tokenRow) return json({ error: "Unauthorized" }, 401);
    const userId = tokenRow.user_id;
    const deviceId = tokenRow.device_id;
    if (isLeaderboardBlockedUser(userId)) {
      return json({ error: "Account blocked" }, 403);
    }
    const buckets = Array.isArray(body.buckets) ? body.buckets : Array.isArray(body.hourly) ? body.hourly : [];
    const rawStates = Array.isArray(body.account_session_states) ? body.account_session_states : [];
    if (rawStates.length > 500) {
      return json({ error: "Too many account session states (max 500)" }, 400);
    }
    const TOKEN_KEYS = [
      "input_tokens",
      "output_tokens",
      "cached_input_tokens",
      "cache_creation_input_tokens",
      "reasoning_output_tokens",
      "total_tokens"
    ];
    const states = [];
    for (const r of rawStates) {
      const source = typeof r?.source === "string" ? r.source.trim().toLowerCase() : "";
      const sessionId = typeof r?.session_id === "string" ? r.session_id.trim() : "";
      const model = typeof r?.model === "string" ? r.model.trim() : "";
      const bucketStart = Date.parse(String(r?.bucket_start ?? ""));
      const verifiedAt = Date.parse(String(r?.snapshot_verified_at ?? ""));
      const tokens = {};
      let tokensOk = true;
      for (const k of TOKEN_KEYS) {
        const v = Number(r?.[k]);
        if (!Number.isSafeInteger(v) || v < 0) tokensOk = false;
        else tokens[k] = v;
      }
      if (source !== "trae-cn" || !sessionId || sessionId.length > 256 || !model || model.length > 200 || !Number.isFinite(bucketStart) || !Number.isFinite(verifiedAt) || !tokensOk || tokens.total_tokens !== tokens.input_tokens + tokens.cached_input_tokens + tokens.cache_creation_input_tokens + tokens.output_tokens) {
        return json({ error: "Invalid account session state" }, 400);
      }
      states.push({
        source,
        session_id: sessionId,
        model,
        bucket_start: new Date(bucketStart).toISOString(),
        snapshot_verified_at: new Date(verifiedAt).toISOString(),
        ...tokens
      });
    }
    const stateMap = /* @__PURE__ */ new Map();
    for (const r of states) stateMap.set(r.source + "|" + r.session_id, r);
    const stateRows = Array.from(stateMap.values());
    if ((!Array.isArray(buckets) || buckets.length === 0) && stateRows.length === 0) {
      return json({ error: "No usage buckets provided" }, 400);
    }
    if (buckets.length > 500) {
      return json({ error: "Too many buckets (max 500)" }, 400);
    }
    const mappedRows = buckets.map((b) => ({
      user_id: userId,
      device_id: deviceId,
      hour_start: b.hour_start,
      source: b.source || "unknown",
      model: b.model || "unknown",
      input_tokens: b.input_tokens || 0,
      cached_input_tokens: b.cached_input_tokens || 0,
      cache_creation_input_tokens: b.cache_creation_input_tokens || 0,
      output_tokens: b.output_tokens || 0,
      reasoning_output_tokens: b.reasoning_output_tokens || 0,
      total_tokens: b.total_tokens || 0,
      billable_total_tokens: b.billable_total_tokens || 0,
      total_cost_usd: Number(b.total_cost_usd) || 0,
      // The CLI queue rows name this field `conversation_count`; older upload
      // paths sent `conversations`. Reading only `conversations` zeroed the
      // column for every CLI upload since 2026-04-18 — accept both.
      conversations: b.conversation_count ?? b.conversations ?? 0
    }));
    const dedupedMap = /* @__PURE__ */ new Map();
    for (const r of mappedRows) {
      const key = `${r.hour_start}|${r.source}|${r.model}`;
      const prev = dedupedMap.get(key);
      if (!prev || (Number(r.total_tokens) || 0) > (Number(prev.total_tokens) || 0)) {
        dedupedMap.set(key, r);
      }
    }
    const rows = Array.from(dedupedMap.values());
    try {
      const result = await cloudRpc(client, "cloud_ingest_usage", {
        p_token_hash: tokenHash,
        p_rows: rows,
        p_states: stateRows,
        p_upload_id: typeof body.upload_id === "string" && /^[0-9a-f-]{36}$/i.test(body.upload_id) ? body.upload_id : null
      });
      if (!result.ok) return cloudFailure(result, corsHeaders);
      return json(result);
    } catch (error) {
      console.error("cloud ingest transaction failed", error.message);
      return json({ error: "Cloud access unavailable", code: "cloud_access_unavailable" }, 503);
    }
  }
  return __toCommonJS(tokentracker_ingest_exports);
})();

    return await __selfHostHandler.default(req);
  })(Deno);
};
