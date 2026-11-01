-- What the live search path needs from the schema beyond schema.sql's base tables, added as
-- idempotent statements so the same file serves a fresh load and a replica that already holds
-- data (load.mjs applies it in both, and in --functions-only). Run it through load.mjs, not by
-- hand: the line marked @@LAW_DOCUMENT_IS_PUBLISHED@@ is replaced with the function's text from
-- its migration. Applied only to niyantran_retrieval_replica, never to a hosted project.
--
-- Why each piece exists (all checked against supabase/migrations on 2026-11-01):
--
--  * document_chunks.block_ids, image_ids: 20261001120000_page_contract.sql added them, and
--    match_documents (20261015130000) and match_documents_feature_hnsw (20261027185840) return
--    them. Without the columns every call fails at run time ("column c.block_ids does not exist").
--  * documents.source_key (text, unique): read by the restrictive policy law_documents_serving
--    below. Live: `source_key text not null unique` (20260921000003). The upgrade path adds it
--    nullable, because a replica loaded before this change has no values for it; load.mjs --resume
--    fills it.
--  * The law_* tables, their RLS, the function law_document_is_published and the restrictive
--    policies law_documents_serving and law_chunks_serving (20261023184450_law_listing_publication.sql).
--    Every `authenticated` read of document_chunks and documents runs these on live: a chunk row is
--    visible only if its document is, and a supplied-text NCLT document is visible only once its
--    law record is published, while law_listing_settings.active is true. They change what search
--    returns when the listing is active, and add a per-row probe to every search, so a replica
--    without them measures a faster, differently-filtered search than production. Only the columns
--    the policies read are kept: law_records(id, visible), law_document_links(document_id,
--    record_id), law_listing_settings(singleton, seeded, active). load.mjs copies the rows.
--
-- Not replicated, because no search function reads it: document_chunks.embed_hash,
-- documents.file_sha256 and the other live indexes on documents (20261001160000,
-- 20261027231901), the policies on document_pages, document_page_blocks, document_page_images
-- and desk_rows (also in 20261023184450), ingest_* tables.
\set ON_ERROR_STOP on

-- replica_meta records how the replica was built (load.mjs finish): the load mode, NTER's row counts
-- at the end of the load and the replica's own, so a resumed or short replica is never mistaken for a
-- complete one. Added here, not in schema.sql, so a replica created before this change gets them too.
alter table public.replica_meta add column if not exists load_mode text;
alter table public.replica_meta add column if not exists source_counts jsonb;
alter table public.replica_meta add column if not exists replica_counts jsonb;
alter table public.replica_meta add column if not exists counts_match boolean;

alter table public.document_chunks add column if not exists block_ids uuid[];
alter table public.document_chunks add column if not exists image_ids uuid[];

alter table public.documents add column if not exists source_key text;
create unique index if not exists documents_source_key_key on public.documents (source_key);

create table if not exists public.law_listing_settings (
  singleton boolean primary key default true check (singleton),
  seeded    boolean not null default false,
  active    boolean not null default false
);
insert into public.law_listing_settings values (true, false, false) on conflict do nothing;
create table if not exists public.law_records (
  id      uuid primary key,
  visible boolean not null default true
);
create table if not exists public.law_document_links (
  document_id uuid primary key references public.documents(id),
  record_id   uuid not null references public.law_records(id)
);
create index if not exists law_document_links_record on public.law_document_links (record_id);

alter table public.law_listing_settings enable row level security;
alter table public.law_records enable row level security;
alter table public.law_document_links enable row level security;
revoke all on public.law_listing_settings, public.law_records, public.law_document_links from public, anon, authenticated;
grant select on public.law_listing_settings, public.law_records to anon, authenticated;
grant select on public.law_document_links to authenticated;
grant select, insert, update, delete on public.law_listing_settings, public.law_records, public.law_document_links to service_role;

drop policy if exists law_settings_read on public.law_listing_settings;
create policy law_settings_read on public.law_listing_settings for select to anon, authenticated using (true);
drop policy if exists law_records_read on public.law_records;
create policy law_records_read on public.law_records for select to anon, authenticated
  using (visible and exists (select 1 from public.law_listing_settings where active));
drop policy if exists law_links_read on public.law_document_links;
create policy law_links_read on public.law_document_links for select to authenticated
  using (exists (select 1 from public.law_records r where r.id = record_id));

-- @@LAW_DOCUMENT_IS_PUBLISHED@@

drop policy if exists law_documents_serving on public.documents;
create policy law_documents_serving on public.documents as restrictive for select to authenticated using (
  not (starts_with(source_key, 'law:trib:IBBI_NCLT:') and metadata->>'origin' = 'supplied-text')
  or not exists (select 1 from public.law_listing_settings where active)
  or public.law_document_is_published(id));
drop policy if exists law_chunks_serving on public.document_chunks;
create policy law_chunks_serving on public.document_chunks as restrictive for select to authenticated using (
  exists (select 1 from public.documents d where d.id = document_id));
