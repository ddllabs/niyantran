-- Feature-filter candidates for retrieval-scope (spec "Choosing the feature-branch
-- strategy"; plan task T7). REPLICA ONLY: loaded into niyantran_retrieval_replica, never
-- into NTER. Every candidate has the future 5-argument signature. With ids, or without a
-- feature, each delegates to the live match_documents, so only the feature branch differs.
-- HNSW settings are fixed per function with a SET clause, which scopes them to the call.
\set ON_ERROR_STOP on

drop type if exists public.match_row cascade;
create type public.match_row as (
  id uuid, document_id uuid, content text, similarity float8, chunk_index int, source_kind text,
  page_number int, char_from int, char_to int, title text, file_name text, file_url text,
  desk_tier text, desk_feature text
);

-- The feature's chunks, joined and filtered (shared by the exact candidates).
create or replace view public.cand_feature_chunks as
  select c.id, c.document_id, c.content, c.embedding, c.chunk_index, c.source_kind, c.page_number,
         c.char_from, c.char_to, d.title, d.file_name, d.file_url, d.desk_tier, d.desk_feature
    from public.document_chunks c
    join public.documents d on d.id = c.document_id
   where d.indexed_at is not null and c.embedding is not null;
grant select on public.cand_feature_chunks to authenticated;

-- E: exact. Ordered by full-precision distance, which no index serves: an exact scan of
-- the feature's chunks, no per-document quota.
create or replace function public.match_documents_e(
  query_embedding extensions.vector(1536), match_count int default 40,
  p_document_ids uuid[] default null, p_desk_tier text default null, p_desk_feature text default null
) returns setof public.match_row language plpgsql stable security invoker
set search_path = public, extensions as $fn$
declare v_limit int := least(greatest(coalesce(match_count, 40), 1), 200);
begin
  if coalesce(array_length(p_document_ids, 1), 0) > 0 or p_desk_feature is null then
    return query select * from public.match_documents(query_embedding, match_count, p_document_ids, p_desk_tier);
    return;
  end if;
  return query
    select f.id, f.document_id, f.content, (1 - (f.embedding <=> query_embedding))::float8,
           f.chunk_index, f.source_kind, f.page_number, f.char_from, f.char_to,
           f.title, f.file_name, f.file_url, f.desk_tier, f.desk_feature
      from public.cand_feature_chunks f
     where f.desk_feature = p_desk_feature and (p_desk_tier is null or f.desk_tier = p_desk_tier)
     order by f.embedding <=> query_embedding
     limit v_limit;
end $fn$;

-- Eh: exact at half precision over the materialised feature set (so HNSW can't be used and
-- filter after the fact), top 2×limit, then a full-precision re-rank.
create or replace function public.match_documents_eh(
  query_embedding extensions.vector(1536), match_count int default 40,
  p_document_ids uuid[] default null, p_desk_tier text default null, p_desk_feature text default null
) returns setof public.match_row language plpgsql stable security invoker
set search_path = public, extensions as $fn$
declare v_limit int := least(greatest(coalesce(match_count, 40), 1), 200);
begin
  if coalesce(array_length(p_document_ids, 1), 0) > 0 or p_desk_feature is null then
    return query select * from public.match_documents(query_embedding, match_count, p_document_ids, p_desk_tier);
    return;
  end if;
  return query
    with feature as materialized (
      select f.id, f.embedding from public.cand_feature_chunks f
       where f.desk_feature = p_desk_feature and (p_desk_tier is null or f.desk_tier = p_desk_tier)
    ), top as (
      select feature.id from feature
       order by (feature.embedding::halfvec(1536)) <=> (query_embedding::halfvec(1536))
       limit v_limit * 2
    )
    select f.id, f.document_id, f.content, (1 - (f.embedding <=> query_embedding))::float8,
           f.chunk_index, f.source_kind, f.page_number, f.char_from, f.char_to,
           f.title, f.file_name, f.file_url, f.desk_tier, f.desk_feature
      from top t join public.cand_feature_chunks f on f.id = t.id
     order by f.embedding <=> query_embedding
     limit v_limit;
end $fn$;

-- H<N>: HNSW with ef_search = N, filtered after the index scan (the D1 behaviour, with a
-- wider beam). One function per N, each with its own SET clause.
do $do$
declare ef int;
begin
  foreach ef in array array[100, 400, 1000] loop
    execute format($f$
      create or replace function public.match_documents_h%1$s(
        query_embedding extensions.vector(1536), match_count int default 40,
        p_document_ids uuid[] default null, p_desk_tier text default null, p_desk_feature text default null
      ) returns setof public.match_row language plpgsql stable security invoker
      set search_path = public, extensions
      set hnsw.ef_search = %1$s
      as $fn$
      declare v_limit int := least(greatest(coalesce(match_count, 40), 1), 200);
      begin
        if coalesce(array_length(p_document_ids, 1), 0) > 0 or p_desk_feature is null then
          return query select * from public.match_documents(query_embedding, match_count, p_document_ids, p_desk_tier);
          return;
        end if;
        return query
          select c.id, c.document_id, c.content, (1 - (c.embedding <=> query_embedding))::float8,
                 c.chunk_index, c.source_kind, c.page_number, c.char_from, c.char_to,
                 d.title, d.file_name, d.file_url, d.desk_tier, d.desk_feature
            from public.document_chunks c
            join public.documents d on d.id = c.document_id
           where d.desk_feature = p_desk_feature and (p_desk_tier is null or d.desk_tier = p_desk_tier)
             and d.indexed_at is not null and c.embedding is not null
           order by (c.embedding::halfvec(1536)) <=> (query_embedding::halfvec(1536))
           limit v_limit;
      end $fn$;$f$, ef);
  end loop;
end $do$;

-- I: HNSW with iterative scan (relaxed order), a materialised CTE and a re-sort on
-- distance + 0 (the pgvector 0.8 README pattern for Postgres 17).
create or replace function public.match_documents_i(
  query_embedding extensions.vector(1536), match_count int default 40,
  p_document_ids uuid[] default null, p_desk_tier text default null, p_desk_feature text default null
) returns setof public.match_row language plpgsql stable security invoker
set search_path = public, extensions
set hnsw.iterative_scan = relaxed_order
as $fn$
declare v_limit int := least(greatest(coalesce(match_count, 40), 1), 200);
begin
  if coalesce(array_length(p_document_ids, 1), 0) > 0 or p_desk_feature is null then
    return query select * from public.match_documents(query_embedding, match_count, p_document_ids, p_desk_tier);
    return;
  end if;
  return query
    with hits as materialized (
      select c.id, (c.embedding::halfvec(1536)) <=> (query_embedding::halfvec(1536)) as dist
        from public.document_chunks c
        join public.documents d on d.id = c.document_id
       where d.desk_feature = p_desk_feature and (p_desk_tier is null or d.desk_tier = p_desk_tier)
         and d.indexed_at is not null and c.embedding is not null
       order by dist
       limit v_limit
    )
    select c.id, c.document_id, c.content, (1 - (c.embedding <=> query_embedding))::float8,
           c.chunk_index, c.source_kind, c.page_number, c.char_from, c.char_to,
           d.title, d.file_name, d.file_url, d.desk_tier, d.desk_feature
      from hits h
      join public.document_chunks c on c.id = h.id
      join public.documents d on d.id = c.document_id
     order by h.dist + 0
     limit v_limit;
end $fn$;

grant execute on function public.match_documents_e(extensions.vector, int, uuid[], text, text),
  public.match_documents_eh(extensions.vector, int, uuid[], text, text),
  public.match_documents_h100(extensions.vector, int, uuid[], text, text),
  public.match_documents_h400(extensions.vector, int, uuid[], text, text),
  public.match_documents_h1000(extensions.vector, int, uuid[], text, text),
  public.match_documents_i(extensions.vector, int, uuid[], text, text)
  to authenticated;
