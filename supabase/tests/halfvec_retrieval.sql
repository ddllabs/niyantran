-- Disposable PG + real pgvector assertions for F22: unscoped match_documents
-- ranks on the half-precision HNSW index, the full-precision index is gone,
-- scoped retrieval is unchanged, and similarities stay full precision.
-- Run on the least-privilege fixture plus research-turn persistence,
-- 20260922104646, 20260929120000_halfvec_index and
-- 20260929120100_match_documents_halfvec; never against a hosted project.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE FUNCTION pg_temp.assert_true(actual boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF actual IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END; $$;

SELECT pg_temp.assert_true(to_regclass('public.document_chunks_embedding_halfvec_hnsw') IS NOT NULL, 'the half-precision index exists');
SELECT pg_temp.assert_true(to_regclass('public.document_chunks_embedding_hnsw') IS NULL, 'the full-precision index is dropped');
SELECT pg_temp.assert_true(pg_get_functiondef('public.match_documents(extensions.vector,int,uuid[],text)'::regprocedure) ILIKE '%halfvec(1536)) <=> (query_embedding::extensions.halfvec(1536))%', 'unscoped ranking uses the half-precision expression');

-- A small corpus: axis-aligned unit vectors, so the true ranking is known.
CREATE FUNCTION pg_temp.v(i int, w real DEFAULT 1) RETURNS vector LANGUAGE sql AS $$
  SELECT (array_fill(0::real, array[i - 1]) || array[w] || array_fill(0::real, array[1536 - i]))::vector(1536);
$$;
INSERT INTO documents (id, source_key, title, desk_tier, content_sha256, ocr_text, chunker_version, indexed_at) VALUES
  ('a0220000-0000-0000-0000-000000000001', 'f22-a', 'Doc A', 'national', 'sha-a', 'aaaa', 2, now()),
  ('a0220000-0000-0000-0000-000000000002', 'f22-b', 'Doc B', 'law', 'sha-b', 'bbbb', 2, now()),
  ('a0220000-0000-0000-0000-000000000003', 'f22-c', 'Doc C', 'national', 'sha-c', 'cccc', 2, NULL);
INSERT INTO document_chunks (document_id, chunk_hash, chunk_index, char_from, char_to, content, embedding, chunker_version)
SELECT 'a0220000-0000-0000-0000-000000000001'::uuid, 'a' || i, i, 0, 4, 'aaaa', pg_temp.v(1) + pg_temp.v(i + 1, 0.1 * i), 2 FROM generate_series(1, 5) i
UNION ALL
SELECT 'a0220000-0000-0000-0000-000000000002'::uuid, 'b' || i, i, 0, 4, 'bbbb', pg_temp.v(2) + pg_temp.v(i + 10, 0.1 * i), 2 FROM generate_series(1, 5) i
UNION ALL
SELECT 'a0220000-0000-0000-0000-000000000003'::uuid, 'c1', 1, 0, 4, 'cccc', pg_temp.v(1), 2;

-- Unscoped: the nearest chunks come first, an unindexed document is never
-- returned, and the similarity is the full-precision cosine.
SELECT pg_temp.assert_true((SELECT array_agg(chunk_index ORDER BY similarity DESC) FROM match_documents(pg_temp.v(1), 3)) = array[1, 2, 3], 'unscoped ranks by similarity');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM match_documents(pg_temp.v(1), 40) WHERE document_id = 'a0220000-0000-0000-0000-000000000003'), 'an unindexed document is excluded');
SELECT pg_temp.assert_true((SELECT abs(similarity - (1 - ((pg_temp.v(1) + pg_temp.v(2, 0.1)) <=> pg_temp.v(1)))) < 1e-9 FROM match_documents(pg_temp.v(1), 1)), 'similarity is full precision');
SELECT pg_temp.assert_true((SELECT bool_and(desk_tier = 'law') FROM match_documents(pg_temp.v(2), 40, NULL, 'law')), 'the desk tier filter still applies');

-- Scoped: unchanged. One document gets the whole limit; two share it.
SELECT pg_temp.assert_true((SELECT count(*) FROM match_documents(pg_temp.v(1), 40, array['a0220000-0000-0000-0000-000000000002'::uuid])) = 5, 'scoped returns every chunk of the attached document');
SELECT pg_temp.assert_true((SELECT count(DISTINCT document_id) FROM match_documents(pg_temp.v(1), 4, array['a0220000-0000-0000-0000-000000000001'::uuid, 'a0220000-0000-0000-0000-000000000002'::uuid])) = 2, 'two attached documents share the budget');

-- The planner can use the expression index for the unscoped ordering.
SET LOCAL enable_seqscan = off;
CREATE TEMP TABLE plan_lines (line text);
DO $$ DECLARE r record; BEGIN
  FOR r IN EXECUTE 'EXPLAIN SELECT c.id FROM public.document_chunks c WHERE c.embedding IS NOT NULL ORDER BY (c.embedding::extensions.halfvec(1536)) <=> ($1::extensions.halfvec(1536)) LIMIT 5' USING pg_temp.v(1) LOOP
    INSERT INTO plan_lines VALUES (r."QUERY PLAN");
  END LOOP;
END $$;
SELECT pg_temp.assert_true(EXISTS (SELECT FROM plan_lines WHERE line ILIKE '%document_chunks_embedding_halfvec_hnsw%'), 'the unscoped ordering can use the half-precision index');
ROLLBACK;
