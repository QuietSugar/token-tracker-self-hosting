# 内建看板

服务端内置一个用量看板，**无需安装任何前端**：浏览器打开 `http://<你的地址>:8080/` 就是它。

- 如需官方 dashboard / 菜单栏的完整视图，请参见 [`official-client.md`](official-client.md)，两者可同时使用。
- 本页面面向「快速查看当日用量」的场景，不需要 npm，也不需要公网访问。
  **用量数据只读**；页面上唯一能改的是设备名称（见下节）。

## 登录

三种登录方式，按可用条件选择：

| 可用凭据 | 操作 |
|---|---|
| owner 账户密码 | 邮箱 + 密码，走 `POST /api/auth/sessions`（服务端设了 `TT_AUTH_EMAIL`/`TT_AUTH_PASSWORD` 才会有） |
| 一个 JWT | 点「直接粘贴 JWT」，把 `./scripts/issue-token.sh --json` 的输出贴进去 |
| 均无 | 参见 [`quickstart.md`](quickstart.md)，由脚本签发 |

token 仅保存在 `sessionStorage`：关闭标签页即失效，不写入磁盘，不写入 cookie。
access token 在 1 小时后过期时，页面会使用登录取得的 refresh token **自动续期一次**后重试；续期失败才返回登录页，并注明具体请求、状态码与响应内容。

## 页面内容

- **6 张统计卡**：总 tokens、输入、输出、缓存读+写、推理、费用（USD）
- **最近 26 周热力图**（按天，颜色按用量分级）
- **按模型**：条形图，前 12 个，带来源标签与费用
- **按设备**：每台设备一行
- **按日明细**：日期 / 总量 / 输入 / 输出 / 费用
- **周期切换**：今日 / 近 7 天 / 本月 / 全部（= 近 24 个月）
- **设备下拉**：只统计选中的那台

## 重命名设备

「按设备」列表每行的「改名」按钮打开行内输入框，回车或「保存」提交，Esc 或「取消」放弃。

- 走的是官方端点 `/functions/tokentracker-device-rename`（请求体 `{device_id, device_name}`），
  与官方 dashboard 的请求体一致。
- **同一平台下重名会被拒绝**（409）：两台设备都叫 `nas` 时，页面会提示换一个名字。
  这条约束来自数据库上的部分唯一索引 `(user_id, platform, device_name)`。
- 改名同时写入 `devices.device_name`（本页与 `account-devices`）和 `cloud_machines.name`
  （`billing?action=devices`，官方 dashboard 的设备卡片），两处名字一致。
- 客户端重新执行 `device-login` 或重签 token **不会覆盖**服务端改好的名字：设备行按 `machine_id`
  复用，不会被当成新设备。手写脚本若不带 `machine_id`，才会按 `platform + device_name` 匹配失败而新建一台。
- 暂停 / 恢复设备**不在本页**（见 [`devices.md`](devices.md)）。

## 两项有意的设计选择

1. **列出全部设备，包括 0 用量的**（标注「无用量」）。官方 dashboard 会将当前周期无用量的设备从下拉列表中隐藏，易被误解为设备丢失。
2. **用量只读，写操作走白名单**：页面读取用量全部是 GET；POST 只有三个 —— 登录（`/api/auth/sessions`）、
   续期（`/api/auth/refresh`）、设备改名（`/functions/tokentracker-device-rename`）。
   暂停、恢复、删除数据均不在此进行（见 [`devices.md`](devices.md)）；
   `TestDashboardWritesAreAllowlisted` 把这三条写死在测试里，多出任何写端点都会让它失败。

## 保证与限制

- **零外部请求**：样式与脚本全部内联，不引入 CDN / 字体 / 统计脚本；响应头 `Content-Security-Policy: default-src 'none'` 禁止一切外部资源加载。内网无公网出口时也能正常显示。
- `Cache-Control: no-store`，数据不会被中间缓存保留。
- 其它未注册路径仍然是 `404 {"error":"not found"}`（脚本依赖这个形状）。
- 数据来自 `/functions/tokentracker-account-*`，与官方 dashboard 使用同一批端点，因此两边数字一致；若不一致，请先检查时区设置（页面自动携带浏览器时区）。

## 切换回官方 dashboard

按 [`official-client.md`](official-client.md) 配置 `TT_DASHBOARD_URL` 与客户端 `base_url` 即可，内建看板不受影响。
