-- Storage usage and quota readable only by their own user (F410). Spec: docs/specs/2026-11-26-user-storage-own-user.md.
--
-- public.user_storage_used_bytes(uuid) and public.user_storage_quota_bytes(uuid) are live on NTER but in no migration
-- on main: they came from the file-manager branch's supabase_dashboard_storage_setup.sql, pasted into the dashboard.
-- Read on NTER 2026-11-25: both are SECURITY DEFINER and executable by PUBLIC and anon (Supabase's security advisor,
-- lint 0028, flags both). used_bytes refuses another user's id only when auth.uid() is set, so a signed-out caller
-- reads any user's usage by id; quota_bytes checks no owner at all, so any caller reads any user's quota, and with it
-- their plan. The only callers pass their own id: the file manager's client (user.id) and user_file_prepare_upload
-- (security invoker, auth.uid()).
--
-- WHAT THIS CHANGES, only where both functions exist (on a database without them it does nothing, so main's
-- from-scratch build is unaffected; with only one of them it refuses):
--   * Both bodies: a request made for an end user (a token with a user id, or the anon or authenticated role) may read
--     only its own figures; anything else raises 42501. The service role and a direct database session (no token)
--     may still read any user's. Otherwise the bodies are NTER's, unchanged: same arguments and default, same
--     counting, same plan-to-quota mapping, still STABLE SECURITY DEFINER with search_path public, pg_temp.
--   * Grants: execute revoked from PUBLIC and anon; authenticated and service_role keep it.
--   * A self-check at the end raises (and so undoes everything) if anon or PUBLIC can still execute either function.
-- It reads and writes no table.
--
-- APPLY on NTER: by psql as postgres, with the history row inserted by hand under 20261126090000 (rollback-runbook.md;
-- never `supabase db push`, F283). Then: the advisor's lint 0028 no longer lists either function, and
--   select has_function_privilege('anon','public.user_storage_used_bytes(uuid)','execute'),
--          has_function_privilege('anon','public.user_storage_quota_bytes(uuid)','execute');   -- false, false
--
-- DOWN (restores the exposure; only to undo a fault this change caused): re-run the two CREATE OR REPLACE FUNCTION
-- statements in supabase/tests/bootstrap_user_storage_live.sql (NTER's bodies of 2026-11-25), then
--   grant execute on function public.user_storage_used_bytes(uuid), public.user_storage_quota_bytes(uuid) to public, anon;
--
-- For whoever adopts the file-manager schema into main: its migration redefines both functions with the old bodies.
-- Carry these bodies and grants into it, or this fix is undone the next time that file runs.

do $migration$
declare
  v_used regprocedure := to_regprocedure('public.user_storage_used_bytes(uuid)');
  v_quota regprocedure := to_regprocedure('public.user_storage_quota_bytes(uuid)');
begin
  if v_used is null and v_quota is null then
    raise notice 'F410: public.user_storage_used_bytes and public.user_storage_quota_bytes do not exist here; nothing to do';
    return;
  end if;
  if v_used is null or v_quota is null then
    raise exception 'F410: only one of user_storage_used_bytes and user_storage_quota_bytes exists; refusing to guess';
  end if;

  CREATE OR REPLACE FUNCTION public.user_storage_quota_bytes(p_user_id uuid DEFAULT NULL::uuid)
   RETURNS bigint
   LANGUAGE plpgsql
   STABLE SECURITY DEFINER
   SET search_path TO 'public', 'pg_temp'
  AS $function$
  DECLARE
    v_uid uuid := COALESCE(p_user_id, (SELECT auth.uid()));
    v_caller uuid := (SELECT auth.uid());
    v_role text := (SELECT auth.role());
    v_ent jsonb;
    v_plan text;
    v_status text;
    v_lapsed boolean;
  BEGIN
    IF v_uid IS NULL THEN
      RETURN 524288000; -- 500 MB default
    END IF;

    -- F410: a request made for an end user reads only its own quota (and so its own plan).
    IF (v_caller IS NOT NULL OR v_role IN ('anon', 'authenticated')) AND v_caller IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'unauthorized: cannot inspect the storage quota of another user' USING ERRCODE = '42501';
    END IF;

    IF to_regproc('public.entitlement_from') IS NOT NULL THEN
      EXECUTE 'SELECT public.entitlement_from(p) FROM public.user_profiles p WHERE p.user_id = $1'
        INTO v_ent USING v_uid;
    ELSE
      SELECT jsonb_build_object('plan', p.plan, 'status', 'active', 'lapsed', false)
        INTO v_ent
        FROM public.user_profiles p
        WHERE p.user_id = v_uid;
    END IF;

    IF v_ent IS NULL THEN
      RETURN 524288000;
    END IF;

    v_plan := lower(COALESCE(v_ent->>'plan', 'free'));
    v_status := lower(COALESCE(v_ent->>'status', 'free'));
    v_lapsed := COALESCE((v_ent->>'lapsed')::boolean, false);

    IF v_lapsed IS TRUE OR v_status = 'free' OR v_plan IN ('free', 'explorer') THEN
      RETURN 524288000;    -- 500 MB Free
    ELSIF v_plan IN ('plus') THEN
      RETURN 2147483648;   -- 2 GB Plus
    ELSIF v_plan IN ('pro', 'professional') THEN
      RETURN 5368709120;   -- 5 GB Pro
    ELSIF v_plan IN ('max', 'enterprise') THEN
      RETURN 53687091200;  -- 50 GB Max
    ELSE
      RETURN 524288000;
    END IF;
  END;
  $function$;

  CREATE OR REPLACE FUNCTION public.user_storage_used_bytes(p_user_id uuid DEFAULT NULL::uuid)
   RETURNS bigint
   LANGUAGE plpgsql
   STABLE SECURITY DEFINER
   SET search_path TO 'public', 'pg_temp'
  AS $function$
  DECLARE
    v_uid uuid := COALESCE(p_user_id, (SELECT auth.uid()));
    v_caller uuid := (SELECT auth.uid());
    v_role text := (SELECT auth.role());
    v_used bigint;
  BEGIN
    IF v_uid IS NULL THEN
      RETURN 0;
    END IF;

    -- F410: a request made for an end user reads only its own usage, whether or not it carries a user id.
    IF (v_caller IS NOT NULL OR v_role IN ('anon', 'authenticated')) AND v_caller IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'unauthorized: cannot inspect storage usage of another user' USING ERRCODE = '42501';
    END IF;

    SELECT COALESCE(SUM(size_bytes), 0) INTO v_used
    FROM public.user_files
    WHERE user_id = v_uid
      AND upload_status <> 'upload_failed'
      AND NOT (upload_status = 'pending_upload' AND created_at < (now() - interval '2 hours'));

    RETURN v_used;
  END;
  $function$;

  REVOKE EXECUTE ON FUNCTION public.user_storage_used_bytes(uuid), public.user_storage_quota_bytes(uuid) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.user_storage_used_bytes(uuid), public.user_storage_quota_bytes(uuid) TO authenticated, service_role;

  -- Self-check: neither function is executable by anon or PUBLIC, and both stay executable by the two callers' roles.
  IF has_function_privilege('anon', v_used, 'execute') OR has_function_privilege('anon', v_quota, 'execute')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                WHERE p.oid IN (v_used, v_quota) AND a.grantee = 0) THEN
    RAISE EXCEPTION 'F410 self-check: anon or PUBLIC can still execute a user_storage function';
  END IF;
  IF NOT (has_function_privilege('authenticated', v_used, 'execute') AND has_function_privilege('authenticated', v_quota, 'execute')
          AND has_function_privilege('service_role', v_used, 'execute') AND has_function_privilege('service_role', v_quota, 'execute')) THEN
    RAISE EXCEPTION 'F410 self-check: authenticated or service_role lost execute on a user_storage function';
  END IF;
END
$migration$;
