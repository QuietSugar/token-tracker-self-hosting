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

  // dashboard/edge-patches/tokentracker-device-rename.ts
  var tokentracker_device_rename_exports = {};
  __export(tokentracker_device_rename_exports, {
    default: () => tokentracker_device_rename_default
  });
  var import_sdk = __require("npm:@insforge/sdk@1.4.5");
  var corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey"
  };
  var MAX_NAME_LEN = 60;
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
  async function tokentracker_device_rename_default(req) {
    if (req.method === "OPTIONS")
      return new Response(null, { status: 204, headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const baseUrl = Deno.env.get("INSFORGE_BASE_URL");
    if (!baseUrl) return json({ error: "server misconfigured" }, 500);
    const serviceRoleKey = Deno.env.get("INSFORGE_SERVICE_ROLE_KEY");
    if (!serviceRoleKey) return json({ error: "server misconfigured" }, 500);
    const incomingApiKey = req.headers.get("apikey") ?? req.headers.get("Apikey") ?? req.headers.get("x-api-key") ?? void 0;
    const anonKey = Deno.env.get("INSFORGE_ANON_KEY") ?? Deno.env.get("ANON_KEY") ?? incomingApiKey ?? void 0;
    const userId = await verifiedUserIdFromJwt(req.headers.get("Authorization"));
    if (!userId) return json({ error: "Unauthorized" }, 401);
    const body = await req.json().catch(() => ({}));
    const deviceId = typeof body.device_id === "string" ? body.device_id.trim() : "";
    if (!deviceId) return json({ error: "device_id is required" }, 400);
    const name = (typeof body.device_name === "string" ? body.device_name : "").trim().slice(0, MAX_NAME_LEN);
    if (!name) return json({ error: "device_name is required" }, 400);
    const client = (0, import_sdk.createClient)({
      baseUrl,
      edgeFunctionToken: serviceRoleKey,
      anonKey,
      ...anonKey ? { headers: { apikey: anonKey } } : {}
    });
    try {
      let priorName = null;
      const { data: current, error: readErr } = await client.database.from("tokentracker_devices").select("id, device_name, name_customized").eq("id", deviceId).eq("user_id", userId).is("revoked_at", null).maybeSingle();
      if (!readErr && current && !current.name_customized) {
        priorName = current.device_name ?? null;
      }
      let { data, error } = await client.database.from("tokentracker_devices").update(priorName ? { device_name: name, name_customized: true, default_device_name: priorName } : { device_name: name, name_customized: true }).eq("id", deviceId).eq("user_id", userId).is("revoked_at", null).select("id, device_name, platform");
      if (error && /name_customized|default_device_name/i.test(error.message || "")) {
        ({ data, error } = await client.database.from("tokentracker_devices").update({ device_name: name }).eq("id", deviceId).eq("user_id", userId).is("revoked_at", null).select("id, device_name, platform"));
      }
      if (error) {
        const msg = error.message || "";
        if (/unique|duplicate|conflict|already exists/i.test(msg))
          return json({ error: "name_taken" }, 409);
        return json({ error: msg }, 500);
      }
      const rows = Array.isArray(data) ? data : [];
      if (rows.length === 0) return json({ error: "not_found" }, 404);
      return json({ ok: true, device: rows[0] });
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }
  return __toCommonJS(tokentracker_device_rename_exports);
})();

    return await __selfHostHandler.default(req);
  })(Deno);
};
