-- Status: Normative. F201: period overlap over existing handbook rows; no data writes/reload.
-- Exact JSON year filters remain exact. Only state handbook keys use the new helper.
create function public.handbook_period_in(p_row jsonb, p_from text, p_to text)
returns boolean language plpgsql immutable security invoker set search_path = ''
as $$
declare
  parts text[];
  first_year integer;
  last_year integer;
  period_start date;
  period_end date;
begin
  parts := regexp_match(p_row ->> 'year', '^(19[0-9]{2}|20[0-9]{2})(?:-([0-9]{2}|[0-9]{4}))?$');
  if parts is null then return public.desk_row_date_in(p_row ->> 'date', p_from, p_to); end if;
  first_year := parts[1]::integer;
  last_year := first_year;
  if parts[2] is not null then
    last_year := parts[2]::integer;
    if length(parts[2]) = 2 then
      last_year := first_year / 100 * 100 + last_year;
      if last_year <= first_year then last_year := last_year + 100; end if;
    end if;
  end if;
  if p_row ->> 'period' = 'financial year' and last_year = first_year + 1 then
    period_start := make_date(first_year, 4, 1);
    period_end := make_date(last_year, 3, 31);
  elsif p_row ->> 'period' = 'calendar year' and parts[2] is null then
    period_start := make_date(first_year, 1, 1);
    period_end := make_date(first_year, 12, 31);
  elsif p_row ->> 'period' = 'period of years' and last_year > first_year and last_year <= first_year + 10 then
    period_start := make_date(first_year, 1, 1);
    period_end := make_date(last_year, 12, 31);
  else
    return public.desk_row_date_in(p_row ->> 'date', p_from, p_to);
  end if;
  return (p_from is null or p_from::date <= period_end)
     and (p_to is null or p_to::date >= period_start);
end;
$$;
revoke all on function public.handbook_period_in(jsonb,text,text) from public, anon;
grant execute on function public.handbook_period_in(jsonb,text,text) to authenticated, service_role;

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
    conds := conds || 'case when r.row_key like ''hb:t%'' and r.tier = ''state'' then public.handbook_period_in(r.row, $6, $7) else public.desk_row_date_in(r.row ->> ''date'', $6, $7) end'::text;
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

-- Down (manual):
-- create or replace function public.search_desk_rows(
--   p_tier      text,
--   p_feature   text  default null,
--   p_query     text  default null,
--   p_filters   jsonb default '{}'::jsonb,
--   p_limit     int   default 20,
--   p_date_from text  default null,
--   p_date_to   text  default null
-- ) returns table (
--   tier         text,
--   feature      text,
--   row_key      text,
--   "row"        jsonb,
--   record_text  text,
--   document_key text,
--   snapshot_at  timestamptz,
--   total        bigint
-- )
-- language plpgsql
-- stable
-- security invoker
-- set search_path = public
-- as $fn$
-- declare
--   -- Every fragment below is a literal written here, never caller input. The caller's values reach
--   -- the statement only through USING, so nothing a user or the model types is ever parsed as SQL.
--   conds   text[] := array['r.tier = $1'];
--   lim     int    := least(greatest(coalesce(p_limit, 20), 1), 50);
--   filters boolean := coalesce(p_filters, '{}'::jsonb) <> '{}'::jsonb;
--   q       text   := $q$
--     with keys as (
--       select r.tier, r.feature, r.row_key
--         from public.desk_rows r
--        where %s
--     ), page as (
--       select k.tier, k.feature, k.row_key, count(*) over () as total
--         from keys k
--        order by k.feature, k.row_key
--        limit $5
--     )
--     select d.tier, d.feature, d.row_key, d.row, d.record_text, d.document_key, d.snapshot_at, p.total
--       from page p
--       join public.desk_rows d
--         on d.tier = p.tier and d.feature = p.feature and d.row_key = p.row_key
--      order by d.feature, d.row_key
--   $q$;
-- begin
--   if p_date_from is not null and p_date_from !~ '^\d{4}-\d{2}-\d{2}$' then
--     raise exception 'search_desk_rows: p_date_from must be YYYY-MM-DD' using errcode = '22007';
--   end if;
--   if p_date_to is not null and p_date_to !~ '^\d{4}-\d{2}-\d{2}$' then
--     raise exception 'search_desk_rows: p_date_to must be YYYY-MM-DD' using errcode = '22007';
--   end if;
-- 
--   if p_feature is not null                         then conds := conds || 'r.feature = $2'::text; end if;
--   if coalesce(p_query, '') <> ''                   then conds := conds || 'r.record_text ilike ''%'' || $3 || ''%'''::text; end if;
--   if p_date_from is not null or p_date_to is not null then
--     conds := conds || 'public.desk_row_date_in(r.row ->> ''date'', $6, $7)'::text;
--   end if;
-- 
--   if filters then
--     -- Exact containment first: indexed, and the answer whenever it finds anything.
--     return query execute format(q, array_to_string(conds || 'r.row @> $4'::text, ' and '))
--       using p_tier, p_feature, p_query, p_filters, lim, p_date_from, p_date_to;
--     if found then
--       return;
--     end if;
--     -- Nothing matched exactly: the same filters once more without case or outer spaces. A field
--     -- the row does not have never matches (null is distinct from every value).
--     conds := conds || $c$not exists (
--         select 1 from jsonb_each_text($4) f
--          where lower(btrim(r.row ->> f.key)) is distinct from lower(btrim(f.value)))$c$::text;
--   end if;
-- 
--   return query execute format(q, array_to_string(conds, ' and '))
--     using p_tier, p_feature, p_query, p_filters, lim, p_date_from, p_date_to;
-- end
-- $fn$;
-- drop function public.handbook_period_in(jsonb,text,text);
