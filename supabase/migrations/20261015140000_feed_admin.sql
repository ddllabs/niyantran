-- The admin screen reads the scheduled feed store's health (open-work F169 phase 4, C5;
-- docs/decisions/0012-scheduled-feeds-records-first.md; docs/plans/2026-10-15-next-work.md, C5).
--
-- feed_state and feed_runs are service-role only (RLS on, no policies, nothing granted to
-- authenticated), so the admin app cannot read them. This adds one read-only function the admin's
-- own session may call, the way db_size() (20261015120000_feed_records.sql) already is:
--
--   * feed_admin_status()                                     authenticated, admins only
--       One row per module and variant in feed_state (about 65), ordered by tier, feature,
--       variant. Raises 42501 for anyone but an active platform admin (is_platform_admin()).
--       Takes no argument, writes nothing and reads feed_state plus the last 24 hours of
--       feed_runs. Columns:
--         tier, feature, variant, class, kind, interval_minutes, serve
--         next_due_at, fetched_at (last success), checked_at (last attempt), last_error,
--         consecutive_failures, item_count
--         leased             a run holds the module now (lease_token set and lease_until ahead)
--         last_run_status    the status of the module's latest run in feed_runs, a 'stale'
--                            row (a run that lost its lease) not counted; null if none
--         last_run_at        when that run started
--         runs_ok_24h        runs in the last 24 hours with status ok or unchanged
--         runs_failed_24h    runs in the last 24 hours with status failed, timeout, empty or
--                            shrunk
--         stale_after_minutes  how long the module's items stay fresh: three of its intervals
--                            or two hours, whichever is more
--         stale              the module was last fetched (else, first listed) more than
--                            stale_after_minutes ago; exactly that long ago is not stale
--       The stale rule is the page server's (server/feedServe.mjs storeMaxAgeMinutes and
--       STORE_MIN_FRESH_MINUTES): one rule for the page and the admin screen. If one changes,
--       change the other. A module never fetched counts from created_at, so a new module
--       turns stale if it has produced nothing for that long.
--
-- No table or other function changes. No BEGIN/COMMIT: the migration tool runs each file in one
-- transaction.
--
-- Down (manual): nothing depends on the function.
--   begin;
--   drop function public.feed_admin_status();
--   commit;

create function public.feed_admin_status()
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
         coalesce(s.fetched_at, s.created_at) < now() - make_interval(mins => limits.minutes)
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
