-- Budget OCR text queue (F391). Spec: docs/specs/2026-11-21-budget-ocr-text.md (Status: Living).
--
-- 116 Budget records are held at screening because the pack's extracted text has control codes in place of spaces and digits.
-- Their text is re-extracted by Mistral OCR from the official PDF, without storing or serving the PDF and without any OCR or
-- model key on the operator's laptop. A queue in the database carries the work:
--
--   corpus_ingest (the runner's login)  --enqueue-->  private.budget_ocr_requests  <--claim/finish/fail--  budget-ocr Edge
--   function (service role, MISTRAL_API_KEY, gives Mistral the official URL)  --text-->  corpus_ingest reads it back by key.
--
-- The OCR text then goes through the existing five-desk supplied-text route (screen, batch policy, spend stops), so nothing
-- here admits a document.
--
-- WHAT THIS CREATES (nothing is read from or written to any existing table):
--   private.budget_ocr_settings   one row: the spend cap (US$2), the price per 1,000 pages (US$4), the switch (OFF), the
--                                 function's URL (empty), attempts and batch size.
--   private.budget_ocr_requests   the queue: source key, official URL, expected pages, the pack's sha256, status, pages and
--                                 cost, the OCR text (a JSON list of page texts), the error code, timestamps.
--   public.budget_ocr_enqueue(jsonb)   corpus_ingest, service_role: queue requests. Refuses a host that is not one of the
--                                 Budget desk's official hosts (public.ingest_search_only_desks(), the list the five-desk
--                                 route admits file links against) and refuses a key or link already queued.
--   public.budget_ocr_read(text[])     corpus_ingest, service_role: read requests back by source key, with the text when done.
--   public.budget_ocr_status()         corpus_ingest, service_role: counts, money spent and reserved, the cap.
--   public.budget_ocr_claim / _finish / _fail   service_role only (the Edge function): the spend cap is enforced in claim.
--   private.budget_ocr_tick()          what the cron job runs: does nothing unless the switch is on, a URL is set and work is
--                                 queued; then posts to the function with a secret header (pg_net, vault).
--   cron job 'budget-ocr' (every minute, where pg_cron is installed): INERT while settings.enabled is false. Applying this
--                                 migration starts no spend.
--
-- THE SPEND CAP (in the database): committed = what finished or uncertain attempts may have cost (spent_usd) + the estimate of
-- every running request (reserved). claim refuses a request when committed + its estimate would pass cap_usd, and says so
-- ('cap'). The estimate is pages x price, computed here from the expected page count, never taken from the caller. The Edge
-- function also asks Mistral for exactly the expected pages, so a request cannot cost more than its estimate. An attempt that
-- ended without a known answer (timeout, 5xx, a lost lease) counts its full estimate as spent: the cap errs high.
--
-- ENABLE (developer's yes, as postgres, after the function is deployed and its secrets are set; BUDGET_OCR_SECRET must be at
-- least 32 characters or the function answers 503). The URL must be a project reference (20 characters) on supabase.co:
--   update private.budget_ocr_settings set function_url = 'https://<project-ref>.supabase.co/functions/v1/budget-ocr',
--                                          cap_usd = 2, enabled = true;
-- DISABLE: update private.budget_ocr_settings set enabled = false;   (claim also refuses while it is false)
--
-- Privileges: nothing for anon, authenticated or PUBLIC on the tables, the schema or any function; RLS is on with no policy.
-- Every function is SECURITY DEFINER with search_path pg_catalog, pg_temp and schema-qualified names.
--
-- Down (nothing else depends on these objects):
--   begin;
--   --   select cron.unschedule(jobid) from cron.job where jobname = 'budget-ocr';   (where pg_cron is installed)
--   drop function public.budget_ocr_enqueue(jsonb), public.budget_ocr_read(text[]), public.budget_ocr_status(),
--     public.budget_ocr_claim(integer, integer), public.budget_ocr_finish(uuid, uuid, integer, jsonb),
--     public.budget_ocr_fail(uuid, uuid, text, boolean, boolean), private.budget_ocr_tick(), private.budget_ocr_committed();
--   drop table private.budget_ocr_requests, private.budget_ocr_settings;
--   commit;
-- (The private schema is left: other migrations use it. The vault secret 'budget_ocr_secret' is left too: delete it from
-- vault.secrets if it is no longer wanted.)

begin;
set local lock_timeout = '10s';

create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role, corpus_ingest;

-- ---------------------------------------------------------------------------
-- Tables.

create table private.budget_ocr_settings (
  singleton           boolean primary key default true check (singleton),
  cap_usd             numeric not null default 2 check (cap_usd >= 0 and cap_usd <= 50),
  usd_per_1000_pages  numeric not null default 4 check (usd_per_1000_pages > 0 and usd_per_1000_pages <= 100),
  enabled             boolean not null default false,
  function_url        text check (function_url is null or function_url ~ '^https://[a-z0-9]{20}\.supabase\.co/functions/v1/budget-ocr$'),
  max_attempts        integer not null default 3 check (max_attempts between 1 and 10),
  updated_at          timestamptz not null default now()
);
insert into private.budget_ocr_settings (singleton) values (true);

create table private.budget_ocr_requests (
  id              uuid primary key default gen_random_uuid(),
  source_key      text not null unique check (source_key ~ '^[0-9a-f]{40}$'),
  official_url    text not null unique check (official_url ~ '^https://[^/@:?#]+/[^?#]+\.pdf$' and length(official_url) <= 2000),
  expected_pages  integer not null check (expected_pages between 1 and 1000),
  pack_sha256     text not null check (pack_sha256 ~ '^[0-9a-f]{64}$'),
  status          text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  estimate_usd    numeric not null check (estimate_usd > 0),
  spent_usd       numeric not null default 0 check (spent_usd >= 0),
  attempts        integer not null default 0,
  claim_token     uuid,
  lease_until     timestamptz,
  pages           integer,
  cost_usd        numeric,
  page_texts      jsonb check (page_texts is null or jsonb_typeof(page_texts) = 'array'),
  error_code      text check (error_code is null or error_code ~ '^[a-z0-9_]{1,64}$'),
  created_at      timestamptz not null default now(),
  claimed_at      timestamptz,
  finished_at     timestamptz,
  check ((status = 'running') = (claim_token is not null and lease_until is not null)),
  check (status <> 'done' or (page_texts is not null and pages is not null and cost_usd is not null))
);
create index budget_ocr_requests_queue on private.budget_ocr_requests (status, created_at, id) where status in ('queued', 'running');

alter table private.budget_ocr_settings enable row level security;
alter table private.budget_ocr_requests enable row level security;
revoke all on private.budget_ocr_settings, private.budget_ocr_requests from public, anon, authenticated, service_role, corpus_ingest;

-- ---------------------------------------------------------------------------
-- What has been spent or is reserved.

create function private.budget_ocr_committed() returns numeric
language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select coalesce(sum(spent_usd), 0) + coalesce(sum(estimate_usd) filter (where status = 'running'), 0)
  from private.budget_ocr_requests;
$$;

-- ---------------------------------------------------------------------------
-- Enqueue (corpus_ingest). One element: {source_key, official_url, expected_pages, pack_sha256}.

create function public.budget_ocr_enqueue(p_items jsonb) returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_hosts text[];
  v_rate  numeric;
  v_item  jsonb;
  v_out   jsonb := '[]'::jsonb;
  v_key   text;
  v_url   text;
  v_pages integer;
  v_sha   text;
  v_host  text;
  v_id    uuid;
  v_why   text;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'budget_ocr_enqueue: items must be a JSON list' using errcode = '22023'; end if;
  if jsonb_array_length(p_items) > 50 then raise exception 'budget_ocr_enqueue: at most 50 items a call' using errcode = '22023'; end if;
  select d.hosts into v_hosts from public.ingest_search_only_desks() d where d.desk_feature = 'Budget Utilisation & Schemes';
  select usd_per_1000_pages into v_rate from private.budget_ocr_settings;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_why := null; v_key := null; v_url := null; v_pages := null; v_sha := null;
    if jsonb_typeof(v_item) <> 'object' then
      v_why := 'item_shape';
    else
      v_key := v_item ->> 'source_key';
      v_url := v_item ->> 'official_url';
      v_sha := v_item ->> 'pack_sha256';
      if jsonb_typeof(v_item -> 'expected_pages') = 'number' and (v_item ->> 'expected_pages') ~ '^[0-9]{1,4}$' then
        v_pages := (v_item ->> 'expected_pages')::integer;
      end if;
      v_host := substring(v_url from '^https://([^/@:?#]+)/');
      if v_key is null or v_key !~ '^[0-9a-f]{40}$' then v_why := 'source_key';
      elsif v_url is null or v_url !~ '^https://[^/@:?#]+/[^?#]+\.pdf$' or length(v_url) > 2000
            -- The screen's own path check (billUrlSegmentsOk, mirrored by public.bill_admission_key): no control character or
            -- backslash, no encoded separator (%2f, %5c), no . or .. path segment (plain, encoded or with a path parameter).
            or v_url ~ '[\x01-\x1f\x7f\\]' or v_url ~* '%2f|%5c'
            or v_url ~* '(^|/)(\.|%2e){1,2}((;|%3b)[^/]*)?(/|$)' then v_why := 'official_url';
      elsif v_hosts is null or v_host is null or not (v_host = any (v_hosts)) then v_why := 'host_not_official';
      elsif v_pages is null or v_pages < 1 or v_pages > 1000 then v_why := 'expected_pages';
      elsif v_sha is null or v_sha !~ '^[0-9a-f]{64}$' then v_why := 'pack_sha256';
      end if;
    end if;
    if v_why is not null then
      v_out := v_out || jsonb_build_object('source_key', v_key, 'outcome', 'refused', 'reason', v_why);
      continue;
    end if;
    insert into private.budget_ocr_requests (source_key, official_url, expected_pages, pack_sha256, estimate_usd)
    values (v_key, v_url, v_pages, v_sha, v_pages * v_rate / 1000)
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

create function public.budget_ocr_read(p_keys text[]) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
begin
  if p_keys is null or cardinality(p_keys) > 50 then raise exception 'budget_ocr_read: 1 to 50 keys a call' using errcode = '22023'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'source_key', r.source_key, 'official_url', r.official_url, 'expected_pages', r.expected_pages,
      'pack_sha256', r.pack_sha256, 'status', r.status, 'pages', r.pages, 'cost_usd', r.cost_usd,
      'error_code', r.error_code, 'attempts', r.attempts, 'page_texts', case when r.status = 'done' then r.page_texts end)
      order by r.source_key)
    from private.budget_ocr_requests r where r.source_key = any (p_keys)), '[]'::jsonb);
end;
$$;

create function public.budget_ocr_status() returns jsonb
language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select jsonb_build_object(
    'by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from private.budget_ocr_requests group by status) t), '{}'::jsonb),
    'committed_usd', private.budget_ocr_committed(),
    'cap_usd', s.cap_usd, 'enabled', s.enabled, 'function_url_set', s.function_url is not null)
  from private.budget_ocr_settings s;
$$;

-- ---------------------------------------------------------------------------
-- Claim (service_role): the spend cap is enforced here, under a lock on the settings row.

create function public.budget_ocr_claim(p_limit integer default 1, p_lease_seconds integer default 300) returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, pg_temp as $$
declare
  s          private.budget_ocr_settings;
  v_commit   numeric;
  v_refused  text := null;
  v_out      jsonb := '[]'::jsonb;
  r          private.budget_ocr_requests;
  v_token    uuid;
  v_est      numeric;
begin
  if p_limit is null or p_limit < 1 or p_limit > 5 then raise exception 'budget_ocr_claim: limit 1 to 5' using errcode = '22023'; end if;
  if p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 900 then raise exception 'budget_ocr_claim: lease 30 to 900 seconds' using errcode = '22023'; end if;
  select * into s from private.budget_ocr_settings for update;
  if not s.enabled then
    return jsonb_build_object('claimed', '[]'::jsonb, 'refused', 'disabled');
  end if;
  -- A request whose lease ran out was lost without an answer: its estimate counts as spent, and it is queued again or failed.
  update private.budget_ocr_requests
     set spent_usd = spent_usd + estimate_usd,
         status = case when attempts >= s.max_attempts then 'failed' else 'queued' end,
         error_code = 'lease_expired', claim_token = null, lease_until = null,
         finished_at = case when attempts >= s.max_attempts then now() end
   where status = 'running' and lease_until < now();
  v_commit := private.budget_ocr_committed();
  for r in
    select * from private.budget_ocr_requests where status = 'queued' order by created_at, id for update skip locked limit p_limit
  loop
    -- The estimate is pages x the CURRENT price, not the one in force when the request was queued.
    v_est := r.expected_pages * s.usd_per_1000_pages / 1000;
    if v_commit + v_est > s.cap_usd then v_refused := 'cap'; exit; end if;
    v_token := gen_random_uuid();
    update private.budget_ocr_requests
       set status = 'running', attempts = attempts + 1, claim_token = v_token, claimed_at = now(), estimate_usd = v_est,
           lease_until = now() + make_interval(secs => p_lease_seconds), error_code = null
     where id = r.id;
    v_commit := v_commit + v_est;
    v_out := v_out || jsonb_build_object('id', r.id, 'token', v_token, 'source_key', r.source_key,
                                         'official_url', r.official_url, 'expected_pages', r.expected_pages);
  end loop;
  return jsonb_build_object('claimed', v_out, 'refused', v_refused, 'committed_usd', v_commit, 'cap_usd', s.cap_usd);
end;
$$;

-- ---------------------------------------------------------------------------
-- Finish (service_role): the cost is pages processed x the price, computed here. Page texts must be a list of strings, one
-- per expected page; otherwise the request fails (page_count_mismatch) and keeps no text, but the money is still counted.
-- More pages processed than expected fails the request (pages_over_expected) and switches the whole run OFF.

create function public.budget_ocr_finish(p_id uuid, p_token uuid, p_pages integer, p_texts jsonb) returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, pg_temp as $$
declare
  r      private.budget_ocr_requests;
  v_rate numeric;
  v_cost numeric;
  v_ok   boolean;
begin
  select * into r from private.budget_ocr_requests where id = p_id for update;
  if not found or r.status <> 'running' or r.claim_token is distinct from p_token then
    return jsonb_build_object('outcome', 'stale');
  end if;
  if p_pages is null or p_pages < 0 or p_pages > 1000 then raise exception 'budget_ocr_finish: bad page count' using errcode = '22023'; end if;
  select usd_per_1000_pages into v_rate from private.budget_ocr_settings;
  v_cost := p_pages * v_rate / 1000;
  if p_pages > r.expected_pages then
    -- More pages were billed than were asked for: the estimate no longer bounds the cost. Record the real cost, keep no text
    -- and switch the run OFF, so a billing surprise stops here instead of repeating.
    update private.budget_ocr_requests
       set status = 'failed', pages = p_pages, cost_usd = v_cost, spent_usd = spent_usd + v_cost, page_texts = null,
           error_code = 'pages_over_expected', claim_token = null, lease_until = null, finished_at = now()
     where id = p_id;
    update private.budget_ocr_settings set enabled = false, updated_at = now();
    return jsonb_build_object('outcome', 'failed', 'cost_usd', v_cost, 'halted', true);
  end if;
  v_ok := p_texts is not null and jsonb_typeof(p_texts) = 'array' and jsonb_array_length(p_texts) = r.expected_pages
          and not exists (select 1 from jsonb_array_elements(p_texts) e where jsonb_typeof(e) <> 'string')
          and octet_length(p_texts::text) <= 16000000;
  if v_ok then
    update private.budget_ocr_requests
       set status = 'done', pages = p_pages, cost_usd = v_cost, spent_usd = spent_usd + v_cost, page_texts = p_texts,
           error_code = null, claim_token = null, lease_until = null, finished_at = now()
     where id = p_id;
    return jsonb_build_object('outcome', 'done', 'cost_usd', v_cost);
  end if;
  update private.budget_ocr_requests
     set status = 'failed', pages = p_pages, cost_usd = v_cost, spent_usd = spent_usd + v_cost, page_texts = null,
         error_code = 'page_count_mismatch', claim_token = null, lease_until = null, finished_at = now()
   where id = p_id;
  return jsonb_build_object('outcome', 'failed', 'cost_usd', v_cost);
end;
$$;

-- ---------------------------------------------------------------------------
-- Fail (service_role). p_uncertain: the attempt may have been billed (a timeout, a 5xx), so its estimate counts as spent.
-- p_permanent: do not try again. Otherwise the request is queued again until max_attempts.

create function public.budget_ocr_fail(p_id uuid, p_token uuid, p_code text, p_uncertain boolean, p_permanent boolean) returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, pg_temp as $$
declare
  r      private.budget_ocr_requests;
  s      private.budget_ocr_settings;
  v_code text := case when p_code ~ '^[a-z0-9_]{1,64}$' then p_code else 'unknown' end;
  v_stop boolean;
begin
  select * into s from private.budget_ocr_settings;
  select * into r from private.budget_ocr_requests where id = p_id for update;
  if not found or r.status <> 'running' or r.claim_token is distinct from p_token then
    return jsonb_build_object('outcome', 'stale');
  end if;
  v_stop := coalesce(p_permanent, false) or r.attempts >= s.max_attempts;
  update private.budget_ocr_requests
     set status = case when v_stop then 'failed' else 'queued' end,
         spent_usd = spent_usd + case when coalesce(p_uncertain, false) then estimate_usd else 0 end,
         error_code = v_code, claim_token = null, lease_until = null,
         finished_at = case when v_stop then now() end
   where id = p_id;
  return jsonb_build_object('outcome', case when v_stop then 'failed' else 'queued' end);
end;
$$;

-- ---------------------------------------------------------------------------
-- The cron job's body. Inert unless settings.enabled, a function URL and queued work exist and the cheapest queued
-- request still fits under the cap.

create function private.budget_ocr_tick() returns text
language plpgsql volatile security definer set search_path = pg_catalog, pg_temp as $$
declare
  s        private.budget_ocr_settings;
  v_next   numeric;
  v_secret text;
begin
  select * into s from private.budget_ocr_settings;
  if not s.enabled or s.function_url is null then return 'disabled'; end if;
  select min(expected_pages) * s.usd_per_1000_pages / 1000 into v_next from private.budget_ocr_requests
   where status = 'queued' or (status = 'running' and lease_until < now());
  if v_next is null then return 'idle'; end if;
  if private.budget_ocr_committed() + v_next > s.cap_usd and not exists (
       select 1 from private.budget_ocr_requests where status = 'running' and lease_until < now()) then
    return 'cap';
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'budget_ocr_secret';
  if v_secret is null then return 'no_secret'; end if;
  perform net.http_post(
    url := s.function_url,
    headers := jsonb_build_object('content-type', 'application/json', 'x-budget-ocr-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000);
  return 'called';
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges. Supabase's default privileges grant execute on new public functions to anon and authenticated: revoked here.

revoke all on function private.budget_ocr_committed(), private.budget_ocr_tick() from public, anon, authenticated, service_role, corpus_ingest;
revoke all on function public.budget_ocr_enqueue(jsonb), public.budget_ocr_read(text[]), public.budget_ocr_status(),
  public.budget_ocr_claim(integer, integer), public.budget_ocr_finish(uuid, uuid, integer, jsonb),
  public.budget_ocr_fail(uuid, uuid, text, boolean, boolean) from public, anon, authenticated, service_role, corpus_ingest;
grant execute on function public.budget_ocr_enqueue(jsonb), public.budget_ocr_read(text[]), public.budget_ocr_status()
  to corpus_ingest, service_role;
grant execute on function public.budget_ocr_claim(integer, integer), public.budget_ocr_finish(uuid, uuid, integer, jsonb),
  public.budget_ocr_fail(uuid, uuid, text, boolean, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- Schedule. Every minute, where pg_cron is installed; the job does nothing while settings.enabled is false.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'budget-ocr';
    perform cron.schedule('budget-ocr', '* * * * *', 'select private.budget_ocr_tick()');
  end if;
end;
$$;

commit;
