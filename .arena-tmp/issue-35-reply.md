确认是 bug，已修并合并（#34 `809bb22`、#36 `3b3d775`）。

修复后的镜像：

```
ghcr.io/quietsugar/token-tracker-self-hosting-go:experimental            # 指向最新 main
ghcr.io/quietsugar/token-tracker-self-hosting-go:experimental-3b3d775
ghcr.io/quietsugar/token-tracker-self-hosting-go:sha-3b3d775
```

（amd64 + arm64，构建流程已在真实 PostgreSQL 上跑过冒烟）

## 根因

两处叠加，缺一不可：

1. `approveDeviceCode` 写死 `deviceFor(sub, "Device Flow", "cli", mid, …)` —— `device_codes.client_info` 里明明有 `win32-x64 hp`，服务端**没看它**；
2. `deviceFor` 的复用条件是 `machine_id = ? OR (platform = ? AND device_name = ?)`。

所有 device flow 设备行都叫 `Device Flow` / `cli`，于是 hp 命中 `OR` 的后半段，借走了 vm128 的行。

## 修复后的行为

- 判重**只看 `machine_id`**；没有 `machine_id`（老脚本）才退回 `(platform, device_name)`。
- 设备名取自 `client_info` 的 hostname、`platform` 用官方的 `cli-device-flow`：设备列表里直接看到 `hp`、`vm128`。
- 两台机器 hostname 撞名时，后接入的那台自动改名（`hp #1a2b3c4d`）并**照常接入** —— 不顶替别人的行，也不会因为重名登录不上。
- 老库兼容：`machine_id` 为空的历史行会被同名机器认领并回填，不会为同一台机器多建一行。

## 你实例的存量数据怎么处理（hp 的用量挂在 19467088 上）

关键点：`hourly` 只有 `device_id`，**没有** `machine_id`。所以两台机器的量一旦混在同一行，单看库分不开 —— 按时间窗搬只是近似。但**每台机器自己的 `~/.tokentracker/tracker/queue.jsonl` 是 append-only 的全量小时桶**：把这一行的量删掉、让两台机器各自重放自己的队列，就等于原样重建，精确且不用猜。

### 1) 升级 + 两台机器各自重新登录

```sh
docker compose pull && docker compose up -d     # 你跑的是 experimental-dfa0c76，需要升

# vm128 与 hp 各跑一次
tracker device-login --base-url https://<你的地址> --anon-key "$ANON"
```

- vm128：原行的 `machine_id` 就是它，**继续复用 19467088**，只是名字还叫 `Device Flow`（最后改名即可）；
- hp：拿到一个**全新设备行**，名字就是 `hp`。注意 hp 的 `config.json` 里 `deviceToken` 已经换成新行那个，旧 token 还留在旧行上但客户端不再使用 —— **后面重放务必用新 token**。

### 2) 删掉被污染那行的用量（先预览、带备份）

```sh
# 只看不写：多少桶、多少量、删完全库应剩多少
./go-server/scripts/device-purge-usage.sh --dsn "$TT_DATABASE_URL" --device 19467088

# 备份 + 删除（备份表 hourly_backup_<时间戳>）
./go-server/scripts/device-purge-usage.sh --dsn "$TT_DATABASE_URL" --device 19467088 --apply
```

删的是**整行设备**的量，不是某段时间 —— 因为两台机器都会重放自己的队列，等于原样重建。脚本同时清 `usage_cache`（聚合缓存按 user 缓存，60 秒内自动重建）。

> 没升级也能做，等价 SQL：
> ```sql
> BEGIN;
> CREATE TABLE hourly_backup_20261028 AS SELECT * FROM hourly WHERE device_id = '19467088-…';
> DELETE FROM hourly WHERE device_id = '19467088-…';
> DELETE FROM usage_cache;
> COMMIT;
> ```

### 3) 两台机器各自重放本地队列

```sh
# 客户端原生：重新 init 会检测到实例变化、把 queue.state.json 的 offset 归零，下次 sync 从文件头重传
tracker init --base-url https://<你的地址> --anon-key "$ANON"
tracker sync
```

不想重跑 `init` 就把 `~/.tokentracker/tracker/queue.state.json` 移走再 `sync`，效果一样。
客户端已卸载 / 队列不在原位时用仓库脚本（可指定队列文件与新签的 device token）：

```sh
./scripts/replay-queue.py --base https://<你的地址> --device-token "$DTOK" --dry-run
./scripts/replay-queue.py --base https://<你的地址> --device-token "$DTOK"
```

重放是幂等的（同键整行替换），多跑一次不会翻倍。

### 4) 核对

```sh
psql "$TT_DATABASE_URL" -f go-server/scripts/device-report.sql
```

- 每台设备的桶数 / 总量应等于那台机器的真实用量，**全库总计与修复前完全一致**（你的实例 1495 行 / ≈116.7 亿 tokens）；
- 第 2 段「可疑登录」里 `DLDE-LNZ6` 那条历史记录还会列出来（那是发生过的事实，不用删），但不应再出现新记录；
- 最后在看板把老行 `Device Flow` 改名成 `vm128`。

### 队列已经丢了怎么办

只能近似：`./go-server/scripts/device-move-usage.sh --dsn "$TT_DATABASE_URL" --from vm128 --to hp --since … --until …`
（默认试运行、冲突自动中止、`--merge=sum` 合并、搬完打印全库总计）。挑「只有 hp 在跑」的时间窗，否则会把 vm128 的量一起搬走。

## 补充

- 旧 token 仍可用是既有语义（device token 无 TTL，只有撤销能失效），这次没改；只是新接入的机器不会再落到别人的行上。
- 完整文档：[`docs/users/devices.md` §6](https://github.com/QuietSugar/token-tracker-self-hosting/blob/main/docs/users/devices.md#6-用量记错了设备怎么办老数据修复)。
