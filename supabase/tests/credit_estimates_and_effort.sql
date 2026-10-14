-- Model plans, credit estimates and the effort column (migration 20261014230000;
-- open-work F111, F150, F151, P3; docs/specs/2026-10-14-ai-credits.md §6.1, §12).
-- PostgreSQL assertions, no pgTAP. Run only in a disposable database, through
-- run.sh, which applies the migration as a non-superuser (nter_migrator).
-- Bootstrap: the ai_credits chain (ending with 20261014200000_ai_credits.sql),
-- bootstrap_credit_estimates_seed.sql (models and prices the migration must
-- process), then 20261014230000_credit_estimates_and_effort.sql as a
-- non-superuser. The vacuity check drops the last: ai_models.min_plan is then
-- missing, so the first assertion fails.
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

CREATE FUNCTION pg_temp.rejected(statement text, expected_state text, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> expected_state THEN
      RAISE EXCEPTION 'FAIL: % (expected %, got %: %)', label, expected_state, SQLSTATE, SQLERRM;
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

-- 1. ai_models.min_plan (F150) ---------------------------------------------------------------
SELECT pg_temp.assert_true((SELECT attnotnull AND format_type(atttypid, atttypmod) = 'app_plan'
    FROM pg_attribute WHERE attrelid = 'public.ai_models'::regclass AND attname = 'min_plan'),
  'ai_models.min_plan is a NOT NULL app_plan');
SELECT pg_temp.assert_true((SELECT pg_get_expr(adbin, adrelid) FROM pg_attrdef d JOIN pg_attribute a
    ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.ai_models'::regclass AND a.attname = 'min_plan') = '''plus''::app_plan',
  'min_plan defaults to plus, so a new model needs a paid plan');
SELECT pg_temp.assert_true(
  (SELECT array_agg(model_id ORDER BY model_id COLLATE "C") FROM public.ai_models WHERE min_plan = 'free')
  = ARRAY['anthropic/claude-haiku-4', 'anthropic/claude-haiku-5.5', 'deepseek/deepseek-v4-flash',
          'google/gemini-2.5-flash-lite', 'google/gemini-3.5-flash-lite', 'google/gemini-3.7-flash',
          '~deepseek/deepseek-latest', '~openai/gpt-luna-latest'],
  'free: Gemini Flash and Flash-Lite, DeepSeek (with and without ~), Luna and Haiku, enabled or not');
SELECT pg_temp.assert_true(
  (SELECT array_agg(model_id ORDER BY model_id COLLATE "C") FROM public.ai_models WHERE min_plan = 'plus')
  = ARRAY['anthropic/claude-opus-5.5', 'anthropic/claude-sonnet-5', 'anthropic/claude-sonnet-5.5',
          'google/gemini-3.1-pro', 'google/gemma-3-27b-it', 'google/gemma-4-31b-it', 'openai/gpt-6-astra',
          'x-ai/grok-unpriced', 'z-ai/glm-tiny'],
  'plus: everything else (Gemini Pro, Gemma, Sonnet, Opus, Astra and unknown vendors)');
SELECT pg_temp.rejected($$UPDATE public.ai_models SET min_plan = 'gold' WHERE model_id = 'z-ai/glm-tiny'$$,
  '22P02', 'min_plan accepts only app_plan values');
SELECT pg_temp.rejected($$UPDATE public.ai_models SET min_plan = NULL WHERE model_id = 'z-ai/glm-tiny'$$,
  '23502', 'min_plan cannot be null');
SAVEPOINT plans;
UPDATE public.ai_models SET min_plan = 'pro' WHERE model_id = 'z-ai/glm-tiny';
UPDATE public.ai_models SET min_plan = 'max' WHERE model_id = 'x-ai/grok-unpriced';
SELECT pg_temp.assert_true(pg_temp.min_plan('z-ai/glm-tiny') = 'pro' AND pg_temp.min_plan('x-ai/grok-unpriced') = 'max',
  'every paid plan is a valid min_plan');
ROLLBACK TO SAVEPOINT plans;

INSERT INTO public.ai_models (model_id, label, enabled) VALUES ('meta/new-model', 'New', false);
SELECT pg_temp.assert_true(pg_temp.min_plan('meta/new-model') = 'plus', 'a model added later defaults to plus');
SELECT public.admin_models_upsert('model', '{"model_id": "z-ai/glm-tiny", "label": "Renamed"}');
SELECT pg_temp.assert_true(pg_temp.min_plan('z-ai/glm-tiny') = 'plus'
  AND (SELECT label FROM public.ai_models WHERE model_id = 'z-ai/glm-tiny') = 'Renamed',
  'an admin edit through admin_models_upsert keeps min_plan');

SET LOCAL ROLE authenticated;
CREATE TEMP TABLE seen_plans AS SELECT model_id, min_plan::text AS min_plan FROM public.ai_models;
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*) FROM seen_plans WHERE min_plan IS NOT NULL) > 0,
  'authenticated reads min_plan wherever it reads ai_models');

-- 2. The three Claude models -------------------------------------------------------------------
SELECT pg_temp.assert_true((SELECT row(label, vendor, tier, min_plan::text, enabled, is_default, efforts, sort_order)
    FROM public.ai_models WHERE model_id = 'anthropic/claude-haiku-5.5')
  = row('Claude - Haiku 5.5'::text, 'anthropic'::text, 1::smallint, 'free'::text, true, false, ARRAY['off','low','medium','high'], 43),
  'Haiku 5.5: tier 1, free, efforts from its catalogue plus off, after the last Claude row');
SELECT pg_temp.assert_true((SELECT row(label, vendor, tier, min_plan::text, enabled, is_default, efforts, sort_order)
    FROM public.ai_models WHERE model_id = 'anthropic/claude-sonnet-5.5')
  = row('Claude - Sonnet 5.5'::text, 'anthropic'::text, 3::smallint, 'plus'::text, true, false, ARRAY['low','medium','high','xhigh','max'], 44),
  'Sonnet 5.5: tier 3, plus, no off where reasoning is mandatory');
SELECT pg_temp.assert_true((SELECT row(label, tier, min_plan::text, efforts, sort_order)
    FROM public.ai_models WHERE model_id = 'anthropic/claude-opus-5.5')
  = row('Opus (admin)'::text, 2::smallint, 'plus'::text, ARRAY['high'], 42),
  'Opus 5.5 already existed: ON CONFLICT DO NOTHING keeps the admin''s row, and it needs a paid plan');

-- 3. Gemma is disabled, unless a role points at it -------------------------------------------
SELECT pg_temp.assert_true((SELECT NOT enabled AND NOT is_default FROM public.ai_models WHERE model_id = 'google/gemma-4-31b-it'),
  'Gemma is disabled, not deleted');
SELECT pg_temp.assert_true((SELECT enabled FROM public.ai_models WHERE model_id = 'google/gemma-3-27b-it')
  AND (SELECT model_id FROM public.ai_roles WHERE role_id = 'EXPERT_ESCALATION') = 'google/gemma-3-27b-it',
  'a Gemma model a role points at stays enabled, so the role is not broken');

-- 4. model_call_logs.reasoning_effort (P3) ----------------------------------------------------
INSERT INTO public.model_call_logs (caller, purpose, status, reasoning_effort)
SELECT 'research-chat', 'chat_answer', 'success', e
FROM unnest(ARRAY['off','minimal','low','medium','high','xhigh','max', NULL]) e;
SELECT pg_temp.assert_true((SELECT count(*) FROM public.model_call_logs WHERE caller = 'research-chat') = 8,
  'reasoning_effort takes every effort in validate.ts, and null');
SELECT pg_temp.rejected($$INSERT INTO public.model_call_logs (caller, purpose, status, reasoning_effort)
  VALUES ('research-chat', 'chat_answer', 'success', 'turbo')$$, '23514', 'reasoning_effort refuses anything else');

-- 5. model_credit_estimates() (F151) ----------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-4000-8000-00000000e001', 'estimates@example.invalid');

-- One charged answer: a ledger charge, its chat_answer row (and an embedding row), both charged.
-- p_failover adds a later chat_answer row on another model, as a failover does.
CREATE FUNCTION pg_temp.charge(p_turn text, p_model text, p_credits numeric, p_at timestamptz,
                               p_failover text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE entry uuid; row_id uuid;
BEGIN
  INSERT INTO public.credit_ledger (user_id, kind, credits, turn_key, usd_to_inr, inr_per_credit, created_at)
  VALUES ('00000000-0000-4000-8000-00000000e001', 'charge', -p_credits, p_turn, 95, 0.1, p_at)
  RETURNING id INTO entry;
  INSERT INTO public.model_call_logs (user_id, caller, purpose, model_requested, status, cost_usd, created_at)
  VALUES ('00000000-0000-4000-8000-00000000e001', 'research-chat', 'chat_answer', p_model, 'success', p_credits / 950,
          p_at - interval '1 minute')
  RETURNING id INTO row_id;
  INSERT INTO public.credit_charge_rows VALUES (row_id, entry, p_credits / 950);
  INSERT INTO public.model_call_logs (user_id, caller, purpose, model_requested, status, cost_usd, created_at)
  VALUES ('00000000-0000-4000-8000-00000000e001', 'research-chat', 'embedding', 'openai/text-embedding-3-small',
          'success', 0, p_at - interval '2 minutes')
  RETURNING id INTO row_id;
  INSERT INTO public.credit_charge_rows VALUES (row_id, entry, 0);
  IF p_failover IS NOT NULL THEN
    INSERT INTO public.model_call_logs (user_id, caller, purpose, model_requested, status, cost_usd, created_at)
    VALUES ('00000000-0000-4000-8000-00000000e001', 'research-chat', 'chat_answer', p_failover, 'success', 0,
            p_at - interval '30 seconds')
    RETURNING id INTO row_id;
    INSERT INTO public.credit_charge_rows VALUES (row_id, entry, 0);
  END IF;
END;
$$;

-- Gemini 3.7 Flash: eleven answers of 10, 12, ... 30 credits (median 20). g1 failed over to
-- Flash-Lite and still counts for 3.7 Flash; g11 was charged in two entries (settle, then sweep).
SELECT pg_temp.charge('g' || i, 'google/gemini-3.7-flash', 8 + 2 * i, now() - make_interval(days => i),
                      CASE WHEN i = 1 THEN 'google/gemini-3.5-flash-lite' END)
FROM generate_series(1, 10) i;
SELECT pg_temp.charge('g11', 'google/gemini-3.7-flash', 25, now() - interval '11 days');
SELECT pg_temp.charge('g11', 'google/gemini-3.7-flash', 5, now() - interval '10 days');
-- Flash-Lite: one answer of its own (it is only a failover in g1).
SELECT pg_temp.charge('f1', 'google/gemini-3.5-flash-lite', 50, now() - interval '1 day', 'google/gemini-3.7-flash');
-- DeepSeek: nine answers, one short of measured.
SELECT pg_temp.charge('d' || i, 'deepseek/deepseek-v4-flash', 5, now() - make_interval(days => i))
FROM generate_series(1, 9) i;
-- Sonnet 5: ten answers, one of them older than 30 days.
SELECT pg_temp.charge('s' || i, 'anthropic/claude-sonnet-5', 170,
                      CASE WHEN i = 10 THEN now() - interval '31 days' ELSE now() - make_interval(days => i) END)
FROM generate_series(1, 10) i;

CREATE TEMP TABLE res (k text PRIMARY KEY, v jsonb);
GRANT ALL ON res TO anon, authenticated, service_role;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000e001', true);
INSERT INTO res VALUES ('est', public.model_credit_estimates());
RESET ROLE;
CREATE TEMP TABLE est AS
SELECT e ->> 'model_id' AS model_id, (e ->> 'credits')::numeric AS credits, e ->> 'basis' AS basis, e AS raw
FROM res, jsonb_array_elements(v) e WHERE k = 'est';

SELECT pg_temp.assert_true((SELECT credits = 20 AND basis = 'measured' FROM est WHERE model_id = 'google/gemini-3.7-flash'),
  'measured: the median credits per answer over 30 days, with failovers and split charges counted once');
SELECT pg_temp.assert_true((SELECT credits = 11 AND basis = 'list_price' FROM est WHERE model_id = 'deepseek/deepseek-v4-flash'),
  'nine charged answers are not enough: list price, round((30k x prompt + 2k x completion) x 95 / 0.10)');
SELECT pg_temp.assert_true((SELECT credits = 114 AND basis = 'list_price' FROM est WHERE model_id = 'anthropic/claude-sonnet-5'),
  'an answer older than 30 days does not count towards the ten');
SELECT pg_temp.assert_true((SELECT credits = 4 AND basis = 'list_price' FROM est WHERE model_id = 'google/gemini-3.5-flash-lite'),
  'a failover model is not credited with the answers it rescued');
SELECT pg_temp.assert_true((SELECT credits = 55 AND basis = 'list_price' FROM est WHERE model_id = 'google/gemini-3.1-pro')
  AND (SELECT credits = 38 AND basis = 'list_price' FROM est WHERE model_id = 'anthropic/claude-haiku-5.5'),
  'list price for a model with no charges, rounded to whole credits');
SELECT pg_temp.assert_true((SELECT credits = 1 AND basis = 'list_price' FROM est WHERE model_id = 'z-ai/glm-tiny'),
  'an estimate is at least 1 credit');
SELECT pg_temp.assert_true((SELECT credits IS NULL AND basis = 'none' FROM est WHERE model_id = 'x-ai/grok-unpriced'),
  'a model without prices has no estimate rather than a made-up one');
SELECT pg_temp.assert_true(
  (SELECT array_agg(model_id ORDER BY model_id) FROM est)
  = (SELECT array_agg(model_id ORDER BY model_id) FROM public.ai_models WHERE enabled)
  AND NOT EXISTS (SELECT FROM est WHERE model_id IN ('google/gemma-4-31b-it', 'google/gemini-2.5-flash-lite', 'meta/new-model')),
  'one entry per enabled model; disabled models are omitted');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM est
    WHERE (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(raw) k) <> ARRAY['basis', 'credits', 'model_id']),
  'each entry is exactly {model_id, credits, basis}');
SELECT pg_temp.assert_true((SELECT v::text FROM res WHERE k = 'est') !~* '(usd|inr|rate|cost)',
  'no dollars, rupees or exchange rate');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM est WHERE credits <> round(credits)), 'whole credits only');

SELECT pg_temp.assert_true((SELECT prosecdef AND provolatile = 's'
    AND proconfig @> ARRAY['search_path=""', 'TimeZone=UTC']
    FROM pg_proc WHERE oid = 'public.model_credit_estimates()'::regprocedure),
  'SECURITY DEFINER, STABLE, search_path '''' and TimeZone UTC');
SELECT pg_temp.assert_true(has_function_privilege('authenticated', 'public.model_credit_estimates()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.model_credit_estimates()', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.model_credit_estimates()', 'EXECUTE')
  AND NOT EXISTS (SELECT FROM pg_proc p, aclexplode(p.proacl) a
                  WHERE p.oid = 'public.model_credit_estimates()'::regprocedure AND a.grantee = 0),
  'executable by authenticated only: not PUBLIC, anon or service_role');
SET LOCAL ROLE anon;
SELECT pg_temp.rejected('SELECT public.model_credit_estimates()', '42501', 'anon cannot execute model_credit_estimates');
RESET ROLE;

ROLLBACK;
