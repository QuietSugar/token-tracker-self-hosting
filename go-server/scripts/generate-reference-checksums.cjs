#!/usr/bin/env node
// Generates PostgreSQLReferenceSteps from the committed L1 static contract.
// These are audit crosswalk values only; Store.Install does NOT apply PG migrations.
"use strict";
const fs=require("node:fs"),path=require("node:path"),cp=require("node:child_process");
const root=path.resolve(__dirname,"../..");
const ref=fs.readFileSync(path.join(root,"tracking/REF"),"utf8");
const version=ref.match(/^VERSION=(.*)$/m)[1].trim();
const file=path.join(root,"contract/golden",version,"static.json");
const data=JSON.parse(fs.readFileSync(file,"utf8"));
const lines=[
  "// Code generated from contract/golden/"+version+"/static.json — DO NOT EDIT.",
  "// PostgreSQL reference migration checksums are an audit crosswalk only.",
  "package store","",
  "// PostgreSQLReferenceSteps contains the upstream PG migration step IDs/checksums.",
  "// 它们只作为审计对照（audit crosswalk），不会被本服务执行——本服务用自己的",
  "// schema_migrations / schema_additions 账本，不伪造上游的 15-step 安装记录。",
  "var PostgreSQLReferenceSteps = []struct{ ID, Checksum string }{",
];
for(const s of data.steps.items) lines.push(`\t{${JSON.stringify(s.id)}, ${JSON.stringify(s.checksum)}},`);
lines.push("}");
const out=path.join(root,"go-server/internal/store/checksums.go");
fs.writeFileSync(out,lines.join("\n")+"\n");
cp.execFileSync("gofmt",["-w",out]);
console.log(`generated ${data.steps.items.length} PG reference steps -> ${path.relative(root,out)}`);
