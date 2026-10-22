-- Chat-only deadline fixture, disposable database; causal baseline omits new migration.
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
INSERT INTO auth.users(id,email) VALUES ('00000000-0000-4000-8000-000000000091','deadline@example.invalid');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.claim_research_turn(uuid,text,text,uuid,text,text,text,text,text)','EXECUTE'), 'anon cannot claim');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated','public.claim_research_turn(uuid,text,text,uuid,text,text,text,text,text)','EXECUTE'), 'authenticated cannot claim');
SELECT pg_temp.assert_true(has_function_privilege('service_role','public.claim_research_turn(uuid,text,text,uuid,text,text,text,text,text)','EXECUTE'), 'service may claim');
SELECT pg_temp.assert_true(NOT prosecdef, 'claim remains invoker security') FROM pg_proc WHERE oid='public.claim_research_turn(uuid,text,text,uuid,text,text,text,text,text)'::regprocedure;
SET LOCAL ROLE service_role;
DO $$
DECLARE owner_id uuid := '00000000-0000-4000-8000-000000000091'; first jsonb; replay jsonb; saved jsonb;
BEGIN
 first := public.claim_research_turn(owner_id,'long-answer',repeat('a',64),NULL,'Question','deepseek');
 PERFORM pg_temp.assert_true(first->>'kind'='claimed','claim created');
 PERFORM pg_temp.assert_true((first#>>'{assistant,execution_expires_at}')::timestamptz - (first->>'server_now')::timestamptz BETWEEN interval '299 seconds' AND interval '300 seconds','new claim receives bounded300s lease');
 replay := public.claim_research_turn(owner_id,'long-answer',repeat('a',64),NULL,'Question','deepseek');
 PERFORM pg_temp.assert_true(replay->>'kind'='running','duplicate claim replays running turn');
 PERFORM pg_temp.assert_true(replay#>>'{assistant,execution_expires_at}'=first#>>'{assistant,execution_expires_at}','replay never extends lease');
 PERFORM pg_temp.assert_true(replay#>>'{assistant,id}'=first#>>'{assistant,id}','replay uses same assistant');
 saved := public.finalize_research_turn(owner_id,'long-answer',(first->>'execution_token')::uuid,jsonb_build_object('status','complete','content','Answer','sources','[]'::jsonb,'follow_ups','[]'::jsonb,'activity','[]'::jsonb,'model_served','deepseek'));
 PERFORM pg_temp.assert_true(saved#>>'{assistant,status}'='complete','terminal answer saved');
 saved := public.finalize_research_turn(owner_id,'long-answer',(first->>'execution_token')::uuid,jsonb_build_object('status','error','content','Late overwrite','sources','[]'::jsonb,'follow_ups','[]'::jsonb,'activity','[]'::jsonb));
 PERFORM pg_temp.assert_true(saved#>>'{assistant,content}'='Answer','second finalization cannot overwrite');
END $$;
RESET ROLE;
-- Simulate a legacy shorter lease and an expired orphan without sleeping. This is
-- fixture-only privileged setup; production never edits existing turn deadlines.
CREATE TEMP TABLE deadlines AS SELECT public.claim_research_turn('00000000-0000-4000-8000-000000000091','legacy',repeat('b',64),NULL,'Question','deepseek') AS claim;
ALTER TABLE public.chat_messages DISABLE TRIGGER research_result_immutable;
UPDATE public.chat_messages SET execution_expires_at=clock_timestamp()+interval '110 seconds' WHERE id=((SELECT claim FROM deadlines)#>>'{assistant,id}')::uuid;
ALTER TABLE public.chat_messages ENABLE TRIGGER research_result_immutable;
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true((public.lookup_research_turn('00000000-0000-4000-8000-000000000091','legacy',repeat('b',64),NULL)#>>'{assistant,execution_expires_at}')::timestamptz-clock_timestamp() BETWEEN interval '109 seconds' AND interval '110 seconds','legacy shorter lease remains intact');
RESET ROLE;
ALTER TABLE public.chat_messages DISABLE TRIGGER research_result_immutable;
UPDATE public.chat_messages SET execution_expires_at=clock_timestamp()-interval '1 second' WHERE id=((SELECT claim FROM deadlines)#>>'{assistant,id}')::uuid;
ALTER TABLE public.chat_messages ENABLE TRIGGER research_result_immutable;
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(public.lookup_research_turn('00000000-0000-4000-8000-000000000091','legacy',repeat('b',64),NULL)#>>'{assistant,status}'='interrupted','expired orphan still recovers');
RESET ROLE;
-- Claims use a durable chronology, not transaction-scoped now(). These calls
-- deliberately share one transaction; existing future timestamps must also win
-- over wall time without moving the execution deadline into the future.
SET LOCAL ROLE service_role;
DO $$
DECLARE
 owner_id uuid := '00000000-0000-4000-8000-000000000091';
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
   BETWEEN interval '299 seconds' AND interval '300 seconds', 'future message chronology never extends real execution deadline');
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

ROLLBACK;
