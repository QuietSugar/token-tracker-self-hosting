# 自托管清单摘要

- 生成时间：2026-10-28T02:51:49Z（SOURCE_DATE_EPOCH，可复现）
- 构建版本：`1.4.15`
- 上游 HEAD：`4cf3e2125b8e274d03b7210c2fd0e1124e23f987`
- 安装步骤数：**15**
- 私有函数数：**14**

## 安装步骤

| # | step id | sha256(step.sql) | bytes |
|---|---|---|---|
| 1 | `01-private-baseline` | `071ca2557673de115bca98fba2ea1fd577ad056b96ef76ff4a44dcae5fff6470` | 5558 |
| 2 | `02-account-sessions` | `980d8eeef13d68f95d4fa9c32d925b66715bd342aed9aef0872d8b416cd7eabf` | 9339 |
| 3 | `03-device-identity` | `6967e029ddba62373f5e18b80cecbca2deae8f1dbeb8c2a1891ff15e5b4a85db` | 5138 |
| 4 | `04-private-aggregation` | `b95a322e4c8f1a2afd038e6f3658cc9236349b8200502bd48d07d79f68204c02` | 35650 |
| 5 | `20261003120000_cloud-subscriptions` | `d7ccbed0b936d8ff517a7932799770c944e6942cadb0c949b745ded799c19937` | 29984 |
| 6 | `20261004120000_cloud-machine-access` | `6938d26ea6dc211db83ac6c769e9930c80b147dc2fcbe837c6902ef2dc1a394c` | 29216 |
| 7 | `20261007120000_cloud-waffo` | `ee4303a99b3141015b68f960ad111672862ba9b2b2537c3d25c288eedaa66f5c` | 28265 |
| 8 | `20261007130000_cloud-waffo-retry` | `ad42488cbf8279f98e269067cbfa270c692fb171bbf66d9e2350f8c6341c1a37` | 20897 |
| 9 | `20261007140000_cloud-waffo-attempts` | `ad0986bc74bd4840247c898667783fd8153238262ecce0e27865bb7c9311b946` | 33954 |
| 10 | `20261007150000_cloud-waffo-authorizations` | `f54e4de4009d39e1f1356a5f9fd619fddd0055bf5d836f94cee452b720a799c2` | 3817 |
| 11 | `20261007160000_cloud-waffo-sandbox-periods` | `396bfab22c09a35a76510644e8ec002fa8ff48763104e1f86369c0c8b2af36d1` | 15920 |
| 12 | `10-self-hosted-policy` | `3808d8964e2f987569fd6d5eb82b2fa349e2bedd6de1ad45a631ead93279cad2` | 9662 |
| 13 | `11-token-environment-validation` | `08a7dd10fde98f8aafc25bd9f7bb719914498ef1b1ce5823d76d81c15af69d3d` | 280 |
| 14 | `12-pro-gifts` | `d3929a662143ab38f2e8edca5bcfd9549546e711222f4a20a6ba6c202f73d777` | 25902 |
| 15 | `13-machine-alias-cascade` | `002132f9587810337d2e9f1667ce2c33bf5be2b6689cf051fa21ababc9122f53` | 445 |

> 这些 checksum 由 installer 写入 `public.tokentracker_self_host_installations`。
> 重跑新版完整 SQL 时：已安装且 checksum 一致的步骤跳过；新增步骤执行；
> **旧步骤 checksum 变化会直接报错并整体回滚** —— 因此旧步骤 SQL 绝不可改。

## 私有函数清单

1. `tokentracker-device-flow-authorize`
2. `tokentracker-device-flow-grant`
3. `tokentracker-device-flow-poll`
4. `tokentracker-device-token-issue`
5. `tokentracker-device-rename`
6. `tokentracker-ingest`
7. `tokentracker-account-summary`
8. `tokentracker-account-daily`
9. `tokentracker-account-hourly`
10. `tokentracker-account-monthly`
11. `tokentracker-account-heatmap`
12. `tokentracker-account-model-breakdown`
13. `tokentracker-account-devices`
14. `tokentracker-billing`

## functions.json

```json
{
  "schemaVersion": 1,
  "mode": "self_hosted",
  "functions": [
    {
      "slug": "tokentracker-device-flow-authorize",
      "file": "tokentracker-device-flow-authorize.js",
      "public": true
    },
    {
      "slug": "tokentracker-device-flow-grant",
      "file": "tokentracker-device-flow-grant.js",
      "public": false
    },
    {
      "slug": "tokentracker-device-flow-poll",
      "file": "tokentracker-device-flow-poll.js",
      "public": true
    },
    {
      "slug": "tokentracker-device-token-issue",
      "file": "tokentracker-device-token-issue.js",
      "public": false
    },
    {
      "slug": "tokentracker-device-rename",
      "file": "tokentracker-device-rename.js",
      "public": false
    },
    {
      "slug": "tokentracker-ingest",
      "file": "tokentracker-ingest.js",
      "public": false
    },
    {
      "slug": "tokentracker-account-summary",
      "file": "tokentracker-account-summary.js",
      "public": false
    },
    {
      "slug": "tokentracker-account-daily",
      "file": "tokentracker-account-daily.js",
      "public": false
    },
    {
      "slug": "tokentracker-account-hourly",
      "file": "tokentracker-account-hourly.js",
      "public": false
    },
    {
      "slug": "tokentracker-account-monthly",
      "file": "tokentracker-account-monthly.js",
      "public": false
    },
    {
      "slug": "tokentracker-account-heatmap",
      "file": "tokentracker-account-heatmap.js",
      "public": false
    },
    {
      "slug": "tokentracker-account-model-breakdown",
      "file": "tokentracker-account-model-breakdown.js",
      "public": false
    },
    {
      "slug": "tokentracker-account-devices",
      "file": "tokentracker-account-devices.js",
      "public": false
    },
    {
      "slug": "tokentracker-billing",
      "file": "tokentracker-billing.js",
      "public": false
    }
  ],
  "serverSecrets": [
    "INSFORGE_BASE_URL",
    "INSFORGE_SERVICE_ROLE_KEY",
    "ANON_KEY",
    "JWT_SECRET or JWT_PUBLIC_KEY",
    "TOKENTRACKER_DASHBOARD_URL"
  ],
  "dashboardBuildVariables": [
    "VITE_INSFORGE_BASE_URL",
    "VITE_INSFORGE_ANON_KEY"
  ],
  "excluded": [
    "official community publishing",
    "payment provider webhooks",
    "billing merchant credentials"
  ]
}
```

