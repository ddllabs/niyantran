-- F258: bootstrap unscoped_ef_search chain, then feature_search_recovery migration.
-- Disposable only. Real HNSW underfill, exact oracle, RLS, ID-path preservation.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path=public,extensions;
CREATE FUNCTION pg_temp.assert_true(actual boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF actual IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label; END $$;
CREATE FUNCTION pg_temp.v(i int, w real DEFAULT 1) RETURNS vector LANGUAGE sql AS $$
  SELECT (array_fill(0::real, array[i - 1]) || array[w] || array_fill(0::real, array[1536 - i]))::vector(1536);
$$;
-- Offset r gives cosine distance d = 1 - 1/sqrt(1 + r^2), so r = sqrt(1/(1-d)^2 - 1).
CREATE FUNCTION pg_temp.spiral(k int) RETURNS vector LANGUAGE sql AS $$
  SELECT (array[1::real, (r * cos(k * 2.39996323))::real, (r * sin(k * 2.39996323))::real]
          || array_fill(0::real, array[1533]))::vector(1536)
    FROM (SELECT sqrt(1 / (1 - d) ^ 2 - 1) AS r
            FROM (SELECT CASE WHEN k <= 10 THEN 0.01 * k ELSE 0.11 + (k - 11) * 0.09 / 2989 END AS d) x) y;
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
SELECT ('f8000000-0000-0000-0000-00000000000' || (1 + (k - 1) / 500))::uuid, 'l' || k, k, 0, 4, 'llll', pg_temp.spiral(k), 2
  FROM generate_series(1, 3000) k
UNION ALL
SELECT d::uuid, h, i, 0, 4, 'ssss', pg_temp.v(1) + pg_temp.v(1000 + i, w), 2
  FROM (VALUES ('f8100000-0000-0000-0000-000000000001', 's1a', 1, 1.00::real), ('f8100000-0000-0000-0000-000000000001', 's1b', 2, 1.10), ('f8100000-0000-0000-0000-000000000001', 's1c', 3, 1.20),
               ('f8100000-0000-0000-0000-000000000002', 's2a', 4, 1.05), ('f8100000-0000-0000-0000-000000000002', 's2b', 5, 1.15),
               ('f8100000-0000-0000-0000-000000000003', 's3a', 6, 1.03), ('f8100000-0000-0000-0000-000000000003', 's3b', 7, 1.13)) t(d, h, i, w)
UNION ALL
SELECT 'f8100000-0000-0000-0000-000000000001'::uuid, 's1-noemb', 9, 0, 4, 'ssss', NULL, 2
UNION ALL
SELECT 'f8100000-0000-0000-0000-000000000004'::uuid, 's4-unindexed', 1, 0, 4, 'ssss', pg_temp.v(1), 2;


-- Increase Small past the strategy threshold; all remain farther than Large.
INSERT INTO document_chunks(document_id,chunk_hash,chunk_index,char_from,char_to,content,embedding,chunker_version)
SELECT 'f8100000-0000-0000-0000-000000000001','far'||k,100+k,0,4,'ssss',pg_temp.v(1)+pg_temp.v(2,(2+(k::real/100000))::real),2 FROM generate_series(1,14996) k;
SET LOCAL jit=off;
ANALYZE documents; ANALYZE document_chunks;
SET LOCAL enable_seqscan=off; SET LOCAL enable_sort=off;
SET LOCAL hnsw.ef_search=40;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE got AS SELECT * FROM match_documents(pg_temp.v(1),40,NULL,'national','Small');
SELECT pg_temp.assert_true((SELECT count(*) FROM got)=40,'large minority feature recovers 40 despite nearer other-feature vectors');
SELECT pg_temp.assert_true((SELECT bool_and(desk_feature='Small' AND desk_tier='national') FROM got),'scope retained');
CREATE TEMP TABLE expected AS SELECT c.id FROM document_chunks c JOIN documents d ON d.id=c.document_id WHERE c.embedding IS NOT NULL AND d.indexed_at IS NOT NULL AND d.desk_tier='national' AND d.desk_feature='Small' ORDER BY c.embedding <=> pg_temp.v(1) LIMIT 40;
SELECT pg_temp.assert_true(NOT EXISTS(SELECT id FROM expected EXCEPT SELECT id FROM got),'recovery matches exact oracle');
SELECT pg_temp.assert_true(current_setting('hnsw.ef_search')='40','setting restored');
SELECT pg_temp.assert_true((SELECT count(*) FROM match_documents(pg_temp.v(1),40,array['f8100000-0000-0000-0000-000000000002'::uuid],'national','Large'))=2,'explicit IDs win over feature and corpus size');
SELECT pg_temp.assert_true((SELECT count(*) FROM match_documents(pg_temp.v(1),40,NULL,'national','Empty'))=0,'empty feature honestly empty');
RESET ROLE;
-- Match the inclusive boundary, then one below it. Exact paths must remain complete.
DELETE FROM document_chunks WHERE chunk_hash='far14996';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT count(*) FROM match_documents(pg_temp.v(1),40,NULL,'national','Small'))=40,'15000 boundary returns full count');
RESET ROLE;
DELETE FROM document_chunks WHERE chunk_hash='far14995';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT count(*) FROM match_documents(pg_temp.v(1),40,NULL,'national','Small'))=40,'14999 below boundary returns full count');
RESET ROLE;
-- Force a caller-visible restriction on the closest indexed document. Both
-- approximate candidates and recovery must obey it, not just the final display.
CREATE POLICY f258_hidden_document ON documents AS RESTRICTIVE FOR SELECT TO authenticated
  USING (id <> 'f8100000-0000-0000-0000-000000000002'::uuid);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM match_documents_feature_hnsw(pg_temp.v(1),40,'national','Small') WHERE document_id='f8100000-0000-0000-0000-000000000002'),'recovery respects restrictive document RLS');
SELECT pg_temp.assert_true((SELECT count(*) FROM match_documents_feature_hnsw(pg_temp.v(1),40,'state','Small'))=2,'fewer eligible chunks return only the eligible count');
SELECT pg_temp.assert_true((SELECT count(*) FROM match_documents_feature_hnsw(pg_temp.v(1),1,'national','Large'))=1,'full ANN path preserves requested limit');
RESET ROLE;
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.match_documents_feature_hnsw(extensions.vector,int,text,text)','EXECUTE'),'anon remains denied');
SELECT pg_temp.assert_true(NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.match_documents_feature_hnsw(extensions.vector,int,text,text)'::regprocedure),'helper remains security invoker');
-- Zero vectors are legal pgvector values but absent from its cosine HNSW index.
-- Use them only to exercise capacity admission deterministically, not as a
-- semantic retrieval corpus. The independent nonzero test above proves recovery.
INSERT INTO documents(id,source_key,title,desk_tier,desk_feature,content_sha256,ocr_text,chunker_version,indexed_at)
VALUES('f8200000-0000-0000-0000-000000000001','capacity','Capacity','national','Capacity','capacity','ssss',2,now());
INSERT INTO document_chunks(document_id,chunk_hash,chunk_index,char_from,char_to,content,embedding,chunker_version)
SELECT 'f8200000-0000-0000-0000-000000000001','capacity'||k,k,0,4,'ssss',array_fill(0::real,array[1536])::vector,2 FROM generate_series(1,100001)k;
ANALYZE documents; ANALYZE document_chunks;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM * FROM match_documents_feature_hnsw(pg_temp.v(1),40,'national','Capacity');
  RAISE EXCEPTION 'FAIL: recovery over capacity must raise, never return empty';
 EXCEPTION WHEN SQLSTATE '54000' THEN
  PERFORM pg_temp.assert_true(SQLERRM='FEATURE_SEARCH_RECOVERY_LIMIT','capacity is explicit failure, not no evidence');
 END;
END $$;
SELECT pg_temp.assert_true(current_setting('hnsw.ef_search')='40','setting restored after capacity failure');
RESET ROLE;
DELETE FROM document_chunks WHERE chunk_hash='capacity100001';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT count(*) FROM match_documents_feature_hnsw(pg_temp.v(1),40,'national','Capacity'))=40,'exactly 100000 eligible chunks stay within recovery ceiling');
RESET ROLE;
ROLLBACK;
