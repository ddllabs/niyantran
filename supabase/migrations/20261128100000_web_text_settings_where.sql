-- F418: the web-text queue's settings updates carry a WHERE clause, so they run through PostgREST.
--
-- PostgREST's role (authenticator) loads pg_safeupdate, which refuses an UPDATE or DELETE with no WHERE clause
-- ("UPDATE requires a WHERE clause", SQLSTATE 21000). Four statements in 20261126100000_web_text_queue.sql update the
-- one-row private.web_text_settings with no WHERE: in public.web_text_claim, counting a lapsed lease toward the halt rule
-- and switching the run off when it reaches halt_source_errors; in public.web_text_fail, the same two for a failure that
-- counted money. The web-text Edge Function calls both through PostgREST, so each of those branches answered 400 and
-- nothing changed: on NTER on 2026-11-28 a lease lapsed at 12:30 UTC and every claim after it failed, so the queue
-- stalled with 6 requests left, and the halt rule (a wrong key, no credits, a run of billed failures) could not switch a
-- run off. A psql session does not load the library, which is why these paths passed every test.
--
-- The fix adds `where singleton` (the table's one-row key, always true) to the four statements. Nothing else in either
-- function changes: the bodies are 20261126100000's, which were read back from NTER on 2026-11-28 (same md5 of prosrc).
-- `create or replace` keeps each function's owner, grants and comment. web_text_finish's settings update already has a
-- WHERE clause and is not touched. Fixture: supabase/tests/web_text_safeupdate.sql.
--
-- Down: re-run the two `create function` statements of 20261126100000_web_text_queue.sql as `create or replace`.

create or replace function public.web_text_claim(p_limit integer default 1, p_lease_seconds integer default 300) returns jsonb
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
      update private.web_text_settings set enabled = false, halted_reason = 'source_errors', source_error_run = 0, updated_at = now() where singleton;
      return jsonb_build_object('claimed', '[]'::jsonb, 'refused', 'disabled', 'halted', 'source_errors');
    end if;
    update private.web_text_settings set source_error_run = v_run, updated_at = now() where singleton;
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

create or replace function public.web_text_fail(p_id uuid, p_token uuid, p_code text, p_uncertain boolean, p_permanent boolean) returns jsonb
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
    update private.web_text_settings set enabled = false, halted_reason = v_halt, source_error_run = 0, updated_at = now() where singleton;
  elsif v_run <> s.source_error_run then
    update private.web_text_settings set source_error_run = v_run, updated_at = now() where singleton;
  end if;
  return jsonb_build_object('outcome', case when v_stop then 'failed' else 'queued' end, 'halted', v_halt);
end;
$$;
