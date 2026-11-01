维护者实测确认已恢复，关闭。

修复见 PR #48（main `7d293fc`），镜像 `ghcr.io/quietsugar/token-tracker-self-hosting-go:experimental-7d293fc` 已推送：

- 轮换出的 token 由父 token 派生（HMAC-SHA256，输入是父 token 的 SHA-256），同一份 refresh token 并发 N 次只得到同一个新 token；插入靠唯一索引 + `ON CONFLICT DO NOTHING` 收敛成一行
- 60 秒宽限期改为沿 `parent_id` 走到当前存活那一份返回，不再另签
- 轮换时顺手清理 7 天前的死行
- 没有新增任何环境变量或配置项，库结构不变

若日后仍复现，请直接重开本 issue，并附上 `/health` 的 `ref` 与访问日志。
