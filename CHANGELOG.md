# 变更记录

本文件记录**本运维仓库自身**的变更，不记录上游发布（上游版本见 `tracking/upstream.md`）。

## 2026-10-26 — 仓库初始化（计划阶段）

- 创建独立运维仓库，与上游 TokenTracker checkout 分离。
- 归档三份规划文档到 `docs/`：维护提示词、可复用提示词、总体规划。
- 新增 `docs/runbook.md`：首次实施 / 升级 / 回滚操作手册。
- 建立 `tracking/REF`（锁定 v1.4.12 / `8d32a956181bf52fae449c89b8f6520253566283`）与 `tracking/upstream.md` 版本追踪表。
- 新增脚本：`upstream.sh`（只读上游检查）、`build.sh`（产物生成）、`summarize.cjs`（清单摘要）、`verify.sh`（完整性与编码校验）。
- 新增 `env/server.env.example`、`releases/_template/` 模板。
- 记录已知偏差：文档写 14 步，实际 `manifest.steps()` 为 15 步；以 `tracking/upstream.md` 为准。
- **首次实施尚未开始**：`releases/` 下暂无产物。
