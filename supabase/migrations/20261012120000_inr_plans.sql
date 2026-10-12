-- INR plan set (open-work F109; docs/specs/2026-10-12-inr-billing.md).
--
-- The owner's plans are Free ₹0, Plus ₹399, Pro ₹999 and Max ₹9,999 per
-- month, priced on AI credits, with no trials. This migration:
--
--   * renames app_plan values to the product's ids: explorer -> free,
--     professional -> pro, enterprise -> max, and adds plus. Stored rows,
--     column defaults and CHECK constraints follow a rename by themselves;
--     function bodies are text, so every function that names a value is
--     replaced below.
--   * retires trials: signup always starts free; start_trial refuses and is
--     no longer executable by signed-in users.
--   * makes paid periods monthly only.
--
-- NTER on 2026-10-12 (read-only check): 11 profiles, all explorer/free; no
-- plan_grants, no invoices. Apply in one transaction; 'plus' is only cast
-- at run time, never during this migration.
--
-- Down: rename the values back (free -> explorer, pro -> professional,
-- max -> enterprise; 'plus' cannot be dropped from an enum and stays unused),
-- then re-run sections 3-8 of 20260929100000_plan_entitlements.sql.

-- 1. Plan values -------------------------------------------------------------------
ALTER TYPE public.app_plan RENAME VALUE 'explorer' TO 'free';
ALTER TYPE public.app_plan RENAME VALUE 'professional' TO 'pro';
ALTER TYPE public.app_plan RENAME VALUE 'enterprise' TO 'max';
ALTER TYPE public.app_plan ADD VALUE IF NOT EXISTS 'plus' BEFORE 'pro';

-- 2. Effective plan: a lapsed period reads as free ------------------------------------
CREATE OR REPLACE FUNCTION public.entitlement_from(p public.user_profiles)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE
      WHEN p.plan_status <> 'free' AND p.plan_period_end IS NOT NULL AND p.plan_period_end <= now()
        THEN jsonb_build_object('plan', 'free', 'status', 'free', 'period_end', p.plan_period_end, 'lapsed', true)
      ELSE jsonb_build_object('plan', p.plan::text, 'status', p.plan_status, 'period_end', p.plan_period_end, 'lapsed', false)
    END
    || jsonb_build_object(
      'granted_plan', p.plan::text,
      'source', p.plan_source,
      'trial_used', p.trial_started_at IS NOT NULL
    );
$$;

-- 3. The paid plans ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.paid_plan_of(p_plan text)
RETURNS public.app_plan
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT (CASE lower(coalesce(p_plan, ''))
            WHEN 'plus' THEN 'plus'
            WHEN 'pro' THEN 'pro'
            WHEN 'max' THEN 'max'
          END)::public.app_plan;
$$;

-- 4. Trials are retired ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_trial(p_plan text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Trials are not offered' USING ERRCODE = '0A000';
END;
$$;

-- 5. Paid period: one month per verified payment ---------------------------------------
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
  p public.user_profiles;
  base timestamptz;
  ends timestamptz;
BEGIN
  IF target IS NULL THEN
    RAISE EXCEPTION 'Unknown paid plan' USING ERRCODE = '22023';
  END IF;
  IF p_period IS DISTINCT FROM 'month' THEN
    RAISE EXCEPTION 'Plans are billed monthly' USING ERRCODE = '22023';
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
  ends := base + interval '1 month';
  UPDATE public.user_profiles
  SET plan = target, plan_status = 'active', plan_source = 'payment', plan_period_end = ends
  WHERE user_id = p_user
  RETURNING * INTO p;
  INSERT INTO public.plan_grants (user_id, plan, status, period_end, source, payment_id)
  VALUES (p_user, target, 'active', ends, 'payment', p_payment_id);
  RETURN public.entitlement_from(p);
END;
$$;

-- 6. Manual grant or revoke: free revokes, a null end is open-ended ---------------------
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
  IF lower(coalesce(p_plan, '')) = 'free' THEN
    target := 'free';
  ELSE
    target := public.paid_plan_of(p_plan);
  END IF;
  IF target IS NULL THEN
    RAISE EXCEPTION 'Unknown plan' USING ERRCODE = '22023';
  END IF;
  IF target <> 'free' AND p_period_end IS NOT NULL AND p_period_end <= now() THEN
    RAISE EXCEPTION 'The end date must be in the future' USING ERRCODE = '22023';
  END IF;

  UPDATE public.user_profiles
  SET plan = target,
      plan_status = CASE WHEN target = 'free' THEN 'free' ELSE 'active' END,
      plan_source = 'manual',
      plan_period_end = CASE WHEN target = 'free' THEN NULL ELSE p_period_end END
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

-- 7. Signup always starts free ---------------------------------------------------------
-- raw_user_meta_data.plan is ignored: there is no trial to pick. Role and
-- status are fixed here, whatever the metadata says.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.user_profiles (
    user_id,
    email,
    first_name,
    last_name,
    role,
    plan,
    plan_status,
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
    'free',
    'free',
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
  RETURN new;
END;
$$;

-- 8. Privileges ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION
  public.entitlement_from(public.user_profiles),
  public.paid_plan_of(text),
  public.my_entitlement(),
  public.start_trial(text),
  public.grant_paid_plan(uuid, text, text, text),
  public.grant_manual_plan(uuid, text, timestamptz, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_entitlement() TO authenticated;
GRANT EXECUTE ON FUNCTION
  public.entitlement_from(public.user_profiles),
  public.paid_plan_of(text),
  public.my_entitlement(),
  public.grant_paid_plan(uuid, text, text, text),
  public.grant_manual_plan(uuid, text, timestamptz, uuid)
TO service_role;
