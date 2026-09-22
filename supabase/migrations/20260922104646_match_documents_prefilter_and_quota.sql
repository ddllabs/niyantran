-- 104646: scoped retrieval actually scopes, and two attached documents both get read.
--
-- Two defects, both measured on the live database before this change. Spec:
-- docs/specs/2026-09-22-scoped-retrieval-design.md (D1, D7).
--
-- D1. The filter was
--
--     and (p_document_ids is null or c.document_id = any (p_document_ids))
--
-- the same disjunction defect fixed for search_desk_rows in 20260922073933. Two
-- branches do not mention the column, so the planner must produce one plan that
-- also works when the parameter is null and can never pre-filter on document_id.
-- pgvector therefore walked the HNSW index and discarded non-matching rows
-- afterwards. With hnsw.ef_search at 40 - the same number as match_count - it
-- collected 40 candidates from all 54,219 chunks and the document filter deleted
-- almost all of them. The average document is 23 chunks, 0.04% of the corpus:
--
--     45-chunk document, asked for 40   ->  returned 0-1 (it varied between runs)
--     915-chunk document, asked for 40  ->  returned 12
--
-- The 915-chunk probe used one of that document's own embeddings, so a chunk with
-- similarity 1.0 existed and was still not returned. Scoped search was not merely
-- truncated, it was losing the single most relevant passage. The near-empty result
-- then tripped the caller's fallback (agent.ts) and the turn silently re-ran across
-- the whole corpus - which is why attaching a bill produced citations from fifteen
-- other documents. Scoping had never worked, for any document, at any coverage.
--
-- Fixed by branching instead of overloading one predicate. When p_document_ids is
-- non-empty the predicate is unconditional, the planner pre-filters with
-- document_chunks_document_order, and the rows are scored exhaustively. HNSW is
-- deliberately not used there: over 23-915 rows an exact scan is faster than an
-- approximate index and, unlike it, complete. TenderBase reached the same shape
-- independently - their match_documents_scoped filters `WHERE e.tender_id =
-- p_tender_uuid`, unconditional, and sets no ef_search anywhere in their codebase.
--
-- hnsw.iterative_scan (pgvector 0.8.2 is installed) was measured and rejected: it
-- returns the right rows but took 19,820 ms on the 45-chunk document, because it
-- widens the search until it fills the limit.
--
-- D7. Ranking was global across the scoped union, so each document's share of the
-- 40 was proportional to its chunk count. Attaching two documents of unequal size
-- meant the smaller one was barely read, or not at all:
--
--     915-chunk + 45-chunk   ->  35 / 5
--     915-chunk + 23-chunk   ->  40 / 0   <- the second document never read
--
-- "Compare these two bills" would have been answered from one of them with nothing
-- saying so. Each document now gets ceil(limit / n) ranked within itself. The total
-- returned is unchanged at match_count - this redistributes the budget, it does not
-- raise it - and a single attachment still gets the whole 40, so the quota only
-- binds when more than one document is in scope.
--
-- Unscoped retrieval is untouched and was proved identical: four different probe
-- vectors and a desk_tier filter all returned the same ids in the same order with
-- the same similarities to six decimal places.
--
-- After, on the live database:
--
--     scoped, 915-chunk doc   40 chunks, 16 ms, and the similarity-1.0 chunk first
--     scoped, 45-chunk doc    40 chunks,  1 ms
--     two documents           20 / 20
--     unscoped                40 chunks,  6 ms
--
-- security invoker, stable, signature, return type and grants all unchanged.
--
-- Down (manual): restore the function body from
-- supabase/migrations/20260921000014_corpus_revision_integrity.sql.

create or replace function public.match_documents(
  query_embedding extensions.vector(1536),
  match_count     int    default 40,
  p_document_ids  uuid[] default null,
  p_desk_tier     text   default null
) returns table (
  id            uuid,
  document_id   uuid,
  content       text,
  similarity    float8,
  chunk_index   int,
  source_kind   text,
  page_number   int,
  char_from     int,
  char_to       int,
  title         text,
  file_name     text,
  file_url      text,
  desk_tier     text,
  desk_feature  text
)
language plpgsql
stable
security invoker
set search_path = public, extensions
as $fn$
declare
  v_limit int := least(greatest(coalesce(match_count, 40), 1), 200);
  v_docs  int := coalesce(array_length(p_document_ids, 1), 0);
  v_quota int;
begin
  if v_docs > 0 then
    -- Scoped. The predicate on document_id is unconditional here, so the planner
    -- pre-filters with document_chunks_document_order and scores only that
    -- document's rows. HNSW is deliberately unused: over 23-915 rows an exact
    -- scan is both faster and, unlike an approximate index, complete.
    v_quota := greatest(ceil(v_limit::numeric / v_docs)::int, 1);
    return query
      with scoped as (
        select c.id, c.document_id, c.content, c.chunk_index, c.source_kind,
               c.page_number, c.char_from, c.char_to,
               (c.embedding <=> query_embedding) as dist,
               row_number() over (partition by c.document_id
                                  order by c.embedding <=> query_embedding) as rn
          from public.document_chunks c
         where c.document_id = any (p_document_ids)
           and c.embedding is not null
      )
      -- documents is joined after ranking, against the quota'd handful of rows,
      -- so indexed_at costs a primary-key probe instead of hashing every document.
      select s.id, s.document_id, s.content, (1 - s.dist)::float8,
             s.chunk_index, s.source_kind, s.page_number, s.char_from, s.char_to,
             d.title, d.file_name, d.file_url, d.desk_tier, d.desk_feature
        from scoped s
        join public.documents d on d.id = s.document_id
       where s.rn <= v_quota
         and d.indexed_at is not null
         and (p_desk_tier is null or d.desk_tier = p_desk_tier)
       order by s.dist
       limit v_limit;
  else
    -- Unscoped: unchanged from migration 0014, byte-for-byte in behaviour.
    return query
      select c.id, c.document_id, c.content,
             (1 - (c.embedding <=> query_embedding))::float8,
             c.chunk_index, c.source_kind, c.page_number, c.char_from, c.char_to,
             d.title, d.file_name, d.file_url, d.desk_tier, d.desk_feature
        from public.document_chunks c
        join public.documents d on d.id = c.document_id
       where c.embedding is not null
         and d.indexed_at is not null
         and (p_desk_tier is null or d.desk_tier = p_desk_tier)
       order by c.embedding <=> query_embedding
       limit v_limit;
  end if;
end
$fn$;

revoke all on function public.match_documents(extensions.vector, int, uuid[], text) from public, anon;
grant execute on function public.match_documents(extensions.vector, int, uuid[], text) to authenticated, service_role;

-- match_documents_v2 was the throwaway the before/after comparison ran against.
drop function if exists public.match_documents_v2(extensions.vector, int, uuid[], text);
