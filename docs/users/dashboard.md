# 内建看板

服务端自带一个只读页面，**不用装任何前端**：浏览器打开 `http://<你的地址>:8080/` 就是它。

- 想接官方 dashboard / 菜单栏的完整视图，那走 [`official-client.md`](official-client.md)，两者不冲突。
- 这里解决的是"我就想看一眼今天用了多少"，不需要 npm、不需要公网。

## 登录

三种进法，按你有的选：

| 你有什么 | 怎么做 |
|---|---|
| owner 账户密码 | 邮箱 + 密码，走 `POST /api/auth/sessions`（服务端设了 `TT_AUTH_EMAIL`/`TT_AUTH_PASSWORD` 才会有） |
| 一个 JWT | 点「直接粘贴 JWT」，把 `./scripts/issue-token.sh --json` 的输出贴进去 |
| 什么都没有 | 见 [`quickstart.md`](quickstart.md)，脚本会替你签 |

token 只存在 `sessionStorage`：关掉标签页就失效，不落盘、不写 cookie。
access token 1 小时后过期时，页面会用登录拿到的 refresh token **自动续一次**再重试；续不上才回登录页，并写明是哪个请求、什么状态码、返回了什么。

## 里面有什么

- **6 张统计卡**：总 tokens、输入、输出、缓存读+写、推理、费用（USD）
- **最近 26 周热力图**（按天，颜色按用量分级）
- **按模型**：条形图，前 12 个，带来源标签与费用
- **按设备**：每台设备一行
- **按日明细**：日期 / 总量 / 输入 / 输出 / 费用
- **周期切换**：今日 / 近 7 天 / 本月 / 全部（= 近 24 个月）
- **设备下拉**：只统计选中的那台

## 它刻意做的两个选择

1. **列出全部设备，包括 0 用量的**（标「无用量」）。官方 dashboard 会把当前周期没量的设备从下拉里藏起来，看起来像"设备丢了"。
2. **只读**：页面只发 GET，唯一的 POST 是登录。改名、暂停设备、删数据都不在这里做（见 [`devices.md`](devices.md)）。

## 保证与限制

- **零外部请求**：样式、脚本全内联，不引 CDN / 字体 / 统计脚本；响应头 `Content-Security-Policy: default-src 'none'` 把外联堵死。内网没有公网出口也能正常显示。
- `Cache-Control: no-store`，不会把数据留在中间缓存里。
- 其它未注册路径仍然是 `404 {"error":"not found"}`（脚本依赖这个形状）。
- 数据来自 `/functions/tokentracker-account-*`，和官方 dashboard 用的是同一批端点——所以两边数字一致；不一致时先看时区设置（页面自动带浏览器时区）。

## 想换回官方 dashboard

按 [`official-client.md`](official-client.md) 配 `TT_DASHBOARD_URL` 与客户端 `base_url` 即可，内建看板不受影响。
