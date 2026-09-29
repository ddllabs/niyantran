-- F2 phase 1: the plan is server-owned (docs/specs/2026-09-29-f2-entitlements.md).
--
-- Before this, the plan a user saw was whatever sessionStorage said: signup
-- wrote a 14-day trial there and checkout wrote a paid plan there, and no
-- database row changed. Now:
--
--   * user_profiles carries plan_status, plan_period_end, plan_source and
--     trial_started_at beside the existing plan. The profile authority guard
--     (0012) already refuses signed-in changes to every non-personal column,
--     and authenticated has UPDATE only on the personal columns, so users
--     cannot set any of them.
--   * my_entitlement() returns the effective plan. A period that has ended
--     reads as free at read time, so nothing needs a scheduled job.
--   * start_trial() grants 14 days of Pro or Enterprise, once per account.
--     handle_new_user() applies the trial picked at signup the same way.
--   * grant_paid_plan() (service role, called by /api/billing/verify after
--     its checks) and grant_manual_plan() (service role, called by the admin
--     users route) are the only other writers. Each grant is logged in
--     plan_grants; a payment id can be granted once.

-- 1. Columns -------------------------------------------------------------------
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS plan_status text NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS plan_period_end timestamptz,
  ADD COLUMN IF NOT EXISTS plan_source text,
  ADD COLUMN IF NOT EXISTS trial_started_at timestamptz;

-- An account already on a paid plan keeps it, open-ended, as a manual grant.
-- NTER had none on 2026-09-29 (all ten profiles were explorer).
UPDATE public.user_profiles
SET plan_status = 'active', plan_source = 'manual'
WHERE plan <> 'explorer' AND plan_status = 'free';

ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_plan_status_check
    CHECK (plan_status IN ('free', 'trial', 'active')),
  ADD CONSTRAINT user_profiles_plan_source_check
    CHECK (plan_source IS NULL OR plan_source IN ('trial', 'payment', 'manual')),
  -- Explorer is exactly the free status, and a trial always ends.
  ADD CONSTRAINT user_profiles_plan_consistent_check
    CHECK ((plan = 'explorer') = (plan_status = 'free')
           AND (plan_status <> 'trial' OR (plan_period_end IS NOT NULL AND plan_source = 'trial')));

-- 2. Grant log (server-only) -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.plan_grants (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan        public.app_plan NOT NULL,
  status      text        NOT NULL CHECK (status IN ('free', 'trial', 'active')),
  period_end  timestamptz,
  source      text        NOT NULL CHECK (source IN ('trial', 'payment', 'manual')),
  payment_id  text        UNIQUE CHECK (payment_id IS NULL OR length(payment_id) BETWEEN 1 AND 100),
  granted_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS plan_grants_user_idx ON public.plan_grants (user_id, created_at DESC);
ALTER TABLE public.plan_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.plan_grants FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.plan_grants TO service_role;

-- 3. Effective plan ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.entitlement_from(p public.user_profiles)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE
      WHEN p.plan_status <> 'free' AND p.plan_period_end IS NOT NULL AND p.plan_period_end <= now()
        THEN jsonb_build_object('plan', 'explorer', 'status', 'free', 'period_end', p.plan_period_end, 'lapsed', true)
      ELSE jsonb_build_object('plan', p.plan::text, 'status', p.plan_status, 'period_end', p.plan_period_end, 'lapsed', false)
    END
    || jsonb_build_object(
      'granted_plan', p.plan::text,
      'source', p.plan_source,
      'trial_used', p.trial_started_at IS NOT NULL
    );
$$;

CREATE OR REPLACE FUNCTION public.my_entitlement()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.entitlement_from(p)
  FROM public.user_profiles p
  WHERE p.user_id = auth.uid() AND p.status = 'active';
$$;

-- 'pro' is the browser's id for professional.
CREATE OR REPLACE FUNCTION public.paid_plan_of(p_plan text)
RETURNS public.app_plan
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT (CASE lower(coalesce(p_plan, ''))
            WHEN 'pro' THEN 'professional'
            WHEN 'professional' THEN 'professional'
            WHEN 'enterprise' THEN 'enterprise'
          END)::public.app_plan;
$$;

-- 4. Trial, once per account -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_trial(p_plan text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := auth.uid();
  target public.app_plan := public.paid_plan_of(p_plan);
  p public.user_profiles;
  ends timestamptz := now() + interval '14 days';
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to start a trial' USING ERRCODE = '42501';
  END IF;
  IF target IS NULL THEN
    RAISE EXCEPTION 'Trials are for Pro or Enterprise' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO p FROM public.user_profiles WHERE user_id = uid AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active account required' USING ERRCODE = '42501';
  END IF;
  IF p.trial_started_at IS NOT NULL THEN
    RAISE EXCEPTION 'This account has already used its trial' USING ERRCODE = 'P0001';
  END IF;
  IF public.entitlement_from(p) ->> 'status' = 'active' THEN
    RAISE EXCEPTION 'This account already has a paid plan' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.user_profiles
  SET plan = target, plan_status = 'trial', plan_source = 'trial',
      plan_period_end = ends, trial_started_at = now()
  WHERE user_id = uid
  RETURNING * INTO p;
  INSERT INTO public.plan_grants (user_id, plan, status, period_end, source)
  VALUES (uid, target, 'trial', ends, 'trial');
  RETURN public.entitlement_from(p);
END;
$$;

-- 5. Paid period (service role, after /api/billing/verify's checks) ---------------------
-- Paying for the plan already held extends from its current end; anything
-- else starts from now. A payment id already granted changes nothing.
CREATE OR REPLACE FUNCTION public.grant_paid_plan(p_user uuid, p_plan text, p_period text, p_payment_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target public.app_plan := public.paid_plan_of(p_plan);
  span interval := CASE p_period WHEN 'month' THEN interval '1 month' WHEN 'year' THEN interval '1 year' END;
  p public.user_profiles;
  base timestamptz;
  ends timestamptz;
BEGIN
  IF target IS NULL THEN
    RAISE EXCEPTION 'Unknown paid plan' USING ERRCODE = '22023';
  END IF;
  IF span IS NULL THEN
    RAISE EXCEPTION 'Period must be month or year' USING ERRCODE = '22023';
  END IF;
  IF p_payment_id IS NULL OR length(p_payment_id) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'A payment id is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO p FROM public.user_profiles WHERE user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No profile for this user' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT FROM public.plan_grants WHERE payment_id = p_payment_id) THEN
    RETURN public.entitlement_from(p);
  END IF;

  base := CASE
    WHEN p.plan_status = 'active' AND p.plan = target AND p.plan_period_end > now() THEN p.plan_period_end
    ELSE now()
  END;
  ends := base + span;
  UPDATE public.user_profiles
  SET plan = target, plan_status = 'active', plan_source = 'payment', plan_period_end = ends
  WHERE user_id = p_user
  RETURNING * INTO p;
  INSERT INTO public.plan_grants (user_id, plan, status, period_end, source, payment_id)
  VALUES (p_user, target, 'active', ends, 'payment', p_payment_id);
  RETURN public.entitlement_from(p);
END;
$$;

-- 6. Manual grant or revoke (service role, after the admin route's check) -----------------
-- explorer revokes. A null end is open-ended.
CREATE OR REPLACE FUNCTION public.grant_manual_plan(p_user uuid, p_plan text, p_period_end timestamptz, p_granted_by uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target public.app_plan;
  p public.user_profiles;
BEGIN
  IF lower(coalesce(p_plan, '')) = 'explorer' THEN
    target := 'explorer';
  ELSE
    target := public.paid_plan_of(p_plan);
  END IF;
  IF target IS NULL THEN
    RAISE EXCEPTION 'Unknown plan' USING ERRCODE = '22023';
  END IF;
  IF target <> 'explorer' AND p_period_end IS NOT NULL AND p_period_end <= now() THEN
    RAISE EXCEPTION 'The end date must be in the future' USING ERRCODE = '22023';
  END IF;

  UPDATE public.user_profiles
  SET plan = target,
      plan_status = CASE WHEN target = 'explorer' THEN 'free' ELSE 'active' END,
      plan_source = 'manual',
      plan_period_end = CASE WHEN target = 'explorer' THEN NULL ELSE p_period_end END
  WHERE user_id = p_user
  RETURNING * INTO p;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No profile for this user' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.plan_grants (user_id, plan, status, period_end, source, granted_by)
  VALUES (p_user, target, p.plan_status, p.plan_period_end, 'manual', p_granted_by);
  RETURN public.entitlement_from(p);
END;
$$;

-- 7. Signup applies the trial picked on the signup page ------------------------------------
-- The live function (20260928120000_signup_persona.sql) with the plan columns
-- added. raw_user_meta_data.plan is the signup page's pick: pro or enterprise
-- starts the account's one trial, anything else starts free. Role and status
-- are still fixed here, whatever the metadata says.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  trial public.app_plan := public.paid_plan_of(new.raw_user_meta_data ->> 'plan');
  ends timestamptz := CASE WHEN trial IS NOT NULL THEN now() + interval '14 days' END;
  created integer;
BEGIN
  INSERT INTO public.user_profiles (
    user_id,
    email,
    first_name,
    last_name,
    role,
    plan,
    plan_status,
    plan_source,
    plan_period_end,
    trial_started_at,
    status,
    organisation_id,
    language,
    onboarding_complete,
    persona
  )
  VALUES (
    new.id,
    coalesce(new.email, ''),
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name',
    -- every normal signup starts as user
    'user',
    -- explorer, or the picked plan on its 14-day trial
    coalesce(trial, 'explorer'),
    CASE WHEN trial IS NOT NULL THEN 'trial' ELSE 'free' END,
    CASE WHEN trial IS NOT NULL THEN 'trial' END,
    ends,
    CASE WHEN trial IS NOT NULL THEN now() END,
    'active',
    -- normal users have no organisation
    null,
    coalesce(new.raw_user_meta_data ->> 'language', 'en'),
    false,
    (CASE new.raw_user_meta_data ->> 'personaId'
       WHEN 'policy' THEN 'policy_analyst'
       WHEN 'journalist' THEN 'journalist'
       WHEN 'student' THEN 'upsc_aspirant'
       WHEN 'analyst' THEN 'corporate_affairs'
       WHEN 'lawyer' THEN 'legal_researcher'
       WHEN 'academic' THEN 'academic'
     END)::public.app_persona
  )
  ON CONFLICT (user_id) DO NOTHING;
  GET DIAGNOSTICS created = ROW_COUNT;

  IF created = 1 AND trial IS NOT NULL THEN
    INSERT INTO public.plan_grants (user_id, plan, status, period_end, source)
    VALUES (new.id, trial, 'trial', ends, 'trial');
  END IF;
  RETURN new;
END;
$$;

-- 8. Privileges ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION
  public.entitlement_from(public.user_profiles),
  public.paid_plan_of(text),
  public.my_entitlement(),
  public.start_trial(text),
  public.grant_paid_plan(uuid, text, text, text),
  public.grant_manual_plan(uuid, text, timestamptz, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_entitlement(), public.start_trial(text) TO authenticated;
GRANT EXECUTE ON FUNCTION
  public.entitlement_from(public.user_profiles),
  public.paid_plan_of(text),
  public.my_entitlement(),
  public.grant_paid_plan(uuid, text, text, text),
  public.grant_manual_plan(uuid, text, timestamptz, uuid)
TO service_role;
