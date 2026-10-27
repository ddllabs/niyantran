-- Disposable fixture. Guard: 20261027175415_admin_persona_prompts.sql.
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(v boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; END; $$;
CREATE FUNCTION pg_temp.rejected(q text, code text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE q; EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE=code THEN RETURN; END IF;
    RAISE EXCEPTION 'unexpected %: %',SQLSTATE,SQLERRM;
  END;
  RAISE EXCEPTION 'statement unexpectedly accepted: %',q;
END; $$;
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated','public.persona_admin(uuid,text,text,text,integer,uuid,jsonb)','EXECUTE'),'no browser RPC grant');
SELECT pg_temp.assert_true(NOT has_table_privilege('authenticated','public.persona_prompt_revisions','SELECT'),'no browser prompt reads');
SELECT pg_temp.assert_true(NOT has_table_privilege('service_role','public.persona_prompt_revisions','UPDATE'),'immutable revisions');
SELECT pg_temp.assert_true(NOT has_table_privilege('service_role','public.persona_prompt_events','DELETE'),'immutable audit');
INSERT INTO auth.users(id,email) VALUES
 ('00000000-0000-4000-8000-000000000001','pilot@example.test'),
 ('00000000-0000-4000-8000-000000000002','other@example.test');
UPDATE public.user_profiles SET role='admin',status='active';
SELECT pg_temp.assert_true(NOT public.persona_pilot_access('00000000-0000-4000-8000-000000000001'),'disabled by default');
UPDATE public.persona_pilot_settings SET enabled=true,owner_id='00000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(public.persona_pilot_access('00000000-0000-4000-8000-000000000001'),'pilot allowed');
SELECT pg_temp.assert_true(NOT public.persona_pilot_access('00000000-0000-4000-8000-000000000002'),'other admin excluded');
SELECT pg_temp.rejected($q$select public.persona_admin('00000000-0000-4000-8000-000000000002','read')$q$,'42501');
SELECT public.persona_admin('00000000-0000-4000-8000-000000000001','initialize',p_baselines := '{"policy_analyst":"base","journalist":"base","upsc_aspirant":"base","corporate_affairs":"base","legal_researcher":"base","academic":"base"}');
SELECT public.persona_admin('00000000-0000-4000-8000-000000000001','save','academic',E'  Exact\nπ\n ',1);
SELECT pg_temp.assert_true((public.persona_admin('00000000-0000-4000-8000-000000000001','active','academic')->>'text')='base','save does not publish');
SELECT pg_temp.rejected($q$select public.persona_admin('00000000-0000-4000-8000-000000000001','save','academic','stale',1)$q$,'40001');
SELECT public.persona_admin('00000000-0000-4000-8000-000000000001','publish','academic',null,2);
SELECT pg_temp.assert_true((public.persona_admin('00000000-0000-4000-8000-000000000001','active','academic')->>'text')=E'  Exact\nπ\n ','exact active bytes');
SELECT public.persona_admin('00000000-0000-4000-8000-000000000001','rollback','academic',null,3,
 (select revision_id from public.persona_prompt_events where persona='academic' and action='initialize'));
SELECT pg_temp.assert_true((public.persona_admin('00000000-0000-4000-8000-000000000001','active','academic')->>'text')='base','rollback restores baseline');
SELECT pg_temp.rejected($q$select public.persona_admin('00000000-0000-4000-8000-000000000001','save','academic','   ',4)$q$,'23514');
RESET ROLE;
UPDATE public.persona_pilot_settings SET enabled=false;
SELECT pg_temp.assert_true(NOT public.persona_pilot_access('00000000-0000-4000-8000-000000000001'),'kill switch');
UPDATE public.persona_pilot_settings SET enabled=true;
UPDATE public.user_profiles SET status='suspended' where user_id='00000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true(NOT public.persona_pilot_access('00000000-0000-4000-8000-000000000001'),'revoked admin cannot use pilot');
ROLLBACK;
