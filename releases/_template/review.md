# 升级评审：<版本>（<旧版本> → <新版本>）

> 复制本文件到 `releases/<新版本>/review.md` 后填写。
> 依据：`docs/prompts.md` 提示词 B、`docs/maintainer-prompt.md` 工作流 3)。

## 1. 版本范围

| 项 | 值 |
|---|---|
| 旧锁定点 | `<旧 commit 全 SHA>`（v<旧版本>） |
| 新锁定点 | `<新 commit 全 SHA>`（v<新版本>） |
| 评审日期 | YYYY-MM-DD |
| 新增提交数 | `git rev-list --count 旧..新` |
| 契约 diff | `./scripts/upstream.sh review` 输出（贴入下方） |

```
<粘贴 ./scripts/upstream.sh review 的关键输出>
```

## 2. 两个明确结论

- **自托管契约是否变化**：是 / 否
- **客户端是否值得升级**：是 / 否（理由：）

## 3. SQL / 步骤清单对比

对照新旧 `manifest-report.md`：

| 对比项 | 旧 | 新 | 结论 |
|---|---|---|---|
| 步骤数 | | | |
| 新增步骤 id | — | | 允许（追加） |
| 旧步骤 checksum 变化 | — | | **不允许**，出现即停止评审 |
| 删除 / 重命名表或函数 | — | | 高亮兼容性影响 |

- [ ] 确认所有旧步骤 checksum 完全一致
- [ ] 确认新增步骤为追加，未修改任何旧步骤
- [ ] 检查 `test/self-host-backend.test.js`、`test/self-host-instance-config.test.js`、`test/self-host-acceptance.test.js` 是否变更

## 4. 函数产物对比

| 函数 | 是否变化 | 备注 |
|---|---|---|
| tokentracker-device-flow-authorize | | |
| tokentracker-device-flow-grant | | |
| tokentracker-device-flow-poll | | |
| tokentracker-device-token-issue | | |
| tokentracker-device-rename | | |
| tokentracker-ingest | | |
| tokentracker-account-summary | | |
| tokentracker-account-daily | | |
| tokentracker-account-hourly | | |
| tokentracker-account-monthly | | |
| tokentracker-account-heatmap | | |
| tokentracker-account-model-breakdown | | |
| tokentracker-account-devices | | |
| tokentracker-billing | | |

**依赖版本变化**（必须高亮）：

| 依赖 | 旧 | 新 |
|---|---|---|
| `npm:@insforge/sdk` | 1.4.5 | |
| `alipay-sdk` | 4.14.0 | |
| `urllib` | 4.9.1 | |
| `@waffo/pancake-ts` | 0.25.0 | |

## 5. 执行顺序（给实例持有者）

1. 备份数据库（15 系 `pg_dump`）+ 保留上一版 `releases/<旧版本>/functions/`。
2. 应用新 `tokentracker-install.sql`（或平台通道用 `tokentracker-migration.sql`），`ON_ERROR_STOP=1`。
3. 校验 `tokentracker_self_host_installations` 行数与新增 step id。
4. 仅重新上传**发生变化**的函数（或全部 14 个，按 `functions.json`）。
5. 按 `acceptance.md` 验收。

## 6. 回滚方案

- 数据库：用第 1 步备份恢复。
- 函数：重新上传 `releases/<旧版本>/functions/`。
- 客户端：回退到匹配的 CLI / 桌面版本（实例指向配置不变）。
- 若 installer 报「Installed step has changed」，**不要绕过**：说明上游改了旧步骤，需重新评审。

## 7. 责任划分

| 动作 | 由谁执行 |
|---|---|
| 生成产物、diff 评审、写本文档 | 维护 Agent / 本地 |
| psql、上传函数、配服务端环境变量 | 实例持有者（VPS） |
| 验收取证 | 实例持有者 |
