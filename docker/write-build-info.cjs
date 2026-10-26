#!/usr/bin/env node
/**
 * 生成 /opt/tokentracker/BUILD.json（镜像内构建元数据）。
 * 从环境变量读取 Dockerfile build-args；SOURCE_DATE_EPOCH 保证时间可复现。
 */
"use strict";
const fs = require("node:fs");

const epoch = Number(process.env.SOURCE_DATE_EPOCH || 0) || Math.floor(Date.now() / 1000);
const info = {
  schemaVersion: 1,
  product: "tokentracker-selfhost-artifacts",
  version: process.env.VERSION || "unknown",
  upstream: {
    repository: "https://github.com/xiufengsun/TokenTracker.git",
    commit: process.env.UPSTREAM_COMMIT || "unknown",
  },
  vcsRef: process.env.VCS_REF || "unknown",
  builtAt: new Date(epoch * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
  platform: "linux/amd64",
  node: process.version,
  contents: { installSteps: 15, privateFunctions: 14 },
  sourceDateEpoch: epoch,
};
const target = "/opt/tokentracker/BUILD.json";
fs.writeFileSync(target, JSON.stringify(info, null, 2) + "\n", { mode: 0o644 });
fs.chownSync(target, 10001, 10001);
console.log(`BUILD.json written: ${info.version} @ ${info.upstream.commit.slice(0, 8)}`);
