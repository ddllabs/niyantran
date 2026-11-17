-- Fact-check charges in the credit reports (migration 20261116100000; open-work F347). PostgreSQL assertions, no
-- pgTAP. Run only in a disposable database, through run.sh.
-- Bootstrap: the factcheck fixture's chain (the latest credit and billing chain, the Storage stub, app_flags, then
-- 20261116090000_factcheck.sql, as a non-superuser). The vacuity check drops that last file: the fact-check tables are
-- then missing and the first fact-check step fails.
--
-- This fixture is NOT one transaction: the report migration under test is applied in the middle of it (run.sh expands
-- the include below, and the migration commits its own transaction), so that the reports can be compared on the same
-- seeded chat and dictation data before and after it. Before: summary, timeseries (day and month), the activity list
-- (grouped and per call, every kind, status and model filter), my_credits and my_conversation_credits for two users, and
-- the owners, security, volatility, settings and grants of the functions. After the migration every one must be equal.
-- Then fact-check sessions are charged and the new rows are checked.
--
-- Users (00000000-0000-4000-8000-0000000fd0NN): 01 the reader, 02 another user whose rows must never reach 01.
\set ON_ERROR_STOP on

CREATE FUNCTION pg_temp.assert_true(actual boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL: %', label;
  END IF;
  RAISE NOTICE 'PASS: %', label;
END;
$$;

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;

-- The first fact-check step: fails without the fact-check migration of the chain.
SELECT pg_temp.assert_true(to_regclass('public.factcheck_sessions') IS NOT NULL AND to_regclass('private.factcheck_hold_keys') IS NOT NULL,
  'the fact-check tables exist');

CREATE FUNCTION pg_temp.u(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-4000-8000-0000000fd' || lpad(n::text, 3, '0'))::uuid;
$$;
CREATE FUNCTION pg_temp.mkuser(n integer, credits numeric) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid := pg_temp.u(n);
BEGIN
  INSERT INTO auth.users (id, email, created_at) VALUES (v, v::text || '@example.invalid', now());
  PERFORM private.credit_wallet(v);
  IF credits > 0 THEN
    PERFORM private.credit_mint(v, 'topup', credits, now() - interval '1 minute', now() + interval '12 months',
      'fx:' || v, NULL, 'grant', NULL, NULL, NULL);
  END IF;
  RETURN v;
END;
$$;
-- A claimed turn with its assistant message in the given state. Returns the assistant message id.
CREATE FUNCTION pg_temp.turn(p_user uuid, p_key text, p_status text, p_content text DEFAULT 'An answer.')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE conv uuid := gen_random_uuid(); um uuid; am uuid;
BEGIN
  INSERT INTO public.conversations (id, user_id, title) VALUES (conv, p_user, 'Conversation ' || p_key);
  INSERT INTO public.chat_messages (conversation_id, user_id, role, content, turn_key, created_at)
    VALUES (conv, p_user, 'user', 'A question ' || p_key, p_key, clock_timestamp()) RETURNING id INTO um;
  INSERT INTO public.chat_messages (conversation_id, user_id, role, content, status, execution_expires_at, created_at)
    VALUES (conv, p_user, 'assistant', p_content, p_status, CASE WHEN p_status = 'running' THEN now() + interval '10 minutes' END, clock_timestamp())
    RETURNING id INTO am;
  INSERT INTO public.research_turns (user_id, turn_key, request_hash, conversation_id, user_message_id, assistant_message_id, execution_token)
    VALUES (p_user, p_key, encode(sha256(convert_to(p_key, 'UTF8')), 'hex'), conv, um, am, gen_random_uuid());
  RETURN am;
END;
$$;
-- A second turn in an existing conversation.
CREATE FUNCTION pg_temp.turn_in(p_user uuid, p_conv uuid, p_key text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE um uuid; am uuid;
BEGIN
  INSERT INTO public.chat_messages (conversation_id, user_id, role, content, turn_key, created_at)
    VALUES (p_conv, p_user, 'user', 'A follow-up ' || p_key, p_key, clock_timestamp()) RETURNING id INTO um;
  INSERT INTO public.chat_messages (conversation_id, user_id, role, content, status, created_at)
    VALUES (p_conv, p_user, 'assistant', 'An answer.', 'complete', clock_timestamp()) RETURNING id INTO am;
  INSERT INTO public.research_turns (user_id, turn_key, request_hash, conversation_id, user_message_id, assistant_message_id, execution_token)
    VALUES (p_user, p_key, encode(sha256(convert_to(p_key, 'UTF8')), 'hex'), p_conv, um, am, gen_random_uuid());
  RETURN am;
END;
$$;
-- A charged chat answer: the turn, its model calls, the reservation and the settlement.
CREATE FUNCTION pg_temp.chat(p_user uuid, p_key text, p_status text, p_cost numeric, p_model text DEFAULT 'google/gemini-test',
                             p_search numeric DEFAULT 0, p_conv uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE am uuid;
BEGIN
  PERFORM public.reserve_turn_credits(p_user, p_key, true);
  IF p_conv IS NULL THEN
    am := pg_temp.turn(p_user, p_key, p_status, CASE WHEN p_status = 'error' THEN '' ELSE 'An answer.' END);
  ELSE
    am := pg_temp.turn_in(p_user, p_conv, p_key);
  END IF;
  INSERT INTO public.model_call_logs (user_id, message_id, caller, purpose, status, cost_usd, model_requested, total_tokens, web_search_count, web_search_cost_usd)
    VALUES (p_user, am, 'research-chat', 'chat_answer', 'success', p_cost, p_model, 100, CASE WHEN p_search > 0 THEN 2 ELSE 0 END, nullif(p_search, 0));
  INSERT INTO public.model_call_logs (user_id, message_id, caller, purpose, status, cost_usd, model_requested, total_tokens)
    VALUES (p_user, am, 'research-chat', 'embedding', 'success', p_cost / 10, 'openai/embed-test', 10);
  RETURN public.settle_turn_credits(p_user, p_key);
END;
$$;
-- An answer that cost nothing: no model call was logged.
CREATE FUNCTION pg_temp.free(p_user uuid, p_key text) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.reserve_turn_credits(p_user, p_key, true);
  PERFORM pg_temp.turn(p_user, p_key, 'complete');
  RETURN public.settle_turn_credits(p_user, p_key);
END;
$$;
-- The run's clock: reports are read over explicit bounds around it, so a run that crosses midnight in IST (or a month end)
-- sees the same buckets before and after the migration.
CREATE TEMP TABLE clock AS SELECT now() AS t0, now() AS tmid;
CREATE FUNCTION pg_temp.conv(p_user uuid, p_key text) RETURNS uuid LANGUAGE sql AS $$
  SELECT conversation_id FROM public.research_turns WHERE user_id = p_user AND turn_key = p_key;
$$;

-- Snapshots of everything a reader can see, for one user.
CREATE TEMP TABLE snap (tag text, k text, v jsonb, PRIMARY KEY (tag, k));
CREATE FUNCTION pg_temp.take(p_tag text, p_user uuid, p_conv uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE who text := p_user::text; lo timestamptz; hi timestamptz; mid timestamptz;
BEGIN
  SELECT c.t0 - interval '3 days', c.t0 + interval '1 day', c.tmid INTO lo, hi, mid FROM clock c;
  PERFORM set_config('request.jwt.claim.sub', who, false);
  INSERT INTO snap VALUES
    (p_tag, who || '.summary', public.my_usage_summary(NULL, NULL)),
    (p_tag, who || '.summary_range', public.my_usage_summary(lo, hi)),
    (p_tag, who || '.summary_mid', public.my_usage_summary(mid, hi)),
    (p_tag, who || '.ts_day_mid', public.my_usage_timeseries(mid, hi, 'day')),
    (p_tag, who || '.summary_empty', public.my_usage_summary(lo - interval '10 days', lo - interval '5 days')),
    (p_tag, who || '.ts_day', public.my_usage_timeseries(lo, hi, 'day')),
    (p_tag, who || '.ts_month', public.my_usage_timeseries(lo, hi, 'month')),
    (p_tag, who || '.ts_day_empty', public.my_usage_timeseries(lo - interval '10 days', lo - interval '5 days', 'day')),
    (p_tag, who || '.act_u_page', public.my_usage_activity(1, 2, false, NULL, 'all', 'all')),
    (p_tag, who || '.act_u_failed', public.my_usage_activity(0, 100, false, NULL, 'failed', 'all')),
    (p_tag, who || '.act_u_succ', public.my_usage_activity(0, 100, false, NULL, 'succeeded', 'all')),
    (p_tag, who || '.act_u_answers', public.my_usage_activity(0, 100, false, NULL, 'all', 'answers')),
    (p_tag, who || '.act_g_running', public.my_usage_activity(0, 100, true, NULL, 'all', 'answers')),
    (p_tag, who || '.act_g_all', public.my_usage_activity(0, 100, true, NULL, 'all', 'all')),
    (p_tag, who || '.act_u_all', public.my_usage_activity(0, 100, false, NULL, 'all', 'all')),
    (p_tag, who || '.act_g_answers', public.my_usage_activity(0, 100, true, NULL, 'all', 'answers')),
    (p_tag, who || '.act_g_dictation', public.my_usage_activity(0, 100, true, NULL, 'all', 'dictation')),
    (p_tag, who || '.act_u_dictation', public.my_usage_activity(0, 100, false, NULL, 'all', 'dictation')),
    (p_tag, who || '.act_g_failed', public.my_usage_activity(0, 100, true, NULL, 'failed', 'all')),
    (p_tag, who || '.act_g_succ', public.my_usage_activity(0, 100, true, NULL, 'succeeded', 'all')),
    (p_tag, who || '.act_g_model', public.my_usage_activity(0, 100, true, 'google/gemini-test', 'all', 'all')),
    (p_tag, who || '.act_u_model', public.my_usage_activity(0, 100, false, 'google/gemini-test', 'all', 'all')),
    (p_tag, who || '.act_g_page', public.my_usage_activity(1, 2, true, NULL, 'all', 'all')),
    (p_tag, who || '.credits', public.my_credits());
  IF p_conv IS NOT NULL THEN
    INSERT INTO snap VALUES (p_tag, who || '.conv', public.my_conversation_credits(p_conv));
  END IF;
END;
$$;
CREATE TEMP TABLE procs (tag text, name text, attrs jsonb, PRIMARY KEY (tag, name));
CREATE FUNCTION pg_temp.take_procs(p_tag text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO procs
  SELECT p_tag, p.oid::regprocedure::text,
         jsonb_build_object('owner', p.proowner::regrole::text, 'secdef', p.prosecdef, 'vol', p.provolatile,
                            'config', p.proconfig, 'acl', p.proacl::text, 'ret', p.prorettype::regtype::text,
                            'args', pg_get_function_arguments(p.oid), 'lang', (SELECT l.lanname FROM pg_language l WHERE l.oid = p.prolang))
  FROM pg_proc p
  WHERE p.oid IN ('public.my_usage_summary(timestamptz,timestamptz)'::regprocedure,
                  'public.my_usage_timeseries(timestamptz,timestamptz,text)'::regprocedure,
                  'public.my_usage_activity(integer,integer,boolean,text,text,text)'::regprocedure,
                  'public.my_credits()'::regprocedure,
                  'public.my_conversation_credits(uuid)'::regprocedure,
                  'private.credit_usage_charged(uuid,timestamptz,timestamptz)'::regprocedure);
$$;

-- 1. Seeded chat and dictation data, before the migration -----------------------------------------------------------
SELECT pg_temp.mkuser(1, 5000);
SELECT pg_temp.mkuser(2, 5000);
SELECT pg_temp.mkuser(3, 0);   -- a user with no data at all
SELECT pg_temp.chat(pg_temp.u(1), 'a1', 'complete', 0.01);
SELECT pg_temp.chat(pg_temp.u(1), 'a2', 'complete', 0.02, 'openai/chat-test');
SELECT pg_temp.chat(pg_temp.u(1), 'a3', 'error', 0.01);
SELECT pg_temp.chat(pg_temp.u(2), 'b1', 'complete', 0.05);
UPDATE clock SET tmid = clock_timestamp();   -- the answers above are older than this, the ones below newer
SELECT pg_temp.chat(pg_temp.u(1), 'c1', 'cancelled', 0.01);
SELECT pg_temp.chat(pg_temp.u(1), 'c2', 'truncated', 0.015);
SELECT pg_temp.chat(pg_temp.u(1), 'c3', 'running', 0.01);                      -- still running: pending, not charged
SELECT pg_temp.free(pg_temp.u(1), 'c4');                                       -- complete with no model call: free
SELECT pg_temp.chat(pg_temp.u(1), 'c5', 'complete', 0.02, 'google/gemini-test', 0.004);   -- with a web search cost
SELECT pg_temp.chat(pg_temp.u(1), 'c6', 'complete', 0.012, 'google/gemini-test', 0, pg_temp.conv(pg_temp.u(1), 'a1'));   -- a second turn in a1's conversation
-- A charge with no charge rows (caller NULL), one in the old credit unit (0.10 a credit against today's), and a charged
-- dictation call, as the three odd shapes the reports have to carry through.
DO $$
DECLARE u uuid := pg_temp.u(1); s public.credit_settings := private.credit_config(); e uuid; lid uuid;
BEGIN
  PERFORM pg_temp.turn(u, 'nocr1', 'complete');
  e := private.credit_entry(u, 'charge', -7, NULL, 'nocr1', NULL, s.usd_to_inr, s.inr_per_credit, NULL, NULL);
  PERFORM pg_temp.turn(u, 'old1', 'complete');
  e := private.credit_entry(u, 'charge', -3, NULL, 'old1', NULL, s.usd_to_inr, 10 * s.inr_per_credit, NULL, NULL);
  INSERT INTO public.model_call_logs (user_id, message_id, caller, purpose, status, cost_usd, model_requested, total_tokens)
    VALUES (u, NULL, 'transcribe-audio', 'transcription', 'success', 0.02, 'openai/whisper-test', 5) RETURNING id INTO lid;
  e := private.credit_entry(u, 'charge', -4, NULL, 'dict-1', NULL, s.usd_to_inr, s.inr_per_credit, NULL, NULL);
  INSERT INTO public.credit_charge_rows (model_call_log_id, ledger_id, cost_usd) VALUES (lid, e, 0.02);
END;
$$;
INSERT INTO public.model_call_logs (user_id, message_id, caller, purpose, status, cost_usd, model_requested, total_tokens)
VALUES (pg_temp.u(1), NULL, 'transcribe-audio', 'transcription', 'success', 0, 'openai/whisper-test', 20),
       (pg_temp.u(2), NULL, 'transcribe-audio', 'transcription', 'success', 0, 'openai/whisper-test', 30);
SELECT pg_temp.assert_true((SELECT count(*) FROM public.credit_ledger WHERE kind = 'charge' AND user_id = pg_temp.u(1)) >= 2,
  'the reader has charged chat answers');

SELECT pg_temp.take('before', pg_temp.u(1), pg_temp.conv(pg_temp.u(1), 'a1'));
SELECT pg_temp.take('before', pg_temp.u(2), pg_temp.conv(pg_temp.u(2), 'b1'));
SELECT pg_temp.take('before', pg_temp.u(3), NULL);
SELECT pg_temp.take_procs('before');

-- 2. The migration under test, as the migrating role -----------------------------------------------------------------
SET ROLE nter_migrator;
\i supabase/migrations/20261116100000_factcheck_usage_reports.sql
RESET ROLE;

SELECT pg_temp.take('after', pg_temp.u(1), pg_temp.conv(pg_temp.u(1), 'a1'));
SELECT pg_temp.take('after', pg_temp.u(2), pg_temp.conv(pg_temp.u(2), 'b1'));
SELECT pg_temp.take('after', pg_temp.u(3), NULL);
SELECT pg_temp.take_procs('after');

SELECT pg_temp.assert_true((SELECT count(*) FROM snap WHERE tag = 'before') = (SELECT count(*) FROM snap WHERE tag = 'after')
  AND (SELECT count(*) FROM snap WHERE tag = 'before') >= 60, 'both snapshots hold the same reports');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM snap b JOIN snap a ON a.k = b.k AND a.tag = 'after' WHERE b.tag = 'before' AND a.v IS DISTINCT FROM b.v),
  'chat and dictation reports are identical before and after the migration (summary, timeseries, activity in every mode, my_credits, my_conversation_credits, two users)');
SELECT pg_temp.assert_true((SELECT count(*) FROM procs WHERE tag = 'after') = 6
  AND NOT EXISTS (SELECT FROM procs b JOIN procs a ON a.name = b.name AND a.tag = 'after' WHERE b.tag = 'before' AND a.attrs IS DISTINCT FROM b.attrs),
  'owners, security, volatility, settings, grants and signatures of the six functions are unchanged');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM snap WHERE v::text LIKE '%factcheck%' OR v::text LIKE '%fc:%'),
  'with no fact-check charge, no report mentions fact-check at all');

-- 3. Fact-check sessions and charges ----------------------------------------------------------------------------------
INSERT INTO public.app_flags (key, value) VALUES ('livetv_factcheck', '{"enabled":true,"audience":"admin","credits_per_minute":2}')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

CREATE FUNCTION pg_temp.fcstart(p_user uuid, p_channel text, p_kind text, p_minutes integer) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE r jsonb := public.factcheck_start(p_user, 'vid1', p_channel, p_kind, NULL, p_minutes, true);
BEGIN
  IF r ->> 'ok' <> 'true' THEN RAISE EXCEPTION 'FAIL: start refused: %', r; END IF;
  RETURN (r ->> 'session_id')::uuid;
END;
$$;
CREATE FUNCTION pg_temp.fcend(p_user uuid, p_session uuid, p_started interval, p_last interval) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.factcheck_sessions SET started_at = now() - p_started, last_activity_at = now() - p_last WHERE id = p_session;
  RETURN public.factcheck_settle(p_user, p_session);
END;
$$;

CREATE TEMP TABLE ids (k text PRIMARY KEY, id uuid, key text);
DO $$
DECLARE
  r uuid := pg_temp.u(1); o uuid := pg_temp.u(2);
  s1 uuid; s2 uuid; s3 uuid; res jsonb;
BEGIN
  -- The research-chat turn whose key looks like a fact-check session's: it must stay a plain chat answer.
  s1 := pg_temp.fcstart(r, 'ltv-channel-a', 'live', 10);
  res := pg_temp.chat(r, 'factcheck:' || s1, 'complete', 0.03);
  INSERT INTO ids VALUES ('collide_conv', pg_temp.conv(r, 'factcheck:' || s1), 'factcheck:' || s1);
  INSERT INTO ids VALUES ('collide_chat_credits', NULL, res ->> 'credits');
  res := pg_temp.fcend(r, s1, interval '450 seconds', interval '1 second');
  PERFORM pg_temp.assert_true((res ->> 'credits_charged')::numeric = 16 AND (res ->> 'minutes_used')::int = 8, 'session 1 charged 8 minutes = 16');
  s2 := pg_temp.fcstart(r, 'ltv-channel-b', 'recorded', 5);
  res := pg_temp.fcend(r, s2, interval '2 minutes', interval '1 second');
  PERFORM pg_temp.assert_true((res ->> 'credits_charged')::numeric = 4, 'session 2 charged 2 minutes = 4');
  s3 := pg_temp.fcstart(o, 'ltv-channel-other', 'live', 5);
  res := pg_temp.fcend(o, s3, interval '2 minutes', interval '1 second');
  INSERT INTO ids VALUES ('s1', s1, NULL), ('s2', s2, NULL), ('s3', s3, NULL);
  INSERT INTO ids VALUES ('hold1', NULL, (SELECT turn_key FROM private.factcheck_hold_keys WHERE session_id = s1)),
                         ('hold2', NULL, (SELECT turn_key FROM private.factcheck_hold_keys WHERE session_id = s2)),
                         ('hold3', NULL, (SELECT turn_key FROM private.factcheck_hold_keys WHERE session_id = s3));
END;
$$;

-- The sessions were charged in one transaction (one clock reading): date the first charge an hour earlier.
UPDATE public.credit_ledger SET created_at = created_at - interval '1 hour'
WHERE kind = 'charge' AND note = 'live tv fact-check' AND user_id = pg_temp.u(1) AND credits = -16;

CREATE FUNCTION pg_temp.fcrows(act jsonb) RETURNS SETOF jsonb LANGUAGE sql AS $$
  SELECT e FROM jsonb_array_elements(act -> 'rows') e WHERE e ->> 'feature' = 'factcheck';
$$;

-- 4. The activity list ---------------------------------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', pg_temp.u(1)::text, false);
DO $$
DECLARE g jsonb := public.my_usage_activity(0, 100, true, NULL, 'all', 'all'); u jsonb := public.my_usage_activity(0, 100, false, NULL, 'all', 'all');
  row16 jsonb; row4 jsonb; mode text;
BEGIN
  FOREACH mode IN ARRAY ARRAY['grouped', 'per call'] LOOP
    PERFORM pg_temp.assert_true((SELECT count(*) FROM pg_temp.fcrows(CASE mode WHEN 'grouped' THEN g ELSE u END)) = 2,
      mode || ' list: both fact-check charges are listed');
    SELECT e INTO row16 FROM pg_temp.fcrows(CASE mode WHEN 'grouped' THEN g ELSE u END) e WHERE (e ->> 'credits')::numeric = 16;
    SELECT e INTO row4 FROM pg_temp.fcrows(CASE mode WHEN 'grouped' THEN g ELSE u END) e WHERE (e ->> 'credits')::numeric = 4;
    PERFORM pg_temp.assert_true(row16 IS NOT NULL AND row4 IS NOT NULL, mode || ' list: the two rows carry 16 and 4 credits');
    PERFORM pg_temp.assert_true(row16 ->> 'channel' = 'ltv-channel-a' AND (row16 ->> 'minutes_used')::int = 8 AND row16 ->> 'video_kind' = 'live'
      AND row4 ->> 'channel' = 'ltv-channel-b' AND (row4 ->> 'minutes_used')::int = 2 AND row4 ->> 'video_kind' = 'recorded',
      mode || ' list: channel, minutes used and kind');
    PERFORM pg_temp.assert_true(jsonb_typeof(row16 -> 'turn_key') = 'null' AND jsonb_typeof(row16 -> 'conversation_id') = 'null'
      AND jsonb_typeof(row16 -> 'title') = 'null' AND jsonb_typeof(row16 -> 'question') = 'null' AND jsonb_typeof(row16 -> 'model') = 'null'
      AND row16 ->> 'status' = 'succeeded' AND (row16 ->> 'calls')::int = 0 AND (row16 ->> 'tokens')::int = 0 AND row16 -> 'detail' = '[]'::jsonb,
      mode || ' list: never joined to a conversation, no turn key, no model, no calls');
    PERFORM pg_temp.assert_true((row16 ->> 'created_at')::timestamptz BETWEEN now() - interval '90 minutes' AND now() - interval '30 minutes'
      AND (row4 ->> 'created_at')::timestamptz > now() - interval '10 minutes', mode || ' list: each row carries the date of its charge');
  END LOOP;
  PERFORM pg_temp.assert_true((SELECT count(*) FROM jsonb_array_elements(g -> 'rows') e WHERE e ? 'feature') = 2
    AND (SELECT count(*) FROM jsonb_array_elements(u -> 'rows') e WHERE e ? 'feature') = 2,
    'chat and dictation rows carry none of the new keys');
  PERFORM pg_temp.assert_true((g ->> 'total')::int = (SELECT count(*) FROM jsonb_array_elements(g -> 'rows')) AND (u ->> 'total')::int = (SELECT count(*) FROM jsonb_array_elements(u -> 'rows')),
    'the totals count the fact-check rows');
  -- The credits of the list reconcile with the summary.
  PERFORM pg_temp.assert_true((SELECT sum((e ->> 'credits')::numeric) FROM jsonb_array_elements(g -> 'rows') e)
    = (public.my_usage_summary(NULL, NULL) ->> 'credits')::numeric,
    'the grouped list''s credits add up to the summary''s credits');
END;
$$;
DO $$
DECLARE kinds text[] := ARRAY['all', 'answers', 'dictation', 'factcheck']; k text; g jsonb; n integer;
BEGIN
  FOREACH k IN ARRAY kinds LOOP
    g := public.my_usage_activity(0, 100, true, NULL, 'all', k);
    n := (SELECT count(*) FROM pg_temp.fcrows(g));
    PERFORM pg_temp.assert_true(CASE k WHEN 'all' THEN n = 2 WHEN 'factcheck' THEN n = 2 AND (g ->> 'total')::int = 2 ELSE n = 0 END, 'kind ' || k || ': fact-check rows ' || n);
    g := public.my_usage_activity(0, 100, false, NULL, 'all', k);
    n := (SELECT count(*) FROM pg_temp.fcrows(g));
    PERFORM pg_temp.assert_true(CASE k WHEN 'all' THEN n = 2 WHEN 'factcheck' THEN n = 2 AND (g ->> 'total')::int = 2 ELSE n = 0 END, 'per call, kind ' || k || ': fact-check rows ' || n);
  END LOOP;
  PERFORM pg_temp.assert_true((SELECT count(*) FROM pg_temp.fcrows(public.my_usage_activity(0, 100, true, 'google/gemini-test', 'all', 'all'))) = 0
    AND (SELECT count(*) FROM pg_temp.fcrows(public.my_usage_activity(0, 100, false, 'google/gemini-test', 'all', 'all'))) = 0,
    'a real model filter leaves out fact-check rows');
  PERFORM pg_temp.assert_true((SELECT count(*) FROM pg_temp.fcrows(public.my_usage_activity(0, 100, true, 'factcheck', 'all', 'all'))) = 2
    AND (SELECT count(*) FROM pg_temp.fcrows(public.my_usage_activity(0, 100, false, 'factcheck', 'all', 'all'))) = 2
    AND (public.my_usage_activity(0, 100, true, 'factcheck', 'all', 'all') ->> 'total')::int = 2,
    'the model filter ''factcheck'' selects only them');
  PERFORM pg_temp.assert_true((SELECT count(*) FROM pg_temp.fcrows(public.my_usage_activity(0, 100, true, NULL, 'failed', 'all'))) = 0
    AND (SELECT count(*) FROM pg_temp.fcrows(public.my_usage_activity(0, 100, true, NULL, 'succeeded', 'all'))) = 2,
    'status filters: they are succeeded, never failed');
  PERFORM pg_temp.assert_true((SELECT (e ->> 'credits')::numeric FROM pg_temp.fcrows(public.my_usage_activity(0, 1, true, NULL, 'all', 'factcheck')) e) = 4
    AND (SELECT (e ->> 'credits')::numeric FROM pg_temp.fcrows(public.my_usage_activity(1, 1, true, NULL, 'all', 'factcheck')) e) = 16,
    'newest first, and paging works over them');
END;
$$;

-- 5. The summary and the timeseries --------------------------------------------------------------------------------------
DO $$
DECLARE s jsonb := public.my_usage_summary(NULL, NULL); f jsonb; research jsonb; dict jsonb; chat_credits numeric; ts jsonb;
BEGIN
  SELECT e INTO f FROM jsonb_array_elements(s -> 'by_feature') e WHERE e ->> 'feature' = 'factcheck';
  SELECT e INTO research FROM jsonb_array_elements(s -> 'by_feature') e WHERE e ->> 'feature' = 'research';
  SELECT e INTO dict FROM jsonb_array_elements(s -> 'by_feature') e WHERE e ->> 'feature' = 'dictation';
  PERFORM pg_temp.assert_true(f IS NOT NULL AND (f ->> 'calls')::int = 2 AND (f ->> 'credits')::numeric = 20 AND (f ->> 'searches')::int = 0,
    'summary: its own feature with 2 charges and 20 credits: ' || coalesce(f::text, 'missing'));
  -- Chat charges in today's unit (the old-unit one counts for ten times its ledger figure), dictation apart.
  SELECT -sum(private.credit_current_amount(credits, inr_per_credit)) INTO chat_credits FROM public.credit_ledger
  WHERE user_id = pg_temp.u(1) AND kind = 'charge' AND note IS DISTINCT FROM 'live tv fact-check' AND turn_key <> 'dict-1';
  PERFORM pg_temp.assert_true((research ->> 'credits')::numeric = chat_credits AND (dict ->> 'credits')::numeric = 4,
    'summary: research credits are the chat charges only (' || (research ->> 'credits') || ' of ' || chat_credits || '), dictation its own 4');
  chat_credits := chat_credits + 4;
  PERFORM pg_temp.assert_true((s ->> 'credits')::numeric = chat_credits + 20 AND (s ->> 'lifetime_credits')::numeric = chat_credits + 20,
    'summary: the total and the lifetime figure include the 20');
  PERFORM pg_temp.assert_true(jsonb_array_length(s -> 'by_feature') = 3, 'summary: three features');
  PERFORM pg_temp.assert_true(NOT EXISTS (SELECT FROM jsonb_array_elements(s -> 'by_model') m WHERE m ->> 'model' = 'factcheck')
    AND (SELECT (m ->> 'credits')::numeric FROM jsonb_array_elements(s -> 'by_model') m WHERE m ->> 'model' = 'unknown') = 37
    AND (s ->> 'models_used')::int = jsonb_array_length(s -> 'by_model'),
    'summary: fact-check is not a model in by_model, and the ''unknown'' model holds only the two charges with no model calls (7 + 30)');
  PERFORM pg_temp.assert_true((SELECT array_agg(m ->> 'model' ORDER BY m ->> 'model') FROM jsonb_array_elements(s -> 'by_model') m)
    = (SELECT array_agg(m ->> 'model' ORDER BY m ->> 'model') FROM jsonb_array_elements((SELECT v FROM snap WHERE tag = 'after' AND k = pg_temp.u(1)::text || '.summary') -> 'by_model') m),
    'summary: by_model lists the same models as before any fact-check charge');
  ts := public.my_usage_timeseries(NULL, NULL, 'day');
  PERFORM pg_temp.assert_true((SELECT sum((e ->> 'credits')::numeric) FROM jsonb_array_elements(ts -> 'series') e) = (s ->> 'credits')::numeric
    AND (SELECT sum((e ->> 'credits')::numeric) FROM jsonb_array_elements(ts -> 'series') e WHERE e ->> 'model' = 'factcheck') = 20,
    'timeseries: adds up to the summary, with the fact-check credits under the model ''factcheck''');
  ts := public.my_usage_timeseries(NULL, NULL, 'month');
  PERFORM pg_temp.assert_true((SELECT sum((e ->> 'credits')::numeric) FROM jsonb_array_elements(ts -> 'series') e WHERE e ->> 'model' = 'factcheck') = 20,
    'timeseries by month: the same');
END;
$$;

-- 6. my_credits.recent ----------------------------------------------------------------------------------------------------
DO $$
DECLARE c jsonb := public.my_credits(); f jsonb; n integer;
BEGIN
  SELECT count(*) INTO n FROM jsonb_array_elements(c -> 'recent') e WHERE e ->> 'feature' = 'factcheck';
  PERFORM pg_temp.assert_true(n = 2, 'recent: both charges are listed as fact-check: ' || n);
  SELECT e INTO f FROM jsonb_array_elements(c -> 'recent') e WHERE e ->> 'feature' = 'factcheck' AND (e ->> 'credits')::numeric = 16;
  PERFORM pg_temp.assert_true(f ->> 'title' = 'Live TV fact-check' AND jsonb_typeof(f -> 'conversation_id') = 'null', 'recent: titled, with no conversation');
  PERFORM pg_temp.assert_true(NOT EXISTS (SELECT FROM jsonb_array_elements(c -> 'recent') e WHERE e ? 'feature' AND e ->> 'feature' <> 'factcheck')
    AND (SELECT count(*) FROM jsonb_array_elements(c -> 'recent') e WHERE NOT (e ? 'feature') AND e ->> 'title' LIKE 'Conversation %') >= 3,
    'recent: chat entries keep their conversation titles and carry no feature key');
  PERFORM pg_temp.assert_true((c ->> 'balance')::numeric = (SELECT sum(credits) FROM public.credit_ledger WHERE user_id = pg_temp.u(1)), 'the balance already includes them');
END;
$$;

-- 7. A research-chat turn keyed like a fact-check session never takes the charge ------------------------------------------------
DO $$
DECLARE r uuid := pg_temp.u(1); ckey text; conv uuid; chat numeric; s jsonb; cc jsonb; rw jsonb;
BEGIN
  SELECT i.key, i.id INTO ckey, conv FROM ids i WHERE i.k = 'collide_conv';
  SELECT i.key::numeric INTO chat FROM ids i WHERE i.k = 'collide_chat_credits';
  s := public.settle_turn_credits(r, ckey);
  PERFORM pg_temp.assert_true((s ->> 'credits')::numeric = chat AND s ->> 'state' = 'charged', 'a chat settle for factcheck:<session id> sees only its own charge: ' || s::text);
  cc := public.my_conversation_credits(conv);
  PERFORM pg_temp.assert_true(jsonb_array_length(cc) = 1 AND (cc -> 0 ->> 'credits')::numeric = chat, 'my_conversation_credits for that conversation is the chat cost alone: ' || cc::text);
  SELECT e INTO rw FROM jsonb_array_elements(public.my_usage_activity(0, 100, true, NULL, 'all', 'answers') -> 'rows') e WHERE e ->> 'conversation_id' = conv::text;
  PERFORM pg_temp.assert_true((rw ->> 'credits')::numeric = chat AND NOT (rw ? 'feature'), 'the activity row of that conversation is the chat cost alone');
  PERFORM pg_temp.assert_true(NOT EXISTS (SELECT FROM jsonb_array_elements(public.my_credits() -> 'recent') e
                                          WHERE e ->> 'conversation_id' = conv::text AND (e ->> 'credits')::numeric <> chat),
    'recent: the conversation''s entry is the chat cost alone');
  PERFORM pg_temp.assert_true((SELECT count(*) FROM pg_temp.fcrows(public.my_usage_activity(0, 100, true, NULL, 'all', 'all'))) = 2
    AND NOT EXISTS (SELECT FROM pg_temp.fcrows(public.my_usage_activity(0, 100, true, NULL, 'all', 'all')) e WHERE e ->> 'conversation_id' IS NOT NULL),
    'and the fact-check rows still have no conversation');
END;
$$;

-- 8. Nothing leaks: not the hold key, not another user's charge ------------------------------------------------------------------
DO $$
DECLARE r uuid := pg_temp.u(1); o uuid := pg_temp.u(2); outtxt text; h record; ro jsonb;
BEGIN
  FOR h IN SELECT u FROM (VALUES (r), (o)) t(u) LOOP
    PERFORM set_config('request.jwt.claim.sub', h.u::text, false);
    outtxt := public.my_usage_summary(NULL, NULL)::text || public.my_usage_timeseries(NULL, NULL, 'day')::text || public.my_usage_timeseries(NULL, NULL, 'month')::text
        || public.my_usage_activity(0, 100, true, NULL, 'all', 'all')::text || public.my_usage_activity(0, 100, false, NULL, 'all', 'all')::text
        || public.my_usage_activity(0, 100, true, NULL, 'all', 'factcheck')::text || public.my_credits()::text;
    PERFORM pg_temp.assert_true(outtxt NOT LIKE '%fc:%' AND NOT EXISTS (SELECT FROM ids i WHERE i.k LIKE 'hold%' AND position(i.key IN outtxt) > 0),
      'no report output contains the hold key or any "fc:" text');
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub', o::text, false);
  ro := public.my_usage_activity(0, 100, true, NULL, 'all', 'all');
  PERFORM pg_temp.assert_true((SELECT count(*) FROM pg_temp.fcrows(ro)) = 1 AND (SELECT e ->> 'channel' FROM pg_temp.fcrows(ro) e) = 'ltv-channel-other'
    AND NOT EXISTS (SELECT FROM pg_temp.fcrows(ro) e WHERE e ->> 'channel' IN ('ltv-channel-a', 'ltv-channel-b')),
    'another user sees only their own fact-check charge');
  PERFORM set_config('request.jwt.claim.sub', r::text, false);
  PERFORM pg_temp.assert_true(NOT EXISTS (SELECT FROM pg_temp.fcrows(public.my_usage_activity(0, 100, true, NULL, 'all', 'all')) e WHERE e ->> 'channel' = 'ltv-channel-other'),
    'and the reader never sees theirs');
END;
$$;

-- 9. A session the owner deleted still lists its charge, without the detail ------------------------------------------------------
DO $$
DECLARE r uuid := pg_temp.u(1); before_total numeric; g jsonb; rw jsonb; s2id uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', r::text, false);
  before_total := (public.my_usage_summary(NULL, NULL) ->> 'credits')::numeric;
  SELECT id INTO s2id FROM ids WHERE k = 's1';
  DELETE FROM public.factcheck_sessions WHERE id = s2id;
  g := public.my_usage_activity(0, 100, true, NULL, 'all', 'factcheck');
  SELECT e INTO rw FROM pg_temp.fcrows(g) e WHERE (e ->> 'credits')::numeric = 16;
  PERFORM pg_temp.assert_true(rw IS NOT NULL AND jsonb_typeof(rw -> 'channel') = 'null' AND jsonb_typeof(rw -> 'minutes_used') = 'null'
    AND (public.my_usage_summary(NULL, NULL) ->> 'credits')::numeric = before_total
    AND (SELECT count(*) FROM pg_temp.fcrows(g)) = 2,
    'after the session is deleted its charge is still listed, with no channel or minutes, and the totals are the same');
END;
$$;

-- 9b. Kinds that cannot contain a fact-check row do not read the ledger for one. A stand-in helper that raises is put in
-- place; the activity list for 'answers' and for 'dictation' must still work in both modes (so the helper is never
-- called), and for 'factcheck' it must raise (so the stand-in is really in use). Then the migration is applied again,
-- which restores the helper (and is the harmless second apply the drift guard allows).
SET ROLE nter_migrator;
CREATE OR REPLACE FUNCTION private.factcheck_charges(p_user uuid, p_from timestamptz, p_to timestamptz)
RETURNS TABLE (ledger_id uuid, charged_at timestamptz, credits numeric, channel_id text, video_kind text, minutes_used integer)
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'the fact-check helper was called' USING ERRCODE = 'XX001'; END; $$;
RESET ROLE;
DO $$
DECLARE k text; g boolean; raised boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u(1)::text, false);
  FOREACH k IN ARRAY ARRAY['answers', 'dictation'] LOOP
    FOREACH g IN ARRAY ARRAY[true, false] LOOP
      PERFORM public.my_usage_activity(0, 100, g, NULL, 'all', k);
    END LOOP;
  END LOOP;
  PERFORM pg_temp.assert_true(true, 'kinds answers and dictation never call the fact-check helper, in either mode');
  raised := false;
  BEGIN PERFORM public.my_usage_activity(0, 100, true, NULL, 'all', 'factcheck');
  EXCEPTION WHEN SQLSTATE 'XX001' THEN raised := true; END;
  PERFORM pg_temp.assert_true(raised, 'and the stand-in is in use: kind factcheck does call it');
END;
$$;
SET ROLE nter_migrator;
\i supabase/migrations/20261116100000_factcheck_usage_reports.sql
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*) FROM pg_temp.fcrows(public.my_usage_activity(0, 100, true, NULL, 'all', 'all'))) = 2,
  'after the second apply the helper is back and the fact-check rows list again');

-- 10. The new helper is private (last on purpose: without the migration the earlier, behavioural assertions fail first).
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated', 'private.factcheck_charges(uuid,timestamptz,timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'private.factcheck_charges(uuid,timestamptz,timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'private.factcheck_charges(uuid,timestamptz,timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('public', 'private.factcheck_charges(uuid,timestamptz,timestamptz)', 'EXECUTE'),
  'the new helper is private');
