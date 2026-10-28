# 导入历史用量

两种数据源对应两个工具，**请勿混用**。

| 数据位置 | 使用工具 | 说明 |
|---|---|---|
| CSV / JSON / JSONL 导出文件（官方 dashboard 导出、旧 SQLite 实例导出、自己的账单表） | [`scripts/import-usage.py`](#import-usagepy外部文件) | 需要将各种时间格式、列名与时区统一为服务端的键 |
| 官方客户端自己的 `~/.tokentracker/tracker/queue.jsonl` | [`scripts/replay-queue.py`](#replay-queuepy客户端本地队列) | 需要保留客户端原始时间戳，否则会与已上传的行重复 |

> **从官方云正常切换时无需任何工具**：`tracker init` 更换地址后，客户端会自动重放队列，
> 见 [`official-client.md`](official-client.md) §5。本文覆盖客户端无法处理的情况。

两个工具均支持 `--dry-run`，**建议先用其查看统计**。导入是幂等的（主键整行替换），重复运行不会重复计数。

---

## import-usage.py：外部文件

```sh
cd go-server

# 先试运行，确认解析结果
./scripts/import-usage.py --base http://192.168.1.10:8080 --jwt "$JWT" \
  --device-name old-cloud --input export.csv --dry-run

# 确认无误后正式导入
./scripts/import-usage.py --base http://192.168.1.10:8080 --jwt "$JWT" \
  --device-name old-cloud --input export.csv
```

输入格式：

- **CSV / TSV**：首行为表头，列名支持别名（`timestamp`/`time`/`hour` → `hour_start`，`provider` → `source`，
  `prompt_tokens` → `input_tokens`，`completion_tokens` → `output_tokens`，`cost`/`usd` → `total_cost_usd`…）
- **JSONL**：每行一个对象；**JSON**：一个数组
- 时间支持 `2026-10-18 09:15:00`、`2026-10-18T23:30:00+08:00`、epoch 秒/毫秒

它会做的处理：

- **时间归一化到 UTC 整点**（`2026-10-18T09:00:00Z`）。服务端按字符串比较时间，非 UTC 或带偏移的时间将无法查询到。
- 缺失字段的处理：`total_tokens` 缺失时按 `input+output+reasoning+cache_creation` 算；`billable_total_tokens` 留 0（服务端按 total 处理）。
- 按主键去重、自动分批（默认 200/批，上限 500，并按 ≤512KB 切分），对网络错误与 5xx 进行退避重试。
- `--jwt` 模式会自动签发 device token 并缓存到 `~/.cache/token-tracker/device-tokens.json`（权限 0600，按「服务地址 + 设备名」索引），
  重复运行不会因「同名设备已存在」而失败。也可通过 `--device-token` 直接指定。

常用参数：`--since` / `--until`（仅导入指定区间）、`--device-name`（同一来源固定一个名称，如 `old-cloud`、`nas`）、
`--batch`、`--no-cache`、`--format csv|jsonl|json`、`--input -`（从 stdin 读取）。

**注意：该工具会将时间归整到整点**，因此适用于导入「客户端从未上传过的历史」；请勿用它重新导入客户端已上传过的同一批桶
（`…T00:30:00.000Z` 与 `…T00:30:00Z` 在服务端是两行）。

退出码：0 全部成功；1 参数 / 输入错误；2 部分批次失败（已成功的批次不回滚，重新运行即可）。

---

## replay-queue.py：客户端本地队列

将 `~/.tokentracker/tracker/queue.jsonl` 原样重放进服务端。适用场景有三类：

1. 客户端已推进 offset，但目标后端的数据未保留（库重建、更换 schema、误删）
2. 更换机器 / 账号迁移历史（复制旧机器的 `~/.tokentracker` 备份）
3. 核对某次 sync 是否传输完整

```sh
cd go-server

# 试运行：统计信息与客户端自身的 offset 进度
./scripts/replay-queue.py --base https://tt.lan:8443 --jwt "$JWT" --dry-run

# 正式重放（默认读取 ~/.tokentracker/tracker/queue.jsonl）
./scripts/replay-queue.py --base https://tt.lan:8443 --jwt "$JWT"

# 使用备份文件，先迁移一个区间试运行
./scripts/replay-queue.py --base https://tt.lan:8443 --device-token "$DTOK" \
  --queue ./backup/queue.jsonl --since 2026-09-01 --until 2026-10-01
```

其行为逐条对齐客户端：

- 跳过 `kind` 控制记录（`account_session_state` 等不属于用量）
- 缺失 `source` / `model` 时补为 `codex` / `unknown`（与客户端上传前的处理一致）
- 按 `(source, model, hour_start)` 合并重复行，后者覆盖前者
- **时间戳原样保留**（不归整，避免与客户端已上传的行重复）
- 输出客户端 `queue.state.json` 的 `offset` 与文件大小，可直接看出剩余未传输量

参数：`--queue`、`--since`/`--until`、`--limit`（先搬 N 个桶）、`--batch`、`--dry-run`、`--jwt`/`--device-token`。

实测：对 374 个唯一桶 / 909,911 tokens 的仿真队列重放后，设备总量为 909,911；第二遍重放仍为 909,911。

---

## 导入后核对

```sh
curl -s -H "Authorization: Bearer $JWT" \
  'http://127.0.0.1:8080/functions/tokentracker-account-devices?from=2026-01-01&to=2026-12-31&tz=Asia/Shanghai'
```

检查设备的 `total_tokens` 是否与工具输出的统计一致；再打开看板并切换到「全部」周期核对。

结果不一致时，最常见的原因有三项：

1. **时间戳形式不同**（`T…Z` vs `T….000Z`，或时区未转换为 UTC）→ 被记为两行
2. `--since` / `--until` 过滤掉了目标数据
3. 使用了不同的 `--device-name`，数据落在另一台设备（总量正确，但按设备查看时分开）
