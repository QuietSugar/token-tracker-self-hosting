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

完整数据在 `golden/1.4.12/static.json`。**这是 Go 后端改造的施工图**。

## 参考实现自测

```
[L1] 静态契约: ✓ 一致
[L2] 行为契约: 35 PASS / 0 FAIL / 0 SKIP / 0 waived
```

- 两次独立录制 `SHA256SUMS` **逐字节一致**（可复现性已验证）。
- 负向测试：篡改 golden 的一个字段后，对比器正确报 `FAIL` 并定位到具体 JSON path。
- 所有录制响应都是真实 handler + PGlite SQL 的 loopback HTTP，不是 mock。

## Go + PostgreSQL 实验实现（2026-10-26）

真实 adapter：`contract/adapters/go-postgres.cjs`（同一份 Go 代码，每个用例独立 schema）。

```
Go 1.27 工具链 + github.com/lib/pq 1.10.9 + PostgreSQL 16.2（真实服务，非 PGlite）
[L1] 静态参考契约: ✓ 一致（引用上游版本/step checksums；不是声称 Go 里有 PG 对象）
[L2] 行为契约: 33 PASS / 0 FAIL / 2 SKIP / 0 waived
```

- 与 SQLite adapter 共用同一批 golden、同一份 Go 代码，只有引擎不同：
  **同一实现、两种引擎行为一致**的交叉验证。
- 2 个 SKIP 与 SQLite 版相同（PG 15-step 安装账本 / step checksum 不属于本实现的账本）。
- CI 在 PostgreSQL **15 与 16** 上各跑一遍（`.github/workflows/go-server.yml`）。
- 设计与取舍（含"是否保留 SQLite"的成本分析）见 `../docs/go-postgres.md`。

## Go + SQLite 实验实现（2026-10-26）

真实 adapter：`contract/adapters/go-sqlite.cjs`；Go 服务：`go-server/`。

```
Go 1.24.4 + modernc.org/sqlite 1.34.5 (纯 Go/CGO=0)
[L1] 静态参考契约: ✓ 一致（引用上游版本/step checksums；不是声称 SQLite 里有 PG 对象）
[L2] 行为契约: 33 PASS / 0 FAIL / 2 SKIP / 0 waived
```

2 个 **显式 PG 专属 SKIP**：
- `install/ledger-15-steps`：Go/SQLite 不伪造 PostgreSQL 15 步 SQL 安装账本；它有自己的 `schema_migrations(version=1, sha256(schema))`。
- `install/checksum-drift-refused`：PG step SQL checksum 不变规则仅适用于 PG 安装器；SQLite 的 schema checksum drift 有独立 Go unit test。

**重要边界**：这是经过 33 个行为契约验证的**垂直切片**，不是完整 14-handler / 24-table 等价实现，也不是生产 GA。未覆盖的完整 schema、session-state、全部定价、备份恢复、抗压和客户端 E2E 见 `../go-server/STATUS.md`。

### Go+SQLite 相对性能（3 轮，case 含实例启动）

| 用例 | PGlite TS p50 | Go+SQLite p50 | 比值 |
|---|---:|---:|---:|
| account-summary（空） | 171.1 ms | 12.5 ms | 13.7× |
| account-summary（有数据） | 425.0 ms | 32.2 ms | 13.2× |
| ingest 单行 | 221.4 ms | 15.8 ms | 14.0× |
| ingest 80 模型批量 | 235.1 ms | 16.5 ms | 14.2× |
| model-breakdown | 379.2 ms | 17.7 ms | 21.4× |
| device-flow 全流程 | 255.4 ms | 16.6 ms | 15.4× |
| billing/account | 194.1 ms | 11.8 ms | 16.4× |

> 只能说明此沙箱与这些用例下 Go 子进程+SQLite 比 PGlite fixture 快；**不能推断生产 PG vs SQLite 性能**，也没测试高并发/大数据量。PGlite fixture 每 case 启一个完整 WASM DB，计时包含启动开销。

## L3 真实 PostgreSQL 并发测试（不属于 PGlite）

官方 InsForge v2.3.3 四容器栈 + PostgreSQL 15.18；真实多连接：

| 测试 | 结果 |
|---|---|
| 两个会话争抢 `pg_advisory_xact_lock`，第二会话等待 2.5 秒 | PASS |
| 8 个独立连接并发跑 15-step `install.sql` | PASS（8/8 exit 0，15 行唯一 ledger，0 错误） |
| 并发重装后 step checksum 与 golden 一致 | PASS |
| `anon` / `authenticated` 对 hourly 直接 SELECT/写 RPC 权限矩阵 | PASS（全部 false） |
| 10 个独立连接对同一主键并发 upsert | PASS（最终 1 行 / 100 tokens） |

详见 [`L3-RESULTS.md`](L3-RESULTS.md) 与 `./contract/scripts/standard-env-test.sh`。这补上了 PGlite 单连接无法证明的锁/并发语义。

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

1. **PGlite 仍是 L1/L2 参考录制器**，不能证明多连接锁；L3 已由单独的真实 PG 15.18 脚本覆盖基本 advisory lock / 并发重装 / upsert，但还不是持续压力/崩溃恢复测试。
2. **冻结时钟的边界**：`Date` shim 影响 Node 侧 `new Date()`，PGlite 的 `clock_timestamp()` 在 C 层；绝对时间戳按类型归一化。新增时间字段必须检查 normalize 规则。
3. **归一化的盲区**：无序 SQL 结果仅对白名单 key 稳定排序；不能把时间序列/排名数组误列入无序集。
4. **未覆盖路径**：付费 webhook、社区排行榜、gzip 传输层、原生客户端回调、真实浏览器 OAuth 被有意排除在本自托管后端契约外。
5. **候选实现范围**：Go+SQLite 当前 33 PASS / 2 PG-specific SKIP 仅覆盖 `go-server/STATUS.md` 的垂直切片，不是所有用户可观测行为，也不构成生产替换批准。
6. **错误契约粒度**：错误消息完整参与对比；有意差异需经 `waivers.json` 显式批准，不能只弱化成状态码断言。

## 改造者下一步

见 `SPEC.md §6` 检查清单。最关键是：

1. 读 `golden/1.4.12/static.json`，按 24 表 / 52 函数 / 15 索引建 SQLite 等价 schema，填 `mapping.json`。
2. 实现 `adapters/go-sqlite.cjs`（或 HTTP 服务 + 薄 adapter）。
3. `CONTRACT_ADAPTER=... ./contract/scripts/verify.sh` 跑到 0 FAIL。
4. 无法一致的项登记 `capabilities.json` / `waivers.json`，并在 `report.md` 逐项说明。
