# 契约测试

标准在 `contract/`，实现照着它写。这份文件说明**怎么跑、怎么判、什么时候能改 golden**。
设计意图（为什么用契约而不是抄代码）见 [`../design/parity.md`](../design/parity.md)。

## 1. 一次跑通

```sh
# 先编出 adapter 要用的二进制（它按 go-server/bin/tokentracker-server 找）
cd go-server && go build -o bin/tokentracker-server ./cmd/server && cd ..

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

## 2. 实现者要满足什么

任何想替代后端的实现，都要提供这两层：

**Adapter（`contract/adapters/<name>.cjs`，CommonJS）**

```js
module.exports = {
  name: "go-postgres",
  async start(config) -> Adapter,
  // Adapter:
  //   .request(slug, {method, query, headers, body, token}) -> {status, headers, body}
  //   .query(sql, params) -> rows      // 仅调试用；Go 实现返回 null
  //   .close()
  //   .info() -> {version, engine, ...}
  //   .skip[] -> 有意跳过的 case 列表（必须带理由）
};
```

`start()` 每次返回**全新的空实例**（用例之间不共享状态）。

**HTTP 面**

| 路径 | 方法 | 认证 | 我们的实现 |
|---|---|---|---|
| `/functions/<slug>` | GET/POST | JWT / device token / 无（仅 `device-flow-authorize`、`device-flow-poll` 公开） | ✅ |
| `/api/database/rpc/<fn>` | POST | `project_admin` | ✅ |
| `/rest/v1/<table>` | GET/POST/PATCH | `project_admin` | ❌ 不实现（参考实现有，用例不依赖） |

请求 `Content-Type: application/json`，POST body 为 JSON；响应 body 为 JSON 对象或数组。
认证模型：HS256 JWT（`{sub, role, exp}`，role ∈ `anon`/`authenticated`/`project_admin`）；
device token 为不透明串、服务端只存 SHA-256；伪造签名 / 过期 / 未知 token → 401。

**归一化**（`lib/normalize.cjs`，规则改了就是改基准，必须评审）：UUID → 占位、
时间 → 固定形状、随机 token / 哈希 → 占位、浮点按固定精度、对象键排序。
归一化覆盖不到的真实差异必须登记到 `waivers.json`。

## 3. 目录里各是什么

```
contract/
├── scenarios/         语言无关的用例（index.json 定顺序，8 组 35 个用例 82 步）
├── golden/<ver>/      录制的参考快照：_meta.json、static.json、*.case.json、SHA256SUMS
├── adapters/          go-postgres.cjs（我们的实现）、reference.cjs（上游黑盒）
├── lib/               normalize / runner / compare / static / verify / recorder / harness
├── waivers.json       已登记的有意偏差（当前为空）
└── L3-RESULTS.md      真实 PG 上的并发测试**生成结果**（不是文档，勿手改）
```

`contract/` 里只有机器资产与生成结果；说明在本文，不要在目录里另写一份 README。

`golden/<ver>` 的 SHA256SUMS 是**防篡改**的：CI 会 `sha256sum -c`，
所以改 golden 必须是有意识的评审动作，不能顺手 `--update`。

## 4. 判定规则

- 归一化后才比对：UUID、时间、随机 token、浮点。规则见 §2，实现是 `lib/normalize.cjs`。
- 归一化覆盖不到的真实差异 → **FAIL**，除非在 `waivers.json` 里逐项登记
  `case` / `path` / `reason` / `approvedBy` / `date`。当前 `waivers` 为空数组。
- 状态码、body 的字段与值都比；关键响应头（`Access-Control-Allow-Origin`、`Content-Type`）也比。

## 5. 加用例 / 改 golden

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

## 6. CI 里怎么跑

| workflow | 内容 |
|---|---|
| `verify.yml` | 密钥扫描、编码校验、`releases/*/SHA256SUMS`、脚本语法、**静态契约 + golden checksums** |
| `contract.yml` | L1 静态契约 + golden checksums + 参考实现自测（PGlite，无需真 PG）+ 每周一完整回归 |
| `go-server.yml` | 真实 PG **15 / 16 矩阵**（`postgres:<ver>-alpine`）上的 `go vet` + `go test -race` + 契约对拍 |

CI 里 `CONTRACT_CONCURRENCY=3`（GH runner 内存够）；脚本默认值是 1，本地沙箱请保持 1。

## 7. 本地起 PG（沙箱/无 docker 时）

```sh
pip install --target /tmp/tools pgserver
python3 -c "import pgserver,os;print(pgserver.get_server('/tmp/pgdata', cleanup_mode=None).get_uri())"
# 得到 postgresql://postgres:@/postgres?host=/tmp/pgdata
```

`go-server/scripts/test-with-pg.sh` 是更省事的一键版（有 docker 时用 docker）。
