-- Disposable PG assertions for ingestion-v2 (20261001140000_ingestion_v2;
-- docs/specs/2026-10-01-rag-v2-ingestion-v2.md, "Test plan -> SQL fixture"):
-- the private corpus bucket; the privilege matrix of document_files,
-- document_ocr_pages and ingest_jobs and the functions' execute grants;
-- ingest_register's validation, refusals (legacy rows with and without chunks,
-- re-extraction, a changed file, an active or succeeded job), resume and one
-- active job; ingest_claim's system-wide cap across two real sessions (dblink),
-- the lease, attempts counted at claim time and failure after 6; ingest_advance's
-- fencing, set-once hashes, increments, forward-only stage, release, backoff and
-- redaction; ingest_retry and ingest_cancel; ingest_activate's first-extraction
-- rule and indexed_at, with chunks invisible to match_documents until then.
-- Run on page_contract's chain plus bootstrap_storage.sql and the migration,
-- which run.sh applies as a NON-superuser; never against a hosted project. The
-- vacuity check drops the migration. Every label is unique and each assertion
-- was shown red on its own against a broken variant of the migration.
--
-- Section 1 commits (two dblink sessions cannot see an open transaction) and
-- deletes its rows afterwards; everything else runs in one transaction that is
-- rolled back. Inside it now() is constant, so times are compared exactly.
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
-- Refused with a message containing `pattern`: pins the refusal to its rule.
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
CREATE FUNCTION pg_temp.shape(t regclass) RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(attname || ':' || format_type(atttypid, atttypmod) || CASE WHEN attnotnull THEN ':nn' ELSE '' END, ', ' ORDER BY attnum)
    FROM pg_attribute WHERE attrelid = t AND attnum > 0 AND NOT attisdropped;
$$;
CREATE FUNCTION pg_temp.v(i int, w real DEFAULT 1) RETURNS vector LANGUAGE sql AS $$
  SELECT (array_fill(0::real, array[i - 1]) || array[w] || array_fill(0::real, array[1536 - i]))::vector(1536);
$$;

-- Inputs. h(n): a distinct SHA-256; part(): one files[] entry, content-addressed.
CREATE FUNCTION pg_temp.h(n int) RETURNS text LANGUAGE sql AS $$ SELECT encode(sha256(convert_to('file-' || n, 'UTF8')), 'hex') $$;
CREATE FUNCTION pg_temp.part(i int, off int, cnt int, sha text, size bigint) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('part_index', i, 'page_offset', off, 'page_count', cnt, 'sha256', sha, 'byte_size', size, 'storage_path', 'files/' || sha || '.pdf')
$$;
CREATE FUNCTION pg_temp.input(key text, sha text, pages int, files jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('source_key', key, 'title', 'Doc ' || key, 'desk_tier', 'national', 'desk_feature', 'IngFeat',
                            'file_url', 'https://example.test/' || key || '.pdf', 'metadata', jsonb_build_object('k', key),
                            'file_sha256', sha, 'page_count', pages, 'files', files)
$$;
-- An uploaded object in the corpus bucket, as Storage records it.
CREATE FUNCTION pg_temp.obj(n int, size bigint, bucket text DEFAULT 'corpus') RETURNS void LANGUAGE sql AS $$
  INSERT INTO storage.objects (bucket_id, name, metadata)
  VALUES (bucket, 'files/' || pg_temp.h(n) || '.pdf', jsonb_build_object('size', size, 'mimetype', 'application/pdf'))
$$;

-- The functions, called as service_role (the only role granted them). A role
-- set inside a statement that fails is undone with it.
CREATE FUNCTION pg_temp.register(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb; BEGIN SET LOCAL ROLE service_role; r := public.ingest_register(p); RESET ROLE; RETURN r; END; $$;
CREATE FUNCTION pg_temp.claim(n int, lease interval DEFAULT interval '5 minutes') RETURNS SETOF public.ingest_jobs LANGUAGE plpgsql AS $$
BEGIN SET LOCAL ROLE service_role; RETURN QUERY SELECT * FROM public.ingest_claim(n, lease); RESET ROLE; END; $$;
CREATE FUNCTION pg_temp.advance(job uuid, token uuid, p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb; BEGIN SET LOCAL ROLE service_role; r := public.ingest_advance(job, token, p); RESET ROLE; RETURN r; END; $$;
CREATE FUNCTION pg_temp.activate(job uuid, token uuid, p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb; BEGIN SET LOCAL ROLE service_role; r := public.ingest_activate(job, token, p); RESET ROLE; RETURN r; END; $$;
CREATE FUNCTION pg_temp.retry(job uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb; BEGIN SET LOCAL ROLE service_role; r := public.ingest_retry(job); RESET ROLE; RETURN r; END; $$;
CREATE FUNCTION pg_temp.cancel(job uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb; BEGIN SET LOCAL ROLE service_role; r := public.ingest_cancel(job); RESET ROLE; RETURN r; END; $$;

-- Scenario helpers. job(key): the newest job of a document; tok(key): its token.
CREATE FUNCTION pg_temp.job(key text) RETURNS uuid LANGUAGE sql AS $$
  SELECT j.id FROM ingest_jobs j JOIN documents d ON d.id = j.document_id WHERE d.source_key = key ORDER BY j.created_at DESC, j.id DESC LIMIT 1
$$;
CREATE FUNCTION pg_temp.tok(key text) RETURNS uuid LANGUAGE sql AS $$ SELECT claim_token FROM ingest_jobs WHERE id = pg_temp.job(key) $$;
-- Park every active job, so a scenario's claim picks only its own.
CREATE FUNCTION pg_temp.quiesce() RETURNS void LANGUAGE sql AS $$
  UPDATE ingest_jobs SET status = 'cancelled', claim_token = NULL, lease_until = NULL, finished_at = now() WHERE status IN ('queued', 'running')
$$;
-- A fresh single-part document with object n, registered and alone in the queue.
CREATE FUNCTION pg_temp.fresh(key text, n int, pages int DEFAULT 3) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.quiesce();
  PERFORM pg_temp.obj(n, 1000 + n);
  PERFORM pg_temp.register(pg_temp.input(key, pg_temp.h(n), pages, jsonb_build_array(pg_temp.part(0, 0, pages, pg_temp.h(n), 1000 + n))));
  RETURN pg_temp.job(key);
END; $$;
-- Claim the one queued job (after fresh) and return its token.
CREATE FUNCTION pg_temp.claim1() RETURNS uuid LANGUAGE sql AS $$ SELECT claim_token FROM pg_temp.claim(1) $$;

-- ===== 1. The system cap across two sessions (committed; cleaned up after) =====
-- Session A claims inside an open transaction; session B's claim must wait for
-- the claim lock, then see A's running job and take only the one free slot.
CREATE SCHEMA fixture_dblink;
CREATE EXTENSION dblink SCHEMA fixture_dblink;
DO $$
BEGIN
  FOR k IN 1..3 LOOP
    PERFORM pg_temp.obj(100 + k, 5000);
    PERFORM pg_temp.register(pg_temp.input('iv2-conc-' || k, pg_temp.h(100 + k), 2, jsonb_build_array(pg_temp.part(0, 0, 2, pg_temp.h(100 + k), 5000))));
  END LOOP;
END; $$;
SELECT fixture_dblink.dblink_connect('ing_a', 'dbname=' || current_database() || ' user=postgres');
SELECT fixture_dblink.dblink_connect('ing_b', 'dbname=' || current_database() || ' user=postgres');
SELECT fixture_dblink.dblink_exec('ing_a', 'BEGIN');
SELECT fixture_dblink.dblink_exec('ing_a', 'SET LOCAL ROLE service_role');
SELECT pg_temp.assert_true((SELECT n FROM fixture_dblink.dblink('ing_a', 'SELECT count(*)::int FROM public.ingest_claim(1, interval ''5 minutes'')') AS t(n int)) = 1,
                           'session A claims one job and keeps its transaction open');
SELECT fixture_dblink.dblink_exec('ing_b', 'SET ROLE service_role');
SELECT fixture_dblink.dblink_send_query('ing_b', 'SELECT count(*)::int FROM public.ingest_claim(5, interval ''5 minutes'')');
SELECT pg_sleep(0.5);
SELECT pg_temp.assert_true(fixture_dblink.dblink_is_busy('ing_b') = 1 AND EXISTS (SELECT FROM pg_locks WHERE locktype = 'advisory' AND NOT granted),
                           'session B''s claim waits on the claim lock while A''s claim is uncommitted');
SELECT fixture_dblink.dblink_exec('ing_a', 'COMMIT');
SELECT pg_temp.assert_true((SELECT n FROM fixture_dblink.dblink_get_result('ing_b') AS t(n int)) = 1, 'session B then claims only the one free slot');
SELECT pg_temp.assert_true((SELECT count(*) FROM ingest_jobs WHERE status = 'running') = 2, 'two sessions together hold at most two running jobs');
SELECT fixture_dblink.dblink_disconnect('ing_a');
SELECT fixture_dblink.dblink_disconnect('ing_b');
DELETE FROM documents WHERE source_key LIKE 'iv2-conc-%';
DELETE FROM storage.objects WHERE bucket_id = 'corpus';
DROP EXTENSION dblink;
DROP SCHEMA fixture_dblink;

BEGIN;
SET LOCAL search_path = public, extensions;

-- ===== 2. Shape =====
SELECT pg_temp.assert_true(pg_temp.shape('public.ingest_jobs') =
  'id:uuid:nn, document_id:uuid:nn, status:text:nn, stage:text:nn, file_sha256:text:nn, ocr_hash:text, extract_hash:text, model_id:text, '
  'pages_total:integer:nn, pages_per_call:integer:nn, claim_token:uuid, lease_until:timestamp with time zone, attempts:integer:nn, '
  'next_attempt_at:timestamp with time zone:nn, error_code:text, last_error:text, ocr_pages:integer:nn, ocr_cost_usd:numeric:nn, '
  'embed_tokens:bigint:nn, embed_cost_usd:numeric:nn, requested_by:uuid, created_at:timestamp with time zone:nn, '
  'started_at:timestamp with time zone, finished_at:timestamp with time zone',
  'ingest_jobs has the columns of types.ts IngestJob');
SELECT pg_temp.assert_true(pg_temp.shape('public.document_files') =
  'document_id:uuid:nn, part_index:integer:nn, page_offset:integer:nn, page_count:integer:nn, sha256:text:nn, byte_size:bigint:nn, storage_path:text:nn',
  'document_files has the columns of types.ts FilePart');
SELECT pg_temp.assert_true(pg_temp.shape('public.document_ocr_pages') =
  'document_id:uuid:nn, ocr_hash:text:nn, page_number:integer:nn, raw:jsonb:nn, created_at:timestamp with time zone:nn',
  'document_ocr_pages has the spec''s columns');
SELECT pg_temp.assert_true((SELECT column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ingest_jobs' AND column_name = 'pages_per_call') = '25',
                           'pages_per_call defaults to 25');
SELECT pg_temp.assert_true((SELECT count(*) FILTER (WHERE column_default IS NOT DISTINCT FROM '0') = 5 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ingest_jobs'
                             AND column_name IN ('ocr_cost_usd', 'embed_cost_usd', 'ocr_pages', 'embed_tokens', 'attempts')),
                           'costs and counters default to 0');
SELECT pg_temp.assert_true((SELECT bool_and(NOT r.rolsuper) FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
                             WHERE c.oid IN ('public.ingest_jobs'::regclass, 'public.document_files'::regclass, 'public.document_ocr_pages'::regclass)),
                           'the migration was applied by a role that is not a superuser');
SELECT pg_temp.assert_true((SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN
                              ('ingest_register', 'ingest_claim', 'ingest_advance', 'ingest_retry', 'ingest_cancel', 'ingest_activate')) = 6
                           AND to_regprocedure('public.ingest_register(jsonb)') IS NOT NULL
                           AND to_regprocedure('public.ingest_claim(int,interval)') IS NOT NULL
                           AND to_regprocedure('public.ingest_advance(uuid,uuid,jsonb)') IS NOT NULL
                           AND to_regprocedure('public.ingest_retry(uuid)') IS NOT NULL
                           AND to_regprocedure('public.ingest_cancel(uuid)') IS NOT NULL
                           AND to_regprocedure('public.ingest_activate(uuid,uuid,jsonb)') IS NOT NULL,
                           'the six functions exist once each, with the plan''s signatures');
SELECT pg_temp.assert_true(pg_get_function_result('public.ingest_claim(int,interval)'::regprocedure) = 'SETOF ingest_jobs'
                           AND pg_get_function_result('public.ingest_register(jsonb)'::regprocedure) = 'jsonb'
                           AND pg_get_function_result('public.ingest_advance(uuid,uuid,jsonb)'::regprocedure) = 'jsonb',
                           'ingest_claim returns setof ingest_jobs; register and advance return jsonb');
SELECT pg_temp.assert_true((SELECT count(*) FILTER (WHERE prosecdef AND proconfig IS NOT DISTINCT FROM array['search_path=public, extensions']) = 6 FROM pg_proc
                             WHERE pronamespace = 'public'::regnamespace AND proname IN
                               ('ingest_register', 'ingest_claim', 'ingest_advance', 'ingest_retry', 'ingest_cancel', 'ingest_activate')),
                           'each function is security definer and sets only search_path = public, extensions');

-- ===== 3. The corpus bucket =====
SELECT pg_temp.assert_true((SELECT public = false FROM storage.buckets WHERE id = 'corpus'), 'the corpus bucket exists and is private');
SELECT pg_temp.assert_true((SELECT file_size_limit = 50000000 FROM storage.buckets WHERE id = 'corpus'), 'the corpus bucket limits files to 50,000,000 bytes');
SELECT pg_temp.assert_true((SELECT allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] FROM storage.buckets WHERE id = 'corpus'),
                           'the corpus bucket allows PDF, JPEG, PNG and WebP only');

-- ===== 4. RLS, privileges and execute grants =====
SELECT pg_temp.assert_true((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('public.ingest_jobs'::regclass, 'public.document_files'::regclass, 'public.document_ocr_pages'::regclass)),
                           'RLS is enabled on the three tables');
-- PUBLIC first: a grant to PUBLIC also reaches anon and authenticated.
DO $$
DECLARE tbl text; actor text; privilege text; expected boolean;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['document_files', 'document_ocr_pages', 'ingest_jobs'] LOOP
    FOREACH actor IN ARRAY ARRAY['public', 'anon', 'authenticated', 'service_role'] LOOP
      FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
        expected := CASE
          WHEN actor = 'authenticated' THEN tbl = 'document_files' AND privilege = 'SELECT'
          WHEN actor = 'service_role' AND tbl = 'ingest_jobs' THEN privilege = 'SELECT'
          WHEN actor = 'service_role' THEN privilege IN ('SELECT','INSERT','UPDATE','DELETE')
          ELSE false END;
        PERFORM pg_temp.assert_true(has_table_privilege(actor, 'public.' || tbl, privilege) = expected,
                                    actor || CASE WHEN expected THEN ' can ' ELSE ' cannot ' END || privilege || ' ' || tbl);
      END LOOP;
    END LOOP;
  END LOOP;
END; $$;
DO $$
DECLARE fn text; actor text; expected boolean;
BEGIN
  FOREACH fn IN ARRAY ARRAY['public.ingest_register(jsonb)', 'public.ingest_claim(int,interval)', 'public.ingest_advance(uuid,uuid,jsonb)',
                            'public.ingest_retry(uuid)', 'public.ingest_cancel(uuid)', 'public.ingest_activate(uuid,uuid,jsonb)', 'public.ingest_redact(text,int)'] LOOP
    FOREACH actor IN ARRAY ARRAY['public', 'anon', 'authenticated', 'service_role'] LOOP
      expected := actor = 'service_role' AND fn <> 'public.ingest_redact(text,int)';
      PERFORM pg_temp.assert_true(has_function_privilege(actor, fn, 'EXECUTE') = expected,
                                  actor || CASE WHEN expected THEN ' can ' ELSE ' cannot ' END || 'execute ' || fn);
    END LOOP;
  END LOOP;
END; $$;
SELECT pg_temp.assert_true((SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('document_files', 'document_ocr_pages', 'ingest_jobs')) = 1
                           AND (SELECT cmd = 'SELECT' AND roles = '{authenticated}' AND qual = 'true' AND permissive = 'PERMISSIVE' FROM pg_policies
                                 WHERE schemaname = 'public' AND tablename = 'document_files'),
                           'one policy: document_files select to authenticated using (true); none on the service-only tables');

-- ===== 5. ingest_register =====
INSERT INTO auth.users (id, email) VALUES ('d0000000-0000-4000-8000-0000000000a1'::uuid, 'owner@example.test')
  ON CONFLICT DO NOTHING;
SELECT pg_temp.obj(1, 1000);                                   -- iv2-one, 12 pages
SELECT pg_temp.obj(2, 2000); SELECT pg_temp.obj(3, 3000); SELECT pg_temp.obj(4, 4000);  -- iv2-split's parts
SELECT pg_temp.obj(6, 6000);                                   -- a different file
SELECT pg_temp.obj(7, 50000001);                               -- over the limit
INSERT INTO storage.buckets (id, name, public) VALUES ('elsewhere', 'elsewhere', false);
SELECT pg_temp.obj(8, 8000, 'elsewhere');                      -- right name, wrong bucket
CREATE TEMP TABLE reg (k text PRIMARY KEY, r jsonb);

INSERT INTO reg SELECT 'one', pg_temp.register(pg_temp.input('iv2-one', pg_temp.h(1), 12, jsonb_build_array(pg_temp.part(0, 0, 12, pg_temp.h(1), 1000)))
                                               || '{"requested_by": "d0000000-0000-4000-8000-0000000000a1"}'::jsonb);
SELECT pg_temp.assert_true((SELECT r->>'status' = 'queued' AND (r->>'resumed')::boolean = false AND (r->>'job_id')::uuid = pg_temp.job('iv2-one')
                                   AND (r->>'document_id')::uuid = (SELECT id FROM documents WHERE source_key = 'iv2-one') FROM reg WHERE k = 'one'),
                           'register returns {document_id, job_id, status: queued}');
SELECT pg_temp.assert_true((SELECT ocr_text = '' AND content_sha256 = encode(sha256(''::bytea), 'hex') AND indexed_at IS NULL AND extract_hash IS NULL AND chunker_version IS NULL
                              FROM documents WHERE source_key = 'iv2-one'),
                           'a registered document has empty text, the hash of empty text, and is not indexed');
SELECT pg_temp.assert_true((SELECT storage_path = 'files/' || pg_temp.h(1) || '.pdf' AND file_sha256 = pg_temp.h(1) AND source_mime = 'application/pdf' AND page_count = 12
                              FROM documents WHERE source_key = 'iv2-one'),
                           'a registered document records its file, MIME type and page_count');
SELECT pg_temp.assert_true((SELECT title = 'Doc iv2-one' AND desk_tier = 'national' AND desk_feature = 'IngFeat' AND file_url = 'https://example.test/iv2-one.pdf'
                                   AND metadata = '{"k": "iv2-one"}' FROM documents WHERE source_key = 'iv2-one'),
                           'a registered document keeps the descriptive fields');
SELECT pg_temp.assert_true((SELECT jsonb_agg(to_jsonb(f) - 'document_id') FROM document_files f JOIN documents d ON d.id = f.document_id WHERE d.source_key = 'iv2-one')
                           = jsonb_build_array(pg_temp.part(0, 0, 12, pg_temp.h(1), 1000)),
                           'register stores the file part');
SELECT pg_temp.assert_true((SELECT status = 'queued' AND stage = 'ocr' AND file_sha256 = pg_temp.h(1) AND pages_total = 12 AND pages_per_call = 25 AND attempts = 0
                                   AND next_attempt_at = now() AND claim_token IS NULL AND lease_until IS NULL AND ocr_hash IS NULL AND extract_hash IS NULL AND model_id IS NULL
                                   AND ocr_pages = 0 AND ocr_cost_usd = 0 AND embed_tokens = 0 AND embed_cost_usd = 0
                                   AND requested_by = 'd0000000-0000-4000-8000-0000000000a1'::uuid AND started_at IS NULL AND finished_at IS NULL
                              FROM ingest_jobs WHERE id = pg_temp.job('iv2-one')),
                           'register queues one job at stage ocr, due now, with the file hash and page total');

-- A split file: parts given out of order are taken in part_index order.
INSERT INTO reg SELECT 'split', pg_temp.register(pg_temp.input('iv2-split', pg_temp.h(5), 12, jsonb_build_array(
  pg_temp.part(2, 9, 3, pg_temp.h(4), 4000), pg_temp.part(0, 0, 4, pg_temp.h(2), 2000), pg_temp.part(1, 4, 5, pg_temp.h(3), 3000))));
SELECT pg_temp.assert_true((SELECT jsonb_agg(to_jsonb(f) - 'document_id' ORDER BY part_index) FROM document_files f JOIN documents d ON d.id = f.document_id WHERE d.source_key = 'iv2-split')
                           = jsonb_build_array(pg_temp.part(0, 0, 4, pg_temp.h(2), 2000), pg_temp.part(1, 4, 5, pg_temp.h(3), 3000), pg_temp.part(2, 9, 3, pg_temp.h(4), 4000)),
                           'a split file stores every part');
SELECT pg_temp.assert_true((SELECT storage_path = 'files/' || pg_temp.h(2) || '.pdf' AND file_sha256 = pg_temp.h(5) FROM documents WHERE source_key = 'iv2-split'),
                           'a split file''s document points at part 0 and keeps the original''s hash');

-- Validation. Each input is valid except for the one defect named.
SELECT pg_temp.refused($q$SELECT pg_temp.register(pg_temp.input('iv2-bad-pages', pg_temp.h(1), 0, jsonb_build_array(pg_temp.part(0, 0, 12, pg_temp.h(1), 1000))))$q$,
                       'page_count must be at least 1', 'register refuses page_count 0');
SELECT pg_temp.refused($q$SELECT pg_temp.register(pg_temp.input('iv2-bad-gap', pg_temp.h(5), 7, jsonb_build_array(pg_temp.part(0, 0, 4, pg_temp.h(2), 2000), pg_temp.part(2, 4, 3, pg_temp.h(4), 4000))))$q$,
                       'without gaps', 'register refuses a gap in part_index');
SELECT pg_temp.refused($q$SELECT pg_temp.register(pg_temp.input('iv2-bad-start', pg_temp.h(5), 8, jsonb_build_array(pg_temp.part(1, 0, 5, pg_temp.h(3), 3000), pg_temp.part(2, 5, 3, pg_temp.h(4), 4000))))$q$,
                       'without gaps', 'register refuses parts that do not start at 0');
SELECT pg_temp.refused($q$SELECT pg_temp.register(pg_temp.input('iv2-bad-overlap', pg_temp.h(5), 12, jsonb_build_array(
                            pg_temp.part(0, 0, 4, pg_temp.h(2), 2000), pg_temp.part(1, 3, 5, pg_temp.h(3), 3000), pg_temp.part(2, 9, 3, pg_temp.h(4), 4000))))$q$,
                       'must start at page_offset', 'register refuses overlapping parts');
SELECT pg_temp.refused($q$SELECT pg_temp.register(pg_temp.input('iv2-bad-hole', pg_temp.h(5), 13, jsonb_build_array(
                            pg_temp.part(0, 0, 4, pg_temp.h(2), 2000), pg_temp.part(1, 5, 5, pg_temp.h(3), 3000), pg_temp.part(2, 10, 3, pg_temp.h(4), 4000))))$q$,
                       'must start at page_offset', 'register refuses a hole between parts');
SELECT pg_temp.refused($q$SELECT pg_temp.register(pg_temp.input('iv2-bad-sum', pg_temp.h(5), 13, jsonb_build_array(
                            pg_temp.part(0, 0, 4, pg_temp.h(2), 2000), pg_temp.part(1, 4, 5, pg_temp.h(3), 3000), pg_temp.part(2, 9, 3, pg_temp.h(4), 4000))))$q$,
                       'parts cover 12 pages, page_count is 13', 'register refuses parts that do not sum to page_count');
SELECT pg_temp.refused($q$SELECT pg_temp.register(pg_temp.input('iv2-bad-empty-part', pg_temp.h(5), 12, jsonb_build_array(
                            pg_temp.part(0, 0, 12, pg_temp.h(2), 2000), pg_temp.part(1, 12, 0, pg_temp.h(3), 3000))))$q$,
                       'page_count of at least 1', 'register refuses a part with no pages');
SELECT pg_temp.refused($q$SELECT pg_temp.register(pg_temp.input('iv2-bad-path', pg_temp.h(1), 12, jsonb_build_array(
                            pg_temp.part(0, 0, 12, pg_temp.h(1), 1000) || jsonb_build_object('storage_path', 'doc/' || pg_temp.h(1) || '.pdf'))))$q$,
                       'storage_path must be files/<sha256>.pdf', 'register refuses a path that is not files/<sha256>.pdf');
SELECT pg_temp.refused($q$SELECT pg_temp.register(pg_temp.input('iv2-bad-missing', pg_temp.h(9), 12, jsonb_build_array(pg_temp.part(0, 0, 12, pg_temp.h(9), 1000))))$q$,
                       'is not in the corpus bucket', 'register refuses a part whose object was never uploaded');
SELECT pg_temp.refused($q$SELECT pg_temp.register(pg_temp.input('iv2-bad-bucket', pg_temp.h(8), 12, jsonb_build_array(pg_temp.part(0, 0, 12, pg_temp.h(8), 8000))))$q$,
                       'is not in the corpus bucket', 'register refuses an object stored in another bucket');
SELECT pg_temp.refused($q$SELECT pg_temp.register(pg_temp.input('iv2-bad-size', pg_temp.h(1), 12, jsonb_build_array(pg_temp.part(0, 0, 12, pg_temp.h(1), 999))))$q$,
                       'has size 1000, expected 999', 'register refuses an object whose size differs');
SELECT pg_temp.refused($q$SELECT pg_temp.register(pg_temp.input('iv2-bad-limit', pg_temp.h(7), 12, jsonb_build_array(pg_temp.part(0, 0, 12, pg_temp.h(7), 50000001))))$q$,
                       'byte_size must be between 1 and 50000000', 'register refuses a part over 50,000,000 bytes');
SELECT pg_temp.refused($q$SELECT pg_temp.register(pg_temp.input('iv2-bad-whole', pg_temp.h(5), 12, jsonb_build_array(pg_temp.part(0, 0, 12, pg_temp.h(1), 1000))))$q$,
                       'a single part must be the whole file', 'register refuses a single part that is not the whole file');
SELECT pg_temp.refused($q$SELECT pg_temp.register(pg_temp.input('iv2-bad-sha', upper(pg_temp.h(1)), 12, jsonb_build_array(pg_temp.part(0, 0, 12, pg_temp.h(1), 1000))))$q$,
                       'file_sha256 must be 64 lowercase hex', 'register refuses a malformed file_sha256');
SELECT pg_temp.refused($q$SELECT pg_temp.register(pg_temp.input('iv2-bad-nofiles', pg_temp.h(1), 12, '[]'::jsonb))$q$,
                       'files must be a non-empty array', 'register refuses an empty files list');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM documents WHERE source_key LIKE 'iv2-bad-%'), 'a refused registration leaves no document');

-- Existing documents.
INSERT INTO documents (id, source_key, title, content_sha256, ocr_text, chunker_version, indexed_at) VALUES
  ('d0000000-0000-4000-8000-000000000001', 'iv2-legacy', 'Legacy', 'sha-l', 'legacy text', 2, now()),
  ('d0000000-0000-4000-8000-000000000002', 'iv2-legacy-chunked', 'Legacy chunked', 'sha-lc', 'chunked text', 2, now());
INSERT INTO document_chunks (document_id, chunk_hash, chunk_index, char_from, char_to, content, embedding, chunker_version)
  VALUES ('d0000000-0000-4000-8000-000000000002', 'lc1', 0, 0, 7, 'chunked', pg_temp.v(1), 2);
SELECT pg_temp.refused($q$SELECT pg_temp.register(pg_temp.input('iv2-legacy', pg_temp.h(1), 12, jsonb_build_array(pg_temp.part(0, 0, 12, pg_temp.h(1), 1000))))$q$,
                       'is a legacy document', 'register refuses a legacy document without chunks');
SELECT pg_temp.refused($q$SELECT pg_temp.register(pg_temp.input('iv2-legacy-chunked', pg_temp.h(1), 12, jsonb_build_array(pg_temp.part(0, 0, 12, pg_temp.h(1), 1000))))$q$,
                       'is a legacy document', 'register refuses a legacy document with chunks');
SELECT pg_temp.assert_true((SELECT ocr_text = 'legacy text' AND storage_path IS NULL FROM documents WHERE source_key = 'iv2-legacy')
                           AND (SELECT count(*) = 1 FROM document_chunks WHERE document_id = 'd0000000-0000-4000-8000-000000000002')
                           AND NOT EXISTS (SELECT FROM ingest_jobs WHERE document_id IN ('d0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002')),
                           'legacy documents are left untouched and get no job');
SELECT pg_temp.refused($q$SELECT pg_temp.register(pg_temp.input('iv2-one', pg_temp.h(6), 12, jsonb_build_array(pg_temp.part(0, 0, 12, pg_temp.h(6), 6000))))$q$,
                       'exists with a different file', 'register refuses a changed file for an existing source_key');
SELECT pg_temp.refused($q$SELECT pg_temp.register(pg_temp.input('iv2-one', pg_temp.h(1), 12, jsonb_build_array(pg_temp.part(0, 0, 12, pg_temp.h(1), 1000))))$q$,
                       'already has an active or succeeded job', 'register refuses a document whose job is queued');
UPDATE ingest_jobs SET status = 'running', claim_token = gen_random_uuid(), lease_until = now() + interval '5 minutes' WHERE id = pg_temp.job('iv2-split');
SELECT pg_temp.refused($q$SELECT pg_temp.register(pg_temp.input('iv2-split', pg_temp.h(5), 12, jsonb_build_array(
                            pg_temp.part(0, 0, 4, pg_temp.h(2), 2000), pg_temp.part(1, 4, 5, pg_temp.h(3), 3000), pg_temp.part(2, 9, 3, pg_temp.h(4), 4000))))$q$,
                       'already has an active or succeeded job', 'register refuses a document whose job is running');
-- Re-extraction: the document already has an extraction (its job long finished).
SELECT pg_temp.obj(10, 1010);
SELECT pg_temp.register(pg_temp.input('iv2-extracted', pg_temp.h(10), 2, jsonb_build_array(pg_temp.part(0, 0, 2, pg_temp.h(10), 1010))));
UPDATE documents SET extract_hash = 'x-old', indexed_at = now() WHERE source_key = 'iv2-extracted';
UPDATE ingest_jobs SET status = 'succeeded', stage = 'done', finished_at = now() WHERE id = pg_temp.job('iv2-extracted');
SELECT pg_temp.refused($q$SELECT pg_temp.register(pg_temp.input('iv2-extracted', pg_temp.h(10), 2, jsonb_build_array(pg_temp.part(0, 0, 2, pg_temp.h(10), 1010))))$q$,
                       're-extraction is refused', 'register refuses re-extraction of an extracted document');
-- A succeeded job on a document without extract_hash (never expected; still refused).
SELECT pg_temp.obj(11, 1011);
SELECT pg_temp.register(pg_temp.input('iv2-succeeded', pg_temp.h(11), 2, jsonb_build_array(pg_temp.part(0, 0, 2, pg_temp.h(11), 1011))));
UPDATE ingest_jobs SET status = 'succeeded', stage = 'done', finished_at = now() WHERE id = pg_temp.job('iv2-succeeded');
SELECT pg_temp.refused($q$SELECT pg_temp.register(pg_temp.input('iv2-succeeded', pg_temp.h(11), 2, jsonb_build_array(pg_temp.part(0, 0, 2, pg_temp.h(11), 1011))))$q$,
                       'already has an active or succeeded job', 'register refuses a document whose job succeeded');

-- Resume: a failed job with the same file is re-queued, stage kept, attempts 0.
SELECT pg_temp.obj(12, 1012);
INSERT INTO reg SELECT 'resume-first', pg_temp.register(pg_temp.input('iv2-resume', pg_temp.h(12), 2, jsonb_build_array(pg_temp.part(0, 0, 2, pg_temp.h(12), 1012))));
UPDATE ingest_jobs SET status = 'failed', stage = 'index', attempts = 4, error_code = 'http_500', last_error = 'boom', finished_at = now(),
                       next_attempt_at = now() + interval '1 hour', ocr_hash = 'oh-r', ocr_pages = 2
 WHERE id = pg_temp.job('iv2-resume');
INSERT INTO reg SELECT 'resume', pg_temp.register(pg_temp.input('iv2-resume', pg_temp.h(12), 2, jsonb_build_array(pg_temp.part(0, 0, 2, pg_temp.h(12), 1012))));
SELECT pg_temp.assert_true((SELECT (r->>'job_id') = (SELECT r->>'job_id' FROM reg WHERE k = 'resume-first') AND (r->>'resumed')::boolean AND r->>'status' = 'queued'
                              FROM reg WHERE k = 'resume') AND (SELECT count(*) = 1 FROM ingest_jobs WHERE document_id = (SELECT id FROM documents WHERE source_key = 'iv2-resume')),
                           'register resumes the failed job instead of adding one');
SELECT pg_temp.assert_true((SELECT status = 'queued' AND stage = 'index' AND ocr_hash = 'oh-r' AND ocr_pages = 2 FROM ingest_jobs WHERE id = pg_temp.job('iv2-resume')),
                           'a resumed job keeps its stage and progress');
SELECT pg_temp.assert_true((SELECT attempts = 0 AND error_code IS NULL AND last_error IS NULL AND next_attempt_at = now() AND finished_at IS NULL
                              FROM ingest_jobs WHERE id = pg_temp.job('iv2-resume')),
                           'a resumed job starts with attempts 0, no error, due now');
SELECT pg_temp.obj(13, 1013);
SELECT pg_temp.register(pg_temp.input('iv2-resume-cancelled', pg_temp.h(13), 2, jsonb_build_array(pg_temp.part(0, 0, 2, pg_temp.h(13), 1013))));
UPDATE ingest_jobs SET status = 'cancelled', finished_at = now() WHERE id = pg_temp.job('iv2-resume-cancelled');
SELECT pg_temp.accepted($q$SELECT pg_temp.register(pg_temp.input('iv2-resume-cancelled', pg_temp.h(13), 2, jsonb_build_array(pg_temp.part(0, 0, 2, pg_temp.h(13), 1013))))$q$,
                        'register resumes a cancelled job');
SELECT pg_temp.assert_true((SELECT status = 'queued' FROM ingest_jobs WHERE id = pg_temp.job('iv2-resume-cancelled')), 'the resumed cancelled job is queued');

-- One active job per document.
SELECT pg_temp.rejected($q$INSERT INTO ingest_jobs (document_id, file_sha256, pages_total) SELECT id, file_sha256, 12 FROM documents WHERE source_key = 'iv2-one'$q$,
                        '23505', 'a second queued job for a document is rejected');
SELECT pg_temp.rejected($q$INSERT INTO ingest_jobs (document_id, file_sha256, pages_total, status, claim_token, lease_until)
                           SELECT id, file_sha256, 12, 'running', gen_random_uuid(), now() FROM documents WHERE source_key = 'iv2-one'$q$,
                        '23505', 'a running job beside a queued one is rejected');
SELECT pg_temp.accepted($q$INSERT INTO ingest_jobs (document_id, file_sha256, pages_total, status) SELECT id, file_sha256, 12, 'failed' FROM documents WHERE source_key = 'iv2-one'$q$,
                        'finished jobs may sit beside the active one');

-- ===== 6. ingest_claim =====
SELECT pg_temp.quiesce();
SELECT pg_temp.obj(20 + k, 1020 + k) FROM generate_series(1, 3) k;
SELECT pg_temp.register(pg_temp.input('iv2-claim-' || k, pg_temp.h(20 + k), 2, jsonb_build_array(pg_temp.part(0, 0, 2, pg_temp.h(20 + k), 1020 + k)))) FROM generate_series(1, 3) k;
CREATE TEMP TABLE claimed AS SELECT 1 AS round, * FROM pg_temp.claim(1);
SELECT pg_temp.assert_true((SELECT count(*) FROM claimed WHERE round = 1) = 1, 'a claim takes at most p_limit jobs');
SELECT pg_temp.assert_true((SELECT status = 'running' AND attempts = 1 AND claim_token IS NOT NULL AND lease_until = now() + interval '5 minutes' AND started_at = now()
                              FROM claimed WHERE round = 1)
                           AND (SELECT status = 'running' AND claim_token IS NOT NULL FROM ingest_jobs WHERE id = (SELECT id FROM claimed WHERE round = 1)),
                           'a claimed job is running with a token, a lease of p_lease, attempts 1 and started_at');
INSERT INTO claimed SELECT 2, * FROM pg_temp.claim(5);
SELECT pg_temp.assert_true((SELECT count(*) FROM claimed WHERE round = 2) = 1, 'a claim stops at two running jobs system-wide');
INSERT INTO claimed SELECT 3, * FROM pg_temp.claim(5);
SELECT pg_temp.assert_true((SELECT count(*) FROM claimed WHERE round = 3) = 0
                           AND (SELECT status = 'queued' FROM ingest_jobs j JOIN documents d ON d.id = j.document_id
                                 WHERE d.source_key LIKE 'iv2-claim-%' AND j.id NOT IN (SELECT id FROM claimed)),
                           'no third job is claimed while two leases are live');
-- The lease: an expired one is reclaimed, first, with a new token.
UPDATE ingest_jobs SET lease_until = now() - interval '1 second', started_at = now() - interval '1 hour' WHERE id = (SELECT id FROM claimed WHERE round = 1);
INSERT INTO claimed SELECT 4, * FROM pg_temp.claim(5);
SELECT pg_temp.assert_true((SELECT count(*) = 1 AND bool_and(id = (SELECT id FROM claimed WHERE round = 1)) FROM claimed WHERE round = 4),
                           'a running job whose lease expired is claimed again');
SELECT pg_temp.assert_true((SELECT c4.claim_token <> c1.claim_token AND c4.attempts = 2 FROM claimed c4, claimed c1 WHERE c4.round = 4 AND c1.round = 1),
                           'a reclaim issues a new token and counts an attempt');
SELECT pg_temp.assert_true((SELECT started_at = now() - interval '1 hour' FROM claimed WHERE round = 4), 'a reclaim keeps started_at');
SELECT pg_temp.refused($q$SELECT * FROM pg_temp.claim(1, interval '0 seconds')$q$, 'p_lease must be a positive interval', 'a claim refuses a lease that is not positive');
-- Not due.
SELECT pg_temp.fresh('iv2-due', 30);
UPDATE ingest_jobs SET next_attempt_at = now() + interval '1 second' WHERE id = pg_temp.job('iv2-due');
SELECT pg_temp.assert_true((SELECT count(*) FROM pg_temp.claim(5)) = 0, 'a queued job is not claimed before next_attempt_at');
UPDATE ingest_jobs SET next_attempt_at = now() WHERE id = pg_temp.job('iv2-due');
SELECT pg_temp.assert_true((SELECT count(*) FROM pg_temp.claim(5)) = 1, 'a queued job is claimed once next_attempt_at is due');
-- Attempts at claim time: the 6th claim without progress is allowed, the 7th fails the job.
SELECT pg_temp.fresh('iv2-attempts', 31);
UPDATE ingest_jobs SET attempts = 5 WHERE id = pg_temp.job('iv2-attempts');
SELECT pg_temp.assert_true((SELECT attempts FROM pg_temp.claim(1)) = 6, 'a job with 5 attempts is claimed a sixth time');
SELECT pg_temp.advance(pg_temp.job('iv2-attempts'), pg_temp.tok('iv2-attempts'), '{"progressed": false, "error": {"code": "http_503", "message": "busy", "permanent": false}}');
UPDATE ingest_jobs SET next_attempt_at = now() WHERE id = pg_temp.job('iv2-attempts');
-- (A claim and a check of its effects are separate statements: one statement's
-- snapshot does not see what a function it calls has written.)
INSERT INTO claimed SELECT 7, * FROM pg_temp.claim(1);
SELECT pg_temp.assert_true((SELECT count(*) FROM claimed WHERE round = 7) = 0
                           AND (SELECT status = 'failed' AND error_code = 'attempts_exhausted' AND attempts = 6 AND finished_at = now() AND claim_token IS NULL
                                 FROM ingest_jobs WHERE id = pg_temp.job('iv2-attempts')),
                           'a seventh claim without progress fails the job instead');
SELECT pg_temp.fresh('iv2-crashed', 32);
UPDATE ingest_jobs SET status = 'running', attempts = 6, claim_token = gen_random_uuid(), lease_until = now() - interval '1 second' WHERE id = pg_temp.job('iv2-crashed');
INSERT INTO claimed SELECT 8, * FROM pg_temp.claim(1);
SELECT pg_temp.assert_true((SELECT count(*) FROM claimed WHERE round = 8) = 0
                           AND (SELECT status = 'failed' AND error_code = 'attempts_exhausted' AND lease_until IS NULL FROM ingest_jobs WHERE id = pg_temp.job('iv2-crashed')),
                           'a worker that died on its sixth claim fails the job at the next claim');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM ingest_jobs WHERE status IN ('queued', 'running'))
                           AND EXISTS (SELECT FROM ingest_jobs WHERE status = 'failed') AND EXISTS (SELECT FROM ingest_jobs WHERE status = 'cancelled')
                           AND EXISTS (SELECT FROM ingest_jobs WHERE status = 'succeeded'), 'only finished jobs remain');
INSERT INTO claimed SELECT 9, * FROM pg_temp.claim(5);
SELECT pg_temp.assert_true((SELECT count(*) FROM claimed WHERE round = 9) = 0 AND NOT EXISTS (SELECT FROM ingest_jobs WHERE status = 'running'),
                           'failed, cancelled and succeeded jobs are never claimed');

-- ===== 7. ingest_advance =====
SELECT pg_temp.fresh('iv2-adv', 40, 10);
CREATE TEMP TABLE t (k text PRIMARY KEY, token uuid);
INSERT INTO t VALUES ('1', pg_temp.claim1());
SELECT pg_temp.refused($q$SELECT pg_temp.advance(pg_temp.job('iv2-adv'), gen_random_uuid(), '{"progressed": true}')$q$,
                       'is not running under this claim token', 'advance refuses a token that is not the claim''s');
SELECT pg_temp.advance(pg_temp.job('iv2-adv'), (SELECT token FROM t WHERE k = '1'),
  '{"progressed": true, "ocr_hash": "oh1", "model_id": "mistral-ocr-4-1", "ocr_pages": 3, "ocr_cost_usd": 0.003, "pages_per_call": 12}');
SELECT pg_temp.assert_true((SELECT status = 'queued' AND lease_until IS NULL AND claim_token IS NULL AND next_attempt_at = now() FROM ingest_jobs WHERE id = pg_temp.job('iv2-adv')),
                           'advance releases the job: queued, no lease, no token, due now');
SELECT pg_temp.assert_true((SELECT ocr_hash = 'oh1' AND model_id = 'mistral-ocr-4-1' FROM ingest_jobs WHERE id = pg_temp.job('iv2-adv')), 'the first advance sets ocr_hash and model_id');
SELECT pg_temp.assert_true((SELECT pages_per_call = 12 FROM ingest_jobs WHERE id = pg_temp.job('iv2-adv')), 'advance replaces pages_per_call');
SELECT pg_temp.refused(format($q$SELECT pg_temp.advance(pg_temp.job('iv2-adv'), %L, '{"progressed": true}')$q$, (SELECT token FROM t WHERE k = '1')),
                       'is not running under this claim token', 'a released claim''s token is spent');
INSERT INTO t VALUES ('2', pg_temp.claim1());
SELECT pg_temp.advance(pg_temp.job('iv2-adv'), (SELECT token FROM t WHERE k = '2'), '{"progressed": false, "ocr_hash": "oh1", "ocr_pages": 2, "ocr_cost_usd": 0.002}');
SELECT pg_temp.assert_true((SELECT ocr_pages = 5 AND ocr_cost_usd = 0.005 FROM ingest_jobs WHERE id = pg_temp.job('iv2-adv')), 'advance adds to the counters');
SELECT pg_temp.assert_true((SELECT attempts = 1 FROM ingest_jobs WHERE id = pg_temp.job('iv2-adv')), 'a step without progress keeps its attempt');
SELECT pg_temp.assert_true((SELECT ocr_hash = 'oh1' FROM ingest_jobs WHERE id = pg_temp.job('iv2-adv')), 'the same ocr_hash again is accepted');
INSERT INTO t VALUES ('3', pg_temp.claim1());
SELECT pg_temp.refused(format($q$SELECT pg_temp.advance(pg_temp.job('iv2-adv'), %L, '{"progressed": true, "ocr_hash": "oh2"}')$q$, (SELECT token FROM t WHERE k = '3')),
                       'ocr_hash is already set to a different value', 'advance refuses a different ocr_hash');
SELECT pg_temp.refused(format($q$SELECT pg_temp.advance(pg_temp.job('iv2-adv'), %L, '{"progressed": true, "model_id": "mistral-ocr-latest"}')$q$, (SELECT token FROM t WHERE k = '3')),
                       'model_id is already set to a different value', 'advance refuses a different model_id');
SELECT pg_temp.refused(format($q$SELECT pg_temp.advance(pg_temp.job('iv2-adv'), %L, '{"progressed": true, "ocr_pages": -1}')$q$, (SELECT token FROM t WHERE k = '3')),
                       'cannot be negative', 'advance refuses a negative increment');
SELECT pg_temp.refused(format($q$SELECT pg_temp.advance(pg_temp.job('iv2-adv'), %L, '{"ocr_pages": 1}')$q$, (SELECT token FROM t WHERE k = '3')),
                       'progressed (boolean) is required', 'advance requires progressed');
SELECT pg_temp.assert_true((SELECT attempts = 2 FROM ingest_jobs WHERE id = pg_temp.job('iv2-adv')), 'the job has two attempts before progress');
SELECT pg_temp.advance(pg_temp.job('iv2-adv'), (SELECT token FROM t WHERE k = '3'), '{"progressed": true}');
SELECT pg_temp.assert_true((SELECT attempts = 0 AND stage = 'ocr' FROM ingest_jobs WHERE id = pg_temp.job('iv2-adv')), 'progress resets attempts to 0');
INSERT INTO t VALUES ('3b', pg_temp.claim1());
SELECT pg_temp.advance(pg_temp.job('iv2-adv'), (SELECT token FROM t WHERE k = '3b'), '{"progressed": true, "stage": "index", "extract_hash": "xh1"}');
SELECT pg_temp.assert_true((SELECT stage = 'index' AND extract_hash = 'xh1' FROM ingest_jobs WHERE id = pg_temp.job('iv2-adv')), 'advance moves the stage forward and sets extract_hash');
INSERT INTO t VALUES ('4', pg_temp.claim1());
SELECT pg_temp.refused(format($q$SELECT pg_temp.advance(pg_temp.job('iv2-adv'), %L, '{"progressed": true, "stage": "ocr"}')$q$, (SELECT token FROM t WHERE k = '4')),
                       'stage cannot move back', 'advance refuses to move the stage back');
SELECT pg_temp.refused(format($q$SELECT pg_temp.advance(pg_temp.job('iv2-adv'), %L, '{"progressed": true, "stage": "done"}')$q$, (SELECT token FROM t WHERE k = '4')),
                       'only ingest_activate moves a job to done', 'advance refuses stage done');
SELECT pg_temp.refused(format($q$SELECT pg_temp.advance(pg_temp.job('iv2-adv'), %L, '{"progressed": true, "extract_hash": "xh2"}')$q$, (SELECT token FROM t WHERE k = '4')),
                       'extract_hash is already set to a different value', 'advance refuses a different extract_hash');
-- A stage change is progress even when the step reports none.
SELECT pg_temp.fresh('iv2-stage', 41);
INSERT INTO t VALUES ('s', pg_temp.claim1());
SELECT pg_temp.advance(pg_temp.job('iv2-stage'), (SELECT token FROM t WHERE k = 's'), '{"progressed": false, "stage": "index"}');
SELECT pg_temp.assert_true((SELECT stage = 'index' AND attempts = 0 FROM ingest_jobs WHERE id = pg_temp.job('iv2-stage')), 'a stage change resets attempts');
-- Backoff: 30 s x 2^attempts, capped at an hour; permanent errors fail.
SELECT pg_temp.fresh('iv2-backoff', 42);
INSERT INTO t VALUES ('b', pg_temp.claim1());
UPDATE ingest_jobs SET attempts = 2 WHERE id = pg_temp.job('iv2-backoff');
SELECT pg_temp.advance(pg_temp.job('iv2-backoff'), (SELECT token FROM t WHERE k = 'b'), '{"progressed": false, "error": {"code": "http_503", "message": "upstream busy", "permanent": false}}');
SELECT pg_temp.assert_true((SELECT status = 'queued' AND next_attempt_at = now() + interval '120 seconds' AND claim_token IS NULL AND lease_until IS NULL
                              FROM ingest_jobs WHERE id = pg_temp.job('iv2-backoff')),
                           'a transient failure re-queues after 30 s x 2^attempts');
SELECT pg_temp.assert_true((SELECT error_code = 'http_503' AND last_error = 'upstream busy' AND finished_at IS NULL FROM ingest_jobs WHERE id = pg_temp.job('iv2-backoff')),
                           'a transient failure records its code and message');
UPDATE ingest_jobs SET next_attempt_at = now() WHERE id = pg_temp.job('iv2-backoff');
INSERT INTO t VALUES ('b2', pg_temp.claim1());
UPDATE ingest_jobs SET attempts = 10 WHERE id = pg_temp.job('iv2-backoff');
SELECT pg_temp.advance(pg_temp.job('iv2-backoff'), (SELECT token FROM t WHERE k = 'b2'), '{"progressed": false, "error": {"code": "http_503", "message": "busy", "permanent": false}}');
SELECT pg_temp.assert_true((SELECT next_attempt_at = now() + interval '1 hour' FROM ingest_jobs WHERE id = pg_temp.job('iv2-backoff')), 'the backoff is capped at one hour');
SELECT pg_temp.fresh('iv2-permanent', 43);
INSERT INTO t VALUES ('p', pg_temp.claim1());
SELECT pg_temp.advance(pg_temp.job('iv2-permanent'), (SELECT token FROM t WHERE k = 'p'), '{"progressed": false, "error": {"code": "http_400", "message": "bad document", "permanent": true}}');
SELECT pg_temp.assert_true((SELECT status = 'failed' AND error_code = 'http_400' AND finished_at = now() AND claim_token IS NULL AND lease_until IS NULL
                              FROM ingest_jobs WHERE id = pg_temp.job('iv2-permanent')),
                           'a permanent failure fails the job');
-- Redaction: every rule has a secret only it catches.
SELECT pg_temp.fresh('iv2-redact', 44);
INSERT INTO t VALUES ('r', pg_temp.claim1());
SELECT pg_temp.advance(pg_temp.job('iv2-redact'), (SELECT token FROM t WHERE k = 'r'), jsonb_build_object('progressed', false, 'error', jsonb_build_object(
  'code', 'http_401 Bearer codetoken99',
  'message', 'upstream said no | GET https://api.mistral.ai/v1/ocr?token=querysecret1&expires=99 | sent Bearer abc.DEF_ghi-123'
             || ' | api_key=Zq9short1 | key sk-or-v1-abc123XYZ | jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig_abc'
             || ' | hex ' || left(pg_temp.h(99), 36) || ' | b64 QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU2Nzg5'
             || ' | url https://x.test/storage/v1/object/sign/corpus/files/abc.pdf | end',
  'permanent', false)));
CREATE TEMP TABLE redacted AS SELECT error_code, last_error FROM ingest_jobs WHERE id = pg_temp.job('iv2-redact');
SELECT pg_temp.assert_true((SELECT last_error LIKE 'upstream said no | GET https://api.mistral.ai/v1/ocr%' AND last_error LIKE '%| end' FROM redacted),
                           'redaction keeps the rest of the message');
SELECT pg_temp.assert_true((SELECT last_error NOT LIKE '%querysecret1%' AND last_error NOT LIKE '%expires=99%' AND last_error LIKE '%https://api.mistral.ai/v1/ocr?[redacted]%' FROM redacted),
                           'redaction strips URL query strings');
SELECT pg_temp.assert_true((SELECT last_error NOT LIKE '%abc.DEF_ghi-123%' AND last_error LIKE '%Bearer [redacted]%' FROM redacted), 'redaction removes bearer tokens');
SELECT pg_temp.assert_true((SELECT last_error NOT LIKE '%Zq9short1%' AND last_error LIKE '%api_key=[redacted]%' FROM redacted), 'redaction removes key=value secrets');
SELECT pg_temp.assert_true((SELECT last_error NOT LIKE '%abc123XYZ%' FROM redacted), 'redaction removes sk- keys');
SELECT pg_temp.assert_true((SELECT last_error NOT LIKE '%eyJzdWIiOiJ4In0%' FROM redacted), 'redaction removes JWTs');
SELECT pg_temp.assert_true((SELECT last_error NOT LIKE '%' || left(pg_temp.h(99), 36) || '%' FROM redacted), 'redaction removes long hex runs');
SELECT pg_temp.assert_true((SELECT last_error NOT LIKE '%QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU2Nzg5%' FROM redacted), 'redaction removes long base64 runs');
SELECT pg_temp.assert_true((SELECT last_error LIKE '%| url https://x.test/storage/v1/object/sign/corpus/files/abc.pdf |%' FROM redacted),
                           'redaction keeps a storage path readable');
SELECT pg_temp.assert_true((SELECT error_code NOT LIKE '%codetoken99%' AND error_code LIKE 'http_401%' FROM redacted), 'the error code is redacted too');
UPDATE ingest_jobs SET next_attempt_at = now() WHERE id = pg_temp.job('iv2-redact');
INSERT INTO t VALUES ('r2', pg_temp.claim1());
SELECT pg_temp.advance(pg_temp.job('iv2-redact'), (SELECT token FROM t WHERE k = 'r2'), jsonb_build_object('progressed', false, 'error', jsonb_build_object(
  'code', repeat('c', 500), 'message', repeat('word ', 2000), 'permanent', false)));
SELECT pg_temp.assert_true((SELECT length(last_error) <= 1000 AND length(error_code) <= 100 FROM ingest_jobs WHERE id = pg_temp.job('iv2-redact')),
                           'a stored error is truncated (message 1,000, code 100 characters)');

-- ===== 8. ingest_retry and ingest_cancel =====
SELECT pg_temp.refused($q$SELECT pg_temp.retry(pg_temp.job('iv2-redact'))$q$, 'only a failed or cancelled job can be retried', 'retry refuses a queued job');
SELECT pg_temp.retry(pg_temp.job('iv2-permanent'));
SELECT pg_temp.assert_true((SELECT status = 'queued' AND stage = 'ocr' AND attempts = 0 AND error_code IS NULL AND last_error IS NULL AND finished_at IS NULL AND next_attempt_at = now()
                              FROM ingest_jobs WHERE id = pg_temp.job('iv2-permanent')),
                           'retry re-queues a failed job with attempts 0 and no error');
SELECT pg_temp.fresh('iv2-cancel', 45);
INSERT INTO t VALUES ('c', pg_temp.claim1());
SELECT pg_temp.cancel(pg_temp.job('iv2-cancel'));
SELECT pg_temp.assert_true((SELECT status = 'cancelled' AND claim_token IS NULL AND lease_until IS NULL AND finished_at = now() FROM ingest_jobs WHERE id = pg_temp.job('iv2-cancel')),
                           'cancel stops a running job');
SELECT pg_temp.refused(format($q$SELECT pg_temp.advance(pg_temp.job('iv2-cancel'), %L, '{"progressed": true}')$q$, (SELECT token FROM t WHERE k = 'c')),
                       'is not running under this claim token', 'a cancelled job''s worker is fenced out');
SELECT pg_temp.assert_true((SELECT pg_temp.cancel(pg_temp.job('iv2-cancel'))->>'status') = 'cancelled', 'cancelling a cancelled job changes nothing');
SELECT pg_temp.retry(pg_temp.job('iv2-cancel'));
SELECT pg_temp.assert_true((SELECT status = 'queued' FROM ingest_jobs WHERE id = pg_temp.job('iv2-cancel')), 'retry re-queues a cancelled job');
SELECT pg_temp.refused($q$SELECT pg_temp.cancel(pg_temp.job('iv2-extracted'))$q$, 'cannot be cancelled', 'cancel refuses a succeeded job');

-- ===== 9. ingest_activate =====
SELECT pg_temp.fresh('iv2-act', 50, 2);
INSERT INTO t VALUES ('a1', pg_temp.claim1());
SELECT pg_temp.refused(format($q$SELECT pg_temp.activate(pg_temp.job('iv2-act'), %L, '{"extract_hash": "xa", "ocr_text": "", "content_sha256": "%s", "page_count": 2, "embed_tokens": 0, "embed_cost_usd": 0}')$q$,
                              (SELECT token FROM t WHERE k = 'a1'), encode(sha256(''::bytea), 'hex')),
                       'not index', 'activate refuses a job still at stage ocr');
SELECT pg_temp.advance(pg_temp.job('iv2-act'), (SELECT token FROM t WHERE k = 'a1'),
  '{"progressed": true, "stage": "index", "ocr_hash": "oha", "extract_hash": "xa", "model_id": "mistral-ocr-4-1", "embed_tokens": 40, "embed_cost_usd": 0.00004}');
INSERT INTO t VALUES ('a2', pg_temp.claim1());
-- Chunks committed before activation.
SET LOCAL ROLE service_role;
SELECT public.chunk_commit((SELECT id FROM documents WHERE source_key = 'iv2-act'), jsonb_build_array(
  jsonb_build_object('chunk_hash', 'act1', 'chunk_index', 0, 'source_kind', 'pdf_page', 'page_number', 1, 'char_from', 0, 'char_to', 8, 'content', 'page one',
                     'chunker_version', 3, 'embed_hash', 'e-act1', 'embedding', to_jsonb(pg_temp.v(1)::real[]))), array['act1']);
RESET ROLE;
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM match_documents(pg_temp.v(1), 5, array[(SELECT id FROM documents WHERE source_key = 'iv2-act')]))
                           AND (SELECT indexed_at IS NULL FROM documents WHERE source_key = 'iv2-act'),
                           'chunks committed before activation are invisible to match_documents');
SELECT pg_temp.refused(format($q$SELECT pg_temp.activate(pg_temp.job('iv2-act'), gen_random_uuid(), '{"extract_hash": "xa", "ocr_text": "page one", "content_sha256": "%s", "page_count": 2, "embed_tokens": 0, "embed_cost_usd": 0}')$q$,
                              encode(sha256(convert_to('page one', 'UTF8')), 'hex')),
                       'is not running under this claim token', 'activate refuses a token that is not the claim''s');
SELECT pg_temp.refused(format($q$SELECT pg_temp.activate(pg_temp.job('iv2-act'), %L, '{"extract_hash": "xa", "ocr_text": "page one", "content_sha256": "%s", "page_count": 2, "embed_tokens": 0, "embed_cost_usd": 0}')$q$,
                              (SELECT token FROM t WHERE k = 'a2'), encode(sha256(''::bytea), 'hex')),
                       'content_sha256 is not the SHA-256 of ocr_text', 'activate refuses a content_sha256 that does not match ocr_text');
SELECT pg_temp.refused(format($q$SELECT pg_temp.activate(pg_temp.job('iv2-act'), %L, '{"extract_hash": "xb", "ocr_text": "page one", "content_sha256": "%s", "page_count": 2, "embed_tokens": 0, "embed_cost_usd": 0}')$q$,
                              (SELECT token FROM t WHERE k = 'a2'), encode(sha256(convert_to('page one', 'UTF8')), 'hex')),
                       'extract_hash differs from the job', 'activate refuses an extract_hash other than the job''s');
-- An earlier failure's error, as the local end-to-end run left on a job that later succeeded.
UPDATE ingest_jobs SET error_code = 'internal', last_error = 'an earlier failure' WHERE id = pg_temp.job('iv2-act');
SELECT pg_temp.activate(pg_temp.job('iv2-act'), (SELECT token FROM t WHERE k = 'a2'), jsonb_build_object(
  'extract_hash', 'xa', 'ocr_text', E'page one\n\npage two', 'content_sha256', encode(sha256(convert_to(E'page one\n\npage two', 'UTF8')), 'hex'),
  'page_count', 2, 'embed_tokens', 60, 'embed_cost_usd', 0.00006));
SELECT pg_temp.assert_true((SELECT extract_hash = 'xa' AND ocr_text = E'page one\n\npage two' AND content_sha256 = encode(sha256(convert_to(E'page one\n\npage two', 'UTF8')), 'hex')
                                   AND page_count = 2 FROM documents WHERE source_key = 'iv2-act'),
                           'activate sets extract_hash, ocr_text, content_sha256 and page_count');
SELECT pg_temp.assert_true((SELECT indexed_at = now() FROM documents WHERE source_key = 'iv2-act'), 'activate sets indexed_at');
SELECT pg_temp.assert_true((SELECT stage = 'done' AND status = 'succeeded' AND finished_at = now() AND claim_token IS NULL AND lease_until IS NULL
                              FROM ingest_jobs WHERE id = pg_temp.job('iv2-act')),
                           'activate finishes the job: done, succeeded, lease cleared');
SELECT pg_temp.assert_true((SELECT embed_tokens = 100 AND embed_cost_usd = 0.0001 FROM ingest_jobs WHERE id = pg_temp.job('iv2-act')), 'activate adds its embedding counters');
SELECT pg_temp.assert_true((SELECT error_code IS NULL AND last_error IS NULL FROM ingest_jobs WHERE id = pg_temp.job('iv2-act')),
                           'activate clears an earlier failure''s error');
SELECT pg_temp.assert_true((SELECT count(*) FROM match_documents(pg_temp.v(1), 5, array[(SELECT id FROM documents WHERE source_key = 'iv2-act')])) = 1,
                           'after activation the chunks are searchable');
SELECT pg_temp.refused(format($q$SELECT pg_temp.advance(pg_temp.job('iv2-act'), %L, '{"progressed": true}')$q$, (SELECT token FROM t WHERE k = 'a2')),
                       'is not running under this claim token', 'an activated job''s token is spent');
-- First extraction only: a document that gained an extraction meanwhile is refused.
SELECT pg_temp.fresh('iv2-act2', 51, 2);
INSERT INTO t VALUES ('d1', pg_temp.claim1());
SELECT pg_temp.advance(pg_temp.job('iv2-act2'), (SELECT token FROM t WHERE k = 'd1'), '{"progressed": true, "stage": "index"}');
INSERT INTO t VALUES ('d2', pg_temp.claim1());
UPDATE documents SET extract_hash = 'x-other' WHERE source_key = 'iv2-act2';
SELECT pg_temp.refused(format($q$SELECT pg_temp.activate(pg_temp.job('iv2-act2'), %L, '{"extract_hash": "xn", "ocr_text": "t", "content_sha256": "%s", "page_count": 2, "embed_tokens": 0, "embed_cost_usd": 0}')$q$,
                              (SELECT token FROM t WHERE k = 'd2'), encode(sha256(convert_to('t', 'UTF8')), 'hex')),
                       'only a first extraction can be activated', 'activate refuses a document that is already extracted');
SELECT pg_temp.assert_true((SELECT indexed_at IS NULL AND ocr_text = '' AND extract_hash = 'x-other' FROM documents WHERE source_key = 'iv2-act2')
                           AND (SELECT status = 'running' FROM ingest_jobs WHERE id = pg_temp.job('iv2-act2')),
                           'a refused activation changes neither the document nor the job');

ROLLBACK;
