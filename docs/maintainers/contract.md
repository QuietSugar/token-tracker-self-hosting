# 契约测试

标准在 `contract/`，实现照着它写。这份文件说明**怎么跑、怎么判、什么时候能改 golden**。
设计意图（为什么用契约而不是抄代码）见 [`../design/parity.md`](../design/parity.md)。

## 1. 一次跑通

```sh
# 行为契约（需要一个真实 PG；Go adapter 自己起实例）
CONTRACT_ADAPTER=./contract/adapters/go-postgres.cjs \
GO_POSTGRES_URL='postgres://postgres:@/postgres?host=/tmp/pgdata' \
./contract/scripts/verify.sh

# 只跑静态契约（无需运行时，CI 每个 PR 都跑）
node contract/lib/verify.cjs --static-only
```

**门槛：33 PASS / 0 FAIL / 2 SKIP。** 少一个 PASS、多一个 FAIL 都不算通过。

两个 SKIP 登记在 `contract/adapters/go-postgres.cjs` 的 `skip` 里：
`install/ledger-15-steps`、`install/checksum-drift-refused`。它们是**上游 PG 的安装账本**用例 ——
我们不伪造那个账本，用 `schema_migrations(version=1, checksum)` 做自己的 drift gate。
SKIP 必须带理由出现在这份代码里，不是"跑不过就跳过"。

`verify.sh` 的环境：`CONTRACT_CONCURRENCY=1`、`CONTRACT_NOW=2026-10-26T00:00:00Z`（冻结时钟，复现用）。

## 2. 目录里各是什么

```
contract/
├── SPEC.md            实现者契约：接口、归一化、对比规则
├── scenarios/         语言无关的用例（index.json 定顺序，8 组 35 个用例 82 步）
├── golden/<ver>/      录制的参考快照：_meta.json、static.json、*.case.json、SHA256SUMS
├── adapters/          go-postgres.cjs（我们的实现）、reference.cjs（上游黑盒）
├── lib/               normalize / runner / compare / static / verify / recorder / harness
└── waivers.json       已登记的有意偏差（当前为空）
```

`golden/<ver>` 的 SHA256SUMS 是**防篡改**的：CI 会 `sha256sum -c`，
所以改 golden 必须是有意识的评审动作，不能顺手 `--update`。

## 3. 判定规则

- 归一化后才比对：UUID、时间、随机 token、浮点。规则在 `SPEC.md`，实现是 `lib/normalize.cjs`。
- 归一化覆盖不到的真实差异 → **FAIL**，除非在 `waivers.json` 里逐项登记
  `case` / `path` / `reason` / `approvedBy` / `date`。当前 `waivers` 为空数组。
- 状态码、body 的字段与值都比；关键响应头（`Access-Control-Allow-Origin`、`Content-Type`）也比。

## 4. 加用例 / 改 golden

**加用例**（我们的实现要做新行为）：

1. 在 `scenarios/NN-*.json` 里加 case（注意文件里的键是 `cases`，不是 `scenarios`），并更新 `index.json`；
2. 用参考实现录 golden：`./contract/scripts/setup-upstream.sh` 后跑 `reference.cjs` adapter；
3. 实现 Go 侧，跑到 PASS；
4. 提交时一起带上 scenario + golden 新文件 + `SHA256SUMS`。

**重录 golden**（上游契约变了才允许）：

1. 先按 [`upstream.md`](upstream.md) 确认是真的上游变化，不是我们想改；
2. `setup-upstream.sh` 把上游 checkout 到新锁定 commit；
3. 重录整份 `golden/<ver>/`，`_meta.json` 记版本、commit、种子、冻结时钟；
4. 用 diff 逐个解释**每个变化的字段**，写进 PR 说明。

**为了让测试变绿而重录 golden = 把 bug 写进基准。** 这一条没有例外。

## 5. CI 里怎么跑

| workflow | 内容 |
|---|---|
| `verify.yml` | 密钥扫描、编码校验、`releases/*/SHA256SUMS`、脚本语法、**静态契约 + golden checksums** |
| `contract.yml` | 真实 PG（digest 固定）上的行为契约 |
| `go-server.yml` | PG 15 与 16 矩阵上的 `go vet` + `go test -race` + 契约 |

## 6. 本地起 PG（沙箱/无 docker 时）

```sh
pip install --target /tmp/tools pgserver
python3 -c "import pgserver,os;print(pgserver.get_server('/tmp/pgdata', cleanup_mode=None).get_uri())"
# 得到 postgresql://postgres:@/postgres?host=/tmp/pgdata
```

`go-server/scripts/test-with-pg.sh` 是更省事的一键版（有 docker 时用 docker）。
