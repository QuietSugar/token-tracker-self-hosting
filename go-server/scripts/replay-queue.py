#!/usr/bin/env python3
"""把官方客户端的本地队列（`~/.tokentracker/tracker/queue.jsonl`）重放进自托管后端。

## 什么时候需要它

官方客户端自己就有回放能力：`tracker init --base-url <新地址>` 检测到"实例变了"会把
`queue.state.json` 的 `offset` 归零（源码：`src/commands/init.js` → `resetInstanceState`），
下一次 `tracker sync` 就从文件头重新上传。**正常切换不需要本脚本**。

它解决的是另外三种情况：

1. **客户端已经把 offset 推过去了，但那个后端的数据没留住**（库重建、schema 换名、
   误删），而本地 `queue.jsonl` 还在 —— 客户端不会再传第二遍，只能外部重放。
2. **换机 / 换用户**：把旧机器的 `~/.tokentracker` 备份拷过来，用新签的 device token
   把历史灌进服务端（第三方设备，与客户端之后的增量上传互不干扰）。
3. **核对**："我那次 sync 到底传全了吗？"用 `--dry-run` 算一遍，和服务端 summary 对。

## 和客户端行为对齐的三件事（很重要）

* **时间戳原样保留**。服务端主键是 `(user_id, device_id, hour_start, source, model)` 的
  字符串形式：`2026-10-20T00:30:00.000Z` 和 `2026-10-20T00:30:00Z` 是**两行**。
  客户端发的带毫秒，所以本脚本也带毫秒——否则同一批数据会被算两遍。
  （`import-usage.py` 会规整到整点，两者别对同一时间段混用，见 README §3.5.4。）
* **缺省值**：客户端在上传前会把缺失的 `source` 填成 `codex`、`model` 填成 `unknown`。
  本脚本做同样的事，避免这些行被服务端当无效行丢掉。
* **控制记录跳过**：`kind: "account_session_state"` 是 TRAE / cursor 的会话去重记录，
  不是用量。服务端会忽略它们（回 200、不写入），本脚本干脆不发。

## 用法

    # 先干跑：只看统计，不发请求
    ./replay-queue.py --base http://192.168.1.10:8080 --device-token "$DTOK" --dry-run

    # 真重放（默认就是 ~/.tokentracker/tracker/queue.jsonl）
    ./replay-queue.py --base http://192.168.1.10:8080 --device-token "$DTOK"

    # 用 JWT 自动签一个 device token（设备名 queue-replay）
    ./replay-queue.py --base http://192.168.1.10:8080 --jwt "$JWT"

    # 只重放某个时间段，或从备份文件读
    ./replay-queue.py --base ... --device-token ... --queue ./backup/queue.jsonl \
        --since 2026-09-01 --until 2026-10-01

退出码：0 成功；1 参数/输入错误；2 有批次失败（已成功的不回滚，重跑即可——重放是幂等的）。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

MAX_BUCKETS_PER_REQUEST = 500  # 服务端硬上限
MAX_BODY_BYTES = 1 << 20  # 服务端 body 上限 1 MiB
DEFAULT_QUEUE = "~/.tokentracker/tracker/queue.jsonl"
INGEST = "/functions/tokentracker-ingest"
ISSUE = "/functions/tokentracker-device-token-issue"


# ------------------------------------------------------------------ 解析
def parse_ts(value: str) -> datetime | None:
    """解析客户端写进队列的时间戳。

    形如 `2026-10-20T00:30:00.000Z`（新版）或 `2026-10-20T00:30:00Z`（旧版）。
    只用于筛选/统计，**写回服务端时一律用原始字符串**。
    """
    if not isinstance(value, str) or not value:
        return None
    try:
        text = value[:-1] + "+00:00" if value.endswith("Z") else value
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    return dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def boundary(text: str | None, *, end: bool) -> datetime | None:
    """--since/--until：只给日期时，--until 含当天。"""
    if not text:
        return None
    dt = parse_ts(text if "T" in text else f"{text}T00:00:00Z")
    if dt is None:
        raise SystemExit(f"无法解析时间：{text}")
    if end and "T" not in text:
        dt = dt.replace(hour=23, minute=59, second=59, microsecond=999999)
    return dt


# ------------------------------------------------------------------ 读队列
def read_queue(path: str, since, until):
    """返回 (buckets, stats)。去重规则与客户端 readQueueBatch 一致：同键后者胜。"""
    stats = {
        "lines": 0, "bad_json": 0, "control_records": 0, "no_hour_start": 0,
        "out_of_range": 0, "duplicates": 0, "defaults_applied": 0,
    }
    buckets: dict[tuple[str, str, str], dict] = {}
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        for raw in fh:
            if not raw.strip():
                continue
            stats["lines"] += 1
            try:
                row = json.loads(raw)
            except json.JSONDecodeError:
                stats["bad_json"] += 1
                continue
            if not isinstance(row, dict) or isinstance(row, list):
                stats["bad_json"] += 1
                continue
            # 控制记录（account_session_state / account_sync_watermark …）不是用量。
            if "kind" in row:
                stats["control_records"] += 1
                continue
            hour_start = row.get("hour_start")
            dt = parse_ts(hour_start)
            if dt is None:
                stats["no_hour_start"] += 1
                continue
            if since and dt < since:
                stats["out_of_range"] += 1
                continue
            if until and dt > until:
                stats["out_of_range"] += 1
                continue
            source = str(row.get("source") or "").strip().lower()
            model = str(row.get("model") or "").strip()
            if not source or not model:
                stats["defaults_applied"] += 1
            source = source or "codex"
            model = model or "unknown"
            out = {"hour_start": hour_start, "source": source, "model": model}
            for key in (
                "input_tokens", "output_tokens", "cached_input_tokens",
                "cache_creation_input_tokens", "reasoning_output_tokens",
                "total_tokens", "billable_total_tokens", "conversation_count",
            ):
                out[key] = int(row.get(key) or 0)
            if out["billable_total_tokens"] == 0:
                out["billable_total_tokens"] = out["total_tokens"]
            if row.get("total_cost_usd") not in (None, ""):
                out["total_cost_usd"] = row["total_cost_usd"]
            key = (source, model, hour_start)
            if key in buckets:
                stats["duplicates"] += 1
            buckets[key] = out
    return list(buckets.values()), stats


def client_progress(queue_path: str) -> dict | None:
    """读客户端的 queue.state.json：offset 是"已上传到文件第几个字节"。"""
    state_path = os.path.join(os.path.dirname(os.path.abspath(queue_path)), "queue.state.json")
    try:
        with open(state_path, "r", encoding="utf-8") as fh:
            state = json.load(fh)
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(state, dict):
        return None
    try:
        size = os.path.getsize(queue_path)
    except OSError:
        size = None
    return {"path": state_path, "state": state, "size": size}


# ------------------------------------------------------------------ HTTP
def http_json(url: str, token: str, body: dict | None = None, timeout: float = 60.0) -> dict:
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method="POST" if body is not None else "GET")
    req.add_header("Authorization", f"Bearer {token}")
    # 与内建看板一致：有的反代会把 Authorization 当自己的凭据吃掉。
    req.add_header("X-TokenTracker-Token", f"Bearer {token}")
    if body is not None:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read() or b"{}")


def mint_device_token(base: str, jwt: str, name: str, platform: str) -> str:
    payload = {"device_name": name, "platform": platform, "machine_id": f"replay-{platform}-{name}"}
    try:
        body = http_json(base + ISSUE, jwt, payload)
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"签发 device token 失败：HTTP {exc.code} {exc.read()[:200]!r}") from exc
    token = body.get("token")
    if not token:
        raise SystemExit(f"签发 device token 没有返回 token：{body}")
    return token


# ------------------------------------------------------------------ 主流程
def main() -> int:
    ap = argparse.ArgumentParser(
        description="把官方客户端的 queue.jsonl 重放进自托管后端",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--base", required=True, help="服务地址，如 http://192.168.1.10:8080")
    auth = ap.add_mutually_exclusive_group(required=True)
    auth.add_argument("--device-token", help="已签发的 device token（上传用量用它）")
    auth.add_argument("--jwt", help="账户 JWT；脚本会先签一个 device token")
    ap.add_argument("--device-name", default="queue-replay", help="配合 --jwt：新设备的显示名")
    ap.add_argument("--platform", default="linux", help="配合 --jwt")
    ap.add_argument("--queue", default=DEFAULT_QUEUE, help=f"队列文件，默认 {DEFAULT_QUEUE}")
    ap.add_argument("--since", help="只重放该时间之后的桶（YYYY-MM-DD 或完整时间）")
    ap.add_argument("--until", help="只重放该时间之前的桶（只给日期时含当天）")
    ap.add_argument("--batch", type=int, default=200, help="每批桶数（服务端上限 500）")
    ap.add_argument("--limit", type=int, default=0, help="最多重放多少个桶（0 = 全部，便于分批试验）")
    ap.add_argument("--dry-run", action="store_true", help="只解析并打印统计，不发请求")
    args = ap.parse_args()

    base = args.base.rstrip("/")
    queue_path = os.path.expanduser(args.queue)
    if not os.path.isfile(queue_path):
        raise SystemExit(f"找不到队列文件：{queue_path}\n（客户端从没 sync 过？或用 --queue 指定备份路径）")

    progress = client_progress(queue_path)
    if progress:
        offset = int(progress["state"].get("offset") or 0)
        size = progress["size"]
        note = progress["state"].get("note")
        tail = f"，文件 {size} 字节" if size is not None else ""
        pending = f"，客户端还有 {size - offset} 字节没传" if size is not None and size > offset else ""
        print(f"客户端进度：offset={offset}{tail}{pending}")
        if note:
            print(f"  客户端备注：{note}")

    since, until = boundary(args.since, end=False), boundary(args.until, end=True)
    buckets, stats = read_queue(queue_path, since, until)
    if args.limit:
        buckets = buckets[: args.limit]

    print(
        f"队列：{stats['lines']} 行 → {len(buckets)} 个唯一桶"
        f"（控制记录 {stats['control_records']}，重复合并 {stats['duplicates']}，"
        f"无效 {stats['bad_json'] + stats['no_hour_start']}，区间外 {stats['out_of_range']}，"
        f"补默认值 {stats['defaults_applied']}）"
    )
    if not buckets:
        print("没有可重放的桶。")
        return 0

    sources: dict[str, int] = {}
    total_tokens = 0
    days: set[str] = set()
    for b in buckets:
        sources[b["source"]] = sources.get(b["source"], 0) + 1
        total_tokens += b["total_tokens"]
        days.add(b["hour_start"][:10])
    print(
        f"覆盖 {min(days)} … {max(days)} 共 {len(days)} 天，"
        f"合计 {total_tokens} tokens；来源：" +
        ", ".join(f"{k}×{v}" for k, v in sorted(sources.items(), key=lambda kv: -kv[1]))
    )

    if args.dry_run:
        print("dry-run：没有发送任何请求。")
        return 0

    token = args.device_token or mint_device_token(base, args.jwt, args.device_name, args.platform)
    batch_size = max(1, min(args.batch, MAX_BUCKETS_PER_REQUEST))

    sent = inserted = skipped = 0
    started = time.time()
    for start in range(0, len(buckets), batch_size):
        chunk = buckets[start: start + batch_size]
        # body 上限 1 MiB：桶特别宽（很多字段）时按体积再切一次。
        while chunk:
            body = {"hourly": chunk, "upload_id": f"replay-{int(started)}-{start}"}
            encoded = len(json.dumps(body).encode())
            if encoded <= MAX_BODY_BYTES or len(chunk) == 1:
                break
            chunk = chunk[: max(1, len(chunk) // 2)]
        try:
            result = http_json(base + INGEST, token, body)
        except urllib.error.HTTPError as exc:
            detail = exc.read()[:300]
            print(f"\n第 {start // batch_size + 1} 批失败：HTTP {exc.code} {detail!r}", file=sys.stderr)
            print("已成功的批次不会回滚；修好原因后原样重跑即可（重放是幂等的）。", file=sys.stderr)
            return 2
        except urllib.error.URLError as exc:
            print(f"\n连不上 {base}：{exc.reason}", file=sys.stderr)
            return 2
        sent += len(chunk)
        inserted += int(result.get("inserted") or 0)
        skipped += int(result.get("skipped") or 0)
        done = min(start + len(chunk), len(buckets))
        pct = done * 100 // len(buckets)
        print(f"\r已发送 {done}/{len(buckets)} 桶（{pct}%）", end="", flush=True)
    print()
    print(f"完成：服务端 inserted={inserted}，skipped={skipped}，用时 {time.time() - started:.1f}s")
    if skipped:
        print(
            "skipped 不为 0 通常是同键多行（服务端按整行替换，不影响合计）"
            "或缺 hour_start/source/model 的行。"
        )
    print(
        "核对：打开看板（`GET /`）或请求 "
        f"{base}/functions/tokentracker-account-summary，看总量是否与上面统计一致。"
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\n中断。已上传的批次保留，重跑会从同一起点重新覆盖（幂等）。", file=sys.stderr)
        sys.exit(130)
