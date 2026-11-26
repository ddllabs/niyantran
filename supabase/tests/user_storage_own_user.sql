-- F410: a user's storage usage and quota are readable only by that user (and the service role). Disposable fixture.
-- run.sh uses the bare bootstrap_auth chain (roles, auth.uid(), auth.role()), then bootstrap_user_storage_live.sql
-- (the two functions exactly as they are live on NTER), then 20261126090000_user_storage_own_user (as a
-- non-superuser). Spec: docs/specs/2026-11-26-user-storage-own-user.md.
-- Without the migration the stand-in grants anon execute and quota_bytes has no owner check, so the vacuity check fails
-- at the first assertion.
\set ON_ERROR_STOP on
begin;
set search_path=public,extensions;
create function pg_temp.ok(v boolean,label text) returns void language plpgsql as $$begin
 if v is distinct from true then raise exception 'FAIL %',label; end if; raise notice 'PASS %',label; end$$;

-- A is on the free plan with 300 bytes; B is on Pro with 1,000 bytes that count, plus a failed upload and an abandoned
-- pending one that do not.
insert into auth.users(id) values ('00000000-0000-0000-0000-00000000000a'),('00000000-0000-0000-0000-00000000000b');
insert into public.user_profiles(user_id,plan) values
 ('00000000-0000-0000-0000-00000000000a','free'),('00000000-0000-0000-0000-00000000000b','pro');
insert into public.user_files(user_id,size_bytes,upload_status,created_at) values
 ('00000000-0000-0000-0000-00000000000a',300,'uploaded',now()),
 ('00000000-0000-0000-0000-00000000000b',1000,'uploaded',now()),
 ('00000000-0000-0000-0000-00000000000b',500,'upload_failed',now()),
 ('00000000-0000-0000-0000-00000000000b',700,'pending_upload',now()-interval '3 hours');

-- (a) Grants: nobody signed out may call either function; signed-in users and the service role may.
select pg_temp.ok(not has_function_privilege('anon','public.user_storage_used_bytes(uuid)','execute')
  and not has_function_privilege('anon','public.user_storage_quota_bytes(uuid)','execute'),
  'anon cannot execute user_storage_used_bytes or user_storage_quota_bytes');
select pg_temp.ok(not exists(select 1 from pg_proc p, aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   where p.oid in ('public.user_storage_used_bytes(uuid)'::regprocedure,'public.user_storage_quota_bytes(uuid)'::regprocedure)
     and a.grantee=0),
  'PUBLIC holds no execute on either function');
select pg_temp.ok(has_function_privilege('authenticated','public.user_storage_used_bytes(uuid)','execute')
  and has_function_privilege('authenticated','public.user_storage_quota_bytes(uuid)','execute')
  and has_function_privilege('service_role','public.user_storage_used_bytes(uuid)','execute')
  and has_function_privilege('service_role','public.user_storage_quota_bytes(uuid)','execute'),
  'authenticated and service_role keep execute on both');

-- (b) The contract the callers rely on is unchanged: definer, pinned search_path, one argument defaulting to null.
select pg_temp.ok((select bool_and(prosecdef and proconfig @> array['search_path=public, pg_temp'] and pronargdefaults=1
                                   and provolatile='s')
   from pg_proc where oid in ('public.user_storage_used_bytes(uuid)'::regprocedure,'public.user_storage_quota_bytes(uuid)'::regprocedure)),
  'both stay STABLE SECURITY DEFINER with search_path public, pg_temp and p_user_id defaulting to null');

-- (c) Signed out, through the grants: refused.
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$ begin perform public.user_storage_used_bytes('00000000-0000-0000-0000-00000000000b');
 raise exception 'FAIL anon read another user''s usage';
 exception when insufficient_privilege then raise notice 'PASS anon is refused user_storage_used_bytes'; end $$;
do $$ begin perform public.user_storage_quota_bytes('00000000-0000-0000-0000-00000000000b');
 raise exception 'FAIL anon read another user''s quota';
 exception when insufficient_privilege then raise notice 'PASS anon is refused user_storage_quota_bytes'; end $$;
reset role;

-- (d) Signed in as A: A's own figures, by id or by default; B's are refused by both functions.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000000a"}',true);
set local role authenticated;
do $$ begin
 if public.user_storage_used_bytes('00000000-0000-0000-0000-00000000000a') is distinct from 300
    or public.user_storage_used_bytes(null) is distinct from 300 then raise exception 'FAIL A''s own usage is not 300'; end if;
 if public.user_storage_quota_bytes('00000000-0000-0000-0000-00000000000a') is distinct from 524288000
    or public.user_storage_quota_bytes(null) is distinct from 524288000 then raise exception 'FAIL A''s own quota is not 500 MB'; end if;
 raise notice 'PASS A reads its own usage and quota, by id and by default';
end $$;
do $$ begin perform public.user_storage_used_bytes('00000000-0000-0000-0000-00000000000b');
 raise exception 'FAIL A read B''s usage';
 exception when insufficient_privilege then raise notice 'PASS A is refused B''s usage'; end $$;
do $$ begin perform public.user_storage_quota_bytes('00000000-0000-0000-0000-00000000000b');
 raise exception 'FAIL A read B''s quota (and so B''s plan)';
 exception when insufficient_privilege then raise notice 'PASS A is refused B''s quota'; end $$;
reset role;

-- (e) A signed-in role whose token carries no user id is refused another user's figures (it is not the service role).
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
set local role authenticated;
do $$ begin perform public.user_storage_used_bytes('00000000-0000-0000-0000-00000000000b');
 raise exception 'FAIL a token without a user id read B''s usage';
 exception when insufficient_privilege then raise notice 'PASS a token without a user id is refused B''s usage'; end $$;
do $$ begin perform public.user_storage_quota_bytes('00000000-0000-0000-0000-00000000000b');
 raise exception 'FAIL a token without a user id read B''s quota';
 exception when insufficient_privilege then raise notice 'PASS a token without a user id is refused B''s quota'; end $$;
reset role;

-- (f) The service role, and a direct database session (no token), read any user's figures; the body's counting is
-- unchanged (failed uploads and pending uploads older than two hours do not count).
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$ begin
 if public.user_storage_used_bytes('00000000-0000-0000-0000-00000000000b') is distinct from 1000 then raise exception 'FAIL service role: B''s usage is not 1000'; end if;
 if public.user_storage_quota_bytes('00000000-0000-0000-0000-00000000000b') is distinct from 5368709120 then raise exception 'FAIL service role: B''s quota is not 5 GB'; end if;
 raise notice 'PASS the service role reads B''s usage (1000) and quota (5 GB)';
end $$;
reset role;
select set_config('request.jwt.claims','',true);
select pg_temp.ok(public.user_storage_used_bytes('00000000-0000-0000-0000-00000000000b')=1000
  and public.user_storage_quota_bytes('00000000-0000-0000-0000-00000000000b')=5368709120,
  'a direct database session reads B''s usage and quota');

-- (g) The body refuses on its own: with anon's execute put back by mistake, anon still cannot read B's figures, and
-- without a user id it gets only the defaults it got before (0 bytes used, 500 MB), which name no user.
grant execute on function public.user_storage_used_bytes(uuid), public.user_storage_quota_bytes(uuid) to anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$ begin perform public.user_storage_used_bytes('00000000-0000-0000-0000-00000000000b');
 raise exception 'FAIL with execute regranted, anon read B''s usage';
 exception when insufficient_privilege then raise notice 'PASS with execute regranted, anon is still refused B''s usage'; end $$;
do $$ begin perform public.user_storage_quota_bytes('00000000-0000-0000-0000-00000000000b');
 raise exception 'FAIL with execute regranted, anon read B''s quota';
 exception when insufficient_privilege then raise notice 'PASS with execute regranted, anon is still refused B''s quota'; end $$;
do $$ begin
 if public.user_storage_used_bytes(null) is distinct from 0 or public.user_storage_quota_bytes(null) is distinct from 524288000 then
   raise exception 'FAIL anon without a user id got something other than the defaults'; end if;
 raise notice 'PASS anon without a user id gets only the defaults';
end $$;
reset role;
rollback;
