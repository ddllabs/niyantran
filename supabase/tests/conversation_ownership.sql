-- B2 PostgreSQL assertions; no pgTAP dependency. Run only in a disposable DB.
-- Bootstrap: bootstrap_auth.sql, backend/sql/auth_schema.sql, 0001 email SQL,
-- 0002, 0004, then 0013. Never load the live cron schedule for these tests.
-- This tests database authority, not D3/D6 HTTP identity/ownership validation.
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
  ('00000000-0000-4000-8000-000000000011', 'chat.one@example.invalid'),
  ('00000000-0000-4000-8000-000000000012', 'chat.two@example.invalid');
INSERT INTO public.conversations (id, user_id, title) VALUES
  ('10000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000011', 'One'),
  ('10000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000012', 'Two');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000011';
SET LOCAL request.jwt.claim.role = 'authenticated';

-- Baseline negatives: each statement is accepted by migration 0002 alone.
SELECT pg_temp.rejected($q$INSERT INTO public.chat_messages (conversation_id, role, content)
  VALUES ('10000000-0000-4000-8000-000000000012', 'user', 'Cross-parent message')$q$,
  '42501', 'client cannot insert into another user conversation');
SELECT pg_temp.rejected($q$INSERT INTO public.chat_cancellations (conversation_id)
  VALUES ('10000000-0000-4000-8000-000000000012')$q$,
  '42501', 'client cannot cancel another user conversation');
SELECT pg_temp.rejected($q$INSERT INTO public.chat_messages (conversation_id, role, content)
  VALUES ('10000000-0000-4000-8000-000000000011', 'assistant', 'Forged answer')$q$,
  '42501', 'client cannot insert an assistant message');
SELECT pg_temp.rejected($q$INSERT INTO public.chat_messages (conversation_id, role, content, usage)
  VALUES ('10000000-0000-4000-8000-000000000011', 'user', 'Forged usage', '{"cost_usd":999}')$q$,
  '42501', 'client cannot forge trusted message metadata');

SELECT pg_temp.assert_true(NOT has_table_privilege('authenticated', 'public.chat_messages', 'INSERT')
  AND NOT has_column_privilege('authenticated', 'public.chat_messages', 'usage', 'INSERT')
  AND NOT has_column_privilege('authenticated', 'public.chat_messages', 'content', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.model_call_logs', 'user_id', 'UPDATE'),
  'broad table and historical column grants removed');

INSERT INTO public.conversations (id, title)
VALUES ('10000000-0000-4000-8000-000000000013', 'Created by owner');
UPDATE public.conversations SET title = 'Renamed by owner'
WHERE id = '10000000-0000-4000-8000-000000000013';
SELECT pg_temp.assert_true((SELECT title = 'Renamed by owner' FROM public.conversations
  WHERE id = '10000000-0000-4000-8000-000000000013'), 'owner can create and rename conversations');
DELETE FROM public.conversations WHERE id = '10000000-0000-4000-8000-000000000013';

-- Positive client path uses precisely the columns accepted by PostgREST.
INSERT INTO public.chat_messages (id, conversation_id, user_id, role, content, turn_key)
VALUES ('20000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000011',
  auth.uid(), 'user', 'A real question', 'one');
SELECT pg_temp.assert_true((SELECT role = 'user' AND content = 'A real question'
  AND sources = '[]'::jsonb AND usage IS NULL AND timing IS NULL
  AND status = 'complete' AND created_at = now() FROM public.chat_messages
  WHERE id = '20000000-0000-4000-8000-000000000011'), 'own user-message insert uses trusted defaults');

SELECT pg_temp.rejected($q$INSERT INTO public.chat_messages (conversation_id, user_id, role, content)
  VALUES ('10000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000012', 'user', 'Forged user')$q$,
  '42501', 'client cannot impersonate the parent owner');
SELECT pg_temp.rejected($q$INSERT INTO public.chat_messages (conversation_id, role, content)
  VALUES ('10000000-0000-4000-8000-000000000099', 'user', 'Missing parent')$q$,
  '42501', 'client cannot insert with a missing parent');

DO $$
DECLARE entry record;
BEGIN
  FOR entry IN SELECT * FROM (VALUES
    ('sources', '''[{"id":"forged"}]'''), ('follow_ups', '''["forged"]'''),
    ('activity', '''["forged"]'''), ('model_requested', '''fake-model'''),
    ('model_served', '''fake-model'''), ('reasoning_effort', '''high'''),
    ('status', '''error'''), ('error_message', '''forged'''),
    ('timing', '''{"total_ms":1}'''), ('created_at', '''2000-01-01''')
  ) AS fields(column_name, value_sql)
  LOOP
    PERFORM pg_temp.rejected(format(
      'INSERT INTO public.chat_messages (conversation_id, role, content, %I) VALUES (%L, %L, %L, %s)',
      entry.column_name, '10000000-0000-4000-8000-000000000011', 'user', 'Forged metadata', entry.value_sql),
      '42501', 'client cannot supply ' || entry.column_name);
  END LOOP;
END;
$$;

SELECT pg_temp.rejected($q$UPDATE public.chat_messages SET role = 'assistant'
  WHERE id = '20000000-0000-4000-8000-000000000011'$q$, '42501', 'client cannot promote user message to assistant');
SELECT pg_temp.rejected($q$UPDATE public.chat_messages SET conversation_id = '10000000-0000-4000-8000-000000000012'
  WHERE id = '20000000-0000-4000-8000-000000000011'$q$, '42501', 'client cannot reparent a message');
SELECT pg_temp.rejected($q$DELETE FROM public.chat_messages
  WHERE id = '20000000-0000-4000-8000-000000000011'$q$, '42501', 'individual persisted messages are immutable to clients');
SELECT pg_temp.rejected($q$INSERT INTO public.chat_messages (conversation_id, role, content, turn_key)
  VALUES ('10000000-0000-4000-8000-000000000011', 'user', 'Changed question', 'one')
  ON CONFLICT (conversation_id, turn_key) DO UPDATE SET content = EXCLUDED.content$q$,
  '42501', 'client upsert cannot overwrite a persisted turn');

INSERT INTO public.chat_cancellations (conversation_id, user_id, cancel_requested_at)
VALUES ('10000000-0000-4000-8000-000000000011', auth.uid(), '2026-09-01T00:00:00Z')
ON CONFLICT (conversation_id) DO UPDATE SET conversation_id = EXCLUDED.conversation_id,
  user_id = EXCLUDED.user_id, cancel_requested_at = EXCLUDED.cancel_requested_at;
INSERT INTO public.chat_cancellations (conversation_id, user_id, cancel_requested_at)
VALUES ('10000000-0000-4000-8000-000000000011', auth.uid(), now())
ON CONFLICT (conversation_id) DO UPDATE SET conversation_id = EXCLUDED.conversation_id,
  user_id = EXCLUDED.user_id, cancel_requested_at = EXCLUDED.cancel_requested_at;
SELECT pg_temp.assert_true((SELECT count(*) = 1 AND bool_and(cancel_requested_at = now())
  FROM public.chat_cancellations), 'owner cancellation upsert accepts all submitted payload columns');
SELECT pg_temp.rejected($q$UPDATE public.chat_cancellations
  SET conversation_id = '10000000-0000-4000-8000-000000000012'$q$, '42501', 'client cannot reparent cancellation');
SELECT pg_temp.rejected($q$UPDATE public.chat_cancellations
  SET user_id = '00000000-0000-4000-8000-000000000012'$q$, '42501', 'client cannot reassign cancellation owner');

RESET ROLE;
SET LOCAL ROLE service_role;
INSERT INTO public.chat_messages (id, conversation_id, user_id, role, content,
  sources, usage, timing, model_served)
VALUES ('20000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000011',
  '00000000-0000-4000-8000-000000000011', 'assistant', 'Verified server result',
  '[{"id":"source-1"}]', '{"cost_usd":0.01}', '{"total_ms":12}', 'test-model');
UPDATE public.chat_messages SET status = 'cancelled'
WHERE id = '20000000-0000-4000-8000-000000000012';
SELECT pg_temp.assert_true((SELECT role = 'assistant' AND status = 'cancelled'
  AND usage = '{"cost_usd":0.01}'::jsonb FROM public.chat_messages
  WHERE id = '20000000-0000-4000-8000-000000000012'), 'trusted server persists and updates assistant results');

SELECT pg_temp.rejected($q$INSERT INTO public.chat_messages (conversation_id, user_id, role, content)
  VALUES ('10000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000011', 'assistant', 'Wrong owner')$q$,
  '23503', 'composite FK rejects inconsistent server message');
SELECT pg_temp.rejected($q$INSERT INTO public.chat_cancellations (conversation_id, user_id)
  VALUES ('10000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000011')$q$,
  '23503', 'composite FK rejects inconsistent server cancellation');
SELECT pg_temp.rejected($q$UPDATE public.chat_messages
  SET user_id = '00000000-0000-4000-8000-000000000012'
  WHERE id = '20000000-0000-4000-8000-000000000012'$q$, '23503', 'composite FK protects server message updates');
SELECT pg_temp.rejected($q$UPDATE public.chat_cancellations
  SET user_id = '00000000-0000-4000-8000-000000000012'
  WHERE conversation_id = '10000000-0000-4000-8000-000000000011'$q$,
  '23503', 'composite FK protects server cancellation updates');
SELECT pg_temp.rejected($q$UPDATE public.conversations
  SET user_id = '00000000-0000-4000-8000-000000000012'
  WHERE id = '10000000-0000-4000-8000-000000000011'$q$, '23503', 'parent ownership cannot drift from existing children');

INSERT INTO public.model_call_logs (id, user_id, conversation_id, message_id, caller, purpose, status, cost_usd)
VALUES ('30000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000011',
  '10000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000012',
  'research-chat', 'chat_answer', 'success', 0.01);
INSERT INTO public.chat_turn_traces (id, user_id, conversation_id, message_id, step_index, step_type, model_call_log_id)
VALUES ('40000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000011',
  '10000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000012',
  0, 'answer', '30000000-0000-4000-8000-000000000011');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM public.chat_messages), 'owner reads user and trusted assistant messages');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.model_call_logs)
  AND (SELECT count(*) = 1 FROM public.chat_turn_traces), 'owner reads server telemetry');
SELECT pg_temp.rejected($q$UPDATE public.chat_messages SET content = 'Tampered answer'
  WHERE id = '20000000-0000-4000-8000-000000000012'$q$, '42501', 'client cannot alter assistant content');
SELECT pg_temp.rejected($q$DELETE FROM public.chat_messages
  WHERE id = '20000000-0000-4000-8000-000000000012'$q$, '42501', 'client cannot delete an individual assistant result');

DO $$
DECLARE relation text;
BEGIN
  PERFORM pg_temp.rejected($q$INSERT INTO public.model_call_logs (user_id, caller, purpose, status)
    VALUES (auth.uid(), 'research-chat', 'chat_answer', 'success')$q$,
    '42501', 'client cannot insert model-call telemetry');
  PERFORM pg_temp.rejected($q$INSERT INTO public.chat_turn_traces (user_id, message_id, step_index, step_type)
    VALUES (auth.uid(), '20000000-0000-4000-8000-000000000012', 0, 'answer')$q$,
    '42501', 'client cannot insert turn telemetry');
  FOREACH relation IN ARRAY ARRAY['model_call_logs', 'chat_turn_traces'] LOOP
    PERFORM pg_temp.rejected(format('UPDATE public.%I SET user_id = auth.uid()', relation),
      '42501', 'client cannot alter ' || relation);
    PERFORM pg_temp.rejected(format('DELETE FROM public.%I', relation),
      '42501', 'client cannot delete ' || relation);
  END LOOP;
  FOREACH relation IN ARRAY ARRAY['conversations', 'chat_messages', 'chat_cancellations', 'model_call_logs', 'chat_turn_traces'] LOOP
    PERFORM pg_temp.rejected(format('TRUNCATE public.%I CASCADE', relation),
      '42501', 'client cannot truncate ' || relation);
  END LOOP;
END;
$$;

SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000012';
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.chat_messages)
  AND (SELECT count(*) = 0 FROM public.chat_cancellations), 'second user cannot read first-user children');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.model_call_logs)
  AND (SELECT count(*) = 0 FROM public.chat_turn_traces), 'second user cannot read first-user telemetry');
SELECT pg_temp.rejected($q$INSERT INTO public.chat_cancellations (conversation_id, user_id)
  VALUES ('10000000-0000-4000-8000-000000000011', auth.uid())
  ON CONFLICT (conversation_id) DO UPDATE SET user_id = EXCLUDED.user_id$q$,
  '42501', 'second-user upsert cannot steal existing cancellation');
DELETE FROM public.chat_cancellations;
DELETE FROM public.conversations WHERE id = '10000000-0000-4000-8000-000000000011';
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.chat_cancellations)
  AND (SELECT count(*) = 2 FROM public.conversations), 'cross-user deletes changed no rows');

-- RLS independently hides mismatched children even if an operator later
-- removes the FK. Roll back this corruption probe without changing fixtures.
SAVEPOINT ownership_policy_probe;
ALTER TABLE public.chat_messages DROP CONSTRAINT chat_messages_conversation_owner_fkey;
ALTER TABLE public.chat_cancellations DROP CONSTRAINT chat_cancellations_conversation_owner_fkey;
INSERT INTO public.chat_messages (id, conversation_id, user_id, role, content)
VALUES ('20000000-0000-4000-8000-000000000099', '10000000-0000-4000-8000-000000000012',
  '00000000-0000-4000-8000-000000000011', 'user', 'Mismatched fixture');
INSERT INTO public.chat_cancellations (conversation_id, user_id)
VALUES ('10000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000011');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000011';
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM public.chat_messages),
  'message read policy independently requires parent ownership');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.chat_cancellations),
  'cancellation read policy independently requires parent ownership');
SELECT pg_temp.rejected($q$INSERT INTO public.chat_messages (conversation_id, role, content)
  VALUES ('10000000-0000-4000-8000-000000000012', 'user', 'Still forbidden')$q$,
  '42501', 'message insert policy protects parent without FK');
SELECT pg_temp.rejected($q$INSERT INTO public.chat_cancellations (conversation_id, user_id)
  VALUES ('10000000-0000-4000-8000-000000000012', auth.uid())
  ON CONFLICT (conversation_id) DO UPDATE SET cancel_requested_at = now()$q$,
  '42501', 'cancellation upsert policy protects parent without FK');
RESET ROLE;
ROLLBACK TO SAVEPOINT ownership_policy_probe;

SET LOCAL ROLE anon;
SET LOCAL request.jwt.claim.sub = '';
SELECT pg_temp.rejected($q$SELECT * FROM public.chat_messages$q$, '42501', 'anonymous message read denied');
SELECT pg_temp.rejected($q$INSERT INTO public.chat_cancellations (conversation_id)
  VALUES ('10000000-0000-4000-8000-000000000011')$q$, '42501', 'anonymous cancellation denied');
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000011';
DELETE FROM public.chat_cancellations WHERE conversation_id = '10000000-0000-4000-8000-000000000011';
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.chat_cancellations), 'owner can clear cancellation');
INSERT INTO public.chat_cancellations (conversation_id)
VALUES ('10000000-0000-4000-8000-000000000011');
DELETE FROM public.conversations WHERE id = '10000000-0000-4000-8000-000000000011';
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.chat_messages)
  AND (SELECT count(*) = 0 FROM public.chat_cancellations)
  AND (SELECT count(*) = 1 FROM public.conversations), 'owner conversation deletion cascades without affecting other user');

ROLLBACK;
