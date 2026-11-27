-- F413: the file-manager credit functions charge once and cancel only before the worker starts. Disposable fixture.
-- run.sh's chain: file_manager_grants' (bootstrap_auth, bootstrap_storage, bootstrap_file_manager_deps, F410, F411 and
-- F412), then bootstrap_file_manager_credit_stubs.sql (stand-ins for the private credit functions), then
-- 20261127100000_file_manager_credit_fixes, migrations as a non-superuser.
-- Spec: docs/specs/2026-11-27-file-manager-credit-fixes.md. Review: docs/research/2026-11-27-f413-file-manager-credit-review.md.
-- Each numbered check fails without the migration; the review records each defect reproduced on F411's text.
\set ON_ERROR_STOP on
begin;

create function pg_temp.ok(v boolean, label text) returns void language plpgsql as $$begin
 if v is distinct from true then raise exception 'FAIL %', label; end if; raise notice 'PASS %', label; end$$;
create function pg_temp.as_user() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000000a"}', true) $$;

insert into public.app_flags (key, value) values ('file_indexing_billing', 'true'::jsonb);
insert into auth.users (id) values ('00000000-0000-0000-0000-00000000000a');
insert into public.credit_wallets (user_id, balance) values ('00000000-0000-0000-0000-00000000000a', 10000);
insert into public.user_files (id, user_id, name, storage_path, mime_type, size_bytes, upload_status) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000a', 'a.pdf',
   '00000000-0000-0000-0000-00000000000a/a.pdf', 'application/pdf', 120000, 'uploaded'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-00000000000a', 'b.pdf',
   '00000000-0000-0000-0000-00000000000a/b.pdf', 'application/pdf', 60000, 'uploaded'),
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-00000000000a', 'c.pdf',
   '00000000-0000-0000-0000-00000000000a/c.pdf', 'application/pdf', 60000, 'uploaded');

-- 1. One active job per file. Two concurrent enqueues both pass enqueue's existence check (review, finding 1); in one
-- session the guarantee is shown on the table itself, which is what stops the second of them, and through retry,
-- which reaches the same handler.
select pg_temp.as_user();
set local role authenticated;
select pg_temp.ok((public.user_file_enqueue_indexing('11111111-1111-1111-1111-111111111111') ->> 'job_id') is not null,
  'enqueue creates a job for file a');
reset role;
do $$ begin
  insert into public.user_file_jobs (file_id, user_id, status, step)
    values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000a', 'queued', 'ocr');
  raise exception 'FAIL 1a a second queued job for file a was accepted';
exception when unique_violation then raise notice 'PASS 1a a second active job for the same file is refused';
end $$;
-- A failed job for file b, then a new job for b: retrying the failed one must not make b's second active job.
insert into public.user_file_jobs (id, file_id, user_id, status, step, attempt_count, credits_hold_paise)
  overriding system value values (900, '22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-00000000000a', 'failed', 'embed', 1, 40);
select pg_temp.as_user();
set local role authenticated;
select pg_temp.ok((public.user_file_enqueue_indexing('22222222-2222-2222-2222-222222222222') ->> 'status') = 'queued',
  'enqueue creates a job for file b while its failed job stays failed');
do $$ begin
  perform public.user_file_job_retry(900);
  raise exception 'FAIL 1b retrying the failed job made a second active job for file b';
exception when unique_violation then
  if sqlerrm like 'duplicate_job:%' then raise notice 'PASS 1b retry is refused with duplicate_job while another job for the file is active';
  else raise exception 'FAIL 1b refused, but not with duplicate_job: %', sqlerrm; end if;
end $$;
reset role;
select pg_temp.ok((select count(*) = 1 from public.user_file_jobs where file_id = '22222222-2222-2222-2222-222222222222'
                   and status in ('queued', 'running')), '1c file b has exactly one active job');

-- 2. Settle once per attempt (finding 2). The worker claimed job 901 (attempt 1), and it failed after spending
-- US$0.01 of embeddings (95 credits). The same settlement arrives twice.
insert into public.user_file_jobs (id, file_id, user_id, status, step, attempt_count, credits_hold_paise, claimed_by)
  overriding system value values (901, '33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-00000000000a', 'running', 'embed', 1, 40, 'w1');
insert into public.credit_holds (user_id, turn_key, credits, inr_per_credit, expires_at, shadow_blocked)
  values ('00000000-0000-0000-0000-00000000000a', 'file_job:901', 40, 0.01, now() + interval '30 minutes', false);
set local role service_role;
select pg_temp.ok((public.user_file_settle_credits(901, 95, 'failed', null, null, 0.01) ->> 'credits_settled')::numeric = 95,
  'the first settlement of job 901 charges 95 credits');
select pg_temp.ok((public.user_file_settle_credits(901, 95, 'failed', null, null, 0.01) ->> 'status') = 'already_settled',
  '2a a repeated settlement for the same attempt returns already_settled');
reset role;
select pg_temp.ok((select count(*) = 1 and sum(credits) = -95 from public.credit_ledger where turn_key = 'file_job:901'),
  '2b the ledger holds one charge of 95 for job 901, not two');

-- 4 and 5. Retry, then a new attempt is charged and added (finding 4); retry re-arms the hold at the current rate
-- and clears its sweep mark (finding 5).
update public.credit_holds set swept_at = now() - interval '1 minute', inr_per_credit = 0.02 where turn_key = 'file_job:901';
select pg_temp.as_user();
set local role authenticated;
select pg_temp.ok((public.user_file_job_retry(901) ->> 'status') = 'queued', 'the user retries job 901');
reset role;
select pg_temp.ok((select swept_at is null and inr_per_credit = 0.01 and settled_at is null
                   from public.credit_holds where turn_key = 'file_job:901'),
  '5 the re-armed hold has no sweep mark and the current rate');
update public.user_file_jobs set status = 'running', attempt_count = attempt_count + 1, claimed_by = 'w1' where id = 901;   -- as user_file_claim does
set local role service_role;
select pg_temp.ok((public.user_file_settle_credits(901, 100, 'completed', null, null, 0.0105) ->> 'credits_settled')::numeric = 100,
  'the second attempt of job 901 is charged 100 credits');
reset role;
select pg_temp.ok((select credits_settled_paise = 195 from public.user_file_jobs where id = 901)
                  and (select sum(credits) = -195 from public.credit_ledger where turn_key = 'file_job:901'),
  '4 the job row shows 195 settled, the same as the ledger');

-- 3. Cancel only before the worker starts (finding 3, the developer's design: a started job runs to the end and is
-- billed). File a's job is claimed by the worker; file b's is still queued.
update public.user_file_jobs set status = 'running', attempt_count = 1, claimed_by = 'w1', lease_expires_at = now() + interval '300 seconds'
  where file_id = '11111111-1111-1111-1111-111111111111' and status = 'queued';
select pg_temp.as_user();
set local role authenticated;
do $$ declare v_job bigint := (select id from public.user_file_jobs where file_id = '11111111-1111-1111-1111-111111111111');
begin
  perform public.user_file_job_cancel(v_job);
  raise exception 'FAIL 3a a running job was cancelled';
exception when others then
  if sqlerrm like 'job_running:%' then raise notice 'PASS 3a cancelling a running job is refused with job_running';
  else raise exception 'FAIL 3a refused, but not with job_running: %', sqlerrm; end if;
end $$;
select pg_temp.ok((public.user_file_job_cancel((select id from public.user_file_jobs
                   where file_id = '22222222-2222-2222-2222-222222222222' and status = 'queued')) ->> 'status') = 'cancelled',
  '3b a queued job is still cancelled');
reset role;
select pg_temp.ok((select status = 'running' from public.user_file_jobs where file_id = '11111111-1111-1111-1111-111111111111')
                  and (select settled_at is null from public.credit_holds h join public.user_file_jobs j on h.turn_key = 'file_job:' || j.id
                       where j.file_id = '11111111-1111-1111-1111-111111111111'),
  '3c the running job is still running and its hold still open');
select pg_temp.ok((select settled_at is not null from public.credit_holds h join public.user_file_jobs j on h.turn_key = 'file_job:' || j.id
                   where j.file_id = '22222222-2222-2222-2222-222222222222' and j.status = 'cancelled')
                  and not exists (select 1 from public.credit_ledger l join public.user_file_jobs j on l.turn_key = 'file_job:' || j.id
                                  where j.status = 'cancelled'),
  '3d the cancelled job''s hold is released and it is charged nothing');

-- Unchanged: the flag gate, and who may call what.
update public.app_flags set value = 'false'::jsonb where key = 'file_indexing_billing';
select pg_temp.as_user();
set local role authenticated;
do $$ begin
  perform public.user_file_enqueue_indexing('33333333-3333-3333-3333-333333333333');
  raise exception 'FAIL enqueue ran with the flag off';
exception when object_not_in_prerequisite_state then raise notice 'PASS enqueue still refuses while the flag is off';
end $$;
reset role;
select pg_temp.ok(has_function_privilege('authenticated', 'public.user_file_enqueue_indexing(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.user_file_job_cancel(bigint)', 'execute')
  and has_function_privilege('authenticated', 'public.user_file_job_retry(bigint)', 'execute')
  and not has_function_privilege('authenticated', 'public.user_file_settle_credits(bigint,bigint,text,integer,integer,numeric)', 'execute')
  and has_function_privilege('service_role', 'public.user_file_settle_credits(bigint,bigint,text,integer,integer,numeric)', 'execute')
  and not has_function_privilege('anon', 'public.user_file_enqueue_indexing(uuid)', 'execute'),
  'the credit functions keep their grants');
rollback;
