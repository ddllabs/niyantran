-- Disposable PG assertions for ingest_discard (20261001160000_ingest_discard;
-- docs/specs/2026-10-01-rag-v2-admin-upload.md, decision 6 and "Testing
-- strategy"; plan docs/plans/2026-10-01-rag-v2-admin-upload.md, B1): the
-- function's shape and execute grants; the partial documents_file_sha256 index;
-- each refusal with its exact message (a missing document, a key that is not
-- upload:, a live document by indexed_at and by extract_hash, and a queued,
-- running or succeeded job); discarding an upload whose jobs failed or were
-- cancelled, with every dependent row cascading and other documents and the
-- stored objects untouched; and the row lock, across two real sessions (dblink):
-- a discard that waits on a registration's lock re-checks the jobs afterwards.
-- Run on ingestion_v2's chain plus the migration, which run.sh applies as a
-- NON-superuser; never against a hosted project. The vacuity check drops the
-- migration. Every label is unique and each assertion was shown red on its own
-- against a broken variant of the migration (the one seeding guard, marked
-- below, checks the fixture itself).
--
-- Sections 1 and 2 read the catalogue; section 3 runs in one transaction that
-- is rolled back; section 4 commits (two dblink sessions cannot see an open
-- transaction) and deletes its rows afterwards. It comes last, so a broken
-- refusal fails at its own assertion in section 3 first.
\set ON_ERROR_STOP on
SET search_path = public, extensions;
CREATE FUNCTION pg_temp.assert_true(actual boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF actual IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END; $$;
-- Refused with exactly `message` (admin-ingest maps these messages to its 409).
CREATE FUNCTION pg_temp.refused_with(statement text, message text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM IS DISTINCT FROM message THEN RAISE EXCEPTION 'FAIL: % expected "%" got %: %', label, message, SQLSTATE, SQLERRM; END IF;
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

-- Inputs. h(n): a distinct SHA-256. doc(): an uploaded document as
-- ingest_register leaves it (not indexed, no extraction), keyed upload:<sha>
-- unless a key is given. job(): a job in the given status, valid for the
-- table's checks.
CREATE FUNCTION pg_temp.h(n int) RETURNS text LANGUAGE sql AS $$ SELECT encode(sha256(convert_to('discard-' || n, 'UTF8')), 'hex') $$;
CREATE FUNCTION pg_temp.doc(id uuid, n int, key text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.documents (id, source_key, title, content_sha256, ocr_text, page_count, storage_path, file_sha256, source_mime)
  VALUES (id, coalesce(key, 'upload:' || pg_temp.h(n)), 'Discard ' || n, encode(sha256(''::bytea), 'hex'), '', 4,
          'files/' || pg_temp.h(n) || '.pdf', pg_temp.h(n), 'application/pdf')
$$;
CREATE FUNCTION pg_temp.job(doc uuid, status text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.ingest_jobs (document_id, status, stage, file_sha256, pages_total, claim_token, lease_until, finished_at)
  SELECT doc, status, CASE WHEN status = 'succeeded' THEN 'done' ELSE 'ocr' END, d.file_sha256, 4,
         CASE WHEN status = 'running' THEN gen_random_uuid() END,
         CASE WHEN status = 'running' THEN now() + interval '5 minutes' END,
         CASE WHEN status IN ('succeeded', 'failed', 'cancelled') THEN now() END
    FROM public.documents d WHERE d.id = doc
$$;
-- Every dependent row a document can have: two pages, two blocks, an image,
-- two chunks, two stored parts, two raw OCR pages.
CREATE FUNCTION pg_temp.seed(doc uuid, n int) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.document_pages (document_id, extract_hash, page_number, text, char_from, char_to)
    VALUES (doc, 'x' || n, 1, 'page one', 0, 8), (doc, 'x' || n, 2, 'page two', 10, 18);
  INSERT INTO public.document_page_blocks (document_id, extract_hash, page_number, block_index, type, content)
    VALUES (doc, 'x' || n, 1, 0, 'text', 'page one'), (doc, 'x' || n, 2, 0, 'text', 'page two');
  INSERT INTO public.document_page_images (document_id, extract_hash, page_number, placeholder, sha256, mime, storage_path)
    VALUES (doc, 'x' || n, 1, 'img:1-1', pg_temp.h(1000 + n), 'image/png', 'img/' || pg_temp.h(1000 + n) || '.png');
  INSERT INTO public.document_chunks (document_id, chunk_hash, chunk_index, source_kind, page_number, char_from, char_to, content, chunker_version)
    VALUES (doc, 'c1-' || n, 0, 'pdf_page', 1, 0, 8, 'page one', 3), (doc, 'c2-' || n, 1, 'pdf_page', 2, 10, 18, 'page two', 3);
  INSERT INTO public.document_files (document_id, part_index, page_offset, page_count, sha256, byte_size, storage_path)
    VALUES (doc, 0, 0, 2, pg_temp.h(2000 + n), 100, 'files/' || pg_temp.h(2000 + n) || '.pdf'),
           (doc, 1, 2, 2, pg_temp.h(3000 + n), 100, 'files/' || pg_temp.h(3000 + n) || '.pdf');
  INSERT INTO public.document_ocr_pages (document_id, ocr_hash, page_number, raw)
    VALUES (doc, 'o' || n, 1, '{"index": 0}'), (doc, 'o' || n, 2, '{"index": 1}');
$$;
-- The rows each dependent table holds for a document.
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
-- The function, called as service_role (the only role granted it).
CREATE FUNCTION pg_temp.discard(doc uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb; BEGIN SET LOCAL ROLE service_role; r := public.ingest_discard(doc); RESET ROLE; RETURN r; END; $$;

-- ===== 1. Shape and execute grants =====
SELECT pg_temp.assert_true((SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'ingest_discard') = 1
                           AND to_regprocedure('public.ingest_discard(uuid)') IS NOT NULL,
                           'ingest_discard exists once, as ingest_discard(uuid)');
SELECT pg_temp.assert_true(pg_get_function_result('public.ingest_discard(uuid)'::regprocedure) = 'jsonb', 'ingest_discard returns jsonb');
SELECT pg_temp.assert_true((SELECT prosecdef AND proconfig IS NOT DISTINCT FROM array['search_path=public, extensions']
                              FROM pg_proc WHERE oid = 'public.ingest_discard(uuid)'::regprocedure),
                           'ingest_discard is security definer and sets only search_path = public, extensions');
SELECT pg_temp.assert_true((SELECT NOT r.rolsuper FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner WHERE p.oid = 'public.ingest_discard(uuid)'::regprocedure),
                           'the migration was applied by a role that is not a superuser');
-- PUBLIC first: a grant to PUBLIC also reaches anon and authenticated.
DO $$
DECLARE actor text; expected boolean;
BEGIN
  FOREACH actor IN ARRAY ARRAY['public', 'anon', 'authenticated', 'service_role'] LOOP
    expected := actor = 'service_role';
    PERFORM pg_temp.assert_true(has_function_privilege(actor, 'public.ingest_discard(uuid)', 'EXECUTE') = expected,
                                actor || CASE WHEN expected THEN ' can ' ELSE ' cannot ' END || 'execute ingest_discard');
  END LOOP;
END; $$;

-- ===== 2. The index prepare looks documents up by =====
SELECT pg_temp.assert_true((SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'documents' AND indexname = 'documents_file_sha256')
                           = 'CREATE INDEX documents_file_sha256 ON public.documents USING btree (file_sha256) WHERE (file_sha256 IS NOT NULL)',
                           'documents_file_sha256 is a plain btree on file_sha256, partial where it is not null');

BEGIN;
SET LOCAL search_path = public, extensions;

-- ===== 3. Refusals, discards and the cascade =====
-- Each refused document breaks exactly one rule, so each refusal is pinned to it.
SELECT pg_temp.doc('d1000000-0000-4000-8000-000000000001', 1, 'legacy-discard-1');           -- a key that is not upload:
SELECT pg_temp.doc('d1000000-0000-4000-8000-000000000002', 2, 'upload-' || pg_temp.h(2));    -- upload without the colon
SELECT pg_temp.doc('d1000000-0000-4000-8000-000000000003', 3, 'x-upload:' || pg_temp.h(3));  -- upload: not at the start
SELECT pg_temp.doc('d1000000-0000-4000-8000-000000000004', 4);                               -- indexed
UPDATE documents SET indexed_at = now() WHERE id = 'd1000000-0000-4000-8000-000000000004';
SELECT pg_temp.doc('d1000000-0000-4000-8000-000000000005', 5);                               -- extracted, not yet indexed
UPDATE documents SET extract_hash = 'x-5' WHERE id = 'd1000000-0000-4000-8000-000000000005';
SELECT pg_temp.doc('d1000000-0000-4000-8000-000000000006', 6);                               -- a queued job beside a failed one
SELECT pg_temp.job('d1000000-0000-4000-8000-000000000006', 'failed');
SELECT pg_temp.job('d1000000-0000-4000-8000-000000000006', 'queued');
SELECT pg_temp.doc('d1000000-0000-4000-8000-000000000007', 7);                               -- a running job
SELECT pg_temp.job('d1000000-0000-4000-8000-000000000007', 'running');
SELECT pg_temp.doc('d1000000-0000-4000-8000-000000000008', 8);                               -- a succeeded job, document not live
SELECT pg_temp.job('d1000000-0000-4000-8000-000000000008', 'succeeded');

SELECT pg_temp.refused_with($q$SELECT pg_temp.discard('d1000000-0000-4000-8000-0000000000ff')$q$,
                            'ingest_discard: document not found', 'discard refuses a document that does not exist');
SELECT pg_temp.refused_with($q$SELECT pg_temp.discard('d1000000-0000-4000-8000-000000000001')$q$,
                            'ingest_discard: not an upload', 'discard refuses a document whose key is not upload:');
SELECT pg_temp.refused_with($q$SELECT pg_temp.discard('d1000000-0000-4000-8000-000000000002')$q$,
                            'ingest_discard: not an upload', 'discard refuses a key that starts upload without the colon');
SELECT pg_temp.refused_with($q$SELECT pg_temp.discard('d1000000-0000-4000-8000-000000000003')$q$,
                            'ingest_discard: not an upload', 'discard refuses a key with upload: after its start');
SELECT pg_temp.refused_with($q$SELECT pg_temp.discard('d1000000-0000-4000-8000-000000000004')$q$,
                            'ingest_discard: already live', 'discard refuses an indexed document');
SELECT pg_temp.refused_with($q$SELECT pg_temp.discard('d1000000-0000-4000-8000-000000000005')$q$,
                            'ingest_discard: already live', 'discard refuses a document with an extraction, even before indexed_at');
SELECT pg_temp.refused_with($q$SELECT pg_temp.discard('d1000000-0000-4000-8000-000000000006')$q$,
                            'ingest_discard: has an active or succeeded job', 'discard refuses a document with a queued job');
SELECT pg_temp.refused_with($q$SELECT pg_temp.discard('d1000000-0000-4000-8000-000000000007')$q$,
                            'ingest_discard: has an active or succeeded job', 'discard refuses a document with a running job');
SELECT pg_temp.refused_with($q$SELECT pg_temp.discard('d1000000-0000-4000-8000-000000000008')$q$,
                            'ingest_discard: has an active or succeeded job', 'discard refuses a document with a succeeded job');

-- Accepted: an upload whose only job failed, and one whose only job was
-- cancelled. Each is created just before its discard, so a discard that
-- removed more than its own document would show at the bystander below.
SELECT pg_temp.doc('d1000000-0000-4000-8000-000000000009', 9);
SELECT pg_temp.job('d1000000-0000-4000-8000-000000000009', 'failed');
SELECT pg_temp.accepted($q$SELECT pg_temp.discard('d1000000-0000-4000-8000-000000000009')$q$, 'discard accepts an upload whose only job failed');
SELECT pg_temp.doc('d1000000-0000-4000-8000-00000000000a', 10);
SELECT pg_temp.job('d1000000-0000-4000-8000-00000000000a', 'cancelled');
SELECT pg_temp.accepted($q$SELECT pg_temp.discard('d1000000-0000-4000-8000-00000000000a')$q$, 'discard accepts an upload whose only job was cancelled');

-- The cascade: a document with a failed and a cancelled job and every
-- dependent row, a bystander like it, and a stored object of the first.
SELECT pg_temp.doc('d1000000-0000-4000-8000-00000000000b', 11);
SELECT pg_temp.job('d1000000-0000-4000-8000-00000000000b', 'failed');
SELECT pg_temp.job('d1000000-0000-4000-8000-00000000000b', 'cancelled');
SELECT pg_temp.seed('d1000000-0000-4000-8000-00000000000b', 11);
SELECT pg_temp.doc('d1000000-0000-4000-8000-00000000000c', 12);
SELECT pg_temp.job('d1000000-0000-4000-8000-00000000000c', 'failed');
SELECT pg_temp.seed('d1000000-0000-4000-8000-00000000000c', 12);
INSERT INTO storage.objects (bucket_id, name, metadata)
  VALUES ('corpus', 'files/' || pg_temp.h(11) || '.pdf', '{"size": 100, "mimetype": "application/pdf"}');
CREATE TEMP TABLE before AS SELECT pg_temp.rows_of('d1000000-0000-4000-8000-00000000000b') AS target,
                                   pg_temp.rows_of('d1000000-0000-4000-8000-00000000000c') AS bystander,
                                   (SELECT count(*) FROM documents) AS documents;
-- (A guard on the fixture's own seeding, not on the migration.)
SELECT pg_temp.assert_true((SELECT target = '{"documents": 1, "document_pages": 2, "document_page_blocks": 2, "document_page_images": 1, "document_chunks": 2,
                                              "document_files": 2, "document_ocr_pages": 2, "ingest_jobs": 2}'::jsonb
                                   AND bystander = target || '{"ingest_jobs": 1}'::jsonb
                              FROM before),
                           'before the discard every dependent table holds rows for the seeded documents');
-- (A call and a check of its effects are separate statements: one statement's
-- snapshot does not see what a function it calls has written.)
CREATE TEMP TABLE result AS SELECT pg_temp.discard('d1000000-0000-4000-8000-00000000000b') AS r;
SELECT pg_temp.assert_true((SELECT r = '{"discarded": true}'::jsonb FROM result), 'discard returns {"discarded": true}');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM documents WHERE id = 'd1000000-0000-4000-8000-00000000000b'), 'the discarded document is gone');
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['document_pages', 'document_page_blocks', 'document_page_images', 'document_chunks',
                             'document_files', 'document_ocr_pages', 'ingest_jobs'] LOOP
    PERFORM pg_temp.assert_true((pg_temp.rows_of('d1000000-0000-4000-8000-00000000000b')->>tbl)::int = 0,
                                'the discarded document''s ' || tbl || ' rows are gone');
  END LOOP;
END; $$;
SELECT pg_temp.assert_true((SELECT pg_temp.rows_of('d1000000-0000-4000-8000-00000000000c') = bystander FROM before)
                           AND (SELECT count(*) FROM documents) = (SELECT documents - 1 FROM before),
                           'every other document and its rows are untouched');
SELECT pg_temp.assert_true(EXISTS (SELECT FROM storage.objects WHERE bucket_id = 'corpus' AND name = 'files/' || pg_temp.h(11) || '.pdf'),
                           'the discarded document''s stored object is left for the sweeper');

ROLLBACK;

-- ===== 4. The row lock across two sessions (committed; cleaned up after) =====
-- Session A holds the document's row lock (as ingest_register does while it
-- resumes a failed job) and re-queues the job. Session B's discard must wait
-- for the lock and then see the queued job; without the lock it would check
-- the jobs first, wait only at its delete, and remove a document whose job is
-- queued.
CREATE SCHEMA fixture_dblink;
CREATE EXTENSION dblink SCHEMA fixture_dblink;
SELECT pg_temp.doc('d1000000-0000-4000-8000-00000000000d', 13);
SELECT pg_temp.job('d1000000-0000-4000-8000-00000000000d', 'failed');
SELECT fixture_dblink.dblink_connect('dis_a', 'dbname=' || current_database() || ' user=postgres');
SELECT fixture_dblink.dblink_connect('dis_b', 'dbname=' || current_database() || ' user=postgres');
SELECT fixture_dblink.dblink_exec('dis_a', 'BEGIN');
SELECT * FROM fixture_dblink.dblink('dis_a', $q$SELECT 1 FROM public.documents WHERE id = 'd1000000-0000-4000-8000-00000000000d' FOR UPDATE$q$) AS t(locked int);
SELECT fixture_dblink.dblink_exec('dis_a', $q$UPDATE public.ingest_jobs SET status = 'queued', finished_at = NULL WHERE document_id = 'd1000000-0000-4000-8000-00000000000d'$q$);
SELECT fixture_dblink.dblink_exec('dis_b', 'SET ROLE service_role');
SELECT fixture_dblink.dblink_send_query('dis_b', $q$SELECT public.ingest_discard('d1000000-0000-4000-8000-00000000000d')::text$q$);
SELECT pg_sleep(0.5);
SELECT pg_temp.assert_true(fixture_dblink.dblink_is_busy('dis_b') = 1, 'session B''s discard waits while A holds the document''s lock');
SELECT fixture_dblink.dblink_exec('dis_a', 'COMMIT');
SELECT pg_temp.refused_with($q$SELECT * FROM fixture_dblink.dblink_get_result('dis_b') AS t(r text)$q$,
                            'ingest_discard: has an active or succeeded job',
                            'a discard that waited on the lock re-checks the jobs and refuses the re-queued one');
SELECT fixture_dblink.dblink_disconnect('dis_a');
SELECT fixture_dblink.dblink_disconnect('dis_b');
DELETE FROM documents WHERE id = 'd1000000-0000-4000-8000-00000000000d';
DROP EXTENSION dblink;
DROP SCHEMA fixture_dblink;
