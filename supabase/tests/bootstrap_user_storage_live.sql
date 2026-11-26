-- Disposable stand-in for the user_storage_* functions as they are live on NTER. NEVER apply to a Supabase project.
--
-- F410. The two functions are on NTER but in no migration on main: they came from the file-manager branch's
-- supabase_dashboard_storage_setup.sql, pasted into the dashboard. The bodies below were read from NTER with
-- pg_get_functiondef on 2026-11-25 and are copied verbatim (carriage returns removed). The ACL they end up with here is
-- NTER's: {=X, postgres=X, anon=X, authenticated=X, service_role=X}, from PUBLIC's default execute plus the
-- Supabase-style default privileges in bootstrap_auth.sql. The tables carry only the columns the functions read.
-- On NTER, public.entitlement_from exists, so quota_bytes takes its dynamic branch; here it does not, so it takes
-- the fallback branch, which reads user_profiles.plan. The plan-to-quota mapping is the same either way.
\set ON_ERROR_STOP on

create table public.user_profiles (
  user_id uuid primary key,
  plan text not null default 'free'
);

create table public.user_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  size_bytes bigint not null,
  upload_status text not null,
  created_at timestamptz not null default now()
);

CREATE OR REPLACE FUNCTION public.user_storage_quota_bytes(p_user_id uuid DEFAULT NULL::uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := COALESCE(p_user_id, (SELECT auth.uid()));
  v_ent jsonb;
  v_plan text;
  v_status text;
  v_lapsed boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN 524288000; -- 500 MB default
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
  v_used bigint;
BEGIN
  IF v_uid IS NULL THEN
    RETURN 0;
  END IF;

  IF (SELECT auth.uid()) IS NOT NULL AND (SELECT auth.uid()) <> v_uid THEN
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

-- NTER's grants, stated so the stand-in does not depend on how the defaults above happen to resolve.
grant execute on function public.user_storage_quota_bytes(uuid) to public, anon, authenticated, service_role;
grant execute on function public.user_storage_used_bytes(uuid) to public, anon, authenticated, service_role;
