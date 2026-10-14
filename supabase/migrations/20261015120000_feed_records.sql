-- Scheduled module data kept as records (open-work F169 phase 4, F160, F170 rules 1-3;
-- docs/decisions/0012-scheduled-feeds-records-first.md;
-- docs/specs/2026-10-14-scheduled-module-data.md, Amendment A).
--
-- Four tables, all service-role only (RLS on, no policies, nothing granted to anon or
-- authenticated):
--
--   * feed_items: one row per listed item of a scheduled module, keyed by module, variant and
--     the item key from server/feedSchedule.mjs itemKeyFor. A refresh updates an item in place;
--     its row is rewritten only when its content_hash changes. sort_at (published_at, else
--     first_seen) orders a module's items newest first.
--   * feed_state: one row per module and variant: the schedule copied from code (class, kind,
--     interval_minutes), next_due_at, the run lease and its token, health (failures, last
--     error), the answer's notes (meta: source note, links, coverage, adapter), item_count and
--     the serve switch, off until go-live.
--   * feed_runs: one row per attempt; feed_purge() deletes those older than 30 days.
--   * feed_daily: the last value of a measurement item on each India (Asia/Kolkata) day; kept.
--
-- Functions, all SECURITY DEFINER with search_path '':
--
--   * feed_claim_due(p_runs, p_limit, p_lease_seconds)       service_role
--       p_runs is the schedule from code (server/feedSchedule.mjs feedRunsForDb):
--       [{tier, feature, variant, class, kind, interval_minutes}]; other keys are ignored.
--       1. Adds missing modules (due now) and copies class, kind and interval.
--       2. A listed module whose lease ended with no record is a failed run: one more
--          failure, the usual backoff, last_error 'no result before the lease ended', a
--          'timeout' run logged. Its new next_due_at is in the future, so step 3 skips it.
--       3. Leases and returns up to p_limit listed modules that are due and not leased,
--          oldest due first (skip locked), each with a new lease_token.
--       A module that is not in p_runs is never claimed.
--   * feed_record(p)                                          service_role
--       One module outcome, in one transaction: {tier, feature, variant, lease_token, status,
--       ms, error, meta, started_at, items:[{item_key, row, title, url, published_at,
--       content_hash}]}. status is ok, failed, timeout or empty. The kind is the stored one
--       from the schedule; a kind in p is ignored.
--       Input over the caps is refused (22023) before anything changes: 2,000 items, a row of
--       64 KB, a title of 1,000 characters, a url of 2,048, meta of 16 KB.
--       Outcomes:
--         stale      the lease_token is not the module's current one (another run holds or
--                    held the module since): only the run is logged; items, daily rows and
--                    state are unchanged.
--         empty      ok with no items: a failure.
--         shrunk     a latest or reference module holding 10 or more items gets fewer than
--                    half of them: a failure, nothing pruned or replaced.
--         ok         items upserted (new inserted; a changed hash rewrites row, title, url,
--                    published_at; an unchanged one touches last_seen only); kinds latest and
--                    reference drop the module's items missing from the batch; kind
--                    measurement writes today's feed_daily row per item; state reset to
--                    healthy, next due after the interval. Logged ok, or unchanged when
--                    nothing was added, changed or dropped.
--         failures   (failed, timeout, empty, shrunk) items kept, one more failure, retry after
--                    2, 4, 8 ... minutes but never later than the interval, last_error kept
--                    to 300 characters, lease released, run logged.
--       Duplicate item keys within one batch keep the first.
--   * feed_page(p_tier, p_feature, p_variant, p_limit, p_offset)  service_role
--       Items newest first (sort_at desc, item_key) with the module's state; null for an
--       unknown module. p_limit is clamped to 1..500, p_offset to 0 or more.
--   * feed_purge()                                            service_role
--       Deletes feed_runs older than 30 days and measurement items not seen for 30 days
--       (their daily summaries in feed_daily are kept), and corrects item_count.
--   * db_size()                                               authenticated, admins only
--       The database's size and each feed table's total size in bytes. Raises 42501 for
--       anyone but an active platform admin.
--
-- Grants: service_role may SELECT the four tables and UPDATE only feed_state.serve (the
-- rollback switch); every other write goes through feed_record and feed_claim_due, so their
-- rules hold. No cron job is scheduled here: the supervisor schedules the refresh and the
-- daily purge at go-live.
--
-- No BEGIN/COMMIT: the migration tool runs each file in one transaction.
--
-- Down (manual): the tables hold stored records; drop them only when the records are not
-- wanted. Switching serve off for every module is the non-destructive rollback (ADR 0012).
--   begin;
--   drop function public.db_size();
--   drop function public.feed_purge();
--   drop function public.feed_page(text, text, text, integer, integer);
--   drop function public.feed_record(jsonb);
--   drop function public.feed_claim_due(jsonb, integer, integer);
--   drop table public.feed_daily;
--   drop table public.feed_runs;
--   drop table public.feed_items;
--   drop table public.feed_state;
--   commit;

-- Tables -------------------------------------------------------------------------------------

create table public.feed_state (
  tier                 text        not null check (length(tier) between 1 and 100),
  feature              text        not null check (length(feature) between 1 and 300),
  variant              text        not null default '' check (length(variant) <= 200),
  class                text        not null check (class ~ '^[a-z][a-z_]{0,39}$'),
  kind                 text        not null check (kind in ('official', 'news', 'events', 'measurement', 'latest', 'reference')),
  interval_minutes     integer     not null check (interval_minutes between 15 and 43200),
  next_due_at          timestamptz not null default now(),
  leased_at            timestamptz,
  lease_until          timestamptz,
  lease_token          uuid,
  consecutive_failures integer     not null default 0 check (consecutive_failures >= 0),
  last_error           text        check (length(last_error) <= 300),
  fetched_at           timestamptz,
  checked_at           timestamptz,
  changed_at           timestamptz,
  meta                 jsonb       not null default '{}' check (jsonb_typeof(meta) = 'object'),
  item_count           integer     not null default 0 check (item_count >= 0),
  serve                boolean     not null default false,
  created_at           timestamptz not null default now(),
  primary key (tier, feature, variant),
  check ((lease_token is null) = (lease_until is null))
);

create table public.feed_items (
  tier         text        not null,
  feature      text        not null,
  variant      text        not null default '',
  item_key     text        not null check (octet_length(item_key) between 1 and 2000),
  row          jsonb       not null check (jsonb_typeof(row) = 'object'),
  title        text        check (length(title) <= 1000),
  url          text        check (length(url) <= 2048),
  published_at timestamptz,
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  kind         text        not null check (kind in ('official', 'news', 'events', 'measurement', 'latest', 'reference')),
  content_hash text        not null check (length(content_hash) between 1 and 128),
  sort_at      timestamptz generated always as (coalesce(published_at, first_seen)) stored,
  primary key (tier, feature, variant, item_key),
  foreign key (tier, feature, variant) references public.feed_state (tier, feature, variant)
) with (fillfactor = 90);

-- Serving order. last_seen is deliberately not indexed: an unchanged item's refresh touches only
-- last_seen and stays a HOT update (fillfactor 90 leaves the room for it).
create index feed_items_serve_idx on public.feed_items (tier, feature, variant, sort_at desc, item_key);
-- feed_purge's measurement detail.
create index feed_items_measurement_seen_idx on public.feed_items (last_seen) where kind = 'measurement';

create table public.feed_runs (
  id         bigint      generated always as identity primary key,
  tier       text        not null,
  feature    text        not null,
  variant    text        not null default '',
  started_at timestamptz not null default now(),
  ms         integer     check (ms >= 0),
  status     text        not null check (status in ('ok', 'unchanged', 'failed', 'timeout', 'empty', 'shrunk', 'stale')),
  items      integer     not null default 0 check (items >= 0),
  new_items  integer     not null default 0 check (new_items >= 0),
  error      text        check (length(error) <= 300)
);

create index feed_runs_started_idx on public.feed_runs (started_at);
create index feed_runs_module_idx on public.feed_runs (tier, feature, variant, started_at desc);

create table public.feed_daily (
  tier        text        not null,
  feature     text        not null,
  variant     text        not null default '',
  item_key    text        not null,
  day         date        not null,
  row         jsonb       not null check (jsonb_typeof(row) = 'object'),
  recorded_at timestamptz not null default now(),
  primary key (tier, feature, variant, item_key, day),
  foreign key (tier, feature, variant) references public.feed_state (tier, feature, variant)
);

alter table public.feed_state enable row level security;
alter table public.feed_items enable row level security;
alter table public.feed_runs enable row level security;
alter table public.feed_daily enable row level security;

revoke all on table public.feed_state, public.feed_items, public.feed_runs, public.feed_daily
  from public, anon, authenticated, service_role;
revoke all on sequence public.feed_runs_id_seq from public, anon, authenticated, service_role;
grant select on table public.feed_state, public.feed_items, public.feed_runs, public.feed_daily to service_role;
grant update (serve) on table public.feed_state to service_role;

-- feed_claim_due ------------------------------------------------------------------------------

create function public.feed_claim_due(p_runs jsonb, p_limit integer, p_lease_seconds integer)
returns table (tier text, feature text, variant text, class text, kind text, interval_minutes integer,
               next_due_at timestamptz, consecutive_failures integer, lease_until timestamptz,
               lease_token uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_bad bigint;
  v_dup text;
begin
  if jsonb_typeof(p_runs) is distinct from 'array' then
    raise exception 'feed_claim_due: p_runs must be a JSON array of {tier, feature, variant, class, kind, interval_minutes}'
      using errcode = '22023';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'feed_claim_due: p_limit must be between 1 and 100' using errcode = '22023';
  end if;
  if p_lease_seconds is null or p_lease_seconds not between 10 and 3600 then
    raise exception 'feed_claim_due: p_lease_seconds must be between 10 and 3600' using errcode = '22023';
  end if;

  select e.ord into v_bad
    from jsonb_array_elements(p_runs) with ordinality as e(r, ord)
   where jsonb_typeof(e.r) is distinct from 'object'
      or jsonb_typeof(e.r -> 'tier') is distinct from 'string' or length(e.r ->> 'tier') not between 1 and 100
      or jsonb_typeof(e.r -> 'feature') is distinct from 'string' or length(e.r ->> 'feature') not between 1 and 300
      or (e.r ? 'variant' and jsonb_typeof(e.r -> 'variant') not in ('string', 'null'))
      or length(coalesce(e.r ->> 'variant', '')) > 200
      or jsonb_typeof(e.r -> 'class') is distinct from 'string' or (e.r ->> 'class') !~ '^[a-z][a-z_]{0,39}$'
      or jsonb_typeof(e.r -> 'kind') is distinct from 'string'
      or (e.r ->> 'kind') not in ('official', 'news', 'events', 'measurement', 'latest', 'reference')
      or jsonb_typeof(e.r -> 'interval_minutes') is distinct from 'number'
      or case when (e.r ->> 'interval_minutes') ~ '^[0-9]{1,5}$' then (e.r ->> 'interval_minutes')::integer else 0 end
         not between 15 and 43200
   order by e.ord
   limit 1;
  if v_bad is not null then
    raise exception 'feed_claim_due: run % needs tier, feature, an optional variant, class (a-z, _), kind (official, news, events, measurement, latest or reference) and interval_minutes (whole minutes, 15 to 43200)', v_bad
      using errcode = '22023';
  end if;

  select concat_ws('/', r ->> 'tier', r ->> 'feature', coalesce(r ->> 'variant', '')) into v_dup
    from jsonb_array_elements(p_runs) as r
   group by r ->> 'tier', r ->> 'feature', coalesce(r ->> 'variant', '')
  having count(*) > 1
   limit 1;
  if v_dup is not null then
    raise exception 'feed_claim_due: run % is listed twice', v_dup using errcode = '22023';
  end if;

  -- 1. Copy the schedule from code: add new modules (due now), then update only the modules whose
  -- class, kind or interval changed; a shorter interval pulls next_due_at in. A plain upsert
  -- would wait on every module another run holds, even when nothing changes (measured);
  -- filtered like this, a claim waits only on a module that is new or changed.
  insert into public.feed_state (tier, feature, variant, class, kind, interval_minutes, next_due_at)
  select r ->> 'tier', r ->> 'feature', coalesce(r ->> 'variant', ''), r ->> 'class', r ->> 'kind',
         (r ->> 'interval_minutes')::integer, now()
    from jsonb_array_elements(p_runs) as r
   where not exists (select from public.feed_state s
                      where s.tier = r ->> 'tier' and s.feature = r ->> 'feature'
                        and s.variant = coalesce(r ->> 'variant', ''))
  on conflict on constraint feed_state_pkey do nothing;

  update public.feed_state s
     set class = n.class,
         kind = n.kind,
         interval_minutes = n.interval_minutes,
         next_due_at = least(s.next_due_at, now() + make_interval(mins => n.interval_minutes))
    from (select r ->> 'tier' as tier, r ->> 'feature' as feature, coalesce(r ->> 'variant', '') as variant,
                 r ->> 'class' as class, r ->> 'kind' as kind, (r ->> 'interval_minutes')::integer as interval_minutes
            from jsonb_array_elements(p_runs) as r) as n
   where s.tier = n.tier and s.feature = n.feature and s.variant = n.variant
     and (s.class, s.kind, s.interval_minutes) is distinct from (n.class, n.kind, n.interval_minutes);

  -- 2. A lease that ended with no record: the run died or overran. Count it as a failed run.
  with expired as (
    select s.tier, s.feature, s.variant, s.leased_at
      from public.feed_state s
      join (select r ->> 'tier' as tier, r ->> 'feature' as feature, coalesce(r ->> 'variant', '') as variant
              from jsonb_array_elements(p_runs) as r) as runs
        on runs.tier = s.tier and runs.feature = s.feature and runs.variant = s.variant
     where s.lease_token is not null and s.lease_until <= now()
       for update of s skip locked
  ), failed as (
    update public.feed_state s
       set consecutive_failures = s.consecutive_failures + 1,
           last_error = 'no result before the lease ended',
           checked_at = now(),
           next_due_at = now() + make_interval(mins => least(s.interval_minutes,
                                                             power(2, least(s.consecutive_failures + 1, 20))::integer)),
           leased_at = null, lease_until = null, lease_token = null
      from expired e
     where s.tier = e.tier and s.feature = e.feature and s.variant = e.variant
    returning s.tier, s.feature, s.variant, e.leased_at
  )
  insert into public.feed_runs (tier, feature, variant, started_at, ms, status, error)
  select f.tier, f.feature, f.variant, coalesce(f.leased_at, now()),
         (extract(epoch from now() - coalesce(f.leased_at, now())) * 1000)::integer,
         'timeout', 'no result before the lease ended'
    from failed f;

  -- 3. Lease the due modules.
  return query
  with runs as (
    select r ->> 'tier' as tier, r ->> 'feature' as feature, coalesce(r ->> 'variant', '') as variant
      from jsonb_array_elements(p_runs) as r
  ), due as (
    select s.tier, s.feature, s.variant
      from public.feed_state s
      join runs on runs.tier = s.tier and runs.feature = s.feature and runs.variant = s.variant
     where s.next_due_at <= now()
       and s.lease_token is null
     order by s.next_due_at, s.tier, s.feature, s.variant
     limit p_limit
       for update of s skip locked
  ), claimed as (
    update public.feed_state s
       set leased_at = now(),
           lease_until = now() + make_interval(secs => p_lease_seconds),
           lease_token = gen_random_uuid()
      from due
     where s.tier = due.tier and s.feature = due.feature and s.variant = due.variant
    returning s.tier, s.feature, s.variant, s.class, s.kind, s.interval_minutes, s.next_due_at,
              s.consecutive_failures, s.lease_until, s.lease_token
  )
  select c.tier, c.feature, c.variant, c.class, c.kind, c.interval_minutes, c.next_due_at,
         c.consecutive_failures, c.lease_until, c.lease_token
    from claimed c
   order by c.next_due_at, c.tier, c.feature, c.variant;
end;
$$;

-- feed_record ---------------------------------------------------------------------------------

create function public.feed_record(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tier     text;
  v_feature  text;
  v_variant  text;
  v_token    uuid;
  v_status   text;
  v_kind     text;
  v_ms       integer;
  v_error    text;
  v_started  timestamptz;
  v_items    jsonb;
  v_meta     jsonb;
  v_state    public.feed_state;
  v_bad      text;
  v_keys     text[];
  v_batch    integer := 0;
  v_new      integer := 0;
  v_changed  integer := 0;
  v_pruned   integer := 0;
  v_count    integer;
  v_logged   text;
  v_failures integer;
  v_next     timestamptz;
  v_day      date := (now() at time zone 'Asia/Kolkata')::date;
begin
  -- Validation: everything is refused here, before anything changes.
  if jsonb_typeof(p) is distinct from 'object' then
    raise exception 'feed_record: the outcome must be a JSON object' using errcode = '22023';
  end if;
  if jsonb_typeof(p -> 'tier') is distinct from 'string' or jsonb_typeof(p -> 'feature') is distinct from 'string'
     or coalesce(p ->> 'tier', '') = '' or coalesce(p ->> 'feature', '') = '' then
    raise exception 'feed_record: tier and feature are required strings' using errcode = '22023';
  end if;
  if p ? 'variant' and jsonb_typeof(p -> 'variant') not in ('string', 'null') then
    raise exception 'feed_record: variant must be a string' using errcode = '22023';
  end if;
  v_tier := p ->> 'tier';
  v_feature := p ->> 'feature';
  v_variant := coalesce(p ->> 'variant', '');

  if jsonb_typeof(p -> 'lease_token') is distinct from 'string' or not pg_input_is_valid(p ->> 'lease_token', 'uuid') then
    raise exception 'feed_record: lease_token (the uuid feed_claim_due returned) is required' using errcode = '22023';
  end if;
  v_token := (p ->> 'lease_token')::uuid;

  v_status := p ->> 'status';
  if v_status is null or v_status not in ('ok', 'failed', 'timeout', 'empty') then
    raise exception 'feed_record: status must be ok, failed, timeout or empty, not %', coalesce(v_status, 'missing')
      using errcode = '22023';
  end if;
  if p ? 'ms' and jsonb_typeof(p -> 'ms') <> 'null' then
    if jsonb_typeof(p -> 'ms') <> 'number' or (p ->> 'ms') !~ '^[0-9]{1,9}$' then
      raise exception 'feed_record: ms must be a whole number of milliseconds' using errcode = '22023';
    end if;
    v_ms := (p ->> 'ms')::integer;
  end if;
  if p ? 'error' and jsonb_typeof(p -> 'error') not in ('string', 'null') then
    raise exception 'feed_record: error must be a string' using errcode = '22023';
  end if;
  v_error := left(nullif(btrim(p ->> 'error'), ''), 300);
  v_meta := nullif(p -> 'meta', 'null'::jsonb);
  if v_meta is not null and jsonb_typeof(v_meta) <> 'object' then
    raise exception 'feed_record: meta must be a JSON object' using errcode = '22023';
  end if;
  if pg_column_size(v_meta) > 16384 then
    raise exception 'feed_record: meta is % bytes; the limit is 16 KB', pg_column_size(v_meta) using errcode = '22023';
  end if;
  if p ? 'started_at' and jsonb_typeof(p -> 'started_at') <> 'null' then
    if jsonb_typeof(p -> 'started_at') <> 'string' or not pg_input_is_valid(p ->> 'started_at', 'timestamptz') then
      raise exception 'feed_record: started_at must be a timestamp' using errcode = '22023';
    end if;
    v_started := least((p ->> 'started_at')::timestamptz, now());
  end if;
  v_started := coalesce(v_started, now() - make_interval(secs => coalesce(v_ms, 0) / 1000.0));

  v_items := coalesce(nullif(p -> 'items', 'null'::jsonb), '[]'::jsonb);
  if jsonb_typeof(v_items) <> 'array' then
    raise exception 'feed_record: items must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(v_items) > 2000 then
    raise exception 'feed_record: % items; the limit is 2,000 in one record', jsonb_array_length(v_items)
      using errcode = '22023';
  end if;
  select format('item %s %s', x.ord, x.reason) into v_bad
    from (select e.ord, case
                 when jsonb_typeof(e.i) is distinct from 'object'
                   or jsonb_typeof(e.i -> 'item_key') is distinct from 'string'
                   or octet_length(e.i ->> 'item_key') not between 1 and 2000
                   or jsonb_typeof(e.i -> 'row') is distinct from 'object'
                   or jsonb_typeof(e.i -> 'content_hash') is distinct from 'string'
                   or length(e.i ->> 'content_hash') not between 1 and 128
                   or (e.i ? 'title' and jsonb_typeof(e.i -> 'title') not in ('string', 'null'))
                   or (e.i ? 'url' and jsonb_typeof(e.i -> 'url') not in ('string', 'null'))
                   or (e.i ? 'published_at' and jsonb_typeof(e.i -> 'published_at') not in ('string', 'null'))
                   or (nullif(e.i ->> 'published_at', '') is not null
                       and not pg_input_is_valid(e.i ->> 'published_at', 'timestamptz'))
                   then 'needs item_key (1 to 2000 bytes), row (an object) and content_hash; title and url are strings; published_at a timestamp'
                 when pg_column_size(e.i -> 'row') > 65536 then 'has a row over 64 KB'
                 when length(e.i ->> 'title') > 1000 then 'has a title over 1,000 characters'
                 when length(e.i ->> 'url') > 2048 then 'has a url over 2,048 characters'
               end as reason
            from jsonb_array_elements(v_items) with ordinality as e(i, ord)) as x
   where x.reason is not null
   order by x.ord
   limit 1;
  if v_bad is not null then
    raise exception 'feed_record: %', v_bad using errcode = '22023';
  end if;

  select * into v_state from public.feed_state s
   where s.tier = v_tier and s.feature = v_feature and s.variant = v_variant
     for update;
  if not found then
    raise exception 'feed_record: % / % / "%" is not scheduled (feed_claim_due adds it)', v_tier, v_feature, v_variant
      using errcode = '22023';
  end if;

  -- The distinct keys of the batch (a key listed twice keeps its first copy below).
  v_keys := array(select distinct e.i ->> 'item_key' from jsonb_array_elements(v_items) as e(i));
  v_batch := cardinality(v_keys);

  -- A run that no longer holds the module: log it and change nothing else.
  if v_state.lease_token is distinct from v_token then
    insert into public.feed_runs (tier, feature, variant, started_at, ms, status, items, error)
    values (v_tier, v_feature, v_variant, v_started, v_ms, 'stale', v_batch,
            'the lease was no longer held; nothing was recorded');
    return jsonb_build_object('status', 'stale');
  end if;

  v_kind := v_state.kind;

  if v_status = 'ok' and v_batch = 0 then
    v_status := 'empty';
    v_error := coalesce(v_error, 'the source answered with no items');
  end if;

  if v_status = 'ok' and v_kind in ('latest', 'reference') then
    select count(*)::integer into v_count from public.feed_items f
     where f.tier = v_tier and f.feature = v_feature and f.variant = v_variant;
    if v_count >= 10 and v_batch * 2 < v_count then
      v_status := 'shrunk';
      v_error := format('%s items arrived and %s are held; kept the held list', v_batch, v_count);
    end if;
  end if;

  if v_status = 'ok' then
    -- One statement, one snapshot: "cmp" sees the items as they were before the upsert.
    with batch as (
      select distinct on (e.i ->> 'item_key')
             e.i ->> 'item_key' as item_key, e.i -> 'row' as row,
             nullif(e.i ->> 'title', '') as title, nullif(e.i ->> 'url', '') as url,
             nullif(e.i ->> 'published_at', '')::timestamptz as published_at,
             e.i ->> 'content_hash' as content_hash
        from jsonb_array_elements(v_items) with ordinality as e(i, ord)
       order by e.i ->> 'item_key', e.ord
    ), cmp as (
      select b.item_key, f.content_hash as old_hash, b.content_hash as new_hash
        from batch b
        left join public.feed_items f
          on f.tier = v_tier and f.feature = v_feature and f.variant = v_variant and f.item_key = b.item_key
    ), up as (
      insert into public.feed_items as f
             (tier, feature, variant, item_key, row, title, url, published_at, kind, content_hash)
      select v_tier, v_feature, v_variant, b.item_key, b.row, b.title, b.url, b.published_at, v_kind, b.content_hash
        from batch b
      on conflict on constraint feed_items_pkey do update
         set row          = case when f.content_hash = excluded.content_hash then f.row else excluded.row end,
             title        = case when f.content_hash = excluded.content_hash then f.title else excluded.title end,
             url          = case when f.content_hash = excluded.content_hash then f.url else excluded.url end,
             published_at = case when f.content_hash = excluded.content_hash then f.published_at else excluded.published_at end,
             content_hash = excluded.content_hash,
             kind         = excluded.kind,
             last_seen    = now()
      returning 1
    ), daily as (
      insert into public.feed_daily as d (tier, feature, variant, item_key, day, row)
      select v_tier, v_feature, v_variant, b.item_key, v_day, b.row
        from batch b
       where v_kind = 'measurement'
      on conflict on constraint feed_daily_pkey do update
         set row = excluded.row, recorded_at = now()
       where d.row is distinct from excluded.row
      returning 1
    )
    select (count(*) filter (where c.old_hash is null))::integer,
           (count(*) filter (where c.old_hash is not null and c.old_hash <> c.new_hash))::integer
      into v_new, v_changed
      from cmp c;

    if v_kind in ('latest', 'reference') then
      delete from public.feed_items f
       where f.tier = v_tier and f.feature = v_feature and f.variant = v_variant
         and not exists (select from unnest(v_keys) as k(item_key) where k.item_key = f.item_key);
      get diagnostics v_pruned = row_count;
    end if;

    select count(*)::integer into v_count from public.feed_items f
     where f.tier = v_tier and f.feature = v_feature and f.variant = v_variant;
    v_logged := case when v_new + v_changed + v_pruned > 0 then 'ok' else 'unchanged' end;
    v_next := now() + make_interval(mins => v_state.interval_minutes);

    update public.feed_state s
       set fetched_at = now(),
           checked_at = now(),
           changed_at = case when v_logged = 'ok' then now() else s.changed_at end,
           item_count = v_count,
           meta = coalesce(v_meta, s.meta),
           consecutive_failures = 0,
           last_error = null,
           next_due_at = v_next,
           leased_at = null, lease_until = null, lease_token = null
     where s.tier = v_tier and s.feature = v_feature and s.variant = v_variant;
  else
    v_failures := v_state.consecutive_failures + 1;
    v_next := now() + make_interval(mins => least(v_state.interval_minutes, power(2, least(v_failures, 20))::integer));
    v_error := coalesce(v_error, v_status);
    v_count := v_state.item_count;
    v_logged := v_status;

    update public.feed_state s
       set checked_at = now(),
           consecutive_failures = v_failures,
           last_error = v_error,
           next_due_at = v_next,
           leased_at = null, lease_until = null, lease_token = null
     where s.tier = v_tier and s.feature = v_feature and s.variant = v_variant;
  end if;

  insert into public.feed_runs (tier, feature, variant, started_at, ms, status, items, new_items, error)
  values (v_tier, v_feature, v_variant, v_started, v_ms, v_logged, v_batch, v_new,
          case when v_logged in ('ok', 'unchanged') then null else v_error end);

  return jsonb_build_object(
    'status', v_logged, 'items', v_batch, 'new_items', v_new, 'changed_items', v_changed,
    'removed_items', v_pruned, 'item_count', v_count, 'next_due_at', v_next,
    'consecutive_failures', coalesce(v_failures, 0));
end;
$$;

-- feed_page -----------------------------------------------------------------------------------

create function public.feed_page(p_tier text, p_feature text, p_variant text, p_limit integer, p_offset integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'tier', s.tier, 'feature', s.feature, 'variant', s.variant, 'class', s.class, 'kind', s.kind,
    'serve', s.serve, 'fetched_at', s.fetched_at, 'checked_at', s.checked_at, 'changed_at', s.changed_at,
    'interval_minutes', s.interval_minutes, 'consecutive_failures', s.consecutive_failures,
    'last_error', s.last_error, 'meta', s.meta, 'total', s.item_count,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('item_key', i.item_key, 'row', i.row, 'published_at', i.published_at,
                                          'first_seen', i.first_seen, 'last_seen', i.last_seen)
                       order by i.sort_at desc, i.item_key)
        from (select f.item_key, f.row, f.published_at, f.first_seen, f.last_seen, f.sort_at
                from public.feed_items f
               where f.tier = s.tier and f.feature = s.feature and f.variant = s.variant
               order by f.sort_at desc, f.item_key
               limit least(greatest(coalesce(p_limit, 50), 1), 500)
              offset greatest(coalesce(p_offset, 0), 0)) as i), '[]'::jsonb))
    from public.feed_state s
   where s.tier = p_tier and s.feature = p_feature and s.variant = coalesce(p_variant, '');
$$;

-- feed_purge ----------------------------------------------------------------------------------

create function public.feed_purge()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_runs  integer;
  v_items integer;
begin
  delete from public.feed_runs r where r.started_at < now() - interval '30 days';
  get diagnostics v_runs = row_count;

  -- Measurement detail: an instrument not seen for 30 days. Its daily summaries stay.
  with gone as (
    delete from public.feed_items f
     where f.kind = 'measurement' and f.last_seen < now() - interval '30 days'
    returning f.tier, f.feature, f.variant
  ), per_module as (
    select g.tier, g.feature, g.variant, count(*)::integer as n from gone g group by 1, 2, 3
  ), fixed as (
    update public.feed_state s
       set item_count = greatest(s.item_count - m.n, 0)
      from per_module m
     where s.tier = m.tier and s.feature = m.feature and s.variant = m.variant
    returning 1
  )
  select coalesce(sum(m.n), 0)::integer into v_items from per_module m;

  return jsonb_build_object('feed_runs', v_runs, 'feed_items', v_items);
end;
$$;

-- db_size -------------------------------------------------------------------------------------

create function public.db_size()
returns table (name text, bytes bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not coalesce(public.is_platform_admin(), false) then
    raise exception 'Only an admin can read database sizes' using errcode = '42501';
  end if;
  return query
  select 'database'::text, pg_catalog.pg_database_size(pg_catalog.current_database())
  union all
  select t.relname::text, pg_catalog.pg_total_relation_size(t.oid)
    from pg_catalog.pg_class t
   where t.oid in ('public.feed_items'::regclass, 'public.feed_state'::regclass,
                   'public.feed_runs'::regclass, 'public.feed_daily'::regclass);
end;
$$;

revoke all on function public.feed_claim_due(jsonb, integer, integer), public.feed_record(jsonb),
  public.feed_page(text, text, text, integer, integer), public.feed_purge(), public.db_size()
  from public, anon, authenticated, service_role;
grant execute on function public.feed_claim_due(jsonb, integer, integer), public.feed_record(jsonb),
  public.feed_page(text, text, text, integer, integer), public.feed_purge()
  to service_role;
grant execute on function public.db_size() to authenticated;
