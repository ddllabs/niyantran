-- F291: a stopped batch that cannot recover. ingest_batch_resume may now requeue the batch's failed jobs in the same
-- transaction.
--
-- The defect (20261102130000_batch_registration.sql): a claim marks every expired supplied-text claim failed as
-- text_outcome_uncertain. When the batch then holds more of those than its policy's uncertain_max, ingest_batch_requeue
-- refuses the job and stops the batch as uncertain_count, and refuses every job while the batch is stopped.
-- ingest_batch_resume restores the batch but keeps the policy snapshot and lowers no count, so the next requeue stops it
-- again. Requeue is the only thing that lowers the count, so no job can move.
--
-- It changes one function, public.ingest_batch_resume(uuid, jsonb), and nothing else. Its argument gains one optional
-- key, requeue_failed:
--   * absent or false: exactly as before (same checks, same writes, same result);
--   * not a JSON boolean: refused (ingest_batch_resume: requeue_failed must be true or false), nothing changed;
--   * true: after the batch is resumed, still holding its row lock, every job of the batch that is failed and whose item
--     has requeues = 0 (uncertain or not) is requeued, in job-id order, exactly as ingest_batch_requeue requeues one:
--     public.ingest_retry(job), the item's requeues + 1, and a 'requeued' event with the job id and its error code,
--     which here also carries via 'resume' and the call's decision_id. The 'resumed' event also carries
--     requeue_failed true. The result gains requeued (how many), left_failed (failed jobs left), blocking_jobs (their
--     ids, in id order), running (the batch's running jobs, left alone and in neither count) and still_blocked
--     (ingest_batch_block_reason of the batch at the end, null when none).
-- What it does not do:
--   * A failed job whose item has already been requeued once (requeues is at most 1), or that has no item, is not moved
--     by this call; it is listed in blocking_jobs. While such jobs keep the batch blocked (an uncertain one over
--     uncertain_max, or failures over failure_rate), the only exit today is the operator cancelling those jobs with
--     public.ingest_cancel(uuid) (20261001140000_ingestion_v2.sql:613, executable by service_role only, :743 and :749):
--     a cancelled job counts neither as failed nor as uncertain in ingest_batch_block_reason.
--   * Every eligible job's single requeue is used even when the batch is still blocked afterwards (for example by a job
--     in blocking_jobs, or by spend_ceiling when est_cost_usd is not raised in the same call). The batch is resumed all
--     the same; the next claim stops it again with that reason, and the ledger says why. Read still_blocked first.
-- Lock order is that of ingest_batch_requeue: the batch row, then each job row in job-id order, then its item row.
-- Claims never wait on the batch row (ingest_batch_mark_stopped takes it with skip locked) and lock only queued or
-- running jobs, never the failed ones this call locks, so a claim and this call cannot wait on each other in a cycle.
-- The signature, language, security definer, search_path and grants are those of 20261102130000_batch_registration.sql.
--
-- Depends on 20261102130000_batch_registration.sql (ingest_batch_resume, ingest_batch_block_reason, the ledger) and on
-- public.ingest_retry(uuid) of 20261001140000_ingestion_v2.sql.
--
-- Apply by psql (F283). The file commits itself, so the supervisor inserts the history row immediately after, as the
-- apply procedure does for the earlier migrations (docs/operations/2026-11-09-hybrid-apply-and-measure.md):
--   insert into supabase_migrations.schema_migrations (version, name) values ('20261112090000', 'batch_resume_requeue');
-- The worker need not be paused: a call that has already started keeps the old definition.
-- Before applying, check the function's owner (the migration must run as it, or as a member of it):
--   select proowner::regrole from pg_proc where oid = 'public.ingest_batch_resume(uuid,jsonb)'::regprocedure;
-- A dry run: replace this file's trailing commit; with checks and rollback; (an outer transaction does not work, the
-- file commits itself), for example
--   select pg_get_functiondef('public.ingest_batch_resume(uuid,jsonb)'::regprocedure) like '%requeue_failed%';
--   select has_function_privilege('corpus_ingest','public.ingest_batch_resume(uuid,jsonb)','execute');  -- false
--   rollback;
--
-- Rollback, in one transaction: the function as 20261102130000_batch_registration.sql created it, written create or
-- replace because that file wrote create function:
--   begin;
--   create or replace function public.ingest_batch_resume(p_batch uuid, p jsonb) returns jsonb
--   language plpgsql security definer set search_path = public, extensions, pg_temp as $$
--   declare b public.ingest_batches%rowtype; v_cost numeric;
--   begin
--     if jsonb_typeof(p) is distinct from 'object' or length(coalesce(p->>'decision_id','')) not between 1 and 200
--       or length(coalesce(p->>'approver','')) not between 1 and 200 or coalesce(p->>'evidence_sha256','') !~ '^[a-f0-9]{64}$' then
--       raise exception 'ingest_batch_resume: decision_id, approver and evidence_sha256 are required';
--     end if;
--     select * into b from public.ingest_batches where id = p_batch for update;
--     if not found then raise exception 'ingest_batch_resume: batch % does not exist', p_batch; end if;
--     if b.state <> 'stopped' then raise exception 'ingest_batch_resume: batch % is %, not stopped', p_batch, b.state; end if;
--     if p ? 'est_cost_usd' and (jsonb_typeof(p->'est_cost_usd') <> 'number' or (p->>'est_cost_usd')::numeric < b.est_cost_usd) then
--       raise exception 'ingest_batch_resume: est_cost_usd may only be raised';
--     end if;
--     v_cost := coalesce((p->>'est_cost_usd')::numeric, b.est_cost_usd);
--     update public.ingest_batches set state=b.stopped_from, stopped_from=null, stop_reason=null, stopped_at=null,
--       est_cost_usd=v_cost, updated_at=now() where id = b.id;
--     insert into public.ingest_batch_events(batch_id,event,detail) values(b.id,'resumed',jsonb_build_object(
--       'reason',b.stop_reason,'to',b.stopped_from,'decision_id',p->>'decision_id','approver',p->>'approver',
--       'evidence_sha256',p->>'evidence_sha256','est_cost_usd',v_cost));
--     return jsonb_build_object('batch_id',b.id,'state',b.stopped_from,'est_cost_usd',v_cost);
--   end $$;
--   revoke all on function public.ingest_batch_resume(uuid, jsonb) from public, anon, authenticated, service_role;
--   grant execute on function public.ingest_batch_resume(uuid, jsonb) to service_role;
--   delete from supabase_migrations.schema_migrations where version = '20261112090000';
--   commit;
-- Jobs it requeued stay requeued; their events and requeue counts are the ledger of what was done.

begin;
set local lock_timeout = '10s';

do $$
begin
  if to_regprocedure('public.ingest_batch_resume(uuid,jsonb)') is null or to_regprocedure('public.ingest_batch_block_reason(uuid)') is null
     or to_regprocedure('public.ingest_retry(uuid)') is null then
    raise exception 'apply 20261102130000_batch_registration.sql first';
  end if;
end $$;

create or replace function public.ingest_batch_resume(p_batch uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare b public.ingest_batches%rowtype; v_cost numeric;
  j public.ingest_jobs%rowtype; item public.ingest_batch_items%rowtype; v_requeued int := 0; v_left int := 0;
  v_flag boolean; v_blocking jsonb := '[]';
begin
  if jsonb_typeof(p) is distinct from 'object' or length(coalesce(p->>'decision_id','')) not between 1 and 200
    or length(coalesce(p->>'approver','')) not between 1 and 200 or coalesce(p->>'evidence_sha256','') !~ '^[a-f0-9]{64}$' then
    raise exception 'ingest_batch_resume: decision_id, approver and evidence_sha256 are required';
  end if;
  if p ? 'requeue_failed' and jsonb_typeof(p->'requeue_failed') <> 'boolean' then
    raise exception 'ingest_batch_resume: requeue_failed must be true or false';
  end if;
  v_flag := coalesce((p->>'requeue_failed')::boolean, false);
  select * into b from public.ingest_batches where id = p_batch for update;
  if not found then raise exception 'ingest_batch_resume: batch % does not exist', p_batch; end if;
  if b.state <> 'stopped' then raise exception 'ingest_batch_resume: batch % is %, not stopped', p_batch, b.state; end if;
  if p ? 'est_cost_usd' and (jsonb_typeof(p->'est_cost_usd') <> 'number' or (p->>'est_cost_usd')::numeric < b.est_cost_usd) then
    raise exception 'ingest_batch_resume: est_cost_usd may only be raised';
  end if;
  v_cost := coalesce((p->>'est_cost_usd')::numeric, b.est_cost_usd);
  update public.ingest_batches set state=b.stopped_from, stopped_from=null, stop_reason=null, stopped_at=null,
    est_cost_usd=v_cost, updated_at=now() where id = b.id;
  insert into public.ingest_batch_events(batch_id,event,detail) values(b.id,'resumed',jsonb_build_object(
    'reason',b.stop_reason,'to',b.stopped_from,'decision_id',p->>'decision_id','approver',p->>'approver',
    'evidence_sha256',p->>'evidence_sha256','est_cost_usd',v_cost)
    || case when v_flag then jsonb_build_object('requeue_failed',true) else '{}'::jsonb end);
  if not v_flag then
    return jsonb_build_object('batch_id',b.id,'state',b.stopped_from,'est_cost_usd',v_cost);
  end if;
  -- The batch row is held (above). Each failed job of this batch, in job-id order, then its item: the order
  -- ingest_batch_requeue locks them in. Only this batch's own jobs, as there.
  for j in select * from public.ingest_jobs where batch_id = b.id and status = 'failed' order by id for update loop
    select * into item from public.ingest_batch_items where batch_id = b.id and job_id = j.id for update;
    if not found or item.requeues <> 0 then
      v_left := v_left + 1; v_blocking := v_blocking || to_jsonb(j.id); continue;
    end if;
    perform public.ingest_retry(j.id);
    update public.ingest_batch_items set requeues = requeues + 1 where batch_id = b.id and job_id = j.id;
    insert into public.ingest_batch_events(batch_id,event,detail)
    values(b.id,'requeued',jsonb_build_object('job_id',j.id,'error_code',j.error_code,'via','resume','decision_id',p->>'decision_id'));
    v_requeued := v_requeued + 1;
  end loop;
  return jsonb_build_object('batch_id',b.id,'state',b.stopped_from,'est_cost_usd',v_cost,
    'requeued',v_requeued,'left_failed',v_left,'blocking_jobs',v_blocking,
    'running',(select count(*) from public.ingest_jobs where batch_id = b.id and status = 'running'),
    'still_blocked',public.ingest_batch_block_reason(b.id));
end $$;
revoke all on function public.ingest_batch_resume(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.ingest_batch_resume(uuid, jsonb) to service_role;

commit;
