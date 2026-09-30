-- chunk-contract (T14): the page, block and image contract. Spec:
-- docs/specs/2026-09-30-rag-v2-chunk-contract.md ("Schema", R4-R6); ADR 0004
-- and its 2026-09-30 amendment. Additive: the existing documents, chunks,
-- ingest-documents and every saved citation keep working.
--
--   * documents gains nullable storage_path, file_sha256, extract_hash and
--     source_mime; document_chunks gains nullable block_ids, image_ids and
--     embed_hash. Old rows read null.
--   * document_pages, document_page_blocks and document_page_images, keyed by
--     (document_id, extract_hash, ...), cascade with their document. A box is
--     either all null (the page had no dimensions) or all set, inside 0..1,
--     with x0 <= x1 and y0 <= y1; a block's offsets are both null (not
--     located) or both set with 0 <= char_from <= char_to. (Each check names
--     every column as not null: a comparison with a null passes a CHECK.)
--     Each unique key also serves the lookups by extraction (and, for blocks,
--     by page) as its leading columns, so no separate, duplicate index is
--     created.
--   * Each new table: RLS on, revoke all from public, anon, authenticated and
--     service_role, then select to authenticated and select, insert, update,
--     delete to service_role, and one policy: select to authenticated using
--     (true). Supabase's default privileges grant new tables broadly, hence
--     revoke first.
--   * chunk_commit (same signature, security definer, search_path and grants,
--     re-asserted): a hit also refreshes block_ids, image_ids and embed_hash
--     from the row, and replaces the vector when the row carries one (R4: the
--     context changed, the text did not, so the id and its citations survive).
--     An insert writes them. A row without these keys behaves as before and
--     leaves them null. A hit whose embed_hash changes without a new vector is
--     refused, so embed_hash always names the input of the stored vector.
--   * match_documents and match_documents_feature_hnsw are dropped and
--     recreated with the same signatures and bodies as 20261001100000, plus
--     three return columns: block_ids, image_ids and section
--     (metadata->'section'). Old rows return nulls. Both keep revoke from
--     public and anon, grant to authenticated and service_role.
--
-- No function here has a SET clause for a custom GUC: NTER's migration role is
-- not a superuser and refused `set hnsw.ef_search` on 2026-10-01. The helper
-- keeps set_config and restores the caller's value. run.sh applies this file as
-- a non-superuser to prove it.
--
-- Deploy order:
--   1. This migration. The deployed research-chat reads match_documents rows
--      by column name, so the extra columns are ignored; ingest-documents sends
--      none of the new chunk_commit keys, so it behaves exactly as before.
--      (If PostgREST reports a function missing, run notify pgrst, 'reload schema'.)
--   2. research-chat and the browser changes that read the new columns (T15a/b)
--      and ingest-documents' refusal of page-aware documents (T16), in any order.
--   3. ingestion-v2, the first writer of pages and page chunks.
--
-- Down, only while no page-aware document exists (it drops page data): roll
-- back steps 2-3, then from the repository root:
--
--   begin;
--   drop function public.match_documents(extensions.vector, int, uuid[], text, text);
--   drop function public.match_documents_feature_hnsw(extensions.vector, int, text, text);
--   -- run 20261001100000_match_documents_feature.sql's create function, revoke
--   -- and grant statements for match_documents_feature_hnsw and match_documents
--   -- only (not document_modules, which this migration leaves in place);
--   -- run 20260921000014_corpus_revision_integrity.sql's chunk_commit
--   -- create or replace, revoke and grant statements (not its match_documents);
--   drop table public.document_page_images, public.document_page_blocks, public.document_pages;
--   alter table public.document_chunks drop column block_ids, drop column image_ids, drop column embed_hash;
--   alter table public.documents drop column storage_path, drop column file_sha256,
--     drop column extract_hash, drop column source_mime;
--   commit;
--
-- Then check that exactly one overload of each function exists.

-- ---------------------------------------------------------------------------
-- Columns on existing tables (nullable, no default: catalogue-only changes).

alter table public.documents
  add column storage_path text,   -- <document_id>/<file_sha256>.pdf in the private corpus bucket
  add column file_sha256  text,   -- the PDF's content hash
  add column extract_hash text,   -- the current extraction (R6); changed only by compare-and-set
  add column source_mime  text;   -- application/pdf

alter table public.document_chunks
  add column block_ids  uuid[],   -- document_page_blocks.id overlapping the chunk (R5)
  add column image_ids  uuid[],   -- document_page_images.id whose placeholder lies inside it
  add column embed_hash text;     -- SHA-256(normalise(embedding input)) (R4)

-- ---------------------------------------------------------------------------
-- Pages, blocks and images of an extraction.

create table public.document_pages (
  id             uuid primary key default gen_random_uuid(),
  document_id    uuid not null references public.documents(id) on delete cascade,
  extract_hash   text not null,
  page_number    int  not null check (page_number >= 1),
  text           text not null,
  char_from      int  not null,   -- UTF-16 offsets of text in documents.ocr_text
  char_to        int  not null,
  header         text,
  footer         text,
  header_in_text boolean not null default false,
  footer_in_text boolean not null default false,
  width_px       int,
  height_px      int,
  dpi            int,
  created_at     timestamptz not null default now(),
  constraint document_pages_span check (0 <= char_from and char_from <= char_to),
  constraint document_pages_page_key unique (document_id, extract_hash, page_number)
);

create table public.document_page_blocks (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.documents(id) on delete cascade,
  extract_hash text not null,
  page_number  int  not null check (page_number >= 1),
  block_index  int  not null,     -- reading order
  type         text not null,
  x0           real,
  y0           real,
  x1           real,
  y1           real,
  char_from    int,               -- page-local, null when not located
  char_to      int,
  content      text,
  constraint document_page_blocks_box check (
    (x0 is null and y0 is null and x1 is null and y1 is null)
    or (x0 is not null and y0 is not null and x1 is not null and y1 is not null
        and 0 <= x0 and x0 <= x1 and x1 <= 1 and 0 <= y0 and y0 <= y1 and y1 <= 1)),
  constraint document_page_blocks_span check (
    (char_from is null and char_to is null)
    or (char_from is not null and char_to is not null and 0 <= char_from and char_from <= char_to)),
  constraint document_page_blocks_block_key unique (document_id, extract_hash, page_number, block_index)
);

create table public.document_page_images (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.documents(id) on delete cascade,
  extract_hash text not null,
  page_number  int  not null check (page_number >= 1),
  placeholder  text not null,     -- img:<page>-<n>
  sha256       text not null,
  mime         text not null,
  storage_path text not null,     -- <document_id>/img/<sha256>.<ext>
  byte_size    int,
  x0           real,
  y0           real,
  x1           real,
  y1           real,
  constraint document_page_images_box check (
    (x0 is null and y0 is null and x1 is null and y1 is null)
    or (x0 is not null and y0 is not null and x1 is not null and y1 is not null
        and 0 <= x0 and x0 <= x1 and x1 <= 1 and 0 <= y0 and y0 <= y1 and y1 <= 1)),
  constraint document_page_images_placeholder_key unique (document_id, extract_hash, placeholder)
);

alter table public.document_pages       enable row level security;
alter table public.document_page_blocks enable row level security;
alter table public.document_page_images enable row level security;

revoke all on table public.document_pages, public.document_page_blocks, public.document_page_images
  from public, anon, authenticated, service_role;
grant select on table public.document_pages, public.document_page_blocks, public.document_page_images
  to authenticated;
grant select, insert, update, delete on table public.document_pages, public.document_page_blocks, public.document_page_images
  to service_role;

create policy document_pages_read       on public.document_pages       for select to authenticated using (true);
create policy document_page_blocks_read on public.document_page_blocks for select to authenticated using (true);
create policy document_page_images_read on public.document_page_images for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- chunk_commit: 0014's function, plus the page columns and vector replacement.

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
  v_deleted    int := 0;
  v_kept       int := 0;
  v_inserted   int := 0;
  r            jsonb;
  v_hash       text;
  v_updated    int;
  v_block_ids  uuid[];
  v_image_ids  uuid[];
  v_embed_hash text;
  v_embedding  extensions.vector(1536);
  v_stored     text;
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

    -- The page columns. An absent key or a JSON null is null; a list keeps its order.
    if coalesce(jsonb_typeof(r->'block_ids'), 'null') not in ('array', 'null') then
      raise exception 'chunk_commit: chunk % has block_ids that is not an array', v_hash;
    end if;
    if coalesce(jsonb_typeof(r->'image_ids'), 'null') not in ('array', 'null') then
      raise exception 'chunk_commit: chunk % has image_ids that is not an array', v_hash;
    end if;
    v_block_ids := case when jsonb_typeof(r->'block_ids') = 'array' then
      array(select e::uuid from jsonb_array_elements_text(r->'block_ids') with ordinality t(e, n) order by n) end;
    v_image_ids := case when jsonb_typeof(r->'image_ids') = 'array' then
      array(select e::uuid from jsonb_array_elements_text(r->'image_ids') with ordinality t(e, n) order by n) end;
    v_embed_hash := r->>'embed_hash';

    -- A vector, when the row carries one: required for an insert, a replacement on a hit.
    v_embedding := null;
    if coalesce(jsonb_typeof(r->'embedding'), 'null') <> 'null' then
      if jsonb_typeof(r->'embedding') <> 'array' then
        raise exception 'chunk_commit: chunk % has an embedding that is not an array', v_hash;
      end if;
      if jsonb_array_length(r->'embedding') <> 1536 then
        raise exception 'chunk_commit: chunk % has embedding width %, expected 1536', v_hash, jsonb_array_length(r->'embedding');
      end if;
      v_embedding := (r->>'embedding')::extensions.vector(1536);
    end if;

    -- On a hit whose embedding input changed, the stored vector no longer matches it.
    if v_embedding is null and v_embed_hash is not null then
      select c.embed_hash into v_stored
        from public.document_chunks c
       where c.document_id = p_document_id and c.chunk_hash = v_hash;
      if found and v_stored is distinct from v_embed_hash then
        raise exception 'chunk_commit: chunk % changed embed_hash without a new embedding', v_hash;
      end if;
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
           token_count     = nullif(r->>'token_count', '')::int,
           block_ids       = v_block_ids,
           image_ids       = v_image_ids,
           embed_hash      = v_embed_hash,
           embedding       = coalesce(v_embedding, embedding)
     where document_id = p_document_id
       and chunk_hash  = v_hash;
    get diagnostics v_updated = row_count;

    if v_updated = 1 then
      v_kept := v_kept + 1;
    else
      if v_embedding is null then
        raise exception 'chunk_commit: new chunk % has no embedding', v_hash;
      end if;
      insert into public.document_chunks
        (document_id, chunk_hash, chunk_index, source_kind, page_number, char_from, char_to,
         content, token_count, embedding, chunker_version, metadata,
         block_ids, image_ids, embed_hash)
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
         v_embedding,
         (r->>'chunker_version')::int,
         coalesce(r->'metadata', '{}'::jsonb),
         v_block_ids,
         v_image_ids,
         v_embed_hash);
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'kept', v_kept, 'deleted', v_deleted);
end;
$$;

revoke all on function public.chunk_commit(uuid, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.chunk_commit(uuid, jsonb, text[]) to service_role;

-- ---------------------------------------------------------------------------
-- match_documents and its large-feature helper: 20261001100000's definitions,
-- plus block_ids, image_ids and section. A return type cannot change in place,
-- so both are dropped and recreated.

drop function public.match_documents(extensions.vector, int, uuid[], text, text);
drop function public.match_documents_feature_hnsw(extensions.vector, int, text, text);

-- The large-feature path. Filtering after the index scan is correct only
-- while the feature is a large share of the corpus: with N = 400 the scan
-- yields up to 400 nearest chunks before the feature filter. Measured:
-- docs/research/2026-10-01-feature-filter-measurements.md.
--
-- N is applied with set_config(..., true) and restored before returning,
-- rather than with a SET clause. NTER refused the SET clause on 2026-10-01
-- ("permission denied to set parameter hnsw.ef_search"): until pgvector's
-- library is loaded in a session, hnsw.ef_search is a placeholder, and only
-- a superuser may attach a placeholder to a function. set_config is allowed
-- for any role (verified as authenticated on NTER). RETURN QUERY runs the
-- query to completion before the next statement, so restoring the old value
-- afterwards means nothing outlives the call.
create function public.match_documents_feature_hnsw(
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
  v_previous  text := current_setting('hnsw.ef_search', true);
begin
  perform set_config('hnsw.ef_search', c_ef_search, true);
  return query
    select c.id, c.document_id, c.content,
           (1 - (c.embedding <=> query_embedding))::float8,
           c.chunk_index, c.source_kind, c.page_number, c.char_from, c.char_to,
           d.title, d.file_name, d.file_url, d.desk_tier, d.desk_feature,
           c.block_ids, c.image_ids, c.metadata->'section'
      from public.document_chunks c
      join public.documents d on d.id = c.document_id
     where c.embedding is not null
       and d.indexed_at is not null
       and d.desk_feature = p_desk_feature
       and (p_desk_tier is null or d.desk_tier = p_desk_tier)
     order by (c.embedding::extensions.halfvec(1536)) <=> (query_embedding::extensions.halfvec(1536))
     limit least(greatest(coalesce(match_count, 40), 1), 200);
  -- Restore what the caller had ('' when the setting did not exist yet reads
  -- back as the default, 40, once the library is loaded).
  perform set_config('hnsw.ef_search', coalesce(nullif(v_previous, ''), '40'), true);
end
$fn$;

revoke all on function public.match_documents_feature_hnsw(extensions.vector, int, text, text) from public, anon;
grant execute on function public.match_documents_feature_hnsw(extensions.vector, int, text, text) to authenticated, service_role;

create function public.match_documents(
  query_embedding extensions.vector(1536),
  match_count     int    default 40,
  p_document_ids  uuid[] default null,
  p_desk_tier     text   default null,
  p_desk_feature  text   default null
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
  v_limit int := least(greatest(coalesce(match_count, 40), 1), 200);
  v_docs  int := coalesce(array_length(p_document_ids, 1), 0);
  v_quota int;
  -- T: at most this many indexed, embedded chunks in the feature -> exact scan;
  -- more -> match_documents_feature_hnsw, which applies N = 400 to its own
  -- query and restores the caller's value (see its comment). Chosen in
  -- docs/research/2026-10-01-feature-filter-measurements.md.
  c_exact_max_chunks constant int := 15000;
  v_chunks int;
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
               c.block_ids, c.image_ids, c.metadata->'section' as section,
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
             d.title, d.file_name, d.file_url, d.desk_tier, d.desk_feature,
             s.block_ids, s.image_ids, s.section
        from scoped s
        join public.documents d on d.id = s.document_id
       where s.rn <= v_quota
         and d.indexed_at is not null
         and (p_desk_tier is null or d.desk_tier = p_desk_tier)
       order by s.dist
       limit v_limit;
  elsif p_desk_feature is null then
    -- Unscoped: ranked on the half-precision HNSW index
    -- (document_chunks_embedding_halfvec_hnsw); the similarity returned is
    -- still computed at full precision for the rows kept.
    return query
      select c.id, c.document_id, c.content,
             (1 - (c.embedding <=> query_embedding))::float8,
             c.chunk_index, c.source_kind, c.page_number, c.char_from, c.char_to,
             d.title, d.file_name, d.file_url, d.desk_tier, d.desk_feature,
             c.block_ids, c.image_ids, c.metadata->'section'
        from public.document_chunks c
        join public.documents d on d.id = c.document_id
       where c.embedding is not null
         and d.indexed_at is not null
         and (p_desk_tier is null or d.desk_tier = p_desk_tier)
       order by (c.embedding::extensions.halfvec(1536)) <=> (query_embedding::extensions.halfvec(1536))
       limit v_limit;
  else
    -- Feature, no ids: hybrid X. Count the feature's chunks, stopping at T + 1:
    -- that decides the path without counting all of a large feature.
    select count(*) into v_chunks
      from (select 1
              from public.document_chunks c
              join public.documents d on d.id = c.document_id
             where c.embedding is not null
               and d.indexed_at is not null
               and d.desk_feature = p_desk_feature
               and (p_desk_tier is null or d.desk_tier = p_desk_tier)
             limit c_exact_max_chunks + 1) f;
    if v_chunks <= c_exact_max_chunks then
      -- Exact: full-precision distance, which no index serves, so every chunk
      -- of the feature is scored and the full match_count comes back whenever
      -- the feature holds that many. No per-document quota.
      return query
        select c.id, c.document_id, c.content,
               (1 - (c.embedding <=> query_embedding))::float8,
               c.chunk_index, c.source_kind, c.page_number, c.char_from, c.char_to,
               d.title, d.file_name, d.file_url, d.desk_tier, d.desk_feature,
               c.block_ids, c.image_ids, c.metadata->'section'
          from public.document_chunks c
          join public.documents d on d.id = c.document_id
         where c.embedding is not null
           and d.indexed_at is not null
           and d.desk_feature = p_desk_feature
           and (p_desk_tier is null or d.desk_tier = p_desk_tier)
         order by c.embedding <=> query_embedding
         limit v_limit;
    else
      return query
        select * from public.match_documents_feature_hnsw(query_embedding, v_limit, p_desk_tier, p_desk_feature);
    end if;
  end if;
end
$fn$;

revoke all on function public.match_documents(extensions.vector, int, uuid[], text, text) from public, anon;
grant execute on function public.match_documents(extensions.vector, int, uuid[], text, text) to authenticated, service_role;
