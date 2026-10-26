# 验收记录：<版本>

> 复制本文件到 `releases/<版本>/acceptance.md` 后逐项填写。
> 依据：`docs/prompts.md` 提示词 D、`docs/update-plan.md` 第 5 节。

- 日期：YYYY-MM-DD
- 执行人：
- 环境：API `https://...` / Dashboard `https://...` / InsForge v2.3.3 / PostgreSQL 15.18
- 对应产物：`SHA256SUMS`（已校验 ✓ / 未校验 ✗）

## 首次部署验收

| # | 项目 | 命令 / 操作 | 预期结果 | 取证 | 结论 |
|---|---|---|---|---|---|
| 1 | HTTPS 注册 / 登录 / 登出 / 刷新会话 | 浏览器 + 开发者工具 | 全流程成功，cookie/会话正确 | 截图 + HTTP 状态 | ☐ |
| 2 | 双账号 RLS 隔离 | 用 A 的 token 读 B 的数据；客户端角色执行私有函数 | 被拒绝 | SQL / HTTP 403 | ☐ |
| 3 | 双设备授权互不覆盖 | 同账号两台设备 `init` + 授权 | 两条 device 记录，互不覆盖 | 数据库查询 | ☐ |
| 4 | 重传幂等 / 修正去重 | 重复 `sync` 同一批数据 | 不重复累计 | 前后计数对比 | ☐ |
| 5 | 时区 / 成本一致 | 对比本地与云上汇总 | device/provider/model/时区/cost 一致 | JSON 对比 | ☐ |
| 6 | 断网 / 暂停设备 / 后端离线可恢复 | 模拟故障后恢复 | UI 可恢复，本地队列不丢 | 日志 | ☐ |
| 7 | 流量不回流官方 | 浏览器 Network + 原生抓包 | 只出现自有域名 | 抓包记录 | ☐ |
| 8 | 备份恢复演练 | `pg_dump` / `pg_restore`（15 系工具） | 恢复后数据一致 | 命令输出 | ☐ |
| 9 | 升级演练 | 新增步骤后重跑 installer | 幂等、数据保留 | installations 表快照 | ☐ |

## 上游明确标注为「未验收」的三项（自行补做）

| # | 项目 | 结论 |
|---|---|---|
| A | 公共 VPS 的 HTTPS / 浏览器信任 | ☐ |
| B | OAuth（若启用，需自有 provider 凭据并实测 code exchange） | ☐ |
| C | Windows 打包客户端的原生回调路由 | ☐ |

## 关键取证查询

```sql
-- 安装步骤（期望 N 行，与 manifest-report.md 一致）
SELECT step, checksum, installed_at
FROM public.tokentracker_self_host_installations ORDER BY step;

-- 自托管策略已激活
SELECT hosting_mode, phase FROM public.tokentracker_cloud_policy;
```

## 结论

- [ ] 全部通过，可进入稳定运行
- [ ] 有未通过项，记录如下：

```
<失败项、原因、后续动作>
```
