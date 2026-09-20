-- 0003: document corpus, chunk embeddings, desk row snapshot — global, read by every user.
-- Spec: docs/specs/2026-09-20-ai-backend-foundation-design.md §B; ADRs 0003, 0004.
-- Plan: docs/plans/2026-09-21-ai-backend-foundation.md Task 3.
-- The RPCs over these tables (match_documents, chunk_commit, search_desk_rows)
-- belong to the document-rag-and-citations and desk-row-grounding modules.
--
-- Down (manual):
--   drop table if exists public.desk_rows, public.document_chunks, public.documents;

create table public.documents (
  id               uuid primary key default gen_random_uuid(),
  source_key       text not null unique,      -- Niyantran's stable file identity
  title            text not null,
  file_name        text,
  file_url         text,
  desk_tier        text,                      -- 'national' | 'law' | …
  desk_feature     text,                      -- module name when known
  content_sha256   text not null,             -- of ocr_text
  ocr_text         text not null,             -- the text itself lives here (owner decision)
  page_count       int,                       -- null until page-wise Markdown exists
  chunker_version  int,
  indexed_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index documents_desk on public.documents (desk_tier, desk_feature);

create trigger documents_updated_at
  before update on public.documents
  for each row execute function public.update_updated_at_column();

create table public.document_chunks (
  id               uuid primary key default gen_random_uuid(),
  document_id      uuid not null references public.documents(id) on delete cascade,
  chunk_hash       text not null,
  chunk_index      int  not null,
  source_kind      text not null default 'document' check (source_kind in ('document', 'pdf_page')),
  page_number      int,                                -- nullable anchor
  char_from        int  not null,
  char_to          int  not null,
  content          text not null,                      -- exactly ocr_text[char_from:char_to]
  token_count      int,
  embedding        extensions.vector(1536),
  chunker_version  int  not null,
  metadata         jsonb not null default '{}',
  created_at       timestamptz not null default now(),
  unique (document_id, chunk_hash)
);
create index document_chunks_embedding_hnsw
  on public.document_chunks using hnsw (embedding extensions.vector_cosine_ops);
create index document_chunks_document_order
  on public.document_chunks (document_id, chunk_index);

create table public.desk_rows (
  tier         text not null,
  feature      text not null,
  row_key      text not null,
  row          jsonb not null,
  record_text  text not null,           -- flattened columns for text search
  snapshot_at  timestamptz not null,
  loaded_at    timestamptz not null default now(),
  primary key (tier, feature, row_key)
);
create index desk_rows_row_gin on public.desk_rows using gin (row jsonb_path_ops);

-- RLS: every signed-in user may read; only the service role writes. anon gets nothing.
alter table public.documents       enable row level security;
alter table public.document_chunks enable row level security;
alter table public.desk_rows       enable row level security;

create policy documents_read       on public.documents       for select to authenticated using (true);
create policy document_chunks_read on public.document_chunks for select to authenticated using (true);
create policy desk_rows_read       on public.desk_rows       for select to authenticated using (true);

grant select on public.documents, public.document_chunks, public.desk_rows to authenticated;
revoke all on public.documents, public.document_chunks, public.desk_rows from anon;
