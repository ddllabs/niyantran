-- Diagnostics for the replica (plan task T7). REPLICA ONLY.
-- match_documents_exact: the unscoped branch without the index. Ordered by full-precision
-- distance over every chunk, so it shows what an exact search would return. Comparing it with
-- the HNSW baseline separates "the index lost it" from "the question is hard".
\set ON_ERROR_STOP on
create or replace function public.match_documents_exact(
  query_embedding extensions.vector(1536), match_count int default 40,
  p_document_ids uuid[] default null, p_desk_tier text default null
) returns setof public.match_row language sql stable security invoker
set search_path = public, extensions as $fn$
  select c.id, c.document_id, c.content, (1 - (c.embedding <=> query_embedding))::float8,
         c.chunk_index, c.source_kind, c.page_number, c.char_from, c.char_to,
         d.title, d.file_name, d.file_url, d.desk_tier, d.desk_feature
    from public.document_chunks c
    join public.documents d on d.id = c.document_id
   where c.embedding is not null and d.indexed_at is not null
     and (p_desk_tier is null or d.desk_tier = p_desk_tier)
   order by c.embedding <=> query_embedding
   limit least(greatest(coalesce(match_count, 40), 1), 200);
$fn$;
grant execute on function public.match_documents_exact(extensions.vector, int, uuid[], text) to authenticated;
