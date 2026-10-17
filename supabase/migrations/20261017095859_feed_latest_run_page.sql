-- Status: Normative. F160: paginate the current run without scanning historical pages.
-- Public readers have no execute grant. The service caller pins p_run_at across pages;
-- a refreshed/disabled state returns NULL instead of a mixed snapshot. Same 60 s timestamp
-- tolerance as server/feedServe.mjs, for existing rows written at nearby instants.
create function public.feed_latest_run_page(
  p_tier text, p_feature text, p_variant text, p_limit integer, p_offset integer, p_run_at timestamptz
) returns jsonb
language sql stable security definer set search_path = ''
as $$
  with state as (
    select * from public.feed_state s
     where s.tier = p_tier and s.feature = p_feature and s.variant = coalesce(p_variant, '')
       and s.serve and s.fetched_at = p_run_at
  ), current_items as materialized (
    select f.* from public.feed_items f join state s using (tier, feature, variant)
     where f.last_seen >= s.fetched_at - interval '60 seconds'
  ), page as (
    select * from current_items f order by f.position, f.item_key
     limit least(greatest(coalesce(p_limit, 50), 1), 500)
     offset least(greatest(coalesce(p_offset, 0), 0), 10000)
  )
  select jsonb_build_object(
    'tier', s.tier, 'feature', s.feature, 'variant', s.variant, 'class', s.class, 'kind', s.kind,
    'serve', s.serve, 'fetched_at', s.fetched_at, 'checked_at', s.checked_at, 'changed_at', s.changed_at,
    'interval_minutes', s.interval_minutes, 'consecutive_failures', s.consecutive_failures,
    'last_error', s.last_error, 'meta', s.meta, 'total', (select count(*) from current_items),
    'items', coalesce((select jsonb_agg(jsonb_build_object('item_key', f.item_key, 'row', f.row,
      'published_at', f.published_at, 'first_seen', f.first_seen, 'last_seen', f.last_seen)
      order by f.position, f.item_key) from page f), '[]'::jsonb))
  from state s;
$$;
revoke all on function public.feed_latest_run_page(text,text,text,integer,integer,timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.feed_latest_run_page(text,text,text,integer,integer,timestamptz) to service_role;

-- Down (manual):
-- drop function public.feed_latest_run_page(text,text,text,integer,integer,timestamptz);
