-- F391: the Budget OCR text queue. Disposable fixture. run.sh uses the five-desk chain (which has the host list
-- public.ingest_search_only_desks() and the corpus_ingest role), then 20261125100000_budget_ocr_queue (as a non-superuser).
-- Without the migration the queue does not exist, so the first assertion fails (the vacuity check).
-- Spec: docs/specs/2026-11-21-budget-ocr-text.md. Nothing here calls Mistral: the Edge function's side is simulated by
-- calling claim, finish and fail as service_role; pg_net and the vault are stand-ins.
\set ON_ERROR_STOP on
begin;
set search_path = public, extensions;
create function pg_temp.ok(v boolean, label text) returns void language plpgsql as $$begin
 if v is distinct from true then raise exception 'FAIL %', label; end if; raise notice 'PASS %', label; end$$;
-- Runs q as a role, returns its jsonb result (null for no result).
create function pg_temp.as_role(r text, q text) returns jsonb language plpgsql as $$declare v jsonb; begin
 execute format('set local role %I', r); execute q into v; reset role; return v; end$$;
-- q as a role must be refused with a message containing pattern; the role is reset either way.
create function pg_temp.refused_as(r text, q text, pattern text) returns void language plpgsql as $$begin
 begin
  execute format('set local role %I', r); execute q;
  reset role;
 exception when others then
  reset role;
  if position(pattern in sqlerrm) = 0 then raise exception 'wrong refusal for %: %', r, sqlerrm; end if;
  return;
 end;
 raise exception 'accepted unsafe operation as %: %', r, q; end$$;

-- A statement that changes data and a check of what it changed cannot share a query (the query's snapshot predates the
-- change), so each action is run into this table first and checked after.
create temp table act(label text primary key, j jsonb);
create function pg_temp.key(n int) returns text language sql immutable as $$ select left(encode(sha256(convert_to('k' || n, 'UTF8')), 'hex'), 40) $$;
create function pg_temp.url(n int) returns text language sql immutable as $$ select 'https://www.indiabudget.gov.in/doc/bh' || n || '.pdf' $$;
create function pg_temp.item(n int, pages int default 3) returns jsonb language sql immutable as $$
 select jsonb_build_object('source_key', pg_temp.key(n), 'official_url', pg_temp.url(n), 'expected_pages', pages,
                           'pack_sha256', repeat('a', 64)) $$;
create function pg_temp.enq(items jsonb) returns jsonb language sql as $$ select pg_temp.as_role('corpus_ingest', format('select public.budget_ocr_enqueue(%L::jsonb)', items::text)) $$;
create function pg_temp.texts(n int) returns jsonb language sql immutable as $$ select coalesce(jsonb_agg('page ' || g), '[]'::jsonb) from generate_series(1, n) g $$;

-- ═══ 1. What exists, and who can reach it ═══════════════════════════════════

select pg_temp.ok(to_regclass('private.budget_ocr_requests') is not null and to_regclass('private.budget_ocr_settings') is not null,
  'the queue and its settings exist in the private schema');
select pg_temp.ok((select cap_usd = 2 and usd_per_1000_pages = 4 and enabled = false and function_url is null from private.budget_ocr_settings),
  'defaults: cap US$2, US$4 per 1,000 pages, switched OFF, no function URL');
select pg_temp.ok((select relrowsecurity from pg_class where oid = 'private.budget_ocr_requests'::regclass)
  and (select relrowsecurity from pg_class where oid = 'private.budget_ocr_settings'::regclass), 'row level security is on for both tables');
select pg_temp.ok(not exists (select 1 from unnest(array['anon', 'authenticated', 'service_role', 'corpus_ingest']) r(r),
    unnest(array['private.budget_ocr_requests', 'private.budget_ocr_settings']) t(t),
    unnest(array['select', 'insert', 'update', 'delete']) p(p) where has_table_privilege(r.r, t.t, p.p)),
  'no role but the owner holds any privilege on either table');
select pg_temp.ok(not has_schema_privilege('anon', 'private', 'usage') and not has_schema_privilege('authenticated', 'private', 'usage'),
  'anon and authenticated have no use of the private schema');
select pg_temp.ok(not exists (select 1 from pg_policy where polrelid in ('private.budget_ocr_requests'::regclass, 'private.budget_ocr_settings'::regclass)),
  'no row level security policy: nothing reads the tables through the data API');

create temp table fns as
 select p.oid, p.oid::regprocedure::text as sig, p.prosecdef, p.proconfig from pg_proc p
 where p.oid in ('public.budget_ocr_enqueue(jsonb)'::regprocedure, 'public.budget_ocr_read(text[])'::regprocedure,
   'public.budget_ocr_status()'::regprocedure, 'public.budget_ocr_claim(integer,integer)'::regprocedure,
   'public.budget_ocr_finish(uuid,uuid,integer,jsonb)'::regprocedure, 'public.budget_ocr_fail(uuid,uuid,text,boolean,boolean)'::regprocedure,
   'private.budget_ocr_tick()'::regprocedure, 'private.budget_ocr_committed()'::regprocedure);
select pg_temp.ok((select count(*) = 8 from fns), 'all eight functions exist');
select pg_temp.ok((select bool_and(prosecdef and coalesce(proconfig @> array['search_path=pg_catalog, pg_temp'], false)) from fns),
  'every function is security definer with a pinned search_path');
select pg_temp.ok(not exists (select 1 from fns f, unnest(array['anon', 'authenticated']) r(r) where has_function_privilege(r.r, f.oid, 'execute')),
  'anon and authenticated can execute none of them');
select pg_temp.ok(not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where p.oid in (select oid from fns) and a.grantee = 0), 'PUBLIC can execute none of them');
select pg_temp.ok((select bool_and(has_function_privilege('corpus_ingest', oid, 'execute') = (sig ~ 'enqueue|read|status')) from fns where sig !~ 'tick|committed')
  and (select bool_and(not has_function_privilege('corpus_ingest', oid, 'execute')) from fns where sig ~ 'tick|committed'),
  'corpus_ingest may enqueue, read and read the status, and may not claim, finish, fail or tick');
select pg_temp.ok((select bool_and(has_function_privilege('service_role', oid, 'execute')) from fns where sig !~ 'tick|committed')
  and (select bool_and(not has_function_privilege('service_role', oid, 'execute')) from fns where sig ~ 'tick|committed'),
  'service_role may execute the six public functions and not the two private ones');
select pg_temp.refused_as('anon', 'select public.budget_ocr_status()', 'permission denied');
select pg_temp.refused_as('authenticated', $q$select public.budget_ocr_read(array['x'])$q$, 'permission denied');
select pg_temp.refused_as('corpus_ingest', 'select * from private.budget_ocr_requests', 'permission denied');
select pg_temp.refused_as('corpus_ingest', 'select public.budget_ocr_claim(1, 300)', 'permission denied');
select pg_temp.refused_as('service_role', 'select * from private.budget_ocr_requests', 'permission denied');

-- ═══ 2. Enqueue: the official hosts, the shape, duplicates ═════════════════════

insert into act select 'enq1', pg_temp.enq(jsonb_build_array(pg_temp.item(1, 3), pg_temp.item(2, 62)));
select pg_temp.ok((select j from act where label = 'enq1') -> 'results' @> '[{"outcome":"queued"}]'
  and (select count(*) = 2 and bool_and(status = 'queued') from private.budget_ocr_requests), 'two requests are queued');
select pg_temp.ok((select estimate_usd = 0.012 from private.budget_ocr_requests where source_key = pg_temp.key(1))
  and (select estimate_usd = 0.248 from private.budget_ocr_requests where source_key = pg_temp.key(2)),
  'the estimate is pages x US$4 per 1,000, computed in the database (3 pages = 0.012, 62 pages = 0.248)');
-- A caller cannot set the estimate, the status or the text.
insert into act select 'enq3', pg_temp.enq(jsonb_build_array(pg_temp.item(3) || '{"estimate_usd":0.0001,"status":"done","page_texts":["x"]}'::jsonb));
select pg_temp.ok((select j from act where label = 'enq3') -> 'results' @> '[{"outcome":"queued"}]'
  and (select estimate_usd = 0.012 and status = 'queued' and page_texts is null from private.budget_ocr_requests where source_key = pg_temp.key(3)),
  'fields the caller adds (estimate, status, text) are ignored');
-- Creation order is the queue order; one transaction gives every row the same now(), so the fixture sets it.
update private.budget_ocr_requests set created_at = now() - interval '1 hour'
  + (case source_key when pg_temp.key(1) then 0 when pg_temp.key(2) then 1 else 2 end) * interval '1 minute';

create function pg_temp.reason(items jsonb) returns text language sql as $$ select pg_temp.enq(items) -> 'results' -> 0 ->> 'reason' $$;
select pg_temp.ok(pg_temp.reason(jsonb_build_array(pg_temp.item(10) || '{"official_url":"https://www.rbi.org.in/doc/x.pdf"}')) = 'host_not_official',
  'another desk''s official host is refused');
select pg_temp.ok(pg_temp.reason(jsonb_build_array(pg_temp.item(11) || '{"official_url":"https://www.indiabudget.gov.in.evil.example/x.pdf"}')) = 'host_not_official',
  'a look-alike host is refused');
select pg_temp.ok(pg_temp.reason(jsonb_build_array(pg_temp.item(12) || '{"official_url":"https://www.indiabudget.gov.in@evil.example/x.pdf"}')) = 'official_url',
  'a link with credentials is refused');
select pg_temp.ok(pg_temp.reason(jsonb_build_array(pg_temp.item(13) || '{"official_url":"https://www.indiabudget.gov.in:8443/x.pdf"}')) = 'official_url',
  'a link with a port is refused');
select pg_temp.ok(pg_temp.reason(jsonb_build_array(pg_temp.item(14) || '{"official_url":"http://www.indiabudget.gov.in/x.pdf"}')) = 'official_url',
  'a plain http link is refused');
select pg_temp.ok(pg_temp.reason(jsonb_build_array(pg_temp.item(15) || '{"official_url":"https://www.indiabudget.gov.in/x.pdf?a=1"}')) = 'official_url',
  'a link with a query string is refused');
select pg_temp.ok(pg_temp.reason(jsonb_build_array(pg_temp.item(16) || '{"official_url":"https://www.indiabudget.gov.in/x.html"}')) = 'official_url',
  'a link that is not a PDF is refused');
select pg_temp.ok(pg_temp.reason(jsonb_build_array(pg_temp.item(17) || '{"source_key":"ABC"}')) = 'source_key', 'a source key that is not 40 hex characters is refused');
select pg_temp.ok(pg_temp.reason(jsonb_build_array(pg_temp.item(18, 0))) = 'expected_pages' and pg_temp.reason(jsonb_build_array(pg_temp.item(19, 1001))) = 'expected_pages'
  and pg_temp.reason(jsonb_build_array(pg_temp.item(20) || '{"expected_pages":"3"}')) = 'expected_pages', 'a page count outside 1 to 1,000, or not a number, is refused');
select pg_temp.ok(pg_temp.reason(jsonb_build_array(pg_temp.item(21) || '{"pack_sha256":"zz"}')) = 'pack_sha256', 'a pack hash that is not sha256 is refused');
select pg_temp.ok(pg_temp.reason(jsonb_build_array('"text"'::jsonb)) = 'item_shape', 'an item that is not an object is refused');
select pg_temp.ok((select count(*) from private.budget_ocr_requests) = 3, 'none of the refused items was queued');
select pg_temp.ok(pg_temp.reason(jsonb_build_array(pg_temp.item(1))) = 'duplicate', 'a source key already queued is refused as a duplicate');
select pg_temp.ok(pg_temp.reason(jsonb_build_array(pg_temp.item(30) || jsonb_build_object('official_url', pg_temp.url(2)))) = 'duplicate',
  'a link already queued under another key is refused as a duplicate');
select pg_temp.ok((select count(*) from private.budget_ocr_requests) = 3, 'duplicates added nothing');
select pg_temp.refused_as('corpus_ingest', $q$select public.budget_ocr_enqueue('{"a":1}'::jsonb)$q$, 'must be a JSON list');
select pg_temp.refused_as('corpus_ingest', $q$select public.budget_ocr_enqueue((select jsonb_agg('{}'::jsonb) from generate_series(1, 51)))$q$, 'at most 50');
-- The host list is the desk's own: change it and the enqueue follows (fail closed when the desk is not on the list).
select pg_temp.ok((select hosts = array['www.indiabudget.gov.in'] from public.ingest_search_only_desks() where desk_feature = 'Budget Utilisation & Schemes'),
  'the Budget desk''s hosts, as the five-desk route lists them, are the ones enqueue accepts');

-- ═══ 3. Claim: off by default, then the cap ═══════════════════════════════════

insert into act select 'claim_off', pg_temp.as_role('service_role', 'select public.budget_ocr_claim(5, 300)');
select pg_temp.ok((select j from act where label = 'claim_off') ->> 'refused' = 'disabled'
  and (select count(*) = 3 and bool_and(status = 'queued' and attempts = 0) from private.budget_ocr_requests),
  'while the switch is off, claim refuses and nothing is claimed');
update private.budget_ocr_settings set enabled = true, function_url = 'https://abc.supabase.co/functions/v1/budget-ocr', cap_usd = 0.26;
-- Queue order is creation order: the 3-page request (0.012), the 62-page one (0.248), another 3-page one (0.012).
create temp table c1 as select pg_temp.as_role('service_role', 'select public.budget_ocr_claim(5, 300)') j;
select pg_temp.ok((select (j -> 'claimed' -> 0 ->> 'source_key') = pg_temp.key(1) and jsonb_array_length(j -> 'claimed') = 2 and j ->> 'refused' = 'cap' from c1),
  'cap 0.26: the first two (0.012 + 0.248 = 0.260, exactly the cap) are claimed and the third (0.272) is refused as over the cap');
select pg_temp.ok((select count(*) = 1 from private.budget_ocr_requests where status = 'queued' and source_key = pg_temp.key(3))
  and (select count(*) = 2 from private.budget_ocr_requests where status = 'running' and attempts = 1 and claim_token is not null and lease_until > now()),
  'the refused request stays queued; the two claimed ones are running with a token and a lease');
select pg_temp.ok(private.budget_ocr_committed() = 0.260, 'the running estimates are reserved against the cap');
insert into act select 'claim_cap', pg_temp.as_role('service_role', 'select public.budget_ocr_claim(5, 300)');
select pg_temp.ok((select j from act where label = 'claim_cap') ->> 'refused' = 'cap' and (select j from act where label = 'claim_cap') -> 'claimed' = '[]'::jsonb
  and (select count(*) = 1 from private.budget_ocr_requests where status = 'queued'), 'a second claim at the cap claims nothing');
select pg_temp.refused_as('service_role', 'select public.budget_ocr_claim(6, 300)', 'limit 1 to 5');
select pg_temp.refused_as('service_role', 'select public.budget_ocr_claim(1, 5)', 'lease 30 to 900');

-- ═══ 4. Finish ═══════════════════════════════════════════════════════════════

create temp table c1ids as select (e ->> 'id')::uuid id, (e ->> 'token')::uuid tok, e ->> 'source_key' k from c1, jsonb_array_elements(c1.j -> 'claimed') e;
insert into act select 'fin_stale', pg_temp.as_role('service_role', format($q$select public.budget_ocr_finish(%L, %L, 3, %L::jsonb)$q$,
    (select id from c1ids where k = pg_temp.key(1)), gen_random_uuid(), pg_temp.texts(3)::text));
select pg_temp.ok((select j from act where label = 'fin_stale') ->> 'outcome' = 'stale', 'a finish with the wrong token is stale');
select pg_temp.ok((select status = 'running' and page_texts is null from private.budget_ocr_requests where source_key = pg_temp.key(1)), 'the wrongly-tokened finish changed nothing');
insert into act select 'fin_done', pg_temp.as_role('service_role', format($q$select public.budget_ocr_finish(%L, %L, 3, %L::jsonb)$q$,
    (select id from c1ids where k = pg_temp.key(1)), (select tok from c1ids where k = pg_temp.key(1)), pg_temp.texts(3)::text));
select pg_temp.ok((select j from act where label = 'fin_done') ->> 'outcome' = 'done'
  and (select status = 'done' and pages = 3 and cost_usd = 0.012 and spent_usd = 0.012 and claim_token is null and finished_at is not null
        and page_texts = pg_temp.texts(3) from private.budget_ocr_requests where source_key = pg_temp.key(1)),
  'a finish stores the text, the pages and the cost (pages x price, computed here)');
select pg_temp.ok(private.budget_ocr_committed() = 0.260, 'committed: 0.012 spent + 0.248 still reserved');
-- A text list that is not the expected length fails the request, keeps no text, and still counts the money.
insert into act select 'fin_mismatch', pg_temp.as_role('service_role', format($q$select public.budget_ocr_finish(%L, %L, 61, %L::jsonb)$q$,
    (select id from c1ids where k = pg_temp.key(2)), (select tok from c1ids where k = pg_temp.key(2)), pg_temp.texts(61)::text));
select pg_temp.ok((select j from act where label = 'fin_mismatch') ->> 'outcome' = 'failed'
  and (select status = 'failed' and error_code = 'page_count_mismatch' and page_texts is null and spent_usd = 0.244
        from private.budget_ocr_requests where source_key = pg_temp.key(2)),
  'a page count that differs from the expected one fails the request without the text, but the money is counted');
select pg_temp.ok((select page_texts is null from private.budget_ocr_requests where source_key = pg_temp.key(2)) and private.budget_ocr_committed() = 0.256,
  'committed now 0.012 + 0.244');
-- Read back: text only for done requests, by key.
create temp table rd as select pg_temp.as_role('corpus_ingest', format('select public.budget_ocr_read(%L::text[])', array[pg_temp.key(1), pg_temp.key(2), pg_temp.key(3), 'nope']::text)) j;
select pg_temp.ok((select jsonb_array_length(j) = 3 from rd), 'read returns the requests that exist, by key');
select pg_temp.ok((select j @> jsonb_build_array(jsonb_build_object('source_key', pg_temp.key(1), 'status', 'done', 'page_texts', pg_temp.texts(3))) from rd)
  and (select (e -> 'page_texts') = 'null'::jsonb and e ->> 'status' = 'failed' and e ->> 'error_code' = 'page_count_mismatch' from rd, jsonb_array_elements(rd.j) e where e ->> 'source_key' = pg_temp.key(2))
  and (select (e -> 'page_texts') = 'null'::jsonb and e ->> 'status' = 'queued' from rd, jsonb_array_elements(rd.j) e where e ->> 'source_key' = pg_temp.key(3)),
  'text comes back only for the done request; the failed and the queued ones carry none');
select pg_temp.refused_as('corpus_ingest', $q$select public.budget_ocr_read(null)$q$, '1 to 50 keys');
select pg_temp.ok((pg_temp.as_role('corpus_ingest', 'select public.budget_ocr_status()')) @> '{"by_status":{"done":1,"failed":1,"queued":1},"enabled":true,"function_url_set":true}'
  and ((pg_temp.as_role('corpus_ingest', 'select public.budget_ocr_status()')) ->> 'committed_usd')::numeric = 0.256, 'status: counts, committed money, the switch');

-- ═══ 5. Fail, retries and the lease ═════════════════════════════════════════════

-- After the 62-page request failed (0.256 committed of 0.26) the remaining 3-page request (0.012) no longer fits.
insert into act select 'claim_cap2', pg_temp.as_role('service_role', 'select public.budget_ocr_claim(5, 300)');
select pg_temp.ok((select j from act where label = 'claim_cap2') ->> 'refused' = 'cap', 'the cap holds after spending: 0.256 + 0.012 passes 0.26');
update private.budget_ocr_settings set cap_usd = 2;
create temp table c2 as select pg_temp.as_role('service_role', 'select public.budget_ocr_claim(5, 300)') j;
select pg_temp.ok((select jsonb_array_length(j -> 'claimed') = 1 and j ->> 'refused' is null from c2), 'with a larger cap the queued request is claimed');
create function pg_temp.fail(code text, uncertain boolean, permanent boolean) returns jsonb language sql as $$
 select pg_temp.as_role('service_role', format($q$select public.budget_ocr_fail(%L, %L, %L, %L, %L)$q$,
   (select (j -> 'claimed' -> 0 ->> 'id') from c2), (select (j -> 'claimed' -> 0 ->> 'token') from c2), code, uncertain, permanent)) $$;
insert into act select 'fail1', pg_temp.fail('mistral_rate_limited', false, false);
select pg_temp.ok((select j from act where label = 'fail1') ->> 'outcome' = 'queued'
  and (select status = 'queued' and error_code = 'mistral_rate_limited' and spent_usd = 0 and claim_token is null and attempts = 1 from private.budget_ocr_requests where source_key = pg_temp.key(3)),
  'a rate-limited attempt (not billed) is queued again and adds no spend');
insert into act select 'fail1b', pg_temp.fail('mistral_rate_limited', false, false);
select pg_temp.ok((select j from act where label = 'fail1b') ->> 'outcome' = 'stale', 'a second report on the same claim is stale');
create temp table c3 as select pg_temp.as_role('service_role', 'select public.budget_ocr_claim(1, 300)') j;
select pg_temp.ok((select (j -> 'claimed' -> 0 ->> 'source_key') = pg_temp.key(3) from c3) and (select attempts = 2 from private.budget_ocr_requests where source_key = pg_temp.key(3)),
  'the request is claimed again (attempt 2)');
insert into act select 'fail2', pg_temp.as_role('service_role', format($q$select public.budget_ocr_fail(%L, %L, 'mistral_unavailable', true, false)$q$,
    (select j -> 'claimed' -> 0 ->> 'id' from c3), (select j -> 'claimed' -> 0 ->> 'token' from c3)));
select pg_temp.ok((select j from act where label = 'fail2') ->> 'outcome' = 'queued'
  and (select spent_usd = 0.012 from private.budget_ocr_requests where source_key = pg_temp.key(3)),
  'a timeout (may have been billed) is queued again and counts its estimate as spent');
create temp table c4 as select pg_temp.as_role('service_role', 'select public.budget_ocr_claim(1, 300)') j;
insert into act select 'fail3', pg_temp.as_role('service_role', format($q$select public.budget_ocr_fail(%L, %L, 'mistral_unavailable', true, false)$q$,
    (select j -> 'claimed' -> 0 ->> 'id' from c4), (select j -> 'claimed' -> 0 ->> 'token' from c4)));
select pg_temp.ok((select j from act where label = 'fail3') ->> 'outcome' = 'failed'
  and (select status = 'failed' and attempts = 3 and spent_usd = 0.024 and finished_at is not null from private.budget_ocr_requests where source_key = pg_temp.key(3)),
  'the third failed attempt (max_attempts is 3) ends the request, with both timeouts counted as spent');
insert into act select 'claim_none', pg_temp.as_role('service_role', 'select public.budget_ocr_claim(5, 300)');
select pg_temp.ok((select j from act where label = 'claim_none') -> 'claimed' = '[]'::jsonb, 'a failed request is not claimed again');

-- A permanent failure ends the request on its first attempt.
select pg_temp.enq(jsonb_build_array(pg_temp.item(42, 1)));
create temp table c5 as select pg_temp.as_role('service_role', 'select public.budget_ocr_claim(1, 300)') j;
insert into act select 'fail4', pg_temp.as_role('service_role', format($q$select public.budget_ocr_fail(%L, %L, 'mistral_rejected', false, true)$q$,
    (select j -> 'claimed' -> 0 ->> 'id' from c5), (select j -> 'claimed' -> 0 ->> 'token' from c5)));
select pg_temp.ok((select j from act where label = 'fail4') ->> 'outcome' = 'failed'
  and (select status = 'failed' and attempts = 1 and error_code = 'mistral_rejected' and spent_usd = 0 from private.budget_ocr_requests where source_key = pg_temp.key(42)),
  'a permanent failure ends the request at once');

-- Retries stop at max_attempts without a permanent flag.
select pg_temp.enq(jsonb_build_array(pg_temp.item(40, 1)));
update private.budget_ocr_settings set max_attempts = 2;
create temp table c6 as select pg_temp.as_role('service_role', 'select public.budget_ocr_claim(1, 300)') j;
insert into act select 'fail5', pg_temp.as_role('service_role', format($q$select public.budget_ocr_fail(%L, %L, 'x', false, false)$q$,
    (select j -> 'claimed' -> 0 ->> 'id' from c6), (select j -> 'claimed' -> 0 ->> 'token' from c6)));
select pg_temp.ok((select j from act where label = 'fail5') ->> 'outcome' = 'queued', 'attempt 1 of 2 is retried');
create temp table c7 as select pg_temp.as_role('service_role', 'select public.budget_ocr_claim(1, 300)') j;
insert into act select 'fail6', pg_temp.as_role('service_role', format($q$select public.budget_ocr_fail(%L, %L, 'Bad Code!', false, false)$q$,
    (select j -> 'claimed' -> 0 ->> 'id' from c7), (select j -> 'claimed' -> 0 ->> 'token' from c7)));
select pg_temp.ok((select j from act where label = 'fail6') ->> 'outcome' = 'failed'
  and (select error_code = 'unknown' from private.budget_ocr_requests where source_key = pg_temp.key(40)),
  'attempt 2 of 2 is final, and an error code of another shape is stored as unknown');

-- A lease that ran out: the work was lost without an answer, so its estimate counts as spent and it is queued again.
select pg_temp.enq(jsonb_build_array(pg_temp.item(41, 2)));
update private.budget_ocr_settings set max_attempts = 3;
create temp table c8 as select pg_temp.as_role('service_role', 'select public.budget_ocr_claim(1, 300)') j;
update private.budget_ocr_requests set lease_until = now() - interval '1 minute' where source_key = pg_temp.key(41);
create temp table c9 as select pg_temp.as_role('service_role', 'select public.budget_ocr_claim(1, 300)') j;
select pg_temp.ok((select error_code is null and attempts = 2 and spent_usd = 0.008 and status = 'running' from private.budget_ocr_requests where source_key = pg_temp.key(41))
  and (select (j -> 'claimed' -> 0 ->> 'source_key') = pg_temp.key(41) from c9),
  'an expired lease counts its estimate as spent and the request is claimed again');
insert into act select 'fin_late', pg_temp.as_role('service_role', format($q$select public.budget_ocr_finish(%L, %L, 2, %L::jsonb)$q$,
    (select j -> 'claimed' -> 0 ->> 'id' from c8), (select j -> 'claimed' -> 0 ->> 'token' from c8), pg_temp.texts(2)::text));
select pg_temp.ok((select j from act where label = 'fin_late') ->> 'outcome' = 'stale',
  'the first claimant''s late answer is stale: the claim token belongs to the second claim');

-- ═══ 6. The cron body: inert until switched on ═══════════════════════════════════

create schema net; create schema vault;
create table public.http_calls_fixture(url text, headers jsonb);
create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int) returns bigint language sql as $$
 insert into public.http_calls_fixture values (url, headers) returning 1::bigint $$;
create table vault.decrypted_secrets(name text, decrypted_secret text);
update private.budget_ocr_requests set status = 'queued', claim_token = null, lease_until = null where source_key = pg_temp.key(41);

update private.budget_ocr_settings set enabled = false;
create temp table tk(label text primary key, r text);
insert into tk select 'off', private.budget_ocr_tick();
select pg_temp.ok((select r from tk where label = 'off') = 'disabled' and (select count(*) = 0 from public.http_calls_fixture), 'tick does nothing while the switch is off');
update private.budget_ocr_settings set enabled = true, function_url = null;
insert into tk select 'nourl', private.budget_ocr_tick();
select pg_temp.ok((select r from tk where label = 'nourl') = 'disabled' and (select count(*) = 0 from public.http_calls_fixture), 'tick does nothing without a function URL');
update private.budget_ocr_settings set function_url = 'https://abc.supabase.co/functions/v1/budget-ocr';
insert into tk select 'nosecret', private.budget_ocr_tick();
select pg_temp.ok((select r from tk where label = 'nosecret') = 'no_secret' and (select count(*) = 0 from public.http_calls_fixture), 'tick does nothing without the secret in the vault');
insert into vault.decrypted_secrets values ('budget_ocr_secret', 'fixture-secret');
update private.budget_ocr_settings set cap_usd = 0.2;
select pg_temp.ok(private.budget_ocr_committed() > 0.2, 'precondition: the money committed already passes the lowered cap');
insert into tk select 'cap', private.budget_ocr_tick();
select pg_temp.ok((select r from tk where label = 'cap') = 'cap' and (select count(*) = 0 from public.http_calls_fixture), 'tick does not call the function when the cap leaves no room');
update private.budget_ocr_settings set cap_usd = 2;
insert into tk select 'called', private.budget_ocr_tick();
select pg_temp.ok((select r from tk where label = 'called') = 'called' and (select count(*) = 1 and bool_and(url = 'https://abc.supabase.co/functions/v1/budget-ocr' and headers ->> 'x-budget-ocr-secret' = 'fixture-secret')
   from public.http_calls_fixture), 'tick posts to the function with the secret header when on, queued and under the cap');
update private.budget_ocr_requests set status = 'failed', finished_at = now() where status = 'queued';
insert into tk select 'idle', private.budget_ocr_tick();
select pg_temp.ok((select r from tk where label = 'idle') = 'idle' and (select count(*) = 1 from public.http_calls_fixture), 'tick does nothing when nothing is queued');
select pg_temp.refused_as('corpus_ingest', 'select private.budget_ocr_tick()', 'permission denied');
select pg_temp.refused_as('service_role', 'select private.budget_ocr_tick()', 'permission denied');

-- ═══ 7. Constraints ═══════════════════════════════════════════════════════════

select pg_temp.refused_as('postgres', $q$update private.budget_ocr_settings set function_url = 'https://evil.example/functions/v1/other'$q$, 'check constraint');
select pg_temp.refused_as('postgres', $q$update private.budget_ocr_requests set status = 'done' where source_key = pg_temp.key(2)$q$, 'check constraint');

rollback;
