-- Database advisor fixes (migration 20261015190000; open-work P12): twelve RLS policies with
-- auth.uid() evaluated once per statement, and eight foreign keys given covering indexes.
-- PostgreSQL assertions, no pgTAP. Run only in a disposable database, through run.sh.
-- Bootstrap: the least_privilege chain plus research_turn_persistence, then every migration that
-- creates a table the advisor flagged (invoices, plan_entitlements, ingestion_v2's chain,
-- ai_credits' chain), then 20261015190000_rls_initplan_fk_indexes.sql, applied as a non-superuser.
-- The vacuity check drops the last: the policies then call auth.uid() bare and the indexes are
-- missing, so the first assertion fails.
--
-- 1. Each of the twelve policies wraps every auth.uid() as ( SELECT auth.uid() AS uid), has no bare
--    auth.*() or current_setting() call left, and apart from the wrapping reads exactly as before
--    (same command, roles, permissiveness, USING and WITH CHECK).
-- 2. Each of the eight foreign keys has the named index, a plain btree whose leading columns are
--    the key's columns in the key's order.
-- 3. Ownership still holds, as role authenticated with request.jwt.claims for user A: A sees and
--    changes A's rows and not B's, and cannot write a row carrying B's user_id; the
--    is_platform_admin() branch still lets an admin read other users' rows.
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

-- 1. Policies -----------------------------------------------------------------------------------

CREATE TEMP TABLE expected_policies (tablename name, policyname name, cmd text, qual text, with_check text);
INSERT INTO expected_policies VALUES
  ('user_profiles', 'Users can view own profile', 'SELECT',
   '((user_id = auth.uid()) OR is_platform_admin())', null),
  ('user_profiles', 'Users can update own profile', 'UPDATE',
   '((user_id = auth.uid()) OR is_platform_admin())', '((user_id = auth.uid()) OR is_platform_admin())'),
  ('conversations', 'conversations_select', 'SELECT', '(user_id = auth.uid())', null),
  ('conversations', 'conversations_insert', 'INSERT', null, '(user_id = auth.uid())'),
  ('conversations', 'conversations_update', 'UPDATE', '(user_id = auth.uid())', '(user_id = auth.uid())'),
  ('conversations', 'conversations_delete', 'DELETE', '(user_id = auth.uid())', null),
  ('user_roles', 'Users can view roles', 'SELECT',
   '(is_platform_admin() OR (user_id = auth.uid()) OR ((organisation_id IS NOT NULL) AND is_org_member(organisation_id)))', null),
  ('privacy_policy_consents', 'Users can view own consent', 'SELECT',
   '((user_id = auth.uid()) OR is_platform_admin())', null),
  ('privacy_policy_consents', 'Users can create own consent', 'INSERT', null, '(user_id = auth.uid())'),
  ('model_call_logs', 'model_call_logs_own', 'SELECT', '(user_id = auth.uid())', null),
  ('chat_turn_traces', 'chat_turn_traces_own', 'SELECT', '(user_id = auth.uid())', null),
  ('invoices', 'Owners and admins read invoices', 'SELECT',
   '((user_id = auth.uid()) OR is_platform_admin())', null);

DO $$
DECLARE
  e record;
  p record;
  expr text;
BEGIN
  FOR e IN SELECT * FROM expected_policies LOOP
    SELECT * INTO p FROM pg_catalog.pg_policies
     WHERE schemaname = 'public' AND tablename = e.tablename AND policyname = e.policyname;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'FAIL: policy % on % is missing', e.policyname, e.tablename;
    END IF;
    -- Every expression the policy has wraps auth.uid(), and nothing else of auth.* or
    -- current_setting() is called per row.
    FOREACH expr IN ARRAY array_remove(ARRAY[p.qual, p.with_check], NULL) LOOP
      IF position('( SELECT auth.uid() AS uid)' IN expr) = 0 THEN
        RAISE EXCEPTION 'FAIL: % on %: auth.uid() is not wrapped in %', e.policyname, e.tablename, expr;
      END IF;
      IF replace(expr, '( SELECT auth.uid() AS uid)', '') ~ '(auth\.[a-z_]+\(|current_setting\()' THEN
        RAISE EXCEPTION 'FAIL: % on %: a bare per-row call is left in %', e.policyname, e.tablename, expr;
      END IF;
    END LOOP;
    -- Apart from the wrapping, the policy is exactly the one it replaced.
    IF p.cmd IS DISTINCT FROM e.cmd OR p.roles IS DISTINCT FROM ARRAY['authenticated']::name[]
       OR p.permissive IS DISTINCT FROM 'PERMISSIVE'
       OR replace(replace(p.qual, '( SELECT auth.uid() AS uid)', 'auth.uid()'), 'public.', '') IS DISTINCT FROM e.qual
       OR replace(replace(p.with_check, '( SELECT auth.uid() AS uid)', 'auth.uid()'), 'public.', '') IS DISTINCT FROM e.with_check THEN
      RAISE EXCEPTION 'FAIL: % on % changed beyond the wrapping: % % % using % with check %',
        e.policyname, e.tablename, p.cmd, p.roles, p.permissive, p.qual, p.with_check;
    END IF;
    RAISE NOTICE 'PASS: % on % wraps auth.uid() and is otherwise unchanged', e.policyname, e.tablename;
  END LOOP;
END;
$$;

SELECT pg_temp.assert_true((SELECT count(*) = 12 FROM pg_catalog.pg_policies p JOIN expected_policies e
  USING (tablename, policyname) WHERE p.schemaname = 'public'), 'all twelve policies checked');

-- 2. Foreign-key indexes ------------------------------------------------------------------------

CREATE TEMP TABLE expected_indexes (fk name, index_name name);
INSERT INTO expected_indexes VALUES
  ('ai_roles_model_id_fkey', 'ai_roles_model_id_idx'),
  ('chat_cancellations_conversation_owner_fkey', 'chat_cancellations_conversation_owner_idx'),
  ('chat_messages_conversation_owner_fkey', 'chat_messages_conversation_owner_idx'),
  ('chat_turn_traces_model_call_log_id_fkey', 'chat_turn_traces_model_call_log_id_idx'),
  ('credit_settings_updated_by_fkey', 'credit_settings_updated_by_idx'),
  ('ingest_jobs_requested_by_fkey', 'ingest_jobs_requested_by_idx'),
  ('plan_grants_granted_by_fkey', 'plan_grants_granted_by_idx'),
  ('research_turns_conversation_id_user_id_fkey', 'research_turns_conversation_owner_idx');

DO $$
DECLARE
  e record;
  c record;
  i record;
BEGIN
  FOR e IN SELECT * FROM expected_indexes LOOP
    SELECT con.conrelid, con.conkey INTO c FROM pg_catalog.pg_constraint con
     WHERE con.contype = 'f' AND con.connamespace = 'public'::regnamespace AND con.conname = e.fk;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'FAIL: foreign key % is missing', e.fk;
    END IF;
    SELECT ix.indrelid, string_to_array(ix.indkey::text, ' ')::int2[] AS cols, ix.indpred, ix.indexprs, am.amname
      INTO i
      FROM pg_catalog.pg_index ix
      JOIN pg_catalog.pg_class ic ON ic.oid = ix.indexrelid
      JOIN pg_catalog.pg_am am ON am.oid = ic.relam
     WHERE ic.relnamespace = 'public'::regnamespace AND ic.relname = e.index_name;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'FAIL: index % for % is missing', e.index_name, e.fk;
    END IF;
    IF i.indrelid <> c.conrelid OR i.amname <> 'btree' OR i.indpred IS NOT NULL OR i.indexprs IS NOT NULL
       OR i.cols[1:cardinality(c.conkey)] IS DISTINCT FROM c.conkey THEN
      RAISE EXCEPTION 'FAIL: index % does not cover % (index columns %, key columns %)',
        e.index_name, e.fk, i.cols, c.conkey;
    END IF;
    RAISE NOTICE 'PASS: % covers % (columns %)', e.index_name, e.fk, c.conkey;
  END LOOP;
END;
$$;

-- The advisor's own test: no foreign key in public lacks an index led by its columns, for the
-- eight keys above.
SELECT pg_temp.assert_true(NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_constraint con JOIN expected_indexes e ON e.fk = con.conname
   WHERE con.contype = 'f' AND con.connamespace = 'public'::regnamespace
     AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_index ix WHERE ix.indrelid = con.conrelid
       AND (string_to_array(ix.indkey::text, ' ')::int2[])[1:cardinality(con.conkey)] = con.conkey)),
  'every flagged foreign key has an index led by its columns');

-- 3. Ownership ----------------------------------------------------------------------------------

-- A and B are ordinary users; C is an active platform admin. The auth.users trigger creates their
-- profiles.
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'p12.a@example.invalid'),
  ('00000000-0000-4000-8000-0000000000b1', 'p12.b@example.invalid'),
  ('00000000-0000-4000-8000-0000000000c1', 'p12.c@example.invalid');
UPDATE public.user_profiles SET role = 'admin' WHERE user_id = '00000000-0000-4000-8000-0000000000c1';
INSERT INTO public.conversations (id, user_id, title) VALUES
  ('10000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a1', 'A'),
  ('10000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b1', 'B');
INSERT INTO public.privacy_policy_consents (user_id, policy_version) VALUES
  ('00000000-0000-4000-8000-0000000000b1', 'p12-b');
INSERT INTO public.user_roles (user_id) VALUES
  ('00000000-0000-4000-8000-0000000000a1'), ('00000000-0000-4000-8000-0000000000b1');
INSERT INTO public.model_call_logs (user_id, caller, purpose, status) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'research-chat', 'chat_answer', 'success'),
  ('00000000-0000-4000-8000-0000000000b1', 'research-chat', 'chat_answer', 'success');
INSERT INTO public.chat_turn_traces (user_id, message_id, step_index, step_type) VALUES
  ('00000000-0000-4000-8000-0000000000a1', gen_random_uuid(), 0, 'answer'),
  ('00000000-0000-4000-8000-0000000000b1', gen_random_uuid(), 0, 'answer');
INSERT INTO public.invoices (id, invoice_no, financial_year, seq, user_id, user_email, plan_id, taxable, total, provider) VALUES
  ('inv_p12_a', 'P12/A', '2026', 9001, '00000000-0000-4000-8000-0000000000a1', 'p12.a@example.invalid', 'plus', 1, 1, 'demo'),
  ('inv_p12_b', 'P12/B', '2026', 9002, '00000000-0000-4000-8000-0000000000b1', 'p12.b@example.invalid', 'plus', 1, 1, 'demo');
-- Clients have no grant on the two telemetry tables (least privilege); grant SELECT inside this
-- transaction only, so their row policies are exercised.
GRANT SELECT ON public.model_call_logs, public.chat_turn_traces TO authenticated;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000a1", "role": "authenticated"}';
SELECT pg_temp.assert_true(auth.uid() = '00000000-0000-4000-8000-0000000000a1', 'claims identify A');

-- conversations: all four commands.
SELECT pg_temp.assert_true((SELECT array_agg(id) = ARRAY['10000000-0000-4000-8000-0000000000a1'::uuid]
  FROM public.conversations), 'A sees only A''s conversation');
SELECT pg_temp.rejected($q$INSERT INTO public.conversations (id, user_id, title)
  VALUES ('10000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000b1', 'Forged')$q$,
  '42501', 'A cannot insert a conversation with B''s user_id');
INSERT INTO public.conversations (id, user_id, title)
VALUES ('10000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000a1', 'A two');
UPDATE public.conversations SET title = 'Taken' WHERE id = '10000000-0000-4000-8000-0000000000b1';
DELETE FROM public.conversations WHERE id = '10000000-0000-4000-8000-0000000000b1';
UPDATE public.conversations SET title = 'A renamed' WHERE id = '10000000-0000-4000-8000-0000000000a3';
SELECT pg_temp.assert_true((SELECT title = 'A renamed' FROM public.conversations
  WHERE id = '10000000-0000-4000-8000-0000000000a3'), 'A inserts and renames A''s conversation');
SELECT pg_temp.rejected($q$UPDATE public.conversations SET user_id = '00000000-0000-4000-8000-0000000000b1'
  WHERE id = '10000000-0000-4000-8000-0000000000a3'$q$, '42501', 'A cannot hand a conversation to B');
DELETE FROM public.conversations WHERE id = '10000000-0000-4000-8000-0000000000a3';

-- privacy_policy_consents: insert and select.
INSERT INTO public.privacy_policy_consents (user_id, policy_version)
VALUES ('00000000-0000-4000-8000-0000000000a1', 'p12-a');
SELECT pg_temp.rejected($q$INSERT INTO public.privacy_policy_consents (user_id, policy_version)
  VALUES ('00000000-0000-4000-8000-0000000000b1', 'forged')$q$,
  '42501', 'A cannot record a consent with B''s user_id');
SELECT pg_temp.assert_true((SELECT array_agg(policy_version) = ARRAY['p12-a']
  FROM public.privacy_policy_consents), 'A sees only A''s consent');

-- user_profiles: select and update.
SELECT pg_temp.assert_true((SELECT array_agg(user_id) = ARRAY['00000000-0000-4000-8000-0000000000a1'::uuid]
  FROM public.user_profiles), 'A sees only A''s profile');
UPDATE public.user_profiles SET first_name = 'Taken' WHERE user_id = '00000000-0000-4000-8000-0000000000b1';
UPDATE public.user_profiles SET first_name = 'Asha' WHERE user_id = '00000000-0000-4000-8000-0000000000a1';

-- user_roles, model_call_logs, chat_turn_traces, invoices: select.
SELECT pg_temp.assert_true((SELECT array_agg(user_id) = ARRAY['00000000-0000-4000-8000-0000000000a1'::uuid]
  FROM public.user_roles), 'A sees only A''s role');
SELECT pg_temp.assert_true((SELECT array_agg(user_id) = ARRAY['00000000-0000-4000-8000-0000000000a1'::uuid]
  FROM public.model_call_logs), 'A sees only A''s model calls');
SELECT pg_temp.assert_true((SELECT array_agg(user_id) = ARRAY['00000000-0000-4000-8000-0000000000a1'::uuid]
  FROM public.chat_turn_traces), 'A sees only A''s traces');
SELECT pg_temp.assert_true((SELECT array_agg(id) = ARRAY['inv_p12_a']
  FROM public.invoices), 'A sees only A''s invoice');

-- The admin branch is unchanged: C reads A's and B's profile, consent, role and invoice, but not
-- their conversations (that policy has no admin branch). The chain seeds other users too, so
-- these check A's and B's rows rather than totals.
SET LOCAL request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000c1", "role": "authenticated"}';
SELECT pg_temp.assert_true((SELECT count(*) = 3 FROM public.user_profiles WHERE user_id IN (
  '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1',
  '00000000-0000-4000-8000-0000000000c1')), 'the admin sees A''s, B''s and its own profile');
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM public.privacy_policy_consents WHERE policy_version IN ('p12-a', 'p12-b')),
  'the admin sees A''s and B''s consent');
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM public.user_roles WHERE user_id IN (
  '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1')), 'the admin sees A''s and B''s role');
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM public.invoices WHERE id IN ('inv_p12_a', 'inv_p12_b')),
  'the admin sees A''s and B''s invoice');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.conversations), 'the admin sees no one else''s conversation');
RESET ROLE;

SELECT pg_temp.assert_true((SELECT title = 'B' FROM public.conversations
  WHERE id = '10000000-0000-4000-8000-0000000000b1'), 'A''s update and delete left B''s conversation alone');
SELECT pg_temp.assert_true((SELECT first_name IS NULL FROM public.user_profiles
  WHERE user_id = '00000000-0000-4000-8000-0000000000b1'), 'A''s update left B''s profile alone');
SELECT pg_temp.assert_true((SELECT first_name = 'Asha' FROM public.user_profiles
  WHERE user_id = '00000000-0000-4000-8000-0000000000a1'), 'A updates A''s profile');

ROLLBACK;
