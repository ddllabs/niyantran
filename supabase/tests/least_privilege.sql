-- B5, plain PostgreSQL assertions against a disposable pgvector database only.
-- Bootstrap auth + migrations 0001-0014; omit 0007's extensions/schedule and
-- load only its model_pricing_reconcile definition and RPC grants. Apply 0015.
-- Negative controls: broad default table ACLs, PUBLIC/anon table and column
-- ACLs, and authenticated historical column INSERT/UPDATE/REFERENCES grants.
-- Every fixture/action rolls back, including unexpectedly accepted DDL.
\set ON_ERROR_STOP on
BEGIN;
CREATE SCHEMA privilege_test_fixture;
GRANT USAGE, CREATE ON SCHEMA privilege_test_fixture TO authenticated;
CREATE TEMP TABLE checks (label text, passed boolean);
GRANT INSERT ON checks TO authenticated, anon, service_role;
CREATE FUNCTION pg_temp.check(actual boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO pg_temp.checks VALUES (label, actual IS TRUE);
  IF actual IS NOT TRUE THEN RAISE WARNING 'FAIL: %', label; END IF;
END;
$$;
CREATE FUNCTION pg_temp.denied(statement text, label text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE rejected boolean := false;
BEGIN
  BEGIN
    EXECUTE statement;
    -- Roll back accepted mutations too, so negative controls cannot erase data.
    RAISE EXCEPTION USING ERRCODE = 'P9001', MESSAGE = 'accepted action rollback';
  EXCEPTION
    WHEN insufficient_privilege THEN rejected := true;
    WHEN SQLSTATE 'P9001' THEN NULL;
  END;
  PERFORM pg_temp.check(rejected, label);
END;
$$;
CREATE FUNCTION pg_temp.noop_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RETURN NEW; END;
$$;
CREATE TEMP TABLE expected (name text, verbs text[]);
INSERT INTO expected VALUES
 ('documents', ARRAY['SELECT']), ('document_chunks', ARRAY['SELECT']),
 ('desk_rows', ARRAY['SELECT']), ('ai_models', ARRAY['SELECT']),
 ('ai_roles', ARRAY['SELECT']), ('model_pricing', ARRAY['SELECT']),
 ('organisations', ARRAY['SELECT','UPDATE']),
 ('organisation_members', ARRAY['SELECT','INSERT','UPDATE','DELETE']),
 ('user_roles', ARRAY['SELECT','INSERT','UPDATE','DELETE']),
 ('organisation_invites', ARRAY['SELECT','INSERT','UPDATE']),
 ('privacy_policy_consents', ARRAY['SELECT','INSERT']),
 ('user_profiles', ARRAY['SELECT']),
 ('conversations', ARRAY['SELECT','INSERT','UPDATE','DELETE']),
 ('chat_messages', ARRAY['SELECT']),
 ('chat_cancellations', ARRAY['SELECT','INSERT','UPDATE','DELETE']),
 ('model_call_logs', ARRAY['SELECT']), ('chat_turn_traces', ARRAY['SELECT']);
DO $$
DECLARE r record; relation regclass; privilege text; c record; allowed boolean; role_name text;
BEGIN
  FOR r IN SELECT * FROM expected LOOP
    relation := ('public.' || r.name)::regclass;
    PERFORM pg_temp.check(NOT EXISTS (
      SELECT FROM pg_class t, LATERAL aclexplode(t.relacl) a
      WHERE t.oid = relation AND a.grantee = 0
      UNION ALL
      SELECT FROM pg_attribute t, LATERAL aclexplode(t.attacl) a
      WHERE t.attrelid = relation AND a.grantee = 0), r.name || ': no PUBLIC ACL');
    FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      PERFORM pg_temp.check(NOT has_table_privilege('anon',relation,privilege),r.name || ': anon lacks ' || privilege);
      PERFORM pg_temp.check(has_table_privilege('authenticated',relation,privilege) = (privilege = ANY(r.verbs)),r.name || ': authenticated ' || privilege || ' matches policy matrix');
    END LOOP;
    FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
      PERFORM pg_temp.check(has_table_privilege('service_role',relation,privilege),r.name || ': service ' || privilege);
    END LOOP;
    FOREACH privilege IN ARRAY ARRAY['TRUNCATE','REFERENCES','TRIGGER'] LOOP
      PERFORM pg_temp.check(NOT has_table_privilege('service_role',relation,privilege),r.name || ': service lacks unnecessary ' || privilege);
    END LOOP;
    -- MAINTAIN was introduced in PostgreSQL 17; older versions reject its name.
    IF current_setting('server_version_num')::int >= 170000 THEN
      FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
        PERFORM pg_temp.check(NOT has_table_privilege(role_name,relation,'MAINTAIN'),r.name || ': ' || role_name || ' lacks MAINTAIN');
      END LOOP;
    END IF;
    FOR c IN SELECT attname FROM pg_attribute WHERE attrelid=relation AND attnum>0 AND NOT attisdropped LOOP
      PERFORM pg_temp.check(NOT has_column_privilege('service_role',relation,c.attname,'REFERENCES'),r.name||'.'||c.attname||': no historical service REFERENCES');
      FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
        allowed := privilege = ANY(r.verbs)
          OR (r.name='user_profiles' AND privilege='UPDATE' AND c.attname = ANY(ARRAY['first_name','last_name','phone_number','department','persona','practice_area','jurisdiction','language','onboarding_complete','updated_at']))
          OR (r.name='chat_messages' AND privilege='INSERT' AND c.attname = ANY(ARRAY['id','conversation_id','user_id','role','content','turn_key']));
        PERFORM pg_temp.check(NOT has_column_privilege('anon',relation,c.attname,privilege),r.name||'.'||c.attname||': anon lacks '||privilege);
        PERFORM pg_temp.check(has_column_privilege('authenticated',relation,c.attname,privilege)=allowed,r.name||'.'||c.attname||': authenticated '||privilege||' matches column matrix');
      END LOOP;
    END LOOP;
  END LOOP;
END;
$$;
-- Real fixtures make allowed reads and ownership checks non-vacuous.
INSERT INTO auth.users(id,email) VALUES
 ('00000000-0000-4000-8000-000000000051','priv-owner@example.invalid'),
 ('00000000-0000-4000-8000-000000000052','priv-member@example.invalid'),
 ('00000000-0000-4000-8000-000000000053','priv-outsider@example.invalid');
INSERT INTO public.organisations(id,name) VALUES
 ('10000000-0000-4000-8000-000000000051','Privileges fixture');
INSERT INTO public.organisation_members(organisation_id,user_id,role,status) VALUES
 ('10000000-0000-4000-8000-000000000051','00000000-0000-4000-8000-000000000051','owner','active');
SET LOCAL ROLE service_role;
SELECT pg_temp.denied('TRUNCATE public.user_profiles CASCADE','service cannot truncate protected profile table');
SELECT pg_temp.denied('CREATE TRIGGER forbidden_service_trigger BEFORE UPDATE ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION pg_temp.noop_trigger()','service cannot create protected profile trigger');
SELECT pg_temp.check((public.model_pricing_reconcile('[{"model_id":"test/privileges","supported_parameters":["tools"]}]')->>'upserted')::int=1,'service pricing reconcile executes and writes');
INSERT INTO public.ai_models(model_id,label,enabled) VALUES('test/privileges','Privileges',true);
INSERT INTO public.ai_roles(role_id,label,hint,model_id) VALUES('privileges','Privileges','Fixture','test/privileges');
INSERT INTO public.documents(id,source_key,title,content_sha256,ocr_text) VALUES
 ('20000000-0000-4000-8000-000000000051','privileges-fixture','Privileges','fixture-hash','Fixture');
INSERT INTO public.document_chunks(document_id,chunk_hash,chunk_index,char_from,char_to,content,chunker_version) VALUES
 ('20000000-0000-4000-8000-000000000051','fixture-chunk',0,0,7,'Fixture',1);
INSERT INTO public.desk_rows(tier,feature,row_key,row,record_text,snapshot_at) VALUES('test','privileges','fixture','{}','Fixture',now());
UPDATE public.documents SET title='Service update' WHERE source_key='privileges-fixture';
SELECT pg_temp.check((SELECT title='Service update' FROM public.documents WHERE source_key='privileges-fixture'),'service corpus insert/update/select works');
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.role = 'authenticated';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000051';
DO $$
DECLARE t text; n int; c text;
BEGIN
  FOREACH t IN ARRAY ARRAY['documents','document_chunks','desk_rows','ai_models','ai_roles','model_pricing'] LOOP
    SELECT attname INTO c FROM pg_attribute WHERE attrelid=('public.'||t)::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum LIMIT 1;
    EXECUTE format('SELECT count(*) FROM public.%I',t) INTO n;
    PERFORM pg_temp.denied(format('UPDATE public.%I SET %I=%I WHERE false',t,c,c),t||': authenticated column UPDATE denied');
    PERFORM pg_temp.denied(format('INSERT INTO public.%I (%I) SELECT %I FROM public.%I WHERE false',t,c,c,t),t||': authenticated column INSERT denied');
    PERFORM pg_temp.check(n>0,t||': authenticated reads fixture');
    PERFORM pg_temp.denied(format('DELETE FROM public.%I WHERE false',t),t||': authenticated DELETE denied at privilege boundary');
    PERFORM pg_temp.denied(format('TRUNCATE public.%I CASCADE',t),t||': authenticated TRUNCATE denied');
  END LOOP;
END;
$$;
SELECT pg_temp.denied('CREATE TABLE privilege_test_fixture.forbidden_reference (id uuid REFERENCES public.documents(id))','authenticated cannot REFERENCES corpus ID');
SELECT pg_temp.denied('CREATE TRIGGER forbidden_trigger BEFORE UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION pg_temp.noop_trigger()','authenticated cannot create corpus trigger');
SELECT pg_temp.denied('SELECT public.model_pricing_reconcile(''[]'')','authenticated cannot execute service pricing RPC');
SELECT pg_temp.denied('INSERT INTO public.organisations(name) VALUES (''Forbidden'')','B1 organisation INSERT remains denied');
SELECT pg_temp.denied('DELETE FROM public.organisations WHERE false','organisation DELETE denied');
SELECT pg_temp.denied('DELETE FROM public.organisation_invites WHERE false','invitation DELETE denied');
SELECT pg_temp.denied('UPDATE public.privacy_policy_consents SET policy_version=''forged'' WHERE false','consent UPDATE denied');
SELECT pg_temp.denied('DELETE FROM public.privacy_policy_consents WHERE false','consent DELETE denied');
UPDATE public.organisations SET name='Owner update' WHERE id='10000000-0000-4000-8000-000000000051';
SELECT pg_temp.check((SELECT name='Owner update' FROM public.organisations WHERE id='10000000-0000-4000-8000-000000000051'),'owner selects/updates organisation');
INSERT INTO public.organisation_members(organisation_id,user_id,role,status) VALUES
 ('10000000-0000-4000-8000-000000000051','00000000-0000-4000-8000-000000000052','user','active');
UPDATE public.organisation_members SET status='disabled' WHERE user_id='00000000-0000-4000-8000-000000000052';
SELECT pg_temp.check((SELECT status='disabled' FROM public.organisation_members WHERE user_id='00000000-0000-4000-8000-000000000052'),'owner inserts/selects/updates member');
DELETE FROM public.organisation_members WHERE user_id='00000000-0000-4000-8000-000000000052';
SELECT pg_temp.check(NOT EXISTS(SELECT FROM public.organisation_members WHERE user_id='00000000-0000-4000-8000-000000000052'),'owner deletes member');
INSERT INTO public.user_roles(user_id,organisation_id,role) VALUES
 ('00000000-0000-4000-8000-000000000052','10000000-0000-4000-8000-000000000051','user');
UPDATE public.user_roles SET role='owner' WHERE user_id='00000000-0000-4000-8000-000000000052';
SELECT pg_temp.check((SELECT role='owner' FROM public.user_roles WHERE user_id='00000000-0000-4000-8000-000000000052'),'owner inserts/selects/updates role');
DELETE FROM public.user_roles WHERE user_id='00000000-0000-4000-8000-000000000052';
SELECT pg_temp.check(NOT EXISTS(SELECT FROM public.user_roles WHERE user_id='00000000-0000-4000-8000-000000000052'),'owner deletes role');
INSERT INTO public.organisation_invites(organisation_id,email) VALUES('10000000-0000-4000-8000-000000000051','invited@example.invalid');
UPDATE public.organisation_invites SET email='updated@example.invalid' WHERE organisation_id='10000000-0000-4000-8000-000000000051';
SELECT pg_temp.check((SELECT email='updated@example.invalid' FROM public.organisation_invites WHERE organisation_id='10000000-0000-4000-8000-000000000051'),'owner inserts/selects/updates invitation');
INSERT INTO public.privacy_policy_consents(user_id,policy_version) VALUES(auth.uid(),'test-privileges');
SELECT pg_temp.check((SELECT count(*)=1 FROM public.privacy_policy_consents WHERE user_id=auth.uid()),'user inserts/selects own consent');
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000053';
SELECT pg_temp.check(NOT EXISTS(SELECT FROM public.organisations WHERE id='10000000-0000-4000-8000-000000000051'),'outsider cannot read organisation');
SELECT pg_temp.check(NOT EXISTS(SELECT FROM public.privacy_policy_consents WHERE policy_version='test-privileges'),'outsider cannot read consent');
SELECT pg_temp.denied('INSERT INTO public.organisation_invites(organisation_id,email) VALUES (''10000000-0000-4000-8000-000000000051'',''outsider@example.invalid'')','outsider invitation INSERT blocked by RLS');
SELECT pg_temp.denied('INSERT INTO public.privacy_policy_consents(user_id,policy_version) VALUES (''00000000-0000-4000-8000-000000000051'',''forged'')','outsider consent INSERT blocked by RLS');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.denied('SELECT id FROM public.documents','anon cannot read corpus');
SELECT pg_temp.denied('TRUNCATE public.documents CASCADE','anon cannot truncate corpus');
SELECT pg_temp.denied('SELECT user_id FROM public.privacy_policy_consents','anon cannot read consent');
RESET ROLE;
SET LOCAL ROLE service_role;
DELETE FROM public.documents WHERE source_key='privileges-fixture';
SELECT pg_temp.check(NOT EXISTS(SELECT FROM public.document_chunks WHERE document_id='20000000-0000-4000-8000-000000000051'),'service deletes corpus with chunk cascade');
RESET ROLE;
SELECT count(*) AS assertions, count(*) FILTER(WHERE NOT passed) AS failures FROM checks;
DO $$
BEGIN
  IF EXISTS(SELECT FROM checks WHERE NOT passed) THEN
    RAISE EXCEPTION 'least privilege assertions failed';
  END IF;
END;
$$;
ROLLBACK;
