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

  // dashboard/edge-patches/tokentracker-device-flow-authorize.ts
  var tokentracker_device_flow_authorize_exports = {};
  __export(tokentracker_device_flow_authorize_exports, {
    default: () => tokentracker_device_flow_authorize_default
  });
  var import_sdk = __require("npm:@insforge/sdk@1.4.5");
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
  function generateDeviceCode() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  function generateUserCode() {
    const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    let out = "";
    for (let i = 0; i < 8; i++) {
      out += alphabet[bytes[i] % alphabet.length];
      if (i === 3) out += "-";
    }
    return out;
  }
  async function tokentracker_device_flow_authorize_default(req) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    let body = {};
    try {
      body = await req.json();
    } catch (_e) {
    }
    const clientInfo = typeof body.client_info === "string" ? body.client_info.slice(0, 200) : null;
    const machineId = typeof body.machine_id === "string" && body.machine_id.trim().length >= 8 ? body.machine_id.trim().slice(0, 64) : null;
    const baseUrl = Deno.env.get("INSFORGE_BASE_URL");
    const serviceRoleKey = Deno.env.get("INSFORGE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("INSFORGE_ANON_KEY") ?? Deno.env.get("ANON_KEY");
    if (!baseUrl) return json({ error: "misconfigured" }, 500);
    if (!serviceRoleKey) return json({ error: "misconfigured" }, 500);
    let verificationUri;
    try {
      const dashboard = new URL(Deno.env.get("TOKENTRACKER_DASHBOARD_URL") || "");
      if (dashboard.username || dashboard.password || dashboard.protocol !== "https:" && !(dashboard.protocol === "http:" && ["localhost", "127.0.0.1"].includes(dashboard.hostname))) {
        return json({ error: "self-host dashboard URL must use HTTPS" }, 500);
      }
      verificationUri = new URL("/device", dashboard).toString();
    } catch {
      return json({ error: "self-host dashboard URL is required" }, 500);
    }
    const client = (0, import_sdk.createClient)({
      baseUrl,
      edgeFunctionToken: serviceRoleKey,
      anonKey,
      ...anonKey ? { headers: { apikey: anonKey } } : {}
    });
    let lastError = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const device_code = generateDeviceCode();
      const user_code = generateUserCode();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1e3).toISOString();
      const { error } = await client.database.from("tokentracker_device_codes").insert([
        {
          device_code,
          user_code,
          status: "pending",
          client_info: clientInfo,
          machine_id: machineId,
          expires_at: expiresAt
        }
      ]);
      if (!error) {
        return json({
          device_code,
          user_code,
          verification_uri: verificationUri,
          verification_uri_complete: verificationUri + "?user_code=" + encodeURIComponent(user_code),
          expires_in: 900,
          interval: 5
        });
      }
      lastError = error;
    }
    return json({ error: "could not allocate device code", detail: String(lastError) }, 503);
  }
  return __toCommonJS(tokentracker_device_flow_authorize_exports);
})();

    return await __selfHostHandler.default(req);
  })(Deno);
};
