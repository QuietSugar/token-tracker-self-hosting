# Self-Host 可持续维护规划（跟随上游更新）

> 目标：以官方开源仓库为唯一上游，通过「拉取最新代码 → 本地生成基线/构建函数 → 部署到自有 InsForge 实例」的循环，长期维护私有同步后端。
> 状态：技术预览（依据 `docs/self-hosting-status.md`）。本文只做规划与交接，不实际执行 InsForge 平台部署（平台由你负责）。

## 1. 总体架构与职责边界

```
[上游 GitHub main] --git pull--> [本地应用 checkout] --npm ci--> [依赖]
    --> install.cjs --sql 生成应用基线 SQL --> psql 应用到自有 PostgreSQL
    --> build-functions.cjs 生成 14 个私有函数 --> 部署到自有 InsForge worker
    --> 自有 InsForge 实例 <-- config.json 指向 -- 官方 CLI / 桌面 App
```

| 环节 | 负责方 |
|---|---|
| InsForge 平台（镜像/API/认证/worker/存储） | 你 |
| 应用 schema / RPC / RLS 基线 | 本仓库工具（install.cjs） |
| 14 个私有函数 | 本仓库工具（build-functions.cjs） |
| 客户端指向自有实例 | 本仓库 config 机制 |
| 公共 VPS HTTPS / OAuth / 原生路由验收 | 你 + 本仓库验收清单 |

## 2. 跟随上游更新的标准循环

每次上游有更新（尤其 `src/`、`dashboard/`、`scripts/self-host/`、`migrations/`），执行：

```sh
# 0) 固定上游与审查：记录将要审查的 SHA
git fetch origin main
git checkout main
git pull --ff-only origin main
REVIEWED_COMMIT=$(git rev-parse HEAD)

# 1) 安装依赖（Node >= 20；本机 version-fox 默认 14.21.3，必须先切换，如 fnm use 22）

# 2) 生成应用基线 SQL（独立事务 + 安装锁；幂等）
node scripts/self-host/install.cjs --sql /absolute/private/path/tokentracker-install.sql
#    审查生成的 SQL。若步骤变化 = 升级而非重装，走新增迁移步骤，保留回滚。

# 3) 构建 14 个私有函数
node scripts/self-host/build-functions.cjs /absolute/private/path/tokentracker-functions
#    产物：*.js + functions.json（函数名 -> 构建路径）
#    依赖必须与 package-lock.json 一致（alipay-sdk@4.14.0 / urllib@4.9.1 / @waffo/pancake-ts@0.25.0）

# 4) 部署到自有 InsForge（你执行）：按 functions.json 上传，配服务器环境变量

# 5) 验证
node --test test/self-host-backend.test.js
node --test test/self-host-instance-config.test.js
node --test test/self-host-acceptance.test.js
```

**关键规则（来自源码与文档）**
- 绝不对全新库跑所有 `migrations/*.sql`（历史是增量/运维修复，不是基线）；只跑 `install.cjs` 生成的干净基线。
- `install.cjs` 自带清单：`tokentracker_self_host_installations` 记录每步 SHA-256；步骤变化会报错而非静默替换。升级走新增步骤。
- `build-functions.cjs` 输出 async CommonJS，供官方 v2.3.3 worker 的 `new Function` 执行器使用；ESM 部署可能调用失败。
- 设备授权函数的 `TOKENTRACKER_DASHBOARD_URL` 有源码锚点校验：必须指向你自己的 dashboard 域名（HTTPS 或本地 loopback HTTP），否则构建/配置校验失败，绝不回落官方 dashboard。

## 3. 服务器环境变量（函数侧）

```dotenv
INSFORGE_BASE_URL=https://api.your-domain.example
INSFORGE_SERVICE_ROLE_KEY=your-server-only-service-credential
ANON_KEY=your-public-anonymous-key-40or64hex
JWT_SECRET=your-platform-signing-secret        # RS256 平台则用 JWT_PUBLIC_KEY
TOKENTRACKER_DASHBOARD_URL=https://dashboard.your-domain.example
TOKENTRACKER_BILLING_ENVIRONMENT=live
```

- 只放个人实例所需；不要配 Waffo/Paddle/微信/支付宝密钥（自托管支付与赠送码本就不开放）。
- 官方 v2.3.3 平台会通过保留内部 URL/密钥别名注入（`INSFORGE_INTERNAL_URL`、`API_KEY` 回退），无需额外设置。
- 密钥只存在于服务器；浏览器构建只用公开 anon key。

## 4. 客户端指向自托管（官方产物免自建）

**结论：官方 CLI 与桌面 App 不需要自行构建，通过配置即可切换后端。**

- 解析优先级（`src/lib/runtime-config.js`）：CLI 参数 → `~/.tokentracker/config.json` → 环境变量 `TOKENTRACKER_INSFORGE_BASE_URL` / `_ANON_KEY` / `TOKENTRACKER_DASHBOARD_URL` → 官方默认。
- 初始化时写入：
  ```sh
  npx tokentracker init --base-url https://api.your-domain.example \
    --anon-key <你的anon_key> --dashboard-url https://dashboard.your-domain.example
  ```
  或直接编辑 `~/.tokentracker/config.json`（`baseUrl` / `anonKey` / `dashboardUrl`）。
- 桌面 App 只是启动内置 CLI + 打开 localhost，自动复用该配置（Windows `ServerManager.cs`、macOS `ServerManager.swift` 均无后端地址概念）。
- 唯一需要自建前端的场景：让线上官网 `www.tokentracker.cc` 也指向你的实例（独立发布管道，默认不做）。

## 5. 上线前验收清单

- [ ] 真实 HTTPS 域名：注册/登录/登出/刷新会话
- [ ] 两个账号互不可读（RLS 生效，客户端角色无权限执行私有函数）
- [ ] 两台设备授权同一账号，互不覆盖身份
- [ ] 重传同一批数据不重复累计；修正与去重生效
- [ ] 时区/DST、模型成本与本地一致
- [ ] 会话过期 / 暂停设备 / 后端离线 → UI 可恢复，不丢本地队列
- [ ] 浏览器与原生流量只走自有实例；不回流官方后端/排行榜
- [ ] 备份恢复演练（pg_dump/restore；PostgreSQL 15.18 要配套 15 系工具，官方镜像默认 18.4 会因 transaction_timeout 失败）
- [ ] 升级演练：14 步基线 → 新增版本步骤 → 校验幂等与数据保留

## 6. 风险与边界

- 自托管仍为技术预览；公共 VPS HTTPS / OAuth / Windows 桌面回调三类由文档列为未验收。
- 上游更新可能改变 schema/函数契约或构建依赖锁（SDK 1.4.5、支付库版本）；升级前 diff `manifest.cjs` 的 `steps()` 与 `functions.json`。
- 客户端版本与后端契约需匹配；旧客户端连新后端前先核对。
- 微信/支付宝/Pro 付费相关函数被自托管清单主动排除；不要手动补部署。
## 版本追踪（自托管契约）

| 上游版本 | 自托管清单 | 新增/变更 | 说明 |
|---|---|---|---|
| 1.3.9 (626f5601) | 13 步 | — | 初始基线（本次规划起点） |
| 1.3.14 (b19d27b0) | 14 步 | 新增 13-machine-alias-cascade；account-model-breakdown 加 CompressionStream 兼容 | 需要重新生成 SQL + 函数并升级部署 |
| 1.4.7 (12f8a479) | 14 步（未变） | 无自托管清单/edge-patches/cloud 变更 | CLI/sync 大量改动，客户端升级需配套发新版；云端新增 device-usage-reset 未纳入自托管（上游设计） |
| 1.4.12 (8d32a956) | 14 步（未变） | 无自托管清单/migrations/cloud 模块变更；account-*、leaderboard-* edge 仅新增模型定价条目（Claude Haiku 5.5、Kimi K3.1、Qwen3.8-max、Muse-free 等），函数签名不变 | 后端契约继续稳定；客户端升级到 1.4.12 即可获得新定价/CVE 修复（undici 8.12.2）与新功能（OpenSquilla/OMP session 等） |

> 每次拉取后，`git diff --stat 旧SHA..新SHA -- scripts/self-host docs/self-hosting* dashboard/edge-patches/cloud` 为空即代表自托管契约未变；否则按提示词 B 走升级评审。

- 已知版本锚点：清单当前为 14 步（含 13-machine-alias-cascade，2026-10-12 迁移）；构建产物对 account-model-breakdown 做了 CompressionStream 兼容处理。升级前用 `git log --oneline 旧SHA..新SHA -- scripts/self-host migrations` 核对这两者是否变动。