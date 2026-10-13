-- Web search columns (migration 20261013140000; web-search spec §5). PostgreSQL
-- assertions, no pgTAP. Run only in a disposable database, through run.sh, which
-- applies the migration as a non-superuser (nter_migrator).
-- Bootstrap: the least_privilege chain, research_turn_persistence, then
-- 20261013140000_web_search.sql. The vacuity check drops the last: every
-- column and the new step type are then missing, so this fails.
\set ON_ERROR_STOP on
BEGIN;

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

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-4000-8000-000000000021', 'web.one@example.invalid'),
  ('00000000-0000-4000-8000-000000000022', 'web.two@example.invalid');
INSERT INTO public.conversations (id, user_id, title) VALUES
  ('20000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000021', 'One'),
  ('20000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000022', 'Two');

-- Service role (the research-chat server) writes the answer, its web sources and the telemetry.
INSERT INTO public.chat_messages (id, conversation_id, user_id, role, content, web_sources) VALUES
  ('30000000-0000-4000-8000-000000000021', '20000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000021',
   'assistant', 'Answer', '[{"url":"https://rbi.org.in/x","title":"RBI","domain":"rbi.org.in","cited":true}]'),
  ('30000000-0000-4000-8000-000000000022', '20000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000022',
   'assistant', 'Answer', '[{"url":"https://pib.gov.in/y","title":"PIB","domain":"pib.gov.in","cited":false}]');
INSERT INTO public.model_call_logs (id, user_id, conversation_id, message_id, caller, purpose, status, cost_usd, web_search_count, web_search_cost_usd) VALUES
  ('40000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000021', '20000000-0000-4000-8000-000000000021',
   '30000000-0000-4000-8000-000000000021', 'research-chat', 'chat_answer', 'success', 0.0157, 1, 0.007),
  ('40000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000022', '20000000-0000-4000-8000-000000000022',
   '30000000-0000-4000-8000-000000000022', 'research-chat', 'chat_answer', 'success', 0.0522, 2, 0.014);
INSERT INTO public.chat_turn_traces (user_id, conversation_id, message_id, step_index, step_type, result_count, model_call_log_id) VALUES
  ('00000000-0000-4000-8000-000000000021', '20000000-0000-4000-8000-000000000021', '30000000-0000-4000-8000-000000000021',
   0, 'web_search', 5, '40000000-0000-4000-8000-000000000021'),
  ('00000000-0000-4000-8000-000000000022', '20000000-0000-4000-8000-000000000022', '30000000-0000-4000-8000-000000000022',
   0, 'web_search', 10, '40000000-0000-4000-8000-000000000022');

SELECT pg_temp.assert_true((SELECT web_search IS NULL FROM public.conversations WHERE id = '20000000-0000-4000-8000-000000000021'),
  'a conversation starts automatic (web_search is null)');

-- Constraints hold even for the service role.
SELECT pg_temp.rejected($q$INSERT INTO public.chat_turn_traces (message_id, step_index, step_type)
  VALUES ('30000000-0000-4000-8000-000000000021', 1, 'web_fetch')$q$, '23514', 'an unknown step type is still rejected');
SELECT pg_temp.rejected($q$UPDATE public.model_call_logs SET web_search_count = -1
  WHERE id = '40000000-0000-4000-8000-000000000021'$q$, '23514', 'a negative search count is rejected');
SELECT pg_temp.rejected($q$UPDATE public.model_call_logs SET web_search_cost_usd = -0.007
  WHERE id = '40000000-0000-4000-8000-000000000021'$q$, '23514', 'a negative search cost is rejected');
SELECT pg_temp.rejected($q$UPDATE public.chat_messages SET web_sources = '{"url":"x"}'
  WHERE id = '30000000-0000-4000-8000-000000000021'$q$, '23514', 'web_sources must be an array');
SELECT pg_temp.rejected($q$UPDATE public.chat_messages SET web_sources = (SELECT jsonb_agg(jsonb_build_object('url', 'https://e.example/' || i)) FROM generate_series(1, 21) i)
  WHERE id = '30000000-0000-4000-8000-000000000021'$q$, '23514', 'web_sources holds at most 20 pages');
INSERT INTO public.model_call_logs (user_id, caller, purpose, status) VALUES
  ('00000000-0000-4000-8000-000000000021', 'research-chat', 'chat_answer', 'success');
SELECT pg_temp.assert_true((SELECT web_search_count = 0 AND web_search_cost_usd IS NULL FROM public.model_call_logs
    WHERE user_id = '00000000-0000-4000-8000-000000000021' AND message_id IS NULL),
  'a call without a search logs a count of 0 and no search cost');

-- The research-chat server saves a turn's web sources through finalize_research_turn.
SET LOCAL ROLE service_role;
DO $$
DECLARE
  a uuid := '00000000-0000-4000-8000-000000000021';
  claim jsonb; saved jsonb;
  terminal jsonb := '{"status":"complete","content":"Answer","sources":[],"follow_ups":[],"activity":[],"model_served":"fake","error_message":null,"usage":null,"timing":null}';
BEGIN
  claim := public.claim_research_turn(a, 'web-1', repeat('a', 64), NULL, 'Question', 'fake');
  saved := public.finalize_research_turn(a, 'web-1', (claim->>'execution_token')::uuid,
    terminal || '{"web_sources":[{"url":"https://rbi.org.in/x","title":"RBI","domain":"rbi.org.in","cited":true}]}'::jsonb);
  PERFORM pg_temp.assert_true(saved#>>'{assistant,web_sources,0,domain}' = 'rbi.org.in',
    'finalize saves the web sources and returns them in the snapshot');
  PERFORM pg_temp.assert_true((SELECT jsonb_array_length(web_sources) = 1 FROM public.chat_messages
    WHERE id = (claim#>>'{assistant,id}')::uuid), 'the saved row holds the web sources');

  claim := public.claim_research_turn(a, 'web-2', repeat('b', 64), NULL, 'Question', 'fake');
  saved := public.finalize_research_turn(a, 'web-2', (claim->>'execution_token')::uuid, terminal);
  PERFORM pg_temp.assert_true(saved#>'{assistant,web_sources}' = '[]'::jsonb,
    'a result without web sources saves an empty list (older servers keep working)');

  claim := public.claim_research_turn(a, 'web-3', repeat('c', 64), NULL, 'Question', 'fake');
  PERFORM pg_temp.rejected(format('SELECT public.finalize_research_turn(%L, ''web-3'', %L, %L)', a, claim->>'execution_token',
    terminal || '{"web_sources":{"url":"https://x.example"}}'::jsonb), '22023', 'finalize rejects web sources that are not an array');
  PERFORM pg_temp.rejected(format('SELECT public.finalize_research_turn(%L, ''web-3'', %L, %L)', a, claim->>'execution_token',
    terminal || jsonb_build_object('web_sources', (SELECT jsonb_agg(jsonb_build_object('url', 'https://e.example/' || i)) FROM generate_series(1, 21) i))),
    '23514', 'finalize cannot save more than 20 web sources');
END $$;
RESET ROLE;

-- The reader, user one.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000021';
SET LOCAL request.jwt.claim.role = 'authenticated';

UPDATE public.conversations SET web_search = false WHERE id = '20000000-0000-4000-8000-000000000021';
SELECT pg_temp.assert_true((SELECT web_search = false FROM public.conversations WHERE id = '20000000-0000-4000-8000-000000000021'),
  'the owner sets their own conversation''s globe override');
UPDATE public.conversations SET web_search = true WHERE id = '20000000-0000-4000-8000-000000000022';
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.conversations WHERE id = '20000000-0000-4000-8000-000000000022'),
  'another user''s conversation is invisible, so its override cannot be set');

SELECT pg_temp.assert_true((SELECT jsonb_array_length(web_sources) = 1 FROM public.chat_messages
    WHERE id = '30000000-0000-4000-8000-000000000021'),
  'the owner reads the web sources of their answer');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.chat_messages WHERE id = '30000000-0000-4000-8000-000000000022'),
  'another user''s web sources are invisible');
SELECT pg_temp.assert_true(NOT has_column_privilege('authenticated', 'public.chat_messages', 'web_sources', 'INSERT')
  AND NOT has_column_privilege('authenticated', 'public.chat_messages', 'web_sources', 'UPDATE'),
  'a reader cannot write web sources');
SELECT pg_temp.rejected($q$INSERT INTO public.chat_messages (conversation_id, role, content, web_sources)
  VALUES ('20000000-0000-4000-8000-000000000021', 'user', 'Forged', '[{"url":"https://evil.example"}]')$q$,
  '42501', 'a reader cannot insert a message with web sources');

SELECT pg_temp.assert_true((SELECT web_search_count = 1 AND web_search_cost_usd = 0.007 FROM public.model_call_logs
    WHERE id = '40000000-0000-4000-8000-000000000021'),
  'the owner reads their own call''s search count and cost');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.model_call_logs WHERE id = '40000000-0000-4000-8000-000000000022'),
  'another user''s search telemetry is invisible');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.chat_turn_traces WHERE step_type = 'web_search'),
  'the owner reads their own web_search trace and no one else''s');
SELECT pg_temp.rejected($q$UPDATE public.model_call_logs SET web_search_count = 0$q$, '42501',
  'a reader cannot rewrite search telemetry');

ROLLBACK;
