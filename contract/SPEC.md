# 契约规范（Contract Specification）

本文件是**实现者契约**：任何想替代当前后端的实现（Go+SQLite 或其他）都必须满足它。
测试体系按此规范判定"一致"。

---

## 1. 被测实现必须提供的接口

### 1.1 Adapter 接口（供自动化调用）

每个实现提供一个 Node CommonJS 模块，导出：

```js
module.exports = {
  name: "go-sqlite",                    // 实现标识
  async start(config) -> Adapter,       // 启动一个隔离实例（全新空库）
  // Adapter:
  //   .request(slug, {method, query, headers, body, token}) -> {status, headers, body}
  //   .query(sql, params) -> rows      // 仅参考实现/调试用；Go 实现可返回 null
  //   .close()
  //   .info() -> {version, engine, ...}
};
```

`start()` 必须是**幂等且隔离**的：每次调用得到一个全新的空实例，用例之间不共享状态。
若实现无法提供隔离实例，则必须支持 `reset()`。

### 1.2 HTTP 端点契约

| 路径 | 方法 | 认证 | 说明 |
|---|---|---|---|
| `/functions/<slug>` | GET/POST | Bearer JWT 或 device token 或无 | 14 个私有函数；部分公开 |
| `/api/database/rpc/<fn>` | POST | service-role | SQL 函数 RPC（PostgREST 风格） |
| `/rest/v1/<table>` | GET/POST/PATCH | service-role | 表访问 |

**请求格式**：`Content-Type: application/json`；查询参数走 URL；POST body 为 JSON。
**响应格式**：`Content-Type: application/json`；body 为 JSON（对象或数组）。

### 1.3 14 个函数（slug 固定，不可改名）

```
tokentracker-device-flow-authorize   (public)
tokentracker-device-flow-poll       (public)
tokentracker-device-flow-grant
tokentracker-device-token-issue
tokentracker-device-rename
tokentracker-ingest
tokentracker-account-summary
tokentracker-account-daily
tokentracker-account-hourly
tokentracker-account-monthly
tokentracker-account-heatmap
tokentracker-account-model-breakdown
tokentracker-account-devices
tokentracker-billing
```

公开入口只有 `authorize` 和 `poll`；其余必须拒绝未认证请求。

### 1.4 认证模型

- JWT：`HS256`，claims `{sub: uuid, role, exp}`。
- 三种角色：`anon`、`authenticated`、`project_admin`（bypassrls）。
- device token：不透明字符串，服务端存 SHA-256 hash；用于 `ingest`。
- 伪造签名 / 过期 / 未知 token → `401`。

---

## 2. 用例格式

`scenarios/*.json` 是数组，每个元素：

```json
{
  "id": "03-ingest/idempotent-upload",
  "given": { "users": 1, "devices": 1, "tokens": 100, "hours": ["2026-10-01T12:00:00Z"] },
  "steps": [
    { "call": "tokentracker-ingest", "as": "device", "body": {"buckets": [...]},
      "expect": { "status": 200, "body": { ... } } }
  ],
  "capture": ["body.totals.total_tokens", "headers.content-type"]
}
```

- `given` 描述前置数据（用户/设备/用量），由 harness 用固定的确定性种子生成。
- `steps` 按顺序执行；`as` 指定身份：`owner` / `stranger` / `device` / `anon` / `forged` / `service`。
- `expect` 是可选的直接断言；**主要判据是录制的完整响应**。
- `capture` 指定要从响应里额外提取的字段（便于聚焦关键差异）。

### 确定性种子

所有随机值由 `CONTRACT_SEED`（默认 `tokentracker-contract-v1`）派生，用 HKDF/SHA-256 生成稳定的
UUID、machine_id、token。这样参考实现与 Go 实现能拿到**完全相同的输入**。

---

## 3. 归一化规则（Normalization）

录制与对比前，对响应做归一化，消除非语义差异。

| 类别 | 规则 |
|---|---|
| UUID | 按出现顺序映射为 `@uuid:1`、`@uuid:2`…（同一值保持一致） |
| 时间戳 | 绝对时间映射为 `@ts:1`…；或按 ISO 日期保留（若由输入固定） |
| 随机 token / code | 映射为 `@secret:1`… |
| 浮点 | 保留 6 位小数，`-0` → `0`，`NaN/Infinity` → 字符串标记 |
| 数组顺序 | 若字段标注为无序（如 `sources[].models`），按稳定键排序 |
| HTTP 头 | 只保留语义相关头（content-type、cache-control、access-control-*、content-encoding）；其余丢弃 |
| 空白 | JSON 结构化比较，忽略键顺序与空白 |

归一化后仍是 JSON，用**稳定序列化**（键排序）生成字符串，再计算 SHA-256。

---

## 4. 对比规则

对每个用例：

1. 用**相同的确定性输入**调用参考实现与候选实现。
2. 各自归一化。
3. 生成结构化 diff（路径 → 期望值 / 实际值）。
4. 判定：
   - **PASS**：归一化后完全一致。
   - **FAIL**：任何字段不一致。
   - **SKIP**：候选实现声明不支持该能力（必须在 `capabilities.json` 里显式声明并写理由，
     不能静默跳过；SKIP 会体现在报告里）。

### 允许的偏差（需显式登记）

某些差异是**有意为之**（例如 SQLite 没有 `timestamptz`，时间用 ISO 文本存储）。
这类偏差必须登记在 `contract/waivers.json`：

```json
{
  "waivers": [
    { "case": "07-aggregation/timezone-bucket", "path": "body.tz",
      "reason": "SQLite 无 timestamptz；Go 层用 UTC 文本等价实现", "approvedBy": "...", "date": "..." }
  ]
}
```

未登记的偏差一律 FAIL。

---

## 5. L1 静态契约（必须逐项一致）

由 `lib/static.cjs` 从 `releases/<version>/` 提取：

| 项 | 来源 | Go 实现要做什么 |
|---|---|---|
| 15 个安装步骤 id + `sha256(step.sql)` | `manifest-report.md` | 在 SQLite 里建等价 schema，步骤顺序固定 |
| 14 个函数 slug + 文件 + public 标记 | `functions/functions.json` | 实现同名端点 |
| 服务器密钥名清单 | `functions.json.serverSecrets` | 配置相同环境变量 |
| 排除项 | `functions.json.excluded` | 不实现付费 webhook / 排行榜 |
| 依赖锁定 | `manifest-report.md` 的依赖段 | 记录 Go 侧等价依赖 |
| SQL 对象清单（表/视图/函数/索引/触发器/策略） | `tokentracker-install.sql` 解析 | 建立等价对象（名字可不同，但要在映射表里登记） |
| 每步 SQL 的字节数与哈希 | `SHA256SUMS` | 作为改造前后的对照锚点 |

---

## 6. 实现者检查清单

Go+SQLite 实现者需要交付：

- [ ] `adapters/go-sqlite.cjs`（或等价 HTTP 服务 + 一个薄 adapter）
- [ ] `capabilities.json`：声明支持/不支持的用例
- [ ] `waivers.json`：登记所有有意偏差
- [ ] `mapping.json`：PG 对象 → SQLite 对象的映射（表名、类型、函数等价实现）
- [ ] 通过 `./contract/scripts/verify.sh`，报告 0 FAIL
- [ ] 若 SKIP 或 WAIVER 存在，在 `report.md` 里逐项说明

---

## 7. 不在契约范围内

以下属于平台职责，不由这套测试判定（见 `docs/database-choice.md`）：

- InsForge 平台自身的部署、HTTPS、OAuth、MCP。
- Deno worker 的 `new Function` 执行机制。
- 真实多连接下的 advisory lock 竞争（L3 单独 gate）。
- 前端 dashboard 的展示逻辑。

---

## 8. 版本与升级

- golden 快照按 `<上游版本>/` 目录存放。
- 升级上游时：先在 `releases/<new>/review.md` 里评审契约变化，再 `--update` 重新录制，
  用 `diff` 展示快照变化。**禁止直接覆盖 golden 而不评审**。
- 快照变化必须伴随 `CHANGELOG.md` 记录。
