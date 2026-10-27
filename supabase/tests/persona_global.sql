-- Disposable fixture. Guard: 20261027192031_persona_global_rollout.sql.
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(v boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; END; $$;
CREATE FUNCTION pg_temp.rejected(q text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE q; EXCEPTION WHEN insufficient_privilege THEN RETURN; END;
  RAISE EXCEPTION 'unexpectedly accepted: %',q;
END; $$;
INSERT INTO auth.users(id,email) VALUES
 ('00000000-0000-4000-8000-000000000001','owner@example.test'),
 ('00000000-0000-4000-8000-000000000002','admin@example.test'),
 ('00000000-0000-4000-8000-000000000003','reader@example.test');
UPDATE public.user_profiles SET status='active',persona='academic';
UPDATE public.user_profiles SET role='admin' WHERE user_id IN
 ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');
UPDATE public.persona_pilot_settings SET enabled=true,owner_id='00000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true(NOT (SELECT global_enabled FROM public.persona_pilot_settings),'global starts disabled');
SELECT pg_temp.assert_true(NOT public.persona_published_access('00000000-0000-4000-8000-000000000003'),'reader excluded before rollout');
SELECT pg_temp.assert_true(public.persona_published_access('00000000-0000-4000-8000-000000000001'),'pilot continues');
SET LOCAL ROLE service_role;
SELECT public.persona_admin('00000000-0000-4000-8000-000000000002','initialize',p_baselines := '{"policy_analyst":"base","journalist":"base","upsc_aspirant":"base","corporate_affairs":"base","legal_researcher":"base","academic":"base"}');
SELECT public.persona_admin('00000000-0000-4000-8000-000000000002','save','academic',E'  Published\nπ\n ',1);
SELECT public.persona_admin('00000000-0000-4000-8000-000000000002','publish','academic',null,2);
SELECT pg_temp.assert_true((SELECT count(*) FROM public.persona_prompt_events WHERE actor_id='00000000-0000-4000-8000-000000000002')=8,'other admin audited');
SELECT pg_temp.rejected($q$SELECT public.persona_admin('00000000-0000-4000-8000-000000000003','read')$q$);
SELECT pg_temp.rejected($q$SELECT public.persona_admin('00000000-0000-4000-8000-000000000003','publish','academic',null,3)$q$);
RESET ROLE;
UPDATE public.persona_pilot_settings SET global_enabled=true;
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(public.persona_published_access('00000000-0000-4000-8000-000000000003'),'global active reader');
SELECT pg_temp.assert_true(NOT public.persona_admin_access('00000000-0000-4000-8000-000000000003'),'reader cannot edit');
SELECT pg_temp.assert_true(public.persona_active('00000000-0000-4000-8000-000000000003','academic')->>'text'=E'  Published\nπ\n ','reader exact published bytes');
SELECT pg_temp.rejected($q$SELECT public.persona_active('00000000-0000-4000-8000-000000000003','journalist')$q$);
SELECT pg_temp.assert_true(public.persona_active('00000000-0000-4000-8000-000000000002','journalist')->>'text'='base','admin probe');
SELECT public.persona_admin('00000000-0000-4000-8000-000000000002','rollback','academic',null,3,
 (SELECT revision_id FROM public.persona_prompt_events WHERE persona='academic' AND action='initialize'));
RESET ROLE;
UPDATE public.user_profiles SET persona=null WHERE user_id='00000000-0000-4000-8000-000000000003';
SELECT pg_temp.assert_true(public.persona_active('00000000-0000-4000-8000-000000000003','corporate_affairs')->>'text'='base','unselected persona default');
UPDATE public.user_profiles SET status='suspended' WHERE user_id='00000000-0000-4000-8000-000000000003';
SELECT pg_temp.assert_true(NOT public.persona_published_access('00000000-0000-4000-8000-000000000003'),'inactive reader denied');
SELECT pg_temp.rejected($q$SELECT public.persona_active('00000000-0000-4000-8000-000000000003','corporate_affairs')$q$);
UPDATE public.persona_pilot_settings SET enabled=false;
SELECT pg_temp.assert_true(NOT public.persona_published_access('00000000-0000-4000-8000-000000000001'),'kill switch denies consumption');
SELECT pg_temp.assert_true(public.persona_admin_access('00000000-0000-4000-8000-000000000002'),'management survives consumption pause');
SELECT public.persona_admin('00000000-0000-4000-8000-000000000002','read');
UPDATE public.persona_pilot_settings SET enabled=true,global_enabled=false;
SELECT pg_temp.assert_true(public.persona_published_access('00000000-0000-4000-8000-000000000001'),'rollback owner remains');
SELECT pg_temp.assert_true(NOT public.persona_published_access('00000000-0000-4000-8000-000000000002'),'rollback excludes other admin consumer');
UPDATE public.user_profiles SET status='suspended' WHERE user_id='00000000-0000-4000-8000-000000000002';
SELECT pg_temp.rejected($q$SELECT public.persona_admin('00000000-0000-4000-8000-000000000002','read')$q$);
SET LOCAL ROLE authenticated;
SELECT pg_temp.rejected($q$SELECT * FROM public.persona_prompt_revisions$q$);
SELECT pg_temp.rejected($q$SELECT * FROM public.persona_prompt_states$q$);
SELECT pg_temp.rejected($q$SELECT public.persona_admin_access('00000000-0000-4000-8000-000000000001')$q$);
SELECT pg_temp.rejected($q$SELECT public.persona_published_access('00000000-0000-4000-8000-000000000001')$q$);
SELECT pg_temp.rejected($q$SELECT public.persona_active('00000000-0000-4000-8000-000000000001','academic')$q$);
SELECT pg_temp.rejected($q$SELECT public.persona_admin('00000000-0000-4000-8000-000000000001','read')$q$);
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.rejected($q$SELECT * FROM public.persona_prompt_states$q$);
SELECT pg_temp.rejected($q$SELECT public.persona_active('00000000-0000-4000-8000-000000000001','academic')$q$);
SELECT pg_temp.rejected($q$SELECT public.persona_admin('00000000-0000-4000-8000-000000000001','read')$q$);
RESET ROLE;
ROLLBACK;
