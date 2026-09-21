-- B1: profiles expose preferences, while identity and entitlements remain
-- server-owned. Existing profiles and organisation data are preserved.
-- Apply after the reconciled 0011 baseline. No backfill or live data rewrite.

CREATE OR REPLACE FUNCTION public.guard_profile_authority()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    personal_columns constant text[] := ARRAY[
        'first_name', 'last_name', 'phone_e164', 'department', 'job_title',
        'persona', 'practice_area', 'jurisdiction', 'language',
        'onboarding_complete', 'updated_at'
    ];
BEGIN
    -- Check the executing database role, never a caller-supplied JWT claim.
    -- Auth's handle_new_user() executes as its trusted postgres owner.
    IF current_user IN ('postgres', 'service_role') THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        RAISE EXCEPTION 'Profile creation requires trusted server access'
            USING ERRCODE = '42501';
    END IF;

    -- Deny changes to every non-personal field, including future columns.
    -- updated_at is overwritten by the existing maintenance trigger.
    IF (to_jsonb(NEW) - personal_columns)
       IS DISTINCT FROM (to_jsonb(OLD) - personal_columns) THEN
        RAISE EXCEPTION 'Profile authority fields require trusted server access'
            USING ERRCODE = '42501';
    END IF;

    IF NEW.phone_e164 IS DISTINCT FROM OLD.phone_e164 THEN
        NEW.phone_verified := false;
        NEW.phone_verified_at := NULL;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_profiles_authority_guard ON public.user_profiles;
CREATE TRIGGER user_profiles_authority_guard
BEFORE INSERT OR UPDATE ON public.user_profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_profile_authority();

DROP POLICY IF EXISTS "Users can insert own profile" ON public.user_profiles;
REVOKE ALL ON public.user_profiles FROM PUBLIC, anon, authenticated;

-- Table-level REVOKE does not remove any prior column-level grants.
DO $$
DECLARE columns text;
BEGIN
    SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO columns
    FROM pg_attribute
    WHERE attrelid = 'public.user_profiles'::regclass
      AND attnum > 0 AND NOT attisdropped;
    EXECUTE 'REVOKE ALL (' || columns || ') ON public.user_profiles FROM PUBLIC, anon, authenticated';
END;
$$;

GRANT SELECT ON public.user_profiles TO authenticated;
GRANT UPDATE (
    first_name, last_name, phone_e164, department, job_title, persona,
    practice_area, jurisdiction, language, onboarding_complete, updated_at
) ON public.user_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_profiles TO service_role;

-- Organisation provisioning is deferred. Disable both the public RPC and
-- the direct-table fallback without dropping organisation tables or rows.
DROP POLICY IF EXISTS "Authenticated users can create organisation" ON public.organisations;
REVOKE INSERT ON public.organisations FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_organisation(
    p_name text,
    p_website text DEFAULT NULL,
    p_about text DEFAULT NULL,
    p_industry_id text DEFAULT NULL
)
RETURNS public.organisations
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'Public organisation provisioning is disabled'
        USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.create_organisation(text, text, text, text)
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.get_my_profile(),
    public.update_my_onboarding_profile(public.app_persona, text, text, text, boolean),
    public.is_platform_admin(), public.is_org_member(uuid), public.is_org_owner(uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_profile(),
    public.update_my_onboarding_profile(public.app_persona, text, text, text, boolean),
    public.is_platform_admin(), public.is_org_member(uuid), public.is_org_owner(uuid)
TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.guard_profile_authority(), public.handle_new_user()
FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.get_my_profile() SET search_path = '';
ALTER FUNCTION public.update_my_onboarding_profile(public.app_persona, text, text, text, boolean) SET search_path = '';
ALTER FUNCTION public.is_platform_admin() SET search_path = '';
ALTER FUNCTION public.is_org_member(uuid) SET search_path = '';
ALTER FUNCTION public.is_org_owner(uuid) SET search_path = '';
ALTER FUNCTION public.handle_new_user() SET search_path = '';
