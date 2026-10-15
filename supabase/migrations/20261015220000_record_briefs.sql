-- Stored AI record briefs (open-work F123; owner decisions 2026-10-15).
--
-- The first time anyone opens a record's panel, the desk-brief Edge Function (scope 'record')
-- writes a short brief of that record's fields with a cheap model, stores it here, and every
-- later viewer reads the stored brief. The platform pays: the provider call is logged to
-- model_call_logs with caller 'desk-brief', purpose 'record_brief' and no message_id, and
-- private.credit_charge_turn charges only purposes 'chat_answer' and 'embedding' of a turn's
-- message, so no user is ever charged credits for a brief.
--
-- Where a brief's content comes from (source) decides how it is shared:
--
--   * 'desk_rows': desk_rows holds the record, and the function briefs that stored copy, never the
--     browser's row. One brief per (tier, feature, row_key). It is regenerated only when the
--     record's content hash changes, and then at most once per 24 hours (live rows change often);
--     meanwhile the previous brief is served for the new hash. desk_rows is a snapshot, so the
--     brief describes the snapshot's copy, which can lag the live row.
--   * 'client': desk_rows does not hold the record, so the function briefs the row the browser
--     sent. Nothing proves that row is genuine, so the brief is content-addressed: one brief per
--     (tier, feature, row_key, content_hash), served only to a request whose row hashes to the
--     same content_hash (computed by the function). A forged row gets a brief of the forgery that
--     only an identical forgery reads, and it can never replace or be served for a 'desk_rows'
--     brief of the same key, which lives in its own row. A changed row is a new brief, with no
--     24-hour rule, still within the generation limits.
--
-- Generations, never reads, are limited per user per minute and per day and globally per day,
-- and the kill switch app_flags.record_briefs (seeded OFF here) stops all generation. Stored
-- briefs are still served while it is off or over a limit. The global limit the function passes
-- (5,000 a day) can be used up by about 25 accounts at their 200-a-day limit; after that, records
-- without a brief show none until the next UTC day, while stored briefs are still served.
--
-- Tables:
--
--   * record_briefs: one row per (tier, feature, row_key, hash_key). tier is the desk tab id
--     (global, national, state, law, economics, carbon, sports, entertainment), as in desk_rows.
--     The function computes row_key (deskRowKey) and content_hash (the v7 entry fingerprint,
--     24 hex characters) from the row; the browser never supplies either. hash_key is '' for a
--     'desk_rows' brief and content_hash for a 'client' brief. status is pending (a generation
--     holds claim_token since claimed_at), ready, or failed (retry after retry_after). A failed or
--     pending regeneration keeps the previous headline, points, model and written_at, which are
--     served until a new brief replaces them. attempts counts claims for content_hash since the
--     last ready brief; a new content_hash starts it again at 1. Cost, tokens and the log id are
--     kept for the platform. RLS on; service_role writes. authenticated may read only tier,
--     feature, row_key, status, headline, points, model and written_at of 'desk_rows' briefs,
--     never cost or tokens, and never a 'client' brief (served only through the claim, which
--     checks the hash); anon reads nothing.
--   * record_brief_quota: generation counters, one row per bucket and window: 'm:<user>' per
--     minute, 'd:<user>' per UTC day and 'g' per UTC day. Only the claim function touches it;
--     rows older than two days are deleted by the first claim of each day.
--
-- Functions, SECURITY DEFINER with search_path '' and TimeZone UTC, executable by service_role
-- only:
--
--   * record_brief_claim(p_tier, p_feature, p_row_key, p_hash, p_source, p_user,
--                        p_user_per_minute, p_user_per_day, p_global_per_day) -> jsonb
--       Reads the row for (p_tier, p_feature, p_row_key, hash_key) and answers, in order:
--         {state:'ready', headline, points, model, written_at}
--             a stored brief that may not be regenerated now (same hash, or written within
--             24 hours, or another generation is running, or a retry is not due or no longer
--             allowed), and also the previous brief whenever generation is off or limited;
--         {state:'pending'}      another generation holds the row and no brief exists yet;
--         {state:'failed'}       the last attempt failed (or its generation vanished), no brief
--                                exists, and a retry is not due or no longer allowed;
--         {state:'unavailable', reason:'off'|'limited'}  generation is off or over a limit
--             and no brief exists;
--         {state:'claimed', token, previous}  the caller won the claim and must generate,
--             then call record_brief_finish with the token. previous is the stored brief
--             (as in 'ready', without state) or null.
--       A row may be claimed when it has no row; when it is ready with a different hash and
--       was written more than 24 hours ago (or never); when it is pending and was claimed more
--       than 90 seconds ago; or when it failed and retry_after has passed. A pending or failed
--       row whose hash already had 5 attempts is not claimed again for that hash: only a changed
--       hash (new content) is. The claim is one INSERT ... ON CONFLICT DO UPDATE ... WHERE, so of
--       two concurrent callers exactly one wins; the loser reads what the winner left. The
--       winner's claim counts against p_user_per_minute, p_user_per_day and p_global_per_day;
--       over any of them the claim and every count are rolled back and the caller gets
--       'unavailable' (or the previous brief). Invalid input raises 22023.
--   * record_brief_finish(p_tier, p_feature, p_row_key, p_token, p_brief) -> boolean
--       Completes the claim held by p_token (unique, so it names one row of the key). p_brief
--       null marks the row failed, keeping the previous brief, with retry_after now + 10 minutes
--       x 2^(attempts - 1), at most 24 hours (10, 20, 40, 80, 160 minutes; the fifth failure for
--       a hash is the last). Otherwise p_brief is {headline, points, model, prompt_tokens,
--       completion_tokens, reasoning_tokens, cost_usd, model_call_log_id}: headline 1-300
--       characters, points 1-5 strings of at most 600 characters; token counts are rounded to
--       integers; the row becomes ready, written now. Returns false, changing nothing, when the
--       token no longer holds the claim (a stale claim was taken over). Invalid input raises 22023.
--
-- Down (manual): the table holds generated briefs the platform paid for; drop it only when
-- they are not wanted. Turning app_flags.record_briefs off is the non-destructive rollback.
--   begin;
--   drop function public.record_brief_finish(text, text, text, uuid, jsonb);
--   drop function public.record_brief_claim(text, text, text, text, text, uuid, integer, integer, integer);
--   drop table public.record_brief_quota;
--   drop table public.record_briefs;
--   delete from public.app_flags where key = 'record_briefs';
--   commit;

-- Tables -------------------------------------------------------------------------------------

create table public.record_briefs (
  tier               text        not null
                     check (tier in ('global', 'national', 'state', 'law', 'economics', 'carbon', 'sports', 'entertainment')),
  feature            text        not null check (length(feature) between 1 and 300),
  row_key            text        not null check (length(row_key) between 1 and 300),
  hash_key           text        not null,
  source             text        not null check (source in ('desk_rows', 'client')),
  content_hash       text        not null check (content_hash ~ '^[0-9a-f]{24}$'),
  status             text        not null check (status in ('pending', 'ready', 'failed')),
  headline           text        check (length(headline) between 1 and 300),
  points             jsonb       check (jsonb_typeof(points) = 'array' and jsonb_array_length(points) between 1 and 5),
  model              text        check (length(model) between 1 and 200),
  prompt_tokens      integer     check (prompt_tokens >= 0),
  completion_tokens  integer     check (completion_tokens >= 0),
  reasoning_tokens   integer     check (reasoning_tokens >= 0),
  cost_usd           numeric(12, 6) check (cost_usd >= 0),
  model_call_log_id  uuid,
  claim_token        uuid,
  claimed_at         timestamptz,
  written_at         timestamptz,
  attempts           integer     not null default 0 check (attempts >= 0),
  retry_after        timestamptz,
  primary key (tier, feature, row_key, hash_key),
  -- A desk_rows brief is the key's one shared brief; a client brief belongs to its hash alone.
  constraint record_briefs_hash_key check ((source = 'desk_rows' and hash_key = '')
                                        or (source = 'client' and hash_key = content_hash)),
  constraint record_briefs_brief_whole check ((headline is null) = (points is null) and (headline is null) = (written_at is null)),
  constraint record_briefs_pending_claimed check (status <> 'pending' or (claim_token is not null and claimed_at is not null)),
  constraint record_briefs_ready_written check (status <> 'ready' or written_at is not null),
  constraint record_briefs_failed_retry check (status <> 'failed' or retry_after is not null)
);

comment on table public.record_briefs is
  'F123: stored AI briefs of desk records, written by desk-brief (scope record) at the platform''s cost; client-sourced briefs are keyed by content hash.';

create table public.record_brief_quota (
  bucket        text        not null check (length(bucket) between 1 and 80),
  window_start  timestamptz not null,
  hits          integer     not null check (hits > 0),
  primary key (bucket, window_start)
);

comment on table public.record_brief_quota is
  'F123: record-brief generation counters (m:<user> per minute, d:<user> and g per UTC day); claim function only.';

alter table public.record_briefs enable row level security;
alter table public.record_brief_quota enable row level security;

-- Supabase default privileges grant everything on new public tables to the API roles; reset
-- them, then grant only what is needed.
revoke all on table public.record_briefs, public.record_brief_quota from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.record_briefs to service_role;
grant select on table public.record_brief_quota to service_role;
grant select (tier, feature, row_key, status, headline, points, model, written_at)
  on table public.record_briefs to authenticated;
-- Only desk_rows briefs: a client brief is served through the claim alone, which checks its hash.
create policy record_briefs_read on public.record_briefs for select to authenticated using (source = 'desk_rows');

-- The kill switch, off until the owner turns it on.
insert into public.app_flags (key, value) values ('record_briefs', 'false'::jsonb)
on conflict (key) do nothing;

-- Functions ----------------------------------------------------------------------------------

create function public.record_brief_claim(
  p_tier text, p_feature text, p_row_key text, p_hash text, p_source text, p_user uuid,
  p_user_per_minute integer, p_user_per_day integer, p_global_per_day integer
) returns jsonb
language plpgsql volatile security definer set search_path = '' set "TimeZone" = 'UTC' as $$
declare
  v_now   timestamptz := now();
  v_key   text;
  b       public.record_briefs;
  v_prev  jsonb;
  v_token uuid;
  v_on    boolean;
  v_hits  integer;
  q       record;
begin
  if p_tier is null or p_tier not in ('global', 'national', 'state', 'law', 'economics', 'carbon', 'sports', 'entertainment')
     or p_feature is null or length(p_feature) not between 1 and 300
     or p_row_key is null or length(p_row_key) not between 1 and 300
     or p_hash is null or p_hash !~ '^[0-9a-f]{24}$'
     or p_source is null or p_source not in ('desk_rows', 'client')
     or p_user is null
     or p_user_per_minute is null or p_user_per_minute not between 1 and 100000
     or p_user_per_day is null or p_user_per_day not between 1 and 100000
     or p_global_per_day is null or p_global_per_day not between 1 and 1000000 then
    raise exception 'record_brief_claim: invalid input' using errcode = '22023';
  end if;
  -- A client brief is addressed by its content: only the same hash ever reads or replaces it.
  v_key := case p_source when 'client' then p_hash else '' end;

  select * into b from public.record_briefs r
  where r.tier = p_tier and r.feature = p_feature and r.row_key = p_row_key and r.hash_key = v_key;
  if found and b.written_at is not null then
    v_prev := jsonb_build_object('headline', b.headline, 'points', b.points, 'model', b.model, 'written_at', b.written_at);
  end if;

  -- Not claimable: serve what is stored. Kept equal to the ON CONFLICT condition below.
  if found and not (
       (b.status = 'ready' and b.content_hash <> p_hash and (b.written_at is null or b.written_at < v_now - interval '24 hours'))
    or (b.status = 'pending' and b.claimed_at < v_now - interval '90 seconds' and (b.content_hash <> p_hash or b.attempts < 5))
    or (b.status = 'failed' and b.retry_after <= v_now and (b.content_hash <> p_hash or b.attempts < 5))) then
    if v_prev is not null then
      return jsonb_build_object('state', 'ready') || v_prev;
    end if;
    -- A pending row past its 90 seconds that may not be reclaimed is a generation that vanished.
    return jsonb_build_object('state', case when b.status = 'pending' and b.claimed_at >= v_now - interval '90 seconds'
                                            then 'pending' else 'failed' end);
  end if;

  -- Generation is wanted: the kill switch and the limits apply from here on only.
  select coalesce((select f.value = 'true'::jsonb from public.app_flags f where f.key = 'record_briefs'), false) into v_on;
  if not v_on then
    return coalesce(jsonb_build_object('state', 'ready') || v_prev, jsonb_build_object('state', 'unavailable', 'reason', 'off'));
  end if;

  begin
    insert into public.record_briefs as r
      (tier, feature, row_key, hash_key, source, content_hash, status, claim_token, claimed_at, attempts)
    values (p_tier, p_feature, p_row_key, v_key, p_source, p_hash, 'pending', gen_random_uuid(), v_now, 1)
    on conflict (tier, feature, row_key, hash_key) do update
      set content_hash = excluded.content_hash, status = 'pending', claim_token = excluded.claim_token,
          claimed_at = excluded.claimed_at, retry_after = null,
          attempts = case when r.content_hash = excluded.content_hash then r.attempts + 1 else 1 end
      where (r.status = 'ready' and r.content_hash <> excluded.content_hash
             and (r.written_at is null or r.written_at < v_now - interval '24 hours'))
         or (r.status = 'pending' and r.claimed_at < v_now - interval '90 seconds'
             and (r.content_hash <> excluded.content_hash or r.attempts < 5))
         or (r.status = 'failed' and r.retry_after <= v_now
             and (r.content_hash <> excluded.content_hash or r.attempts < 5))
    returning r.claim_token into v_token;

    if v_token is null then
      -- Another caller won the claim first: report what it left.
      select * into b from public.record_briefs r
      where r.tier = p_tier and r.feature = p_feature and r.row_key = p_row_key and r.hash_key = v_key;
      if b.written_at is not null then
        return jsonb_build_object('state', 'ready', 'headline', b.headline, 'points', b.points, 'model', b.model,
                                  'written_at', b.written_at);
      end if;
      return jsonb_build_object('state', case b.status when 'failed' then 'failed' else 'pending' end);
    end if;

    -- The claim is a generation: count it. Over any limit, the claim and the counts roll back.
    for q in
      select * from (values ('m:' || p_user::text, date_trunc('minute', v_now), p_user_per_minute),
                            ('d:' || p_user::text, date_trunc('day', v_now at time zone 'UTC') at time zone 'UTC', p_user_per_day),
                            ('g', date_trunc('day', v_now at time zone 'UTC') at time zone 'UTC', p_global_per_day)) v(bucket, win, lim)
    loop
      insert into public.record_brief_quota as c (bucket, window_start, hits) values (q.bucket, q.win, 1)
      on conflict (bucket, window_start) do update set hits = c.hits + 1
      returning c.hits into v_hits;
      if v_hits > q.lim then
        raise exception 'record_brief_limited';
      end if;
      if q.bucket = 'g' and v_hits = 1 then
        delete from public.record_brief_quota c where c.window_start < v_now - interval '2 days';
      end if;
    end loop;
  exception when raise_exception then
    if sqlerrm <> 'record_brief_limited' then
      raise;
    end if;
    return coalesce(jsonb_build_object('state', 'ready') || v_prev, jsonb_build_object('state', 'unavailable', 'reason', 'limited'));
  end;

  return jsonb_build_object('state', 'claimed', 'token', v_token, 'previous', v_prev);
end;
$$;

create function public.record_brief_finish(
  p_tier text, p_feature text, p_row_key text, p_token uuid, p_brief jsonb
) returns boolean
language plpgsql volatile security definer set search_path = '' set "TimeZone" = 'UTC' as $$
declare
  v_headline text;
  v_points   jsonb;
begin
  if p_token is null or p_tier is null or p_feature is null or p_row_key is null then
    raise exception 'record_brief_finish: invalid input' using errcode = '22023';
  end if;

  if p_brief is null then
    update public.record_briefs r
       set status = 'failed', claim_token = null,
           retry_after = now() + least(interval '10 minutes' * power(2, greatest(r.attempts, 1) - 1), interval '24 hours')
     where r.tier = p_tier and r.feature = p_feature and r.row_key = p_row_key
       and r.status = 'pending' and r.claim_token = p_token;
    return found;
  end if;

  v_headline := p_brief ->> 'headline';
  v_points := p_brief -> 'points';
  if jsonb_typeof(p_brief) <> 'object'
     or v_headline is null or length(v_headline) not between 1 and 300
     or jsonb_typeof(v_points) is distinct from 'array' or jsonb_array_length(v_points) not between 1 and 5
     or exists (select from jsonb_array_elements(v_points) e
                where jsonb_typeof(e) <> 'string' or length(e #>> '{}') not between 1 and 600) then
    raise exception 'record_brief_finish: invalid brief' using errcode = '22023';
  end if;

  update public.record_briefs r
     set status = 'ready', headline = v_headline, points = v_points,
         model = nullif(left(p_brief ->> 'model', 200), ''),
         prompt_tokens = round((p_brief ->> 'prompt_tokens')::numeric)::integer,
         completion_tokens = round((p_brief ->> 'completion_tokens')::numeric)::integer,
         reasoning_tokens = round((p_brief ->> 'reasoning_tokens')::numeric)::integer,
         cost_usd = (p_brief ->> 'cost_usd')::numeric,
         model_call_log_id = (p_brief ->> 'model_call_log_id')::uuid,
         written_at = now(), attempts = 0, retry_after = null, claim_token = null
   where r.tier = p_tier and r.feature = p_feature and r.row_key = p_row_key
     and r.status = 'pending' and r.claim_token = p_token;
  return found;
end;
$$;

revoke all on function public.record_brief_claim(text, text, text, text, text, uuid, integer, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.record_brief_finish(text, text, text, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.record_brief_claim(text, text, text, text, text, uuid, integer, integer, integer) to service_role;
grant execute on function public.record_brief_finish(text, text, text, uuid, jsonb) to service_role;
