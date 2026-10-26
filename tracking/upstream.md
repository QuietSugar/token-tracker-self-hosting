# 上游版本追踪（单一事实来源）

> 本表由**本运维仓库**维护，上游仓库内没有这张表。
> 每次拉取上游后必须更新，并给出两个明确结论：**自托管契约是否变化** + **客户端是否值得升级**。
> 判定命令：`./scripts/upstream.sh review`。当前锁定点见 [`REF`](REF)。

## 版本追踪表

| 上游版本 | commit | 自托管清单 | 新增/变更 | 结论 |
|---|---|---|---|---|
| 1.3.9 | `626f5601` | 14 步 | 规划起点 | 历史基线 |
| 1.3.14 | `b19d27b0` | 15 步 | 新增 `13-machine-alias-cascade`；account-model-breakdown 加 CompressionStream 兼容 | 需重新生成 SQL + 函数并升级部署 |
| 1.4.7 | `12f8a479` | 15 步（未变） | 无自托管清单 / edge-patches/cloud 变更 | 客户端升级即可；云端新增 `device-usage-reset` 未纳入自托管（上游设计） |
| **1.4.12** | `8d32a956` | **15 步（未变）** | 1.4.7→1.4.12 契约 diff 为空；edge 仅新增模型定价条目，函数签名不变 | **后端无需动作**；客户端建议升级（新定价 + undici 8.12.2 CVE 修复 + OpenSquilla/OMP） |

最后核对：2026-10-26。当前锁定版本 **1.4.12**。

## 关于「14 步」的校正

归档的三份文档与上游 `docs/self-hosting-backend.md` 都写「当前 14 application steps」，那是 **2026-10-09** 的快照（当时 `13-machine-alias-cascade`，即迁移 `20261012120000_cloud-machine-alias-cascade.sql`，尚未加入）。

在 v1.4.12 上实际执行 `require('./scripts/self-host/manifest.cjs').steps()` 得到 **15 步**：

- 固定 id 8 个：`01-private-baseline`、`02-account-sessions`、`03-device-identity`、`04-private-aggregation`、`10-self-hosted-policy`、`11-token-environment-validation`、`12-pro-gifts`、`13-machine-alias-cascade`
- `cloud-*` 迁移 7 个：`20261003120000_cloud-subscriptions`、`20261004120000_cloud-machine-access`、`20261007120000_cloud-waffo`、`20261007130000_cloud-waffo-retry`、`20261007140000_cloud-waffo-attempts`、`20261007150000_cloud-waffo-authorizations`、`20261007160000_cloud-waffo-sandbox-periods`

文档里把 `cloud-*` 简写成「05..09」（5 个），因此少算了 2 个；相对变化（1.3.9 → 1.3.14 新增 1 步）是对的，绝对数量整体偏小。**本仓库以实际 `steps()` 输出为准。**

`privateFunctions` 经核对确认为 **14 个**，与文档完全一致。

## 契约判定规则

```sh
git diff --stat <旧SHA> <新SHA> -- scripts/self-host 'docs/self-hosting*' \
  dashboard/edge-patches/cloud scripts/build-cloud-functions.cjs migrations
```

- **diff 为空** → 自托管后端契约未变。只看 `src/`、`dashboard/src/` 变化，评估客户端是否值得升级。
- **`manifest.cjs` 的 `steps()` 或 `privateFunctions` 变化** → 升级信号：走提示词 B，生成新产物 + 升级评审。
- **仅 edge-patches 新增模型定价条目** → 函数签名不变，通常不需要重部署函数；仅在需要同步新定价时才重新构建。

## 升级的硬约束

installer（`scripts/self-host/install.cjs`）把每步 `sha256(step.sql)` 记入 `public.tokentracker_self_host_installations`。重跑新版完整 SQL 时：

- 已安装且 checksum 一致的步骤 → **跳过**；
- 新增步骤 → 执行并登记；
- 已安装但 checksum 不一致（旧步骤被改动）→ **直接 `RAISE EXCEPTION` 并整体回滚**。

因此：**升级 = 用新 commit 重新生成完整 SQL 并重跑**，而不是手写增量迁移；**旧步骤 SQL 绝不可改**。生成迁移版可用 `install.cjs --migration`（不带事务包装，供平台迁移通道使用）。

## 依赖锁定（构建时校验）

`npm:@insforge/sdk@1.4.5`、`alipay-sdk@4.14.0`、`urllib@4.9.1`、`@waffo/pancake-ts@0.25.0`。
`build-functions.cjs` 会比对 `package-lock.json`，版本不一致会显式报错。升级评审需高亮任何依赖版本变化。
