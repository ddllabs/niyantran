-- 073933: let search_desk_rows reach the trigram index 073820 built for it.
--
-- 073820 created desk_rows_record_text_trgm and measured the raw predicate at
-- 35 ms (Bitmap Index Scan, 1288 buffers). The function kept taking 560 ms
-- over 14,701 buffers, because of this line:
--
--   and (p_query is null or p_query = '' or r.record_text ilike '%' || p_query || '%')
--
-- Two of those three branches do not mention the column at all, so the planner
-- has to produce a plan that returns every row when p_query is null. No index
-- can serve that, and the whole disjunction falls back to a sequential scan -
-- for every call, including the ones that do pass a query.
--
-- The rewrite folds the null and empty cases into the pattern instead of into
-- the boolean:
--
--   and r.record_text ilike '%' || coalesce(p_query, '') || '%'
--
-- which is one indexable predicate in all three cases. The result set does not
-- move: desk_rows.record_text is NOT NULL (checked: 0 nulls in 34,184 rows), so
-- `record_text ilike '%%'` is true for exactly the rows `p_query is null` used
-- to admit. When p_query is null the pattern has no trigrams, pg_trgm reports
-- it cannot help, and the planner picks the sequential scan on its own - which
-- is the right plan for a filter that matches everything.
--
-- Unchanged on purpose: p_query is still concatenated into the pattern, so `%`
-- and `_` inside a caller's query remain wildcards exactly as before. That is
-- pre-existing behaviour the tool relies on, not something this migration is
-- deciding; p_query is still bound, never interpolated as SQL.
--
-- Still open: `(p_filters is null or p_filters = '{}'::jsonb or r.row @> p_filters)`
-- has the identical defect and keeps desk_rows_row_gin unused. It is left alone
-- here because the desk's filter path is not what is failing, and folding it
-- would need its own proof that `row` is always a non-null object.
--
-- Down (manual): re-create the function with the disjunction from migration
-- 0011 (supabase/migrations/20260921000011_desk_rows_search.sql). Nothing else
-- in this migration needs undoing - the signature, grants and return type are
-- unchanged.

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
      and r.record_text ilike '%' || coalesce(p_query, '') || '%'
      and (p_filters is null or p_filters = '{}'::jsonb or r.row @> p_filters)
  )
  select m.tier, m.feature, m.row_key, m.row, m.record_text, m.document_key, m.snapshot_at,
         count(*) over () as total
  from matched m
  order by m.feature, m.row_key
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;

-- create or replace preserves grants, but 0011's least-privilege stance is
-- restated so this file is readable on its own and a future `create` (rather
-- than `replace`) cannot silently widen access.
revoke all on function public.search_desk_rows(text, text, text, jsonb, int) from public, anon;
grant execute on function public.search_desk_rows(text, text, text, jsonb, int) to authenticated, service_role;
