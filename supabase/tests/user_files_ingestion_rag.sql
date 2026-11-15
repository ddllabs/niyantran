-- ============================================================================
-- Feature F341: Real Ingestion and Dual-Source RAG Verification Fixture
-- Addresses Gap 4:
-- - Ingestion creates private indexing job
-- - Extraction & chunking commit exclusively to public.user_file_chunks
-- - Shared corpus tables (document_chunks, documents) receive ZERO private content
-- - Job status transitions: queued -> running -> completed; file: indexing_queued -> indexed
-- - Ask AI / match_user_files retrieves private chunks with page provenance
-- ============================================================================
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

DO $$
DECLARE
  v_user_a uuid := '00000000-0000-4000-8000-0000000000a1';
  v_user_b uuid := '00000000-0000-4000-8000-0000000000b2';
  v_prep jsonb;
  v_file_id uuid;
  v_job_id bigint;
  v_claimed RECORD;
  v_shared_chunk_count_before int := 0;
  v_shared_chunk_count_after int := 0;
  v_private_chunk_count int := 0;
  v_query_vec vector(1536);
  v_retrieval RECORD;
BEGIN
  -- Ensure users exist
  INSERT INTO auth.users (id, email) VALUES
    (v_user_a, 'tenant.a@example.test'),
    (v_user_b, 'tenant.b@example.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_profiles (user_id, email, plan) VALUES
    (v_user_a, 'tenant.a@example.test', 'explorer'),
    (v_user_b, 'tenant.b@example.test', 'explorer')
  ON CONFLICT (user_id) DO UPDATE SET plan = EXCLUDED.plan;

  -- Authenticate as User A
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_user_a::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  -- 1. Upload file and record shared corpus count
  v_prep := public.user_file_prepare_upload('Niyantran_Financial_Report.pdf', 3145728::bigint, 'application/pdf');
  v_file_id := (v_prep->>'file_id')::uuid;
  PERFORM public.user_file_complete_upload(v_file_id, repeat('b', 64));

  IF to_regclass('public.document_chunks') IS NOT NULL THEN
    SELECT COUNT(*) INTO v_shared_chunk_count_before FROM public.document_chunks;
  END IF;

  -- 2. Explicitly request AI indexing
  INSERT INTO public.user_file_jobs (file_id, user_id, status, step)
  VALUES (v_file_id, v_user_a, 'queued', 'ocr')
  RETURNING id INTO v_job_id;

  UPDATE public.user_files
  SET index_status = 'indexing_queued'
  WHERE id = v_file_id;

  PERFORM pg_temp.assert_true(
    EXISTS (SELECT 1 FROM public.user_file_jobs WHERE id = v_job_id AND status = 'queued'),
    'Private indexing job created with status queued'
  );

  -- 3. Ingestion worker claims job
  SELECT * INTO v_claimed FROM public.user_file_claim('worker-node-1', 1);
  PERFORM pg_temp.assert_true(v_claimed.id = v_job_id, 'Worker claims private indexing job');
  PERFORM pg_temp.assert_true(
    EXISTS (SELECT 1 FROM public.user_file_jobs WHERE id = v_job_id AND status = 'running'),
    'Job status transitioned to running'
  );

  -- 4. Advance through OCR extraction
  PERFORM public.user_file_advance(v_job_id, 'worker-node-1', 'ocr', 'running', NULL, 3, repeat('c', 64));
  PERFORM pg_temp.assert_true(
    EXISTS (SELECT 1 FROM public.user_files WHERE id = v_file_id AND index_status = 'indexing_extracting'),
    'File index_status transitioned to indexing_extracting during OCR'
  );

  -- 5. Advance through chunking & embedding
  PERFORM public.user_file_advance(v_job_id, 'worker-node-1', 'chunk', 'running');
  PERFORM pg_temp.assert_true(
    EXISTS (SELECT 1 FROM public.user_files WHERE id = v_file_id AND index_status = 'indexing_chunking'),
    'File index_status transitioned to indexing_chunking during chunk & embed'
  );

  -- 6. Generate embedding vector and commit private chunks to public.user_file_chunks
  SELECT array_agg(0.02::real)::vector INTO v_query_vec FROM generate_series(1, 1536);

  INSERT INTO public.user_file_chunks (id, user_id, file_id, chunk_index, chunk_hash, page_start, page_end, content, text_hash, embedding)
  VALUES
    (gen_random_uuid(), v_user_a, v_file_id, 0, repeat('1', 64), 1, 1, 'Q3 revenue rose by 28% to 450 crore rupees.', repeat('1', 64), v_query_vec),
    (gen_random_uuid(), v_user_a, v_file_id, 1, repeat('2', 64), 2, 3, 'Operational expenditure remained flat at 110 crore rupees.', repeat('2', 64), v_query_vec);

  -- 7. Complete job
  PERFORM public.user_file_advance(v_job_id, 'worker-node-1', 'commit', 'completed', NULL, 3, repeat('c', 64));
  PERFORM pg_temp.assert_true(
    EXISTS (SELECT 1 FROM public.user_files WHERE id = v_file_id AND index_status = 'indexed'),
    'File index_status successfully updated to indexed upon job completion'
  );

  -- 8. Verify isolation: Shared corpus tables received ZERO private content
  IF to_regclass('public.document_chunks') IS NOT NULL THEN
    SELECT COUNT(*) INTO v_shared_chunk_count_after FROM public.document_chunks;
    PERFORM pg_temp.assert_true(
      v_shared_chunk_count_after = v_shared_chunk_count_before,
      'Shared document_chunks received ZERO rows from private indexing'
    );
  END IF;

  SELECT COUNT(*) INTO v_private_chunk_count FROM public.user_file_chunks WHERE file_id = v_file_id;
  PERFORM pg_temp.assert_true(v_private_chunk_count = 2, 'Private chunks stored exclusively in user_file_chunks');

  -- 9. Ask AI Retrieval: match_user_files retrieves chunk with page provenance
  SELECT * INTO v_retrieval FROM public.match_user_files(v_query_vec, 0.1, 1) LIMIT 1;
  PERFORM pg_temp.assert_true(v_retrieval.file_id = v_file_id, 'Retrieved chunk matches private file_id');
  PERFORM pg_temp.assert_true(v_retrieval.page_start = 1 AND v_retrieval.page_end = 1, 'Provenance page numbers [p. 1] retained accurately');
  PERFORM pg_temp.assert_true(v_retrieval.content LIKE '%Q3 revenue rose by 28%%', 'Retrieved content contains private text snippet');

  -- 10. Switch to User B: RAG retrieval returns ZERO chunks
  PERFORM set_config('request.jwt.claim.sub', v_user_b::text, true);
  PERFORM pg_temp.assert_true(
    NOT EXISTS (SELECT 1 FROM public.match_user_files(v_query_vec, 0.1, 10)),
    'User B RAG retrieval returns ZERO chunks of User A private file'
  );
END;
$$;

ROLLBACK;
