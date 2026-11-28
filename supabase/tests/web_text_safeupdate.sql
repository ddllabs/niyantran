-- F417: every UPDATE and DELETE in the web-text queue's functions carries a WHERE clause. Disposable fixture.
-- PostgREST's role loads pg_safeupdate, which refuses an UPDATE or DELETE with no WHERE clause; the web-text Edge
-- Function calls web_text_claim, web_text_finish and web_text_fail through PostgREST, so such a statement fails there
-- although it passes in psql (and in web_text_queue.sql, which runs as psql). The local containers have no pg_safeupdate,
-- so this fixture checks the rule on the function definitions themselves. run.sh uses web_text_queue's chain, then
-- 20261128100000_web_text_settings_where (as a non-superuser). Without that migration the four settings updates in
-- web_text_claim and web_text_fail have no WHERE and the main assertion fails (the vacuity check).
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(v boolean, label text) returns void language plpgsql as $$begin
 if v is distinct from true then raise exception 'FAIL %', label; end if; raise notice 'PASS %', label; end$$;

-- The UPDATE and DELETE statements in a function body that have no WHERE clause, comments removed. A statement runs from
-- the keyword to its semicolon (a row lock, FOR UPDATE, is not a statement); the web-text functions have no semicolon inside
-- a string literal.
create function pg_temp.unsafe(p_def text) returns setof text language sql immutable as $$
  select s[1]
    from regexp_matches(regexp_replace(p_def, '--[^\n]*', '', 'g'), '(?<!for\s)(\m(?:update|delete\s+from)\M[^;]*);', 'gi') as s
   where s[1] !~* '\mwhere\M'
$$;

-- The checker itself: a statement without WHERE is found, one with WHERE is not, a commented-out one is ignored.
create function pg_temp.bad() returns void language plpgsql as $$begin
  update private.web_text_settings set updated_at = now();
end$$;
create function pg_temp.good() returns void language plpgsql as $$declare r record; begin
  select * into r from private.web_text_settings for update;
  -- update private.web_text_settings set updated_at = now();
  update private.web_text_settings set updated_at = now() where singleton;
  delete from private.web_text_requests where false;
end$$;
select pg_temp.ok((select count(*) = 1 from pg_temp.unsafe(pg_get_functiondef('pg_temp.bad()'::regprocedure))),
  'the checker finds an UPDATE with no WHERE');
select pg_temp.ok((select count(*) = 0 from pg_temp.unsafe(pg_get_functiondef('pg_temp.good()'::regprocedure))),
  'the checker passes an UPDATE and a DELETE with WHERE and ignores FOR UPDATE and a commented-out UPDATE');

-- The functions the rule covers are all there (a rename must not empty the check).
select pg_temp.ok((select count(*) = 9 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname in ('public', 'private') and p.proname like 'web\_text\_%'),
  'nine web_text_ functions exist in public and private');

-- The rule: no web_text_ function has an UPDATE or DELETE without WHERE.
select pg_temp.ok((select count(*) = 0
                     from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
                          lateral pg_temp.unsafe(pg_get_functiondef(p.oid))
                    where n.nspname in ('public', 'private') and p.proname like 'web\_text\_%'),
  'every UPDATE and DELETE in the web_text_ functions has a WHERE clause (pg_safeupdate, which PostgREST loads)');

-- The fix changed nothing else: owner, definer, search_path and grants of the two replaced functions are as before.
select pg_temp.ok((select bool_and(p.prosecdef and p.proconfig = array['search_path=pg_catalog, pg_temp'])
                     from pg_proc p where p.oid in ('public.web_text_claim(integer, integer)'::regprocedure,
                                                    'public.web_text_fail(uuid, uuid, text, boolean, boolean)'::regprocedure)),
  'web_text_claim and web_text_fail stay SECURITY DEFINER with search_path pg_catalog, pg_temp');
select pg_temp.ok(has_function_privilege('service_role', 'public.web_text_claim(integer, integer)', 'execute')
  and has_function_privilege('service_role', 'public.web_text_fail(uuid, uuid, text, boolean, boolean)', 'execute')
  and not has_function_privilege('corpus_ingest', 'public.web_text_claim(integer, integer)', 'execute')
  and not has_function_privilege('anon', 'public.web_text_fail(uuid, uuid, text, boolean, boolean)', 'execute')
  and not has_function_privilege('authenticated', 'public.web_text_claim(integer, integer)', 'execute'),
  'service_role keeps execute on both; corpus_ingest, anon and authenticated still have none');

-- The paths the fix touches still work: a lapsed lease is counted and requeued, and the halt switches the run off.
update private.web_text_settings set enabled = true, cap_usd = 1, halt_source_errors = 2,
       function_url = 'https://abcdefghijklmnopqrst.supabase.co/functions/v1/web-text';
set local role corpus_ingest;
select public.web_text_enqueue(jsonb_build_array(jsonb_build_object(
  'source_key', repeat('1', 40), 'official_url', 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=1',
  'pack_sha256', repeat('a', 64))));
reset role;
create temp table act(label text primary key, j jsonb);
grant all on act to service_role;
set local role service_role;
insert into act values ('c1', public.web_text_claim(1, 300));
reset role;
update private.web_text_requests set lease_until = now() - interval '1 second' where status = 'running';
set local role service_role;
insert into act values ('c2', public.web_text_claim(1, 300));
reset role;
select pg_temp.ok((select jsonb_array_length(j -> 'claimed') = 1 from act where label = 'c2')
  and (select source_error_run = 1 and enabled from private.web_text_settings),
  'a lapsed lease is counted toward the halt rule and the request is claimed again');
update private.web_text_requests set lease_until = now() - interval '1 second' where status = 'running';
set local role service_role;
insert into act values ('c3', public.web_text_claim(1, 300));
reset role;
select pg_temp.ok((select j ->> 'halted' = 'source_errors' from act where label = 'c3')
  and (select not enabled and halted_reason = 'source_errors' and source_error_run = 0 from private.web_text_settings),
  'the second lapse in a row reaches halt_source_errors 2 and switches the run off');

rollback;
