-- F278 step 3 (plan docs/plans/2026-11-01-chunk-partitions.md, task B1; spec
-- docs/specs/2026-11-01-bulk-ingestion.md §4.1 and §4.5): document_chunks becomes a table
-- list-partitioned on the chunk's own copy of its document's feature, with typed facet
-- columns kept equal to the document by triggers. Code keeps naming public.document_chunks.
--
-- What changes
--   * public.document_chunks is a new table, partitioned by list (desk_feature):
--       document_chunks_nclt     for 'NCLT / NCLAT (Insolvency)' (225,273 chunks on 2026-11-01)
--       document_chunks_default  everything else, including a null feature
--     It has the old columns (same types, defaults and check) plus four facets:
--       desk_tier, desk_feature (the partition key), doc_date, language.
--     Unique keys must include the partition key: (id, desk_feature) and
--     (document_id, chunk_hash, desk_feature), both NULLS NOT DISTINCT so a null feature still
--     gets the old uniqueness. Every chunk of a document has its document's feature (the
--     trigger below refuses anything else), so (document_id, chunk_hash) stays unique.
--     A primary key is not possible: its columns must be NOT NULL, and a chunk of a document
--     without a feature has a null key (documents.desk_feature is nullable). The unique
--     constraint on (id, desk_feature) takes its place.
--     Indexes per partition: the two unique keys, (document_id, chunk_index), the same HNSW
--     index as 20260929120000 (halfvec(1536), halfvec_cosine_ops, default m and
--     ef_construction), and btree (desk_feature, desk_tier|doc_date|language) for facet filters
--     and the exact feature path. Foreign key to documents on delete cascade, as before.
--   * The old table is kept, renamed document_chunks_unpartitioned, with its rows, indexes,
--     policies and foreign key (deleting a document still cascades into it), and no privilege
--     for public, anon, authenticated or service_role. It exists only for the rollback below;
--     a later migration drops it.
--   * Facets: document_date_facet(feature, metadata) is the one parser of doc_date, used by the
--     backfill and both triggers. NCLT citation.order_date and Bills citation.introduced_on are
--     ISO (YYYY-MM-DD); Parliamentary Questions citation.answered_on is D.M.YYYY (separators
--     . / -; ISO also accepted). Anything else, an impossible date, a two-digit year or another
--     feature gives null, never a guess. language is metadata->>'language'.
--   * Sync: a BEFORE INSERT / UPDATE OF (document_id, facets) trigger on chunks fills desk_tier,
--     doc_date and language from the document and refuses a desk_feature that differs from
--     the document's (tuple routing happens before row triggers, so the writer must set the
--     partition key). chunk_commit sets it. An AFTER UPDATE OF (desk_feature, desk_tier,
--     metadata) trigger on documents rewrites the chunks' facets when the derived values change,
--     moving the chunks to the other partition when the feature changes.
--   * Functions: chunk_commit writes desk_feature; match_documents (feature branch) and
--     match_documents_feature_hnsw scope on the chunk's desk_feature (and desk_tier), so the
--     planner reads one partition, and the helper's approximate pass runs with
--     hnsw.iterative_scan = relaxed_order, set and restored with set_config like ef_search.
--     Signatures, security definer / invoker, search_path, volatility and grants are unchanged.
--     match_documents' document-id and unscoped branches are unchanged. admin_readiness_document,
--     ingest_text_activate_unmapped, record_mapping_fingerprint and record_resolve_document_keys
--     are not recreated: they name public.document_chunks in plpgsql / SQL bodies resolved at
--     run time and read only by document_id, so they read the new table with the same results
--     (the fixture executes each one).
--
-- Copy, swap and writes during the window
--   The migration runs in one transaction. It first takes SHARE ROW EXCLUSIVE on documents and
--   document_chunks: searches (reads) continue on the old table throughout, while every chunk or
--   document write waits until commit, so no row can be written between the copy and the swap
--   and no catch-up step is needed. It also refuses to start while an ingestion job holds a live
--   claim (stop ingestion first; the lock is the guarantee, the check makes the freeze explicit).
--   Before the swap it asserts that the old and new tables hold the same number of rows and the
--   same digest of every column, with vectors compared byte for byte (vector_send), and aborts
--   otherwise. The swap takes ACCESS EXCLUSIVE on the old table only for the renames and grants
--   at the end. A writer still blocked when the swap commits re-resolves public.document_chunks
--   to the new table; an older chunk_commit body already running in that session would insert
--   without desk_feature and is refused by the trigger (loud, retryable), never misplaced.
--   A transaction that has already read document_chunks and then waits to write chunks or
--   documents during the window deadlocks with the swap's ACCESS EXCLUSIVE, and PostgreSQL aborts
--   one of the two. If it is the migration, the whole migration rolls back and nothing changed:
--   apply it again. ingest_text_activate does exactly that (reads chunks, then updates documents),
--   which is one more reason the freeze means stopping the worker, not only waiting for claims.
--   (Both behaviours were executed on a disposable copy, 2026-11-01.)
--
-- Phases print NOTICEs prefixed "document_chunks_partitioned phase:" with clock_timestamp(),
-- for the rehearsal's timings (plan task B2/B3).
--
-- Adding a partition later (a feature that passes the 100,000-chunk threshold, spec §4.1).
-- Its rows are in the default partition, which must not keep any row the new bound accepts.
-- With ingestion for the feature stopped, in one migration:
--   lock table public.document_chunks in share row exclusive mode;
--   create table public.document_chunks_<slug> (like public.document_chunks including defaults including constraints);
--   insert into public.document_chunks_<slug> select * from public.document_chunks_default where desk_feature = '<feature>';
--   create index document_chunks_<slug>_embedding_halfvec_hnsw on public.document_chunks_<slug>
--     using hnsw ((embedding::extensions.halfvec(1536)) extensions.halfvec_cosine_ops);
--   delete from public.document_chunks_default where desk_feature = '<feature>';
--   alter table public.document_chunks attach partition public.document_chunks_<slug> for values in ('<feature>');
--   revoke all on table public.document_chunks_<slug> from public, anon, authenticated, service_role;
--   alter table public.document_chunks_<slug> enable row level security;
-- ATTACH builds or attaches every other parent index on the new partition (the HNSW index
-- created above is attached, not rebuilt), clones the row triggers and the foreign key, and
-- scans the default partition to prove it holds no row for the feature. Policies stay on the
-- parent. Supabase's default privileges grant every new table to anon and authenticated, hence
-- the revoke: a partition read directly bypasses the parent's policies.
--
-- Rollback, while document_chunks_unpartitioned still exists (stop ingestion first). It copies
-- back the chunk writes made since the swap, so nothing written after the swap is lost:
--
--   begin;
--   set local lock_timeout = '30s';
--   lock table public.documents, public.document_chunks, public.document_chunks_unpartitioned in share row exclusive mode;
--   delete from public.document_chunks_unpartitioned o where not exists (select 1 from public.document_chunks n where n.id = o.id);
--   insert into public.document_chunks_unpartitioned
--     (id, document_id, chunk_hash, chunk_index, source_kind, page_number, char_from, char_to, content, token_count,
--      embedding, chunker_version, metadata, created_at, block_ids, image_ids, embed_hash)
--   select id, document_id, chunk_hash, chunk_index, source_kind, page_number, char_from, char_to, content, token_count,
--          embedding, chunker_version, metadata, created_at, block_ids, image_ids, embed_hash
--     from public.document_chunks
--   on conflict (id) do update set
--     document_id = excluded.document_id, chunk_hash = excluded.chunk_hash, chunk_index = excluded.chunk_index,
--     source_kind = excluded.source_kind, page_number = excluded.page_number, char_from = excluded.char_from,
--     char_to = excluded.char_to, content = excluded.content, token_count = excluded.token_count,
--     embedding = excluded.embedding, chunker_version = excluded.chunker_version, metadata = excluded.metadata,
--     created_at = excluded.created_at, block_ids = excluded.block_ids, image_ids = excluded.image_ids,
--     embed_hash = excluded.embed_hash;
--   lock table public.document_chunks, public.document_chunks_unpartitioned in access exclusive mode;
--   drop trigger documents_chunk_facets on public.documents;
--   drop table public.document_chunks;
--   alter table public.document_chunks_unpartitioned rename to document_chunks;
--   alter index public.document_chunks_unpartitioned_pkey rename to document_chunks_pkey;
--   alter index public.document_chunks_unpartitioned_document_id_chunk_hash_key rename to document_chunks_document_id_chunk_hash_key;
--   alter index public.document_chunks_unpartitioned_document_order rename to document_chunks_document_order;
--   alter index public.document_chunks_unpartitioned_embedding_halfvec_hnsw rename to document_chunks_embedding_halfvec_hnsw;
--   grant select on table public.document_chunks to authenticated;
--   grant select, insert, update, delete on table public.document_chunks to service_role;
--   drop function public.documents_sync_chunk_facets();
--   drop function public.document_chunks_fill_facets();
--   drop function public.document_date_facet(text, jsonb);
--   -- run 20261001120000_page_contract.sql's chunk_commit create or replace, revoke and grant;
--   -- run 20261015130000_unscoped_ef_search.sql's match_documents create or replace, revoke and grant;
--   -- run 20261027185840_feature_search_recovery.sql's match_documents_feature_hnsw create or replace, revoke and grant;
--   commit;
--   analyze public.document_chunks;
--
-- The old table's policies (document_chunks_read, law_chunks_serving) were never removed, so
-- the rename restores them. Then check that exactly one overload of each function exists, and
-- run notify pgrst, 'reload schema' if PostgREST still reports the old shape.

-- Explicit, as in 20260921000013: LOCK TABLE and SET LOCAL need a transaction block under psql
-- too (the Supabase CLI already runs each file in one).
begin;

set local statement_timeout = '2h';
set local lock_timeout = '30s';
-- The value NTER accepted for the halfvec index build (20260929120000). Two HNSW builds of
-- about 225k and 168k vectors exceed it, so pgvector builds partly on disk: slower, not wrong.
-- Raise it only after checking NTER's memory (plan B3 measures the build times).
set local maintenance_work_mem = '256MB';

-- ---------------------------------------------------------------------------
-- Preconditions. Each failure aborts before anything is changed.

do $$
declare
  v_old regclass := to_regclass('public.document_chunks');
  v_vector_version int[];
  v_missing text;
  v_extra text;
begin
  if v_old is null or (select relkind from pg_class where oid = v_old) <> 'r' then
    raise exception 'document_chunks_partitioned: public.document_chunks must exist as an ordinary (unpartitioned) table';
  end if;
  if to_regclass('public.document_chunks_unpartitioned') is not null
     or to_regclass('public.document_chunks_partitioned') is not null
     or to_regclass('public.document_chunks_nclt') is not null
     or to_regclass('public.document_chunks_default') is not null then
    raise exception 'document_chunks_partitioned: a table this migration creates already exists';
  end if;

  -- Iterative index scans arrived in pgvector 0.8.0. Without them the feature search would
  -- silently fall back to filtering after the index.
  select string_to_array(split_part(extversion, '-', 1), '.')::int[] into v_vector_version
    from pg_extension where extname = 'vector';
  if v_vector_version is null or v_vector_version < array[0, 8, 0] then
    raise exception 'document_chunks_partitioned: pgvector 0.8.0 or later is required (hnsw.iterative_scan)';
  end if;

  -- The copy names every column. A column it does not know would be lost, so any difference fails.
  with expected(name, typ, typmod) as (values
    ('id', 'uuid'::regtype, -1), ('document_id', 'uuid'::regtype, -1), ('chunk_hash', 'text'::regtype, -1),
    ('chunk_index', 'integer'::regtype, -1), ('source_kind', 'text'::regtype, -1), ('page_number', 'integer'::regtype, -1),
    ('char_from', 'integer'::regtype, -1), ('char_to', 'integer'::regtype, -1), ('content', 'text'::regtype, -1),
    ('token_count', 'integer'::regtype, -1), ('embedding', 'extensions.vector'::regtype, 1536),
    ('chunker_version', 'integer'::regtype, -1), ('metadata', 'jsonb'::regtype, -1),
    ('created_at', 'timestamp with time zone'::regtype, -1), ('block_ids', 'uuid[]'::regtype, -1),
    ('image_ids', 'uuid[]'::regtype, -1), ('embed_hash', 'text'::regtype, -1)
  ), actual as (
    select attname::text as name, atttypid::regtype as typ, atttypmod as typmod
      from pg_attribute where attrelid = v_old and attnum > 0 and not attisdropped
  )
  select (select string_agg(format('%s %s', e.name, e.typ), ', ') from (select * from expected except select * from actual) e),
         (select string_agg(format('%s %s', a.name, a.typ), ', ') from (select * from actual except select * from expected) a)
    into v_missing, v_extra;
  if v_missing is not null or v_extra is not null then
    raise exception 'document_chunks_partitioned: unexpected columns on document_chunks (missing: %; unexpected: %)',
      coalesce(v_missing, 'none'), coalesce(v_extra, 'none');
  end if;

  -- Objects that would stay attached to the old table and silently stop applying.
  if (select array_agg(c.relname::text order by c.relname) from pg_index i join pg_class c on c.oid = i.indexrelid where i.indrelid = v_old)
     is distinct from array['document_chunks_document_id_chunk_hash_key', 'document_chunks_document_order',
                            'document_chunks_embedding_halfvec_hnsw', 'document_chunks_pkey'] then
    raise exception 'document_chunks_partitioned: document_chunks has indexes this migration does not recreate';
  end if;
  -- The two policies below are recreated from this file's text, so they must be today's exactly
  -- (name, permissive or restrictive, command, roles and expression, whitespace and schema aside).
  if (select array_agg(format('%s %s %s %s %s', polname, polpermissive, polcmd, polroles::regrole[],
                              regexp_replace(pg_get_expr(polqual, polrelid), '\s+|public\.|document_chunks\.', '', 'g')) order by polname)
        from pg_policy where polrelid = v_old)
     is distinct from array['document_chunks_read t r {authenticated} true',
                            'law_chunks_serving f r {authenticated} (EXISTS(SELECT1FROMdocumentsdWHERE(d.id=document_id)))'] then
    raise exception 'document_chunks_partitioned: document_chunks has policies this migration does not recreate as they are';
  end if;
  if exists (select 1 from pg_trigger where tgrelid = v_old and not tgisinternal)
     or exists (select 1 from pg_constraint where confrelid = v_old)
     or exists (select 1 from pg_depend d where d.refobjid = v_old and d.classid = 'pg_rewrite'::regclass)
     or exists (select 1 from pg_publication_rel where prrelid = v_old) then
    raise exception 'document_chunks_partitioned: a trigger, foreign key, view or publication depends on document_chunks';
  end if;

  -- The ingestion freeze (see the header). ingest_jobs is absent only on the retrieval replica.
  if to_regclass('public.ingest_jobs') is not null then
    if exists (select 1 from public.ingest_jobs where status = 'running' and lease_until > now()) then
      raise exception 'document_chunks_partitioned: an ingestion job holds a live claim; stop ingestion before applying';
    end if;
  end if;
end
$$;

lock table public.documents, public.document_chunks in share row exclusive mode;

do $$ begin raise notice 'document_chunks_partitioned phase: locked %', clock_timestamp(); end $$;

-- ---------------------------------------------------------------------------
-- The date facet: one parser for the backfill and both triggers.

create function public.document_date_facet(p_desk_feature text, p_metadata jsonb) returns date
language sql immutable parallel safe set search_path = pg_catalog as $$
  select case
           when y between 1 and 9999 and m between 1 and 12
            and d between 1 and case when m = 2 then case when (y % 4 = 0 and y % 100 <> 0) or y % 400 = 0 then 29 else 28 end
                                     when m in (4, 6, 9, 11) then 30
                                     else 31 end
           then make_date(y, m, d)
         end
    from (select coalesce(iso[1], dmy[3])::int as y,
                 coalesce(iso[2], dmy[2])::int as m,
                 coalesce(iso[3], dmy[1])::int as d
            from (select regexp_match(v, '^([0-9]{4})-([0-9]{2})-([0-9]{2})$') as iso,
                         case when p_desk_feature = 'Parliamentary Question Database'
                              then regexp_match(v, '^([0-9]{1,2})[./-]([0-9]{1,2})[./-]([0-9]{4})$') end as dmy
                    from (select btrim(case p_desk_feature
                                         when 'NCLT / NCLAT (Insolvency)'       then p_metadata #>> '{citation,order_date}'
                                         when 'Bill Passage Probability Index'  then p_metadata #>> '{citation,introduced_on}'
                                         when 'Parliamentary Question Database' then p_metadata #>> '{citation,answered_on}'
                                       end, E' \t\n\r\f' || chr(11) || chr(160)) as v) raw) parsed) parts
$$;
revoke all on function public.document_date_facet(text, jsonb) from public, anon, authenticated;
grant execute on function public.document_date_facet(text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- The new table, side by side with the old one. Indexes are built after the copy.

create table public.document_chunks_partitioned (
  id               uuid not null default gen_random_uuid(),
  document_id      uuid not null,
  chunk_hash       text not null,
  chunk_index      int  not null,
  source_kind      text not null default 'document',
  page_number      int,
  char_from        int  not null,
  char_to          int  not null,
  content          text not null,
  token_count      int,
  embedding        extensions.vector(1536),
  chunker_version  int  not null,
  metadata         jsonb not null default '{}',
  created_at       timestamptz not null default now(),
  block_ids        uuid[],
  image_ids        uuid[],
  embed_hash       text,
  desk_tier        text,   -- documents.desk_tier
  desk_feature     text,   -- documents.desk_feature; the partition key
  doc_date         date,   -- document_date_facet(desk_feature, documents.metadata)
  language         text,   -- documents.metadata->>'language'
  constraint document_chunks_source_kind_check check (source_kind in ('document', 'pdf_page'))
) partition by list (desk_feature);

create table public.document_chunks_nclt partition of public.document_chunks_partitioned
  for values in ('NCLT / NCLAT (Insolvency)');
create table public.document_chunks_default partition of public.document_chunks_partitioned default;

-- ---------------------------------------------------------------------------
-- Copy every row, vectors unchanged, with the facets derived once per document.

do $$ begin raise notice 'document_chunks_partitioned phase: copy start %', clock_timestamp(); end $$;

insert into public.document_chunks_partitioned
  (id, document_id, chunk_hash, chunk_index, source_kind, page_number, char_from, char_to, content, token_count,
   embedding, chunker_version, metadata, created_at, block_ids, image_ids, embed_hash,
   desk_tier, desk_feature, doc_date, language)
select c.id, c.document_id, c.chunk_hash, c.chunk_index, c.source_kind, c.page_number, c.char_from, c.char_to,
       c.content, c.token_count, c.embedding, c.chunker_version, c.metadata, c.created_at, c.block_ids, c.image_ids,
       c.embed_hash, f.desk_tier, f.desk_feature, f.doc_date, f.language
  from public.document_chunks c
  join (select d.id, d.desk_tier, d.desk_feature,
               public.document_date_facet(d.desk_feature, d.metadata) as doc_date,
               d.metadata->>'language' as language
          from public.documents d) f on f.id = c.document_id;

do $$ begin raise notice 'document_chunks_partitioned phase: copy done, keys start %', clock_timestamp(); end $$;

alter table public.document_chunks_partitioned
  add constraint document_chunks_id_desk_feature_key unique nulls not distinct (id, desk_feature),
  add constraint document_chunks_document_id_chunk_hash_desk_feature_key
    unique nulls not distinct (document_id, chunk_hash, desk_feature),
  add constraint document_chunks_document_id_fkey
    foreign key (document_id) references public.documents(id) on delete cascade;

create index document_chunks_partitioned_document_order on public.document_chunks_partitioned (document_id, chunk_index);
-- Facet filters: the exact feature path and its count (feature, tier), and the date and
-- language filters planned inside a feature (spec §4.1, "the fine cut").
create index document_chunks_feature_tier on public.document_chunks_partitioned (desk_feature, desk_tier);
create index document_chunks_feature_date on public.document_chunks_partitioned (desk_feature, doc_date);
create index document_chunks_feature_language on public.document_chunks_partitioned (desk_feature, language);

do $$ begin raise notice 'document_chunks_partitioned phase: keys done, hnsw start %', clock_timestamp(); end $$;

-- One HNSW index per partition, the definition of 20260929120000, attached to a parent index
-- so a partition attached later carries it too.
create index document_chunks_partitioned_embedding_halfvec_hnsw on only public.document_chunks_partitioned
  using hnsw ((embedding::extensions.halfvec(1536)) extensions.halfvec_cosine_ops);
create index document_chunks_nclt_embedding_halfvec_hnsw on public.document_chunks_nclt
  using hnsw ((embedding::extensions.halfvec(1536)) extensions.halfvec_cosine_ops);
do $$ begin raise notice 'document_chunks_partitioned phase: hnsw nclt done %', clock_timestamp(); end $$;
create index document_chunks_default_embedding_halfvec_hnsw on public.document_chunks_default
  using hnsw ((embedding::extensions.halfvec(1536)) extensions.halfvec_cosine_ops);
alter index public.document_chunks_partitioned_embedding_halfvec_hnsw
  attach partition public.document_chunks_nclt_embedding_halfvec_hnsw;
alter index public.document_chunks_partitioned_embedding_halfvec_hnsw
  attach partition public.document_chunks_default_embedding_halfvec_hnsw;

do $$ begin raise notice 'document_chunks_partitioned phase: hnsw done, verify start %', clock_timestamp(); end $$;

-- ---------------------------------------------------------------------------
-- Verify the copy before the swap: same row count and the same digest of every old column,
-- vectors byte for byte. Two 64-bit sums of each row's md5, so order does not matter.

do $$
declare
  c_digest constant text := $q$
    select count(*) as n,
           coalesce(sum(('x' || substr(h, 1, 16))::bit(64)::bigint), 0) as a,
           coalesce(sum(('x' || substr(h, 17, 16))::bit(64)::bigint), 0) as b
      from (select md5(row(c.id, c.document_id, c.chunk_hash, c.chunk_index, c.source_kind, c.page_number,
                           c.char_from, c.char_to, c.content, c.token_count, c.chunker_version, c.metadata,
                           c.created_at, c.block_ids, c.image_ids, c.embed_hash)::text
                       || coalesce(md5(extensions.vector_send(c.embedding)), '-')) as h
              from %s c) r
  $q$;
  v_old record;
  v_new record;
begin
  execute format(c_digest, 'public.document_chunks') into v_old;
  execute format(c_digest, 'public.document_chunks_partitioned') into v_new;
  if (v_old.n, v_old.a, v_old.b) is distinct from (v_new.n, v_new.a, v_new.b) then
    raise exception 'document_chunks_partitioned: copy differs from the original (rows % vs %); nothing was swapped',
      v_old.n, v_new.n;
  end if;
  raise notice 'document_chunks_partitioned phase: verified % rows %', v_new.n, clock_timestamp();
end
$$;

-- ---------------------------------------------------------------------------
-- Facet sync. Both trigger functions run as their owner: the chunk trigger must read (and
-- share-lock) a document the writer may not see, and the document trigger must move chunks
-- whatever the updating role may write.

-- Chunks: fill desk_tier, doc_date and language from the document; refuse a desk_feature that
-- is not the document's. The document row is share-locked, so its feature cannot change until
-- this transaction ends (its own trigger would then rewrite this chunk too). A missing document
-- is left to the foreign key, which refuses the row as before.
create function public.document_chunks_fill_facets() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_feature  text;
  v_tier     text;
  v_metadata jsonb;
begin
  select d.desk_feature, d.desk_tier, d.metadata into v_feature, v_tier, v_metadata
    from public.documents d where d.id = new.document_id for share;
  if not found then
    return new;
  end if;
  if new.desk_feature is distinct from v_feature then
    raise exception using errcode = '23514',
      message = format('document_chunks: chunk desk_feature %L is not its document''s %L', new.desk_feature, v_feature),
      hint = 'Write chunks through chunk_commit, which copies the document''s feature.';
  end if;
  new.desk_tier := v_tier;
  new.doc_date  := public.document_date_facet(v_feature, v_metadata);
  new.language  := v_metadata->>'language';
  return new;
end
$$;
revoke all on function public.document_chunks_fill_facets() from public, anon, authenticated, service_role;
create trigger document_chunks_fill_facets
  before insert or update of document_id, desk_tier, desk_feature, doc_date, language
  on public.document_chunks_partitioned
  for each row execute function public.document_chunks_fill_facets();

-- Documents: when a derived facet changes, rewrite it on every chunk. A changed feature moves
-- the rows to the other partition (an UPDATE of the partition key is a delete and an insert).
create function public.documents_sync_chunk_facets() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.desk_feature, new.desk_tier, public.document_date_facet(new.desk_feature, new.metadata), new.metadata->>'language')
     is not distinct from
     (old.desk_feature, old.desk_tier, public.document_date_facet(old.desk_feature, old.metadata), old.metadata->>'language') then
    return null;
  end if;
  update public.document_chunks c
     set desk_feature = new.desk_feature,
         desk_tier    = new.desk_tier,
         doc_date     = public.document_date_facet(new.desk_feature, new.metadata),
         language     = new.metadata->>'language'
   where c.document_id = new.id;
  return null;
end
$$;
revoke all on function public.documents_sync_chunk_facets() from public, anon, authenticated, service_role;
create trigger documents_chunk_facets
  after update of desk_feature, desk_tier, metadata on public.documents
  for each row execute function public.documents_sync_chunk_facets();

-- ---------------------------------------------------------------------------
-- Access: the policies as on the old table, on the parent only. A partition read directly
-- bypasses the parent's policies, so no role but the owner holds any privilege on a partition,
-- and RLS is on there too (no policy, so a role that somehow got a grant still reads nothing).

alter table public.document_chunks_partitioned enable row level security;
alter table public.document_chunks_nclt enable row level security;
alter table public.document_chunks_default enable row level security;
create policy document_chunks_read on public.document_chunks_partitioned for select to authenticated using (true);
create policy law_chunks_serving on public.document_chunks_partitioned as restrictive for select to authenticated using (
  exists (select 1 from public.documents d where d.id = document_id));

revoke all on table public.document_chunks_partitioned, public.document_chunks_nclt, public.document_chunks_default
  from public, anon, authenticated, service_role;
grant select on table public.document_chunks_partitioned to authenticated;
grant select, insert, update, delete on table public.document_chunks_partitioned to service_role;

-- ---------------------------------------------------------------------------
-- Functions. Bodies are resolved by name at run time, so they read the new table after the swap.

-- chunk_commit: 20261001120000's function; an insert also writes desk_feature from the document
-- (the trigger fills the other facets). Same signature, security definer, search_path and grants.
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
  v_feature    text;
begin
  if p_document_id is null then
    raise exception 'chunk_commit: p_document_id is required';
  end if;

  -- The partition key. A missing document leaves it null, and the foreign key refuses the insert.
  select d.desk_feature into v_feature from public.documents d where d.id = p_document_id;

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
         block_ids, image_ids, embed_hash, desk_feature)
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
         v_embed_hash,
         v_feature);
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'kept', v_kept, 'deleted', v_deleted);
end;
$$;

revoke all on function public.chunk_commit(uuid, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.chunk_commit(uuid, jsonb, text[]) to service_role;

-- match_documents_feature_hnsw: 20261027185840's helper, scoped on the chunk's own feature and
-- tier so the planner reads one partition, with the approximate pass walking the index until
-- enough rows pass the filters (pgvector 0.8 hnsw.iterative_scan, relaxed_order; the candidates
-- are re-sorted by distance). Both settings are set with set_config and restored afterwards: NTER
-- refuses a SET clause for a custom setting (see 20261001120000). Recovery and its bound are
-- unchanged. It still runs when the walk stops before match_count rows pass the filters: when the
-- feature has fewer eligible chunks than match_count, or when its chunks are so rare among the
-- partition's indexed rows (or so often hidden by the access check) that hnsw.max_scan_tuples
-- (pgvector default 20,000) or the scan's memory limit is reached first. It raises
-- FEATURE_SEARCH_RECOVERY_LIMIT only if that happens to a feature with more than 100,000 eligible
-- chunks. The access check (RLS on chunks and documents, indexed_at) still applies to every row.
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
  c_iterative_scan constant text := 'relaxed_order';
  c_recovery_max_chunks constant int := 100000;
  v_limit int := least(greatest(coalesce(match_count, 40), 1), 200);
  v_previous text := current_setting('hnsw.ef_search', true);
  v_previous_iterative text := current_setting('hnsw.iterative_scan', true);
  v_ids uuid[];
  v_chunks int;
begin
  perform set_config('hnsw.ef_search', c_ef_search, true);
  perform set_config('hnsw.iterative_scan', c_iterative_scan, true);
  select array_agg(candidate.id order by candidate.distance, candidate.id) into v_ids from (
    select c.id, (c.embedding::extensions.halfvec(1536)) <=> (query_embedding::extensions.halfvec(1536)) as distance
    from public.document_chunks c
    join public.documents d on d.id = c.document_id
    where c.embedding is not null and d.indexed_at is not null
      and c.desk_feature = p_desk_feature
      and (p_desk_tier is null or c.desk_tier = p_desk_tier)
    order by (c.embedding::extensions.halfvec(1536)) <=> (query_embedding::extensions.halfvec(1536))
    limit v_limit
  ) candidate;
  perform set_config('hnsw.iterative_scan', coalesce(nullif(v_previous_iterative, ''), 'off'), true);
  perform set_config('hnsw.ef_search', coalesce(nullif(v_previous, ''), '40'), true);
  if coalesce(cardinality(v_ids), 0) < v_limit then
    -- Bound work before exact recovery. This is a capacity hold, NOT absence of evidence.
    select count(*) into v_chunks from (
      select 1 from public.document_chunks c
      join public.documents d on d.id = c.document_id
      where c.embedding is not null and d.indexed_at is not null
        and c.desk_feature = p_desk_feature
        and (p_desk_tier is null or c.desk_tier = p_desk_tier)
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
        and c.desk_feature = p_desk_feature
        and (p_desk_tier is null or c.desk_tier = p_desk_tier)
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
      join public.document_chunks c on c.id = a.id and c.desk_feature = p_desk_feature
      join public.documents d on d.id = c.document_id
      order by a.n;
  end if;
end
$fn$;
revoke all on function public.match_documents_feature_hnsw(extensions.vector, int, text, text) from public, anon;
grant execute on function public.match_documents_feature_hnsw(extensions.vector, int, text, text) to authenticated, service_role;

-- match_documents: 20261015130000's function. The document-id and unscoped branches are
-- unchanged. The feature branch counts and searches on the chunk's own feature and tier, so it
-- reads one partition; the decision between the exact scan and the helper is unchanged.
create or replace function public.match_documents(
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
  -- F35: the unscoped search's HNSW candidate list. 200 finds the right document in the top 10 as
  -- often as exact search on the replica (170/184; the default 40 finds 162), at about 2 ms more p50.
  -- Above about 500 the planner turns to an exact scan. Measured:
  -- docs/research/2026-10-15-unscoped-search-recall.md.
  c_unscoped_ef_search constant text := '200';
  v_previous text;
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
    -- Unscoped: ranked on the half-precision HNSW index of each partition, merged
    -- by distance (document_chunks_embedding_halfvec_hnsw); the similarity returned is
    -- still computed at full precision for the rows kept. ef_search is set with
    -- set_config and restored afterwards, as in match_documents_feature_hnsw
    -- (NTER refuses a SET clause for it; see that function's comment).
    v_previous := current_setting('hnsw.ef_search', true);
    perform set_config('hnsw.ef_search', c_unscoped_ef_search, true);
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
    perform set_config('hnsw.ef_search', coalesce(nullif(v_previous, ''), '40'), true);
  else
    -- Feature, no ids: hybrid X, on the chunk's own feature (one partition). Count the
    -- feature's chunks, stopping at T + 1: that decides the path without counting all of a
    -- large feature.
    select count(*) into v_chunks
      from (select 1
              from public.document_chunks c
              join public.documents d on d.id = c.document_id
             where c.embedding is not null
               and d.indexed_at is not null
               and c.desk_feature = p_desk_feature
               and (p_desk_tier is null or c.desk_tier = p_desk_tier)
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
           and c.desk_feature = p_desk_feature
           and (p_desk_tier is null or c.desk_tier = p_desk_tier)
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

-- ---------------------------------------------------------------------------
-- The swap. ACCESS EXCLUSIVE on the old table from here to commit: renames and grants only.

do $$ begin raise notice 'document_chunks_partitioned phase: swap start %', clock_timestamp(); end $$;

lock table public.document_chunks in access exclusive mode;

alter table public.document_chunks rename to document_chunks_unpartitioned;
alter index public.document_chunks_pkey rename to document_chunks_unpartitioned_pkey;
alter index public.document_chunks_document_id_chunk_hash_key rename to document_chunks_unpartitioned_document_id_chunk_hash_key;
alter index public.document_chunks_document_order rename to document_chunks_unpartitioned_document_order;
alter index public.document_chunks_embedding_halfvec_hnsw rename to document_chunks_unpartitioned_embedding_halfvec_hnsw;

alter table public.document_chunks_partitioned rename to document_chunks;
alter index public.document_chunks_partitioned_document_order rename to document_chunks_document_order;
alter index public.document_chunks_partitioned_embedding_halfvec_hnsw rename to document_chunks_embedding_halfvec_hnsw;

-- The old table is for the rollback only: no role but its owner reaches it.
revoke all on table public.document_chunks_unpartitioned from public, anon, authenticated, service_role;
do $$
declare
  v_columns text;
begin
  select string_agg(quote_ident(attname), ', ' order by attnum) into v_columns
    from pg_attribute
   where attrelid = 'public.document_chunks_unpartitioned'::regclass and attnum > 0 and not attisdropped;
  execute format('revoke all (%s) on table public.document_chunks_unpartitioned from public, anon, authenticated, service_role', v_columns);
end
$$;

do $$ begin raise notice 'document_chunks_partitioned phase: swap done %', clock_timestamp(); end $$;

-- Statistics for the new table and each partition now (AGENTS.md: after a bulk load).
analyze public.document_chunks;

notify pgrst, 'reload schema';

commit;
