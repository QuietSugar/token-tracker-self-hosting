# 安全说明

> 本仓库是**公有仓库**：<https://github.com/QuietSugar/token-tracker-self-hosting>
> 任何 push 都立即对全网可见。**删提交 / 改历史 / force push 都不等于「已撤销」——轮换密钥永远优先于清理历史。**

## 凭据放哪

本仓库**不存储任何真实凭据**。下面这些只允许存在于你的机器上：

| 凭据 | 位置 | 权限 |
|---|---|---|
| `TT_JWT_SECRET` | `go-server/.env` 或 `/etc/tokentracker/env` | `600` |
| PostgreSQL 口令 | 同上（写在 `TT_DATABASE_URL` 里） | `600` |
| `POSTGRES_PASSWORD` | `go-server/.env` | `600` |
| 客户端 `~/.tokentracker/tracker/config.json` | 客户端机器，**不要复制进本仓库** | `600` |

持有 `TT_JWT_SECRET` 就能伪造任何身份，它是唯一必须守住的东西。自托管不需要付费 / OAuth / 邮件服务商密钥。

推送前：

```sh
./scripts/check-secrets.sh    # 命中即非零退出
./scripts/check-encoding.sh
```

CI（`.github/workflows/verify.yml`）会再查一遍，但不要把 CI 当作唯一防线。

## 部署时的真实边界

- **`TT_DEVICE_APPROVE=page|auto` 不要暴露到公网**：这两种模式下，能访问服务并拿到 `user_code` 的人就能把设备接进 owner 账户。
  需要审批边界用 `jwt`（`scripts/approve-device.sh`）。详见 [`docs/design/auth.md`](docs/design/auth.md) §5。
- **`TT_ENABLE_TEST_ENDPOINTS` 生产必须关闭**：`/_test/sql` 可执行任意 SQL。
- 没有速率限制、爆破防护、审计日志 —— 这是局域网单实例自用的取舍。真要公网访问，请在前面加一层网关。
- 反代必须透传 `Authorization`；否则表现为「密码能登录但所有 API 401」。排查用 `TT_ACCESS_LOG=true`。

## 误提交处置（公有仓库 = 已泄露）

1. **立刻轮换**该密钥 / token。把这一步当第一步，不要先去改 git 历史。
2. 检查相关服务的访问日志，确认有无异常使用。
3. `git rm --cached` 移除并提交；若已推送，可用 `git filter-repo` 清历史并强推（先与协作者协调）。
4. 清理完成后仍按"已泄露"处理：历史可能已被 clone / fork / 缓存。
5. 复盘：把该文件模式加进 `.gitignore` 与 `scripts/check-secrets.sh`，避免重犯。

## 报告问题

不要在公开 issue / PR 里贴日志、配置片段或实例地址。
请用 GitHub 的 Private vulnerability reporting，或直接联系仓库所有者。
