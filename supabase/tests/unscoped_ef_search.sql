-- Disposable PG + real pgvector assertions for F35 (20261015130000_unscoped_ef_search): the unscoped
-- branch of match_documents searches the HNSW index with ef_search 200, restores the caller's value,
-- and changes nothing else (one overload, same settings and grants).
-- Run on page_contract's chain plus that migration, as a non-superuser; never against a hosted project.
-- The vacuity check drops the migration: with the default ef_search (40) the index hands back only
-- the 100 nearer chunks of an unindexed document, the indexed_at filter removes them all, and the
-- search returns nothing.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE FUNCTION pg_temp.assert_true(actual boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF actual IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END; $$;

-- Shape and privileges are unchanged.
SELECT pg_temp.assert_true((SELECT count(*) FROM pg_proc WHERE proname = 'match_documents' AND pronamespace = 'public'::regnamespace) = 1, 'exactly one match_documents overload');
SELECT pg_temp.assert_true((SELECT proconfig FROM pg_proc WHERE oid = to_regprocedure('public.match_documents(extensions.vector,int,uuid[],text,text)')) = array['search_path=public, extensions'], 'match_documents sets only search_path (no hnsw SET clause)');
SELECT pg_temp.assert_true((SELECT NOT prosecdef FROM pg_proc WHERE oid = to_regprocedure('public.match_documents(extensions.vector,int,uuid[],text,text)')), 'match_documents stays security invoker');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.match_documents(extensions.vector,int,uuid[],text,text)', 'EXECUTE')
                       AND NOT has_function_privilege('public', 'public.match_documents(extensions.vector,int,uuid[],text,text)', 'EXECUTE'), 'anon and PUBLIC cannot execute match_documents');
SELECT pg_temp.assert_true(has_function_privilege('authenticated', 'public.match_documents(extensions.vector,int,uuid[],text,text)', 'EXECUTE')
                       AND has_function_privilege('service_role', 'public.match_documents(extensions.vector,int,uuid[],text,text)', 'EXECUTE'), 'authenticated and service_role can execute match_documents');

-- The corpus. Query = axis 1.
--   Hidden: one UNINDEXED document with 100 chunks on a spiral around axis 1, cosine distance
--     0.01 .. 0.20, all nearer than any indexed chunk. 100 > 40, so at the default ef_search the
--     index's candidates are all Hidden chunks.
--   Shown: one indexed document with 5 chunks on their own axes at distance 0.29 .. 0.40.
CREATE FUNCTION pg_temp.v(i int, w real DEFAULT 1) RETURNS vector LANGUAGE sql AS $$
  SELECT (array_fill(0::real, array[i - 1]) || array[w] || array_fill(0::real, array[1536 - i]))::vector(1536);
$$;
CREATE FUNCTION pg_temp.spiral(k int) RETURNS vector LANGUAGE sql AS $$
  SELECT (array[1::real, (r * cos(k * 2.39996323))::real, (r * sin(k * 2.39996323))::real]
          || array_fill(0::real, array[1533]))::vector(1536)
    FROM (SELECT sqrt(1 / (1 - (0.01 + (k - 1) * 0.19 / 99)) ^ 2 - 1) AS r) y;
$$;
INSERT INTO documents (id, source_key, title, desk_tier, desk_feature, content_sha256, ocr_text, chunker_version, indexed_at) VALUES
  ('f3500000-0000-0000-0000-000000000001', 'ef-hidden', 'Hidden', 'national', 'Hidden', 'sha-ef-h', 'hhhh', 2, NULL),
  ('f3500000-0000-0000-0000-000000000002', 'ef-shown',  'Shown',  'national', 'Shown',  'sha-ef-s', 'ssss', 2, now());
INSERT INTO document_chunks (document_id, chunk_hash, chunk_index, char_from, char_to, content, embedding, chunker_version)
SELECT 'f3500000-0000-0000-0000-000000000001'::uuid, 'efh' || k, k, 0, 4, 'hhhh', pg_temp.spiral(k), 2
  FROM generate_series(1, 100) k
UNION ALL
SELECT 'f3500000-0000-0000-0000-000000000002'::uuid, 'efs' || i, 100 + i, 0, 4, 'ssss', pg_temp.v(1) + pg_temp.v(1000 + i, w), 2
  FROM (VALUES (1, 1.00::real), (2, 1.05), (3, 1.10), (4, 1.15), (5, 1.20)) t(i, w);
ANALYZE documents;
ANALYZE document_chunks;

-- The index must be used, as on NTER, or the test proves nothing.
SET LOCAL enable_seqscan = off;
SET LOCAL enable_sort = off;
-- Load pgvector's library so hnsw.ef_search is a real setting, then set a caller value.
SELECT pg_temp.v(1) <=> pg_temp.v(2);
SET LOCAL hnsw.ef_search = 10;

DO $$ DECLARE r text; plan text := ''; BEGIN
  FOR r IN EXECUTE 'EXPLAIN (COSTS OFF) SELECT c.id FROM public.document_chunks c JOIN public.documents d ON d.id = c.document_id WHERE c.embedding IS NOT NULL AND d.indexed_at IS NOT NULL ORDER BY (c.embedding::extensions.halfvec(1536)) <=> (pg_temp.v(1)::extensions.halfvec(1536)) LIMIT 10' LOOP plan := plan || r || ' '; END LOOP;
  PERFORM pg_temp.assert_true(plan ILIKE '%document_chunks_embedding_halfvec_hnsw%', 'the unscoped query runs on the HNSW index, as on NTER');
END $$;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE got ON COMMIT DROP AS
  SELECT row_number() OVER () AS rn, m.* FROM public.match_documents(pg_temp.v(1), 10) m;
RESET ROLE;

SELECT pg_temp.assert_true((SELECT count(*) FROM got) = 5, 'unscoped search past 100 nearer unindexed chunks returns all 5 indexed ones (ef_search 200)');
SELECT pg_temp.assert_true((SELECT array_agg(chunk_index ORDER BY rn) FROM got) = array[101, 102, 103, 104, 105], 'in exact distance order');
SELECT pg_temp.assert_true((SELECT bool_and(document_id = 'f3500000-0000-0000-0000-000000000002') FROM got), 'no unindexed document is returned');
SELECT pg_temp.assert_true(current_setting('hnsw.ef_search') = '10', 'the caller''s ef_search is restored after the call');

-- The scoped branch is untouched: it never sets ef_search.
SET LOCAL ROLE authenticated;
SELECT count(*) FROM public.match_documents(pg_temp.v(1), 10, array['f3500000-0000-0000-0000-000000000002'::uuid]);
RESET ROLE;
SELECT pg_temp.assert_true(current_setting('hnsw.ef_search') = '10', 'the scoped branch leaves ef_search alone');

ROLLBACK;
