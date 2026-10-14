-- The admin sets a model's plan (migration 20261014234500; open-work F155;
-- docs/specs/2026-10-14-ai-credits.md §6.1).
-- PostgreSQL assertions, no pgTAP. Run only in a disposable database, through
-- run.sh, which applies the migration as a non-superuser (nter_migrator).
-- Bootstrap: the credit_estimates_and_effort chain (ending with
-- 20261014230000_credit_estimates_and_effort.sql, which adds ai_models.min_plan
-- and seeds it), then 20261014234500_admin_model_plan.sql as a non-superuser.
-- The vacuity check drops the last: admin_models_upsert then ignores min_plan,
-- so the first "admin sets" assertion fails.
--
-- admin-models calls admin_models_upsert with the service role after checking
-- is_platform_admin(); here the admin is therefore the service_role. A signed-in
-- user who is not an admin reaches PostgREST as authenticated, and a visitor as
-- anon: neither may execute the function at all.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL TimeZone = 'UTC';

CREATE FUNCTION pg_temp.assert_true(actual boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL: %', label;
  END IF;
  RAISE NOTICE 'PASS: %', label;
END;
$$;

CREATE FUNCTION pg_temp.rejected(statement text, expected_state text, label text, expected_message text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> expected_state THEN
      RAISE EXCEPTION 'FAIL: % (expected %, got %: %)', label, expected_state, SQLSTATE, SQLERRM;
    END IF;
    IF expected_message IS NOT NULL AND SQLERRM <> expected_message THEN
      RAISE EXCEPTION 'FAIL: % (expected message "%", got "%")', label, expected_message, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS: %', label;
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL: % (statement was accepted)', label;
END;
$$;

CREATE FUNCTION pg_temp.min_plan(p_model text) RETURNS text LANGUAGE sql AS $$
  SELECT min_plan::text FROM public.ai_models WHERE model_id = p_model;
$$;

CREATE TEMP TABLE res (k text PRIMARY KEY, v jsonb);
GRANT ALL ON res TO anon, authenticated, service_role;

-- 0. The migration changed no model's plan -----------------------------------------------------
-- The lists credit_estimates_and_effort.sql proves for 20261014230000, unchanged.
SELECT pg_temp.assert_true(
  (SELECT array_agg(model_id ORDER BY model_id COLLATE "C") FROM public.ai_models WHERE min_plan = 'free')
  = ARRAY['anthropic/claude-haiku-4', 'anthropic/claude-haiku-5.5', 'deepseek/deepseek-v4-flash',
          'google/gemini-2.5-flash-lite', 'google/gemini-3.5-flash-lite', 'google/gemini-3.7-flash',
          '~deepseek/deepseek-latest', '~openai/gpt-luna-latest']
  AND (SELECT array_agg(model_id ORDER BY model_id COLLATE "C") FROM public.ai_models WHERE min_plan = 'plus')
  = ARRAY['anthropic/claude-opus-5.5', 'anthropic/claude-sonnet-5', 'anthropic/claude-sonnet-5.5',
          'google/gemini-3.1-pro', 'google/gemma-3-27b-it', 'google/gemma-4-31b-it', 'openai/gpt-6-astra',
          'x-ai/grok-unpriced', 'z-ai/glm-tiny']
  AND NOT EXISTS (SELECT FROM public.ai_models WHERE min_plan IN ('pro', 'max')),
  'the migration changes no model''s plan');

-- 1. The function keeps its signature, settings, owner and privileges ---------------------------
SELECT pg_temp.assert_true((SELECT count(*) FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace AND proname = 'admin_models_upsert') = 1,
  'exactly one admin_models_upsert, (text, jsonb)');
SELECT pg_temp.assert_true((SELECT p.prosecdef AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=""']
    AND p.prorettype = 'jsonb'::regtype AND l.lanname = 'plpgsql' AND p.provolatile = 'v'
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
    WHERE p.oid = 'public.admin_models_upsert(text, jsonb)'::regprocedure),
  'SECURITY DEFINER, VOLATILE plpgsql returning jsonb, search_path '''' and no other setting');
SELECT pg_temp.assert_true((SELECT pg_get_userbyid(proowner) = 'postgres'
    FROM pg_proc WHERE oid = 'public.admin_models_upsert(text, jsonb)'::regprocedure),
  'CREATE OR REPLACE keeps the owner (postgres, not the migrating role)');
SELECT pg_temp.assert_true(
  (SELECT array_agg(pg_get_userbyid(a.grantee) || ':' || a.privilege_type ORDER BY pg_get_userbyid(a.grantee))
     FROM pg_proc p, aclexplode(p.proacl) a
     WHERE p.oid = 'public.admin_models_upsert(text, jsonb)'::regprocedure)
  = ARRAY['postgres:EXECUTE', 'service_role:EXECUTE'],
  'ACL is exactly 0008''s: the owner and service_role may execute, nobody else (no PUBLIC)');
SELECT pg_temp.assert_true(has_function_privilege('service_role', 'public.admin_models_upsert(text, jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.admin_models_upsert(text, jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_models_upsert(text, jsonb)', 'EXECUTE'),
  'has_function_privilege: service_role only');

-- 2. The admin (admin-models, as service_role) sets and changes min_plan ------------------------
SET LOCAL ROLE service_role;
INSERT INTO res VALUES ('free', public.admin_models_upsert('model', '{"model_id": "z-ai/glm-tiny", "min_plan": "free"}'));
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.min_plan('z-ai/glm-tiny') = 'free', 'admin sets a paid model to free');
SELECT pg_temp.assert_true((SELECT v ->> 'min_plan' = 'free' AND v ->> 'label' = 'Tiny' FROM res WHERE k = 'free')
  AND (SELECT row(label, tier, enabled, sort_order) FROM public.ai_models WHERE model_id = 'z-ai/glm-tiny')
      = row('Tiny'::text, 1::smallint, true, 70),
  'the saved row is returned with its plan, and the other fields are kept');

SET LOCAL ROLE service_role;
SELECT public.admin_models_upsert('model', '{"model_id": "z-ai/glm-tiny", "min_plan": "pro"}');
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.min_plan('z-ai/glm-tiny') = 'pro', 'admin changes it to pro');
SET LOCAL ROLE service_role;
SELECT public.admin_models_upsert('model', '{"model_id": "z-ai/glm-tiny", "min_plan": "max"}');
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.min_plan('z-ai/glm-tiny') = 'max', 'admin changes it to max');
SET LOCAL ROLE service_role;
SELECT public.admin_models_upsert('model', '{"model_id": "google/gemini-3.7-flash", "min_plan": "plus"}');
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.min_plan('google/gemini-3.7-flash') = 'plus', 'admin moves a free model to paid plans');

-- 3. A row without min_plan leaves the stored plan alone ---------------------------------------
SET LOCAL ROLE service_role;
SELECT public.admin_models_upsert('model', '{"model_id": "z-ai/glm-tiny", "label": "Tiny GLM", "tier": 2, "sort_order": 7}');
SELECT public.admin_models_upsert('model', '{"model_id": "deepseek/deepseek-v4-flash", "enabled": true}');
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.min_plan('z-ai/glm-tiny') = 'max'
  AND (SELECT row(label, tier, sort_order) FROM public.ai_models WHERE model_id = 'z-ai/glm-tiny') = row('Tiny GLM'::text, 2::smallint, 7),
  'an edit without min_plan saves its fields and keeps a stored max');
SELECT pg_temp.assert_true(pg_temp.min_plan('deepseek/deepseek-v4-flash') = 'free',
  'a toggle without min_plan keeps a stored free');

-- 4. A new model defaults to plus; the admin may choose another plan when adding ---------------
SET LOCAL ROLE service_role;
SELECT public.admin_models_upsert('model', '{"model_id": "meta/brand-new", "label": "New", "enabled": false}');
SELECT public.admin_models_upsert('model', '{"model_id": "meta/brand-new-free", "enabled": false, "min_plan": "free"}');
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.min_plan('meta/brand-new') = 'plus', 'a new model without min_plan needs a paid plan (plus)');
SELECT pg_temp.assert_true(pg_temp.min_plan('meta/brand-new-free') = 'free', 'a new model may be added as free');

-- 5. Invalid values are refused with a clear error, and nothing is written ----------------------
SET LOCAL ROLE service_role;
SELECT pg_temp.rejected($$SELECT public.admin_models_upsert('model', '{"model_id": "z-ai/glm-tiny", "min_plan": "gold"}')$$,
  '22023', 'an unknown plan is refused', 'min_plan must be one of free, plus, pro, max');
SELECT pg_temp.rejected($$SELECT public.admin_models_upsert('model', '{"model_id": "z-ai/glm-tiny", "min_plan": null}')$$,
  '22023', 'a null plan is refused, not reset to the default', 'min_plan must be one of free, plus, pro, max');
SELECT pg_temp.rejected($$SELECT public.admin_models_upsert('model', '{"model_id": "z-ai/glm-tiny", "min_plan": 1}')$$,
  '22023', 'a number is refused');
SELECT pg_temp.rejected($$SELECT public.admin_models_upsert('model', '{"model_id": "z-ai/glm-tiny", "min_plan": ["free"]}')$$,
  '22023', 'an array is refused');
SELECT pg_temp.rejected($$SELECT public.admin_models_upsert('model', '{"model_id": "z-ai/glm-tiny", "min_plan": "FREE"}')$$,
  '22023', 'plan names are exact (no case folding)');
SELECT pg_temp.rejected($$SELECT public.admin_models_upsert('model', '{"model_id": "z-ai/glm-tiny", "min_plan": ""}')$$,
  '22023', 'an empty plan is refused');
SELECT pg_temp.rejected($$SELECT public.admin_models_upsert('model', '{"model_id": "meta/never-added", "min_plan": "gold"}')$$,
  '22023', 'a new model with an unknown plan is refused');
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.min_plan('z-ai/glm-tiny') = 'max'
  AND NOT EXISTS (SELECT FROM public.ai_models WHERE model_id = 'meta/never-added'),
  'a refused write changes nothing and adds nothing');

-- 6. Roles are unchanged: min_plan is not a role field -----------------------------------------
SET LOCAL ROLE service_role;
SELECT public.admin_models_upsert('role', '{"role_id": "EXPERT_ESCALATION", "hint": "Harder questions", "min_plan": "gold"}');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT row(hint, model_id) FROM public.ai_roles WHERE role_id = 'EXPERT_ESCALATION')
  = row('Harder questions'::text, 'google/gemma-3-27b-it'::text)
  AND pg_temp.min_plan('google/gemma-3-27b-it') = 'plus',
  'a role write ignores min_plan and touches no model''s plan');

-- 7. A signed-in non-admin and a visitor cannot execute it -------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000f155', true);
SELECT pg_temp.rejected($$SELECT public.admin_models_upsert('model', '{"model_id": "z-ai/glm-tiny", "min_plan": "free"}')$$,
  '42501', 'authenticated (a signed-in non-admin) cannot set a plan');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.rejected($$SELECT public.admin_models_upsert('model', '{"model_id": "z-ai/glm-tiny", "min_plan": "free"}')$$,
  '42501', 'anon cannot set a plan');
SELECT pg_temp.rejected($$SELECT public.admin_models_upsert('model', '{"model_id": "meta/anon-model"}')$$,
  '42501', 'anon cannot add a model');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.rejected($$UPDATE public.ai_models SET min_plan = 'free' WHERE model_id = 'z-ai/glm-tiny'$$,
  '42501', 'authenticated cannot write ai_models directly either');
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.min_plan('z-ai/glm-tiny') = 'max'
  AND NOT EXISTS (SELECT FROM public.ai_models WHERE model_id = 'meta/anon-model'),
  'the refused callers changed nothing');

ROLLBACK;
