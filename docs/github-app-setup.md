# GitHub App 配置指南（长期维护认证）

> 目标：用 GitHub App 取代 PAT，让维护 Agent 能长期、安全、可撤销地向本仓库推送。
> 依据 GitHub 官方文档（链接见文末「参考」）。

---

## 1. 为什么用 GitHub App 而不是 PAT

| 维度 | Fine-grained PAT | GitHub App |
|---|---|---|
| 凭据寿命 | 长期有效，泄露后需手动 revoke | 私钥长期，但**每次换取 1 小时的 installation token** |
| 权限粒度 | 绑定个人账号 + 指定仓库 | 独立身份，权限精确到单个仓库、单个 permission |
| 推送 workflow 文件 | 需要 `Workflows: R/W`（我们上次就是栽在这里） | 需要 `Workflows: R/W`（同样必须显式勾选） |
| 轮换 | 重新生成 token | 重新生成私钥，旧私钥立即失效 |
| 审计 | 混在个人账号活动里 | App 有独立活动日志 |
| 速率限制 | 绑定用户 | 独立配额，随 installation 扩展 |

**关键**：GitHub 对 `.github/workflows/` 的写入有服务器端的硬性检查。无论 PAT 还是 GitHub App，推送包含该路径变更的提交时，凭据必须带 **Workflows** 权限；只有 `Contents: R/W` 不够。[1](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)

---

## 2. 前提：确认由哪个账号操作

本仓库 owner 是 **`QuietSugar`**（User 账号）。GitHub App 的安装需要对目标仓库有管理权限，因此：

- **最稳妥**：用 `QuietSugar` 账号创建并安装 App。
- 如果实际操作账号是另一个账号（例如 `hall`），需要先把该账号加为本仓库的 **admin collaborator**，或者由 `QuietSugar` 完成安装。
- 提交作者身份与推送凭据是两回事：提交作者由本地 `git config user.name/user.email` 决定，与 App 无关。

---

## 3. 创建 GitHub App（网页端步骤）

1. 登录有权限的账号，打开 <https://github.com/settings/apps/new>
   （路径：头像 → Settings → Developer settings → GitHub Apps → **New GitHub App**）。
   组织仓库则是 `https://github.com/organizations/<ORG>/settings/apps/new`。

2. 基础信息：

   | 字段 | 建议值 |
   |---|---|
   | GitHub App name | `tokentracker-selfhost-maintainer`（全局唯一，可自行调整） |
   | Homepage URL | `https://github.com/QuietSugar/token-tracker-self-hosting` |
   | Description | 可选，例如 `Long-term maintenance bot for the self-hosting control repo` |
   | **Webhook → Active** | **取消勾选**。本方案不需要 webhook，取消后也不必填 URL |
   | **Where can this GitHub App be installed?** | **Only on this account**（最严格） |

3. **Repository permissions**（这是核心，决定能做什么）：

   | Permission | Access | 用途 | 是否必需 |
   |---|---|---|---|
   | **Contents** | **Read and write** | 推送提交、分支、tag | ✅ 必需 |
   | **Workflows** | **Read and write** | 推送 `.github/workflows/verify.yml` | ✅ **必需**（否则重演上次的拒绝） |
   | Metadata | Read-only | 所有 App 强制自带的基线权限 | ✅ 自动 |
   | Issues | Read and write | 定时检查上游后自动开 issue 提醒 | 可选（推荐，见 §7） |
   | Pull requests | Read and write | 走 PR 评审流程 | 可选 |
   | Actions | Read-only | 读取 CI 运行状态 | 可选 |
   | Checks | Read-only | 读取 CI 检查结果 | 可选 |

   > 注意：`Actions` 权限管的是**运行**工作流，不是**编辑**工作流文件。编辑 `.github/workflows/` 必须靠 `Workflows` 权限，两者不能互相替代。

4. **Subscribe to events**：不需要（webhook 已关闭）。
5. 点击 **Create GitHub App**。

---

## 4. 收集三项信息

创建成功后，在 App 设置页：

| 项 | 位置 | 说明 |
|---|---|---|
| **App ID** | App settings → About → App ID | 一串数字。也可用 **Client ID**（`Iv23...`），两者都能作为 JWT 的 `iss` |
| **Private key** | App settings → Private keys → **Generate a private key** | 下载得到 `*.private-key.pem`。**只显示一次**，这是唯一长期秘密 |
| **Installation ID** | 见下一步 | 一串数字 |

生成私钥后立即妥善保存。它不能单独访问任何东西（还需要 App ID + Installation ID），但依然要当密钥对待。

---

## 5. 安装 App 并取得 Installation ID

1. App 设置页左侧 → **Install App** → 选择账号 → **Install**。
2. 仓库范围选 **Only select repositories** → 勾选 `token-tracker-self-hosting` → Install。
3. 安装完成后的页面 URL 形如：
   `https://github.com/settings/installations/12345678`
   —— 结尾的数字就是 **Installation ID**。
4. 也可以在安装页左侧 **Installations** 里点进去看 URL 里的数字。
5. （备选）用 JWT 调 `GET /repos/{owner}/{repo}/installation` 也能查到。

> 安装后如果之后**修改了 App 权限**，每个 installation 需要重新批准，GitHub 会在安装页给出提示。别忘了点确认，否则新权限不生效。

---

## 6. 交给维护 Agent 什么

把这三样发给我（**私钥用附件上传，不要贴在聊天里**）：

```
App ID (或 Client ID) : 123456
Installation ID       : 87654321
private-key.pem       : 作为附件上传
```

我会在沙箱里这样安置（**都在仓库目录之外**，git 不会跟踪，`check-secrets.sh` 也扫不到）：

```
~/.config/tokentracker-gh-app/
├── config.env          # 非密钥：GH_APP_ID / GH_INSTALLATION_ID / GH_APP_PRIVATE_KEY_PATH
└── private-key.pem     # chmod 600
```

---

## 7. 认证流程（Agent 侧做了什么）

```
[私钥 PEM + App ID]
   │  RS256 签名 JWT（iat = now-60s，exp = now+600s，iss = App ID / Client ID）
   ▼
POST https://api.github.com/app/installations/{INSTALLATION_ID}/access_tokens
   │  Authorization: Bearer <JWT>
   ▼
installation access token（有效期 1 小时）
   │  用户名固定 x-access-token，token 作为 HTTP 密码
   ▼
git push https://x-access-token:<token>@github.com/OWNER/REPO.git main
```

实现要点：

- JWT 必须 **RS256**，`iat` 建议取 60 秒前以容忍时钟漂移，`exp` 最多 10 分钟；`iss` 用 App ID 或 Client ID。[2](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app)
- `POST /app/installations/{id}/access_tokens` 返回的 token **1 小时过期**；可用 `repositories` / `permissions` 请求体进一步收窄（不传则继承 installation 的全部权限）。[3](https://docs.github.com/en/rest/apps/apps)
- Git over HTTPS 的用法是 `https://x-access-token:TOKEN@github.com/...`。[1](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)
- 本仓库的 `scripts/push-with-app.sh` 通过 `GIT_ASKPASS` 把 token 注入单次 push 进程：**不写进 URL、不写 `.git/config`、不落 shell 历史、输出自动脱敏**，推送后立即删除临时文件。
- 2026 年起 GitHub 逐步把 installation token 换成无状态格式 `ghs_APPID_JWT`（约 520 字符，不再是固定 40 字符），脚本已按前缀脱敏并兼容长 token。[4](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)

### 使用命令

```sh
./scripts/bootstrap.sh                      # 恢复 remote / 提交身份
./scripts/push-with-app.sh --dry-run        # 只验证配置 + 换取 token，不推送
./scripts/push-with-app.sh -u origin main   # 实际推送
```

`session-start.sh` 会检查 `~/.config/tokentracker-gh-app/` 是否就绪并在缺失时提示。

---

## 8. 可选的主动化：定时检查上游

Agent 无法在本环境里主动定时运行。若要让"长期维护"更自动，可加一个定时 workflow：每周用 `upstream.sh review` 做只读检查，发现上游契约变化时自动开 issue 提醒（这正是 `Issues: R/W` 权限的用途）。

- CI 只负责**检查 + 提醒**，不自动 `pin`、不自动部署——决策权在人。
- 需要把 App 的 `Client ID` 存为 repository variable、私钥存为 repository secret，并用 `actions/create-github-app-token` 换取 token。[5](https://github.com/actions/create-github-app-token)

---

## 9. 轮换与撤销

| 场景 | 操作 |
|---|---|
| 怀疑私钥泄露 | App settings → Private keys → 生成新私钥（旧的立即失效），更新本地 `private-key.pem` |
| 停止维护 | Install App → **Uninstall**，或 App settings → 删除 App |
| 收紧权限 | App settings → Permissions & events → 修改 → **每个 installation 重新批准** |
| 审计 | App settings → Advanced / 安装页可查看近期活动 |

> installation token 只有 1 小时寿命，即使泄露影响窗口也很短；真正需要保护的是私钥。

---

## 参考

1. Choosing permissions for a GitHub App — <https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app>
2. Generating a JSON Web Token (JWT) for a GitHub App — <https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app>
3. REST API endpoints for GitHub Apps（Create an installation access token）— <https://docs.github.com/en/rest/apps/apps>
4. Generating an installation access token for a GitHub App — <https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app>
5. actions/create-github-app-token — <https://github.com/actions/create-github-app-token>
