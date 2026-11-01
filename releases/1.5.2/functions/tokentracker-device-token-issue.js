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

  // dashboard/edge-patches/tokentracker-device-token-issue.ts
  var tokentracker_device_token_issue_exports = {};
  __export(tokentracker_device_token_issue_exports, {
    default: () => tokentracker_device_token_issue_default
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

  // dashboard/edge-patches/tokentracker-device-token-issue.ts
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
  function b64urlToBytes(s) {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    const pad = (4 - b64.length % 4) % 4;
    const raw = atob(b64 + "=".repeat(pad));
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  async function verifiedUserIdFromJwt(token) {
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
      const payloadStr = new TextDecoder().decode(b64urlToBytes(parts[1]));
      const payload = JSON.parse(payloadStr);
      if (typeof payload.exp === "number" && Date.now() / 1e3 > payload.exp) return null;
      const sub = payload.sub;
      if (typeof sub === "string" && sub.length > 0) return sub;
      const uid = payload.user_id;
      if (typeof uid === "string" && uid.length > 0) return uid;
    } catch {
    }
    return null;
  }
  function resolveUserIdForUserMode(bearer) {
    return verifiedUserIdFromJwt(bearer);
  }
  async function sha256Hex(input) {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  async function tokentracker_device_token_issue_default(req) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const baseUrl = Deno.env.get("INSFORGE_BASE_URL");
    const incomingApiKey = req.headers.get("apikey") ?? req.headers.get("Apikey") ?? req.headers.get("x-api-key") ?? void 0;
    const anonKey = Deno.env.get("INSFORGE_ANON_KEY") ?? Deno.env.get("ANON_KEY") ?? incomingApiKey ?? void 0;
    const bearer = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!bearer) return json({ error: "Missing bearer token" }, 401);
    const body = await req.json().catch(() => ({}));
    const serviceRoleKey = Deno.env.get("INSFORGE_SERVICE_ROLE_KEY");
    if (!serviceRoleKey) return json({ error: "server misconfigured" }, 500);
    const adminMode = Boolean(serviceRoleKey && bearer === serviceRoleKey);
    let userId = null;
    let dbClient;
    if (adminMode) {
      const fromBody = typeof body.user_id === "string" ? body.user_id : null;
      const dataObj = body.data && typeof body.data === "object" ? body.data : null;
      const fromData = dataObj && typeof dataObj.user_id === "string" ? dataObj.user_id : null;
      userId = fromBody || fromData;
      if (!userId) return json({ error: "user_id is required (admin mode)" }, 400);
      dbClient = (0, import_sdk.createClient)({
        baseUrl,
        edgeFunctionToken: serviceRoleKey,
        anonKey,
        ...anonKey ? { headers: { apikey: anonKey } } : {}
      });
    } else {
      userId = await resolveUserIdForUserMode(bearer);
      if (!userId) return json({ error: "Unauthorized" }, 401);
      dbClient = (0, import_sdk.createClient)({
        baseUrl,
        edgeFunctionToken: serviceRoleKey,
        anonKey,
        ...anonKey ? { headers: { apikey: anonKey } } : {}
      });
    }
    if (isLeaderboardBlockedUser(userId)) {
      return json({ error: "Account blocked" }, 403);
    }
    const dataObj2 = body.data && typeof body.data === "object" ? body.data : void 0;
    const deviceName = String(body.device_name ?? dataObj2?.device_name ?? "Token Tracker").slice(0, 128);
    const platform = String(body.platform ?? dataObj2?.platform ?? "web").slice(
      0,
      32
    );
    const machineIdRaw = body.machine_id ?? dataObj2?.machine_id;
    const machineId = typeof machineIdRaw === "string" && machineIdRaw.trim().length >= 8 ? machineIdRaw.trim().slice(0, 64) : null;
    const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    try {
      const issued = await cloudRpc(dbClient, "cloud_issue_device_token", {
        p_user_id: userId,
        p_device_name: deviceName,
        p_platform: platform,
        p_machine_id: machineId,
        p_legacy_names: Array.from(/* @__PURE__ */ new Set([
          deviceName,
          ...machineId ? [`Token Tracker (dashboard) #${machineId.slice(0, 8)}`] : [],
          "Token Tracker (dashboard)",
          "Token Tracker"
        ])),
        p_token_id: crypto.randomUUID(),
        p_token_hash: await sha256Hex(token),
        p_rotate: false
      });
      if (!issued.ok) return cloudFailure(issued, corsHeaders);
      return json({
        token,
        device_id: issued.device_id,
        created_at: issued.created_at,
        machine_id: issued.machine_id,
        membership: issued.membership
      });
    } catch (error) {
      console.error("device issuance failed", error.message);
      return json({ error: "Cloud access unavailable", code: "cloud_access_unavailable" }, 503);
    }
  }
  return __toCommonJS(tokentracker_device_token_issue_exports);
})();

    return await __selfHostHandler.default(req);
  })(Deno);
};
