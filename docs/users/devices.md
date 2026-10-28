# 设备

一台机器要向本后端上报用量，需要**一条设备记录**和**一个 device token**。
正常流程由官方客户端完成（见 §1），也可手工签发（见 §4）。

## 1. 标准接入流程（与官方一致）

在**新机器**上（已按 [`official-client.md`](official-client.md) 配置好 `base_url` 与 anon key）：

```sh
tracker device-login --base-url https://tt.lan:8443 --anon-key "$ANON"
```

它会输出一个链接，形如 `https://tt.lan:8443/device?user_code=FQYG-CFWL`。
**使用任意浏览器打开**（本机、手机或另一台电脑均可），确认页面显示的机器信息无误后选择「批准」。
终端在一轮轮询内取得 device token，并写入 `~/.tokentracker/tracker/config.json`。

`/device` 页面会显示：设备代码、申请方的 `client_info`（客户端版本/平台）、`machine_id`、有效期。
批准前可确认是否为本人机器 —— 仅凭用户代码即批准，等同于未做设备确认。

### 三种批准方式（`TT_DEVICE_APPROVE`）

| 模式 | 接入动作 | 适用场景 |
|---|---|---|
| `page`（**默认**） | 浏览器打开链接并选择「批准」 | 与官方一致；有可用浏览器 |
| `auto` | 无 —— `device-login` 直接完成 | NAS / 无头机器，无需人工交互 |
| `jwt` | `./scripts/approve-device.sh FQYG-CFWL --base …`，或携带 JWT 调用 `device-flow-grant` | 需要保留审批边界 |

**安全边界（重要）**：在 `page` 与 `auto` 模式下，凡能访问本服务并取得 `user_code` 者，均可将设备接入 owner 账户。
`user_code` 仅出现在发起申请的机器终端中，是该流程唯一的凭据 —— 官方 device flow 采用同一模型，
区别在于官方页面要求先登录 dashboard。**请勿将使用 `page` / `auto` 的实例暴露到公网**；需要真正的审批边界时使用 `jwt`。

### 同一台机器重复接入

再次执行 `device-login` 会**复用同一设备记录**并签发新 token，不会新增设备
（`devices` 上有 `(user_id, machine_id)` 与 `(user_id, platform, device_name)` 两个 partial unique index）。

---

## 2. 设备归属

所有设备均归属于**本服务的 owner 账户**。先接入设备或先创建账户均可，最终指向同一账户
（`auth_owner` 为单例，不存在「默认账户 UUID」）。

仅存储用量、不需要跨设备汇总：无需账户，仅使用 device token（见 §4）。
需要 dashboard / 菜单栏显示跨设备汇总：需要 owner 账户并登录。

---

## 3. 按设备查看用量

```sh
curl -s -H "Authorization: Bearer $TOKEN" \
  'http://127.0.0.1:8080/functions/tokentracker-account-devices?from=2026-09-01&to=2026-10-27&tz=Asia/Shanghai'
```

返回内容仅含未撤销设备，按用量降序排列：

```json
{"from":"…","to":"…","devices":[{"id":"…","device_name":"macbook","platform":"darwin",
  "created_at":"…","total_tokens":2524170}],"account_sources":[]}
```

- **不过滤 0 用量**：`total_tokens` 为 0 的设备同样列出。官方 dashboard 会在前端隐藏这些设备，本项目予以保留 —— 否则易被误认为设备丢失。
- `account_sources` 在自托管下恒为空数组：所有用量均带 `device_id`，不存在「账户级」来源。

其余端点均接受 `?device_id=<uuid>`，用于仅统计指定设备：

```sh
curl -s -H "Authorization: Bearer $TOKEN" \
  'http://127.0.0.1:8080/functions/tokentracker-account-summary?from=2026-10-01&to=2026-10-27&device_id=…'
```

`device_id` 格式不合法（非 UUID）时按未传处理，不返回错误；其他账户的 `device_id` 返回空结果 —— 归属由 SQL 中的 `user_id` 条件保证。

### 时区

所有 `account-*` 端点接受官方的 `tz`（IANA 名称）与 `tz_offset_minutes`（= `-Date.getTimezoneOffset()`），
按**本地日**归集：查库时把 UTC 窗口向前放宽 1 天、向后放宽 2 天，再按 `(tz)` 的本地日期裁剪
（覆盖最大 ±14h 时区）。summary 的 rolling 窗口锚定本地当天，`days` 为本地活跃天数。不传时按 UTC 计算。

内建看板会自动携带浏览器时区；使用 `curl` 时易遗漏，**「当日有数据但查询为空」通常源于缺少 `tz`**。

---

## 4. 手工签发 device token（不使用官方客户端）

适用场景：自行编写上报脚本、运行导入工具、准备手工设备。

```sh
# 1) 先有一条设备 + 一个 device token（需要 owner 的 JWT）
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"device_name":"nas","platform":"linux","machine_id":"m-nas"}' \
  http://127.0.0.1:8080/functions/tokentracker-device-token-issue
# {"token":"…","device_id":"…","machine_id":"m-nas","device_name":"nas","membership":{…}}

# 2) 用它上传用量
curl -s -X POST -H "Authorization: Bearer <token>" -H 'Content-Type: application/json' \
  -d '{"buckets":[{"hour_start":"2026-10-20T10:00:00Z","source":"codex","model":"gpt-6",
       "input_tokens":1234,"total_tokens":1234,"billable_total_tokens":1234}]}' \
  http://127.0.0.1:8080/functions/tokentracker-ingest
```

注意事项：

- **device token 不是 JWT**：为随机串，服务端仅保存其 SHA-256；丢失后无法找回，只能重新签发。
- 同名 / 同 `machine_id` 重复调用是安全的：复用设备行并更换新 token（客户端重装、脚本重跑均属此类）。
- 账户行不存在时会自动创建（`ensureAccount`），首次使用不会因外键约束失败。

上传约束：单次 ≤500 个桶、body ≤1 MiB；主键 `user_id+device_id+hour_start+source+model`，
**同键重复上传为整行替换**，因此重传安全。

---

## 5. 重命名 / 暂停 / 恢复

**重命名**（冲突时返回 409）：

```sh
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"device_id":"…","device_name":"书房的 MacBook"}' \
  http://127.0.0.1:8080/functions/tokentracker-device-rename
```

**暂停 / 恢复**：按**机器**操作（官方 dashboard 的设备卡片即调用这两个 action）。

```sh
# 1) 列出机器，取各项的 machine_id（响应中的 machines[]）
curl -s -H "Authorization: Bearer $TOKEN" \
  'http://127.0.0.1:8080/functions/tokentracker-billing?action=devices&current_machine_id=m-nas'
# {"machines":[{"machine_id":"m-nas","name":"nas","platform":"linux","status":"active",
#               "is_current":true,"last_seen_at":"…"}],"machine_count":1,"machine_limit":null,
#  "over_machine_limit":null,"membership":{…}}

# 2) 暂停：将该机器置为 paused，并撤销其名下设备的 device token（此后无法上传）
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"machine_id":"m-nas"}' \
  'http://127.0.0.1:8080/functions/tokentracker-billing?action=remove-device'

# 3) 恢复
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"machine_id":"m-nas"}' \
  'http://127.0.0.1:8080/functions/tokentracker-billing?action=resume-device'
```

- 请求体字段为 **`machine_id`**（`machines[].machine_id`，也接受该行的内部 `id`），**不是 `device_id`** —— 传 `device_id` 会返回 400 `machine_id is required`。
- 两个 action 均为 POST；响应为操作后的机器列表及 `ok:true`。
- **暂停 = 撤销该机器的设备与 device token**（上传返回 401）；**恢复 = 还原被撤销的那一份**，
  该机器使用**原有 token** 即可继续上传，无需重新执行 `device-login`。
- 若暂停期间客户端已重新执行 `device-login`（新的设备行与新 token 已处于活跃状态），恢复时保留旧行的撤销状态 ——
  该机器已有可用新 token，不会出现两条活跃设备行。
- 暂停不会删除历史用量。`ingest` 会更新该机器的 `last_seen_at`（即设备卡片上的「最后活跃」）。

---

## 6. 相关命令

```sh
./scripts/issue-token.sh                  # 签发 JWT（默认取本机 owner）
./scripts/issue-token.sh --json           # 仅输出 token
./scripts/approve-device.sh FQYG-CFWL     # jwt 模式下批准设备
./scripts/check-oauth.sh                  # 自检：登录 → 轮换 → 旧 token 拒绝 → 撤销 → 读 account
```
