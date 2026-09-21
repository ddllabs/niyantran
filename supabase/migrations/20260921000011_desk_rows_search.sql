-- 0011: desk-row grounding — document_key on desk rows, search_desk_rows.
-- Spec: docs/specs/2026-09-20-desk-row-grounding-design.md §B, Decision 5,
-- and its plan amendments of 2026-09-21.
-- Plan: docs/plans/2026-09-21-desk-row-grounding.md Task 4.
--
-- desk_rows (migration 0003) holds the rows the desk shows, loaded by
-- scripts/load-desk-rows.mjs. document_key joins a bill row to the corpus
-- document that carries the same key in documents.metadata; the agent loop
-- uses it to scope a document search to the bill the user is looking at.
--
-- Down (manual):
--   drop function if exists public.search_desk_rows(text, text, text, jsonb, int);
--   drop index if exists public.documents_document_key;
--   drop index if exists public.desk_rows_feature;
--   drop index if exists public.desk_rows_document_key;
--   alter table public.desk_rows drop column if exists document_key;

alter table public.desk_rows add column if not exists document_key text;

create index if not exists desk_rows_document_key
  on public.desk_rows (document_key) where document_key is not null;
create index if not exists desk_rows_feature
  on public.desk_rows (tier, feature);

-- The only consumer of documents.metadata->>'document_key' is this module's
-- Decision 5 (row key → documents.id), so the expression index lives here.
create index if not exists documents_document_key
  on public.documents ((metadata->>'document_key'));

-- Filters and counts over desk rows. p_query is bound, never concatenated by
-- the caller; p_filters is a JSON object of column = value pairs applied
-- with containment, so a value is never interpreted as SQL. total is the
-- true count before the limit; the limit is clamped to 1..50.
create or replace function public.search_desk_rows(
  p_tier    text,
  p_feature text  default null,
  p_query   text  default null,
  p_filters jsonb default '{}'::jsonb,
  p_limit   int   default 20
) returns table (
  tier         text,
  feature      text,
  row_key      text,
  "row"        jsonb,        -- reserved word; the column is still returned as `row`
  record_text  text,
  document_key text,
  snapshot_at  timestamptz,
  total        bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with matched as (
    select r.*
    from public.desk_rows r
    where r.tier = p_tier
      and (p_feature is null or r.feature = p_feature)
      and (p_query is null or p_query = '' or r.record_text ilike '%' || p_query || '%')
      and (p_filters is null or p_filters = '{}'::jsonb or r.row @> p_filters)
  )
  select m.tier, m.feature, m.row_key, m.row, m.record_text, m.document_key, m.snapshot_at,
         count(*) over () as total
  from matched m
  order by m.feature, m.row_key
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;

-- Any signed-in user may search (desk_rows_read applies under security
-- invoker); anon has no policy and no execute grant.
revoke all on function public.search_desk_rows(text, text, text, jsonb, int) from public, anon;
grant execute on function public.search_desk_rows(text, text, text, jsonb, int) to authenticated, service_role;
