# 项目真实状态与文档/规则审视

审视日期：2026-10-26（Asia/Shanghai）

> 本次审视按实际源码、真实运行结果和 CI 结果回看仓库文档；不是照抄旧计划。

---

## 结论摘要

文档骨架大体有用，但在用户提出“最终是 Docker 镜像”“未来改 SQLite + Go”之后，原先一部分表述已过时，且首次契约录制暴露了实质性测试盲区。已做以下修正：

1. README 不再说“首次实施尚未开始”：v1.4.12 工件已生成，官方标准栈在沙箱中真实安装/幂等重装通过；**用户自己的公共 VPS 部署仍未开始**。
2. 将正式交付与新实验路线拆开：现有正式 Docker 镜像仍是 InsForge + PostgreSQL 的工件载体；新增的 `go-server/` 是实验性后端镜像，不混用 `latest`/正式 tag。
3. `database-choice.md` 结论收窄为“当前正式 InsForge/TS 路径需要 PG”，不再说“项目永远不可能用 SQLite”；Go+SQLite 原型的边界另见 `go-server/STATUS.md`。
4. 契约体系把 PostgreSQL 专属的 15-step SQL ledger / step checksum 用例明确标成 Go 的 **SKIP**，并使用 SQLite 自己的 `schema_migrations(version, checksum)`；不再伪造 PG 账本。
5. 修复契约执行器：`expectStatus` 不符时录制失败；对象归一化按稳定键遍历；相对日期使用值驱动 placeholder；无序 SQL 结果按稳定业务键排序。升级归一化版本并重录 golden。
6. 在 GitHub Actions 启用候选 Go+SQLite gate 与真实 PG 15 L3 gate。

---

## 一、真实环境：能做到什么、实际做了什么

### 环境能力实测

沙箱最初没有 Docker / Go / PostgreSQL 服务端。经确认有免密 sudo 与网络后，安装并启动了：

- Go **1.24.4**。
- PostgreSQL client/server **17.11**（系统服务端，仅作工具；不是本次标准环境）。
- Docker Engine 26.1.5 + Compose v2.30.3；实测能 pull 并运行容器。

### 官方标准栈实测

从 InsForge **v2.3.3** tag 取官方 compose；实际把 `insforge:latest` 固定为 v2.3.3，并把四镜像 digest 记录进 `contract/L3-RESULTS.md`。四容器均运行：

- PostgreSQL **15.18**（与上游文档记录的标准 PG 版本一致）；
- PostgREST v12.2.12；
- InsForge OSS v2.3.3；
- Deno 2.0.6。

真实库确认 `auth.users`、`auth.uid()`、`anon` / `authenticated` / `project_admin BYPASSRLS` 均由平台建立。对真实 PG 应用 v1.4.12 **15 步 SQL**，二次运行幂等，仍为 15 行 ledger 且 checksum 不变。

**L3 真实多连接测试 5 PASS / 0 FAIL**：

- 两连接争抢 advisory lock，第二连接等待约 2.5s；
- 8 个 psql 独立连接同时重装，8/8 成功，15 行 ledger 不变；
- checksum 与 golden 相符；
- 真实 PG role/table/function privilege matrix；
- 10 个独立连接同一主键 upsert，最终 1 行、100 tokens，10/10 成功。

### 真实环境的边界

- 官方栈里的 Deno 容器无法从容器网络访问 `deno.land`（沙箱 DNS 限制）；宿主机预热 Deno cache volume 后健康检查返回 200。普通公网 VPS 不需要这个特定 workaround。
- 本次**没有**把用户数据/真实账号导入任何环境，没有连接用户 VPS，也没有上传 InsForge 函数。
- 本次真实 PG L3 验证 SQL/锁/ACL，不等价于完整 InsForge signup/signin + 14 handler + 真实浏览器/原生客户端 E2E。该完整官方本地栈证据此前在上游维护文档中有记录，但本轮没有重新跑所有场景。

**判断**：用户问的“真实标准环境”做到了官方栈 + 真实 PG 15.18 + 实际 SQL 安装与 L3 多连接验证；但不能把这句话夸大成“Go+SQLite 已在官方 InsForge 栈中运行”（Go 版本是独立服务，和 InsForge 不同架构）。

---

## 二、Go + SQLite：实际实现范围与不该声称的内容

### 已有真实实现

`go-server/` 是真实 Go HTTP server + SQLite（modernc 纯 Go驱动）。可运行 Docker 镜像已在本地 build+smoke：linux/amd64、uid 10001、owner-only DB/WAL/SHM、JWT secret 强制 32 字节、production 默认关闭危险 `/_test/*` SQL fixture 端点。

Go candidate 在 35 个行为案例上 **33 PASS / 0 FAIL / 2 SKIP**；静态参考契约 L1 校验也通过。Go unit tests、race、vet、CGO=0 build 全过。

### 这 2 个 SKIP 是正确边界

- `install/ledger-15-steps`：SQLite 不声称执行 15 个 PostgreSQL DDL migration。
- `install/checksum-drift-refused`：PG step SQL checksum 规则不适用于另一份 SQLite schema。SQLite 对自己的 schema 计算 SHA-256，重装时拒绝 schema drift，且有 unit test。

此前 Go adapter 一度伪造了 PG step ledger / privilege matrix / payment table probe，导致表面 PASS。审视后已去掉这种做法：**实现相关内部状态不能假装跨实现相同**；改为显式 SKIP（仅限 PG 特有项）或公共 HTTP 行为测试。这是对测试规则的重要修订。

### 不能宣称“完成了 SQLite+Go 版”

Go 现在是**可运行、受契约测试约束的垂直切片**，不是完整替代：SQLite 当前 14 张表，而 PG 静态契约 24 张；Go 服务未实现完整 signup/signin/OAuth、所有后台聚合/缓存、赠送码/支付流程、session state 和生产运维。35 个用例只覆盖一部分可观察行为。

**因此：**镜像与文档标 `experimental`；不得推成正式 `latest`，不得接真实用户，不得据此关闭官方 PG 部署方案。完整差距清单见 `go-server/STATUS.md`。

---

## 三、原计划/规则里发现的问题

| 旧说法/规则 | 真实情况 | 已采取的修订 |
|---|---|---|
| “计划阶段，首次实施尚未开始” | v1.4.12 SQL/函数已生成；真实标准 PG 安装/重装已通过 | README 改成“工件已生成，本地标准栈验收；用户公共 VPS 部署未开始” |
| “PG 永远不可替代” | 只对当前 InsForge + PG + TS 实现成立；新 Go/SQLite 路线是实验上可行 | `database-choice.md` 分正式路径/实验后端，并链接 STATUS |
| `account_usage_grouped_cached` golden 已测聚合 | 4 个 scenario RPC 参数名错误（`p_device_ids`/`p_bucket`/`p_limit`），录到了 PG 42883，而不是聚合结果 | 查真实 `pg_get_function_arguments`，改为 `p_device_id`/`p_trunc`/`p_offset_min`；`expectStatus` 不符现在使录制失败；重录 golden，现已覆盖上海时区、100→60 cache invalidation、weekend off-peak |
| Go/SQLite 必须保留 PG 的 15-step ledger | 不同引擎并不共享 SQL migration step 语义 | Go 用自己的 `schema_migrations(version, checksum)`；两个 PG-only case 显式 SKIP |
| L1 静态契约 PASS 就说明 Go schema parity | verify 的 L1 是对上游 release 与 golden 的一致性，不是自动解析 Go schema 等价 | STATUS 明确说这是“PG 参考施工图”；Go 只实现 14/24 表，不能宣称完全等价 |
| 真实 PG 并发是未测试限制 | 本轮真实 PG 15.18 L3 已跑 5 项 | 加 `standard-env-test.sh` 与 contract.yml L3 服务容器 job |
| compose 默认 image tag 满足 pin 规则 | 官方 v2.3.3 compose 的 InsForge image 写 `latest` | 标准环境复现脚本固定 4 个 OCI digest；L3 结果记录 digest |
| “镜像最终产物”只有一个含义 | 现在是两条架构：官方 PG artifact-carrier 与 Go/SQLite backend | README/docker 文档/MAINTENANCE 分开标注正式与 experimental |

---

## 四、维护规则是否需要调整

需要，而且已调整：

1. **正式路径 vs 实验路径分离**：官方镜像/升级 SOP 不被 Go 原型改动；Go image 只用 `experimental` tag。
2. **对照测试不强迫内部同构**：公共行为必须比；引擎专属 migration ledger / PG catalog 查询应明确 SKIP 或改成 HTTP 可观察行为，不能复制一个“看上去像”的 PG 表。
3. **golden 录制加断言**：scenario 可声明 `expectStatus`；预期 200 却收到 42883 时 recorder 必须 fail，而非把 bug 录成新的真相。
4. **多层门禁**：PGlite L1/L2 可复现 + 真实 PG L3 并发/锁 + Go unit/race/vet + 跨实现行为契约。任何一层都不能代替另外几层。
5. **生产门槛显式**：Go schema 24 表全映射、身份服务、真实 native/browser E2E、负载/恢复/备份、安全审计通过前，禁止 GA。
6. **GitHub App 最小权限/凭据轮换**：推送前确认私钥有效且未泄露，疑似泄露时先轮换。App 权限收窄到 Contents + Workflows（若不自动开 issue 则去掉 Issues/Actions/Checks/PR 写权限）；PEM 只通过受控附件交付，不进入公共仓库。

---

## 五、当前人工决定项

- Go/SQLite 是实验还是要继续投资源冲到生产替代？本轮按“实验垂直切片”实现，未假装完成全量重写。
- 要不要把公开提交邮箱 `sugarjellyfish@gmail.com` 换成 GitHub noreply？已进入 public commit history；要改需要强制改写并 force-push。后续可以切换。
- 公开 GHCR 的正式 artifact image 与新的 experimental Go image 是否都要 public？目前正式镜像 public；Go build workflow 可以推 GHCR，但可见性需显式核对。
