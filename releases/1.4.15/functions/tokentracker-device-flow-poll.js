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

  // dashboard/edge-patches/tokentracker-device-flow-poll.ts
  var tokentracker_device_flow_poll_exports = {};
  __export(tokentracker_device_flow_poll_exports, {
    default: () => tokentracker_device_flow_poll_default
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

  // dashboard/edge-patches/tokentracker-device-flow-poll.ts
  var corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
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
    const data = new TextEncoder().encode(input);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  async function issueDeviceToken(client, userId, clientInfo, machineId, deviceCode) {
    const hostname = clientInfo?.match(/^\S+\s+(.+)$/)?.[1]?.trim();
    const bare = `TokenTracker CLI${clientInfo ? ` (${clientInfo})` : ""}`.slice(0, 128);
    const legacy = `${bare}${machineId ? ` #${machineId.slice(0, 8)}` : ""}`.slice(0, 128);
    const deviceName = (hostname || legacy).slice(0, 128);
    const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const result = await cloudRpc(client, "cloud_issue_device_token", {
      p_user_id: userId,
      p_device_name: deviceName,
      p_platform: "cli-device-flow",
      p_machine_id: machineId,
      p_legacy_names: Array.from(/* @__PURE__ */ new Set([deviceName, legacy, bare])),
      p_token_id: crypto.randomUUID(),
      p_token_hash: await sha256Hex(token),
      p_rotate: true,
      p_device_code: deviceCode
    });
    return { token, result };
  }
  async function tokentracker_device_flow_poll_default(req) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    let body = {};
    try {
      body = await req.json();
    } catch (_e) {
    }
    const deviceCode = typeof body.device_code === "string" ? body.device_code.trim() : "";
    if (!/^[0-9a-f]{64}$/.test(deviceCode)) return json({ status: "unknown" }, 404);
    const baseUrl = Deno.env.get("INSFORGE_BASE_URL");
    const serviceRoleKey = Deno.env.get("INSFORGE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("INSFORGE_ANON_KEY") ?? Deno.env.get("ANON_KEY");
    if (!baseUrl) return json({ error: "misconfigured" }, 500);
    if (!serviceRoleKey) return json({ error: "misconfigured" }, 500);
    const client = (0, import_sdk.createClient)({
      baseUrl,
      edgeFunctionToken: serviceRoleKey,
      anonKey,
      ...anonKey ? { headers: { apikey: anonKey } } : {}
    });
    const { data, error } = await client.database.from("tokentracker_device_codes").select("device_code, user_id, status, expires_at, approved_at, client_info, machine_id").eq("device_code", deviceCode).maybeSingle();
    if (error) {
      console.error("[device-flow-poll] db error:", String(error?.message ?? error));
      return json({ error: "db error" }, 502);
    }
    if (!data) return json({ status: "unknown" }, 404);
    const row = data;
    const expiresAt = new Date(row.expires_at).getTime();
    if (Date.now() > expiresAt) {
      await client.database.from("tokentracker_device_codes").update({ status: "expired" }).eq("device_code", deviceCode).eq("status", "pending");
      return json({ status: "expired" }, 410);
    }
    if (row.status === "approved" && row.user_id) {
      if (isLeaderboardBlockedUser(row.user_id)) {
        return json({ error: "Account blocked" }, 403);
      }
      try {
        const issued = await issueDeviceToken(client, row.user_id, row.client_info, row.machine_id, deviceCode);
        if (!issued.result.ok) return cloudFailure(issued.result, corsHeaders);
        return json({
          status: "approved",
          user_id: row.user_id,
          device_token: issued.token,
          device_id: issued.result.device_id,
          machine_id: issued.result.machine_id,
          membership: issued.result.membership
        });
      } catch (e) {
        console.error("[device-flow-poll] issue failed:", String(e?.message ?? e));
        return json({ error: "Failed to issue device token" }, 500);
      }
    }
    return json({ status: "pending" });
  }
  return __toCommonJS(tokentracker_device_flow_poll_exports);
})();

    return await __selfHostHandler.default(req);
  })(Deno);
};
