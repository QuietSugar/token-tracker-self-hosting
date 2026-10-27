# 契约测试体系（Golden Master / Characterization Tests）

> **目的**：将当前 `PostgreSQL + TypeScript/Deno` 自托管后端中**已选定、可自动化的 HTTP 行为与静态契约**录制成
> 与实现语言、数据库引擎无关的黄金快照，作为 `SQLite + Golang` 迁移实验的对比基准。35 个场景并不覆盖全部用户可见行为；剩余范围列在 `../go-server/STATUS.md`。
> 所有流程可本地一键运行，也在 GitHub Actions 里自动化。

---

## 为什么需要这套东西

改造数据库和后端语言时，最容易出问题的不是"功能能不能跑"，而是**语义漂移**：

- 时区/夏令时边界的聚合结果差 1 小时；
- 浮点成本、整数舍入、null 与 0 的区别；
- 错误码、错误消息、HTTP 状态、CORS 头；
- 幂等性、整行修正（whole-row correction）、重复上传；
- 权限边界：谁能读、谁能写、JWT 过期/伪造；
- 排序、分页、空数组 vs null、字段名大小写。

这些靠"看代码"发现不了。所以做法是：**把参考实现当成黑盒，录制它的实际响应；
候选实现（Go + PostgreSQL）实现同样的 HTTP 接口后，跑同一批用例逐字段对比。**

参考实现运行器直接复用上游的 `test/helpers/self-host-fixture.cjs`：
它在 PGlite（PostgreSQL WASM 版）上安装 15 步基线，加载真实打包后的 14 个
async CommonJS handler，通过 loopback HTTP 提供 `/functions/<slug>` 与 PostgREST 风格的
`/api/database/rpc/`、`/rest/v1/` 端点。也就是说，**录到的不是 mock，是真实 SQL + 真实 handler 的输出**。

> PGlite 是单连接 WASM PG，只在这里作为"可复现的参考实现运行器"，
> 不能证明生产环境的并发/锁行为（见 `docs/database-choice.md`）。
> 并发语义另有专门的 L3 测试，需要在真实 PostgreSQL 上跑。

---

## 目录结构

```
contract/
├── README.md                  本文件
├── SPEC.md                    契约规范：接口、归一化、对比规则、实现者清单
├── scenarios/                 语言无关的用例定义（JSON）
│   ├── index.json             用例清单与执行顺序
│   ├── 01-install.json        安装/幂等/校验和
│   ├── 02-device-flow.json    设备授权全流程
│   ├── 03-ingest.json         上传、幂等、整行修正、边界
│   ├── 04-account-reads.json  7 个账户读取接口
│   ├── 05-policy.json         免费策略、配额、赠送码被拒
│   ├── 06-auth.json           认证边界、撤销、RLS
│   ├── 07-aggregation.json    时区/定价档/聚合
│   └── 08-billing.json        billing / catalog / devices
├── golden/
│   └── v1.4.12/               录制的参考快照（PG + TypeScript）
│       ├── _meta.json
│       ├── static.json        L1 静态契约
│       ├── *.case.json        L2 每个用例的响应
│       └── SHA256SUMS
├── lib/
│   ├── normalize.cjs          归一化（UUID/时间/随机 token/浮点）
│   ├── harness.cjs            参考实现运行器（包装上游 fixture）
│   ├── recorder.cjs           录制器
│   ├── runner.cjs             通用执行器（对任意实现）
│   ├── compare.cjs            对比器
│   ├── static.cjs             L1 静态契约提取
│   └── schema.cjs             快照结构校验
├── adapters/
│   ├── reference.cjs          PG+TS 参考实现适配器（已实现）
│   ├── go-postgres.cjs        Go 实验实现 × PostgreSQL adapter（已连接，每 case 独立 schema）
│   └── go-postgres.cjs        Go 实验实现 × PostgreSQL adapter（已连接，CI 跑 15/16）
├── scripts/
│   ├── record.sh              录制 golden
│   ├── verify.sh              对候选实现跑并对比
│   ├── self-test.sh           自测（用参考实现自己对比自己）
│   └── benchmark.sh           性能基准
└── report.md                  最近一次运行报告（自动生成）
```

---

## 快速开始

```sh
# 前置：上游 checkout 在 ../TokenTracker，且已安装依赖
# （recorder 会自动 npm ci + 装 @insforge/sdk@1.4.5）

cd /path/to/token-tracker-self-hosting

# 1) 录制参考快照（PG + TypeScript）
./contract/scripts/record.sh

# 2) 自测：用参考实现对比自己，应当 100% 通过
./contract/scripts/self-test.sh

# 3) 对 Go 实现跑同一批用例并对比（需要先有一个 PostgreSQL）
CONTRACT_ADAPTER=./contract/adapters/go-postgres.cjs \
  ./contract/scripts/verify.sh

# 4) 性能基准（可选）
./contract/scripts/benchmark.sh
```

---

## 分层

| 层 | 内容 | 是否需运行时 | 对 Go 实现的意义 |
|---|---|---|---|
| **L1 静态契约** | 15 步 id + `sha256(step.sql)`、14 函数清单、SQL 对象清单、函数签名、依赖锁定、响应 schema | 否 | 规格书：告诉你要建哪些表/索引/函数、返回什么字段 |
| **L2 行为契约** | 每个用例的输入与 HTTP 响应（状态、头、体） | 是（参考实现） | 一致性判据：逐字段对比 |
| **L3 并发/锁** | 多连接 advisory lock、并发重装、并发 upsert | 是（真实 PG） | 已在真实 PG 15.18 通过 5 项；这不等于 Go 实现的并发压力测试 |

---

## 关键设计原则

1. **黑盒**：用例只描述 HTTP 请求与期望的可观测响应，不假设内部实现。
2. **确定性**：所有 UUID、时间戳、随机 token 在归一化阶段替换为稳定占位符，
   保证重复录制结果一致（见 `SPEC.md`）。
3. **逐字节可复现**：golden 快照有 `SHA256SUMS`；两次录制若不一致说明参考实现不稳定，属于 bug。
4. **不修改上游**：`harness.cjs` 只读上游 checkout，测试依赖装到临时目录。
5. **失败即停**：任一用例不一致 → 非零退出，CI 变红，输出结构化 diff。
6. **快照是资产**：`golden/` 入库；升级上游版本时用 `--update` 显式更新并写 review。

---

## 在 CI 里

`.github/workflows/contract.yml`：

- 每次 push / PR：重建 golden（临时目录）→ 与仓库里的 `golden/` 逐字节对比 → 自测 → 静态契约校验。
- 每周定时：跑完整套件 + 性能基准，把报告作为 artifact。
- `go-server.yml` 在 PostgreSQL 15/16 上跑同一批 unit + 契约；独立 `build-go-image.yml` 负责候选镜像构建/实验发布。两个 workflow 均不会替代正式 InsForge/PostgreSQL 制品路径。

---

## 当前状态

- 上游参考实现：v1.4.12 / `8d32a956181bf52fae449c89b8f6520253566283`
- 录制时间：见 `golden/1.4.12/_meta.json`
- 用例数：35（见 `scenarios/index.json`）；Go 实现是 33 PASS / 2 PG-specific SKIP（跑在真实 PostgreSQL 上）。
- L3：真实 PostgreSQL 15.18 多连接锁/并发测试已通过 5 项，见 `L3-RESULTS.md`；这不代表 Go 实现的并发压力验收。
- Go adapter 和服务为实验垂直切片，生产阻断项见 `../go-server/STATUS.md`。
