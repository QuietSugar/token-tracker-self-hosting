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

### 设备名与平台从哪里来

客户端发起 `device-login` 时会上报两样身份：

| 字段 | 客户端取值 | 服务端用法 |
|---|---|---|
| `client_info` | `${os.platform()}-${os.arch()} ${os.hostname()}`，如 `linux-x64 hp` | 取其中**空格之后的部分当设备名**（即 hostname） |
| `machine_id` | 首次运行生成并持久化在客户端配置里的 UUID | 设备的**真实身份**，判重只看它 |

因此设备列表里看到的是 `hp`、`nas`、`vm128` 这种名字，`platform` 统一为 `cli-device-flow`（与官方实现一致）。
`client_info` 里没有 hostname 时（自定义脚本）退回 `TokenTracker CLI (<client_info>) #<machine_id 前 8 位>`，
仍然能区分机器。

**设备名只用于展示**：判断「是不是同一台机器」始终看 `machine_id`。改名、加后缀都不会改变用量归属。

### 三种批准方式（`TT_DEVICE_APPROVE`）

| 模式 | 接入动作 | 适用场景 |
|---|---|---|
| `page`（**默认**） | 浏览器打开链接并选择「批准」 | 与官方一致；有可用浏览器 |
| `auto` | 无 —— `device-login` 直接完成 | NAS / 无头机器，无需人工交互 |
| `jwt` | `./scripts/approve-device.sh FQYG-CFWL --base …`，或携带 JWT 调用 `device-flow-grant` | 需要保留审批边界 |

**安全边界（重要）**：在 `page` 与 `auto` 模式下，凡能访问本服务并取得 `user_code` 者，均可将设备接入 owner 账户。
`user_code` 仅出现在发起申请的机器终端中，是该流程唯一的凭据 —— 官方 device flow 采用同一模型，
区别在于官方页面要求先登录 dashboard。**请勿将使用 `page` / `auto` 的实例暴露到公网**；需要真正的审批边界时使用 `jwt`。

### 同一台机器重复接入 vs 不同机器

- **同一台机器**再次 `device-login`（`machine_id` 相同）：**复用同一设备记录**并签发新 token，不新增设备。
  这是最常见的情形——重装客户端、清空配置后重新登录都不会多出一行。
- **不同机器**接入（`machine_id` 不同）：**一定新建各自的设备记录**，即使两台机器 hostname 相同、
  或 `client_info` 完全一样。每个 device token 都指向自己那台机器的设备行，用量不会串。
- **重名处理**：两台机器报同一个 hostname 时，后接入的那台自动改名为 `hp #1a2b3c4d`
  （machine_id 前 8 位），接入照常成功。想合并展示就用看板「改名」改成不同名字；
  两台机器**不会**共用一行——共用行意味着两台的用量被混记成一台。
- **老库升级**：早于本版本创建的设备行可能没有 `machine_id`。同名的机器重新接入时会**认领**那一行
  （回填 `machine_id`），不会为同一台机器再造一行。

`devices` 上有 `(user_id, machine_id)` 与 `(user_id, platform, device_name)` 两个 partial unique index，
上面这些规则就是为了既能重复接入、又不撞索引、又不把两台机器的数据混在一起。

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
- 同 `machine_id` 重复调用是安全的：复用设备行并更换新 token（客户端重装、脚本重跑均属此类）。
- 换了 `machine_id` 但沿用同名 `device_name` 时，会新建一行并把名字改成 `nas #1a2b3c4d`——
  宁可名字难看，也不把新机器的用量记到老设备名下。
- 账户行不存在时会自动创建（`ensureAccount`），首次使用不会因外键约束失败。

上传约束：单次 ≤500 个桶、body ≤1 MiB；主键 `user_id+device_id+hour_start+source+model`，
**同键重复上传为整行替换**，因此重传安全。

### 凭据有效期：device token 永不过期

`device_tokens` 表只有 `token_hash` 与 `revoked_at`，**没有任何过期列**，客户端侧也不存有效期
（`device-login` 只写 `deviceToken` 与 `deviceTokenBaseUrl`）。因此：

- 签发十年后的 token 依然可以上传；**不存在「到期后要重新 `device-login`」这回事**。
- 唯一能让 token 失效的操作是**撤销**（暂停设备 / 删除设备），没有第二个途径。
- 每次成功上传都会刷新该机器的 `last_seen_at`（设备清单上的「最后活跃」），
  所以持续 `sync` 的机器在清单上一直是活的——不需要任何额外的「续期」动作。

真正有时间限制的是另外三样，都不影响 `sync`：

| 有期限的东西 | 时限 | 影响 |
|---|---|---|
| `user_code`（设备授权码） | 15 分钟 | 只约束「批准」这一步，过期重新 `device-login` 即可 |
| 看板 access token | 1 小时 | 看板自动用 refresh token 续期 |
| 看板 refresh token | 90 天 | 每次刷新都轮换并重新计时；只影响看板登录，不影响上传 |

---

## 5. 重命名 / 暂停 / 恢复

本项目的工作模式是**设备长期在线**：接一次、之后一直 `sync`。下面的「暂停 / 恢复」只是为与官方
dashboard 保持一致而保留的能力，日常不需要用；看板也不提供（见 [`dashboard.md`](dashboard.md)）。

**重命名**：内建看板（`GET /`）的设备列表里有「改名」按钮，行内改完即生效，见
[`dashboard.md`](dashboard.md)。下面是等价的 HTTP 调用（脚本 / 官方 dashboard 用）：

冲突时返回 409：

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

改名相关的两个要点：

- 名字存在两张表上（`devices.device_name` 与 `cloud_machines.name`），改名会同时写；只改一张会让
  本服务的设备列表与官方 dashboard 的设备卡片显示两个名字。
- 客户端再次 `device-login` 不会覆盖改好的名字（按 `machine_id` 复用设备行），但**同一平台下不能重名**。

---

## 6. 用量记错了设备怎么办（老数据修复）

设备归属曾经出过一次问题：`device-login` 的判重条件里带了一条「同名同平台也算同一台设备」，
于是**新机器会借用已有设备行**——它上传的用量全部记在旧机器名下（账户总量没错，只是跨设备汇总里
旧机器虚高、新机器偏少）。当前版本已修复（见 [`CHANGELOG`](../../CHANGELOG.md)），但**已经写错的历史行不会自己搬家**，
需要按下面两步处理。

### 6.1 先诊断（只读）

```sh
psql "$TT_DATABASE_URL" -f go-server/scripts/device-report.sql
```

四段输出，按需看：

1. 每台设备的 token 数、桶数、总量、时间范围 —— 数量明显不合理的那台就是受害者/受益者。
2. **可疑登录**：`device_codes` 里「批准的 `machine_id`」与「落到的设备行的 `machine_id`」不一致的记录。
   有输出 = 这台机器的 token 指向了别人的设备行，就是本节的场景。
3. 同一 `(hour_start, source, model)` 同时出现在多台设备下 —— 搬迁时会撞主键，见 6.2 的 `--merge`。
4. 全库总计 —— 记下这个数字，搬迁前后对比，确认没丢。

非默认 schema 时加 `PGOPTIONS='-c search_path=<schema>'`，或先 `SET search_path`。

### 6.2 再搬迁

```sh
# 试运行：只统计，不写库
./go-server/scripts/device-move-usage.sh --dsn "$TT_DATABASE_URL" --from vm128 --to hp

# 只搬一段时间（误归属发生的那几天）
./go-server/scripts/device-move-usage.sh --dsn "$TT_DATABASE_URL" --from vm128 --to hp \
    --since 2026-10-20 --until 2026-10-26 --apply
```

- `--from` / `--to` 用**设备名**（唯一时）或**设备 id**；重名时必须用 id，脚本会列出来让你选。
- 只搬 `hourly`（用量）。设备行、token、机器名都不动 —— 那些用 `device-login` 重签或看板改名处理。
- 目标设备已有同一 `(hour_start, source, model)` 时默认**中止并退出码 2**，先让你人工核对；
  确认是「同一批数据的上报」才用 `--merge=sum`（数值相加后合并）。
- 搬完会打印全库总计。**与搬前一致**即说明没有丢数据。
- 改完库后聚合缓存的失效是按用户清理的，脚本里已包含；若看板仍显示旧数字，刷新页面即可（服务端有 60 秒缓存）。

设备名不用手改：确认哪台是哪台之后，在看板里点「改名」（见 [`dashboard.md`](dashboard.md)）即可。

---

## 7. 相关命令

```sh
./scripts/issue-token.sh                  # 签发 JWT（默认取本机 owner）
./scripts/issue-token.sh --json           # 仅输出 token
./scripts/approve-device.sh FQYG-CFWL     # jwt 模式下批准设备
./scripts/check-oauth.sh                  # 自检：登录 → 轮换 → 旧 token 拒绝 → 撤销 → 读 account
./scripts/device-report.sql               # 只读诊断：设备用量 / 可疑登录 / 汇总对账
./scripts/device-move-usage.sh            # 把误归属的用量从一个设备搬到另一个设备
```
