-- Local retrieval replica (docs/specs/2026-09-30-rag-v2-retrieval-scope.md,
-- "The local replica"; plan task T6). A minimal schema, not the migration chain:
-- only what match_documents reads, the roles it runs as, and the RLS it runs under.
-- Applied by scripts/eval-replica/load.mjs to database niyantran_retrieval_replica in
-- the niyantran-corpus-test-db container, never to a hosted project.
\set ON_ERROR_STOP on

create schema if not exists extensions;
create extension if not exists vector with schema extensions;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
-- Signed-in users on NTER run under an 8 s statement timeout (pg_roles.rolconfig, 2026-09-30).
alter role authenticated set statement_timeout = '8s';
grant usage on schema public, extensions to anon, authenticated, service_role;

-- documents: the columns match_documents and the eval harness read. No ocr_text.
create table public.documents (
  id              uuid primary key,
  title           text not null,
  file_name       text,
  file_url        text,
  desk_tier       text,
  desk_feature    text,
  content_sha256  text,
  indexed_at      timestamptz,
  metadata        jsonb not null default '{}'
);
create index documents_desk on public.documents (desk_tier, desk_feature);
create index documents_document_key on public.documents ((metadata->>'document_key'));

create table public.document_chunks (
  id               uuid primary key,
  document_id      uuid not null references public.documents(id) on delete cascade,
  chunk_hash       text not null,
  chunk_index      int  not null,
  source_kind      text not null,
  page_number      int,
  char_from        int  not null,
  char_to          int  not null,
  content          text not null,
  token_count      int,
  embedding        extensions.vector(1536),
  chunker_version  int  not null,
  metadata         jsonb not null default '{}',
  created_at       timestamptz,
  unique (document_id, chunk_hash)
);
create index document_chunks_document_order on public.document_chunks (document_id, chunk_index);
-- The halfvec HNSW index is built after the load (index.sql), as on NTER.

alter table public.documents enable row level security;
alter table public.document_chunks enable row level security;
create policy documents_read on public.documents for select to authenticated using (true);
create policy document_chunks_read on public.document_chunks for select to authenticated using (true);
grant select on public.documents, public.document_chunks to authenticated;
grant select, insert, update, delete on public.documents, public.document_chunks to service_role;
revoke all on public.documents, public.document_chunks from anon;

-- What the eval fingerprint reads on the replica.
create table public.replica_meta (
  source_project    text not null,
  source_migration  text not null,
  copied_at         timestamptz not null,
  doc_count         int not null,
  chunk_count       int not null
);
grant select on public.replica_meta to authenticated, service_role;
