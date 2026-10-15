-- The record brief takes the analysis box's shape (open-work F123; owner decision 2026-10-15).
--
-- The AI record brief now has the shape of the blue "Niyantran analysis" box: a lead brief, why it
-- matters, what to watch for, and up to four tags. desk-brief writes it as format 2; briefs written
-- before (a headline and three points) are format 1.
--
-- 20261015220000_record_briefs.sql is applied to NTER and is not edited. The smallest change that
-- stores the new shape:
--
--   * record_briefs.brief_format smallint, not null, default 1 (every stored brief is format 1).
--     A format-2 brief keeps its lead brief in headline (now 1-600 characters; format 1 keeps its
--     1-300) and {why, watch, tags} in points, as an object (format 1 keeps its array of 1-5
--     points). Both checks are restated with the same names. authenticated may also read
--     brief_format (so a direct reader can tell the shapes apart); still never cost or tokens.
--   * record_brief_claim(... , p_format integer default 1) -> jsonb  (replaces the 9-argument one)
--       As in 20261015220000, with one more claimable case: a ready row whose stored brief is of an
--       older format than p_format is claimed, whatever its hash and however recently it was
--       written. Finishing writes p_format, so this happens once per row; a failed regeneration
--       follows the usual backoff and five-failure cap for the hash, serving the old brief
--       meanwhile, as do the kill switch and the limits. Every brief the claim returns (ready,
--       previous) also carries format. p_format defaults to 1 so the desk-brief already deployed
--       (9 named arguments) keeps working between this migration and its own deploy; it never
--       regenerates anything. Invalid input raises 22023, p_format outside 1-1000 included.
--   * record_brief_finish(p_tier, p_feature, p_row_key, p_token, p_brief) -> boolean  (replaced)
--       As in 20261015220000, with p_brief's optional format (an integer 1-1000; absent means 1):
--         format 1: headline 1-300 characters, points 1-5 strings of 1-600 characters (unchanged);
--         format 2+: headline (the lead brief) 1-600 characters, points an object with exactly
--           why (a string of 1-600 characters), watch (a string of 0-600) and tags (an array of
--           at most 4 strings of 1-40 characters).
--       The row's brief_format becomes that format. Anything else raises 22023.
--
-- No BEGIN/COMMIT: the migration tool runs each file in one transaction.
--
-- Down (manual): format-2 briefs are turned back into format-1 ones (the lead brief, why and
-- watch become the points; the tags are lost), then 20261015220000's definitions are put back.
--   begin;
--   drop function public.record_brief_claim(text, text, text, text, text, uuid, integer, integer, integer, integer);
--   drop function public.record_brief_finish(text, text, text, uuid, jsonb);
--   update public.record_briefs r set brief_format = 1, headline = left(r.headline, 300),
--     points = jsonb_build_array(r.headline) || coalesce((select jsonb_agg(v) from (values (r.points ->> 'why'), (r.points ->> 'watch')) x(v) where v <> ''), '[]'::jsonb)
--     where r.brief_format <> 1 and r.points is not null;
--   alter table public.record_briefs drop constraint record_briefs_headline_check, drop constraint record_briefs_points_check;
--   alter table public.record_briefs drop column brief_format;
--   alter table public.record_briefs add constraint record_briefs_headline_check check (length(headline) between 1 and 300),
--     add constraint record_briefs_points_check check (jsonb_typeof(points) = 'array' and jsonb_array_length(points) between 1 and 5);
--   -- run 20261015220000_record_briefs.sql's create function public.record_brief_claim and public.record_brief_finish
--   revoke all on function public.record_brief_claim(text, text, text, text, text, uuid, integer, integer, integer) from public, anon, authenticated, service_role;
--   revoke all on function public.record_brief_finish(text, text, text, uuid, jsonb) from public, anon, authenticated, service_role;
--   grant execute on function public.record_brief_claim(text, text, text, text, text, uuid, integer, integer, integer) to service_role;
--   grant execute on function public.record_brief_finish(text, text, text, uuid, jsonb) to service_role;
--   commit;

-- Table ----------------------------------------------------------------------------------------

alter table public.record_briefs
  add column brief_format smallint not null default 1 check (brief_format between 1 and 1000);

comment on column public.record_briefs.brief_format is
  'F123: the stored brief''s shape: 1 = headline + points[1-5]; 2+ = lead brief in headline, {why, watch, tags} in points.';

-- A CASE, so jsonb_array_length never sees an object.
alter table public.record_briefs
  drop constraint record_briefs_headline_check,
  drop constraint record_briefs_points_check,
  add constraint record_briefs_headline_check
    check (length(headline) between 1 and case when brief_format = 1 then 300 else 600 end),
  add constraint record_briefs_points_check
    check (case jsonb_typeof(points)
             when 'array' then brief_format = 1 and jsonb_array_length(points) between 1 and 5
             when 'object' then brief_format >= 2
             else points is null end);

grant select (brief_format) on table public.record_briefs to authenticated;

-- Functions ----------------------------------------------------------------------------------

drop function public.record_brief_claim(text, text, text, text, text, uuid, integer, integer, integer);

create function public.record_brief_claim(
  p_tier text, p_feature text, p_row_key text, p_hash text, p_source text, p_user uuid,
  p_user_per_minute integer, p_user_per_day integer, p_global_per_day integer, p_format integer default 1
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
     or p_global_per_day is null or p_global_per_day not between 1 and 1000000
     or p_format is null or p_format not between 1 and 1000 then
    raise exception 'record_brief_claim: invalid input' using errcode = '22023';
  end if;
  -- A client brief is addressed by its content: only the same hash ever reads or replaces it.
  v_key := case p_source when 'client' then p_hash else '' end;

  select * into b from public.record_briefs r
  where r.tier = p_tier and r.feature = p_feature and r.row_key = p_row_key and r.hash_key = v_key;
  if found and b.written_at is not null then
    v_prev := jsonb_build_object('headline', b.headline, 'points', b.points, 'model', b.model, 'written_at', b.written_at,
                                 'format', b.brief_format);
  end if;

  -- Not claimable: serve what is stored. Kept equal to the ON CONFLICT condition below.
  if found and not (
       (b.status = 'ready' and b.brief_format < p_format)
    or (b.status = 'ready' and b.content_hash <> p_hash and (b.written_at is null or b.written_at < v_now - interval '24 hours'))
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
      where (r.status = 'ready' and r.brief_format < p_format)
         or (r.status = 'ready' and r.content_hash <> excluded.content_hash
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
                                  'written_at', b.written_at, 'format', b.brief_format);
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

create or replace function public.record_brief_finish(
  p_tier text, p_feature text, p_row_key text, p_token uuid, p_brief jsonb
) returns boolean
language plpgsql volatile security definer set search_path = '' set "TimeZone" = 'UTC' as $$
declare
  v_headline text;
  v_points   jsonb;
  v_format   integer;
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

  if jsonb_typeof(p_brief) <> 'object' then
    raise exception 'record_brief_finish: invalid brief' using errcode = '22023';
  end if;
  -- An absent format is 1: the shape the desk-brief deployed before this migration writes.
  if p_brief ? 'format' and (jsonb_typeof(p_brief -> 'format') <> 'number'
                             or (p_brief ->> 'format')::numeric not between 1 and 1000
                             or (p_brief ->> 'format')::numeric <> trunc((p_brief ->> 'format')::numeric)) then
    raise exception 'record_brief_finish: invalid brief' using errcode = '22023';
  end if;
  v_format := coalesce((p_brief ->> 'format')::numeric::integer, 1);
  v_headline := p_brief ->> 'headline';
  v_points := p_brief -> 'points';
  -- The CASE is in parentheses: PL/pgSQL reads an IF condition up to the first THEN outside them.
  if v_headline is null or length(v_headline) not between 1 and (case when v_format = 1 then 300 else 600 end) then
    raise exception 'record_brief_finish: invalid brief' using errcode = '22023';
  end if;
  if v_format = 1 then
    if jsonb_typeof(v_points) is distinct from 'array' or jsonb_array_length(v_points) not between 1 and 5
       or exists (select from jsonb_array_elements(v_points) e
                  where jsonb_typeof(e) <> 'string' or length(e #>> '{}') not between 1 and 600) then
      raise exception 'record_brief_finish: invalid brief' using errcode = '22023';
    end if;
  elsif jsonb_typeof(v_points) is distinct from 'object'
     or not (v_points ?& array['why', 'watch', 'tags'])
     or (v_points - array['why', 'watch', 'tags']) <> '{}'::jsonb
     or jsonb_typeof(v_points -> 'why') <> 'string' or length(v_points ->> 'why') not between 1 and 600
     or jsonb_typeof(v_points -> 'watch') <> 'string' or length(v_points ->> 'watch') > 600
     or jsonb_typeof(v_points -> 'tags') <> 'array' or jsonb_array_length(v_points -> 'tags') > 4
     or exists (select from jsonb_array_elements(v_points -> 'tags') e
                where jsonb_typeof(e) <> 'string' or length(e #>> '{}') not between 1 and 40) then
    raise exception 'record_brief_finish: invalid brief' using errcode = '22023';
  end if;

  update public.record_briefs r
     set status = 'ready', headline = v_headline, points = v_points, brief_format = v_format,
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

revoke all on function public.record_brief_claim(text, text, text, text, text, uuid, integer, integer, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.record_brief_finish(text, text, text, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.record_brief_claim(text, text, text, text, text, uuid, integer, integer, integer, integer) to service_role;
grant execute on function public.record_brief_finish(text, text, text, uuid, jsonb) to service_role;
