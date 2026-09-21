-- Disposable PG assertions. Run on the isolated B1/B2/C2/B5 least-privilege
-- fixture plus the D3 migration; never bootstrap production cron (0007).
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(actual boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF actual IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END; $$;
CREATE FUNCTION pg_temp.rejected(statement text, expected_state text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> expected_state THEN RAISE EXCEPTION 'FAIL: % expected % got %: %', label, expected_state, SQLSTATE, SQLERRM; END IF;
    RAISE NOTICE 'PASS: %', label; RETURN;
  END;
  RAISE EXCEPTION 'FAIL: % accepted', label;
END; $$;
SELECT pg_temp.assert_true(to_regclass('public.research_turns') IS NOT NULL, 'durable turn claim exists');
INSERT INTO auth.users(id,email) VALUES
 ('00000000-0000-4000-8000-000000000031','turn.a@example.invalid'),
 ('00000000-0000-4000-8000-000000000032','turn.b@example.invalid');
INSERT INTO public.conversations(id,user_id,title) VALUES
 ('10000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000031','Owned'),
 ('10000000-0000-4000-8000-000000000032','00000000-0000-4000-8000-000000000032','Foreign');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000031';
SELECT pg_temp.rejected($q$SELECT public.claim_research_turn(auth.uid(),'client',repeat('a',64),NULL,'Question','fake')$q$, '42501', 'clients cannot claim server work');
SELECT pg_temp.rejected($q$SELECT * FROM public.research_turns$q$, '42501', 'clients cannot read execution tokens');
SELECT pg_temp.rejected($q$INSERT INTO public.chat_messages(conversation_id,role,content,status,execution_expires_at) VALUES ('10000000-0000-4000-8000-000000000031','assistant','forged','running',now())$q$, '42501', 'clients cannot reserve or finalize assistant results');
RESET ROLE;

DO $$
DECLARE actor text; privilege text; routine text;
BEGIN
  FOREACH actor IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
      PERFORM pg_temp.assert_true(NOT has_table_privilege(actor,'public.research_turns',privilege), actor || ' cannot ' || privilege || ' claims');
    END LOOP;
    FOREACH routine IN ARRAY ARRAY['lookup_research_turn(uuid,text,text,uuid)','claim_research_turn(uuid,text,text,uuid,text,text,text,text,text)','finalize_research_turn(uuid,text,uuid,jsonb)'] LOOP
      PERFORM pg_temp.assert_true(NOT has_function_privilege(actor,'public.'||routine,'EXECUTE'), actor || ' cannot execute ' || routine);
    END LOOP;
  END LOOP;
  FOREACH privilege IN ARRAY ARRAY['DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
    PERFORM pg_temp.assert_true(NOT has_table_privilege('service_role','public.research_turns',privilege), 'service cannot ' || privilege || ' claim keys');
  END LOOP;
END; $$;

-- Claims use a durable chronology, not transaction-scoped now(). These calls
-- deliberately share one transaction; existing future timestamps must also win
-- over wall time without moving the execution deadline into the future.
SET LOCAL ROLE service_role;
DO $$
DECLARE
 owner_id uuid := '00000000-0000-4000-8000-000000000031';
 first jsonb; second jsonb; third jsonb; parent_id uuid;
 user_time timestamptz; assistant_time timestamptz; next_time timestamptz;
 future_time timestamptz := clock_timestamp() + interval '1 year';
BEGIN
 first := public.claim_research_turn(owner_id,'ordered-first',repeat('1',64),NULL,'Ordering','fake');
 parent_id := (first#>>'{conversation,id}')::uuid;
 SELECT created_at INTO user_time FROM public.chat_messages WHERE id = (first->>'user_message_id')::uuid;
 assistant_time := (first#>>'{assistant,created_at}')::timestamptz;
 PERFORM pg_temp.assert_true(user_time < assistant_time, 'user strictly precedes reserved assistant');
 second := public.claim_research_turn(owner_id,'ordered-second',repeat('2',64),parent_id,'Ordering again','fake');
 PERFORM pg_temp.assert_true((SELECT last_message_at >= (first->>'server_now')::timestamptz FROM public.conversations WHERE id = parent_id),
   'new claim advances parent activity and row version');
 SELECT created_at INTO next_time FROM public.chat_messages WHERE id = (second->>'user_message_id')::uuid;
 PERFORM pg_temp.assert_true(assistant_time < next_time AND next_time < (second#>>'{assistant,created_at}')::timestamptz,
   'same-transaction next pair follows previous assistant');
 PERFORM pg_temp.assert_true((SELECT count(DISTINCT created_at) = 4 FROM public.chat_messages WHERE conversation_id = parent_id),
   'same-transaction pair timestamps remain distinct');
 PERFORM pg_temp.assert_true(public.claim_research_turn(owner_id,'ordered-first',repeat('1',64),NULL,'Ordering','fake')#>>'{assistant,created_at}' = first#>>'{assistant,created_at}',
   'replay preserves original reserved timestamp');
 INSERT INTO public.chat_messages(conversation_id,user_id,role,content,created_at)
   VALUES(parent_id,owner_id,'user','Prior future timestamp',future_time);
 third := public.claim_research_turn(owner_id,'ordered-future',repeat('3',64),parent_id,'Ordering after future data','fake');
 SELECT created_at INTO user_time FROM public.chat_messages WHERE id = (third->>'user_message_id')::uuid;
 PERFORM pg_temp.assert_true(future_time < user_time AND user_time < (third#>>'{assistant,created_at}')::timestamptz,
   'new pair follows prior future timestamp');
 PERFORM pg_temp.assert_true((third#>>'{assistant,execution_expires_at}')::timestamptz - clock_timestamp()
   BETWEEN interval '119 seconds' AND interval '120 seconds', 'future message chronology never extends real execution deadline');
 PERFORM pg_temp.assert_true((SELECT created_at = future_time FROM public.chat_messages WHERE conversation_id = parent_id AND content = 'Prior future timestamp'),
   'existing timestamps remain unchanged');
 INSERT INTO public.chat_messages(conversation_id,user_id,role,content,created_at)
   VALUES(parent_id,owner_id,'user','Unorderable prior timestamp','infinity');
 PERFORM pg_temp.rejected(format('SELECT public.claim_research_turn(%L,''ordered-infinity'',repeat(''4'',64),%L,''Ordering'',''fake'')',owner_id,parent_id),
   '22023', 'nonfinite prior timestamp rejects rather than creating tied chronology');
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT FROM public.research_turns WHERE user_id = owner_id AND turn_key = 'ordered-infinity'),
   'unorderable claim rolls back without consuming key');
END; $$;
RESET ROLE;

SET LOCAL ROLE service_role;
DO $$
DECLARE
 a uuid := '00000000-0000-4000-8000-000000000031'; b uuid := '00000000-0000-4000-8000-000000000032';
 own uuid := '10000000-0000-4000-8000-000000000031'; foreign_parent uuid := '10000000-0000-4000-8000-000000000032';
 first jsonb; replay jsonb; second jsonb; saved jsonb; deleted jsonb; original_count bigint;
 status_value text;
 terminal jsonb := '{"status":"complete","content":"Original answer","sources":[],"follow_ups":["Next?"],"activity":[],"model_served":"fake","error_message":null,"usage":{"total_tokens":3},"timing":null}';
BEGIN
  SELECT count(*) INTO original_count FROM public.conversations;
  first := public.claim_research_turn(a,'new-turn',repeat('a',64),NULL,'Question','fake');
  PERFORM pg_temp.assert_true(first->>'kind' = 'claimed', 'new key wins claim');
  PERFORM pg_temp.assert_true(first#>>'{assistant,status}' = 'running', 'running assistant reserved before execution');
  PERFORM pg_temp.assert_true((first#>>'{assistant,execution_expires_at}')::timestamptz - (first->>'server_now')::timestamptz BETWEEN interval '119 seconds' AND interval '120 seconds', 'database sets fixed 120 second deadline');
  PERFORM pg_temp.assert_true((SELECT count(*) = 2 FROM public.chat_messages WHERE conversation_id = (first#>>'{conversation,id}')::uuid), 'one user and one assistant reserved');
  replay := public.claim_research_turn(a,'new-turn',repeat('a',64),NULL,'Question','changed-default');
  PERFORM pg_temp.assert_true(replay->>'kind' = 'running' AND replay#>>'{assistant,id}' = first#>>'{assistant,id}', 'omitted-parent duplicate returns original reservation');
  PERFORM pg_temp.assert_true(NOT replay ? 'execution_token', 'loser never receives execution token');
  PERFORM pg_temp.assert_true((SELECT count(*) = original_count + 1 FROM public.conversations), 'duplicate creates no extra conversation');
  PERFORM pg_temp.assert_true(public.lookup_research_turn(a,'new-turn',repeat('b',64))->>'kind' = 'conflict', 'changed payload conflicts');
  PERFORM pg_temp.assert_true(public.lookup_research_turn(a,'new-turn',repeat('a',64),own)->>'kind' = 'conflict', 'changed parent conflicts');
  PERFORM pg_temp.assert_true(public.lookup_research_turn(a,'new-turn',repeat('a',64),(first#>>'{conversation,id}')::uuid)->>'kind' = 'running', 'retry may supply originally returned parent');
  second := public.claim_research_turn(b,'new-turn',repeat('a',64),NULL,'Other user','fake');
  PERFORM pg_temp.assert_true(second->>'kind' = 'claimed' AND second#>>'{assistant,id}' <> first#>>'{assistant,id}', 'same key in second account has independent claim');
  PERFORM pg_temp.assert_true(public.finalize_research_turn(a,'new-turn',(second->>'execution_token')::uuid,terminal)->>'kind' = 'forbidden', 'other execution token cannot finalize');
  PERFORM pg_temp.assert_true(public.finalize_research_turn(b,'new-turn',(first->>'execution_token')::uuid,terminal)->>'kind' = 'forbidden', 'owner and token both required');
  saved := public.finalize_research_turn(a,'new-turn',(first->>'execution_token')::uuid,terminal);
  PERFORM pg_temp.assert_true(saved#>>'{assistant,status}' = 'complete' AND saved#>>'{assistant,content}' = 'Original answer', 'finalize updates reserved result');
  replay := public.finalize_research_turn(a,'new-turn',(first->>'execution_token')::uuid,terminal || '{"content":"Overwrite","status":"error"}'::jsonb);
  PERFORM pg_temp.assert_true(replay->'assistant' = saved->'assistant', 'repeated finalize cannot overwrite terminal result');
  PERFORM pg_temp.assert_true(public.lookup_research_turn(a,'new-turn',repeat('a',64))->'assistant' = saved->'assistant', 'terminal replay returns complete original result');
  FOREACH status_value IN ARRAY ARRAY['error','cancelled','truncated','interrupted'] LOOP
    second := public.claim_research_turn(a,'terminal-' || status_value,repeat('d',64),own,'Question','fake');
    replay := public.finalize_research_turn(a,'terminal-' || status_value,(second->>'execution_token')::uuid,terminal || jsonb_build_object('status',status_value,'content','Partial ' || status_value));
    PERFORM pg_temp.assert_true(replay#>>'{assistant,status}' = status_value AND replay#>>'{assistant,id}' = second#>>'{assistant,id}', 'reserved row finalizes as ' || status_value);
    PERFORM pg_temp.assert_true(public.lookup_research_turn(a,'terminal-' || status_value,repeat('d',64))->'assistant' = replay->'assistant', status_value || ' replays exact terminal row');
  END LOOP;
  second := public.claim_research_turn(b,'new-turn',repeat('a',64),NULL,'Other user','fake');
  PERFORM pg_temp.rejected(format('UPDATE public.chat_messages SET content = %L WHERE id = %L','Overwrite',first#>>'{assistant,id}'),'23514','direct service update cannot overwrite terminal assistant');
  PERFORM pg_temp.rejected(format('UPDATE public.research_turns SET assistant_message_id = NULL WHERE user_id = %L AND turn_key = ''new-turn''',a),'23514','live result cannot be unlinked to evade immutability');
  PERFORM pg_temp.rejected(format('UPDATE public.research_turns SET request_hash = repeat(''f'',64) WHERE user_id = %L AND turn_key = ''new-turn''',a),'23514','claim payload is immutable');
  PERFORM pg_temp.rejected(format('UPDATE public.research_turns SET user_id = %L WHERE user_id = %L AND turn_key = ''new-turn''',b,a),'23514','claim owner is immutable');
  PERFORM pg_temp.rejected(format('SELECT public.claim_research_turn(%L,''foreign'',repeat(''a'',64),%L,''Question'',''fake'')',a,foreign_parent),'P0002','foreign parent rejected');
  PERFORM pg_temp.rejected(format('SELECT public.claim_research_turn(%L,''missing'',repeat(''a'',64),%L,''Question'',''fake'')',a,'10000000-0000-4000-8000-000000000099'),'P0002','missing parent rejected');
  PERFORM pg_temp.assert_true(NOT EXISTS (SELECT FROM public.research_turns WHERE turn_key IN ('foreign','missing')), 'failed parent validation rolls back claims');
  PERFORM pg_temp.rejected(format('INSERT INTO public.research_turns(user_id,turn_key,request_hash,conversation_id,user_message_id,assistant_message_id) VALUES(%L,''wrong-child'',repeat(''a'',64),%L,%L,%L)',a,first#>>'{conversation,id}',second->>'user_message_id',first#>>'{assistant,id}'),'23514','claim cannot bind another owner user message');
  INSERT INTO public.chat_messages(conversation_id,user_id,role,content,turn_key) VALUES(own,a,'user','Legacy question','legacy');
  PERFORM pg_temp.rejected(format('SELECT public.claim_research_turn(%L,''legacy'',repeat(''a'',64),NULL,''Question'',''fake'')',a),'23505','legacy key is not silently adopted or rerun');
  PERFORM pg_temp.rejected(format('SELECT public.claim_research_turn(%L,%L,repeat(''a'',64),NULL,''Question'',''fake'')',a,repeat('k',65)),'23514','oversized DB key rejected');
  -- Deleting only an assistant must retain the key and suppress provider restart.
  DELETE FROM public.chat_messages WHERE id = (second#>>'{assistant,id}')::uuid;
  deleted := public.lookup_research_turn(b,'new-turn',repeat('a',64));
  PERFORM pg_temp.assert_true(deleted->>'kind' = 'deleted', 'deleted assistant leaves tombstone');
  PERFORM pg_temp.assert_true(public.claim_research_turn(b,'new-turn',repeat('a',64),NULL,'Other user','fake')->>'kind' = 'deleted', 'deleted assistant cannot be claimed again');
  PERFORM pg_temp.assert_true(EXISTS (SELECT FROM public.research_turns WHERE user_id = b AND turn_key = 'new-turn'), 'message deletion preserves owner and key');
  PERFORM pg_temp.rejected(format('UPDATE public.research_turns SET assistant_message_id = %L WHERE user_id = %L AND turn_key = ''new-turn''',first#>>'{assistant,id}',b),'23514','tombstone cannot adopt another result');
END; $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000031';
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.chat_messages WHERE user_id = '00000000-0000-4000-8000-000000000032'), 'other owner results are hidden by RLS');
SELECT pg_temp.assert_true((SELECT count(*) > 0 FROM public.chat_messages WHERE user_id = auth.uid()), 'own results remain readable through B2 RLS');
RESET ROLE;

-- Real authenticated conversation deletion cascades messages, not the durable key.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000031';
DELETE FROM public.conversations WHERE title = 'Question';
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(public.lookup_research_turn('00000000-0000-4000-8000-000000000031','new-turn',repeat('a',64))->>'kind' = 'deleted', 'owner conversation deletion leaves consumed-key tombstone');
SELECT pg_temp.assert_true(EXISTS(SELECT FROM public.research_turns WHERE user_id = '00000000-0000-4000-8000-000000000031' AND turn_key = 'new-turn'), 'conversation deletion never deletes owner/key');
RESET ROLE;

-- Expiry fixtures advance stored deadline as DB owner with just the immutability
-- trigger disabled locally. No test sleeps and no live runtime clock changes.
CREATE TEMP TABLE deadlines AS SELECT public.claim_research_turn('00000000-0000-4000-8000-000000000031','expired',repeat('c',64),NULL,'Expired','fake') AS claim;
ALTER TABLE public.chat_messages DISABLE TRIGGER research_result_immutable;
UPDATE public.chat_messages SET execution_expires_at = clock_timestamp() - interval '1 second' WHERE id = ((SELECT claim FROM deadlines)#>>'{assistant,id}')::uuid;
ALTER TABLE public.chat_messages ENABLE TRIGGER research_result_immutable;
SELECT pg_temp.assert_true(public.finalize_research_turn('00000000-0000-4000-8000-000000000031','expired',((SELECT claim FROM deadlines)->>'execution_token')::uuid,
 '{"status":"complete","content":"Too late","sources":[],"follow_ups":[],"activity":[]}')->'assistant'->>'status' = 'interrupted', 'late finalize becomes interrupted');
SELECT pg_temp.assert_true(public.lookup_research_turn('00000000-0000-4000-8000-000000000031','expired',repeat('c',64))->'assistant'->>'content' = '', 'late result cannot replace interrupted content');
CREATE TEMP TABLE lazy_deadlines AS SELECT public.claim_research_turn('00000000-0000-4000-8000-000000000031','lazy-expired',repeat('e',64),NULL,'Expired','fake') AS claim;
ALTER TABLE public.chat_messages DISABLE TRIGGER research_result_immutable;
UPDATE public.chat_messages SET execution_expires_at = clock_timestamp() - interval '1 second' WHERE id = ((SELECT claim FROM lazy_deadlines)#>>'{assistant,id}')::uuid;
ALTER TABLE public.chat_messages ENABLE TRIGGER research_result_immutable;
SELECT pg_temp.assert_true(public.lookup_research_turn('00000000-0000-4000-8000-000000000031','lazy-expired',repeat('e',64))->'assistant'->>'status' = 'interrupted', 'reload lookup materializes expired running state without restart');
UPDATE public.user_profiles SET status = 'suspended' WHERE user_id = '00000000-0000-4000-8000-000000000032';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(public.claim_research_turn('00000000-0000-4000-8000-000000000032','suspended',repeat('a',64),NULL,'Question','fake')->>'kind' = 'forbidden', 'suspended owner cannot claim');
RESET ROLE;
ROLLBACK;
