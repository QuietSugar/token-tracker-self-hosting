# 契约测试当前结果（v1.4.12）

> 自动生成物见 `self-test-report.md`（自测）与 `report.md`（候选实现）。
> 本文件是给人看的**状态摘要**，不参与自动化判定。

## 基准信息

| 项 | 值 |
|---|---|
| 上游版本 | 1.4.12 |
| 上游 commit | `8d32a956181bf52fae449c89b8f6520253566283` |
| 参考实现 | PostgreSQL (PGlite 0.5.10) + TypeScript/Deno 打包产物 |
| 录制时间 | 见 `golden/1.4.12/_meta.json` |
| 冻结时钟 | `2026-10-26T00:00:00Z`（`CONTRACT_NOW`） |
| 确定性种子 | `tokentracker-contract-v1` |
| 用例数 | **35**（8 组） |
| 步骤数 | **82** |
| golden 文件 | 39 个，348 KB，含 `SHA256SUMS` |

## 覆盖矩阵

| 组 | 用例 | 覆盖内容 |
|---|---:|---|
| install | 5 | 15 步 ledger、策略、幂等重装、校验和漂移拒绝、manifest 排除项 |
| device-flow | 3 | authorize→poll→grant→poll→ingest 全流程、自有 dashboard 锚点、未知 code |
| ingest | 6 | 幂等、整行修正、双设备、未认证拒绝、80 模型批量、超限拒绝 |
| account-reads | 4 | 7 个读接口空态/有数据 schema、跨用户隔离、缺失/非法参数 |
| policy | 5 | membership、7 设备免费、付费/试用被拒、未知账户、无支付行 |
| auth | 4 | 伪造/过期/匿名 token、设备撤销、RLS 权限矩阵、账户删除级联 |
| aggregation | 4 | 时区桶、缓存失效、周末 off-peak 定价、UTC vs 偏移 |
| billing | 4 | catalog、account、无商户密钥、未认证 |

## 静态契约（L1）提取结果

| 项 | 数量 |
|---|---:|
| 安装步骤 | 15 |
| 私有函数 | 14（2 个 public） |
| 表 | 24 |
| 视图 | 0 |
| SQL 函数 | 52 |
| 索引 | 15 |
| 触发器 | 8 |
| RLS 策略 | 4 |
| GRANT | 31 |
| `jsonb` 出现 | 160 |
| `timestamptz` 出现 | 199 |
| `pg_advisory_xact_lock` | 33 |

完整数据在 `golden/1.4.12/static.json`。**这是 Go+SQLite 改造的施工图**。

## 自测结果

```
[L1] 静态契约: ✓ 一致
[L2] 行为契约: 35 PASS / 0 FAIL / 0 SKIP / 0 waived
```

- 两次独立录制 `SHA256SUMS` **逐字节一致**（可复现性已验证）。
- 负向测试：篡改 golden 的一个字段后，对比器正确报 `FAIL` 并定位到 `$.steps[0].body.ok`。

## 性能基准（参考实现）

单位毫秒，整个 case 的 wall time（含实例启动）。3 轮采样。

| 用例 | p50 | p95 |
|---|---:|---:|
| account-summary（空） | 174.9 | 179.1 |
| account-summary（有数据） | 421.5 | 466.2 |
| ingest 单行 | 195.0 | 204.1 |
| ingest 80 模型批量 | 254.6 | 276.6 |
| model-breakdown | 351.9 | 373.8 |
| device-flow 全流程 | 276.4 | 279.4 |
| billing/account | 191.3 | 196.7 |

> PGlite 是单连接 WASM PG，绝对数值不代表生产。**用途是跨实现相对比值**。

## 已知限制

1. **PGlite 单连接**：不能证明真实多连接下的 advisory lock 竞争、并发上传串行化、事务隔离。这属于 L3，需要在真实 PostgreSQL 15.18 上单独跑（当前未自动化）。
2. **冻结时钟的边界**：`Date` shim 影响 Node 侧 `new Date()`，但 PGlite 的 `clock_timestamp()` 仍在 C 层。相关时间戳已通过归一化转成相对占位符，但若有新的时间字段出现，需重新检查归一化规则。
3. **归一化的盲区**：排序数组只在白名单键上做稳定排序；若新增无序 SQL 结果集字段，需加入 `UNORDERED_KEYS`。
4. **未覆盖的路径**：付费 webhook、社区排行榜、gzip 传输层、原生客户端回调、真实浏览器 OAuth —— 这些被有意排除在自托管契约之外。
5. **错误契约的粒度**：错误消息里的具体文本被完整录制；Go 实现若只想保证状态码，可以在 `waivers.json` 里登记，但必须评审。

## 改造者下一步

见 `SPEC.md §6` 检查清单。最关键是：

1. 读 `golden/1.4.12/static.json`，按 24 表 / 52 函数 / 15 索引建 SQLite 等价 schema，填 `mapping.json`。
2. 实现 `adapters/go-sqlite.cjs`（或 HTTP 服务 + 薄 adapter）。
3. `CONTRACT_ADAPTER=... ./contract/scripts/verify.sh` 跑到 0 FAIL。
4. 无法一致的项登记 `capabilities.json` / `waivers.json`，并在 `report.md` 逐项说明。
