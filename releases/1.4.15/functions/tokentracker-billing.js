module.exports = async function(req) {
  return await (async (__selfHostPlatformDeno) => {
    const Deno = { env: { get(key) {
      if (key === "INSFORGE_BASE_URL") return __selfHostPlatformDeno.env.get("INSFORGE_INTERNAL_URL") || __selfHostPlatformDeno.env.get(key);
      if (key === "INSFORGE_SERVICE_ROLE_KEY") return __selfHostPlatformDeno.env.get(key) || __selfHostPlatformDeno.env.get("API_KEY");
      return __selfHostPlatformDeno.env.get(key);
    } } };
    const __selfHostModules = { "node:async_hooks": { __esModule: true, ...await import("node:async_hooks") },
"node:buffer": (mod => ({ __esModule: true, ...mod, File: mod.File || globalThis.File }))(await import("node:buffer")),
"node:crypto": { __esModule: true, ...await import("node:crypto") },
"node:diagnostics_channel": { __esModule: true, ...await import("node:diagnostics_channel") },
"node:dns": { __esModule: true, ...await import("node:dns") },
"node:events": { __esModule: true, ...await import("node:events") },
"node:fs": { __esModule: true, ...await import("node:fs") },
"node:http": { __esModule: true, ...await import("node:http") },
"node:net": { __esModule: true, ...await import("node:net") },
"node:path": { __esModule: true, ...await import("node:path") },
"node:perf_hooks": { __esModule: true, ...await import("node:perf_hooks") },
"node:querystring": { __esModule: true, ...await import("node:querystring") },
"node:stream": { __esModule: true, ...await import("node:stream") },
"node:stream/promises": { __esModule: true, ...await import("node:stream/promises") },
"node:stream/web": { __esModule: true, ...await import("node:stream/web") },
"node:timers/promises": { __esModule: true, ...await import("node:timers/promises") },
"node:url": { __esModule: true, ...await import("node:url") },
"node:util": { __esModule: true, ...await import("node:util") },
"node:zlib": { __esModule: true, ...await import("node:zlib") },
"npm:@fidm/x509@1.2.1": { __esModule: true, ...await import("npm:@fidm/x509@1.2.1") },
"npm:@insforge/sdk@1.4.5": { __esModule: true, ...await import("npm:@insforge/sdk@1.4.5") },
"npm:bignumber.js@9.3.1": { __esModule: true, ...await import("npm:bignumber.js@9.3.1") },
"npm:camelcase-keys@7.0.2": { __esModule: true, ...await import("npm:camelcase-keys@7.0.2") },
"npm:crypto-js@4.2.0": { __esModule: true, ...await import("npm:crypto-js@4.2.0") },
"npm:form-data@4.0.6": { __esModule: true, ...await import("npm:form-data@4.0.6") },
"npm:formstream@1.5.2": { __esModule: true, ...await import("npm:formstream@1.5.2") },
"npm:mime-types@2.1.35": { __esModule: true, ...await import("npm:mime-types@2.1.35") },
"npm:qs@6.16.0": { __esModule: true, ...await import("npm:qs@6.16.0") },
"npm:snakecase-keys@8.1.0": { __esModule: true, ...await import("npm:snakecase-keys@8.1.0") },
"npm:sse-decoder@1.0.0": { __esModule: true, ...await import("npm:sse-decoder@1.0.0") },
"npm:undici@7.30.0": { __esModule: true, ...await import("npm:undici@7.30.0") },
"npm:undici@7.30.0/lib/core/symbols.js": { __esModule: true, ...await import("npm:undici@7.30.0/lib/core/symbols.js") },
"npm:undici@7.30.0/lib/web/fetch/response.js": { __esModule: true, ...await import("npm:undici@7.30.0/lib/web/fetch/response.js") },
"npm:utility@2.5.0": { __esModule: true, ...await import("npm:utility@2.5.0") },
"npm:ylru@2.0.0": { __esModule: true, ...await import("npm:ylru@2.0.0") } };
    const require = specifier => {
      if (!Object.hasOwn(__selfHostModules,specifier)) throw new Error("Unknown self-host runtime module: " + specifier);
      return __selfHostModules[specifier];
    };
    const Buffer = __selfHostModules["node:buffer"].Buffer;
/*! Alipay SDK 4.14.0
This software is licensed under the MIT License.

Copyright(c) 2024 - present alipay and other contributors.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/
/*! urllib 4.9.1
MIT License

Copyright(c) 2011 - 2014 fengmk2 and other contributors.
Copyright(c) 2015 - present node-modules and other contributors.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
/*! Waffo SDK 0.25.0
MIT License

Copyright (c) 2025-present Waffo

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

    "use strict";
var __selfHostHandler = (() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __esm = (fn, res, err) => function __init() {
    if (err) throw err[0];
    try {
      return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
    } catch (e) {
      throw err = [e], e;
    }
  };
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
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // dashboard/edge-patches/cloud/contracts.ts
  function object(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new BillingError("invalid_provider_payload");
    return value;
  }
  function text(value, maxLength = 200) {
    if (typeof value !== "string" || !value || value.length > maxLength) throw new BillingError("invalid_provider_field");
    return value;
  }
  function cents(value) {
    if ((typeof value !== "string" || !/^\d+$/.test(value)) && (typeof value !== "number" || !Number.isInteger(value))) throw new BillingError("invalid_provider_amount");
    const amount = Number(value);
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > 2147483647) throw new BillingError("invalid_provider_amount");
    return amount;
  }
  function decimalCents(value) {
    if (typeof value !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(value)) throw new BillingError("invalid_provider_amount");
    const [whole, decimal = ""] = value.split(".");
    return cents(Number(whole) * 100 + Number(decimal.padEnd(2, "0")));
  }
  function isoDate(value) {
    const date = text(value);
    if (!Number.isFinite(Date.parse(date))) throw new BillingError("invalid_provider_date");
    return new Date(date).toISOString();
  }
  function uuid(value) {
    const id = text(value);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new BillingError("invalid_order_id");
    return id;
  }
  async function providerJson(response) {
    if (!response.ok) throw new BillingError("payment_provider_unavailable", 502);
    return object(await response.json().catch(() => null));
  }
  var BillingError;
  var init_contracts = __esm({
    "dashboard/edge-patches/cloud/contracts.ts"() {
      "use strict";
      BillingError = class extends Error {
        constructor(code, status = 400) {
          super(code);
          this.code = code;
          this.status = status;
        }
        code;
        status;
      };
    }
  });

  // dashboard/edge-patches/cloud/cryptography.ts
  function bytes(value) {
    return encoder.encode(value);
  }
  function base64Bytes(value) {
    try {
      return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
    } catch {
      throw new BillingError("invalid_signature", 401);
    }
  }
  function pemBytes(value) {
    return base64Bytes(value.replace(/-----[^-]+-----|\s/g, ""));
  }
  function freshTimestamp(value, nowMs, toleranceSeconds) {
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Math.abs(nowMs / 1e3 - Number(value)) > toleranceSeconds) throw new BillingError("stale_signature", 401);
  }
  async function verifyRsa(publicKeyPem, message, signature) {
    try {
      const key = await crypto.subtle.importKey(
        "spki",
        pemBytes(publicKeyPem),
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"]
      );
      return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64Bytes(signature), bytes(message));
    } catch {
      return false;
    }
  }
  async function signRsa(privateKeyPem, message) {
    const key = await crypto.subtle.importKey(
      "pkcs8",
      pemBytes(privateKeyPem),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, bytes(message));
    return btoa(String.fromCharCode(...new Uint8Array(signature)));
  }
  var encoder;
  var init_cryptography = __esm({
    "dashboard/edge-patches/cloud/cryptography.ts"() {
      "use strict";
      init_contracts();
      encoder = new TextEncoder();
    }
  });

  // dashboard/edge-patches/cloud/wechat.ts
  function merchantOrderId(id) {
    return uuid(id).replace(/-/g, "");
  }
  function localOrderId(value) {
    const id = text(value);
    if (!/^[0-9a-f]{32}$/i.test(id)) throw new BillingError("invalid_order_id");
    return uuid(
      `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`
    );
  }
  async function verifyWechatMessage(raw, headers, config, nowMs = Date.now()) {
    const timestamp = headers.get("Wechatpay-Timestamp");
    const nonce = headers.get("Wechatpay-Nonce");
    const signature = headers.get("Wechatpay-Signature");
    const serial = headers.get("Wechatpay-Serial");
    if (!config.platformKeyId || !config.platformPublicKey) {
      throw new BillingError("wechat_not_configured", 503);
    }
    if (!timestamp || !nonce || !signature || serial !== config.platformKeyId || nonce.length > 200) {
      throw new BillingError("invalid_signature", 401);
    }
    freshTimestamp(timestamp, nowMs, 300);
    if (!await verifyRsa(
      config.platformPublicKey,
      `${timestamp}
${nonce}
${raw}
`,
      signature
    )) {
      throw new BillingError("invalid_signature", 401);
    }
  }
  async function wechatRequest(method, pathname, payload, config, request2 = fetch) {
    if (config.environment !== "live") {
      throw new BillingError("wechat_live_merchant_required", 503);
    }
    if (!config.merchantId || !config.merchantSerial || !config.merchantPrivateKey) throw new BillingError("wechat_not_configured", 503);
    if (!pathname.startsWith("/v3/") || pathname.includes("\n")) {
      throw new BillingError("invalid_provider_request");
    }
    const body2 = payload ? JSON.stringify(payload) : "";
    const timestamp = String(Math.floor(Date.now() / 1e3));
    const nonce = Array.from(
      crypto.getRandomValues(new Uint8Array(16)),
      (b) => b.toString(16).padStart(2, "0")
    ).join("");
    const signature = await signRsa(
      config.merchantPrivateKey,
      `${method}
${pathname}
${timestamp}
${nonce}
${body2}
`
    );
    const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${config.merchantId}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${config.merchantSerial}"`;
    const response = await request2(`https://api.mch.weixin.qq.com${pathname}`, {
      method,
      signal: AbortSignal.timeout(15e3),
      headers: {
        Authorization: authorization,
        Accept: "application/json",
        "Content-Type": "application/json",
        "Wechatpay-Serial": config.platformKeyId
      },
      ...payload ? { body: body2 } : {}
    });
    const raw = await response.text();
    await verifyWechatMessage(raw, response.headers, config);
    if (!response.ok) throw new BillingError("payment_provider_unavailable", 502);
    try {
      return object(JSON.parse(raw));
    } catch {
      throw new BillingError("invalid_provider_payload", 502);
    }
  }
  async function queryWechatOrder(order, config, request2 = fetch) {
    assertWechatOrder(order, config);
    const data = await wechatRequest(
      "GET",
      `/v3/pay/transactions/out-trade-no/${merchantOrderId(order.id)}?mchid=${encodeURIComponent(config.merchantId)}`,
      null,
      config,
      request2
    );
    if (data.mchid !== config.merchantId || data.appid !== config.appId || localOrderId(data.out_trade_no) !== order.id) {
      throw new BillingError("payment_order_mismatch");
    }
    if (data.trade_state !== "SUCCESS") return null;
    return normalizeWechatEvent(
      {
        id: `query:${text(data.transaction_id)}`,
        event_type: "TRANSACTION.SUCCESS",
        create_time: isoDate(data.success_time)
      },
      data,
      order,
      config
    );
  }
  function normalizeWechatEvent(payload, data, order, config) {
    assertWechatOrder(order, config);
    const event = object(payload);
    if (data.mchid !== config.merchantId || localOrderId(data.out_trade_no) !== order.id) {
      throw new BillingError("payment_order_mismatch");
    }
    const common = {
      event_id: text(event.id),
      order_id: order.id,
      occurred_at: isoDate(event.create_time)
    };
    const amount = object(data.amount);
    if (event.event_type === "REFUND.SUCCESS") {
      if (data.refund_status !== "SUCCESS") return null;
      if (amount.currency != null && amount.currency !== "CNY" || cents(amount.total) !== order.amount_cents) throw new BillingError("payment_amount_mismatch");
      return {
        ...common,
        kind: "refund",
        action_id: text(data.refund_id),
        transaction_id: text(data.transaction_id),
        currency: "CNY",
        amount_cents: cents(amount.refund)
      };
    }
    if (event.event_type !== "TRANSACTION.SUCCESS" || data.trade_state !== "SUCCESS") return null;
    if (data.appid !== config.appId || data.trade_type !== "NATIVE" || data.attach != null && data.attach !== order.id) throw new BillingError("payment_account_mismatch");
    if (amount.currency !== "CNY" || cents(amount.total) !== order.amount_cents) {
      throw new BillingError("payment_amount_mismatch");
    }
    return {
      ...common,
      kind: "payment",
      action_id: text(data.transaction_id),
      currency: "CNY",
      base_amount_cents: order.amount_cents,
      amount_cents: order.amount_cents
    };
  }
  function assertWechatOrder(order, config) {
    if (order.provider !== "wechat" || order.environment !== config.environment || order.currency !== "CNY") {
      throw new BillingError("payment_order_mismatch");
    }
  }
  var init_wechat = __esm({
    "dashboard/edge-patches/cloud/wechat.ts"() {
      "use strict";
      init_contracts();
      init_cryptography();
    }
  });

  // node_modules/urllib/dist/esm/symbols.js
  var symbols, symbols_default;
  var init_symbols = __esm({
    "node_modules/urllib/dist/esm/symbols.js"() {
      symbols = {
        kSocketId: /* @__PURE__ */ Symbol("socket id"),
        kSocketStartTime: /* @__PURE__ */ Symbol("socket start time"),
        kSocketConnectedTime: /* @__PURE__ */ Symbol("socket connected time"),
        kSocketConnectErrorTime: /* @__PURE__ */ Symbol("socket connectError time"),
        kSocketRequestEndTime: /* @__PURE__ */ Symbol("socket request end time"),
        kSocketLocalAddress: /* @__PURE__ */ Symbol("socket local address"),
        kSocketLocalPort: /* @__PURE__ */ Symbol("socket local port"),
        kSocketConnectHost: /* @__PURE__ */ Symbol("socket connect params: host"),
        kSocketConnectPort: /* @__PURE__ */ Symbol("socket connect params: port"),
        kSocketConnectProtocol: /* @__PURE__ */ Symbol("socket connect params: protocol"),
        kHandledRequests: /* @__PURE__ */ Symbol("handled requests per socket"),
        kHandledResponses: /* @__PURE__ */ Symbol("handled responses per socket"),
        kRequestSocket: /* @__PURE__ */ Symbol("request on the socket"),
        kRequestId: /* @__PURE__ */ Symbol("request id"),
        kRequestStartTime: /* @__PURE__ */ Symbol("request start time"),
        kEnableRequestTiming: /* @__PURE__ */ Symbol("enable request timing or not"),
        kRequestTiming: /* @__PURE__ */ Symbol("request timing"),
        kRequestOriginalOpaque: /* @__PURE__ */ Symbol("request original opaque"),
        kRequestInternalOpaque: /* @__PURE__ */ Symbol("request internal opaque"),
        kErrorSocket: /* @__PURE__ */ Symbol("socket of error")
      };
      symbols_default = symbols;
    }
  });

  // node_modules/urllib/dist/esm/utils.js
  function replaceOneChar(c) {
    return JSONCtlCharsMap[c] || "\\u" + (c.charCodeAt(0) + 65536).toString(16).substring(1);
  }
  function replaceJSONCtlChars(value) {
    return value.replace(JSONCtlCharsRE, replaceOneChar);
  }
  function parseJSON(data, fixJSONCtlChars) {
    if (typeof fixJSONCtlChars === "function") {
      data = fixJSONCtlChars(data);
    } else if (fixJSONCtlChars) {
      data = replaceJSONCtlChars(data);
    }
    try {
      data = JSON.parse(data);
    } catch (err) {
      if (err.name === "SyntaxError") {
        err.name = "JSONResponseFormatError";
      }
      if (data.length > 1024) {
        err.message += " (data json format: " + JSON.stringify(data.slice(0, 512)) + " ...skip... " + JSON.stringify(data.slice(data.length - 512)) + ")";
      } else {
        err.message += " (data json format: " + JSON.stringify(data) + ")";
      }
      throw err;
    }
    return data;
  }
  function md5(s) {
    const sum = (0, import_node_crypto.createHash)("md5");
    sum.update(s, "utf8");
    return sum.digest("hex");
  }
  function digestAuthHeader(method, uri, wwwAuthenticate, userpass) {
    const parts = wwwAuthenticate.split(",");
    const opts = {};
    for (const part of parts) {
      const m = part.match(AUTH_KEY_VALUE_RE);
      if (m) {
        opts[m[1]] = m[2].replace(/["']/g, "");
      }
    }
    if (!opts.realm || !opts.nonce) {
      return "";
    }
    let qop = opts.qop || "";
    const index = userpass.indexOf(":");
    const user = userpass.substring(0, index);
    const pass = userpass.substring(index + 1);
    let nc = String(++NC);
    nc = `${NC_PAD.substring(nc.length)}${nc}`;
    const cnonce = (0, import_node_crypto.randomBytes)(8).toString("hex");
    const ha1 = md5(`${user}:${opts.realm}:${pass}`);
    const ha2 = md5(`${method.toUpperCase()}:${uri}`);
    let s = `${ha1}:${opts.nonce}`;
    if (qop) {
      qop = qop.split(",")[0];
      s += `:${nc}:${cnonce}:${qop}`;
    }
    s += `:${ha2}`;
    const response = md5(s);
    let authstring = `Digest username="${user}", realm="${opts.realm}", nonce="${opts.nonce}", uri="${uri}", response="${response}"`;
    if (opts.opaque) {
      authstring += `, opaque="${opts.opaque}"`;
    }
    if (qop) {
      authstring += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
    }
    return authstring;
  }
  function globalId(category) {
    if (!globalIds[category] || globalIds[category] >= MAX_ID_VALUE) {
      globalIds[category] = 0;
    }
    return ++globalIds[category];
  }
  function performanceTime(startTime, now) {
    return Math.floor(((now ?? import_node_perf_hooks.performance.now()) - startTime) * 1e3) / 1e3;
  }
  function isReadable(stream) {
    if (typeof import_node_stream.Readable.isReadable === "function")
      return import_node_stream.Readable.isReadable(stream);
    return stream !== null && typeof stream === "object" && typeof stream.pipe === "function" && stream.readable !== false && typeof stream._read === "function" && typeof stream._readableState === "object";
  }
  function updateSocketInfo(socketInfo, internalOpaque, err) {
    const socket = internalOpaque[symbols_default.kRequestSocket] ?? err?.[symbols_default.kErrorSocket];
    if (socket) {
      socketInfo.id = socket[symbols_default.kSocketId];
      socketInfo.handledRequests = socket[symbols_default.kHandledRequests];
      socketInfo.handledResponses = socket[symbols_default.kHandledResponses];
      if (socket[symbols_default.kSocketLocalAddress]) {
        socketInfo.localAddress = socket[symbols_default.kSocketLocalAddress];
        socketInfo.localPort = socket[symbols_default.kSocketLocalPort];
      }
      if (socket.remoteAddress) {
        socketInfo.remoteAddress = socket.remoteAddress;
        socketInfo.remotePort = socket.remotePort;
        socketInfo.remoteFamily = socket.remoteFamily;
      }
      if (Array.isArray(socket.autoSelectFamilyAttemptedAddresses)) {
        socketInfo.attemptedRemoteAddresses = socket.autoSelectFamilyAttemptedAddresses;
      }
      socketInfo.bytesRead = socket.bytesRead;
      socketInfo.bytesWritten = socket.bytesWritten;
      if (socket[symbols_default.kSocketConnectErrorTime]) {
        socketInfo.connectErrorTime = socket[symbols_default.kSocketConnectErrorTime];
        socketInfo.connectProtocol = socket[symbols_default.kSocketConnectProtocol];
        socketInfo.connectHost = socket[symbols_default.kSocketConnectHost];
        socketInfo.connectPort = socket[symbols_default.kSocketConnectPort];
      }
      if (socket[symbols_default.kSocketConnectedTime]) {
        socketInfo.connectedTime = socket[symbols_default.kSocketConnectedTime];
      }
      if (socket[symbols_default.kSocketRequestEndTime]) {
        socketInfo.lastRequestEndTime = socket[symbols_default.kSocketRequestEndTime];
      }
      socket[symbols_default.kSocketRequestEndTime] = /* @__PURE__ */ new Date();
    }
  }
  function convertHeader(headers) {
    const res = {};
    for (const [key, value] of headers.entries()) {
      if (res[key]) {
        if (!Array.isArray(res[key])) {
          res[key] = [res[key]];
        }
        res[key].push(value);
      } else {
        res[key] = value;
      }
    }
    return res;
  }
  function patchForNode16() {
    if (typeof global.ReadableStream === "undefined") {
      global.ReadableStream = import_web.ReadableStream;
    }
    if (typeof global.TransformStream === "undefined") {
      global.TransformStream = import_web.TransformStream;
    }
    if (typeof global.Blob === "undefined") {
      global.Blob = import_node_buffer.Blob;
    }
    if (typeof global.DOMException === "undefined") {
      global.DOMException = getDOMExceptionClass();
    }
    if (typeof global.File === "undefined") {
      global.File = import_node_buffer.File;
    }
    if (String.prototype.toWellFormed === void 0) {
      Object.defineProperty(String.prototype, "toWellFormed", {
        value: function() {
          return (0, import_node_util.toUSVString)(this);
        },
        enumerable: false,
        configurable: true,
        writable: true
      });
    }
    if (String.prototype.isWellFormed === void 0) {
      Object.defineProperty(String.prototype, "isWellFormed", {
        value: function() {
          return (0, import_node_util.toUSVString)(this) === this;
        },
        enumerable: false,
        configurable: true,
        writable: true
      });
    }
  }
  function getDOMExceptionClass() {
    try {
      atob(0);
    } catch (err) {
      return err.constructor;
    }
  }
  var import_node_buffer, import_node_crypto, import_node_perf_hooks, import_node_stream, import_web, import_node_util, JSONCtlCharsMap, JSONCtlCharsRE, AUTH_KEY_VALUE_RE, NC, NC_PAD, MAX_ID_VALUE, globalIds;
  var init_utils = __esm({
    "node_modules/urllib/dist/esm/utils.js"() {
      import_node_buffer = __require("node:buffer");
      import_node_crypto = __require("node:crypto");
      import_node_perf_hooks = __require("node:perf_hooks");
      import_node_stream = __require("node:stream");
      import_web = __require("node:stream/web");
      import_node_util = __require("node:util");
      init_symbols();
      JSONCtlCharsMap = {
        '"': '\\"',
        // \u0022
        "\\": "\\\\",
        // \u005c
        "\b": "\\b",
        // \u0008
        "\f": "\\f",
        // \u000c
        "\n": "\\n",
        // \u000a
        "\r": "\\r",
        // \u000d
        "	": "\\t"
        // \u0009
      };
      JSONCtlCharsRE = /[\u0000-\u001F\u005C]/g;
      AUTH_KEY_VALUE_RE = /(\w{1,100})=["']?([^'"]+)["']?/;
      NC = 0;
      NC_PAD = "00000000";
      MAX_ID_VALUE = Math.pow(2, 31) - 10;
      globalIds = {};
    }
  });

  // node_modules/urllib/dist/esm/diagnosticsChannel.js
  function subscribe(name, listener) {
    import_node_diagnostics_channel.default.subscribe(name, listener);
  }
  function formatSocket(socket) {
    if (!socket)
      return socket;
    if (!kSocketReset) {
      const symbols2 = Object.getOwnPropertySymbols(socket);
      for (const symbol of symbols2) {
        if (symbol.description === "reset") {
          kSocketReset = symbol;
          break;
        }
      }
    }
    return {
      localAddress: socket[symbols_default.kSocketLocalAddress],
      localPort: socket[symbols_default.kSocketLocalPort],
      remoteAddress: socket.remoteAddress,
      remotePort: socket.remotePort,
      attemptedAddresses: socket.autoSelectFamilyAttemptedAddresses,
      connecting: socket.connecting,
      reset: socket[kSocketReset]
    };
  }
  function getRequestOpaque(request2, kHandler) {
    if (!kHandler)
      return;
    const handler = Reflect.get(request2, kHandler);
    return handler?.opts?.opaque ?? handler?.opaque;
  }
  function initDiagnosticsChannel() {
    if (initedDiagnosticsChannel)
      return;
    initedDiagnosticsChannel = true;
    let kHandler;
    subscribe("undici:request:create", (message, name) => {
      const { request: request2 } = message;
      if (!kHandler) {
        const symbols2 = Object.getOwnPropertySymbols(request2);
        for (const symbol of symbols2) {
          if (symbol.description === "handler") {
            kHandler = symbol;
            break;
          }
        }
      }
      const opaque = getRequestOpaque(request2, kHandler);
      if (!opaque || !opaque[symbols_default.kRequestId])
        return;
      Reflect.set(request2, symbols_default.kRequestInternalOpaque, opaque);
      debug("[%s] Request#%d %s %s, path: %s, headers: %j", name, opaque[symbols_default.kRequestId], request2.method, request2.origin, request2.path, request2.headers);
      if (!opaque[symbols_default.kEnableRequestTiming])
        return;
      opaque[symbols_default.kRequestTiming].queuing = performanceTime(opaque[symbols_default.kRequestStartTime]);
    });
    subscribe("undici:client:connectError", (message, name) => {
      const { error, connectParams, socket } = message;
      let sock = socket;
      if (!sock && error[symbols_default.kErrorSocket]) {
        sock = error[symbols_default.kErrorSocket];
      }
      if (sock) {
        sock[symbols_default.kSocketId] = globalId("UndiciSocket");
        sock[symbols_default.kSocketConnectErrorTime] = /* @__PURE__ */ new Date();
        sock[symbols_default.kHandledRequests] = 0;
        sock[symbols_default.kHandledResponses] = 0;
        if (sock.localAddress) {
          sock[symbols_default.kSocketLocalAddress] = sock.localAddress;
          sock[symbols_default.kSocketLocalPort] = sock.localPort;
        }
        sock[symbols_default.kSocketConnectProtocol] = connectParams.protocol;
        sock[symbols_default.kSocketConnectHost] = connectParams.host;
        sock[symbols_default.kSocketConnectPort] = connectParams.port;
        debug("[%s] Socket#%d connectError, connectParams: %j, error: %s, (sock: %j)", name, sock[symbols_default.kSocketId], connectParams, error.message, formatSocket(sock));
      } else {
        debug("[%s] connectError, connectParams: %j, error: %o", name, connectParams, error);
      }
    });
    subscribe("undici:client:connected", (message, name) => {
      const { socket, connectParams } = message;
      socket[symbols_default.kSocketId] = globalId("UndiciSocket");
      socket[symbols_default.kSocketStartTime] = import_node_perf_hooks2.performance.now();
      socket[symbols_default.kSocketConnectedTime] = /* @__PURE__ */ new Date();
      socket[symbols_default.kHandledRequests] = 0;
      socket[symbols_default.kHandledResponses] = 0;
      socket[symbols_default.kSocketLocalAddress] = socket.localAddress;
      socket[symbols_default.kSocketLocalPort] = socket.localPort;
      socket[symbols_default.kSocketConnectProtocol] = connectParams.protocol;
      socket[symbols_default.kSocketConnectHost] = connectParams.host;
      socket[symbols_default.kSocketConnectPort] = connectParams.port;
      debug("[%s] Socket#%d connected (sock: %j)", name, socket[symbols_default.kSocketId], formatSocket(socket));
    });
    subscribe("undici:client:sendHeaders", (message, name) => {
      const { request: request2, socket } = message;
      const opaque = Reflect.get(request2, symbols_default.kRequestInternalOpaque);
      if (!opaque || !opaque[symbols_default.kRequestId]) {
        debug("[%s] opaque not found", name);
        return;
      }
      socket[symbols_default.kHandledRequests]++;
      opaque[symbols_default.kRequestSocket] = socket;
      debug("[%s] Request#%d send headers on Socket#%d (handled %d requests, sock: %j)", name, opaque[symbols_default.kRequestId], socket[symbols_default.kSocketId], socket[symbols_default.kHandledRequests], formatSocket(socket));
      if (!opaque[symbols_default.kEnableRequestTiming])
        return;
      opaque[symbols_default.kRequestTiming].requestHeadersSent = performanceTime(opaque[symbols_default.kRequestStartTime]);
      if (socket[symbols_default.kHandledRequests] === 1) {
        opaque[symbols_default.kRequestTiming].connected = performanceTime(opaque[symbols_default.kRequestStartTime], socket[symbols_default.kSocketStartTime]);
      }
    });
    subscribe("undici:request:bodySent", (message, name) => {
      const { request: request2 } = message;
      const opaque = Reflect.get(request2, symbols_default.kRequestInternalOpaque);
      if (!opaque || !opaque[symbols_default.kRequestId]) {
        debug("[%s] opaque not found", name);
        return;
      }
      debug("[%s] Request#%d send body", name, opaque[symbols_default.kRequestId]);
      if (!opaque[symbols_default.kEnableRequestTiming])
        return;
      opaque[symbols_default.kRequestTiming].requestSent = performanceTime(opaque[symbols_default.kRequestStartTime]);
    });
    subscribe("undici:request:headers", (message, name) => {
      const { request: request2, response } = message;
      const opaque = Reflect.get(request2, symbols_default.kRequestInternalOpaque);
      if (!opaque || !opaque[symbols_default.kRequestId]) {
        debug("[%s] opaque not found", name);
        return;
      }
      const socket = opaque[symbols_default.kRequestSocket];
      if (socket) {
        socket[symbols_default.kHandledResponses]++;
        debug("[%s] Request#%d get %s response headers on Socket#%d (handled %d responses, sock: %j)", name, opaque[symbols_default.kRequestId], response.statusCode, socket[symbols_default.kSocketId], socket[symbols_default.kHandledResponses], formatSocket(socket));
      } else {
        debug("[%s] Request#%d get %s response headers on Unknown Socket", name, opaque[symbols_default.kRequestId], response.statusCode);
      }
      if (!opaque[symbols_default.kEnableRequestTiming])
        return;
      opaque[symbols_default.kRequestTiming].waiting = performanceTime(opaque[symbols_default.kRequestStartTime]);
    });
    subscribe("undici:request:trailers", (message, name) => {
      const { request: request2 } = message;
      const opaque = Reflect.get(request2, symbols_default.kRequestInternalOpaque);
      if (!opaque || !opaque[symbols_default.kRequestId]) {
        debug("[%s] opaque not found", name);
        return;
      }
      debug("[%s] Request#%d get response body and trailers", name, opaque[symbols_default.kRequestId]);
      if (!opaque[symbols_default.kEnableRequestTiming])
        return;
      opaque[symbols_default.kRequestTiming].contentDownload = performanceTime(opaque[symbols_default.kRequestStartTime]);
    });
  }
  var import_node_diagnostics_channel, import_node_net, import_node_perf_hooks2, import_node_util2, debug, initedDiagnosticsChannel, kSocketReset, destroySocket;
  var init_diagnosticsChannel = __esm({
    "node_modules/urllib/dist/esm/diagnosticsChannel.js"() {
      import_node_diagnostics_channel = __toESM(__require("node:diagnostics_channel"), 1);
      import_node_net = __require("node:net");
      import_node_perf_hooks2 = __require("node:perf_hooks");
      import_node_util2 = __require("node:util");
      init_symbols();
      init_utils();
      debug = (0, import_node_util2.debuglog)("urllib/diagnosticsChannel");
      initedDiagnosticsChannel = false;
      destroySocket = import_node_net.Socket.prototype.destroy;
      import_node_net.Socket.prototype.destroy = function(err) {
        if (err) {
          Object.defineProperty(err, symbols_default.kErrorSocket, {
            // don't show on console log
            enumerable: false,
            value: this
          });
        }
        return destroySocket.call(this, err);
      };
    }
  });

  // node_modules/urllib/dist/esm/FormData.js
  var import_node_path, import_form_data, NON_ASCII_RE, FormData;
  var init_FormData = __esm({
    "node_modules/urllib/dist/esm/FormData.js"() {
      import_node_path = __toESM(__require("node:path"), 1);
      import_form_data = __toESM(__require("npm:form-data@4.0.6"), 1);
      NON_ASCII_RE = /[^\x00-\x7F]/i;
      FormData = class extends import_form_data.default {
        _getContentDisposition(value, options) {
          let filename;
          let contentDisposition;
          if (typeof options.filepath === "string") {
            filename = import_node_path.default.normalize(options.filepath).replace(/\\/g, "/");
          } else if (options.filename || value.name || value.path) {
            filename = import_node_path.default.basename(options.filename || value.name || value.path);
          } else if (value.readable && value.hasOwnProperty("httpVersion")) {
            filename = import_node_path.default.basename(value.client._httpMessage.path || "");
          }
          if (filename) {
            contentDisposition = 'filename="' + filename + '"';
            if (NON_ASCII_RE.test(filename)) {
              contentDisposition += "; filename*=UTF-8''" + encodeURIComponent(filename);
            }
          }
          return contentDisposition;
        }
      };
    }
  });

  // node_modules/urllib/dist/esm/BaseAgent.js
  var import_undici, BaseAgent;
  var init_BaseAgent = __esm({
    "node_modules/urllib/dist/esm/BaseAgent.js"() {
      import_undici = __require("npm:undici@7.30.0");
      BaseAgent = class extends import_undici.Agent {
        #opaqueLocalStorage;
        constructor(options) {
          super(options);
          this.#opaqueLocalStorage = options.opaqueLocalStorage;
        }
        dispatch(options, handler) {
          const opaque = this.#opaqueLocalStorage?.getStore();
          if (opaque) {
            handler.opaque = opaque;
          }
          return super.dispatch(options, handler);
        }
      };
    }
  });

  // node_modules/urllib/dist/esm/HttpAgent.js
  var import_node_dns, import_node_net2, IllegalAddressError, HttpAgent;
  var init_HttpAgent = __esm({
    "node_modules/urllib/dist/esm/HttpAgent.js"() {
      import_node_dns = __toESM(__require("node:dns"), 1);
      import_node_net2 = __require("node:net");
      init_BaseAgent();
      IllegalAddressError = class extends Error {
        hostname;
        ip;
        family;
        constructor(hostname, ip, family) {
          const message = "illegal address";
          super(message);
          this.name = this.constructor.name;
          this.hostname = hostname;
          this.ip = ip;
          this.family = family;
          Error.captureStackTrace(this, this.constructor);
        }
      };
      HttpAgent = class extends BaseAgent {
        #checkAddress;
        constructor(options) {
          const { lookup = import_node_dns.default.lookup, ...baseOpts } = options;
          const lookupFunction = (hostname, dnsOptions, callback) => {
            lookup(hostname, dnsOptions, (err, ...args) => {
              const address = args[0];
              const family = args[1];
              if (err)
                return callback(err, address, family);
              if (options.checkAddress) {
                if (typeof address === "string") {
                  if (!options.checkAddress(address, family, hostname)) {
                    err = new IllegalAddressError(hostname, address, family);
                  }
                } else if (Array.isArray(address)) {
                  const addresses = address;
                  for (const addr of addresses) {
                    if (!options.checkAddress(addr.address, addr.family, hostname)) {
                      err = new IllegalAddressError(hostname, addr.address, addr.family);
                      break;
                    }
                  }
                }
              }
              callback(err, address, family);
            });
          };
          super({
            ...baseOpts,
            connect: { ...options.connect, lookup: lookupFunction, allowH2: options.allowH2 }
          });
          this.#checkAddress = options.checkAddress;
        }
        dispatch(options, handler) {
          if (this.#checkAddress && options.origin) {
            const originUrl = typeof options.origin === "string" ? new URL(options.origin) : options.origin;
            let hostname = originUrl.hostname;
            if (hostname.startsWith("[") && hostname.endsWith("]")) {
              hostname = hostname.substring(1, hostname.length - 1);
            }
            const family = (0, import_node_net2.isIP)(hostname);
            if (family === 4 || family === 6) {
              if (!this.#checkAddress(hostname, family, hostname)) {
                throw new IllegalAddressError(hostname, hostname, family);
              }
            }
          }
          return super.dispatch(options, handler);
        }
      };
    }
  });

  // node_modules/urllib/dist/esm/HttpClientError.js
  var HttpClientRequestError, HttpClientRequestTimeoutError, HttpClientConnectTimeoutError;
  var init_HttpClientError = __esm({
    "node_modules/urllib/dist/esm/HttpClientError.js"() {
      HttpClientRequestError = class extends Error {
        status;
        headers;
        socket;
        res;
      };
      HttpClientRequestTimeoutError = class extends HttpClientRequestError {
        constructor(timeout, options) {
          const message = `Request timeout for ${timeout} ms`;
          super(message, options);
          this.name = this.constructor.name;
          Error.captureStackTrace(this, this.constructor);
        }
      };
      HttpClientConnectTimeoutError = class extends HttpClientRequestError {
        code;
        constructor(message, code, options) {
          super(message, options);
          this.name = this.constructor.name;
          this.code = code;
          Error.captureStackTrace(this, this.constructor);
        }
      };
    }
  });

  // node_modules/urllib/dist/esm/HttpClient.js
  function noop() {
  }
  function getFileName(stream) {
    const filePath = stream.path;
    if (filePath) {
      return (0, import_node_path2.basename)(filePath);
    }
    return "";
  }
  function defaultIsRetry(response) {
    return response.status >= 500;
  }
  var import_node_diagnostics_channel2, import_node_events, import_node_fs, import_node_http, import_node_path2, import_node_perf_hooks3, import_node_querystring, import_node_stream2, import_promises, import_promises2, import_node_url, import_node_util3, import_node_zlib, import_formstream, import_mime_types, import_qs, import_undici2, import_symbols3, PROTO_RE, debug2, VERSION, HEADER_USER_AGENT, channels, RedirectStatusCodes, CrossOriginSensitiveHeaders, HttpClient2;
  var init_HttpClient = __esm({
    "node_modules/urllib/dist/esm/HttpClient.js"() {
      import_node_diagnostics_channel2 = __toESM(__require("node:diagnostics_channel"), 1);
      import_node_events = __require("node:events");
      import_node_fs = __require("node:fs");
      import_node_http = __require("node:http");
      import_node_path2 = __require("node:path");
      import_node_perf_hooks3 = __require("node:perf_hooks");
      import_node_querystring = __toESM(__require("node:querystring"), 1);
      import_node_stream2 = __require("node:stream");
      import_promises = __require("node:stream/promises");
      import_promises2 = __require("node:timers/promises");
      import_node_url = __require("node:url");
      import_node_util3 = __require("node:util");
      import_node_zlib = __require("node:zlib");
      import_formstream = __toESM(__require("npm:formstream@1.5.2"), 1);
      import_mime_types = __toESM(__require("npm:mime-types@2.1.35"), 1);
      import_qs = __toESM(__require("npm:qs@6.16.0"), 1);
      import_undici2 = __require("npm:undici@7.30.0");
      import_symbols3 = __toESM(__require("npm:undici@7.30.0/lib/core/symbols.js"), 1);
      init_diagnosticsChannel();
      init_FormData();
      init_HttpAgent();
      init_HttpClientError();
      init_symbols();
      init_utils();
      PROTO_RE = /^https?:\/\//i;
      debug2 = (0, import_node_util3.debuglog)("urllib:HttpClient");
      VERSION = "4.9.1";
      HEADER_USER_AGENT = `node-urllib/${VERSION} Node.js/${process.version.substring(1)} (${process.platform}; ${process.arch})`;
      channels = {
        request: import_node_diagnostics_channel2.default.channel("urllib:request"),
        response: import_node_diagnostics_channel2.default.channel("urllib:response"),
        fetchRequest: import_node_diagnostics_channel2.default.channel("urllib:fetch:request"),
        fetchResponse: import_node_diagnostics_channel2.default.channel("urllib:fetch:response")
      };
      RedirectStatusCodes = [
        301,
        // Moved Permanently
        302,
        // Found
        303,
        // See Other
        307,
        // Temporary Redirect
        308
        // Permanent Redirect
      ];
      CrossOriginSensitiveHeaders = /* @__PURE__ */ new Set(["authorization", "cookie", "proxy-authorization"]);
      HttpClient2 = class extends import_node_events.EventEmitter {
        #defaultArgs;
        #dispatcher;
        constructor(clientOptions) {
          super();
          this.#defaultArgs = clientOptions?.defaultArgs;
          if (clientOptions?.lookup || clientOptions?.checkAddress) {
            this.#dispatcher = new HttpAgent({
              lookup: clientOptions.lookup,
              checkAddress: clientOptions.checkAddress,
              connect: clientOptions.connect,
              allowH2: clientOptions.allowH2
            });
          } else if (clientOptions?.connect) {
            this.#dispatcher = new import_undici2.Agent({
              connect: clientOptions.connect,
              allowH2: clientOptions.allowH2
            });
          } else if (clientOptions?.allowH2) {
            this.#dispatcher = new import_undici2.Agent({
              allowH2: clientOptions.allowH2
            });
          }
          initDiagnosticsChannel();
        }
        getDispatcher() {
          return this.#dispatcher ?? (0, import_undici2.getGlobalDispatcher)();
        }
        setDispatcher(dispatcher) {
          this.#dispatcher = dispatcher;
        }
        getDispatcherPoolStats() {
          const agent = this.getDispatcher();
          const clients = Reflect.get(agent, import_symbols3.default.kClients);
          const poolStatsMap = {};
          if (!clients) {
            return poolStatsMap;
          }
          for (const [key, ref] of clients) {
            const pool = typeof ref.deref === "function" ? ref.deref() : ref;
            const stats = pool?.stats ?? pool?.dispatcher?.stats;
            if (!stats)
              continue;
            poolStatsMap[key] = {
              connected: stats.connected,
              free: stats.free,
              pending: stats.pending,
              queued: stats.queued,
              running: stats.running,
              size: stats.size
            };
          }
          return poolStatsMap;
        }
        async request(url, options) {
          return await this.#requestInternal(url, options);
        }
        // alias to request, keep compatible with urllib@2 HttpClient.curl
        async curl(url, options) {
          return await this.request(url, options);
        }
        async #requestInternal(url, options, requestContext) {
          const requestId = globalId("HttpClientRequest");
          let requestUrl;
          if (typeof url === "string") {
            if (!PROTO_RE.test(url)) {
              url = "http://" + url;
            }
            requestUrl = new URL(url);
          } else {
            if (!url.searchParams) {
              requestUrl = new URL((0, import_node_url.format)(url));
            } else {
              requestUrl = new URL(url.toString());
            }
          }
          const method = (options?.type || options?.method || "GET").toUpperCase();
          const originalHeaders = options?.headers;
          const headers = {};
          const args = {
            retry: 0,
            socketErrorRetry: 1,
            timing: true,
            ...this.#defaultArgs,
            ...options,
            // keep method and headers exists on args for request event handler to easy use
            method,
            headers
          };
          requestContext = {
            retries: 0,
            socketErrorRetries: 0,
            redirects: 0,
            history: [],
            ...requestContext
          };
          if (!requestContext.requestStartTime) {
            requestContext.requestStartTime = import_node_perf_hooks3.performance.now();
          }
          requestContext.history.push(requestUrl.href);
          const requestStartTime = requestContext.requestStartTime;
          const timing = {
            // socket assigned
            queuing: 0,
            // dns lookup time
            dnslookup: 0,
            // socket connected
            connected: 0,
            // request headers sent
            requestHeadersSent: 0,
            // request sent, including headers and body
            requestSent: 0,
            // Time to first byte (TTFB), the response headers have been received
            waiting: 0,
            // the response body and trailers have been received
            contentDownload: 0
          };
          const originalOpaque = args.opaque;
          const internalOpaque = {
            [symbols_default.kRequestId]: requestId,
            [symbols_default.kRequestStartTime]: requestStartTime,
            [symbols_default.kEnableRequestTiming]: !!args.timing,
            [symbols_default.kRequestTiming]: timing,
            [symbols_default.kRequestOriginalOpaque]: originalOpaque
          };
          const reqMeta = {
            requestId,
            url: requestUrl.href,
            args,
            ctx: args.ctx,
            retries: requestContext.retries
          };
          const socketInfo = {
            id: 0,
            localAddress: "",
            localPort: 0,
            remoteAddress: "",
            remotePort: 0,
            remoteFamily: "",
            bytesWritten: 0,
            bytesRead: 0,
            handledRequests: 0,
            handledResponses: 0
          };
          const resHeaders = {};
          let res = {
            status: -1,
            statusCode: -1,
            statusText: "",
            statusMessage: "",
            headers: resHeaders,
            size: 0,
            aborted: false,
            rt: 0,
            keepAliveSocket: true,
            requestUrls: requestContext.history,
            timing,
            socket: socketInfo,
            retries: requestContext.retries,
            socketErrorRetries: requestContext.socketErrorRetries
          };
          let headersTimeout = 5e3;
          let bodyTimeout = 5e3;
          if (args.timeout) {
            if (Array.isArray(args.timeout)) {
              headersTimeout = args.timeout[0] ?? headersTimeout;
              bodyTimeout = args.timeout[1] ?? bodyTimeout;
            } else {
              headersTimeout = bodyTimeout = typeof args.timeout === "string" ? parseInt(args.timeout) : args.timeout;
            }
          }
          if (originalHeaders) {
            for (const name in originalHeaders) {
              headers[name.toLowerCase()] = originalHeaders[name];
            }
          }
          const hiddenUserAgent = "user-agent" in headers && !headers["user-agent"];
          if (hiddenUserAgent) {
            delete headers["user-agent"];
          } else if (!headers["user-agent"]) {
            headers["user-agent"] = HEADER_USER_AGENT;
          }
          if (args.streaming || args.customResponse) {
            args.dataType = "stream";
          }
          if (args.dataType === "json" && !headers.accept) {
            headers.accept = "application/json";
          }
          if (args.gzip && args.compressed !== false) {
            args.compressed = true;
          }
          if (args.compressed && !headers["accept-encoding"]) {
            headers["accept-encoding"] = "gzip, br";
          }
          if (requestContext.retries > 0) {
            headers["x-urllib-retry"] = `${requestContext.retries}/${args.retry}`;
          }
          if (requestContext.socketErrorRetries > 0) {
            headers["x-urllib-retry-on-socket-error"] = `${requestContext.socketErrorRetries}/${args.socketErrorRetry}`;
          }
          if (args.auth && !headers.authorization) {
            headers.authorization = `Basic ${Buffer.from(args.auth).toString("base64")}`;
          }
          let isStreamingRequest = false;
          let isStreamingResponse = false;
          if (args.dataType === "stream" || args.writeStream) {
            isStreamingResponse = true;
          }
          let maxRedirects = args.maxRedirects ?? 10;
          try {
            const requestOptions = {
              method,
              // disable undici auto redirect handler
              // maxRedirections: 0,
              headersTimeout,
              headers,
              bodyTimeout,
              opaque: internalOpaque,
              dispatcher: args.dispatcher ?? this.#dispatcher,
              signal: args.signal,
              reset: false
            };
            if (typeof args.highWaterMark === "number") {
              requestOptions.highWaterMark = args.highWaterMark;
            }
            if (typeof args.reset === "boolean") {
              requestOptions.reset = args.reset;
            }
            if (args.followRedirect === false) {
              maxRedirects = 0;
            }
            const isGETOrHEAD = requestOptions.method === "GET" || requestOptions.method === "HEAD";
            if (args.stream && !args.content) {
              if (isReadable(args.stream) && !(args.stream instanceof import_node_stream2.Readable)) {
                debug2("Request#%d convert old style stream to Readable", requestId);
                args.stream = new import_node_stream2.Readable().wrap(args.stream);
                isStreamingRequest = true;
              } else if (args.stream instanceof import_formstream.default) {
                debug2("Request#%d convert formstream to Readable", requestId);
                args.stream = new import_node_stream2.Readable().wrap(args.stream);
                isStreamingRequest = true;
              }
              args.content = args.stream;
            }
            if (args.files) {
              if (isGETOrHEAD) {
                requestOptions.method = "POST";
              }
              const formData = new FormData();
              const uploadFiles = [];
              if (Array.isArray(args.files)) {
                for (const [index, file] of args.files.entries()) {
                  const field = index === 0 ? "file" : `file${index}`;
                  uploadFiles.push([field, file]);
                }
              } else if (args.files instanceof import_node_stream2.Readable || isReadable(args.files)) {
                uploadFiles.push(["file", args.files]);
              } else if (typeof args.files === "string" || Buffer.isBuffer(args.files)) {
                uploadFiles.push(["file", args.files]);
              } else if (typeof args.files === "object") {
                const files = args.files;
                for (const field in files) {
                  const file = files[field];
                  uploadFiles.push([field, file, field]);
                }
              }
              if (args.data) {
                for (const field in args.data) {
                  formData.append(field, args.data[field]);
                }
              }
              for (const [index, [field, file, customFileName]] of uploadFiles.entries()) {
                let fileName = "";
                let value;
                if (typeof file === "string") {
                  fileName = (0, import_node_path2.basename)(file);
                  value = (0, import_node_fs.createReadStream)(file);
                } else if (Buffer.isBuffer(file)) {
                  fileName = customFileName || `bufferfile${index}`;
                  value = file;
                } else if (file instanceof import_node_stream2.Readable || isReadable(file)) {
                  fileName = getFileName(file) || customFileName || `streamfile${index}`;
                  isStreamingRequest = true;
                  value = file;
                }
                const mimeType = import_mime_types.default.lookup(fileName) || "";
                formData.append(field, value, {
                  filename: fileName,
                  contentType: mimeType
                });
                debug2("formData append field: %s, mimeType: %s, fileName: %s", field, mimeType, fileName);
              }
              Object.assign(headers, formData.getHeaders());
              requestOptions.body = formData;
            } else if (args.content) {
              if (!isGETOrHEAD) {
                requestOptions.body = args.content;
                if (args.contentType) {
                  headers["content-type"] = args.contentType;
                } else if (typeof args.content === "string" && !headers["content-type"]) {
                  headers["content-type"] = "text/plain;charset=UTF-8";
                }
                isStreamingRequest = isReadable(args.content);
              }
            } else if (args.data) {
              const isStringOrBufferOrReadable = typeof args.data === "string" || Buffer.isBuffer(args.data) || isReadable(args.data);
              if (isGETOrHEAD) {
                if (!isStringOrBufferOrReadable) {
                  let query2;
                  if (args.nestedQuerystring) {
                    query2 = import_qs.default.stringify(args.data);
                  } else {
                    query2 = import_node_querystring.default.stringify(args.data);
                  }
                  const href = requestUrl.href;
                  requestUrl = new URL(href + (href.includes("?") ? "&" : "?") + query2);
                }
              } else {
                if (isStringOrBufferOrReadable) {
                  requestOptions.body = args.data;
                  isStreamingRequest = isReadable(args.data);
                } else {
                  if (args.contentType === "json" || args.contentType === "application/json" || headers["content-type"]?.startsWith("application/json")) {
                    requestOptions.body = JSON.stringify(args.data);
                    if (!headers["content-type"]) {
                      headers["content-type"] = "application/json";
                    }
                  } else {
                    headers["content-type"] = "application/x-www-form-urlencoded;charset=UTF-8";
                    if (args.nestedQuerystring) {
                      requestOptions.body = import_qs.default.stringify(args.data);
                    } else {
                      requestOptions.body = new URLSearchParams(args.data).toString();
                    }
                  }
                }
              }
            }
            if (isStreamingRequest) {
              args.retry = 0;
              args.socketErrorRetry = 0;
              maxRedirects = 0;
            }
            if (isStreamingResponse) {
              args.retry = 0;
              args.socketErrorRetry = 0;
            }
            debug2("Request#%d %s %s, headers: %j, headersTimeout: %s, bodyTimeout: %s, isStreamingRequest: %s, isStreamingResponse: %s, maxRedirections: %s, redirects: %s", requestId, requestOptions.method, requestUrl.href, headers, headersTimeout, bodyTimeout, isStreamingRequest, isStreamingResponse, maxRedirects, requestContext.redirects);
            requestOptions.headers = headers;
            channels.request.publish({
              request: reqMeta
            });
            if (this.listenerCount("request") > 0) {
              this.emit("request", reqMeta);
            }
            let response = await (0, import_undici2.request)(requestUrl, requestOptions);
            if (response.statusCode === 401 && (response.headers["www-authenticate"] || response.headers["x-www-authenticate"]) && !requestOptions.headers.authorization && args.digestAuth) {
              const authenticateHeaders = response.headers["www-authenticate"] ?? response.headers["x-www-authenticate"];
              const authenticate = Array.isArray(authenticateHeaders) ? authenticateHeaders.find((authHeader) => authHeader.startsWith("Digest ")) : authenticateHeaders;
              if (authenticate && authenticate.startsWith("Digest ")) {
                debug2("Request#%d %s: got digest auth header WWW-Authenticate: %s", requestId, requestUrl.href, authenticate);
                requestOptions.headers.authorization = digestAuthHeader(requestOptions.method, `${requestUrl.pathname}${requestUrl.search}`, authenticate, args.digestAuth);
                debug2("Request#%d %s: auth with digest header: %s", requestId, url, requestOptions.headers.authorization);
                if (Array.isArray(response.headers["set-cookie"])) {
                  requestOptions.headers.cookie = response.headers["set-cookie"].join(";");
                }
                await response.body.arrayBuffer();
                response = await (0, import_undici2.request)(requestUrl, requestOptions);
              }
            }
            const contentEncoding = response.headers["content-encoding"];
            const isCompressedContent = contentEncoding === "gzip" || contentEncoding === "br";
            res.headers = response.headers;
            res.status = res.statusCode = response.statusCode;
            res.statusMessage = res.statusText = import_node_http.STATUS_CODES[res.status] || "";
            if (res.headers["content-length"]) {
              res.size = parseInt(res.headers["content-length"]);
            }
            if (RedirectStatusCodes.includes(res.statusCode) && maxRedirects > 0 && requestContext.redirects < maxRedirects) {
              if (res.headers.location) {
                requestContext.redirects++;
                const nextUrl = new URL(res.headers.location, requestUrl.href);
                await response.body.arrayBuffer();
                let redirectOptions = options;
                if (nextUrl.origin !== requestUrl.origin) {
                  const cleanedHeaders = {};
                  if (options?.headers) {
                    for (const name in options.headers) {
                      if (!CrossOriginSensitiveHeaders.has(name.toLowerCase())) {
                        cleanedHeaders[name] = options.headers[name];
                      }
                    }
                  }
                  redirectOptions = { ...options, headers: cleanedHeaders, auth: void 0, digestAuth: void 0 };
                }
                debug2("Request#%d got response, status: %s, headers: %j, timing: %j, redirect to %s", requestId, res.status, res.headers, res.timing, nextUrl.href);
                return await this.#requestInternal(nextUrl.href, redirectOptions, requestContext);
              }
            }
            let data = null;
            if (args.dataType === "stream") {
              if (args.compressed === true && isCompressedContent) {
                const decoder = contentEncoding === "gzip" ? (0, import_node_zlib.createGunzip)() : (0, import_node_zlib.createBrotliDecompress)();
                res = Object.assign((0, import_node_stream2.pipeline)(response.body, decoder, noop), res);
              } else {
                res = Object.assign(response.body, res);
              }
            } else if (args.writeStream) {
              if (args.compressed === true && isCompressedContent) {
                const decoder = contentEncoding === "gzip" ? (0, import_node_zlib.createGunzip)() : (0, import_node_zlib.createBrotliDecompress)();
                await (0, import_promises.pipeline)(response.body, decoder, args.writeStream);
              } else {
                await (0, import_promises.pipeline)(response.body, args.writeStream);
              }
            } else {
              data = Buffer.from(await response.body.arrayBuffer());
              if (isCompressedContent && data.length > 0) {
                try {
                  data = contentEncoding === "gzip" ? (0, import_node_zlib.gunzipSync)(data) : (0, import_node_zlib.brotliDecompressSync)(data);
                } catch (err) {
                  if (err.name === "Error") {
                    err.name = "UnzipError";
                  }
                  throw err;
                }
              }
              if (args.dataType === "text" || args.dataType === "html") {
                data = data.toString();
              } else if (args.dataType === "json") {
                if (data.length === 0) {
                  data = null;
                } else {
                  data = parseJSON(data.toString(), args.fixJSONCtlChars);
                }
              }
            }
            res.rt = performanceTime(requestStartTime);
            updateSocketInfo(socketInfo, internalOpaque);
            const clientResponse = {
              opaque: originalOpaque,
              data,
              status: res.status,
              statusCode: res.status,
              statusText: res.statusText,
              headers: res.headers,
              url: requestUrl.href,
              redirected: requestContext.history.length > 1,
              requestUrls: res.requestUrls,
              res
            };
            debug2("Request#%d got response, status: %s, headers: %j, timing: %j, socket: %j", requestId, res.status, res.headers, res.timing, res.socket);
            if (args.retry > 0 && requestContext.retries < args.retry) {
              const isRetry = args.isRetry ?? defaultIsRetry;
              if (isRetry(clientResponse)) {
                if (args.retryDelay) {
                  await (0, import_promises2.setTimeout)(args.retryDelay);
                }
                requestContext.retries++;
                return await this.#requestInternal(url, options, requestContext);
              }
            }
            channels.response.publish({
              request: reqMeta,
              response: res
            });
            if (this.listenerCount("response") > 0) {
              this.emit("response", {
                requestId,
                error: null,
                ctx: args.ctx,
                req: {
                  ...reqMeta,
                  options: args
                },
                res
              });
            }
            return clientResponse;
          } catch (rawError) {
            debug2("Request#%d throw error: %s, socketErrorRetry: %s, socketErrorRetries: %s", requestId, rawError, args.socketErrorRetry, requestContext.socketErrorRetries);
            let err = rawError;
            if (err.name === "HeadersTimeoutError") {
              err = new HttpClientRequestTimeoutError(headersTimeout, { cause: err });
            } else if (err.name === "BodyTimeoutError") {
              err = new HttpClientRequestTimeoutError(bodyTimeout, { cause: err });
            } else if (err.name === "InformationalError" && err.message.includes("stream timeout")) {
              err = new HttpClientRequestTimeoutError(bodyTimeout, { cause: err });
            } else if (err.code === "UND_ERR_CONNECT_TIMEOUT") {
              err = new HttpClientConnectTimeoutError(err.message, err.code, { cause: err });
            } else if (err.code === "UND_ERR_SOCKET" || err.code === "ECONNRESET") {
              if (args.socketErrorRetry > 0 && requestContext.socketErrorRetries < args.socketErrorRetry) {
                requestContext.socketErrorRetries++;
                debug2("Request#%d retry on socket error, socketErrorRetries: %d", requestId, requestContext.socketErrorRetries);
                return await this.#requestInternal(url, options, requestContext);
              }
            }
            err.opaque = originalOpaque;
            err.status = res.status;
            err.headers = res.headers;
            err.res = res;
            if (err.socket) {
              err._rawSocket = err.socket;
            }
            err.socket = socketInfo;
            res.rt = performanceTime(requestStartTime);
            updateSocketInfo(socketInfo, internalOpaque, rawError);
            channels.response.publish({
              request: reqMeta,
              response: res,
              error: err
            });
            if (this.listenerCount("response") > 0) {
              this.emit("response", {
                requestId,
                error: err,
                ctx: args.ctx,
                req: {
                  ...reqMeta,
                  options: args
                },
                res
              });
            }
            throw err;
          }
        }
      };
    }
  });

  // node_modules/urllib/dist/esm/fetch.js
  var import_node_async_hooks, import_node_util4, import_undici3, import_symbols5, import_response, debug3, FetchFactory, fetch2;
  var init_fetch = __esm({
    "node_modules/urllib/dist/esm/fetch.js"() {
      import_node_async_hooks = __require("node:async_hooks");
      import_node_util4 = __require("node:util");
      import_undici3 = __require("npm:undici@7.30.0");
      import_symbols5 = __toESM(__require("npm:undici@7.30.0/lib/core/symbols.js"), 1);
      import_response = __require("npm:undici@7.30.0/lib/web/fetch/response.js");
      init_BaseAgent();
      init_diagnosticsChannel();
      init_HttpAgent();
      init_HttpClient();
      init_symbols();
      init_utils();
      debug3 = (0, import_node_util4.debuglog)("urllib/fetch");
      FetchFactory = class _FetchFactory {
        #dispatcher;
        #opaqueLocalStorage = new import_node_async_hooks.AsyncLocalStorage();
        static #instance = new _FetchFactory();
        setClientOptions(clientOptions) {
          let dispatcherOption = {
            opaqueLocalStorage: this.#opaqueLocalStorage
          };
          let dispatcherClazz = BaseAgent;
          if (clientOptions?.lookup || clientOptions?.checkAddress) {
            dispatcherOption = {
              ...dispatcherOption,
              lookup: clientOptions.lookup,
              checkAddress: clientOptions.checkAddress,
              connect: clientOptions.connect,
              allowH2: clientOptions.allowH2
            };
            dispatcherClazz = HttpAgent;
          } else if (clientOptions?.connect) {
            dispatcherOption = {
              ...dispatcherOption,
              connect: clientOptions.connect,
              allowH2: clientOptions.allowH2
            };
            dispatcherClazz = BaseAgent;
          } else if (clientOptions?.allowH2) {
            dispatcherOption = {
              ...dispatcherOption,
              allowH2: clientOptions.allowH2
            };
            dispatcherClazz = BaseAgent;
          }
          this.#dispatcher = new dispatcherClazz(dispatcherOption);
          initDiagnosticsChannel();
        }
        getDispatcher() {
          return this.#dispatcher ?? (0, import_undici3.getGlobalDispatcher)();
        }
        setDispatcher(dispatcher) {
          this.#dispatcher = dispatcher;
        }
        getDispatcherPoolStats() {
          const agent = this.getDispatcher();
          const clients = Reflect.get(agent, import_symbols5.default.kClients);
          const poolStatsMap = {};
          if (!clients) {
            return poolStatsMap;
          }
          for (const [key, ref] of clients) {
            const pool = typeof ref.deref === "function" ? ref.deref() : ref;
            const stats = pool?.stats ?? pool?.dispatcher?.stats;
            if (!stats)
              continue;
            poolStatsMap[key] = {
              connected: stats.connected,
              free: stats.free,
              pending: stats.pending,
              queued: stats.queued,
              running: stats.running,
              size: stats.size
            };
          }
          return poolStatsMap;
        }
        static setClientOptions(clientOptions) {
          _FetchFactory.#instance.setClientOptions(clientOptions);
        }
        static getDispatcherPoolStats() {
          return _FetchFactory.#instance.getDispatcherPoolStats();
        }
        async fetch(input, init) {
          const requestStartTime = performance.now();
          init = init ?? {};
          init.dispatcher = init.dispatcher ?? this.#dispatcher;
          const request2 = new import_undici3.Request(input, init);
          const requestId = globalId("HttpClientRequest");
          const timing = {
            // socket assigned
            queuing: 0,
            // dns lookup time
            dnslookup: 0,
            // socket connected
            connected: 0,
            // request headers sent
            requestHeadersSent: 0,
            // request sent, including headers and body
            requestSent: 0,
            // Time to first byte (TTFB), the response headers have been received
            waiting: 0,
            // the response body and trailers have been received
            contentDownload: 0
          };
          const internalOpaque = {
            [symbols_default.kRequestId]: requestId,
            [symbols_default.kRequestStartTime]: requestStartTime,
            [symbols_default.kEnableRequestTiming]: !!(init.timing ?? true),
            [symbols_default.kRequestTiming]: timing
            // [symbols.kRequestOriginalOpaque]: originalOpaque,
          };
          const reqMeta = {
            requestId,
            url: request2.url,
            args: {
              method: request2.method,
              type: request2.method,
              data: request2.body,
              headers: convertHeader(request2.headers)
            },
            retries: 0
          };
          const fetchMeta = {
            requestId,
            request: request2
          };
          const socketInfo = {
            id: 0,
            localAddress: "",
            localPort: 0,
            remoteAddress: "",
            remotePort: 0,
            remoteFamily: "",
            bytesWritten: 0,
            bytesRead: 0,
            handledRequests: 0,
            handledResponses: 0
          };
          channels.request.publish({
            request: reqMeta,
            isSentByFetch: true,
            fetchOpaque: internalOpaque
          });
          channels.fetchRequest.publish({
            fetch: fetchMeta,
            fetchOpaque: internalOpaque
          });
          let res;
          const resHeaders = {};
          const urllibResponse = {
            status: -1,
            statusCode: -1,
            statusText: "",
            statusMessage: "",
            headers: resHeaders,
            size: 0,
            aborted: false,
            rt: 0,
            keepAliveSocket: true,
            requestUrls: [request2.url],
            timing,
            socket: socketInfo,
            retries: 0,
            socketErrorRetries: 0
          };
          try {
            await this.#opaqueLocalStorage.run(internalOpaque, async () => {
              res = await (0, import_undici3.fetch)(request2);
            });
          } catch (e) {
            updateSocketInfo(socketInfo, internalOpaque, e);
            urllibResponse.rt = performanceTime(requestStartTime);
            debug3("Request#%d throw error: %s", requestId, e);
            channels.fetchResponse.publish({
              fetch: fetchMeta,
              error: e,
              fetchOpaque: internalOpaque
            });
            channels.response.publish({
              request: reqMeta,
              response: urllibResponse,
              error: e,
              isSentByFetch: true,
              fetchOpaque: internalOpaque
            });
            throw e;
          }
          const state = (0, import_response.getResponseState)(res);
          updateSocketInfo(socketInfo, internalOpaque);
          urllibResponse.headers = convertHeader(res.headers);
          urllibResponse.status = urllibResponse.statusCode = res.status;
          urllibResponse.statusMessage = res.statusText;
          if (urllibResponse.headers["content-length"]) {
            urllibResponse.size = parseInt(urllibResponse.headers["content-length"]);
          }
          urllibResponse.rt = performanceTime(requestStartTime);
          debug3("Request#%d got response, status: %s, headers: %j, timing: %j, socket: %j", requestId, urllibResponse.status, urllibResponse.headers, timing, urllibResponse.socket);
          channels.fetchResponse.publish({
            fetch: fetchMeta,
            timingInfo: state.timingInfo,
            response: res,
            fetchOpaque: internalOpaque
          });
          channels.response.publish({
            request: reqMeta,
            response: urllibResponse,
            isSentByFetch: true,
            fetchOpaque: internalOpaque
          });
          return res;
        }
        static getDispatcher() {
          return _FetchFactory.#instance.getDispatcher();
        }
        static setDispatcher(dispatcher) {
          _FetchFactory.#instance.setDispatcher(dispatcher);
        }
        static async fetch(input, init) {
          return _FetchFactory.#instance.fetch(input, init);
        }
      };
      fetch2 = FetchFactory.fetch;
    }
  });

  // node_modules/urllib/dist/esm/index.js
  function getDefaultHttpClient(rejectUnauthorized, allowH2) {
    if (rejectUnauthorized === false) {
      if (allowH2) {
        if (!allowH2AndUnauthorizedHttpClient) {
          allowH2AndUnauthorizedHttpClient = new HttpClient2({
            allowH2,
            connect: {
              rejectUnauthorized
            }
          });
        }
        return allowH2AndUnauthorizedHttpClient;
      }
      if (!allowUnauthorizedHttpClient) {
        allowUnauthorizedHttpClient = new HttpClient2({
          connect: {
            rejectUnauthorized
          }
        });
      }
      return allowUnauthorizedHttpClient;
    }
    if (allowH2) {
      if (!allowH2HttpClient) {
        allowH2HttpClient = new HttpClient2({
          allowH2
        });
      }
      return allowH2HttpClient;
    }
    if (!httpClient) {
      httpClient = new HttpClient2();
    }
    return httpClient;
  }
  async function request(url, options) {
    if (options?.socketPath) {
      let domainSocketHttpclient = domainSocketHttpClients.get(options.socketPath);
      if (!domainSocketHttpclient) {
        domainSocketHttpclient = new HttpClient2({
          connect: { socketPath: options.socketPath }
        });
        domainSocketHttpClients.set(options.socketPath, domainSocketHttpclient);
      }
      return await domainSocketHttpclient.request(url, options);
    }
    return await getDefaultHttpClient(options?.rejectUnauthorized, options?.allowH2).request(url, options);
  }
  async function curl(url, options) {
    return await request(url, options);
  }
  var import_ylru, import_undici4, httpClient, allowH2HttpClient, allowUnauthorizedHttpClient, allowH2AndUnauthorizedHttpClient, domainSocketHttpClients, urllib, esm_default;
  var init_esm = __esm({
    "node_modules/urllib/dist/esm/index.js"() {
      import_ylru = __require("npm:ylru@2.0.0");
      init_utils();
      init_HttpClient();
      import_undici4 = __require("npm:undici@7.30.0");
      init_HttpClient();
      init_HttpClientError();
      init_fetch();
      init_FormData();
      patchForNode16();
      domainSocketHttpClients = new import_ylru.LRU(50);
      urllib = {
        request,
        curl,
        USER_AGENT: HEADER_USER_AGENT
      };
      esm_default = urllib;
    }
  });

  // node_modules/alipay-sdk/dist/esm/types.js
  var init_types = __esm({
    "node_modules/alipay-sdk/dist/esm/types.js"() {
    }
  });

  // node_modules/alipay-sdk/dist/esm/AlipayFormStream.js
  var import_formstream2, AlipayFormStream;
  var init_AlipayFormStream = __esm({
    "node_modules/alipay-sdk/dist/esm/AlipayFormStream.js"() {
      import_formstream2 = __toESM(__require("npm:formstream@1.5.2"), 1);
      AlipayFormStream = class extends import_formstream2.default {
        constructor(options) {
          super({
            // set default minChunkSize to 2MB
            minChunkSize: 1024 * 1024 * 2,
            ...options
          });
        }
      };
    }
  });

  // node_modules/alipay-sdk/dist/esm/form.js
  function isJSONString(value) {
    if (typeof value !== "string")
      return false;
    value = value.replace(/\s/g, "").replace(/\n|\r/, "");
    if (/^\{(.*?)\}$/.test(value)) {
      return /"(.*?)":(.*?)/g.test(value);
    }
    if (/^\[(.*?)\]$/.test(value)) {
      return value.replace(/^\[/, "").replace(/\]$/, "").replace(/},{/g, "}\n{").split(/\n/).map((s) => {
        return isJSONString(s);
      }).reduce(function(_prev, curr) {
        return !!curr;
      });
    }
    return false;
  }
  var AlipayFormData;
  var init_form = __esm({
    "node_modules/alipay-sdk/dist/esm/form.js"() {
      AlipayFormData = class {
        method;
        files;
        fields;
        constructor() {
          this.fields = [];
          this.files = [];
          this.method = "post";
        }
        getFields() {
          return this.fields;
        }
        getFiles() {
          return this.files;
        }
        getMethod() {
          return this.method;
        }
        /**
         * 设置 method
         * post、get 的区别在于 post 会返回 form 表单，get 返回 url
         */
        setMethod(method) {
          this.method = method.toLowerCase();
        }
        /**
         * 增加字段
         * @param fieldName 字段名
         * @param fieldValue 字段值
         */
        addField(fieldName, fieldValue) {
          if (isJSONString(fieldValue)) {
            this.fields.push({ name: fieldName, value: JSON.parse(fieldValue) });
          } else {
            this.fields.push({ name: fieldName, value: fieldValue });
          }
        }
        /**
         * 增加文件
         * @param fieldName 文件字段名
         * @param fileName 文件名
         * @param filePath 文件绝对路径，或者文件流，又或者文件内容 Buffer
         */
        addFile(fieldName, fileName, filePath) {
          const file = {
            fieldName,
            name: fileName
          };
          if (typeof filePath === "string") {
            file.path = filePath;
          } else if (Buffer.isBuffer(filePath)) {
            file.content = filePath;
          } else {
            file.stream = filePath;
          }
          this.files.push(file);
        }
      };
    }
  });

  // node_modules/alipay-sdk/dist/esm/util.js
  function parseKey(aesKey) {
    return {
      iv: IV,
      key: import_crypto_js.default.enc.Base64.parse(aesKey)
    };
  }
  function aesEncryptText(plainText, aesKey) {
    const { iv, key } = parseKey(aesKey);
    const encryptedText = import_crypto_js.default.AES.encrypt(plainText, key, { iv }).toString();
    return encryptedText;
  }
  function aesDecryptText(encryptedText, aesKey) {
    const { iv, key } = parseKey(aesKey);
    const bytes2 = import_crypto_js.default.AES.decrypt(encryptedText, key, { iv });
    const plainText = bytes2.toString(import_crypto_js.default.enc.Utf8);
    return plainText;
  }
  function aesEncrypt(data, aesKey) {
    const plainText = JSON.stringify(data);
    return aesEncryptText(plainText, aesKey);
  }
  function aesDecrypt(encryptedText, aesKey) {
    const plainText = aesDecryptText(encryptedText, aesKey);
    const decryptedData = JSON.parse(plainText);
    return decryptedData;
  }
  function sign(method, params, config, options) {
    const signParams = {
      method,
      appId: config.appId,
      charset: config.charset,
      version: config.version,
      signType: config.signType,
      timestamp: (0, import_utility.YYYYMMDDHHmmss)()
    };
    for (const key in params) {
      if (key === "bizContent" || key === "biz_content" || key === "needEncrypt")
        continue;
      signParams[key] = params[key];
    }
    if (config.appCertSn && config.alipayRootCertSn) {
      signParams.appCertSn = config.appCertSn;
      signParams.alipayRootCertSn = config.alipayRootCertSn;
    }
    if (config.wsServiceUrl) {
      signParams.wsServiceUrl = config.wsServiceUrl;
    }
    if (params.bizContent && params.biz_content) {
      throw new TypeError("\u4E0D\u80FD\u540C\u65F6\u8BBE\u7F6E bizContent \u548C biz_content");
    }
    let bizContent = params.bizContent ?? params.biz_content;
    if (bizContent) {
      if (options?.bizContentAutoSnakeCase !== false) {
        bizContent = (0, import_snakecase_keys.default)(bizContent);
      }
      if (params.needEncrypt) {
        if (!config.encryptKey) {
          throw new TypeError("\u8BF7\u8BBE\u7F6E encryptKey \u53C2\u6570");
        }
        signParams.encryptType = "AES";
        signParams.bizContent = aesEncrypt(bizContent, config.encryptKey);
      } else {
        signParams.bizContent = JSON.stringify(bizContent);
      }
    }
    const decamelizeParams = (0, import_snakecase_keys.default)(signParams);
    const signString = Object.keys(decamelizeParams).sort().map((key) => {
      let data = decamelizeParams[key];
      if (Array.prototype.toString.call(data) !== "[object String]") {
        data = JSON.stringify(data);
      }
      return `${key}=${data}`;
    }).join("&");
    const algorithm = ALIPAY_ALGORITHM_MAPPING[config.signType];
    decamelizeParams.sign = (0, import_node_crypto2.createSign)(algorithm).update(signString, "utf8").sign(config.privateKey, "base64");
    debug4("algorithm: %s, signString: %o, sign: %o", algorithm, signString, decamelizeParams.sign);
    return decamelizeParams;
  }
  function signatureV3(signString, appPrivateKey) {
    return (0, import_node_crypto2.createSign)("RSA-SHA256").update(signString, "utf-8").sign(appPrivateKey, "base64");
  }
  function verifySignatureV3(signString, expectedSignature, alipayPublicKey) {
    return (0, import_node_crypto2.createVerify)("RSA-SHA256").update(signString, "utf-8").verify(alipayPublicKey, expectedSignature, "base64");
  }
  function createRequestId() {
    return (0, import_node_crypto2.randomUUID)().replaceAll("-", "");
  }
  async function readableToBytes(stream) {
    const chunks = [];
    let chunk;
    let totalLength = 0;
    for await (chunk of stream) {
      chunks.push(chunk);
      totalLength += chunk.length;
    }
    return Buffer.concat(chunks, totalLength);
  }
  function decamelize(text2) {
    const separator = "_";
    const preserveConsecutiveUppercase = false;
    if (typeof text2 !== "string") {
      throw new TypeError("The `text` arguments should be of type `string`");
    }
    if (text2.length < 2) {
      return preserveConsecutiveUppercase ? text2 : text2.toLowerCase();
    }
    const replacement = `$1${separator}$2`;
    const decamelized = text2.replace(/([\p{Lowercase_Letter}\d])(\p{Uppercase_Letter})/gu, replacement);
    if (preserveConsecutiveUppercase) {
      return handlePreserveConsecutiveUppercase(decamelized, separator);
    }
    return decamelized.replace(/(\p{Uppercase_Letter})(\p{Uppercase_Letter}\p{Lowercase_Letter}+)/gu, replacement).toLowerCase();
  }
  function handlePreserveConsecutiveUppercase(decamelized, separator) {
    decamelized = decamelized.replace(/((?<![\p{Uppercase_Letter}\d])[\p{Uppercase_Letter}\d](?![\p{Uppercase_Letter}\d]))/gu, ($0) => $0.toLowerCase());
    return decamelized.replace(/(\p{Uppercase_Letter}+)(\p{Uppercase_Letter}\p{Lowercase_Letter}+)/gu, (_, $1, $2) => $1 + separator + $2.toLowerCase());
  }
  var import_node_util5, import_node_crypto2, import_utility, import_snakecase_keys, import_crypto_js, debug4, ALIPAY_ALGORITHM_MAPPING, IV;
  var init_util = __esm({
    "node_modules/alipay-sdk/dist/esm/util.js"() {
      import_node_util5 = __require("node:util");
      import_node_crypto2 = __require("node:crypto");
      import_utility = __require("npm:utility@2.5.0");
      import_snakecase_keys = __toESM(__require("npm:snakecase-keys@8.1.0"), 1);
      import_crypto_js = __toESM(__require("npm:crypto-js@4.2.0"), 1);
      debug4 = (0, import_node_util5.debuglog)("alipay-sdk:util");
      ALIPAY_ALGORITHM_MAPPING = {
        RSA: "RSA-SHA1",
        RSA2: "RSA-SHA256"
      };
      IV = import_crypto_js.default.enc.Hex.parse("00000000000000000000000000000000");
    }
  });

  // node_modules/alipay-sdk/dist/esm/antcertutil.js
  function loadPublicKeyFromPath(filePath) {
    const fileData = import_node_fs2.default.readFileSync(filePath);
    const certificate = import_x509.Certificate.fromPEM(fileData);
    return certificate.publicKeyRaw.toString("base64");
  }
  function loadPublicKey(content) {
    const pemContent = typeof content === "string" ? Buffer.from(content) : content;
    const certificate = import_x509.Certificate.fromPEM(pemContent);
    return certificate.publicKeyRaw.toString("base64");
  }
  function getSNFromPath(filePath, isRoot = false) {
    const fileData = import_node_fs2.default.readFileSync(filePath);
    return getSN(fileData, isRoot);
  }
  function getSN(fileData, isRoot = false) {
    const pemData = typeof fileData === "string" ? Buffer.from(fileData) : fileData;
    if (isRoot) {
      return getRootCertSN(pemData);
    }
    const certificate = import_x509.Certificate.fromPEM(pemData);
    return getCertSN(certificate);
  }
  function getCertSN(certificate) {
    const { issuer, serialNumber } = certificate;
    const principalName = issuer.attributes.reduceRight((prev, curr) => {
      const { shortName, value } = curr;
      const result = `${prev}${shortName}=${value},`;
      return result;
    }, "").slice(0, -1);
    const decimalNumber = new import_bignumber.BigNumber(serialNumber, 16).toString(10);
    const SN = (0, import_node_crypto3.createHash)("md5").update(principalName + decimalNumber, "utf8").digest("hex");
    return SN;
  }
  function getRootCertSN(rootContent) {
    const certificates = import_x509.Certificate.fromPEMs(rootContent);
    let rootCertSN = "";
    certificates.forEach((item) => {
      if (item.signatureOID.startsWith("1.2.840.113549.1.1")) {
        const SN = getCertSN(item);
        if (rootCertSN.length === 0) {
          rootCertSN += SN;
        } else {
          rootCertSN += `_${SN}`;
        }
      }
    });
    return rootCertSN;
  }
  var import_node_fs2, import_node_crypto3, import_bignumber, import_x509;
  var init_antcertutil = __esm({
    "node_modules/alipay-sdk/dist/esm/antcertutil.js"() {
      import_node_fs2 = __toESM(__require("node:fs"), 1);
      import_node_crypto3 = __require("node:crypto");
      import_bignumber = __require("npm:bignumber.js@9.3.1");
      import_x509 = __require("npm:@fidm/x509@1.2.1");
    }
  });

  // node_modules/alipay-sdk/dist/esm/alipay.js
  var import_node_util6, import_node_crypto4, import_node_stream3, import_camelcase_keys, import_snakecase_keys2, import_sse_decoder, debug5, http2Agent, AlipayRequestError, SSEField, AlipaySdk;
  var init_alipay = __esm({
    "node_modules/alipay-sdk/dist/esm/alipay.js"() {
      import_node_util6 = __require("node:util");
      import_node_crypto4 = __require("node:crypto");
      import_node_stream3 = __require("node:stream");
      init_esm();
      import_camelcase_keys = __toESM(__require("npm:camelcase-keys@7.0.2"), 1);
      import_snakecase_keys2 = __toESM(__require("npm:snakecase-keys@8.1.0"), 1);
      import_sse_decoder = __require("npm:sse-decoder@1.0.0");
      init_AlipayFormStream();
      init_form();
      init_util();
      init_antcertutil();
      debug5 = (0, import_node_util6.debuglog)("alipay-sdk");
      http2Agent = new import_undici4.Agent({
        allowH2: true
      });
      AlipayRequestError = class extends Error {
        code;
        traceId;
        responseHttpStatus;
        responseDataRaw;
        responseHttpHeaders;
        links;
        constructor(message, options) {
          if (options?.traceId) {
            message = `${message} (traceId: ${options.traceId})`;
          }
          super(message, options);
          this.code = options?.code;
          this.traceId = options?.traceId;
          this.responseHttpStatus = options?.responseHttpStatus;
          this.responseHttpHeaders = options?.responseHttpHeaders;
          this.responseDataRaw = options?.responseDataRaw;
          this.links = options?.links;
          this.name = this.constructor.name;
          Error.captureStackTrace(this, this.constructor);
        }
      };
      (function(SSEField2) {
        SSEField2["EVENT"] = "event";
        SSEField2["DATA"] = "data";
        SSEField2["ID"] = "id";
        SSEField2["RETRY"] = "retry";
      })(SSEField || (SSEField = {}));
      AlipaySdk = class {
        version = "alipay-sdk-nodejs-4.0.0";
        config;
        #proxyAgent;
        /**
         * @class
         * @param {AlipaySdkConfig} config 初始化 SDK 配置
         */
        constructor(config) {
          if (!config.appId) {
            throw Error("config.appId is required");
          }
          if (!config.privateKey) {
            throw Error("config.privateKey is required");
          }
          const privateKeyType = config.keyType === "PKCS8" ? "PRIVATE KEY" : "RSA PRIVATE KEY";
          config.privateKey = this.formatKey(config.privateKey, privateKeyType);
          if (config.appCertPath || config.appCertContent) {
            config.appCertSn = config.appCertContent ? getSN(config.appCertContent, false) : getSNFromPath(config.appCertPath, false);
            config.alipayCertSn = config.alipayPublicCertContent ? getSN(config.alipayPublicCertContent, false) : getSNFromPath(config.alipayPublicCertPath, false);
            config.alipayRootCertSn = config.alipayRootCertContent ? getSN(config.alipayRootCertContent, true) : getSNFromPath(config.alipayRootCertPath, true);
            config.alipayPublicKey = config.alipayPublicCertContent ? loadPublicKey(config.alipayPublicCertContent) : loadPublicKeyFromPath(config.alipayPublicCertPath);
            config.alipayPublicKey = this.formatKey(config.alipayPublicKey, "PUBLIC KEY");
          } else if (config.alipayPublicKey) {
            config.alipayPublicKey = this.formatKey(config.alipayPublicKey, "PUBLIC KEY");
          }
          this.#proxyAgent = config.proxyAgent;
          this.config = Object.assign({
            urllib: esm_default,
            gateway: "https://openapi.alipay.com/gateway.do",
            endpoint: "https://openapi.alipay.com",
            timeout: 5e3,
            camelcase: true,
            signType: "RSA2",
            charset: "utf-8",
            version: "1.0"
          }, (0, import_camelcase_keys.default)(config, { deep: true }));
        }
        // 格式化 key
        formatKey(key, type) {
          const item = key.split("\n").map((val) => val.trim());
          if (item[0].includes(type)) {
            item.shift();
          }
          if (item[item.length - 1].includes(type)) {
            item.pop();
          }
          return `-----BEGIN ${type}-----
${item.join("")}
-----END ${type}-----`;
        }
        // 格式化请求 url（按规范把某些固定的参数放入 url）
        formatUrl(url, params) {
          const requestUrl = new URL(url);
          const urlArgs = [
            "app_id",
            "method",
            "format",
            "charset",
            "sign_type",
            "sign",
            "timestamp",
            "version",
            "notify_url",
            "return_url",
            "auth_token",
            "app_auth_token",
            "app_cert_sn",
            "alipay_root_cert_sn",
            "ws_service_url"
          ];
          const execParams = {};
          for (const key in params) {
            const value = params[key];
            if (urlArgs.includes(key)) {
              requestUrl.searchParams.set(key, value);
            } else {
              execParams[key] = value;
            }
          }
          return { execParams, url: requestUrl.toString() };
        }
        /**
         * Alipay OpenAPI V3 with JSON Response
         * @see https://opendocs.alipay.com/open-v3/054kaq?pathHash=b3eb94e6
         */
        async curl(httpMethod, path2, options) {
          return await this.#curl(httpMethod, path2, options, "json");
        }
        /**
         * Alipay OpenAPI V3 with Stream Response
         * @see https://opendocs.alipay.com/open-v3/054kaq?pathHash=b3eb94e6
         */
        async curlStream(httpMethod, path2, options) {
          return await this.#curl(httpMethod, path2, options, "stream");
        }
        /**
         * Alipay OpenAPI V3 with SSE Response
         * @see https://opendocs.alipay.com/open-v3/054kaq?pathHash=b3eb94e6
         */
        async *sse(httpMethod, path2, options) {
          const { stream } = await this.curlStream(httpMethod, path2, options);
          const parsedStream = import_sse_decoder.Stream.fromReadableStream(stream, void 0, {
            disableJSONParse: true
          });
          let lastEventName = "";
          for await (const line of parsedStream) {
            debug5("[%s][sse] line: %o", Date.now(), line.substring(0, 100));
            if (line.startsWith(":")) {
              continue;
            }
            const index = line.indexOf(": ");
            if (index === -1)
              continue;
            const field = line.substring(0, index);
            const value = line.substring(index + 2);
            if (field === SSEField.RETRY) {
              continue;
            }
            if (field === SSEField.EVENT) {
              if (lastEventName) {
                yield { event: lastEventName, data: "" };
              }
              lastEventName = value;
              continue;
            }
            if (field === SSEField.DATA) {
              yield { event: lastEventName, data: value };
              lastEventName = "";
            }
          }
        }
        async #curl(httpMethod, path2, options, dataType = "json") {
          httpMethod = httpMethod.toUpperCase();
          let url = `${this.config.endpoint}${path2}`;
          let httpRequestUrl = path2;
          let httpRequestBody = "";
          const requestOptions = {
            method: httpMethod,
            dataType: dataType === "stream" ? "stream" : "text",
            timeout: options?.requestTimeout ?? this.config.timeout,
            dispatcher: this.#proxyAgent
          };
          let validateResponseSignature = true;
          if (dataType === "stream") {
            requestOptions.dispatcher = http2Agent;
            validateResponseSignature = false;
          }
          if (validateResponseSignature && !this.config.alipayPublicKey) {
            throw new TypeError("\u8BF7\u786E\u4FDD\u652F\u4ED8\u5B9D\u516C\u94A5 config.alipayPublicKey \u5DF2\u7ECF\u914D\u7F6E\uFF0C\u9700\u8981\u4F7F\u7528\u5B83\u5BF9\u54CD\u5E94\u8FDB\u884C\u9A8C\u7B7E");
          }
          if (options?.agent) {
            requestOptions.dispatcher = options.agent;
          }
          const requestId = options?.requestId ?? createRequestId();
          requestOptions.headers = {
            "user-agent": this.version,
            "alipay-request-id": requestId,
            accept: "application/json"
          };
          if (options?.query) {
            const urlObject = new URL(url);
            for (const key in options.query) {
              urlObject.searchParams.set(key, String(options.query[key]));
            }
            url = urlObject.toString();
            httpRequestUrl = `${urlObject.pathname}${urlObject.search}`;
          }
          if (httpMethod === "GET" || httpMethod === "HEAD") {
            if (options?.body || options?.form) {
              throw new TypeError("GET / HEAD \u8BF7\u6C42\u4E0D\u5141\u8BB8\u63D0\u4EA4 body \u6216 form \u6570\u636E");
            }
          } else {
            if (options?.form) {
              if (options.needEncrypt) {
                throw new TypeError("\u63D0\u4EA4 form \u6570\u636E\u4E0D\u652F\u6301\u5185\u5BB9\u52A0\u5BC6");
              }
              let form;
              if (options.form instanceof AlipayFormData) {
                form = new AlipayFormStream();
                const dataFieldValue = {};
                for (const item of options.form.fields) {
                  dataFieldValue[item.name] = item.value;
                }
                if (options.body) {
                  Object.assign(dataFieldValue, options.body);
                }
                httpRequestBody = JSON.stringify(dataFieldValue);
                form.field("data", httpRequestBody, "application/json");
                for (const item of options.form.files) {
                  if (item.path) {
                    form.file(item.fieldName, item.path, item.name);
                  } else if (item.content) {
                    form.buffer(item.fieldName, item.content, item.name);
                  } else if (item.stream) {
                    form.stream(item.fieldName, item.stream, item.name);
                  }
                }
              } else if (options.form instanceof AlipayFormStream) {
                form = options.form;
                if (options.body) {
                  httpRequestBody = JSON.stringify(options.body);
                  form.field("data", httpRequestBody, "application/json");
                }
              } else {
                throw new TypeError("options.form \u5FC5\u987B\u662F AlipayFormData \u6216\u8005 AlipayFormStream \u7C7B\u578B");
              }
              requestOptions.content = new import_node_stream3.Readable().wrap(form);
              Object.assign(requestOptions.headers, form.headers());
            } else {
              let contentType = "application/json";
              httpRequestBody = options?.body ? JSON.stringify(options.body) : "";
              if (options?.needEncrypt) {
                if (!this.config.encryptKey) {
                  throw new TypeError("\u8BF7\u914D\u7F6E config.encryptKey \u624D\u80FD\u901A\u8FC7 needEncrypt = true \u8FDB\u884C\u8BF7\u6C42\u5185\u5BB9\u52A0\u5BC6\u8C03\u7528");
                }
                contentType = "text/plain";
                requestOptions.headers["alipay-encryption-algm"] = "AES";
                requestOptions.headers["alipay-encrypt-type"] = "AES";
                httpRequestBody = aesEncryptText(httpRequestBody, this.config.encryptKey);
              }
              requestOptions.headers["content-type"] = contentType;
              requestOptions.content = httpRequestBody;
            }
          }
          if (this.config.alipayRootCertSn) {
            requestOptions.headers["alipay-root-cert-sn"] = this.config.alipayRootCertSn;
          }
          let authString = `app_id=${this.config.appId}`;
          if (this.config.appCertSn) {
            authString += `,app_cert_sn=${this.config.appCertSn}`;
          }
          authString += `,nonce=${(0, import_node_crypto4.randomUUID)()},timestamp=${Date.now()}`;
          if (this.config.additionalAuthInfo) {
            authString += `,${this.config.additionalAuthInfo}`;
          }
          let signString = `${authString}
${httpMethod}
${httpRequestUrl}
${httpRequestBody}
`;
          if (options?.appAuthToken) {
            requestOptions.headers["alipay-app-auth-token"] = options.appAuthToken;
            signString += `${options.appAuthToken}
`;
          }
          const signature = signatureV3(signString, this.config.privateKey);
          const authorization = `ALIPAY-SHA256withRSA ${authString},sign=${signature}`;
          debug5("signString: \n--------\n%s\n--------\nauthorization: %o", signString, authorization);
          requestOptions.headers.authorization = authorization;
          debug5("curl %s %s, with body: %s, headers: %j, dataType: %s", httpMethod, url, httpRequestBody, requestOptions.headers, dataType);
          let httpResponse;
          try {
            httpResponse = await esm_default.request(url, requestOptions);
          } catch (err) {
            debug5("HttpClient Request error: %s", err.message);
            debug5(err);
            throw new AlipayRequestError(`HttpClient Request error, ${err.message}`, {
              cause: err,
              traceId: requestId
            });
          }
          const traceId = httpResponse.headers["alipay-trace-id"] ?? requestId;
          debug5("curl response status: %s, headers: %j, raw text body: %s, traceId: %s", httpResponse.status, httpResponse.headers, httpResponse.data, traceId);
          if (httpResponse.status >= 400) {
            let errorData;
            if (dataType === "stream") {
              const bytes2 = await readableToBytes(httpResponse.res);
              errorData = JSON.parse(bytes2.toString());
              debug5("stream to errorData: %j", errorData);
            } else {
              errorData = JSON.parse(httpResponse.data);
            }
            throw new AlipayRequestError(errorData.message, {
              code: errorData.code,
              links: errorData.links,
              responseHttpStatus: httpResponse.status,
              responseHttpHeaders: httpResponse.headers,
              traceId
            });
          }
          if (dataType === "stream") {
            return {
              stream: httpResponse.res,
              responseHttpStatus: httpResponse.status,
              traceId
            };
          }
          let httpResponseBody = httpResponse.data;
          if (validateResponseSignature) {
            const headers = httpResponse.headers;
            const responseSignString = `${headers["alipay-timestamp"]}
${headers["alipay-nonce"]}
${httpResponseBody}
`;
            const expectedSignature = headers["alipay-signature"];
            const expectedAlipaySN = headers["alipay-sn"];
            if (expectedAlipaySN && this.config.alipayCertSn && expectedAlipaySN !== this.config.alipayCertSn) {
              throw new AlipayRequestError(`\u652F\u4ED8\u5B9D\u516C\u94A5\u8BC1\u4E66\u53F7\u4E0D\u5339\u914D\uFF0C\u670D\u52A1\u7AEF\u8FD4\u56DE\u7684\u662F\uFF1A${expectedAlipaySN}\uFF0CSDK \u914D\u7F6E\u7684\u662F\uFF1A${this.config.alipayCertSn}`, {
                code: "response-alipay-sn-verify-error",
                responseDataRaw: httpResponse.data,
                responseHttpStatus: httpResponse.status,
                responseHttpHeaders: httpResponse.headers,
                traceId
              });
            }
            debug5("responseSignString: \n--------\n%s\n--------\nexpectedSignature: %o", responseSignString, expectedSignature);
            if (!verifySignatureV3(responseSignString, expectedSignature, this.config.alipayPublicKey)) {
              throw new AlipayRequestError(`\u652F\u4ED8\u5B9D\u54CD\u5E94\u9A8C\u7B7E\u5931\u8D25\uFF0C\u8BF7\u786E\u4FDD\u652F\u4ED8\u5B9D\u516C\u94A5 config.alipayPublicKey \u662F\u6700\u65B0\u6709\u6548\u7248\u672C\uFF0C\u7B7E\u540D\u5B57\u7B26\u4E32\u4E3A\uFF1A${expectedSignature}\uFF0C\u9A8C\u8BC1\u5B57\u7B26\u4E32\u4E3A\uFF1A${JSON.stringify(responseSignString)}`, {
                code: "response-signature-verify-error",
                responseDataRaw: httpResponse.data,
                responseHttpStatus: httpResponse.status,
                responseHttpHeaders: httpResponse.headers,
                traceId
              });
            }
          }
          if (options?.needEncrypt) {
            httpResponseBody = this.aesDecrypt(httpResponseBody);
            if (!httpResponseBody) {
              throw new AlipayRequestError("\u89E3\u5BC6\u5931\u8D25\uFF0C\u8BF7\u786E\u8BA4 config.encryptKey \u8BBE\u7F6E\u6B63\u786E", {
                code: "decrypt-error",
                responseDataRaw: httpResponse.data,
                responseHttpStatus: httpResponse.status,
                responseHttpHeaders: httpResponse.headers,
                traceId
              });
            }
          }
          return {
            data: JSON.parse(httpResponseBody),
            responseHttpStatus: httpResponse.status,
            traceId
          };
        }
        // 文件上传
        async #multipartExec(method, options) {
          const config = this.config;
          let signParams = {};
          let formData = {};
          options.formData.getFields().forEach((field) => {
            const parsedFieldValue = typeof field.value === "object" && field.value ? JSON.stringify(field.value) : field.value;
            signParams[field.name] = parsedFieldValue;
            formData[field.name] = parsedFieldValue;
          });
          signParams = (0, import_camelcase_keys.default)(signParams, { deep: true });
          formData = (0, import_snakecase_keys2.default)(formData);
          const formStream = new AlipayFormStream();
          for (const k in formData) {
            formStream.field(k, formData[k]);
          }
          options.formData.getFiles().forEach((file) => {
            const fileKey = decamelize(file.fieldName);
            if (file.path) {
              formStream.file(fileKey, file.path, file.name);
            } else if (file.stream) {
              formStream.stream(fileKey, file.stream, file.name);
            } else if (file.content) {
              formStream.buffer(fileKey, file.content, file.name);
            }
          });
          const requestOptions = {
            method: "POST",
            dataType: "text",
            timeout: config.timeout,
            headers: {
              "user-agent": this.version,
              accept: "application/json",
              ...formStream.headers()
            },
            content: new import_node_stream3.Readable().wrap(formStream),
            dispatcher: this.#proxyAgent
          };
          const signData = sign(method, signParams, config);
          const { url } = this.formatUrl(config.gateway, signData);
          options.log?.info("[AlipaySdk] start exec url: %s, method: %s, params: %j", url, method, signParams);
          let httpResponse;
          try {
            httpResponse = await esm_default.request(url, requestOptions);
          } catch (err) {
            debug5("HttpClient Request error: %s", err);
            throw new AlipayRequestError(`HttpClient Request error: ${err.message}`, {
              cause: err
            });
          }
          return this.#formatExecHttpResponse(method, httpResponse, {
            validateSign: options.validateSign
          });
        }
        /**
         * 生成请求字符串，用于客户端进行调用
         * @param {string} method 方法名
         * @param {IRequestParams} bizParams 请求参数
         * @param {object} bizParams.bizContent 业务请求参数
         * @return {string} 请求字符串
         */
        sdkExecute(method, bizParams, options) {
          if (options?.bizContentAutoSnakeCase !== false) {
            bizParams = (0, import_camelcase_keys.default)(bizParams, { deep: true });
          }
          const data = sign(method, bizParams, this.config, {
            bizContentAutoSnakeCase: options?.bizContentAutoSnakeCase
          });
          const sdkStr = Object.keys(data).map((key) => {
            return `${key}=${encodeURIComponent(data[key])}`;
          }).join("&");
          return sdkStr;
        }
        /**
         * @alias sdkExecute
         */
        sdkExec(method, bizParams) {
          return this.sdkExecute(method, bizParams);
        }
        pageExecute(method, httpMethodOrParams, bizParams) {
          const formData = new AlipayFormData();
          let httpMethod = "";
          if (typeof httpMethodOrParams === "string") {
            httpMethod = httpMethodOrParams;
          } else if (typeof httpMethodOrParams === "object") {
            bizParams = httpMethodOrParams;
          }
          if (!httpMethod && bizParams?.method) {
            httpMethod = bizParams.method;
          }
          for (const k in bizParams) {
            if (k === "method")
              continue;
            formData.addField(k, bizParams[k]);
          }
          if (httpMethod) {
            formData.setMethod(httpMethod);
          }
          return this.#pageExec(method, { formData });
        }
        pageExec(method, httpMethodOrParams, bizParams) {
          if (bizParams) {
            return this.pageExecute(method, httpMethodOrParams, bizParams);
          }
          return this.pageExecute(method, httpMethodOrParams);
        }
        // page 类接口，兼容原来的 formData 格式
        #pageExec(method, option = {}) {
          let signParams = { alipaySdk: this.version };
          const config = this.config;
          option.formData.getFields().forEach((field) => {
            signParams[field.name] = field.value;
          });
          signParams = (0, import_camelcase_keys.default)(signParams, { deep: true });
          const signData = sign(method, signParams, config);
          const { url, execParams } = this.formatUrl(config.gateway, signData);
          option.log?.info("[AlipaySdk]start exec url: %s, method: %s, params: %s", url, method, JSON.stringify(signParams));
          if (option.formData.getMethod() === "get") {
            const query2 = Object.keys(execParams).map((key) => {
              return `${key}=${encodeURIComponent(execParams[key])}`;
            });
            return `${url}&${query2.join("&")}`;
          }
          const formName = `alipaySDKSubmit${Date.now()}`;
          return `
      <form action="${url}" method="post" name="${formName}" id="${formName}">
        ${Object.keys(execParams).map((key) => {
            const value = String(execParams[key]).replace(/\"/g, "&quot;");
            return `<input type="hidden" name="${key}" value="${value}" />`;
          }).join("")}
      </form>
      <script>document.forms["${formName}"].submit();</script>
    `;
        }
        // 消息验签
        notifyRSACheck(signArgs, signStr, signType, raw) {
          const signContent = Object.keys(signArgs).sort().filter((val) => val).map((key) => {
            let value = signArgs[key];
            if (Array.prototype.toString.call(value) !== "[object String]") {
              value = JSON.stringify(value);
            }
            if (raw) {
              return `${key}=${value}`;
            }
            return `${key}=${decodeURIComponent(value)}`;
          }).join("&");
          return this.rsaCheck(signContent, signStr, signType);
        }
        /**
         * @ignore
         * @param originStr 开放平台返回的原始字符串
         * @param responseKey xx_response 方法名 key
         */
        getSignStr(originStr, responseKey) {
          let validateStr = originStr.trim();
          const startIndex = originStr.indexOf(`${responseKey}"`);
          const lastIndex = originStr.lastIndexOf('"sign"');
          validateStr = validateStr.substring(startIndex + responseKey.length + 1);
          validateStr = validateStr.substring(0, lastIndex);
          validateStr = validateStr.replace(/^[^{]*{/g, "{");
          validateStr = validateStr.replace(/\}([^}]*)$/g, "}");
          return validateStr;
        }
        /**
         * 执行请求，调用支付宝服务端
         * @param {string} method 调用接口方法名，比如 alipay.ebpp.bill.add
         * @param {IRequestParams} params 请求参数
         * @param {object} params.bizContent 业务请求参数
         * @param {IRequestOption} options 选项
         * @param {Boolean} options.validateSign 是否验签
         * @param {Console} options.log 可选日志记录对象
         * @return {Promise<AlipaySdkCommonResult | string>} 请求执行结果
         */
        async exec(method, params = {}, options = {}) {
          if (options.formData) {
            if (options.formData.getFiles().length > 0) {
              return await this.#multipartExec(method, options);
            }
            throw new TypeError("formData \u53C2\u6570\u4E0D\u5305\u542B\u6587\u4EF6\uFF0C\u4F60\u53EF\u80FD\u662F\u5E0C\u671B\u83B7\u53D6 POST \u8868\u5355 HTML\uFF0C\u8BF7\u8C03\u7528 pageExec() \u65B9\u6CD5\u4EE3\u66FF");
          }
          const config = this.config;
          const signParams = sign(method, params, config);
          const { url, execParams } = this.formatUrl(config.gateway, signParams);
          debug5("start exec, url: %s, method: %s, params: %o", url, method, execParams);
          let httpResponse;
          try {
            httpResponse = await esm_default.request(url, {
              method: "POST",
              data: execParams,
              // 按 text 返回（为了验签）
              dataType: "text",
              timeout: config.timeout,
              headers: {
                "user-agent": this.version,
                "alipay-request-id": options.traceId ?? createRequestId(),
                // 请求须设置 HTTP 头部： Content-Type: application/json, Accept: application/json
                // 加密请求和文件上传 API 除外。
                // 'content-type': 'application/json',
                accept: "application/json"
              },
              dispatcher: this.#proxyAgent
            });
          } catch (err) {
            debug5("HttpClient Request error: %s", err);
            throw new AlipayRequestError(`HttpClient Request error: ${err.message}`, {
              cause: err
            });
          }
          return this.#formatExecHttpResponse(method, httpResponse, {
            needEncrypt: params.needEncrypt,
            validateSign: options.validateSign
          });
        }
        #formatExecHttpResponse(method, httpResponse, options) {
          debug5("http response status: %s, headers: %j, raw text: %o", httpResponse.status, httpResponse.headers, httpResponse.data);
          const traceId = httpResponse.headers.trace_id;
          if (httpResponse.status !== 200) {
            throw new AlipayRequestError(`HTTP \u8BF7\u6C42\u9519\u8BEF, status: ${httpResponse.status}`, {
              traceId,
              responseDataRaw: httpResponse.data
            });
          }
          let alipayResponse;
          try {
            alipayResponse = JSON.parse(httpResponse.data);
          } catch (err) {
            throw new AlipayRequestError("Response \u683C\u5F0F\u9519\u8BEF", {
              traceId,
              responseDataRaw: httpResponse.data,
              cause: err
            });
          }
          const responseKey = `${method.replaceAll(".", "_")}_response`;
          let data = alipayResponse[responseKey] ?? alipayResponse.error_response;
          if (data) {
            if (options?.needEncrypt) {
              if (typeof data === "string") {
                data = aesDecrypt(data, this.config.encryptKey);
              } else {
              }
            }
            if (options?.validateSign) {
              const serverSign = alipayResponse.sign;
              this.checkResponseSign(httpResponse.data, responseKey, serverSign, traceId);
            }
            const result = this.config.camelcase ? (0, import_camelcase_keys.default)(data, { deep: true }) : data;
            if (result && traceId) {
              result.traceId = traceId;
            }
            return result;
          }
          throw new AlipayRequestError(`Response \u683C\u5F0F\u9519\u8BEF\uFF0C\u8FD4\u56DE\u503C ${responseKey} \u627E\u4E0D\u5230`, {
            traceId,
            responseDataRaw: httpResponse.data
          });
        }
        // 结果验签
        checkResponseSign(responseDataRaw, responseKey, serverSign, traceId) {
          if (!this.config.alipayPublicKey) {
            console.warn("[alipay-sdk] config.alipayPublicKey is empty, skip validateSign");
            return;
          }
          if (!responseDataRaw) {
            throw new AlipayRequestError("\u9A8C\u7B7E\u5931\u8D25\uFF0C\u670D\u52A1\u7AEF\u8FD4\u56DE\u503C\u4E3A\u7A7A\u65E0\u6CD5\u8FDB\u884C\u9A8C\u7B7E", {
              traceId,
              responseDataRaw
            });
          }
          const validateStr = this.getSignStr(responseDataRaw, responseKey);
          const verifier = (0, import_node_crypto4.createVerify)(ALIPAY_ALGORITHM_MAPPING[this.config.signType]);
          verifier.update(validateStr, "utf8");
          const success = verifier.verify(this.config.alipayPublicKey, serverSign, "base64");
          if (!success) {
            throw new AlipayRequestError(`\u9A8C\u7B7E\u5931\u8D25\uFF0C\u670D\u52A1\u7AEF\u8FD4\u56DE\u7684 sign: '${serverSign}' \u65E0\u6548, validateStr: '${validateStr}'`, {
              traceId,
              responseDataRaw
            });
          }
        }
        /**
         * 通知验签，不对 value 进行 decode
         * @param {JSON} postData 服务端的消息内容
         * @return { Boolean } 验签是否成功
         */
        checkNotifySignV2(postData) {
          return this.checkNotifySign(postData, true);
        }
        /**
         * 通知验签
         * @param {JSON} postData 服务端的消息内容
         * @param {Boolean} raw 是否使用 raw 内容而非 decode 内容验签
         * @return { Boolean } 验签是否成功
         */
        checkNotifySign(postData, raw) {
          const signStr = postData.sign;
          if (!this.config.alipayPublicKey || !signStr) {
            return false;
          }
          const signType = postData.sign_type || this.config.signType || "RSA2";
          const signArgs = { ...postData };
          delete signArgs.sign;
          signArgs.sign_type = signType;
          const verifyResult = this.notifyRSACheck(signArgs, signStr, signType, raw);
          if (!verifyResult) {
            delete signArgs.sign_type;
            return this.notifyRSACheck(signArgs, signStr, signType, raw);
          }
          return true;
        }
        /**
         * 对加密内容进行 AES 解密
         * @see https://opendocs.alipay.com/common/02mse3#AES%20%E8%A7%A3%E5%AF%86%E5%87%BD%E6%95%B0
         * @param encryptedText 加密内容字符串
         */
        aesDecrypt(encryptedText) {
          return aesDecryptText(encryptedText, this.config.encryptKey);
        }
        /**
         * 对指定内容进行验签
         *
         * 如对前端返回的报文进行验签 https://opendocs.alipay.com/common/02mse3#AES%20%E8%A7%A3%E5%AF%86%E5%87%BD%E6%95%B0
         */
        rsaCheck(signContent, sign2, signType = "RSA2") {
          const verifier = (0, import_node_crypto4.createVerify)(ALIPAY_ALGORITHM_MAPPING[signType]);
          return verifier.update(signContent, "utf-8").verify(this.config.alipayPublicKey, sign2, "base64");
        }
      };
    }
  });

  // node_modules/alipay-sdk/dist/esm/index.js
  var init_esm2 = __esm({
    "node_modules/alipay-sdk/dist/esm/index.js"() {
      init_esm();
      init_types();
      init_alipay();
      init_form();
      init_AlipayFormStream();
    }
  });

  // dashboard/edge-patches/cloud/alipay.ts
  var alipay_exports = {};
  __export(alipay_exports, {
    alipayClient: () => alipayClient,
    createAlipayCheckout: () => createAlipayCheckout,
    normalizeAlipayNotification: () => normalizeAlipayNotification,
    normalizeAlipayQuery: () => normalizeAlipayQuery,
    parseAlipayNotification: () => parseAlipayNotification,
    queryAlipayOrder: () => queryAlipayOrder,
    verifyAlipayNotification: () => verifyAlipayNotification
  });
  function alipayClient(config) {
    if (!config.appId || !config.sellerId || !config.privateKey || !config.publicKey) throw new BillingError("alipay_not_configured", 503);
    const sdk = new AlipaySdk({
      appId: config.appId,
      privateKey: config.privateKey.trim(),
      alipayPublicKey: config.publicKey.trim(),
      keyType: "PKCS8",
      signType: "RSA2",
      charset: "utf-8",
      camelcase: false,
      timeout: 15e3,
      gateway: config.environment === "sandbox" ? "https://openapi-sandbox.dl.alipaydev.com/gateway.do" : "https://openapi.alipay.com/gateway.do",
      endpoint: config.environment === "sandbox" ? "https://openapi-sandbox.dl.alipaydev.com" : "https://openapi.alipay.com"
    });
    const pem = (value, label) => {
      const encoded = value.replace(/-----[^-]+-----|\s/g, "");
      return `-----BEGIN ${label}-----
${encoded.match(/.{1,64}/g)?.join("\n")}
-----END ${label}-----`;
    };
    sdk.config.privateKey = pem(config.privateKey, "PRIVATE KEY");
    sdk.config.alipayPublicKey = pem(config.publicKey, "PUBLIC KEY");
    return sdk;
  }
  function createAlipayCheckout(order, config, mobile = false) {
    assertAlipayOrder(order, config);
    const notify = new URL(config.notifyUrl);
    const returnUrl = new URL(config.checkoutPage);
    if (notify.protocol !== "https:" || returnUrl.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(returnUrl.hostname)) {
      throw new BillingError("invalid_checkout_configuration", 503);
    }
    returnUrl.searchParams.set("order", order.id);
    const amount = `${Math.floor(order.amount_cents / 100)}.${String(order.amount_cents % 100).padStart(2, "0")}`;
    const sdk = alipayClient(config);
    const checkoutUrl = sdk.pageExecute(
      mobile ? "alipay.trade.wap.pay" : "alipay.trade.page.pay",
      "GET",
      {
        bizContent: {
          out_trade_no: merchantOrderId(order.id),
          total_amount: amount,
          product_code: mobile ? "QUICK_WAP_WAY" : "FAST_INSTANT_TRADE_PAY",
          subject: order.term_months === 12 ? "TokenTracker Cloud annual membership" : "TokenTracker Cloud monthly membership",
          timeout_express: "30m",
          seller_id: config.sellerId
        },
        notifyUrl: notify.toString(),
        returnUrl: returnUrl.toString()
      }
    );
    return { checkoutUrl };
  }
  function parseAlipayNotification(raw) {
    const values = {};
    for (const [key, value] of new URLSearchParams(raw)) {
      if (Object.hasOwn(values, key)) {
        throw new BillingError("duplicate_provider_field");
      }
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        throw new BillingError("invalid_provider_field");
      }
      values[key] = value;
    }
    return values;
  }
  function verifyAlipayNotification(values, config) {
    if (values.sign_type !== "RSA2" || values.charset?.toLowerCase() !== "utf-8" || !alipayClient(config).checkNotifySignV2(values)) throw new BillingError("invalid_signature", 401);
    if (values.app_id !== config.appId || values.seller_id !== config.sellerId) {
      throw new BillingError("payment_account_mismatch");
    }
  }
  function alipayDate(value) {
    const raw = text(value);
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
      throw new BillingError("invalid_provider_date");
    }
    const date = /* @__PURE__ */ new Date(`${raw.replace(" ", "T")}+08:00`);
    if (!Number.isFinite(date.getTime())) {
      throw new BillingError("invalid_provider_date");
    }
    return date.toISOString();
  }
  function normalizeAlipayNotification(values, order, config) {
    assertAlipayOrder(order, config);
    if (values.app_id !== config.appId || values.seller_id !== config.sellerId || localOrderId(values.out_trade_no) !== order.id) throw new BillingError("payment_order_mismatch");
    if (decimalCents(values.total_amount) !== order.amount_cents) {
      throw new BillingError("payment_amount_mismatch");
    }
    const refundTotal = values.refund_fee ? decimalCents(values.refund_fee) : 0;
    if (!["TRADE_SUCCESS", "TRADE_FINISHED"].includes(values.trade_status) && !(values.trade_status === "TRADE_CLOSED" && refundTotal > 0)) return [];
    if (refundTotal > order.amount_cents) {
      throw new BillingError("payment_amount_mismatch");
    }
    const transactionId = text(values.trade_no);
    const notificationId = text(values.notify_id, 160);
    const occurred = alipayDate(values.gmt_payment || values.notify_time);
    const payment = {
      event_id: `${notificationId}:payment`,
      kind: "payment",
      action_id: transactionId,
      order_id: order.id,
      occurred_at: occurred,
      currency: "CNY",
      base_amount_cents: order.amount_cents,
      amount_cents: order.amount_cents
    };
    if (refundTotal === 0) return [payment];
    return [payment, {
      event_id: `${notificationId}:refund`,
      kind: "refund",
      action_id: `${transactionId}:refund:${refundTotal}`,
      order_id: order.id,
      occurred_at: alipayDate(values.notify_time),
      transaction_id: transactionId,
      currency: "CNY",
      amount_cents: refundTotal,
      refund_total_cents: refundTotal
    }];
  }
  async function queryAlipayOrder(order, config) {
    assertAlipayOrder(order, config);
    const data = await alipayClient(config).exec("alipay.trade.query", {
      bizContent: { out_trade_no: merchantOrderId(order.id) }
    }, { validateSign: true });
    if (data.code === "40004" && data.sub_code === "ACQ.TRADE_NOT_EXIST") {
      return null;
    }
    if (data.code !== "10000") {
      throw new BillingError("payment_provider_unavailable", 502);
    }
    if (data.out_trade_no !== merchantOrderId(order.id)) {
      throw new BillingError("payment_order_mismatch");
    }
    return data;
  }
  function normalizeAlipayQuery(data, order, config) {
    assertAlipayOrder(order, config);
    if (!data) return null;
    if (data.code !== "10000" || data.out_trade_no !== merchantOrderId(order.id) || data.trans_currency != null && data.trans_currency !== "CNY") throw new BillingError("payment_order_mismatch");
    if (decimalCents(data.total_amount) !== order.amount_cents) {
      throw new BillingError("payment_amount_mismatch");
    }
    if (!["TRADE_SUCCESS", "TRADE_FINISHED"].includes(String(data.trade_status))) return null;
    const transactionId = text(data.trade_no);
    return {
      event_id: `query:${transactionId}:payment`,
      kind: "payment",
      action_id: transactionId,
      order_id: order.id,
      occurred_at: alipayDate(data.send_pay_date),
      currency: "CNY",
      base_amount_cents: order.amount_cents,
      amount_cents: order.amount_cents
    };
  }
  function assertAlipayOrder(order, config) {
    if (order.provider !== "alipay" || order.environment !== config.environment || order.currency !== "CNY") {
      throw new BillingError("payment_order_mismatch");
    }
  }
  var init_alipay2 = __esm({
    "dashboard/edge-patches/cloud/alipay.ts"() {
      "use strict";
      init_esm2();
      init_contracts();
      init_wechat();
    }
  });

  // dashboard/edge-patches/tokentracker-billing.ts
  var tokentracker_billing_exports = {};
  __export(tokentracker_billing_exports, {
    default: () => billing
  });

  // node_modules/@waffo/pancake-ts/dist/index.js
  var import_crypto = __require("node:crypto");
  var import_crypto2 = __require("node:crypto");
  var WaffoPancakeError = class extends Error {
    status;
    errors;
    constructor(status, errors) {
      const rootCause = errors[0]?.message ?? "Unknown error";
      super(rootCause);
      this.name = "WaffoPancakeError";
      this.status = status;
      this.errors = errors;
    }
  };
  var DEFAULT_BASE_URL = "https://api.waffo.ai";
  var CustomerHttpClient = class {
    token;
    environment;
    baseUrl;
    _fetch;
    constructor(token, environment, config) {
      this.token = token;
      this.environment = environment;
      this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
      this._fetch = config.fetch ?? globalThis.fetch.bind(globalThis);
    }
    /**
     * Send a Bearer-authenticated POST and return the full envelope plus HTTP status.
     *
     * Sends `Authorization: Bearer <token>` and `X-Environment` — the gateway
     * requires both to accept a session token. `X-Idempotency-Key` is attached only
     * when the caller supplied `options.idempotencyKey`; no key is derived here.
     *
     * Does NOT throw on `errors[]` or non-2xx status — caller inspects the result.
     * Throws {@link WaffoPancakeError} only when the response body is not valid JSON.
     */
    async post(path2, body2, options) {
      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
        "X-Environment": this.environment
      };
      if (options?.idempotencyKey) {
        headers["X-Idempotency-Key"] = options.idempotencyKey;
      }
      const response = await this._fetch(`${this.baseUrl}${path2}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body2)
      });
      let envelope;
      try {
        envelope = await response.json();
      } catch {
        throw new WaffoPancakeError(response.status, [{ message: `Non-JSON response from ${path2}`, layer: "sdk" }]);
      }
      return { status: response.status, ...envelope };
    }
  };
  var PKCS8_HEADER = "-----BEGIN PRIVATE KEY-----";
  var PKCS8_FOOTER = "-----END PRIVATE KEY-----";
  var PKCS1_HEADER = "-----BEGIN RSA PRIVATE KEY-----";
  var PKCS1_FOOTER = "-----END RSA PRIVATE KEY-----";
  var SPKI_HEADER = "-----BEGIN PUBLIC KEY-----";
  var SPKI_FOOTER = "-----END PUBLIC KEY-----";
  var PKCS1_PUB_HEADER = "-----BEGIN RSA PUBLIC KEY-----";
  var PKCS1_PUB_FOOTER = "-----END RSA PUBLIC KEY-----";
  function normalizePrivateKey(raw) {
    if (!raw || !raw.trim()) {
      throw new Error("Private key is empty. Provide an RSA private key in PEM format.");
    }
    let pem = raw.replace(/\\n/g, "\n").replace(/\r\n/g, "\n");
    pem = pem.trim();
    const hasPkcs8Header = pem.includes(PKCS8_HEADER);
    const hasPkcs1Header = pem.includes(PKCS1_HEADER);
    const hasHeader = hasPkcs8Header || hasPkcs1Header;
    if (hasHeader) {
      const base64 = pem.replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----/g, "").replace(/-----END (?:RSA )?PRIVATE KEY-----/g, "").replace(/\s+/g, "");
      if (!base64) {
        throw new Error("Private key contains PEM headers but no key data. Check the key content.");
      }
      const header = hasPkcs1Header ? PKCS1_HEADER : PKCS8_HEADER;
      const footer = hasPkcs1Header ? PKCS1_FOOTER : PKCS8_FOOTER;
      const wrapped = base64.match(/.{1,64}/g).join("\n");
      pem = `${header}
${wrapped}
${footer}`;
    } else {
      const base64 = pem.replace(/\s+/g, "");
      if (!/^[A-Za-z0-9+/]+=*$/.test(base64)) {
        throw new Error("Private key is not valid PEM or base64. Expected an RSA private key in PEM format or raw base64.");
      }
      const wrapped = base64.match(/.{1,64}/g).join("\n");
      pem = `${PKCS8_HEADER}
${wrapped}
${PKCS8_FOOTER}`;
    }
    try {
      (0, import_crypto.createPrivateKey)(pem);
    } catch {
      throw new Error("Private key could not be parsed. Ensure it is a valid RSA private key in PKCS#8 or PKCS#1 (PEM) format.");
    }
    return pem;
  }
  function normalizePublicKey(raw) {
    if (!raw || !raw.trim()) {
      throw new Error("Public key is empty. Provide an RSA public key in PEM format.");
    }
    let pem = raw.replace(/\\n/g, "\n").replace(/\r\n/g, "\n");
    pem = pem.trim();
    const hasSpkiHeader = pem.includes(SPKI_HEADER);
    const hasPkcs1PubHeader = pem.includes(PKCS1_PUB_HEADER);
    const hasHeader = hasSpkiHeader || hasPkcs1PubHeader;
    if (hasHeader) {
      const base64 = pem.replace(/-----BEGIN (?:RSA )?PUBLIC KEY-----/g, "").replace(/-----END (?:RSA )?PUBLIC KEY-----/g, "").replace(/\s+/g, "");
      if (!base64) {
        throw new Error("Public key contains PEM headers but no key data. Check the key content.");
      }
      const header = hasPkcs1PubHeader ? PKCS1_PUB_HEADER : SPKI_HEADER;
      const footer = hasPkcs1PubHeader ? PKCS1_PUB_FOOTER : SPKI_FOOTER;
      const wrapped = base64.match(/.{1,64}/g).join("\n");
      pem = `${header}
${wrapped}
${footer}`;
    } else {
      const base64 = pem.replace(/\s+/g, "");
      if (!/^[A-Za-z0-9+/]+=*$/.test(base64)) {
        throw new Error("Public key is not valid PEM or base64. Expected an RSA public key in PEM format or raw base64.");
      }
      const wrapped = base64.match(/.{1,64}/g).join("\n");
      pem = `${SPKI_HEADER}
${wrapped}
${SPKI_FOOTER}`;
    }
    try {
      (0, import_crypto.createPublicKey)(pem);
    } catch {
      throw new Error("Public key could not be parsed. Ensure it is a valid RSA public key in SPKI or PKCS#1 (PEM) format.");
    }
    return pem;
  }
  function signRequest(method, path2, timestamp, body2, privateKey) {
    const bodyHash = (0, import_crypto.createHash)("sha256").update(body2).digest("base64");
    const canonicalRequest = `${method}
${path2}
${timestamp}
${bodyHash}`;
    const sign2 = (0, import_crypto.createSign)("sha256");
    sign2.update(canonicalRequest);
    return sign2.sign(privateKey, "base64");
  }
  var DEFAULT_BASE_URL2 = "https://api.waffo.ai";
  var HttpClient = class {
    merchantId;
    privateKey;
    baseUrl;
    _fetch;
    constructor(config) {
      this.merchantId = config.merchantId;
      this.privateKey = normalizePrivateKey(config.privateKey);
      this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL2).replace(/\/+$/, "");
      this._fetch = config.fetch ?? globalThis.fetch.bind(globalThis);
    }
    /**
     * Send a signed POST and return the full envelope plus HTTP status.
     *
     * Behavior:
     * - Builds RSA-SHA256 signature (`X-Merchant-Id` / `X-Timestamp` / `X-Signature`)
     * - Attaches `X-Idempotency-Key` **only** when the caller supplied
     *   `options.idempotencyKey`. No key is derived here and none is sent otherwise,
     *   so a request without one is not covered by the gateway's 24h dedup cache
     * - Does NOT throw on `errors[]` or non-2xx status — caller inspects the result
     * - Throws {@link WaffoPancakeError} only on transport failures (non-JSON body)
     *
     * @param path - API path (e.g. `/v1/actions/store/create-store`, `/v1/graphql`)
     * @param body - Request body object
     * @param options - Optional settings
     * @returns Parsed envelope with HTTP status
     * @throws {WaffoPancakeError} When the response body is not valid JSON
     */
    async post(path2, body2, options) {
      const bodyStr = JSON.stringify(body2);
      const timestamp = Math.floor(Date.now() / 1e3).toString();
      const signature = signRequest("POST", path2, timestamp, bodyStr, this.privateKey);
      const headers = {
        "Content-Type": "application/json",
        "X-Merchant-Id": this.merchantId,
        "X-Timestamp": timestamp,
        "X-Signature": signature
      };
      if (options?.idempotencyKey) {
        headers["X-Idempotency-Key"] = options.idempotencyKey;
      }
      const response = await this._fetch(`${this.baseUrl}${path2}`, {
        method: "POST",
        headers,
        body: bodyStr
      });
      let envelope;
      try {
        envelope = await response.json();
      } catch {
        throw new WaffoPancakeError(response.status, [{ message: `Non-JSON response from ${path2}`, layer: "sdk" }]);
      }
      return { status: response.status, ...envelope };
    }
  };
  function unwrapAction(r) {
    if (r.errors?.length) {
      throw new WaffoPancakeError(r.status, r.errors);
    }
    return { ...r.data, ...r.warnings ? { warnings: r.warnings } : {} };
  }
  var SHORT_ID_REGEX = /^[A-Z]{2,5}_[0-9A-Za-z]{22}$/;
  var CURRENCY_CODE_REGEX = /^[A-Z]{3}$/;
  var COUNTRY_CODE_REGEX = /^[A-Z]{2}$/;
  var AMOUNT_STRING_REGEX = /^\d+(\.\d+)?$/;
  var SHORT_ID_LABELS = {
    STO: "Store",
    PROD: "Product",
    ORD: "Order",
    PAY: "Payment",
    REF: "Refund",
    TKT: "Ticket",
    MER: "Merchant"
  };
  function fail(message) {
    throw new WaffoPancakeError(400, [{ message, layer: "sdk" }]);
  }
  function validateRequired(field, value) {
    if (value === void 0 || value === null) {
      fail(`Missing required field: ${field}`);
    }
    if (typeof value === "string" && value.trim() === "") {
      fail(`${field} cannot be empty`);
    }
  }
  function validateShortId(field, value, prefix) {
    validateRequired(field, value);
    const label = SHORT_ID_LABELS[prefix] ?? prefix;
    if (!SHORT_ID_REGEX.test(value)) {
      fail(`Invalid ${field}: expected ${label} Short ID format (${prefix}_xxx), got "${value}"`);
    }
    if (!value.startsWith(`${prefix}_`)) {
      fail(`Invalid ${field}: expected ${prefix}_ prefix (${label}), got "${value.split("_")[0]}_"`);
    }
  }
  function validateCurrencyCode(field, value) {
    validateRequired(field, value);
    if (!CURRENCY_CODE_REGEX.test(value)) {
      fail(`Invalid ${field}: expected 3-letter ISO 4217 currency code (e.g., "USD"), got "${value}"`);
    }
  }
  function validateAmountString(field, value) {
    validateRequired(field, value);
    if (!AMOUNT_STRING_REGEX.test(value)) {
      fail(`Invalid ${field}: expected numeric string in display format (e.g., "9.99", "1000"), got "${value}"`);
    }
  }
  function validateEnum(field, value, allowed) {
    validateRequired(field, value);
    if (!allowed.includes(value)) {
      fail(`Invalid ${field}: expected one of [${allowed.join(", ")}], got "${value}"`);
    }
  }
  function validateMaxLength(field, value, max) {
    if (value !== void 0 && value.length > max) {
      fail(`${field} must be at most ${max} characters, got ${value.length}`);
    }
  }
  function validatePositiveInteger(field, value) {
    if (!Number.isInteger(value) || value <= 0) {
      fail(`Invalid ${field}: expected positive integer, got ${value}`);
    }
  }
  function validateCountryCode(field, value) {
    validateRequired(field, value);
    if (!COUNTRY_CODE_REGEX.test(value)) {
      fail(`Invalid ${field}: expected 2-letter ISO 3166-1 country code (e.g., "US"), got "${value}"`);
    }
  }
  function validatePrices(field, prices) {
    validateRequired(field, prices);
    const entries = Object.entries(prices);
    if (entries.length === 0) {
      fail(`${field} must contain at least one currency`);
    }
    for (const [currency, info] of entries) {
      validateCurrencyCode(`${field}.${currency} (key)`, currency);
      validateAmountString(`${field}.${currency}.amount`, info.amount);
      validateRequired(`${field}.${currency}.taxCategory`, info.taxCategory);
    }
  }
  function validateBillingDetail(detail) {
    validateCountryCode("billingDetail.country", detail.country);
    if (typeof detail.isBusiness !== "boolean") {
      fail(`Invalid billingDetail.isBusiness: expected boolean, got ${typeof detail.isBusiness}`);
    }
  }
  function validateCheckoutCommon(params) {
    validateShortId("productId", params.productId, "PROD");
    validateCurrencyCode("currency", params.currency);
    if (params.priceSnapshot) {
      validateAmountString("priceSnapshot.amount", params.priceSnapshot.amount);
      validateRequired("priceSnapshot.taxCategory", params.priceSnapshot.taxCategory);
    }
    if (params.billingDetail) {
      validateBillingDetail(params.billingDetail);
    }
    if (params.expiresInSeconds !== void 0) {
      validatePositiveInteger("expiresInSeconds", params.expiresInSeconds);
    }
    validateMaxLength("orderMerchantExternalId", params.orderMerchantExternalId, 128);
  }
  function validatePlanChangeCommon(params) {
    validateCheckoutCommon(params);
    validateShortId("originOrderId", params.originOrderId, "ORD");
    if (params.changeAmount !== void 0) {
      validateAmountString("changeAmount", params.changeAmount);
    }
    if (params.changeCreditAmount !== void 0) {
      validateAmountString("changeCreditAmount", params.changeCreditAmount);
    }
  }
  var AuthResource = class {
    constructor(http) {
      this.http = http;
    }
    /**
     * Issue a session token for a customer.
     *
     * @param params - Token issuance parameters
     * @returns Issued session token with expiration
     *
     * @example
     * // By store ID
     * const { token, expiresAt } = await client.auth.issueSessionToken({
     *   storeId: "STO_xxx",
     *   buyerIdentity: "customer@example.com",
     * });
     *
     * @example
     * // By product ID (store derived automatically)
     * const { token, expiresAt } = await client.auth.issueSessionToken({
     *   productId: "PROD_xxx",
     *   buyerIdentity: "customer@example.com",
     * });
     */
    async issueSessionToken(params, options) {
      if (!params.storeId && !params.productId) {
        throw new WaffoPancakeError(400, [{ message: "Missing required field: provide storeId or productId", layer: "sdk" }]);
      }
      if (params.storeId) {
        validateShortId("storeId", params.storeId, "STO");
      }
      if (params.productId) {
        validateShortId("productId", params.productId, "PROD");
      }
      validateRequired("buyerIdentity", params.buyerIdentity);
      return unwrapAction(await this.http.post("/v1/actions/auth/issue-session-token", params, options));
    }
  };
  var CheckoutAnonymousResource = class {
    constructor(http) {
      this.http = http;
    }
    /**
     * Create an anonymous checkout session.
     *
     * @param params - Checkout parameters (no customer identity required)
     * @returns Session ID, checkout URL, and expiration
     *
     * @example
     * // Minimal — customer fills everything on the page
     * const result = await client.checkout.anonymous.create({
     *   productId: "PROD_xxx",
     *   currency: "USD",
     * });
     *
     * @example
     * // Pre-fill email + billing + attach business-side order reference
     * const result = await client.checkout.anonymous.create({
     *   productId: "PROD_xxx",
     *   currency: "USD",
     *   buyerEmail: "customer@example.com",
     *   billingDetail: { country: "US", isBusiness: false, postcode: "10001" },
     *   orderMerchantExternalId: "ORDER-2026-00891",
     * });
     */
    async create(params, options) {
      validateCheckoutCommon(params);
      return unwrapAction(await this.http.post("/v1/actions/checkout/create-session", params, options));
    }
  };
  var CheckoutAuthenticatedResource = class {
    constructor(http) {
      this.http = http;
    }
    /**
     * Create an authenticated checkout session.
     *
     * Behavior:
     * - Issues a session token via `issue-session-token` (receives `buyerIdentity` + `productId` only)
     * - Creates a checkout session via `create-session` (receives every other field unchanged)
     * - Appends the token to the checkout URL as a URL fragment (`#token=...`)
     * - An `idempotencyKey` you pass applies to the `create-session` call only. One key
     *   cannot address two endpoints, and re-issuing a token is harmless, so the token
     *   call is always sent without one
     *
     * `buyerIdentity` and `buyerEmail` are independent inputs: identity is for the JWT,
     * email is for pre-filling the checkout page. The SDK forwards each to its own endpoint.
     *
     * @param params - Checkout parameters including customer identity
     * @returns Session details with token-appended checkout URL
     *
     * @example
     * const result = await client.checkout.authenticated.create({
     *   productId: "PROD_xxx",
     *   currency: "USD",
     *   buyerIdentity: "user-123",
     *   buyerEmail: "customer@example.com",
     *   orderMerchantExternalId: "ORDER-2026-00891",
     * });
     * // Redirect to result.checkoutUrl (includes #token=...)
     */
    async create(params, options) {
      validateCheckoutCommon(params);
      validateRequired("buyerIdentity", params.buyerIdentity);
      const { buyerIdentity, ...sessionParams } = params;
      const [tokenResult, sessionResult] = await Promise.all([
        this.http.post("/v1/actions/auth/issue-session-token", {
          productId: params.productId,
          buyerIdentity
        }),
        this.http.post("/v1/actions/checkout/create-session", sessionParams, options)
      ]);
      const token = unwrapAction(tokenResult);
      const session = unwrapAction(sessionResult);
      const warnings = [...token.warnings ?? [], ...session.warnings ?? []];
      return {
        sessionId: session.sessionId,
        checkoutUrl: `${session.checkoutUrl}#token=${token.token}`,
        expiresAt: session.expiresAt,
        token: token.token,
        tokenExpiresAt: token.expiresAt,
        ...warnings.length > 0 ? { warnings } : {}
      };
    }
    /**
     * Create an authenticated plan-change link for an existing subscription.
     *
     * Behavior:
     * - Same two-call split as `create()`: `buyerIdentity` goes to
     *   `issue-session-token`, everything else to `create-session`
     * - `originOrderId` puts the session into plan change mode, so the returned URL
     *   is the change confirmation page (`…/store/{slug}/change/{sessionId}`) with
     *   the token appended as a URL fragment (`#token=...`)
     * - The request is signed with the merchant API Key, so `changeAmount`,
     *   `changeCreditAmount` and `withTrial` are honored here; a customer credential
     *   calling the endpoint directly would have them silently dropped
     * - `changeAmount` and `changeCreditAmount` are mutually exclusive — the platform
     *   rejects both-at-once with a 400
     * - An `idempotencyKey` you pass applies to the `create-session` call only, for the
     *   same reason as in `create()`
     *
     * @param params - Plan change parameters including customer identity
     * @returns Session details with token-appended confirmation URL
     *
     * @example
     * const result = await client.checkout.authenticated.createPlanChange({
     *   originOrderId: "ORD_xxx",
     *   productId: "PROD_target_plan",
     *   currency: "USD",
     *   buyerIdentity: "user-123",
     *   changeTiming: ChangeTiming.NextPeriod,
     * });
     * // Redirect to result.checkoutUrl (includes #token=...)
     */
    async createPlanChange(params, options) {
      validatePlanChangeCommon(params);
      validateRequired("buyerIdentity", params.buyerIdentity);
      const { buyerIdentity, ...sessionParams } = params;
      const [tokenResult, sessionResult] = await Promise.all([
        this.http.post("/v1/actions/auth/issue-session-token", {
          productId: params.productId,
          buyerIdentity
        }),
        this.http.post("/v1/actions/checkout/create-session", sessionParams, options)
      ]);
      const token = unwrapAction(tokenResult);
      const session = unwrapAction(sessionResult);
      const warnings = [...token.warnings ?? [], ...session.warnings ?? []];
      return {
        sessionId: session.sessionId,
        checkoutUrl: `${session.checkoutUrl}#token=${token.token}`,
        expiresAt: session.expiresAt,
        token: token.token,
        tokenExpiresAt: token.expiresAt,
        ...warnings.length > 0 ? { warnings } : {}
      };
    }
  };
  var CheckoutResource = class {
    constructor(http) {
      this.http = http;
      this.anonymous = new CheckoutAnonymousResource(http);
      this.authenticated = new CheckoutAuthenticatedResource(http);
    }
    /** Anonymous checkout — no customer identity, empty form. */
    anonymous;
    /** Authenticated checkout — merchant provides customer identity. */
    authenticated;
    /**
     * Create a checkout session (low-level). Returns a URL to redirect the customer to.
     *
     * For most use cases, prefer `checkout.anonymous.create()` or
     * `checkout.authenticated.create()` which handle the full flow automatically.
     *
     * @param params - Checkout session parameters
     * @returns Session ID, checkout URL, and expiration
     *
     * @example
     * const session = await client.checkout.createSession({
     *   productId: "PROD_xxx",
     *   currency: "USD",
     *   buyerEmail: "customer@example.com",
     * });
     * // Redirect to session.checkoutUrl
     */
    async createSession(params, options) {
      return unwrapAction(await this.http.post("/v1/actions/checkout/create-session", params, options));
    }
    /**
     * Create a plan-change session for an existing subscription. Returns a URL to
     * send the customer to, where they confirm the change.
     *
     * Behavior:
     * - Hits the same `create-session` endpoint as `createSession()`; `originOrderId`
     *   is what puts the request into plan change mode
     * - Pass `{ idempotencyKey }` to have a retry return the first session instead of
     *   issuing a second one; without a key nothing is deduplicated
     * - The returned `checkoutUrl` points at the change confirmation page
     *   (`…/store/{slug}/change/{sessionId}`), not the new-purchase cashier
     * - `changeAmount`, `changeCreditAmount` and `withTrial` are merchant-credential
     *   only; the platform silently drops them for any other credential
     * - `changeAmount` and `changeCreditAmount` are mutually exclusive, and the
     *   platform rejects both-at-once with a 400 — the SDK forwards what you pass
     * - Issued with your API Key, so the platform checks only that the subscription is
     *   yours: any target plan is allowed, in the group or not. For the customer-driven
     *   half (same group + `selfServicePlanChange` on), see
     *   `client.customer(token).createPlanChangeSession()`
     *
     * @param params - Plan change parameters; `originOrderId` identifies the subscription
     * @returns Session ID, confirmation page URL, and expiration
     *
     * @example
     * const session = await client.checkout.createPlanChangeSession({
     *   originOrderId: "ORD_xxx",
     *   productId: "PROD_target_plan",
     *   currency: "USD",
     *   changeTiming: ChangeTiming.Immediate,
     *   changeCreditAmount: "8.00", // or changeAmount — never both
     * });
     * // Send the customer to session.checkoutUrl
     */
    async createPlanChangeSession(params, options) {
      validatePlanChangeCommon(params);
      return unwrapAction(await this.http.post("/v1/actions/checkout/create-session", params, options));
    }
  };
  var ContentSafetyResource = class {
    constructor(http) {
      this.http = http;
    }
    /**
     * Scan a user's text prompt for content-safety compliance before AIGC
     * generation. Call this before invoking your image/video model and continue
     * only when `action` is `allow`.
     *
     * Stateless — the check never stores prompt text. If the safety service is
     * briefly unavailable, the verdict fails closed to `review` so an
     * unmoderated prompt is never let through.
     *
     * @param params - Scan parameters (prompt required; locale / semantic optional)
     * @returns Redacted scan verdict
     *
     * @example
     * const verdict = await client.contentSafety.scanPrompt({ prompt: "a cat riding a bike" });
     * if (verdict.action !== "allow") {
     *   // do not generate
     * }
     */
    async scanPrompt(params, options) {
      validateRequired("prompt", params.prompt);
      return unwrapAction(await this.http.post("/v1/actions/verification/scan-prompt", params, options));
    }
  };
  var CustomerSession = class {
    constructor(http) {
      this.http = http;
      this.graphql = new CustomerGraphQL(http);
    }
    /** GraphQL query access scoped to the customer's data. */
    graphql;
    /**
     * Cancel a subscription order.
     *
     * @param params - Order to cancel
     * @returns Order ID and resulting status
     *
     * @example
     * const { orderId, status } = await customer.cancelSubscription({ orderId: "ORD_xxx" });
     * // status: "canceled" (was pending)
     * //      or "canceling" (was active — stops at the end of the current period)
     * //      or "canceling" (was past_due — stops immediately)
     */
    async cancelSubscription(params, options) {
      validateShortId("orderId", params.orderId, "ORD");
      return unwrapAction(await this.http.post("/v1/actions/subscription-order/cancel-order", params, options));
    }
    /**
     * Cancel a one-time order (only while payment is still pending).
     *
     * @param params - Order to cancel
     * @returns Order ID and resulting status
     *
     * @example
     * const { orderId, status } = await customer.cancelOnetimeOrder({ orderId: "ORD_xxx" });
     */
    async cancelOnetimeOrder(params, options) {
      validateShortId("orderId", params.orderId, "ORD");
      return unwrapAction(await this.http.post("/v1/actions/onetime-order/cancel-order", params, options));
    }
    /**
     * Reactivate a subscription that is in `canceling` status.
     *
     * A subscription that had an unpaid charge at the moment cancellation was
     * requested is refused with 400 (`Subscription with an unpaid balance cannot
     * be reactivated`), which is worded differently from the 400 returned when
     * the order is not in `canceling` status. Cancelling a `past_due`
     * subscription always falls into the former category.
     *
     * @param params - Order to reactivate
     * @returns Order ID and resulting status
     *
     * @example
     * const { orderId, status } = await customer.reactivateSubscription({ orderId: "ORD_xxx" });
     * // status: "active"
     */
    async reactivateSubscription(params, options) {
      validateShortId("orderId", params.orderId, "ORD");
      return unwrapAction(
        await this.http.post("/v1/actions/subscription-order/reactivate-order", params, options)
      );
    }
    /**
     * Submit a refund request for a payment.
     *
     * @param params - Refund ticket details
     * @returns Created refund ticket
     *
     * @example
     * const { ticket } = await customer.createRefundTicket({
     *   paymentId: "PAY_xxx",
     *   reason: "Product not as described",
     *   requestedAmount: { amount: "29.00", currency: "USD" },
     *   refundTicketMerchantExternalId: "REF-2026-00891",
     * });
     */
    async createRefundTicket(params, options) {
      validateShortId("paymentId", params.paymentId, "PAY");
      validateRequired("reason", params.reason);
      validateAmountString("requestedAmount.amount", params.requestedAmount.amount);
      validateCurrencyCode("requestedAmount.currency", params.requestedAmount.currency);
      validateMaxLength("refundTicketMerchantExternalId", params.refundTicketMerchantExternalId, 128);
      return unwrapAction(await this.http.post("/v1/actions/refund-ticket/create-ticket", params, options));
    }
    /**
     * Resubmit a previously rejected refund ticket with updated details.
     *
     * @param params - Updated ticket details
     * @returns Updated refund ticket
     *
     * @example
     * const { ticket } = await customer.resubmitRefundTicket({
     *   ticketId: "TKT_xxx",
     *   paymentId: "PAY_xxx",
     *   reason: "Updated reason with more detail",
     *   requestedAmount: { amount: "29.00", currency: "USD" },
     * });
     */
    async resubmitRefundTicket(params, options) {
      validateShortId("ticketId", params.ticketId, "TKT");
      validateShortId("paymentId", params.paymentId, "PAY");
      validateRequired("reason", params.reason);
      validateAmountString("requestedAmount.amount", params.requestedAmount.amount);
      validateCurrencyCode("requestedAmount.currency", params.requestedAmount.currency);
      return unwrapAction(await this.http.post("/v1/actions/refund-ticket/resubmit-ticket", params, options));
    }
    /**
     * Create a plan-change session for one of the customer's own subscriptions —
     * the self-service half of a plan change. Returns a URL to send them to, where
     * they confirm the change.
     *
     * The platform applies three checks to a customer-issued link that it does not
     * apply to a merchant-issued one, each with its own 403:
     * - **Ownership** — the subscription must belong to this session's customer
     *   (its `buyerIdentity` and store must match the token), else
     *   `Subscription order does not belong to this credential`
     * - **Same group** — the target plan must sit in the same product group as the
     *   current plan, else `Target plan is not in the same product group as the current plan`
     * - **Switch on** — that group's `selfServicePlanChange` rule must be on, else
     *   `Self-service plan change is not enabled for this product group`.
     *   Open it with `client.subscriptionProductGroups.update()`
     *
     * A merchant issuing the link with the API Key
     * (`client.checkout.createPlanChangeSession()`) is subject to none of the three
     * and may switch a subscription to any plan, group or not.
     *
     * The API-Key-only fields are absent from the params by construction — the
     * platform would drop them here without saying so. As everywhere else, this call
     * is deduplicated only if you pass an `idempotencyKey`; without one a retry after
     * a timeout issues a second session.
     *
     * @param params - Plan change parameters; `originOrderId` identifies the subscription
     * @returns Session ID, confirmation page URL, and expiration
     *
     * @example
     * const session = await customer.createPlanChangeSession({
     *   originOrderId: "ORD_xxx",
     *   productId: "PROD_target_plan",
     *   currency: "USD",
     * });
     * // Send the customer to session.checkoutUrl
     */
    async createPlanChangeSession(params, options) {
      validateShortId("originOrderId", params.originOrderId, "ORD");
      validateShortId("productId", params.productId, "PROD");
      validateCurrencyCode("currency", params.currency);
      return unwrapAction(await this.http.post("/v1/actions/checkout/create-session", params, options));
    }
  };
  var CustomerGraphQL = class {
    constructor(http) {
      this.http = http;
    }
    /**
     * Execute a GraphQL query scoped to the customer's data.
     *
     * @param params - GraphQL query and variables
     * @returns GraphQL response
     *
     * @example
     * const result = await customer.graphql.query({
     *   query: `query { orders { id status } }`,
     * });
     */
    async query(params) {
      validateRequired("query", params.query);
      const result = await this.http.post("/v1/graphql", params);
      return { data: result.data, errors: result.errors, warnings: result.warnings };
    }
  };
  var GraphQLResource = class {
    constructor(http) {
      this.http = http;
    }
    /**
     * Execute a GraphQL query (Query only, no Mutations).
     *
     * @param params - GraphQL query and optional variables
     * @returns GraphQL response with data and optional errors
     *
     * @example
     * const result = await client.graphql.query<{ stores: Array<{ id: string; name: string }> }>({
     *   query: `query { stores { id name status } }`,
     * });
     * console.log(result.data?.stores);
     *
     * @example
     * const result = await client.graphql.query({
     *   query: `query ($id: ID!) { onetimeProduct(id: $id) { id name prices } }`,
     *   variables: { id: "PROD_xxx" },
     * });
     */
    async query(params) {
      validateRequired("query", params.query);
      const result = await this.http.post("/v1/graphql", params);
      return { data: result.data, errors: result.errors, warnings: result.warnings };
    }
  };
  var OnetimeProductsResource = class {
    constructor(http) {
      this.http = http;
    }
    /**
     * Create a one-time product with multi-currency pricing.
     *
     * @param params - Product creation parameters
     * @returns Created product detail
     *
     * @example
     * const { product } = await client.onetimeProducts.create({
     *   storeId: "STO_xxx",
     *   name: "E-Book",
     *   prices: { USD: { amount: "29.00", taxCategory: "digital_goods" } },
     * });
     */
    async create(params, options) {
      validateShortId("storeId", params.storeId, "STO");
      validateRequired("name", params.name);
      validatePrices("prices", params.prices);
      return unwrapAction(
        await this.http.post("/v1/actions/onetime-product/create-product", params, options)
      );
    }
    /**
     * Update a one-time product. Creates a new version; skips if unchanged.
     *
     * @param params - Product update parameters (only `id` is required)
     * @returns Updated product detail
     *
     * @example
     * // Update only the name
     * const { product } = await client.onetimeProducts.update({
     *   id: "PROD_xxx",
     *   name: "E-Book v2",
     * });
     *
     * @example
     * // Update prices while preserving other fields
     * const { product } = await client.onetimeProducts.update({
     *   id: "PROD_xxx",
     *   prices: { USD: { amount: "39.00", taxCategory: "digital_goods" } },
     * });
     */
    async update(params, options) {
      validateShortId("id", params.id, "PROD");
      if (params.name !== void 0) validateRequired("name", params.name);
      if (params.prices) validatePrices("prices", params.prices);
      return unwrapAction(
        await this.http.post("/v1/actions/onetime-product/update-product", params, options)
      );
    }
    /**
     * Publish a one-time product's test version to production.
     *
     * @param params - Product to publish
     * @returns Published product detail
     *
     * @example
     * const { product } = await client.onetimeProducts.publish({ id: "PROD_xxx" });
     */
    async publish(params, options) {
      validateShortId("id", params.id, "PROD");
      return unwrapAction(
        await this.http.post("/v1/actions/onetime-product/publish-product", params, options)
      );
    }
    /**
     * Update a one-time product's status (active/inactive).
     *
     * @param params - Status update parameters
     * @returns Updated product detail
     *
     * @example
     * const { product } = await client.onetimeProducts.updateStatus({
     *   id: "PROD_xxx",
     *   status: ProductVersionStatus.Inactive,
     * });
     */
    async updateStatus(params, options) {
      validateShortId("id", params.id, "PROD");
      validateEnum("status", params.status, ["active", "inactive"]);
      return unwrapAction(
        await this.http.post("/v1/actions/onetime-product/update-status", params, options)
      );
    }
  };
  var OrdersResource = class {
    constructor(http) {
      this.http = http;
    }
    /**
     * Cancel a subscription order.
     *
     * - pending -> canceled (immediate, no PSP call)
     * - active/trialing -> canceling (PSP cancel scheduled for the end of the
     *   current billing period; the subscription stays usable until then)
     * - past_due -> canceling (PSP cancel dispatched immediately; the billing
     *   period has already lapsed, so nothing is left to use)
     *
     * In both canceling cases the terminal `canceled` status is written when the
     * PSP cancellation webhook arrives, not by this call.
     *
     * @param params - Order to cancel
     * @returns Order ID and resulting status
     *
     * @example
     * const { orderId, status } = await client.orders.cancelSubscription({
     *   orderId: "ORD_xxx",
     * });
     * // status: "canceled" or "canceling"
     */
    async cancelSubscription(params, options) {
      validateShortId("orderId", params.orderId, "ORD");
      return unwrapAction(await this.http.post("/v1/actions/subscription-order/cancel-order", params, options));
    }
  };
  var StoreMerchantsResource = class {
    constructor(http) {
      this.http = http;
    }
    /**
     * Add a merchant to a store.
     *
     * @param params - Merchant addition parameters
     * @returns Added merchant details
     *
     * @example
     * const result = await client.storeMerchants.add({
     *   storeId: "STO_xxx",
     *   email: "member@example.com",
     *   role: "admin",
     * });
     */
    async add(params, options) {
      validateShortId("storeId", params.storeId, "STO");
      validateRequired("email", params.email);
      validateEnum("role", params.role, ["admin", "member"]);
      return unwrapAction(await this.http.post("/v1/actions/store-merchant/add-merchant", params, options));
    }
    /**
     * Remove a merchant from a store.
     *
     * @param params - Merchant removal parameters
     * @returns Removal confirmation
     *
     * @example
     * const result = await client.storeMerchants.remove({
     *   storeId: "STO_xxx",
     *   merchantId: "MER_xxx",
     * });
     */
    async remove(params, options) {
      validateShortId("storeId", params.storeId, "STO");
      validateShortId("merchantId", params.merchantId, "MER");
      return unwrapAction(await this.http.post("/v1/actions/store-merchant/remove-merchant", params, options));
    }
    /**
     * Update a merchant's role in a store.
     *
     * @param params - Role update parameters
     * @returns Updated role details
     *
     * @example
     * const result = await client.storeMerchants.updateRole({
     *   storeId: "STO_xxx",
     *   merchantId: "MER_xxx",
     *   role: "member",
     * });
     */
    async updateRole(params, options) {
      validateShortId("storeId", params.storeId, "STO");
      validateShortId("merchantId", params.merchantId, "MER");
      validateEnum("role", params.role, ["admin", "member"]);
      return unwrapAction(await this.http.post("/v1/actions/store-merchant/update-role", params, options));
    }
  };
  var StoresResource = class {
    constructor(http) {
      this.http = http;
    }
    /**
     * Create a new store. Slug is auto-generated from the name.
     *
     * @param params - Store creation parameters
     * @returns Created store entity
     *
     * @example
     * const { store } = await client.stores.create({ name: "My Store" });
     */
    async create(params, options) {
      validateRequired("name", params.name);
      return unwrapAction(await this.http.post("/v1/actions/store/create-store", params, options));
    }
    /**
     * Update an existing store's settings.
     *
     * Settings objects (`notificationSettings`, `checkoutSettings`) support
     * partial updates: omitted sub-fields keep existing values, `null` clears a
     * field. Pass the entire settings object as `null` to clear all fields.
     *
     * `notificationSettings` accepts the merchant-writable keys only — every
     * `notify*` toggle plus the two customer reminders `emailUpcomingCharge` and
     * `emailTrialEnding`. Other `email*` keys are dropped and named in `warnings`.
     * Passing `notificationSettings: null` clears the writable keys back to their
     * default of on, so send a partial update to keep a reminder switched off.
     *
     * **BREAKING (2026-05)**: the legacy `webhookSettings` parameter is removed.
     * Use `client.webhooks.add / update / remove` to manage webhook endpoints,
     * and query the configured webhook list via GraphQL `Store.storeWebhooks`.
     *
     * @param params - Fields to update (only provided fields are changed)
     * @returns Updated store entity
     *
     * @example
     * // Update name
     * const { store } = await client.stores.update({
     *   id: "STO_xxx",
     *   name: "Updated Name",
     * });
     *
     * @example
     * // Toggle a notification preference
     * const { store } = await client.stores.update({
     *   id: "STO_xxx",
     *   notificationSettings: { notifyNewOrders: false },
     * });
     *
     * @example
     * // Stop reminding this store's buyers that their trial is about to end
     * const { store } = await client.stores.update({
     *   id: "STO_xxx",
     *   notificationSettings: { emailTrialEnding: false },
     * });
     */
    async update(params, options) {
      validateShortId("id", params.id, "STO");
      return unwrapAction(await this.http.post("/v1/actions/store/update-store", params, options));
    }
    /**
     * Soft-delete a store. Only the owner can delete.
     *
     * @param params - Store to delete
     * @returns Deleted store entity (with `deletedAt` set)
     *
     * @example
     * const { store } = await client.stores.delete({ id: "STO_xxx" });
     */
    async delete(params, options) {
      validateShortId("id", params.id, "STO");
      return unwrapAction(await this.http.post("/v1/actions/store/delete-store", params, options));
    }
  };
  var SubscriptionProductGroupsResource = class {
    constructor(http) {
      this.http = http;
    }
    /**
     * Create a subscription product group for shared-trial or plan switching.
     *
     * Both `rules` switches are optional; one left out is created off.
     * `selfServicePlanChange` is what lets customers switch plans within the group
     * from the customer portal — without it their plan-change links are rejected.
     *
     * @param params - Group creation parameters
     * @returns Created group entity
     *
     * @example
     * const { group } = await client.subscriptionProductGroups.create({
     *   storeId: "STO_xxx",
     *   name: "Pro Plans",
     *   rules: { sharedTrial: true, selfServicePlanChange: true },
     *   productIds: ["PROD_aaa", "PROD_bbb"],
     * });
     */
    async create(params, options) {
      validateShortId("storeId", params.storeId, "STO");
      validateRequired("name", params.name);
      return unwrapAction(
        await this.http.post("/v1/actions/subscription-product-group/create-group", params, options)
      );
    }
    /**
     * Update a subscription product group. `productIds` is a full replacement;
     * `rules` is merged switch by switch, so sending one switch leaves the other
     * at its stored value. The returned entity always carries both switches.
     *
     * @param params - Group update parameters
     * @returns Updated group entity
     *
     * @example
     * const { group } = await client.subscriptionProductGroups.update({
     *   id: "GRP_xxx",
     *   productIds: ["PROD_aaa", "PROD_bbb", "PROD_ccc"],
     * });
     *
     * @example
     * // Open self-service plan change; sharedTrial keeps whatever it was
     * const { group } = await client.subscriptionProductGroups.update({
     *   id: "GRP_xxx",
     *   rules: { selfServicePlanChange: true },
     * });
     */
    async update(params, options) {
      validateRequired("id", params.id);
      return unwrapAction(
        await this.http.post("/v1/actions/subscription-product-group/update-group", params, options)
      );
    }
    /**
     * Hard-delete a subscription product group.
     *
     * @param params - Group to delete
     * @returns Deleted group entity
     *
     * @example
     * const { group } = await client.subscriptionProductGroups.delete({ id: "GRP_xxx" });
     */
    async delete(params, options) {
      validateRequired("id", params.id);
      return unwrapAction(
        await this.http.post("/v1/actions/subscription-product-group/delete-group", params, options)
      );
    }
    /**
     * Publish a test-environment group to production (upsert).
     *
     * @param params - Group to publish
     * @returns Published group entity
     *
     * @example
     * const { group } = await client.subscriptionProductGroups.publish({ id: "GRP_xxx" });
     */
    async publish(params, options) {
      validateRequired("id", params.id);
      return unwrapAction(
        await this.http.post("/v1/actions/subscription-product-group/publish-group", params, options)
      );
    }
  };
  var SubscriptionProductsResource = class {
    constructor(http) {
      this.http = http;
    }
    /**
     * Create a subscription product with billing period and multi-currency pricing.
     *
     * @param params - Product creation parameters
     * @returns Created product detail
     *
     * @example
     * const { product } = await client.subscriptionProducts.create({
     *   storeId: "STO_xxx",
     *   name: "Pro Plan",
     *   billingPeriod: "monthly",
     *   prices: { USD: { amount: "9.99", taxCategory: "saas" } },
     * });
     */
    async create(params, options) {
      validateShortId("storeId", params.storeId, "STO");
      validateRequired("name", params.name);
      validateEnum("billingPeriod", params.billingPeriod, ["weekly", "monthly", "quarterly", "yearly"]);
      validatePrices("prices", params.prices);
      return unwrapAction(
        await this.http.post("/v1/actions/subscription-product/create-product", params, options)
      );
    }
    /**
     * Update a subscription product. Creates a new version; skips if unchanged.
     *
     * @param params - Product update parameters (only `id` is required)
     * @returns Updated product detail
     *
     * @example
     * // Update only the name
     * const { product } = await client.subscriptionProducts.update({
     *   id: "PROD_xxx",
     *   name: "Pro Plan v2",
     * });
     *
     * @example
     * // Update prices and billing period
     * const { product } = await client.subscriptionProducts.update({
     *   id: "PROD_xxx",
     *   billingPeriod: "yearly",
     *   prices: { USD: { amount: "99.00", taxCategory: "saas" } },
     * });
     */
    async update(params, options) {
      validateShortId("id", params.id, "PROD");
      if (params.name !== void 0) validateRequired("name", params.name);
      if (params.billingPeriod !== void 0)
        validateEnum("billingPeriod", params.billingPeriod, ["weekly", "monthly", "quarterly", "yearly"]);
      if (params.prices) validatePrices("prices", params.prices);
      return unwrapAction(
        await this.http.post("/v1/actions/subscription-product/update-product", params, options)
      );
    }
    /**
     * Publish a subscription product's test version to production.
     *
     * @param params - Product to publish
     * @returns Published product detail
     *
     * @example
     * const { product } = await client.subscriptionProducts.publish({ id: "PROD_xxx" });
     */
    async publish(params, options) {
      validateShortId("id", params.id, "PROD");
      return unwrapAction(
        await this.http.post("/v1/actions/subscription-product/publish-product", params, options)
      );
    }
    /**
     * Update a subscription product's status (active/inactive).
     *
     * @param params - Status update parameters
     * @returns Updated product detail
     *
     * @example
     * const { product } = await client.subscriptionProducts.updateStatus({
     *   id: "PROD_xxx",
     *   status: ProductVersionStatus.Active,
     * });
     */
    async updateStatus(params, options) {
      validateShortId("id", params.id, "PROD");
      validateEnum("status", params.status, ["active", "inactive"]);
      return unwrapAction(
        await this.http.post("/v1/actions/subscription-product/update-status", params, options)
      );
    }
  };
  var DEFAULT_TOLERANCE_MS = 45 * 60 * 1e3;
  var DEFAULT_FUTURE_TOLERANCE_MS = 60 * 1e3;
  var TEST_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxnmRY6yMMA3lVqmAU6ZG
b1sjL/+r/z6E+ZjkXaDAKiqOhk9rpazni0bNsGXwmftTPk9jy2wn+j6JHODD/WH/
SCnSfvKkLIjy4Hk7BuCgB174C0ydan7J+KgXLkOwgCAxxB68t2tezldwo74ZpXgn
F49opzMvQ9prEwIAWOE+kV9iK6gx/AckSMtHIHpUesoPDkldpmFHlB2qpf1vsFTZ
5kD6DmGl+2GIVK01aChy2lk8pLv0yUMu18v44sLkO5M44TkGPJD9qG09wrvVG2wp
OTVCn1n5pP8P+HRLcgzbUB3OlZVfdFurn6EZwtyL4ZD9kdkQ4EZE/9inKcp3c1h4
xwIDAQAB
-----END PUBLIC KEY-----`;
  var PROD_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAz+xApdTIb4ua+DgZKQ54
iBsD82ybyhGCLRETONW4Jgbb3A8DUM1LqBk6r/CmTOCHqLalTQHNigvP3R5zkDNX
iRJz6gA4MJ/+8K0+mnEE2RISQzN+Qu65TNd6svb+INm/kMaftY4uIXr6y6kchtTJ
dwnQhcKdAL2v7h7IFnkVelQsKxDdb2PqX8xX/qwd01iXvMcpCCaXovUwZsxH2QN5
ZKBTseJivbhUeyJCco4fdUyxOMHe2ybCVhyvim2uxAl1nkvL5L8RCWMCAV55LLo0
9OhmLahz/DYNu13YLVP6dvIT09ZFBYU6Owj1NxdinTynlJCFS9VYwBgmftosSE1U
dwIDAQAB
-----END PUBLIC KEY-----`;
  function parseSignatureHeader(header) {
    let t = "";
    let v1 = "";
    for (const pair of header.split(",")) {
      const eqIdx = pair.indexOf("=");
      if (eqIdx === -1) continue;
      const key = pair.slice(0, eqIdx).trim();
      const value = pair.slice(eqIdx + 1).trim();
      if (key === "t") t = value;
      else if (key === "v1") v1 = value;
    }
    return { t, v1 };
  }
  function rsaVerify(signatureInput, v1, publicKey) {
    const verifier = (0, import_crypto2.createVerify)("RSA-SHA256");
    verifier.update(signatureInput);
    return verifier.verify(publicKey, v1, "base64");
  }
  function resolveKeyForEnv(env, configKeys) {
    if (typeof configKeys === "string") {
      return normalizePublicKey(configKeys);
    }
    if (configKeys?.[env]) {
      return normalizePublicKey(configKeys[env]);
    }
    const envSpecific = env === "test" ? process.env.WAFFO_WEBHOOK_TEST_PUBLIC_KEY : process.env.WAFFO_WEBHOOK_PROD_PUBLIC_KEY;
    if (envSpecific) {
      return normalizePublicKey(envSpecific);
    }
    const generic = process.env.WAFFO_WEBHOOK_PUBLIC_KEY;
    if (generic) {
      return normalizePublicKey(generic);
    }
    return env === "test" ? TEST_PUBLIC_KEY : PROD_PUBLIC_KEY;
  }
  function verifyWebhook(payload, signatureHeader, options) {
    if (!signatureHeader) {
      throw new Error("Missing X-Waffo-Signature header");
    }
    const { t, v1 } = parseSignatureHeader(signatureHeader);
    if (!t || !v1) {
      throw new Error("Malformed X-Waffo-Signature header: missing t or v1");
    }
    const toleranceMs = options?.toleranceMs ?? DEFAULT_TOLERANCE_MS;
    if (toleranceMs > 0) {
      const timestampMs = Number(t);
      if (Number.isNaN(timestampMs)) {
        throw new Error("Invalid timestamp in X-Waffo-Signature header");
      }
      const futureToleranceMs = options?.futureToleranceMs ?? DEFAULT_FUTURE_TOLERANCE_MS;
      const ageMs = Date.now() - timestampMs;
      if (ageMs > toleranceMs || ageMs < -futureToleranceMs) {
        throw new Error("Webhook timestamp outside tolerance window (possible replay attack)");
      }
    }
    const signatureInput = `${t}.${payload}`;
    const directKey = options?.publicKey;
    if (directKey) {
      const normalizedKey = normalizePublicKey(directKey);
      if (!rsaVerify(signatureInput, v1, normalizedKey)) {
        throw new Error("Invalid webhook signature (custom key)");
      }
    } else {
      const configKeys = options?.publicKeys;
      const env = options?.environment;
      if (env === "test" || env === "prod") {
        const key = resolveKeyForEnv(env, configKeys);
        if (!rsaVerify(signatureInput, v1, key)) {
          throw new Error(`Invalid webhook signature (${env} key)`);
        }
      } else {
        const prodKey = resolveKeyForEnv("prod", configKeys);
        if (!rsaVerify(signatureInput, v1, prodKey)) {
          const testKey = resolveKeyForEnv("test", configKeys);
          if (!rsaVerify(signatureInput, v1, testKey)) {
            throw new Error("Invalid webhook signature (tried both prod and test keys)");
          }
        }
      }
    }
    return JSON.parse(payload);
  }
  var WebhooksResource = class {
    /**
     * @param http - HTTP client (used for add/update/remove)
     * @param publicKeys - Optional config-level public key(s) from WaffoPancakeConfig
     */
    constructor(http, publicKeys) {
      this.http = http;
      this.publicKeys = publicKeys;
    }
    /**
     * Add a webhook endpoint to a store.
     *
     * @param params - Webhook configuration
     * @returns Created webhook entity
     *
     * @example
     * // HTTP webhook (RSA-signed envelope, default)
     * const { webhook } = await client.webhooks.add({
     *   storeId: "STO_xxx",
     *   channel: "http",
     *   url: "https://example.com/webhook",
     *   events: ["order.completed", "refund.succeeded"],
     *   testMode: false,
     * });
     *
     * @example
     * // Discord webhook (uses Discord embed format)
     * await client.webhooks.add({
     *   storeId: "STO_xxx",
     *   channel: "discord",
     *   url: "https://discord.com/api/webhooks/...",
     *   events: ["order.completed"],
     *   testMode: false,
     * });
     *
     * @example
     * // Telegram bot — chat_id goes in `secret`; URL is the bot's sendMessage endpoint
     * await client.webhooks.add({
     *   storeId: "STO_xxx",
     *   channel: "telegram",
     *   url: "https://api.telegram.org/bot123:ABC/sendMessage",
     *   events: ["order.completed"],
     *   testMode: false,
     *   secret: "8737101383",
     * });
     */
    async add(params, options) {
      validateShortId("storeId", params.storeId, "STO");
      validateRequired("channel", params.channel);
      validateRequired("url", params.url);
      return unwrapAction(await this.http.post("/v1/actions/store/add-webhook", params, options));
    }
    /**
     * Update an existing webhook (only `url`, `events`, and `secret` are mutable).
     *
     * `channel` and `testMode` cannot be changed — remove the webhook and
     * re-add it instead. URL changes must remain on the same channel host
     * whitelist.
     *
     * @param params - Fields to update
     * @returns Updated webhook entity
     *
     * @example
     * await client.webhooks.update({
     *   id: "11111111-2222-3333-4444-555555555555",
     *   events: ["order.completed", "refund.succeeded", "subscription.canceled"],
     * });
     */
    async update(params, options) {
      validateRequired("id", params.id);
      return unwrapAction(await this.http.post("/v1/actions/store/update-webhook", params, options));
    }
    /**
     * Hard-delete a webhook. Historical `webhook_deliveries` rows are retained
     * (with `storeWebhookId` set to null) for audit purposes.
     *
     * @param params - Webhook to remove
     * @returns The removed webhook entity (snapshot before deletion)
     *
     * @example
     * await client.webhooks.remove({ id: "11111111-..." });
     */
    async remove(params, options) {
      validateRequired("id", params.id);
      return unwrapAction(await this.http.post("/v1/actions/store/remove-webhook", params, options));
    }
    /**
     * Verify and parse an incoming webhook event.
     *
     * Key resolution order:
     * 1. `options.publicKey` — per-call override (highest priority)
     * 2. `config.webhookPublicKey[env]` or `config.webhookPublicKey` (string)
     * 3. `WAFFO_WEBHOOK_{TEST|PROD}_PUBLIC_KEY` environment variable
     * 4. `WAFFO_WEBHOOK_PUBLIC_KEY` environment variable
     * 5. Built-in hardcoded key
     *
     * @param payload - Raw request body string (must be unparsed)
     * @param signatureHeader - Value of the `X-Waffo-Signature` header
     * @param options - Verification options (optional)
     * @returns Parsed webhook event
     * @throws Error if signature is invalid, header is malformed, or timestamp is stale
     *
     * @example
     * const event = client.webhooks.verify(rawBody, signatureHeader);
     *
     * @example
     * // Specify environment
     * const event = client.webhooks.verify(rawBody, sig, { environment: "test" });
     *
     * @example
     * // Per-call key override
     * const event = client.webhooks.verify(rawBody, sig, { publicKey: oneOffKey });
     */
    verify(payload, signatureHeader, options) {
      const mergedOptions = {
        ...options,
        publicKeys: options?.publicKeys ?? this.publicKeys
      };
      return verifyWebhook(payload, signatureHeader, mergedOptions);
    }
  };
  var WaffoPancake = class {
    http;
    config;
    auth;
    stores;
    storeMerchants;
    onetimeProducts;
    subscriptionProducts;
    subscriptionProductGroups;
    orders;
    checkout;
    graphql;
    webhooks;
    contentSafety;
    constructor(config) {
      validateShortId("merchantId", config.merchantId, "MER");
      this.config = config;
      this.http = new HttpClient(config);
      this.auth = new AuthResource(this.http);
      this.stores = new StoresResource(this.http);
      this.storeMerchants = new StoreMerchantsResource(this.http);
      this.onetimeProducts = new OnetimeProductsResource(this.http);
      this.subscriptionProducts = new SubscriptionProductsResource(this.http);
      this.subscriptionProductGroups = new SubscriptionProductGroupsResource(this.http);
      this.orders = new OrdersResource(this.http);
      this.checkout = new CheckoutResource(this.http);
      this.graphql = new GraphQLResource(this.http);
      this.webhooks = new WebhooksResource(this.http, config.webhookPublicKey);
      this.contentSafety = new ContentSafetyResource(this.http);
    }
    /**
     * Create a customer session for self-service operations.
     *
     * The returned session uses Bearer token authentication and provides
     * methods for order cancellation, subscription management, refund tickets,
     * and scoped GraphQL queries.
     *
     * Session tokens expire 5 minutes after issuance, so issue one right before
     * use rather than caching it.
     *
     * @param token - Session token from `client.auth.issueSessionToken()`
     * @param options - Per-session overrides
     * @returns A customer session with self-service methods
     * @throws {WaffoPancakeError} When no environment is available from either
     *   `options.environment` or `WaffoPancakeConfig.environment`
     *
     * @example
     * const { token } = await client.auth.issueSessionToken({
     *   storeId: "STO_xxx",
     *   buyerIdentity: "customer@example.com",
     * });
     * const customer = client.customer(token, { environment: "test" });
     * await customer.cancelSubscription({ orderId: "ORD_xxx" });
     *
     * @example
     * // Set the environment once on the client instead
     * const client = new WaffoPancake({ merchantId, privateKey, environment: "test" });
     * const customer = client.customer(token);
     */
    customer(token, options) {
      const environment = options?.environment ?? this.config.environment;
      if (environment === void 0) {
        throw new WaffoPancakeError(400, [
          {
            message: "Missing required field: environment \u2014 set it on the client config or pass client.customer(token, { environment: 'test' | 'prod' })",
            layer: "sdk"
          }
        ]);
      }
      validateEnum("environment", environment, ["test", "prod"]);
      const customerHttp = new CustomerHttpClient(token, environment, {
        baseUrl: this.config.baseUrl,
        fetch: this.config.fetch
      });
      return new CustomerSession(customerHttp);
    }
    /**
     * Create a customer session for self-service operations.
     *
     * @param token - Session token from `client.auth.issueSessionToken()`
     * @param options - Per-session overrides
     * @returns A customer session with self-service methods
     *
     * @example
     * ```typescript
     * const session = client.buyer(token); // prefer client.customer(token)
     * ```
     *
     * @deprecated Use {@link WaffoPancake.customer} instead.
     */
    buyer(token, options) {
      return this.customer(token, options);
    }
  };

  // dashboard/edge-patches/cloud/waffo.ts
  init_contracts();
  init_cryptography();
  function mode(config) {
    if (config.environment !== "sandbox" && config.environment !== "live") {
      throw new BillingError("invalid_billing_environment");
    }
    return config.environment === "sandbox" ? "test" : "prod";
  }
  function shortId(value, prefix) {
    const id = text(value);
    if (!new RegExp(`^${prefix}_[0-9A-Za-z]{22}$`).test(id)) {
      throw new BillingError("invalid_provider_identifier");
    }
    return id;
  }
  function assertOrder(order, config) {
    uuid(order.id);
    uuid(order.user_id);
    mode(config);
    if (String(order.provider) !== "waffo" || order.environment !== config.environment || ![1, 12].includes(order.term_months)) throw new BillingError("invalid_checkout_provider");
    const billingMode = order.billing_mode;
    if (order.currency !== "USD" || !["fixed", "recurring"].includes(billingMode || "") || !cents(order.amount_cents) || order.sku !== `cloud_usd_${order.term_months === 12 ? "yearly" : "monthly"}${billingMode === "fixed" ? "_fixed" : ""}`) {
      throw new BillingError("payment_price_mismatch");
    }
  }
  function waffoProductId(order, config) {
    assertOrder(order, config);
    const id = order.provider_price_id || config.productIds[order.sku];
    if (!id) throw new BillingError("waffo_not_configured", 503);
    return shortId(id, "PROD");
  }
  function client(config, request2) {
    if (!config.privateKey) throw new BillingError("waffo_not_configured", 503);
    shortId(config.merchantId, "MER");
    shortId(config.storeId, "STO");
    try {
      return new WaffoPancake({
        merchantId: config.merchantId,
        privateKey: config.privateKey,
        environment: mode(config),
        fetch: async (url, init) => {
          const response = await request2(url, { ...init, signal: AbortSignal.timeout(15e3) });
          if (!response.ok) throw new BillingError("payment_provider_unavailable", 502);
          if (!response.body) return response;
          if (Number(response.headers.get("Content-Length")) > 8 * 1024 * 1024) {
            await response.body.cancel();
            throw new BillingError("waffo_snapshot_too_large", 503);
          }
          const reader = response.body.getReader();
          const chunks = [];
          let length = 0;
          for (; ; ) {
            const part = await reader.read();
            if (part.done) break;
            length += part.value.byteLength;
            if (length > 8 * 1024 * 1024) {
              await reader.cancel();
              throw new BillingError("waffo_snapshot_too_large", 503);
            }
            chunks.push(part.value);
          }
          const body2 = new Uint8Array(length);
          let offset = 0;
          for (const part of chunks) {
            body2.set(part, offset);
            offset += part.byteLength;
          }
          return new Response(body2, { status: response.status, headers: response.headers });
        }
      });
    } catch (error) {
      if (error instanceof BillingError) throw error;
      throw new BillingError("waffo_not_configured", 503);
    }
  }
  async function providerCall(operation) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof BillingError) throw error;
      throw new BillingError("payment_provider_unavailable", 502);
    }
  }
  async function query(config, request2, document, variables) {
    const result = await providerCall(() => client(config, request2).graphql.query({ query: document, variables }));
    if (result.errors?.length || result.data == null) throw new BillingError("payment_provider_unavailable", 502);
    return object(result.data);
  }
  function metadata(value) {
    if (typeof value === "string") {
      try {
        return object(JSON.parse(value));
      } catch {
        throw new BillingError("invalid_provider_payload");
      }
    }
    return object(value);
  }
  function assertPrices(prices, order) {
    if (!Array.isArray(prices)) throw new BillingError("invalid_provider_payload");
    const rows = prices.map(object).filter((p) => p.currency === order.currency);
    if (rows.length !== 1) throw new BillingError("payment_currency_mismatch");
    const price = object(rows[0].priceInfo);
    if (decimalCents(price.amount) !== order.amount_cents || price.taxCategory !== "saas" || price.trialAmount != null) {
      throw new BillingError("payment_price_mismatch");
    }
  }
  function assertNoTrial(value) {
    const meta = metadata(value);
    if (meta.trialDays != null && meta.trialDays !== 0) throw new BillingError("waffo_trial_configuration_mismatch", 503);
  }
  async function assertVerifiedLiveKey(config) {
    const expected = config.livePrivateKeySha256;
    if (typeof expected !== "string" || !/^[0-9a-f]{64}$/i.test(expected)) {
      throw new BillingError("waffo_live_key_not_verified", 503);
    }
    try {
      const pem = config.privateKey.trim();
      if (!/^-----BEGIN (PRIVATE KEY|RSA PRIVATE KEY)-----\s*[A-Za-z0-9+/=\s]+-----END \1-----$/.test(pem)) throw Error();
      const material = pemBytes(pem);
      if (!material.length) throw Error();
      const actual = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", material))).map((value) => value.toString(16).padStart(2, "0")).join("");
      if (actual !== expected.toLowerCase()) throw Error();
    } catch {
      throw new BillingError("waffo_live_key_not_verified", 503);
    }
  }
  async function validateWaffoProduct(order, config, request2 = fetch) {
    const id = waffoProductId(order, config);
    const live = config.environment === "live";
    if (live) await assertVerifiedLiveKey(config);
    const subscription = order.billing_mode === "recurring";
    const field = subscription ? "subscriptionProduct" : "onetimeProduct";
    const data = await query(config, request2, `query ($id: String!${live ? ", $storeId: String!" : ""}) {
    ${live ? "store(id: $storeId) { id prodEnabled }" : ""}
    ${field}(id: $id) { id storeId status metadata ${live ? "hasProdVersion" : ""} ${subscription ? "billingPeriod" : ""}
      prices { currency priceInfo { amount taxCategory ${subscription ? "trialAmount" : ""} } } }
  }`, { id, ...live ? { storeId: config.storeId } : {} });
    const product = object(data[field]);
    const store = live ? object(data.store || {}) : {};
    if (product.id !== id || product.storeId !== config.storeId || product.status !== "active" || subscription && product.billingPeriod !== (order.term_months === 12 ? "yearly" : "monthly") || live && (product.hasProdVersion !== true || store.id !== config.storeId || store.prodEnabled !== true)) {
      throw new BillingError("waffo_product_configuration_mismatch", 503);
    }
    assertPrices(product.prices, order);
    assertNoTrial(product.metadata);
  }
  var CHECKOUT_TTL_SECONDS = 1800;
  async function createWaffoCheckout(order, config, request2 = fetch) {
    const id = waffoProductId(order, config);
    let success;
    try {
      success = new URL(config.checkoutPage);
    } catch {
      throw new BillingError("invalid_checkout_configuration", 503);
    }
    if (success.protocol !== "https:" || success.username || success.password) {
      throw new BillingError("invalid_checkout_configuration", 503);
    }
    success.searchParams.set("order", order.id);
    await validateWaffoProduct(order, config, request2);
    const result = await providerCall(() => client(config, request2).checkout.createSession({
      productId: id,
      currency: order.currency,
      withTrial: false,
      successUrl: success.toString(),
      expiresInSeconds: CHECKOUT_TTL_SECONDS,
      orderMerchantExternalId: order.id,
      metadata: {
        tokentracker_order_id: order.id,
        tokentracker_user_id: order.user_id,
        tokentracker_environment: order.environment
      }
    }, { idempotencyKey: `tokentracker-${config.environment}-checkout-${order.id}` }));
    const sessionId = text(result.sessionId);
    if (!/^cs_[0-9A-Za-z_-]+$/.test(sessionId)) throw new BillingError("invalid_provider_identifier");
    let checkout;
    try {
      checkout = new URL(text(result.checkoutUrl, 8192));
    } catch {
      throw new BillingError("invalid_provider_checkout_url", 502);
    }
    if (checkout.protocol !== "https:" || checkout.hostname !== "pancake.waffo.ai" || checkout.port || checkout.username || checkout.password || !checkout.pathname.endsWith(`/checkout/${sessionId}`) || !checkout.pathname.startsWith("/store/")) throw new BillingError("invalid_provider_checkout_url", 502);
    if (config.environment === "sandbox") checkout.searchParams.set("test", "true");
    else if (checkout.searchParams.has("test")) throw new BillingError("invalid_provider_checkout_url", 502);
    isoDate(result.expiresAt);
    return { checkoutUrl: checkout.toString(), sessionId, priceId: id };
  }
  var moneyFields = "amount currency display";
  var breakdownFields = "currency subtotal taxAmount total taxCategory";
  var paymentFields = `id orderId status testMode periodNumber orderMerchantExternalId createdAt
  amount { ${moneyFields} } snapshotAmountDetails { ${breakdownFields} phase }
  pspAmountDetails { amount currency }
  refunds { id paymentId status testMode orderMerchantExternalId createdAt
    amount { ${moneyFields} } pspAmountDetails { amount currency } }`;
  async function providerOrders(order, config, request2) {
    const id = waffoProductId(order, config);
    const subscription = order.billing_mode === "recurring";
    const field = subscription ? "subscriptionOrders" : "onetimeOrders";
    const subscriptionFields = `billingPeriod isInTrial willRenew currentPeriodStart currentPeriodEnd currentPeriodNumber
    changeOriginOrderId supersededByOrderId`;
    const document = `query ($storeId: String!, $ref: String!, $offset: Int!) {
    ${field}(storeId: $storeId, filter: { orderMerchantExternalId: { eq: $ref } }, limit: 100, offset: $offset) {
      id storeId status currency testMode orderMerchantExternalId merchantProvidedBuyerIdentity metadata createdAt updatedAt
      ${subscription ? subscriptionFields : ""}
      productVersion { id productId metadata ${subscription ? "billingPeriod" : ""}
        prices { currency priceInfo { amount taxCategory ${subscription ? "trialAmount" : ""} } } }
      priceSnapshot { currency ${subscription ? `specialPhaseDays specialPhase { subtotal taxAmount total taxCategory }
        regularPhase { subtotal taxAmount total taxCategory }` : "subtotal taxAmount total taxCategory"} }
      payments { ${paymentFields} }
    }
    ${field}Count(storeId: $storeId, filter: { orderMerchantExternalId: { eq: $ref } })
  }`;
    const all = [];
    const ids = /* @__PURE__ */ new Set();
    let total = null;
    for (let offset = 0; ; offset += 100) {
      const data = await query(config, request2, document, { storeId: config.storeId, ref: order.id, offset });
      const rows = data[field];
      const count = data[`${field}Count`];
      if (!Array.isArray(rows) || !Number.isSafeInteger(count) || Number(count) < 0) {
        throw new BillingError("invalid_provider_payload");
      }
      if (Number(count) > 1e3) throw new BillingError("waffo_attempt_limit_exceeded", 503);
      if (total !== null && total !== count) throw new BillingError("waffo_notification_pending", 503);
      total = Number(count);
      if (rows.length > 100 || rows.length === 0 && all.length < total) {
        throw new BillingError("waffo_notification_pending", 503);
      }
      for (const value of rows) {
        const remote = validateProviderOrder(value, order, config, id, subscription);
        const remoteId = text(remote.id);
        if (ids.has(remoteId)) throw new BillingError("ambiguous_payment_binding", 409);
        ids.add(remoteId);
        all.push(remote);
      }
      if (all.length === total) return all;
      if (all.length > total) throw new BillingError("invalid_provider_payload");
    }
  }
  function validateProviderOrder(value, order, config, id, subscription) {
    const remote = object(value);
    shortId(remote.id, "ORD");
    if (remote.storeId !== config.storeId || remote.testMode !== (mode(config) === "test") || remote.orderMerchantExternalId !== order.id) {
      throw new BillingError("payment_order_mismatch");
    }
    const meta = metadata(remote.metadata);
    if (meta.tokentracker_order_id !== order.id || meta.tokentracker_user_id !== order.user_id || meta.tokentracker_environment !== order.environment) throw new BillingError("payment_account_mismatch");
    const version = object(remote.productVersion);
    if (version.productId !== id || remote.currency !== order.currency || subscription && (remote.billingPeriod !== (order.term_months === 12 ? "yearly" : "monthly") || version.billingPeriod !== remote.billingPeriod || remote.isInTrial !== false || remote.changeOriginOrderId != null || remote.supersededByOrderId != null)) {
      throw new BillingError("payment_price_mismatch");
    }
    assertPrices(version.prices, order);
    assertNoTrial(version.metadata);
    const snapshot = object(remote.priceSnapshot);
    if (snapshot.currency !== order.currency) throw new BillingError("payment_currency_mismatch");
    if (subscription && (snapshot.specialPhaseDays != null || snapshot.specialPhase != null)) {
      throw new BillingError("payment_price_mismatch");
    }
    assertBreakdown(subscription ? object(snapshot.regularPhase) : snapshot, order);
    isoDate(remote.createdAt);
    isoDate(remote.updatedAt);
    return remote;
  }
  async function providerOrder(order, config, request2, targetId) {
    const rows = await providerOrders(order, config, request2);
    if (targetId) return rows.find((remote) => remote.id === targetId) || null;
    if (rows.length > 1) throw new BillingError("ambiguous_payment_binding", 409);
    return rows[0] || null;
  }
  function assertBreakdown(snapshot, order) {
    const subtotal = decimalCents(snapshot.subtotal);
    const tax = decimalCents(snapshot.taxAmount);
    const total = decimalCents(snapshot.total);
    if (subtotal !== order.amount_cents || subtotal + tax !== total || snapshot.taxCategory !== "saas") {
      throw new BillingError("payment_amount_mismatch");
    }
    return total;
  }
  function money(value, currency) {
    const amount = object(value);
    const minor = cents(amount.amount);
    if (amount.currency !== currency || decimalCents(amount.display) !== minor) {
      throw new BillingError("payment_amount_mismatch");
    }
    return minor;
  }
  function pspMoney(value, currency) {
    const amount = object(value);
    if (amount.currency !== currency) throw new BillingError("payment_currency_mismatch");
    return decimalCents(amount.amount);
  }
  function isZeroAuthorization(payment, order) {
    if (order.billing_mode !== "recurring" || payment.status !== "succeeded" || payment.periodNumber !== 0) return false;
    const snapshot = object(payment.snapshotAmountDetails);
    if (snapshot.currency !== order.currency || snapshot.phase !== "regular") throw new BillingError("payment_currency_mismatch");
    assertBreakdown(snapshot, order);
    const amount = pspMoney(payment.pspAmountDetails, order.currency);
    if (money(payment.amount, order.currency) !== amount) throw new BillingError("payment_amount_mismatch");
    return amount === 0 && Array.isArray(payment.refunds) && payment.refunds.length === 0;
  }
  function period(value, remoteId, priceId2) {
    if (!Number.isSafeInteger(value.period_number) || value.period_number < 1 || value.waffo_order_id && value.waffo_order_id !== remoteId || value.provider_price_id && value.provider_price_id !== priceId2) throw new BillingError("invalid_billing_period");
    const starts_at = isoDate(value.starts_at);
    const ends_at = isoDate(value.ends_at);
    if (Date.parse(ends_at) <= Date.parse(starts_at)) throw new BillingError("invalid_billing_period");
    return { waffo_order_id: remoteId, provider_price_id: priceId2, period_number: value.period_number, starts_at, ends_at };
  }
  function currentPeriod(remote, priceId2, order) {
    if (remote.currentPeriodStart == null || remote.currentPeriodEnd == null || remote.currentPeriodNumber == null || remote.currentPeriodNumber === 0) return null;
    if (["past_due", "canceling", "canceled", "closed", "expired"].includes(String(remote.status))) {
      if (!Array.isArray(remote.payments)) throw new BillingError("invalid_provider_payload");
      const paidCurrent = remote.payments.some((value) => {
        const payment = object(value);
        if (payment.status !== "succeeded" || payment.periodNumber !== remote.currentPeriodNumber) return false;
        if (payment.orderId !== remote.id || payment.orderMerchantExternalId !== order.id || payment.testMode !== remote.testMode) throw new BillingError("payment_order_mismatch");
        const actual = pspMoney(payment.pspAmountDetails, order.currency);
        if (money(payment.amount, order.currency) !== actual) throw new BillingError("payment_amount_mismatch");
        if (!actual) return false;
        const snapshot = object(payment.snapshotAmountDetails);
        if (snapshot.currency !== order.currency || snapshot.phase !== "regular" || assertBreakdown(snapshot, order) !== actual) {
          throw new BillingError("payment_amount_mismatch");
        }
        return true;
      });
      if (!paidCurrent) return null;
    }
    return period({
      period_number: remote.currentPeriodNumber,
      starts_at: remote.currentPeriodStart,
      ends_at: remote.currentPeriodEnd
    }, text(remote.id), priceId2);
  }
  async function queryWaffoBindings(order, config, request2 = fetch) {
    const remotes = await providerOrders(order, config, request2);
    const priceId2 = waffoProductId(order, config);
    return remotes.map((remote) => ({
      waffo_order_id: shortId(remote.id, "ORD"),
      provider_price_id: priceId2,
      current_period: order.billing_mode === "recurring" ? currentPeriod(remote, priceId2, order) : null
    }));
  }
  async function queryWaffoOrder(order, config, request2 = fetch, periods = []) {
    const remotes = await providerOrders(order, config, request2);
    if (order.waffo_order_id && !remotes.some((remote) => remote.id === order.waffo_order_id)) {
      throw new BillingError("payment_order_mismatch");
    }
    const events = remotes.flatMap((remote) => normalizeWaffoOrder(remote, order, config, periods));
    if (order.provider_order_id && !events.some((event) => event.kind === "payment" && event.action_id === order.provider_order_id)) {
      throw new BillingError("payment_order_mismatch");
    }
    const actions = /* @__PURE__ */ new Set();
    for (const event of events) {
      if (event.kind === "subscription") continue;
      const key = `${event.kind}:${event.action_id}`;
      if (actions.has(key)) throw new BillingError("ambiguous_payment_binding", 409);
      actions.add(key);
    }
    const precedence = { authorization: 0, payment: 1, refund: 2, subscription: 3 };
    return events.sort((a, b) => precedence[a.kind] - precedence[b.kind] || Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
  }
  function normalizeWaffoOrder(remote, order, config, periods) {
    const remoteId = text(remote.id);
    const priceId2 = waffoProductId(order, config);
    const subscription = order.billing_mode === "recurring";
    const current = subscription ? currentPeriod(remote, priceId2, order) : null;
    const cache = /* @__PURE__ */ new Map();
    for (const value of [...periods.filter((value2) => value2.waffo_order_id === remoteId), ...current ? [current] : []]) {
      const checked = period(value, remoteId, priceId2);
      const previous = cache.get(checked.period_number);
      if (previous && (previous.starts_at !== checked.starts_at || previous.ends_at !== checked.ends_at)) {
        throw new BillingError("waffo_billing_period_conflict", 409);
      }
      cache.set(checked.period_number, checked);
    }
    if (!Array.isArray(remote.payments)) throw new BillingError("invalid_provider_payload");
    const payments = remote.payments.map(object).filter((p) => p.status === "succeeded").sort((a, b) => Date.parse(isoDate(a.createdAt)) - Date.parse(isoDate(b.createdAt)));
    const events = [];
    const paymentIds = /* @__PURE__ */ new Set();
    const refundIds = /* @__PURE__ */ new Set();
    for (const payment of payments) {
      const paymentId = shortId(payment.id, "PAY");
      if (paymentIds.has(paymentId)) throw new BillingError("ambiguous_payment_binding", 409);
      paymentIds.add(paymentId);
      if (payment.orderId !== remoteId || payment.testMode !== (mode(config) === "test") || payment.orderMerchantExternalId !== order.id) throw new BillingError("payment_order_mismatch");
      const snapshot = object(payment.snapshotAmountDetails);
      if (snapshot.currency !== order.currency || subscription && snapshot.phase !== "regular") {
        throw new BillingError("payment_currency_mismatch");
      }
      const total = assertBreakdown(snapshot, order);
      const actual = pspMoney(payment.pspAmountDetails, order.currency);
      if (money(payment.amount, order.currency) !== actual) {
        throw new BillingError("payment_amount_mismatch");
      }
      if (isZeroAuthorization(payment, order)) {
        events.push({
          event_id: `waffo_${config.environment}_authorization_${paymentId}`,
          kind: "authorization",
          action_id: paymentId,
          order_id: order.id,
          occurred_at: isoDate(payment.createdAt),
          transaction_id: paymentId,
          waffo_order_id: remoteId,
          provider_price_id: priceId2,
          currency: order.currency,
          base_amount_cents: order.amount_cents,
          amount_cents: 0,
          subscription_id: remoteId,
          period_number: 0
        });
        continue;
      }
      if (actual !== total) throw new BillingError("payment_amount_mismatch");
      const paidPeriod = subscription ? cache.get(payment.periodNumber) : null;
      if (subscription && !paidPeriod) throw new BillingError("waffo_billing_period_pending", 503);
      events.push({
        event_id: `waffo_${config.environment}_payment_${paymentId}`,
        kind: "payment",
        action_id: paymentId,
        order_id: order.id,
        occurred_at: isoDate(payment.createdAt),
        transaction_id: paymentId,
        waffo_order_id: remoteId,
        provider_price_id: priceId2,
        currency: order.currency,
        base_amount_cents: order.amount_cents,
        amount_cents: actual,
        ...paidPeriod ? {
          subscription_id: remoteId,
          period_number: paidPeriod.period_number,
          starts_at: paidPeriod.starts_at,
          ends_at: paidPeriod.ends_at
        } : {}
      });
      if (!Array.isArray(payment.refunds)) throw new BillingError("invalid_provider_payload");
      let refunded = 0;
      for (const entry of payment.refunds) {
        const refund = object(entry);
        if (refund.status !== "succeeded") continue;
        const refundId = shortId(refund.id, "(?:RFD|REF)");
        if (refundIds.has(refundId)) throw new BillingError("ambiguous_payment_binding", 409);
        refundIds.add(refundId);
        if (refund.paymentId !== paymentId || refund.testMode !== (mode(config) === "test") || refund.orderMerchantExternalId !== order.id) throw new BillingError("payment_order_mismatch");
        const amount = pspMoney(refund.pspAmountDetails, order.currency);
        refunded += amount;
        if (!amount || amount !== money(refund.amount, order.currency) || refunded > actual) {
          throw new BillingError("payment_amount_mismatch");
        }
        events.push({
          event_id: `waffo_${config.environment}_refund_${refundId}`,
          kind: "refund",
          action_id: refundId,
          order_id: order.id,
          occurred_at: isoDate(refund.createdAt),
          transaction_id: paymentId,
          waffo_order_id: remoteId,
          provider_price_id: priceId2,
          currency: order.currency,
          amount_cents: amount,
          ...subscription ? { subscription_id: remoteId } : {}
        });
      }
    }
    if (subscription && remote.status !== "pending") {
      const status = remote.status === "canceling" ? "active" : remote.status;
      if (!["active", "past_due", "canceled", "expired", "closed"].includes(String(status))) {
        throw new BillingError("invalid_provider_subscription_status");
      }
      const updated = isoDate(remote.updatedAt);
      const canceled = remote.status === "canceling";
      if (typeof remote.willRenew !== "boolean") throw new BillingError("invalid_provider_payload");
      events.push({
        event_id: `waffo_${config.environment}_subscription_${remoteId}_${updated}`,
        kind: "subscription",
        action_id: `${remoteId}:${updated}`,
        order_id: order.id,
        occurred_at: updated,
        subscription_id: remoteId,
        waffo_order_id: remoteId,
        provider_price_id: priceId2,
        status: status === "expired" || status === "closed" ? "canceled" : String(status),
        cancel_at_period_end: canceled,
        next_billed_at: status === "active" && !canceled && remote.willRenew && current ? current.ends_at : null,
        ...current ? { starts_at: current.starts_at, ends_at: current.ends_at, period_number: current.period_number } : {}
      });
    }
    return events;
  }
  async function cancelWaffoSubscription(order, subscriptionId, config, request2 = fetch) {
    assertOrder(order, config);
    if (order.billing_mode !== "recurring") throw new BillingError("invalid_checkout_provider");
    const id = shortId(subscriptionId, "ORD");
    const remote = await providerOrder(order, config, request2, id);
    if (!remote || remote.id !== id) throw new BillingError("payment_order_mismatch");
    if (remote.status === "canceling" || remote.status === "canceled") {
      return { orderId: id, status: remote.status };
    }
    const version = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text(remote.updatedAt))));
    const operation = Array.from(version, (byte) => byte.toString(16).padStart(2, "0")).join("");
    const result = await providerCall(() => client(config, request2).orders.cancelSubscription(
      { orderId: id },
      { idempotencyKey: `tokentracker-${config.environment}-cancel-${order.id}-${operation}` }
    ));
    if (result.orderId !== id || !["canceling", "canceled"].includes(result.status)) {
      throw new BillingError("invalid_provider_subscription_status");
    }
    const confirmed = await providerOrder(order, config, request2, id);
    if (!confirmed || confirmed.id !== id || !["canceling", "canceled"].includes(String(confirmed.status))) {
      throw new BillingError("subscription_cancellation_pending", 503);
    }
    return { orderId: id, status: String(confirmed.status) };
  }
  function assertUnpaid(remote, order, config) {
    if (!["pending", "canceled", "closed", "expired"].includes(String(remote.status)) || !Array.isArray(remote.payments) || remote.payments.some((payment) => !["failed", "canceled", "expired"].includes(String(object(payment).status)) && !isZeroAuthorization(object(payment), order))) {
      throw new BillingError("checkout_confirmation_pending", 409);
    }
    for (const value of remote.payments) {
      const payment = object(value);
      shortId(payment.id, "PAY");
      if (payment.orderId !== remote.id || payment.testMode !== (mode(config) === "test") || payment.orderMerchantExternalId !== order.id) throw new BillingError("payment_order_mismatch");
    }
  }
  async function closeSingleUnpaidWaffoOrder(order, targetId, config, request2 = fetch) {
    const remote = await providerOrder(order, config, request2, targetId);
    if (!remote) throw new BillingError("checkout_confirmation_pending", 409);
    if (order.provider_order_id) throw new BillingError("checkout_confirmation_pending", 409);
    assertUnpaid(remote, order, config);
    const id = shortId(remote.id, "ORD");
    if (["canceled", "closed", "expired"].includes(String(remote.status))) {
      const confirmed2 = await providerOrder(order, config, request2, targetId);
      if (!confirmed2 || confirmed2.id !== id || !["canceled", "closed", "expired"].includes(String(confirmed2.status))) {
        throw new BillingError("checkout_confirmation_pending", 409);
      }
      assertUnpaid(confirmed2, order, config);
      return id;
    }
    const api = client(config, request2);
    const options = { idempotencyKey: `tokentracker-${config.environment}-close-${order.id}-${id}` };
    let result;
    if (order.billing_mode === "recurring") {
      result = await providerCall(() => api.orders.cancelSubscription({ orderId: id }, options));
    } else {
      if (!remote.merchantProvidedBuyerIdentity) throw new BillingError("checkout_confirmation_pending", 409);
      const session = await providerCall(() => api.auth.issueSessionToken({
        storeId: config.storeId,
        buyerIdentity: text(remote.merchantProvidedBuyerIdentity, 512)
      }));
      const customer = api.customer(text(session.token, 8192), { environment: mode(config) });
      const visible = await providerCall(() => customer.graphql.query({ query: `query ($id: String!) {
      onetimeOrder(id: $id) { id storeId currency testMode orderMerchantExternalId productVersion { productId } }
    }`, variables: { id } }));
      if (visible.errors?.length || visible.data == null) throw new BillingError("payment_provider_unavailable", 502);
      const owned = object(object(visible.data).onetimeOrder);
      if (owned.id !== id || owned.storeId !== config.storeId || owned.currency !== order.currency || owned.testMode !== (mode(config) === "test") || owned.orderMerchantExternalId !== order.id || object(owned.productVersion).productId !== waffoProductId(order, config)) {
        throw new BillingError("payment_order_mismatch");
      }
      result = await providerCall(() => customer.cancelOnetimeOrder({ orderId: id }, options));
    }
    if (result.orderId !== id || result.status !== "canceled") throw new BillingError("checkout_confirmation_pending", 409);
    const confirmed = await providerOrder(order, config, request2, targetId);
    if (!confirmed || confirmed.id !== id || confirmed.status !== "canceled") {
      throw new BillingError("checkout_confirmation_pending", 409);
    }
    assertUnpaid(confirmed, order, config);
    return id;
  }
  async function closeUnpaidWaffoAttempts(order, config, request2 = fetch) {
    const remotes = await providerOrders(order, config, request2);
    if (!remotes.length || order.provider_order_id) throw new BillingError("checkout_confirmation_pending", 409);
    for (const remote of remotes) assertUnpaid(remote, order, config);
    const expected = remotes.map((remote) => text(remote.id)).sort();
    const sameAttempts = (current) => {
      const ids = current.map((remote) => text(remote.id)).sort();
      if (expected.length !== ids.length || expected.some((id, index) => id !== ids[index])) {
        throw new BillingError("checkout_confirmation_pending", 409);
      }
      for (const remote of current) assertUnpaid(remote, order, config);
    };
    for (const id of remotes.filter((remote) => remote.status === "pending").map((remote) => text(remote.id)).sort()) {
      const current = await providerOrders(order, config, request2);
      sameAttempts(current);
      if (current.find((remote) => remote.id === id)?.status === "pending") {
        await closeSingleUnpaidWaffoOrder(order, id, config, request2);
      }
    }
    const confirmed = await providerOrders(order, config, request2);
    sameAttempts(confirmed);
    for (const remote of confirmed) {
      assertUnpaid(remote, order, config);
      if (!["canceled", "closed", "expired"].includes(String(remote.status))) {
        throw new BillingError("checkout_confirmation_pending", 409);
      }
    }
    return expected;
  }
  async function confirmExpiredUnusedWaffoCheckout(order, config, request2 = fetch, now = Date.now()) {
    assertOrder(order, config);
    const expires = Date.parse(String(order.expires_at));
    if (!["pending", "ready"].includes(order.status) || !Number.isFinite(expires) || expires > now || order.provider_order_id || order.waffo_order_id) return false;
    const record = object(order);
    if (record.checkout_attempts === 0 && !record.provider_checkout_id && !order.checkout_url) return true;
    const claimed = Date.parse(String(record.checkout_claimed_at));
    const session = record.provider_checkout_id;
    if (typeof session !== "string" || !/^cs_[0-9A-Za-z_-]+$/.test(session) || !Number.isFinite(claimed) || !order.checkout_url) return false;
    const checkout = new URL(order.checkout_url);
    if (checkout.protocol !== "https:" || checkout.hostname !== "pancake.waffo.ai" || checkout.port || checkout.username || checkout.password || !checkout.pathname.startsWith("/store/") || !checkout.pathname.endsWith(`/checkout/${session}`)) return false;
    if (now < claimed + CHECKOUT_TTL_SECONDS * 1e3 + 6e4) return false;
    if ((await providerOrders(order, config, request2)).length) return false;
    return (await providerOrders(order, config, request2)).length === 0;
  }

  // dashboard/edge-patches/cloud/waffo-processing.ts
  init_contracts();

  // dashboard/edge-patches/cloud/runtime.ts
  var import_sdk_1_4 = __require("npm:@insforge/sdk@1.4.5");
  init_contracts();

  // dashboard/edge-patches/cloud/auth.ts
  init_contracts();
  init_cryptography();
  async function billingUserId(authorization, secrets, nowMs = Date.now()) {
    if (!authorization?.startsWith("Bearer ")) throw new BillingError("sign_in_required", 401);
    const token = authorization.slice(7).trim();
    const parts = token.split(".");
    if (parts.length !== 3) throw new BillingError("sign_in_required", 401);
    try {
      const decode = (value) => base64Bytes(value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "="));
      const header = object(JSON.parse(new TextDecoder().decode(decode(parts[0]))));
      let key;
      let algorithm;
      if (header.alg === "HS256" && secrets.jwtSecret) {
        algorithm = "HMAC";
        key = await crypto.subtle.importKey("raw", bytes(secrets.jwtSecret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
      } else if (header.alg === "RS256" && secrets.jwtPublicKey) {
        algorithm = "RSASSA-PKCS1-v1_5";
        key = await crypto.subtle.importKey("spki", pemBytes(secrets.jwtPublicKey), { name: algorithm, hash: "SHA-256" }, false, ["verify"]);
      } else throw new BillingError("sign_in_required", 401);
      if (!await crypto.subtle.verify(algorithm, key, decode(parts[2]), bytes(`${parts[0]}.${parts[1]}`))) {
        throw new BillingError("sign_in_required", 401);
      }
      const claims = object(JSON.parse(new TextDecoder().decode(decode(parts[1]))));
      if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp <= nowMs / 1e3 || claims.nbf !== void 0 && (typeof claims.nbf !== "number" || claims.nbf > nowMs / 1e3) || claims.role === "anon" || claims.role === "service_role") throw new BillingError("sign_in_required", 401);
      return uuid(claims.sub || claims.user_id);
    } catch {
      throw new BillingError("sign_in_required", 401);
    }
  }

  // dashboard/edge-patches/cloud/runtime.ts
  var cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey"
  };
  function json(data, status = 200) {
    return Response.json(data, { status, headers: { ...cors, "Cache-Control": "no-store" } });
  }
  function billingEnvironment() {
    const value = Deno.env.get("TOKENTRACKER_BILLING_ENVIRONMENT") || "live";
    if (value !== "sandbox" && value !== "live") throw new BillingError("billing_configuration_invalid", 503);
    return value;
  }
  function paddleConfig() {
    return {
      environment: billingEnvironment(),
      apiKey: Deno.env.get("PADDLE_API_KEY") || "",
      webhookSecret: Deno.env.get("PADDLE_WEBHOOK_SECRET") || "",
      monthlyPriceId: Deno.env.get("PADDLE_CLOUD_MONTHLY_PRICE_ID") || "",
      yearlyPriceId: Deno.env.get("PADDLE_CLOUD_YEARLY_PRICE_ID") || "",
      checkoutPage: `${billingSiteUrl()}/billing/checkout`
    };
  }
  function wechatConfig() {
    const baseUrl = Deno.env.get("INSFORGE_BASE_URL") || "";
    return {
      environment: billingEnvironment(),
      appId: Deno.env.get("WECHATPAY_APP_ID") || "",
      merchantId: Deno.env.get("WECHATPAY_MCH_ID") || "",
      merchantSerial: Deno.env.get("WECHATPAY_MERCHANT_SERIAL") || "",
      merchantPrivateKey: Deno.env.get("WECHATPAY_MERCHANT_PRIVATE_KEY") || "",
      platformKeyId: Deno.env.get("WECHATPAY_PUBLIC_KEY_ID") || "",
      platformPublicKey: Deno.env.get("WECHATPAY_PUBLIC_KEY") || "",
      apiV3Key: Deno.env.get("WECHATPAY_API_V3_KEY") || "",
      notifyUrl: `${baseUrl.replace(/\/$/, "")}/functions/tokentracker-wechat-webhook`
    };
  }
  function alipayConfig() {
    const baseUrl = Deno.env.get("INSFORGE_BASE_URL") || "";
    return {
      environment: billingEnvironment(),
      appId: Deno.env.get("ALIPAY_APP_ID") || "",
      sellerId: Deno.env.get("ALIPAY_SELLER_ID") || "",
      privateKey: Deno.env.get("ALIPAY_PRIVATE_KEY") || "",
      publicKey: Deno.env.get("ALIPAY_PUBLIC_KEY") || "",
      notifyUrl: `${baseUrl.replace(/\/$/, "")}/functions/tokentracker-alipay-webhook`,
      checkoutPage: `${billingSiteUrl()}/billing/checkout`
    };
  }
  function configuredProviders() {
    const paddle = paddleConfig();
    const wechat = wechatConfig();
    const alipay = alipayConfig();
    const waffo = waffoConfig();
    return {
      waffo: Boolean(waffo.merchantId && waffo.privateKey && waffo.storeId && Object.values(waffo.productIds).every(Boolean) && (waffo.environment !== "live" || /^[0-9a-f]{64}$/i.test(waffo.livePrivateKeySha256 || ""))),
      paddle: Boolean(paddle.apiKey && paddle.webhookSecret && paddle.monthlyPriceId && paddle.yearlyPriceId && Deno.env.get("PADDLE_CLIENT_TOKEN")),
      wechat: wechat.environment === "live" && Boolean(wechat.appId && wechat.merchantId && wechat.merchantSerial && wechat.merchantPrivateKey && wechat.platformKeyId && wechat.platformPublicKey && new TextEncoder().encode(wechat.apiV3Key).byteLength === 32),
      alipay: Boolean(alipay.appId && alipay.sellerId && alipay.privateKey && alipay.publicKey)
    };
  }
  function waffoCheckoutVerified(policy, configured, now = Date.now()) {
    const launch = Date.parse(String(policy.launch_at));
    return billingEnvironment() === "live" && configured && policy.phase === "active" && Number.isFinite(launch) && launch <= now && Deno.env.get("TOKENTRACKER_WAFFO_LIVE_CHECKOUT_VERIFIED") === "true";
  }
  function waffoConfig() {
    const privateKey = Deno.env.get("WAFFO_PRIVATE_KEY") || "";
    const environment = billingEnvironment();
    return {
      environment,
      merchantId: Deno.env.get("WAFFO_MERCHANT_ID") || "",
      storeId: Deno.env.get("WAFFO_STORE_ID") || "",
      privateKey,
      ...environment === "live" ? { livePrivateKeySha256: Deno.env.get("WAFFO_LIVE_PRIVATE_KEY_SHA256") } : {},
      checkoutPage: `${billingSiteUrl()}/billing/checkout`,
      productIds: {
        cloud_usd_monthly: Deno.env.get("WAFFO_CLOUD_MONTHLY_PRODUCT_ID") || "",
        cloud_usd_yearly: Deno.env.get("WAFFO_CLOUD_YEARLY_PRODUCT_ID") || "",
        cloud_usd_monthly_fixed: Deno.env.get("WAFFO_CLOUD_MONTHLY_PASS_PRODUCT_ID") || "",
        cloud_usd_yearly_fixed: Deno.env.get("WAFFO_CLOUD_YEARLY_PASS_PRODUCT_ID") || ""
      }
    };
  }
  function billingSiteUrl() {
    const value = Deno.env.get("TOKENTRACKER_BILLING_SITE_URL") || "https://www.tokentracker.cc";
    const url = new URL(value);
    if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
      throw new BillingError("billing_configuration_invalid", 503);
    }
    return url.origin;
  }
  function billingClient() {
    const baseUrl = Deno.env.get("INSFORGE_BASE_URL");
    const edgeFunctionToken = Deno.env.get("INSFORGE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("INSFORGE_ANON_KEY") || Deno.env.get("ANON_KEY");
    if (!baseUrl || !edgeFunctionToken || !anonKey) throw new BillingError("billing_not_configured", 503);
    return (0, import_sdk_1_4.createClient)({ baseUrl, edgeFunctionToken, anonKey, headers: { apikey: anonKey } });
  }
  async function signedInUser(req) {
    return await billingUserId(req.headers.get("Authorization"), {
      jwtSecret: Deno.env.get("JWT_SECRET"),
      jwtPublicKey: Deno.env.get("JWT_PUBLIC_KEY")
    });
  }
  async function rpc(client2, name, data) {
    const result = await client2.database.rpc(name, data);
    if (result.error) {
      const message = result.error.message || "";
      const code = message.includes("self-hosted access is free") ? "self_hosted_free" : message.includes("gift_membership_active") ? "gift_membership_active" : message.includes("payment conflict must be resolved") ? "payment_conflict" : message.includes("previous retry order has a successful payment") || message.includes("paid Waffo order cannot be restarted") ? "checkout_already_paid" : message.includes("existing checkout") ? "pending_checkout_exists" : message.includes("existing subscription") ? "subscription_already_exists" : message.includes("fixed membership term") ? "fixed_term_still_active" : message.includes("before the first purchase") ? "trial_unavailable" : message.includes("trial has not launched") ? "trial_not_launched" : message.includes("different purchase") || message.includes("retry request already belongs") ? "checkout_request_conflict" : "billing_operation_failed";
      throw new BillingError(code, code === "billing_operation_failed" ? 503 : 409);
    }
    return object(result.data);
  }
  function failure(error) {
    if (error instanceof BillingError) return json({ error: error.code }, error.status);
    console.error("cloud-billing: operation failed");
    return json({ error: "billing_operation_failed" }, 503);
  }
  async function body(req) {
    const contentLength = Number(req.headers.get("Content-Length") || 0);
    if (contentLength > 16384) throw new BillingError("request_too_large", 413);
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > 16384) throw new BillingError("request_too_large", 413);
    try {
      return object(JSON.parse(raw));
    } catch {
      throw new BillingError("invalid_request");
    }
  }
  function preflight(req) {
    return req.method === "OPTIONS" ? new Response(null, { status: 204, headers: cors }) : null;
  }

  // dashboard/edge-patches/cloud/waffo-processing.ts
  async function reconcileWaffoOrder(client2, order, config, notification) {
    const bindings = await queryWaffoBindings(order, config);
    const notificationData = notification ? object(notification.data) : null;
    const binding = notificationData ? bindings.find((value) => value.waffo_order_id === notificationData.orderId) : null;
    if (notification) {
      const data = object(notification.data);
      if (!bindings.length) throw new BillingError("waffo_notification_pending", 503);
      if (!binding || data.orderMerchantExternalId !== order.id) {
        throw new BillingError("ambiguous_payment_binding", 409);
      }
    }
    for (const attempt of bindings) {
      await rpc(client2, "cloud_register_waffo_attempt", {
        p_order_id: order.id,
        p_environment: order.environment,
        p_waffo_order_id: attempt.waffo_order_id,
        p_provider_price_id: attempt.provider_price_id,
        p_billing_mode: order.billing_mode
      });
    }
    async function record(period2) {
      await rpc(client2, "cloud_record_waffo_period", {
        p_order_id: order.id,
        p_environment: order.environment,
        p_waffo_order_id: text(period2.waffo_order_id),
        p_provider_price_id: text(period2.provider_price_id),
        p_period_number: period2.period_number,
        p_starts_at: isoDate(period2.starts_at),
        p_ends_at: isoDate(period2.ends_at)
      });
    }
    for (const attempt of bindings) if (attempt.current_period) await record(attempt.current_period);
    const periods = [];
    for (let offset = 0; ; offset += 100) {
      const result = await client2.database.from("tokentracker_cloud_waffo_periods").select("waffo_order_id,period_number,starts_at,ends_at").eq("order_id", order.id).eq("environment", order.environment).order("waffo_order_id").order("period_number").range(offset, offset + 99);
      if (result.error) throw new BillingError("billing_operation_failed", 503);
      const page = result.data || [];
      periods.push(...page);
      if (page.length < 100) break;
    }
    for (const attempt of bindings) {
      if (attempt.current_period && !periods.some((period2) => period2.waffo_order_id === attempt.waffo_order_id && period2.period_number === attempt.current_period?.period_number)) {
        periods.push(attempt.current_period);
      }
    }
    if (notification && order.billing_mode === "recurring" && !["subscription.past_due", "subscription.canceled", "subscription.canceling", "subscription.uncanceled"].includes(String(notification.eventType))) {
      const data = object(notification.data);
      if (data.currentPeriodStart && data.currentPeriodEnd && Number.isInteger(data.periodNumber) && Number(data.periodNumber) > 0) {
        const starts = text(data.currentPeriodStart);
        const ends = text(data.currentPeriodEnd);
        const known = periods.find((period2) => period2.period_number === data.periodNumber && period2.waffo_order_id === data.orderId);
        const matches = (received, verified) => /^\d{4}-\d{2}-\d{2}$/.test(received) ? received === isoDate(verified).slice(0, 10) : isoDate(received) === isoDate(verified);
        if (known) {
          if (!matches(starts, known.starts_at) || !matches(ends, known.ends_at)) {
            throw new BillingError("waffo_billing_period_conflict", 409);
          }
        } else {
          if (/^\d{4}-\d{2}-\d{2}$/.test(starts) || /^\d{4}-\d{2}-\d{2}$/.test(ends)) {
            throw new BillingError("waffo_billing_period_pending", 503);
          }
          const period2 = {
            waffo_order_id: text(data.orderId),
            provider_price_id: waffoProductId(order, config),
            period_number: Number(data.periodNumber),
            starts_at: starts,
            ends_at: ends
          };
          await record(period2);
          periods.push(period2);
        }
      }
    }
    const events = await queryWaffoOrder(order, config, fetch, periods);
    if (notification) {
      const data = object(notification.data);
      const type = String(notification.eventType);
      const expected = type === "refund.succeeded" ? "refund" : ["order.completed", "subscription.payment_succeeded"].includes(type) ? "payment" : "subscription";
      if (type !== "refund.failed") {
        const action = expected === "refund" ? data.refundId || notification.eventId : expected === "payment" ? data.paymentId || notification.eventId : null;
        if (!events.some((event) => (event.kind === expected || expected === "payment" && event.kind === "authorization") && event.waffo_order_id === data.orderId && (action === null || event.action_id === action))) {
          throw new BillingError("waffo_notification_pending", 503);
        }
        if (expected === "subscription" && type.startsWith("subscription.")) {
          const current = events.find((event) => event.kind === "subscription" && event.waffo_order_id === data.orderId);
          const matchedPeriod = Number.isInteger(data.periodNumber) && Number(data.periodNumber) > 0 ? current?.period_number === data.periodNumber : true;
          if (type === "subscription.renewed" && (!Number.isInteger(data.periodNumber) || !events.some((event) => event.kind === "payment" && event.waffo_order_id === data.orderId && event.period_number === data.periodNumber))) {
            throw new BillingError("waffo_notification_pending", 503);
          }
          const reflects = current && (type === "subscription.canceling" ? current.status === "active" && current.cancel_at_period_end === true : type === "subscription.canceled" ? current.status === "canceled" : type === "subscription.past_due" ? current.status === "past_due" : ["subscription.activated", "subscription.recovered", "subscription.renewed"].includes(type) ? current.status === "active" && matchedPeriod : type === "subscription.uncanceled" ? current.status === "active" && current.cancel_at_period_end === false : false);
          if (!current || !reflects && Date.parse(current.occurred_at) < Date.parse(isoDate(notification.timestamp))) {
            throw new BillingError("waffo_notification_pending", 503);
          }
        }
      }
    }
    for (const event of events) if (event.kind === "authorization") {
      await rpc(client2, "cloud_record_waffo_authorization", { p_environment: order.environment, p_event: event });
    }
    const financial = events.filter((event) => event.kind !== "authorization");
    for (let offset = 0; offset < financial.length; offset += 100) {
      await rpc(client2, "cloud_apply_waffo_events", {
        p_environment: order.environment,
        p_events: financial.slice(offset, offset + 100)
      });
    }
    return events.some((event) => event.kind === "payment");
  }

  // dashboard/edge-patches/cloud/gifts.ts
  init_contracts();
  async function giftCodeHash(value) {
    if (typeof value !== "string" || value.length > 256 || /[^\x00-\x7f]/.test(value)) return null;
    const canonical = value.replace(/[- \t\r\n\f\v]/g, "").toUpperCase();
    if (!/^TTPRO[0-9A-F]{32}$/.test(canonical)) return null;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  function missingGiftRpc(error, name) {
    const message = String(error.message || "");
    return (error.code === "PGRST202" || error.code === "42883") && message.includes(name);
  }
  async function giftAccount(client2, userId, environment) {
    const result = await client2.database.rpc("cloud_gift_account", { p_user_id: userId, p_environment: environment });
    if (result.error) {
      if (missingGiftRpc(object(result.error), "cloud_gift_account")) {
        return { gifts: [], gift_redemption_available: false };
      }
      throw new BillingError("billing_operation_failed", 503);
    }
    return object(result.data);
  }
  async function redeemGift(client2, userId, environment, code, requestId) {
    const result = await client2.database.rpc("cloud_redeem_gift", {
      p_user_id: userId,
      p_environment: environment,
      p_code_hash: await giftCodeHash(code),
      p_request_id: requestId
    });
    if (result.error) {
      if (missingGiftRpc(object(result.error), "cloud_redeem_gift")) throw new BillingError("gift_not_available", 503);
      throw new BillingError("billing_operation_failed", 503);
    }
    const data = object(result.data);
    if (data.ok === false) return { status: Number(data.status) || 400, data: { error: data.code, retry_after: data.retry_after } };
    if (data.ok !== true || !data.gift || !data.membership) throw new BillingError("billing_operation_failed", 503);
    return { status: 200, data: { gift: data.gift, membership: data.membership, already_redeemed: data.reused === true } };
  }

  // dashboard/edge-patches/cloud/gift-expired-orders.ts
  init_contracts();
  async function closeExpiredUnusedGiftOrders(client2, userId, environment, config) {
    const result = await client2.database.from("tokentracker_cloud_orders").select("*").eq("user_id", userId).eq("environment", environment).in("status", ["pending", "ready"]).order("created_at", { ascending: true }).limit(10);
    if (result.error) throw new BillingError("billing_operation_failed", 503);
    let closed = false;
    for (const value of result.data || []) {
      const order = value;
      if (order.user_id !== userId || order.environment !== environment || order.provider !== "waffo") continue;
      if (!await confirmExpiredUnusedWaffoCheckout(order, config)) continue;
      const latest = await rpc(client2, "cloud_close_unpaid_order", { p_user_id: userId, p_order_id: order.id });
      if (latest.status === "closed") closed = true;
    }
    return closed;
  }

  // dashboard/edge-patches/tokentracker-billing.ts
  init_contracts();

  // dashboard/edge-patches/cloud/paddle.ts
  init_contracts();
  init_cryptography();
  function paddleApiUrl(environment) {
    return environment === "sandbox" ? "https://sandbox-api.paddle.com" : "https://api.paddle.com";
  }
  function priceId(order, config) {
    return order.provider_price_id || (order.term_months === 12 ? config.yearlyPriceId : config.monthlyPriceId);
  }
  async function paddleRequest(path2, config, request2, value) {
    if (!config.apiKey) throw new BillingError("paddle_not_configured", 503);
    const response = await request2(`${paddleApiUrl(config.environment)}${path2}`, {
      method: value === void 0 ? "GET" : "POST",
      signal: AbortSignal.timeout(15e3),
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "Paddle-Version": "1"
      },
      ...value === void 0 ? {} : { body: JSON.stringify(value) }
    });
    return object((await providerJson(response)).data);
  }
  function assertPrice(price, order, config) {
    const unit = object(price.unit_price);
    const cycle = object(price.billing_cycle);
    if (price.id !== priceId(order, config) || unit.currency_code !== order.currency || cents(unit.amount) !== order.amount_cents || cycle.frequency !== 1 || cycle.interval !== (order.term_months === 12 ? "year" : "month")) {
      throw new BillingError("payment_price_mismatch");
    }
  }
  function assertTransaction(data, order, config) {
    assertPaddleOrder(order, config);
    const custom = object(data.custom_data);
    if (custom.tokentracker_order_id !== order.id || custom.tokentracker_user_id !== order.user_id) {
      throw new BillingError("payment_account_mismatch");
    }
    if (data.currency_code !== order.currency || data.collection_mode !== "automatic") throw new BillingError("payment_currency_mismatch");
    if (!Array.isArray(data.items) || data.items.length !== 1) {
      throw new BillingError("payment_items_mismatch");
    }
    const item = object(data.items[0]);
    if (item.quantity !== 1 || item.proration != null) {
      throw new BillingError("payment_price_mismatch");
    }
    assertPrice(object(item.price), order, config);
    if (data.discount_id != null) {
      throw new BillingError("payment_amount_mismatch");
    }
  }
  async function queryPaddleOrder(order, config, request2 = fetch) {
    assertPaddleOrder(order, config);
    if (!order.provider_order_id) {
      throw new BillingError("checkout_confirmation_pending", 409);
    }
    const data = await paddleRequest(
      `/transactions/${encodeURIComponent(order.provider_order_id)}`,
      config,
      request2
    );
    if (data.id !== order.provider_order_id) {
      throw new BillingError("payment_order_mismatch");
    }
    assertTransaction(data, order, config);
    return data;
  }
  async function queryPaddleSubscription(order, subscriptionId, config, request2 = fetch) {
    assertPaddleOrder(order, config);
    const data = await paddleRequest(
      `/subscriptions/${encodeURIComponent(text(subscriptionId))}`,
      config,
      request2
    );
    if (data.id !== subscriptionId) {
      throw new BillingError("payment_order_mismatch");
    }
    const custom = object(data.custom_data);
    if (custom.tokentracker_order_id !== order.id || custom.tokentracker_user_id !== order.user_id) throw new BillingError("payment_account_mismatch");
    return data;
  }
  async function createPaddlePortal(order, subscriptionId, config, request2 = fetch) {
    const subscription = await queryPaddleSubscription(
      order,
      subscriptionId,
      config,
      request2
    );
    const customerId = text(subscription.customer_id);
    const session = await paddleRequest(
      `/customers/${encodeURIComponent(customerId)}/portal-sessions`,
      config,
      request2,
      { subscription_ids: [subscriptionId] }
    );
    if (session.customer_id !== customerId) {
      throw new BillingError("payment_account_mismatch");
    }
    const url = text(object(object(session.urls).general).overview, 8192);
    const parsed = new URL(url);
    const host = config.environment === "sandbox" ? "sandbox-customer-portal.paddle.com" : "customer-portal.paddle.com";
    if (parsed.protocol !== "https:" || parsed.hostname !== host) {
      throw new BillingError("invalid_provider_portal_url", 502);
    }
    return url;
  }
  async function cancelPaddleSubscription(order, subscriptionId, config, request2 = fetch) {
    const current = await queryPaddleSubscription(
      order,
      subscriptionId,
      config,
      request2
    );
    if (current.status === "canceled" || current.scheduled_change != null && object(current.scheduled_change).action === "cancel") return current;
    const data = await paddleRequest(
      `/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
      config,
      request2,
      { effective_from: current.status === "paused" ? "immediately" : "next_billing_period" }
    );
    const custom = object(data.custom_data);
    if (data.id !== subscriptionId || custom.tokentracker_order_id !== order.id || custom.tokentracker_user_id !== order.user_id || data.status !== "canceled" && object(data.scheduled_change).action !== "cancel") throw new BillingError("subscription_cancellation_pending", 502);
    return data;
  }
  async function normalizePaddleEvent(payload, config, resolver) {
    const event = object(payload);
    const type = text(event.event_type);
    if (type !== "transaction.completed" && !type.startsWith("subscription.") && type !== "adjustment.created" && type !== "adjustment.updated") return null;
    const data = object(event.data);
    const eventId = text(event.event_id);
    const occurredAt = isoDate(
      type.startsWith("subscription.") ? data.updated_at || event.occurred_at : event.occurred_at
    );
    if (type.startsWith("adjustment.")) {
      if (data.status !== "approved" || !["refund", "chargeback"].includes(String(data.action))) return null;
      const transactionId = text(data.transaction_id);
      const order2 = await resolver.transactionOrder(transactionId);
      assertPaddleOrder(order2, config);
      if (data.currency_code !== order2.currency) {
        throw new BillingError("payment_currency_mismatch");
      }
      return {
        event_id: eventId,
        kind: "refund",
        action_id: text(data.id),
        order_id: order2.id,
        occurred_at: occurredAt,
        transaction_id: transactionId,
        currency: order2.currency,
        amount_cents: cents(object(data.totals).total)
      };
    }
    const custom = object(data.custom_data);
    const order = await resolver.order(uuid(custom.tokentracker_order_id));
    assertPaddleOrder(order, config);
    if (custom.tokentracker_user_id !== order.user_id) {
      throw new BillingError("payment_account_mismatch");
    }
    const items = data.items;
    if (!Array.isArray(items) || items.length !== 1) {
      throw new BillingError("payment_items_mismatch");
    }
    const item = object(items[0]);
    const price = object(item.price);
    if (item.quantity !== 1 || price.id !== priceId(order, config)) {
      throw new BillingError("payment_price_mismatch");
    }
    assertPrice(price, order, config);
    if (type === "transaction.completed") {
      assertTransaction(data, order, config);
      if (data.status !== "completed" || data.currency_code !== order.currency) {
        throw new BillingError("payment_not_completed");
      }
      const totals = object(object(data.details).totals);
      if (totals.currency_code !== order.currency || cents(totals.subtotal) !== order.amount_cents || cents(totals.discount) !== 0 || cents(totals.credit) !== 0) throw new BillingError("payment_amount_mismatch");
      const period2 = object(data.billing_period);
      return {
        event_id: eventId,
        kind: "payment",
        action_id: text(data.id),
        order_id: order.id,
        occurred_at: occurredAt,
        subscription_id: text(data.subscription_id),
        currency: order.currency,
        base_amount_cents: order.amount_cents,
        amount_cents: cents(totals.grand_total),
        starts_at: isoDate(period2.starts_at),
        ends_at: isoDate(period2.ends_at)
      };
    }
    if (!["active", "canceled", "past_due", "paused", "trialing"].includes(
      String(data.status)
    )) {
      throw new BillingError("invalid_subscription_status");
    }
    const scheduled = data.scheduled_change == null ? null : object(data.scheduled_change);
    return {
      event_id: eventId,
      kind: "subscription",
      action_id: eventId,
      order_id: order.id,
      occurred_at: occurredAt,
      subscription_id: text(data.id),
      status: String(data.status),
      cancel_at_period_end: scheduled?.action === "cancel",
      next_billed_at: data.next_billed_at == null ? null : isoDate(data.next_billed_at)
    };
  }
  function assertPaddleOrder(order, config) {
    if (order.provider !== "paddle" || order.environment !== config.environment || order.currency !== "USD") {
      throw new BillingError("payment_order_mismatch");
    }
  }

  // dashboard/edge-patches/tokentracker-billing.ts
  init_wechat();
  async function billing(req) {
    const options = preflight(req);
    if (options) return options;
    try {
      if (req.method !== "GET" && req.method !== "POST") {
        throw new BillingError("method_not_allowed", 405);
      }
      const url = new URL(req.url);
      const action = url.searchParams.get("action") || "account";
      const client2 = billingClient();
      const environment = billingEnvironment();
      if (action === "catalog" && req.method === "GET") {
        const [catalog, policy] = await Promise.all([
          client2.database.from("tokentracker_cloud_catalog").select(
            "sku,currency,amount_cents,term_months,billing_mode"
          ).eq("active", true),
          client2.database.from("tokentracker_cloud_policy").select(
            "phase,launch_at,hosting_mode"
          ).eq("environment", environment).single()
        ]);
        if (catalog.error || policy.error) {
          throw new BillingError("billing_operation_failed", 503);
        }
        const selfHosted = object(policy.data).hosting_mode === "self_hosted";
        const providers = selfHosted ? { waffo: false, paddle: false, wechat: false, alipay: false } : configuredProviders();
        return json({
          environment,
          policy: policy.data,
          prices: selfHosted ? [] : catalog.data,
          providers,
          checkout_verified: waffoCheckoutVerified(object(policy.data), providers.waffo),
          paddle_client_token: providers.paddle ? Deno.env.get("PADDLE_CLIENT_TOKEN") : null,
          limits: {
            machines: selfHosted ? null : 99,
            sync_minutes: selfHosted ? 0 : 15,
            hourly_history_days: selfHosted ? null : 90,
            daily_history_months: selfHosted ? null : 24,
            trial_days: selfHosted ? 0 : 7
          }
        });
      }
      const userId = await signedInUser(req);
      async function checkoutPolicy() {
        const result = await client2.database.from("tokentracker_cloud_policy").select("phase,launch_at,hosting_mode").eq("environment", environment).single();
        const policy = result.error ? {} : object(result.data);
        if (policy.hosting_mode === "self_hosted") throw new BillingError("self_hosted_free", 409);
        const launch = Date.parse(String(policy.launch_at));
        if (result.error || policy.phase !== "active" || !Number.isFinite(launch) || launch > Date.now()) {
          throw new BillingError("checkout_not_launched", 503);
        }
      }
      async function ownedOrder(id) {
        const result = await client2.database.from("tokentracker_cloud_orders").select("*").eq("id", id).eq("user_id", userId).eq("environment", environment).maybeSingle();
        if (result.error) throw new BillingError("billing_operation_failed", 503);
        if (!result.data) throw new BillingError("order_not_found", 404);
        return object(result.data);
      }
      if (action === "account" && req.method === "GET") {
        const [membership, payments, subscriptions, orders, conflicts, gifts, machines] = await Promise.all([
          rpc(client2, "cloud_membership", {
            p_user_id: userId,
            p_environment: environment
          }),
          client2.database.from("tokentracker_cloud_payments").select(
            "id,provider,currency,amount_cents,refunded_cents,starts_at,ends_at,paid_at"
          ).eq("user_id", userId).eq("environment", environment).order(
            "paid_at",
            { ascending: false }
          ).limit(20),
          client2.database.from("tokentracker_cloud_subscriptions").select("provider,provider_subscription_id,status,cancel_at_period_end,next_billed_at").eq("user_id", userId).eq("environment", environment),
          client2.database.from("tokentracker_cloud_orders").select(
            "id,provider,sku,currency,amount_cents,billing_mode,status,created_at,expires_at,checkout_url,retry_payment_conflict_at"
          ).eq("user_id", userId).eq("environment", environment).in("status", [
            "pending",
            "ready"
          ]).order("created_at", { ascending: false }).limit(10),
          client2.database.from("tokentracker_cloud_orders").select("id,provider,sku,currency,amount_cents,billing_mode,status,retry_payment_conflict_at").eq("user_id", userId).eq("environment", environment).not("retry_payment_conflict_at", "is", null).order("created_at", { ascending: false }).limit(20),
          giftAccount(client2, userId, environment),
          // Soft-fail: account must stay usable if device listing is unavailable.
          // Reuse list_machines so Cloud CTAs can target multi-device accounts
          // from the same account response the dashboard already loads.
          rpc(client2, "cloud_list_machines", {
            p_user_id: userId,
            p_environment: environment,
            p_current_machine_id: null
          }).catch(() => null)
        ]);
        if (payments.error || subscriptions.error || orders.error || conflicts.error) {
          throw new BillingError("billing_operation_failed", 503);
        }
        const machineCount = Number(machines?.machine_count);
        return json({
          environment,
          membership,
          ...Number.isFinite(machineCount) ? { machine_count: machineCount } : {},
          payments: payments.data,
          subscriptions: subscriptions.data,
          pending_orders: orders.data,
          conflict_orders: conflicts.data,
          ...gifts
        });
      }
      if (action === "redeem-gift" && req.method === "POST") {
        const input = await body(req);
        const requestId = uuid(input.request_id);
        let result = await redeemGift(client2, userId, environment, input.code, requestId);
        if (result.status === 409 && result.data.error === "gift_checkout_pending" && await closeExpiredUnusedGiftOrders(client2, userId, environment, waffoConfig())) {
          result = await redeemGift(client2, userId, environment, input.code, requestId);
        }
        const response = json(result.data, result.status);
        if (result.status === 429) response.headers.set("Retry-After", String(object(result.data).retry_after || 900));
        return response;
      }
      if (action === "trial" && req.method === "POST") {
        return json({
          membership: await rpc(client2, "cloud_start_trial", {
            p_user_id: userId,
            p_environment: environment
          })
        });
      }
      if (action === "devices" && req.method === "GET") {
        return json(
          await rpc(client2, "cloud_list_machines", {
            p_user_id: userId,
            p_environment: environment,
            p_current_machine_id: url.searchParams.get("current_machine_id")
          })
        );
      }
      if ((action === "remove-device" || action === "resume-device") && req.method === "POST") {
        const input = await body(req);
        const result = await rpc(
          client2,
          action === "remove-device" ? "cloud_remove_machine" : "cloud_resume_machine",
          {
            p_user_id: userId,
            p_environment: environment,
            p_machine_id: uuid(input.machine_id)
          }
        );
        if (result.ok === false) {
          return json({
            error: result.code,
            membership: result.membership,
            recovery_url: result.recovery_url
          }, Number(result.status) || 409);
        }
        return json(result);
      }
      if (action === "order" && req.method === "GET") {
        const id = uuid(url.searchParams.get("id"));
        const result = await client2.database.from("tokentracker_cloud_orders").select(
          "id,provider,sku,currency,amount_cents,billing_mode,status,checkout_url,expires_at,provider_order_id,retry_payment_conflict_at"
        ).eq("id", id).eq("user_id", userId).eq("environment", environment).maybeSingle();
        if (result.error) throw new BillingError("billing_operation_failed", 503);
        if (!result.data) throw new BillingError("order_not_found", 404);
        const { provider_order_id, ...order } = object(result.data);
        let paymentState = "unpaid";
        if (provider_order_id) {
          const payment = await client2.database.from(
            "tokentracker_cloud_payments"
          ).select("amount_cents,refunded_cents").eq("order_id", id).eq("user_id", userId).eq(
            "environment",
            environment
          ).eq("transaction_id", provider_order_id).maybeSingle();
          if (payment.error) {
            throw new BillingError("billing_operation_failed", 503);
          }
          if (payment.data) {
            const amount = object(payment.data);
            paymentState = amount.refunded_cents === amount.amount_cents ? "refunded" : Number(amount.refunded_cents) > 0 ? "partially_refunded" : "paid";
          }
        }
        return json({
          order: { ...order, payment_state: paymentState },
          membership: await rpc(client2, "cloud_membership", {
            p_user_id: userId,
            p_environment: environment
          })
        });
      }
      if (action === "restart-checkout" && req.method === "POST") {
        await checkoutPolicy();
        const input = await body(req);
        const requestId = uuid(input.request_id);
        const old = await ownedOrder(uuid(input.id));
        if (old.provider !== "waffo" || !configuredProviders().waffo) {
          throw new BillingError("payment_provider_not_configured", 503);
        }
        let next;
        if (old.retry_order_id) {
          next = await ownedOrder(old.retry_order_id);
        } else {
          if (old.status === "paid" || old.provider_order_id) throw new BillingError("checkout_already_paid", 409);
          const attempts = await queryWaffoBindings(old, waffoConfig());
          for (const attempt of attempts) await rpc(client2, "cloud_register_waffo_attempt", {
            p_order_id: old.id,
            p_environment: environment,
            p_waffo_order_id: attempt.waffo_order_id,
            p_provider_price_id: attempt.provider_price_id,
            p_billing_mode: old.billing_mode
          });
          const providerOrderIds = await closeUnpaidWaffoAttempts(old, waffoConfig());
          await reconcileWaffoOrder(client2, old, waffoConfig());
          const restarted = await rpc(client2, "cloud_restart_waffo_attempts", {
            p_user_id: userId,
            p_environment: environment,
            p_order_id: old.id,
            p_request_id: requestId,
            p_waffo_order_ids: providerOrderIds
          });
          next = object(restarted.order);
        }
        if (!["pending", "ready"].includes(next.status)) {
          return json({ order: { id: next.id, status: next.status } });
        }
        const target = new URL(req.url);
        target.searchParams.set("action", "checkout");
        return await billing(new Request(target, {
          method: "POST",
          headers: req.headers,
          body: JSON.stringify({ provider: "waffo", sku: next.sku, request_id: object(next).request_id })
        }));
      }
      if ((action === "portal" || action === "cancel") && req.method === "POST") {
        const input = await body(req);
        if (action === "portal" && !input.subscription_id) {
          const history = await client2.database.from("tokentracker_cloud_payments").select("id").eq("user_id", userId).eq("environment", environment).eq("provider", "waffo").limit(1);
          if (history.error) throw new BillingError("billing_operation_failed", 503);
          if (!history.data?.length) throw new BillingError("order_not_found", 404);
          return json({ url: "https://pancake.waffo.ai/consumer/portal/login" });
        }
        const subscriptionId = text(input.subscription_id);
        const sub = await client2.database.from("tokentracker_cloud_subscriptions").select("order_id").eq("environment", environment).eq(
          "user_id",
          userId
        ).eq("provider_subscription_id", subscriptionId).maybeSingle();
        if (sub.error) throw new BillingError("billing_operation_failed", 503);
        if (!sub.data) throw new BillingError("subscription_not_found", 404);
        const order = await ownedOrder(uuid(object(sub.data).order_id));
        if (order.provider === "waffo") {
          if (action === "portal") return json({ url: "https://pancake.waffo.ai/consumer/portal/login" });
          await cancelWaffoSubscription(order, subscriptionId, waffoConfig());
          await reconcileWaffoOrder(client2, order, waffoConfig());
          return json({ membership: await rpc(client2, "cloud_membership", {
            p_user_id: userId,
            p_environment: environment
          }) });
        }
        const config = paddleConfig();
        if (action === "portal") {
          return json({
            url: await createPaddlePortal(order, subscriptionId, config)
          });
        }
        const data = await cancelPaddleSubscription(
          order,
          subscriptionId,
          config
        );
        const stamp = text(data.updated_at);
        const event = await normalizePaddleEvent(
          {
            event_type: "subscription.updated",
            event_id: `query:${subscriptionId}:${stamp}`,
            occurred_at: stamp,
            data
          },
          config,
          { order: async () => order, transactionOrder: async () => order }
        );
        if (!event) {
          throw new BillingError("subscription_cancellation_pending", 503);
        }
        await rpc(client2, "cloud_apply_event", {
          p_provider: "paddle",
          p_environment: environment,
          p_event: event
        });
        return json({
          membership: await rpc(client2, "cloud_membership", {
            p_user_id: userId,
            p_environment: environment
          })
        });
      }
      if (action === "reconcile" && req.method === "POST") {
        const input = await body(req);
        const order = await ownedOrder(uuid(input.id));
        if (!configuredProviders()[order.provider]) {
          throw new BillingError("payment_provider_not_configured", 503);
        }
        const claim = await rpc(client2, "cloud_claim_reconciliation", {
          p_user_id: userId,
          p_order_id: order.id
        });
        if (!claim.claimed) {
          const result = json({
            error: "reconciliation_rate_limited",
            retry_after: claim.retry_after
          }, 429);
          result.headers.set("Retry-After", String(claim.retry_after));
          return result;
        }
        if (order.provider === "waffo") {
          const confirmed = await reconcileWaffoOrder(client2, order, waffoConfig());
          return json({ confirmed, membership: await rpc(client2, "cloud_membership", {
            p_user_id: userId,
            p_environment: environment
          }) });
        }
        let event;
        if (order.provider === "paddle") {
          const config = paddleConfig();
          const data = await queryPaddleOrder(order, config);
          if (data.status === "canceled") {
            await rpc(client2, "cloud_close_unpaid_order", {
              p_user_id: userId,
              p_order_id: order.id
            });
          }
          event = data.status === "completed" ? await normalizePaddleEvent(
            {
              event_type: "transaction.completed",
              event_id: `query:${text(data.id)}:payment`,
              occurred_at: data.updated_at,
              data
            },
            config,
            { order: async () => order, transactionOrder: async () => order }
          ) : null;
        } else if (order.provider === "wechat") {
          event = await queryWechatOrder(order, wechatConfig());
        } else {
          const { queryAlipayOrder: queryAlipayOrder2, normalizeAlipayQuery: normalizeAlipayQuery2 } = await Promise.resolve().then(() => (init_alipay2(), alipay_exports));
          const config = alipayConfig();
          event = normalizeAlipayQuery2(
            await queryAlipayOrder2(order, config),
            order,
            config
          );
        }
        if (event) {
          await rpc(client2, "cloud_apply_event", {
            p_provider: order.provider,
            p_environment: environment,
            p_event: event
          });
        }
        return json({
          confirmed: Boolean(event),
          membership: await rpc(client2, "cloud_membership", {
            p_user_id: userId,
            p_environment: environment
          })
        });
      }
      if (action === "checkout" && req.method === "POST") {
        const input = await body(req);
        const provider = text(input.provider);
        if (provider !== "waffo" || !configuredProviders().waffo) throw new BillingError("payment_provider_not_configured", 503);
        await checkoutPolicy();
        const order = await rpc(client2, "cloud_create_order", {
          p_user_id: userId,
          p_environment: environment,
          p_provider: provider,
          p_sku: text(input.sku),
          p_request_id: uuid(input.request_id)
        });
        if (order.expires_at && Date.parse(order.expires_at) <= Date.now()) {
          throw new BillingError("checkout_expired", 409);
        }
        if (!order.checkout_url && !order.provider_price_id) {
          const config = waffoConfig();
          await validateWaffoProduct(order, config);
          await rpc(client2, "cloud_attach_waffo_checkout", {
            p_user_id: userId,
            p_order_id: order.id,
            p_provider_checkout_id: null,
            p_provider_price_id: waffoProductId(order, config),
            p_checkout_url: null
          });
        }
        const claim = await rpc(client2, "cloud_claim_checkout", {
          p_user_id: userId,
          p_order_id: order.id
        });
        const current = object(claim.order);
        if (!["pending", "ready"].includes(current.status) || Date.parse(current.expires_at) <= Date.now()) {
          throw new BillingError("checkout_expired", 409);
        }
        if (current.checkout_url) {
          return json({
            order: {
              id: current.id,
              checkout_url: current.checkout_url,
              status: current.status
            }
          });
        }
        if (!claim.claimed && (current.status !== "pending" || !current.provider_price_id)) {
          return json({
            order: { id: current.id, status: current.status },
            pending: true
          }, 202);
        }
        let checkout;
        try {
          checkout = await createWaffoCheckout(current, waffoConfig());
        } catch {
          return json({
            order: { id: current.id, status: current.status },
            pending: true,
            error: "checkout_confirmation_pending"
          }, 202);
        }
        const attached = await rpc(client2, "cloud_attach_waffo_checkout", {
          p_user_id: userId,
          p_order_id: current.id,
          p_provider_checkout_id: checkout.sessionId || null,
          p_provider_price_id: checkout.priceId || null,
          p_checkout_url: checkout.checkoutUrl
        });
        return json({
          order: {
            id: attached.id,
            checkout_url: attached.checkout_url,
            status: attached.status
          }
        });
      }
      throw new BillingError("action_not_found", 404);
    } catch (error) {
      return failure(error);
    }
  }
  return __toCommonJS(tokentracker_billing_exports);
})();

    return await __selfHostHandler.default(req);
  })(Deno);
};
