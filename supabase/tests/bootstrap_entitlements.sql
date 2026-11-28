ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS plan_status text NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS plan_period_end timestamptz,
  ADD COLUMN IF NOT EXISTS plan_source text,
  ADD COLUMN IF NOT EXISTS trial_started_at timestamptz;

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
