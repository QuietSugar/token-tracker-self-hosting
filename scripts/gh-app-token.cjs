#!/usr/bin/env node
/**
 * 用 GitHub App 私钥换取 installation access token。
 *
 * 用法:
 *   GH_APP_ID=... GH_INSTALLATION_ID=... GH_APP_PRIVATE_KEY_PATH=... \
 *     node scripts/gh-app-token.cjs /absolute/path/to/token-file
 *
 * - 只把 token 写到指定文件（mode 600），stdout 只打印非敏感元数据。
 * - 私钥由 node:crypto 直接读取，不打印、不复制、不写日志。
 * - JWT: RS256，iat = now-60s，exp = now+600s，iss = App ID 或 Client ID。
 * - token 有效期 1 小时；每次推送都重新换取，不缓存。
 */
"use strict";
const fs = require("node:fs");
const crypto = require("node:crypto");

function die(msg) {
  console.error("ERROR: " + msg);
  process.exit(1);
}
const b64url = obj => Buffer.from(JSON.stringify(obj)).toString("base64url");
const redact = s => String(s).replace(/(ghs_|ghu_|ghs_|github_pat_|ghp_|gho_)[A-Za-z0-9_.=-]{20,}/g, "***REDACTED***");

async function main() {
  const appId = process.env.GH_APP_ID || process.env.GH_APP_CLIENT_ID || "";
  const installationId = process.env.GH_INSTALLATION_ID || "";
  const keyPath = process.env.GH_APP_PRIVATE_KEY_PATH || "";
  const outFile = process.argv[2];

  if (!appId) die("GH_APP_ID（或 GH_APP_CLIENT_ID）未设置");
  if (!installationId) die("GH_INSTALLATION_ID 未设置");
  if (!keyPath) die("GH_APP_PRIVATE_KEY_PATH 未设置");
  if (!outFile) die("用法: gh-app-token.cjs <输出文件>");
  if (!fs.existsSync(keyPath)) die("私钥文件不存在: " + keyPath);

  // 1) 生成 JWT
  const privateKey = fs.readFileSync(keyPath, "utf8");
  const now = Math.floor(Date.now() / 1000);
  const signingInput = `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url({ iat: now - 60, exp: now + 600, iss: appId })}`;
  let jwt;
  try {
    const sig = crypto.createSign("RSA-SHA256").update(signingInput).sign(privateKey).toString("base64url");
    jwt = `${signingInput}.${sig}`;
  } catch (e) {
    die("JWT 签名失败（私钥格式不对？）: " + e.message);
  }

  // 2) 换取 installation token
  const api = process.env.GITHUB_API_URL || "https://api.github.com";
  let resp, body;
  try {
    resp = await fetch(`${api}/app/installations/${installationId}/access_tokens`, {
      method: "POST",
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${jwt}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "tokentracker-selfhost-maintainer",
      },
      // 不传 body：token 继承 installation 已授予的全部权限与仓库范围。
      // 如需收窄，可在此加 { repositories: ["token-tracker-self-hosting"] }。
    });
    body = await resp.text();
  } catch (e) {
    die("请求 GitHub API 失败: " + e.message);
  }

  if (!resp.ok) {
    // 错误体可能包含诊断信息，但仍做脱敏
    console.error(`GitHub API ${resp.status}: ${redact(body).slice(0, 800)}`);
    process.exit(1);
  }

  let data;
  try { data = JSON.parse(body); } catch { die("响应不是合法 JSON"); }
  if (!data.token) die("响应缺少 token 字段: " + redact(body).slice(0, 300));

  fs.writeFileSync(outFile, data.token + "\n", { mode: 0o600 });
  console.log("installation token 已生成（内容未打印）");
  console.log("  过期时间 :", data.expires_at || "(未知)");
  console.log("  仓库范围 :", data.repository_selection || "(默认)");
  console.log("  权限     :", JSON.stringify(data.permissions || {}));
  console.log("  token 长度:", data.token.length, data.token.length > 100 ? "(无状态 ghs_APPID_JWT 格式)" : "(传统格式)");
}
main().catch(e => die(e.message));
