-- 0014: preserve exact citation spans on hash reuse; hide unfinished revisions.
-- Normalized hashes intentionally fold whitespace. Refresh the supplied exact
-- content together with its anchors while retaining the chunk UUID/embedding.
-- Offsets are zero-based JavaScript UTF-16 code units (chunkDocument and
-- SourceReader.slice), not PostgreSQL character indexes. Do not reconstruct
-- content using SQL substring with these offsets; astral characters differ.
--
-- The single ingestion writer clears indexed_at with each text upsert, then
-- commits chunks, then marks indexed. Readers must not expose either old or
-- newly committed chunks until that last step succeeds. This preserves the
-- existing ingestion/RPC interface; no data rewrite or provider call occurs.
-- Rollback (manual): restore the two function definitions from migration 0009;
-- that also restores its known citation/readiness defects.

create or replace function public.chunk_commit(
  p_document_id uuid,
  p_rows        jsonb,
  p_keep_hashes text[]
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_deleted  int := 0;
  v_kept     int := 0;
  v_inserted int := 0;
  r          jsonb;
  v_hash     text;
  v_updated  int;
begin
  if p_document_id is null then
    raise exception 'chunk_commit: p_document_id is required';
  end if;

  delete from public.document_chunks
   where document_id = p_document_id
     and not (chunk_hash = any (coalesce(p_keep_hashes, '{}'::text[])));
  get diagnostics v_deleted = row_count;

  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_hash := r->>'chunk_hash';
    if v_hash is null then
      raise exception 'chunk_commit: a row has no chunk_hash';
    end if;

    update public.document_chunks
       set chunk_index     = (r->>'chunk_index')::int,
           char_from       = (r->>'char_from')::int,
           char_to         = (r->>'char_to')::int,
           content         = r->>'content',
           page_number     = nullif(r->>'page_number', '')::int,
           source_kind     = coalesce(r->>'source_kind', 'document'),
           metadata        = coalesce(r->'metadata', '{}'::jsonb),
           chunker_version = (r->>'chunker_version')::int,
           token_count     = nullif(r->>'token_count', '')::int
     where document_id = p_document_id
       and chunk_hash  = v_hash;
    get diagnostics v_updated = row_count;

    if v_updated = 1 then
      v_kept := v_kept + 1;
    else
      if r->'embedding' is null or jsonb_typeof(r->'embedding') <> 'array' then
        raise exception 'chunk_commit: new chunk % has no embedding', v_hash;
      end if;
      if jsonb_array_length(r->'embedding') <> 1536 then
        raise exception 'chunk_commit: new chunk % has embedding width %, expected 1536', v_hash, jsonb_array_length(r->'embedding');
      end if;
      insert into public.document_chunks
        (document_id, chunk_hash, chunk_index, source_kind, page_number, char_from, char_to,
         content, token_count, embedding, chunker_version, metadata)
      values
        (p_document_id,
         v_hash,
         (r->>'chunk_index')::int,
         coalesce(r->>'source_kind', 'document'),
         nullif(r->>'page_number', '')::int,
         (r->>'char_from')::int,
         (r->>'char_to')::int,
         r->>'content',
         nullif(r->>'token_count', '')::int,
         (r->>'embedding')::extensions.vector(1536),
         (r->>'chunker_version')::int,
         coalesce(r->'metadata', '{}'::jsonb));
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'kept', v_kept, 'deleted', v_deleted);
end;
$$;

revoke all on function public.chunk_commit(uuid, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.chunk_commit(uuid, jsonb, text[]) to service_role;

-- Nearest chunks by cosine similarity, joined to their document. Security
-- invoker: the caller's RLS applies (every signed-in user may read the global
-- corpus, ADR 0003); anon has no policy and no execute grant.
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
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select c.id, c.document_id, c.content,
         1 - (c.embedding <=> query_embedding) as similarity,
         c.chunk_index, c.source_kind, c.page_number, c.char_from, c.char_to,
         d.title, d.file_name, d.file_url, d.desk_tier, d.desk_feature
    from public.document_chunks c
    join public.documents d on d.id = c.document_id
   where c.embedding is not null
     and d.indexed_at is not null
     and (p_document_ids is null or c.document_id = any (p_document_ids))
     and (p_desk_tier is null or d.desk_tier = p_desk_tier)
   order by c.embedding <=> query_embedding
   limit least(greatest(coalesce(match_count, 40), 1), 200)
$$;

revoke all on function public.match_documents(extensions.vector, int, uuid[], text) from public, anon;
grant execute on function public.match_documents(extensions.vector, int, uuid[], text) to authenticated, service_role;
