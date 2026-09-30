-- Disposable PG + real pgvector assertions for retrieval-scope's feature filter
-- (20261001100000_match_documents_feature): with a desk feature and no ids,
-- match_documents returns the feature's nearest chunks in exact order even when
-- hundreds of out-of-feature chunks sit nearer the query; ids still win; the
-- unscoped branch is unchanged; the large-feature helper carries its own
-- ef_search; one overload; no anon/PUBLIC execute; document_modules() returns
-- every (tier, feature) pair once, past 1,000 documents.
-- Run on the halfvec_retrieval chain plus 20261001100000_match_documents_feature;
-- never against a hosted project. The vacuity check drops that migration.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE FUNCTION pg_temp.assert_true(actual boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF actual IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END; $$;

-- Shape: exactly one overload, with the feature argument; the helper and
-- document_modules exist. The regprocedure casts fail loudly without the migration.
SELECT pg_temp.assert_true((SELECT count(*) FROM pg_proc WHERE proname = 'match_documents' AND pronamespace = 'public'::regnamespace) = 1, 'exactly one match_documents overload');
SELECT pg_temp.assert_true(to_regprocedure('public.match_documents(extensions.vector,int,uuid[],text,text)') IS NOT NULL, 'match_documents takes p_desk_feature');
SELECT pg_temp.assert_true(to_regprocedure('public.match_documents_feature_hnsw(extensions.vector,int,text,text)') IS NOT NULL, 'the large-feature helper exists');
SELECT pg_temp.assert_true(to_regprocedure('public.document_modules()') IS NOT NULL, 'document_modules() exists');

-- Session settings live only on the helper, as a SET clause (scoped to the call).
SELECT pg_temp.assert_true(pg_get_functiondef(to_regprocedure('public.match_documents(extensions.vector,int,uuid[],text,text)')) ILIKE '%match_documents_feature_hnsw(%', 'match_documents routes large features to the helper');
SELECT pg_temp.assert_true(pg_get_functiondef(to_regprocedure('public.match_documents_feature_hnsw(extensions.vector,int,text,text)')) ILIKE '%set_config(''hnsw.ef_search'', c_ef_search, true)%'
                       AND pg_get_functiondef(to_regprocedure('public.match_documents_feature_hnsw(extensions.vector,int,text,text)')) ~* 'c_ef_search\s+constant\s+text\s*:=\s*''400''', 'the helper sets hnsw.ef_search = 400 for its own query');
SELECT pg_temp.assert_true((SELECT proconfig IS NULL OR NOT EXISTS (SELECT 1 FROM unnest(proconfig) s WHERE s LIKE 'hnsw.%') FROM pg_proc WHERE oid = to_regprocedure('public.match_documents_feature_hnsw(extensions.vector,int,text,text)')), 'no hnsw SET clause (NTER refuses it for a non-superuser)');
SELECT pg_temp.assert_true(pg_get_functiondef(to_regprocedure('public.match_documents(extensions.vector,int,uuid[],text,text)')) NOT ILIKE '%set_config%', 'match_documents itself sets nothing');
SELECT pg_temp.assert_true((SELECT proconfig FROM pg_proc WHERE oid = to_regprocedure('public.match_documents(extensions.vector,int,uuid[],text,text)')) = array['search_path=public, extensions'], 'match_documents sets only search_path');

-- Privileges: PUBLIC and anon cannot execute any of the three; authenticated and service_role can.
SELECT pg_temp.assert_true(bool_and(NOT has_function_privilege('anon', f, 'EXECUTE')), 'anon cannot execute match_documents, the helper or document_modules')
  FROM unnest(array['public.match_documents(extensions.vector,int,uuid[],text,text)', 'public.match_documents_feature_hnsw(extensions.vector,int,text,text)', 'public.document_modules()']) f;
SELECT pg_temp.assert_true(bool_and(NOT has_function_privilege('public', f, 'EXECUTE')), 'PUBLIC cannot execute match_documents, the helper or document_modules')
  FROM unnest(array['public.match_documents(extensions.vector,int,uuid[],text,text)', 'public.match_documents_feature_hnsw(extensions.vector,int,text,text)', 'public.document_modules()']) f;
SELECT pg_temp.assert_true(bool_and(has_function_privilege('authenticated', f, 'EXECUTE') AND has_function_privilege('service_role', f, 'EXECUTE')), 'authenticated and service_role can execute all three')
  FROM unnest(array['public.match_documents(extensions.vector,int,uuid[],text,text)', 'public.match_documents_feature_hnsw(extensions.vector,int,text,text)', 'public.document_modules()']) f;

-- The corpus. Query = axis 1. Each chunk is axis 1 plus an offset, so the
-- true order is known.
--   Large (national): 600 chunks on a spiral in the plane of axes 2 and 3, all
--     NEARER than any Small chunk: l1..l10 at cosine distance 0.01 .. 0.10,
--     the rest packed between 0.11 and 0.20. 600 > ef_search 400, so an index
--     scan filtered afterwards sees only Large and returns no Small row at all.
--     (Spacing matters: HNSW normalises for cosine, and at half precision a
--     component near 1 moves in steps of about 5e-4, so chunks closer than that
--     tie inside the index. A spiral, not one axis per chunk: offsets on
--     separate axes are mutually equidistant, which HNSW prunes into poor recall.)
--   Small chunks each sit on their own axis at offset w (distance 0.29 .. 0.40):
--     S1 w 1.00 1.10 1.20 (+ one chunk with no embedding), S2 w 1.05 1.15
--     (national); S3 w 1.03 1.13 (state).
--   S4 is Small (national) but unindexed, and holds the query vector itself.
CREATE FUNCTION pg_temp.v(i int, w real DEFAULT 1) RETURNS vector LANGUAGE sql AS $$
  SELECT (array_fill(0::real, array[i - 1]) || array[w] || array_fill(0::real, array[1536 - i]))::vector(1536);
$$;
-- Offset r gives cosine distance d = 1 - 1/sqrt(1 + r^2), so r = sqrt(1/(1-d)^2 - 1).
CREATE FUNCTION pg_temp.spiral(k int) RETURNS vector LANGUAGE sql AS $$
  SELECT (array[1::real, (r * cos(k * 2.39996323))::real, (r * sin(k * 2.39996323))::real]
          || array_fill(0::real, array[1533]))::vector(1536)
    FROM (SELECT sqrt(1 / (1 - d) ^ 2 - 1) AS r
            FROM (SELECT CASE WHEN k <= 10 THEN 0.01 * k ELSE 0.11 + (k - 11) * 0.09 / 589 END AS d) x) y;
$$;
INSERT INTO documents (id, source_key, title, desk_tier, desk_feature, content_sha256, ocr_text, chunker_version, indexed_at)
SELECT ('f8000000-0000-0000-0000-00000000000' || n)::uuid, 'ff-l' || n, 'Large ' || n, 'national', 'Large', 'sha-l' || n, 'llll', 2, now()
  FROM generate_series(1, 6) n;
INSERT INTO documents (id, source_key, title, desk_tier, desk_feature, content_sha256, ocr_text, chunker_version, indexed_at) VALUES
  ('f8100000-0000-0000-0000-000000000001', 'ff-s1', 'Small 1', 'national', 'Small', 'sha-s1', 'ssss', 2, now()),
  ('f8100000-0000-0000-0000-000000000002', 'ff-s2', 'Small 2', 'national', 'Small', 'sha-s2', 'ssss', 2, now()),
  ('f8100000-0000-0000-0000-000000000003', 'ff-s3', 'Small 3', 'state',    'Small', 'sha-s3', 'ssss', 2, now()),
  ('f8100000-0000-0000-0000-000000000004', 'ff-s4', 'Small 4', 'national', 'Small', 'sha-s4', 'ssss', 2, NULL);
INSERT INTO document_chunks (document_id, chunk_hash, chunk_index, char_from, char_to, content, embedding, chunker_version)
SELECT ('f8000000-0000-0000-0000-00000000000' || (1 + (k - 1) / 100))::uuid, 'l' || k, k, 0, 4, 'llll', pg_temp.spiral(k), 2
  FROM generate_series(1, 600) k
UNION ALL
SELECT d::uuid, h, i, 0, 4, 'ssss', pg_temp.v(1) + pg_temp.v(1000 + i, w), 2
  FROM (VALUES ('f8100000-0000-0000-0000-000000000001', 's1a', 1, 1.00::real), ('f8100000-0000-0000-0000-000000000001', 's1b', 2, 1.10), ('f8100000-0000-0000-0000-000000000001', 's1c', 3, 1.20),
               ('f8100000-0000-0000-0000-000000000002', 's2a', 4, 1.05), ('f8100000-0000-0000-0000-000000000002', 's2b', 5, 1.15),
               ('f8100000-0000-0000-0000-000000000003', 's3a', 6, 1.03), ('f8100000-0000-0000-0000-000000000003', 's3b', 7, 1.13)) t(d, h, i, w)
UNION ALL
SELECT 'f8100000-0000-0000-0000-000000000001'::uuid, 's1-noemb', 9, 0, 4, 'ssss', NULL, 2
UNION ALL
SELECT 'f8100000-0000-0000-0000-000000000004'::uuid, 's4-unindexed', 1, 0, 4, 'ssss', pg_temp.v(1), 2;

-- Push the planner onto the HNSW index wherever it can use it. Left alone, it
-- ranks a small feature by fetching that feature's few chunks and sorting them
-- (as the replica's H400 did), which hides a feature filter applied after the
-- index scan. Only an ordered index scan avoids both a seq scan and a sort; the
-- full-precision exact path has no such index, so it still sorts.
SET LOCAL enable_seqscan = off;
SET LOCAL enable_sort = off;

CREATE FUNCTION pg_temp.hashes(q vector, n int, ids uuid[], tier text, feature text) RETURNS text[] LANGUAGE sql AS $$
  SELECT array_agg(c.chunk_hash ORDER BY m.similarity DESC, c.chunk_hash)
    FROM match_documents(q, n, ids, tier, feature) m JOIN document_chunks c ON c.id = m.id;
$$;

-- The feature branch (small feature -> exact path): the full count, only the
-- feature, only indexed documents with embeddings, in exact distance order.
SELECT pg_temp.assert_true(pg_temp.hashes(pg_temp.v(1), 40, NULL, 'national', 'Small') = array['s1a', 's2a', 's1b', 's2b', 's1c'], 'a small feature returns all its chunks in exact order despite 600 nearer out-of-feature chunks');
SELECT pg_temp.assert_true(pg_temp.hashes(pg_temp.v(1), 3, NULL, 'national', 'Small') = array['s1a', 's2a', 's1b'], 'a small feature returns exactly match_count when it holds more');
SELECT pg_temp.assert_true(pg_temp.hashes(pg_temp.v(1), 40, NULL, NULL, 'Small') = array['s1a', 's3a', 's2a', 's1b', 's3b', 's2b', 's1c'], 'with no tier, the feature spans tiers');
SELECT pg_temp.assert_true(pg_temp.hashes(pg_temp.v(1), 40, NULL, 'state', 'Small') = array['s3a', 's3b'], 'the tier narrows the feature');
SELECT pg_temp.assert_true((SELECT array_agg(m.id ORDER BY m.similarity DESC) FROM match_documents(pg_temp.v(1), 40, NULL, 'national', 'Small') m)
                         = (SELECT array_agg(c.id ORDER BY c.embedding <=> pg_temp.v(1))
                              FROM document_chunks c JOIN documents d ON d.id = c.document_id
                             WHERE d.desk_feature = 'Small' AND d.desk_tier = 'national' AND d.indexed_at IS NOT NULL AND c.embedding IS NOT NULL), 'the feature result equals an explicit exact computation');
SELECT pg_temp.assert_true((SELECT bool_and(abs(m.similarity - (1 - (c.embedding <=> pg_temp.v(1)))) < 1e-9 AND m.desk_feature = 'Small' AND m.desk_tier = 'national')
                              FROM match_documents(pg_temp.v(1), 40, NULL, 'national', 'Small') m JOIN document_chunks c ON c.id = m.id), 'feature rows carry full-precision similarity and their tier and feature');
SELECT pg_temp.assert_true(pg_temp.hashes(pg_temp.v(1), 10, NULL, 'national', 'Large') = array['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9', 'l10'], 'a feature below the threshold is ranked exactly');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM match_documents(pg_temp.v(1), 40, NULL, 'national', 'No Such Module')), 'a feature with no documents returns nothing');

-- Run as the caller the RPC serves: RLS and the grants hold for the feature path.
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT count(*) FROM match_documents(pg_temp.v(1), 40, NULL, 'national', 'Small')) = 5, 'authenticated gets the feature result under RLS');
RESET ROLE;

-- Ids given: the feature is ignored and the scoped branch answers as before.
SELECT pg_temp.assert_true(pg_temp.hashes(pg_temp.v(1), 40, array['f8000000-0000-0000-0000-000000000001'::uuid], NULL, 'Small')
                         = pg_temp.hashes(pg_temp.v(1), 40, array['f8000000-0000-0000-0000-000000000001'::uuid], NULL, NULL), 'ids given: the feature is ignored');
SELECT pg_temp.assert_true((SELECT count(*) = 40 AND bool_and(document_id = 'f8000000-0000-0000-0000-000000000001') FROM match_documents(pg_temp.v(1), 40, array['f8000000-0000-0000-0000-000000000001'::uuid], NULL, 'Small')), 'ids given: rows come from the attached document, not the feature');
SELECT pg_temp.assert_true((SELECT count(DISTINCT document_id) FROM match_documents(pg_temp.v(1), 4, array['f8000000-0000-0000-0000-000000000001'::uuid, 'f8100000-0000-0000-0000-000000000001'::uuid], NULL, 'Large')) = 2, 'ids given: the per-document quota still applies');

-- No feature: the unscoped branch returns what the old definition's query returns.
SELECT pg_temp.assert_true((SELECT array_agg(m.id ORDER BY m.similarity DESC, m.id) FROM match_documents(pg_temp.v(1), 40) m)
                         = (SELECT array_agg(x.id ORDER BY x.sim DESC, x.id) FROM (
                              SELECT c.id, (1 - (c.embedding <=> pg_temp.v(1)))::float8 AS sim
                                FROM public.document_chunks c
                                JOIN public.documents d ON d.id = c.document_id
                               WHERE c.embedding IS NOT NULL AND d.indexed_at IS NOT NULL
                               ORDER BY (c.embedding::extensions.halfvec(1536)) <=> (pg_temp.v(1)::extensions.halfvec(1536))
                               LIMIT 40) x), 'no feature: the unscoped branch is unchanged');
SELECT pg_temp.assert_true((SELECT count(*) = 10 AND bool_and(desk_feature = 'Large') FROM match_documents(pg_temp.v(1), 10, NULL, 'national')), 'the four-argument call still resolves and the nearest rows win');
SELECT pg_temp.assert_true(pg_get_functiondef(to_regprocedure('public.match_documents(extensions.vector,int,uuid[],text,text)')) ILIKE '%halfvec(1536)) <=> (query_embedding::extensions.halfvec(1536))%', 'unscoped ranking still uses the half-precision expression');

-- The large-feature helper, called directly (15,000 chunks is too many to load
-- here): in-feature rows only, ordered by half-precision distance.
SELECT pg_temp.assert_true((SELECT array_agg(c.chunk_hash ORDER BY h.similarity DESC, c.chunk_hash)
                              FROM match_documents_feature_hnsw(pg_temp.v(1), 10, 'national', 'Large') h JOIN document_chunks c ON c.id = h.id)
                         = array['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9', 'l10'], 'the helper returns the nearest in-feature rows');
SELECT pg_temp.assert_true((SELECT bool_and(desk_feature = 'Large' AND desk_tier = 'national') FROM match_documents_feature_hnsw(pg_temp.v(1), 40, 'national', 'Large')), 'the helper returns only the feature');
CREATE TEMP TABLE helper_rows AS SELECT row_number() OVER () AS rn, h.* FROM match_documents_feature_hnsw(pg_temp.v(1), 10, 'national', 'Large') h;
SELECT pg_temp.assert_true((SELECT bool_and(a.dist <= b.dist) FROM
                              (SELECT r.rn, (c.embedding::halfvec(1536)) <=> (pg_temp.v(1)::halfvec(1536)) AS dist FROM helper_rows r JOIN document_chunks c ON c.id = r.id) a
                              JOIN (SELECT r.rn, (c.embedding::halfvec(1536)) <=> (pg_temp.v(1)::halfvec(1536)) AS dist FROM helper_rows r JOIN document_chunks c ON c.id = r.id) b ON b.rn = a.rn + 1)
                         AND (SELECT count(*) FROM helper_rows) = 10, 'the helper orders by half-precision distance');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM match_documents_feature_hnsw(pg_temp.v(1), 40, 'national', 'Small') WHERE desk_feature <> 'Small'), 'the helper never leaks other features');
SELECT pg_temp.assert_true((SELECT count(*) FROM match_documents_feature_hnsw(pg_temp.v(1), 100000, NULL, 'Large')) = 200, 'the helper clamps match_count to 200');
SELECT pg_temp.assert_true(current_setting('hnsw.ef_search') = '40', 'the helper''s ef_search does not leak into the session');
SET LOCAL hnsw.ef_search = 77;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT count(*) FROM match_documents_feature_hnsw(pg_temp.v(1), 10, 'national', 'Large')) = 10, 'authenticated can call the helper');
SELECT pg_temp.assert_true(current_setting('hnsw.ef_search') = '77', 'the helper restores the caller''s own ef_search');
RESET ROLE;

-- document_modules(): every (tier, feature) pair once, only indexed documents,
-- no null feature, and still complete past 1,000 documents (PostgREST's max_rows
-- capped the per-document read it replaces). The last pair is on document 1,200.
RESET enable_seqscan;
RESET enable_sort;
INSERT INTO documents (source_key, title, desk_tier, desk_feature, content_sha256, ocr_text, chunker_version, indexed_at)
SELECT 'ff-bulk' || i, 'Bulk ' || i,
       CASE WHEN i = 1200 THEN 'state' ELSE 'national' END,
       CASE WHEN i = 1200 THEN 'Zeta Late' WHEN i % 100 = 0 THEN NULL ELSE 'Bulk ' || (i % 3) END,
       'sha-bulk' || i, 'bbbb', 2, now()
  FROM generate_series(1, 1200) i;
INSERT INTO documents (source_key, title, desk_tier, desk_feature, content_sha256, ocr_text, chunker_version, indexed_at) VALUES
  ('ff-unindexed-only', 'Unindexed', 'national', 'Unindexed Only', 'sha-u', 'uuuu', NULL, NULL);
SELECT pg_temp.assert_true((SELECT count(*) FROM documents) > 1200, 'more than 1,200 documents exist');
SELECT pg_temp.assert_true((SELECT count(*) FROM document_modules()) = (SELECT count(*) FROM (SELECT DISTINCT * FROM document_modules()) x), 'document_modules() returns each pair once');
SELECT pg_temp.assert_true((SELECT array_agg(m.desk_tier || '/' || m.desk_feature ORDER BY 1) FROM document_modules() m)
                         = array['national/Bulk 0', 'national/Bulk 1', 'national/Bulk 2', 'national/Large', 'national/Small', 'state/Small', 'state/Zeta Late'], 'document_modules() returns every indexed pair, including the last document''s');
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT count(*) FROM document_modules()) = 7, 'authenticated can call document_modules() under RLS');
RESET ROLE;
ROLLBACK;
