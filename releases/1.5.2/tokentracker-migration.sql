SELECT pg_advisory_xact_lock(hashtextextended('tokentracker:self-host-install',0));
DO $preflight$ BEGIN
    IF to_regclass('auth.users') IS NULL OR to_regprocedure('auth.uid()') IS NULL OR
      NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') OR
      NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') OR
      NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_admin' AND rolbypassrls) THEN
      RAISE EXCEPTION 'Install the compatible InsForge auth schema and API roles first';
    END IF;
    IF NOT has_schema_privilege('project_admin','auth','USAGE') OR
      NOT has_column_privilege('project_admin','auth.users','id','SELECT') THEN
      RAISE EXCEPTION 'The InsForge server role must be able to verify auth.users.id';
    END IF;
    IF to_regclass('public.tokentracker_self_host_installations') IS NULL AND
      (to_regclass('public.tokentracker_devices') IS NOT NULL OR to_regclass('public.tokentracker_cloud_policy') IS NOT NULL) THEN
      RAISE EXCEPTION 'This clean installer refuses an existing unregistered TokenTracker database';
    END IF;
  END $preflight$;
  CREATE TABLE IF NOT EXISTS public.tokentracker_self_host_installations(
    step text PRIMARY KEY,checksum text NOT NULL,installed_at timestamptz NOT NULL DEFAULT clock_timestamp());
  ALTER TABLE public.tokentracker_self_host_installations ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON public.tokentracker_self_host_installations FROM PUBLIC,anon,authenticated;
  GRANT ALL ON public.tokentracker_self_host_installations TO project_admin;

DO $install$ DECLARE v_checksum text; BEGIN
      SELECT checksum INTO v_checksum FROM public.tokentracker_self_host_installations WHERE step = '01-private-baseline';
      IF FOUND AND v_checksum <> '071ca2557673de115bca98fba2ea1fd577ad056b96ef76ff4a44dcae5fff6470' THEN RAISE EXCEPTION 'Installed step has changed: %','01-private-baseline'; END IF;
      IF NOT FOUND THEN
        EXECUTE '-- Application tables only. InsForge owns auth.users, auth.uid(), and API roles.
CREATE TABLE public.tokentracker_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_name text NOT NULL,
  platform text,
  machine_id text,
  revoked_at timestamptz,
  name_customized boolean NOT NULL DEFAULT false,
  default_device_name text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX tokentracker_devices_machine_unique ON public.tokentracker_devices(user_id,machine_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX tokentracker_devices_active_unique ON public.tokentracker_devices(user_id,platform,device_name) WHERE revoked_at IS NULL;
CREATE TABLE public.tokentracker_device_machine (
  device_id uuid PRIMARY KEY REFERENCES public.tokentracker_devices(id) ON DELETE CASCADE,
  machine_cluster_id text NOT NULL
);
CREATE TABLE public.tokentracker_device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES public.tokentracker_devices(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.tokentracker_device_codes (
  device_code text PRIMARY KEY,
  user_code text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT ''pending'' CHECK (status IN (''pending'',''approved'',''used'',''expired'')),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  approved_at timestamptz,
  client_info text,
  machine_id text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.tokentracker_hourly (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES public.tokentracker_devices(id) ON DELETE CASCADE,
  hour_start timestamptz NOT NULL,
  source text NOT NULL,
  model text NOT NULL,
  input_tokens bigint NOT NULL CHECK (input_tokens >= 0),
  cached_input_tokens bigint NOT NULL CHECK (cached_input_tokens >= 0),
  cache_creation_input_tokens bigint NOT NULL CHECK (cache_creation_input_tokens >= 0),
  output_tokens bigint NOT NULL CHECK (output_tokens >= 0),
  reasoning_output_tokens bigint NOT NULL CHECK (reasoning_output_tokens >= 0),
  total_tokens bigint NOT NULL CHECK (total_tokens >= 0),
  billable_total_tokens bigint,
  conversations integer NOT NULL CHECK (conversations >= 0),
  total_cost_usd numeric NOT NULL DEFAULT 0 CHECK (total_cost_usd >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(user_id,device_id,hour_start,source,model)
);
CREATE INDEX tokentracker_hourly_user_time_idx ON public.tokentracker_hourly(user_id,hour_start);
CREATE TABLE public.tokentracker_account_usage_cache (
  cache_key text PRIMARY KEY, fetched_at timestamptz NOT NULL, result jsonb NOT NULL
);
ALTER TABLE public.tokentracker_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tokentracker_device_machine ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tokentracker_device_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tokentracker_device_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tokentracker_hourly ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tokentracker_account_usage_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tokentracker_devices,public.tokentracker_device_machine,public.tokentracker_device_tokens,
  public.tokentracker_device_codes,public.tokentracker_hourly,public.tokentracker_account_usage_cache FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.tokentracker_devices,public.tokentracker_device_machine,public.tokentracker_device_tokens,
  public.tokentracker_device_codes,public.tokentracker_hourly,public.tokentracker_account_usage_cache TO project_admin;

CREATE INDEX tokentracker_account_usage_cache_owner_idx
  ON public.tokentracker_account_usage_cache((split_part(cache_key,chr(31),2)));
CREATE FUNCTION public.self_host_invalidate_usage_cache() RETURNS trigger LANGUAGE plpgsql
SET search_path = public,pg_temp AS $fn$
BEGIN
  IF TG_OP = ''INSERT'' THEN
    DELETE FROM public.tokentracker_account_usage_cache
      WHERE split_part(cache_key,chr(31),2) IN (SELECT DISTINCT user_id::text FROM changed_new);
  ELSIF TG_OP = ''DELETE'' THEN
    DELETE FROM public.tokentracker_account_usage_cache
      WHERE split_part(cache_key,chr(31),2) IN (SELECT DISTINCT user_id::text FROM changed_old);
  ELSE
    DELETE FROM public.tokentracker_account_usage_cache
      WHERE split_part(cache_key,chr(31),2) IN (
        SELECT user_id::text FROM changed_new UNION SELECT user_id::text FROM changed_old);
  END IF;
  RETURN NULL;
END;
$fn$;
CREATE TRIGGER self_host_hourly_insert_cache AFTER INSERT ON public.tokentracker_hourly
  REFERENCING NEW TABLE AS changed_new FOR EACH STATEMENT EXECUTE FUNCTION public.self_host_invalidate_usage_cache();
CREATE TRIGGER self_host_hourly_update_cache AFTER UPDATE ON public.tokentracker_hourly
  REFERENCING OLD TABLE AS changed_old NEW TABLE AS changed_new FOR EACH STATEMENT EXECUTE FUNCTION public.self_host_invalidate_usage_cache();
CREATE TRIGGER self_host_hourly_delete_cache AFTER DELETE ON public.tokentracker_hourly
  REFERENCING OLD TABLE AS changed_old FOR EACH STATEMENT EXECUTE FUNCTION public.self_host_invalidate_usage_cache();
REVOKE ALL ON FUNCTION public.self_host_invalidate_usage_cache() FROM PUBLIC,anon,authenticated;
';
        INSERT INTO public.tokentracker_self_host_installations(step,checksum) VALUES ('01-private-baseline','071ca2557673de115bca98fba2ea1fd577ad056b96ef76ff4a44dcae5fff6470');
      END IF;
    END $install$;

DO $install$ DECLARE v_checksum text; BEGIN
      SELECT checksum INTO v_checksum FROM public.tokentracker_self_host_installations WHERE step = '02-account-sessions';
      IF FOUND AND v_checksum <> '980d8eeef13d68f95d4fa9c32d925b66715bd342aed9aef0872d8b416cd7eabf' THEN RAISE EXCEPTION 'Installed step has changed: %','02-account-sessions'; END IF;
      IF NOT FOUND THEN
        EXECUTE '-- Account-level sources serve CORRECTABLE account snapshots, not append-only
-- machine logs: TRAE CN (trae-cn) can revise a session''s totals downward,
-- move it to another model, or shift its half-hour bucket. Deduplicating
-- those corrections at the HOUR level cannot work: a fresh device''s snapshot
-- starts at its first observed session, so an hour-level owner can never
-- safely displace a stale tuple for an hour the fresh snapshot has no data
-- for (that would require an unproven "absent = deleted" contract), and a
-- bucket migration (10:00 -> 10:30) leaves the old hour stranded.
--
-- Fix: canonical truth at the SESSION level. TRAE''s usage API carries a
-- session_id whose observed stability splits into (evidence 2026-08-17,
-- one account, three real fetches 137 -> 141 -> 164 sessions):
--   repeated-fetch stability        VERIFIED (137/137 persisted across two
--                                   independent fetches, 0 disappearances;
--                                   one session revised upward mid-window
--                                   KEPT its session_id)
--   cross-window stability          VERIFIED (window-subset queries return
--                                   exact id subsets)
--   no duplicate ids                OBSERVED (all fetched responses)
--   cross-device same-account       NOT DIRECTLY VERIFIED: the request body
--                                   carries no device discriminator, but that
--                                   is necessary, not sufficient - a device
--                                   or login context could ride inside the
--                                   JWT / server auth context. No second
--                                   independent device/auth experiment was
--                                   run. If it were ever DISPROVEN (same
--                                   logical session, different ids per
--                                   device), this PK would split one logical
--                                   session into competing rows and the
--                                   identity must be re-evaluated.
-- The CLI parser (src/lib/rollout.js) emits one queue record per CHANGED
-- session (kind: "account_session_state"); the ingest edge upserts them
-- here via tokentracker_upsert_account_session_states(). Identity is
-- (user_id, source, session_id) - device_id is NOT part of the identity
-- (the API request carries no device discriminator; see the stability
-- split above for what that does and does not prove).
--
-- Three corrections become ONE whole-row replace:
--   downward   S tokens 100 -> 60        row replaced, total 60
--   model      S model A -> B            row replaced, only B=100 remains
--   bucket     S bucket 10:00 -> 10:30   row replaced, only 10:30=100
-- A fresh device with no cursor history simply uploads the sessions it sees;
-- the upsert''s LWW guard reconciles versions across devices.
--
-- Absence is NOT PROVEN to mean deletion (see the parser''s empty-payload
-- note): nothing here ever deletes a session row. Corrections are explicit
-- observations only.
--
-- Freshness: the API exposes NO provider-side ordering signal (headers carry
-- only CDN trace ids; rows have no revision/updated_at - probed 2026-08-17).
-- snapshot_verified_at is the CLIENT fetch stamp, set once per real fetch
-- and replayed verbatim by the append-only queue. The upsert applies an
-- observation only when its stamp is STRICTLY NEWER (>) than the stored
-- one, so a transport retry of an old observation is a no-op, and the same
-- observation replayed is idempotent. This is best-effort cross-device
-- ordering, NOT strict correctness: client clock skew can mis-order two
-- conflicting observations of one session, and a sufficiently
-- future-skewed client timestamp can delay later corrections (residual
-- risk; there is no mechanism bounding the skew).
--
-- Semantics mirrored by src/lib/account-usage-dedup.js and pinned by
-- test/account-usage-dedup.test.js. Apply BEFORE re-deploying the updated
-- scripts/ops/account-usage-grouped-rpc.sql and the ingest edge (both read /
-- write this table).
-- Rollback: DROP TABLE tokentracker_account_session_states; DROP FUNCTION
-- tokentracker_upsert_account_session_states(uuid, jsonb); and re-apply the
-- previous leaderboard_hourly_dedup_v2 definition.

CREATE TABLE IF NOT EXISTS public.tokentracker_account_session_states (
  user_id uuid NOT NULL,
  source text NOT NULL,
  -- Provider-side session identity (TRAE session_id): stable across
  -- repeated fetches and window changes (VERIFIED), account-scoped rather
  -- than device-scoped in the request (cross-device id stability itself is
  -- NOT DIRECTLY VERIFIED - see the header''s evidence split).
  session_id text NOT NULL,
  model text NOT NULL,
  -- Canonical UTC half-hour bucket of this session''s CURRENT placement.
  bucket_start timestamptz NOT NULL,
  input_tokens bigint NOT NULL,
  output_tokens bigint NOT NULL,
  cached_input_tokens bigint NOT NULL,
  cache_creation_input_tokens bigint NOT NULL,
  reasoning_output_tokens bigint NOT NULL,
  total_tokens bigint NOT NULL,
  -- Client logical fetch stamp (see the freshness note above). Ops metadata
  -- only - updated_at (first server write time) never participates in
  -- correctness.
  snapshot_verified_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, source, session_id),
  CHECK (
    total_tokens =
      input_tokens + cached_input_tokens + cache_creation_input_tokens + output_tokens
  ),
  CHECK (
    input_tokens >= 0 AND output_tokens >= 0 AND cached_input_tokens >= 0
    AND cache_creation_input_tokens >= 0 AND reasoning_output_tokens >= 0
    AND total_tokens >= 0
  )
);

ALTER TABLE public.tokentracker_account_session_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tokentracker_account_session_states FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.tokentracker_account_session_states TO project_admin;

-- Aggregation reads group by (user, source, bucket).
CREATE INDEX IF NOT EXISTS tokentracker_account_session_states_bucket_idx
  ON public.tokentracker_account_session_states (user_id, source, bucket_start);

-- Batch LWW upsert used by the ingest edge (the SDK''s upsert cannot express
-- a conditional DO UPDATE). SECURITY DEFINER with a locked search_path; the
-- edge calls it with the service-role token after authenticating the device.
-- A strict ">" guard makes replay idempotent and prevents a transport retry
-- of an older observation from displacing a newer one; conflicting
-- observations with EQUAL stamps keep the first-applied row (stable under
-- retries).
CREATE OR REPLACE FUNCTION public.tokentracker_upsert_account_session_states(
  p_user_id uuid,
  p_states jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_applied integer;
BEGIN
  INSERT INTO tokentracker_account_session_states AS t
    (user_id, source, session_id, model, bucket_start,
     input_tokens, output_tokens, cached_input_tokens,
     cache_creation_input_tokens, reasoning_output_tokens, total_tokens,
     snapshot_verified_at)
  SELECT
    p_user_id, x.source, x.session_id, x.model, x.bucket_start,
    x.input_tokens, x.output_tokens, x.cached_input_tokens,
    x.cache_creation_input_tokens, x.reasoning_output_tokens, x.total_tokens,
    x.snapshot_verified_at
  FROM jsonb_to_recordset(p_states) AS x(
    source text, session_id text, model text, bucket_start timestamptz,
    input_tokens bigint, output_tokens bigint, cached_input_tokens bigint,
    cache_creation_input_tokens bigint, reasoning_output_tokens bigint,
    total_tokens bigint, snapshot_verified_at timestamptz)
  ON CONFLICT (user_id, source, session_id) DO UPDATE SET
    model = EXCLUDED.model,
    bucket_start = EXCLUDED.bucket_start,
    input_tokens = EXCLUDED.input_tokens,
    output_tokens = EXCLUDED.output_tokens,
    cached_input_tokens = EXCLUDED.cached_input_tokens,
    cache_creation_input_tokens = EXCLUDED.cache_creation_input_tokens,
    reasoning_output_tokens = EXCLUDED.reasoning_output_tokens,
    total_tokens = EXCLUDED.total_tokens,
    snapshot_verified_at = EXCLUDED.snapshot_verified_at,
    updated_at = now()
  WHERE EXCLUDED.snapshot_verified_at > t.snapshot_verified_at;

  GET DIAGNOSTICS v_applied = ROW_COUNT;
  RETURN v_applied;
END
$fn$;

REVOKE ALL ON FUNCTION public.tokentracker_upsert_account_session_states(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tokentracker_upsert_account_session_states(uuid, jsonb)
  TO project_admin;


CREATE TRIGGER self_host_sessions_insert_cache AFTER INSERT ON public.tokentracker_account_session_states
  REFERENCING NEW TABLE AS changed_new FOR EACH STATEMENT EXECUTE FUNCTION public.self_host_invalidate_usage_cache();
CREATE TRIGGER self_host_sessions_update_cache AFTER UPDATE ON public.tokentracker_account_session_states
  REFERENCING OLD TABLE AS changed_old NEW TABLE AS changed_new FOR EACH STATEMENT EXECUTE FUNCTION public.self_host_invalidate_usage_cache();
CREATE TRIGGER self_host_sessions_delete_cache AFTER DELETE ON public.tokentracker_account_session_states
  REFERENCING OLD TABLE AS changed_old FOR EACH STATEMENT EXECUTE FUNCTION public.self_host_invalidate_usage_cache();';
        INSERT INTO public.tokentracker_self_host_installations(step,checksum) VALUES ('02-account-sessions','980d8eeef13d68f95d4fa9c32d925b66715bd342aed9aef0872d8b416cd7eabf');
      END IF;
    END $install$;

DO $install$ DECLARE v_checksum text; BEGIN
      SELECT checksum INTO v_checksum FROM public.tokentracker_self_host_installations WHERE step = '03-device-identity';
      IF FOUND AND v_checksum <> '6967e029ddba62373f5e18b80cecbca2deae8f1dbeb8c2a1891ff15e5b4a85db' THEN RAISE EXCEPTION 'Installed step has changed: %','03-device-identity'; END IF;
      IF NOT FOUND THEN
        EXECUTE 'CREATE OR REPLACE FUNCTION public.refresh_tokentracker_device_identity(
  p_user_id uuid,
  p_device_id uuid,
  p_device_name text,
  p_platform text
) RETURNS boolean
LANGUAGE plpgsql VOLATILE
SET search_path TO public, pg_temp
SET statement_timeout TO ''15s''
AS $func$
DECLARE
  v_current_name text;
  v_name_customized boolean;
  v_current_default_name text;
  v_legacy_id uuid;
  v_legacy_name text;
  v_legacy_name_customized boolean;
  v_legacy_default_name text;
  v_target_name text;
  v_target_name_customized boolean;
  v_target_default_name text;
BEGIN
  SELECT d.device_name, d.name_customized, d.default_device_name
    INTO v_current_name, v_name_customized, v_current_default_name
  FROM public.tokentracker_devices AS d
  WHERE d.id = p_device_id
    AND d.user_id = p_user_id
    AND d.revoked_at IS NULL
    AND d.machine_id IS NOT NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT
    legacy.id,
    legacy.device_name,
    legacy.name_customized,
    legacy.default_device_name
  INTO
    v_legacy_id,
    v_legacy_name,
    v_legacy_name_customized,
    v_legacy_default_name
  FROM public.tokentracker_devices AS legacy
  WHERE legacy.user_id = p_user_id
    AND legacy.id <> p_device_id
    AND legacy.revoked_at IS NULL
    AND legacy.machine_id IS NULL
    AND legacy.platform IS NOT DISTINCT FROM p_platform
    AND (
      legacy.device_name = p_device_name
      OR legacy.default_device_name = p_device_name
    )
  ORDER BY
    CASE WHEN legacy.device_name = p_device_name THEN 0 ELSE 1 END,
    legacy.created_at,
    legacy.id
  LIMIT 1
  FOR UPDATE;

  IF v_legacy_id IS NOT NULL THEN
    INSERT INTO public.tokentracker_hourly AS canonical (
      user_id,
      device_id,
      source,
      model,
      hour_start,
      input_tokens,
      cached_input_tokens,
      cache_creation_input_tokens,
      output_tokens,
      reasoning_output_tokens,
      total_tokens,
      billable_total_tokens,
      conversations,
      created_at,
      updated_at,
      total_cost_usd
    )
    SELECT
      ranked.user_id,
      p_device_id,
      ranked.source,
      ranked.model,
      ranked.hour_start,
      ranked.input_tokens,
      ranked.cached_input_tokens,
      ranked.cache_creation_input_tokens,
      ranked.output_tokens,
      ranked.reasoning_output_tokens,
      ranked.total_tokens,
      ranked.billable_total_tokens,
      ranked.conversations,
      ranked.created_at,
      ranked.updated_at,
      ranked.total_cost_usd
    FROM (
      SELECT
        h.*,
        ROW_NUMBER() OVER (
          PARTITION BY h.user_id, h.source, h.model, h.hour_start
          ORDER BY h.total_tokens DESC, h.updated_at DESC, h.device_id = p_device_id DESC
        ) AS canonical_rank
      FROM public.tokentracker_hourly AS h
      WHERE h.user_id = p_user_id
        AND h.device_id IN (p_device_id, v_legacy_id)
    ) AS ranked
    WHERE ranked.canonical_rank = 1
    ON CONFLICT (user_id, device_id, source, model, hour_start) DO UPDATE SET
      input_tokens = EXCLUDED.input_tokens,
      cached_input_tokens = EXCLUDED.cached_input_tokens,
      cache_creation_input_tokens = EXCLUDED.cache_creation_input_tokens,
      output_tokens = EXCLUDED.output_tokens,
      reasoning_output_tokens = EXCLUDED.reasoning_output_tokens,
      total_tokens = EXCLUDED.total_tokens,
      billable_total_tokens = EXCLUDED.billable_total_tokens,
      conversations = EXCLUDED.conversations,
      created_at = EXCLUDED.created_at,
      updated_at = EXCLUDED.updated_at,
      total_cost_usd = EXCLUDED.total_cost_usd;

    DELETE FROM public.tokentracker_hourly
    WHERE user_id = p_user_id
      AND device_id = v_legacy_id;

    UPDATE public.tokentracker_device_tokens
    SET device_id = p_device_id
    WHERE user_id = p_user_id
      AND device_id = v_legacy_id;

    IF to_regclass(''public.tokentracker_device_machine'') IS NOT NULL THEN
      EXECUTE
        ''DELETE FROM public.tokentracker_device_machine WHERE device_id = $1''
      USING v_legacy_id;
    END IF;

    UPDATE public.tokentracker_devices
    SET revoked_at = clock_timestamp()
    WHERE id = v_legacy_id
      AND user_id = p_user_id
      AND revoked_at IS NULL
      AND machine_id IS NULL;
  END IF;

  v_target_name := CASE
    WHEN v_name_customized THEN v_current_name
    WHEN COALESCE(v_legacy_name_customized, false) THEN v_legacy_name
    ELSE p_device_name
  END;
  v_target_name_customized :=
    v_name_customized OR COALESCE(v_legacy_name_customized, false);
  v_target_default_name := CASE
    WHEN v_name_customized THEN v_current_default_name
    WHEN COALESCE(v_legacy_name_customized, false)
      THEN COALESCE(v_legacy_default_name, p_device_name)
    ELSE v_current_default_name
  END;

  BEGIN
    UPDATE public.tokentracker_devices
    SET
      device_name = v_target_name,
      platform = p_platform,
      name_customized = v_target_name_customized,
      default_device_name = v_target_default_name
    WHERE id = p_device_id
      AND user_id = p_user_id
      AND revoked_at IS NULL;
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  RETURN true;
END;
$func$;';
        INSERT INTO public.tokentracker_self_host_installations(step,checksum) VALUES ('03-device-identity','6967e029ddba62373f5e18b80cecbca2deae8f1dbeb8c2a1891ff15e5b4a85db');
      END IF;
    END $install$;

DO $install$ DECLARE v_checksum text; BEGIN
      SELECT checksum INTO v_checksum FROM public.tokentracker_self_host_installations WHERE step = '04-private-aggregation';
      IF FOUND AND v_checksum <> 'b95a322e4c8f1a2afd038e6f3658cc9236349b8200502bd48d07d79f68204c02' THEN RAISE EXCEPTION 'Installed step has changed: %','04-private-aggregation'; END IF;
      IF NOT FOUND THEN
        EXECUTE '-- Clean private-instance aggregation only; do not replace a hosted cold-history reader.
CREATE OR REPLACE FUNCTION public.account_usage_grouped(
  p_user_id uuid,
  p_device_ids uuid[],
  p_from timestamptz,
  p_to timestamptz,
  p_trunc text,
  p_tz text,
  p_offset_min integer
) RETURNS jsonb
LANGUAGE sql STABLE
SET search_path TO public, pg_temp
SET statement_timeout TO ''8s''
AS $func$
  WITH tzr AS (
    SELECT CASE
      WHEN p_tz IS NOT NULL AND p_tz <> ''''
       AND EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_tz)
      THEN p_tz ELSE NULL
    END AS tz
  ), base AS MATERIALIZED (
    SELECT
      h.device_id, h.hour_start, h.source, h.model,
      h.total_tokens::bigint AS total_tokens,
      h.input_tokens::bigint AS input_tokens,
      h.output_tokens::bigint AS output_tokens,
      h.cached_input_tokens::bigint AS cached_input_tokens,
      h.cache_creation_input_tokens::bigint AS cache_creation_input_tokens,
      h.reasoning_output_tokens::bigint AS reasoning_output_tokens,
      h.conversations::bigint AS conversations,
      h.updated_at
    FROM public.tokentracker_hourly h
    WHERE h.user_id = p_user_id
      AND h.hour_start >= p_from AND h.hour_start < p_to
      AND (
        h.source = ''cursor''
        OR (
          h.source NOT IN (''cursor'', ''trae-cn'')
          AND h.device_id = ANY(p_device_ids)
        )
      )
  ), hourly AS (
    SELECT mac.hour_start, mac.source, mac.model,
      mac.total_tokens, mac.input_tokens, mac.output_tokens,
      mac.cached_input_tokens, mac.cache_creation_input_tokens,
      mac.reasoning_output_tokens, mac.conversations
    FROM (
      SELECT DISTINCT ON (
        COALESCE(dm.machine_cluster_id, h.device_id::text),
        h.hour_start, h.source, h.model
      )
        h.hour_start, h.source, h.model,
        h.total_tokens, h.input_tokens, h.output_tokens,
        h.cached_input_tokens, h.cache_creation_input_tokens,
        h.reasoning_output_tokens, h.conversations
      FROM base h
      LEFT JOIN public.tokentracker_device_machine dm ON dm.device_id = h.device_id
      WHERE h.source NOT IN (''cursor'', ''trae-cn'')
        AND h.device_id = ANY(p_device_ids)
      ORDER BY COALESCE(dm.machine_cluster_id, h.device_id::text),
        h.hour_start, h.source, h.model, h.total_tokens DESC, h.updated_at DESC
    ) mac

    UNION ALL

    SELECT d.hour_start, d.source, d.model,
      d.total_tokens, d.input_tokens, d.output_tokens,
      d.cached_input_tokens, d.cache_creation_input_tokens,
      d.reasoning_output_tokens, d.conversations
    FROM (
      SELECT DISTINCT ON (h.hour_start, h.source, h.model)
        h.hour_start, h.source, h.model,
        h.total_tokens, h.input_tokens, h.output_tokens,
        h.cached_input_tokens, h.cache_creation_input_tokens,
        h.reasoning_output_tokens, h.conversations
      FROM base h
      WHERE h.source = ''cursor''
      ORDER BY h.hour_start, h.source, h.model, h.total_tokens DESC, h.updated_at DESC
    ) d

    UNION ALL

    SELECT s.bucket_start, s.source, s.model,
      SUM(s.total_tokens)::bigint, SUM(s.input_tokens)::bigint,
      SUM(s.output_tokens)::bigint, SUM(s.cached_input_tokens)::bigint,
      SUM(s.cache_creation_input_tokens)::bigint,
      SUM(s.reasoning_output_tokens)::bigint, COUNT(*)::bigint
    FROM public.tokentracker_account_session_states s
    WHERE s.user_id = p_user_id
      AND s.bucket_start >= p_from AND s.bucket_start < p_to
      AND s.source = ''trae-cn''
    GROUP BY s.bucket_start, s.source, s.model
  ), located AS (
    SELECT
      CASE p_trunc
        WHEN ''hour'' THEN to_char(date_trunc(''hour'', local_ts), ''YYYY-MM-DD"T"HH24:00:00'')
        WHEN ''day'' THEN to_char(date_trunc(''day'', local_ts), ''YYYY-MM-DD'')
        WHEN ''month'' THEN to_char(date_trunc(''month'', local_ts), ''YYYY-MM'')
        ELSE ''''
      END AS bucket,
      source, model,
      CASE WHEN lower(model) LIKE ''%deepseek-v4-flash%'' OR lower(model) LIKE ''%deepseek-v4-pro%'' THEN CASE
        WHEN hour_start >= timestamptz ''2026-08-22T16:00:00Z''
          AND extract(dow FROM ((hour_start AT TIME ZONE ''UTC'') + interval ''8 hours'')) IN (0,6) THEN ''off_peak''
        WHEN extract(hour FROM hour_start AT TIME ZONE ''UTC'') >= 1 AND extract(hour FROM hour_start AT TIME ZONE ''UTC'') < 4
          OR extract(hour FROM hour_start AT TIME ZONE ''UTC'') >= 6 AND extract(hour FROM hour_start AT TIME ZONE ''UTC'') < 10
          THEN ''peak'' ELSE ''off_peak'' END ELSE ''peak'' END AS pricing_tier,
      total_tokens, input_tokens, output_tokens, cached_input_tokens,
      cache_creation_input_tokens, reasoning_output_tokens, conversations
    FROM hourly CROSS JOIN tzr
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN tzr.tz IS NOT NULL THEN hour_start AT TIME ZONE tzr.tz
        WHEN p_offset_min IS NOT NULL
          THEN (hour_start AT TIME ZONE ''UTC'') + make_interval(mins => p_offset_min)
        ELSE hour_start AT TIME ZONE ''UTC''
      END AS local_ts
    ) local_time
  ), grouped AS (
    SELECT bucket, source, model, pricing_tier,
      SUM(total_tokens)::bigint AS total_tokens,
      SUM(input_tokens)::bigint AS input_tokens,
      SUM(output_tokens)::bigint AS output_tokens,
      SUM(cached_input_tokens)::bigint AS cached_input_tokens,
      SUM(cache_creation_input_tokens)::bigint AS cache_creation_input_tokens,
      SUM(reasoning_output_tokens)::bigint AS reasoning_output_tokens,
      SUM(conversations)::bigint AS conversations
    FROM located
    GROUP BY bucket, source, model, pricing_tier
  )
  SELECT COALESCE(
    jsonb_agg(to_jsonb(grouped.*) ORDER BY bucket, source, model, pricing_tier),
    ''[]''::jsonb
  ) FROM grouped
$func$;


CREATE OR REPLACE FUNCTION public.account_usage_grouped_v2(
  p_user_id uuid,
  p_device_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_trunc text,
  p_tz text,
  p_offset_min integer
) RETURNS jsonb
LANGUAGE sql STABLE
SET search_path TO public, pg_temp
SET statement_timeout TO ''8s''
AS $func$
  WITH active AS (
    SELECT COALESCE(array_agg(d.id ORDER BY d.id), ARRAY[]::uuid[]) AS ids
    FROM public.tokentracker_devices d
    WHERE d.user_id = p_user_id AND d.revoked_at IS NULL
  ), scoped AS (
    SELECT ids,
      CASE WHEN p_device_id IS NOT NULL AND p_device_id = ANY(ids)
        THEN ARRAY[p_device_id]::uuid[] ELSE ids END AS selected_ids
    FROM active
  )
  SELECT CASE WHEN cardinality(ids) = 0 THEN ''[]''::jsonb
    ELSE public.account_usage_grouped(
      p_user_id, selected_ids, p_from, p_to, p_trunc, p_tz, p_offset_min
    ) END
  FROM scoped
$func$;

CREATE OR REPLACE FUNCTION public.account_usage_grouped_cached(
  p_user_id uuid,
  p_device_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_trunc text,
  p_tz text,
  p_offset_min integer
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE
SET search_path TO public, pg_temp
SET statement_timeout TO ''8s''
AS $func$
DECLARE
  v_cache_key text;
  v_result jsonb;
BEGIN
  v_cache_key := concat_ws(
    chr(31),
    ''v1'',
    p_user_id::text,
    COALESCE(p_device_id::text, ''''),
    to_char(p_from AT TIME ZONE ''UTC'', ''YYYY-MM-DD"T"HH24:MI:SS.US''),
    to_char(p_to AT TIME ZONE ''UTC'', ''YYYY-MM-DD"T"HH24:MI:SS.US''),
    p_trunc,
    COALESCE(p_tz, ''''),
    COALESCE(p_offset_min::text, '''')
  );

  SELECT c.result
    INTO v_result
  FROM public.tokentracker_account_usage_cache c
  WHERE c.cache_key = v_cache_key
    AND c.fetched_at >= clock_timestamp() - interval ''30 seconds'';
  IF FOUND THEN
    RETURN v_result;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_cache_key, 0));

  SELECT c.result
    INTO v_result
  FROM public.tokentracker_account_usage_cache c
  WHERE c.cache_key = v_cache_key
    AND c.fetched_at >= clock_timestamp() - interval ''30 seconds'';
  IF FOUND THEN
    RETURN v_result;
  END IF;

  v_result := public.account_usage_grouped_v2(
    p_user_id,
    p_device_id,
    p_from,
    p_to,
    p_trunc,
    p_tz,
    p_offset_min
  );

  INSERT INTO public.tokentracker_account_usage_cache AS c (
    cache_key,
    fetched_at,
    result
  ) VALUES (
    v_cache_key,
    clock_timestamp(),
    v_result
  )
  ON CONFLICT (cache_key) DO UPDATE SET
    fetched_at = EXCLUDED.fetched_at,
    result = EXCLUDED.result;

  IF random() < 0.01 THEN
    WITH stale AS (
      SELECT stale.cache_key
      FROM public.tokentracker_account_usage_cache AS stale
      WHERE stale.fetched_at < clock_timestamp() - interval ''5 minutes''
      ORDER BY stale.fetched_at, stale.cache_key
      FOR UPDATE SKIP LOCKED
      LIMIT 256
    )
    DELETE FROM public.tokentracker_account_usage_cache AS c
    USING stale
    WHERE c.cache_key = stale.cache_key;
  END IF;

  RETURN v_result;
END;
$func$;

-- Stop shipping per-row detail to the edge just to be summed and thrown away.
--
-- account-summary and account-heatmap both called account_usage_grouped_cached()
-- and received one row per (local day, source, model, pricing_tier) with eight
-- token columns each, then folded that down in Deno. Neither endpoint ever
-- emitted those rows: summary emits totals, a day count and two rolling
-- windows; heatmap emits one cell per day. For a heavy account a 52-week
-- heatmap moved ~400 KB across the wire to render ~45 KB, and a 30-day summary
-- moved ~99 KB to render a few hundred bytes.
--
-- That transfer dominated the project''s egress bill: access logs showed
-- account_usage_grouped_cached alone at 74% of all egress bytes, and
-- edge-to-PostgREST traffic at 83% of the total, on the way to ~1.1 TB against a
-- 250 GB allowance.
--
-- Both functions below delegate to account_usage_grouped_cached() unchanged, so
-- they inherit its 30-second shared cache, its advisory-lock cold fill and its
-- cross-device dedup semantics byte for byte. The only thing that moves is where
-- the rollup happens. Range filtering (p_range_from / p_range_to, inclusive
-- local-day strings) moves in here too, matching the string comparison the edge
-- functions used to do in JS.
--
-- Cost is deliberately NOT computed here. The model price table lives in the
-- five edge functions (see test/edge-pricing-parity.test.js) and must not gain a
-- sixth copy in SQL. account_summary_compact returns cost_dims: the token
-- columns summed per (source, model, pricing_tier), which is every dimension
-- pricing depends on. computeRowCost is linear in each token column, so pricing
-- the day-folded dims equals pricing each day and summing. Verified against the
-- per-day path on 12 real heavy accounts: worst relative difference 8.5e-16
-- (double epsilon), zero differences at the emitted toFixed(6).

CREATE OR REPLACE FUNCTION public.account_summary_compact(
  p_user_id uuid,
  p_device_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_tz text,
  p_offset_min integer,
  p_range_from text,
  p_range_to text
) RETURNS jsonb
LANGUAGE sql
VOLATILE
SET search_path TO ''public'', ''pg_temp''
SET statement_timeout TO ''8s''
AS $fn$
  WITH raw AS (
    SELECT public.account_usage_grouped_cached(
      p_user_id, p_device_id, p_from, p_to, ''day'', p_tz, p_offset_min
    ) AS j
  ), g AS (
    SELECT
      e->>''bucket'' AS bucket,
      e->>''source'' AS source,
      e->>''model'' AS model,
      e->>''pricing_tier'' AS pricing_tier,
      COALESCE((e->>''total_tokens'')::bigint, 0) AS total_tokens,
      COALESCE((e->>''input_tokens'')::bigint, 0) AS input_tokens,
      COALESCE((e->>''output_tokens'')::bigint, 0) AS output_tokens,
      COALESCE((e->>''cached_input_tokens'')::bigint, 0) AS cached_input_tokens,
      COALESCE((e->>''cache_creation_input_tokens'')::bigint, 0) AS cache_creation_input_tokens,
      COALESCE((e->>''reasoning_output_tokens'')::bigint, 0) AS reasoning_output_tokens,
      COALESCE((e->>''conversations'')::bigint, 0) AS conversations
    FROM raw, jsonb_array_elements(raw.j) e
  ), in_range AS (
    SELECT * FROM g WHERE bucket >= p_range_from AND bucket <= p_range_to
  ), dims AS (
    SELECT source, model, pricing_tier,
      SUM(input_tokens) AS i,
      SUM(output_tokens) AS o,
      SUM(cached_input_tokens) AS cr,
      SUM(cache_creation_input_tokens) AS cw,
      SUM(reasoning_output_tokens) AS rs
    FROM in_range
    GROUP BY source, model, pricing_tier
  ), days AS (
    SELECT bucket, SUM(total_tokens) AS t, SUM(conversations) AS c
    FROM g GROUP BY bucket
  )
  SELECT jsonb_build_object(
    ''cost_dims'', COALESCE(
      (SELECT jsonb_agg(jsonb_build_array(source, model, pricing_tier, i, o, cr, cw, rs)
                        ORDER BY source, model, pricing_tier) FROM dims),
      ''[]''::jsonb),
    ''day_rollup'', COALESCE(
      (SELECT jsonb_agg(jsonb_build_array(bucket, t, c) ORDER BY bucket) FROM days),
      ''[]''::jsonb),
    ''range_totals'', (SELECT jsonb_build_object(
        ''total_tokens'', COALESCE(SUM(total_tokens), 0),
        ''input_tokens'', COALESCE(SUM(input_tokens), 0),
        ''output_tokens'', COALESCE(SUM(output_tokens), 0),
        ''cached_input_tokens'', COALESCE(SUM(cached_input_tokens), 0),
        ''cache_creation_input_tokens'', COALESCE(SUM(cache_creation_input_tokens), 0),
        ''reasoning_output_tokens'', COALESCE(SUM(reasoning_output_tokens), 0),
        ''conversation_count'', COALESCE(SUM(conversations), 0),
        ''active_days'', COUNT(DISTINCT bucket)
      ) FROM in_range)
  )
$fn$;

-- One [day, total_tokens, {model: tokens}] triple per active local day. The
-- NULL/empty model folds to ''unknown'' here, exactly as the edge''s
-- String(row.model || "unknown") used to.
CREATE OR REPLACE FUNCTION public.account_heatmap_compact(
  p_user_id uuid,
  p_device_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_tz text,
  p_offset_min integer,
  p_range_from text,
  p_range_to text
) RETURNS jsonb
LANGUAGE sql
VOLATILE
SET search_path TO ''public'', ''pg_temp''
SET statement_timeout TO ''8s''
AS $fn$
  WITH raw AS (
    SELECT public.account_usage_grouped_cached(
      p_user_id, p_device_id, p_from, p_to, ''day'', p_tz, p_offset_min
    ) AS j
  ), g AS (
    SELECT
      e->>''bucket'' AS bucket,
      COALESCE(NULLIF(e->>''model'', ''''), ''unknown'') AS model,
      COALESCE((e->>''total_tokens'')::bigint, 0) AS tt
    FROM raw, jsonb_array_elements(raw.j) e
    WHERE e->>''bucket'' >= p_range_from AND e->>''bucket'' <= p_range_to
  ), per_model AS (
    SELECT bucket, model, SUM(tt) AS mt
    FROM g GROUP BY bucket, model
  ), per_day AS (
    SELECT bucket, SUM(mt) AS t, jsonb_object_agg(model, mt) AS models
    FROM per_model GROUP BY bucket
  )
  SELECT COALESCE(
    (SELECT jsonb_agg(jsonb_build_array(bucket, t, models) ORDER BY bucket) FROM per_day),
    ''[]''::jsonb)
$fn$;

-- Postgres grants EXECUTE to PUBLIC by default, which would let any anon caller
-- pass an arbitrary p_user_id and read another account''s usage. Match the
-- account_usage_grouped_cached ACL exactly: project_admin only, which is the
-- role the edge functions connect as.
REVOKE ALL ON FUNCTION public.account_summary_compact(uuid, uuid, timestamptz, timestamptz, text, integer, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.account_heatmap_compact(uuid, uuid, timestamptz, timestamptz, text, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_summary_compact(uuid, uuid, timestamptz, timestamptz, text, integer, text, text) TO project_admin;
GRANT EXECUTE ON FUNCTION public.account_heatmap_compact(uuid, uuid, timestamptz, timestamptz, text, integer, text, text) TO project_admin;


-- Same fold as 20260918041500, applied to account-model-breakdown.
--
-- That endpoint groups by (source, model) and hardcodes `days: 0` — it never
-- had a day dimension in its output — yet it pulled one row per
-- (local day, source, model, pricing_tier) from account_usage_grouped_cached
-- and collapsed the days in Deno. At ~96.5k calls/day that detail was the
-- second-largest remaining source of edge-to-PostgREST egress after summary and
-- heatmap were folded.
--
-- pricing_tier stays in the grouping key because DeepSeek V4 peak/off_peak rows
-- for the same (source, model) price differently; the edge re-splits them and
-- sums the two costs into one model entry, exactly as it did per day.
--
-- Cost is still computed on the edge, where the price table lives. Since
-- getRowPricing depends only on (source, model, pricing_tier) and the cost
-- expression is linear in each token column, pricing the day-folded rows equals
-- pricing each day and summing.

CREATE OR REPLACE FUNCTION public.account_model_breakdown_compact(
  p_user_id uuid,
  p_device_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_tz text,
  p_offset_min integer,
  p_range_from text,
  p_range_to text
) RETURNS jsonb
LANGUAGE sql
VOLATILE
SET search_path TO ''public'', ''pg_temp''
SET statement_timeout TO ''8s''
AS $fn$
  WITH raw AS (
    SELECT public.account_usage_grouped_cached(
      p_user_id, p_device_id, p_from, p_to, ''day'', p_tz, p_offset_min
    ) AS j
  ), g AS (
    SELECT
      e->>''bucket'' AS bucket,
      e->>''source'' AS source,
      e->>''model'' AS model,
      e->>''pricing_tier'' AS pricing_tier,
      COALESCE((e->>''total_tokens'')::bigint, 0) AS total_tokens,
      COALESCE((e->>''input_tokens'')::bigint, 0) AS input_tokens,
      COALESCE((e->>''output_tokens'')::bigint, 0) AS output_tokens,
      COALESCE((e->>''cached_input_tokens'')::bigint, 0) AS cached_input_tokens,
      COALESCE((e->>''cache_creation_input_tokens'')::bigint, 0) AS cache_creation_input_tokens,
      COALESCE((e->>''reasoning_output_tokens'')::bigint, 0) AS reasoning_output_tokens
    FROM raw, jsonb_array_elements(raw.j) e
  ), dims AS (
    SELECT source, model, pricing_tier,
      SUM(total_tokens) AS tt,
      SUM(input_tokens) AS i,
      SUM(output_tokens) AS o,
      SUM(cached_input_tokens) AS cr,
      SUM(cache_creation_input_tokens) AS cw,
      SUM(reasoning_output_tokens) AS rs
    FROM g
    WHERE bucket >= p_range_from AND bucket <= p_range_to
    GROUP BY source, model, pricing_tier
  )
  SELECT COALESCE(
    (SELECT jsonb_agg(jsonb_build_array(source, model, pricing_tier, tt, i, o, cr, cw, rs)
                      ORDER BY source, model, pricing_tier) FROM dims),
    ''[]''::jsonb)
$fn$;

-- Postgres grants EXECUTE to PUBLIC by default; without this an anon caller
-- could pass an arbitrary p_user_id and read another account''s usage.
REVOKE ALL ON FUNCTION public.account_model_breakdown_compact(uuid, uuid, timestamptz, timestamptz, text, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_model_breakdown_compact(uuid, uuid, timestamptz, timestamptz, text, integer, text, text) TO project_admin;


-- Same fold as 20260918041500, applied to account-daily.
--
-- daily is the one endpoint that genuinely needs a per-model dimension: it emits
-- a per-day total_cost_usd, and pricing depends on (source, model,
-- pricing_tier). So the cost dimension cannot collapse the way summary''s and
-- model-breakdown''s could. What it CAN drop is the JSON object keys: the old
-- payload repeated all eleven column names on every one of ~500 rows, which is
-- most of its bytes. Positional arrays plus a day-level rollup take a 30-day
-- window for a heavy account from ~146 KB to ~60 KB (-59%).
--
-- Two sections come back:
--   days:      [day, total, input, output, cache_read, cache_write, reasoning,
--               conversations, {model: tokens}] — one row per active local day,
--               carrying everything the response needs except cost.
--   cost_dims: [day, source, model, pricing_tier, input, output, cache_read,
--               cache_write, reasoning] — still per day, because each day prints
--               its own cost, but with the day''s rows pre-summed per
--               (source, model, tier) and the key names gone.
--
-- Folding before pricing is exact here as elsewhere (computeRowCost is linear in
-- every token column). Checked on 368 (account, day) pairs from 12 real heavy
-- accounts: zero differences, including in the raw JSON number — daily emits
-- total_cost_usd unrounded, so any float drift would have been visible.

CREATE OR REPLACE FUNCTION public.account_daily_compact(
  p_user_id uuid,
  p_device_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_tz text,
  p_offset_min integer,
  p_range_from text,
  p_range_to text
) RETURNS jsonb
LANGUAGE sql
VOLATILE
SET search_path TO ''public'', ''pg_temp''
SET statement_timeout TO ''8s''
AS $fn$
  WITH raw AS (
    SELECT public.account_usage_grouped_cached(
      p_user_id, p_device_id, p_from, p_to, ''day'', p_tz, p_offset_min
    ) AS j
  ), g AS (
    SELECT
      e->>''bucket'' AS bucket,
      e->>''source'' AS source,
      e->>''model'' AS model,
      e->>''pricing_tier'' AS pricing_tier,
      COALESCE(NULLIF(e->>''model'', ''''), ''unknown'') AS model_key,
      COALESCE((e->>''total_tokens'')::bigint, 0) AS total_tokens,
      COALESCE((e->>''input_tokens'')::bigint, 0) AS input_tokens,
      COALESCE((e->>''output_tokens'')::bigint, 0) AS output_tokens,
      COALESCE((e->>''cached_input_tokens'')::bigint, 0) AS cached_input_tokens,
      COALESCE((e->>''cache_creation_input_tokens'')::bigint, 0) AS cache_creation_input_tokens,
      COALESCE((e->>''reasoning_output_tokens'')::bigint, 0) AS reasoning_output_tokens,
      COALESCE((e->>''conversations'')::bigint, 0) AS conversations
    FROM raw, jsonb_array_elements(raw.j) e
    WHERE e->>''bucket'' >= p_range_from AND e->>''bucket'' <= p_range_to
  ), per_day_model AS (
    SELECT bucket, model_key, SUM(total_tokens) AS mt
    FROM g GROUP BY bucket, model_key
  ), models AS (
    SELECT bucket, jsonb_object_agg(model_key, mt) AS mm
    FROM per_day_model GROUP BY bucket
  ), days AS (
    SELECT bucket,
      SUM(total_tokens) AS tt, SUM(input_tokens) AS i, SUM(output_tokens) AS o,
      SUM(cached_input_tokens) AS cr, SUM(cache_creation_input_tokens) AS cw,
      SUM(reasoning_output_tokens) AS rs, SUM(conversations) AS cv
    FROM g GROUP BY bucket
  ), cost AS (
    SELECT bucket, source, model, pricing_tier,
      SUM(input_tokens) AS i, SUM(output_tokens) AS o,
      SUM(cached_input_tokens) AS cr, SUM(cache_creation_input_tokens) AS cw,
      SUM(reasoning_output_tokens) AS rs
    FROM g GROUP BY bucket, source, model, pricing_tier
  )
  SELECT jsonb_build_object(
    ''days'', COALESCE(
      (SELECT jsonb_agg(jsonb_build_array(d.bucket, d.tt, d.i, d.o, d.cr, d.cw, d.rs, d.cv, m.mm)
                        ORDER BY d.bucket)
       FROM days d JOIN models m ON m.bucket = d.bucket),
      ''[]''::jsonb),
    ''cost_dims'', COALESCE(
      (SELECT jsonb_agg(jsonb_build_array(bucket, source, model, pricing_tier, i, o, cr, cw, rs)
                        ORDER BY bucket, source, model, pricing_tier) FROM cost),
      ''[]''::jsonb)
  )
$fn$;

-- Postgres grants EXECUTE to PUBLIC by default; without this an anon caller
-- could pass an arbitrary p_user_id and read another account''s usage.
REVOKE ALL ON FUNCTION public.account_daily_compact(uuid, uuid, timestamptz, timestamptz, text, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_daily_compact(uuid, uuid, timestamptz, timestamptz, text, integer, text, text) TO project_admin;


-- Dictionary encoding changes only the database-to-edge payload. Existing
-- compact RPCs retain their aggregation, cache, timezone and dedup semantics.
-- Token values stay JSONB values, so numeric strings and large integers do not
-- pass through a floating-point conversion. Each row keeps its original order.
-- The edge expands these payloads before its existing pricing/output logic.

CREATE OR REPLACE FUNCTION public.account_heatmap_wire(
  p_user_id uuid,
  p_device_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_tz text,
  p_offset_min integer,
  p_range_from text,
  p_range_to text
) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path TO ''public'', ''pg_temp''
SET statement_timeout TO ''8s''
AS $fn$

  WITH raw AS MATERIALIZED (SELECT public.account_heatmap_compact(p_user_id, p_device_id, p_from, p_to, p_tz, p_offset_min, p_range_from, p_range_to) AS j),
  days AS (
    SELECT value AS row, ordinality AS day_ord
    FROM raw, jsonb_array_elements(raw.j) WITH ORDINALITY
  ), names AS (
    SELECT DISTINCT to_jsonb(key) AS name
    FROM days, jsonb_each(COALESCE(NULLIF(row->2, ''null''::jsonb), ''{}''::jsonb))
  ), dictionary AS (
    SELECT name, row_number() OVER (ORDER BY name) - 1 AS idx FROM names
  ), packed_days AS (
    SELECT day_ord, jsonb_build_array(row->0, row->1,
      CASE WHEN row->2 = ''null''::jsonb THEN ''null''::jsonb ELSE COALESCE((
        SELECT jsonb_agg(v ORDER BY model_ord, part)
        FROM jsonb_each(row->2) WITH ORDINALITY AS m(name, tokens, model_ord)
        JOIN dictionary d ON d.name = to_jsonb(m.name)
        CROSS JOIN LATERAL (VALUES (0, to_jsonb(d.idx)), (1, m.tokens)) AS pairs(part, v)
      ), ''[]''::jsonb) END
    ) AS row FROM days
  )
  SELECT jsonb_build_object(
    ''model_names'', COALESCE((SELECT jsonb_agg(name ORDER BY idx) FROM dictionary), ''[]''::jsonb),
    ''days'', COALESCE((SELECT jsonb_agg(row ORDER BY day_ord) FROM packed_days), ''[]''::jsonb)
  )
$fn$;

CREATE OR REPLACE FUNCTION public.account_daily_wire(
  p_user_id uuid,
  p_device_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_tz text,
  p_offset_min integer,
  p_range_from text,
  p_range_to text
) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path TO ''public'', ''pg_temp''
SET statement_timeout TO ''8s''
AS $fn$

  WITH raw AS MATERIALIZED (SELECT public.account_daily_compact(p_user_id, p_device_id, p_from, p_to, p_tz, p_offset_min, p_range_from, p_range_to) AS j),
  days AS (
    SELECT value AS row, ordinality AS day_ord
    FROM raw, jsonb_array_elements(raw.j->''days'') WITH ORDINALITY
  ), cost AS (
    SELECT value AS row, ordinality AS cost_ord
    FROM raw, jsonb_array_elements(raw.j->''cost_dims'') WITH ORDINALITY
  ), model_names AS (
    SELECT to_jsonb(key) AS name
    FROM days, jsonb_each(COALESCE(NULLIF(row->8, ''null''::jsonb), ''{}''::jsonb))
    UNION SELECT row->2 FROM cost
  ), models AS (
    SELECT name, row_number() OVER (ORDER BY name) - 1 AS idx FROM model_names
  ), sources AS (
    SELECT name, row_number() OVER (ORDER BY name) - 1 AS idx
    FROM (SELECT DISTINCT row->1 AS name FROM cost) names
  ), tiers AS (
    SELECT name, row_number() OVER (ORDER BY name) - 1 AS idx
    FROM (SELECT DISTINCT row->3 AS name FROM cost) names
  ), packed_days AS (
    SELECT day_ord, jsonb_build_array(
      row->0, row->1, row->2, row->3, row->4, row->5, row->6, row->7,
      CASE WHEN row->8 = ''null''::jsonb THEN ''null''::jsonb ELSE COALESCE((
        SELECT jsonb_agg(v ORDER BY model_ord, part)
        FROM jsonb_each(row->8) WITH ORDINALITY AS m(name, tokens, model_ord)
        JOIN models d ON d.name = to_jsonb(m.name)
        CROSS JOIN LATERAL (VALUES (0, to_jsonb(d.idx)), (1, m.tokens)) AS pairs(part, v)
      ), ''[]''::jsonb) END
    ) AS row FROM days
  ), packed_cost AS (
    SELECT cost_ord, jsonb_build_array(
      row->0, s.idx, m.idx, t.idx, row->4, row->5, row->6, row->7, row->8
    ) AS row FROM cost
    JOIN sources s ON s.name = row->1
    JOIN models m ON m.name = row->2
    JOIN tiers t ON t.name = row->3
  )
  SELECT jsonb_build_object(
    ''model_names'', COALESCE((SELECT jsonb_agg(name ORDER BY idx) FROM models), ''[]''::jsonb),
    ''source_names'', COALESCE((SELECT jsonb_agg(name ORDER BY idx) FROM sources), ''[]''::jsonb),
    ''pricing_tiers'', COALESCE((SELECT jsonb_agg(name ORDER BY idx) FROM tiers), ''[]''::jsonb),
    ''days'', COALESCE((SELECT jsonb_agg(row ORDER BY day_ord) FROM packed_days), ''[]''::jsonb),
    ''cost_dims'', COALESCE((SELECT jsonb_agg(row ORDER BY cost_ord) FROM packed_cost), ''[]''::jsonb)
  )
$fn$;

-- Match the existing account RPCs: only the edge''s project_admin role can read
-- another user''s account data. Do not change any existing RPC permissions.
REVOKE EXECUTE ON FUNCTION public.account_heatmap_wire(uuid, uuid, timestamptz, timestamptz, text, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_heatmap_wire(uuid, uuid, timestamptz, timestamptz, text, integer, text, text) TO project_admin;
REVOKE EXECUTE ON FUNCTION public.account_daily_wire(uuid, uuid, timestamptz, timestamptz, text, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_daily_wire(uuid, uuid, timestamptz, timestamptz, text, integer, text, text) TO project_admin;


-- Expand dictionary/positional rows at the edge before existing pricing and
-- output logic. Delegate to legacy aggregation once, preserving device scope,
-- shared cache and timezone semantics. JSONB token values retain their types.
-- Trim only numeric trailing zeros; fall back to legacy payloads when smaller.

CREATE OR REPLACE FUNCTION public.account_summary_wire(
  p_user_id uuid,
  p_device_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_tz text,
  p_offset_min integer,
  p_range_from text,
  p_range_to text
) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path TO ''public'', ''pg_temp''
SET statement_timeout TO ''8s''
AS $fn$

  WITH raw AS MATERIALIZED (SELECT public.account_summary_compact(p_user_id, p_device_id, p_from, p_to, p_tz, p_offset_min, p_range_from, p_range_to) AS j),
  dims AS (
    SELECT value AS row, ordinality AS ord
    FROM raw, jsonb_array_elements(raw.j->''cost_dims'') WITH ORDINALITY
  ), sources AS (
    SELECT name, row_number() OVER (ORDER BY name) - 1 AS idx
    FROM (SELECT DISTINCT row->0 AS name FROM dims) names
  ), models AS (
    SELECT name, row_number() OVER (ORDER BY name) - 1 AS idx
    FROM (SELECT DISTINCT row->1 AS name FROM dims) names
  ), tiers AS (
    SELECT name, row_number() OVER (ORDER BY name) - 1 AS idx
    FROM (SELECT DISTINCT row->2 AS name FROM dims) names
  ), indexed AS (
    SELECT ord, jsonb_build_array(s.idx, m.idx, t.idx, row->3, row->4, row->5, row->6, row->7) AS row
    FROM dims
    JOIN sources s ON s.name = row->0
    JOIN models m ON m.name = row->1
    JOIN tiers t ON t.name = row->2
  ), packed_dims AS (
    SELECT ord, (
      SELECT jsonb_agg(value ORDER BY token_ord)
      FROM jsonb_array_elements(row) WITH ORDINALITY AS tokens(value, token_ord)
      WHERE token_ord <= GREATEST(3, COALESCE((
        SELECT MAX(last_ord)
        FROM jsonb_array_elements(row) WITH ORDINALITY AS last_value(value, last_ord)
        WHERE last_value.value <> ''0''::jsonb
      ), 3))
    ) AS row FROM indexed
  ), days AS (
    SELECT value AS row, ordinality AS ord
    FROM raw, jsonb_array_elements(raw.j->''day_rollup'') WITH ORDINALITY
  ), day_start AS (
    SELECT MIN(row->>0) AS day FROM days
  ), packed_days AS (
    SELECT ord, jsonb_build_array((row->>0)::date - day::date, row->1, row->2) AS row
    FROM days CROSS JOIN day_start
  ), candidate AS (
    SELECT jsonb_build_object(
      ''source_names'', COALESCE((SELECT jsonb_agg(name ORDER BY idx) FROM sources), ''[]''::jsonb),
      ''model_names'', COALESCE((SELECT jsonb_agg(name ORDER BY idx) FROM models), ''[]''::jsonb),
      ''pricing_tiers'', COALESCE((SELECT jsonb_agg(name ORDER BY idx) FROM tiers), ''[]''::jsonb),
      ''cost_dims'', COALESCE((SELECT jsonb_agg(row ORDER BY ord) FROM packed_dims), ''[]''::jsonb),
      ''day_start'', (SELECT day FROM day_start),
      ''day_rollup'', COALESCE((SELECT jsonb_agg(row ORDER BY ord) FROM packed_days), ''[]''::jsonb),
      ''range_totals'', jsonb_build_array(raw.j->''range_totals''->''total_tokens'', raw.j->''range_totals''->''input_tokens'', raw.j->''range_totals''->''output_tokens'', raw.j->''range_totals''->''cached_input_tokens'', raw.j->''range_totals''->''cache_creation_input_tokens'', raw.j->''range_totals''->''reasoning_output_tokens'', raw.j->''range_totals''->''conversation_count'', raw.j->''range_totals''->''active_days'')
    ) AS wire FROM raw
  )
  SELECT CASE WHEN octet_length(wire::text) < octet_length(raw.j::text)
    THEN wire ELSE raw.j END
  FROM candidate CROSS JOIN raw
$fn$;

CREATE OR REPLACE FUNCTION public.account_model_breakdown_wire(
  p_user_id uuid,
  p_device_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_tz text,
  p_offset_min integer,
  p_range_from text,
  p_range_to text
) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path TO ''public'', ''pg_temp''
SET statement_timeout TO ''8s''
AS $fn$

  WITH raw AS MATERIALIZED (SELECT public.account_model_breakdown_compact(p_user_id, p_device_id, p_from, p_to, p_tz, p_offset_min, p_range_from, p_range_to) AS j),
  dims AS (
    SELECT value AS row, ordinality AS ord
    FROM raw, jsonb_array_elements(raw.j) WITH ORDINALITY
  ), sources AS (
    SELECT name, row_number() OVER (ORDER BY name) - 1 AS idx
    FROM (SELECT DISTINCT row->0 AS name FROM dims) names
  ), models AS (
    SELECT name, row_number() OVER (ORDER BY name) - 1 AS idx
    FROM (SELECT DISTINCT row->1 AS name FROM dims) names
  ), tiers AS (
    SELECT name, row_number() OVER (ORDER BY name) - 1 AS idx
    FROM (SELECT DISTINCT row->2 AS name FROM dims) names
  ), indexed AS (
    SELECT ord, jsonb_build_array(s.idx, m.idx, t.idx, row->3, row->4, row->5, row->6, row->7, row->8) AS row
    FROM dims
    JOIN sources s ON s.name = row->0
    JOIN models m ON m.name = row->1
    JOIN tiers t ON t.name = row->2
  ), packed_dims AS (
    SELECT ord, (
      SELECT jsonb_agg(value ORDER BY token_ord)
      FROM jsonb_array_elements(row) WITH ORDINALITY AS tokens(value, token_ord)
      WHERE token_ord <= GREATEST(3, COALESCE((
        SELECT MAX(last_ord)
        FROM jsonb_array_elements(row) WITH ORDINALITY AS last_value(value, last_ord)
        WHERE last_value.value <> ''0''::jsonb
      ), 3))
    ) AS row FROM indexed
  ), candidate AS (
    SELECT jsonb_build_object(
      ''source_names'', COALESCE((SELECT jsonb_agg(name ORDER BY idx) FROM sources), ''[]''::jsonb),
      ''model_names'', COALESCE((SELECT jsonb_agg(name ORDER BY idx) FROM models), ''[]''::jsonb),
      ''pricing_tiers'', COALESCE((SELECT jsonb_agg(name ORDER BY idx) FROM tiers), ''[]''::jsonb),
      ''dims'', COALESCE((SELECT jsonb_agg(row ORDER BY ord) FROM packed_dims), ''[]''::jsonb)
    ) AS wire FROM raw
  )
  SELECT CASE WHEN octet_length(wire::text) < octet_length(raw.j::text)
    THEN wire ELSE raw.j END
  FROM candidate CROSS JOIN raw
$fn$;

REVOKE EXECUTE ON FUNCTION public.account_summary_wire(uuid, uuid, timestamptz, timestamptz, text, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_summary_wire(uuid, uuid, timestamptz, timestamptz, text, integer, text, text) TO project_admin;
REVOKE EXECUTE ON FUNCTION public.account_model_breakdown_wire(uuid, uuid, timestamptz, timestamptz, text, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_model_breakdown_wire(uuid, uuid, timestamptz, timestamptz, text, integer, text, text) TO project_admin;


-- Only the private installer owns these aggregation functions and their bootstrap grants.
REVOKE ALL ON FUNCTION public.account_usage_grouped(uuid,uuid[],timestamptz,timestamptz,text,text,integer),
  public.account_usage_grouped_v2(uuid,uuid,timestamptz,timestamptz,text,text,integer),
  public.account_usage_grouped_cached(uuid,uuid,timestamptz,timestamptz,text,text,integer),
  public.refresh_tokentracker_device_identity(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.account_usage_grouped(uuid,uuid[],timestamptz,timestamptz,text,text,integer),
  public.account_usage_grouped_v2(uuid,uuid,timestamptz,timestamptz,text,text,integer),
  public.account_usage_grouped_cached(uuid,uuid,timestamptz,timestamptz,text,text,integer),
  public.refresh_tokentracker_device_identity(uuid,uuid,text,text) TO project_admin;';
        INSERT INTO public.tokentracker_self_host_installations(step,checksum) VALUES ('04-private-aggregation','b95a322e4c8f1a2afd038e6f3658cc9236349b8200502bd48d07d79f68204c02');
      END IF;
    END $install$;

DO $install$ DECLARE v_checksum text; BEGIN
      SELECT checksum INTO v_checksum FROM public.tokentracker_self_host_installations WHERE step = '20261003120000_cloud-subscriptions';
      IF FOUND AND v_checksum <> 'd7ccbed0b936d8ff517a7932799770c944e6942cadb0c949b745ded799c19937' THEN RAISE EXCEPTION 'Installed step has changed: %','20261003120000_cloud-subscriptions'; END IF;
      IF NOT FOUND THEN
        EXECUTE '-- Payment state is written only by verified, server-side provider handlers.
-- Applying this migration does not activate production charging or limits.
CREATE TABLE public.tokentracker_cloud_catalog (
  sku text PRIMARY KEY,
  currency text NOT NULL CHECK (currency IN (''CNY'', ''USD'')),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  term_months integer NOT NULL CHECK (term_months IN (1, 12))
);
INSERT INTO public.tokentracker_cloud_catalog VALUES
  (''cloud_cny_monthly'', ''CNY'', 2900, 1),
  (''cloud_cny_yearly'', ''CNY'', 24900, 12),
  (''cloud_usd_monthly'', ''USD'', 599, 1),
  (''cloud_usd_yearly'', ''USD'', 4900, 12);

CREATE TABLE public.tokentracker_cloud_policy (
  environment text PRIMARY KEY CHECK (environment IN (''sandbox'', ''live'')),
  phase text NOT NULL DEFAULT ''preview'' CHECK (phase IN (''preview'', ''active'')),
  launch_at timestamptz,
  CHECK (phase = ''preview'' OR launch_at IS NOT NULL)
);
INSERT INTO public.tokentracker_cloud_policy (environment) VALUES (''sandbox''), (''live'');

CREATE TABLE public.tokentracker_cloud_accounts (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  environment text NOT NULL REFERENCES public.tokentracker_cloud_policy(environment),
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  PRIMARY KEY (user_id, environment),
  CHECK ((trial_started_at IS NULL AND trial_ends_at IS NULL) OR
    (trial_started_at IS NOT NULL AND trial_ends_at > trial_started_at))
);

CREATE TABLE public.tokentracker_cloud_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  environment text NOT NULL REFERENCES public.tokentracker_cloud_policy(environment),
  request_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN (''paddle'', ''wechat'', ''alipay'')),
  sku text NOT NULL REFERENCES public.tokentracker_cloud_catalog(sku),
  currency text NOT NULL CHECK (currency IN (''CNY'', ''USD'')),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  term_months integer NOT NULL CHECK (term_months IN (1, 12)),
  status text NOT NULL DEFAULT ''pending'' CHECK (status IN (''pending'', ''ready'', ''paid'', ''closed'')),
  provider_order_id text,
  provider_price_id text,
  checkout_url text,
  checkout_attempts integer NOT NULL DEFAULT 0 CHECK (checkout_attempts >= 0),
  checkout_claimed_at timestamptz,
  last_reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval ''30 minutes'',
  UNIQUE (user_id, environment, request_id),
  UNIQUE (provider, environment, provider_order_id),
  CHECK ((provider = ''paddle'' AND currency = ''USD'') OR
    (provider IN (''wechat'', ''alipay'') AND currency = ''CNY''))
);
CREATE INDEX tokentracker_cloud_orders_user_created_idx
  ON public.tokentracker_cloud_orders (user_id, environment, created_at DESC);

CREATE TABLE public.tokentracker_cloud_subscriptions (
  provider text NOT NULL CHECK (provider = ''paddle''),
  environment text NOT NULL REFERENCES public.tokentracker_cloud_policy(environment),
  provider_subscription_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES public.tokentracker_cloud_orders(id),
  status text NOT NULL CHECK (status IN (''active'', ''canceled'', ''past_due'', ''paused'', ''trialing'')),
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  last_event_at timestamptz NOT NULL,
  next_billed_at timestamptz,
  PRIMARY KEY (provider, environment, provider_subscription_id)
);
CREATE INDEX tokentracker_cloud_subscriptions_user_idx
  ON public.tokentracker_cloud_subscriptions (user_id, environment);

CREATE TABLE public.tokentracker_cloud_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.tokentracker_cloud_orders(id),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider IN (''paddle'', ''wechat'', ''alipay'')),
  environment text NOT NULL REFERENCES public.tokentracker_cloud_policy(environment),
  transaction_id text NOT NULL,
  subscription_id text,
  currency text NOT NULL CHECK (currency IN (''CNY'', ''USD'')),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  refunded_cents integer NOT NULL DEFAULT 0,
  revoked_at timestamptz,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  paid_at timestamptz NOT NULL,
  UNIQUE (provider, environment, transaction_id),
  CHECK (refunded_cents BETWEEN 0 AND amount_cents),
  CHECK (ends_at > starts_at)
);
CREATE INDEX tokentracker_cloud_payments_user_period_idx
  ON public.tokentracker_cloud_payments (user_id, environment, ends_at);

CREATE TABLE public.tokentracker_cloud_events (
  provider text NOT NULL CHECK (provider IN (''paddle'', ''wechat'', ''alipay'')),
  environment text NOT NULL REFERENCES public.tokentracker_cloud_policy(environment),
  event_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN (''payment'', ''refund'', ''subscription'')),
  action_id text NOT NULL,
  order_id uuid NOT NULL REFERENCES public.tokentracker_cloud_orders(id),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  normalized_event jsonb NOT NULL,
  status text NOT NULL DEFAULT ''pending'' CHECK (status IN (''pending'', ''applied'', ''duplicate'', ''outdated'')),
  PRIMARY KEY (provider, environment, event_id)
);
CREATE UNIQUE INDEX tokentracker_cloud_events_applied_action_idx
  ON public.tokentracker_cloud_events (provider, environment, kind, action_id)
  WHERE status = ''applied'' AND kind IN (''payment'', ''refund'');

ALTER TABLE public.tokentracker_cloud_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tokentracker_cloud_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tokentracker_cloud_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tokentracker_cloud_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tokentracker_cloud_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tokentracker_cloud_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tokentracker_cloud_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.tokentracker_cloud_catalog, public.tokentracker_cloud_policy,
  public.tokentracker_cloud_accounts, public.tokentracker_cloud_orders,
  public.tokentracker_cloud_subscriptions, public.tokentracker_cloud_payments,
  public.tokentracker_cloud_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.tokentracker_cloud_catalog, public.tokentracker_cloud_policy,
  public.tokentracker_cloud_accounts, public.tokentracker_cloud_orders,
  public.tokentracker_cloud_subscriptions, public.tokentracker_cloud_payments,
  public.tokentracker_cloud_events TO project_admin;
-- The billing API serves the catalog. Direct client reads would disclose
-- unpublished pricing while the hosted sandbox is being accepted.
GRANT SELECT ON public.tokentracker_cloud_accounts, public.tokentracker_cloud_orders,
  public.tokentracker_cloud_subscriptions, public.tokentracker_cloud_payments TO authenticated;
CREATE POLICY cloud_accounts_owner_read ON public.tokentracker_cloud_accounts
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY cloud_orders_owner_read ON public.tokentracker_cloud_orders
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY cloud_subscriptions_owner_read ON public.tokentracker_cloud_subscriptions
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY cloud_payments_owner_read ON public.tokentracker_cloud_payments
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.cloud_membership(
  p_user_id uuid, p_environment text
) RETURNS jsonb LANGUAGE plpgsql STABLE
SET search_path = public, pg_temp AS $fn$
DECLARE
  v_now timestamptz := statement_timestamp();
  v_policy public.tokentracker_cloud_policy%ROWTYPE;
  v_trial timestamptz;
  v_transition timestamptz;
  v_end timestamptz;
  v_history_end timestamptz;
  v_paid boolean := false;
  v_status text;
  v_period record;
BEGIN
  SELECT * INTO STRICT v_policy FROM public.tokentracker_cloud_policy
    WHERE environment = p_environment;
  SELECT trial_ends_at INTO v_trial FROM public.tokentracker_cloud_accounts
    WHERE user_id = p_user_id AND environment = p_environment;
  IF v_policy.launch_at IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tokentracker_devices
    WHERE user_id = p_user_id AND created_at < v_policy.launch_at
  ) THEN
    v_transition := v_policy.launch_at + interval ''30 days'';
  END IF;
  SELECT max(CASE WHEN refunded_cents = amount_cents THEN least(ends_at, revoked_at)
    ELSE ends_at END) INTO v_history_end FROM public.tokentracker_cloud_payments
    WHERE user_id = p_user_id AND environment = p_environment;
  v_history_end := greatest(v_history_end, v_trial, v_transition);
  v_end := greatest(v_now, v_trial, v_transition);
  -- Merge contiguous paid intervals. A refunded middle term cannot bridge a gap.
  FOR v_period IN SELECT starts_at, ends_at FROM public.tokentracker_cloud_payments
    WHERE user_id = p_user_id AND environment = p_environment
      AND refunded_cents < amount_cents AND ends_at > v_now
    ORDER BY starts_at, ends_at
  LOOP
    IF v_period.starts_at <= v_end THEN
      v_end := greatest(v_end, v_period.ends_at);
      IF v_period.starts_at <= v_now THEN v_paid := true; END IF;
    END IF;
  END LOOP;
  v_status := CASE
    WHEN v_policy.phase = ''preview'' THEN ''legacy_free''
    WHEN v_paid THEN ''active''
    WHEN v_trial > v_now THEN ''trial''
    WHEN v_transition > v_now THEN ''transition''
    WHEN v_history_end IS NOT NULL THEN ''expired''
    ELSE ''free'' END;
  RETURN jsonb_build_object(
    ''environment'', p_environment, ''phase'', v_policy.phase, ''status'', v_status,
    ''expires_at'', CASE WHEN v_end > v_now THEN v_end ELSE NULL END,
    ''trial_ends_at'', v_trial, ''trial_available'', v_trial IS NULL AND NOT EXISTS (
      SELECT 1 FROM public.tokentracker_cloud_payments
      WHERE user_id = p_user_id AND environment = p_environment),
    ''transition_ends_at'', v_transition,
    ''read_only_until'', v_history_end + interval ''30 days'',
    ''can_read_cloud'', v_status IN (''legacy_free'', ''active'', ''trial'', ''transition'')
      OR (v_status = ''expired'' AND v_history_end + interval ''30 days'' > v_now),
    ''can_upload_cloud'', v_status IN (''legacy_free'', ''active'', ''trial'', ''transition''),
    ''machine_limit'', CASE WHEN v_status = ''legacy_free'' THEN NULL
      WHEN v_status IN (''active'', ''trial'', ''transition'') THEN 5 ELSE 1 END,
    ''sync_interval_seconds'', CASE WHEN v_status IN (''legacy_free'', ''active'', ''trial'', ''transition'')
      THEN 900 ELSE 86400 END,
    ''hourly_history_days'', 90, ''daily_history_months'', 24
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.cloud_start_trial(p_user_id uuid, p_environment text)
RETURNS jsonb LANGUAGE plpgsql
SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || '':'' || p_environment, 0));
  IF NOT EXISTS (SELECT 1 FROM public.tokentracker_cloud_policy
    WHERE environment = p_environment AND phase = ''active'' AND launch_at <= clock_timestamp()) THEN
    RAISE EXCEPTION ''trial has not launched'';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_payments
    WHERE user_id = p_user_id AND environment = p_environment) THEN
    RAISE EXCEPTION ''trial is only available before the first purchase'';
  END IF;
  INSERT INTO public.tokentracker_cloud_accounts (user_id, environment, trial_started_at, trial_ends_at)
    VALUES (p_user_id, p_environment, clock_timestamp(), clock_timestamp() + interval ''7 days'')
    ON CONFLICT (user_id, environment) DO UPDATE
      SET trial_started_at = excluded.trial_started_at, trial_ends_at = excluded.trial_ends_at
      WHERE tokentracker_cloud_accounts.trial_started_at IS NULL;
  RETURN public.cloud_membership(p_user_id, p_environment);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.cloud_create_order(
  p_user_id uuid, p_environment text, p_provider text, p_sku text, p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql
SET search_path = public, pg_temp AS $fn$
DECLARE
  v_catalog public.tokentracker_cloud_catalog%ROWTYPE;
  v_order public.tokentracker_cloud_orders%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || '':'' || p_environment, 0));
  SELECT * INTO v_order FROM public.tokentracker_cloud_orders
    WHERE user_id = p_user_id AND environment = p_environment AND request_id = p_request_id;
  IF FOUND THEN
    IF v_order.provider <> p_provider OR v_order.sku <> p_sku THEN
      RAISE EXCEPTION ''idempotency request belongs to a different purchase'';
    END IF;
    RETURN to_jsonb(v_order);
  END IF;
  SELECT * INTO STRICT v_catalog FROM public.tokentracker_cloud_catalog WHERE sku = p_sku;
  IF (p_provider = ''paddle'' AND v_catalog.currency <> ''USD'') OR
     (p_provider IN (''wechat'', ''alipay'') AND v_catalog.currency <> ''CNY'') THEN
    RAISE EXCEPTION ''payment provider does not support this currency'';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_subscriptions
    WHERE user_id = p_user_id AND environment = p_environment
      AND status IN (''active'', ''trialing'', ''past_due'', ''paused'') AND NOT cancel_at_period_end) THEN
    RAISE EXCEPTION ''manage the existing subscription before purchasing another plan'';
  END IF;
  IF p_provider = ''paddle'' AND EXISTS (SELECT 1 FROM public.tokentracker_cloud_payments
    WHERE user_id = p_user_id AND environment = p_environment
      AND refunded_cents < amount_cents AND ends_at > clock_timestamp()) THEN
    RAISE EXCEPTION ''the current fixed membership term must end before starting a subscription'';
  END IF;
  INSERT INTO public.tokentracker_cloud_orders
    (user_id, environment, request_id, provider, sku, currency, amount_cents, term_months)
    VALUES (p_user_id, p_environment, p_request_id, p_provider, p_sku,
      v_catalog.currency, v_catalog.amount_cents, v_catalog.term_months)
    RETURNING * INTO v_order;
  RETURN to_jsonb(v_order);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.cloud_claim_checkout(p_user_id uuid, p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql
SET search_path = public, pg_temp AS $fn$
DECLARE v_order public.tokentracker_cloud_orders%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_order FROM public.tokentracker_cloud_orders
    WHERE id = p_order_id AND user_id = p_user_id FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_order.user_id::text || '':'' || v_order.environment,0));
  IF v_order.checkout_url IS NOT NULL OR v_order.checkout_attempts > 0 OR
    v_order.status <> ''pending'' OR v_order.expires_at <= clock_timestamp() THEN
    RETURN jsonb_build_object(''claimed'', false, ''order'', to_jsonb(v_order));
  END IF;
  IF v_order.provider=''paddle'' AND EXISTS (SELECT 1 FROM public.tokentracker_cloud_orders
    WHERE user_id=p_user_id AND environment=v_order.environment AND provider=''paddle'' AND id<>v_order.id
      AND status IN (''pending'',''ready'') AND checkout_attempts>0) THEN
    RAISE EXCEPTION ''an existing checkout must be confirmed before another subscription'';
  END IF;
  UPDATE public.tokentracker_cloud_orders
    SET checkout_attempts = checkout_attempts + 1, checkout_claimed_at = clock_timestamp()
    WHERE id = p_order_id RETURNING * INTO v_order;
  -- Ambiguous provider failures are reconciled, never retried as a new charge.
  RETURN jsonb_build_object(''claimed'', true, ''order'', to_jsonb(v_order));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.cloud_close_unpaid_order(p_user_id uuid,p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql
SET search_path=public,pg_temp AS $fn$
DECLARE v_order public.tokentracker_cloud_orders%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_order FROM public.tokentracker_cloud_orders WHERE id=p_order_id AND user_id=p_user_id FOR UPDATE;
  IF v_order.status IN (''pending'',''ready'') THEN
    UPDATE public.tokentracker_cloud_orders SET status=''closed'' WHERE id=p_order_id RETURNING * INTO v_order;
  END IF;
  RETURN to_jsonb(v_order);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.cloud_attach_checkout(
  p_user_id uuid, p_order_id uuid, p_provider_order_id text,
  p_provider_price_id text, p_checkout_url text
) RETURNS jsonb LANGUAGE plpgsql
SET search_path = public, pg_temp AS $fn$
DECLARE v_order public.tokentracker_cloud_orders%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_order FROM public.tokentracker_cloud_orders
    WHERE id = p_order_id AND user_id = p_user_id FOR UPDATE;
  IF (v_order.provider_order_id IS NOT NULL AND p_provider_order_id IS NOT NULL
    AND v_order.provider_order_id <> p_provider_order_id) OR
    (v_order.provider_price_id IS NOT NULL AND p_provider_price_id IS NOT NULL
    AND v_order.provider_price_id <> p_provider_price_id) THEN
    RAISE EXCEPTION ''checkout is already bound to a different provider transaction or price'';
  END IF;
  UPDATE public.tokentracker_cloud_orders
    SET provider_order_id = coalesce(provider_order_id, p_provider_order_id),
      provider_price_id = coalesce(provider_price_id, p_provider_price_id),
      checkout_url = coalesce(p_checkout_url, checkout_url),
      status = CASE WHEN status = ''pending'' AND p_checkout_url IS NOT NULL THEN ''ready'' ELSE status END
    WHERE id = p_order_id RETURNING * INTO v_order;
  RETURN to_jsonb(v_order);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.cloud_claim_reconciliation(p_user_id uuid,p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql
SET search_path = public,pg_temp AS $fn$
DECLARE v_order public.tokentracker_cloud_orders%ROWTYPE; v_now timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO STRICT v_order FROM public.tokentracker_cloud_orders
    WHERE id=p_order_id AND user_id=p_user_id FOR UPDATE;
  IF v_order.last_reconciled_at IS NOT NULL AND v_order.last_reconciled_at > v_now-interval ''30 seconds'' THEN
    RETURN jsonb_build_object(''claimed'',false,''retry_after'',
      greatest(1,ceil(extract(epoch FROM v_order.last_reconciled_at+interval ''30 seconds''-v_now))::integer));
  END IF;
  UPDATE public.tokentracker_cloud_orders SET last_reconciled_at=v_now WHERE id=p_order_id;
  RETURN jsonb_build_object(''claimed'',true);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.cloud_apply_event(
  p_provider text, p_environment text, p_event jsonb
) RETURNS jsonb LANGUAGE plpgsql
SET search_path = public, pg_temp AS $fn$
DECLARE
  v_order public.tokentracker_cloud_orders%ROWTYPE;
  v_payment public.tokentracker_cloud_payments%ROWTYPE;
  v_subscription public.tokentracker_cloud_subscriptions%ROWTYPE;
  v_event_id text := p_event->>''event_id'';
  v_kind text := p_event->>''kind'';
  v_action_id text := p_event->>''action_id'';
  v_occurred timestamptz := (p_event->>''occurred_at'')::timestamptz;
  v_start timestamptz;
  v_end timestamptz;
  v_subscription_id text := nullif(p_event->>''subscription_id'', '''');
  v_status text := ''applied'';
  v_amount integer;
  v_refund_total integer;
BEGIN
  IF v_event_id IS NULL OR v_event_id = '''' OR length(v_event_id) > 200 OR
    v_action_id IS NULL OR v_action_id = '''' OR length(v_action_id) > 200 OR
    v_kind NOT IN (''payment'', ''refund'', ''subscription'') OR v_kind IS NULL OR
    v_occurred IS NULL OR v_occurred > clock_timestamp() + interval ''5 minutes'' THEN
    RAISE EXCEPTION ''invalid normalized payment event'';
  END IF;
  SELECT * INTO STRICT v_order FROM public.tokentracker_cloud_orders
    WHERE id = (p_event->>''order_id'')::uuid FOR UPDATE;
  -- Also serialize separate orders which extend the same account''s paid term.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_order.user_id::text || '':'' || p_environment, 0));
  IF v_order.provider <> p_provider OR v_order.environment <> p_environment THEN
    RAISE EXCEPTION ''payment event does not match the order provider or environment'';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_events
    WHERE provider = p_provider AND environment = p_environment AND event_id = v_event_id) THEN
    IF NOT EXISTS (SELECT 1 FROM public.tokentracker_cloud_events
      WHERE provider = p_provider AND environment = p_environment AND event_id = v_event_id
        AND normalized_event = p_event AND order_id = v_order.id) THEN
      RAISE EXCEPTION ''event identifier was already used for different payment data'';
    END IF;
    RETURN jsonb_build_object(''applied'', false, ''duplicate'', true);
  END IF;
  INSERT INTO public.tokentracker_cloud_events
    (provider, environment, event_id, kind, action_id, order_id, occurred_at, normalized_event)
    VALUES (p_provider, p_environment, v_event_id, v_kind, v_action_id, v_order.id, v_occurred, p_event);
  IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_events
    WHERE provider = p_provider AND environment = p_environment AND kind = v_kind
      AND action_id = v_action_id AND status = ''applied'' AND kind IN (''payment'', ''refund'')) THEN
    IF NOT EXISTS (SELECT 1 FROM public.tokentracker_cloud_events
      WHERE provider = p_provider AND environment = p_environment AND kind = v_kind
        AND action_id = v_action_id AND status = ''applied'' AND order_id = v_order.id
        AND normalized_event - ARRAY[''event_id'',''occurred_at''] = p_event - ARRAY[''event_id'',''occurred_at'']) THEN
      RAISE EXCEPTION ''payment action was already applied to different payment data'';
    END IF;
    v_status := ''duplicate'';
  ELSIF v_kind = ''payment'' THEN
    IF p_event->>''currency'' IS DISTINCT FROM v_order.currency OR
      (p_event->>''base_amount_cents'')::integer IS DISTINCT FROM v_order.amount_cents THEN
      RAISE EXCEPTION ''payment amount or currency does not match the order'';
    END IF;
    v_amount := (p_event->>''amount_cents'')::integer;
    IF v_amount IS NULL OR v_amount < v_order.amount_cents OR
      (p_provider <> ''paddle'' AND v_amount <> v_order.amount_cents) THEN
      RAISE EXCEPTION ''invalid paid amount'';
    END IF;
    IF p_provider = ''paddle'' THEN
      IF v_order.provider_order_id IS NOT NULL AND v_order.provider_order_id <> v_action_id
        AND (v_subscription_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM public.tokentracker_cloud_subscriptions
          WHERE provider = p_provider AND environment = p_environment
            AND provider_subscription_id = v_subscription_id
            AND user_id = v_order.user_id AND order_id = v_order.id
        )) THEN RAISE EXCEPTION ''unrecognized subscription renewal''; END IF;
      v_start := (p_event->>''starts_at'')::timestamptz;
      v_end := (p_event->>''ends_at'')::timestamptz;
      IF v_subscription_id IS NULL OR v_start IS NULL OR v_end IS NULL OR
        v_end <= v_start OR v_end > v_start + make_interval(months => v_order.term_months) + interval ''1 day'' OR
        v_end < v_start + make_interval(months => v_order.term_months) - interval ''1 day'' THEN
        RAISE EXCEPTION ''invalid subscription billing period'';
      END IF;
      SELECT * INTO v_subscription FROM public.tokentracker_cloud_subscriptions
        WHERE provider = p_provider AND environment = p_environment
          AND provider_subscription_id = v_subscription_id FOR UPDATE;
      IF FOUND AND (v_subscription.user_id <> v_order.user_id OR v_subscription.order_id <> v_order.id) THEN
        RAISE EXCEPTION ''subscription belongs to a different account or order'';
      END IF;
      INSERT INTO public.tokentracker_cloud_subscriptions
        (provider, environment, provider_subscription_id, user_id, order_id, status, last_event_at,next_billed_at)
        VALUES (p_provider, p_environment, v_subscription_id, v_order.user_id, v_order.id, ''active'', v_occurred,v_end)
        ON CONFLICT (provider, environment, provider_subscription_id) DO UPDATE SET
          next_billed_at=CASE WHEN tokentracker_cloud_subscriptions.status IN (''active'',''trialing'',''past_due'')
            AND NOT tokentracker_cloud_subscriptions.cancel_at_period_end
            THEN greatest(tokentracker_cloud_subscriptions.next_billed_at,excluded.next_billed_at)
            ELSE tokentracker_cloud_subscriptions.next_billed_at END;
    ELSE
      IF v_order.provider_order_id IS NOT NULL AND v_order.provider_order_id <> v_action_id THEN
        RAISE EXCEPTION ''payment transaction does not match the order'';
      END IF;
      SELECT greatest(clock_timestamp(), max(ends_at)) INTO v_start
        FROM public.tokentracker_cloud_payments WHERE user_id = v_order.user_id
          AND environment = p_environment AND refunded_cents < amount_cents;
      v_end := v_start + make_interval(months => v_order.term_months);
    END IF;
    INSERT INTO public.tokentracker_cloud_payments
      (order_id, user_id, provider, environment, transaction_id, subscription_id,
        currency, amount_cents, starts_at, ends_at, paid_at)
      VALUES (v_order.id, v_order.user_id, p_provider, p_environment, v_action_id, v_subscription_id,
        v_order.currency, v_amount, v_start, v_end, v_occurred);
    UPDATE public.tokentracker_cloud_orders SET status = ''paid'',
      provider_order_id = coalesce(provider_order_id, v_action_id) WHERE id = v_order.id;
  ELSIF v_kind = ''refund'' THEN
    SELECT * INTO STRICT v_payment FROM public.tokentracker_cloud_payments
      WHERE provider = p_provider AND environment = p_environment
        AND transaction_id = p_event->>''transaction_id'' FOR UPDATE;
    IF v_payment.order_id <> v_order.id OR v_payment.user_id <> v_order.user_id OR
      p_event->>''currency'' IS DISTINCT FROM v_payment.currency THEN
      RAISE EXCEPTION ''refund does not match the paid order'';
    END IF;
    IF p_event ? ''refund_total_cents'' THEN
      IF p_provider <> ''alipay'' THEN RAISE EXCEPTION ''invalid cumulative refund provider''; END IF;
      v_refund_total := (p_event->>''refund_total_cents'')::integer;
      IF v_refund_total IS NULL OR v_refund_total <= 0 OR v_refund_total > v_payment.amount_cents OR
        v_refund_total IS DISTINCT FROM (p_event->>''amount_cents'')::integer THEN
        RAISE EXCEPTION ''invalid refund amount'';
      END IF;
      IF v_refund_total <= v_payment.refunded_cents THEN v_status := ''outdated''; END IF;
    ELSE
      v_amount := (p_event->>''amount_cents'')::integer;
      IF v_amount IS NULL OR v_amount <= 0 OR
        v_payment.refunded_cents + v_amount > v_payment.amount_cents THEN
        RAISE EXCEPTION ''invalid refund amount'';
      END IF;
      v_refund_total := v_payment.refunded_cents + v_amount;
    END IF;
    IF v_status = ''applied'' THEN
      UPDATE public.tokentracker_cloud_payments SET refunded_cents = v_refund_total,
        revoked_at = CASE WHEN v_refund_total = amount_cents THEN clock_timestamp() ELSE revoked_at END
        WHERE id = v_payment.id;
    END IF;
  ELSE
    IF p_provider <> ''paddle'' OR v_subscription_id IS NULL OR
      p_event->>''status'' IS NULL OR p_event->>''status'' NOT IN
        (''active'', ''canceled'', ''past_due'', ''paused'', ''trialing'') THEN
      RAISE EXCEPTION ''invalid subscription event'';
    END IF;
    SELECT * INTO v_subscription FROM public.tokentracker_cloud_subscriptions
      WHERE provider = p_provider AND environment = p_environment
        AND provider_subscription_id = v_subscription_id FOR UPDATE;
    IF FOUND AND (v_subscription.user_id <> v_order.user_id OR v_subscription.order_id <> v_order.id) THEN
      RAISE EXCEPTION ''subscription belongs to a different account or order'';
    END IF;
    IF FOUND AND v_subscription.last_event_at >= v_occurred THEN
      v_status := ''outdated'';
    ELSE
      INSERT INTO public.tokentracker_cloud_subscriptions
        (provider, environment, provider_subscription_id, user_id, order_id, status,
          cancel_at_period_end, last_event_at,next_billed_at)
        VALUES (p_provider, p_environment, v_subscription_id, v_order.user_id, v_order.id,
          p_event->>''status'', coalesce((p_event->>''cancel_at_period_end'')::boolean, false), v_occurred,
          (p_event->>''next_billed_at'')::timestamptz)
        ON CONFLICT (provider, environment, provider_subscription_id) DO UPDATE
          SET status = excluded.status, cancel_at_period_end = excluded.cancel_at_period_end,
            last_event_at = excluded.last_event_at,next_billed_at=excluded.next_billed_at;
    END IF;
  END IF;
  UPDATE public.tokentracker_cloud_events SET status = v_status
    WHERE provider = p_provider AND environment = p_environment AND event_id = v_event_id;
  RETURN jsonb_build_object(''applied'', v_status = ''applied'', ''status'', v_status,
    ''membership'', public.cloud_membership(v_order.user_id, p_environment));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.cloud_apply_events(p_provider text, p_environment text, p_events jsonb)
RETURNS jsonb LANGUAGE plpgsql
SET search_path = public, pg_temp AS $fn$
DECLARE v_event jsonb; v_results jsonb := ''[]''::jsonb;
BEGIN
  IF jsonb_typeof(p_events) <> ''array'' OR jsonb_array_length(p_events) NOT BETWEEN 1 AND 3 THEN
    RAISE EXCEPTION ''invalid payment event batch'';
  END IF;
  FOR v_event IN SELECT value FROM jsonb_array_elements(p_events) LOOP
    v_results := v_results || jsonb_build_array(public.cloud_apply_event(p_provider,p_environment,v_event));
  END LOOP;
  RETURN jsonb_build_object(''results'',v_results);
END;
$fn$;

REVOKE ALL ON FUNCTION public.cloud_membership(uuid, text),
  public.cloud_start_trial(uuid, text), public.cloud_create_order(uuid, text, text, text, uuid),
  public.cloud_claim_checkout(uuid, uuid), public.cloud_attach_checkout(uuid, uuid, text, text, text),
  public.cloud_claim_reconciliation(uuid,uuid),
  public.cloud_close_unpaid_order(uuid,uuid),
  public.cloud_apply_event(text, text, jsonb), public.cloud_apply_events(text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cloud_membership(uuid, text),
  public.cloud_start_trial(uuid, text), public.cloud_create_order(uuid, text, text, text, uuid),
  public.cloud_claim_checkout(uuid, uuid), public.cloud_attach_checkout(uuid, uuid, text, text, text),
  public.cloud_claim_reconciliation(uuid,uuid),
  public.cloud_close_unpaid_order(uuid,uuid),
  public.cloud_apply_event(text, text, jsonb), public.cloud_apply_events(text,text,jsonb) TO project_admin;
';
        INSERT INTO public.tokentracker_self_host_installations(step,checksum) VALUES ('20261003120000_cloud-subscriptions','d7ccbed0b936d8ff517a7932799770c944e6942cadb0c949b745ded799c19937');
      END IF;
    END $install$;

DO $install$ DECLARE v_checksum text; BEGIN
      SELECT checksum INTO v_checksum FROM public.tokentracker_self_host_installations WHERE step = '20261004120000_cloud-machine-access';
      IF FOUND AND v_checksum <> '6938d26ea6dc211db83ac6c769e9930c80b147dc2fcbe837c6902ef2dc1a394c' THEN RAISE EXCEPTION 'Installed step has changed: %','20261004120000_cloud-machine-access'; END IF;
      IF NOT FOUND THEN
        EXECUTE '-- Stable synchronization slots. Display names and OS-derived machine ids are
-- aliases, not hardware attestation. Preview preserves pre-launch access.
CREATE TABLE public.tokentracker_cloud_machines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  environment text NOT NULL REFERENCES public.tokentracker_cloud_policy(environment),
  status text NOT NULL DEFAULT ''active'' CHECK (status IN (''active'',''paused'',''merged'')),
  merged_into uuid REFERENCES public.tokentracker_cloud_machines(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_at timestamptz,
  last_upload_at timestamptz,
  upload_window_until timestamptz,
  upload_token_id uuid,
  upload_id text,
  upload_batch_count integer NOT NULL DEFAULT 0 CHECK (upload_batch_count >= 0),
  UNIQUE (user_id, environment, id),
  CHECK ((status = ''merged'') = (merged_into IS NOT NULL))
);
CREATE TABLE public.tokentracker_cloud_machine_aliases (
  user_id uuid NOT NULL,
  environment text NOT NULL,
  kind text NOT NULL CHECK (kind IN (''device'',''machine'',''cluster'')),
  alias text NOT NULL,
  machine_id uuid NOT NULL,
  PRIMARY KEY (user_id, environment, kind, alias),
  FOREIGN KEY (user_id, environment, machine_id)
    REFERENCES public.tokentracker_cloud_machines(user_id, environment, id)
);
CREATE INDEX tokentracker_cloud_machine_aliases_slot_idx
  ON public.tokentracker_cloud_machine_aliases (user_id, environment, machine_id);
ALTER TABLE public.tokentracker_cloud_machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tokentracker_cloud_machine_aliases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tokentracker_cloud_machines, public.tokentracker_cloud_machine_aliases
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.tokentracker_cloud_machines, public.tokentracker_cloud_machine_aliases TO project_admin;

-- Existing tokens belong to the live project. Sandbox issuance cannot grant
-- live access; identity is read from the token table, never from request JSON.
ALTER TABLE public.tokentracker_device_tokens ADD COLUMN cloud_environment text
  NOT NULL DEFAULT ''live'';
-- Enforce new writes now; validate existing tokens in a separate transaction
-- so the initial schema change does not scan the large live token table.
ALTER TABLE public.tokentracker_device_tokens
  ADD CONSTRAINT tokentracker_device_tokens_cloud_environment_fkey
  FOREIGN KEY (cloud_environment) REFERENCES public.tokentracker_cloud_policy(environment) NOT VALID;

CREATE FUNCTION public.cloud_merge_machine_slots(p_user_id uuid, p_environment text, p_ids uuid[])
RETURNS uuid LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
DECLARE v_id uuid; v_paused boolean;
BEGIN
  SELECT id INTO v_id FROM public.tokentracker_cloud_machines
    WHERE user_id=p_user_id AND environment=p_environment AND id=ANY(p_ids)
    ORDER BY created_at,id LIMIT 1;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  SELECT bool_or(status=''paused'') INTO v_paused FROM public.tokentracker_cloud_machines
    WHERE user_id=p_user_id AND environment=p_environment AND id=ANY(p_ids);
  UPDATE public.tokentracker_cloud_machines SET
    status=CASE WHEN v_paused THEN ''paused'' ELSE ''active'' END,
    last_seen_at=(SELECT max(last_seen_at) FROM public.tokentracker_cloud_machines WHERE id=ANY(p_ids)),
    last_upload_at=(SELECT max(last_upload_at) FROM public.tokentracker_cloud_machines WHERE id=ANY(p_ids)),
    upload_window_until=NULL, upload_token_id=NULL, upload_id=NULL
    WHERE id=v_id AND (SELECT count(DISTINCT value) FROM unnest(p_ids) value)>1;
  UPDATE public.tokentracker_cloud_machine_aliases SET machine_id=v_id
    WHERE user_id=p_user_id AND environment=p_environment AND machine_id=ANY(p_ids);
  UPDATE public.tokentracker_cloud_machines SET status=''merged'', merged_into=v_id,
    upload_window_until=NULL, upload_token_id=NULL, upload_id=NULL
    WHERE user_id=p_user_id AND environment=p_environment AND id<>v_id
      AND (id=ANY(p_ids) OR merged_into=ANY(p_ids));
  RETURN v_id;
END;
$fn$;

CREATE FUNCTION public.cloud_bind_device_slot(p_user_id uuid, p_environment text, p_device_id uuid)
RETURNS uuid LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
DECLARE v_device public.tokentracker_devices%ROWTYPE; v_cluster text; v_ids uuid[]; v_id uuid;
BEGIN
  SELECT * INTO STRICT v_device FROM public.tokentracker_devices WHERE id=p_device_id AND user_id=p_user_id;
  SELECT machine_cluster_id INTO v_cluster FROM public.tokentracker_device_machine WHERE device_id=p_device_id;
  SELECT array_agg(DISTINCT machine_id) INTO v_ids FROM public.tokentracker_cloud_machine_aliases
    WHERE user_id=p_user_id AND environment=p_environment AND
      ((kind=''device'' AND alias=p_device_id::text) OR
       (kind=''machine'' AND alias=v_device.machine_id) OR (kind=''cluster'' AND alias=v_cluster));
  v_id := public.cloud_merge_machine_slots(p_user_id,p_environment,v_ids);
  IF v_id IS NULL THEN
    INSERT INTO public.tokentracker_cloud_machines(user_id,environment,status)
      VALUES(p_user_id,p_environment,CASE WHEN v_device.revoked_at IS NULL THEN ''active'' ELSE ''paused'' END)
      RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tokentracker_cloud_machine_aliases(user_id,environment,kind,alias,machine_id)
    SELECT p_user_id,p_environment,k,a,v_id FROM (VALUES
      (''device'',p_device_id::text),(''machine'',v_device.machine_id),(''cluster'',v_cluster)) AS aliases(k,a)
    WHERE a IS NOT NULL
    ON CONFLICT (user_id,environment,kind,alias) DO UPDATE SET machine_id=excluded.machine_id;
  RETURN v_id;
END;
$fn$;

CREATE FUNCTION public.cloud_reconcile_machines(p_user_id uuid, p_environment text)
RETURNS void LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
DECLARE v_device record;
BEGIN
  -- Use the billing lock first, so a refund/renewal and admission have one
  -- order. A user-wide lock then serializes live/sandbox device-row adoption.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || '':'' || p_environment,0));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || '':cloud-device'',0));
  FOR v_device IN SELECT id FROM public.tokentracker_devices WHERE user_id=p_user_id
    AND (revoked_at IS NULL OR EXISTS (SELECT 1 FROM public.tokentracker_cloud_machine_aliases
      WHERE user_id=p_user_id AND environment=p_environment AND kind=''device'' AND alias=id::text))
    ORDER BY created_at,id
  LOOP
    PERFORM public.cloud_bind_device_slot(p_user_id,p_environment,v_device.id);
  END LOOP;
END;
$fn$;

CREATE FUNCTION public.cloud_list_machines(p_user_id uuid, p_environment text, p_current_machine_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
DECLARE v_membership jsonb; v_current uuid; v_machines jsonb; v_count integer;
BEGIN
  PERFORM public.cloud_reconcile_machines(p_user_id,p_environment);
  v_membership:=public.cloud_membership(p_user_id,p_environment);
  SELECT machine_id INTO v_current FROM public.tokentracker_cloud_machine_aliases
    WHERE user_id=p_user_id AND environment=p_environment AND kind=''machine'' AND alias=p_current_machine_id;
  SELECT count(*) FILTER (WHERE m.status=''active''), coalesce(jsonb_agg(jsonb_build_object(
    ''machine_id'',m.id,''name'',coalesce(d.device_name,''Token Tracker''),''platform'',d.platform,
    ''last_seen_at'',m.last_seen_at,''is_current'',coalesce(m.id=v_current OR m.id::text=p_current_machine_id,false),
    ''status'',m.status) ORDER BY m.created_at,m.id),''[]''::jsonb)
  INTO v_count,v_machines FROM public.tokentracker_cloud_machines m
  LEFT JOIN LATERAL (SELECT device_name,platform FROM public.tokentracker_devices d
    JOIN public.tokentracker_cloud_machine_aliases a ON a.kind=''device'' AND a.alias=d.id::text
      AND a.user_id=m.user_id AND a.environment=m.environment AND a.machine_id=m.id
    ORDER BY d.name_customized DESC,d.revoked_at NULLS FIRST,d.created_at,d.id LIMIT 1) d ON true
  WHERE m.user_id=p_user_id AND m.environment=p_environment AND m.status<>''merged'';
  RETURN jsonb_build_object(''machines'',v_machines,''machine_count'',v_count,
    ''machine_limit'',v_membership->''machine_limit'',''membership'',v_membership,
    ''over_machine_limit'',(v_membership->>''machine_limit'')::integer<v_count);
END;
$fn$;

CREATE FUNCTION public.cloud_set_machine_status(p_user_id uuid,p_environment text,p_machine_id uuid,p_status text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
DECLARE v_machine public.tokentracker_cloud_machines%ROWTYPE; v_state jsonb; v_limit integer; v_count integer;
BEGIN
  PERFORM public.cloud_reconcile_machines(p_user_id,p_environment);
  SELECT * INTO v_machine FROM public.tokentracker_cloud_machines
    WHERE id=p_machine_id AND user_id=p_user_id AND environment=p_environment;
  IF NOT FOUND THEN RETURN jsonb_build_object(''ok'',false,''code'',''cloud_machine_not_found'',''status'',404); END IF;
  IF v_machine.status=''merged'' THEN
    SELECT * INTO v_machine FROM public.tokentracker_cloud_machines WHERE id=v_machine.merged_into;
  END IF;
  IF p_status=''active'' AND v_machine.status<>''active'' THEN
    v_state:=public.cloud_membership(p_user_id,p_environment);
    v_limit:=(v_state->>''machine_limit'')::integer;
    SELECT count(*) INTO v_count FROM public.tokentracker_cloud_machines
      WHERE user_id=p_user_id AND environment=p_environment AND status=''active'';
    IF v_limit IS NOT NULL AND v_count>=v_limit THEN
      RETURN jsonb_build_object(''ok'',false,''code'',''cloud_machine_limit'',''status'',409,
        ''membership'',v_state,''recovery_url'',''https://www.tokentracker.cc/cloud'');
    END IF;
  END IF;
  UPDATE public.tokentracker_cloud_machines SET status=p_status,upload_window_until=NULL,
    upload_token_id=NULL,upload_id=NULL WHERE id=v_machine.id;
  IF p_status=''paused'' THEN
    UPDATE public.tokentracker_device_tokens SET revoked_at=clock_timestamp()
      WHERE user_id=p_user_id AND cloud_environment=p_environment AND revoked_at IS NULL
      AND device_id::text IN (SELECT alias FROM public.tokentracker_cloud_machine_aliases
        WHERE user_id=p_user_id AND environment=p_environment AND kind=''device'' AND machine_id=v_machine.id);
  END IF;
  RETURN public.cloud_list_machines(p_user_id,p_environment,NULL) || jsonb_build_object(''ok'',true);
END;
$fn$;
CREATE FUNCTION public.cloud_remove_machine(p_user_id uuid,p_environment text,p_machine_id uuid)
RETURNS jsonb LANGUAGE sql SET search_path = public, pg_temp AS $fn$
  SELECT public.cloud_set_machine_status(p_user_id,p_environment,p_machine_id,''paused'');
$fn$;
CREATE FUNCTION public.cloud_resume_machine(p_user_id uuid,p_environment text,p_machine_id uuid)
RETURNS jsonb LANGUAGE sql SET search_path = public, pg_temp AS $fn$
  SELECT public.cloud_set_machine_status(p_user_id,p_environment,p_machine_id,''active'');
$fn$;

CREATE FUNCTION public.cloud_issue_device_token(
  p_user_id uuid,p_environment text,p_device_name text,p_platform text,p_machine_id text,
  p_legacy_names text[],p_token_id uuid,p_token_hash text,p_rotate boolean DEFAULT false,p_device_code text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
DECLARE v_device public.tokentracker_devices%ROWTYPE; v_legacy uuid; v_slot uuid; v_other uuid;
  v_state jsonb; v_limit integer; v_count integer; v_name text; v_code record; v_known_slot uuid;
BEGIN
  PERFORM public.cloud_reconcile_machines(p_user_id,p_environment);
  IF p_device_code IS NOT NULL THEN
    SELECT * INTO v_code FROM public.tokentracker_device_codes WHERE device_code=p_device_code FOR UPDATE;
    IF NOT FOUND OR v_code.user_id IS DISTINCT FROM p_user_id OR v_code.status<>''approved''
      OR v_code.expires_at<=clock_timestamp() THEN
      RETURN jsonb_build_object(''ok'',false,''code'',''cloud_device_code_expired'',''status'',410);
    END IF;
  END IF;
  v_state:=public.cloud_membership(p_user_id,p_environment);
  v_limit:=(v_state->>''machine_limit'')::integer;
  SELECT machine_id INTO v_known_slot FROM public.tokentracker_cloud_machine_aliases
    WHERE user_id=p_user_id AND environment=p_environment AND kind=''machine'' AND alias=p_machine_id;
  IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_machines WHERE id=v_known_slot AND status=''paused'') THEN
    RETURN jsonb_build_object(''ok'',false,''code'',''cloud_machine_paused'',''status'',403,
      ''membership'',v_state,''machine_id'',v_known_slot,''recovery_url'',''https://www.tokentracker.cc/cloud'');
  END IF;
  IF p_machine_id IS NOT NULL THEN
    SELECT * INTO v_device FROM public.tokentracker_devices WHERE user_id=p_user_id
      AND machine_id=p_machine_id AND revoked_at IS NULL ORDER BY created_at,id LIMIT 1;
  END IF;
  IF v_device.id IS NULL THEN
    SELECT * INTO v_device FROM public.tokentracker_devices WHERE user_id=p_user_id
      AND platform IS NOT DISTINCT FROM p_platform AND revoked_at IS NULL
      AND (p_machine_id IS NULL OR machine_id IS NULL)
      AND (device_name=ANY(p_legacy_names) OR default_device_name=ANY(p_legacy_names))
      ORDER BY (device_name=p_device_name) DESC,created_at,id LIMIT 1;
  ELSE
    -- The old identity refresh may absorb a legacy row and move its tokens.
    -- Merge its existing slot before that row is revoked by the original RPC.
    SELECT id INTO v_legacy FROM public.tokentracker_devices WHERE user_id=p_user_id
      AND id<>v_device.id AND revoked_at IS NULL AND machine_id IS NULL
      AND platform IS NOT DISTINCT FROM p_platform
      AND (device_name=p_device_name OR default_device_name=p_device_name)
      ORDER BY created_at,id LIMIT 1;
    IF v_legacy IS NOT NULL THEN
      v_slot:=public.cloud_bind_device_slot(p_user_id,p_environment,v_device.id);
      v_other:=public.cloud_bind_device_slot(p_user_id,p_environment,v_legacy);
      PERFORM public.cloud_merge_machine_slots(p_user_id,p_environment,ARRAY[v_slot,v_other]);
    END IF;
    PERFORM public.refresh_tokentracker_device_identity(p_user_id,v_device.id,p_device_name,p_platform);
  END IF;
  IF v_device.id IS NULL THEN
    SELECT count(*) INTO v_count FROM public.tokentracker_cloud_machines
      WHERE user_id=p_user_id AND environment=p_environment AND status=''active'';
    IF v_known_slot IS NULL AND v_limit IS NOT NULL AND v_count>=v_limit THEN
      RETURN jsonb_build_object(''ok'',false,''code'',''cloud_machine_limit'',''status'',409,
        ''membership'',v_state,''machine_count'',v_count,''recovery_url'',''https://www.tokentracker.cc/cloud'');
    END IF;
    v_name:=p_device_name;
    IF EXISTS (SELECT 1 FROM public.tokentracker_devices WHERE user_id=p_user_id AND platform=p_platform
      AND device_name=v_name AND revoked_at IS NULL) THEN
      v_name:=left(p_device_name,116) || '' #'' || left(coalesce(p_machine_id,p_token_id::text),8);
    END IF;
    INSERT INTO public.tokentracker_devices(id,user_id,device_name,platform,machine_id)
      VALUES(gen_random_uuid(),p_user_id,v_name,p_platform,p_machine_id)
      ON CONFLICT DO NOTHING RETURNING * INTO v_device;
    IF v_device.id IS NULL AND p_machine_id IS NOT NULL THEN
      -- Legacy rename/create paths do not take the account lock. Only an
      -- exact machine identity may win that race; a matching name cannot.
      SELECT * INTO v_device FROM public.tokentracker_devices WHERE user_id=p_user_id
        AND machine_id=p_machine_id AND revoked_at IS NULL ORDER BY created_at,id LIMIT 1 FOR UPDATE;
    END IF;
    IF v_device.id IS NULL THEN
      RETURN jsonb_build_object(''ok'',false,''code'',''cloud_device_identity_conflict'',''status'',409,
        ''membership'',v_state,''recovery_url'',''https://www.tokentracker.cc/cloud'');
    END IF;
  ELSE
    v_slot:=public.cloud_bind_device_slot(p_user_id,p_environment,v_device.id);
    IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_machines WHERE id=v_slot AND status=''paused'') THEN
      RETURN jsonb_build_object(''ok'',false,''code'',''cloud_machine_paused'',''status'',403,
        ''membership'',v_state,''machine_id'',v_slot,''recovery_url'',''https://www.tokentracker.cc/cloud'');
    END IF;
    IF p_machine_id IS NOT NULL AND v_device.machine_id IS NULL THEN
      BEGIN
        UPDATE public.tokentracker_devices SET machine_id=p_machine_id,
          device_name=CASE WHEN name_customized THEN device_name ELSE p_device_name END WHERE id=v_device.id;
      EXCEPTION WHEN unique_violation THEN
        BEGIN
          UPDATE public.tokentracker_devices SET machine_id=p_machine_id WHERE id=v_device.id;
        EXCEPTION WHEN unique_violation THEN
          RETURN jsonb_build_object(''ok'',false,''code'',''cloud_device_identity_conflict'',''status'',409,
            ''membership'',v_state,''recovery_url'',''https://www.tokentracker.cc/cloud'');
        END;
      END;
    END IF;
  END IF;
  v_slot:=public.cloud_bind_device_slot(p_user_id,p_environment,v_device.id);
  IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_machines WHERE id=v_slot AND status=''paused'') THEN
    RETURN jsonb_build_object(''ok'',false,''code'',''cloud_machine_paused'',''status'',403,
      ''membership'',v_state,''machine_id'',v_slot,''recovery_url'',''https://www.tokentracker.cc/cloud'');
  END IF;
  SELECT count(*) INTO v_count FROM public.tokentracker_cloud_machines
    WHERE user_id=p_user_id AND environment=p_environment AND status=''active'';
  IF v_limit IS NOT NULL AND v_count>v_limit AND NOT coalesce((v_state->>''transition_ends_at'')::timestamptz>clock_timestamp(),false) THEN
    RETURN jsonb_build_object(''ok'',false,''code'',''cloud_machine_limit'',''status'',409,
      ''membership'',v_state,''machine_count'',v_count,''recovery_url'',''https://www.tokentracker.cc/cloud'');
  END IF;
  IF p_rotate THEN
    UPDATE public.tokentracker_device_tokens SET revoked_at=clock_timestamp()
      WHERE device_id=v_device.id AND cloud_environment=p_environment AND revoked_at IS NULL;
  END IF;
  INSERT INTO public.tokentracker_device_tokens(id,user_id,device_id,token_hash,cloud_environment)
    VALUES(p_token_id,p_user_id,v_device.id,p_token_hash,p_environment);
  RETURN jsonb_build_object(''ok'',true,''device_id'',v_device.id,''machine_id'',v_slot,
    ''created_at'',clock_timestamp(),''membership'',v_state);
END;
$fn$;

CREATE FUNCTION public.cloud_grant_device_code(p_user_id uuid,p_environment text,p_user_code text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
DECLARE v_code public.tokentracker_device_codes%ROWTYPE; v_state jsonb; v_slot uuid;
BEGIN
  PERFORM public.cloud_reconcile_machines(p_user_id,p_environment);
  SELECT * INTO v_code FROM public.tokentracker_device_codes WHERE user_code=p_user_code FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object(''ok'',false,''code'',''cloud_device_code_unknown'',''status'',404); END IF;
  IF v_code.expires_at<=clock_timestamp() THEN
    RETURN jsonb_build_object(''ok'',false,''code'',''cloud_device_code_expired'',''status'',410);
  END IF;
  IF v_code.status=''approved'' AND v_code.user_id IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object(''ok'',false,''code'',''cloud_device_code_claimed'',''status'',409);
  END IF;
  SELECT machine_id INTO v_slot FROM public.tokentracker_cloud_machine_aliases
    WHERE user_id=p_user_id AND environment=p_environment AND kind=''machine'' AND alias=v_code.machine_id;
  IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_machines WHERE id=v_slot AND status=''paused'') THEN
    RETURN jsonb_build_object(''ok'',false,''code'',''cloud_machine_paused'',''status'',403,
      ''machine_id'',v_slot,''recovery_url'',''https://www.tokentracker.cc/cloud'');
  END IF;
  -- Final identity resolution and quota admission happen at token issuance.
  v_state:=public.cloud_membership(p_user_id,p_environment);
  UPDATE public.tokentracker_device_codes SET status=''approved'',user_id=p_user_id,
    approved_at=coalesce(approved_at,clock_timestamp()) WHERE device_code=v_code.device_code;
  RETURN jsonb_build_object(''ok'',true,''status'',CASE WHEN v_code.status=''approved'' THEN ''already_approved''
    ELSE ''approved'' END,''client_info'',v_code.client_info,''membership'',v_state);
END;
$fn$;

CREATE FUNCTION public.cloud_account_access(p_user_id uuid,p_environment text,p_kind text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $fn$
DECLARE v_state jsonb; v_from date;
BEGIN
  v_state:=public.cloud_membership(p_user_id,p_environment);
  IF NOT (v_state->>''can_read_cloud'')::boolean THEN
    RETURN jsonb_build_object(''ok'',false,''status'',402,''code'',CASE WHEN v_state->>''status''=''expired''
      THEN ''cloud_read_only_expired'' ELSE ''cloud_membership_required'' END,
      ''membership'',v_state,''recovery_url'',''https://www.tokentracker.cc/cloud'');
  END IF;
  IF v_state->>''phase''=''active'' THEN
    v_from:=CASE WHEN p_kind=''hourly'' THEN (now() AT TIME ZONE ''UTC'')::date - 89
      ELSE ((now() AT TIME ZONE ''UTC'')::date - interval ''24 months'')::date END;
  END IF;
  RETURN jsonb_build_object(''ok'',true,''membership'',v_state,''available_from'',v_from);
END;
$fn$;

CREATE FUNCTION public.cloud_ingest_usage(p_token_hash text,p_environment text,p_rows jsonb,p_states jsonb,p_upload_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
DECLARE v_token public.tokentracker_device_tokens%ROWTYPE; v_device public.tokentracker_devices%ROWTYPE;
  v_slot uuid; v_machine public.tokentracker_cloud_machines%ROWTYPE; v_state jsonb; v_limit integer; v_count integer;
  v_now timestamptz:=clock_timestamp(); v_interval integer; v_max_batches integer; v_next timestamptz; v_continuation boolean; v_inserted integer;
BEGIN
  IF p_rows IS NULL OR p_states IS NULL OR jsonb_typeof(p_rows)<>''array'' OR jsonb_typeof(p_states)<>''array''
    OR jsonb_array_length(p_rows)>500 OR jsonb_array_length(p_states)>500
    OR jsonb_array_length(p_rows)+jsonb_array_length(p_states)=0
    OR octet_length(p_rows::text)+octet_length(p_states::text)>1048576 THEN
    RETURN jsonb_build_object(''ok'',false,''code'',''cloud_upload_size_exceeded'',''status'',413);
  END IF;
  SELECT * INTO v_token FROM public.tokentracker_device_tokens WHERE token_hash=p_token_hash AND revoked_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object(''ok'',false,''code'',''cloud_device_token_rejected'',''status'',401); END IF;
  IF v_token.cloud_environment IS DISTINCT FROM p_environment THEN
    RETURN jsonb_build_object(''ok'',false,''code'',''cloud_environment_mismatch'',''status'',401);
  END IF;
  PERFORM public.cloud_reconcile_machines(v_token.user_id,p_environment);
  v_now:=clock_timestamp();
  -- Removal and issuance use the same lock. Re-read after waiting for it.
  SELECT * INTO v_token FROM public.tokentracker_device_tokens WHERE token_hash=p_token_hash AND revoked_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object(''ok'',false,''code'',''cloud_device_token_rejected'',''status'',401); END IF;
  IF v_token.cloud_environment IS DISTINCT FROM p_environment THEN
    RETURN jsonb_build_object(''ok'',false,''code'',''cloud_environment_mismatch'',''status'',401);
  END IF;
  SELECT * INTO STRICT v_device FROM public.tokentracker_devices WHERE id=v_token.device_id AND user_id=v_token.user_id;
  IF v_device.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object(''ok'',false,''code'',''cloud_device_revoked'',''status'',403);
  END IF;
  v_slot:=public.cloud_bind_device_slot(v_token.user_id,p_environment,v_token.device_id);
  SELECT * INTO STRICT v_machine FROM public.tokentracker_cloud_machines WHERE id=v_slot;
  v_state:=public.cloud_membership(v_token.user_id,p_environment);
  IF v_machine.status<>''active'' THEN
    RETURN jsonb_build_object(''ok'',false,''code'',''cloud_machine_paused'',''status'',403,
      ''membership'',v_state,''recovery_url'',''https://www.tokentracker.cc/cloud'');
  END IF;
  v_limit:=(v_state->>''machine_limit'')::integer;
  SELECT count(*) INTO v_count FROM public.tokentracker_cloud_machines
    WHERE user_id=v_token.user_id AND environment=p_environment AND status=''active'';
  -- The promised transition deadline survives an early purchase. Afterwards
  -- users choose their five; new slots still pass the admission limit above.
  IF v_limit IS NOT NULL AND v_count>v_limit AND NOT coalesce((v_state->>''transition_ends_at'')::timestamptz>clock_timestamp(),false) THEN
    RETURN jsonb_build_object(''ok'',false,''code'',''cloud_machine_limit'',''status'',409,
      ''membership'',v_state,''machine_count'',v_count,''recovery_url'',''https://www.tokentracker.cc/cloud'');
  END IF;
  v_interval:=(v_state->>''sync_interval_seconds'')::integer;
  v_next:=CASE WHEN (v_state->>''can_upload_cloud'')::boolean
    THEN v_machine.last_upload_at+make_interval(secs=>v_interval)
    ELSE date_trunc(''day'',v_machine.last_upload_at AT TIME ZONE ''UTC'') AT TIME ZONE ''UTC''+interval ''1 day'' END;
  v_max_batches:=CASE WHEN (v_state->>''can_upload_cloud'')::boolean THEN 100 ELSE 10 END;
  v_continuation:=v_machine.upload_window_until>v_now AND v_machine.upload_batch_count<v_max_batches
    AND v_machine.upload_token_id=v_token.id
    AND v_machine.upload_id IS NOT DISTINCT FROM p_upload_id;
  IF v_state->>''phase''=''active'' AND v_next>v_now AND NOT coalesce(v_continuation,false) THEN
    RETURN jsonb_build_object(''ok'',false,''code'',''cloud_sync_throttled'',''status'',429,
      ''next_allowed_at'',v_next,''retry_after_seconds'',greatest(1,ceil(extract(epoch FROM v_next-v_now))::integer),
      ''membership'',v_state,''recovery_url'',''https://www.tokentracker.cc/cloud'');
  END IF;
  -- Each batch retains MAX within the batch, then replaces the complete row
  -- across requests. Never use GREATEST against the stored hourly snapshot.
  INSERT INTO public.tokentracker_hourly AS h(user_id,device_id,hour_start,source,model,input_tokens,
    cached_input_tokens,cache_creation_input_tokens,output_tokens,reasoning_output_tokens,total_tokens,
    billable_total_tokens,total_cost_usd,conversations,updated_at)
  SELECT v_token.user_id,v_token.device_id,x.hour_start,x.source,x.model,x.input_tokens,
    x.cached_input_tokens,x.cache_creation_input_tokens,x.output_tokens,x.reasoning_output_tokens,x.total_tokens,
    x.billable_total_tokens,x.total_cost_usd,x.conversations,v_now
  FROM (SELECT DISTINCT ON (hour_start,source,model) * FROM jsonb_to_recordset(p_rows) AS r(
    hour_start timestamptz,source text,model text,input_tokens bigint,cached_input_tokens bigint,
    cache_creation_input_tokens bigint,output_tokens bigint,reasoning_output_tokens bigint,total_tokens bigint,
    billable_total_tokens bigint,total_cost_usd numeric,conversations integer)
    ORDER BY hour_start,source,model,total_tokens DESC) x
  ON CONFLICT(user_id,device_id,hour_start,source,model) DO UPDATE SET
    input_tokens=excluded.input_tokens,cached_input_tokens=excluded.cached_input_tokens,
    cache_creation_input_tokens=excluded.cache_creation_input_tokens,output_tokens=excluded.output_tokens,
    reasoning_output_tokens=excluded.reasoning_output_tokens,total_tokens=excluded.total_tokens,
    billable_total_tokens=excluded.billable_total_tokens,total_cost_usd=excluded.total_cost_usd,
    conversations=excluded.conversations,updated_at=excluded.updated_at;
  GET DIAGNOSTICS v_inserted=ROW_COUNT;
  IF jsonb_array_length(p_states)>0 THEN
    PERFORM public.tokentracker_upsert_account_session_states(v_token.user_id,p_states);
  END IF;
  IF NOT coalesce(v_continuation,false) THEN
    UPDATE public.tokentracker_cloud_machines SET last_upload_at=v_now,
      upload_window_until=v_now+interval ''2 minutes'',upload_token_id=v_token.id,upload_id=p_upload_id,
      upload_batch_count=0 WHERE id=v_slot;
    v_next:=CASE WHEN (v_state->>''can_upload_cloud'')::boolean THEN v_now+make_interval(secs=>v_interval)
      ELSE date_trunc(''day'',v_now AT TIME ZONE ''UTC'') AT TIME ZONE ''UTC''+interval ''1 day'' END;
  END IF;
  UPDATE public.tokentracker_cloud_machines SET last_seen_at=v_now,
    upload_batch_count=upload_batch_count+1 WHERE id=v_slot;
  RETURN jsonb_build_object(''ok'',true,''inserted'',v_inserted,''skipped'',0,''membership'',v_state,
    ''upload_scope'',CASE WHEN (v_state->>''can_upload_cloud'')::boolean THEN ''cloud'' ELSE ''community'' END,
    ''next_allowed_at'',CASE WHEN v_state->>''phase''=''active'' THEN v_next ELSE NULL END,
    ''sync_interval_seconds'',CASE WHEN v_state->>''phase''=''active'' THEN v_interval ELSE NULL END);
END;
$fn$;

REVOKE ALL ON FUNCTION public.cloud_merge_machine_slots(uuid,text,uuid[]),
 public.cloud_bind_device_slot(uuid,text,uuid),public.cloud_reconcile_machines(uuid,text),
 public.cloud_list_machines(uuid,text,text),public.cloud_set_machine_status(uuid,text,uuid,text),
 public.cloud_remove_machine(uuid,text,uuid),public.cloud_resume_machine(uuid,text,uuid),
 public.cloud_issue_device_token(uuid,text,text,text,text,text[],uuid,text,boolean,text),
 public.cloud_grant_device_code(uuid,text,text),public.cloud_account_access(uuid,text,text),public.cloud_ingest_usage(text,text,jsonb,jsonb,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cloud_merge_machine_slots(uuid,text,uuid[]),
 public.cloud_bind_device_slot(uuid,text,uuid),public.cloud_reconcile_machines(uuid,text),
 public.cloud_list_machines(uuid,text,text),public.cloud_set_machine_status(uuid,text,uuid,text),
 public.cloud_remove_machine(uuid,text,uuid),public.cloud_resume_machine(uuid,text,uuid),
 public.cloud_issue_device_token(uuid,text,text,text,text,text[],uuid,text,boolean,text),
 public.cloud_grant_device_code(uuid,text,text),public.cloud_account_access(uuid,text,text),public.cloud_ingest_usage(text,text,jsonb,jsonb,text)
 TO project_admin;
';
        INSERT INTO public.tokentracker_self_host_installations(step,checksum) VALUES ('20261004120000_cloud-machine-access','6938d26ea6dc211db83ac6c769e9930c80b147dc2fcbe837c6902ef2dc1a394c');
      END IF;
    END $install$;

DO $install$ DECLARE v_checksum text; BEGIN
      SELECT checksum INTO v_checksum FROM public.tokentracker_self_host_installations WHERE step = '20261007120000_cloud-waffo';
      IF FOUND AND v_checksum <> 'ee4303a99b3141015b68f960ad111672862ba9b2b2537c3d25c288eedaa66f5c' THEN RAISE EXCEPTION 'Installed step has changed: %','20261007120000_cloud-waffo'; END IF;
      IF NOT FOUND THEN
        EXECUTE '-- Waffo checkout sessions, orders, and payments have separate identities.
-- The legacy financial tables and provider transaction semantics remain intact.
ALTER TABLE public.tokentracker_cloud_catalog
  ADD COLUMN billing_mode text NOT NULL DEFAULT ''fixed'' CHECK (billing_mode IN (''fixed'',''recurring'')),
  ADD COLUMN active boolean NOT NULL DEFAULT true;
UPDATE public.tokentracker_cloud_catalog SET active = false WHERE currency = ''CNY'';
UPDATE public.tokentracker_cloud_catalog SET billing_mode = ''recurring'',
  amount_cents = CASE WHEN term_months = 12 THEN 3999 ELSE 499 END WHERE currency = ''USD'';
INSERT INTO public.tokentracker_cloud_catalog (sku,currency,amount_cents,term_months,billing_mode) VALUES
  (''cloud_usd_monthly_fixed'',''USD'',499,1,''fixed''),
  (''cloud_usd_yearly_fixed'',''USD'',3999,12,''fixed'');
ALTER TABLE public.tokentracker_cloud_orders
  DROP CONSTRAINT tokentracker_cloud_orders_provider_check,
  DROP CONSTRAINT tokentracker_cloud_orders_check,
  ADD CONSTRAINT tokentracker_cloud_orders_provider_check
    CHECK (provider IN (''paddle'',''wechat'',''alipay'',''waffo'')),
  ADD CONSTRAINT tokentracker_cloud_orders_provider_currency_check
    CHECK (provider = ''waffo'' OR (provider = ''paddle'' AND currency = ''USD'') OR
      (provider IN (''wechat'',''alipay'') AND currency = ''CNY'')),
  ADD COLUMN provider_checkout_id text,
  ADD COLUMN waffo_order_id text,
  ADD COLUMN billing_mode text NOT NULL DEFAULT ''fixed'' CHECK (billing_mode IN (''fixed'',''recurring'')),
  ADD CONSTRAINT tokentracker_cloud_orders_waffo_identity_check
    CHECK ((provider = ''waffo'' OR (provider_checkout_id IS NULL AND waffo_order_id IS NULL)) AND
      (provider_checkout_id IS NULL OR (provider_checkout_id ~ ''^cs_[A-Za-z0-9-]+$'' AND length(provider_checkout_id) <= 200)) AND
      (waffo_order_id IS NULL OR (waffo_order_id ~ ''^ORD_[A-Za-z0-9]+$'' AND length(waffo_order_id) <= 200)));
UPDATE public.tokentracker_cloud_orders SET billing_mode = ''recurring'' WHERE provider = ''paddle'';
ALTER TABLE public.tokentracker_cloud_orders ADD CONSTRAINT tokentracker_cloud_orders_provider_mode_check
  CHECK (provider = ''waffo'' OR (provider = ''paddle'' AND billing_mode = ''recurring'') OR
    (provider IN (''wechat'',''alipay'') AND billing_mode = ''fixed''));
CREATE UNIQUE INDEX tokentracker_cloud_orders_waffo_checkout_idx
  ON public.tokentracker_cloud_orders (environment, provider_checkout_id) WHERE provider = ''waffo'';
CREATE UNIQUE INDEX tokentracker_cloud_orders_waffo_order_idx
  ON public.tokentracker_cloud_orders (environment, waffo_order_id) WHERE provider = ''waffo'';
ALTER TABLE public.tokentracker_cloud_payments
  DROP CONSTRAINT tokentracker_cloud_payments_provider_check,
  ADD CONSTRAINT tokentracker_cloud_payments_provider_check CHECK (provider IN (''paddle'',''wechat'',''alipay'',''waffo''));
ALTER TABLE public.tokentracker_cloud_events
  DROP CONSTRAINT tokentracker_cloud_events_provider_check,
  ADD CONSTRAINT tokentracker_cloud_events_provider_check CHECK (provider IN (''paddle'',''wechat'',''alipay'',''waffo''));
ALTER TABLE public.tokentracker_cloud_subscriptions
  DROP CONSTRAINT tokentracker_cloud_subscriptions_provider_check,
  ADD CONSTRAINT tokentracker_cloud_subscriptions_provider_check CHECK (provider IN (''paddle'',''waffo''));

CREATE TABLE public.tokentracker_cloud_waffo_periods (
  order_id uuid NOT NULL REFERENCES public.tokentracker_cloud_orders(id),
  environment text NOT NULL REFERENCES public.tokentracker_cloud_policy(environment),
  waffo_order_id text NOT NULL,
  period_number integer NOT NULL CHECK (period_number > 0),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  PRIMARY KEY (order_id, period_number),
  UNIQUE (environment, waffo_order_id, period_number)
);
ALTER TABLE public.tokentracker_cloud_waffo_periods ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tokentracker_cloud_waffo_periods FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.tokentracker_cloud_waffo_periods TO project_admin;

CREATE OR REPLACE FUNCTION public.cloud_record_waffo_period(
  p_order_id uuid, p_environment text, p_waffo_order_id text, p_provider_price_id text,
  p_period_number integer, p_starts_at timestamptz, p_ends_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql
SET search_path = public, pg_temp AS $fn$
DECLARE v_order public.tokentracker_cloud_orders%ROWTYPE; v_period public.tokentracker_cloud_waffo_periods%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_order FROM public.tokentracker_cloud_orders WHERE id = p_order_id;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_order.user_id::text || '':'' || p_environment, 0));
  SELECT * INTO STRICT v_order FROM public.tokentracker_cloud_orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.provider <> ''waffo'' OR v_order.environment <> p_environment OR v_order.billing_mode <> ''recurring'' OR
    p_waffo_order_id IS NULL OR p_waffo_order_id !~ ''^ORD_[A-Za-z0-9]+$'' OR length(p_waffo_order_id) > 200 OR
    v_order.provider_price_id IS NULL OR p_provider_price_id IS DISTINCT FROM v_order.provider_price_id OR
    (v_order.waffo_order_id IS NOT NULL AND v_order.waffo_order_id <> p_waffo_order_id) THEN
    RAISE EXCEPTION ''Waffo billing period does not match the bound order or product'';
  END IF;
  IF p_period_number IS NULL OR p_period_number <= 0 OR p_starts_at IS NULL OR p_ends_at IS NULL OR
    NOT isfinite(p_starts_at) OR NOT isfinite(p_ends_at) OR p_ends_at <= p_starts_at OR
    p_ends_at > p_starts_at + make_interval(months => v_order.term_months) + interval ''1 day'' OR
    p_ends_at < p_starts_at + make_interval(months => v_order.term_months) - interval ''1 day'' THEN
    RAISE EXCEPTION ''invalid Waffo subscription billing period'';
  END IF;
  UPDATE public.tokentracker_cloud_orders SET waffo_order_id = coalesce(waffo_order_id, p_waffo_order_id)
    WHERE id = p_order_id;
  SELECT * INTO v_period FROM public.tokentracker_cloud_waffo_periods
    WHERE order_id = p_order_id AND period_number = p_period_number FOR UPDATE;
  IF FOUND THEN
    IF v_period.environment <> p_environment OR v_period.waffo_order_id <> p_waffo_order_id OR
      v_period.starts_at <> p_starts_at OR v_period.ends_at <> p_ends_at THEN
      RAISE EXCEPTION ''Waffo billing period is already bound to different dates'';
    END IF;
  ELSE
    INSERT INTO public.tokentracker_cloud_waffo_periods
      (order_id, environment, waffo_order_id, period_number, starts_at, ends_at)
      VALUES (p_order_id, p_environment, p_waffo_order_id, p_period_number, p_starts_at, p_ends_at)
      RETURNING * INTO v_period;
  END IF;
  -- A verified lifecycle period is evidence for future payments, never paid access.
  RETURN to_jsonb(v_period);
END;
$fn$;


CREATE OR REPLACE FUNCTION public.cloud_create_order(
  p_user_id uuid, p_environment text, p_provider text, p_sku text, p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql
SET search_path = public, pg_temp AS $fn$
DECLARE
  v_catalog public.tokentracker_cloud_catalog%ROWTYPE;
  v_order public.tokentracker_cloud_orders%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || '':'' || p_environment, 0));
  SELECT * INTO v_order FROM public.tokentracker_cloud_orders
    WHERE user_id = p_user_id AND environment = p_environment AND request_id = p_request_id;
  IF FOUND THEN
    IF v_order.provider <> p_provider OR v_order.sku <> p_sku THEN
      RAISE EXCEPTION ''idempotency request belongs to a different purchase'';
    END IF;
    RETURN to_jsonb(v_order);
  END IF;
  SELECT * INTO STRICT v_catalog FROM public.tokentracker_cloud_catalog WHERE sku = p_sku;
  IF NOT v_catalog.active THEN RAISE EXCEPTION ''the requested product is no longer available''; END IF;
  IF (p_provider = ''paddle'' AND (v_catalog.currency <> ''USD'' OR v_catalog.billing_mode <> ''recurring'')) OR
     (p_provider IN (''wechat'', ''alipay'') AND (v_catalog.currency <> ''CNY'' OR v_catalog.billing_mode <> ''fixed'')) THEN
    RAISE EXCEPTION ''payment provider does not support this currency'';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_subscriptions
    WHERE user_id = p_user_id AND environment = p_environment
      AND status IN (''active'', ''trialing'', ''past_due'', ''paused'') AND NOT cancel_at_period_end) THEN
    RAISE EXCEPTION ''manage the existing subscription before purchasing another plan'';
  END IF;
  IF v_catalog.billing_mode = ''recurring'' AND EXISTS (SELECT 1 FROM public.tokentracker_cloud_payments
    WHERE user_id = p_user_id AND environment = p_environment
      AND refunded_cents < amount_cents AND ends_at > clock_timestamp()) THEN
    RAISE EXCEPTION ''the current fixed membership term must end before starting a subscription'';
  END IF;
  INSERT INTO public.tokentracker_cloud_orders
    (user_id, environment, request_id, provider, sku, currency, amount_cents, term_months, billing_mode)
    VALUES (p_user_id, p_environment, p_request_id, p_provider, p_sku,
      v_catalog.currency, v_catalog.amount_cents, v_catalog.term_months, v_catalog.billing_mode)
    RETURNING * INTO v_order;
  RETURN to_jsonb(v_order);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.cloud_claim_checkout(p_user_id uuid, p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql
SET search_path = public, pg_temp AS $fn$
DECLARE v_order public.tokentracker_cloud_orders%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_order FROM public.tokentracker_cloud_orders
    WHERE id = p_order_id AND user_id = p_user_id;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_order.user_id::text || '':'' || v_order.environment,0));
  SELECT * INTO STRICT v_order FROM public.tokentracker_cloud_orders
    WHERE id = p_order_id AND user_id = p_user_id FOR UPDATE;
  IF v_order.checkout_url IS NOT NULL OR v_order.checkout_attempts > 0 OR
    v_order.status <> ''pending'' OR v_order.expires_at <= clock_timestamp() THEN
    RETURN jsonb_build_object(''claimed'', false, ''order'', to_jsonb(v_order));
  END IF;
  IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_orders
    WHERE user_id = p_user_id AND environment = v_order.environment AND id <> v_order.id
      AND (v_order.billing_mode = ''recurring'' OR billing_mode = ''recurring'')
      AND status IN (''pending'',''ready'') AND checkout_attempts > 0) THEN
    RAISE EXCEPTION ''an existing checkout must be confirmed before another subscription'';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_subscriptions
    WHERE user_id = p_user_id AND environment = v_order.environment
      AND status IN (''active'',''trialing'',''past_due'',''paused'') AND NOT cancel_at_period_end) THEN
    RAISE EXCEPTION ''manage the existing subscription before purchasing another plan'';
  END IF;
  IF v_order.billing_mode = ''recurring'' THEN
    IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_payments
      WHERE user_id = p_user_id AND environment = v_order.environment
        AND refunded_cents < amount_cents AND ends_at > clock_timestamp()) THEN
      RAISE EXCEPTION ''the current fixed membership term must end before starting a subscription'';
    END IF;
  END IF;
  UPDATE public.tokentracker_cloud_orders
    SET checkout_attempts = checkout_attempts + 1, checkout_claimed_at = clock_timestamp()
    WHERE id = p_order_id RETURNING * INTO v_order;
  -- Ambiguous provider failures are reconciled, never retried as a new charge.
  RETURN jsonb_build_object(''claimed'', true, ''order'', to_jsonb(v_order));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.cloud_attach_checkout(
  p_user_id uuid, p_order_id uuid, p_provider_order_id text,
  p_provider_price_id text, p_checkout_url text
) RETURNS jsonb LANGUAGE plpgsql
SET search_path = public, pg_temp AS $fn$
DECLARE v_order public.tokentracker_cloud_orders%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_order FROM public.tokentracker_cloud_orders
    WHERE id = p_order_id AND user_id = p_user_id FOR UPDATE;
  IF v_order.provider = ''waffo'' THEN RAISE EXCEPTION ''use the Waffo checkout binding''; END IF;
  IF (v_order.provider_order_id IS NOT NULL AND p_provider_order_id IS NOT NULL
    AND v_order.provider_order_id <> p_provider_order_id) OR
    (v_order.provider_price_id IS NOT NULL AND p_provider_price_id IS NOT NULL
    AND v_order.provider_price_id <> p_provider_price_id) THEN
    RAISE EXCEPTION ''checkout is already bound to a different provider transaction or price'';
  END IF;
  UPDATE public.tokentracker_cloud_orders
    SET provider_order_id = coalesce(provider_order_id, p_provider_order_id),
      provider_price_id = coalesce(provider_price_id, p_provider_price_id),
      checkout_url = coalesce(p_checkout_url, checkout_url),
      status = CASE WHEN status = ''pending'' AND p_checkout_url IS NOT NULL THEN ''ready'' ELSE status END
    WHERE id = p_order_id RETURNING * INTO v_order;
  RETURN to_jsonb(v_order);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.cloud_attach_waffo_checkout(
  p_user_id uuid, p_order_id uuid, p_provider_checkout_id text,
  p_provider_price_id text, p_checkout_url text
) RETURNS jsonb LANGUAGE plpgsql
SET search_path = public, pg_temp AS $fn$
DECLARE v_order public.tokentracker_cloud_orders%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_order FROM public.tokentracker_cloud_orders
    WHERE id = p_order_id AND user_id = p_user_id FOR UPDATE;
  IF v_order.provider <> ''waffo'' OR p_provider_price_id IS NULL OR
    p_provider_price_id = '''' OR length(p_provider_price_id) > 200 OR
    (p_provider_checkout_id IS NOT NULL AND
      (p_provider_checkout_id !~ ''^cs_[A-Za-z0-9-]+$'' OR length(p_provider_checkout_id) > 200)) OR
    (p_checkout_url IS NOT NULL AND (p_provider_checkout_id IS NULL OR p_checkout_url !~ ''^https://'')) THEN
    RAISE EXCEPTION ''invalid Waffo checkout binding'';
  END IF;
  IF (v_order.provider_checkout_id IS NOT NULL AND p_provider_checkout_id IS NOT NULL AND
      v_order.provider_checkout_id <> p_provider_checkout_id) OR
    (v_order.provider_price_id IS NOT NULL AND v_order.provider_price_id <> p_provider_price_id) OR
    (v_order.checkout_url IS NOT NULL AND p_checkout_url IS NOT NULL AND v_order.checkout_url <> p_checkout_url) THEN
    RAISE EXCEPTION ''checkout is already bound to a different Waffo session or product'';
  END IF;
  -- Bind the validated product before the network call; its response may be lost.
  UPDATE public.tokentracker_cloud_orders
    SET provider_checkout_id = coalesce(provider_checkout_id, p_provider_checkout_id),
      provider_price_id = coalesce(provider_price_id, p_provider_price_id),
      checkout_url = coalesce(checkout_url, p_checkout_url),
      status = CASE WHEN status = ''pending'' AND p_checkout_url IS NOT NULL THEN ''ready'' ELSE status END
    WHERE id = p_order_id RETURNING * INTO v_order;
  RETURN to_jsonb(v_order);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.cloud_apply_event(
  p_provider text, p_environment text, p_event jsonb
) RETURNS jsonb LANGUAGE plpgsql
SET search_path = public, pg_temp AS $fn$
DECLARE
  v_order public.tokentracker_cloud_orders%ROWTYPE;
  v_payment public.tokentracker_cloud_payments%ROWTYPE;
  v_subscription public.tokentracker_cloud_subscriptions%ROWTYPE;
  v_event_id text := p_event->>''event_id'';
  v_kind text := p_event->>''kind'';
  v_action_id text := p_event->>''action_id'';
  v_occurred timestamptz := (p_event->>''occurred_at'')::timestamptz;
  v_start timestamptz;
  v_end timestamptz;
  v_subscription_id text := nullif(p_event->>''subscription_id'', '''');
  v_status text := ''applied'';
  v_amount integer;
  v_refund_total integer;
  v_waffo_order_id text := nullif(p_event->>''waffo_order_id'', '''');
  v_recurring boolean;
BEGIN
  IF v_event_id IS NULL OR v_event_id = '''' OR length(v_event_id) > 200 OR
    v_action_id IS NULL OR v_action_id = '''' OR length(v_action_id) > 200 OR
    v_kind NOT IN (''payment'', ''refund'', ''subscription'') OR v_kind IS NULL OR
    v_occurred IS NULL OR v_occurred > clock_timestamp() + interval ''5 minutes'' THEN
    RAISE EXCEPTION ''invalid normalized payment event'';
  END IF;
  SELECT * INTO STRICT v_order FROM public.tokentracker_cloud_orders
    WHERE id = (p_event->>''order_id'')::uuid;
  -- Also serialize separate orders which extend the same account''s paid term.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_order.user_id::text || '':'' || p_environment, 0));
  SELECT * INTO STRICT v_order FROM public.tokentracker_cloud_orders
    WHERE id = (p_event->>''order_id'')::uuid FOR UPDATE;
  IF v_order.provider <> p_provider OR v_order.environment <> p_environment THEN
    RAISE EXCEPTION ''payment event does not match the order provider or environment'';
  END IF;
  v_recurring := v_order.billing_mode = ''recurring'';
  IF p_provider = ''waffo'' THEN
    IF v_waffo_order_id IS NULL OR v_waffo_order_id !~ ''^ORD_[A-Za-z0-9]+$'' OR length(v_waffo_order_id) > 200 OR
      v_order.provider_price_id IS NULL OR p_event->>''provider_price_id'' IS DISTINCT FROM v_order.provider_price_id OR
      (v_order.waffo_order_id IS NOT NULL AND v_order.waffo_order_id <> v_waffo_order_id) THEN
      RAISE EXCEPTION ''Waffo event does not match the bound order or product'';
    END IF;
    IF (v_recurring AND v_subscription_id IS DISTINCT FROM v_waffo_order_id) OR
      (NOT v_recurring AND (v_subscription_id IS NOT NULL OR v_kind = ''subscription'')) THEN
      RAISE EXCEPTION ''Waffo subscription does not match the order billing mode'';
    END IF;
    IF (v_kind = ''payment'' AND v_action_id !~ ''^PAY_[A-Za-z0-9]+$'') OR
      (v_kind = ''refund'' AND (v_action_id !~ ''^(REF|RFD)_[A-Za-z0-9]+$'' OR
        coalesce(p_event->>''transaction_id'', '''') !~ ''^PAY_[A-Za-z0-9]+$'')) THEN
      RAISE EXCEPTION ''invalid Waffo payment or refund identity'';
    END IF;
    UPDATE public.tokentracker_cloud_orders SET waffo_order_id = coalesce(waffo_order_id, v_waffo_order_id)
      WHERE id = v_order.id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_events
    WHERE provider = p_provider AND environment = p_environment AND event_id = v_event_id) THEN
    IF NOT EXISTS (SELECT 1 FROM public.tokentracker_cloud_events
      WHERE provider = p_provider AND environment = p_environment AND event_id = v_event_id
        AND normalized_event = p_event AND order_id = v_order.id) THEN
      RAISE EXCEPTION ''event identifier was already used for different payment data'';
    END IF;
    RETURN jsonb_build_object(''applied'', false, ''duplicate'', true);
  END IF;
  INSERT INTO public.tokentracker_cloud_events
    (provider, environment, event_id, kind, action_id, order_id, occurred_at, normalized_event)
    VALUES (p_provider, p_environment, v_event_id, v_kind, v_action_id, v_order.id, v_occurred, p_event);
  IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_events
    WHERE provider = p_provider AND environment = p_environment AND kind = v_kind
      AND action_id = v_action_id AND status = ''applied'' AND kind IN (''payment'', ''refund'')) THEN
    IF NOT EXISTS (SELECT 1 FROM public.tokentracker_cloud_events
      WHERE provider = p_provider AND environment = p_environment AND kind = v_kind
        AND action_id = v_action_id AND status = ''applied'' AND order_id = v_order.id
        AND normalized_event - ARRAY[''event_id'',''occurred_at''] = p_event - ARRAY[''event_id'',''occurred_at'']) THEN
      RAISE EXCEPTION ''payment action was already applied to different payment data'';
    END IF;
    v_status := ''duplicate'';
  ELSIF v_kind = ''payment'' THEN
    IF p_event->>''currency'' IS DISTINCT FROM v_order.currency OR
      (p_event->>''base_amount_cents'')::integer IS DISTINCT FROM v_order.amount_cents THEN
      RAISE EXCEPTION ''payment amount or currency does not match the order'';
    END IF;
    v_amount := (p_event->>''amount_cents'')::integer;
    IF v_amount IS NULL OR v_amount < v_order.amount_cents OR
      (p_provider NOT IN (''paddle'',''waffo'') AND v_amount <> v_order.amount_cents) THEN
      RAISE EXCEPTION ''invalid paid amount'';
    END IF;
    IF v_recurring THEN
      IF v_order.provider_order_id IS NOT NULL AND v_order.provider_order_id <> v_action_id
        AND (v_subscription_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM public.tokentracker_cloud_subscriptions
          WHERE provider = p_provider AND environment = p_environment
            AND provider_subscription_id = v_subscription_id
            AND user_id = v_order.user_id AND order_id = v_order.id
        )) THEN RAISE EXCEPTION ''unrecognized subscription renewal''; END IF;
      v_start := (p_event->>''starts_at'')::timestamptz;
      v_end := (p_event->>''ends_at'')::timestamptz;
      IF v_subscription_id IS NULL OR v_start IS NULL OR v_end IS NULL OR
        v_end <= v_start OR v_end > v_start + make_interval(months => v_order.term_months) + interval ''1 day'' OR
        v_end < v_start + make_interval(months => v_order.term_months) - interval ''1 day'' THEN
        RAISE EXCEPTION ''invalid subscription billing period'';
      END IF;
      IF p_provider = ''waffo'' AND NOT EXISTS (
        SELECT 1 FROM public.tokentracker_cloud_waffo_periods
        WHERE order_id = v_order.id AND environment = p_environment AND waffo_order_id = v_waffo_order_id
          AND period_number = (p_event->>''period_number'')::integer AND starts_at = v_start AND ends_at = v_end
      ) THEN
        RAISE EXCEPTION ''Waffo payment does not match a verified subscription billing period'';
      END IF;
      SELECT * INTO v_subscription FROM public.tokentracker_cloud_subscriptions
        WHERE provider = p_provider AND environment = p_environment
          AND provider_subscription_id = v_subscription_id FOR UPDATE;
      IF FOUND AND (v_subscription.user_id <> v_order.user_id OR v_subscription.order_id <> v_order.id) THEN
        RAISE EXCEPTION ''subscription belongs to a different account or order'';
      END IF;
      INSERT INTO public.tokentracker_cloud_subscriptions
        (provider, environment, provider_subscription_id, user_id, order_id, status, last_event_at,next_billed_at)
        VALUES (p_provider, p_environment, v_subscription_id, v_order.user_id, v_order.id, ''active'', v_occurred,v_end)
        ON CONFLICT (provider, environment, provider_subscription_id) DO UPDATE SET
          next_billed_at=CASE WHEN tokentracker_cloud_subscriptions.status IN (''active'',''trialing'',''past_due'')
            AND NOT tokentracker_cloud_subscriptions.cancel_at_period_end
            THEN greatest(tokentracker_cloud_subscriptions.next_billed_at,excluded.next_billed_at)
            ELSE tokentracker_cloud_subscriptions.next_billed_at END;
    ELSE
      IF v_order.provider_order_id IS NOT NULL AND v_order.provider_order_id <> v_action_id THEN
        RAISE EXCEPTION ''payment transaction does not match the order'';
      END IF;
      SELECT greatest(clock_timestamp(), max(ends_at)) INTO v_start
        FROM public.tokentracker_cloud_payments WHERE user_id = v_order.user_id
          AND environment = p_environment AND refunded_cents < amount_cents;
      v_end := v_start + make_interval(months => v_order.term_months);
    END IF;
    INSERT INTO public.tokentracker_cloud_payments
      (order_id, user_id, provider, environment, transaction_id, subscription_id,
        currency, amount_cents, starts_at, ends_at, paid_at)
      VALUES (v_order.id, v_order.user_id, p_provider, p_environment, v_action_id, v_subscription_id,
        v_order.currency, v_amount, v_start, v_end, v_occurred);
    UPDATE public.tokentracker_cloud_orders SET status = ''paid'',
      provider_order_id = coalesce(provider_order_id, v_action_id) WHERE id = v_order.id;
  ELSIF v_kind = ''refund'' THEN
    SELECT * INTO STRICT v_payment FROM public.tokentracker_cloud_payments
      WHERE provider = p_provider AND environment = p_environment
        AND transaction_id = p_event->>''transaction_id'' FOR UPDATE;
    IF v_payment.order_id <> v_order.id OR v_payment.user_id <> v_order.user_id OR
      p_event->>''currency'' IS DISTINCT FROM v_payment.currency THEN
      RAISE EXCEPTION ''refund does not match the paid order'';
    END IF;
    IF p_event ? ''refund_total_cents'' THEN
      IF p_provider <> ''alipay'' THEN RAISE EXCEPTION ''invalid cumulative refund provider''; END IF;
      v_refund_total := (p_event->>''refund_total_cents'')::integer;
      IF v_refund_total IS NULL OR v_refund_total <= 0 OR v_refund_total > v_payment.amount_cents OR
        v_refund_total IS DISTINCT FROM (p_event->>''amount_cents'')::integer THEN
        RAISE EXCEPTION ''invalid refund amount'';
      END IF;
      IF v_refund_total <= v_payment.refunded_cents THEN v_status := ''outdated''; END IF;
    ELSE
      v_amount := (p_event->>''amount_cents'')::integer;
      IF v_amount IS NULL OR v_amount <= 0 OR
        v_payment.refunded_cents + v_amount > v_payment.amount_cents THEN
        RAISE EXCEPTION ''invalid refund amount'';
      END IF;
      v_refund_total := v_payment.refunded_cents + v_amount;
    END IF;
    IF v_status = ''applied'' THEN
      UPDATE public.tokentracker_cloud_payments SET refunded_cents = v_refund_total,
        revoked_at = CASE WHEN v_refund_total = amount_cents THEN clock_timestamp() ELSE revoked_at END
        WHERE id = v_payment.id;
    END IF;
  ELSE
    IF NOT v_recurring OR v_subscription_id IS NULL OR
      p_event->>''status'' IS NULL OR p_event->>''status'' NOT IN
        (''active'', ''canceled'', ''past_due'', ''paused'', ''trialing'') THEN
      RAISE EXCEPTION ''invalid subscription event'';
    END IF;
    SELECT * INTO v_subscription FROM public.tokentracker_cloud_subscriptions
      WHERE provider = p_provider AND environment = p_environment
        AND provider_subscription_id = v_subscription_id FOR UPDATE;
    IF FOUND AND (v_subscription.user_id <> v_order.user_id OR v_subscription.order_id <> v_order.id) THEN
      RAISE EXCEPTION ''subscription belongs to a different account or order'';
    END IF;
    IF FOUND AND v_subscription.last_event_at >= v_occurred THEN
      v_status := ''outdated'';
    ELSE
      INSERT INTO public.tokentracker_cloud_subscriptions
        (provider, environment, provider_subscription_id, user_id, order_id, status,
          cancel_at_period_end, last_event_at,next_billed_at)
        VALUES (p_provider, p_environment, v_subscription_id, v_order.user_id, v_order.id,
          p_event->>''status'', coalesce((p_event->>''cancel_at_period_end'')::boolean, false), v_occurred,
          (p_event->>''next_billed_at'')::timestamptz)
        ON CONFLICT (provider, environment, provider_subscription_id) DO UPDATE
          SET status = excluded.status, cancel_at_period_end = excluded.cancel_at_period_end,
            last_event_at = excluded.last_event_at,next_billed_at=excluded.next_billed_at;
    END IF;
  END IF;
  UPDATE public.tokentracker_cloud_events SET status = v_status
    WHERE provider = p_provider AND environment = p_environment AND event_id = v_event_id;
  RETURN jsonb_build_object(''applied'', v_status = ''applied'', ''status'', v_status,
    ''membership'', public.cloud_membership(v_order.user_id, p_environment));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.cloud_apply_waffo_events(p_environment text, p_events jsonb)
RETURNS jsonb LANGUAGE plpgsql
SET search_path = public, pg_temp AS $fn$
DECLARE v_order public.tokentracker_cloud_orders%ROWTYPE; v_event jsonb; v_results jsonb := ''[]''::jsonb;
BEGIN
  IF p_events IS NULL OR jsonb_typeof(p_events) <> ''array'' OR jsonb_array_length(p_events) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION ''invalid Waffo payment event batch'';
  END IF;
  SELECT * INTO STRICT v_order FROM public.tokentracker_cloud_orders
    WHERE id = (p_events->0->>''order_id'')::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_order.user_id::text || '':'' || p_environment, 0));
  FOR v_event IN SELECT value FROM jsonb_array_elements(p_events) LOOP
    IF v_event->>''order_id'' IS DISTINCT FROM v_order.id::text THEN
      RAISE EXCEPTION ''Waffo payment batch must belong to one order'';
    END IF;
    v_results := v_results || jsonb_build_array(public.cloud_apply_event(''waffo'', p_environment, v_event));
  END LOOP;
  RETURN jsonb_build_object(''results'', v_results);
END;
$fn$;

REVOKE ALL ON FUNCTION public.cloud_attach_waffo_checkout(uuid,uuid,text,text,text),
  public.cloud_apply_waffo_events(text,jsonb),
  public.cloud_record_waffo_period(uuid,text,text,text,integer,timestamptz,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cloud_attach_waffo_checkout(uuid,uuid,text,text,text),
  public.cloud_apply_waffo_events(text,jsonb),
  public.cloud_record_waffo_period(uuid,text,text,text,integer,timestamptz,timestamptz) TO project_admin;
';
        INSERT INTO public.tokentracker_self_host_installations(step,checksum) VALUES ('20261007120000_cloud-waffo','ee4303a99b3141015b68f960ad111672862ba9b2b2537c3d25c288eedaa66f5c');
      END IF;
    END $install$;

DO $install$ DECLARE v_checksum text; BEGIN
      SELECT checksum INTO v_checksum FROM public.tokentracker_self_host_installations WHERE step = '20261007130000_cloud-waffo-retry';
      IF FOUND AND v_checksum <> 'ad42488cbf8279f98e269067cbfa270c692fb171bbf66d9e2350f8c6341c1a37' THEN RAISE EXCEPTION 'Installed step has changed: %','20261007130000_cloud-waffo-retry'; END IF;
      IF NOT FOUND THEN
        EXECUTE '-- Restart only after a verified canceled Waffo order has no successful or processing charge.
-- A checkout session itself is never evidence that a previous charge cannot settle.
ALTER TABLE public.tokentracker_cloud_orders
  ADD COLUMN retry_order_id uuid REFERENCES public.tokentracker_cloud_orders(id),
  ADD COLUMN retry_payment_conflict_at timestamptz,
  ADD CONSTRAINT tokentracker_cloud_orders_retry_successor_unique UNIQUE (retry_order_id),
  ADD CONSTRAINT tokentracker_cloud_orders_retry_not_self CHECK (retry_order_id IS DISTINCT FROM id);

CREATE OR REPLACE FUNCTION public.cloud_restart_waffo_order(
  p_user_id uuid, p_environment text, p_order_id uuid, p_request_id uuid, p_waffo_order_id text
) RETURNS jsonb LANGUAGE plpgsql
SET search_path = public, pg_temp AS $fn$
DECLARE v_order public.tokentracker_cloud_orders%ROWTYPE; v_next public.tokentracker_cloud_orders%ROWTYPE; v_next_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || '':'' || p_environment, 0));
  SELECT * INTO STRICT v_order FROM public.tokentracker_cloud_orders
    WHERE id = p_order_id AND user_id = p_user_id AND environment = p_environment FOR UPDATE;
  IF v_order.provider <> ''waffo'' OR v_order.status NOT IN (''pending'',''ready'',''closed'') OR
    p_request_id IS NULL OR p_waffo_order_id IS NULL OR
    p_waffo_order_id !~ ''^ORD_[A-Za-z0-9]+$'' OR length(p_waffo_order_id) > 200 OR
    v_order.provider_price_id IS NULL OR
    (v_order.waffo_order_id IS NOT NULL AND v_order.waffo_order_id <> p_waffo_order_id) THEN
    RAISE EXCEPTION ''Waffo restart does not match the unpaid bound order'';
  END IF;
  IF EXISTS (
    WITH RECURSIVE predecessors AS (
      SELECT id FROM public.tokentracker_cloud_orders WHERE id = p_order_id
      UNION
      SELECT o.id FROM public.tokentracker_cloud_orders o JOIN predecessors p ON o.retry_order_id = p.id
        WHERE o.user_id = p_user_id AND o.environment = p_environment
    )
    SELECT 1 FROM public.tokentracker_cloud_payments WHERE order_id IN (SELECT id FROM predecessors)
  ) THEN
    RAISE EXCEPTION ''a paid Waffo order cannot be restarted'';
  END IF;
  IF v_order.retry_order_id IS NOT NULL THEN
    SELECT * INTO STRICT v_next FROM public.tokentracker_cloud_orders
      WHERE id = v_order.retry_order_id AND user_id = p_user_id AND environment = p_environment;
    RETURN jsonb_build_object(''order'',to_jsonb(v_next),''reused'',true);
  END IF;
  IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_orders
    WHERE user_id = p_user_id AND environment = p_environment AND request_id = p_request_id) THEN
    RAISE EXCEPTION ''retry request already belongs to another order'';
  END IF;
  UPDATE public.tokentracker_cloud_orders SET status = ''closed'',
    waffo_order_id = coalesce(waffo_order_id,p_waffo_order_id) WHERE id = p_order_id;
  v_next_id := (public.cloud_create_order(p_user_id,p_environment,''waffo'',v_order.sku,p_request_id)->>''id'')::uuid;
  SELECT * INTO STRICT v_next FROM public.tokentracker_cloud_orders WHERE id = v_next_id;
  UPDATE public.tokentracker_cloud_orders SET retry_order_id = v_next.id WHERE id = p_order_id;
  RETURN jsonb_build_object(''order'',to_jsonb(v_next),''reused'',false);
END;
$fn$;

REVOKE ALL ON FUNCTION public.cloud_restart_waffo_order(uuid,text,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cloud_restart_waffo_order(uuid,text,uuid,uuid,text) TO project_admin;

CREATE OR REPLACE FUNCTION public.cloud_claim_checkout(p_user_id uuid, p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql
SET search_path = public, pg_temp AS $fn$
DECLARE v_order public.tokentracker_cloud_orders%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_order FROM public.tokentracker_cloud_orders
    WHERE id = p_order_id AND user_id = p_user_id;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_order.user_id::text || '':'' || v_order.environment,0));
  SELECT * INTO STRICT v_order FROM public.tokentracker_cloud_orders
    WHERE id = p_order_id AND user_id = p_user_id FOR UPDATE;
  IF EXISTS (
    WITH RECURSIVE predecessors AS (
      SELECT id FROM public.tokentracker_cloud_orders
        WHERE retry_order_id = v_order.id AND user_id = p_user_id AND environment = v_order.environment
      UNION
      SELECT o.id FROM public.tokentracker_cloud_orders o JOIN predecessors p ON o.retry_order_id = p.id
        WHERE o.user_id = p_user_id AND o.environment = v_order.environment
    )
    SELECT 1 FROM public.tokentracker_cloud_payments WHERE order_id IN (SELECT id FROM predecessors)
  ) THEN
    RAISE EXCEPTION ''a previous retry order has a successful payment'';
  END IF;
  IF v_order.checkout_url IS NOT NULL OR v_order.checkout_attempts > 0 OR
    v_order.status <> ''pending'' OR v_order.expires_at <= clock_timestamp() THEN
    RETURN jsonb_build_object(''claimed'', false, ''order'', to_jsonb(v_order));
  END IF;
  IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_orders
    WHERE user_id = p_user_id AND environment = v_order.environment AND id <> v_order.id
      AND (v_order.billing_mode = ''recurring'' OR billing_mode = ''recurring'')
      AND status IN (''pending'',''ready'') AND checkout_attempts > 0) THEN
    RAISE EXCEPTION ''an existing checkout must be confirmed before another subscription'';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_subscriptions
    WHERE user_id = p_user_id AND environment = v_order.environment
      AND status IN (''active'',''trialing'',''past_due'',''paused'') AND NOT cancel_at_period_end) THEN
    RAISE EXCEPTION ''manage the existing subscription before purchasing another plan'';
  END IF;
  IF v_order.billing_mode = ''recurring'' THEN
    IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_payments
      WHERE user_id = p_user_id AND environment = v_order.environment
        AND refunded_cents < amount_cents AND ends_at > clock_timestamp()) THEN
      RAISE EXCEPTION ''the current fixed membership term must end before starting a subscription'';
    END IF;
  END IF;
  UPDATE public.tokentracker_cloud_orders
    SET checkout_attempts = checkout_attempts + 1, checkout_claimed_at = clock_timestamp()
    WHERE id = p_order_id RETURNING * INTO v_order;
  -- Ambiguous provider failures are reconciled, never retried as a new charge.
  RETURN jsonb_build_object(''claimed'', true, ''order'', to_jsonb(v_order));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.cloud_apply_event(
  p_provider text, p_environment text, p_event jsonb
) RETURNS jsonb LANGUAGE plpgsql
SET search_path = public, pg_temp AS $fn$
DECLARE
  v_order public.tokentracker_cloud_orders%ROWTYPE;
  v_payment public.tokentracker_cloud_payments%ROWTYPE;
  v_subscription public.tokentracker_cloud_subscriptions%ROWTYPE;
  v_event_id text := p_event->>''event_id'';
  v_kind text := p_event->>''kind'';
  v_action_id text := p_event->>''action_id'';
  v_occurred timestamptz := (p_event->>''occurred_at'')::timestamptz;
  v_start timestamptz;
  v_end timestamptz;
  v_subscription_id text := nullif(p_event->>''subscription_id'', '''');
  v_status text := ''applied'';
  v_amount integer;
  v_refund_total integer;
  v_waffo_order_id text := nullif(p_event->>''waffo_order_id'', '''');
  v_recurring boolean;
BEGIN
  IF v_event_id IS NULL OR v_event_id = '''' OR length(v_event_id) > 200 OR
    v_action_id IS NULL OR v_action_id = '''' OR length(v_action_id) > 200 OR
    v_kind NOT IN (''payment'', ''refund'', ''subscription'') OR v_kind IS NULL OR
    v_occurred IS NULL OR v_occurred > clock_timestamp() + interval ''5 minutes'' THEN
    RAISE EXCEPTION ''invalid normalized payment event'';
  END IF;
  SELECT * INTO STRICT v_order FROM public.tokentracker_cloud_orders
    WHERE id = (p_event->>''order_id'')::uuid;
  -- Also serialize separate orders which extend the same account''s paid term.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_order.user_id::text || '':'' || p_environment, 0));
  SELECT * INTO STRICT v_order FROM public.tokentracker_cloud_orders
    WHERE id = (p_event->>''order_id'')::uuid FOR UPDATE;
  IF v_order.provider <> p_provider OR v_order.environment <> p_environment THEN
    RAISE EXCEPTION ''payment event does not match the order provider or environment'';
  END IF;
  v_recurring := v_order.billing_mode = ''recurring'';
  IF p_provider = ''waffo'' THEN
    IF v_waffo_order_id IS NULL OR v_waffo_order_id !~ ''^ORD_[A-Za-z0-9]+$'' OR length(v_waffo_order_id) > 200 OR
      v_order.provider_price_id IS NULL OR p_event->>''provider_price_id'' IS DISTINCT FROM v_order.provider_price_id OR
      (v_order.waffo_order_id IS NOT NULL AND v_order.waffo_order_id <> v_waffo_order_id) THEN
      RAISE EXCEPTION ''Waffo event does not match the bound order or product'';
    END IF;
    IF (v_recurring AND v_subscription_id IS DISTINCT FROM v_waffo_order_id) OR
      (NOT v_recurring AND (v_subscription_id IS NOT NULL OR v_kind = ''subscription'')) THEN
      RAISE EXCEPTION ''Waffo subscription does not match the order billing mode'';
    END IF;
    IF (v_kind = ''payment'' AND v_action_id !~ ''^PAY_[A-Za-z0-9]+$'') OR
      (v_kind = ''refund'' AND (v_action_id !~ ''^(REF|RFD)_[A-Za-z0-9]+$'' OR
        coalesce(p_event->>''transaction_id'', '''') !~ ''^PAY_[A-Za-z0-9]+$'')) THEN
      RAISE EXCEPTION ''invalid Waffo payment or refund identity'';
    END IF;
    UPDATE public.tokentracker_cloud_orders SET waffo_order_id = coalesce(waffo_order_id, v_waffo_order_id)
      WHERE id = v_order.id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_events
    WHERE provider = p_provider AND environment = p_environment AND event_id = v_event_id) THEN
    IF NOT EXISTS (SELECT 1 FROM public.tokentracker_cloud_events
      WHERE provider = p_provider AND environment = p_environment AND event_id = v_event_id
        AND normalized_event = p_event AND order_id = v_order.id) THEN
      RAISE EXCEPTION ''event identifier was already used for different payment data'';
    END IF;
    RETURN jsonb_build_object(''applied'', false, ''duplicate'', true,
      ''retry_payment_conflict'', (SELECT retry_payment_conflict_at IS NOT NULL
        FROM public.tokentracker_cloud_orders WHERE id = v_order.id));
  END IF;
  INSERT INTO public.tokentracker_cloud_events
    (provider, environment, event_id, kind, action_id, order_id, occurred_at, normalized_event)
    VALUES (p_provider, p_environment, v_event_id, v_kind, v_action_id, v_order.id, v_occurred, p_event);
  IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_events
    WHERE provider = p_provider AND environment = p_environment AND kind = v_kind
      AND action_id = v_action_id AND status = ''applied'' AND kind IN (''payment'', ''refund'')) THEN
    IF NOT EXISTS (SELECT 1 FROM public.tokentracker_cloud_events
      WHERE provider = p_provider AND environment = p_environment AND kind = v_kind
        AND action_id = v_action_id AND status = ''applied'' AND order_id = v_order.id
        AND normalized_event - ARRAY[''event_id'',''occurred_at''] = p_event - ARRAY[''event_id'',''occurred_at'']) THEN
      RAISE EXCEPTION ''payment action was already applied to different payment data'';
    END IF;
    v_status := ''duplicate'';
  ELSIF v_kind = ''payment'' THEN
    IF p_event->>''currency'' IS DISTINCT FROM v_order.currency OR
      (p_event->>''base_amount_cents'')::integer IS DISTINCT FROM v_order.amount_cents THEN
      RAISE EXCEPTION ''payment amount or currency does not match the order'';
    END IF;
    v_amount := (p_event->>''amount_cents'')::integer;
    IF v_amount IS NULL OR v_amount < v_order.amount_cents OR
      (p_provider NOT IN (''paddle'',''waffo'') AND v_amount <> v_order.amount_cents) THEN
      RAISE EXCEPTION ''invalid paid amount'';
    END IF;
    IF v_recurring THEN
      IF v_order.provider_order_id IS NOT NULL AND v_order.provider_order_id <> v_action_id
        AND (v_subscription_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM public.tokentracker_cloud_subscriptions
          WHERE provider = p_provider AND environment = p_environment
            AND provider_subscription_id = v_subscription_id
            AND user_id = v_order.user_id AND order_id = v_order.id
        )) THEN RAISE EXCEPTION ''unrecognized subscription renewal''; END IF;
      v_start := (p_event->>''starts_at'')::timestamptz;
      v_end := (p_event->>''ends_at'')::timestamptz;
      IF v_subscription_id IS NULL OR v_start IS NULL OR v_end IS NULL OR
        v_end <= v_start OR v_end > v_start + make_interval(months => v_order.term_months) + interval ''1 day'' OR
        v_end < v_start + make_interval(months => v_order.term_months) - interval ''1 day'' THEN
        RAISE EXCEPTION ''invalid subscription billing period'';
      END IF;
      IF p_provider = ''waffo'' AND NOT EXISTS (
        SELECT 1 FROM public.tokentracker_cloud_waffo_periods
        WHERE order_id = v_order.id AND environment = p_environment AND waffo_order_id = v_waffo_order_id
          AND period_number = (p_event->>''period_number'')::integer AND starts_at = v_start AND ends_at = v_end
      ) THEN
        RAISE EXCEPTION ''Waffo payment does not match a verified subscription billing period'';
      END IF;
      SELECT * INTO v_subscription FROM public.tokentracker_cloud_subscriptions
        WHERE provider = p_provider AND environment = p_environment
          AND provider_subscription_id = v_subscription_id FOR UPDATE;
      IF FOUND AND (v_subscription.user_id <> v_order.user_id OR v_subscription.order_id <> v_order.id) THEN
        RAISE EXCEPTION ''subscription belongs to a different account or order'';
      END IF;
      INSERT INTO public.tokentracker_cloud_subscriptions
        (provider, environment, provider_subscription_id, user_id, order_id, status, last_event_at,next_billed_at)
        VALUES (p_provider, p_environment, v_subscription_id, v_order.user_id, v_order.id, ''active'', v_occurred,v_end)
        ON CONFLICT (provider, environment, provider_subscription_id) DO UPDATE SET
          next_billed_at=CASE WHEN tokentracker_cloud_subscriptions.status IN (''active'',''trialing'',''past_due'')
            AND NOT tokentracker_cloud_subscriptions.cancel_at_period_end
            THEN greatest(tokentracker_cloud_subscriptions.next_billed_at,excluded.next_billed_at)
            ELSE tokentracker_cloud_subscriptions.next_billed_at END;
    ELSE
      IF v_order.provider_order_id IS NOT NULL AND v_order.provider_order_id <> v_action_id THEN
        RAISE EXCEPTION ''payment transaction does not match the order'';
      END IF;
      SELECT greatest(clock_timestamp(), max(ends_at)) INTO v_start
        FROM public.tokentracker_cloud_payments WHERE user_id = v_order.user_id
          AND environment = p_environment AND refunded_cents < amount_cents;
      v_end := v_start + make_interval(months => v_order.term_months);
    END IF;
    INSERT INTO public.tokentracker_cloud_payments
      (order_id, user_id, provider, environment, transaction_id, subscription_id,
        currency, amount_cents, starts_at, ends_at, paid_at)
      VALUES (v_order.id, v_order.user_id, p_provider, p_environment, v_action_id, v_subscription_id,
        v_order.currency, v_amount, v_start, v_end, v_occurred);
    UPDATE public.tokentracker_cloud_orders SET status = ''paid'',
      provider_order_id = coalesce(provider_order_id, v_action_id) WHERE id = v_order.id;
  ELSIF v_kind = ''refund'' THEN
    SELECT * INTO STRICT v_payment FROM public.tokentracker_cloud_payments
      WHERE provider = p_provider AND environment = p_environment
        AND transaction_id = p_event->>''transaction_id'' FOR UPDATE;
    IF v_payment.order_id <> v_order.id OR v_payment.user_id <> v_order.user_id OR
      p_event->>''currency'' IS DISTINCT FROM v_payment.currency THEN
      RAISE EXCEPTION ''refund does not match the paid order'';
    END IF;
    IF p_event ? ''refund_total_cents'' THEN
      IF p_provider <> ''alipay'' THEN RAISE EXCEPTION ''invalid cumulative refund provider''; END IF;
      v_refund_total := (p_event->>''refund_total_cents'')::integer;
      IF v_refund_total IS NULL OR v_refund_total <= 0 OR v_refund_total > v_payment.amount_cents OR
        v_refund_total IS DISTINCT FROM (p_event->>''amount_cents'')::integer THEN
        RAISE EXCEPTION ''invalid refund amount'';
      END IF;
      IF v_refund_total <= v_payment.refunded_cents THEN v_status := ''outdated''; END IF;
    ELSE
      v_amount := (p_event->>''amount_cents'')::integer;
      IF v_amount IS NULL OR v_amount <= 0 OR
        v_payment.refunded_cents + v_amount > v_payment.amount_cents THEN
        RAISE EXCEPTION ''invalid refund amount'';
      END IF;
      v_refund_total := v_payment.refunded_cents + v_amount;
    END IF;
    IF v_status = ''applied'' THEN
      UPDATE public.tokentracker_cloud_payments SET refunded_cents = v_refund_total,
        revoked_at = CASE WHEN v_refund_total = amount_cents THEN clock_timestamp() ELSE revoked_at END
        WHERE id = v_payment.id;
    END IF;
  ELSE
    IF NOT v_recurring OR v_subscription_id IS NULL OR
      p_event->>''status'' IS NULL OR p_event->>''status'' NOT IN
        (''active'', ''canceled'', ''past_due'', ''paused'', ''trialing'') THEN
      RAISE EXCEPTION ''invalid subscription event'';
    END IF;
    SELECT * INTO v_subscription FROM public.tokentracker_cloud_subscriptions
      WHERE provider = p_provider AND environment = p_environment
        AND provider_subscription_id = v_subscription_id FOR UPDATE;
    IF FOUND AND (v_subscription.user_id <> v_order.user_id OR v_subscription.order_id <> v_order.id) THEN
      RAISE EXCEPTION ''subscription belongs to a different account or order'';
    END IF;
    IF FOUND AND v_subscription.last_event_at >= v_occurred THEN
      v_status := ''outdated'';
    ELSE
      INSERT INTO public.tokentracker_cloud_subscriptions
        (provider, environment, provider_subscription_id, user_id, order_id, status,
          cancel_at_period_end, last_event_at,next_billed_at)
        VALUES (p_provider, p_environment, v_subscription_id, v_order.user_id, v_order.id,
          p_event->>''status'', coalesce((p_event->>''cancel_at_period_end'')::boolean, false), v_occurred,
          (p_event->>''next_billed_at'')::timestamptz)
        ON CONFLICT (provider, environment, provider_subscription_id) DO UPDATE
          SET status = excluded.status, cancel_at_period_end = excluded.cancel_at_period_end,
            last_event_at = excluded.last_event_at,next_billed_at=excluded.next_billed_at;
    END IF;
  END IF;
  UPDATE public.tokentracker_cloud_events SET status = v_status
    WHERE provider = p_provider AND environment = p_environment AND event_id = v_event_id;
  RETURN jsonb_build_object(''applied'', v_status = ''applied'', ''status'', v_status,
    ''retry_payment_conflict'', (SELECT retry_payment_conflict_at IS NOT NULL
      FROM public.tokentracker_cloud_orders WHERE id = v_order.id),
    ''membership'', public.cloud_membership(v_order.user_id, p_environment));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.cloud_detect_waffo_retry_payment_conflict()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public, pg_temp AS $fn$
DECLARE v_chain uuid[]; v_descendants uuid[];
BEGIN
  IF NEW.provider <> ''waffo'' THEN RETURN NEW; END IF;
  WITH RECURSIVE edges AS (
    SELECT id AS origin, retry_order_id AS target FROM public.tokentracker_cloud_orders
      WHERE user_id = NEW.user_id AND environment = NEW.environment AND retry_order_id IS NOT NULL
    UNION ALL
    SELECT retry_order_id AS origin, id AS target FROM public.tokentracker_cloud_orders
      WHERE user_id = NEW.user_id AND environment = NEW.environment AND retry_order_id IS NOT NULL
  ), chain AS (
    SELECT NEW.order_id AS id
    UNION
    SELECT e.target FROM edges e JOIN chain c ON e.origin = c.id
  ) SELECT array_agg(id) INTO v_chain FROM chain;
  WITH RECURSIVE descendants AS (
    SELECT retry_order_id AS id FROM public.tokentracker_cloud_orders
      WHERE id = NEW.order_id AND retry_order_id IS NOT NULL
    UNION
    SELECT o.retry_order_id FROM public.tokentracker_cloud_orders o JOIN descendants d ON o.id = d.id
      WHERE o.user_id = NEW.user_id AND o.environment = NEW.environment AND o.retry_order_id IS NOT NULL
  ) SELECT array_agg(id) INTO v_descendants FROM descendants;
  IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_orders
      WHERE id = ANY(v_descendants) AND checkout_attempts > 0) OR
    EXISTS (SELECT 1 FROM public.tokentracker_cloud_payments
      WHERE user_id = NEW.user_id AND environment = NEW.environment
        AND order_id = ANY(v_chain) AND order_id <> NEW.order_id) THEN
    -- Keep both real payments; expose the conflict for provider reconciliation and refund review.
    UPDATE public.tokentracker_cloud_orders
      SET retry_payment_conflict_at = coalesce(retry_payment_conflict_at,clock_timestamp()) WHERE id = ANY(v_chain);
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER cloud_waffo_retry_payment_conflict
  AFTER INSERT ON public.tokentracker_cloud_payments FOR EACH ROW
  EXECUTE FUNCTION public.cloud_detect_waffo_retry_payment_conflict();
REVOKE ALL ON FUNCTION public.cloud_detect_waffo_retry_payment_conflict() FROM PUBLIC, anon, authenticated;
';
        INSERT INTO public.tokentracker_self_host_installations(step,checksum) VALUES ('20261007130000_cloud-waffo-retry','ad42488cbf8279f98e269067cbfa270c692fb171bbf66d9e2350f8c6341c1a37');
      END IF;
    END $install$;

DO $install$ DECLARE v_checksum text; BEGIN
      SELECT checksum INTO v_checksum FROM public.tokentracker_self_host_installations WHERE step = '20261007140000_cloud-waffo-attempts';
      IF FOUND AND v_checksum <> 'ad0986bc74bd4840247c898667783fd8153238262ecce0e27865bb7c9311b946' THEN RAISE EXCEPTION 'Installed step has changed: %','20261007140000_cloud-waffo-attempts'; END IF;
      IF NOT FOUND THEN
        EXECUTE '-- Waffo may replace its ORD after checkout Back while retaining our application order UUID.
-- Register every independently verified attempt; only a real payment chooses the canonical ORD.
CREATE TABLE public.tokentracker_cloud_waffo_attempts (
  order_id uuid NOT NULL REFERENCES public.tokentracker_cloud_orders(id),
  environment text NOT NULL REFERENCES public.tokentracker_cloud_policy(environment),
  waffo_order_id text NOT NULL CHECK (waffo_order_id ~ ''^ORD_[A-Za-z0-9]+$'' AND length(waffo_order_id) <= 200),
  provider_price_id text NOT NULL CHECK (provider_price_id <> '''' AND length(provider_price_id) <= 200),
  billing_mode text NOT NULL CHECK (billing_mode IN (''fixed'',''recurring'')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (environment,waffo_order_id),
  UNIQUE (order_id,environment,waffo_order_id)
);
CREATE INDEX tokentracker_cloud_waffo_attempts_order_idx ON public.tokentracker_cloud_waffo_attempts(order_id);
ALTER TABLE public.tokentracker_cloud_waffo_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tokentracker_cloud_waffo_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.tokentracker_cloud_waffo_attempts TO project_admin;
INSERT INTO public.tokentracker_cloud_waffo_attempts (order_id,environment,waffo_order_id,provider_price_id,billing_mode)
  SELECT id,environment,waffo_order_id,provider_price_id,billing_mode FROM public.tokentracker_cloud_orders
    WHERE provider = ''waffo'' AND waffo_order_id IS NOT NULL AND provider_price_id IS NOT NULL
  UNION
  SELECT p.order_id,p.environment,p.waffo_order_id,o.provider_price_id,o.billing_mode
    FROM public.tokentracker_cloud_waffo_periods p JOIN public.tokentracker_cloud_orders o ON o.id = p.order_id
  UNION
  SELECT s.order_id,s.environment,s.provider_subscription_id,o.provider_price_id,o.billing_mode
    FROM public.tokentracker_cloud_subscriptions s JOIN public.tokentracker_cloud_orders o ON o.id = s.order_id
    WHERE s.provider = ''waffo''
  UNION
  SELECT e.order_id,e.environment,e.normalized_event->>''waffo_order_id'',o.provider_price_id,o.billing_mode
    FROM public.tokentracker_cloud_events e JOIN public.tokentracker_cloud_orders o ON o.id = e.order_id
    WHERE e.provider = ''waffo'' AND e.normalized_event->>''waffo_order_id'' IS NOT NULL
  ON CONFLICT (environment,waffo_order_id) DO NOTHING;
ALTER TABLE public.tokentracker_cloud_payments ADD COLUMN waffo_order_id text;
UPDATE public.tokentracker_cloud_payments p SET waffo_order_id = coalesce(
  (SELECT e.normalized_event->>''waffo_order_id'' FROM public.tokentracker_cloud_events e
    WHERE e.provider = ''waffo'' AND e.environment = p.environment AND e.order_id = p.order_id
      AND e.kind = ''payment'' AND e.action_id = p.transaction_id AND e.status = ''applied''
    ORDER BY e.received_at LIMIT 1),
  p.subscription_id,(SELECT o.waffo_order_id FROM public.tokentracker_cloud_orders o WHERE o.id = p.order_id))
  WHERE p.provider = ''waffo'';
ALTER TABLE public.tokentracker_cloud_payments
  ADD CONSTRAINT tokentracker_cloud_payments_waffo_attempt_check CHECK (provider <> ''waffo'' OR waffo_order_id IS NOT NULL),
  ADD CONSTRAINT tokentracker_cloud_payments_waffo_attempt_fkey FOREIGN KEY (order_id,environment,waffo_order_id)
    REFERENCES public.tokentracker_cloud_waffo_attempts(order_id,environment,waffo_order_id);
ALTER TABLE public.tokentracker_cloud_waffo_periods
  DROP CONSTRAINT tokentracker_cloud_waffo_periods_pkey,
  ADD PRIMARY KEY (order_id,waffo_order_id,period_number),
  ADD CONSTRAINT tokentracker_cloud_waffo_periods_attempt_fkey FOREIGN KEY (order_id,environment,waffo_order_id)
    REFERENCES public.tokentracker_cloud_waffo_attempts(order_id,environment,waffo_order_id);
UPDATE public.tokentracker_cloud_orders o SET waffo_order_id = (
  SELECT p.waffo_order_id FROM public.tokentracker_cloud_payments p WHERE p.order_id = o.id AND p.provider = ''waffo''
    ORDER BY CASE WHEN p.transaction_id = o.provider_order_id THEN 0 ELSE 1 END,p.paid_at,p.id LIMIT 1
) WHERE o.provider = ''waffo'';


CREATE OR REPLACE FUNCTION public.cloud_register_waffo_attempt(
  p_order_id uuid,p_environment text,p_waffo_order_id text,p_provider_price_id text,p_billing_mode text
) RETURNS jsonb LANGUAGE plpgsql
SET search_path = public, pg_temp AS $fn$
DECLARE v_order public.tokentracker_cloud_orders%ROWTYPE; v_attempt public.tokentracker_cloud_waffo_attempts%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_order FROM public.tokentracker_cloud_orders WHERE id = p_order_id;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_order.user_id::text || '':'' || p_environment,0));
  SELECT * INTO STRICT v_order FROM public.tokentracker_cloud_orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.provider <> ''waffo'' OR v_order.environment IS DISTINCT FROM p_environment OR
    p_waffo_order_id IS NULL OR p_waffo_order_id !~ ''^ORD_[A-Za-z0-9]+$'' OR length(p_waffo_order_id) > 200 OR
    v_order.provider_price_id IS NULL OR v_order.provider_price_id IS DISTINCT FROM p_provider_price_id OR
    v_order.billing_mode IS DISTINCT FROM p_billing_mode THEN
    RAISE EXCEPTION ''Waffo attempt does not match the bound order, product, or billing mode'';
  END IF;
  SELECT * INTO v_attempt FROM public.tokentracker_cloud_waffo_attempts
    WHERE environment = p_environment AND waffo_order_id = p_waffo_order_id FOR UPDATE;
  IF FOUND AND (v_attempt.order_id <> p_order_id OR v_attempt.provider_price_id <> p_provider_price_id OR
    v_attempt.billing_mode <> p_billing_mode) THEN
    RAISE EXCEPTION ''Waffo attempt belongs to a different order, product, or billing mode'';
  END IF;
  INSERT INTO public.tokentracker_cloud_waffo_attempts(order_id,environment,waffo_order_id,provider_price_id,billing_mode)
    VALUES (p_order_id,p_environment,p_waffo_order_id,p_provider_price_id,p_billing_mode)
    ON CONFLICT (environment,waffo_order_id) DO UPDATE SET last_seen_at = clock_timestamp()
      WHERE tokentracker_cloud_waffo_attempts.order_id = excluded.order_id
        AND tokentracker_cloud_waffo_attempts.provider_price_id = excluded.provider_price_id
        AND tokentracker_cloud_waffo_attempts.billing_mode = excluded.billing_mode
    RETURNING * INTO STRICT v_attempt;
  RETURN to_jsonb(v_attempt);
END;
$fn$;
REVOKE ALL ON FUNCTION public.cloud_register_waffo_attempt(uuid,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cloud_register_waffo_attempt(uuid,text,text,text,text) TO project_admin;


CREATE OR REPLACE FUNCTION public.cloud_record_waffo_period(
  p_order_id uuid, p_environment text, p_waffo_order_id text, p_provider_price_id text,
  p_period_number integer, p_starts_at timestamptz, p_ends_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql
SET search_path = public, pg_temp AS $fn$
DECLARE v_order public.tokentracker_cloud_orders%ROWTYPE; v_period public.tokentracker_cloud_waffo_periods%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_order FROM public.tokentracker_cloud_orders WHERE id = p_order_id;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_order.user_id::text || '':'' || p_environment, 0));
  SELECT * INTO STRICT v_order FROM public.tokentracker_cloud_orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.provider <> ''waffo'' OR v_order.environment <> p_environment OR v_order.billing_mode <> ''recurring'' OR
    p_waffo_order_id IS NULL OR p_waffo_order_id !~ ''^ORD_[A-Za-z0-9]+$'' OR length(p_waffo_order_id) > 200 OR
    v_order.provider_price_id IS NULL OR p_provider_price_id IS DISTINCT FROM v_order.provider_price_id OR
    NOT EXISTS (SELECT 1 FROM public.tokentracker_cloud_waffo_attempts
      WHERE order_id = p_order_id AND environment = p_environment AND waffo_order_id = p_waffo_order_id
        AND provider_price_id = p_provider_price_id AND billing_mode = ''recurring'') THEN
    RAISE EXCEPTION ''Waffo billing period does not match the bound order or product'';
  END IF;
  IF p_period_number IS NULL OR p_period_number <= 0 OR p_starts_at IS NULL OR p_ends_at IS NULL OR
    NOT isfinite(p_starts_at) OR NOT isfinite(p_ends_at) OR p_ends_at <= p_starts_at OR
    p_ends_at > p_starts_at + make_interval(months => v_order.term_months) + interval ''1 day'' OR
    p_ends_at < p_starts_at + make_interval(months => v_order.term_months) - interval ''1 day'' THEN
    RAISE EXCEPTION ''invalid Waffo subscription billing period'';
  END IF;
  SELECT * INTO v_period FROM public.tokentracker_cloud_waffo_periods
    WHERE order_id = p_order_id AND waffo_order_id = p_waffo_order_id AND period_number = p_period_number FOR UPDATE;
  IF FOUND THEN
    IF v_period.environment <> p_environment OR v_period.waffo_order_id <> p_waffo_order_id OR
      v_period.starts_at <> p_starts_at OR v_period.ends_at <> p_ends_at THEN
      RAISE EXCEPTION ''Waffo billing period is already bound to different dates'';
    END IF;
  ELSE
    INSERT INTO public.tokentracker_cloud_waffo_periods
      (order_id, environment, waffo_order_id, period_number, starts_at, ends_at)
      VALUES (p_order_id, p_environment, p_waffo_order_id, p_period_number, p_starts_at, p_ends_at)
      RETURNING * INTO v_period;
  END IF;
  -- A verified lifecycle period is evidence for future payments, never paid access.
  RETURN to_jsonb(v_period);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.cloud_create_order(
  p_user_id uuid, p_environment text, p_provider text, p_sku text, p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql
SET search_path = public, pg_temp AS $fn$
DECLARE
  v_catalog public.tokentracker_cloud_catalog%ROWTYPE;
  v_order public.tokentracker_cloud_orders%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || '':'' || p_environment, 0));
  SELECT * INTO v_order FROM public.tokentracker_cloud_orders
    WHERE user_id = p_user_id AND environment = p_environment AND request_id = p_request_id;
  IF FOUND THEN
    IF v_order.provider <> p_provider OR v_order.sku <> p_sku THEN
      RAISE EXCEPTION ''idempotency request belongs to a different purchase'';
    END IF;
    RETURN to_jsonb(v_order);
  END IF;
  IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_orders
    WHERE user_id = p_user_id AND environment = p_environment AND retry_payment_conflict_at IS NOT NULL) THEN
    RAISE EXCEPTION ''a payment conflict must be resolved before another purchase'';
  END IF;
  SELECT * INTO STRICT v_catalog FROM public.tokentracker_cloud_catalog WHERE sku = p_sku;
  IF NOT v_catalog.active THEN RAISE EXCEPTION ''the requested product is no longer available''; END IF;
  IF (p_provider = ''paddle'' AND (v_catalog.currency <> ''USD'' OR v_catalog.billing_mode <> ''recurring'')) OR
     (p_provider IN (''wechat'', ''alipay'') AND (v_catalog.currency <> ''CNY'' OR v_catalog.billing_mode <> ''fixed'')) THEN
    RAISE EXCEPTION ''payment provider does not support this currency'';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_subscriptions
    WHERE user_id = p_user_id AND environment = p_environment
      AND status IN (''active'', ''trialing'', ''past_due'', ''paused'') AND NOT cancel_at_period_end) THEN
    RAISE EXCEPTION ''manage the existing subscription before purchasing another plan'';
  END IF;
  IF v_catalog.billing_mode = ''recurring'' AND EXISTS (SELECT 1 FROM public.tokentracker_cloud_payments
    WHERE user_id = p_user_id AND environment = p_environment
      AND refunded_cents < amount_cents AND ends_at > clock_timestamp()) THEN
    RAISE EXCEPTION ''the current fixed membership term must end before starting a subscription'';
  END IF;
  INSERT INTO public.tokentracker_cloud_orders
    (user_id, environment, request_id, provider, sku, currency, amount_cents, term_months, billing_mode)
    VALUES (p_user_id, p_environment, p_request_id, p_provider, p_sku,
      v_catalog.currency, v_catalog.amount_cents, v_catalog.term_months, v_catalog.billing_mode)
    RETURNING * INTO v_order;
  RETURN to_jsonb(v_order);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.cloud_claim_checkout(p_user_id uuid, p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql
SET search_path = public, pg_temp AS $fn$
DECLARE v_order public.tokentracker_cloud_orders%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_order FROM public.tokentracker_cloud_orders
    WHERE id = p_order_id AND user_id = p_user_id;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_order.user_id::text || '':'' || v_order.environment,0));
  SELECT * INTO STRICT v_order FROM public.tokentracker_cloud_orders
    WHERE id = p_order_id AND user_id = p_user_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_orders
    WHERE user_id = p_user_id AND environment = v_order.environment AND retry_payment_conflict_at IS NOT NULL) THEN
    RAISE EXCEPTION ''a payment conflict must be resolved before another purchase'';
  END IF;
  IF EXISTS (
    WITH RECURSIVE predecessors AS (
      SELECT id FROM public.tokentracker_cloud_orders
        WHERE retry_order_id = v_order.id AND user_id = p_user_id AND environment = v_order.environment
      UNION
      SELECT o.id FROM public.tokentracker_cloud_orders o JOIN predecessors p ON o.retry_order_id = p.id
        WHERE o.user_id = p_user_id AND o.environment = v_order.environment
    )
    SELECT 1 FROM public.tokentracker_cloud_payments WHERE order_id IN (SELECT id FROM predecessors)
  ) THEN
    RAISE EXCEPTION ''a previous retry order has a successful payment'';
  END IF;
  IF v_order.checkout_url IS NOT NULL OR v_order.checkout_attempts > 0 OR
    v_order.status <> ''pending'' OR v_order.expires_at <= clock_timestamp() THEN
    RETURN jsonb_build_object(''claimed'', false, ''order'', to_jsonb(v_order));
  END IF;
  IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_orders
    WHERE user_id = p_user_id AND environment = v_order.environment AND id <> v_order.id
      AND (v_order.billing_mode = ''recurring'' OR billing_mode = ''recurring'')
      AND status IN (''pending'',''ready'') AND checkout_attempts > 0) THEN
    RAISE EXCEPTION ''an existing checkout must be confirmed before another subscription'';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_subscriptions
    WHERE user_id = p_user_id AND environment = v_order.environment
      AND status IN (''active'',''trialing'',''past_due'',''paused'') AND NOT cancel_at_period_end) THEN
    RAISE EXCEPTION ''manage the existing subscription before purchasing another plan'';
  END IF;
  IF v_order.billing_mode = ''recurring'' THEN
    IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_payments
      WHERE user_id = p_user_id AND environment = v_order.environment
        AND refunded_cents < amount_cents AND ends_at > clock_timestamp()) THEN
      RAISE EXCEPTION ''the current fixed membership term must end before starting a subscription'';
    END IF;
  END IF;
  UPDATE public.tokentracker_cloud_orders
    SET checkout_attempts = checkout_attempts + 1, checkout_claimed_at = clock_timestamp()
    WHERE id = p_order_id RETURNING * INTO v_order;
  -- Ambiguous provider failures are reconciled, never retried as a new charge.
  RETURN jsonb_build_object(''claimed'', true, ''order'', to_jsonb(v_order));
END;
$fn$;



CREATE OR REPLACE FUNCTION public.cloud_apply_event(
  p_provider text, p_environment text, p_event jsonb
) RETURNS jsonb LANGUAGE plpgsql
SET search_path = public, pg_temp AS $fn$
DECLARE
  v_order public.tokentracker_cloud_orders%ROWTYPE;
  v_payment public.tokentracker_cloud_payments%ROWTYPE;
  v_subscription public.tokentracker_cloud_subscriptions%ROWTYPE;
  v_event_id text := p_event->>''event_id'';
  v_kind text := p_event->>''kind'';
  v_action_id text := p_event->>''action_id'';
  v_occurred timestamptz := (p_event->>''occurred_at'')::timestamptz;
  v_start timestamptz;
  v_end timestamptz;
  v_subscription_id text := nullif(p_event->>''subscription_id'', '''');
  v_status text := ''applied'';
  v_amount integer;
  v_refund_total integer;
  v_waffo_order_id text := nullif(p_event->>''waffo_order_id'', '''');
  v_recurring boolean;
BEGIN
  IF v_event_id IS NULL OR v_event_id = '''' OR length(v_event_id) > 200 OR
    v_action_id IS NULL OR v_action_id = '''' OR length(v_action_id) > 200 OR
    v_kind NOT IN (''payment'', ''refund'', ''subscription'') OR v_kind IS NULL OR
    v_occurred IS NULL OR v_occurred > clock_timestamp() + interval ''5 minutes'' THEN
    RAISE EXCEPTION ''invalid normalized payment event'';
  END IF;
  SELECT * INTO STRICT v_order FROM public.tokentracker_cloud_orders
    WHERE id = (p_event->>''order_id'')::uuid;
  -- Also serialize separate orders which extend the same account''s paid term.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_order.user_id::text || '':'' || p_environment, 0));
  SELECT * INTO STRICT v_order FROM public.tokentracker_cloud_orders
    WHERE id = (p_event->>''order_id'')::uuid FOR UPDATE;
  IF v_order.provider <> p_provider OR v_order.environment <> p_environment THEN
    RAISE EXCEPTION ''payment event does not match the order provider or environment'';
  END IF;
  v_recurring := v_order.billing_mode = ''recurring'';
  IF p_provider = ''waffo'' THEN
    IF v_waffo_order_id IS NULL OR v_waffo_order_id !~ ''^ORD_[A-Za-z0-9]+$'' OR length(v_waffo_order_id) > 200 OR
      v_order.provider_price_id IS NULL OR p_event->>''provider_price_id'' IS DISTINCT FROM v_order.provider_price_id OR
      NOT EXISTS (SELECT 1 FROM public.tokentracker_cloud_waffo_attempts
        WHERE order_id = v_order.id AND environment = p_environment AND waffo_order_id = v_waffo_order_id
          AND provider_price_id = v_order.provider_price_id AND billing_mode = v_order.billing_mode) THEN
      RAISE EXCEPTION ''Waffo event does not match the bound order or product'';
    END IF;
    IF (v_recurring AND v_subscription_id IS DISTINCT FROM v_waffo_order_id) OR
      (NOT v_recurring AND (v_subscription_id IS NOT NULL OR v_kind = ''subscription'')) THEN
      RAISE EXCEPTION ''Waffo subscription does not match the order billing mode'';
    END IF;
    IF (v_kind = ''payment'' AND v_action_id !~ ''^PAY_[A-Za-z0-9]+$'') OR
      (v_kind = ''refund'' AND (v_action_id !~ ''^(REF|RFD)_[A-Za-z0-9]+$'' OR
        coalesce(p_event->>''transaction_id'', '''') !~ ''^PAY_[A-Za-z0-9]+$'')) THEN
      RAISE EXCEPTION ''invalid Waffo payment or refund identity'';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_events
    WHERE provider = p_provider AND environment = p_environment AND event_id = v_event_id) THEN
    IF NOT EXISTS (SELECT 1 FROM public.tokentracker_cloud_events
      WHERE provider = p_provider AND environment = p_environment AND event_id = v_event_id
        AND normalized_event = p_event AND order_id = v_order.id) THEN
      RAISE EXCEPTION ''event identifier was already used for different payment data'';
    END IF;
    RETURN jsonb_build_object(''applied'', false, ''duplicate'', true,
      ''retry_payment_conflict'', (SELECT retry_payment_conflict_at IS NOT NULL
        FROM public.tokentracker_cloud_orders WHERE id = v_order.id));
  END IF;
  INSERT INTO public.tokentracker_cloud_events
    (provider, environment, event_id, kind, action_id, order_id, occurred_at, normalized_event)
    VALUES (p_provider, p_environment, v_event_id, v_kind, v_action_id, v_order.id, v_occurred, p_event);
  IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_events
    WHERE provider = p_provider AND environment = p_environment AND kind = v_kind
      AND action_id = v_action_id AND status = ''applied'' AND kind IN (''payment'', ''refund'')) THEN
    IF NOT EXISTS (SELECT 1 FROM public.tokentracker_cloud_events
      WHERE provider = p_provider AND environment = p_environment AND kind = v_kind
        AND action_id = v_action_id AND status = ''applied'' AND order_id = v_order.id
        AND normalized_event - ARRAY[''event_id'',''occurred_at''] = p_event - ARRAY[''event_id'',''occurred_at'']) THEN
      RAISE EXCEPTION ''payment action was already applied to different payment data'';
    END IF;
    v_status := ''duplicate'';
  ELSIF v_kind = ''payment'' THEN
    IF p_event->>''currency'' IS DISTINCT FROM v_order.currency OR
      (p_event->>''base_amount_cents'')::integer IS DISTINCT FROM v_order.amount_cents THEN
      RAISE EXCEPTION ''payment amount or currency does not match the order'';
    END IF;
    v_amount := (p_event->>''amount_cents'')::integer;
    IF v_amount IS NULL OR v_amount < v_order.amount_cents OR
      (p_provider NOT IN (''paddle'',''waffo'') AND v_amount <> v_order.amount_cents) THEN
      RAISE EXCEPTION ''invalid paid amount'';
    END IF;
    IF v_recurring THEN
      IF p_provider = ''paddle'' AND v_order.provider_order_id IS NOT NULL AND v_order.provider_order_id <> v_action_id
        AND (v_subscription_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM public.tokentracker_cloud_subscriptions
          WHERE provider = p_provider AND environment = p_environment
            AND provider_subscription_id = v_subscription_id
            AND user_id = v_order.user_id AND order_id = v_order.id
        )) THEN RAISE EXCEPTION ''unrecognized subscription renewal''; END IF;
      v_start := (p_event->>''starts_at'')::timestamptz;
      v_end := (p_event->>''ends_at'')::timestamptz;
      IF v_subscription_id IS NULL OR v_start IS NULL OR v_end IS NULL OR
        v_end <= v_start OR v_end > v_start + make_interval(months => v_order.term_months) + interval ''1 day'' OR
        v_end < v_start + make_interval(months => v_order.term_months) - interval ''1 day'' THEN
        RAISE EXCEPTION ''invalid subscription billing period'';
      END IF;
      IF p_provider = ''waffo'' AND NOT EXISTS (
        SELECT 1 FROM public.tokentracker_cloud_waffo_periods
        WHERE order_id = v_order.id AND environment = p_environment AND waffo_order_id = v_waffo_order_id
          AND period_number = (p_event->>''period_number'')::integer AND starts_at = v_start AND ends_at = v_end
      ) THEN
        RAISE EXCEPTION ''Waffo payment does not match a verified subscription billing period'';
      END IF;
      SELECT * INTO v_subscription FROM public.tokentracker_cloud_subscriptions
        WHERE provider = p_provider AND environment = p_environment
          AND provider_subscription_id = v_subscription_id FOR UPDATE;
      IF FOUND AND (v_subscription.user_id <> v_order.user_id OR v_subscription.order_id <> v_order.id) THEN
        RAISE EXCEPTION ''subscription belongs to a different account or order'';
      END IF;
      INSERT INTO public.tokentracker_cloud_subscriptions
        (provider, environment, provider_subscription_id, user_id, order_id, status, last_event_at,next_billed_at)
        VALUES (p_provider, p_environment, v_subscription_id, v_order.user_id, v_order.id, ''active'', v_occurred,v_end)
        ON CONFLICT (provider, environment, provider_subscription_id) DO UPDATE SET
          next_billed_at=CASE WHEN tokentracker_cloud_subscriptions.status IN (''active'',''trialing'',''past_due'')
            AND NOT tokentracker_cloud_subscriptions.cancel_at_period_end
            THEN greatest(tokentracker_cloud_subscriptions.next_billed_at,excluded.next_billed_at)
            ELSE tokentracker_cloud_subscriptions.next_billed_at END;
    ELSE
      IF p_provider <> ''waffo'' AND v_order.provider_order_id IS NOT NULL AND v_order.provider_order_id <> v_action_id THEN
        RAISE EXCEPTION ''payment transaction does not match the order'';
      END IF;
      SELECT greatest(clock_timestamp(), max(ends_at)) INTO v_start
        FROM public.tokentracker_cloud_payments WHERE user_id = v_order.user_id
          AND environment = p_environment AND refunded_cents < amount_cents;
      v_end := v_start + make_interval(months => v_order.term_months);
    END IF;
    INSERT INTO public.tokentracker_cloud_payments
      (order_id, user_id, provider, environment, transaction_id, subscription_id,
        currency, amount_cents, starts_at, ends_at, paid_at, waffo_order_id)
      VALUES (v_order.id, v_order.user_id, p_provider, p_environment, v_action_id, v_subscription_id,
        v_order.currency, v_amount, v_start, v_end, v_occurred, CASE WHEN p_provider = ''waffo'' THEN v_waffo_order_id END);
    UPDATE public.tokentracker_cloud_orders SET status = ''paid'',
      provider_order_id = coalesce(provider_order_id, v_action_id),
      waffo_order_id = CASE WHEN p_provider = ''waffo'' THEN coalesce(waffo_order_id,v_waffo_order_id) ELSE waffo_order_id END
      WHERE id = v_order.id;
  ELSIF v_kind = ''refund'' THEN
    SELECT * INTO STRICT v_payment FROM public.tokentracker_cloud_payments
      WHERE provider = p_provider AND environment = p_environment
        AND transaction_id = p_event->>''transaction_id'' FOR UPDATE;
    IF v_payment.order_id <> v_order.id OR v_payment.user_id <> v_order.user_id OR
      p_event->>''currency'' IS DISTINCT FROM v_payment.currency OR
      (p_provider = ''waffo'' AND v_payment.waffo_order_id IS DISTINCT FROM v_waffo_order_id) THEN
      RAISE EXCEPTION ''refund does not match the paid order'';
    END IF;
    IF p_event ? ''refund_total_cents'' THEN
      IF p_provider <> ''alipay'' THEN RAISE EXCEPTION ''invalid cumulative refund provider''; END IF;
      v_refund_total := (p_event->>''refund_total_cents'')::integer;
      IF v_refund_total IS NULL OR v_refund_total <= 0 OR v_refund_total > v_payment.amount_cents OR
        v_refund_total IS DISTINCT FROM (p_event->>''amount_cents'')::integer THEN
        RAISE EXCEPTION ''invalid refund amount'';
      END IF;
      IF v_refund_total <= v_payment.refunded_cents THEN v_status := ''outdated''; END IF;
    ELSE
      v_amount := (p_event->>''amount_cents'')::integer;
      IF v_amount IS NULL OR v_amount <= 0 OR
        v_payment.refunded_cents + v_amount > v_payment.amount_cents THEN
        RAISE EXCEPTION ''invalid refund amount'';
      END IF;
      v_refund_total := v_payment.refunded_cents + v_amount;
    END IF;
    IF v_status = ''applied'' THEN
      UPDATE public.tokentracker_cloud_payments SET refunded_cents = v_refund_total,
        revoked_at = CASE WHEN v_refund_total = amount_cents THEN clock_timestamp() ELSE revoked_at END
        WHERE id = v_payment.id;
    END IF;
  ELSE
    IF NOT v_recurring OR v_subscription_id IS NULL OR
      p_event->>''status'' IS NULL OR p_event->>''status'' NOT IN
        (''active'', ''canceled'', ''past_due'', ''paused'', ''trialing'') THEN
      RAISE EXCEPTION ''invalid subscription event'';
    END IF;
    SELECT * INTO v_subscription FROM public.tokentracker_cloud_subscriptions
      WHERE provider = p_provider AND environment = p_environment
        AND provider_subscription_id = v_subscription_id FOR UPDATE;
    IF FOUND AND (v_subscription.user_id <> v_order.user_id OR v_subscription.order_id <> v_order.id) THEN
      RAISE EXCEPTION ''subscription belongs to a different account or order'';
    END IF;
    IF FOUND AND v_subscription.last_event_at >= v_occurred THEN
      v_status := ''outdated'';
    ELSE
      INSERT INTO public.tokentracker_cloud_subscriptions
        (provider, environment, provider_subscription_id, user_id, order_id, status,
          cancel_at_period_end, last_event_at,next_billed_at)
        VALUES (p_provider, p_environment, v_subscription_id, v_order.user_id, v_order.id,
          p_event->>''status'', coalesce((p_event->>''cancel_at_period_end'')::boolean, false), v_occurred,
          (p_event->>''next_billed_at'')::timestamptz)
        ON CONFLICT (provider, environment, provider_subscription_id) DO UPDATE
          SET status = excluded.status, cancel_at_period_end = excluded.cancel_at_period_end,
            last_event_at = excluded.last_event_at,next_billed_at=excluded.next_billed_at;
    END IF;
  END IF;
  UPDATE public.tokentracker_cloud_events SET status = v_status
    WHERE provider = p_provider AND environment = p_environment AND event_id = v_event_id;
  RETURN jsonb_build_object(''applied'', v_status = ''applied'', ''status'', v_status,
    ''retry_payment_conflict'', (SELECT retry_payment_conflict_at IS NOT NULL
      FROM public.tokentracker_cloud_orders WHERE id = v_order.id),
    ''membership'', public.cloud_membership(v_order.user_id, p_environment));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.cloud_detect_waffo_retry_payment_conflict()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public, pg_temp AS $fn$
DECLARE v_chain uuid[]; v_descendants uuid[];
BEGIN
  IF NEW.provider <> ''waffo'' THEN RETURN NEW; END IF;
  WITH RECURSIVE edges AS (
    SELECT id AS origin, retry_order_id AS target FROM public.tokentracker_cloud_orders
      WHERE user_id = NEW.user_id AND environment = NEW.environment AND retry_order_id IS NOT NULL
    UNION ALL
    SELECT retry_order_id AS origin, id AS target FROM public.tokentracker_cloud_orders
      WHERE user_id = NEW.user_id AND environment = NEW.environment AND retry_order_id IS NOT NULL
  ), chain AS (
    SELECT NEW.order_id AS id
    UNION
    SELECT e.target FROM edges e JOIN chain c ON e.origin = c.id
  ) SELECT array_agg(id) INTO v_chain FROM chain;
  WITH RECURSIVE descendants AS (
    SELECT retry_order_id AS id FROM public.tokentracker_cloud_orders
      WHERE id = NEW.order_id AND retry_order_id IS NOT NULL
    UNION
    SELECT o.retry_order_id FROM public.tokentracker_cloud_orders o JOIN descendants d ON o.id = d.id
      WHERE o.user_id = NEW.user_id AND o.environment = NEW.environment AND o.retry_order_id IS NOT NULL
  ) SELECT array_agg(id) INTO v_descendants FROM descendants;
  IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_payments p
      JOIN public.tokentracker_cloud_orders o ON o.id = p.order_id
      WHERE p.order_id = NEW.order_id AND p.id <> NEW.id
        AND (p.waffo_order_id IS DISTINCT FROM NEW.waffo_order_id OR o.billing_mode = ''fixed'')) OR
    EXISTS (SELECT 1 FROM public.tokentracker_cloud_orders
      WHERE id = ANY(v_descendants) AND checkout_attempts > 0) OR
    EXISTS (SELECT 1 FROM public.tokentracker_cloud_payments
      WHERE user_id = NEW.user_id AND environment = NEW.environment
        AND order_id = ANY(v_chain) AND order_id <> NEW.order_id) THEN
    -- Keep both real payments; expose the conflict for provider reconciliation and refund review.
    UPDATE public.tokentracker_cloud_orders
      SET retry_payment_conflict_at = coalesce(retry_payment_conflict_at,clock_timestamp()) WHERE id = ANY(v_chain);
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE OR REPLACE FUNCTION public.cloud_restart_waffo_attempts(
  p_user_id uuid, p_environment text, p_order_id uuid, p_request_id uuid, p_waffo_order_ids text[]
) RETURNS jsonb LANGUAGE plpgsql
SET search_path = public, pg_temp AS $fn$
DECLARE v_order public.tokentracker_cloud_orders%ROWTYPE; v_next public.tokentracker_cloud_orders%ROWTYPE; v_next_id uuid; v_given text[]; v_known text[];
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || '':'' || p_environment, 0));
  SELECT * INTO STRICT v_order FROM public.tokentracker_cloud_orders
    WHERE id = p_order_id AND user_id = p_user_id AND environment = p_environment FOR UPDATE;
  IF v_order.provider <> ''waffo'' OR v_order.status NOT IN (''pending'',''ready'',''closed'') OR
    p_request_id IS NULL OR v_order.provider_price_id IS NULL THEN
    RAISE EXCEPTION ''Waffo restart does not match the unpaid bound order'';
  END IF;
  IF p_waffo_order_ids IS NULL OR cardinality(p_waffo_order_ids) NOT BETWEEN 1 AND 1000 OR
    EXISTS (SELECT 1 FROM unnest(p_waffo_order_ids) x WHERE x IS NULL OR x !~ ''^ORD_[A-Za-z0-9]+$'' OR length(x) > 200) THEN
    RAISE EXCEPTION ''invalid verified Waffo attempt bundle'';
  END IF;
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_given FROM unnest(p_waffo_order_ids) x;
  SELECT array_agg(waffo_order_id ORDER BY waffo_order_id) INTO v_known
    FROM public.tokentracker_cloud_waffo_attempts WHERE order_id = p_order_id AND environment = p_environment;
  IF v_given IS DISTINCT FROM v_known OR EXISTS (SELECT 1 FROM public.tokentracker_cloud_waffo_attempts
    WHERE order_id = p_order_id AND environment = p_environment AND
      (provider_price_id <> v_order.provider_price_id OR billing_mode <> v_order.billing_mode)) THEN
    RAISE EXCEPTION ''Waffo restart requires the complete registered attempt bundle'';
  END IF;
  IF EXISTS (
    WITH RECURSIVE predecessors AS (
      SELECT id FROM public.tokentracker_cloud_orders WHERE id = p_order_id
      UNION
      SELECT o.id FROM public.tokentracker_cloud_orders o JOIN predecessors p ON o.retry_order_id = p.id
        WHERE o.user_id = p_user_id AND o.environment = p_environment
    )
    SELECT 1 FROM public.tokentracker_cloud_payments WHERE order_id IN (SELECT id FROM predecessors)
  ) THEN
    RAISE EXCEPTION ''a paid Waffo order cannot be restarted'';
  END IF;
  IF v_order.retry_order_id IS NOT NULL THEN
    SELECT * INTO STRICT v_next FROM public.tokentracker_cloud_orders
      WHERE id = v_order.retry_order_id AND user_id = p_user_id AND environment = p_environment;
    RETURN jsonb_build_object(''order'',to_jsonb(v_next),''reused'',true);
  END IF;
  IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_orders
    WHERE user_id = p_user_id AND environment = p_environment AND request_id = p_request_id) THEN
    RAISE EXCEPTION ''retry request already belongs to another order'';
  END IF;
  UPDATE public.tokentracker_cloud_orders SET status = ''closed'' WHERE id = p_order_id;
  v_next_id := (public.cloud_create_order(p_user_id,p_environment,''waffo'',v_order.sku,p_request_id)->>''id'')::uuid;
  SELECT * INTO STRICT v_next FROM public.tokentracker_cloud_orders WHERE id = v_next_id;
  UPDATE public.tokentracker_cloud_orders SET retry_order_id = v_next.id WHERE id = p_order_id;
  RETURN jsonb_build_object(''order'',to_jsonb(v_next),''reused'',false);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.cloud_restart_waffo_order(
  p_user_id uuid,p_environment text,p_order_id uuid,p_request_id uuid,p_waffo_order_id text
) RETURNS jsonb LANGUAGE plpgsql
SET search_path = public, pg_temp AS $fn$
BEGIN
  RETURN public.cloud_restart_waffo_attempts(p_user_id,p_environment,p_order_id,p_request_id,ARRAY[p_waffo_order_id]);
END;
$fn$;
REVOKE ALL ON FUNCTION public.cloud_restart_waffo_attempts(uuid,text,uuid,uuid,text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cloud_restart_waffo_attempts(uuid,text,uuid,uuid,text[]) TO project_admin;
';
        INSERT INTO public.tokentracker_self_host_installations(step,checksum) VALUES ('20261007140000_cloud-waffo-attempts','ad0986bc74bd4840247c898667783fd8153238262ecce0e27865bb7c9311b946');
      END IF;
    END $install$;

DO $install$ DECLARE v_checksum text; BEGIN
      SELECT checksum INTO v_checksum FROM public.tokentracker_self_host_installations WHERE step = '20261007150000_cloud-waffo-authorizations';
      IF FOUND AND v_checksum <> 'f54e4de4009d39e1f1356a5f9fd619fddd0055bf5d836f94cee452b720a799c2' THEN RAISE EXCEPTION 'Installed step has changed: %','20261007150000_cloud-waffo-authorizations'; END IF;
      IF NOT FOUND THEN
        EXECUTE '-- Channel card checks confirm an authorization, not a paid membership term.
CREATE TABLE public.tokentracker_cloud_waffo_authorizations (
  environment text NOT NULL,
  transaction_id text NOT NULL CHECK (transaction_id ~ ''^PAY_[A-Za-z0-9]+$'' AND length(transaction_id) <= 200),
  order_id uuid NOT NULL,
  waffo_order_id text NOT NULL,
  normalized_event jsonb NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (environment,transaction_id),
  FOREIGN KEY (order_id,environment,waffo_order_id)
    REFERENCES public.tokentracker_cloud_waffo_attempts(order_id,environment,waffo_order_id)
);
ALTER TABLE public.tokentracker_cloud_waffo_authorizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tokentracker_cloud_waffo_authorizations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.tokentracker_cloud_waffo_authorizations TO project_admin;

CREATE FUNCTION public.cloud_record_waffo_authorization(p_environment text,p_event jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
DECLARE
  v_order public.tokentracker_cloud_orders%ROWTYPE;
  v_stored public.tokentracker_cloud_waffo_authorizations%ROWTYPE;
  v_occurred timestamptz := (p_event->>''occurred_at'')::timestamptz;
BEGIN
  SELECT * INTO STRICT v_order FROM public.tokentracker_cloud_orders WHERE id = (p_event->>''order_id'')::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_order.user_id::text || '':'' || p_environment,0));
  SELECT * INTO STRICT v_order FROM public.tokentracker_cloud_orders WHERE id = v_order.id FOR UPDATE;
  IF v_order.provider <> ''waffo'' OR v_order.environment IS DISTINCT FROM p_environment OR
    v_order.billing_mode <> ''recurring'' OR p_event->>''kind'' IS DISTINCT FROM ''authorization'' OR
    p_event->>''currency'' IS DISTINCT FROM v_order.currency OR
    p_event->>''provider_price_id'' IS DISTINCT FROM v_order.provider_price_id OR
    p_event->>''subscription_id'' IS DISTINCT FROM p_event->>''waffo_order_id'' OR
    p_event->>''action_id'' IS DISTINCT FROM p_event->>''transaction_id'' OR
    coalesce(p_event->>''transaction_id'','''') !~ ''^PAY_[A-Za-z0-9]+$'' OR
    jsonb_typeof(p_event->''amount_cents'') IS DISTINCT FROM ''number'' OR p_event->>''amount_cents'' <> ''0'' OR
    jsonb_typeof(p_event->''period_number'') IS DISTINCT FROM ''number'' OR p_event->>''period_number'' <> ''0'' OR
    jsonb_typeof(p_event->''base_amount_cents'') IS DISTINCT FROM ''number'' OR
    (p_event->>''base_amount_cents'')::integer IS DISTINCT FROM v_order.amount_cents OR
    p_event ? ''starts_at'' OR p_event ? ''ends_at'' OR v_occurred IS NULL OR NOT isfinite(v_occurred) OR
    NOT EXISTS (SELECT 1 FROM public.tokentracker_cloud_waffo_attempts WHERE order_id = v_order.id
      AND environment = p_environment AND waffo_order_id = p_event->>''waffo_order_id''
      AND provider_price_id = v_order.provider_price_id AND billing_mode = ''recurring'') THEN
    RAISE EXCEPTION ''invalid Waffo zero-amount authorization'';
  END IF;
  INSERT INTO public.tokentracker_cloud_waffo_authorizations(environment,transaction_id,order_id,waffo_order_id,normalized_event)
    VALUES (p_environment,p_event->>''transaction_id'',v_order.id,p_event->>''waffo_order_id'',p_event)
    ON CONFLICT (environment,transaction_id) DO NOTHING;
  SELECT * INTO STRICT v_stored FROM public.tokentracker_cloud_waffo_authorizations
    WHERE environment = p_environment AND transaction_id = p_event->>''transaction_id'';
  IF v_stored.normalized_event IS DISTINCT FROM p_event THEN
    RAISE EXCEPTION ''Waffo authorization is already bound to different evidence'';
  END IF;
  RETURN jsonb_build_object(''verified'',true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.cloud_record_waffo_authorization(text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cloud_record_waffo_authorization(text,jsonb) TO project_admin;
';
        INSERT INTO public.tokentracker_self_host_installations(step,checksum) VALUES ('20261007150000_cloud-waffo-authorizations','f54e4de4009d39e1f1356a5f9fd619fddd0055bf5d836f94cee452b720a799c2');
      END IF;
    END $install$;

DO $install$ DECLARE v_checksum text; BEGIN
      SELECT checksum INTO v_checksum FROM public.tokentracker_self_host_installations WHERE step = '20261007160000_cloud-waffo-sandbox-periods';
      IF FOUND AND v_checksum <> '396bfab22c09a35a76510644e8ec002fa8ff48763104e1f86369c0c8b2af36d1' THEN RAISE EXCEPTION 'Installed step has changed: %','20261007160000_cloud-waffo-sandbox-periods'; END IF;
      IF NOT FOUND THEN
        EXECUTE '-- The Waffo test simulator can report a successful accelerated paid window.
-- Preserve its exact dates for sandbox accounting. Live purchased periods retain the full-term lower bound.
-- This does not turn collection grace or an authorization into a paid period.
CREATE OR REPLACE FUNCTION public.cloud_record_waffo_period(
  p_order_id uuid, p_environment text, p_waffo_order_id text, p_provider_price_id text,
  p_period_number integer, p_starts_at timestamptz, p_ends_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql
SET search_path = public, pg_temp AS $fn$
DECLARE v_order public.tokentracker_cloud_orders%ROWTYPE; v_period public.tokentracker_cloud_waffo_periods%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_order FROM public.tokentracker_cloud_orders WHERE id = p_order_id;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_order.user_id::text || '':'' || p_environment, 0));
  SELECT * INTO STRICT v_order FROM public.tokentracker_cloud_orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.provider <> ''waffo'' OR v_order.environment <> p_environment OR v_order.billing_mode <> ''recurring'' OR
    p_waffo_order_id IS NULL OR p_waffo_order_id !~ ''^ORD_[A-Za-z0-9]+$'' OR length(p_waffo_order_id) > 200 OR
    v_order.provider_price_id IS NULL OR p_provider_price_id IS DISTINCT FROM v_order.provider_price_id OR
    NOT EXISTS (SELECT 1 FROM public.tokentracker_cloud_waffo_attempts
      WHERE order_id = p_order_id AND environment = p_environment AND waffo_order_id = p_waffo_order_id
        AND provider_price_id = p_provider_price_id AND billing_mode = ''recurring'') THEN
    RAISE EXCEPTION ''Waffo billing period does not match the bound order or product'';
  END IF;
  IF p_period_number IS NULL OR p_period_number <= 0 OR p_starts_at IS NULL OR p_ends_at IS NULL OR
    NOT isfinite(p_starts_at) OR NOT isfinite(p_ends_at) OR p_ends_at <= p_starts_at OR
    p_ends_at > p_starts_at + make_interval(months => v_order.term_months) + interval ''1 day'' OR
    (p_environment <> ''sandbox'' AND p_ends_at < p_starts_at + make_interval(months => v_order.term_months) - interval ''1 day'') THEN
    RAISE EXCEPTION ''invalid Waffo subscription billing period'';
  END IF;
  SELECT * INTO v_period FROM public.tokentracker_cloud_waffo_periods
    WHERE order_id = p_order_id AND waffo_order_id = p_waffo_order_id AND period_number = p_period_number FOR UPDATE;
  IF FOUND THEN
    IF v_period.environment <> p_environment OR v_period.waffo_order_id <> p_waffo_order_id OR
      v_period.starts_at <> p_starts_at OR v_period.ends_at <> p_ends_at THEN
      RAISE EXCEPTION ''Waffo billing period is already bound to different dates'';
    END IF;
  ELSE
    INSERT INTO public.tokentracker_cloud_waffo_periods
      (order_id, environment, waffo_order_id, period_number, starts_at, ends_at)
      VALUES (p_order_id, p_environment, p_waffo_order_id, p_period_number, p_starts_at, p_ends_at)
      RETURNING * INTO v_period;
  END IF;
  -- A verified lifecycle period is evidence for future payments, never paid access.
  RETURN to_jsonb(v_period);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.cloud_apply_event(
  p_provider text, p_environment text, p_event jsonb
) RETURNS jsonb LANGUAGE plpgsql
SET search_path = public, pg_temp AS $fn$
DECLARE
  v_order public.tokentracker_cloud_orders%ROWTYPE;
  v_payment public.tokentracker_cloud_payments%ROWTYPE;
  v_subscription public.tokentracker_cloud_subscriptions%ROWTYPE;
  v_event_id text := p_event->>''event_id'';
  v_kind text := p_event->>''kind'';
  v_action_id text := p_event->>''action_id'';
  v_occurred timestamptz := (p_event->>''occurred_at'')::timestamptz;
  v_start timestamptz;
  v_end timestamptz;
  v_subscription_id text := nullif(p_event->>''subscription_id'', '''');
  v_status text := ''applied'';
  v_amount integer;
  v_refund_total integer;
  v_waffo_order_id text := nullif(p_event->>''waffo_order_id'', '''');
  v_recurring boolean;
BEGIN
  IF v_event_id IS NULL OR v_event_id = '''' OR length(v_event_id) > 200 OR
    v_action_id IS NULL OR v_action_id = '''' OR length(v_action_id) > 200 OR
    v_kind NOT IN (''payment'', ''refund'', ''subscription'') OR v_kind IS NULL OR
    v_occurred IS NULL OR v_occurred > clock_timestamp() + interval ''5 minutes'' THEN
    RAISE EXCEPTION ''invalid normalized payment event'';
  END IF;
  SELECT * INTO STRICT v_order FROM public.tokentracker_cloud_orders
    WHERE id = (p_event->>''order_id'')::uuid;
  -- Also serialize separate orders which extend the same account''s paid term.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_order.user_id::text || '':'' || p_environment, 0));
  SELECT * INTO STRICT v_order FROM public.tokentracker_cloud_orders
    WHERE id = (p_event->>''order_id'')::uuid FOR UPDATE;
  IF v_order.provider <> p_provider OR v_order.environment <> p_environment THEN
    RAISE EXCEPTION ''payment event does not match the order provider or environment'';
  END IF;
  v_recurring := v_order.billing_mode = ''recurring'';
  IF p_provider = ''waffo'' THEN
    IF v_waffo_order_id IS NULL OR v_waffo_order_id !~ ''^ORD_[A-Za-z0-9]+$'' OR length(v_waffo_order_id) > 200 OR
      v_order.provider_price_id IS NULL OR p_event->>''provider_price_id'' IS DISTINCT FROM v_order.provider_price_id OR
      NOT EXISTS (SELECT 1 FROM public.tokentracker_cloud_waffo_attempts
        WHERE order_id = v_order.id AND environment = p_environment AND waffo_order_id = v_waffo_order_id
          AND provider_price_id = v_order.provider_price_id AND billing_mode = v_order.billing_mode) THEN
      RAISE EXCEPTION ''Waffo event does not match the bound order or product'';
    END IF;
    IF (v_recurring AND v_subscription_id IS DISTINCT FROM v_waffo_order_id) OR
      (NOT v_recurring AND (v_subscription_id IS NOT NULL OR v_kind = ''subscription'')) THEN
      RAISE EXCEPTION ''Waffo subscription does not match the order billing mode'';
    END IF;
    IF (v_kind = ''payment'' AND v_action_id !~ ''^PAY_[A-Za-z0-9]+$'') OR
      (v_kind = ''refund'' AND (v_action_id !~ ''^(REF|RFD)_[A-Za-z0-9]+$'' OR
        coalesce(p_event->>''transaction_id'', '''') !~ ''^PAY_[A-Za-z0-9]+$'')) THEN
      RAISE EXCEPTION ''invalid Waffo payment or refund identity'';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_events
    WHERE provider = p_provider AND environment = p_environment AND event_id = v_event_id) THEN
    IF NOT EXISTS (SELECT 1 FROM public.tokentracker_cloud_events
      WHERE provider = p_provider AND environment = p_environment AND event_id = v_event_id
        AND normalized_event = p_event AND order_id = v_order.id) THEN
      RAISE EXCEPTION ''event identifier was already used for different payment data'';
    END IF;
    RETURN jsonb_build_object(''applied'', false, ''duplicate'', true,
      ''retry_payment_conflict'', (SELECT retry_payment_conflict_at IS NOT NULL
        FROM public.tokentracker_cloud_orders WHERE id = v_order.id));
  END IF;
  INSERT INTO public.tokentracker_cloud_events
    (provider, environment, event_id, kind, action_id, order_id, occurred_at, normalized_event)
    VALUES (p_provider, p_environment, v_event_id, v_kind, v_action_id, v_order.id, v_occurred, p_event);
  IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_events
    WHERE provider = p_provider AND environment = p_environment AND kind = v_kind
      AND action_id = v_action_id AND status = ''applied'' AND kind IN (''payment'', ''refund'')) THEN
    IF NOT EXISTS (SELECT 1 FROM public.tokentracker_cloud_events
      WHERE provider = p_provider AND environment = p_environment AND kind = v_kind
        AND action_id = v_action_id AND status = ''applied'' AND order_id = v_order.id
        AND normalized_event - ARRAY[''event_id'',''occurred_at''] = p_event - ARRAY[''event_id'',''occurred_at'']) THEN
      RAISE EXCEPTION ''payment action was already applied to different payment data'';
    END IF;
    v_status := ''duplicate'';
  ELSIF v_kind = ''payment'' THEN
    IF p_event->>''currency'' IS DISTINCT FROM v_order.currency OR
      (p_event->>''base_amount_cents'')::integer IS DISTINCT FROM v_order.amount_cents THEN
      RAISE EXCEPTION ''payment amount or currency does not match the order'';
    END IF;
    v_amount := (p_event->>''amount_cents'')::integer;
    IF v_amount IS NULL OR v_amount < v_order.amount_cents OR
      (p_provider NOT IN (''paddle'',''waffo'') AND v_amount <> v_order.amount_cents) THEN
      RAISE EXCEPTION ''invalid paid amount'';
    END IF;
    IF v_recurring THEN
      IF p_provider = ''paddle'' AND v_order.provider_order_id IS NOT NULL AND v_order.provider_order_id <> v_action_id
        AND (v_subscription_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM public.tokentracker_cloud_subscriptions
          WHERE provider = p_provider AND environment = p_environment
            AND provider_subscription_id = v_subscription_id
            AND user_id = v_order.user_id AND order_id = v_order.id
        )) THEN RAISE EXCEPTION ''unrecognized subscription renewal''; END IF;
      v_start := (p_event->>''starts_at'')::timestamptz;
      v_end := (p_event->>''ends_at'')::timestamptz;
      IF v_subscription_id IS NULL OR v_start IS NULL OR v_end IS NULL OR
        v_end <= v_start OR v_end > v_start + make_interval(months => v_order.term_months) + interval ''1 day'' OR
        ((p_provider <> ''waffo'' OR p_environment <> ''sandbox'') AND v_end < v_start + make_interval(months => v_order.term_months) - interval ''1 day'') THEN
        RAISE EXCEPTION ''invalid subscription billing period'';
      END IF;
      IF p_provider = ''waffo'' AND NOT EXISTS (
        SELECT 1 FROM public.tokentracker_cloud_waffo_periods
        WHERE order_id = v_order.id AND environment = p_environment AND waffo_order_id = v_waffo_order_id
          AND period_number = (p_event->>''period_number'')::integer AND starts_at = v_start AND ends_at = v_end
      ) THEN
        RAISE EXCEPTION ''Waffo payment does not match a verified subscription billing period'';
      END IF;
      SELECT * INTO v_subscription FROM public.tokentracker_cloud_subscriptions
        WHERE provider = p_provider AND environment = p_environment
          AND provider_subscription_id = v_subscription_id FOR UPDATE;
      IF FOUND AND (v_subscription.user_id <> v_order.user_id OR v_subscription.order_id <> v_order.id) THEN
        RAISE EXCEPTION ''subscription belongs to a different account or order'';
      END IF;
      INSERT INTO public.tokentracker_cloud_subscriptions
        (provider, environment, provider_subscription_id, user_id, order_id, status, last_event_at,next_billed_at)
        VALUES (p_provider, p_environment, v_subscription_id, v_order.user_id, v_order.id, ''active'', v_occurred,v_end)
        ON CONFLICT (provider, environment, provider_subscription_id) DO UPDATE SET
          next_billed_at=CASE WHEN tokentracker_cloud_subscriptions.status IN (''active'',''trialing'',''past_due'')
            AND NOT tokentracker_cloud_subscriptions.cancel_at_period_end
            THEN greatest(tokentracker_cloud_subscriptions.next_billed_at,excluded.next_billed_at)
            ELSE tokentracker_cloud_subscriptions.next_billed_at END;
    ELSE
      IF p_provider <> ''waffo'' AND v_order.provider_order_id IS NOT NULL AND v_order.provider_order_id <> v_action_id THEN
        RAISE EXCEPTION ''payment transaction does not match the order'';
      END IF;
      SELECT greatest(clock_timestamp(), max(ends_at)) INTO v_start
        FROM public.tokentracker_cloud_payments WHERE user_id = v_order.user_id
          AND environment = p_environment AND refunded_cents < amount_cents;
      v_end := v_start + make_interval(months => v_order.term_months);
    END IF;
    INSERT INTO public.tokentracker_cloud_payments
      (order_id, user_id, provider, environment, transaction_id, subscription_id,
        currency, amount_cents, starts_at, ends_at, paid_at, waffo_order_id)
      VALUES (v_order.id, v_order.user_id, p_provider, p_environment, v_action_id, v_subscription_id,
        v_order.currency, v_amount, v_start, v_end, v_occurred, CASE WHEN p_provider = ''waffo'' THEN v_waffo_order_id END);
    UPDATE public.tokentracker_cloud_orders SET status = ''paid'',
      provider_order_id = coalesce(provider_order_id, v_action_id),
      waffo_order_id = CASE WHEN p_provider = ''waffo'' THEN coalesce(waffo_order_id,v_waffo_order_id) ELSE waffo_order_id END
      WHERE id = v_order.id;
  ELSIF v_kind = ''refund'' THEN
    SELECT * INTO STRICT v_payment FROM public.tokentracker_cloud_payments
      WHERE provider = p_provider AND environment = p_environment
        AND transaction_id = p_event->>''transaction_id'' FOR UPDATE;
    IF v_payment.order_id <> v_order.id OR v_payment.user_id <> v_order.user_id OR
      p_event->>''currency'' IS DISTINCT FROM v_payment.currency OR
      (p_provider = ''waffo'' AND v_payment.waffo_order_id IS DISTINCT FROM v_waffo_order_id) THEN
      RAISE EXCEPTION ''refund does not match the paid order'';
    END IF;
    IF p_event ? ''refund_total_cents'' THEN
      IF p_provider <> ''alipay'' THEN RAISE EXCEPTION ''invalid cumulative refund provider''; END IF;
      v_refund_total := (p_event->>''refund_total_cents'')::integer;
      IF v_refund_total IS NULL OR v_refund_total <= 0 OR v_refund_total > v_payment.amount_cents OR
        v_refund_total IS DISTINCT FROM (p_event->>''amount_cents'')::integer THEN
        RAISE EXCEPTION ''invalid refund amount'';
      END IF;
      IF v_refund_total <= v_payment.refunded_cents THEN v_status := ''outdated''; END IF;
    ELSE
      v_amount := (p_event->>''amount_cents'')::integer;
      IF v_amount IS NULL OR v_amount <= 0 OR
        v_payment.refunded_cents + v_amount > v_payment.amount_cents THEN
        RAISE EXCEPTION ''invalid refund amount'';
      END IF;
      v_refund_total := v_payment.refunded_cents + v_amount;
    END IF;
    IF v_status = ''applied'' THEN
      UPDATE public.tokentracker_cloud_payments SET refunded_cents = v_refund_total,
        revoked_at = CASE WHEN v_refund_total = amount_cents THEN clock_timestamp() ELSE revoked_at END
        WHERE id = v_payment.id;
    END IF;
  ELSE
    IF NOT v_recurring OR v_subscription_id IS NULL OR
      p_event->>''status'' IS NULL OR p_event->>''status'' NOT IN
        (''active'', ''canceled'', ''past_due'', ''paused'', ''trialing'') THEN
      RAISE EXCEPTION ''invalid subscription event'';
    END IF;
    SELECT * INTO v_subscription FROM public.tokentracker_cloud_subscriptions
      WHERE provider = p_provider AND environment = p_environment
        AND provider_subscription_id = v_subscription_id FOR UPDATE;
    IF FOUND AND (v_subscription.user_id <> v_order.user_id OR v_subscription.order_id <> v_order.id) THEN
      RAISE EXCEPTION ''subscription belongs to a different account or order'';
    END IF;
    IF FOUND AND v_subscription.last_event_at >= v_occurred THEN
      v_status := ''outdated'';
    ELSE
      INSERT INTO public.tokentracker_cloud_subscriptions
        (provider, environment, provider_subscription_id, user_id, order_id, status,
          cancel_at_period_end, last_event_at,next_billed_at)
        VALUES (p_provider, p_environment, v_subscription_id, v_order.user_id, v_order.id,
          p_event->>''status'', coalesce((p_event->>''cancel_at_period_end'')::boolean, false), v_occurred,
          (p_event->>''next_billed_at'')::timestamptz)
        ON CONFLICT (provider, environment, provider_subscription_id) DO UPDATE
          SET status = excluded.status, cancel_at_period_end = excluded.cancel_at_period_end,
            last_event_at = excluded.last_event_at,next_billed_at=excluded.next_billed_at;
    END IF;
  END IF;
  UPDATE public.tokentracker_cloud_events SET status = v_status
    WHERE provider = p_provider AND environment = p_environment AND event_id = v_event_id;
  RETURN jsonb_build_object(''applied'', v_status = ''applied'', ''status'', v_status,
    ''retry_payment_conflict'', (SELECT retry_payment_conflict_at IS NOT NULL
      FROM public.tokentracker_cloud_orders WHERE id = v_order.id),
    ''membership'', public.cloud_membership(v_order.user_id, p_environment));
END;
$fn$;
';
        INSERT INTO public.tokentracker_self_host_installations(step,checksum) VALUES ('20261007160000_cloud-waffo-sandbox-periods','396bfab22c09a35a76510644e8ec002fa8ff48763104e1f86369c0c8b2af36d1');
      END IF;
    END $install$;

DO $install$ DECLARE v_checksum text; BEGIN
      SELECT checksum INTO v_checksum FROM public.tokentracker_self_host_installations WHERE step = '10-self-hosted-policy';
      IF FOUND AND v_checksum <> '3808d8964e2f987569fd6d5eb82b2fa349e2bedd6de1ad45a631ead93279cad2' THEN RAISE EXCEPTION 'Installed step has changed: %','10-self-hosted-policy'; END IF;
      IF NOT FOUND THEN
        EXECUTE '-- Instance owners explicitly choose self-hosted access. Existing hosted instances retain their paid policy.
ALTER TABLE public.tokentracker_cloud_policy ADD COLUMN hosting_mode text NOT NULL DEFAULT ''hosted''
  CHECK (hosting_mode IN (''hosted'',''self_hosted''));

CREATE OR REPLACE FUNCTION public.cloud_membership(
  p_user_id uuid, p_environment text
) RETURNS jsonb LANGUAGE plpgsql STABLE
SET search_path = public, pg_temp AS $fn$
DECLARE
  v_now timestamptz := statement_timestamp();
  v_policy public.tokentracker_cloud_policy%ROWTYPE;
  v_trial timestamptz;
  v_transition timestamptz;
  v_end timestamptz;
  v_history_end timestamptz;
  v_paid boolean := false;
  v_status text;
  v_period record;
BEGIN
  SELECT * INTO STRICT v_policy FROM public.tokentracker_cloud_policy
    WHERE environment = p_environment;
  IF v_policy.hosting_mode = ''self_hosted'' THEN
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
      RAISE EXCEPTION ''self-hosted account does not exist'';
    END IF;
    RETURN jsonb_build_object(''environment'',p_environment,''phase'',''active'',''status'',''self_hosted'',
      ''hosting_mode'',''self_hosted'',''expires_at'',NULL,''trial_ends_at'',NULL,''trial_available'',false,
      ''transition_ends_at'',NULL,''read_only_until'',NULL,''can_read_cloud'',true,''can_upload_cloud'',true,
      ''machine_limit'',NULL,''sync_interval_seconds'',0,''hourly_history_days'',NULL,''daily_history_months'',NULL);
  END IF;
  SELECT trial_ends_at INTO v_trial FROM public.tokentracker_cloud_accounts
    WHERE user_id = p_user_id AND environment = p_environment;
  IF v_policy.launch_at IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tokentracker_devices
    WHERE user_id = p_user_id AND created_at < v_policy.launch_at
  ) THEN
    v_transition := v_policy.launch_at + interval ''30 days'';
  END IF;
  SELECT max(CASE WHEN refunded_cents = amount_cents THEN least(ends_at, revoked_at)
    ELSE ends_at END) INTO v_history_end FROM public.tokentracker_cloud_payments
    WHERE user_id = p_user_id AND environment = p_environment AND starts_at <= v_now;
  v_history_end := greatest(v_history_end, v_trial, v_transition);
  v_end := greatest(v_now, v_trial, v_transition);
  -- Merge contiguous paid intervals. A refunded middle term cannot bridge a gap.
  FOR v_period IN SELECT starts_at, ends_at FROM public.tokentracker_cloud_payments
    WHERE user_id = p_user_id AND environment = p_environment
      AND refunded_cents < amount_cents AND ends_at > v_now
    ORDER BY starts_at, ends_at
  LOOP
    IF v_period.starts_at <= v_end THEN
      v_end := greatest(v_end, v_period.ends_at);
      IF v_period.starts_at <= v_now THEN v_paid := true; END IF;
    END IF;
  END LOOP;
  v_status := CASE
    WHEN v_policy.phase = ''preview'' THEN ''legacy_free''
    WHEN v_paid THEN ''active''
    WHEN v_trial > v_now THEN ''trial''
    WHEN v_transition > v_now THEN ''transition''
    WHEN v_history_end IS NOT NULL THEN ''expired''
    ELSE ''free'' END;
  RETURN jsonb_build_object(
    ''environment'', p_environment, ''phase'', v_policy.phase, ''status'', v_status,
    ''expires_at'', CASE WHEN v_end > v_now THEN v_end ELSE NULL END,
    ''trial_ends_at'', v_trial, ''trial_available'', v_trial IS NULL AND NOT EXISTS (
      SELECT 1 FROM public.tokentracker_cloud_payments
      WHERE user_id = p_user_id AND environment = p_environment),
    ''transition_ends_at'', v_transition,
    ''read_only_until'', v_history_end + interval ''30 days'',
    ''can_read_cloud'', v_status IN (''legacy_free'', ''active'', ''trial'', ''transition'')
      OR (v_status = ''expired'' AND v_history_end + interval ''30 days'' > v_now),
    ''can_upload_cloud'', v_status IN (''legacy_free'', ''active'', ''trial'', ''transition''),
    ''machine_limit'', CASE WHEN v_status = ''legacy_free'' THEN NULL
      WHEN v_status IN (''active'', ''trial'', ''transition'') THEN 5 ELSE 1 END,
    ''sync_interval_seconds'', CASE WHEN v_status IN (''legacy_free'', ''active'', ''trial'', ''transition'')
      THEN 900 ELSE 86400 END,
    ''hourly_history_days'', 90, ''daily_history_months'', 24
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.cloud_account_access(p_user_id uuid,p_environment text,p_kind text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $fn$
DECLARE v_state jsonb; v_from date;
BEGIN
  v_state:=public.cloud_membership(p_user_id,p_environment);
  IF NOT (v_state->>''can_read_cloud'')::boolean THEN
    RETURN jsonb_build_object(''ok'',false,''status'',402,''code'',CASE WHEN v_state->>''status''=''expired''
      THEN ''cloud_read_only_expired'' ELSE ''cloud_membership_required'' END,
      ''membership'',v_state,''recovery_url'',''https://www.tokentracker.cc/cloud'');
  END IF;
  IF v_state->>''phase''=''active'' AND v_state->>''status''<>''self_hosted'' THEN
    v_from:=CASE WHEN p_kind=''hourly'' THEN (now() AT TIME ZONE ''UTC'')::date - 89
      ELSE ((now() AT TIME ZONE ''UTC'')::date - interval ''24 months'')::date END;
  END IF;
  RETURN jsonb_build_object(''ok'',true,''membership'',v_state,''available_from'',v_from);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.cloud_start_trial(p_user_id uuid, p_environment text)
RETURNS jsonb LANGUAGE plpgsql
SET search_path = public, pg_temp AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_policy WHERE environment = p_environment AND hosting_mode = ''self_hosted'') THEN
    RAISE EXCEPTION ''self-hosted access is free and does not require a trial'';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || '':'' || p_environment, 0));
  IF NOT EXISTS (SELECT 1 FROM public.tokentracker_cloud_policy
    WHERE environment = p_environment AND phase = ''active'' AND launch_at <= clock_timestamp()) THEN
    RAISE EXCEPTION ''trial has not launched'';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_payments
    WHERE user_id = p_user_id AND environment = p_environment) THEN
    RAISE EXCEPTION ''trial is only available before the first purchase'';
  END IF;
  INSERT INTO public.tokentracker_cloud_accounts (user_id, environment, trial_started_at, trial_ends_at)
    VALUES (p_user_id, p_environment, clock_timestamp(), clock_timestamp() + interval ''7 days'')
    ON CONFLICT (user_id, environment) DO UPDATE
      SET trial_started_at = excluded.trial_started_at, trial_ends_at = excluded.trial_ends_at
      WHERE tokentracker_cloud_accounts.trial_started_at IS NULL;
  RETURN public.cloud_membership(p_user_id, p_environment);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.cloud_create_order(
  p_user_id uuid, p_environment text, p_provider text, p_sku text, p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql
SET search_path = public, pg_temp AS $fn$
DECLARE
  v_catalog public.tokentracker_cloud_catalog%ROWTYPE;
  v_order public.tokentracker_cloud_orders%ROWTYPE;
BEGIN
  IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_policy WHERE environment = p_environment AND hosting_mode = ''self_hosted'') THEN
    RAISE EXCEPTION ''self-hosted access is free and does not require a paid order'';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || '':'' || p_environment, 0));
  SELECT * INTO v_order FROM public.tokentracker_cloud_orders
    WHERE user_id = p_user_id AND environment = p_environment AND request_id = p_request_id;
  IF FOUND THEN
    IF v_order.provider <> p_provider OR v_order.sku <> p_sku THEN
      RAISE EXCEPTION ''idempotency request belongs to a different purchase'';
    END IF;
    RETURN to_jsonb(v_order);
  END IF;
  IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_orders
    WHERE user_id = p_user_id AND environment = p_environment AND retry_payment_conflict_at IS NOT NULL) THEN
    RAISE EXCEPTION ''a payment conflict must be resolved before another purchase'';
  END IF;
  SELECT * INTO STRICT v_catalog FROM public.tokentracker_cloud_catalog WHERE sku = p_sku;
  IF NOT v_catalog.active THEN RAISE EXCEPTION ''the requested product is no longer available''; END IF;
  IF (p_provider = ''paddle'' AND (v_catalog.currency <> ''USD'' OR v_catalog.billing_mode <> ''recurring'')) OR
     (p_provider IN (''wechat'', ''alipay'') AND (v_catalog.currency <> ''CNY'' OR v_catalog.billing_mode <> ''fixed'')) THEN
    RAISE EXCEPTION ''payment provider does not support this currency'';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_subscriptions
    WHERE user_id = p_user_id AND environment = p_environment
      AND status IN (''active'', ''trialing'', ''past_due'', ''paused'') AND NOT cancel_at_period_end) THEN
    RAISE EXCEPTION ''manage the existing subscription before purchasing another plan'';
  END IF;
  IF v_catalog.billing_mode = ''recurring'' AND EXISTS (SELECT 1 FROM public.tokentracker_cloud_payments
    WHERE user_id = p_user_id AND environment = p_environment
      AND refunded_cents < amount_cents AND ends_at > clock_timestamp()) THEN
    RAISE EXCEPTION ''the current fixed membership term must end before starting a subscription'';
  END IF;
  INSERT INTO public.tokentracker_cloud_orders
    (user_id, environment, request_id, provider, sku, currency, amount_cents, term_months, billing_mode)
    VALUES (p_user_id, p_environment, p_request_id, p_provider, p_sku,
      v_catalog.currency, v_catalog.amount_cents, v_catalog.term_months, v_catalog.billing_mode)
    RETURNING * INTO v_order;
  RETURN to_jsonb(v_order);
END;
$fn$;



REVOKE ALL ON FUNCTION public.cloud_membership(uuid,text),public.cloud_account_access(uuid,text,text),
  public.cloud_start_trial(uuid,text),public.cloud_create_order(uuid,text,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cloud_membership(uuid,text),public.cloud_account_access(uuid,text,text),
  public.cloud_start_trial(uuid,text),public.cloud_create_order(uuid,text,text,text,uuid) TO project_admin;
';
        INSERT INTO public.tokentracker_self_host_installations(step,checksum) VALUES ('10-self-hosted-policy','3808d8964e2f987569fd6d5eb82b2fa349e2bedd6de1ad45a631ead93279cad2');
      END IF;
    END $install$;

DO $install$ DECLARE v_checksum text; BEGIN
      SELECT checksum INTO v_checksum FROM public.tokentracker_self_host_installations WHERE step = '11-token-environment-validation';
      IF FOUND AND v_checksum <> '08a7dd10fde98f8aafc25bd9f7bb719914498ef1b1ce5823d76d81c15af69d3d' THEN RAISE EXCEPTION 'Installed step has changed: %','11-token-environment-validation'; END IF;
      IF NOT FOUND THEN
        EXECUTE '-- Validate historical tokens without retaining the ADD COLUMN exclusive lock.
SET LOCAL lock_timeout = ''3s'';
-- Keep the platform''s enforced statement timeout.
ALTER TABLE public.tokentracker_device_tokens
  VALIDATE CONSTRAINT tokentracker_device_tokens_cloud_environment_fkey;
';
        INSERT INTO public.tokentracker_self_host_installations(step,checksum) VALUES ('11-token-environment-validation','08a7dd10fde98f8aafc25bd9f7bb719914498ef1b1ce5823d76d81c15af69d3d');
      END IF;
    END $install$;

DO $install$ DECLARE v_checksum text; BEGIN
      SELECT checksum INTO v_checksum FROM public.tokentracker_self_host_installations WHERE step = '12-pro-gifts';
      IF FOUND AND v_checksum <> 'd3929a662143ab38f2e8edca5bcfd9549546e711222f4a20a6ba6c202f73d777' THEN RAISE EXCEPTION 'Installed step has changed: %','12-pro-gifts'; END IF;
      IF NOT FOUND THEN
        EXECUTE '-- Gifts are a separate entitlement ledger, never synthetic payments or subscriptions.
CREATE TABLE public.tokentracker_cloud_gift_batches (
  id uuid PRIMARY KEY,
  environment text NOT NULL REFERENCES public.tokentracker_cloud_policy(environment),
  duration_days integer NOT NULL CHECK (duration_days IN (30,90,365)),
  redeem_before timestamptz NOT NULL CHECK (isfinite(redeem_before)),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  disabled_at timestamptz,
  UNIQUE (id,environment)
);
CREATE TABLE public.tokentracker_cloud_gift_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  environment text NOT NULL,
  code_hash text NOT NULL CHECK (code_hash ~ ''^[0-9a-f]{64}$''),
  suffix text NOT NULL CHECK (suffix ~ ''^[0-9A-F]{8}$''),
  FOREIGN KEY (batch_id,environment) REFERENCES public.tokentracker_cloud_gift_batches(id,environment),
  UNIQUE (environment,code_hash), UNIQUE (id,environment)
);
CREATE INDEX tokentracker_cloud_gift_codes_batch_idx ON public.tokentracker_cloud_gift_codes(batch_id,environment);
CREATE TABLE public.tokentracker_cloud_gift_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_id uuid NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  environment text NOT NULL,
  request_id uuid NOT NULL,
  duration_days integer NOT NULL CHECK (duration_days IN (30,90,365)),
  redeemed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  revoked_at timestamptz,
  FOREIGN KEY (code_id,environment) REFERENCES public.tokentracker_cloud_gift_codes(id,environment),
  UNIQUE (user_id,environment,request_id),
  CHECK (isfinite(starts_at) AND isfinite(ends_at) AND ends_at > starts_at),
  CHECK (revoked_at IS NULL OR (isfinite(revoked_at) AND revoked_at >= redeemed_at)),
  CHECK (ends_at = starts_at + duration_days * interval ''24 hours'')
);
CREATE INDEX tokentracker_cloud_gift_grants_user_idx ON public.tokentracker_cloud_gift_grants(user_id,environment,ends_at);
CREATE TABLE public.tokentracker_cloud_gift_attempts (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  environment text NOT NULL REFERENCES public.tokentracker_cloud_policy(environment),
  window_started_at timestamptz NOT NULL,
  failed_attempts integer NOT NULL CHECK (failed_attempts BETWEEN 0 AND 10),
  PRIMARY KEY (user_id,environment)
);
ALTER TABLE public.tokentracker_cloud_gift_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tokentracker_cloud_gift_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tokentracker_cloud_gift_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tokentracker_cloud_gift_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tokentracker_cloud_gift_batches,public.tokentracker_cloud_gift_codes,
  public.tokentracker_cloud_gift_grants,public.tokentracker_cloud_gift_attempts FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.tokentracker_cloud_gift_batches,public.tokentracker_cloud_gift_codes,
  public.tokentracker_cloud_gift_grants,public.tokentracker_cloud_gift_attempts TO project_admin;

CREATE FUNCTION public.cloud_guard_gift_grant() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog,public,pg_temp AS $fn$
BEGIN
  IF (to_jsonb(NEW)-''revoked_at'') IS DISTINCT FROM (to_jsonb(OLD)-''revoked_at'') OR
    (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION ''gift grant history is immutable'';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER cloud_gift_grant_immutable BEFORE UPDATE ON public.tokentracker_cloud_gift_grants
  FOR EACH ROW EXECUTE FUNCTION public.cloud_guard_gift_grant();

CREATE FUNCTION public.cloud_gift_view(p_grant public.tokentracker_cloud_gift_grants)
RETURNS jsonb LANGUAGE sql VOLATILE SET search_path = pg_catalog,public,pg_temp AS $fn$
  SELECT jsonb_build_object(''id'',p_grant.id,''duration_days'',p_grant.duration_days,
    ''redeemed_at'',p_grant.redeemed_at,''starts_at'',p_grant.starts_at,''ends_at'',p_grant.ends_at,
    ''revoked_at'',p_grant.revoked_at,''state'',CASE WHEN p_grant.revoked_at IS NOT NULL THEN ''revoked''
      WHEN p_grant.starts_at > clock_timestamp() THEN ''pending''
      WHEN p_grant.ends_at <= clock_timestamp() THEN ''expired'' ELSE ''active'' END);
$fn$;

CREATE FUNCTION public.cloud_create_gift_batch(p_environment text,p_batch_id uuid,p_duration_days integer,
  p_redeem_before timestamptz,p_label text,p_codes jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog,public,pg_temp AS $fn$
DECLARE v_batch public.tokentracker_cloud_gift_batches%ROWTYPE; v_count integer;
BEGIN
  IF p_environment IS NULL OR p_environment NOT IN (''live'',''sandbox'') OR p_batch_id IS NULL OR
    p_duration_days IS NULL OR p_duration_days NOT IN (30,90,365) OR p_redeem_before IS NULL OR
    NOT isfinite(p_redeem_before) OR p_label IS NULL OR length(p_label) NOT BETWEEN 1 AND 120 OR
    jsonb_typeof(p_codes) IS DISTINCT FROM ''array'' THEN RAISE EXCEPTION ''invalid gift batch''; END IF;
  v_count := jsonb_array_length(p_codes);
  IF v_count NOT BETWEEN 1 AND 1000 OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_codes) c WHERE
    jsonb_typeof(c) <> ''object'' OR c->>''code_hash'' IS NULL OR c->>''code_hash'' !~ ''^[0-9a-f]{64}$'' OR
    c->>''suffix'' IS NULL OR c->>''suffix'' !~ ''^[0-9A-F]{8}$'' OR
    (c-''code_hash''-''suffix'') <> ''{}''::jsonb) OR
    (SELECT count(DISTINCT c->>''code_hash'') FROM jsonb_array_elements(p_codes) c) <> v_count THEN
    RAISE EXCEPTION ''invalid gift batch codes'';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(''gift-batch:''||p_batch_id::text,0));
  SELECT * INTO v_batch FROM public.tokentracker_cloud_gift_batches WHERE id=p_batch_id;
  IF FOUND THEN
    IF v_batch.environment IS DISTINCT FROM p_environment OR v_batch.duration_days IS DISTINCT FROM p_duration_days OR
      v_batch.redeem_before IS DISTINCT FROM p_redeem_before OR v_batch.label IS DISTINCT FROM p_label OR
      (SELECT jsonb_agg(jsonb_build_object(''code_hash'',code_hash,''suffix'',suffix) ORDER BY code_hash)
        FROM public.tokentracker_cloud_gift_codes WHERE batch_id=p_batch_id) IS DISTINCT FROM
      (SELECT jsonb_agg(c ORDER BY c->>''code_hash'') FROM jsonb_array_elements(p_codes) c) THEN
      RAISE EXCEPTION ''gift batch request conflicts with original batch'';
    END IF;
    RETURN jsonb_build_object(''id'',v_batch.id,''environment'',v_batch.environment,''count'',v_count,''reused'',true);
  END IF;
  IF p_redeem_before <= clock_timestamp() THEN RAISE EXCEPTION ''gift redemption deadline must be in the future''; END IF;
  INSERT INTO public.tokentracker_cloud_gift_batches(id,environment,duration_days,redeem_before,label)
    VALUES(p_batch_id,p_environment,p_duration_days,p_redeem_before,p_label);
  INSERT INTO public.tokentracker_cloud_gift_codes(batch_id,environment,code_hash,suffix)
    SELECT p_batch_id,p_environment,c->>''code_hash'',c->>''suffix'' FROM jsonb_array_elements(p_codes) c;
  RETURN jsonb_build_object(''id'',p_batch_id,''environment'',p_environment,''count'',v_count,''reused'',false);
END;
$fn$;

CREATE FUNCTION public.cloud_list_gift_batches(p_environment text,p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = pg_catalog,public,pg_temp AS $fn$
BEGIN
  IF p_environment IS NULL OR p_environment NOT IN (''live'',''sandbox'') OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION ''invalid gift list'';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(b)) FROM (SELECT b.*,
      (SELECT count(*) FROM public.tokentracker_cloud_gift_codes c WHERE c.batch_id=b.id) AS code_count,
      (SELECT count(*) FROM public.tokentracker_cloud_gift_codes c JOIN public.tokentracker_cloud_gift_grants g
        ON g.code_id=c.id WHERE c.batch_id=b.id) AS redeemed_count
    FROM public.tokentracker_cloud_gift_batches b WHERE environment=p_environment
    ORDER BY created_at DESC,id LIMIT p_limit) b),''[]''::jsonb);
END;
$fn$;

CREATE FUNCTION public.cloud_list_gift_codes(p_environment text,p_batch_id uuid,p_limit integer DEFAULT 1000)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = pg_catalog,public,pg_temp AS $fn$
BEGIN
  IF p_environment IS NULL OR p_environment NOT IN (''live'',''sandbox'') OR p_batch_id IS NULL OR
    p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION ''invalid gift list''; END IF;
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(c)) FROM (SELECT c.id,c.suffix,c.batch_id,g.id AS grant_id,
    g.user_id,g.redeemed_at,g.starts_at,g.ends_at,g.revoked_at FROM public.tokentracker_cloud_gift_codes c
    LEFT JOIN public.tokentracker_cloud_gift_grants g ON g.code_id=c.id
    WHERE c.environment=p_environment AND c.batch_id=p_batch_id ORDER BY c.id LIMIT p_limit) c),''[]''::jsonb);
END;
$fn$;

CREATE FUNCTION public.cloud_disable_gift_batch(p_environment text,p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog,public,pg_temp AS $fn$
DECLARE v_batch public.tokentracker_cloud_gift_batches%ROWTYPE;
BEGIN
  UPDATE public.tokentracker_cloud_gift_batches SET disabled_at=coalesce(disabled_at,clock_timestamp())
    WHERE id=p_batch_id AND environment=p_environment RETURNING * INTO STRICT v_batch;
  RETURN jsonb_build_object(''id'',v_batch.id,''environment'',v_batch.environment,''disabled_at'',v_batch.disabled_at);
END;
$fn$;

CREATE FUNCTION public.cloud_revoke_gift(p_environment text,p_grant_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog,public,pg_temp AS $fn$
DECLARE v_grant public.tokentracker_cloud_gift_grants%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_grant FROM public.tokentracker_cloud_gift_grants WHERE id=p_grant_id AND environment=p_environment;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_grant.user_id::text||'':''||p_environment,0));
  UPDATE public.tokentracker_cloud_gift_grants SET revoked_at=coalesce(revoked_at,clock_timestamp())
    WHERE id=p_grant_id AND environment=p_environment RETURNING * INTO STRICT v_grant;
  RETURN public.cloud_gift_view(v_grant);
END;
$fn$;

ALTER FUNCTION public.cloud_membership(uuid,text) RENAME TO cloud_membership_before_gifts;
CREATE FUNCTION public.cloud_membership(p_user_id uuid,p_environment text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog,public,pg_temp AS $fn$
DECLARE
  v_state jsonb := public.cloud_membership_before_gifts(p_user_id,p_environment);
  v_now timestamptz := clock_timestamp(); v_end timestamptz := v_now;
  v_gift_end timestamptz; v_history_end timestamptz; v_status text;
  v_paid boolean := false; v_gift boolean := false; v_has_gift boolean; v_period record;
BEGIN
  v_state := v_state || jsonb_build_object(''access_source'',''none'',''has_gift'',false,''gift_expires_at'',NULL);
  IF v_state->>''hosting_mode''=''self_hosted'' THEN RETURN v_state; END IF;
  SELECT max(ends_at),count(*)>0 INTO v_gift_end,v_has_gift FROM public.tokentracker_cloud_gift_grants
    WHERE user_id=p_user_id AND environment=p_environment AND revoked_at IS NULL AND ends_at>v_now;
  FOR v_period IN SELECT starts_at,ends_at,''payment'' AS source FROM public.tokentracker_cloud_payments
    WHERE user_id=p_user_id AND environment=p_environment AND refunded_cents<amount_cents
      AND revoked_at IS NULL AND ends_at>v_now
    UNION ALL SELECT starts_at,ends_at,''gift'' AS source FROM public.tokentracker_cloud_gift_grants
    WHERE user_id=p_user_id AND environment=p_environment AND revoked_at IS NULL AND ends_at>v_now
    ORDER BY starts_at,ends_at
  LOOP
    IF v_period.starts_at <= v_end THEN
      v_end := greatest(v_end,v_period.ends_at);
      IF v_period.starts_at<=v_now THEN
        IF v_period.source=''payment'' THEN v_paid:=true; ELSE v_gift:=true; END IF;
      END IF;
    END IF;
  END LOOP;
  SELECT max(least(ends_at,coalesce(revoked_at,ends_at))) INTO v_history_end
    FROM public.tokentracker_cloud_gift_grants WHERE user_id=p_user_id AND environment=p_environment
      AND starts_at<=v_now AND (revoked_at IS NULL OR revoked_at>starts_at);
  v_history_end := greatest(v_history_end + interval ''30 days'',(v_state->>''read_only_until'')::timestamptz);
  v_status := v_state->>''status'';
  IF v_state->>''phase''=''active'' THEN
    IF v_paid OR v_gift THEN v_status:=''active'';
    ELSIF v_status=''free'' AND v_history_end IS NOT NULL THEN v_status:=''expired''; END IF;
  END IF;
  RETURN v_state || jsonb_build_object(''status'',v_status,''access_source'',CASE
    WHEN v_state->>''phase''<>''active'' THEN ''none'' WHEN v_paid AND v_gift THEN ''mixed''
    WHEN v_paid THEN ''payment'' WHEN v_gift THEN ''gift'' ELSE ''none'' END,
    ''has_gift'',v_has_gift,''gift_expires_at'',v_gift_end,''expires_at'',CASE WHEN v_status=''active'' THEN v_end
      ELSE (v_state->>''expires_at'')::timestamptz END,
    ''trial_available'',(v_state->>''trial_available'')::boolean AND NOT EXISTS (
      SELECT 1 FROM public.tokentracker_cloud_gift_grants WHERE user_id=p_user_id AND environment=p_environment),
    ''read_only_until'',v_history_end,''can_read_cloud'',v_status IN (''legacy_free'',''active'',''trial'',''transition'') OR
      (v_status=''expired'' AND coalesce(v_history_end>v_now,false)),
    ''can_upload_cloud'',v_status IN (''legacy_free'',''active'',''trial'',''transition''),
    ''machine_limit'',CASE WHEN v_status=''legacy_free'' THEN NULL WHEN v_status IN (''active'',''trial'',''transition'') THEN 5 ELSE 1 END,
    ''sync_interval_seconds'',CASE WHEN v_status IN (''legacy_free'',''active'',''trial'',''transition'') THEN 900 ELSE 86400 END);
END;
$fn$;

CREATE FUNCTION public.cloud_gift_account(p_user_id uuid,p_environment text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = pg_catalog,public,pg_temp AS $fn$
DECLARE v_available boolean; v_restriction text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id=p_user_id) THEN RAISE EXCEPTION ''gift account does not exist''; END IF;
  SELECT hosting_mode=''hosted'' AND phase=''active'' AND launch_at<=statement_timestamp()
    INTO STRICT v_available FROM public.tokentracker_cloud_policy WHERE environment=p_environment;
  IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_subscriptions WHERE user_id=p_user_id AND environment=p_environment
      AND status IN (''pending'',''active'',''trialing'',''past_due'',''paused'') AND NOT cancel_at_period_end) THEN
    v_restriction:=''gift_requires_renewal_cancel'';
  ELSIF EXISTS (SELECT 1 FROM public.tokentracker_cloud_orders WHERE user_id=p_user_id AND environment=p_environment
      AND status IN (''pending'',''ready'')) THEN v_restriction:=''gift_checkout_pending''; END IF;
  RETURN jsonb_build_object(''gift_redemption_available'',v_available,''redemption_restriction'',v_restriction,''gifts'',
    coalesce((SELECT jsonb_agg(public.cloud_gift_view(g)) FROM (SELECT * FROM public.tokentracker_cloud_gift_grants
      WHERE user_id=p_user_id AND environment=p_environment ORDER BY redeemed_at DESC,id DESC LIMIT 20) g),''[]''::jsonb));
END;
$fn$;

CREATE FUNCTION public.cloud_redeem_gift(p_user_id uuid,p_environment text,p_code_hash text,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog,public,pg_temp AS $fn$
DECLARE
  v_code public.tokentracker_cloud_gift_codes%ROWTYPE; v_batch public.tokentracker_cloud_gift_batches%ROWTYPE;
  v_grant public.tokentracker_cloud_gift_grants%ROWTYPE; v_attempt public.tokentracker_cloud_gift_attempts%ROWTYPE;
  v_now timestamptz; v_start timestamptz; v_period record; v_restriction text;
BEGIN
  IF p_environment IS NULL OR p_environment NOT IN (''live'',''sandbox'') OR p_user_id IS NULL OR p_request_id IS NULL OR
    NOT EXISTS (SELECT 1 FROM auth.users WHERE id=p_user_id) THEN RAISE EXCEPTION ''invalid gift request''; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text||'':''||p_environment,0));
  v_now:=clock_timestamp();
  SELECT * INTO v_code FROM public.tokentracker_cloud_gift_codes
    WHERE environment=p_environment AND code_hash=p_code_hash FOR UPDATE;
  IF FOUND THEN
    SELECT * INTO v_grant FROM public.tokentracker_cloud_gift_grants WHERE code_id=v_code.id;
    IF FOUND AND v_grant.user_id=p_user_id THEN
      RETURN jsonb_build_object(''ok'',true,''reused'',true,''gift'',public.cloud_gift_view(v_grant),
        ''membership'',public.cloud_membership(p_user_id,p_environment));
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tokentracker_cloud_policy WHERE environment=p_environment
      AND hosting_mode=''hosted'' AND phase=''active'' AND launch_at<=v_now) THEN
    RETURN jsonb_build_object(''ok'',false,''status'',409,''code'',''gift_not_available'');
  END IF;
  INSERT INTO public.tokentracker_cloud_gift_attempts VALUES(p_user_id,p_environment,v_now,0)
    ON CONFLICT(user_id,environment) DO UPDATE SET window_started_at=excluded.window_started_at,failed_attempts=0
      WHERE tokentracker_cloud_gift_attempts.window_started_at<=v_now-interval ''15 minutes'';
  SELECT * INTO STRICT v_attempt FROM public.tokentracker_cloud_gift_attempts
    WHERE user_id=p_user_id AND environment=p_environment FOR UPDATE;
  IF v_attempt.failed_attempts>=10 THEN
    RETURN jsonb_build_object(''ok'',false,''status'',429,''code'',''gift_redemption_rate_limited'',
      ''retry_after'',greatest(1,ceil(extract(epoch FROM v_attempt.window_started_at+interval ''15 minutes''-v_now))));
  END IF;
  IF v_code.id IS NOT NULL THEN
    SELECT * INTO STRICT v_batch FROM public.tokentracker_cloud_gift_batches WHERE id=v_code.batch_id FOR SHARE;
  END IF;
  IF v_code.id IS NULL OR v_grant.id IS NOT NULL OR v_batch.disabled_at IS NOT NULL OR v_batch.redeem_before<=v_now OR
    EXISTS (SELECT 1 FROM public.tokentracker_cloud_gift_grants WHERE user_id=p_user_id AND environment=p_environment AND request_id=p_request_id) THEN
    UPDATE public.tokentracker_cloud_gift_attempts SET failed_attempts=failed_attempts+1
      WHERE user_id=p_user_id AND environment=p_environment;
    RETURN jsonb_build_object(''ok'',false,''status'',400,''code'',''gift_code_unavailable'');
  END IF;
  -- Read after the account lock in this volatile function. A checkout created
  -- while redemption waited must be visible before any code is consumed.
  IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_subscriptions WHERE user_id=p_user_id AND environment=p_environment
      AND status IN (''pending'',''active'',''trialing'',''past_due'',''paused'') AND NOT cancel_at_period_end) THEN
    v_restriction:=''gift_requires_renewal_cancel'';
  ELSIF EXISTS (SELECT 1 FROM public.tokentracker_cloud_orders WHERE user_id=p_user_id AND environment=p_environment
      AND status IN (''pending'',''ready'')) THEN v_restriction:=''gift_checkout_pending''; END IF;
  IF v_restriction IS NOT NULL THEN RETURN jsonb_build_object(''ok'',false,''status'',409,''code'',v_restriction); END IF;
  v_start:=v_now;
  FOR v_period IN SELECT starts_at,ends_at FROM public.tokentracker_cloud_payments WHERE user_id=p_user_id AND environment=p_environment
      AND refunded_cents<amount_cents AND revoked_at IS NULL AND ends_at>v_now
    UNION ALL SELECT starts_at,ends_at FROM public.tokentracker_cloud_gift_grants WHERE user_id=p_user_id AND environment=p_environment
      AND revoked_at IS NULL AND ends_at>v_now ORDER BY starts_at,ends_at
  LOOP
    IF v_period.starts_at<=v_start THEN v_start:=greatest(v_start,v_period.ends_at); END IF;
  END LOOP;
  INSERT INTO public.tokentracker_cloud_gift_grants(code_id,user_id,environment,request_id,duration_days,redeemed_at,starts_at,ends_at)
    VALUES(v_code.id,p_user_id,p_environment,p_request_id,v_batch.duration_days,v_now,v_start,
      v_start+v_batch.duration_days*interval ''24 hours'') RETURNING * INTO v_grant;
  RETURN jsonb_build_object(''ok'',true,''reused'',false,''gift'',public.cloud_gift_view(v_grant),
    ''membership'',public.cloud_membership(p_user_id,p_environment));
END;
$fn$;

-- All purchase/trial entry points share the same account lock as redemption.
ALTER FUNCTION public.cloud_create_order(uuid,text,text,text,uuid) RENAME TO cloud_create_order_before_gifts;
CREATE FUNCTION public.cloud_create_order(p_user_id uuid,p_environment text,p_provider text,p_sku text,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog,public,pg_temp AS $fn$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text||'':''||p_environment,0));
  IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_gift_grants WHERE user_id=p_user_id AND environment=p_environment
      AND revoked_at IS NULL AND ends_at>clock_timestamp()) AND NOT EXISTS (
    SELECT 1 FROM public.tokentracker_cloud_orders WHERE user_id=p_user_id AND environment=p_environment
      AND request_id=p_request_id AND provider=p_provider AND sku=p_sku AND status=''paid'') THEN
    RAISE EXCEPTION ''gift_membership_active'';
  END IF;
  RETURN public.cloud_create_order_before_gifts(p_user_id,p_environment,p_provider,p_sku,p_request_id);
END;
$fn$;
ALTER FUNCTION public.cloud_claim_checkout(uuid,uuid) RENAME TO cloud_claim_checkout_before_gifts;
CREATE FUNCTION public.cloud_claim_checkout(p_user_id uuid,p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog,public,pg_temp AS $fn$
DECLARE v_order public.tokentracker_cloud_orders%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_order FROM public.tokentracker_cloud_orders WHERE id=p_order_id AND user_id=p_user_id;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text||'':''||v_order.environment,0));
  SELECT * INTO STRICT v_order FROM public.tokentracker_cloud_orders WHERE id=p_order_id AND user_id=p_user_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_gift_grants WHERE user_id=p_user_id AND environment=v_order.environment
      AND revoked_at IS NULL AND ends_at>clock_timestamp()) AND v_order.status<>''paid'' THEN
    RAISE EXCEPTION ''gift_membership_active'';
  END IF;
  RETURN public.cloud_claim_checkout_before_gifts(p_user_id,p_order_id);
END;
$fn$;
ALTER FUNCTION public.cloud_start_trial(uuid,text) RENAME TO cloud_start_trial_before_gifts;
CREATE FUNCTION public.cloud_start_trial(p_user_id uuid,p_environment text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog,public,pg_temp AS $fn$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text||'':''||p_environment,0));
  IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_gift_grants WHERE user_id=p_user_id AND environment=p_environment) THEN
    RAISE EXCEPTION ''trial is only available before the first purchase or gift'';
  END IF;
  RETURN public.cloud_start_trial_before_gifts(p_user_id,p_environment);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.cloud_pro_badges(p_user_ids uuid[],p_environment text DEFAULT ''live'')
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = pg_catalog,public,pg_temp AS $fn$
BEGIN
  IF p_environment IS NULL OR p_environment NOT IN (''live'',''sandbox'') THEN RAISE EXCEPTION ''Invalid badge environment''; END IF;
  IF coalesce(cardinality(p_user_ids),0)>101 THEN RAISE EXCEPTION ''Too many badge users''; END IF;
  -- Private self-hosted installations do not install the public profile table.
  IF NOT EXISTS (SELECT 1 FROM public.tokentracker_cloud_policy WHERE environment=p_environment
      AND phase=''active'' AND hosting_mode=''hosted'' AND launch_at<=statement_timestamp()) THEN RETURN ''{}''::jsonb; END IF;
  RETURN coalesce((SELECT jsonb_object_agg(u.user_id::text,true) FROM (SELECT DISTINCT unnest(p_user_ids) AS user_id) u
    WHERE u.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.tokentracker_cloud_policy WHERE environment=p_environment
      AND phase=''active'' AND hosting_mode=''hosted'' AND launch_at<=statement_timestamp())
    AND NOT EXISTS (SELECT 1 FROM public.tokentracker_user_settings s WHERE s.user_id=u.user_id AND s.leaderboard_anonymous)
    AND (EXISTS (SELECT 1 FROM public.tokentracker_cloud_payments p WHERE p.user_id=u.user_id AND p.environment=p_environment
      AND p.starts_at<=statement_timestamp() AND p.ends_at>statement_timestamp() AND p.refunded_cents<p.amount_cents AND p.revoked_at IS NULL)
    OR EXISTS (SELECT 1 FROM public.tokentracker_cloud_gift_grants g WHERE g.user_id=u.user_id AND g.environment=p_environment
      AND g.starts_at<=statement_timestamp() AND g.ends_at>statement_timestamp() AND g.revoked_at IS NULL))),''{}''::jsonb);
END;
$fn$;

REVOKE ALL ON FUNCTION public.cloud_guard_gift_grant(),public.cloud_gift_view(public.tokentracker_cloud_gift_grants),
  public.cloud_create_gift_batch(text,uuid,integer,timestamptz,text,jsonb),public.cloud_list_gift_batches(text,integer),
  public.cloud_list_gift_codes(text,uuid,integer),public.cloud_disable_gift_batch(text,uuid),public.cloud_revoke_gift(text,uuid),
  public.cloud_gift_account(uuid,text),public.cloud_redeem_gift(uuid,text,text,uuid),public.cloud_membership(uuid,text),
  public.cloud_membership_before_gifts(uuid,text),public.cloud_create_order(uuid,text,text,text,uuid),
  public.cloud_create_order_before_gifts(uuid,text,text,text,uuid),public.cloud_claim_checkout(uuid,uuid),
  public.cloud_claim_checkout_before_gifts(uuid,uuid),public.cloud_start_trial(uuid,text),
  public.cloud_start_trial_before_gifts(uuid,text),public.cloud_pro_badges(uuid[],text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cloud_guard_gift_grant(),public.cloud_gift_view(public.tokentracker_cloud_gift_grants),
  public.cloud_create_gift_batch(text,uuid,integer,timestamptz,text,jsonb),public.cloud_list_gift_batches(text,integer),
  public.cloud_list_gift_codes(text,uuid,integer),public.cloud_disable_gift_batch(text,uuid),public.cloud_revoke_gift(text,uuid),
  public.cloud_gift_account(uuid,text),public.cloud_redeem_gift(uuid,text,text,uuid),public.cloud_membership(uuid,text),
  public.cloud_membership_before_gifts(uuid,text),public.cloud_create_order(uuid,text,text,text,uuid),
  public.cloud_create_order_before_gifts(uuid,text,text,text,uuid),public.cloud_claim_checkout(uuid,uuid),
  public.cloud_claim_checkout_before_gifts(uuid,uuid),public.cloud_start_trial(uuid,text),
  public.cloud_start_trial_before_gifts(uuid,text),public.cloud_pro_badges(uuid[],text) TO project_admin;
NOTIFY pgrst,''reload schema'';
';
        INSERT INTO public.tokentracker_self_host_installations(step,checksum) VALUES ('12-pro-gifts','d3929a662143ab38f2e8edca5bcfd9549546e711222f4a20a6ba6c202f73d777');
      END IF;
    END $install$;

DO $install$ DECLARE v_checksum text; BEGIN
      SELECT checksum INTO v_checksum FROM public.tokentracker_self_host_installations WHERE step = '13-machine-alias-cascade';
      IF FOUND AND v_checksum <> '002132f9587810337d2e9f1667ce2c33bf5be2b6689cf051fa21ababc9122f53' THEN RAISE EXCEPTION 'Installed step has changed: %','13-machine-alias-cascade'; END IF;
      IF NOT FOUND THEN
        EXECUTE '-- Aliases belong to their machine slot and must not block account deletion.
ALTER TABLE public.tokentracker_cloud_machine_aliases
  DROP CONSTRAINT tokentracker_cloud_machine_al_user_id_environment_machine__fkey,
  ADD CONSTRAINT tokentracker_cloud_machine_al_user_id_environment_machine__fkey
    FOREIGN KEY (user_id, environment, machine_id)
    REFERENCES public.tokentracker_cloud_machines(user_id, environment, id)
    ON DELETE CASCADE;
';
        INSERT INTO public.tokentracker_self_host_installations(step,checksum) VALUES ('13-machine-alias-cascade','002132f9587810337d2e9f1667ce2c33bf5be2b6689cf051fa21ababc9122f53');
      END IF;
    END $install$;

DO $verify$ DECLARE v_name text; BEGIN
    FOREACH v_name IN ARRAY ARRAY['tokentracker_devices','tokentracker_device_codes','tokentracker_device_tokens',
      'tokentracker_hourly','tokentracker_device_machine','tokentracker_account_session_states','tokentracker_cloud_machines'] LOOP
      IF to_regclass('public.'||v_name) IS NULL THEN RAISE EXCEPTION 'Installed table is missing: %',v_name; END IF;
    END LOOP;
    FOREACH v_name IN ARRAY ARRAY['cloud_membership(uuid,text)','cloud_account_access(uuid,text,text)',
      'cloud_ingest_usage(text,text,jsonb,jsonb,text)','cloud_issue_device_token(uuid,text,text,text,text,text[],uuid,text,boolean,text)',
      'account_summary_wire(uuid,uuid,timestamptz,timestamptz,text,integer,text,text)',
      'account_daily_wire(uuid,uuid,timestamptz,timestamptz,text,integer,text,text)',
      'account_heatmap_wire(uuid,uuid,timestamptz,timestamptz,text,integer,text,text)',
      'account_model_breakdown_wire(uuid,uuid,timestamptz,timestamptz,text,integer,text,text)'] LOOP
      IF to_regprocedure('public.'||v_name) IS NULL THEN RAISE EXCEPTION 'Installed function is missing: %',v_name; END IF;
      IF has_function_privilege('anon','public.'||v_name,'EXECUTE') OR
        has_function_privilege('authenticated','public.'||v_name,'EXECUTE') THEN
        RAISE EXCEPTION 'Private function is exposed to a client role: %',v_name;
      END IF;
    END LOOP;
  END $verify$;

UPDATE public.tokentracker_cloud_policy SET hosting_mode = 'self_hosted',phase = 'active',launch_at = coalesce(launch_at,clock_timestamp());
NOTIFY pgrst,'reload schema';
