# 维护者文档

给**改这个仓库的人**：跟上游、跑契约、发镜像、守约定。使用者从 [`../README.md`](../README.md) 进。

| 文件 | 什么时候读 |
|---|---|
| [`upstream.md`](upstream.md) | 上游发了新版本，要判断"我们的后端要不要动" |
| [`contract.md`](contract.md) | 要跑契约、加用例、改 golden、看 33 PASS 是怎么来的 |
| [`release.md`](release.md) | 要发镜像（工件镜像 / Go 后端镜像） |
| [`conventions.md`](conventions.md) | 第一次提交代码前；编码、密钥、提交、文档的规矩 |

给 AI 的开发剧本在 [`../agents/develop.md`](../agents/develop.md)。

## 这个仓库里有什么

```
tracking/REF       锁定点（VERSION + COMMIT），构建的唯一来源
contract/          标准：用例、golden 快照、归一化、对比、adapter
releases/<ver>/    从锁定点生成的产物：安装 SQL、14 个函数、SHA256SUMS
scripts/           工件线工具：upstream.sh / build.sh / verify.sh / check-*.sh
go-server/         运行时：Go 后端 + PG + 内建看板
docker/            工件镜像的 CLI 与构建期校验
.github/workflows/ CI：verify / build-image / contract / go-server / build-go-image
```

两条线的关系：**`contract/` 是标准**（官方行为长什么样），**`go-server/` 是照着标准写的实现**。
上游变了 → 重新生成产物 → 看 diff → 同步实现 → 跑契约 → 发镜像。

`contract/`、`releases/`、`tracking/REF` 是**机器资产**：CI 和测试直接读它们，删改会立刻炸。
