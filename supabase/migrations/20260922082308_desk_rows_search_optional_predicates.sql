-- 082308: every optional parameter of search_desk_rows becomes indexable.
--
-- 073933 fixed one of three. The same defect held for the other two, and the
-- function also carried the whole 1.6 KB row through a window it did not need:
--
--   and (p_feature is null or r.feature = p_feature)          -- desk_rows_feature unused
--   and (p_query   is null or ... ilike ...)                  -- fixed in 073933
--   and (p_filters is null or ... r.row @> p_filters)         -- desk_rows_row_gin unused
--
-- Why one fix did not generalise. A `set search_path` SQL function cannot be
-- inlined, so this body is planned once, generically, with all five parameters
-- unknown. A disjunction whose other branch does not mention the column forces
-- a plan that must also work when the parameter is null - and no index can
-- serve "return everything". 073933 removed that for p_query by folding the
-- null case into the pattern. There is no equivalent fold for `feature = $2`
-- or `row @> $4`: `coalesce(p_feature, r.feature)` puts a column on both sides
-- and is not indexable either.
--
-- So the WHERE is now assembled per call from fragments and the absent ones
-- are simply not there, which is the ordinary answer to optional predicates in
-- PostgreSQL. Each call is planned for the shape it actually has. EXECUTE does
-- not cache, so there is no custom-vs-generic plan lottery to lose later; the
-- cost is ~1.5 ms of planning per call against the hundreds of ms below.
--
-- On safety: every fragment is a literal written in this file, and all five
-- caller values still arrive through USING. Nothing a user or the model types
-- is parsed as SQL - the same guarantee 0011 made, by the same mechanism.
-- Verified after applying: anon is denied the function AND the table,
-- `authenticated` gets its rows, and the function is still SECURITY INVOKER,
-- STABLE, search_path=public, executable only by authenticated/service_role.
-- RLS is untouched (dynamic SQL under SECURITY INVOKER is still subject to it).
--
-- The second change is the narrow `keys` CTE. `total` is a documented feature
-- of this tool - it advertises "the true total" and renders "TOTAL: n rows
-- match" to the model - so `count(*) over ()` must still see every match. It
-- does not need the payload to count. Selecting only the primary key through
-- the window makes it an Index Only Scan on desk_rows_pkey, and the wide
-- columns are fetched by primary key for the <= 50 rows actually returned.
-- The 46 MB of temp spill the old shape produced is gone with it.
--
-- Measured before/after on the live instance, three interleaved rounds
-- (best-worst ms), `national`:
--
--   null query, no feature       621-1127  ->   15-42   Index Only Scan
--   null query, 6-row feature    430-461   ->  0.6-1.5  feature predicate now indexed
--   jsonb filter, no query       510-857   ->   40-45   desk_rows_row_gin now used
--   2-char query                 499-713   ->  297-420  no trigram; narrower, still scans
--   trigram query                 24-26    ->   18-20
--
-- Equivalence: 20 parameter shapes compared on full content (row jsonb,
-- record_text, document_key, snapshot_at and total) - all identical; then 160
-- tier x feature x query combinations, 2,071 rows, compared position by
-- position, because renderDeskRows assigns citation handles by position and a
-- reordering would silently remap every citation. All identical.
--
-- Still true after this: a one- or two-character query has no trigram and
-- scans (~300 ms, and it matches so much that the answer is noise anyway), and
-- Heap Fetches was 1,961 on the index-only scan, so a VACUUM would take a bit
-- more off - it cannot run inside a migration.
--
-- Down (manual): restore the body from
-- supabase/migrations/20260922073933_desk_rows_search_uses_trigram.sql. The
-- signature, return type, volatility and grants are unchanged, so nothing else
-- needs undoing.

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
  "row"        jsonb,
  record_text  text,
  document_key text,
  snapshot_at  timestamptz,
  total        bigint
)
language plpgsql
stable
security invoker
set search_path = public
as $fn$
declare
  -- Every fragment below is a literal written here, never caller input. The
  -- caller's five values reach the statement only through USING, so nothing a
  -- user or the model types is ever parsed as SQL.
  conds text[] := array['r.tier = $1'];
begin
  if p_feature is not null                           then conds := conds || 'r.feature = $2'::text; end if;
  if coalesce(p_query, '') <> ''                     then conds := conds || 'r.record_text ilike ''%'' || $3 || ''%'''::text; end if;
  if coalesce(p_filters, '{}'::jsonb) <> '{}'::jsonb then conds := conds || 'r.row @> $4'::text; end if;

  return query execute format($q$
    with keys as (
      select r.tier, r.feature, r.row_key
        from public.desk_rows r
       where %s
    ), page as (
      select k.tier, k.feature, k.row_key, count(*) over () as total
        from keys k
       order by k.feature, k.row_key
       limit $5
    )
    select d.tier, d.feature, d.row_key, d.row, d.record_text, d.document_key, d.snapshot_at, p.total
      from page p
      join public.desk_rows d
        on d.tier = p.tier and d.feature = p.feature and d.row_key = p.row_key
     order by d.feature, d.row_key
  $q$, array_to_string(conds, ' and '))
  using p_tier, p_feature, p_query, p_filters, least(greatest(coalesce(p_limit, 20), 1), 50);
end
$fn$;

revoke all on function public.search_desk_rows(text, text, text, jsonb, int) from public, anon;
grant execute on function public.search_desk_rows(text, text, text, jsonb, int) to authenticated, service_role;

-- search_desk_rows_v2 was the throwaway the before/after comparison ran
-- against. Dropped here so a rebuilt database never carries it.
drop function if exists public.search_desk_rows_v2(text, text, text, jsonb, int);
