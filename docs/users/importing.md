# 导入历史用量

两种数据源，两个工具，**别混用**。

| 你的数据在哪 | 用哪个 | 为什么 |
|---|---|---|
| CSV / JSON / JSONL 导出文件（官方 dashboard 导出、旧 SQLite 实例导出、自己的账单表） | [`scripts/import-usage.py`](#import-usagepy外部文件) | 要把各种时间格式、列名、时区统一成服务端的键 |
| 官方客户端自己的 `~/.tokentracker/tracker/queue.jsonl` | [`scripts/replay-queue.py`](#replay-queuepy客户端本地队列) | 要保持客户端原始时间戳，否则会和已上传的行变成两份 |

> **正常从官方云切过来不需要任何工具**：`tracker init` 换地址后客户端自己会把队列重放一遍，
> 见 [`official-client.md`](official-client.md) §5。这里解决的是它帮不上的情况。

两个工具都支持 `--dry-run`，**先用它看统计**。导入是幂等的（主键整行替换），重跑不会翻倍。

---

## import-usage.py：外部文件

```sh
cd go-server

# 先干跑，看它怎么理解你的文件
./scripts/import-usage.py --base http://192.168.1.10:8080 --jwt "$JWT" \
  --device-name old-cloud --input export.csv --dry-run

# 确认无误再真导
./scripts/import-usage.py --base http://192.168.1.10:8080 --jwt "$JWT" \
  --device-name old-cloud --input export.csv
```

输入格式：

- **CSV / TSV**：第一行表头，列名有别名（`timestamp`/`time`/`hour` → `hour_start`，`provider` → `source`，
  `prompt_tokens` → `input_tokens`，`completion_tokens` → `output_tokens`，`cost`/`usd` → `total_cost_usd`…）
- **JSONL**：每行一个对象；**JSON**：一个数组
- 时间支持 `2026-10-18 09:15:00`、`2026-10-18T23:30:00+08:00`、epoch 秒/毫秒

它会做的处理：

- **时间归一化到 UTC 整点**（`2026-10-18T09:00:00Z`）。服务端按字符串比较时间，非 UTC 或带偏移会查不到数据。
- 缺字段兜底：`total_tokens` 缺失时按 `input+output+reasoning+cache_creation` 算；`billable_total_tokens` 留 0（服务端按 total 处理）。
- 按主键去重、自动分批（默认 200/批，上限 500，并按 ≤512KB 切）、网络/5xx 退避重试。
- `--jwt` 模式自动签 device token 并缓存到 `~/.cache/token-tracker/device-tokens.json`（0600，按「服务地址+设备名」索引），
  重跑不会因为「同名设备已存在」失败。也可以用 `--device-token` 直接给。

常用参数：`--since` / `--until`（只导一段）、`--device-name`（一台来源固定一个名字，如 `old-cloud`、`nas`）、
`--batch`、`--no-cache`、`--format csv|jsonl|json`、`--input -`（读 stdin）。

**注意它会把时间归整到整点**：所以它适合导入"客户端从没传过的历史"，不要拿它重灌客户端已经上传过的同一批桶
（`…T00:30:00.000Z` 与 `…T00:30:00Z` 在服务端是两行）。

退出码：0 全部成功；1 参数/输入错误；2 有批次失败（已成功的不回滚，重跑即可）。

---

## replay-queue.py：客户端本地队列

把 `~/.tokentracker/tracker/queue.jsonl` 原样重放进服务端。三种情况用得上：

1. 客户端已经把 offset 推过去了，但那个后端的数据没留住（库重建、换 schema、误删）
2. 换机 / 换账号搬历史（把旧机器的 `~/.tokentracker` 备份拷过来）
3. 核对"我那次 sync 到底传全了吗"

```sh
cd go-server

# 干跑：统计 + 客户端自己的 offset 进度
./scripts/replay-queue.py --base https://tt.lan:8443 --jwt "$JWT" --dry-run

# 真重放（默认读 ~/.tokentracker/tracker/queue.jsonl）
./scripts/replay-queue.py --base https://tt.lan:8443 --jwt "$JWT"

# 用备份文件，只搬一段先试
./scripts/replay-queue.py --base https://tt.lan:8443 --device-token "$DTOK" \
  --queue ./backup/queue.jsonl --since 2026-09-01 --until 2026-10-01
```

它和客户端行为逐条对齐：

- 跳过 `kind` 控制记录（`account_session_state` 等不是用量）
- 缺 `source`/`model` 补 `codex`/`unknown`（客户端上传前就是这么补的）
- 按 `(source, model, hour_start)` 合并重复行，后者胜
- **时间戳原样保留**（不归整，避免与客户端已上传的行变成两份）
- 打印客户端 `queue.state.json` 的 `offset` 与文件大小，直接看出"还差多少没传"

参数：`--queue`、`--since`/`--until`、`--limit`（先搬 N 个桶）、`--batch`、`--dry-run`、`--jwt`/`--device-token`。

实测：374 个唯一桶 / 909,911 tokens 的仿真队列，重放后设备总量 909,911；重放第二遍仍是 909,911。

---

## 导完核对

```sh
curl -s -H "Authorization: Bearer $JWT" \
  'http://127.0.0.1:8080/functions/tokentracker-account-devices?from=2026-01-01&to=2026-12-31&tz=Asia/Shanghai'
```

看设备的 `total_tokens` 是否与工具打印的统计一致；再打开看板换到「全部」周期对一眼。

对不上时最常见的三个原因：

1. **时间戳形状不同**（`T…Z` vs `T….000Z`，或时区没转 UTC）→ 变成两行
2. `--since/--until` 把数据过滤掉了
3. 用了不同的 `--device-name`，数据落在另一台设备上（总量是对的，按设备看是分开的）
