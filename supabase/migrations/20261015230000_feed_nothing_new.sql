-- An append-only module whose source listed nothing new is a success, not a failure (open-work F196,
-- review R2; docs/decisions/0012-scheduled-feeds-records-first.md).
--
-- SDL Auction & Borrowing Tracker (kind official) reads RBI's press RSS, which lists only the latest
-- ten releases. An hour in which none of them is an SDL auction answered with no items, which
-- feed_record logged as 'empty': a failure (consecutive_failures up, fetched_at not advanced, a
-- backoff), the admin screen counted it failing, and after three hours the page server treated the
-- kept history as stale and showed the empty live answer instead.
--
-- 20261015150000_feed_records.sql is applied to NTER and is not edited; this replaces one function:
--
--   * feed_record(p)                                          service_role
--       As in 20261015150000_feed_records.sql, with one new optional key, nothing_new (true or
--       false; anything else is refused with 22023 before anything changes). An answer with status
--       ok, no items and nothing_new true, for a module whose stored kind keeps its items (official,
--       news, events: ADR 0012's kept kinds), is a run that found nothing new:
--         unchanged  logged as 'unchanged' (items 0, the note "the source listed nothing new; the
--                    kept items stand"); the items, item_count and changed_at are untouched;
--                    fetched_at and checked_at are now; consecutive_failures, shrunk_runs and
--                    last_error are reset; next_due_at is now plus the module's interval; the lease
--                    is released; meta is replaced only when the answer brought one.
--       The flag changes nothing else: with items it is ignored (an ordinary ok), for a kind that
--       replaces its items (latest, reference, measurement) and for any status but ok it is
--       ignored, and an ok answer with no items and no flag is still 'empty', a failure. server/
--       feedStore.mjs sends the flag only when a request in the run reached the source and the
--       loader marked its answer meta.nothing_new (server/featureFeed.mjs serveSdlAuctions: the RSS
--       listed releases, none an SDL auction; an RSS with no items at all is a failure).
--       The grants are restated unchanged.
--
-- No table changes. No BEGIN/COMMIT: the migration tool runs each file in one transaction.
--
-- Down (manual): put back 20261015150000_feed_records.sql's definition.
--   begin;
--   drop function public.feed_record(jsonb);
--   -- run 20261015150000_feed_records.sql's create function public.feed_record
--   revoke all on function public.feed_record(jsonb) from public, anon, authenticated, service_role;
--   grant execute on function public.feed_record(jsonb) to service_role;
--   commit;

-- feed_record ---------------------------------------------------------------------------------

create or replace function public.feed_record(p jsonb)
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
  v_note     text;
  v_keys     text[];
  v_batch    integer := 0;
  v_new      integer := 0;
  v_changed  integer := 0;
  v_pruned   integer := 0;
  v_moved    integer := 0;
  v_count    integer;
  v_logged   text;
  v_failures integer;
  v_next     timestamptz;
  v_day      date := (now() at time zone 'Asia/Kolkata')::date;
  v_nothing_new boolean := false;
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
  if p ? 'nothing_new' and jsonb_typeof(p -> 'nothing_new') not in ('boolean', 'null') then
    raise exception 'feed_record: nothing_new must be true or false' using errcode = '22023';
  end if;
  v_nothing_new := coalesce((p ->> 'nothing_new')::boolean, false);
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

  if v_status = 'ok' and v_batch = 0 and v_nothing_new and v_kind in ('official', 'news', 'events') then
    -- The source was read and listed nothing new: a success. The kept items stand, item_count and
    -- changed_at are unchanged, the module is fresh again (fetched_at) and healthy, and it is due
    -- after its usual interval. meta is replaced only when the answer brought one.
    v_next := now() + make_interval(mins => v_state.interval_minutes);
    v_note := 'the source listed nothing new; the kept items stand';
    update public.feed_state s
       set fetched_at = now(),
           checked_at = now(),
           meta = coalesce(v_meta, s.meta),
           consecutive_failures = 0,
           shrunk_runs = 0,
           last_error = null,
           next_due_at = v_next,
           leased_at = null, lease_until = null, lease_token = null
     where s.tier = v_tier and s.feature = v_feature and s.variant = v_variant;
    insert into public.feed_runs (tier, feature, variant, started_at, ms, status, items, new_items, error)
    values (v_tier, v_feature, v_variant, v_started, v_ms, 'unchanged', 0, 0, v_note);
    return jsonb_build_object(
      'status', 'unchanged', 'items', 0, 'new_items', 0, 'changed_items', 0, 'moved_items', 0,
      'removed_items', 0, 'item_count', v_state.item_count, 'next_due_at', v_next, 'consecutive_failures', 0);
  end if;

  if v_status = 'ok' and v_batch = 0 then
    v_status := 'empty';
    v_error := coalesce(v_error, 'the source answered with no items');
  end if;

  if v_status = 'ok' and v_kind in ('latest', 'reference') then
    select count(*)::integer into v_count from public.feed_items f
     where f.tier = v_tier and f.feature = v_feature and f.variant = v_variant;
    if v_count >= 10 and v_batch * 2 < v_count then
      if v_state.shrunk_runs >= 2 then
        -- The third shrunk answer in a row: the list really is smaller now.
        v_note := format('the list shrank from %s to %s items; accepted after 3 answers in a row', v_count, v_batch);
      else
        v_status := 'shrunk';
        v_error := format('%s items arrived and %s are held; kept the held list', v_batch, v_count);
      end if;
    end if;
  end if;

  if v_status = 'ok' then
    -- One statement, one snapshot: "cmp" sees the items as they were before the upsert.
    with batch as (
      select distinct on (e.i ->> 'item_key')
             e.i ->> 'item_key' as item_key, e.i -> 'row' as row,
             nullif(e.i ->> 'title', '') as title, nullif(e.i ->> 'url', '') as url,
             nullif(e.i ->> 'published_at', '')::timestamptz as published_at,
             e.i ->> 'content_hash' as content_hash,
             (e.ord - 1)::integer as position
        from jsonb_array_elements(v_items) with ordinality as e(i, ord)
       order by e.i ->> 'item_key', e.ord
    ), cmp as (
      select b.item_key, f.content_hash as old_hash, b.content_hash as new_hash,
             f.position as old_position, b.position as new_position
        from batch b
        left join public.feed_items f
          on f.tier = v_tier and f.feature = v_feature and f.variant = v_variant and f.item_key = b.item_key
    ), up as (
      insert into public.feed_items as f
             (tier, feature, variant, item_key, row, title, url, published_at, kind, content_hash, position)
      select v_tier, v_feature, v_variant, b.item_key, b.row, b.title, b.url, b.published_at, v_kind, b.content_hash,
             b.position
        from batch b
      on conflict on constraint feed_items_pkey do update
         set row          = case when f.content_hash = excluded.content_hash then f.row else excluded.row end,
             title        = case when f.content_hash = excluded.content_hash then f.title else excluded.title end,
             url          = case when f.content_hash = excluded.content_hash then f.url else excluded.url end,
             published_at = case when f.content_hash = excluded.content_hash then f.published_at else excluded.published_at end,
             content_hash = excluded.content_hash,
             kind         = excluded.kind,
             position     = excluded.position,
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
           (count(*) filter (where c.old_hash is not null and c.old_hash <> c.new_hash))::integer,
           -- A move changes what a reader sees only where position is the order.
           (count(*) filter (where c.old_hash is not null and c.old_position <> c.new_position
                               and v_kind in ('latest', 'reference', 'measurement')))::integer
      into v_new, v_changed, v_moved
      from cmp c;

    if v_kind in ('latest', 'reference') then
      delete from public.feed_items f
       where f.tier = v_tier and f.feature = v_feature and f.variant = v_variant
         and not exists (select from unnest(v_keys) as k(item_key) where k.item_key = f.item_key);
      get diagnostics v_pruned = row_count;
    end if;

    select count(*)::integer into v_count from public.feed_items f
     where f.tier = v_tier and f.feature = v_feature and f.variant = v_variant;
    v_logged := case when v_new + v_changed + v_moved + v_pruned > 0 then 'ok' else 'unchanged' end;
    v_next := now() + make_interval(mins => v_state.interval_minutes);

    update public.feed_state s
       set fetched_at = now(),
           checked_at = now(),
           changed_at = case when v_logged = 'ok' then now() else s.changed_at end,
           item_count = v_count,
           meta = coalesce(v_meta, s.meta),
           consecutive_failures = 0,
           shrunk_runs = 0,
           last_error = v_note,
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
           shrunk_runs = case when v_logged = 'shrunk' then s.shrunk_runs + 1 else 0 end,
           last_error = v_error,
           next_due_at = v_next,
           leased_at = null, lease_until = null, lease_token = null
     where s.tier = v_tier and s.feature = v_feature and s.variant = v_variant;
  end if;

  insert into public.feed_runs (tier, feature, variant, started_at, ms, status, items, new_items, error)
  values (v_tier, v_feature, v_variant, v_started, v_ms, v_logged, v_batch, v_new,
          case when v_logged in ('ok', 'unchanged') then v_note else v_error end);

  return jsonb_build_object(
    'status', v_logged, 'items', v_batch, 'new_items', v_new, 'changed_items', v_changed,
    'moved_items', v_moved, 'removed_items', v_pruned, 'item_count', v_count, 'next_due_at', v_next,
    'consecutive_failures', coalesce(v_failures, 0));
end;
$$;

revoke all on function public.feed_record(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.feed_record(jsonb) to service_role;
