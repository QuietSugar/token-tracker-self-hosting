# releases/ 目录约定

每个上游版本一个目录，目录名 = 版本号（如 `1.4.12`）。目录内容全部入库，便于审计与回滚。

```
releases/<version>/
├── tokentracker-install.sql       # 独立事务 + 安装锁；首次安装 / 常规升级
├── tokentracker-migration.sql     # 无事务包装；平台迁移通道
├── functions/                     # 14 个 async CommonJS 函数 + functions.json
├── manifest-report.md             # 步骤 id + sha256(step.sql) + 函数清单 + functions.json
├── SHA256SUMS                     # 所有产物校验和
├── review.md                      # 升级评审（由 _template/review.md 复制填写）
└── acceptance.md                  # 验收记录（由 _template/acceptance.md 复制填写）
```

规则：

1. 产物只由 `./scripts/build.sh` 从 `tracking/REF` 锁定的 commit 生成，不手工编辑。
2. 生成后立即 `./scripts/verify.sh releases/<version>`。
3. 产物与 `review.md` / `acceptance.md` 一起提交，commit message 带上游 commit SHA。
4. **不要删除旧版本目录** —— 它是回滚时唯一的已知函数来源。
5. 真实凭据、config.json、数据库 dump 都不放这里。
