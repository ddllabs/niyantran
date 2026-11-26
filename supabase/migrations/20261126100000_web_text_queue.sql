-- Regulatory web-page text queue (F369). Spec: docs/specs/2026-11-23-regulatory-web-text-firecrawl.md (Status: Living).
-- Pattern: the Budget OCR queue, 20261125100000_budget_ocr_queue.sql, which this file does not touch.
--
-- 7,728 Regulatory records (RBI press releases and notifications, three SEBI pages) carry text the pack took from the
-- official web page with a plain HTML-to-text pass. Their page is scraped again by Firecrawl, from a Supabase Edge function
-- that holds the Firecrawl key, so no key is on the operator's laptop. A queue in the database carries the work:
--
--   corpus_ingest (the runner's login)  --enqueue-->  private.web_text_requests  <--claim/finish/fail--  web-text Edge
--   function (service role, FIRECRAWL_API_KEY, gives Firecrawl the official page URL)  --markdown-->  corpus_ingest reads
--   it back by key.
--
-- The text then goes through the existing five-desk supplied-text route (screen, batch policy, spend stops): nothing here
-- admits a document. Only the record's own official web page is scraped, never the blocked PDF (decision D2, 2026-11-23).
--
-- WHAT THIS CREATES (nothing is read from or written to any existing table):
--   private.web_text_settings   one row: the spend cap (US$0: nothing can be claimed until the developer sets it), the price
--                               of a Firecrawl credit (US$0.005), the switch (OFF), the function's URL (empty), attempts (2),
--                               the halt rule's limit (5) and its run counter, and why the run last switched itself off.
--   private.web_text_requests   the queue: source key, desk, official URL, the pack's sha256, status, credits and cost, the
--                               markdown text and its sha256, the site's status, the final host, the content type, the
--                               error code, timestamps.
--   private.web_text_url_ok(text)        the URL rule (below); used by enqueue and by the table's check.
--   private.web_text_committed()         money spent plus money reserved by running requests.
--   public.web_text_enqueue(jsonb)       corpus_ingest, service_role: queue up to 50 requests.
--   public.web_text_read(text[])         corpus_ingest, service_role: requests by source key, the text only when done.
--   public.web_text_status()             corpus_ingest, service_role: counts by status and code, money, the cap, the switch.
--   public.web_text_claim / _finish / _fail   service_role only (the Edge function): the cap is enforced in claim.
--   private.web_text_tick()              what the cron job runs: does nothing unless the switch is on, a URL is set, work is
--                                        queued, the cap leaves room and the vault holds 'web_text_secret'; then posts to
--                                        the function with the secret header (pg_net, vault).
--   cron job 'web-text' (every minute, decision D8; where pg_cron is installed): INERT while settings.enabled is false and
--                               while the cap is 0. Applying this migration starts no spend.
--
-- THE URL RULE (enqueue refuses anything else, and the table's check holds the same rule): the host is one of the Regulatory
-- desk's hosts in public.ingest_search_only_desks(), and the URL is exactly one of
--   ^https://www\.rbi\.org\.in/Scripts/BS_PressReleaseDisplay\.aspx\?prid=[0-9]{1,7}$
--   ^https://www\.rbi\.org\.in/Scripts/NotificationUser\.aspx\?Id=[0-9]{1,7}$
--   ^https://www\.sebi\.gov\.in/[a-z0-9/_.-]{1,400}\.html$ (written as + with a length check: PostgreSQL caps a count at 255)
-- with the screen's path checks (billUrlSegmentsOk): no control character or backslash, no encoded separator, no . or ..
-- path segment. No rbidocs.rbi.org.in URL (the blocked PDFs) is accepted.
--
-- THE SPEND CAP (in the database): committed = what finished or uncertain attempts may have cost (spent_usd) + the estimate
-- of every running request. claim locks the settings row and refuses the next request when committed + its estimate would
-- pass cap_usd ('cap'). A scrape is one credit; the estimate is one credit at the CURRENT usd_per_credit, computed here at
-- claim, never taken from the caller, and it is the price finish and fail then charge (a price changed while the scrape ran
-- does not reach it). Money is counted by the failure code, conservatively:
--   a scrape that returned a document (done, source_status_nnn, not_html, redirected, redirected_off_host, empty_text,
--     firecrawl_too_large, report_failed, finish_invalid, text_too_long): 1 credit;
--   firecrawl_rejected (400), firecrawl_forbidden (401, 403), firecrawl_no_credits (402), firecrawl_rate_limited (429),
--     official_url_invalid (the function's own URL check refused it; nothing was sent): nothing, unless the caller says the
--     attempt may have been billed;
--   anything else (a timeout, a 5xx, a dropped connection, an unreadable answer, a duplicate request id, a lost lease, an
--     unknown code): its whole estimate, since it may have been billed.
-- A 429 gives its attempt back (it was refused before any scrape), so a rate limit never uses up a request's tries.
--
-- THE HALT RULE (in the database): every failure that counted money (billed, or uncertain and charged its estimate: a site
-- status, not_html, redirected, empty_text, firecrawl_too_large, a timeout, a 5xx, an unreadable answer, a duplicate id,
-- report_failed, an unknown code, and a lapsed lease, which claim counts) adds one to a run counter, and a done request
-- sets it back to 0. When the counter reaches halt_source_errors the run switches itself OFF (halted_reason
-- 'source_errors'); this bounds the case where the site, or Firecrawl, fails every request and each failure may still be
-- billed. firecrawl_forbidden, firecrawl_no_credits and firecrawl_rejected (a wrong key, no credits left, a request body
-- Firecrawl refuses: each would fail every request the same way) switch the run OFF at once.
--
-- ENABLE (developer's yes, as postgres, after the function is deployed and its secrets are set; WEB_TEXT_SECRET must be at
-- least 32 characters or the function answers 503, and the same value is in the vault as 'web_text_secret'):
--   update private.web_text_settings set function_url = 'https://<project-ref>.supabase.co/functions/v1/web-text',
--                                        cap_usd = <the agreed cap>, enabled = true, halted_reason = null;
-- DISABLE: update private.web_text_settings set enabled = false;   (claim also refuses while it is false)
--
-- Privileges: nothing for anon, authenticated or PUBLIC on the tables, the schema or any function; RLS is on with no policy.
-- Every function is SECURITY DEFINER with search_path pg_catalog, pg_temp and schema-qualified names.
--
-- Down (nothing else depends on these objects):
--   begin;
--   --   select cron.unschedule(jobid) from cron.job where jobname = 'web-text';   (where pg_cron is installed)
--   drop function public.web_text_enqueue(jsonb), public.web_text_read(text[]), public.web_text_status(),
--     public.web_text_claim(integer, integer), public.web_text_finish(uuid, uuid, jsonb),
--     public.web_text_fail(uuid, uuid, text, boolean, boolean), private.web_text_tick(), private.web_text_committed();
--   drop table private.web_text_requests, private.web_text_settings;
--   drop function private.web_text_url_ok(text);
--   commit;
-- (The private schema is left: other migrations use it. The vault secret 'web_text_secret' is left too: delete it from
-- vault.secrets if it is no longer wanted.)

begin;
set local lock_timeout = '10s';

create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role, corpus_ingest;

-- ---------------------------------------------------------------------------
-- The URL rule. Immutable (it reads nothing), so the table's check can use it; the host list is checked in enqueue.

create function private.web_text_url_ok(p_url text) returns boolean
language sql immutable security definer set search_path = pg_catalog, pg_temp as $$
  select p_url is not null and octet_length(p_url) <= 2000
     and (p_url ~ '^https://www\.rbi\.org\.in/Scripts/BS_PressReleaseDisplay\.aspx\?prid=[0-9]{1,7}$'
          or p_url ~ '^https://www\.rbi\.org\.in/Scripts/NotificationUser\.aspx\?Id=[0-9]{1,7}$'
          -- [a-z0-9/_.-]{1,400}: PostgreSQL caps a repetition count at 255, so the 1 to 400 is a length check on the part
          -- between 'https://www.sebi.gov.in/' (24 characters) and '.html' (5).
          or (p_url ~ '^https://www\.sebi\.gov\.in/[a-z0-9/_.-]+\.html$' and char_length(p_url) - 29 between 1 and 400))
     -- The screen's own path check (billUrlSegmentsOk): no control character or backslash anywhere; before any ? or #,
     -- no encoded separator (%2f, %5c) and no . or .. path segment (plain, encoded or with a path parameter).
     and p_url !~ '[\x01-\x1f\x7f\\]'
     and split_part(split_part(p_url, '?', 1), '#', 1) !~* '%2f|%5c'
     and split_part(split_part(p_url, '?', 1), '#', 1) !~* '(^|/)(\.|%2e){1,2}((;|%3b)[^/]*)?(/|$)';
$$;

-- ---------------------------------------------------------------------------
-- Tables.

create table private.web_text_settings (
  singleton           boolean primary key default true check (singleton),
  cap_usd             numeric not null default 0 check (cap_usd >= 0 and cap_usd <= 100),
  usd_per_credit      numeric not null default 0.005 check (usd_per_credit > 0 and usd_per_credit <= 0.1),
  enabled             boolean not null default false,
  function_url        text check (function_url is null or function_url ~ '^https://[a-z0-9]{20}\.supabase\.co/functions/v1/web-text$'),
  max_attempts        integer not null default 2 check (max_attempts between 1 and 5),
  halt_source_errors  integer not null default 5 check (halt_source_errors between 1 and 100),
  source_error_run    integer not null default 0 check (source_error_run >= 0),
  halted_reason       text check (halted_reason is null or halted_reason in ('source_errors', 'firecrawl_forbidden', 'firecrawl_no_credits', 'firecrawl_rejected')),
  updated_at          timestamptz not null default now()
);
insert into private.web_text_settings (singleton) values (true);

create table private.web_text_requests (
  id              uuid primary key default gen_random_uuid(),
  source_key      text not null unique check (source_key ~ '^[0-9a-f]{40}$'),
  desk_feature    text not null check (desk_feature = 'Regulatory Body Watch (RBI SEBI TRAI CCI)'),
  official_url    text not null unique check (private.web_text_url_ok(official_url)),
  pack_sha256     text not null check (pack_sha256 ~ '^[0-9a-f]{64}$'),
  status          text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  estimate_usd    numeric not null check (estimate_usd > 0),
  spent_usd       numeric not null default 0 check (spent_usd >= 0),
  attempts        integer not null default 0,
  claim_token     uuid,
  lease_until     timestamptz,
  credits         integer not null default 0 check (credits >= 0),
  cost_usd        numeric,
  text            text check (text is null or char_length(text) <= 2000000),
  text_sha256     text check (text_sha256 is null or text_sha256 ~ '^[0-9a-f]{64}$'),
  source_status   integer check (source_status is null or source_status between 100 and 599),
  final_url_host  text check (final_url_host is null or final_url_host ~ '^[a-z0-9.:-]{1,255}$'),
  content_type    text check (content_type is null or char_length(content_type) <= 200),
  scraped_at      timestamptz,
  error_code      text check (error_code is null or error_code ~ '^[a-z0-9_]{1,64}$'),
  created_at      timestamptz not null default now(),
  claimed_at      timestamptz,
  finished_at     timestamptz,
  check ((status = 'running') = (claim_token is not null and lease_until is not null)),
  check (status <> 'done' or (text is not null and text_sha256 is not null and cost_usd is not null and source_status = 200
                              and final_url_host is not null and scraped_at is not null)),
  check (status = 'done' or text is null)
);
create index web_text_requests_queue on private.web_text_requests (status, created_at, id) where status in ('queued', 'running');

alter table private.web_text_settings enable row level security;
alter table private.web_text_requests enable row level security;
revoke all on private.web_text_settings, private.web_text_requests from public, anon, authenticated, service_role, corpus_ingest;

-- ---------------------------------------------------------------------------
-- What has been spent or is reserved.

create function private.web_text_committed() returns numeric
language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select coalesce(sum(spent_usd), 0) + coalesce(sum(estimate_usd) filter (where status = 'running'), 0)
  from private.web_text_requests;
$$;

-- ---------------------------------------------------------------------------
-- Enqueue (corpus_ingest). One element: {source_key, official_url, pack_sha256}. Any other field is ignored.

create function public.web_text_enqueue(p_items jsonb) returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, pg_temp as $$
declare
  c_desk  constant text := 'Regulatory Body Watch (RBI SEBI TRAI CCI)';
  v_hosts text[];
  v_rate  numeric;
  v_item  jsonb;
  v_out   jsonb := '[]'::jsonb;
  v_key   text;
  v_url   text;
  v_sha   text;
  v_host  text;
  v_id    uuid;
  v_why   text;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'web_text_enqueue: items must be a JSON list' using errcode = '22023'; end if;
  if jsonb_array_length(p_items) > 50 then raise exception 'web_text_enqueue: at most 50 items a call' using errcode = '22023'; end if;
  select d.hosts into v_hosts from public.ingest_search_only_desks() d where d.desk_feature = c_desk;
  select usd_per_credit into v_rate from private.web_text_settings;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_why := null; v_key := null; v_url := null; v_sha := null; v_host := null;
    if jsonb_typeof(v_item) <> 'object' then
      v_why := 'item_shape';
    else
      v_key := case when jsonb_typeof(v_item -> 'source_key') = 'string' then v_item ->> 'source_key' end;
      v_url := case when jsonb_typeof(v_item -> 'official_url') = 'string' then v_item ->> 'official_url' end;
      v_sha := case when jsonb_typeof(v_item -> 'pack_sha256') = 'string' then v_item ->> 'pack_sha256' end;
      v_host := substring(v_url from '^https://([^/@:?#]+)/');
      if v_key is null or v_key !~ '^[0-9a-f]{40}$' then v_why := 'source_key';
      elsif not coalesce(private.web_text_url_ok(v_url), false) then v_why := 'official_url';
      elsif v_hosts is null or v_host is null or not (v_host = any (v_hosts)) then v_why := 'host_not_official';
      elsif v_sha is null or v_sha !~ '^[0-9a-f]{64}$' then v_why := 'pack_sha256';
      end if;
    end if;
    if v_why is not null then
      v_out := v_out || jsonb_build_object('source_key', v_key, 'outcome', 'refused', 'reason', v_why);
      continue;
    end if;
    insert into private.web_text_requests (source_key, desk_feature, official_url, pack_sha256, estimate_usd)
    values (v_key, c_desk, v_url, v_sha, v_rate)
    on conflict do nothing
    returning id into v_id;
    if v_id is null then
      v_out := v_out || jsonb_build_object('source_key', v_key, 'outcome', 'refused', 'reason', 'duplicate');
    else
      v_out := v_out || jsonb_build_object('source_key', v_key, 'outcome', 'queued');
    end if;
    v_id := null;
  end loop;
  return jsonb_build_object('results', v_out);
end;
$$;

-- ---------------------------------------------------------------------------
-- Read back (corpus_ingest): by source key; the text only when the request is done.

create function public.web_text_read(p_keys text[]) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
begin
  if p_keys is null or cardinality(p_keys) < 1 or cardinality(p_keys) > 50 then
    raise exception 'web_text_read: 1 to 50 keys a call' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'source_key', r.source_key, 'official_url', r.official_url, 'pack_sha256', r.pack_sha256, 'status', r.status,
      'credits', r.credits, 'cost_usd', r.cost_usd, 'error_code', r.error_code, 'attempts', r.attempts,
      'source_status', r.source_status, 'final_url_host', r.final_url_host, 'content_type', r.content_type,
      'scraped_at', r.scraped_at, 'text_sha256', r.text_sha256,
      'text', case when r.status = 'done' then r.text end)
      order by r.source_key)
    from private.web_text_requests r where r.source_key = any (p_keys)), '[]'::jsonb);
end;
$$;

create function public.web_text_status() returns jsonb
language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select jsonb_build_object(
    'by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from private.web_text_requests group by status) t), '{}'::jsonb),
    'by_code', coalesce((select jsonb_object_agg(error_code, n) from (select error_code, count(*) n from private.web_text_requests
                          where error_code is not null group by error_code) t), '{}'::jsonb),
    'credits', (select coalesce(sum(credits), 0) from private.web_text_requests),
    'committed_usd', private.web_text_committed(),
    'cap_usd', s.cap_usd, 'usd_per_credit', s.usd_per_credit, 'enabled', s.enabled,
    'function_url_set', s.function_url is not null, 'source_error_run', s.source_error_run, 'halted_reason', s.halted_reason)
  from private.web_text_settings s;
$$;

-- ---------------------------------------------------------------------------
-- Claim (service_role): the spend cap is enforced here, under a lock on the settings row.

create function public.web_text_claim(p_limit integer default 1, p_lease_seconds integer default 300) returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, pg_temp as $$
declare
  s          private.web_text_settings;
  v_commit   numeric;
  v_refused  text := null;
  v_out      jsonb := '[]'::jsonb;
  r          private.web_text_requests;
  v_token    uuid;
  v_est      numeric;
  v_lapsed   integer;
  v_run      integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 5 then raise exception 'web_text_claim: limit 1 to 5' using errcode = '22023'; end if;
  if p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 900 then raise exception 'web_text_claim: lease 30 to 900 seconds' using errcode = '22023'; end if;
  select * into s from private.web_text_settings for update;
  if not s.enabled then
    return jsonb_build_object('claimed', '[]'::jsonb, 'refused', 'disabled');
  end if;
  -- A request whose lease ran out was lost without an answer: its estimate counts as spent, and it is queued again or failed.
  update private.web_text_requests
     set spent_usd = spent_usd + estimate_usd,
         status = case when attempts >= s.max_attempts then 'failed' else 'queued' end,
         error_code = 'lease_expired', claim_token = null, lease_until = null,
         finished_at = case when attempts >= s.max_attempts then now() end
   where status = 'running' and lease_until < now();
  -- A lapsed lease is an uncertain failure: it counts toward the halt rule like any other (web_text_fail's rule).
  get diagnostics v_lapsed = row_count;
  if v_lapsed > 0 then
    v_run := s.source_error_run + v_lapsed;
    if v_run >= s.halt_source_errors then
      update private.web_text_settings set enabled = false, halted_reason = 'source_errors', source_error_run = 0, updated_at = now();
      return jsonb_build_object('claimed', '[]'::jsonb, 'refused', 'disabled', 'halted', 'source_errors');
    end if;
    update private.web_text_settings set source_error_run = v_run, updated_at = now();
  end if;
  v_commit := private.web_text_committed();
  for r in
    select * from private.web_text_requests where status = 'queued' order by created_at, id for update skip locked limit p_limit
  loop
    -- One credit at the CURRENT price, not the one in force when the request was queued.
    v_est := s.usd_per_credit;
    if v_commit + v_est > s.cap_usd then v_refused := 'cap'; exit; end if;
    v_token := gen_random_uuid();
    update private.web_text_requests
       set status = 'running', attempts = attempts + 1, claim_token = v_token, claimed_at = now(), estimate_usd = v_est,
           lease_until = now() + make_interval(secs => p_lease_seconds), error_code = null
     where id = r.id;
    v_commit := v_commit + v_est;
    -- The attempt goes with the id into the x-request-id, so a retry is a new Firecrawl request.
    v_out := v_out || jsonb_build_object('id', r.id, 'token', v_token, 'source_key', r.source_key, 'official_url', r.official_url,
                                         'attempt', r.attempts + 1);
  end loop;
  return jsonb_build_object('claimed', v_out, 'refused', v_refused, 'committed_usd', v_commit, 'cap_usd', s.cap_usd);
end;
$$;

-- ---------------------------------------------------------------------------
-- Finish (service_role). p_result: {text, source_status, final_url_host, content_type}. The cost is one credit at the price
-- reserved at claim (estimate_usd); the text's sha256 is computed here. A result the done rule does not accept (site status
-- not 200, final host not the official URL's, a content type that is not HTML, an empty or non-string text) fails it for good as
-- finish_invalid, keeps no text and still counts the credit; a text over 2,000,000 characters fails as text_too_long. A
-- done request ends the halt rule's run of source errors.

create function public.web_text_finish(p_id uuid, p_token uuid, p_result jsonb) returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, pg_temp as $$
declare
  s        private.web_text_settings;
  r        private.web_text_requests;
  v_cost   numeric;
  v_text   text;
  v_status integer;
  v_host   text;
  v_ctype  text;
  v_code   text := null;
begin
  -- The settings row first (as claim and fail take it), then the request: one lock order for all three.
  select * into s from private.web_text_settings for update;
  select * into r from private.web_text_requests where id = p_id for update;
  if not found or r.status <> 'running' or r.claim_token is distinct from p_token then
    return jsonb_build_object('outcome', 'stale');
  end if;
  -- The price reserved at claim, not the current one: a price changed while the scrape ran does not reach it.
  v_cost := r.estimate_usd;
  if p_result is null or jsonb_typeof(p_result) <> 'object' then
    v_code := 'finish_invalid';
  else
    v_text := case when jsonb_typeof(p_result -> 'text') = 'string' then p_result ->> 'text' end;
    v_status := case when jsonb_typeof(p_result -> 'source_status') = 'number' and (p_result ->> 'source_status') ~ '^[0-9]{3}$'
                     then (p_result ->> 'source_status')::integer end;
    v_host := case when jsonb_typeof(p_result -> 'final_url_host') = 'string' then p_result ->> 'final_url_host' end;
    v_ctype := case when jsonb_typeof(p_result -> 'content_type') = 'string' then left(p_result ->> 'content_type', 200) end;
    if v_text is null or v_text !~ '[^[:space:]]' or v_status is distinct from 200
       or v_ctype is null or v_ctype !~* '^\s*(text/html|application/xhtml\+xml)\s*(;|$)'
       or v_host is distinct from substring(r.official_url from '^https://([^/]+)/') then
      v_code := 'finish_invalid';
    elsif char_length(v_text) > 2000000 then
      v_code := 'text_too_long';
    end if;
  end if;
  if v_code is not null then
    update private.web_text_requests
       set status = 'failed', credits = credits + 1, cost_usd = coalesce(cost_usd, 0) + v_cost, spent_usd = spent_usd + v_cost,
           text = null, error_code = v_code, claim_token = null, lease_until = null, finished_at = now()
     where id = p_id;
    return jsonb_build_object('outcome', 'failed', 'code', v_code, 'cost_usd', v_cost);
  end if;
  update private.web_text_requests
     set status = 'done', credits = credits + 1, cost_usd = coalesce(cost_usd, 0) + v_cost, spent_usd = spent_usd + v_cost,
         text = v_text, text_sha256 = encode(sha256(convert_to(v_text, 'UTF8')), 'hex'), source_status = v_status,
         final_url_host = v_host, content_type = v_ctype, scraped_at = now(),
         error_code = null, claim_token = null, lease_until = null, finished_at = now()
   where id = p_id;
  update private.web_text_settings set source_error_run = 0, updated_at = now() where source_error_run <> 0;
  return jsonb_build_object('outcome', 'done', 'cost_usd', v_cost);
end;
$$;

-- ---------------------------------------------------------------------------
-- Fail (service_role). The money and whether the request is tried again follow the code (the header's table); p_uncertain
-- (the attempt may have been billed) can only add money, and p_permanent can only end the request sooner. Otherwise the
-- request is queued again until max_attempts (a 429 gives its attempt back). Money is charged at the price reserved at
-- claim (estimate_usd). Then the halt rule.

create function public.web_text_fail(p_id uuid, p_token uuid, p_code text, p_uncertain boolean, p_permanent boolean) returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, pg_temp as $$
declare
  s        private.web_text_settings;
  r        private.web_text_requests;
  v_code   text := case when p_code ~ '^[a-z0-9_]{1,64}$' then p_code else 'unknown' end;
  v_billed boolean;
  v_free   boolean;
  v_rl     boolean;
  v_counts boolean;
  v_money  numeric;
  v_stop   boolean;
  v_run    integer;
  v_halt   text := null;
begin
  select * into s from private.web_text_settings for update;
  select * into r from private.web_text_requests where id = p_id for update;
  if not found or r.status <> 'running' or r.claim_token is distinct from p_token then
    return jsonb_build_object('outcome', 'stale');
  end if;
  -- A scrape that returned a document was billed one credit.
  v_billed := v_code ~ '^source_status_[0-9]{3}$'
              or v_code in ('not_html', 'redirected', 'redirected_off_host', 'empty_text', 'firecrawl_too_large', 'report_failed');
  -- Refused by Firecrawl before any scrape, or never sent (the function's own URL check): not billed.
  v_free := v_code in ('firecrawl_rejected', 'firecrawl_forbidden', 'firecrawl_no_credits', 'firecrawl_rate_limited',
                       'official_url_invalid');
  -- Billed, or uncertain and charged its estimate: the failures the halt rule counts.
  v_counts := v_billed or not v_free or coalesce(p_uncertain, false);
  v_money := case when v_counts then r.estimate_usd else 0 end;
  -- A 429 was refused before any scrape: it gives its attempt back and is not ended by max_attempts.
  v_rl := v_code = 'firecrawl_rate_limited';
  v_stop := coalesce(p_permanent, false) or (r.attempts >= s.max_attempts and not v_rl)
            or v_code in ('not_html', 'redirected', 'redirected_off_host', 'empty_text', 'firecrawl_too_large', 'report_failed',
                          'official_url_invalid', 'firecrawl_rejected', 'firecrawl_forbidden', 'firecrawl_no_credits');
  update private.web_text_requests
     set status = case when v_stop then 'failed' else 'queued' end,
         attempts = attempts - case when v_rl then 1 else 0 end,
         spent_usd = spent_usd + v_money,
         credits = credits + case when v_billed then 1 else 0 end,
         cost_usd = case when v_billed then coalesce(cost_usd, 0) + v_money else cost_usd end,
         error_code = v_code, claim_token = null, lease_until = null,
         finished_at = case when v_stop then now() end
   where id = p_id;
  -- The halt rule: a wrong key, no credits or a refused request body stops the run at once; a run of failures that counted
  -- money (billed or uncertain) stops it at halt_source_errors.
  v_run := s.source_error_run;
  if v_code in ('firecrawl_forbidden', 'firecrawl_no_credits', 'firecrawl_rejected') then
    v_halt := v_code;
  elsif v_counts then
    v_run := v_run + 1;
    if v_run >= s.halt_source_errors then v_halt := 'source_errors'; end if;
  end if;
  if v_halt is not null then
    update private.web_text_settings set enabled = false, halted_reason = v_halt, source_error_run = 0, updated_at = now();
  elsif v_run <> s.source_error_run then
    update private.web_text_settings set source_error_run = v_run, updated_at = now();
  end if;
  return jsonb_build_object('outcome', case when v_stop then 'failed' else 'queued' end, 'halted', v_halt);
end;
$$;

-- ---------------------------------------------------------------------------
-- The cron job's body. Inert unless settings.enabled, a function URL and queued work exist, one more credit still fits
-- under the cap (or a lapsed lease is waiting to be counted), and the vault holds the secret.

create function private.web_text_tick() returns text
language plpgsql volatile security definer set search_path = pg_catalog, pg_temp as $$
declare
  s        private.web_text_settings;
  v_secret text;
begin
  select * into s from private.web_text_settings;
  if not s.enabled or s.function_url is null then return 'disabled'; end if;
  if not exists (select 1 from private.web_text_requests where status = 'queued' or (status = 'running' and lease_until < now())) then
    return 'idle';
  end if;
  if private.web_text_committed() + s.usd_per_credit > s.cap_usd and not exists (
       select 1 from private.web_text_requests where status = 'running' and lease_until < now()) then
    return 'cap';
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'web_text_secret';
  if v_secret is null then return 'no_secret'; end if;
  perform net.http_post(
    url := s.function_url,
    headers := jsonb_build_object('content-type', 'application/json', 'x-web-text-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000);
  return 'called';
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges. Supabase's default privileges grant execute on new public functions to anon and authenticated: revoked here.

revoke all on function private.web_text_url_ok(text), private.web_text_committed(), private.web_text_tick()
  from public, anon, authenticated, service_role, corpus_ingest;
revoke all on function public.web_text_enqueue(jsonb), public.web_text_read(text[]), public.web_text_status(),
  public.web_text_claim(integer, integer), public.web_text_finish(uuid, uuid, jsonb),
  public.web_text_fail(uuid, uuid, text, boolean, boolean) from public, anon, authenticated, service_role, corpus_ingest;
grant execute on function public.web_text_enqueue(jsonb), public.web_text_read(text[]), public.web_text_status()
  to corpus_ingest, service_role;
grant execute on function public.web_text_claim(integer, integer), public.web_text_finish(uuid, uuid, jsonb),
  public.web_text_fail(uuid, uuid, text, boolean, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- Schedule. Every minute (D8), where pg_cron is installed; the job does nothing while settings.enabled is false.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'web-text';
    perform cron.schedule('web-text', '* * * * *', 'select private.web_text_tick()');
  end if;
end;
$$;

commit;
