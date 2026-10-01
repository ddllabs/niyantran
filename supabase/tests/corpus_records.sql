-- Disposable PG assertions for admin-records (20261001180000_corpus_records;
-- docs/specs/2026-10-01-rag-v2-admin-upload.md, "Amendment A (revision 3)",
-- "Testing and acceptance"; plan docs/plans/2026-10-01-rag-v2-admin-records.md,
-- C1): the audit table, its privileges and the two indexes; every function's
-- shape and execute grants; the desk check (either bill feature, tier and
-- feature bound); every refusal token of ingest_link, ingest_unlink,
-- ingest_swap and ingest_delete, each with no audit row; the D2 unique index
-- (its constraint name) beside legacy duplicates; swap with the old document
-- holding, unlinked, deleted or legacy, a stale expected_old, and its
-- atomicity; delete of uploads only, with the active job cancelled first and
-- the cascade leaving stored objects; ingest_discard's new signature and audit
-- row; ingest_register's link fields (admin key, key_held, replaces, the
-- script path unlinked with link_target, resume applied or refused with
-- conflict); admin_desk_records (shape, statuses and precedence, latest job,
-- search escaping, sort, paging, total, coverage and orphaned links) and
-- admin_unlinked_documents; and, across two real sessions (dblink), the key
-- lock that turns a concurrent link into key_held and the row lock swap takes
-- on the old document.
-- Run on ingest_discard's chain plus the migration, which run.sh applies as a
-- NON-superuser; never against a hosted project. The vacuity check drops the
-- migration; run.sh also runs the migration's duplicate pre-check against
-- seeded duplicates and executes its Down section. Every label is unique and
-- each assertion was shown red on its own against a broken variant of the
-- migration (the seeding guards, marked below, check the fixture itself).
--
-- Section 1 reads the catalogue; sections 2-5 each run in a transaction that
-- is rolled back (inside one, now() is constant); section 6 commits (two
-- dblink sessions cannot see an open transaction) and deletes its rows after.
\set ON_ERROR_STOP on
SET search_path = public, extensions;
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
-- Refused with '<fn>: <token>: ...' and no audit row written.
CREATE FUNCTION pg_temp.refused_token(statement text, fn text, token text, label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE before bigint := (SELECT count(*) FROM public.corpus_admin_actions);
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE fn || ': ' || token || ': %' THEN
      RAISE EXCEPTION 'FAIL: % expected "%: %: ..." got %: %', label, fn, token, SQLSTATE, SQLERRM;
    END IF;
    IF (SELECT count(*) FROM public.corpus_admin_actions) <> before THEN RAISE EXCEPTION 'FAIL: % left an audit row', label; END IF;
    RAISE NOTICE 'PASS: %', label; RETURN;
  END;
  RAISE EXCEPTION 'FAIL: % accepted', label;
END; $$;
-- Refused with a message containing `pattern`.
CREATE FUNCTION pg_temp.refused(statement text, pattern text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF position(pattern IN SQLERRM) = 0 THEN RAISE EXCEPTION 'FAIL: % expected "%" got %: %', label, pattern, SQLSTATE, SQLERRM; END IF;
    RAISE NOTICE 'PASS: %', label; RETURN;
  END;
  RAISE EXCEPTION 'FAIL: % accepted', label;
END; $$;
CREATE FUNCTION pg_temp.accepted(statement text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'FAIL: % refused with %: %', label, SQLSTATE, SQLERRM;
  END;
  RAISE NOTICE 'PASS: %', label;
END; $$;
-- A unique violation of exactly this constraint (admin-ingest maps it by name).
CREATE FUNCTION pg_temp.violates(statement text, constraint_name text, label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE c text;
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS c = CONSTRAINT_NAME;
    IF c IS DISTINCT FROM constraint_name THEN RAISE EXCEPTION 'FAIL: % violated % instead', label, c; END IF;
    RAISE NOTICE 'PASS: %', label; RETURN;
  END;
  RAISE EXCEPTION 'FAIL: % accepted', label;
END; $$;
-- A call that must succeed, its result kept in res under k.
CREATE FUNCTION pg_temp.keep(k text, expr text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_temp.accepted(format('INSERT INTO res SELECT %L, %s', k, expr), label); END; $$;
CREATE FUNCTION pg_temp.shape(t regclass) RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(attname || ':' || format_type(atttypid, atttypmod) || CASE WHEN attnotnull THEN ':nn' ELSE '' END, ', ' ORDER BY attnum)
    FROM pg_attribute WHERE attrelid = t AND attnum > 0 AND NOT attisdropped;
$$;

-- Inputs. id(n): a fixed uuid; h(n): a distinct SHA-256.
CREATE FUNCTION pg_temp.id(n int) RETURNS uuid LANGUAGE sql AS $$ SELECT ('c0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.h(n int) RETURNS text LANGUAGE sql AS $$ SELECT encode(sha256(convert_to('records-' || n, 'UTF8')), 'hex') $$;
-- An ingestion-v2 document (storage_path set), an upload unless src is given.
CREATE FUNCTION pg_temp.v2(n int, feature text, meta jsonb DEFAULT '{}', indexed boolean DEFAULT false, src text DEFAULT NULL,
                           tier text DEFAULT 'national', title text DEFAULT NULL) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.documents (id, source_key, title, desk_tier, desk_feature, metadata, content_sha256, ocr_text, page_count,
                                storage_path, file_sha256, source_mime, indexed_at, created_at)
  VALUES (pg_temp.id(n), coalesce(src, 'upload:' || pg_temp.h(n)), coalesce(title, 'Doc ' || n), tier, feature, meta,
          encode(sha256(''::bytea), 'hex'), '', 4, 'files/' || pg_temp.h(n) || '.pdf', pg_temp.h(n), 'application/pdf',
          CASE WHEN indexed THEN now() END, timestamptz '2030-06-01' + n * interval '1 minute')
  RETURNING id
$$;
-- A legacy document (storage_path null).
CREATE FUNCTION pg_temp.legacy(n int, feature text, meta jsonb, indexed boolean DEFAULT true, src text DEFAULT NULL) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.documents (id, source_key, title, desk_tier, desk_feature, metadata, content_sha256, ocr_text, chunker_version, indexed_at)
  VALUES (pg_temp.id(n), coalesce(src, 'legacy-' || n), 'Legacy ' || n, 'national', feature, meta, 'sha-' || n, 'legacy text', 2,
          CASE WHEN indexed THEN now() END)
  RETURNING id
$$;
-- A job in the given status, valid for the table's checks.
CREATE FUNCTION pg_temp.job(doc uuid, status text, at timestamptz DEFAULT now(), err text DEFAULT NULL) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.ingest_jobs (document_id, status, stage, file_sha256, pages_total, claim_token, lease_until, finished_at, created_at, error_code)
  SELECT doc, status, CASE WHEN status = 'succeeded' THEN 'done' ELSE 'ocr' END, coalesce(d.file_sha256, pg_temp.h(0)), 4,
         CASE WHEN status = 'running' THEN gen_random_uuid() END,
         CASE WHEN status = 'running' THEN now() + interval '5 minutes' END,
         CASE WHEN status IN ('succeeded', 'failed', 'cancelled') THEN now() END, at, err
    FROM public.documents d WHERE d.id = doc
  RETURNING id
$$;
-- A desk row; record_text is the title plus `extra`.
CREATE FUNCTION pg_temp.drow(tier text, feature text, row_key text, key text, title text, date text DEFAULT NULL,
                             house text DEFAULT 'Lok Sabha', extra text DEFAULT '', date_field text DEFAULT 'date_introduced') RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.desk_rows (tier, feature, row_key, row, record_text, document_key, snapshot_at)
  VALUES (tier, feature, row_key,
          jsonb_strip_nulls(jsonb_build_object('bill_name', title, 'house', house, date_field, date,
                                               'source_url', 'https://sansad.in/' || lower(left(house, 1)) || 's/legislation')),
          title || ' ' || extra, key, now())
$$;
CREATE FUNCTION pg_temp.meta(doc uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT metadata FROM public.documents WHERE id = doc $$;
-- A document's audit rows, without id and at.
CREATE FUNCTION pg_temp.audit(doc uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(a) - 'id' - 'at' - 'document_id' ORDER BY a.action, a.key), '[]')
    FROM public.corpus_admin_actions a WHERE a.document_id = doc
$$;

-- The functions, called as service_role (the only role granted them).
CREATE FUNCTION pg_temp.link(d uuid, k text, e text, a uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb; BEGIN SET LOCAL ROLE service_role; r := public.ingest_link(d, k, e, a); RESET ROLE; RETURN r; END; $$;
CREATE FUNCTION pg_temp.unlink(d uuid, e text, a uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb; BEGIN SET LOCAL ROLE service_role; r := public.ingest_unlink(d, e, a); RESET ROLE; RETURN r; END; $$;
CREATE FUNCTION pg_temp.swap(n uuid, o uuid, a uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb; BEGIN SET LOCAL ROLE service_role; r := public.ingest_swap(n, o, a); RESET ROLE; RETURN r; END; $$;
CREATE FUNCTION pg_temp.del(d uuid, a uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb; BEGIN SET LOCAL ROLE service_role; r := public.ingest_delete(d, a); RESET ROLE; RETURN r; END; $$;
CREATE FUNCTION pg_temp.register(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb; BEGIN SET LOCAL ROLE service_role; r := public.ingest_register(p); RESET ROLE; RETURN r; END; $$;
CREATE FUNCTION pg_temp.records(f text, q text DEFAULT NULL, s text DEFAULT NULL, l int DEFAULT 50, o int DEFAULT 0, t text DEFAULT 'national') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb; BEGIN SET LOCAL ROLE service_role; r := public.admin_desk_records(t, f, q, s, l, o); RESET ROLE; RETURN r; END; $$;
CREATE FUNCTION pg_temp.unlinked(f text, q text DEFAULT NULL, l int DEFAULT 50, o int DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb; BEGIN SET LOCAL ROLE service_role; r := public.admin_unlinked_documents('national', f, q, l, o); RESET ROLE; RETURN r; END; $$;

-- ===== 1. Shape, privileges and execute grants =====
SELECT pg_temp.assert_true(pg_temp.shape('public.corpus_admin_actions') =
  'id:uuid:nn, at:timestamp with time zone:nn, actor:uuid, action:text:nn, document_id:uuid, key:text, old_key:text, detail:jsonb:nn',
  'corpus_admin_actions has the spec''s columns');
SELECT pg_temp.assert_true((SELECT jsonb_object_agg(column_name, column_default) FROM information_schema.columns
                             WHERE table_schema = 'public' AND table_name = 'corpus_admin_actions' AND column_default IS NOT NULL)
                           = '{"id": "gen_random_uuid()", "at": "now()", "detail": "''{}''::jsonb"}',
                           'id, at and detail default to a new uuid, now() and {}');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM pg_constraint WHERE conrelid = 'public.corpus_admin_actions'::regclass AND contype = 'f'),
                           'corpus_admin_actions has no foreign key (history survives deletions)');
SELECT pg_temp.assert_true((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.corpus_admin_actions'::regclass)
                           AND NOT EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'corpus_admin_actions'),
                           'RLS is enabled on corpus_admin_actions, with no policy');
SELECT pg_temp.assert_true((SELECT NOT r.rolsuper FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE c.oid = 'public.corpus_admin_actions'::regclass),
                           'the migration was applied by a role that is not a superuser');
-- PUBLIC first: a grant to PUBLIC also reaches anon and authenticated.
DO $$
DECLARE actor text; privilege text; expected boolean;
BEGIN
  FOREACH actor IN ARRAY ARRAY['public', 'anon', 'authenticated', 'service_role'] LOOP
    FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
      expected := actor = 'service_role' AND privilege = 'SELECT';
      PERFORM pg_temp.assert_true(has_table_privilege(actor, 'public.corpus_admin_actions', privilege) = expected,
                                  actor || CASE WHEN expected THEN ' can ' ELSE ' cannot ' END || privilege || ' corpus_admin_actions');
    END LOOP;
  END LOOP;
END; $$;
SELECT pg_temp.assert_true((SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'documents_v2_document_key_unique')
                           = 'CREATE UNIQUE INDEX documents_v2_document_key_unique ON public.documents USING btree (((metadata ->> ''document_key''::text))) '
                             'WHERE ((storage_path IS NOT NULL) AND (metadata ? ''document_key''::text))',
                           'documents_v2_document_key_unique is unique on the key, partial to ingestion-v2 documents with a key');
SELECT pg_temp.assert_true((SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'ingest_jobs_document_created')
                           = 'CREATE INDEX ingest_jobs_document_created ON public.ingest_jobs USING btree (document_id, created_at DESC)',
                           'ingest_jobs_document_created indexes (document_id, created_at desc)');
SELECT pg_temp.assert_true(to_regprocedure('public.ingest_discard(uuid)') IS NULL
                           AND (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'ingest_discard') = 1
                           AND (SELECT pronargdefaults = 1 FROM pg_proc WHERE oid = 'public.ingest_discard(uuid,uuid)'::regprocedure),
                           'ingest_discard exists once, as ingest_discard(uuid, uuid default null)');
DO $$
DECLARE fn text; actor text; expected boolean;
  writers text[] := ARRAY['public.ingest_register(jsonb)', 'public.ingest_link(uuid,text,text,uuid)', 'public.ingest_unlink(uuid,text,uuid)',
                          'public.ingest_swap(uuid,uuid,uuid)', 'public.ingest_delete(uuid,uuid)', 'public.ingest_discard(uuid,uuid)'];
  readers text[] := ARRAY['public.admin_desk_records(text,text,text,text,int,int)', 'public.admin_unlinked_documents(text,text,text,int,int)'];
  internal text[] := ARRAY['public.corpus_key_in_desk(text,text,text)', 'public.corpus_link_plan(text,text,text,boolean,uuid,boolean,uuid)'];
BEGIN
  FOREACH fn IN ARRAY writers || readers LOOP
    PERFORM pg_temp.assert_true(pg_get_function_result(fn::regprocedure) = 'jsonb', fn || ' returns jsonb');
  END LOOP;
  FOREACH fn IN ARRAY writers LOOP
    PERFORM pg_temp.assert_true((SELECT prosecdef AND proconfig IS NOT DISTINCT FROM array['search_path=public, extensions'] FROM pg_proc WHERE oid = fn::regprocedure),
                                fn || ' is security definer and sets only search_path');
  END LOOP;
  FOREACH fn IN ARRAY readers || internal || ARRAY['public.corpus_desk_features(text,text)', 'public.corpus_desk_name(text)'] LOOP
    PERFORM pg_temp.assert_true((SELECT NOT prosecdef AND proconfig IS NOT DISTINCT FROM array['search_path=public, extensions'] FROM pg_proc WHERE oid = fn::regprocedure),
                                fn || ' is security invoker and sets only search_path');
  END LOOP;
  FOREACH fn IN ARRAY writers || readers || internal || ARRAY['public.corpus_desk_features(text,text)', 'public.corpus_desk_name(text)'] LOOP
    PERFORM pg_temp.assert_true((SELECT NOT r.rolsuper FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner WHERE p.oid = fn::regprocedure),
                                fn || ' is owned by a role that is not a superuser');
    FOREACH actor IN ARRAY ARRAY['public', 'anon', 'authenticated', 'service_role'] LOOP
      expected := actor = 'service_role' AND fn <> ALL (internal);
      PERFORM pg_temp.assert_true(has_function_privilege(actor, fn, 'EXECUTE') = expected,
                                  actor || CASE WHEN expected THEN ' can ' ELSE ' cannot ' END || 'execute ' || fn);
    END LOOP;
  END LOOP;
END; $$;

-- ===== 2. Link, unlink, the desk check and the D2 index =====
BEGIN;
SET LOCAL search_path = public, extensions;
SELECT pg_temp.drow('national', 'Bill Passage Probability Index', 'r1', 'bill:2020:1', 'One');
SELECT pg_temp.drow('national', 'Bill Passage Probability Index', 'r2', 'bill:2020:2', 'Two');
SELECT pg_temp.drow('national', 'Policy Intelligence Graph', 'p3', 'bill:2020:3', 'Three');          -- only in the graph
SELECT pg_temp.drow('national', 'Bill Passage Probability Index', 'r4', 'bill:2020:4', 'Four');
SELECT pg_temp.drow('national', 'Bill Passage Probability Index', 'r5', 'bill:2020:5', 'Five');
SELECT pg_temp.drow('state', 'Bill Passage Probability Index', 's6', 'bill:2020:6', 'Six');          -- another tier, same feature name
SELECT pg_temp.drow('national', 'Other Keyed', 'o1', 'other:1', 'Other');                            -- a keyed desk outside the bill pair
SELECT pg_temp.drow('national', 'Budget at a Glance', 'b1', NULL, 'Budget');                         -- a desk without keys
SELECT pg_temp.drow('national', 'Regulators (RBI / SEBI / TRAI / CCI)', 'g1', 'reg:1', 'Regulator');   -- catalogue spelling
SELECT pg_temp.drow('national', 'Policy Intelligence Graph', 'p7', 'bill:2020:7', 'Seven');          -- only in the graph
SELECT pg_temp.legacy(1, 'Bill Passage Probability Index', '{"document_key": "bill:2020:1"}');
SELECT pg_temp.v2(11, 'Bill Passage Probability Index', '{"origin": "admin-upload"}');
SELECT pg_temp.v2(12, 'Policy Intelligence Graph');
SELECT pg_temp.v2(13, 'Budget at a Glance');
SELECT pg_temp.v2(14, 'Bill Passage Probability Index', tier => 'state');
SELECT pg_temp.v2(15, 'Other Keyed');
SELECT pg_temp.v2(16, 'Bill Passage Probability Index');
SELECT pg_temp.v2(17, 'Bill Passage Probability Index');
SELECT pg_temp.v2(18, 'Bill Passage Probability Index', '{"origin": "admin-upload", "link_target": "bill:2020:5", "replaces": "c0000000-0000-4000-8000-000000000099"}');
SELECT pg_temp.v2(19, 'Regulators (RBI/SEBI/TRAI/CCI)');                                             -- corpus spelling
SELECT pg_temp.v2(20, 'bill passage probability-index');                                             -- a bill desk, spelled loosely
CREATE TEMP TABLE res (k text PRIMARY KEY, r jsonb);

SELECT pg_temp.refused_token($q$SELECT pg_temp.link(pg_temp.id(999), 'bill:2020:2', NULL)$q$, 'ingest_link', 'not_found', 'link refuses a document that does not exist');
SELECT pg_temp.refused_token($q$SELECT pg_temp.link(pg_temp.id(1), 'bill:2020:2', 'bill:2020:1')$q$, 'ingest_link', 'legacy', 'link refuses a legacy document');
SELECT pg_temp.refused_token($q$SELECT pg_temp.link(pg_temp.id(11), 'bill:2020:2', 'bill:2020:9')$q$, 'ingest_link', 'stale', 'link refuses an expected key when the document holds none');
SELECT pg_temp.refused_token($q$SELECT pg_temp.link(pg_temp.id(11), 'bill:2020:9', NULL)$q$, 'ingest_link', 'wrong_desk', 'link refuses a key no desk row has');
SELECT pg_temp.refused_token($q$SELECT pg_temp.link(pg_temp.id(11), NULL, NULL)$q$, 'ingest_link', 'wrong_desk', 'link refuses a null key');
SELECT pg_temp.refused_token($q$SELECT pg_temp.link(pg_temp.id(11), 'other:1', NULL)$q$, 'ingest_link', 'wrong_desk', 'link refuses a key of another desk');
SELECT pg_temp.refused_token($q$SELECT pg_temp.link(pg_temp.id(13), 'bill:2020:2', NULL)$q$, 'ingest_link', 'wrong_desk', 'link refuses a bill key for a document of a desk without keys');
SELECT pg_temp.refused_token($q$SELECT pg_temp.link(pg_temp.id(14), 'bill:2020:2', NULL)$q$, 'ingest_link', 'wrong_desk', 'link refuses a key of the same feature in another tier');
SELECT pg_temp.refused_token($q$SELECT pg_temp.link(pg_temp.id(15), 'bill:2020:2', NULL)$q$, 'ingest_link', 'wrong_desk', 'the either-bill-feature rule does not extend to other desks');

SELECT pg_temp.keep('link11', $q$pg_temp.link(pg_temp.id(11), 'bill:2020:3', NULL, pg_temp.id(500))$q$, 'a Bill Passage document links to a key only the Policy Intelligence Graph has (D10)');
SELECT pg_temp.assert_true((SELECT r = jsonb_build_object('document_id', pg_temp.id(11), 'document_key', 'bill:2020:3') FROM res WHERE k = 'link11'),
                           'link returns {document_id, document_key}');
SELECT pg_temp.assert_true(pg_temp.meta(pg_temp.id(11)) = '{"origin": "admin-upload", "document_key": "bill:2020:3"}',
                           'link stores the key and keeps the other metadata');
SELECT pg_temp.assert_true(pg_temp.audit(pg_temp.id(11)) = jsonb_build_array(jsonb_build_object('actor', pg_temp.id(500), 'action', 'link', 'key', 'bill:2020:3',
                             'old_key', NULL, 'detail', '{"link_target": null, "replaces": null}'::jsonb)),
                           'link writes one audit row: actor, link, the key and no old key');
SELECT pg_temp.accepted($q$SELECT pg_temp.link(pg_temp.id(12), 'bill:2020:2', NULL)$q$, 'a Policy Intelligence Graph document links to a key only the Bill Passage desk has');
SELECT pg_temp.accepted($q$SELECT pg_temp.link(pg_temp.id(14), 'bill:2020:6', NULL)$q$, 'a state-tier document links to its own tier''s key');
SELECT pg_temp.accepted($q$SELECT pg_temp.link(pg_temp.id(16), 'bill:2020:1', NULL)$q$, 'a key held only by a legacy document can be linked');
SELECT pg_temp.accepted($q$SELECT pg_temp.link(pg_temp.id(19), 'reg:1', NULL)$q$, 'the desk check compares desk names normalised (punctuation and spacing)');
SELECT pg_temp.accepted($q$SELECT pg_temp.link(pg_temp.id(20), 'bill:2020:7', NULL)$q$, 'a loosely spelled bill desk still accepts either bill feature''s key');
SELECT pg_temp.refused_token($q$SELECT pg_temp.link(pg_temp.id(17), 'bill:2020:3', NULL)$q$, 'ingest_link', 'key_held', 'link refuses a key another ingestion-v2 document holds');
SELECT pg_temp.refused_token($q$SELECT pg_temp.link(pg_temp.id(11), 'bill:2020:4', NULL)$q$, 'ingest_link', 'stale', 'link refuses a null expected key when the document holds one');
SELECT pg_temp.refused_token($q$SELECT pg_temp.link(pg_temp.id(11), 'bill:2020:4', 'bill:2020:2')$q$, 'ingest_link', 'stale', 'link refuses an expected key that is not the current one');
SELECT pg_temp.keep('relink11', $q$pg_temp.link(pg_temp.id(11), 'bill:2020:4', 'bill:2020:3', pg_temp.id(501))$q$, 'link re-links with the current key as the expected one');
SELECT pg_temp.assert_true(pg_temp.meta(pg_temp.id(11))->>'document_key' = 'bill:2020:4'
                           AND pg_temp.audit(pg_temp.id(11)) @> jsonb_build_array(jsonb_build_object('actor', pg_temp.id(501), 'action', 'link', 'key', 'bill:2020:4', 'old_key', 'bill:2020:3'))
                           AND jsonb_array_length(pg_temp.audit(pg_temp.id(11))) = 2,
                           're-link moves the key and audits the old key');
SELECT pg_temp.keep('link18', $q$pg_temp.link(pg_temp.id(18), 'bill:2020:5', NULL)$q$, 'link accepts a document with a pending link_target');
SELECT pg_temp.assert_true(pg_temp.meta(pg_temp.id(18)) = '{"origin": "admin-upload", "document_key": "bill:2020:5"}',
                           'link removes a pending link_target and replaces and keeps other metadata');

-- The D2 index: by constraint name, ingestion-v2 only.
SELECT pg_temp.violates($q$UPDATE documents SET metadata = metadata || '{"document_key": "bill:2020:4"}' WHERE id = pg_temp.id(12)$q$,
                        'documents_v2_document_key_unique', 'a second ingestion-v2 holder of a key violates documents_v2_document_key_unique');
SELECT pg_temp.accepted($q$SELECT pg_temp.legacy(2, 'Bill Passage Probability Index', '{"document_key": "bill:2020:1"}')$q$,
                        'legacy documents may share a key with each other and with an ingestion-v2 document');

-- Unlink.
SELECT pg_temp.refused_token($q$SELECT pg_temp.unlink(pg_temp.id(999), 'bill:2020:2')$q$, 'ingest_unlink', 'not_found', 'unlink refuses a document that does not exist');
SELECT pg_temp.refused_token($q$SELECT pg_temp.unlink(pg_temp.id(1), 'bill:2020:1')$q$, 'ingest_unlink', 'legacy', 'unlink refuses a legacy document');
SELECT pg_temp.refused_token($q$SELECT pg_temp.unlink(pg_temp.id(11), 'bill:2020:3')$q$, 'ingest_unlink', 'stale', 'unlink refuses an expected key that is not the current one');
SELECT pg_temp.refused_token($q$SELECT pg_temp.unlink(pg_temp.id(13), NULL)$q$, 'ingest_unlink', 'stale', 'unlink refuses a document that holds no key');
SELECT pg_temp.keep('unlink12', $q$pg_temp.unlink(pg_temp.id(12), 'bill:2020:2', pg_temp.id(502))$q$, 'unlink accepts the current key');
SELECT pg_temp.assert_true((SELECT r = jsonb_build_object('document_id', pg_temp.id(12), 'document_key', NULL) FROM res WHERE k = 'unlink12'),
                           'unlink returns {document_id, document_key: null}');
SELECT pg_temp.assert_true(pg_temp.meta(pg_temp.id(12)) = '{}', 'unlink removes the document_key');
SELECT pg_temp.assert_true(pg_temp.audit(pg_temp.id(12)) @> jsonb_build_array(jsonb_build_object('actor', pg_temp.id(502), 'action', 'unlink', 'key', NULL, 'old_key', 'bill:2020:2'))
                           AND jsonb_array_length(pg_temp.audit(pg_temp.id(12))) = 2,
                           'unlink writes one audit row with the removed key as old_key');

-- The audit table's action check.
SELECT pg_temp.rejected($q$INSERT INTO corpus_admin_actions (action) VALUES ('rename')$q$, '23514', 'the audit table refuses an unknown action');
SELECT pg_temp.accepted($q$INSERT INTO corpus_admin_actions (action) SELECT unnest(array['attach','link','unlink','swap','delete','discard'])$q$,
                        'the audit table accepts the six actions');
ROLLBACK;

-- ===== 3. Swap, delete and discard =====
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TEMP TABLE res (k text PRIMARY KEY, r jsonb);
-- s(n, key, ...): a pair for one swap. Old 2n holds key; new 2n+1 targets it.
CREATE FUNCTION pg_temp.pair(n int, key text, new_indexed boolean DEFAULT true, replaces boolean DEFAULT true) RETURNS void LANGUAGE sql AS $$
  SELECT pg_temp.v2(100 + 2 * n, 'Bill Passage Probability Index', jsonb_build_object('origin', 'admin-upload', 'document_key', key), true);
  SELECT pg_temp.v2(101 + 2 * n, 'Bill Passage Probability Index',
                    jsonb_build_object('origin', 'admin-upload', 'link_target', key)
                    || CASE WHEN replaces THEN jsonb_build_object('replaces', pg_temp.id(100 + 2 * n)) ELSE '{}' END, new_indexed);
$$;
SELECT pg_temp.pair(1, 'bill:2021:1');
SELECT pg_temp.pair(2, 'bill:2021:2', new_indexed => false);
SELECT pg_temp.pair(3, 'bill:2021:3');
SELECT pg_temp.pair(4, 'bill:2021:4');
SELECT pg_temp.pair(5, 'bill:2021:5');
SELECT pg_temp.pair(7, 'bill:2021:7', replaces => false);
SELECT pg_temp.pair(8, 'bill:2021:8');
SELECT pg_temp.v2(130, 'Bill Passage Probability Index');                                                   -- no link_target
SELECT pg_temp.legacy(131, 'Bill Passage Probability Index', '{"link_target": "bill:2021:9"}');           -- legacy, a stray link_target
SELECT pg_temp.legacy(132, 'Bill Passage Probability Index', '{"document_key": "bill:2021:6"}');          -- legacy holder of bill:2021:6
SELECT pg_temp.v2(133, 'Bill Passage Probability Index', jsonb_build_object('link_target', 'bill:2021:6', 'replaces', pg_temp.id(132)), true);
UPDATE documents SET metadata = metadata - 'document_key' WHERE id = pg_temp.id(114);                    -- pair 7's old holds nothing

SELECT pg_temp.refused_token($q$SELECT pg_temp.swap(pg_temp.id(999), NULL)$q$, 'ingest_swap', 'not_found', 'swap refuses a document that does not exist');
SELECT pg_temp.refused_token($q$SELECT pg_temp.swap(pg_temp.id(130), NULL)$q$, 'ingest_swap', 'not_replacement', 'swap refuses a document without link_target');
SELECT pg_temp.refused_token($q$SELECT pg_temp.swap(pg_temp.id(131), NULL)$q$, 'ingest_swap', 'not_replacement', 'swap refuses a legacy document');
SELECT pg_temp.refused_token($q$SELECT pg_temp.swap(pg_temp.id(103), pg_temp.id(130))$q$, 'ingest_swap', 'stale', 'swap refuses an expected old document that is not the one replaced');
SELECT pg_temp.refused_token($q$SELECT pg_temp.swap(pg_temp.id(103), NULL)$q$, 'ingest_swap', 'stale', 'swap refuses a null expected old document when one is replaced');
SELECT pg_temp.refused_token($q$SELECT pg_temp.swap(pg_temp.id(115), pg_temp.id(114))$q$, 'ingest_swap', 'stale', 'swap refuses an expected old document for a replacement that names none');
SELECT pg_temp.refused_token($q$SELECT pg_temp.swap(pg_temp.id(105), pg_temp.id(104))$q$, 'ingest_swap', 'not_live', 'swap refuses a replacement that is not live yet');

SELECT pg_temp.keep('swap1', $q$pg_temp.swap(pg_temp.id(103), pg_temp.id(102), pg_temp.id(500))$q$, 'swap accepts a live replacement whose old document holds the key');
SELECT pg_temp.assert_true((SELECT r = jsonb_build_object('document_id', pg_temp.id(103), 'document_key', 'bill:2021:1', 'old_document_id', pg_temp.id(102)) FROM res WHERE k = 'swap1'),
                           'swap returns {document_id, document_key, old_document_id}');
SELECT pg_temp.assert_true(pg_temp.meta(pg_temp.id(102)) = '{"origin": "admin-upload"}', 'swap removes the key from the old document only');
SELECT pg_temp.assert_true(pg_temp.meta(pg_temp.id(103)) = '{"origin": "admin-upload", "document_key": "bill:2021:1"}',
                           'swap links the new document and removes its link_target and replaces');
SELECT pg_temp.assert_true(pg_temp.audit(pg_temp.id(103)) = jsonb_build_array(jsonb_build_object('actor', pg_temp.id(500), 'action', 'swap', 'key', 'bill:2021:1', 'old_key', NULL,
                             'detail', jsonb_build_object('old_document_id', pg_temp.id(102), 'replaces', pg_temp.id(102))))
                           AND pg_temp.audit(pg_temp.id(102)) = '[]',
                           'swap writes exactly one audit row, on the new document, naming the old one');
-- Pair 4: the old document was deleted in between (directly, so this does not depend on ingest_delete).
DELETE FROM documents WHERE id = pg_temp.id(108);
SELECT pg_temp.keep('swap4', $q$pg_temp.swap(pg_temp.id(109), pg_temp.id(108))$q$, 'swap accepts a replacement whose old document was deleted in between');
SELECT pg_temp.assert_true((SELECT r = jsonb_build_object('document_id', pg_temp.id(109), 'document_key', 'bill:2021:4', 'old_document_id', NULL) FROM res WHERE k = 'swap4')
                           AND pg_temp.meta(pg_temp.id(109)) = '{"origin": "admin-upload", "document_key": "bill:2021:4"}',
                           'swap links the new document directly when the old one was deleted in between');
-- Pair 5: the old document was unlinked in between.
SELECT pg_temp.unlink(pg_temp.id(110), 'bill:2021:5');
SELECT pg_temp.keep('swap5', $q$pg_temp.swap(pg_temp.id(111), pg_temp.id(110))$q$, 'swap accepts a replacement whose old document was unlinked in between');
SELECT pg_temp.assert_true((SELECT r->'old_document_id' = 'null' FROM res WHERE k = 'swap5')
                           AND pg_temp.meta(pg_temp.id(111))->>'document_key' = 'bill:2021:5',
                           'swap links the new document directly when the old one was unlinked in between');
-- Pair 7: no replaced document at all.
SELECT pg_temp.accepted($q$SELECT pg_temp.swap(pg_temp.id(115), NULL)$q$, 'swap links a replacement that names no old document');
-- A legacy holder is never modified.
SELECT pg_temp.keep('swap-legacy', $q$pg_temp.swap(pg_temp.id(133), pg_temp.id(132))$q$, 'swap accepts a replacement of a legacy holder');
SELECT pg_temp.assert_true((SELECT r->'old_document_id' = 'null' FROM res WHERE k = 'swap-legacy')
                           AND pg_temp.meta(pg_temp.id(132)) = '{"document_key": "bill:2021:6"}'
                           AND pg_temp.meta(pg_temp.id(133)) = '{"document_key": "bill:2021:6"}',
                           'swap over a legacy holder links the new document and leaves the legacy one untouched');
-- Pair 3: the old document was unlinked meanwhile and a third one took the key.
UPDATE documents SET metadata = metadata - 'document_key' WHERE id = pg_temp.id(106);
SELECT pg_temp.v2(134, 'Bill Passage Probability Index', '{"document_key": "bill:2021:3"}', true);
SELECT pg_temp.refused_token($q$SELECT pg_temp.swap(pg_temp.id(107), pg_temp.id(106))$q$, 'ingest_swap', 'key_held', 'swap refuses when the old document lost the key to another one');
-- Atomicity: the new document's update fails after the old one was unlinked.
-- (Fixture triggers are security definer: they fire inside the migration's functions, as their owner.)
CREATE FUNCTION pg_temp.block_new() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN IF NEW.id = pg_temp.id(117) THEN RAISE EXCEPTION 'blocked by the fixture'; END IF; RETURN NEW; END; $$;
CREATE TRIGGER fixture_block_new BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION pg_temp.block_new();
SELECT pg_temp.refused($q$SELECT pg_temp.swap(pg_temp.id(117), pg_temp.id(116))$q$, 'blocked by the fixture', 'a swap whose second update fails raises');
DROP TRIGGER fixture_block_new ON documents;
SELECT pg_temp.assert_true(pg_temp.meta(pg_temp.id(116))->>'document_key' = 'bill:2021:8'
                           AND pg_temp.meta(pg_temp.id(117))->>'link_target' = 'bill:2021:8'
                           AND pg_temp.audit(pg_temp.id(117)) = '[]',
                           'a swap that fails part-way leaves the old document holding the key and writes no audit row');

-- Delete.
SELECT pg_temp.v2(140, 'Bill Passage Probability Index', src => 'corpus:abc');                            -- an R7-style key
SELECT pg_temp.legacy(141, 'Bill Passage Probability Index', '{}', src => 'upload:legacy');               -- legacy, upload: key
SELECT pg_temp.v2(142, 'Bill Passage Probability Index', src => 'x-upload:abc');
SELECT pg_temp.refused_token($q$SELECT pg_temp.del(pg_temp.id(999))$q$, 'ingest_delete', 'not_found', 'delete refuses a document that does not exist');
SELECT pg_temp.refused_token($q$SELECT pg_temp.del(pg_temp.id(140))$q$, 'ingest_delete', 'not_deletable', 'delete refuses a document that is not an upload');
SELECT pg_temp.refused_token($q$SELECT pg_temp.del(pg_temp.id(141))$q$, 'ingest_delete', 'not_deletable', 'delete refuses a legacy document even with an upload: key');
SELECT pg_temp.refused_token($q$SELECT pg_temp.del(pg_temp.id(142))$q$, 'ingest_delete', 'not_deletable', 'delete refuses a key with upload: after its start');
-- The job log: every status change of a job, as the fixture sees it.
CREATE TEMP TABLE job_log (job uuid, old_status text, new_status text, claim_token uuid, lease_until timestamptz);
CREATE FUNCTION pg_temp.log_job() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN INSERT INTO job_log VALUES (NEW.id, OLD.status, NEW.status, NEW.claim_token, NEW.lease_until); RETURN NEW; END; $$;
CREATE TRIGGER fixture_log_job AFTER UPDATE ON ingest_jobs FOR EACH ROW EXECUTE FUNCTION pg_temp.log_job();
-- A linked, live upload with a failed and a queued job and every dependent row; a bystander.
SELECT pg_temp.v2(143, 'Bill Passage Probability Index', '{"document_key": "bill:2021:43"}', true);
SELECT pg_temp.job(pg_temp.id(143), 'failed', now() - interval '1 hour');
INSERT INTO res SELECT 'queued143', to_jsonb(pg_temp.job(pg_temp.id(143), 'queued'));
SELECT pg_temp.v2(144, 'Bill Passage Probability Index', '{}', false);
INSERT INTO res SELECT 'running144', to_jsonb(pg_temp.job(pg_temp.id(144), 'running'));
SELECT pg_temp.v2(145, 'Bill Passage Probability Index');
SELECT pg_temp.job(pg_temp.id(145), 'queued');
CREATE FUNCTION pg_temp.seed(doc uuid, n int) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.document_pages (document_id, extract_hash, page_number, text, char_from, char_to) VALUES (doc, 'x' || n, 1, 'page one', 0, 8);
  INSERT INTO public.document_page_blocks (document_id, extract_hash, page_number, block_index, type, content) VALUES (doc, 'x' || n, 1, 0, 'text', 'page one');
  INSERT INTO public.document_page_images (document_id, extract_hash, page_number, placeholder, sha256, mime, storage_path)
    VALUES (doc, 'x' || n, 1, 'img:1-1', pg_temp.h(1000 + n), 'image/png', 'img/' || pg_temp.h(1000 + n) || '.png');
  INSERT INTO public.document_chunks (document_id, chunk_hash, chunk_index, source_kind, page_number, char_from, char_to, content, chunker_version)
    VALUES (doc, 'c-' || n, 0, 'pdf_page', 1, 0, 8, 'page one', 3);
  INSERT INTO public.document_files (document_id, part_index, page_offset, page_count, sha256, byte_size, storage_path)
    VALUES (doc, 0, 0, 4, pg_temp.h(n), 100, 'files/' || pg_temp.h(n) || '.pdf');
  INSERT INTO public.document_ocr_pages (document_id, ocr_hash, page_number, raw) VALUES (doc, 'o' || n, 1, '{"index": 0}');
$$;
CREATE FUNCTION pg_temp.rows_of(doc uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'documents',            (SELECT count(*) FROM public.documents            WHERE id = doc),
    'document_pages',       (SELECT count(*) FROM public.document_pages       WHERE document_id = doc),
    'document_page_blocks', (SELECT count(*) FROM public.document_page_blocks WHERE document_id = doc),
    'document_page_images', (SELECT count(*) FROM public.document_page_images WHERE document_id = doc),
    'document_chunks',      (SELECT count(*) FROM public.document_chunks      WHERE document_id = doc),
    'document_files',       (SELECT count(*) FROM public.document_files       WHERE document_id = doc),
    'document_ocr_pages',   (SELECT count(*) FROM public.document_ocr_pages   WHERE document_id = doc),
    'ingest_jobs',          (SELECT count(*) FROM public.ingest_jobs          WHERE document_id = doc))
$$;
SELECT pg_temp.seed(pg_temp.id(143), 143);
SELECT pg_temp.seed(pg_temp.id(145), 145);
INSERT INTO storage.objects (bucket_id, name, metadata)
  VALUES ('corpus', 'files/' || pg_temp.h(143) || '.pdf', '{"size": 100, "mimetype": "application/pdf"}'),
         ('corpus', 'img/' || pg_temp.h(1143) || '.png', '{"size": 10, "mimetype": "image/png"}');
CREATE TEMP TABLE before AS SELECT pg_temp.rows_of(pg_temp.id(143)) AS target, pg_temp.rows_of(pg_temp.id(145)) AS bystander;
SELECT pg_temp.assert_true((SELECT target = '{"documents": 1, "document_pages": 1, "document_page_blocks": 1, "document_page_images": 1, "document_chunks": 1,
                                              "document_files": 1, "document_ocr_pages": 1, "ingest_jobs": 2}'::jsonb
                                   AND bystander = target || '{"ingest_jobs": 1}' FROM before),
                           '(fixture) before the delete every dependent table holds rows for the seeded documents');
SELECT pg_temp.keep('del143', $q$pg_temp.del(pg_temp.id(143), pg_temp.id(503))$q$, 'delete accepts a live, linked upload with a queued job');
SELECT pg_temp.assert_true((SELECT r = '{"deleted": true}' FROM res WHERE k = 'del143'), 'delete returns {"deleted": true}');
SELECT pg_temp.assert_true((SELECT jsonb_agg(jsonb_build_array(old_status, new_status, claim_token, lease_until)) FROM job_log
                             WHERE job = (SELECT (r #>> '{}')::uuid FROM res WHERE k = 'queued143')) = '[["queued", "cancelled", null, null]]',
                           'delete cancels the queued job before deleting');
SELECT pg_temp.assert_true((SELECT bool_and((pg_temp.rows_of(pg_temp.id(143))->>t)::int = 0)
                              FROM unnest(array['documents', 'document_pages', 'document_page_blocks', 'document_page_images', 'document_chunks',
                                                'document_files', 'document_ocr_pages', 'ingest_jobs']) t),
                           'delete cascades to pages, blocks, images, chunks, files, raw OCR and jobs');
SELECT pg_temp.assert_true((SELECT pg_temp.rows_of(pg_temp.id(145)) = bystander FROM before), 'delete leaves every other document''s rows untouched');
SELECT pg_temp.assert_true((SELECT count(*) FROM storage.objects WHERE name IN ('files/' || pg_temp.h(143) || '.pdf', 'img/' || pg_temp.h(1143) || '.png')) = 2,
                           'delete leaves the stored objects for the sweeper');
SELECT pg_temp.assert_true(pg_temp.audit(pg_temp.id(143)) = jsonb_build_array(jsonb_build_object('actor', pg_temp.id(503), 'action', 'delete', 'key', NULL, 'old_key', 'bill:2021:43',
                             'detail', jsonb_build_object('source_key', 'upload:' || pg_temp.h(143), 'file_sha256', pg_temp.h(143), 'link_target', NULL,
                                                          'cancelled_job', (SELECT r #>> '{}' FROM res WHERE k = 'queued143')))),
                           'delete writes one audit row with the released key and the cancelled job');
SELECT pg_temp.del(pg_temp.id(144));
SELECT pg_temp.assert_true((SELECT jsonb_agg(jsonb_build_array(old_status, new_status, claim_token, lease_until)) FROM job_log
                             WHERE job = (SELECT (r #>> '{}')::uuid FROM res WHERE k = 'running144')) = '[["running", "cancelled", null, null]]'
                           AND NOT EXISTS (SELECT FROM documents WHERE id = pg_temp.id(144)),
                           'delete cancels a running job (its claim cleared) and deletes a document that never went live');
DROP TRIGGER fixture_log_job ON ingest_jobs;

-- Discard: the new signature and its audit row; the old rules unchanged.
SELECT pg_temp.v2(150, 'Bill Passage Probability Index', '{"link_target": "bill:2021:50"}');
SELECT pg_temp.job(pg_temp.id(150), 'failed');
SELECT pg_temp.v2(151, 'Bill Passage Probability Index');
SELECT pg_temp.job(pg_temp.id(151), 'cancelled');
SELECT pg_temp.v2(152, 'Bill Passage Probability Index', indexed => true);
CREATE FUNCTION pg_temp.discard(doc uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb; BEGIN SET LOCAL ROLE service_role; r := public.ingest_discard(doc); RESET ROLE; RETURN r; END; $$;
CREATE FUNCTION pg_temp.discard(doc uuid, actor uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb; BEGIN SET LOCAL ROLE service_role; r := public.ingest_discard(doc, actor); RESET ROLE; RETURN r; END; $$;
SELECT pg_temp.refused($q$SELECT pg_temp.discard(pg_temp.id(140))$q$, 'ingest_discard: not an upload', 'discard still refuses a document that is not an upload');
SELECT pg_temp.refused($q$SELECT pg_temp.discard(pg_temp.id(152))$q$, 'ingest_discard: already live', 'discard still refuses a live document');
SELECT pg_temp.keep('discard150', $q$pg_temp.discard(pg_temp.id(150), pg_temp.id(504))$q$, 'discard accepts an actor');
SELECT pg_temp.assert_true((SELECT r = '{"discarded": true}' FROM res WHERE k = 'discard150') AND NOT EXISTS (SELECT FROM documents WHERE id = pg_temp.id(150)),
                           'discard with an actor discards and returns {"discarded": true}');
SELECT pg_temp.assert_true(pg_temp.audit(pg_temp.id(150)) = jsonb_build_array(jsonb_build_object('actor', pg_temp.id(504), 'action', 'discard', 'key', NULL, 'old_key', NULL,
                             'detail', jsonb_build_object('source_key', 'upload:' || pg_temp.h(150), 'file_sha256', pg_temp.h(150), 'link_target', 'bill:2021:50'))),
                           'discard writes one audit row with its actor');
SELECT pg_temp.accepted($q$SELECT pg_temp.discard(pg_temp.id(151))$q$, 'discard accepts the old one-argument call');
SELECT pg_temp.assert_true((SELECT jsonb_agg(jsonb_build_array(action, actor)) FROM corpus_admin_actions WHERE document_id = pg_temp.id(151)) = '[["discard", null]]',
                           'discard without an actor (the old one-argument call) still works and is audited');
ROLLBACK;

-- ===== 4. ingest_register's link fields =====
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TEMP TABLE res (k text PRIMARY KEY, r jsonb);
SELECT pg_temp.drow('national', 'Bill Passage Probability Index', 'g1', 'bill:2022:1', 'G1');
SELECT pg_temp.drow('national', 'Bill Passage Probability Index', 'g2', 'bill:2022:2', 'G2');
SELECT pg_temp.drow('national', 'Bill Passage Probability Index', 'g3', 'bill:2022:3', 'G3');
SELECT pg_temp.drow('national', 'Bill Passage Probability Index', 'g4', 'bill:2022:4', 'G4');
SELECT pg_temp.drow('national', 'Policy Intelligence Graph', 'g9', 'bill:2022:9', 'G9');
SELECT pg_temp.drow('national', 'Policy Intelligence Graph', 'g8', 'bill:2022:8', 'G8');
INSERT INTO auth.users (id, email) VALUES (pg_temp.id(600), 'records-admin@example.test');   -- requested_by (actors have no foreign key)
-- input(n): an admin upload of object n, with `extra` merged in.
CREATE FUNCTION pg_temp.input(n int, extra jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('source_key', 'upload:' || pg_temp.h(n), 'title', 'Upload ' || n, 'desk_tier', 'national',
                            'desk_feature', 'Bill Passage Probability Index', 'file_name', 'u' || n || '.pdf',
                            'metadata', '{"origin": "admin-upload"}'::jsonb, 'file_sha256', pg_temp.h(n), 'page_count', 2,
                            'requested_by', pg_temp.id(600),
                            'files', jsonb_build_array(jsonb_build_object('part_index', 0, 'page_offset', 0, 'page_count', 2, 'sha256', pg_temp.h(n),
                                                                          'byte_size', 1000, 'storage_path', 'files/' || pg_temp.h(n) || '.pdf')))
         || extra
$$;
CREATE FUNCTION pg_temp.doc_of(n int) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM documents WHERE source_key = 'upload:' || pg_temp.h(n) $$;
CREATE FUNCTION pg_temp.fail_job(n int) RETURNS void LANGUAGE sql AS $$
  UPDATE ingest_jobs SET status = 'failed', finished_at = now() WHERE document_id = pg_temp.doc_of(n) AND status = 'queued'
$$;
INSERT INTO storage.objects (bucket_id, name, metadata)
  SELECT 'corpus', 'files/' || pg_temp.h(n) || '.pdf', '{"size": 1000, "mimetype": "application/pdf"}' FROM generate_series(1, 40) n;
CREATE FUNCTION pg_temp.desk(k text, extra jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('document_key', k, 'key_check', 'desk', 'actor', pg_temp.id(601)) || extra
$$;

-- Without link fields: as before.
SELECT pg_temp.keep('plain', $q$pg_temp.register(pg_temp.input(1))$q$, 'register accepts a registration without link fields');
SELECT pg_temp.assert_true((SELECT array(SELECT jsonb_object_keys(r) ORDER BY 1) = array['document_id', 'job_id', 'resumed', 'status'] FROM res WHERE k = 'plain')
                           AND pg_temp.meta(pg_temp.doc_of(1)) = '{"origin": "admin-upload"}'
                           AND pg_temp.audit(pg_temp.doc_of(1)) = '[]',
                           'a registration without link fields keeps its result keys and metadata, and writes no audit row');
-- The admin path.
SELECT pg_temp.keep('admin', $q$pg_temp.register(pg_temp.input(2, pg_temp.desk('bill:2022:1')))$q$, 'register accepts an admin key that no document holds');
SELECT pg_temp.assert_true((SELECT r - 'document_id' - 'job_id' = '{"status": "queued", "resumed": false, "linked": true, "document_key": "bill:2022:1", "link_target": null}'
                              FROM res WHERE k = 'admin'),
                           'an admin registration with a free key reports it linked');
SELECT pg_temp.assert_true(pg_temp.meta(pg_temp.doc_of(2)) = '{"origin": "admin-upload", "document_key": "bill:2022:1"}', 'the admin registration stores the key');
SELECT pg_temp.assert_true(pg_temp.audit(pg_temp.doc_of(2)) = jsonb_build_array(jsonb_build_object('actor', pg_temp.id(601), 'action', 'attach', 'key', 'bill:2022:1', 'old_key', NULL,
                             'detail', '{"linked": true, "link_target": null, "replaces": null, "resumed": false}'::jsonb)),
                           'an admin registration writes one attach audit row with its actor');
SELECT pg_temp.accepted($q$SELECT pg_temp.register(pg_temp.input(3, pg_temp.desk('bill:2022:9')))$q$,
                        'an admin registration on the Bill Passage desk accepts a key only the Policy Intelligence Graph has');
SELECT pg_temp.refused_token($q$SELECT pg_temp.register(pg_temp.input(4, pg_temp.desk('bill:2099:1')))$q$, 'ingest_register', 'wrong_desk',
                             'an admin registration refuses a key no desk row has');
SELECT pg_temp.refused_token($q$SELECT pg_temp.register(pg_temp.input(4, pg_temp.desk('bill:2022:2') || '{"desk_feature": "Budget at a Glance"}'))$q$, 'ingest_register', 'wrong_desk',
                             'an admin registration refuses a bill key on a desk without keys');
SELECT pg_temp.refused_token($q$SELECT pg_temp.register(pg_temp.input(4, pg_temp.desk('bill:2022:1')))$q$, 'ingest_register', 'key_held',
                             'an admin registration refuses a key another ingestion-v2 document holds');
SELECT pg_temp.refused_token($q$SELECT pg_temp.register(pg_temp.input(4, pg_temp.desk('bill:2022:1', jsonb_build_object('replaces', pg_temp.doc_of(3)))))$q$, 'ingest_register', 'key_held',
                             'an admin replacement refuses a held key when replaces names another document');
SELECT pg_temp.keep('replace', $q$pg_temp.register(pg_temp.input(5, pg_temp.desk('bill:2022:1', jsonb_build_object('replaces', pg_temp.doc_of(2)))))$q$, 'register accepts an admin replacement of the key''s holder');
SELECT pg_temp.assert_true((SELECT r->'linked' = 'false' AND r->'document_key' = 'null' AND r->>'link_target' = 'bill:2022:1' FROM res WHERE k = 'replace')
                           AND pg_temp.meta(pg_temp.doc_of(5)) = jsonb_build_object('origin', 'admin-upload', 'link_target', 'bill:2022:1', 'replaces', pg_temp.doc_of(2))
                           AND pg_temp.meta(pg_temp.doc_of(2))->>'document_key' = 'bill:2022:1',
                           'an admin replacement of the holder registers unlinked with link_target and replaces');
SELECT pg_temp.assert_true(pg_temp.audit(pg_temp.doc_of(5)) = jsonb_build_array(jsonb_build_object('actor', pg_temp.id(601), 'action', 'attach', 'key', NULL, 'old_key', NULL,
                             'detail', jsonb_build_object('linked', false, 'link_target', 'bill:2022:1', 'replaces', pg_temp.doc_of(2), 'resumed', false))),
                           'a pending replacement is audited with its target');
-- The script path (no key_check).
SELECT pg_temp.keep('script-held', $q$pg_temp.register(pg_temp.input(6, '{"document_key": "bill:2022:1"}'))$q$, 'register accepts a script key that is held');
SELECT pg_temp.assert_true((SELECT r - 'document_id' - 'job_id' = '{"status": "queued", "resumed": false, "linked": false, "document_key": null, "link_target": "bill:2022:1"}'
                              FROM res WHERE k = 'script-held')
                           AND pg_temp.meta(pg_temp.doc_of(6)) = '{"origin": "admin-upload", "link_target": "bill:2022:1"}',
                           'a script registration of a held key registers unlinked with link_target and says so');
SELECT pg_temp.assert_true((SELECT actor FROM corpus_admin_actions WHERE document_id = pg_temp.doc_of(6)) = pg_temp.id(600),
                           'without an actor the audit row names requested_by');
SELECT pg_temp.keep('script-meta-held', $q$pg_temp.register(pg_temp.input(7) || '{"metadata": {"origin": "r7", "document_key": "bill:2022:1"}}')$q$, 'register accepts a held key given in metadata');
SELECT pg_temp.assert_true(pg_temp.meta(pg_temp.doc_of(7)) = '{"origin": "r7", "link_target": "bill:2022:1"}',
                           'a held key given in metadata (the scripts'' form) also registers unlinked');
SELECT pg_temp.keep('script-free', $q$pg_temp.register(pg_temp.input(8) || '{"metadata": {"origin": "r7", "document_key": "nodesk:1"}}')$q$, 'register accepts a script key no desk row has');
SELECT pg_temp.assert_true((SELECT r->'linked' = 'true' FROM res WHERE k = 'script-free')
                           AND pg_temp.meta(pg_temp.doc_of(8)) = '{"origin": "r7", "document_key": "nodesk:1"}',
                           'a script may link a key no desk row has (D8)');
-- Malformed link fields.
SELECT pg_temp.refused($q$SELECT pg_temp.register(pg_temp.input(9, '{"document_key": "bill:2022:3", "metadata": {"document_key": "bill:2022:4"}}'))$q$,
                       'document_key is given at the top level and in metadata with different values', 'register refuses two different keys');
SELECT pg_temp.refused($q$SELECT pg_temp.register(pg_temp.input(9, '{"key_check": "loose", "document_key": "bill:2022:3"}'))$q$,
                       'key_check must be', 'register refuses an unknown key_check');
SELECT pg_temp.refused($q$SELECT pg_temp.register(pg_temp.input(9, '{"replaces": "c0000000-0000-4000-8000-000000000001"}'))$q$,
                       'replaces needs document_key', 'register refuses replaces without a key');
SELECT pg_temp.refused($q$SELECT pg_temp.register(pg_temp.input(9, '{"document_key": "bill:2022:3", "replaces": "not-a-uuid"}'))$q$,
                       'replaces must be a document id', 'register refuses a replaces that is not an id');
SELECT pg_temp.refused($q$SELECT pg_temp.register(pg_temp.input(9, '{"document_key": "bill:2022:3", "link_target": "bill:2022:4"}'))$q$,
                       'document_key and link_target differ', 'register refuses a key and a different link_target');
SELECT pg_temp.refused($q$SELECT pg_temp.register(pg_temp.input(9, '{"no_public_source": "yes"}'))$q$,
                       'no_public_source must be a boolean', 'register refuses a no_public_source that is not a boolean');
SELECT pg_temp.keep('nps', $q$pg_temp.register(pg_temp.input(10, '{"no_public_source": true}'))$q$, 'register accepts no_public_source true');
SELECT pg_temp.keep('nps-false', $q$pg_temp.register(pg_temp.input(11, '{"no_public_source": false}'))$q$, 'register accepts no_public_source false');
SELECT pg_temp.assert_true(pg_temp.meta(pg_temp.doc_of(10)) = '{"origin": "admin-upload", "no_public_source": true}'
                           AND pg_temp.meta(pg_temp.doc_of(11)) = '{"origin": "admin-upload"}'
                           AND (SELECT array(SELECT jsonb_object_keys(r) ORDER BY 1) FROM res WHERE k = 'nps') = array['document_id', 'job_id', 'resumed', 'status'],
                           'no_public_source true is stored in metadata; false is not');

-- Resume (a failed job, the same file).
SELECT pg_temp.register(pg_temp.input(20));
SELECT pg_temp.fail_job(20);
SELECT pg_temp.keep('resume-apply', $q$pg_temp.register(pg_temp.input(20, pg_temp.desk('bill:2022:2')))$q$, 'resume accepts a new admin key for a document without one');
SELECT pg_temp.assert_true((SELECT r - 'document_id' - 'job_id' = '{"status": "queued", "resumed": true, "linked": true, "document_key": "bill:2022:2", "link_target": null}'
                              FROM res WHERE k = 'resume-apply')
                           AND pg_temp.meta(pg_temp.doc_of(20)) = '{"origin": "admin-upload", "document_key": "bill:2022:2"}'
                           AND (SELECT status FROM ingest_jobs WHERE document_id = pg_temp.doc_of(20)) = 'queued',
                           'resume applies a new key to a document without one and re-queues the job');
SELECT pg_temp.assert_true(pg_temp.audit(pg_temp.doc_of(20)) = jsonb_build_array(jsonb_build_object('actor', pg_temp.id(601), 'action', 'attach', 'key', 'bill:2022:2', 'old_key', NULL,
                             'detail', '{"linked": true, "link_target": null, "replaces": null, "resumed": true}'::jsonb)),
                           'a resume that applies a key is audited as resumed');
SELECT pg_temp.fail_job(20);
SELECT pg_temp.refused_token($q$SELECT pg_temp.register(pg_temp.input(20, pg_temp.desk('bill:2022:3')))$q$, 'ingest_register', 'conflict',
                             'resume refuses a different key for a linked document');
SELECT pg_temp.refused_token($q$SELECT pg_temp.register(pg_temp.input(20, pg_temp.desk('bill:2022:2', jsonb_build_object('replaces', pg_temp.doc_of(2)))))$q$, 'ingest_register', 'conflict',
                             'resume refuses replaces for a linked document');
SELECT pg_temp.refused_token($q$SELECT pg_temp.register(pg_temp.input(20, pg_temp.desk('bill:2022:2', '{"desk_feature": "Policy Intelligence Graph"}')))$q$, 'ingest_register', 'conflict',
                             'resume refuses an admin key under another desk than the document''s');
SELECT pg_temp.keep('resume-same', $q$pg_temp.register(pg_temp.input(20, pg_temp.desk('bill:2022:2')))$q$, 'resume accepts the document''s own key');
SELECT pg_temp.assert_true((SELECT r->'linked' = 'true' AND r->'resumed' = 'true' FROM res WHERE k = 'resume-same')
                           AND jsonb_array_length(pg_temp.audit(pg_temp.doc_of(20))) = 1,
                           'resume with the document''s own key is accepted without a new audit row');
SELECT pg_temp.fail_job(20);
SELECT pg_temp.accepted($q$SELECT pg_temp.register(pg_temp.input(20, pg_temp.desk('bill:2022:2', '{"desk_feature": "bill passage  probability-index"}')))$q$,
                        'resume compares the document''s desk normalised');
SELECT pg_temp.fail_job(20);
SELECT pg_temp.accepted($q$SELECT pg_temp.register(pg_temp.input(20))$q$, 'resume without link fields leaves a linked document as it is');
SELECT pg_temp.assert_true(pg_temp.meta(pg_temp.doc_of(20))->>'document_key' = 'bill:2022:2', 'the resumed document keeps its key');
-- A held key on resume.
SELECT pg_temp.register(pg_temp.input(21));
SELECT pg_temp.fail_job(21);
SELECT pg_temp.refused_token($q$SELECT pg_temp.register(pg_temp.input(21, pg_temp.desk('bill:2022:1')))$q$, 'ingest_register', 'key_held',
                             'resume refuses an admin key another document holds');
SELECT pg_temp.keep('resume-script', $q$pg_temp.register(pg_temp.input(21, '{"document_key": "bill:2022:1"}'))$q$, 'resume accepts a held key on the script path');
SELECT pg_temp.assert_true((SELECT r->'linked' = 'false' AND r->>'link_target' = 'bill:2022:1' FROM res WHERE k = 'resume-script')
                           AND pg_temp.meta(pg_temp.doc_of(21)) = '{"origin": "admin-upload", "link_target": "bill:2022:1"}',
                           'resume on the script path registers a held key as link_target');
SELECT pg_temp.fail_job(21);
SELECT pg_temp.accepted($q$SELECT pg_temp.register(pg_temp.input(21, '{"document_key": "bill:2022:1"}'))$q$, 'resume with a pending document''s own target is accepted');
SELECT pg_temp.fail_job(21);
SELECT pg_temp.refused_token($q$SELECT pg_temp.register(pg_temp.input(21, pg_temp.desk('bill:2022:1')))$q$, 'ingest_register', 'key_held',
                             'resume re-checks a pending target on the admin path');
SELECT pg_temp.refused_token($q$SELECT pg_temp.register(pg_temp.input(21, '{"document_key": "bill:2022:4"}'))$q$, 'ingest_register', 'conflict',
                             'resume refuses another key for a pending document');
SELECT pg_temp.keep('resume-nps', $q$pg_temp.register(pg_temp.input(21, '{"no_public_source": true}'))$q$, 'resume accepts no_public_source');
SELECT pg_temp.assert_true(pg_temp.meta(pg_temp.doc_of(21)) = '{"origin": "admin-upload", "link_target": "bill:2022:1", "no_public_source": true}',
                           'resume adds no_public_source');
ROLLBACK;

-- ===== 5. admin_desk_records and admin_unlinked_documents =====
BEGIN;
SET LOCAL search_path = public, extensions;
-- Seventeen keys on the Bill Passage desk; the date sorts them.
SELECT pg_temp.drow('national', 'Bill Passage Probability Index', 'k1a', 'bill:2030:1', 'K1 first', '2030-01-05 19:00:00');
SELECT pg_temp.drow('national', 'Bill Passage Probability Index', 'k1b', 'bill:2030:1', 'K1 second', '2030-03-01 19:00:00', 'Rajya Sabha', 'shared row');
SELECT pg_temp.drow('national', 'Bill Passage Probability Index', 'k' || n, 'bill:2030:' || n, 'K' || n, '2030-02-' || lpad((n - 1)::text, 2, '0') || ' 19:00:00')
  FROM generate_series(2, 11) n;
SELECT pg_temp.drow('national', 'Bill Passage Probability Index', 'k12', 'bill:2030:12', 'K12', '2030-01-01', extra => 'growth 50% target');
SELECT pg_temp.drow('national', 'Bill Passage Probability Index', 'k13', 'bill:2030:13', 'K13', '2030-01-02', extra => 'growth 50 percent');
SELECT pg_temp.drow('national', 'Bill Passage Probability Index', 'k14', 'bill:2030:14', 'K14', '2030-01-03', extra => 'code a_b');
SELECT pg_temp.drow('national', 'Bill Passage Probability Index', 'k15', 'bill:2030:15', 'K15', NULL, extra => 'code axb');
SELECT pg_temp.drow('national', 'Bill Passage Probability Index', 'k16', 'bill:2030:16', 'K16', '2030-01-04', extra => 'back\slash', date_field => 'date');
SELECT pg_temp.drow('national', 'Bill Passage Probability Index', 'k17', 'bill:2030:17', 'K17', NULL, extra => 'backslash');
SELECT pg_temp.drow('national', 'Bill Passage Probability Index', 'nokey', NULL, 'No key');                     -- a row without a key
SELECT pg_temp.drow('national', 'Policy Intelligence Graph', 'k20', 'bill:2030:20', 'K20', '2031-01-01');      -- only in the graph
SELECT pg_temp.drow('national', 'Budget at a Glance', 'b1', NULL, 'Budget');
SELECT pg_temp.drow('national', 'Regulators (RBI / SEBI / TRAI / CCI)', 'g1', 'reg:1', 'Regulator');
-- Documents.
SELECT pg_temp.legacy(201, 'Bill Passage Probability Index', '{"document_key": "bill:2030:2"}');               -- K2 full_text_legacy
SELECT pg_temp.v2(202, 'Bill Passage Probability Index', '{"document_key": "bill:2030:3"}', true);           -- K3 full_text
SELECT pg_temp.job(pg_temp.id(202), 'succeeded');
SELECT pg_temp.v2(203, 'Bill Passage Probability Index', '{"document_key": "bill:2030:4"}');                 -- K4 failed (latest job)
SELECT pg_temp.job(pg_temp.id(203), 'cancelled', now() - interval '2 hours');
SELECT pg_temp.job(pg_temp.id(203), 'failed', now() - interval '1 hour', 'boom');
SELECT pg_temp.legacy(204, 'Bill Passage Probability Index', '{"document_key": "bill:2030:5"}');               -- K5 processing over legacy
SELECT pg_temp.v2(205, 'Bill Passage Probability Index', '{"document_key": "bill:2030:5"}');
SELECT pg_temp.job(pg_temp.id(205), 'queued');
SELECT pg_temp.v2(206, 'Bill Passage Probability Index', '{"document_key": "bill:2030:6"}', true);           -- K6 failed over full_text
SELECT pg_temp.job(pg_temp.id(206), 'succeeded');
SELECT pg_temp.v2(207, 'Bill Passage Probability Index', jsonb_build_object('link_target', 'bill:2030:6', 'replaces', pg_temp.id(206)));
SELECT pg_temp.job(pg_temp.id(207), 'failed');
SELECT pg_temp.v2(208, 'Bill Passage Probability Index', '{"document_key": "bill:2030:7"}');                 -- K7 failed (cancelled)
SELECT pg_temp.job(pg_temp.id(208), 'cancelled');
SELECT pg_temp.v2(209, 'Bill Passage Probability Index', '{"document_key": "bill:2030:8"}');                 -- K8 processing (latest job queued)
SELECT pg_temp.job(pg_temp.id(209), 'failed', now() - interval '1 hour');
SELECT pg_temp.job(pg_temp.id(209), 'queued');
SELECT pg_temp.legacy(210, 'Bill Passage Probability Index', '{"document_key": "bill:2030:9"}', false);        -- K9 record_only (legacy, not indexed)
SELECT pg_temp.v2(211, 'Bill Passage Probability Index', '{"document_key": "bill:2030:10"}', true);          -- K10 full_text over legacy
SELECT pg_temp.job(pg_temp.id(211), 'succeeded');
SELECT pg_temp.legacy(212, 'Bill Passage Probability Index', '{"document_key": "bill:2030:10"}');
SELECT pg_temp.v2(213, 'Bill Passage Probability Index', '{"document_key": "bill:2030:11"}');                -- K11 processing over failed
SELECT pg_temp.job(pg_temp.id(213), 'failed');
SELECT pg_temp.v2(214, 'Bill Passage Probability Index', jsonb_build_object('link_target', 'bill:2030:11', 'replaces', pg_temp.id(213)));
SELECT pg_temp.job(pg_temp.id(214), 'queued');
SELECT pg_temp.v2(215, 'Bill Passage Probability Index', '{"document_key": "bill:2030:99"}');                -- orphaned
SELECT pg_temp.v2(216, 'Policy Intelligence Graph', '{"document_key": "bill:2030:98"}');                     -- orphaned, the other bill feature
SELECT pg_temp.v2(217, 'Budget at a Glance', '{"document_key": "bill:2030:97"}');                            -- orphaned on another desk
SELECT pg_temp.legacy(218, 'Bill Passage Probability Index', '{"document_key": "bill:2030:96"}');               -- legacy, not counted
SELECT pg_temp.v2(219, 'Bill Passage Probability Index', '{"document_key": "bill:2030:20"}', true);          -- key only in the graph: not orphaned
SELECT pg_temp.v2(220, 'Bill Passage Probability Index', title => 'Budget 100% note');
SELECT pg_temp.v2(221, 'Policy Intelligence Graph');
SELECT pg_temp.v2(222, 'Budget at a Glance');
SELECT pg_temp.v2(223, 'Bill Passage Probability Index', title => 'Budget 100 percent note');
SELECT pg_temp.v2(228, 'Bill Passage Probability Index', '{"document_key": "bill:2030:12", "link_target": "bill:2030:13"}');  -- hand-edited: a key and a target
SELECT pg_temp.v2(224, 'Bill Passage Probability Index', '{"document_key": "bill:2030:95"}', tier => 'state'); -- another tier: not orphaned here
SELECT pg_temp.v2(225, 'Regulators (RBI/SEBI/TRAI/CCI)');                                                  -- corpus spelling, no key
SELECT pg_temp.v2(226, 'Regulators (RBI/SEBI/TRAI/CCI)', '{"document_key": "reg:99"}');                    -- corpus spelling, orphaned
SELECT pg_temp.v2(227, 'Regulators (RBI/SEBI/TRAI/CCI)', '{"document_key": "reg:1"}', true);               -- corpus spelling, linked

CREATE FUNCTION pg_temp.bppi(q text DEFAULT NULL, s text DEFAULT NULL, l int DEFAULT 50, o int DEFAULT 0) RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_temp.records('Bill Passage Probability Index', q, s, l, o)
$$;
CREATE FUNCTION pg_temp.keys(r jsonb) RETURNS text[] LANGUAGE sql AS $$
  SELECT coalesce(array_agg(e->>'document_key' ORDER BY i), '{}') FROM jsonb_array_elements(r->'records') WITH ORDINALITY t(e, i)
$$;
CREATE FUNCTION pg_temp.rec(key text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT e FROM jsonb_array_elements(pg_temp.bppi()->'records') e WHERE e->>'document_key' = key
$$;
CREATE TEMP TABLE all_keys AS SELECT array['bill:2030:1', 'bill:2030:11', 'bill:2030:10', 'bill:2030:9', 'bill:2030:8', 'bill:2030:7', 'bill:2030:6',
  'bill:2030:5', 'bill:2030:4', 'bill:2030:3', 'bill:2030:2', 'bill:2030:16', 'bill:2030:14', 'bill:2030:13', 'bill:2030:12', 'bill:2030:15', 'bill:2030:17'] AS k;

SELECT pg_temp.assert_true(array(SELECT jsonb_object_keys(pg_temp.bppi()) ORDER BY 1) = array['coverage', 'records', 'total']
                           AND array(SELECT jsonb_object_keys(pg_temp.rec('bill:2030:6')) ORDER BY 1) = array['document_key', 'documents', 'rows', 'source_hint', 'status']
                           AND array(SELECT jsonb_object_keys(pg_temp.rec('bill:2030:6')->'rows'->0) ORDER BY 1) = array['date', 'house', 'row_key', 'title']
                           AND array(SELECT jsonb_object_keys(pg_temp.rec('bill:2030:6')->'documents'->0) ORDER BY 1) = array['document_id', 'indexed', 'job', 'legacy', 'link_target', 'source_key', 'title']
                           AND array(SELECT jsonb_object_keys(pg_temp.rec('bill:2030:6')->'documents'->0->'job') ORDER BY 1) = array['error_code', 'stage', 'status'],
                           'records has the RecordsResult shape (records, total, coverage; DeskRecord, RecordRow, RecordDocument, JobSummary)');
SELECT pg_temp.assert_true(pg_temp.rec('bill:2030:16')->'rows'->0->>'date' = '2030-01-04', 'a row''s date falls back to row->>''date''');
SELECT pg_temp.assert_true(pg_temp.rec('bill:2030:4')->'documents'->0->'job' = '{"status": "failed", "stage": "ocr", "error_code": "boom"}',
                           'a document''s job is its latest one');
SELECT pg_temp.assert_true(pg_temp.rec('bill:2030:5')->'documents' = jsonb_build_array(
    jsonb_build_object('document_id', pg_temp.id(205), 'title', 'Doc 205', 'source_key', 'upload:' || pg_temp.h(205), 'legacy', false, 'indexed', false,
                       'job', '{"status": "queued", "stage": "ocr", "error_code": null}'::jsonb, 'link_target', NULL),
    jsonb_build_object('document_id', pg_temp.id(204), 'title', 'Legacy 204', 'source_key', 'legacy-204', 'legacy', true, 'indexed', true, 'job', NULL,
                       'link_target', NULL)),
  'a record lists every document holding its key, ingestion-v2 first, with the latest job or null');
SELECT pg_temp.assert_true((SELECT array_agg(e->>'document_id' ORDER BY i) FROM jsonb_array_elements(pg_temp.rec('bill:2030:6')->'documents') WITH ORDINALITY t(e, i))
                           = array[pg_temp.id(206)::text, pg_temp.id(207)::text],
                           'a record lists a replacement targeting its key after the holder');
SELECT pg_temp.assert_true((SELECT array_agg(coalesce(e->>'link_target', '-') ORDER BY i) FROM jsonb_array_elements(pg_temp.rec('bill:2030:6')->'documents') WITH ORDINALITY t(e, i))
                           = array['-', 'bill:2030:6']
                           AND (SELECT array_agg(coalesce(e->>'link_target', '-') ORDER BY i) FROM jsonb_array_elements(pg_temp.rec('bill:2030:12')->'documents') WITH ORDINALITY t(e, i))
                           = array['-'],
                           'a record document''s link_target marks a replacement waiting to swap in; a document holding the key has none');
SELECT pg_temp.assert_true(pg_temp.keys(pg_temp.records('Policy Intelligence Graph')) = array['bill:2030:20']
                           AND pg_temp.records('Policy Intelligence Graph')->'coverage' = '{"keys": 1, "full_text": 1, "orphaned": 2}',
                           'the Policy Intelligence Graph lists its own rows and shares the bill desks'' orphaned links');
SELECT pg_temp.assert_true(pg_temp.keys(pg_temp.bppi()) = (SELECT k FROM all_keys),
                           'records lists one entry per key of the feature, newest introduction date first, undated last, then by key');
SELECT pg_temp.assert_true((pg_temp.bppi()->>'total')::int = 17, 'total counts keys, not rows');
SELECT pg_temp.assert_true(pg_temp.bppi()->'coverage' = '{"keys": 17, "full_text": 5, "orphaned": 2}',
                           'coverage counts the feature''s keys, those with an indexed holder, and orphaned ingestion-v2 links of either bill feature');
SELECT pg_temp.assert_true((SELECT jsonb_object_agg(e->>'document_key', e->>'status') FROM jsonb_array_elements(pg_temp.bppi()->'records') e) =
  '{"bill:2030:1": "record_only", "bill:2030:2": "full_text_legacy", "bill:2030:3": "full_text", "bill:2030:4": "failed", "bill:2030:5": "processing",
    "bill:2030:6": "failed", "bill:2030:7": "failed", "bill:2030:8": "processing", "bill:2030:9": "record_only", "bill:2030:10": "full_text",
    "bill:2030:11": "processing", "bill:2030:12": "record_only", "bill:2030:13": "record_only", "bill:2030:14": "record_only",
    "bill:2030:15": "record_only", "bill:2030:16": "record_only", "bill:2030:17": "record_only"}',
  'each record''s status follows processing > failed > full_text > full_text_legacy > record_only, by each document''s latest job');
SELECT pg_temp.assert_true(pg_temp.rec('bill:2030:1')->'rows' =
  '[{"row_key": "k1b", "title": "K1 second", "house": "Rajya Sabha", "date": "2030-03-01 19:00:00"},
    {"row_key": "k1a", "title": "K1 first", "house": "Lok Sabha", "date": "2030-01-05 19:00:00"}]'
                           AND pg_temp.rec('bill:2030:1')->>'source_hint' = 'https://sansad.in/ls/legislation'
                           AND pg_temp.rec('bill:2030:1')->'documents' = '[]',
                           'a record shows every row sharing its key, newest first, with the provenance URL as a hint');
-- Status filter.
SELECT pg_temp.assert_true(pg_temp.keys(pg_temp.bppi(s => 'processing')) = array['bill:2030:11', 'bill:2030:8', 'bill:2030:5']
                           AND (pg_temp.bppi(s => 'processing')->>'total')::int = 3
                           AND pg_temp.keys(pg_temp.bppi(s => 'failed')) = array['bill:2030:7', 'bill:2030:6', 'bill:2030:4']
                           AND pg_temp.keys(pg_temp.bppi(s => 'full_text')) = array['bill:2030:10', 'bill:2030:3']
                           AND pg_temp.keys(pg_temp.bppi(s => 'full_text_legacy')) = array['bill:2030:2']
                           AND (pg_temp.bppi(s => 'record_only')->>'total')::int = 8,
                           'the status filter keeps only that status, and total counts what it kept');
SELECT pg_temp.refused($q$SELECT pg_temp.bppi(s => 'done')$q$, 'unknown status', 'records refuses an unknown status');
SELECT pg_temp.assert_true(pg_temp.bppi()->'coverage' = pg_temp.bppi(q => 'K12', s => 'failed')->'coverage', 'coverage ignores the search and the status filter');
-- Search.
SELECT pg_temp.assert_true(pg_temp.keys(pg_temp.bppi(q => '50%')) = array['bill:2030:12'], 'search escapes %');
SELECT pg_temp.assert_true(pg_temp.keys(pg_temp.bppi(q => 'a_b')) = array['bill:2030:14'], 'search escapes _');
SELECT pg_temp.assert_true(pg_temp.keys(pg_temp.bppi(q => 'back\slash')) = array['bill:2030:16'], 'search escapes a backslash');
SELECT pg_temp.assert_true(pg_temp.keys(pg_temp.bppi(q => 'GROWTH')) = array['bill:2030:13', 'bill:2030:12'], 'search is case-insensitive');
SELECT pg_temp.assert_true(pg_temp.keys(pg_temp.bppi(q => 'shared row')) = array['bill:2030:1']
                           AND jsonb_array_length(pg_temp.bppi(q => 'shared row')->'records'->0->'rows') = 2,
                           'a search hit on one row returns the whole record');
SELECT pg_temp.assert_true(pg_temp.keys(pg_temp.bppi(q => '   ')) = (SELECT k FROM all_keys), 'a blank search returns every record');
-- Paging.
SELECT pg_temp.assert_true(pg_temp.keys(pg_temp.bppi(l => 2, o => 2)) = (SELECT k[3:4] FROM all_keys)
                           AND (pg_temp.bppi(l => 2, o => 2)->>'total')::int = 17,
                           'limit and offset page through the sorted keys; total is unpaged');
SELECT pg_temp.assert_true(pg_temp.keys(pg_temp.bppi(l => 0)) = (SELECT k[1:1] FROM all_keys)
                           AND pg_temp.keys(pg_temp.bppi(l => -3)) = (SELECT k[1:1] FROM all_keys),
                           'a limit below 1 is clamped to 1');
SELECT pg_temp.accepted($q$SELECT pg_temp.bppi(o => -5)$q$, 'records accepts a negative offset');
SELECT pg_temp.assert_true(pg_temp.keys(pg_temp.bppi(o => -5, l => 3)) = (SELECT k[1:3] FROM all_keys), 'a negative offset is clamped to 0');
SELECT pg_temp.assert_true(pg_temp.bppi(o => 17)->'records' = '[]' AND (pg_temp.bppi(o => 17)->>'total')::int = 17, 'an offset past the end returns no records and the total');
SELECT pg_temp.drow('national', 'Bill Passage Probability Index', 'm' || n, 'bill:2031:' || n, 'M' || n, '2029-01-01') FROM generate_series(1, 40) n;
SELECT pg_temp.assert_true(jsonb_array_length(pg_temp.bppi(l => 100)->'records') = 50 AND (pg_temp.bppi(l => 100)->>'total')::int = 57,
                           'a limit above 50 is clamped to 50');
-- Other desks.
SELECT pg_temp.assert_true(pg_temp.records('Budget at a Glance') = '{"records": [], "total": 0, "coverage": {"keys": 0, "full_text": 0, "orphaned": 1}}',
                           'a desk without keys has no records, and its own orphaned links');

-- admin_unlinked_documents.
CREATE FUNCTION pg_temp.ids(r jsonb) RETURNS uuid[] LANGUAGE sql AS $$
  SELECT coalesce(array_agg((e->>'document_id')::uuid ORDER BY i), '{}') FROM jsonb_array_elements(r->'documents') WITH ORDINALITY t(e, i)
$$;
SELECT pg_temp.assert_true(pg_temp.ids(pg_temp.unlinked('Bill Passage Probability Index')) =
                             array[pg_temp.id(228), pg_temp.id(223), pg_temp.id(221), pg_temp.id(220), pg_temp.id(216), pg_temp.id(215), pg_temp.id(214), pg_temp.id(207)]
                           AND (pg_temp.unlinked('Bill Passage Probability Index')->>'total')::int = 8,
                           'unlinked lists the bill desks'' ingestion-v2 documents with no key, an orphaned key or a link_target (even beside a key), newest first');
SELECT pg_temp.assert_true((SELECT e FROM jsonb_array_elements(pg_temp.unlinked('Bill Passage Probability Index')->'documents') e WHERE e->>'document_id' = pg_temp.id(207)::text)
                           = jsonb_build_object('document_id', pg_temp.id(207), 'title', 'Doc 207', 'source_key', 'upload:' || pg_temp.h(207), 'legacy', false, 'indexed', false,
                                                'job', '{"status": "failed", "stage": "ocr", "error_code": null}'::jsonb, 'orphaned_key', NULL,
                                                'link_target', 'bill:2030:6', 'replaces', pg_temp.id(206),
                                                'created_at', to_jsonb(timestamptz '2030-06-01' + 207 * interval '1 minute')),
                           'an unlinked document has the UnlinkedDocument shape; a replacement shows its target and the replaced document');
SELECT pg_temp.assert_true((SELECT e->>'orphaned_key' = 'bill:2030:98' AND e->'job' = 'null' AND e->'link_target' = 'null'
                              FROM jsonb_array_elements(pg_temp.unlinked('Bill Passage Probability Index')->'documents') e WHERE e->>'document_id' = pg_temp.id(216)::text),
                           'an orphaned link shows its key');
SELECT pg_temp.assert_true(pg_temp.ids(pg_temp.unlinked('Bill Passage Probability Index', '100%')) = array[pg_temp.id(220)], 'unlinked search escapes %');
SELECT pg_temp.assert_true(pg_temp.ids(pg_temp.unlinked('Bill Passage Probability Index', l => 2, o => 1)) = array[pg_temp.id(223), pg_temp.id(221)]
                           AND (pg_temp.unlinked('Bill Passage Probability Index', l => 2, o => 1)->>'total')::int = 8
                           AND jsonb_array_length(pg_temp.unlinked('Bill Passage Probability Index', l => 0)->'documents') = 1,
                           'unlinked pages with a clamped limit; total is unpaged');
SELECT pg_temp.assert_true(pg_temp.ids(pg_temp.unlinked('Budget at a Glance')) = array[pg_temp.id(222), pg_temp.id(217)],
                           'a desk without keys lists all its uploads');
SELECT pg_temp.assert_true(pg_temp.ids(pg_temp.unlinked('Regulators (RBI / SEBI / TRAI / CCI)')) = array[pg_temp.id(226), pg_temp.id(225)],
                           'unlinked matches documents to the desk by normalised name');
SELECT pg_temp.assert_true(pg_temp.records('Regulators (RBI / SEBI / TRAI / CCI)') = jsonb_build_object('records', jsonb_build_array(jsonb_build_object(
                             'document_key', 'reg:1', 'status', 'full_text', 'source_hint', 'https://sansad.in/ls/legislation',
                             'rows', '[{"row_key": "g1", "title": "Regulator", "house": "Lok Sabha", "date": null}]'::jsonb,
                             'documents', jsonb_build_array(jsonb_build_object('document_id', pg_temp.id(227), 'title', 'Doc 227', 'source_key', 'upload:' || pg_temp.h(227),
                                                                               'legacy', false, 'indexed', true, 'job', NULL, 'link_target', NULL)))),
                             'total', 1, 'coverage', '{"keys": 1, "full_text": 1, "orphaned": 1}'::jsonb),
                           'records counts a desk''s orphaned links by normalised name');

-- Privileges, exercised: anon and authenticated cannot call or read; service_role cannot write the audit table.
SELECT pg_temp.refused($q$SET LOCAL ROLE anon; SELECT public.admin_desk_records('national', 'Bill Passage Probability Index', NULL, NULL, 10, 0)$q$, 'permission denied for function admin_desk_records',
                        'anon cannot call admin_desk_records');
SELECT pg_temp.refused($q$SET LOCAL ROLE authenticated; SELECT public.admin_unlinked_documents('national', 'Bill Passage Probability Index', NULL, 10, 0)$q$, 'permission denied for function admin_unlinked_documents',
                        'authenticated cannot call admin_unlinked_documents');
SELECT pg_temp.refused($q$SET LOCAL ROLE authenticated; SELECT public.ingest_link(pg_temp.id(220), 'bill:2030:1', NULL, NULL)$q$, 'permission denied for function ingest_link',
                        'authenticated cannot call ingest_link');
SELECT pg_temp.refused($q$SET LOCAL ROLE anon; SELECT public.ingest_delete(pg_temp.id(220), NULL)$q$, 'permission denied for function ingest_delete', 'anon cannot call ingest_delete');
SELECT pg_temp.refused($q$SET LOCAL ROLE authenticated; SELECT count(*) FROM public.corpus_admin_actions$q$, 'permission denied for table corpus_admin_actions', 'authenticated cannot read corpus_admin_actions');
SELECT pg_temp.refused($q$SET LOCAL ROLE service_role; INSERT INTO public.corpus_admin_actions (action) VALUES ('link')$q$, 'permission denied for table corpus_admin_actions',
                        'service_role cannot write corpus_admin_actions directly');
SELECT pg_temp.accepted($q$SET LOCAL ROLE service_role; SELECT count(*) FROM public.corpus_admin_actions$q$, 'service_role can read corpus_admin_actions');
ROLLBACK;

-- ===== 6. The key lock and swap's row lock across two sessions (committed; cleaned up after) =====
-- (a) Session A links a key and keeps its transaction open; session B's link
-- of the same key must wait on the key lock, then refuse key_held. Without
-- the lock B would find no holder, wait on the unique index and fail with a
-- unique violation instead.
-- (b) Session A unlinks the old document of a replacement and keeps its
-- transaction open; B's swap must wait on the old document's row lock, then
-- see it holds nothing and link directly (old_document_id null).
CREATE SCHEMA fixture_dblink;
CREATE EXTENSION dblink SCHEMA fixture_dblink;
SELECT pg_temp.drow('national', 'Bill Passage Probability Index', 'lock1', 'bill:2040:1', 'Lock one');
SELECT pg_temp.v2(301, 'Bill Passage Probability Index');
SELECT pg_temp.v2(302, 'Bill Passage Probability Index');
SELECT pg_temp.v2(303, 'Bill Passage Probability Index', '{"document_key": "bill:2040:2"}', true);
SELECT pg_temp.v2(304, 'Bill Passage Probability Index', jsonb_build_object('link_target', 'bill:2040:2', 'replaces', pg_temp.id(303)), true);
SELECT fixture_dblink.dblink_connect('rec_a', 'dbname=' || current_database() || ' user=postgres');
SELECT fixture_dblink.dblink_connect('rec_b', 'dbname=' || current_database() || ' user=postgres');
SELECT fixture_dblink.dblink_exec('rec_a', 'BEGIN');
SELECT fixture_dblink.dblink_exec('rec_a', 'SET LOCAL ROLE service_role');
SELECT * FROM fixture_dblink.dblink('rec_a', $q$SELECT public.ingest_link('c0000000-0000-4000-8000-000000000301', 'bill:2040:1', NULL, NULL)::text$q$) AS t(r text);
SELECT fixture_dblink.dblink_exec('rec_b', 'SET ROLE service_role');
SELECT fixture_dblink.dblink_send_query('rec_b', $q$SELECT public.ingest_link('c0000000-0000-4000-8000-000000000302', 'bill:2040:1', NULL, NULL)::text$q$);
SELECT pg_sleep(0.5);
SELECT pg_temp.assert_true(fixture_dblink.dblink_is_busy('rec_b') = 1, 'session B''s link of the same key waits while A''s link is uncommitted');
SELECT fixture_dblink.dblink_exec('rec_a', 'COMMIT');
SELECT pg_temp.refused_token($q$SELECT * FROM fixture_dblink.dblink_get_result('rec_b') AS t(r text)$q$, 'ingest_link', 'key_held',
                             'a link that waited on the key lock refuses key_held, not a unique violation');
SELECT * FROM fixture_dblink.dblink_get_result('rec_b') AS t(r text);
SELECT fixture_dblink.dblink_exec('rec_a', 'BEGIN');
SELECT fixture_dblink.dblink_exec('rec_a', 'SET LOCAL ROLE service_role');
SELECT * FROM fixture_dblink.dblink('rec_a', $q$SELECT public.ingest_unlink('c0000000-0000-4000-8000-000000000303', 'bill:2040:2', NULL)::text$q$) AS t(r text);
SELECT fixture_dblink.dblink_send_query('rec_b', $q$SELECT public.ingest_swap('c0000000-0000-4000-8000-000000000304', 'c0000000-0000-4000-8000-000000000303', NULL)::text$q$);
SELECT pg_sleep(0.5);
SELECT pg_temp.assert_true(fixture_dblink.dblink_is_busy('rec_b') = 1, 'session B''s swap waits while A holds the old document''s row');
SELECT fixture_dblink.dblink_exec('rec_a', 'COMMIT');
SELECT pg_temp.assert_true((SELECT r::jsonb FROM fixture_dblink.dblink_get_result('rec_b') AS t(r text))
                           = jsonb_build_object('document_id', pg_temp.id(304), 'document_key', 'bill:2040:2', 'old_document_id', NULL),
                           'a swap that waited on the old document re-reads it and links the new one directly');
SELECT fixture_dblink.dblink_disconnect('rec_a');
SELECT fixture_dblink.dblink_disconnect('rec_b');
DELETE FROM corpus_admin_actions WHERE document_id IN (pg_temp.id(301), pg_temp.id(302), pg_temp.id(303), pg_temp.id(304));
DELETE FROM documents WHERE id IN (pg_temp.id(301), pg_temp.id(302), pg_temp.id(303), pg_temp.id(304));
DELETE FROM desk_rows WHERE row_key = 'lock1';
DROP EXTENSION dblink;
DROP SCHEMA fixture_dblink;
