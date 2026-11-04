-- The fifth arm of plan T7: Supabase's hybrid_search recipe (docs/guides/ai/hybrid-search) on a rehearsal copy.
-- Rehearsal only. This is not a migration and must never run on NTER.
--
-- Kept from the recipe: websearch_to_tsquery over the `english` configuration (every word of the question must match),
-- ts_rank_cd ordering, 60 candidates a side, reciprocal rank fusion with k = 50 and weight 1 for each side.
--
-- Changed, because the recipe cannot run here as printed, so that the arm measures its query and fusion:
--   - Both sides stay inside the call's feature, as every other arm does.
--   - The vector side takes its 60 rows from match_documents (the HNSW path). The recipe's window over the whole table
--     is an exact scan that passes the 8 s limit.
--   - The keyword side is a definer helper, because this table's restrictive policies keep a caller's keyword match off
--     its index (22 to 29 s measured). The final read goes through the caller's row-level security.
--   - It returns match_count rows, not at most 30. The recipe's cap would leave doc@40 undefined.
--
-- A call without a feature, or with document ids, is plain match_documents: this arm is measured in feature mode only.

create index document_chunks_content_english_tsv on public.document_chunks
  using gin (to_tsvector('english'::regconfig, content));

create function retrieval_internal.recipe_fulltext_ids(p_query text, p_desk_feature text, p_limit int)
returns table (id uuid, rank_ix bigint)
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $fn$
  select c.id,
         row_number() over (
           order by ts_rank_cd(to_tsvector('english'::regconfig, c.content), websearch_to_tsquery('english'::regconfig, p_query)) desc, c.id)
    from public.document_chunks c
    join public.documents d on d.id = c.document_id
   where c.desk_feature = p_desk_feature
     and d.indexed_at is not null
     and c.embedding is not null
     and to_tsvector('english'::regconfig, c.content) @@ websearch_to_tsquery('english'::regconfig, p_query)
   order by 2
   limit p_limit
$fn$;

revoke all on function retrieval_internal.recipe_fulltext_ids(text, text, int) from public, anon;
grant execute on function retrieval_internal.recipe_fulltext_ids(text, text, int) to authenticated;

create function public.match_documents_hybrid_recipe(
  query_embedding extensions.vector(1536),
  query_text      text,
  match_count     int    default 40,
  p_document_ids  uuid[] default null,
  p_desk_tier     text   default null,
  p_desk_feature  text   default null
) returns table (
  id uuid, document_id uuid, content text, similarity float8, chunk_index int, source_kind text, page_number int,
  char_from int, char_to int, title text, file_name text, file_url text, desk_tier text, desk_feature text,
  block_ids uuid[], image_ids uuid[], section jsonb
)
language plpgsql
stable
security invoker
set search_path = public, extensions
as $fn$
#variable_conflict use_column
declare
  c_candidates constant int := 60;
  c_rrf_k constant int := 50;
begin
  if coalesce(array_length(p_document_ids, 1), 0) > 0 or p_desk_feature is null then
    return query select * from public.match_documents(query_embedding, match_count, p_document_ids, p_desk_tier, p_desk_feature);
    return;
  end if;

  return query
    with vec as (
      select m.id, m.ordinality as rn
        from public.match_documents(query_embedding, c_candidates, null, p_desk_tier, p_desk_feature) with ordinality m
    ),
    kw as (
      select r.id, r.rank_ix as rn from retrieval_internal.recipe_fulltext_ids(query_text, p_desk_feature, c_candidates) r
    ),
    fused as (
      select coalesce(v.id, k.id) as id, v.rn as vr, k.rn as kr,
             coalesce(1.0 / (c_rrf_k + k.rn), 0) + coalesce(1.0 / (c_rrf_k + v.rn), 0) as score
        from kw k
        full join vec v on v.id = k.id
       order by 4 desc, v.rn nulls last, k.rn nulls last, 1
       limit match_count
    )
    select c.id, c.document_id, c.content,
           (1 - (c.embedding <=> query_embedding))::float8,
           c.chunk_index, c.source_kind, c.page_number, c.char_from, c.char_to,
           d.title, d.file_name, d.file_url, d.desk_tier, d.desk_feature,
           c.block_ids, c.image_ids, c.metadata->'section'
      from fused f
      join public.document_chunks c on c.id = f.id and c.desk_feature = p_desk_feature
      join public.documents d on d.id = c.document_id
     order by f.score desc, f.vr nulls last, f.kr nulls last, f.id;
end
$fn$;

revoke all on function public.match_documents_hybrid_recipe(extensions.vector, text, int, uuid[], text, text) from public, anon;
grant execute on function public.match_documents_hybrid_recipe(extensions.vector, text, int, uuid[], text, text) to authenticated;
