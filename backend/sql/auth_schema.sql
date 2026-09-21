-- ============================================================
-- NIYANTRAN AI
-- AUTHENTICATION + USER PROFILE + FUTURE ORGANISATION/RBAC
--
-- Supabase / PostgreSQL
--
-- Roles:
--   user
--   admin
--   owner
--
-- Personas:
--   policy_analyst
--   journalist
--   upsc_aspirant
--   corporate_affairs
--   legal_researcher
--   academic
--
-- Plans:
--   explorer
--   professional
--   enterprise
--
-- Default:
--   role = user
--   plan = explorer
--   organisation_id = NULL
-- ============================================================


-- ============================================================
-- 0. EXTENSIONS
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ============================================================
-- 1. ENUMS
-- ============================================================

DO $$
BEGIN
    CREATE TYPE public.app_role AS ENUM (
        'user',
        'admin',
        'owner'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;


DO $$
BEGIN
    CREATE TYPE public.app_persona AS ENUM (
        'policy_analyst',
        'journalist',
        'upsc_aspirant',
        'corporate_affairs',
        'legal_researcher',
        'academic'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;


DO $$
BEGIN
    CREATE TYPE public.app_plan AS ENUM (
        'explorer',
        'professional',
        'enterprise'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;


DO $$
BEGIN
    CREATE TYPE public.account_status AS ENUM (
        'active',
        'inactive',
        'suspended'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;


DO $$
BEGIN
    CREATE TYPE public.member_status AS ENUM (
        'active',
        'invited',
        'disabled'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;


DO $$
BEGIN
    CREATE TYPE public.invite_status AS ENUM (
        'pending',
        'accepted',
        'revoked',
        'expired'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;


-- ============================================================
-- 2. ORGANISATIONS
--
-- Normal users have organisation_id = NULL.
-- This table is prepared for future Enterprise.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.organisations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    name text NOT NULL,
    website text,
    logo_url text,
    about text,
    industry_id text,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);


-- ============================================================
-- 3. USER PROFILES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_profiles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Supabase Auth identity
    user_id uuid NOT NULL UNIQUE
        REFERENCES auth.users(id)
        ON DELETE CASCADE,

    -- NULL for normal users.
    -- Populated when organisation/enterprise functionality is used.
    organisation_id uuid
        REFERENCES public.organisations(id)
        ON DELETE SET NULL,

    -- Identity
    email text NOT NULL,

    first_name text,
    last_name text,

    -- Contact
    phone_number text,
    phone_verified boolean NOT NULL DEFAULT false,
    phone_verified_at timestamptz,

    -- Professional information
    department text,

    -- NTER persona
    persona public.app_persona,

    -- Legal/research context where applicable
    practice_area text,
    jurisdiction text,

    -- Language
    language text NOT NULL DEFAULT 'en',

    -- Platform role
    role public.app_role NOT NULL DEFAULT 'user',

    -- Subscription plan
    plan public.app_plan NOT NULL DEFAULT 'explorer',

    -- Account state
    status public.account_status NOT NULL DEFAULT 'active',

    -- Onboarding
    onboarding_complete boolean NOT NULL DEFAULT false,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT user_profiles_email_not_empty
        CHECK (length(trim(email)) > 0)
);


-- ============================================================
-- 4. ORGANISATION MEMBERS
--
-- Used when Enterprise/organisation functionality is activated.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.organisation_members (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    organisation_id uuid NOT NULL
        REFERENCES public.organisations(id)
        ON DELETE CASCADE,

    user_id uuid NOT NULL
        REFERENCES auth.users(id)
        ON DELETE CASCADE,

    role public.app_role NOT NULL DEFAULT 'user',

    status public.member_status NOT NULL DEFAULT 'active',

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    UNIQUE(organisation_id, user_id)
);


-- ============================================================
-- 5. USER ROLES
--
-- Explicit role mapping for future multi-organisation support.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id uuid NOT NULL
        REFERENCES auth.users(id)
        ON DELETE CASCADE,

    organisation_id uuid
        REFERENCES public.organisations(id)
        ON DELETE CASCADE,

    role public.app_role NOT NULL DEFAULT 'user',

    created_at timestamptz NOT NULL DEFAULT now(),

    UNIQUE(user_id, organisation_id, role)
);


-- ============================================================
-- 6. ORGANISATION INVITATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.organisation_invites (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    organisation_id uuid NOT NULL
        REFERENCES public.organisations(id)
        ON DELETE CASCADE,

    email text NOT NULL,

    role public.app_role NOT NULL DEFAULT 'user',

    status public.invite_status NOT NULL DEFAULT 'pending',

    token text NOT NULL UNIQUE
        DEFAULT encode(gen_random_bytes(24), 'hex'),

    email_sent_at timestamptz,

    expires_at timestamptz
        NOT NULL DEFAULT (now() + interval '7 days'),

    created_at timestamptz NOT NULL DEFAULT now(),

    accepted_at timestamptz,

    CONSTRAINT organisation_invites_role_check
        CHECK (role IN ('user', 'owner'))
);


-- ============================================================
-- 7. PRIVACY POLICY CONSENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.privacy_policy_consents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id uuid NOT NULL
        REFERENCES auth.users(id)
        ON DELETE CASCADE,

    policy_version text NOT NULL,

    accepted_at timestamptz NOT NULL DEFAULT now(),

    ip_address text,
    user_agent text
);


-- ============================================================
-- 8. INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_user_profiles_org
    ON public.user_profiles(organisation_id);

CREATE INDEX IF NOT EXISTS idx_user_profiles_email
    ON public.user_profiles(email);

CREATE INDEX IF NOT EXISTS idx_user_profiles_role
    ON public.user_profiles(role);

CREATE INDEX IF NOT EXISTS idx_user_profiles_plan
    ON public.user_profiles(plan);

CREATE INDEX IF NOT EXISTS idx_user_profiles_persona
    ON public.user_profiles(persona);

CREATE INDEX IF NOT EXISTS idx_user_profiles_status
    ON public.user_profiles(status);

CREATE INDEX IF NOT EXISTS idx_org_members_org
    ON public.organisation_members(organisation_id);

CREATE INDEX IF NOT EXISTS idx_org_members_user
    ON public.organisation_members(user_id);

CREATE INDEX IF NOT EXISTS idx_org_members_role
    ON public.organisation_members(role);

CREATE INDEX IF NOT EXISTS idx_user_roles_user
    ON public.user_roles(user_id);

CREATE INDEX IF NOT EXISTS idx_user_roles_org
    ON public.user_roles(organisation_id);

CREATE INDEX IF NOT EXISTS idx_invites_org
    ON public.organisation_invites(organisation_id);

CREATE INDEX IF NOT EXISTS idx_invites_email
    ON public.organisation_invites(email);

CREATE INDEX IF NOT EXISTS idx_invites_token
    ON public.organisation_invites(token);

CREATE INDEX IF NOT EXISTS idx_privacy_consents_user
    ON public.privacy_policy_consents(user_id);


-- ============================================================
-- 9. ONE ACTIVE OWNER PER ORGANISATION
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS one_active_owner_per_org
ON public.organisation_members(organisation_id)
WHERE role = 'owner'
  AND status = 'active';


-- ============================================================
-- 10. UPDATED_AT FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


-- ============================================================
-- 11. UPDATED_AT TRIGGERS
-- ============================================================

DROP TRIGGER IF EXISTS update_organisations_updated_at
ON public.organisations;

CREATE TRIGGER update_organisations_updated_at
BEFORE UPDATE ON public.organisations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();


DROP TRIGGER IF EXISTS update_user_profiles_updated_at
ON public.user_profiles;

CREATE TRIGGER update_user_profiles_updated_at
BEFORE UPDATE ON public.user_profiles
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();


DROP TRIGGER IF EXISTS update_org_members_updated_at
ON public.organisation_members;

CREATE TRIGGER update_org_members_updated_at
BEFORE UPDATE ON public.organisation_members
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();


-- ============================================================
-- 12. SECURITY HELPERS
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.user_profiles
        WHERE user_id = auth.uid()
          AND role = 'admin'
          AND status = 'active'
    );
$$;


CREATE OR REPLACE FUNCTION public.is_org_member(
    p_organisation_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.organisation_members
        WHERE organisation_id = p_organisation_id
          AND user_id = auth.uid()
          AND status = 'active'
    );
$$;


CREATE OR REPLACE FUNCTION public.is_org_owner(
    p_organisation_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.organisation_members
        WHERE organisation_id = p_organisation_id
          AND user_id = auth.uid()
          AND role = 'owner'
          AND status = 'active'
    );
$$;


-- ============================================================
-- 13. AUTO CREATE PROFILE AFTER SUPABASE SIGNUP
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN

    INSERT INTO public.user_profiles (
        user_id,
        email,
        first_name,
        last_name,
        role,
        plan,
        status,
        organisation_id,
        language,
        onboarding_complete
    )
    VALUES (
        NEW.id,
        COALESCE(NEW.email, ''),
        NEW.raw_user_meta_data ->> 'first_name',
        NEW.raw_user_meta_data ->> 'last_name',

        -- EVERY NORMAL SIGNUP STARTS AS USER
        'user',

        -- EVERY NORMAL SIGNUP STARTS AS EXPLORER
        'explorer',

        'active',

        -- NORMAL USERS HAVE NO ORGANISATION
        NULL,

        COALESCE(
            NEW.raw_user_meta_data ->> 'language',
            'en'
        ),

        false
    )
    ON CONFLICT (user_id)
    DO NOTHING;

    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS on_auth_user_created
ON auth.users;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();


-- ============================================================
-- 14. RLS ENABLEMENT
-- ============================================================

ALTER TABLE public.organisations
ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_profiles
ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.organisation_members
ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_roles
ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.organisation_invites
ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.privacy_policy_consents
ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- 15. ORGANISATION POLICIES
-- ============================================================

DROP POLICY IF EXISTS "Users can view organisation"
ON public.organisations;

CREATE POLICY "Users can view organisation"
ON public.organisations
FOR SELECT
TO authenticated
USING (
    public.is_platform_admin()
    OR public.is_org_member(id)
);


DROP POLICY IF EXISTS "Authenticated users can create organisation"
ON public.organisations;

DROP POLICY IF EXISTS "Owners can update organisation"
ON public.organisations;

CREATE POLICY "Owners can update organisation"
ON public.organisations
FOR UPDATE
TO authenticated
USING (
    public.is_platform_admin()
    OR public.is_org_owner(id)
)
WITH CHECK (
    public.is_platform_admin()
    OR public.is_org_owner(id)
);


-- ============================================================
-- 16. USER PROFILE POLICIES
-- ============================================================

DROP POLICY IF EXISTS "Users can view own profile"
ON public.user_profiles;

CREATE POLICY "Users can view own profile"
ON public.user_profiles
FOR SELECT
TO authenticated
USING (
    user_id = auth.uid()
    OR public.is_platform_admin()
);


DROP POLICY IF EXISTS "Users can view organisation profiles"
ON public.user_profiles;

CREATE POLICY "Users can view organisation profiles"
ON public.user_profiles
FOR SELECT
TO authenticated
USING (
    organisation_id IS NOT NULL
    AND public.is_org_member(organisation_id)
);


DROP POLICY IF EXISTS "Users can insert own profile"
ON public.user_profiles;

DROP POLICY IF EXISTS "Users can update own profile"
ON public.user_profiles;

CREATE POLICY "Users can update own profile"
ON public.user_profiles
FOR UPDATE
TO authenticated
USING (
    user_id = auth.uid()
    OR public.is_platform_admin()
)
WITH CHECK (
    user_id = auth.uid()
    OR public.is_platform_admin()
);


-- ============================================================
-- 17. ORGANISATION MEMBER POLICIES
-- ============================================================

DROP POLICY IF EXISTS "Members can view organisation members"
ON public.organisation_members;

CREATE POLICY "Members can view organisation members"
ON public.organisation_members
FOR SELECT
TO authenticated
USING (
    public.is_platform_admin()
    OR public.is_org_member(organisation_id)
);


DROP POLICY IF EXISTS "Owners can manage organisation members"
ON public.organisation_members;

CREATE POLICY "Owners can manage organisation members"
ON public.organisation_members
FOR ALL
TO authenticated
USING (
    public.is_platform_admin()
    OR public.is_org_owner(organisation_id)
)
WITH CHECK (
    public.is_platform_admin()
    OR public.is_org_owner(organisation_id)
);


-- ============================================================
-- 18. USER ROLES POLICIES
-- ============================================================

DROP POLICY IF EXISTS "Users can view roles"
ON public.user_roles;

CREATE POLICY "Users can view roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (
    public.is_platform_admin()
    OR user_id = auth.uid()
    OR (
        organisation_id IS NOT NULL
        AND public.is_org_member(organisation_id)
    )
);


DROP POLICY IF EXISTS "Admins can manage roles"
ON public.user_roles;

CREATE POLICY "Admins can manage roles"
ON public.user_roles
FOR ALL
TO authenticated
USING (
    public.is_platform_admin()
    OR (
        organisation_id IS NOT NULL
        AND public.is_org_owner(organisation_id)
    )
)
WITH CHECK (
    public.is_platform_admin()
    OR (
        organisation_id IS NOT NULL
        AND public.is_org_owner(organisation_id)
    )
);


-- ============================================================
-- 19. INVITATION POLICIES
-- ============================================================

DROP POLICY IF EXISTS "Admins can view invites"
ON public.organisation_invites;

CREATE POLICY "Admins can view invites"
ON public.organisation_invites
FOR SELECT
TO authenticated
USING (
    public.is_platform_admin()
    OR public.is_org_owner(organisation_id)
);


DROP POLICY IF EXISTS "Owners can create invites"
ON public.organisation_invites;

CREATE POLICY "Owners can create invites"
ON public.organisation_invites
FOR INSERT
TO authenticated
WITH CHECK (
    public.is_platform_admin()
    OR public.is_org_owner(organisation_id)
);


DROP POLICY IF EXISTS "Owners can update invites"
ON public.organisation_invites;

CREATE POLICY "Owners can update invites"
ON public.organisation_invites
FOR UPDATE
TO authenticated
USING (
    public.is_platform_admin()
    OR public.is_org_owner(organisation_id)
)
WITH CHECK (
    public.is_platform_admin()
    OR public.is_org_owner(organisation_id)
);


-- ============================================================
-- 20. PRIVACY CONSENT POLICIES
-- ============================================================

DROP POLICY IF EXISTS "Users can view own consent"
ON public.privacy_policy_consents;

CREATE POLICY "Users can view own consent"
ON public.privacy_policy_consents
FOR SELECT
TO authenticated
USING (
    user_id = auth.uid()
    OR public.is_platform_admin()
);


DROP POLICY IF EXISTS "Users can create own consent"
ON public.privacy_policy_consents;

CREATE POLICY "Users can create own consent"
ON public.privacy_policy_consents
FOR INSERT
TO authenticated
WITH CHECK (
    user_id = auth.uid()
);


-- ============================================================
-- 21. GET CURRENT USER PROFILE
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS public.user_profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT *
    FROM public.user_profiles
    WHERE user_id = auth.uid()
    LIMIT 1;
$$;


-- ============================================================
-- 22. UPDATE NTER ONBOARDING PROFILE
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_my_onboarding_profile(
    p_persona public.app_persona DEFAULT NULL,
    p_practice_area text DEFAULT NULL,
    p_jurisdiction text DEFAULT NULL,
    p_language text DEFAULT 'en',
    p_onboarding_complete boolean DEFAULT false
)
RETURNS public.user_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_profile public.user_profiles;
BEGIN

    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    UPDATE public.user_profiles
    SET
        persona = p_persona,
        practice_area = p_practice_area,
        jurisdiction = p_jurisdiction,
        language = COALESCE(NULLIF(trim(p_language), ''), 'en'),
        onboarding_complete = p_onboarding_complete,
        updated_at = now()
    WHERE user_id = auth.uid()
    RETURNING *
    INTO v_profile;

    IF v_profile.id IS NULL THEN
        RAISE EXCEPTION 'User profile not found';
    END IF;

    RETURN v_profile;
END;
$$;


-- ============================================================
-- 23. PROFILE AUTHORITY AND RPC PRIVILEGES
--
-- Kept equivalent to migration 20260921000012_profile_authority.sql.
-- ============================================================

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
        'first_name', 'last_name', 'phone_number', 'department',
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

    IF NEW.phone_number IS DISTINCT FROM OLD.phone_number THEN
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
    first_name, last_name, phone_number, department, persona,
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
