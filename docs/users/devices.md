# 设备

一台机器要用这个后端上报用量，需要两样东西：**一条设备记录** 和 **一个 device token**。
正常流程由官方客户端自己完成（下面 §1），你也可以手工签发（§4）。

## 1. 正常接法：和官方一模一样

在**新机器**上（已按 [`official-client.md`](official-client.md) 配好 `base_url` 与 anon key）：

```sh
tracker device-login --base-url https://tt.lan:8443 --anon-key "$ANON"
```

它会打印一个链接，形如 `https://tt.lan:8443/device?user_code=FQYG-CFWL`。
**用任何浏览器打开它**（这台机器、手机、另一台电脑都行），确认页面上的机器信息是你自己的，点「批准」。
终端在一轮轮询内拿到 device token，写进 `~/.tokentracker/tracker/config.json`。

`/device` 页面会显示：设备代码、申请方的 `client_info`（客户端版本/平台）、`machine_id`、有效期。
批准前能确认是不是自己的机器 —— 只凭一串代码点批准等于闭眼放行。

### 三种批准方式（`TT_DEVICE_APPROVE`）

| 模式 | 接入动作 | 什么时候用 |
|---|---|---|
| `page`（**默认**） | 浏览器打开链接点「批准」 | 和官方一致；有浏览器可用 |
| `auto` | 无 —— `device-login` 直接完成 | NAS / 无头机器，不想点按钮 |
| `jwt` | `./scripts/approve-device.sh FQYG-CFWL --base …`，或带 JWT 调 `device-flow-grant` | 想保留审批边界 |

**安全边界（重要）**：`page` 和 `auto` 都等于"能访问本服务、并且拿到 `user_code` 的人可以把设备接进 owner 账户"。
`user_code` 只出现在发起申请那台机器的终端里，是这套流程唯一的凭据——官方 device flow 也是同一个模型，
区别只是官方那页还要求你先登录 dashboard。**不要把 `page`/`auto` 的实例暴露到公网**；需要真正的审批边界就用 `jwt`。

### 同一台机器重复接入

再次 `device-login` 会**复用同一台设备记录**、签发新 token，不会多出一台设备
（`devices` 上有 `(user_id, machine_id)` 与 `(user_id, platform, device_name)` 两个 partial unique index）。

---

## 2. 设备归谁

所有设备都属于**这台服务的 owner 账户**。先接设备还是先建账户都行，最后是同一个账户
（`auth_owner` 单例；不存在"默认账户 UUID"这种东西）。

只想存用量、不看跨设备汇总：可以完全不管账户，只用 device token（见 §4）。
想让 dashboard / 菜单栏显示跨设备汇总：需要 owner 账户并登录。

---

## 3. 看每台设备用了多少

```sh
curl -s -H "Authorization: Bearer $TOKEN" \
  'http://127.0.0.1:8080/functions/tokentracker-account-devices?from=2026-09-01&to=2026-10-27&tz=Asia/Shanghai'
```

返回（只含未撤销设备，按用量降序）：

```json
{"from":"…","to":"…","devices":[{"id":"…","device_name":"macbook","platform":"darwin",
  "created_at":"…","total_tokens":2524170}],"account_sources":[]}
```

- **不过滤 0 用量**：`total_tokens` 为 0 的设备也会列出来。官方 dashboard 会在前端把 0 的藏掉，我们保留——否则看起来像设备丢了。
- `account_sources` 在自托管下恒为空数组：所有用量都带 `device_id`，没有"账户级"来源。

其余端点都接受 `?device_id=<uuid>` 只看某台设备：

```sh
curl -s -H "Authorization: Bearer $TOKEN" \
  'http://127.0.0.1:8080/functions/tokentracker-account-summary?from=2026-10-01&to=2026-10-27&device_id=…'
```

`device_id` 形状不对（不是 UUID）时按"没传"处理，不报错；别人的 `device_id` 查出来是空——归属靠 SQL 里的 `user_id` 条件。

### 时区

所有 `account-*` 端点认官方的 `tz`（IANA 名）与 `tz_offset_minutes`（= `-Date.getTimezoneOffset()`），
按**本地日**归日：UTC 窗口两侧各放宽一天再按本地日裁剪。summary 的 rolling 窗口锚在本地今天，
`days` 是本地活跃天数。不传就按 UTC 算。

内建看板会自动带上浏览器的时区；用 `curl` 时容易忘，**"今天有数据但查不到"通常是漏了 `tz`**。

---

## 4. 手工签发 device token（不用官方客户端）

适合：写自己的上报脚本、跑导入工具、准备一台手工设备。

```sh
# 1) 先有一条设备 + 一个 device token（需要 owner 的 JWT）
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"device_name":"nas","platform":"linux","machine_id":"m-nas"}' \
  http://127.0.0.1:8080/functions/tokentracker-device-token-issue
# {"token":"…","device_id":"…","machine_id":"m-nas","device_name":"nas"}

# 2) 用它上传用量
curl -s -X POST -H "Authorization: Bearer <token>" -H 'Content-Type: application/json' \
  -d '{"buckets":[{"hour_start":"2026-10-20T10:00:00Z","source":"codex","model":"gpt-6",
       "input_tokens":1234,"total_tokens":1234,"billable_total_tokens":1234}]}' \
  http://127.0.0.1:8080/functions/tokentracker-ingest
```

要点：

- **device token 不是 JWT**：随机串，服务端只存 SHA-256；丢了对不上，只能重签。
- 同名 / 同 `machine_id` 重复调用是安全的：复用设备行、换新 token（客户端重装、脚本重跑都会这样）。
- 账户行不存在时会自动建（`ensureAccount`），首次使用不会因为外键失败。

上传约束：单次 ≤500 个桶、body ≤1 MiB；主键 `user_id+device_id+hour_start+source+model`，
**同键重复上传是整行替换**，所以重传安全。

---

## 5. 改名 / 暂停 / 恢复

**改名**（冲突返回 409）：

```sh
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"device_id":"…","device_name":"书房的 MacBook"}' \
  http://127.0.0.1:8080/functions/tokentracker-device-rename
```

**暂停 / 恢复**（官方 dashboard 设备卡走的就是这两个）：

```sh
# 列出机器（含 is_current、machine_count、membership）
curl -s -H "Authorization: Bearer $TOKEN" \
  'http://127.0.0.1:8080/functions/tokentracker-billing?action=devices&current_machine_id=m-nas'

# 暂停：撤销这台机器的 device token，它就不能再上传
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"device_id":"…"}' \
  'http://127.0.0.1:8080/functions/tokentracker-billing?action=remove-device'

# 恢复
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"device_id":"…"}' \
  'http://127.0.0.1:8080/functions/tokentracker-billing?action=resume-device'
```

暂停只撤销 token，**不删历史用量**。`ingest` 会更新该机器的 `last_seen_at`（设备卡片上的"最后活跃"）。

---

## 6. 相关命令

```sh
./scripts/issue-token.sh                  # 签 JWT（默认取本机 owner）
./scripts/issue-token.sh --json           # 只要 token
./scripts/approve-device.sh FQYG-CFWL     # jwt 模式下批准设备
./scripts/check-oauth.sh                  # 自检：登录 → 轮换 → 旧 token 拒绝 → 撤销 → 读 account
```
