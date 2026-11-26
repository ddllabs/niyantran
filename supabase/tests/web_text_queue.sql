-- F369: the Regulatory web-page text queue (Firecrawl). Disposable fixture. run.sh uses the five-desk chain (which has the
-- host list public.ingest_search_only_desks() and the corpus_ingest role), then 20261126100000_web_text_queue (as a
-- non-superuser). Without the migration the queue does not exist, so the first assertion fails (the vacuity check).
-- Spec: docs/specs/2026-11-23-regulatory-web-text-firecrawl.md. Nothing here calls Firecrawl: the Edge function's side is
-- simulated by calling claim, finish and fail as service_role; pg_net and the vault are stand-ins.
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
create function pg_temp.url(n int) returns text language sql immutable as $$ select 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=' || n $$;
create function pg_temp.item(n int) returns jsonb language sql immutable as $$
 select jsonb_build_object('source_key', pg_temp.key(n), 'official_url', pg_temp.url(n), 'pack_sha256', repeat('a', 64)) $$;
create function pg_temp.enq(items jsonb) returns jsonb language sql as $$ select pg_temp.as_role('corpus_ingest', format('select public.web_text_enqueue(%L::jsonb)', items::text)) $$;
create function pg_temp.reason(items jsonb) returns text language sql as $$ select pg_temp.enq(items) -> 'results' -> 0 ->> 'reason' $$;
create function pg_temp.reason_url(n int, u text) returns text language sql as $$
 select pg_temp.reason(jsonb_build_array(pg_temp.item(n) || jsonb_build_object('official_url', u))) $$;
create function pg_temp.req(n int) returns private.web_text_requests language sql as $$ select * from private.web_text_requests where source_key = pg_temp.key(n) $$;
-- Claims request n as the only claim: queues it if it is new, puts it first in the queue, claims one, checks it is n.
create function pg_temp.claim_one(n int) returns jsonb language plpgsql as $$declare v jsonb; begin
 if not exists (select 1 from private.web_text_requests where source_key = pg_temp.key(n)) then
  perform pg_temp.enq(jsonb_build_array(pg_temp.item(n)));
 end if;
 update private.web_text_requests set created_at = now() - interval '10 years' where source_key = pg_temp.key(n);
 v := pg_temp.as_role('service_role', 'select public.web_text_claim(1, 300)');
 update private.web_text_requests set created_at = now() where source_key = pg_temp.key(n);
 if v -> 'claimed' -> 0 ->> 'source_key' is distinct from pg_temp.key(n) then raise exception 'claim_one(%) claimed %', n, v; end if;
 return v -> 'claimed' -> 0; end$$;
create function pg_temp.fail(c jsonb, code text, uncertain boolean, permanent boolean) returns jsonb language sql as $$
 select pg_temp.as_role('service_role', format($q$select public.web_text_fail(%L, %L, %L, %L, %L)$q$,
   c ->> 'id', c ->> 'token', code, uncertain, permanent)) $$;
create function pg_temp.finish(c jsonb, res jsonb) returns jsonb language sql as $$
 select pg_temp.as_role('service_role', format($q$select public.web_text_finish(%L, %L, %L::jsonb)$q$, c ->> 'id', c ->> 'token', res::text)) $$;
create function pg_temp.good(t text default '# Press release' || chr(10) || 'The Reserve Bank today announced.') returns jsonb language sql immutable as $$
 select jsonb_build_object('text', t, 'source_status', 200, 'final_url_host', 'www.rbi.org.in', 'content_type', 'text/html; charset=utf-8') $$;
create function pg_temp.settings() returns private.web_text_settings language sql as $$ select * from private.web_text_settings $$;

-- ═══ 1. What exists, and who can reach it ═══════════════════════════════════

select pg_temp.ok(to_regclass('private.web_text_requests') is not null and to_regclass('private.web_text_settings') is not null,
  'the queue and its settings exist in the private schema');
select pg_temp.ok((select cap_usd = 0 and usd_per_credit = 0.005 and enabled = false and function_url is null and max_attempts = 2
                     and halt_source_errors = 5 and source_error_run = 0 and halted_reason is null from private.web_text_settings),
  'defaults: cap US$0, US$0.005 a credit, switched OFF, no function URL, 2 attempts, halt after 5 source errors');
select pg_temp.ok((select count(*) = 1 from private.web_text_settings), 'one settings row');
select pg_temp.ok((select relrowsecurity from pg_class where oid = 'private.web_text_requests'::regclass)
  and (select relrowsecurity from pg_class where oid = 'private.web_text_settings'::regclass), 'row level security is on for both tables');
select pg_temp.ok(not exists (select 1 from unnest(array['anon', 'authenticated', 'service_role', 'corpus_ingest']) r(r),
    unnest(array['private.web_text_requests', 'private.web_text_settings']) t(t),
    unnest(array['select', 'insert', 'update', 'delete']) p(p) where has_table_privilege(r.r, t.t, p.p)),
  'no role but the owner holds any privilege on either table');
select pg_temp.ok(not has_schema_privilege('anon', 'private', 'usage') and not has_schema_privilege('authenticated', 'private', 'usage'),
  'anon and authenticated have no use of the private schema');
select pg_temp.ok(not exists (select 1 from pg_policy where polrelid in ('private.web_text_requests'::regclass, 'private.web_text_settings'::regclass)),
  'no row level security policy: nothing reads the tables through the data API');

create temp table fns as
 select p.oid, p.oid::regprocedure::text as sig, p.prosecdef, p.proconfig from pg_proc p
 where p.oid in ('public.web_text_enqueue(jsonb)'::regprocedure, 'public.web_text_read(text[])'::regprocedure,
   'public.web_text_status()'::regprocedure, 'public.web_text_claim(integer,integer)'::regprocedure,
   'public.web_text_finish(uuid,uuid,jsonb)'::regprocedure, 'public.web_text_fail(uuid,uuid,text,boolean,boolean)'::regprocedure,
   'private.web_text_tick()'::regprocedure, 'private.web_text_committed()'::regprocedure, 'private.web_text_url_ok(text)'::regprocedure);
select pg_temp.ok((select count(*) = 9 from fns), 'all nine functions exist');
select pg_temp.ok((select bool_and(prosecdef and coalesce(proconfig @> array['search_path=pg_catalog, pg_temp'], false)) from fns),
  'every function is security definer with a pinned search_path');
select pg_temp.ok(not exists (select 1 from fns f, unnest(array['anon', 'authenticated']) r(r) where has_function_privilege(r.r, f.oid, 'execute')),
  'anon and authenticated can execute none of them');
select pg_temp.ok(not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where p.oid in (select oid from fns) and a.grantee = 0), 'PUBLIC can execute none of them');
select pg_temp.ok((select bool_and(has_function_privilege('corpus_ingest', oid, 'execute') = (sig ~ 'enqueue|read|status')) from fns where sig !~ '^private\.')
  and (select bool_and(not has_function_privilege('corpus_ingest', oid, 'execute')) from fns where sig ~ '^private\.'),
  'corpus_ingest may enqueue, read and read the status, and may not claim, finish, fail, tick or call the helpers');
select pg_temp.ok((select bool_and(has_function_privilege('service_role', oid, 'execute')) from fns where sig !~ '^private\.')
  and (select bool_and(not has_function_privilege('service_role', oid, 'execute')) from fns where sig ~ '^private\.'),
  'service_role may execute the six public functions and none of the three private ones');
select pg_temp.refused_as('anon', 'select public.web_text_status()', 'permission denied');
select pg_temp.refused_as('authenticated', $q$select public.web_text_read(array['x'])$q$, 'permission denied');
select pg_temp.refused_as('authenticated', $q$select public.web_text_enqueue('[]'::jsonb)$q$, 'permission denied');
select pg_temp.refused_as('corpus_ingest', 'select * from private.web_text_requests', 'permission denied');
select pg_temp.refused_as('corpus_ingest', 'select public.web_text_claim(1, 300)', 'permission denied');
select pg_temp.refused_as('corpus_ingest', $q$select public.web_text_finish(gen_random_uuid(), gen_random_uuid(), '{}'::jsonb)$q$, 'permission denied');
select pg_temp.refused_as('corpus_ingest', $q$select public.web_text_fail(gen_random_uuid(), gen_random_uuid(), 'x', false, false)$q$, 'permission denied');
select pg_temp.refused_as('service_role', 'select * from private.web_text_requests', 'permission denied');
select pg_temp.refused_as('service_role', 'update private.web_text_settings set enabled = true', 'permission denied');

-- ═══ 2. The URL rule and enqueue ═════════════════════════════════════════════


insert into act select 'enq1', pg_temp.enq(jsonb_build_array(pg_temp.item(1), pg_temp.item(2),
  pg_temp.item(3) || '{"official_url":"https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12919"}',
  pg_temp.item(4) || '{"official_url":"https://www.sebi.gov.in/legal/circulars/nov-2024/master-circular-for-stock-brokers_88012.html"}'));
select pg_temp.ok((select j from act where label = 'enq1') -> 'results' = jsonb_build_array(
    jsonb_build_object('source_key', pg_temp.key(1), 'outcome', 'queued'), jsonb_build_object('source_key', pg_temp.key(2), 'outcome', 'queued'),
    jsonb_build_object('source_key', pg_temp.key(3), 'outcome', 'queued'), jsonb_build_object('source_key', pg_temp.key(4), 'outcome', 'queued'))
  and (select count(*) = 4 and bool_and(status = 'queued' and attempts = 0 and credits = 0 and spent_usd = 0
        and desk_feature = 'Regulatory Body Watch (RBI SEBI TRAI CCI)') from private.web_text_requests),
  'an RBI press release, an RBI notification and two SEBI pages are queued on the Regulatory desk');
select pg_temp.ok((select bool_and(estimate_usd = 0.005) from private.web_text_requests),
  'the estimate is one credit at US$0.005, computed in the database');
-- A caller cannot set the estimate, the status, the text or the desk.
insert into act select 'enq5', pg_temp.enq(jsonb_build_array(pg_temp.item(5)
  || '{"estimate_usd":0.0001,"status":"done","text":"x","desk_feature":"Budget Utilisation & Schemes","credits":0}'::jsonb));
select pg_temp.ok((select j from act where label = 'enq5') -> 'results' @> '[{"outcome":"queued"}]'
  and (select estimate_usd = 0.005 and status = 'queued' and text is null and desk_feature = 'Regulatory Body Watch (RBI SEBI TRAI CCI)'
       from private.web_text_requests where source_key = pg_temp.key(5)),
  'fields the caller adds (estimate, status, text, desk) are ignored');
-- Creation order is the queue order; one transaction gives every row the same now(), so the fixture sets it.
update private.web_text_requests set created_at = now() - interval '1 hour' + (select count(*) from private.web_text_requests r2
  where r2.source_key < web_text_requests.source_key) * interval '1 minute';

-- Each form the rule admits, and the ways around it.
select pg_temp.ok(pg_temp.reason_url(10, 'https://rbidocs.rbi.org.in/rdocs/PressRelease/PDFs/PR12345.PDF') = 'official_url'
  and pg_temp.reason_url(11, 'https://rbidocs.rbi.org.in/rdocs/notification/PDFs/NT123.pdf') = 'official_url',
  'a blocked PDF on rbidocs.rbi.org.in is refused (the official page only, D2), though the host is on the desk''s list');
select pg_temp.ok(pg_temp.reason_url(12, 'https://www.sebi.gov.in/legal/circulars/nov-2024/a_1.html?x=1') = 'official_url'
  and pg_temp.reason_url(13, 'https://www.sebi.gov.in/legal/circulars/nov-2024/a_1.html#top') = 'official_url',
  'a SEBI page with a query or a fragment is refused');
select pg_temp.ok(pg_temp.reason_url(14, 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=1&x=2') = 'official_url'
  and pg_temp.reason_url(15, 'https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=1&prid=2') = 'official_url'
  and pg_temp.reason_url(16, 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?x=2&prid=1') = 'official_url',
  'an RBI page with a second query key is refused');
select pg_temp.ok(pg_temp.reason_url(17, 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?Id=1') = 'official_url'
  and pg_temp.reason_url(18, 'https://www.rbi.org.in/Scripts/NotificationUser.aspx?prid=1') = 'official_url'
  and pg_temp.reason_url(19, 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?PRID=1') = 'official_url'
  and pg_temp.reason_url(20, 'https://www.rbi.org.in/scripts/bs_pressreleasedisplay.aspx?prid=1') = 'official_url',
  'each RBI form keeps its own key name and its spelling');
select pg_temp.ok(pg_temp.reason_url(21, 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=') = 'official_url'
  and pg_temp.reason_url(22, 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=12345678') = 'official_url'
  and pg_temp.reason_url(23, 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=1a') = 'official_url'
  and pg_temp.reason_url(24, 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=1234567') is null,
  'the id is 1 to 7 digits (7 accepted, 8 or none or a letter refused)');
select pg_temp.ok(pg_temp.reason_url(25, 'https://user@www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=1') = 'official_url'
  and pg_temp.reason_url(26, 'https://www.rbi.org.in@evil.example/Scripts/BS_PressReleaseDisplay.aspx?prid=1') = 'official_url',
  'a link with credentials is refused');
select pg_temp.ok(pg_temp.reason_url(27, 'https://www.rbi.org.in:443/Scripts/BS_PressReleaseDisplay.aspx?prid=1') = 'official_url'
  and pg_temp.reason_url(28, 'https://www.sebi.gov.in:8443/legal/a_1.html') = 'official_url', 'a link with a port is refused');
select pg_temp.ok(pg_temp.reason_url(29, 'http://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=1') = 'official_url',
  'a plain http link is refused');
select pg_temp.ok(pg_temp.reason_url(30, 'https://www.rbi.org.in.evil.example/Scripts/BS_PressReleaseDisplay.aspx?prid=1') = 'official_url'
  and pg_temp.reason_url(31, 'https://rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=1') = 'official_url'
  and pg_temp.reason_url(32, 'https://www.sebi.gov.in.evil.example/a_1.html') = 'official_url',
  'a look-alike or bare host is refused');
select pg_temp.ok(pg_temp.reason_url(33, 'https://www.sebi.gov.in/legal/a%2fb.html') = 'official_url'
  and pg_temp.reason_url(34, 'https://www.sebi.gov.in/legal/a%5cb.html') = 'official_url'
  and pg_temp.reason_url(35, 'https://www.sebi.gov.in/legal/a' || chr(92) || 'b.html') = 'official_url',
  'an encoded separator or a backslash is refused');
select pg_temp.ok(pg_temp.reason_url(36, 'https://www.sebi.gov.in/legal/../x.html') = 'official_url'
  and pg_temp.reason_url(37, 'https://www.sebi.gov.in/legal/./x.html') = 'official_url'
  and pg_temp.reason_url(38, 'https://www.sebi.gov.in/../x.html') = 'official_url'
  and pg_temp.reason_url(39, 'https://www.sebi.gov.in/legal/%2e%2e/x.html') = 'official_url'
  and pg_temp.reason_url(40, 'https://www.sebi.gov.in/legal/a..b_1.html') is null,
  'a . or .. path segment is refused (a run of dots inside a name is not a segment)');
select pg_temp.ok(pg_temp.reason_url(41, 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=1' || chr(10)) = 'official_url'
  and pg_temp.reason_url(42, 'https://www.sebi.gov.in/legal/a' || chr(9) || 'b.html') = 'official_url'
  and pg_temp.reason_url(43, 'https://www.sebi.gov.in/legal/a' || chr(127) || 'b.html') = 'official_url',
  'a control character is refused');
select pg_temp.ok(pg_temp.reason_url(44, 'https://www.sebi.gov.in/legal/Circulars/a_1.html') = 'official_url'
  and pg_temp.reason_url(45, 'https://www.sebi.gov.in/legal/a_1.pdf') = 'official_url'
  and pg_temp.reason_url(46, 'https://www.sebi.gov.in/legal/a_1.htm') = 'official_url'
  and pg_temp.reason_url(47, 'https://www.sebi.gov.in/.html') = 'official_url'
  and pg_temp.reason_url(48, 'https://www.sebi.gov.in/' || repeat('a', 401) || '.html') = 'official_url'
  and pg_temp.reason_url(49, 'https://www.sebi.gov.in/' || repeat('a', 400) || '.html') is null,
  'a SEBI page is lower-case, ends .html and has a path of 1 to 400 characters');
select pg_temp.ok(pg_temp.reason_url(50, 'https://www.rbi.org.in/Scripts/AnnualReportPublications.aspx?Id=1') = 'official_url'
  and pg_temp.reason_url(51, 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx') = 'official_url'
  and pg_temp.reason_url(52, 'https://www.indiabudget.gov.in/doc/x.html') = 'official_url',
  'another page of the site, or another desk''s host, is refused');
select pg_temp.ok(pg_temp.reason(jsonb_build_array(pg_temp.item(53) || '{"official_url":12}')) = 'official_url'
  and pg_temp.reason(jsonb_build_array(pg_temp.item(54) - 'official_url')) = 'official_url',
  'a link that is not a string, or no link, is refused');
select pg_temp.ok(pg_temp.reason(jsonb_build_array(pg_temp.item(55) || '{"source_key":"ABC"}')) = 'source_key'
  and pg_temp.reason(jsonb_build_array(pg_temp.item(56) || jsonb_build_object('source_key', upper(pg_temp.key(56))))) = 'source_key',
  'a source key that is not 40 lower-case hex characters is refused');
select pg_temp.ok(pg_temp.reason(jsonb_build_array(pg_temp.item(57) || '{"pack_sha256":"zz"}')) = 'pack_sha256', 'a pack hash that is not sha256 is refused');
select pg_temp.ok(pg_temp.reason(jsonb_build_array('"text"'::jsonb)) = 'item_shape', 'an item that is not an object is refused');
select pg_temp.ok((select count(*) from private.web_text_requests) = 8, 'of the refused-form cases only the three edge cases that are allowed were queued');
select pg_temp.ok(pg_temp.reason(jsonb_build_array(pg_temp.item(1))) = 'duplicate', 'a source key already queued is refused as a duplicate');
select pg_temp.ok(pg_temp.reason(jsonb_build_array(pg_temp.item(58) || jsonb_build_object('official_url', pg_temp.url(2)))) = 'duplicate',
  'a link already queued under another key is refused as a duplicate');
select pg_temp.ok((select count(*) from private.web_text_requests) = 8, 'duplicates added nothing');
select pg_temp.refused_as('corpus_ingest', $q$select public.web_text_enqueue('{"a":1}'::jsonb)$q$, 'must be a JSON list');
select pg_temp.refused_as('corpus_ingest', $q$select public.web_text_enqueue(null)$q$, 'must be a JSON list');
select pg_temp.refused_as('corpus_ingest', $q$select public.web_text_enqueue((select jsonb_agg('{}'::jsonb) from generate_series(1, 51)))$q$, 'at most 50');
-- The host list is the desk's own: drop a host from it and enqueue follows (fail closed). Rolled back to a savepoint.
select pg_temp.ok((select hosts = array['rbidocs.rbi.org.in', 'www.rbi.org.in', 'www.sebi.gov.in'] from public.ingest_search_only_desks()
                    where desk_feature = 'Regulatory Body Watch (RBI SEBI TRAI CCI)'),
  'the Regulatory desk''s hosts, as the five-desk route lists them');
savepoint hosts;
create or replace function public.ingest_search_only_desks() returns table(desk_feature text, hosts text[])
language sql immutable set search_path = public, extensions, pg_temp as $$
 select 'Regulatory Body Watch (RBI SEBI TRAI CCI)'::text, array['rbidocs.rbi.org.in', 'www.rbi.org.in'] $$;
select pg_temp.ok(pg_temp.reason_url(900, 'https://www.sebi.gov.in/legal/circulars/nov-2024/a_1.html') = 'host_not_official',
  'a host taken off the desk''s list is refused, though the URL rule allows its form');
rollback to savepoint hosts;
-- The three allowed edge cases out of the way, so the queue holds the five requests the sections below count on.
delete from private.web_text_requests where source_key in (pg_temp.key(24), pg_temp.key(40), pg_temp.key(49));
select pg_temp.ok((select count(*) = 5 from private.web_text_requests), 'precondition: five requests queued');

-- ═══ 3. Claim: off by default, the cap of 0, then the cap ═════════════════════════

insert into act select 'claim_off', pg_temp.as_role('service_role', 'select public.web_text_claim(5, 300)');
select pg_temp.ok((select j from act where label = 'claim_off') ->> 'refused' = 'disabled'
  and (select count(*) = 5 and bool_and(status = 'queued' and attempts = 0) from private.web_text_requests),
  'while the switch is off, claim refuses and nothing is claimed');
update private.web_text_settings set enabled = true, function_url = 'https://abcdefghijklmnopqrst.supabase.co/functions/v1/web-text';
insert into act select 'claim_cap0', pg_temp.as_role('service_role', 'select public.web_text_claim(5, 300)');
select pg_temp.ok((select j from act where label = 'claim_cap0') ->> 'refused' = 'cap' and (select j from act where label = 'claim_cap0') -> 'claimed' = '[]'::jsonb
  and (select count(*) = 5 and bool_and(status = 'queued' and attempts = 0) from private.web_text_requests),
  'switched on with the default cap of 0, claim refuses every request (cap): applying and enabling spends nothing');
update private.web_text_settings set cap_usd = 0.01;
-- The estimate is the CURRENT price: raise it after enqueue and fewer requests fit. Rolled back to a savepoint.
savepoint price_up;
update private.web_text_settings set usd_per_credit = 0.006;
create temp table c_price as select pg_temp.as_role('service_role', 'select public.web_text_claim(5, 300)') j;
select pg_temp.ok((select jsonb_array_length(j -> 'claimed') = 1 and j ->> 'refused' = 'cap' from c_price)
  and (select count(*) = 1 from private.web_text_requests where status = 'running' and estimate_usd = 0.006),
  'price raised to 0.006 after enqueue, cap 0.01: one claims (0.006 + 0.006 = 0.012 passes the cap) at the current price');
rollback to savepoint price_up;
select pg_temp.ok((select usd_per_credit = 0.005 from private.web_text_settings) and (select count(*) = 5 and bool_and(status = 'queued') from private.web_text_requests),
  'the price rise and its claim are rolled back');
create temp table c1 as select pg_temp.as_role('service_role', 'select public.web_text_claim(5, 300)') j;
select pg_temp.ok((select jsonb_array_length(j -> 'claimed') = 2 and j ->> 'refused' = 'cap' and (j ->> 'committed_usd')::numeric = 0.010 from c1),
  'cap 0.01: two requests (0.005 + 0.005 = 0.010, exactly the cap) are claimed and the third (0.015, just over) is refused');
select pg_temp.ok((select array_agg(e ->> 'source_key' order by e ->> 'source_key') from c1, jsonb_array_elements(c1.j -> 'claimed') e)
    = (select array_agg(source_key order by source_key) from (select source_key from private.web_text_requests order by created_at, id limit 2) t),
  'claims follow the queue order (creation time)');
select pg_temp.ok((select count(*) = 3 from private.web_text_requests where status = 'queued')
  and (select count(*) = 2 from private.web_text_requests where status = 'running' and attempts = 1 and claim_token is not null and lease_until > now()),
  'the refused requests stay queued; the two claimed ones are running with a token and a lease');
select pg_temp.ok((select bool_and(e ? 'official_url' and e ? 'id' and e ? 'token' and e ? 'source_key' and (e ->> 'attempt')::int = 1)
                   from c1, jsonb_array_elements(c1.j -> 'claimed') e),
  'a claim carries the id, the token, the key, the official URL and the attempt (1), for the x-request-id');
select pg_temp.ok(private.web_text_committed() = 0.010, 'the running estimates are reserved against the cap');
insert into act select 'claim_cap', pg_temp.as_role('service_role', 'select public.web_text_claim(5, 300)');
select pg_temp.ok((select j from act where label = 'claim_cap') ->> 'refused' = 'cap' and (select j from act where label = 'claim_cap') -> 'claimed' = '[]'::jsonb,
  'a second claim at the cap claims nothing');
-- Two claims at once cannot both pass the cap check: claim first locks the single settings row (FOR UPDATE), so a second
-- claim waits for the first to commit. One session cannot run two claims at once, so the lock is checked in the source.
select pg_temp.ok((select regexp_replace(prosrc, '\s+', ' ', 'g') ~ 'select \* into s from private\.web_text_settings for update; if not s\.enabled'
   from pg_proc where oid = 'public.web_text_claim(integer,integer)'::regprocedure),
  'claim locks the settings row before it reads the committed total (the cap check is serialised across claims)');
select pg_temp.ok((select bool_and(regexp_replace(prosrc, '\s+', ' ', 'g') ~ 'select \* into s from private\.web_text_settings for update; select \* into r from private\.web_text_requests where id = p_id for update;')
   from pg_proc where oid in ('public.web_text_finish(uuid,uuid,jsonb)'::regprocedure, 'public.web_text_fail(uuid,uuid,text,boolean,boolean)'::regprocedure)),
  'finish and fail lock the settings row, then the request (the order claim takes): the halt counter cannot lose an update');
select pg_temp.refused_as('service_role', 'select public.web_text_claim(6, 300)', 'limit 1 to 5');
select pg_temp.refused_as('service_role', 'select public.web_text_claim(0, 300)', 'limit 1 to 5');
select pg_temp.refused_as('service_role', 'select public.web_text_claim(1, 5)', 'lease 30 to 900');
select pg_temp.refused_as('service_role', 'select public.web_text_claim(1, 901)', 'lease 30 to 900');

-- ═══ 4. Finish ═══════════════════════════════════════════════════════════════

-- A request that stays queued to the end (three of the five are never claimed again).
create temp table q as select source_key k from private.web_text_requests where status = 'queued' order by source_key limit 1;
create temp table c1ids as select e c, e ->> 'source_key' k from c1, jsonb_array_elements(c1.j -> 'claimed') e;
create temp table one as select (select c from c1ids order by k limit 1) c, (select k from c1ids order by k limit 1) k;
create temp table two as select (select c from c1ids order by k desc limit 1) c, (select k from c1ids order by k desc limit 1) k;
insert into act select 'fin_stale', pg_temp.finish((select c from one) || jsonb_build_object('token', gen_random_uuid()), pg_temp.good());
select pg_temp.ok((select j from act where label = 'fin_stale') ->> 'outcome' = 'stale'
  and (select status = 'running' and text is null and credits = 0 from private.web_text_requests where source_key = (select k from one)),
  'a finish with the wrong token is stale and changes nothing');
-- The request for key(1) is a press release; for the finish the host must be the official URL's host.
insert into act select 'fin_done', pg_temp.finish((select c from one), pg_temp.good() || jsonb_build_object('final_url_host',
  substring((select official_url from private.web_text_requests where source_key = (select k from one)) from '^https://([^/]+)/')));
select pg_temp.ok((select j from act where label = 'fin_done') ->> 'outcome' = 'done'
  and (select status = 'done' and credits = 1 and cost_usd = 0.005 and spent_usd = 0.005 and claim_token is null and lease_until is null
        and finished_at is not null and scraped_at is not null and source_status = 200 and content_type = 'text/html; charset=utf-8'
        and text = pg_temp.good() ->> 'text' and text_sha256 = encode(sha256(convert_to(pg_temp.good() ->> 'text', 'UTF8')), 'hex')
        from private.web_text_requests where source_key = (select k from one)),
  'a finish stores the text, its sha256 (computed here), the site status, the host, the content type, one credit and its cost');
select pg_temp.ok(private.web_text_committed() = 0.010, 'committed: 0.005 spent + 0.005 still reserved');
insert into act select 'fin_again', pg_temp.finish((select c from one), pg_temp.good());
select pg_temp.ok((select j from act where label = 'fin_again') ->> 'outcome' = 'stale' and (select credits = 1 from private.web_text_requests where source_key = (select k from one)),
  'a second finish of a done request is stale: no second credit');
-- Read back: text only for done requests, by key.
create temp table rd as select pg_temp.as_role('corpus_ingest', format('select public.web_text_read(%L::text[])',
  array[(select k from one), (select k from two), (select k from q), 'nope']::text)) j;
select pg_temp.ok((select jsonb_array_length(j) = 3 from rd), 'read returns the requests that exist, by key');
select pg_temp.ok((select e ->> 'text' = pg_temp.good() ->> 'text' and e ->> 'status' = 'done' and (e ->> 'credits')::int = 1
                     and (e ->> 'source_status')::int = 200 and e ->> 'text_sha256' ~ '^[0-9a-f]{64}$' and e ->> 'pack_sha256' = repeat('a', 64)
                   from rd, jsonb_array_elements(rd.j) e where e ->> 'source_key' = (select k from one))
  and (select (e -> 'text') = 'null'::jsonb and e ->> 'status' = 'running' from rd, jsonb_array_elements(rd.j) e where e ->> 'source_key' = (select k from two))
  and (select (e -> 'text') = 'null'::jsonb and e ->> 'status' = 'queued' from rd, jsonb_array_elements(rd.j) e where e ->> 'source_key' = (select k from q)),
  'text comes back only for the done request; the running and the queued ones carry none');
select pg_temp.refused_as('corpus_ingest', $q$select public.web_text_read(null)$q$, '1 to 50 keys');
select pg_temp.refused_as('corpus_ingest', $q$select public.web_text_read(array[]::text[])$q$, '1 to 50 keys');
select pg_temp.refused_as('corpus_ingest', $q$select public.web_text_read((select array_agg(g::text) from generate_series(1, 51) g))$q$, '1 to 50 keys');

-- A result the done rule does not accept fails the request for good, keeps no text, and still counts the credit.
update private.web_text_settings set cap_usd = 100;
create function pg_temp.finish_case(n int, res jsonb) returns jsonb language plpgsql as $$declare c jsonb; begin
 c := pg_temp.claim_one(n); return pg_temp.finish(c, res); end$$;
insert into act select 'fin_404', pg_temp.finish_case(101, pg_temp.good() || '{"source_status":404}');
insert into act select 'fin_host', pg_temp.finish_case(102, pg_temp.good() || '{"final_url_host":"www.rbi.org.in.evil.example"}');
insert into act select 'fin_pdf', pg_temp.finish_case(103, pg_temp.good() || '{"content_type":"application/pdf"}');
insert into act select 'fin_htmlx', pg_temp.finish_case(104, pg_temp.good() || '{"content_type":"text/htmlx"}');
insert into act select 'fin_empty', pg_temp.finish_case(105, pg_temp.good(' ' || chr(10) || ' '));
insert into act select 'fin_nonstr', pg_temp.finish_case(106, pg_temp.good() || '{"text":["x"]}');
insert into act select 'fin_null', pg_temp.finish_case(107, null);
insert into act select 'fin_status_str', pg_temp.finish_case(108, pg_temp.good() || '{"source_status":"200"}');
insert into act select 'fin_noctype', pg_temp.finish_case(109, pg_temp.good() - 'content_type');
select pg_temp.ok((select bool_and(j ->> 'outcome' = 'failed' and j ->> 'code' = 'finish_invalid') from act where label in
    ('fin_404', 'fin_host', 'fin_pdf', 'fin_htmlx', 'fin_empty', 'fin_nonstr', 'fin_null', 'fin_status_str', 'fin_noctype')),
  'site status not 200, another host, a non-HTML content type, an empty or non-string text, no result: each fails as finish_invalid');
select pg_temp.ok((select count(*) = 9 and bool_and(status = 'failed' and error_code = 'finish_invalid' and text is null and credits = 1
                     and spent_usd = 0.005 and cost_usd = 0.005 and attempts = 1 and finished_at is not null and claim_token is null)
                   from private.web_text_requests where source_key in (select pg_temp.key(g) from generate_series(101, 109) g)),
  'each is failed for good with no text kept and one credit counted');
insert into act select 'fin_long', pg_temp.finish_case(110, pg_temp.good(repeat('a', 2000001)));
select pg_temp.ok((select j ->> 'code' = 'text_too_long' from act where label = 'fin_long')
  and (select status = 'failed' and text is null and credits = 1 and spent_usd = 0.005 from pg_temp.req(110)),
  'a text over 2,000,000 characters fails as text_too_long, with its credit counted');
-- Finish and fail charge the price reserved at claim (estimate_usd), not a price changed while the scrape ran. Rolled back.
savepoint price_mid;
create temp table c_mid1 as select pg_temp.claim_one(120) c;
create temp table c_mid2 as select pg_temp.claim_one(121) c;
create temp table c_mid3 as select pg_temp.claim_one(122) c;
update private.web_text_settings set usd_per_credit = 0.009;
insert into act select 'mid_fin', pg_temp.finish((select c from c_mid1), pg_temp.good());
insert into act select 'mid_fail', pg_temp.fail((select c from c_mid2), 'source_status_404', false, false);
insert into act select 'mid_bad', pg_temp.finish((select c from c_mid3), pg_temp.good() || '{"source_status":404}');
select pg_temp.ok((select status = 'done' and cost_usd = 0.005 and spent_usd = 0.005 from pg_temp.req(120))
  and (select status = 'queued' and cost_usd = 0.005 and spent_usd = 0.005 from pg_temp.req(121))
  and (select status = 'failed' and error_code = 'finish_invalid' and cost_usd = 0.005 and spent_usd = 0.005 from pg_temp.req(122))
  and (select (j ->> 'cost_usd')::numeric = 0.005 from act where label = 'mid_fin'),
  'price raised to 0.009 while three scrapes ran: the finish, the billed fail and the refused finish each charge the 0.005 reserved at claim');
rollback to savepoint price_mid;
insert into act select 'fin_max', pg_temp.finish_case(111, pg_temp.good(repeat('a', 2000000)) || '{"content_type":"application/xhtml+xml"}');
select pg_temp.ok((select j ->> 'outcome' = 'done' from act where label = 'fin_max') and (select status = 'done' and char_length(text) = 2000000 from pg_temp.req(111)),
  'exactly 2,000,000 characters of XHTML is stored');
select pg_temp.ok((select (j ->> 'outcome') = 'done' from act where label = 'fin_done')
  and (pg_temp.as_role('corpus_ingest', 'select public.web_text_status()')) -> 'by_status' @> '{"done":2,"running":1,"failed":10,"queued":3}'
  and (pg_temp.as_role('corpus_ingest', 'select public.web_text_status()')) -> 'by_code' @> '{"finish_invalid":9,"text_too_long":1}'
  and ((pg_temp.as_role('corpus_ingest', 'select public.web_text_status()')) ->> 'credits')::int = 12
  and (pg_temp.as_role('corpus_ingest', 'select public.web_text_status()')) @> '{"enabled":true,"function_url_set":true,"cap_usd":100,"usd_per_credit":0.005}',
  'status: counts by status and by code, credits, the cap, the price, the switch');

-- ═══ 5. Fail: money and retries by code ═══════════════════════════════════════

-- Section 6 tests the halt rule; here every code is tried once, so the run must not halt (restored there).
update private.web_text_settings set halt_source_errors = 100;
-- The second claim of c1 is retried after a rate limit (not billed).
insert into act select 'fail_rl', pg_temp.fail((select c from two), 'firecrawl_rate_limited', false, false);
select pg_temp.ok((select j ->> 'outcome' = 'queued' from act where label = 'fail_rl')
  and (select status = 'queued' and error_code = 'firecrawl_rate_limited' and spent_usd = 0 and credits = 0 and claim_token is null and attempts = 0
       from private.web_text_requests where source_key = (select k from two)),
  'a rate limit (429, not billed) is queued again, adds no spend and gives the attempt back');
insert into act select 'fail_rl2', pg_temp.fail((select c from two), 'firecrawl_rate_limited', false, false);
select pg_temp.ok((select j ->> 'outcome' = 'stale' from act where label = 'fail_rl2'), 'a second report on the same claim is stale');
-- One request per code, each on its first attempt (max_attempts is 2). Halt run kept below 5 here; section 6 tests it.
create function pg_temp.fail_case(n int, code text, uncertain boolean, permanent boolean) returns jsonb language plpgsql as $$declare c jsonb; begin
 c := pg_temp.claim_one(n); return pg_temp.fail(c, code, uncertain, permanent); end$$;
insert into act select 'f_src', pg_temp.fail_case(201, 'source_status_403', false, false);
insert into act select 'f_nothtml', pg_temp.fail_case(202, 'not_html', false, false);
insert into act select 'f_redir', pg_temp.fail_case(203, 'redirected_off_host', false, false);
insert into act select 'f_empty', pg_temp.fail_case(204, 'empty_text', false, false);
insert into act select 'f_report', pg_temp.fail_case(205, 'report_failed', true, false);
insert into act select 'f_rl_unc', pg_temp.fail_case(207, 'firecrawl_rate_limited', true, false);
insert into act select 'f_unavail', pg_temp.fail_case(208, 'firecrawl_unavailable', true, false);
insert into act select 'f_timeout', pg_temp.fail_case(209, 'firecrawl_timeout', false, false);
insert into act select 'f_dup', pg_temp.fail_case(210, 'firecrawl_duplicate', true, false);
insert into act select 'f_unread', pg_temp.fail_case(211, 'firecrawl_unreadable', true, false);
insert into act select 'f_badcode', pg_temp.fail_case(212, 'Bad Code!', false, false);
insert into act select 'f_perm', pg_temp.fail_case(213, 'firecrawl_unavailable', true, true);
insert into act select 'f_redirected', pg_temp.fail_case(214, 'redirected', false, true);
insert into act select 'f_large', pg_temp.fail_case(215, 'firecrawl_too_large', false, true);
insert into act select 'f_badurl', pg_temp.fail_case(216, 'official_url_invalid', false, true);
create temp table money(n int, code text, outcome text, spent numeric, credits int);
insert into money values (201, 'source_status_403', 'queued', 0.005, 1), (202, 'not_html', 'failed', 0.005, 1),
  (203, 'redirected_off_host', 'failed', 0.005, 1), (204, 'empty_text', 'failed', 0.005, 1), (205, 'report_failed', 'failed', 0.005, 1),
  (207, 'firecrawl_rate_limited', 'queued', 0.005, 0), (208, 'firecrawl_unavailable', 'queued', 0.005, 0),
  (209, 'firecrawl_timeout', 'queued', 0.005, 0), (210, 'firecrawl_duplicate', 'queued', 0.005, 0), (211, 'firecrawl_unreadable', 'queued', 0.005, 0),
  (212, 'unknown', 'queued', 0.005, 0), (213, 'firecrawl_unavailable', 'failed', 0.005, 0),
  (214, 'redirected', 'failed', 0.005, 1), (215, 'firecrawl_too_large', 'failed', 0.005, 1), (216, 'official_url_invalid', 'failed', 0, 0);
select pg_temp.ok(not exists (select 1 from money m, private.web_text_requests r where r.source_key = pg_temp.key(m.n)
    and not (r.status = m.outcome and r.error_code = m.code and r.spent_usd = m.spent and r.credits = m.credits and r.claim_token is null
             and r.attempts = case when m.code = 'firecrawl_rate_limited' then 0 else 1 end and (r.finished_at is not null) = (m.outcome = 'failed')))
  and (select count(*) = 15 from money m, private.web_text_requests r where r.source_key = pg_temp.key(m.n)),
  'money and retry by code: a returned document 1 credit; an unbilled 429 or a URL refused before any request nothing; a timeout, a 5xx, a duplicate id, an unreadable answer or an unknown code its estimate; the final codes end the request');
select pg_temp.ok((select status = 'failed' and spent_usd = 0.005 and cost_usd = 0.005 and credits = 1 from pg_temp.req(214))
  and (select status = 'failed' and spent_usd = 0.005 and cost_usd = 0.005 and credits = 1 from pg_temp.req(215))
  and (select status = 'failed' and spent_usd = 0 and cost_usd is null and credits = 0 from pg_temp.req(216)),
  'redirected and firecrawl_too_large are billed one credit and final; official_url_invalid (never sent) is free and final');
-- The code alone decides: with the permanent flag false, redirected, firecrawl_too_large and official_url_invalid still end it.
insert into act select 'f_redirected_np', pg_temp.fail_case(217, 'redirected', false, false);
insert into act select 'f_large_np', pg_temp.fail_case(218, 'firecrawl_too_large', false, false);
insert into act select 'f_badurl_np', pg_temp.fail_case(219, 'official_url_invalid', false, false);
select pg_temp.ok((select bool_and(j ->> 'outcome' = 'failed') from act where label in ('f_redirected_np', 'f_large_np', 'f_badurl_np'))
  and (select spent_usd = 0 from pg_temp.req(219)),
  'redirected, firecrawl_too_large and official_url_invalid are final whatever the permanent flag');
select pg_temp.ok((select j ->> 'outcome' = 'failed' from act where label = 'f_nothtml') and (select j ->> 'outcome' = 'queued' from act where label = 'f_src')
  and (select cost_usd = 0.005 from pg_temp.req(201)) and (select cost_usd is null from pg_temp.req(208)),
  'fail answers queued or failed; a billed failure records its cost, an uncertain one only its spend');
select pg_temp.ok((select error_code = 'firecrawl_timeout' and spent_usd = 0.005 from pg_temp.req(209)),
  'a timeout counts its estimate even when the caller says it was not billed (uncertain can only add money)');
-- Retried once: the second attempt of a site refusal is final, with both credits counted.
insert into act select 'f_src2', pg_temp.fail(pg_temp.claim_one(201), 'source_status_403', false, false);
select pg_temp.ok((select j ->> 'outcome' = 'failed' from act where label = 'f_src2')
  and (select status = 'failed' and attempts = 2 and spent_usd = 0.010 and credits = 2 and cost_usd = 0.010 from pg_temp.req(201)),
  'a site status other than 200 is retried once; the second is final, both credits counted');
insert into act select 'f_to2', pg_temp.fail(pg_temp.claim_one(209), 'firecrawl_timeout', true, false);
select pg_temp.ok((select j ->> 'outcome' = 'failed' from act where label = 'f_to2') and (select status = 'failed' and attempts = 2 and spent_usd = 0.010 from pg_temp.req(209)),
  'retries stop at max_attempts (2), every uncertain attempt counted');
insert into act select 'claim_none', (select jsonb_build_object('n', count(*)) from private.web_text_requests where status = 'queued' and source_key in (pg_temp.key(201), pg_temp.key(209)));
select pg_temp.ok((select (j ->> 'n')::int = 0 from act where label = 'claim_none'), 'a failed request is not queued again');
-- A rate limit does not use up an attempt: two 429s in a row and the request still has both its tries.
insert into act select 'rl_a', pg_temp.fail(pg_temp.claim_one(220), 'firecrawl_rate_limited', false, false);
insert into act select 'rl_b', pg_temp.fail(pg_temp.claim_one(220), 'firecrawl_rate_limited', false, false);
select pg_temp.ok((select bool_and(j ->> 'outcome' = 'queued') from act where label in ('rl_a', 'rl_b'))
  and (select status = 'queued' and attempts = 0 and spent_usd = 0 from pg_temp.req(220)),
  'a 429 gives its attempt back: claimed twice (max_attempts 2), it is still queued with no attempt used');
insert into act select 'rl_c', pg_temp.fail(pg_temp.claim_one(220), 'source_status_404', false, false);
select pg_temp.ok((select j ->> 'outcome' = 'queued' from act where label = 'rl_c') and (select attempts = 1 and status = 'queued' from pg_temp.req(220)),
  'after the 429s a site refusal uses the first attempt; one try is left');
-- Every failure that counted money adds one to the run (halt_source_errors is 100 here). Of this section's 24 reports that
-- were not stale, the five free ones (unbilled 429s on request two and twice on 220, two official_url_invalid) do not count.
select pg_temp.ok((select source_error_run = 19 and enabled from private.web_text_settings),
  'precondition for the halt rule: each of the 19 billed or uncertain failures of this section counted, with no done since; the run is on');

-- ═══ 6. The halt rule; switch off on 401 and 402 ═══════════════════════════════════

update private.web_text_settings set halt_source_errors = 5;
-- A done request ends the run of source errors.
insert into act select 'fin_reset', pg_temp.finish(pg_temp.claim_one(301), pg_temp.good());
select pg_temp.ok((select j ->> 'outcome' = 'done' from act where label = 'fin_reset') and (select source_error_run = 0 from private.web_text_settings),
  'a done request sets the run of source errors back to 0');
-- Four billed or uncertain failures, with free ones between them, do not halt; the fifth does.
insert into act select 'h1', pg_temp.fail_case(311, 'source_status_404', false, false);
insert into act select 'h1x', pg_temp.fail_case(312, 'firecrawl_rate_limited', false, false);
insert into act select 'h2', pg_temp.fail_case(313, 'not_html', false, false);
insert into act select 'h2x', pg_temp.fail_case(314, 'official_url_invalid', false, true);
insert into act select 'h3', pg_temp.fail_case(315, 'redirected', false, true);
insert into act select 'h4', pg_temp.fail_case(316, 'firecrawl_timeout', true, false);
select pg_temp.ok((select source_error_run = 4 and enabled and halted_reason is null from private.web_text_settings)
  and (select bool_and(j -> 'halted' = 'null'::jsonb) from act where label in ('h1', 'h1x', 'h2', 'h2x', 'h3', 'h4')),
  'four billed or uncertain failures (free failures between them neither count nor reset): the run is still on');
insert into act select 'h5', pg_temp.fail_case(317, 'source_status_403', false, false);
select pg_temp.ok((select j ->> 'halted' = 'source_errors' from act where label = 'h5')
  and (select not enabled and halted_reason = 'source_errors' and source_error_run = 0 from private.web_text_settings),
  'the fifth source error in a row switches the run OFF (halted_reason source_errors) and starts the count again');
select pg_temp.ok((select status = 'queued' and spent_usd = 0.005 and credits = 1 from pg_temp.req(317)), 'the halting request itself is recorded as any other');
insert into act select 'claim_halted', pg_temp.as_role('service_role', 'select public.web_text_claim(5, 300)');
select pg_temp.ok((select j ->> 'refused' = 'disabled' from act where label = 'claim_halted'), 'after the halt, claim refuses until the developer switches it back on');
select pg_temp.ok((pg_temp.as_role('corpus_ingest', 'select public.web_text_status()')) @> '{"enabled":false,"halted_reason":"source_errors","source_error_run":0}',
  'status shows the halt and why');
-- A smaller limit is honoured.
update private.web_text_settings set enabled = true, halted_reason = null, halt_source_errors = 1;
insert into act select 'h_one', pg_temp.fail_case(318, 'not_html', false, false);
select pg_temp.ok((select j ->> 'halted' = 'source_errors' from act where label = 'h_one') and not (select enabled from private.web_text_settings),
  'with halt_source_errors 1, one not_html halts the run');
-- Each code that may have cost money counts toward the halt, each free one does not: with a limit of 1, one report of
-- each code, the run switched back on before each.
create temp table halt_cases(n int, code text, uncertain boolean, want text);
insert into halt_cases values
  (331, 'source_status_500', false, 'source_errors'), (332, 'not_html', false, 'source_errors'),
  (333, 'redirected_off_host', false, 'source_errors'), (334, 'redirected', false, 'source_errors'),
  (335, 'empty_text', false, 'source_errors'), (336, 'firecrawl_too_large', false, 'source_errors'),
  (337, 'firecrawl_timeout', true, 'source_errors'), (338, 'firecrawl_unavailable', true, 'source_errors'),
  (339, 'firecrawl_unreadable', true, 'source_errors'), (340, 'firecrawl_duplicate', true, 'source_errors'),
  (341, 'report_failed', true, 'source_errors'), (342, 'Bad Code!', false, 'source_errors'),
  (343, 'firecrawl_rate_limited', true, 'source_errors'),
  (344, 'firecrawl_rate_limited', false, null), (345, 'official_url_invalid', false, null);
do $$declare r record; begin
 for r in select * from halt_cases order by n loop
  update private.web_text_settings set enabled = true, halted_reason = null, source_error_run = 0;
  insert into act select 'halt_' || r.n, pg_temp.fail_case(r.n, r.code, r.uncertain, false);
 end loop; end$$;
select pg_temp.ok(not exists (select 1 from halt_cases h join act a on a.label = 'halt_' || h.n where (a.j ->> 'halted') is distinct from h.want)
  and (select count(*) = 15 from halt_cases h join act a on a.label = 'halt_' || h.n),
  'every billed or uncertain failure (site status, not HTML, redirected, empty, too large, timeout, 5xx, unreadable, duplicate id, report failed, unknown code, a 429 that may have been billed) counts toward the halt; an unbilled 429 and official_url_invalid do not');
-- A lapsed lease is an uncertain failure too: claim counts it toward the halt, and stops when the limit is reached.
update private.web_text_settings set enabled = true, halted_reason = null, source_error_run = 0;
create temp table c_lapse as select pg_temp.claim_one(351) c;
update private.web_text_requests set lease_until = now() - interval '1 minute' where source_key = pg_temp.key(351);
insert into act select 'claim_lapse_halt', pg_temp.as_role('service_role', 'select public.web_text_claim(5, 300)');
select pg_temp.ok((select j ->> 'refused' = 'disabled' and j ->> 'halted' = 'source_errors' and j -> 'claimed' = '[]'::jsonb from act where label = 'claim_lapse_halt')
  and (select not enabled and halted_reason = 'source_errors' and source_error_run = 0 from private.web_text_settings)
  and (select status = 'queued' and error_code = 'lease_expired' and spent_usd = 0.005 from pg_temp.req(351)),
  'with a limit of 1, one lapsed lease switches the run OFF in claim (source_errors), its estimate counted, nothing claimed');
update private.web_text_settings set enabled = true, halted_reason = null, halt_source_errors = 5;
-- 401 or 403 (a wrong key, a forbidden feature) and 402 (no credits) switch the run off at once, and count nothing.
insert into act select 'f_401', pg_temp.fail_case(321, 'firecrawl_forbidden', false, true);
select pg_temp.ok((select j ->> 'outcome' = 'failed' and j ->> 'halted' = 'firecrawl_forbidden' from act where label = 'f_401')
  and (select not enabled and halted_reason = 'firecrawl_forbidden' from private.web_text_settings)
  and (select status = 'failed' and spent_usd = 0 and credits = 0 from pg_temp.req(321)),
  'firecrawl_forbidden (401, 403) fails the request with nothing spent and switches the run OFF');
update private.web_text_settings set enabled = true, halted_reason = null;
-- The code alone decides: the function's permanent flag left false still ends it and still switches off.
insert into act select 'f_402', pg_temp.fail_case(322, 'firecrawl_no_credits', false, false);
select pg_temp.ok((select j ->> 'outcome' = 'failed' and j ->> 'halted' = 'firecrawl_no_credits' from act where label = 'f_402')
  and (select not enabled and halted_reason = 'firecrawl_no_credits' from private.web_text_settings)
  and (select status = 'failed' and spent_usd = 0 and credits = 0 from pg_temp.req(322)),
  'firecrawl_no_credits (402) fails the request with nothing spent and switches the run OFF, whatever the permanent flag');
update private.web_text_settings set enabled = true, halted_reason = null;
-- 400 (our request body is wrong) is free but would fail every request the same way: it switches the run off at once.
insert into act select 'f_400', pg_temp.fail_case(323, 'firecrawl_rejected', false, false);
select pg_temp.ok((select j ->> 'outcome' = 'failed' and j ->> 'halted' = 'firecrawl_rejected' from act where label = 'f_400')
  and (select not enabled and halted_reason = 'firecrawl_rejected' from private.web_text_settings)
  and (select status = 'failed' and spent_usd = 0 and credits = 0 from pg_temp.req(323)),
  'firecrawl_rejected (400) fails the request with nothing spent and switches the run OFF');
update private.web_text_settings set enabled = true, halted_reason = null;

-- ═══ 7. The lease ═══════════════════════════════════════════════════════════════

-- A lease that ran out: the work was lost without an answer, so its estimate counts as spent and it is claimed again.
create temp table c8 as select pg_temp.claim_one(401) c;
update private.web_text_requests set lease_until = now() - interval '1 minute' where source_key = pg_temp.key(401);
create temp table c9 as select pg_temp.claim_one(401) c;
select pg_temp.ok((select error_code is null and attempts = 2 and spent_usd = 0.005 and status = 'running' and credits = 0 from pg_temp.req(401))
  and (select c ->> 'token' <> (select c ->> 'token' from c8) and (c ->> 'attempt')::int = 2 from c9)
  and (select source_error_run = 1 and enabled from private.web_text_settings),
  'an expired lease counts its estimate as spent, adds one to the halt run, and the request is claimed again (attempt 2, a new token)');
insert into act select 'fin_late', pg_temp.finish((select c from c8), pg_temp.good());
select pg_temp.ok((select j ->> 'outcome' = 'stale' from act where label = 'fin_late') and (select status = 'running' and text is null from pg_temp.req(401)),
  'the first claimant''s late answer is stale: the token belongs to the second claim');
-- The lease runs out on the LAST attempt: the request ends as failed and is not claimed again.
update private.web_text_requests set lease_until = now() - interval '1 minute' where source_key = pg_temp.key(401);
insert into act select 'claim_after_last', pg_temp.as_role('service_role', 'select public.web_text_claim(1, 300)');
select pg_temp.ok((select status = 'failed' and error_code = 'lease_expired' and attempts = 2 and spent_usd = 0.010 and finished_at is not null and claim_token is null
                   from pg_temp.req(401))
  and not exists (select 1 from act, jsonb_array_elements(j -> 'claimed') e where label = 'claim_after_last' and e ->> 'source_key' = pg_temp.key(401)),
  'a lease that expires at max_attempts ends the request as failed (lease_expired) with its estimate counted');

-- ═══ 8. The cron body: inert until switched on ═══════════════════════════════════

create schema net; create schema vault;
create table public.http_calls_fixture(url text, headers jsonb, body jsonb);
create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int) returns bigint language sql as $$
 insert into public.http_calls_fixture values (url, headers, body) returning 1::bigint $$;
create table vault.decrypted_secrets(name text, decrypted_secret text);
create temp table tk(label text primary key, r text);

update private.web_text_settings set enabled = false;
insert into tk select 'off', private.web_text_tick();
select pg_temp.ok((select r from tk where label = 'off') = 'disabled' and (select count(*) = 0 from public.http_calls_fixture), 'tick does nothing while the switch is off');
update private.web_text_settings set enabled = true, function_url = null;
insert into tk select 'nourl', private.web_text_tick();
select pg_temp.ok((select r from tk where label = 'nourl') = 'disabled' and (select count(*) = 0 from public.http_calls_fixture), 'tick does nothing without a function URL');
update private.web_text_settings set function_url = 'https://abcdefghijklmnopqrst.supabase.co/functions/v1/web-text';
savepoint idle;
update private.web_text_requests set status = 'failed', finished_at = now(), claim_token = null, lease_until = null where status in ('queued', 'running');
insert into tk select 'idle', private.web_text_tick();
select pg_temp.ok((select r from tk where label = 'idle') = 'idle' and (select count(*) = 0 from public.http_calls_fixture), 'tick does nothing when nothing is queued');
rollback to savepoint idle;
delete from tk where label = 'idle';
select pg_temp.ok((select count(*) > 0 from private.web_text_requests where status = 'queued'), 'precondition: requests are queued');
update private.web_text_settings set cap_usd = 0;
insert into tk select 'cap0', private.web_text_tick();
select pg_temp.ok((select r from tk where label = 'cap0') = 'cap' and (select count(*) = 0 from public.http_calls_fixture), 'tick does nothing with the default cap of 0');
update private.web_text_settings set cap_usd = private.web_text_committed() + 0.004;
insert into tk select 'cap', private.web_text_tick();
select pg_temp.ok((select r from tk where label = 'cap') = 'cap' and (select count(*) = 0 from public.http_calls_fixture),
  'tick does nothing when one more credit would pass the cap');
update private.web_text_settings set cap_usd = 100;
insert into tk select 'nosecret', private.web_text_tick();
select pg_temp.ok((select r from tk where label = 'nosecret') = 'no_secret' and (select count(*) = 0 from public.http_calls_fixture), 'tick does nothing without the secret in the vault');
insert into vault.decrypted_secrets values ('budget_ocr_secret', 'other-function-secret');
insert into tk select 'othersecret', private.web_text_tick();
select pg_temp.ok((select r from tk where label = 'othersecret') = 'no_secret', 'another function''s secret is not this one''s');
insert into vault.decrypted_secrets values ('web_text_secret', 'fixture-secret');
insert into tk select 'called', private.web_text_tick();
select pg_temp.ok((select r from tk where label = 'called') = 'called'
  and (select count(*) = 1 and bool_and(url = 'https://abcdefghijklmnopqrst.supabase.co/functions/v1/web-text'
         and headers ->> 'x-web-text-secret' = 'fixture-secret' and headers ->> 'content-type' = 'application/json' and body = '{}'::jsonb)
       from public.http_calls_fixture),
  'tick posts {} to the function with the x-web-text-secret header when on, queued and under the cap');
-- A lapsed lease is work for claim to count even when the cap is reached.
create temp table c10 as select pg_temp.claim_one(501) c;
update private.web_text_requests set lease_until = now() - interval '1 minute' where source_key = pg_temp.key(501);
update private.web_text_settings set cap_usd = private.web_text_committed();
insert into tk select 'lapsed', private.web_text_tick();
select pg_temp.ok((select r from tk where label = 'lapsed') = 'called', 'tick calls the function at the cap when a lease has lapsed (claim counts it)');
select pg_temp.refused_as('corpus_ingest', 'select private.web_text_tick()', 'permission denied');
select pg_temp.refused_as('service_role', 'select private.web_text_tick()', 'permission denied');
select pg_temp.refused_as('service_role', 'select private.web_text_committed()', 'permission denied');
select pg_temp.refused_as('corpus_ingest', $q$select private.web_text_url_ok('x')$q$, 'permission denied');

-- ═══ 9. Constraints ═══════════════════════════════════════════════════════════

select pg_temp.refused_as('postgres', $q$update private.web_text_settings set function_url = 'https://evil.example/functions/v1/web-text'$q$, 'check constraint');
select pg_temp.refused_as('postgres', $q$update private.web_text_settings set function_url = 'https://abcdefghijklmnopqrst.supabase.co.evil.example/functions/v1/web-text'$q$, 'check constraint');
select pg_temp.refused_as('postgres', $q$update private.web_text_settings set function_url = 'https://abc.supabase.co/functions/v1/web-text'$q$, 'check constraint');
select pg_temp.refused_as('postgres', $q$update private.web_text_settings set function_url = 'https://abcdefghijklmnopqrst.supabase.co/functions/v1/budget-ocr'$q$, 'check constraint');
select pg_temp.ok((select function_url = 'https://abcdefghijklmnopqrst.supabase.co/functions/v1/web-text' from private.web_text_settings),
  'the setting still holds the project''s own web-text URL');
select pg_temp.refused_as('postgres', $q$update private.web_text_settings set cap_usd = 100.01$q$, 'check constraint');
select pg_temp.refused_as('postgres', $q$update private.web_text_settings set cap_usd = -1$q$, 'check constraint');
select pg_temp.refused_as('postgres', $q$update private.web_text_settings set usd_per_credit = 0$q$, 'check constraint');
select pg_temp.refused_as('postgres', $q$update private.web_text_settings set usd_per_credit = 0.11$q$, 'check constraint');
select pg_temp.refused_as('postgres', $q$update private.web_text_settings set max_attempts = 0$q$, 'check constraint');
select pg_temp.refused_as('postgres', $q$insert into private.web_text_settings (singleton) values (false)$q$, 'check constraint');
select pg_temp.refused_as('postgres', $q$update private.web_text_requests set status = 'done' where source_key = (select k from q)$q$, 'check constraint');
select pg_temp.refused_as('postgres', $q$update private.web_text_requests set text = 'x' where source_key = (select k from q)$q$, 'check constraint');
select pg_temp.refused_as('postgres', $q$update private.web_text_requests set desk_feature = 'Budget Utilisation & Schemes' where source_key = (select k from q)$q$, 'check constraint');
select pg_temp.refused_as('postgres', $q$update private.web_text_requests set official_url = 'https://rbidocs.rbi.org.in/rdocs/x.pdf' where source_key = (select k from q)$q$, 'check constraint');
select pg_temp.refused_as('postgres', $q$update private.web_text_requests set status = 'running' where source_key = (select k from q)$q$, 'check constraint');

rollback;
