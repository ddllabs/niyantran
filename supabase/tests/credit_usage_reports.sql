-- Credits usage reports (migration 20261014233000; open-work F153;
-- docs/specs/2026-10-14-credits-usage-page.md, Data). PostgreSQL assertions, no
-- pgTAP. Run only in a disposable database, through run.sh, which applies the
-- migrations as a non-superuser (nter_migrator).
-- Bootstrap: the credit_estimates_and_effort chain (ending with
-- 20261014230000_credit_estimates_and_effort.sql, which adds
-- model_call_logs.reasoning_effort), then 20261014233000_credit_usage_reports.sql
-- as a non-superuser. The vacuity check drops the last: my_usage_summary is then
-- missing, so the first assertion fails.
--
-- Users (00000000-0000-4000-8000-00000000d0xx): 01 the reader, 02 another user
-- whose rows must never reach 01, 03 the my_credits().recent bound.
-- Times are fixed around T = 2026-09-10 20:00 UTC, which is 2026-09-11 01:30 IST,
-- so a day bucketed in UTC instead of IST lands on the wrong date.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL TimeZone = 'UTC';

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;

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

-- 1. The functions, their settings and privileges -------------------------------------------
SELECT pg_temp.assert_true((SELECT count(*) = 3 FROM pg_proc p
    WHERE p.oid IN ('public.my_usage_summary(timestamptz, timestamptz)'::regprocedure,
                    'public.my_usage_timeseries(timestamptz, timestamptz, text)'::regprocedure,
                    'public.my_usage_activity(integer, integer, boolean, text, text, text)'::regprocedure)
      AND p.prosecdef AND p.provolatile = 's' AND p.proconfig @> ARRAY['search_path=""', 'TimeZone=UTC']),
  'the three reports exist: SECURITY DEFINER, STABLE, search_path '''' and TimeZone UTC');
SELECT pg_temp.assert_true(EXISTS (SELECT FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'research_turns'
    AND indexdef LIKE '%(user_id, created_at DESC)%'), 'research_turns is indexed on (user_id, created_at DESC)');

-- Every function the credits migrations add (owned by nter_migrator in public and private).
CREATE TEMP TABLE added_fn AS
  SELECT p.oid, n.nspname, p.proname::text AS proname, p.prosecdef, p.proconfig, p.proacl
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'private') AND pg_get_userbyid(p.proowner) = 'nter_migrator';
SELECT pg_temp.assert_true((SELECT array_agg(proname ORDER BY proname) FROM added_fn WHERE nspname = 'public')
  = ARRAY['admin_adjust_credits', 'credits_on_plan_grant', 'model_credit_estimates', 'my_conversation_credits',
          'my_credits', 'my_usage_activity', 'my_usage_summary', 'my_usage_timeseries', 'reserve_turn_credits',
          'settle_turn_credits'], 'public gains exactly the three reports, no helper');
SELECT pg_temp.assert_true((SELECT count(*) = 4 FROM added_fn WHERE nspname = 'private' AND proname LIKE 'credit_usage_%'),
  'the report helpers live in private');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM added_fn WHERE NOT prosecdef
    OR NOT (proconfig @> ARRAY['search_path=""', 'TimeZone=UTC'])),
  'every added function is SECURITY DEFINER with search_path '''' and TimeZone UTC');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM added_fn WHERE proacl IS NULL
    OR EXISTS (SELECT FROM aclexplode(proacl) a WHERE a.grantee = 0)), 'no added function is executable by PUBLIC');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM added_fn f WHERE
       has_function_privilege('anon', f.oid, 'EXECUTE')
    OR has_function_privilege('authenticated', f.oid, 'EXECUTE')
       <> (f.nspname = 'public' AND f.proname IN ('my_credits', 'my_conversation_credits', 'model_credit_estimates',
                                                   'my_usage_summary', 'my_usage_timeseries', 'my_usage_activity'))
    OR has_function_privilege('service_role', f.oid, 'EXECUTE')
       <> (f.nspname = 'public' AND f.proname IN ('reserve_turn_credits', 'settle_turn_credits', 'admin_adjust_credits',
                                                   'credits_on_plan_grant'))),
  'has_function_privilege: anon none, authenticated the my_* reports and estimates, service_role the writers, private nobody');
SET LOCAL ROLE anon;
SELECT pg_temp.rejected($q$SELECT public.my_usage_summary(now() - interval '1 day', now())$q$, '42501', 'anon cannot execute my_usage_summary');
SELECT pg_temp.rejected($q$SELECT public.my_usage_timeseries(now() - interval '1 day', now(), 'day')$q$, '42501', 'anon cannot execute my_usage_timeseries');
SELECT pg_temp.rejected($q$SELECT public.my_usage_activity(0, 50, true, NULL, NULL, NULL)$q$, '42501', 'anon cannot execute my_usage_activity');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT pg_temp.rejected($q$SELECT public.my_usage_summary(NULL, NULL)$q$, '42501', 'the summary needs a signed-in user');
SELECT pg_temp.rejected($q$SELECT public.my_usage_timeseries(NULL, NULL, 'day')$q$, '42501', 'the series needs a signed-in user');
SELECT pg_temp.rejected($q$SELECT public.my_usage_activity(0, 50, true, NULL, NULL, NULL)$q$, '42501', 'the activity needs a signed-in user');
RESET ROLE;

-- 2. Seed ------------------------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-4000-8000-00000000d001', 'reader@example.invalid'),
  ('00000000-0000-4000-8000-00000000d002', 'other@example.invalid'),
  ('00000000-0000-4000-8000-00000000d003', 'recent@example.invalid');

CREATE TEMP TABLE ids (k text PRIMARY KEY, id uuid);
GRANT SELECT ON ids TO authenticated;
CREATE FUNCTION pg_temp.id(p_key text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM ids WHERE k = p_key $$;

-- A claimed turn: its conversation, question and answer. Returns the assistant message id.
CREATE FUNCTION pg_temp.turn(p_user uuid, p_key text, p_title text, p_question text, p_status text, p_content text,
                             p_at timestamptz) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE conv uuid := gen_random_uuid(); um uuid; am uuid;
BEGIN
  INSERT INTO public.conversations (id, user_id, title) VALUES (conv, p_user, p_title);
  INSERT INTO public.chat_messages (conversation_id, user_id, role, content, turn_key, created_at)
    VALUES (conv, p_user, 'user', p_question, p_key, p_at) RETURNING id INTO um;
  INSERT INTO public.chat_messages (conversation_id, user_id, role, content, status, created_at)
    VALUES (conv, p_user, 'assistant', p_content, p_status, p_at + interval '1 second') RETURNING id INTO am;
  INSERT INTO public.research_turns (user_id, turn_key, request_hash, conversation_id, user_message_id, assistant_message_id,
                                     execution_token, created_at)
    VALUES (p_user, p_key, encode(sha256(convert_to(p_user::text || p_key, 'UTF8')), 'hex'), conv, um, am, gen_random_uuid(), p_at);
  INSERT INTO ids VALUES ('conv:' || p_key, conv), ('msg:' || p_key, am);
  RETURN am;
END;
$$;

CREATE FUNCTION pg_temp.call(p_key text, p_user uuid, p_message uuid, p_caller text, p_purpose text, p_model text,
                             p_status text, p_cost numeric, p_tokens integer, p_at timestamptz,
                             p_searches integer DEFAULT 0, p_search_cost numeric DEFAULT NULL, p_effort text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid;
BEGIN
  INSERT INTO public.model_call_logs (user_id, conversation_id, message_id, caller, purpose, model_requested, status, cost_usd,
                                      total_tokens, created_at, web_search_count, web_search_cost_usd, reasoning_effort)
  VALUES (p_user, (SELECT conversation_id FROM public.chat_messages WHERE id = p_message), p_message, p_caller, p_purpose,
          p_model, p_status, p_cost, p_tokens, p_at, p_searches, p_search_cost, p_effort)
  RETURNING id INTO v;
  INSERT INTO ids VALUES (p_key, v);
  RETURN v;
END;
$$;

-- One charge entry over the given rows, at 950 credits per dollar of their cost.
CREATE FUNCTION pg_temp.charge(p_user uuid, p_turn text, p_rows text[], p_at timestamptz) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE entry uuid; total numeric;
BEGIN
  SELECT sum(l.cost_usd) INTO total FROM public.model_call_logs l JOIN ids ON ids.id = l.id WHERE ids.k = ANY (p_rows);
  INSERT INTO public.credit_ledger (user_id, kind, credits, turn_key, usd_to_inr, inr_per_credit, created_at)
  VALUES (p_user, 'charge', -round(total * 950, 4), p_turn, 95, 0.1, p_at)
  RETURNING id INTO entry;
  INSERT INTO public.credit_charge_rows (model_call_log_id, ledger_id, cost_usd)
  SELECT l.id, entry, l.cost_usd FROM public.model_call_logs l JOIN ids ON ids.id = l.id WHERE ids.k = ANY (p_rows);
  RETURN entry;
END;
$$;

-- The reader (01). Turn a1 at T - 1 minute: a searching call, the query embedding, the answer
-- (linked by its answer trace), an uncharged citation repair, and a cut-off failover call that a
-- later sweep charges a day after.
SELECT pg_temp.turn('00000000-0000-4000-8000-00000000d001', 'a1', 'Rate cut', 'What did the RBI do?', 'complete',
                    'It cut rates.', '2026-09-10 19:59:00+00');
SELECT pg_temp.call('L1', '00000000-0000-4000-8000-00000000d001', pg_temp.id('msg:a1'), 'research-chat', 'chat_answer',
                    'google/gemini-3.7-flash', 'success', 0.02, 1000, '2026-09-10 19:59:10+00', 2, 0.01, 'low');
SELECT pg_temp.call('L2', '00000000-0000-4000-8000-00000000d001', pg_temp.id('msg:a1'), 'research-chat', 'embedding',
                    'openai/text-embedding-3-small', 'success', 0, 10, '2026-09-10 19:59:05+00');
SELECT pg_temp.call('L3', '00000000-0000-4000-8000-00000000d001', pg_temp.id('msg:a1'), 'research-chat', 'chat_answer',
                    'google/gemini-3.7-flash', 'success', 0.03, 2000, '2026-09-10 19:59:20+00', 0, NULL, 'low');
SELECT pg_temp.call('L4', '00000000-0000-4000-8000-00000000d001', pg_temp.id('msg:a1'), 'research-chat', 'citation_repair',
                    'google/gemini-3.5-flash-lite', 'success', 0.001, 300, '2026-09-10 19:59:30+00');
SELECT pg_temp.call('L5', '00000000-0000-4000-8000-00000000d001', pg_temp.id('msg:a1'), 'research-chat', 'chat_answer',
                    'anthropic/claude-sonnet-5', 'aborted', 0.01, 500, '2026-09-10 19:59:40+00', 0, NULL, 'high');
INSERT INTO public.chat_turn_traces (user_id, message_id, step_index, step_type, model_call_log_id)
VALUES ('00000000-0000-4000-8000-00000000d001', pg_temp.id('msg:a1'), 3, 'answer', pg_temp.id('L3'));
SELECT pg_temp.charge('00000000-0000-4000-8000-00000000d001', 'a1', ARRAY['L1', 'L2', 'L3'], '2026-09-10 20:00:00+00');
SELECT pg_temp.charge('00000000-0000-4000-8000-00000000d001', 'a1', ARRAY['L5'], '2026-09-11 20:00:00+00');
-- b1 at T + 2 h: failed with nothing to show, free.
SELECT pg_temp.turn('00000000-0000-4000-8000-00000000d001', 'b1', 'Failed one', 'Will this fail?', 'error', '',
                    '2026-09-10 22:00:00+00');
SELECT pg_temp.call('L6', '00000000-0000-4000-8000-00000000d001', pg_temp.id('msg:b1'), 'research-chat', 'chat_answer',
                    'google/gemini-3.7-flash', 'error', NULL, NULL, '2026-09-10 22:00:10+00');
-- c1 at T + 3 h: charged, then its conversation is deleted.
SELECT pg_temp.turn('00000000-0000-4000-8000-00000000d001', 'c1', 'To be deleted', 'A private question', 'complete',
                    'An answer.', '2026-09-10 23:00:00+00');
SELECT pg_temp.call('L7', '00000000-0000-4000-8000-00000000d001', pg_temp.id('msg:c1'), 'research-chat', 'chat_answer',
                    'deepseek/deepseek-v4-flash', 'success', 0.01, 800, '2026-09-10 23:00:10+00');
SELECT pg_temp.charge('00000000-0000-4000-8000-00000000d001', 'c1', ARRAY['L7'], '2026-09-10 23:00:20+00');
DELETE FROM public.conversations WHERE id = pg_temp.id('conv:c1');
-- Dictation at T + 4 h (succeeded) and T + 5 h (failed); never charged.
SELECT pg_temp.call('L8', '00000000-0000-4000-8000-00000000d001', NULL, 'transcribe-audio', 'transcription',
                    'openai/whisper-large-v3-turbo', 'success', 0.0002, 50, '2026-09-11 00:00:00+00');
SELECT pg_temp.call('L9', '00000000-0000-4000-8000-00000000d001', NULL, 'transcribe-audio', 'transcription',
                    'openai/whisper-large-v3-turbo', 'error', NULL, NULL, '2026-09-11 01:00:00+00');
-- Another caller's row for the same user is not part of the page.
SELECT pg_temp.call('L10', '00000000-0000-4000-8000-00000000d001', NULL, 'desk-brief', 'desk_brief',
                    'google/gemini-3.7-flash', 'success', 0.5, 9999, '2026-09-10 21:00:00+00');

-- Another user (02), inside the same window.
SELECT pg_temp.turn('00000000-0000-4000-8000-00000000d002', 'x1', 'Other user chat', 'Someone else''s question', 'complete',
                    'Theirs.', '2026-09-10 21:00:00+00');
SELECT pg_temp.call('X1', '00000000-0000-4000-8000-00000000d002', pg_temp.id('msg:x1'), 'research-chat', 'chat_answer',
                    'x-ai/grok-other', 'success', 0.02, 4000, '2026-09-10 21:00:10+00', 3, 0.03);
SELECT pg_temp.charge('00000000-0000-4000-8000-00000000d002', 'x1', ARRAY['X1'], '2026-09-10 21:00:20+00');
SELECT pg_temp.call('X2', '00000000-0000-4000-8000-00000000d002', NULL, 'transcribe-audio', 'transcription',
                    'openai/whisper-other', 'success', 0.0002, 70, '2026-09-10 21:30:00+00');

-- 3. Read everything as the users -------------------------------------------------------------------
CREATE TEMP TABLE res (k text PRIMARY KEY, v jsonb);
GRANT ALL ON res TO authenticated;
CREATE FUNCTION pg_temp.r(p_key text) RETURNS jsonb LANGUAGE sql AS $$ SELECT v FROM res WHERE k = p_key $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000d001', true);
INSERT INTO res VALUES
  ('sum', public.my_usage_summary('2026-09-09 20:00:00+00', '2026-09-12 20:00:00+00')),
  ('sum.cycle', public.my_usage_summary('2026-09-09 20:00:00+00', '2026-09-11 08:00:00+00')),
  ('sum.backwards', public.my_usage_summary('2026-09-12 20:00:00+00', '2026-09-09 20:00:00+00')),
  ('ts.day', public.my_usage_timeseries('2026-09-09 20:00:00+00', '2026-09-12 20:00:00+00', 'day')),
  ('ts.week', public.my_usage_timeseries('2026-09-09 20:00:00+00', '2026-09-12 20:00:00+00', 'week')),
  ('ts.month', public.my_usage_timeseries(NULL, '2026-09-12 20:00:00+00', 'month')),
  ('ts.long', public.my_usage_timeseries('2020-01-01 00:00:00+00', '2026-09-12 20:00:00+00', 'day')),
  ('act', public.my_usage_activity(0, 50, true, NULL, NULL, NULL)),
  ('act.page', public.my_usage_activity(1, 2, true, NULL, NULL, NULL)),
  ('act.failed', public.my_usage_activity(0, 50, true, NULL, 'failed', NULL)),
  ('act.ok', public.my_usage_activity(0, 50, true, NULL, 'succeeded', NULL)),
  ('act.bogus', public.my_usage_activity(-5, 50, NULL, NULL, 'bogus', 'bogus')),
  ('act.dictation', public.my_usage_activity(0, 50, true, NULL, NULL, 'dictation')),
  ('act.answers', public.my_usage_activity(0, 50, true, NULL, NULL, 'answers')),
  ('act.sonnet', public.my_usage_activity(0, 50, true, 'anthropic/claude-sonnet-5', NULL, NULL)),
  ('act.one', public.my_usage_activity(0, 0, true, NULL, NULL, NULL)),
  ('act.flat', public.my_usage_activity(0, 500, false, NULL, NULL, NULL)),
  ('act.flat.flash', public.my_usage_activity(0, 50, false, 'google/gemini-3.7-flash', NULL, 'answers'));
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000d002', true);
INSERT INTO res VALUES
  ('other.sum', public.my_usage_summary('2026-09-09 20:00:00+00', '2026-09-12 20:00:00+00')),
  ('other.act', public.my_usage_activity(0, 50, true, NULL, NULL, NULL));
RESET ROLE;

-- 4. No dollars, and no other user's rows ---------------------------------------------------------------
-- Keys only: a chat title may say "Rate cut".
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM res WHERE v::text ~* '"[a-z_]*(usd|cost|rate|inr|rupee|dollar)[a-z_]*":'),
  'no report carries a USD key, a cost, a rate or rupees');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM res WHERE k <> 'recent' AND v::text ~ '0\.0[0-9]*[1-9]'),
  'no dollar amount (a fraction of a cent) appears as a value either');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM res WHERE k NOT LIKE 'other.%'
    AND v::text ~ '(grok-other|whisper-other|Other user chat|Someone else)'),
  'the reader''s reports hold none of the other user''s rows');
SELECT pg_temp.assert_true(pg_temp.r('other.sum') @> '{"credits": 19, "calls": 2, "answers": 1, "lifetime_credits": 19}'
  AND (pg_temp.r('other.act') ->> 'total')::int = 2
  AND pg_temp.r('other.act')::text !~ '(Rate cut|gemini|RBI)',
  'the other user sees only their own: one answer and one dictation');

-- 5. Summary -----------------------------------------------------------------------------------------
SELECT pg_temp.assert_true((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.r('sum')) k)
  = ARRAY['answers', 'answers_free', 'by_feature', 'by_model', 'calls', 'credits', 'failed_calls', 'lifetime_credits',
          'models_used', 'providers', 'tokens', 'web_search_credits', 'web_searches'],
  'the summary returns exactly the spec keys');
SELECT pg_temp.assert_true(pg_temp.r('sum') @> '{"credits": 66.5, "calls": 9, "failed_calls": 2, "tokens": 4660,
    "answers": 3, "answers_free": 1, "web_searches": 2, "web_search_credits": 9.5, "models_used": 6, "providers": 4,
    "lifetime_credits": 66.5}',
  'summary: credits by charge time, calls, failures, tokens, answers, free answers, searches, models and providers');
SELECT pg_temp.assert_true(pg_temp.r('sum') -> 'by_model' = '[
    {"model": "google/gemini-3.7-flash", "provider": "google", "credits": 47.5, "calls": 3, "tokens": 3000},
    {"model": "anthropic/claude-sonnet-5", "provider": "anthropic", "credits": 9.5, "calls": 1, "tokens": 500},
    {"model": "deepseek/deepseek-v4-flash", "provider": "deepseek", "credits": 9.5, "calls": 1, "tokens": 800},
    {"model": "openai/whisper-large-v3-turbo", "provider": "openai", "credits": 0, "calls": 2, "tokens": 50},
    {"model": "google/gemini-3.5-flash-lite", "provider": "google", "credits": 0, "calls": 1, "tokens": 300},
    {"model": "openai/text-embedding-3-small", "provider": "openai", "credits": 0, "calls": 1, "tokens": 10}]'::jsonb,
  'by_model: each model''s share of the charges, its calls and tokens, by credits then calls');
SELECT pg_temp.assert_true((SELECT sum((m ->> 'credits')::numeric) FROM jsonb_array_elements(pg_temp.r('sum') -> 'by_model') m)
  = (pg_temp.r('sum') ->> 'credits')::numeric, 'the model shares add up to the credits charged');
SELECT pg_temp.assert_true(pg_temp.r('sum') -> 'by_feature' = '[
    {"feature": "research", "calls": 7, "credits": 66.5, "searches": 2},
    {"feature": "dictation", "calls": 2, "credits": 0, "searches": 0}]'::jsonb,
  'by_feature: AI research and dictation (free); other callers are left out');
SELECT pg_temp.assert_true(pg_temp.r('sum.cycle') @> '{"credits": 57, "lifetime_credits": 66.5}'
  AND (pg_temp.r('sum.cycle') -> 'by_model') @> '[{"model": "google/gemini-3.7-flash", "credits": 47.5, "calls": 3}]'
  AND (pg_temp.r('sum.cycle') ->> 'calls')::int = 9,
  'credits count by charge time: the sweep a day later falls outside a window its call is inside');
SELECT pg_temp.assert_true(pg_temp.r('sum.backwards') @> '{"credits": 0, "calls": 0, "answers": 0, "by_model": []}',
  'a window that ends before it starts is empty');

-- 6. Shares, at the source ------------------------------------------------------------------------------
SELECT pg_temp.assert_true(NOT EXISTS (
    SELECT FROM public.credit_ledger e
    WHERE e.kind = 'charge'
      AND abs(-e.credits - (SELECT sum(c.credits) FROM private.credit_usage_charged(e.user_id, '-infinity', 'infinity') c
                            WHERE c.ledger_id = e.id)) > 0.0001),
  'each charge entry''s model shares add up to its credits');
SELECT pg_temp.assert_true(NOT EXISTS (
    SELECT FROM auth.users u, private.credit_usage_charged(u.id, '-infinity', 'infinity') c
    WHERE c.web_search_credits > c.credits OR c.web_search_credits < 0),
  'web-search credits never exceed their row''s credits');
SELECT pg_temp.assert_true((SELECT c.web_search_credits = 19 AND c.credits = 19
    FROM private.credit_usage_charged('00000000-0000-4000-8000-00000000d002', '-infinity', 'infinity') c),
  'a row whose recorded search cost exceeds its charged cost is capped at the row''s own credits');

-- 7. Time series in IST ---------------------------------------------------------------------------------
CREATE TEMP TABLE ts AS
SELECT x ->> 'bucket_start' AS b, x ->> 'model' AS model, (x ->> 'credits')::numeric AS credits,
       (x ->> 'calls')::int AS calls, (x ->> 'tokens')::bigint AS tokens
FROM jsonb_array_elements(pg_temp.r('ts.day') -> 'series') x;
SELECT pg_temp.assert_true(pg_temp.r('ts.day') ->> 'bucket' = 'day'
  AND (SELECT array_agg(DISTINCT b ORDER BY b) FROM ts) = ARRAY['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13'],
  'every IST day of the window is a bucket');
SELECT pg_temp.assert_true((SELECT count(*) = 1 AND bool_and(model IS NULL AND credits = 0 AND calls = 0 AND tokens = 0)
    FROM ts WHERE b IN ('2026-09-10')) AND (SELECT count(*) = 1 AND bool_and(model IS NULL) FROM ts WHERE b = '2026-09-13'),
  'an empty day is filled with one zero element whose model is null');
SELECT pg_temp.assert_true((SELECT sum(credits) FROM ts WHERE b = '2026-09-11') = 57
  AND (SELECT credits FROM ts WHERE b = '2026-09-11' AND model = 'google/gemini-3.7-flash') = 47.5
  AND (SELECT calls FROM ts WHERE b = '2026-09-11' AND model = 'google/gemini-3.7-flash') = 3,
  'a charge at 20:00 UTC on 10 Sep is 11 Sep in IST, not 10 Sep');
SELECT pg_temp.assert_true((SELECT credits = 9.5 AND calls = 0 FROM ts WHERE b = '2026-09-12' AND model = 'anthropic/claude-sonnet-5')
  AND (SELECT calls FROM ts WHERE b = '2026-09-11' AND model = 'anthropic/claude-sonnet-5') = 1,
  'credits are bucketed by charge time, calls by call time');
SELECT pg_temp.assert_true((SELECT sum(credits) FROM ts) = (pg_temp.r('sum') ->> 'credits')::numeric
  AND (SELECT sum(calls) FROM ts) = (pg_temp.r('sum') ->> 'calls')::int
  AND (SELECT sum(tokens) FROM ts) = (pg_temp.r('sum') ->> 'tokens')::bigint,
  'the series adds up to the summary over the same window');
SELECT pg_temp.assert_true(pg_temp.r('ts.week') = pg_temp.r('ts.day'), 'an unknown bucket is a day');
SELECT pg_temp.assert_true(pg_temp.r('ts.month') ->> 'bucket' = 'month'
  AND (SELECT array_agg(DISTINCT x ->> 'bucket_start') FROM jsonb_array_elements(pg_temp.r('ts.month') -> 'series') x) = ARRAY['2026-09-01']
  AND (SELECT sum((x ->> 'credits')::numeric) FROM jsonb_array_elements(pg_temp.r('ts.month') -> 'series') x) = 66.5,
  'lifetime by month starts at the first activity and buckets by IST month');
SELECT pg_temp.assert_true((SELECT count(DISTINCT x ->> 'bucket_start') FROM jsonb_array_elements(pg_temp.r('ts.long') -> 'series') x)
  BETWEEN 400 AND 402, 'a day series is clamped to 400 days');

-- 8. Activity, grouped by question --------------------------------------------------------------------
CREATE FUNCTION pg_temp.rows(p_key text) RETURNS SETOF jsonb LANGUAGE sql AS $$
  SELECT x FROM jsonb_array_elements(pg_temp.r(p_key) -> 'rows') x $$;
SELECT pg_temp.assert_true((pg_temp.r('act') ->> 'total')::int = 5
  AND (SELECT array_agg(coalesce(x ->> 'turn_key', x ->> 'model')) FROM pg_temp.rows('act') x)
      = ARRAY['openai/whisper-large-v3-turbo', 'openai/whisper-large-v3-turbo', 'c1', 'b1', 'a1'],
  'activity: three answers and two dictation calls, newest first, nothing of the other caller or user');
SELECT pg_temp.assert_true((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys((SELECT x FROM pg_temp.rows('act') x LIMIT 1)) k)
  = ARRAY['calls', 'conversation_id', 'created_at', 'credits', 'detail', 'model', 'question', 'status', 'title', 'tokens', 'turn_key'],
  'each row has exactly the spec keys');
SELECT pg_temp.assert_true((SELECT x - 'detail' - 'created_at' FROM pg_temp.rows('act') x WHERE x ->> 'turn_key' = 'a1')
  = jsonb_build_object('turn_key', 'a1', 'conversation_id', pg_temp.id('conv:a1'), 'title', 'Rate cut',
      'question', 'What did the RBI do?', 'status', 'succeeded', 'model', 'google/gemini-3.7-flash',
      'calls', 5, 'tokens', 3810, 'credits', 57),
  'an answer: its chat, question, status, answer model, calls, tokens and both charges');
SELECT pg_temp.assert_true((SELECT x -> 'detail' FROM pg_temp.rows('act') x WHERE x ->> 'turn_key' = 'a1') = '[
    {"role": "search", "model": "openai/text-embedding-3-small", "effort": null, "tokens": 10, "credits": 0, "free": false, "status": "succeeded"},
    {"role": "search", "model": "google/gemini-3.7-flash", "effort": "low", "tokens": 1000, "credits": 19, "free": false, "status": "succeeded"},
    {"role": "answer", "model": "google/gemini-3.7-flash", "effort": "low", "tokens": 2000, "credits": 28.5, "free": false, "status": "succeeded"},
    {"role": "repair", "model": "google/gemini-3.5-flash-lite", "effort": null, "tokens": 300, "credits": 0, "free": true, "status": "succeeded"},
    {"role": "search", "model": "anthropic/claude-sonnet-5", "effort": "high", "tokens": 500, "credits": 9.5, "free": false, "status": "stopped"}]'::jsonb,
  'expanded: each call''s role, model, thinking level, tokens and credit share; the repair is free');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM pg_temp.rows('act') x
    WHERE abs((x ->> 'credits')::numeric - (SELECT coalesce(sum((d ->> 'credits')::numeric), 0) FROM jsonb_array_elements(x -> 'detail') d)) > 0.001),
  'every expanded row''s calls add up to its credits');
SELECT pg_temp.assert_true((SELECT x @> '{"status": "failed", "credits": 0, "calls": 1, "title": "Failed one"}'
    AND x -> 'detail' = '[{"role": "answer", "model": "google/gemini-3.7-flash", "effort": null, "tokens": 0, "credits": 0, "free": true, "status": "failed"}]'
  FROM pg_temp.rows('act') x WHERE x ->> 'turn_key' = 'b1'),
  'a failed answer appears, free');
SELECT pg_temp.assert_true((SELECT x @> '{"conversation_id": null, "title": null, "question": null, "status": "succeeded",
    "credits": 9.5, "calls": 1, "model": "deepseek/deepseek-v4-flash"}' FROM pg_temp.rows('act') x WHERE x ->> 'turn_key' = 'c1'),
  'a deleted conversation''s answer keeps its calls and credits, without its title or question');
SELECT pg_temp.assert_true((SELECT x @> '{"turn_key": null, "status": "succeeded", "credits": 0, "calls": 1, "tokens": 50,
    "detail": [{"role": "dictation", "free": true}]}' FROM pg_temp.rows('act') x
  WHERE x ->> 'model' = 'openai/whisper-large-v3-turbo' AND x ->> 'status' = 'succeeded'),
  'a dictation call is its own row, free');
SELECT pg_temp.assert_true((pg_temp.r('act.page') ->> 'total')::int = 5
  AND (SELECT array_agg(coalesce(x ->> 'turn_key', x ->> 'status')) FROM pg_temp.rows('act.page') x) = ARRAY['succeeded', 'c1'],
  'paging: offset 1, limit 2 gives the second and third rows and the full total');
SELECT pg_temp.assert_true((pg_temp.r('act.failed') ->> 'total')::int = 2
  AND NOT EXISTS (SELECT FROM pg_temp.rows('act.failed') x WHERE x ->> 'status' <> 'failed')
  AND (pg_temp.r('act.ok') ->> 'total')::int = 3,
  'failures only, and succeeded');
SELECT pg_temp.assert_true(pg_temp.r('act.bogus') = pg_temp.r('act'),
  'a negative offset, a null grouping and unknown filters mean the first page of everything');
SELECT pg_temp.assert_true((pg_temp.r('act.dictation') ->> 'total')::int = 2 AND (pg_temp.r('act.answers') ->> 'total')::int = 3,
  'kind: answers or dictation');
SELECT pg_temp.assert_true((pg_temp.r('act.sonnet') ->> 'total')::int = 1
  AND (SELECT x ->> 'turn_key' FROM pg_temp.rows('act.sonnet') x) = 'a1',
  'a model filter finds the answer any of whose calls used it');
SELECT pg_temp.assert_true(jsonb_array_length(pg_temp.r('act.one') -> 'rows') = 1, 'a limit below 1 is 1');

-- 9. Activity, one row per call -------------------------------------------------------------------------
SELECT pg_temp.assert_true((pg_temp.r('act.flat') ->> 'total')::int = 9
  AND jsonb_array_length(pg_temp.r('act.flat') -> 'rows') = 9
  AND NOT EXISTS (SELECT FROM pg_temp.rows('act.flat') x WHERE x -> 'detail' <> '[]'::jsonb OR (x ->> 'calls')::int <> 1),
  'ungrouped: one row per call, no detail; a limit of 500 is clamped and still returns all nine');
SELECT pg_temp.assert_true((SELECT x @> '{"turn_key": "a1", "title": "Rate cut", "credits": 19, "status": "succeeded"}'
    FROM pg_temp.rows('act.flat') x WHERE x ->> 'tokens' = '1000')
  AND (SELECT x @> '{"turn_key": "c1", "conversation_id": null, "title": null, "credits": 9.5}'
    FROM pg_temp.rows('act.flat') x WHERE x ->> 'model' = 'deepseek/deepseek-v4-flash'),
  'a call row carries its turn, its chat (none once deleted) and its credit share');
SELECT pg_temp.assert_true((pg_temp.r('act.flat') ->> 'total')::int = (pg_temp.r('sum') ->> 'calls')::int
  AND (SELECT sum((x ->> 'credits')::numeric) FROM pg_temp.rows('act.flat') x) = 66.5,
  'the call rows add up to the summary');
SELECT pg_temp.assert_true((pg_temp.r('act.flat.flash') ->> 'total')::int = 3, 'ungrouped filters by model and kind');

-- 10. my_credits().recent: bounded, same answer ---------------------------------------------------------
-- 25 charged answers for user 03, one a minute; t05 has a second entry (a sweep) a day later, and t07 a
-- zero entry a day after that: each turn counts from its latest entry, as before the bound.
SELECT pg_temp.turn('00000000-0000-4000-8000-00000000d003', 't' || lpad(i::text, 2, '0'), 'Chat ' || i, 'Q', 'complete', 'A',
                    '2026-09-01 00:00:00+00'::timestamptz + make_interval(mins => i))
FROM generate_series(1, 25) i;
INSERT INTO public.credit_ledger (user_id, kind, credits, turn_key, usd_to_inr, inr_per_credit, created_at)
SELECT '00000000-0000-4000-8000-00000000d003', 'charge', -i, 't' || lpad(i::text, 2, '0'), 95, 0.1,
       '2026-09-01 00:00:30+00'::timestamptz + make_interval(mins => i)
FROM generate_series(1, 25) i;
INSERT INTO public.credit_ledger (user_id, kind, credits, turn_key, usd_to_inr, inr_per_credit, created_at) VALUES
  ('00000000-0000-4000-8000-00000000d003', 'charge', -100, 't05', 95, 0.1, '2026-09-02 00:00:00+00'),
  ('00000000-0000-4000-8000-00000000d003', 'charge', 0, 't07', 95, 0.1, '2026-09-03 00:00:00+00');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000d003', true);
INSERT INTO res VALUES ('recent', public.my_credits());
RESET ROLE;
SELECT pg_temp.assert_true((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.r('recent')) k)
  = ARRAY['balance', 'cycle', 'debt', 'held', 'inr_per_credit', 'lots', 'plan', 'recent', 'used_this_cycle'],
  'my_credits keeps its keys');
SELECT pg_temp.assert_true((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.r('recent') -> 'cycle') k)
  = ARRAY['allowance', 'ends_at', 'starts_at'] AND pg_temp.r('recent') -> 'cycle' ->> 'starts_at' IS NULL,
  'the cycle names its start (none without a monthly or signup lot)');
SELECT pg_temp.assert_true(jsonb_array_length(pg_temp.r('recent') -> 'recent') = 20
  AND (SELECT array_agg(x ->> 'title') FROM jsonb_array_elements(pg_temp.r('recent') -> 'recent') x)
      = ARRAY['Chat 7', 'Chat 5', 'Chat 25', 'Chat 24', 'Chat 23', 'Chat 22', 'Chat 21', 'Chat 20', 'Chat 19', 'Chat 18',
              'Chat 17', 'Chat 16', 'Chat 15', 'Chat 14', 'Chat 13', 'Chat 12', 'Chat 11', 'Chat 10', 'Chat 9', 'Chat 8']
  AND (pg_temp.r('recent') -> 'recent' -> 1) @> jsonb_build_object('credits', 105, 'conversation_id', pg_temp.id('conv:t05')),
  'recent: the 20 latest charged answers, each summed over all its entries, newest first');
SELECT pg_temp.assert_true((SELECT prosrc ~ 'ORDER BY e\.created_at DESC\s+LIMIT 200' FROM pg_proc WHERE oid = 'public.my_credits()'::regprocedure),
  'recent reads a bounded number of entries before it aggregates');
INSERT INTO auth.users (id, email, created_at, email_confirmed_at)
VALUES ('00000000-0000-4000-8000-00000000d004', 'signup@example.invalid', now(), now());
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000d004', true);
INSERT INTO res VALUES ('signup', public.my_credits());
RESET ROLE;
SELECT pg_temp.assert_true((pg_temp.r('signup') -> 'cycle' ->> 'starts_at')::timestamptz = now()
  AND (pg_temp.r('signup') -> 'cycle' ->> 'starts_at')::timestamptz
      = (SELECT starts_at FROM public.credit_lots WHERE user_id = '00000000-0000-4000-8000-00000000d004' AND kind = 'signup'),
  'on Free the cycle starts with the signup lot, where used_this_cycle counts from');

ROLLBACK;
