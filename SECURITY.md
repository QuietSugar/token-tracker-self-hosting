# 凭据处理规则

> ⚠️ **本仓库托管在 GitHub public 仓库**：<https://github.com/QuietSugar/token-tracker-self-hosting.git>
> 任何 `git push` 后内容立即对全网可见，且可能被爬虫/密钥扫描机器人即时抓取。
> **删掉提交、改历史、force push 都不能视为「已撤销」——轮换密钥永远优先于清理历史。**

本仓库**不存储任何真实凭据**。以下内容只允许存在于实例持有者的 VPS / 本地环境：

- `INSFORGE_SERVICE_ROLE_KEY`（服务端专用，最高敏感）
- `JWT_SECRET` / `JWT_PUBLIC_KEY`（平台签名密钥）
- `ANON_KEY`（公开匿名键；虽是公开值，也不必写进仓库）
- OAuth / 邮件服务商凭据、数据库口令、API key

## 做法

1. 复制 `env/server.env.example` 为 `env/server.env`，填入真实值。该路径已被 `.gitignore` 忽略。
2. 文件权限 `chmod 600`；密钥只存在于服务器，不进 shell 历史、不进截图、不进浏览器构建产物。
3. 客户端 `~/.tokentracker/config.json` 权限 `600`，且**不复制到本仓库**。
4. 自托管模式**不配置** Waffo / Paddle / 微信 / 支付宝密钥——付费与赠送码功能在自托管清单里被有意排除。
5. **每次推送前**：`./scripts/check-secrets.sh`；失败就不要推。CI 会再查一遍，但不要把 CI 当作唯一防线。
6. `releases/<ver>/acceptance.md` 只写结论与取证方式，**不要粘原始日志、抓包内容、截图或数据库 dump**（这些文件会入库并公开）。

## 误提交处置（公有仓库 = 已泄露）

1. **立刻轮换**该密钥 / token（InsForge 平台、服务商、OAuth provider）。把这一步当第一步，不要先去改 git 历史。
2. 检查该服务的访问日志，确认有无异常使用。
3. `git rm --cached` 移除文件并提交；若已推送，用 `git filter-repo` 清历史并强推（改写历史，先与协作者协调）。
4. 即使清理完成，也**保留已轮换**的假设：历史可能已被 clone / fork / 缓存。
5. 复盘：把该文件模式加入 `.gitignore` 与 `check-secrets.sh` 的模式表，避免重犯。

## 报告

这是公有仓库，**不要**在公开 issue / PR 里贴日志、配置片段或实例地址。
如发现安全问题，请通过 GitHub 私有漏洞报告（Private vulnerability reporting）或直接联系仓库所有者。
