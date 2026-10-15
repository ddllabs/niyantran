-- One read for a register module's first page across its variants, a register never shown as
-- stale, and a register variant made due for a reload (open-work F169 phase 4; owner decision C6, option 1: MLA Directory's register as 31 store
-- variants, one per state, never refreshed by the timer; server/feedSchedule.mjs FEED_REGISTERS).
--
-- 20261015150000_feed_records.sql and 20261015160000_feed_admin.sql are applied to NTER and are not
-- edited; this adds to them.
--
--   * feed_page_across(p_tier, p_feature, p_per_variant)       service_role
--       One call in place of one feed_page per variant (the page asks for a register module with no
--       state: server/feedServe.mjs registerAcross). For the module's variants in feed_state:
--         variants     how many there are, and served how many have serve on; all_served when all do
--         fetched_at   the newest fetched_at among them; total the sum of their item_count
--         pages        only when all_served (otherwise the caller answers live and needs none): one
--                      entry per variant, ordered by variant, with its class, kind, serve, fetched_at,
--                      interval_minutes, meta, total and its first p_per_variant items, in the order
--                      feed_page gives them (the same ordering expression, copied: latest, reference
--                      and measurement by position; official, news and events by sort_at desc, then
--                      position, then item_key). Each item has feed_page's fields.
--       p_per_variant is clamped to 1..100 (null counts as 1). Null for a module with no variant.
--   * feed_make_due(p_tier, p_feature, p_variant)              service_role
--       Makes one register variant due now, so scripts/load-feed-register.mjs --force can reload a
--       register (a bad load corrected) before its 30-day interval ends. Only a row of class
--       'register', and only when no run holds a lease on it (lease_token null; a lease that has
--       ended is cleared by the next feed_claim_due first). Returns true when it set next_due_at,
--       false otherwise (no such variant, not a register, or leased). Nothing else changes. A
--       scheduled module cannot be made due: the timer alone decides when it runs.
--   * feed_admin_status()                                      authenticated, admins only
--       Replaced with one change: a row of class 'register' (how scripts/load-feed-register.mjs
--       stores a register variant: server/feedSchedule.mjs REGISTER_CLASS) is never stale. A register
--       is loaded by a script and stays valid until loaded again, so its age is not a fault. Every other
--       column and row, and every other module's stale rule, is as in 20261015160000_feed_admin.sql.
--       The grants are restated unchanged.
--
-- No table changes. No BEGIN/COMMIT: the migration tool runs each file in one transaction.
--
-- Down (manual): drop the new function, then put back 20261015160000_feed_admin.sql's definition.
--   begin;
--   drop function public.feed_make_due(text, text, text);
--   drop function public.feed_page_across(text, text, integer);
--   drop function public.feed_admin_status();
--   -- run 20261015160000_feed_admin.sql's create function and its revoke and grant
--   commit;

-- feed_page_across ----------------------------------------------------------------------------

create function public.feed_page_across(p_tier text, p_feature text, p_per_variant integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with st as (
    select s.* from public.feed_state s where s.tier = p_tier and s.feature = p_feature
  ), agg as (
    select count(*)::integer as variants,
           (count(*) filter (where st.serve))::integer as served,
           max(st.fetched_at) as fetched_at,
           coalesce(sum(st.item_count), 0)::integer as total
      from st
  )
  select case when agg.variants = 0 then null else jsonb_build_object(
    'tier', p_tier, 'feature', p_feature, 'variants', agg.variants, 'served', agg.served,
    'all_served', agg.served = agg.variants, 'fetched_at', agg.fetched_at, 'total', agg.total,
    'pages', case when agg.served <> agg.variants then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
               'variant', s.variant, 'class', s.class, 'kind', s.kind, 'serve', s.serve,
               'fetched_at', s.fetched_at, 'interval_minutes', s.interval_minutes, 'meta', s.meta,
               'total', s.item_count,
               'items', coalesce((
                 select jsonb_agg(jsonb_build_object('item_key', i.item_key, 'row', i.row, 'published_at', i.published_at,
                                                     'first_seen', i.first_seen, 'last_seen', i.last_seen)
                                  order by i.n)
                   from (select f.item_key, f.row, f.published_at, f.first_seen, f.last_seen,
                                row_number() over (order by case when s.kind in ('latest', 'reference', 'measurement') then f.position end,
                                                            f.sort_at desc, f.position, f.item_key) as n
                           from public.feed_items f
                          where f.tier = s.tier and f.feature = s.feature and f.variant = s.variant
                          order by n
                          limit least(greatest(coalesce(p_per_variant, 1), 1), 100)) as i), '[]'::jsonb))
             order by s.variant)
        from st as s), '[]'::jsonb) end)
  end
    from agg;
$$;

revoke all on function public.feed_page_across(text, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.feed_page_across(text, text, integer) to service_role;

-- feed_make_due -------------------------------------------------------------------------------

create function public.feed_make_due(p_tier text, p_feature text, p_variant text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_done boolean;
begin
  update public.feed_state s
     set next_due_at = now()
   where s.tier = p_tier and s.feature = p_feature and s.variant = coalesce(p_variant, '')
     and s.class = 'register'
     and s.lease_token is null
  returning true into v_done;
  return coalesce(v_done, false);
end;
$$;

revoke all on function public.feed_make_due(text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.feed_make_due(text, text, text) to service_role;

-- feed_admin_status: a register is never stale ------------------------------------------------

create or replace function public.feed_admin_status()
returns table (
  tier                 text,
  feature              text,
  variant              text,
  class                text,
  kind                 text,
  interval_minutes     integer,
  serve                boolean,
  next_due_at          timestamptz,
  fetched_at           timestamptz,
  checked_at           timestamptz,
  last_error           text,
  consecutive_failures integer,
  item_count           integer,
  leased               boolean,
  last_run_status      text,
  last_run_at          timestamptz,
  runs_ok_24h          integer,
  runs_failed_24h      integer,
  stale_after_minutes  integer,
  stale                boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not coalesce(public.is_platform_admin(), false) then
    raise exception 'Only an admin can read the feed store''s health' using errcode = '42501';
  end if;
  return query
  select s.tier, s.feature, s.variant, s.class, s.kind, s.interval_minutes, s.serve,
         s.next_due_at, s.fetched_at, s.checked_at, s.last_error, s.consecutive_failures, s.item_count,
         (s.lease_token is not null and s.lease_until > now()),
         last.status, last.started_at,
         coalesce(day.ok, 0)::integer, coalesce(day.failed, 0)::integer,
         limits.minutes,
         s.class <> 'register' and coalesce(s.fetched_at, s.created_at) < now() - make_interval(mins => limits.minutes)
    from public.feed_state s
    cross join lateral (select greatest(120, 3 * s.interval_minutes) as minutes) as limits
    left join lateral (
      select r.status, r.started_at
        from public.feed_runs r
       where r.tier = s.tier and r.feature = s.feature and r.variant = s.variant and r.status <> 'stale'
       order by r.started_at desc, r.id desc
       limit 1
    ) as last on true
    left join (
      select r.tier, r.feature, r.variant,
             count(*) filter (where r.status in ('ok', 'unchanged')) as ok,
             count(*) filter (where r.status in ('failed', 'timeout', 'empty', 'shrunk')) as failed
        from public.feed_runs r
       where r.started_at >= now() - interval '24 hours'
       group by r.tier, r.feature, r.variant
    ) as day on day.tier = s.tier and day.feature = s.feature and day.variant = s.variant
   order by s.tier, s.feature, s.variant;
end;
$$;

revoke all on function public.feed_admin_status() from public, anon, authenticated, service_role;
grant execute on function public.feed_admin_status() to authenticated;
