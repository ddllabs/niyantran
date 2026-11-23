-- =============================================================================
-- Migration: 20261121000001_user_file_chunks_metadata.sql
-- Description: Extends user_file_chunks with metadata, char offsets, page number,
--              recreates match_user_files with metadata and filename support,
--              and hardens user_file_settle_credits with default paise fallback.
-- =============================================================================

-- 1. Extend user_file_chunks columns
ALTER TABLE public.user_file_chunks
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS char_from int DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS char_to int DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS page_number int DEFAULT 1 NOT NULL,
  ADD COLUMN IF NOT EXISTS extract_hash text DEFAULT NULL;

-- 2. Drop and Recreate match_user_files with expanded return columns
DROP FUNCTION IF EXISTS public.match_user_files(extensions.vector, float, int, uuid[]);

CREATE OR REPLACE FUNCTION public.match_user_files(
  query_embedding extensions.vector(1536),
  match_threshold float DEFAULT 0.2,
  match_count int DEFAULT 10,
  filter_file_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  file_id uuid,
  user_id uuid,
  file_name text,
  chunk_index int,
  chunk_hash text,
  page_start int,
  page_end int,
  char_from int,
  char_to int,
  content text,
  text_hash text,
  metadata jsonb,
  similarity float
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT
    c.id,
    c.file_id,
    c.user_id,
    f.name AS file_name,
    c.chunk_index,
    c.chunk_hash,
    c.page_start,
    c.page_end,
    c.char_from,
    c.char_to,
    c.content,
    c.text_hash,
    c.metadata,
    (1 - (c.embedding <=> query_embedding))::float AS similarity
  FROM public.user_file_chunks c
  INNER JOIN public.user_files f ON c.file_id = f.id
  WHERE f.user_id = (SELECT auth.uid())
    AND f.deleted_at IS NULL
    AND (filter_file_ids IS NULL OR f.id = ANY(filter_file_ids))
    AND (1 - (c.embedding <=> query_embedding)) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_user_files(extensions.vector, float, int, uuid[]) TO authenticated, service_role;

-- 3. Hardened Settlement RPC supporting default/null paise fallback
CREATE OR REPLACE FUNCTION public.user_file_settle_credits(
  p_job_id bigint,
  p_actual_cost_paise bigint DEFAULT NULL,
  p_final_status text DEFAULT 'completed',
  p_ocr_pages int DEFAULT NULL,
  p_embed_tokens int DEFAULT NULL,
  p_actual_cost_usd numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_job RECORD;
  v_charge_paise bigint;
  v_ledger_id uuid := NULL;
  s public.credit_settings := private.credit_config();
BEGIN
  -- Compute paise from USD if omitted or null
  IF p_actual_cost_paise IS NULL THEN
    p_actual_cost_paise := COALESCE(CEIL(COALESCE(p_actual_cost_usd, 0) * 90 * 100)::bigint, 0);
  END IF;

  -- Lock job record
  SELECT * INTO v_job
  FROM public.user_file_jobs
  WHERE id = p_job_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job_not_found: job % does not exist', p_job_id USING ERRCODE = 'P0002';
  END IF;

  -- Guard against duplicate settlement
  IF v_job.status = 'completed' AND v_job.credits_settled_paise > 0 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'success', true,
      'job_id', p_job_id,
      'already_settled', true,
      'credits_settled', v_job.credits_settled_paise
    );
  END IF;

  -- Determine final charge
  IF p_final_status = 'failed' OR p_final_status = 'cancelled' THEN
    v_charge_paise := LEAST(v_job.credits_reserved_paise, p_actual_cost_paise);
  ELSE
    v_charge_paise := LEAST(v_job.credits_reserved_paise, p_actual_cost_paise);
  END IF;

  -- Update job with final settlement values
  UPDATE public.user_file_jobs
  SET
    status = p_final_status,
    credits_settled_paise = v_charge_paise,
    actual_cost_usd = COALESCE(p_actual_cost_usd, actual_cost_usd),
    ocr_pages_processed = COALESCE(p_ocr_pages, ocr_pages_processed),
    embed_tokens_processed = COALESCE(p_embed_tokens, embed_tokens_processed),
    updated_at = now()
  WHERE id = p_job_id;

  RETURN jsonb_build_object(
    'ok', true,
    'success', true,
    'job_id', p_job_id,
    'final_status', p_final_status,
    'credits_reserved_paise', v_job.credits_reserved_paise,
    'credits_settled', v_charge_paise,
    'credits_refunded_paise', (v_job.credits_reserved_paise - v_charge_paise)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.user_file_settle_credits(bigint, bigint, text, int, int, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_file_settle_credits(bigint, bigint, text, int, int, numeric) TO service_role;
