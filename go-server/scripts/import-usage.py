#!/usr/bin/env python3
"""把本地已导出的用量数据导入 TokenTracker Go 后端（局域网自用场景）。

为什么要这个脚本：Go 后端只提供一个「按小时桶」的上传接口
（/functions/tokentracker-ingest），它不做客户端适配。如果你不是在用官方客户端
自动上报，就需要把本地已有的用量（CSV / JSONL / 客户端导出）转换进去——本脚本
负责：字段归一化、时间戳转 UTC 小时桶、批量、重试、幂等重传。

设计要点（与后端契约对齐，见 go-server/internal/app/functions.go）：
  * 主键是 (user_id, device_id, hour_start, source, model)。
    同一个主键再次上传会**整行替换**（whole-row correction），所以本脚本可以安全重跑。
  * hour_start 必须是 RFC3339 UTC、且截断到整点（形如 2026-10-20T10:00:00Z），
    后端按字符串比较时间，非 UTC 或带偏移会导致汇总查询取不到数据。
  * 单次请求 ≤500 个桶、body ≤1 MiB。
  * 认证用 **device token**（不是 JWT）。给了 --jwt 时脚本会自动换一个 device token。

用法示例：
  # 1) 最简单：给 JWT，脚本自动建/用设备
  export TT_JWT_SECRET=...           # 与服务端一致
  ./import-usage.py --base http://192.168.1.10:8080 --jwt "$(./issue-token.sh --json)" \\
      --device-name my-desktop --input usage.csv --dry-run

  # 2) 已经有 device token
  ./import-usage.py --base http://192.168.1.10:8080 --device-token "$DTOK" --input usage.jsonl

  # 3) 从标准输入读，并只导入 2026 年 10 月
  cat usage.csv | ./import-usage.py --base ... --device-token ... --input - --since 2026-10-01

  注意：--jwt 模式会自动申请 device token 并缓存到
  ~/.cache/token-tracker/device-tokens.json（按 服务地址+设备名 索引），
  所以重复执行不会因为「同名设备已存在」而失败；想换设备名用 --device-name，
  想不落盘用 --no-cache。

支持的输入格式（--format auto 按扩展名/内容猜）：
  * CSV / TSV：第一行是表头，列名可用别名（见 COLUMN_ALIASES）
  * JSONL：每行一个对象，键名同 API（或别名）
  * JSON：一个数组，元素同上

退出码：0 全部成功；1 参数/输入错误；2 有批次失败（已成功的不会回滚，重跑即可）。
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

# ---------------------------------------------------------------- 字段别名
# 只要表头里出现其中之一，就映射到 API 字段。大小写/下划线/连字符/空格都会被归一化。
COLUMN_ALIASES = {
    "hour_start": ["hour_start", "hourstart", "hour", "hour_bucket", "timestamp", "time",
                   "datetime", "date", "ts", "period"],
    "source": ["source", "provider", "tool", "app", "client", "agent"],
    "model": ["model", "model_name", "modelname"],
    "input_tokens": ["input_tokens", "input", "prompt_tokens", "prompt"],
    "output_tokens": ["output_tokens", "output", "completion_tokens", "completion"],
    "cached_input_tokens": ["cached_input_tokens", "cached_tokens", "cache_read_tokens", "cached"],
    "cache_creation_input_tokens": ["cache_creation_input_tokens", "cache_write_tokens",
                                    "cache_creation_tokens"],
    "reasoning_output_tokens": ["reasoning_output_tokens", "reasoning_tokens", "reasoning"],
    "total_tokens": ["total_tokens", "total", "tokens"],
    "billable_total_tokens": ["billable_total_tokens", "billable", "billable_tokens"],
    "total_cost_usd": ["total_cost_usd", "cost_usd", "cost", "usd"],
    "conversation_count": ["conversation_count", "conversations", "conversation",
                           "session_count", "sessions", "requests", "request_count"],
}

INT_FIELDS = ["input_tokens", "output_tokens", "cached_input_tokens",
              "cache_creation_input_tokens", "reasoning_output_tokens",
              "total_tokens", "billable_total_tokens", "conversation_count"]

DEFAULT_SOURCE = "codex"
DEFAULT_MODEL = "unknown"
MAX_BUCKETS_PER_REQUEST = 500
MAX_BODY_BYTES = 1 << 20
MAX_ATTEMPTS = 4


def norm_key(k: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(k).strip().lower())


ALIAS_LOOKUP = {}
for api_field, names in COLUMN_ALIASES.items():
    for n in names:
        ALIAS_LOOKUP[norm_key(n)] = api_field


def die(msg: str, code: int = 1):
    print(f"错误: {msg}", file=sys.stderr)
    sys.exit(code)


def parse_time(value):
    """把各种时间写法转成 UTC 整点字符串；失败返回 None。"""
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)) or (isinstance(value, str) and re.fullmatch(r"\d{10,13}", value.strip())):
        n = float(value)
        if n > 1e11:  # 毫秒
            n /= 1000.0
        dt = datetime.fromtimestamp(n, tz=timezone.utc)
        return dt.strftime("%Y-%m-%dT%H:00:00Z")
    s = str(value).strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d", "%Y/%m/%d %H:%M:%S", "%Y/%m/%d"):
            try:
                dt = datetime.strptime(s, fmt)
                break
            except ValueError:
                continue
        else:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:00:00Z")


def parse_bound(value, is_end: bool):
    """--since/--until 的边界：只给日期时，since 取当天 00:00、until 取当天 23:59:59。"""
    if value is None:
        return None
    s = str(value).strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        return s + ("T23:59:59Z" if is_end else "T00:00:00Z")
    return parse_time(s)


def to_int(value) -> int:
    if value is None or value == "":
        return 0
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return int(value)
    s = str(value).strip().replace(",", "").replace("_", "")
    if not s:
        return 0
    try:
        return int(float(s))
    except ValueError:
        return 0


def to_cost(value):
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip().replace("$", "").replace(",", "")
    try:
        return float(s)
    except ValueError:
        return None


def normalize_row(raw: dict) -> dict | None:
    """把任意一行映射成 API 的 bucket 结构；无法解析返回 None。"""
    mapped = {}
    for k, v in raw.items():
        api = ALIAS_LOOKUP.get(norm_key(k))
        if api and api not in mapped:
            mapped[api] = v

    hour = parse_time(mapped.get("hour_start"))
    if not hour:
        return None

    bucket = {
        "hour_start": hour,
        "source": (str(mapped.get("source") or "").strip() or DEFAULT_SOURCE),
        "model": (str(mapped.get("model") or "").strip() or DEFAULT_MODEL),
    }
    for f in INT_FIELDS:
        bucket[f] = to_int(mapped.get(f))

    # 没给 total 时用 input+output+reasoning+cache_creation 兜底；
    # 没给 billable 时留 0，后端会按 total 处理。
    if not bucket["total_tokens"]:
        bucket["total_tokens"] = (bucket["input_tokens"] + bucket["output_tokens"]
                                  + bucket["reasoning_output_tokens"]
                                  + bucket["cache_creation_input_tokens"])

    cost = to_cost(mapped.get("total_cost_usd"))
    if cost is not None:
        bucket["total_cost_usd"] = round(cost, 6)
    return bucket


def read_rows(path: str, fmt: str):
    if path == "-":
        text = sys.stdin.read()
        name = "<stdin>"
    else:
        with open(path, "r", encoding="utf-8-sig") as fh:
            text = fh.read()
        name = path

    if fmt == "auto":
        stripped = text.lstrip()
        lowered = name.lower()
        if lowered.endswith((".jsonl", ".ndjson")):
            fmt = "jsonl"
        elif lowered.endswith(".json"):
            fmt = "json"
        elif lowered.endswith((".csv", ".tsv")):
            fmt = "csv"
        elif stripped.startswith("["):
            fmt = "json"
        elif stripped.startswith("{"):
            fmt = "jsonl"
        else:
            fmt = "csv"

    print(f"读取 {name}（格式 {fmt}）", file=sys.stderr)
    if fmt == "json":
        data = json.loads(text)
        if isinstance(data, dict):
            for key in ("buckets", "hourly", "data", "rows", "usage"):
                if isinstance(data.get(key), list):
                    data = data[key]
                    break
            else:
                data = [data]
        return data
    if fmt == "jsonl":
        out = []
        for lineno, line in enumerate(text.splitlines(), 1):
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError as exc:
                die(f"{name}:{lineno} 不是合法 JSON：{exc}")
        return out
    # CSV / TSV
    sample = text[:4096]
    delimiter = "\t" if (name.lower().endswith(".tsv") or ("," not in sample and "\t" in sample)) else ","
    return list(csv.DictReader(io.StringIO(text), delimiter=delimiter))


def http_json(method: str, url: str, token: str, payload=None, timeout=30):
    body = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header("Authorization", "Bearer " + token)
    if body is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", "replace")
            return resp.status, raw
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")
    except urllib.error.URLError as exc:
        return 0, f"network error: {exc.reason}"


def issue_device(base: str, jwt: str, name: str, platform: str, machine_id: str) -> str:
    status, raw = http_json("POST", base + "/functions/tokentracker-device-token-issue", jwt, {
        "device_name": name, "platform": platform, "machine_id": machine_id,
    })
    if status != 200:
        low = raw.lower()
        if "unique" in low or "duplicate key" in low:
            die("该设备名已存在（同名设备处于 active 状态，唯一索引冲突）。\n"
                f"  → 换个设备名：--device-name <别的名字>\n"
                f"  → 或直接复用已有 device token：--device-token <token>\n"
                f"  → 服务端原始响应：{raw[:200]}")
        die(f"申请 device token 失败（HTTP {status}）：{raw[:300]}")
    try:
        tok = json.loads(raw).get("token", "")
    except json.JSONDecodeError:
        die(f"申请 device token 返回非 JSON：{raw[:300]}")
    if not tok:
        die(f"申请 device token 响应里没有 token：{raw[:300]}")
    print(f"已申请 device token（device={name}, machine_id={machine_id}）", file=sys.stderr)
    return tok


def cache_path() -> str:
    base = os.environ.get("XDG_CACHE_HOME") or os.path.join(os.path.expanduser("~"), ".cache")
    return os.path.join(base, "token-tracker", "device-tokens.json")


def cache_load(path: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def cache_store(path: str, key: str, token: str) -> None:
    data = cache_load(path)
    data[key] = token
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=1)
    except OSError as exc:
        print(f"警告: 无法写入 token 缓存 {path}：{exc}", file=sys.stderr)


def chunk(payloads, limit, max_bytes):
    batch, size = [], 0
    for p in payloads:
        item = len(json.dumps(p).encode()) + 1
        if batch and (len(batch) >= limit or size + item > max_bytes):
            yield batch
            batch, size = [], 0
        batch.append(p)
        size += item
    if batch:
        yield batch


def post_batch(base, token, batch):
    url = base + "/functions/tokentracker-ingest"
    payload = {"buckets": batch}
    for attempt in range(1, MAX_ATTEMPTS + 1):
        status, raw = http_json("POST", url, token, payload)
        if status == 200:
            try:
                obj = json.loads(raw)
            except json.JSONDecodeError:
                obj = {}
            return True, obj, raw
        # 401/400/413 是确定性问题，重试无意义
        if status in (400, 401, 403, 413, 404):
            return False, None, f"HTTP {status}: {raw[:300]}"
        wait = min(2 ** attempt, 15) + random.random()
        print(f"  第 {attempt} 次失败（HTTP {status}），{wait:.1f}s 后重试…", file=sys.stderr)
        time.sleep(wait)
    return False, None, f"重试 {MAX_ATTEMPTS} 次仍失败：{raw[:300]}"


def main() -> int:
    ap = argparse.ArgumentParser(description="把本地用量导入 TokenTracker Go 后端",
                                 formatter_class=argparse.RawDescriptionHelpFormatter,
                                 epilog=__doc__)
    ap.add_argument("--base", required=True, help="服务地址，如 http://192.168.1.10:8080")
    auth = ap.add_mutually_exclusive_group(required=True)
    auth.add_argument("--device-token", help="已签发的 device token（上传用量用它）")
    auth.add_argument("--jwt", help="账户 JWT；脚本会自动换一个 device token")
    ap.add_argument("--device-name", default="import-script",
                    help="配合 --jwt 使用，设备名（建议用这台机器的名字，如 nas/desktop）")
    ap.add_argument("--platform", default="linux", help="配合 --jwt 使用")
    ap.add_argument("--machine-id", default=None,
                    help="配合 --jwt 使用；默认 import-<设备名>，同一设备重复执行会复用同一行")
    ap.add_argument("--input", required=True, help="CSV / JSONL / JSON 文件，- 表示 stdin")
    ap.add_argument("--format", default="auto", choices=["auto", "csv", "jsonl", "json"])
    ap.add_argument("--batch", type=int, default=200, help=f"每批桶数，上限 {MAX_BUCKETS_PER_REQUEST}")
    ap.add_argument("--since", help="只导入该时间之后的记录（YYYY-MM-DD 或完整时间）")
    ap.add_argument("--until", help="只导入该时间之前的记录（只给日期时含当天）")
    ap.add_argument("--token-cache", default=cache_path(),
                    help="--jwt 模式下 device token 的缓存位置（默认 ~/.cache/token-tracker/device-tokens.json）")
    ap.add_argument("--no-cache", action="store_true", help="不读写 device token 缓存")
    ap.add_argument("--dry-run", action="store_true", help="只解析并打印统计，不发请求")
    args = ap.parse_args()

    base = args.base.rstrip("/")
    limit = max(1, min(args.batch, MAX_BUCKETS_PER_REQUEST))
    if not args.machine_id:
        args.machine_id = "import-" + args.device_name

    raw_rows = read_rows(args.input, args.format)
    since = parse_bound(args.since, is_end=False) if args.since else None
    until = parse_bound(args.until, is_end=True) if args.until else None

    buckets, bad, filtered = [], 0, 0
    for raw in raw_rows:
        if not isinstance(raw, dict):
            bad += 1
            continue
        b = normalize_row(raw)
        if b is None:
            bad += 1
            continue
        if since and b["hour_start"] < since:
            filtered += 1
            continue
        if until and b["hour_start"] > until:
            filtered += 1
            continue
        buckets.append(b)

    print(f"解析完成：{len(raw_rows)} 行 → 有效 {len(buckets)} 条，"
          f"无法解析 {bad} 条，时间过滤 {filtered} 条", file=sys.stderr)
    if not buckets:
        die("没有可导入的数据：请检查时间列（需要能被解析成时间）与表头列名")

    # 同一批内去重：主键完全相同的行，后者覆盖前者（与后端语义一致）
    dedup = {}
    for b in buckets:
        dedup[(b["hour_start"], b["source"], b["model"])] = b
    if len(dedup) != len(buckets):
        print(f"批内去重：{len(buckets)} → {len(dedup)} 条（主键重复，后者覆盖前者）", file=sys.stderr)
    payloads = sorted(dedup.values(), key=lambda x: (x["hour_start"], x["source"], x["model"]))

    total_tokens = sum(p["total_tokens"] for p in payloads)
    hours = sorted({p["hour_start"] for p in payloads})
    models = sorted({p["model"] for p in payloads})
    sources = sorted({p["source"] for p in payloads})
    print(f"时间范围：{hours[0]} → {hours[-1]}（{len(hours)} 个小时桶）", file=sys.stderr)
    print(f"来源：{', '.join(sources)}    模型 {len(models)} 个：{', '.join(models[:8])}"
          f"{' …' if len(models) > 8 else ''}", file=sys.stderr)
    print(f"合计 total_tokens：{total_tokens:,}", file=sys.stderr)
    batches = list(chunk(payloads, limit, MAX_BODY_BYTES // 2))
    print(f"将分 {len(batches)} 批上传（每批 ≤{limit} 条）", file=sys.stderr)

    if args.dry_run:
        print("\n--- dry-run：前 2 条将要上传的记录 ---", file=sys.stderr)
        for p in payloads[:2]:
            print(json.dumps(p, ensure_ascii=False), file=sys.stderr)
        print("dry-run 结束，未发送任何请求。去掉 --dry-run 即可真正导入。", file=sys.stderr)
        return 0

    cache_key = f"{base}|{args.device_name}|{args.machine_id}"
    token = args.device_token
    if not token and not args.no_cache:
        cached = cache_load(args.token_cache).get(cache_key)
        if cached:
            token = cached
            print(f"复用缓存的 device token（{args.token_cache}）", file=sys.stderr)
    if not token:
        token = issue_device(base, args.jwt, args.device_name, args.platform, args.machine_id)
        if not args.no_cache:
            cache_store(args.token_cache, cache_key, token)
    ok_inserted = ok_skipped = 0
    failures = 0
    reissued = False
    for idx, batch in enumerate(batches, 1):
        success, obj, raw = post_batch(base, token, batch)
        if not success and not reissued and "HTTP 401" in str(raw) and args.jwt:
            # 缓存里的 token 可能已被撤销/设备被删除：重新签发一次
            print("device token 无效（401），重新申请…", file=sys.stderr)
            token = issue_device(base, args.jwt, args.device_name, args.platform, args.machine_id)
            if not args.no_cache:
                cache_store(args.token_cache, cache_key, token)
            reissued = True
            success, obj, raw = post_batch(base, token, batch)
        if not success:
            failures += 1
            print(f"[{idx}/{len(batches)}] 失败：{raw}", file=sys.stderr)
            continue
        ins = int(obj.get("inserted", 0) or 0)
        skp = int(obj.get("skipped", 0) or 0)
        ok_inserted += ins
        ok_skipped += skp
        print(f"[{idx}/{len(batches)}] 成功：inserted={ins} skipped={skp}", file=sys.stderr)

    print(f"\n完成：批次成功 {len(batches) - failures}/{len(batches)}，"
          f"inserted={ok_inserted}，skipped={ok_skipped}", file=sys.stderr)
    if failures:
        print("有批次失败。已成功的部分不会回滚；修好网络/参数后直接重跑本脚本即可"
              "（同主键整行替换，不会重复计数）。", file=sys.stderr)
        return 2
    print("提示：可以这样核对结果：", file=sys.stderr)
    print(f"  curl -s -H 'Authorization: Bearer <JWT>' "
          f"'{base}/functions/tokentracker-account-summary?from={hours[0][:10]}&to={hours[-1][:10]}'",
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
