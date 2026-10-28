-- 设备 / 用量归属诊断（**只读**，不改任何数据）
--
-- 用途：核对「某台机器的用量是不是记在另一台设备名下」。典型症状是跨设备汇总里
-- 一台虚高、另一台偏少，而账户总量没问题。
--
-- 用法（任选其一）：
--   psql "$TT_DATABASE_URL" -f go-server/scripts/device-report.sql
--   docker compose exec -T tokentracker-postgres \
--     psql -U tokentracker -d tokentracker < go-server/scripts/device-report.sql
--
-- 非默认 schema（TT_POSTGRES_SCHEMA）时先：SET search_path TO "<schema>", public;
\pset pager off
\echo '=== 1. 每台设备：token / 桶数 / 总量 / 时间范围 ==='
SELECT d.device_name,
       COALESCE(d.platform, '')                              AS platform,
       COALESCE(d.machine_id, '(空)')                        AS machine_id,
       (d.revoked_at IS NOT NULL)                            AS revoked,
       (SELECT count(*) FROM device_tokens t
         WHERE t.device_id = d.id AND t.revoked_at IS NULL)  AS active_tokens,
       count(h.*)                                            AS buckets,
       COALESCE(sum(h.total_tokens), 0)                      AS total_tokens,
       min(h.hour_start)                                     AS first_hour,
       max(h.hour_start)                                     AS last_hour,
       d.id
  FROM devices d
  LEFT JOIN hourly h ON h.device_id = d.id AND h.user_id = d.user_id
 GROUP BY d.id
 ORDER BY total_tokens DESC, d.device_name;

\echo ''
\echo '=== 2. 可疑登录：批准的 machine_id 与落到的设备行不一致 ==='
\echo '（这些就是"借用了别人设备行"的登录记录；device_token 不上屏）'
SELECT dc.user_code,
       COALESCE(dc.client_info, '')                AS client_info,
       COALESCE(dc.machine_id, '(空)')             AS login_machine_id,
       d.device_name,
       COALESCE(d.machine_id, '(空)')              AS device_machine_id,
       dc.approved_at,
       (SELECT count(*) FROM hourly h
         WHERE h.device_id = dc.device_id)         AS device_buckets
  FROM device_codes dc
  JOIN devices d ON d.id = dc.device_id
 WHERE dc.status IN ('approved', 'used')
   AND COALESCE(dc.machine_id, '') <> COALESCE(d.machine_id, '')
 ORDER BY dc.approved_at DESC;

\echo ''
\echo '=== 3. 同一 (hour_start, source, model) 同时出现在多台设备下 ==='
\echo '（迁移用量前先看这个：非 0 说明搬迁时会撞主键，需要决定合并策略）'
SELECT h.hour_start, h.source, h.model,
       count(*)                AS devices,
       string_agg(d.device_name, ' | ' ORDER BY d.device_name) AS on_devices
  FROM hourly h
  JOIN devices d ON d.id = h.device_id
 GROUP BY h.user_id, h.hour_start, h.source, h.model
HAVING count(*) > 1
 ORDER BY h.hour_start DESC
 LIMIT 50;

\echo ''
\echo '=== 4. 总计（应与账户总量一致） ==='
SELECT count(*) AS hourly_rows, COALESCE(sum(total_tokens), 0) AS total_tokens FROM hourly;
