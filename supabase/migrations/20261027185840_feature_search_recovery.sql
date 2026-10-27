-- F258: recover ANN underfill within the same caller-visible feature.
-- API, RLS and match_documents exact-ID branch unchanged. No global settings.
-- Full ANN result sets remain approximate; this fixes underfill, not all recall.
-- Down: restore helper from 20261001120000_page_contract.sql.
create or replace function public.match_documents_feature_hnsw(
  query_embedding extensions.vector(1536),
  match_count     int,
  p_desk_tier     text,
  p_desk_feature  text
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
  desk_feature  text,
  block_ids     uuid[],
  image_ids     uuid[],
  section       jsonb
)
language plpgsql
stable
security invoker
set search_path = public, extensions
as $fn$
declare
  c_ef_search constant text := '400';
  c_recovery_max_chunks constant int := 100000;
  v_limit int := least(greatest(coalesce(match_count, 40), 1), 200);
  v_previous text := current_setting('hnsw.ef_search', true);
  v_ids uuid[];
  v_chunks int;
begin
  perform set_config('hnsw.ef_search', c_ef_search, true);
  select array_agg(candidate.id) into v_ids from (
    select c.id from public.document_chunks c
    join public.documents d on d.id = c.document_id
    where c.embedding is not null and d.indexed_at is not null
      and d.desk_feature = p_desk_feature
      and (p_desk_tier is null or d.desk_tier = p_desk_tier)
    order by (c.embedding::extensions.halfvec(1536)) <=> (query_embedding::extensions.halfvec(1536))
    limit v_limit
  ) candidate;
  perform set_config('hnsw.ef_search', coalesce(nullif(v_previous, ''), '40'), true);
  if coalesce(cardinality(v_ids), 0) < v_limit then
    -- Bound work before exact recovery. This is a capacity hold, NOT absence of evidence.
    select count(*) into v_chunks from (
      select 1 from public.document_chunks c
      join public.documents d on d.id = c.document_id
      where c.embedding is not null and d.indexed_at is not null
        and d.desk_feature = p_desk_feature
        and (p_desk_tier is null or d.desk_tier = p_desk_tier)
      limit c_recovery_max_chunks + 1
    ) eligible;
    if v_chunks > c_recovery_max_chunks then
      raise exception using errcode = '54000',
        message = 'FEATURE_SEARCH_RECOVERY_LIMIT',
        hint = 'Scoped retrieval is incomplete; retry with explicit document IDs or provision feature indexing. Do not widen scope.';
    end if;
    return query
      select c.id, c.document_id, c.content,
        (1 - (c.embedding <=> query_embedding))::float8,
        c.chunk_index, c.source_kind, c.page_number, c.char_from, c.char_to,
        d.title, d.file_name, d.file_url, d.desk_tier, d.desk_feature,
        c.block_ids, c.image_ids, c.metadata->'section'
      from public.document_chunks c join public.documents d on d.id = c.document_id
      where c.embedding is not null and d.indexed_at is not null
        and d.desk_feature = p_desk_feature
        and (p_desk_tier is null or d.desk_tier = p_desk_tier)
      order by c.embedding <=> query_embedding, c.id
      limit v_limit;
  else
    return query
      select c.id, c.document_id, c.content,
        (1 - (c.embedding <=> query_embedding))::float8,
        c.chunk_index, c.source_kind, c.page_number, c.char_from, c.char_to,
        d.title, d.file_name, d.file_url, d.desk_tier, d.desk_feature,
        c.block_ids, c.image_ids, c.metadata->'section'
      from unnest(v_ids) with ordinality a(id, n)
      join public.document_chunks c on c.id = a.id
      join public.documents d on d.id = c.document_id
      order by a.n;
  end if;
end
$fn$;
revoke all on function public.match_documents_feature_hnsw(extensions.vector, int, text, text) from public, anon;
grant execute on function public.match_documents_feature_hnsw(extensions.vector, int, text, text) to authenticated, service_role;
