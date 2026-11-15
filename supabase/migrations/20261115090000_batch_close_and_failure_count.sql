-- F326 and F327: close a batch with its failed jobs named, and count the failures a batch has ever seen.
-- Decided by the developer on 2026-11-15 (docs/plans/open-work.md, F326 and F327); reviewed the same day.
--
-- F326. A job that fails again after its one requeue is refused by ingest_batch_requeue as failed_after_requeue and
-- stops the batch; a batch is indexed only when every admitted job succeeded; neither resume nor requeue clears it
-- (20261102130000_batch_registration.sql 1174-1175 and 1086). There is no second automatic requeue. A batch whose only
-- unfinished jobs are such failures may now be CLOSED, under a recorded decision:
--   public.ingest_batch_close(p_batch uuid, p jsonb) returns jsonb                       (service_role only)
--   p carries decision_id, reason, approver (each non-blank, at most 200, reason at most 1000 characters) and
--   evidence_sha256 (64 lower-case hex), as ingest_batch_resume and ingest_policy_approve require theirs. Anything
--   else is an exception and nothing is written.
--   * The batch must be registered or indexing, or stopped from one of those. Every job of the batch must be
--     succeeded, cancelled, or failed with its item's requeues >= 1, and at least one must be failed. Otherwise a
--     refusal is returned and nothing is written: {refused: batch_state | jobs_not_final | uncertain_jobs |
--     no_failed_jobs}. jobs_not_final lists a queued or running job, a failed job not yet requeued, or a job without an
--     item; uncertain_jobs lists jobs failed as text_outcome_uncertain (they need reconciliation, not closure). Both
--     lists are capped at 50 entries and carry the total (blocking_total / uncertain_total).
--   * It moves the batch to the new terminal state closed_with_failures (not indexed: the runner's confirm and every
--     reader of indexed still see a batch that is not complete), clears a stop (stop_reason, stopped_from, stopped_at
--     become null as the batch constraint requires; the stop is kept in the event), and appends one 'closed' event with
--     decision_id, reason, approver, evidence_sha256, failed_jobs (job_id, source_key, error_code, failures_seen),
--     cancelled_jobs (job_id, source_key) and the stop it replaced.
--   * Called again on a closed batch it returns {already: true, closure: <the recorded event detail>} and writes nothing,
--     whatever decision it is given. It deletes nothing: jobs, items, documents and events stay as they are.
--   A closed batch is never claimed (ingest_batch_block_reason answers 'closed'), never stopped
--   (ingest_batch_mark_stopped and ingest_batch_stop leave it alone) and never resumed (resume needs stopped).
--   ingest_retry is not changed: a job of a closed batch retried by an operator (admin-ingest, or the single-document
--   resume) is queued but never claimed, because its batch answers 'closed'. Such a job must be CANCELLED
--   (ingest_cancel, which close counts as final), not left queued.
--
-- F327. failure_rate was failed / (failed + succeeded) over current statuses (batch_registration 874 and 891), so a
-- requeue removed the failure from the count. A failure is now counted once it has been seen, until an explicit recorded
-- resume acknowledges it. Two columns on ingest_jobs, both for batch jobs only:
--   failures_seen          incremented by a BEFORE UPDATE OF status trigger on every transition of a job with batch_id
--                          not null into 'failed' (the claim's sweeps, the worker, the supplied-text reconciliation: no
--                          function is redefined for it; other desks' jobs are untouched).
--   failures_acknowledged  written ONLY by ingest_batch_resume (below), never by the automatic requeue; check
--                          failures_acknowledged <= failures_seen.
-- It is a column, not derived from ingest_batch_items.requeues, because requeues is incremented only by
-- ingest_batch_requeue and ingest_batch_resume, while ingest_retry is also called by admin-ingest
-- (supabase/functions/admin-ingest/index.ts:220), ingestion_v2.sql:361 and corpus_records.sql:516.
-- ingest_batch_block_reason now reads, over the batch's jobs (each job once): failed = failures_seen >
-- failures_acknowledged; decided = succeeded or failed in that sense. Threshold and min_decided are unchanged; the
-- uncertain_max rule still counts jobs currently held as text_outcome_uncertain.
-- Why the baseline: with a plain ever-seen count a batch stopped for failure_rate could never move. Resume with
-- requeue_failed requeues the jobs, but the count stays over the limit, the next claim re-stops the batch before any job
-- runs, the policy snapshot cannot be changed, and close is refused while jobs are queued. So
-- ingest_batch_resume (re-issued from 20261112090000, its last definition) now sets failures_acknowledged = failures_seen
-- for every job of the batch where it is lower, on every resume (resume already needs its recorded decision, approver and
-- evidence), before still_blocked is computed, and lists the acknowledged job ids in the 'resumed' event
-- (acknowledged_jobs). Its arguments, result keys and grants are unchanged. A requeue alone writes no baseline, so it
-- cannot hide a failure; a job that fails again after an acknowledgement is counted again (failures_seen rises past the
-- baseline). The exits from a failure_rate stop are therefore: a recorded resume (which acknowledges what has been
-- seen, so the batch proceeds and new failures count), or closing. Changing the policy, or cancelling a job, does NOT clear
-- the count (a cancelled job keeps failures_seen); only a resume does.
-- Existing data: failures_seen is back-filled for batch jobs as (status = 'failed') + the item's requeues;
-- failures_acknowledged starts at 0. Failures that happened before this migration and were cleared by admin retries
-- (ingest_retry outside the batch functions) cannot be recovered: the count may undercount them.
--
-- Functions CREATE OR REPLACE from their last definition, with the change named:
--   ingest_batch_mark_stopped  20261102130000 :849-863, plus 'closed_with_failures' in the early return (a closed batch is
--                              never stopped; stopped_from does not allow it).
--   ingest_batch_block_reason  20261102130000 :867-894, plus 'closed' for a closed batch and the baseline-aware counts.
--   ingest_batch_status        20261102130000 :1070-1127, plus jobs.ever_failed, jobs.acknowledged and a closure key (the
--                              latest closed event).
--   ingest_batch_stop          20261102130000 :1129-1144, plus a refusal for a closed batch (as for accepted).
--   ingest_batch_resume        20261112090000 (its last definition), plus the acknowledgement described above.
-- None of the first four was redefined by 20261107120000, 20261110120000, 20261112090000, 20261113090000 or
-- 20261114090000 (checked with grep over the migrations). ingest_claim, ingest_batch_requeue and ingest_register_batch are
-- NOT changed: a requeue of a closed batch's failed job is refused failed_after_requeue and writes nothing (mark_stopped
-- returns false); the claim's call of mark_stopped for a closed batch writes nothing; ingest_register_batch treats a closed
-- batch as it treats an indexed one (nothing planned is left).
--
-- Privileges are restated exactly as 20261102130000 :1359-1374 and 20261112090000 set them, not widened: block_reason and
-- mark_stopped owner-only; status and stop for corpus_ingest and service_role; resume for service_role only; the new
-- ingest_batch_close for service_role only; the trigger function owner-only. All functions: security definer where their
-- predecessors are, search_path public, extensions, pg_temp.
--
-- Locks. One statement up front, with set local lock_timeout '10s' so it fails instead of queueing:
--   lock table public.ingest_batches, public.ingest_batch_events, public.ingest_jobs in access exclusive mode;
-- (batches first, as ingest_register_batch locks). It is held to the end of the transaction, which runs these statements
-- only: two small tables' constraint swaps, an ADD COLUMN pair (constant default, no rewrite; the check scans the
-- table once), a back-fill of the failed and requeued batch jobs, a trigger and some CREATE OR REPLACE FUNCTIONs. Expect
-- a second or two; while it is held every reader and writer of those three tables, the worker's claim, the bulk runner,
-- admin-ingest and the search path's job reads, waits. The constraints are added NOT VALID and then validated inside the
-- same transaction, which gains nothing once the lock is held; it is kept only because it is the form that is safe if the
-- up-front lock is ever removed.
-- ingest_batch_close itself locks the batch row, then only the batch's FAILED job rows in id order (as resume does), after
-- a first check without locks; it never locks queued or running jobs.
--
-- Depends on 20261102130000_batch_registration.sql and 20261112090000_batch_resume_requeue.sql (it re-issues
-- ingest_batch_resume). Apply by psql (F283) with the worker's schedule PAUSED and after making sure that no bulk runner and no
-- admin-ingest registration is running (the lock above would otherwise queue them, and a runner call that holds a batch
-- row would make the migration time out). The file commits itself, so the supervisor inserts the history row after:
--   insert into supabase_migrations.schema_migrations (version, name) values ('20261115090000', 'batch_close_and_failure_count');
-- Before applying: check the owner of the functions as 20261112090000 does, and count what the back-fill will touch:
--   select count(*) from public.ingest_jobs j where j.batch_id is not null and (j.status = 'failed'
--     or exists(select 1 from public.ingest_batch_items i where i.job_id = j.id and i.requeues > 0));   -- N
-- A dry run: replace the trailing commit; with checks and rollback; and run, for example,
--   select count(*) filter (where failures_seen > 0) from public.ingest_jobs where batch_id is not null;   -- must equal N
--   select count(*) from public.ingest_jobs where failures_acknowledged <> 0;                              -- 0
--   select has_function_privilege('corpus_ingest','public.ingest_batch_close(uuid,jsonb)','execute');     -- false
--   rollback;
--
-- Rollback, in one transaction (it refuses while any batch is closed_with_failures; nothing here deletes a closure).
-- The four functions and resume are the bodies this file replaced, written create or replace:
--   begin;
--   set local lock_timeout = '10s';
--   lock table public.ingest_batches, public.ingest_batch_events, public.ingest_jobs in access exclusive mode;
--   do $$ begin if exists(select 1 from public.ingest_batches where state = 'closed_with_failures') then
--     raise exception 'a batch is closed_with_failures; do not roll back'; end if; end $$;
--   drop trigger ingest_jobs_count_failure on public.ingest_jobs;
--   drop function public.ingest_jobs_count_failure();
--   drop function public.ingest_batch_close(uuid, jsonb);
--   create or replace function public.ingest_batch_mark_stopped(p_batch uuid, p_reason text, p_skip_locked boolean) returns boolean
--   language plpgsql security definer set search_path = public, extensions, pg_temp as $$
--   declare b public.ingest_batches%rowtype;
--   begin
--     if p_skip_locked then
--       select * into b from public.ingest_batches where id = p_batch for update skip locked;
--     else
--       select * into b from public.ingest_batches where id = p_batch for update;
--     end if;
--     if not found or b.state in ('stopped','accepted') then return false; end if;
--     update public.ingest_batches set state='stopped', stopped_from=b.state, stop_reason=p_reason, stopped_at=now(), updated_at=now()
--      where id = p_batch;
--     insert into public.ingest_batch_events(batch_id,event,detail) values(p_batch,'stopped',jsonb_build_object('reason',p_reason,'from',b.state));
--     return true;
--   end $$;
--   create or replace function public.ingest_batch_block_reason(p_batch uuid) returns text
--   language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
--   declare b public.ingest_batches%rowtype; v_spend numeric; v_budget numeric; v_failed bigint; v_done bigint; v_uncertain bigint; st jsonb;
--   begin
--     select * into b from public.ingest_batches where id = p_batch;
--     if not found then return 'stopped'; end if;
--     if b.state = 'stopped' then return 'stopped'; end if;
--     select coalesce(sum(embed_cost_usd),0), count(*) filter (where status='failed'), count(*) filter (where status in ('failed','succeeded')),
--            count(*) filter (where status='failed' and error_code='text_outcome_uncertain')
--       into v_spend, v_failed, v_done, v_uncertain from public.ingest_jobs where batch_id = p_batch;
--     -- What the jobs reported, or what model_call_logs holds when more (a killed claim reports nothing).
--     v_spend := greatest(v_spend, (select coalesce(sum(m.cost_usd),0) from public.model_call_logs m
--                                    where m.raw_usage ? 'batch_id' and m.raw_usage->>'batch_id' = p_batch::text));
--     if v_spend >= b.est_cost_usd then return 'spend_ceiling'; end if;
--     select budget_usd into v_budget from public.ingest_collection_policies where collection = b.collection;
--     if greatest((select coalesce(sum(j.embed_cost_usd),0) from public.ingest_jobs j join public.ingest_batches x on x.id = j.batch_id
--                   where x.collection = b.collection),
--                 (select coalesce(sum(m.cost_usd),0) from public.model_call_logs m
--                   where m.raw_usage ? 'batch_id' and m.raw_usage->>'batch_id' in (select x.id::text from public.ingest_batches x where x.collection = b.collection)))
--        >= v_budget then
--       return 'collection_spend_ceiling';
--     end if;
--     st := b.policy->'stop_thresholds';
--     if v_uncertain > (st->>'uncertain_max')::numeric then return 'uncertain_count'; end if;
--     if v_done >= (st->>'min_decided')::numeric and v_failed::numeric / v_done > (st->>'failure_rate')::numeric then
--       return 'failure_rate';
--     end if;
--     return null;
--   end $$;
--   create or replace function public.ingest_batch_status(p_batch uuid, p_source_keys text[] default null) returns jsonb
--   language plpgsql security definer set search_path = public, extensions, pg_temp as $$
--   declare b public.ingest_batches%rowtype; v_next text; v_jobs record; v_items jsonb; counts jsonb; by_reason jsonb; jobs jsonb; acc jsonb;
--   begin
--     if coalesce(cardinality(p_source_keys),0) > 1000 then raise exception 'ingest_batch_status: at most 1000 source keys'; end if;
--     select * into b from public.ingest_batches where id = p_batch;
--     if not found then raise exception 'ingest_batch_status: batch % does not exist', p_batch; end if;
--     -- Forward moves only, derived from the jobs this batch admitted. An existing item's job belongs to
--     -- whoever registered it (another batch, or a document registered alone): it is reported in the
--     -- items and counts, never requeued here, and never holds the batch back.
--     if b.state in ('registered','indexing') then
--       select count(*) total, count(*) filter (where j.status = 'succeeded') ok,
--              count(*) filter (where j.status <> 'queued' or j.attempts > 0) started
--         into v_jobs
--         from public.ingest_batch_items i join public.ingest_jobs j on j.id = i.job_id
--        where i.batch_id = b.id and i.outcome = 'admitted';
--       v_next := case when v_jobs.ok = v_jobs.total then 'indexed'
--                      when b.state = 'registered' and v_jobs.started > 0 then 'indexing' end;
--       if v_next is not null then
--         update public.ingest_batches set state = v_next, updated_at = now() where id = b.id and state = b.state;
--         if found then b.state := v_next; end if;
--       end if;
--     end if;
--     select jsonb_build_object('items',count(*),'planned',count(*) filter (where outcome='planned'),
--       'admitted',count(*) filter (where outcome='admitted'),'existing',count(*) filter (where outcome='existing'),
--       'refused',count(*) filter (where outcome='refused')) into counts from public.ingest_batch_items where batch_id = b.id;
--     select coalesce(jsonb_object_agg(reason, cnt), '{}') into by_reason from (
--       select reason, count(*) cnt from public.ingest_batch_items where batch_id = b.id and outcome='refused' group by reason) x;
--     select jsonb_build_object('queued',count(*) filter (where status='queued'),'running',count(*) filter (where status='running'),
--       'succeeded',count(*) filter (where status='succeeded'),'failed',count(*) filter (where status='failed'),
--       'cancelled',count(*) filter (where status='cancelled'),
--       'uncertain',count(*) filter (where status='failed' and error_code='text_outcome_uncertain'),
--       'spend_usd',coalesce(sum(embed_cost_usd),0),'tokens',coalesce(sum(embed_tokens),0)) into jobs
--       from public.ingest_jobs where batch_id = b.id;
--     jobs := jobs || jsonb_build_object('logged_spend_usd',(select coalesce(sum(m.cost_usd),0) from public.model_call_logs m
--                                          where m.raw_usage ? 'batch_id' and m.raw_usage->>'batch_id' = b.id::text));
--     select coalesce(jsonb_agg(jsonb_build_object('check',check_name,'passed',passed,'sample',sample,'recorded_at',recorded_at) order by check_name),'[]')
--       into acc from public.ingest_batch_acceptance where batch_id = b.id;
--     if p_source_keys is not null then
--       select coalesce(jsonb_agg(jsonb_build_object('source_key',i.source_key,'outcome',i.outcome,'reason',i.reason,'detail',i.detail,
--           'document_id',i.document_id,'job_id',i.job_id,'job_status',j.status,'job_stage',j.stage,'error_code',j.error_code,
--           'requeues',i.requeues,'indexed',d.indexed_at is not null) order by i.source_key), '[]')
--         into v_items
--         from public.ingest_batch_items i
--         left join public.ingest_jobs j on j.id = i.job_id
--         left join public.documents d on d.id = i.document_id
--        where i.batch_id = b.id and i.source_key = any(p_source_keys);
--     end if;
--     return jsonb_build_object('batch_id',b.id,'collection',b.collection,'state',b.state,'stop_reason',b.stop_reason,
--       'manifest_sha256',b.manifest_sha256,'policy_sha256',b.policy_sha256,
--       'planned',jsonb_build_object('items',b.items_planned,'chunks',b.chunks_planned,'est_tokens',b.est_tokens,'est_cost_usd',b.est_cost_usd),
--       'counts',counts || jsonb_build_object('by_reason',by_reason,
--         'existing_not_indexed',(select count(*) from public.ingest_batch_items i join public.documents d on d.id = i.document_id
--                                  where i.batch_id = b.id and i.outcome = 'existing' and d.indexed_at is null)),'jobs',jobs,
--       'indexed',(select count(*) from public.ingest_batch_items i join public.documents d on d.id = i.document_id
--                   where i.batch_id = b.id and i.outcome in ('admitted','existing') and d.indexed_at is not null),
--       'acceptance',acc,'items',v_items);
--   end $$;
--   create or replace function public.ingest_batch_stop(p_batch uuid, p_reason text) returns jsonb
--   language plpgsql security definer set search_path = public, extensions, pg_temp as $$
--   declare b public.ingest_batches%rowtype;
--   begin
--     if coalesce(p_reason,'') !~ '^[a-z][a-z0-9_:.-]{0,99}$' then
--       raise exception 'ingest_batch_stop: reason must be a short lowercase token';
--     end if;
--     select * into b from public.ingest_batches where id = p_batch for update;
--     if not found then raise exception 'ingest_batch_stop: batch % does not exist', p_batch; end if;
--     if b.state = 'accepted' then raise exception 'ingest_batch_stop: batch % is accepted', p_batch; end if;
--     if b.state = 'stopped' then
--       return jsonb_build_object('batch_id',b.id,'state','stopped','stop_reason',b.stop_reason,'already',true);
--     end if;
--     perform public.ingest_batch_mark_stopped(b.id, p_reason, false);
--     return jsonb_build_object('batch_id',b.id,'state','stopped','stop_reason',p_reason,'already',false);
--   end $$;
--   create or replace function public.ingest_batch_resume(p_batch uuid, p jsonb) returns jsonb
--   language plpgsql security definer set search_path = public, extensions, pg_temp as $$
--   declare b public.ingest_batches%rowtype; v_cost numeric;
--     j public.ingest_jobs%rowtype; item public.ingest_batch_items%rowtype; v_requeued int := 0; v_left int := 0;
--     v_flag boolean; v_blocking jsonb := '[]';
--   begin
--     if jsonb_typeof(p) is distinct from 'object' or length(coalesce(p->>'decision_id','')) not between 1 and 200
--       or length(coalesce(p->>'approver','')) not between 1 and 200 or coalesce(p->>'evidence_sha256','') !~ '^[a-f0-9]{64}$' then
--       raise exception 'ingest_batch_resume: decision_id, approver and evidence_sha256 are required';
--     end if;
--     if p ? 'requeue_failed' and jsonb_typeof(p->'requeue_failed') <> 'boolean' then
--       raise exception 'ingest_batch_resume: requeue_failed must be true or false';
--     end if;
--     v_flag := coalesce((p->>'requeue_failed')::boolean, false);
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
--       'evidence_sha256',p->>'evidence_sha256','est_cost_usd',v_cost)
--       || case when v_flag then jsonb_build_object('requeue_failed',true) else '{}'::jsonb end);
--     if not v_flag then
--       return jsonb_build_object('batch_id',b.id,'state',b.stopped_from,'est_cost_usd',v_cost);
--     end if;
--     -- The batch row is held (above). Each failed job of this batch, in job-id order, then its item: the order
--     -- ingest_batch_requeue locks them in. Only this batch's own jobs, as there.
--     for j in select * from public.ingest_jobs where batch_id = b.id and status = 'failed' order by id for update loop
--       select * into item from public.ingest_batch_items where batch_id = b.id and job_id = j.id for update;
--       if not found or item.requeues <> 0 then
--         v_left := v_left + 1; v_blocking := v_blocking || to_jsonb(j.id); continue;
--       end if;
--       perform public.ingest_retry(j.id);
--       update public.ingest_batch_items set requeues = requeues + 1 where batch_id = b.id and job_id = j.id;
--       insert into public.ingest_batch_events(batch_id,event,detail)
--       values(b.id,'requeued',jsonb_build_object('job_id',j.id,'error_code',j.error_code,'via','resume','decision_id',p->>'decision_id'));
--       v_requeued := v_requeued + 1;
--     end loop;
--     return jsonb_build_object('batch_id',b.id,'state',b.stopped_from,'est_cost_usd',v_cost,
--       'requeued',v_requeued,'left_failed',v_left,'blocking_jobs',v_blocking,
--       'running',(select count(*) from public.ingest_jobs where batch_id = b.id and status = 'running'),
--       'still_blocked',public.ingest_batch_block_reason(b.id));
--   end $$;
--   revoke all on function public.ingest_batch_mark_stopped(uuid, text, boolean), public.ingest_batch_block_reason(uuid),
--     public.ingest_batch_status(uuid, text[]), public.ingest_batch_stop(uuid, text), public.ingest_batch_resume(uuid, jsonb)
--     from public, anon, authenticated, service_role;
--   grant execute on function public.ingest_batch_status(uuid, text[]), public.ingest_batch_stop(uuid, text) to corpus_ingest, service_role;
--   grant execute on function public.ingest_batch_resume(uuid, jsonb) to service_role;
--   alter table public.ingest_batches drop constraint ingest_batches_state_check,
--     add constraint ingest_batches_state_check check (state in
--       ('open','sealed','registering','registered','indexing','indexed','accepted','stopped'));
--   alter table public.ingest_batch_events drop constraint ingest_batch_events_event_check,
--     add constraint ingest_batch_events_event_check check (event in ('stopped','resumed','requeued'));
--     -- fails if a 'closed' event exists; the events are the record, so leave the constraint then and stop here.
--   alter table public.ingest_jobs drop column failures_acknowledged, drop column failures_seen;   -- loses the counts
--   delete from supabase_migrations.schema_migrations where version = '20261115090000';
--   commit;

begin;
set local lock_timeout = '10s';

do $$
begin
  if to_regprocedure('public.ingest_batch_block_reason(uuid)') is null or to_regprocedure('public.ingest_batch_mark_stopped(uuid,text,boolean)') is null
     or to_regprocedure('public.ingest_batch_status(uuid,text[])') is null or to_regprocedure('public.ingest_batch_stop(uuid,text)') is null
     or to_regprocedure('public.ingest_batch_resume(uuid,jsonb)') is null then
    raise exception 'apply 20261102130000_batch_registration.sql and 20261112090000_batch_resume_requeue.sql first';
  end if;
end $$;

lock table public.ingest_batches, public.ingest_batch_events, public.ingest_jobs in access exclusive mode;

-- F327: the durable count and the acknowledged baseline.
alter table public.ingest_jobs add column failures_seen int not null default 0,
  add column failures_acknowledged int not null default 0,
  add constraint ingest_jobs_failures_acknowledged check (failures_acknowledged <= failures_seen);

create function public.ingest_jobs_count_failure() returns trigger
language plpgsql set search_path = public, extensions, pg_temp as $$
begin
  new.failures_seen := old.failures_seen + 1;
  return new;
end $$;

-- Back-fill, before the trigger exists (it does not fire on a change of failures_seen alone either).
update public.ingest_jobs j set failures_seen = (j.status = 'failed')::int + i.requeues
  from public.ingest_batch_items i
 where i.batch_id = j.batch_id and i.job_id = j.id and (j.status = 'failed' or i.requeues > 0);
update public.ingest_jobs set failures_seen = 1 where batch_id is not null and status = 'failed' and failures_seen = 0;

create trigger ingest_jobs_count_failure before update of status on public.ingest_jobs
  for each row when (new.status = 'failed' and old.status is distinct from 'failed' and new.batch_id is not null)
  execute function public.ingest_jobs_count_failure();

-- F326: the new state and the new ledger event.
alter table public.ingest_batches drop constraint ingest_batches_state_check,
  add constraint ingest_batches_state_check check (state in
    ('open','sealed','registering','registered','indexing','indexed','accepted','stopped','closed_with_failures')) not valid;
alter table public.ingest_batches validate constraint ingest_batches_state_check;
alter table public.ingest_batch_events drop constraint ingest_batch_events_event_check,
  add constraint ingest_batch_events_event_check check (event in ('stopped','resumed','requeued','closed')) not valid;
alter table public.ingest_batch_events validate constraint ingest_batch_events_event_check;

create or replace function public.ingest_batch_mark_stopped(p_batch uuid, p_reason text, p_skip_locked boolean) returns boolean
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare b public.ingest_batches%rowtype;
begin
  if p_skip_locked then
    select * into b from public.ingest_batches where id = p_batch for update skip locked;
  else
    select * into b from public.ingest_batches where id = p_batch for update;
  end if;
  if not found or b.state in ('stopped','accepted','closed_with_failures') then return false; end if;
  update public.ingest_batches set state='stopped', stopped_from=b.state, stop_reason=p_reason, stopped_at=now(), updated_at=now()
   where id = p_batch;
  insert into public.ingest_batch_events(batch_id,event,detail) values(p_batch,'stopped',jsonb_build_object('reason',p_reason,'from',b.state));
  return true;
end $$;

create or replace function public.ingest_batch_block_reason(p_batch uuid) returns text
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare b public.ingest_batches%rowtype; v_spend numeric; v_budget numeric; v_failed bigint; v_done bigint; v_uncertain bigint; st jsonb;
begin
  select * into b from public.ingest_batches where id = p_batch;
  if not found then return 'stopped'; end if;
  if b.state = 'stopped' then return 'stopped'; end if;
  if b.state = 'closed_with_failures' then return 'closed'; end if;
  -- v_failed and v_done count jobs that have ever failed (failures_seen, or failed now), each job once.
  select coalesce(sum(embed_cost_usd),0), count(*) filter (where failures_seen > failures_acknowledged),
         count(*) filter (where status = 'succeeded' or failures_seen > failures_acknowledged),
         count(*) filter (where status='failed' and error_code='text_outcome_uncertain')
    into v_spend, v_failed, v_done, v_uncertain from public.ingest_jobs where batch_id = p_batch;
  -- What the jobs reported, or what model_call_logs holds when more (a killed claim reports nothing).
  v_spend := greatest(v_spend, (select coalesce(sum(m.cost_usd),0) from public.model_call_logs m
                                 where m.raw_usage ? 'batch_id' and m.raw_usage->>'batch_id' = p_batch::text));
  if v_spend >= b.est_cost_usd then return 'spend_ceiling'; end if;
  select budget_usd into v_budget from public.ingest_collection_policies where collection = b.collection;
  if greatest((select coalesce(sum(j.embed_cost_usd),0) from public.ingest_jobs j join public.ingest_batches x on x.id = j.batch_id
                where x.collection = b.collection),
              (select coalesce(sum(m.cost_usd),0) from public.model_call_logs m
                where m.raw_usage ? 'batch_id' and m.raw_usage->>'batch_id' in (select x.id::text from public.ingest_batches x where x.collection = b.collection)))
     >= v_budget then
    return 'collection_spend_ceiling';
  end if;
  st := b.policy->'stop_thresholds';
  if v_uncertain > (st->>'uncertain_max')::numeric then return 'uncertain_count'; end if;
  if v_done >= (st->>'min_decided')::numeric and v_failed::numeric / v_done > (st->>'failure_rate')::numeric then
    return 'failure_rate';
  end if;
  return null;
end $$;

create or replace function public.ingest_batch_status(p_batch uuid, p_source_keys text[] default null) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare b public.ingest_batches%rowtype; v_next text; v_jobs record; v_items jsonb; counts jsonb; by_reason jsonb; jobs jsonb; acc jsonb;
begin
  if coalesce(cardinality(p_source_keys),0) > 1000 then raise exception 'ingest_batch_status: at most 1000 source keys'; end if;
  select * into b from public.ingest_batches where id = p_batch;
  if not found then raise exception 'ingest_batch_status: batch % does not exist', p_batch; end if;
  -- Forward moves only, derived from the jobs this batch admitted. An existing item's job belongs to
  -- whoever registered it (another batch, or a document registered alone): it is reported in the
  -- items and counts, never requeued here, and never holds the batch back.
  if b.state in ('registered','indexing') then
    select count(*) total, count(*) filter (where j.status = 'succeeded') ok,
           count(*) filter (where j.status <> 'queued' or j.attempts > 0) started
      into v_jobs
      from public.ingest_batch_items i join public.ingest_jobs j on j.id = i.job_id
     where i.batch_id = b.id and i.outcome = 'admitted';
    v_next := case when v_jobs.ok = v_jobs.total then 'indexed'
                   when b.state = 'registered' and v_jobs.started > 0 then 'indexing' end;
    if v_next is not null then
      update public.ingest_batches set state = v_next, updated_at = now() where id = b.id and state = b.state;
      if found then b.state := v_next; end if;
    end if;
  end if;
  select jsonb_build_object('items',count(*),'planned',count(*) filter (where outcome='planned'),
    'admitted',count(*) filter (where outcome='admitted'),'existing',count(*) filter (where outcome='existing'),
    'refused',count(*) filter (where outcome='refused')) into counts from public.ingest_batch_items where batch_id = b.id;
  select coalesce(jsonb_object_agg(reason, cnt), '{}') into by_reason from (
    select reason, count(*) cnt from public.ingest_batch_items where batch_id = b.id and outcome='refused' group by reason) x;
  select jsonb_build_object('queued',count(*) filter (where status='queued'),'running',count(*) filter (where status='running'),
    'succeeded',count(*) filter (where status='succeeded'),'failed',count(*) filter (where status='failed'),
    'cancelled',count(*) filter (where status='cancelled'),
    'uncertain',count(*) filter (where status='failed' and error_code='text_outcome_uncertain'),
    'ever_failed',count(*) filter (where status='failed' or failures_seen > 0),
    'acknowledged',count(*) filter (where failures_acknowledged > 0),
    'spend_usd',coalesce(sum(embed_cost_usd),0),'tokens',coalesce(sum(embed_tokens),0)) into jobs
    from public.ingest_jobs where batch_id = b.id;
  jobs := jobs || jsonb_build_object('logged_spend_usd',(select coalesce(sum(m.cost_usd),0) from public.model_call_logs m
                                       where m.raw_usage ? 'batch_id' and m.raw_usage->>'batch_id' = b.id::text));
  select coalesce(jsonb_agg(jsonb_build_object('check',check_name,'passed',passed,'sample',sample,'recorded_at',recorded_at) order by check_name),'[]')
    into acc from public.ingest_batch_acceptance where batch_id = b.id;
  if p_source_keys is not null then
    select coalesce(jsonb_agg(jsonb_build_object('source_key',i.source_key,'outcome',i.outcome,'reason',i.reason,'detail',i.detail,
        'document_id',i.document_id,'job_id',i.job_id,'job_status',j.status,'job_stage',j.stage,'error_code',j.error_code,
        'requeues',i.requeues,'indexed',d.indexed_at is not null) order by i.source_key), '[]')
      into v_items
      from public.ingest_batch_items i
      left join public.ingest_jobs j on j.id = i.job_id
      left join public.documents d on d.id = i.document_id
     where i.batch_id = b.id and i.source_key = any(p_source_keys);
  end if;
  return jsonb_build_object('batch_id',b.id,'collection',b.collection,'state',b.state,'stop_reason',b.stop_reason,
    'manifest_sha256',b.manifest_sha256,'policy_sha256',b.policy_sha256,
    'planned',jsonb_build_object('items',b.items_planned,'chunks',b.chunks_planned,'est_tokens',b.est_tokens,'est_cost_usd',b.est_cost_usd),
    'counts',counts || jsonb_build_object('by_reason',by_reason,
      'existing_not_indexed',(select count(*) from public.ingest_batch_items i join public.documents d on d.id = i.document_id
                               where i.batch_id = b.id and i.outcome = 'existing' and d.indexed_at is null)),'jobs',jobs,
    'indexed',(select count(*) from public.ingest_batch_items i join public.documents d on d.id = i.document_id
                where i.batch_id = b.id and i.outcome in ('admitted','existing') and d.indexed_at is not null),
    'acceptance',acc,'items',v_items,
    'closure',(select e.detail from public.ingest_batch_events e where e.batch_id = b.id and e.event = 'closed' order by e.id desc limit 1));
end $$;

create or replace function public.ingest_batch_stop(p_batch uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare b public.ingest_batches%rowtype;
begin
  if coalesce(p_reason,'') !~ '^[a-z][a-z0-9_:.-]{0,99}$' then
    raise exception 'ingest_batch_stop: reason must be a short lowercase token';
  end if;
  select * into b from public.ingest_batches where id = p_batch for update;
  if not found then raise exception 'ingest_batch_stop: batch % does not exist', p_batch; end if;
  if b.state = 'accepted' then raise exception 'ingest_batch_stop: batch % is accepted', p_batch; end if;
  if b.state = 'closed_with_failures' then raise exception 'ingest_batch_stop: batch % is closed', p_batch; end if;
  if b.state = 'stopped' then
    return jsonb_build_object('batch_id',b.id,'state','stopped','stop_reason',b.stop_reason,'already',true);
  end if;
  perform public.ingest_batch_mark_stopped(b.id, p_reason, false);
  return jsonb_build_object('batch_id',b.id,'state','stopped','stop_reason',p_reason,'already',false);
end $$;

create function public.ingest_batch_close(p_batch uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare b public.ingest_batches%rowtype; v_pass int; v_prev jsonb; v_detail jsonb; v_failed jsonb; v_cancelled jsonb;
  v_unc jsonb; v_unc_n int; v_blk jsonb; v_blk_n int;
begin
  if jsonb_typeof(p) is distinct from 'object'
    or jsonb_typeof(p->'decision_id') is distinct from 'string' or coalesce(p->>'decision_id','') !~ '\S' or length(p->>'decision_id') > 200
    or jsonb_typeof(p->'reason') is distinct from 'string' or coalesce(p->>'reason','') !~ '\S' or length(p->>'reason') > 1000
    or jsonb_typeof(p->'approver') is distinct from 'string' or coalesce(p->>'approver','') !~ '\S' or length(p->>'approver') > 200
    or coalesce(p->>'evidence_sha256','') !~ '^[a-f0-9]{64}$' then
    raise exception 'ingest_batch_close: decision_id, reason, approver (not blank) and evidence_sha256 are required';
  end if;
  select * into b from public.ingest_batches where id = p_batch for update;
  if not found then raise exception 'ingest_batch_close: batch % does not exist', p_batch; end if;
  if b.state = 'closed_with_failures' then
    select e.detail into v_prev from public.ingest_batch_events e where e.batch_id = b.id and e.event = 'closed' order by e.id desc limit 1;
    return jsonb_build_object('batch_id',b.id,'state',b.state,'already',true,'closure',v_prev);
  end if;
  if not (b.state in ('registered','indexing') or (b.state = 'stopped' and b.stopped_from in ('registered','indexing'))) then
    return jsonb_build_object('batch_id',b.id,'state',b.state,'refused','batch_state');
  end if;
  -- Pass 1 reads without locking any job; pass 2 locks only the batch's FAILED jobs, in id order (as resume does), and
  -- reads again, so a job moved between the passes is seen. A queued or running job is never locked: pass 1 refuses it.
  for v_pass in 1..2 loop
    if v_pass = 2 then
      perform 1 from public.ingest_jobs where batch_id = b.id and status = 'failed' order by id for update;
    end if;
    select count(*), coalesce(jsonb_agg(x.o order by x.id) filter (where x.rn <= 50), '[]') into v_unc_n, v_unc from (
      select j.id, jsonb_build_object('job_id',j.id,'requeues',i.requeues) o, row_number() over (order by j.id) rn
        from public.ingest_jobs j left join public.ingest_batch_items i on i.batch_id = b.id and i.job_id = j.id
       where j.batch_id = b.id and j.status = 'failed' and j.error_code = 'text_outcome_uncertain') x;
    if v_unc_n > 0 then
      return jsonb_build_object('batch_id',b.id,'state',b.state,'refused','uncertain_jobs','uncertain_total',v_unc_n,'uncertain_jobs',v_unc);
    end if;
    select count(*), coalesce(jsonb_agg(x.o order by x.id) filter (where x.rn <= 50), '[]') into v_blk_n, v_blk from (
      select j.id, jsonb_build_object('job_id',j.id,'status',j.status,'requeues',i.requeues) o, row_number() over (order by j.id) rn
        from public.ingest_jobs j left join public.ingest_batch_items i on i.batch_id = b.id and i.job_id = j.id
       where j.batch_id = b.id and not (j.status in ('succeeded','cancelled') or (j.status = 'failed' and coalesce(i.requeues,0) >= 1))) x;
    if v_blk_n > 0 then
      return jsonb_build_object('batch_id',b.id,'state',b.state,'refused','jobs_not_final','blocking_total',v_blk_n,'blocking_jobs',v_blk);
    end if;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('job_id',j.id,'source_key',i.source_key,'error_code',j.error_code,
           'failures_seen',j.failures_seen) order by i.source_key, j.id), '[]') into v_failed
    from public.ingest_jobs j join public.ingest_batch_items i on i.batch_id = b.id and i.job_id = j.id
   where j.batch_id = b.id and j.status = 'failed';
  if jsonb_array_length(v_failed) = 0 then
    return jsonb_build_object('batch_id',b.id,'state',b.state,'refused','no_failed_jobs');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('job_id',j.id,'source_key',i.source_key) order by i.source_key, j.id), '[]') into v_cancelled
    from public.ingest_jobs j left join public.ingest_batch_items i on i.batch_id = b.id and i.job_id = j.id
   where j.batch_id = b.id and j.status = 'cancelled';
  v_detail := jsonb_build_object('decision_id',p->>'decision_id','reason',p->>'reason','approver',p->>'approver',
    'evidence_sha256',p->>'evidence_sha256','failed_jobs',v_failed,'cancelled_jobs',v_cancelled,
    'was_stopped',b.state = 'stopped','stop_reason',b.stop_reason,'from',coalesce(b.stopped_from,b.state));
  update public.ingest_batches set state='closed_with_failures', stopped_from=null, stop_reason=null, stopped_at=null, updated_at=now()
   where id = b.id;
  insert into public.ingest_batch_events(batch_id,event,detail) values(b.id,'closed',v_detail);
  return jsonb_build_object('batch_id',b.id,'state','closed_with_failures','already',false,'closure',v_detail);
end $$;

-- ingest_batch_resume, from 20261112090000 (its last definition): every resume acknowledges the failures seen so far.
create or replace function public.ingest_batch_resume(p_batch uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare b public.ingest_batches%rowtype; v_cost numeric;
  j public.ingest_jobs%rowtype; item public.ingest_batch_items%rowtype; v_requeued int := 0; v_left int := 0;
  v_flag boolean; v_blocking jsonb := '[]'; v_ack jsonb;
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
  -- The acknowledged baseline: written only here. Rows locked in id order.
  with t as (select id from public.ingest_jobs where batch_id = b.id and failures_acknowledged < failures_seen order by id for update),
       u as (update public.ingest_jobs aj set failures_acknowledged = aj.failures_seen from t where aj.id = t.id returning aj.id)
  select coalesce(jsonb_agg(id order by id), '[]') into v_ack from u;
  insert into public.ingest_batch_events(batch_id,event,detail) values(b.id,'resumed',jsonb_build_object(
    'reason',b.stop_reason,'to',b.stopped_from,'decision_id',p->>'decision_id','approver',p->>'approver',
    'evidence_sha256',p->>'evidence_sha256','est_cost_usd',v_cost,'acknowledged_jobs',v_ack)
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

-- Privileges as 20261102130000_batch_registration.sql and 20261112090000_batch_resume_requeue.sql set them (restated, not
-- widened); the new function for service_role only.
revoke all on function
  public.ingest_batch_mark_stopped(uuid, text, boolean), public.ingest_batch_block_reason(uuid),
  public.ingest_batch_status(uuid, text[]), public.ingest_batch_stop(uuid, text), public.ingest_batch_resume(uuid, jsonb),
  public.ingest_batch_close(uuid, jsonb), public.ingest_jobs_count_failure()
  from public, anon, authenticated, service_role;
grant execute on function public.ingest_batch_status(uuid, text[]), public.ingest_batch_stop(uuid, text) to corpus_ingest, service_role;
grant execute on function public.ingest_batch_resume(uuid, jsonb), public.ingest_batch_close(uuid, jsonb) to service_role;

commit;
analyze public.ingest_jobs;
