-- 210000: search_desk_rows learns date ranges and case, and the fields a module has (F197).
--
-- The D3 live round (docs/research/2026-10-15-d3-paid-live-round.md) asked "how many bills were
-- introduced in the Lok Sabha in 2026, how many assented?". The model called
--   search_desk_rows('national', 'Bill Passage Probability Index', null, '{"year":"2026","house":"Lok Sabha"}')
-- and answered 0 and 0 with "Strong" confidence. The rows have no `year` field - the year is in the
-- row's date - and the filter is containment (`row @> filters`), so an invented field matched
-- nothing, silently. The register holds 23 and 11. Three changes:
--
--   1. p_date_from / p_date_to (text, 'YYYY-MM-DD', both optional) bound the row's `date` column,
--      the one date every stored row has: src/lib/deskRows.js flattenRow fills `date` from the
--      first of the source's own date fields (date, date_introduced, seendate, pubDate, ...), so
--      for a bill it is the introduction date ("2026-08-09 19:00:00"). public.desk_row_date reads
--      the forms the loaded modules hold - ISO dates and timestamps, "YYYY-MM", a bare year
--      ("2026", "2022 (Feb 2022)") and "12-Jan-2026" - into an ISO prefix; anything else is
--      undated and is outside every range. A row dated only to the year or month is in a range
--      that overlaps it: "2026" is inside 2026-03-01..2026-04-30.
--   2. Filter values that match nothing exactly are tried once more without case and outer
--      spaces ("assented" finds "Assented"). Exact containment still runs first and alone decides
--      every call it answers, so the GIN index (desk_rows_row_gin, 082308) serves the ordinary
--      case unchanged; only a filter that matched no row pays for the second, unindexed pass.
--      A column whose values differ only in case would count only the exact-case rows when any
--      exist; the loaded modules have no such column (checked on the local packs, 2026-10-15).
--   3. public.desk_row_fields(tier, feature) returns the fields the scope's rows carry, how many
--      rows it has and how many are dated. The edge function calls it only when a search with
--      filters or a date range returns no row, to tell an unknown field (an error the model sees,
--      listing the real fields) from a true zero. A search that returns rows needs no check:
--      containment cannot match a field a row does not have.
--
-- The WHERE stays assembled per call from literal fragments (082308), with every caller value
-- passed through USING; the date fragment is one more literal. Nothing a user or the model types
-- is parsed as SQL. The signature gains two parameters, so the old five-argument function is
-- dropped first: two overloads with defaults would make PostgREST's choice ambiguous. Every
-- existing caller (the edge function, src/shell/commandSearch.js) names its five arguments and
-- resolves to the new function unchanged.
--
-- Down (manual):
--   drop function if exists public.desk_row_fields(text, text);
--   drop function if exists public.search_desk_rows(text, text, text, jsonb, int, text, text);
--   drop function if exists public.desk_row_date_in(text, text, text);
--   drop function if exists public.desk_row_date(text);
--   then run supabase/migrations/20260922082308_desk_rows_search_optional_predicates.sql's
--   create function, revoke and grant for public.search_desk_rows(text, text, text, jsonb, int).

-- The ISO prefix of a stored date: 'YYYY-MM-DD', 'YYYY-MM', 'YYYY', or null when undated.
create or replace function public.desk_row_date(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $fn$
  select case
    when p_value ~ '^\s*\d{4}-\d{2}-\d{2}' then substring(p_value from '^\s*(\d{4}-\d{2}-\d{2})')
    when p_value ~ '^\s*\d{4}-\d{2}(\D|$)' then substring(p_value from '^\s*(\d{4}-\d{2})')
    when p_value ~ '^\s*\d{4}(\D|$)' then substring(p_value from '^\s*(\d{4})')
    when p_value ~* '^\s*\d{1,2}[- ](jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[- ,]+\d{4}' then (
      select m[3] || '-'
          || lpad(((strpos('janfebmaraprmayjunjulaugsepoctnovdec', lower(m[2])) + 2) / 3)::text, 2, '0') || '-'
          || lpad(m[1], 2, '0')
        from regexp_match(p_value, '^\s*(\d{1,2})[- ]([A-Za-z]{3})[A-Za-z]*[- ,]+(\d{4})') m
    )
  end
$fn$;

-- Whether a stored date falls in [p_from, p_to] (each 'YYYY-MM-DD' or null for open), compared at
-- the stored date's own precision.
create or replace function public.desk_row_date_in(p_value text, p_from text, p_to text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $fn$
  select d is not null
     and (p_from is null or d >= left(p_from, length(d)))
     and (p_to   is null or d <= left(p_to,   length(d)))
    from (select public.desk_row_date(p_value) as d) s
$fn$;

drop function if exists public.search_desk_rows(text, text, text, jsonb, int);

create or replace function public.search_desk_rows(
  p_tier      text,
  p_feature   text  default null,
  p_query     text  default null,
  p_filters   jsonb default '{}'::jsonb,
  p_limit     int   default 20,
  p_date_from text  default null,
  p_date_to   text  default null
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
  -- Every fragment below is a literal written here, never caller input. The caller's values reach
  -- the statement only through USING, so nothing a user or the model types is ever parsed as SQL.
  conds   text[] := array['r.tier = $1'];
  lim     int    := least(greatest(coalesce(p_limit, 20), 1), 50);
  filters boolean := coalesce(p_filters, '{}'::jsonb) <> '{}'::jsonb;
  q       text   := $q$
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
  $q$;
begin
  if p_date_from is not null and p_date_from !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'search_desk_rows: p_date_from must be YYYY-MM-DD' using errcode = '22007';
  end if;
  if p_date_to is not null and p_date_to !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'search_desk_rows: p_date_to must be YYYY-MM-DD' using errcode = '22007';
  end if;

  if p_feature is not null                         then conds := conds || 'r.feature = $2'::text; end if;
  if coalesce(p_query, '') <> ''                   then conds := conds || 'r.record_text ilike ''%'' || $3 || ''%'''::text; end if;
  if p_date_from is not null or p_date_to is not null then
    conds := conds || 'public.desk_row_date_in(r.row ->> ''date'', $6, $7)'::text;
  end if;

  if filters then
    -- Exact containment first: indexed, and the answer whenever it finds anything.
    return query execute format(q, array_to_string(conds || 'r.row @> $4'::text, ' and '))
      using p_tier, p_feature, p_query, p_filters, lim, p_date_from, p_date_to;
    if found then
      return;
    end if;
    -- Nothing matched exactly: the same filters once more without case or outer spaces. A field
    -- the row does not have never matches (null is distinct from every value).
    conds := conds || $c$not exists (
        select 1 from jsonb_each_text($4) f
         where lower(btrim(r.row ->> f.key)) is distinct from lower(btrim(f.value)))$c$::text;
  end if;

  return query execute format(q, array_to_string(conds, ' and '))
    using p_tier, p_feature, p_query, p_filters, lim, p_date_from, p_date_to;
end
$fn$;

-- The fields a desk scope's rows carry, with its row count and how many rows have a readable date.
-- Called only after a filtered or dated search found nothing (see the header).
create or replace function public.desk_row_fields(p_tier text, p_feature text default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $fn$
declare
  result jsonb;
begin
  if p_feature is null then
    select jsonb_build_object(
             'rows',   count(*),
             'dated',  count(*) filter (where public.desk_row_date(r.row ->> 'date') is not null),
             'fields', coalesce((select jsonb_agg(k order by k)
                                   from (select distinct jsonb_object_keys(x.row) as k
                                           from public.desk_rows x
                                          where x.tier = p_tier) keys), '[]'::jsonb))
      into result
      from public.desk_rows r
     where r.tier = p_tier;
  else
    select jsonb_build_object(
             'rows',   count(*),
             'dated',  count(*) filter (where public.desk_row_date(r.row ->> 'date') is not null),
             'fields', coalesce((select jsonb_agg(k order by k)
                                   from (select distinct jsonb_object_keys(x.row) as k
                                           from public.desk_rows x
                                          where x.tier = p_tier and x.feature = p_feature) keys), '[]'::jsonb))
      into result
      from public.desk_rows r
     where r.tier = p_tier and r.feature = p_feature;
  end if;
  return result;
end
$fn$;

revoke all on function public.desk_row_date(text) from public, anon;
revoke all on function public.desk_row_date_in(text, text, text) from public, anon;
revoke all on function public.search_desk_rows(text, text, text, jsonb, int, text, text) from public, anon;
revoke all on function public.desk_row_fields(text, text) from public, anon;
grant execute on function public.desk_row_date(text) to authenticated, service_role;
grant execute on function public.desk_row_date_in(text, text, text) to authenticated, service_role;
grant execute on function public.search_desk_rows(text, text, text, jsonb, int, text, text) to authenticated, service_role;
grant execute on function public.desk_row_fields(text, text) to authenticated, service_role;
