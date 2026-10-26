# 变更记录

本文件记录**本运维仓库自身**的变更，不记录上游发布（上游版本见 `tracking/upstream.md`）。

## 2026-10-26 — 建立长期维护机制

- 新增 `MAINTENANCE.md`：维护契约、会话启动协议、标准循环 SOP、决策树、硬停止条件、灾难恢复、当前不变式。明确「状态存在仓库里，不在对话记忆里」。
- 新增 `scripts/session-start.sh`：每次维护会话的状态快照命令，输出环境自检、锁定点、版本追踪、最近提交、已有产物、未完成待办、上游状态、安全检查结果。
- 新增 `scripts/bootstrap.sh`：实测发现工作区快照不保存 `.git/config` / `~/.gitconfig`，导致新会话丢失 `origin` 与提交身份（`git commit` 报 `Author identity unknown`）。该脚本幂等地恢复二者；`session-start.sh` 会增加环境自检提醒。
- 修正 `upstream.sh status` 误报：`git diff --numstat` 对纯权限位变更输出 `0  0  file`，之前被误计为内容变更。
- README 增加「长期维护」章节并在开头指向 `MAINTENANCE.md`；命令速查补充 `session-start.sh`。
- 约定：Agent 无法主动定时运行，由用户一句话触发；触发后应能完整执行而无需重新交代背景。
- **首次实施仍未开始**；`releases/` 下暂无产物。

## 2026-10-26 — 面向 public 远程仓库加固

远程确定为 <https://github.com/QuietSugar/token-tracker-self-hosting.git>（**公有仓库**）。

- 新增 `scripts/check-secrets.sh`：推送前密钥扫描（已知 token 格式、私钥块、疑似真实赋值、敏感文件名、`.gitignore` 覆盖验证）。
- 新增 `scripts/check-encoding.sh`：全仓 UTF-8 / 无 BOM 检查；`verify.sh` 改为复用它。
- 新增 `.github/workflows/verify.yml`：push / PR 时自动跑密钥扫描、编码检查、产物校验、脚本语法检查；只依赖官方 `actions/*`。
- README 新增「公有仓库安全约定」章节，明确公开内容范围与硬性规则。
- SECURITY.md 强调公有仓库 = 已泄露，误提交处置改为「先轮换再清历史」。
- 推送前全仓扫描结果：未发现真实凭据；域名均为 `your-domain.example` 类占位符。
- **首次实施仍未开始**；`releases/` 下暂无产物。

## 2026-10-26 — 仓库初始化（计划阶段）

- 创建独立运维仓库，与上游 TokenTracker checkout 分离。
- 归档三份规划文档到 `docs/`：维护提示词、可复用提示词、总体规划。
- 新增 `docs/runbook.md`：首次实施 / 升级 / 回滚操作手册。
- 建立 `tracking/REF`（锁定 v1.4.12 / `8d32a956181bf52fae449c89b8f6520253566283`）与 `tracking/upstream.md` 版本追踪表。
- 新增脚本：`upstream.sh`（只读上游检查）、`build.sh`（产物生成）、`summarize.cjs`（清单摘要）、`verify.sh`（完整性与编码校验）。
- 新增 `env/server.env.example`、`releases/_template/` 模板。
- 记录已知偏差：文档写 14 步，实际 `manifest.steps()` 为 15 步；以 `tracking/upstream.md` 为准。
- **首次实施尚未开始**：`releases/` 下暂无产物。
