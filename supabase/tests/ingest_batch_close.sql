-- F326 and F327: ingest_batch_close (a batch closed with its failed jobs named) and the failure rate that counts failures
-- ever seen. Disposable fixture. run.sh uses national_search_only's chain, then 20261112090000_batch_resume_requeue, then
-- 20261115090000_batch_close_and_failure_count (as a non-superuser). The helpers are ingest_register_batch.sql's.
\set ON_ERROR_STOP on
begin;
set search_path = public, extensions;
create function pg_temp.ok(v boolean, label text) returns void language plpgsql as $$begin
 if v is distinct from true then raise exception 'FAIL %', label; end if; raise notice 'PASS %', label; end$$;
create function pg_temp.refused(q text, pattern text) returns void language plpgsql as $$begin
 begin execute q; exception when others then
 if position(pattern in sqlerrm)=0 then raise exception 'wrong refusal: %',sqlerrm; end if; return; end;
 raise exception 'accepted unsafe operation: %',q; end$$;

-- ═══ Helpers (from ingest_register_batch.sql) ═══════════════════════════════

create function pg_temp.i_open(p jsonb) returns jsonb language plpgsql as $$declare v jsonb; begin
 set local role corpus_ingest; v := public.ingest_batch_open(p); reset role; return v; end$$;
create function pg_temp.i_add(b uuid, items jsonb) returns jsonb language plpgsql as $$declare v jsonb; begin
 set local role corpus_ingest; v := public.ingest_batch_add_items(b, items); reset role; return v; end$$;
create function pg_temp.i_seal(b uuid) returns jsonb language plpgsql as $$declare v jsonb; begin
 set local role corpus_ingest; v := public.ingest_batch_seal(b); reset role; return v; end$$;
create function pg_temp.i_reg(b uuid, docs jsonb) returns jsonb language plpgsql as $$declare v jsonb; begin
 set local role corpus_ingest; v := public.ingest_register_batch(b, docs, false, false); reset role; return v; end$$;
create function pg_temp.i_requeue(b uuid, ids uuid[]) returns jsonb language plpgsql as $$declare v jsonb; begin
 set local role corpus_ingest; v := public.ingest_batch_requeue(b, ids); reset role; return v; end$$;
create function pg_temp.svc(q text) returns jsonb language plpgsql as $$declare v jsonb; begin
 set local role service_role; execute q into v; reset role; return v; end$$;
create function pg_temp.policy(c text, over jsonb default '{}') returns jsonb language sql as $$
 select pg_temp.svc(format('select public.ingest_policy_approve(%L::jsonb)', (jsonb_build_object('collection',c,
  'admitted',jsonb_build_array(jsonb_build_object('desk_tier','national','desk_feature','Parliamentary Question Database','adapter','lok_sabha_answers'))
  ,'licence_classes',jsonb_build_array('gov_open'),'min_chars_per_page',600,'min_pages_for_density',5,'require_page_count',false,
  'budget_usd',100,'chunk_ceiling',100000,'stop_thresholds',jsonb_build_object('refusal_share',1,'failure_rate',1,'uncertain_max',1,'min_decided',1),
  'decision_id','fixture-decision','approver','Fixture Owner','evidence_sha256',repeat('e',64)) || over)::text))
$$;
create function pg_temp.pq_url(g int) returns text language sql immutable as $$
 select 'https://sansad.in/getFile/loksabhaquestions/annex/187/AU' || (1000+g) || '_fx.pdf?source=pqals' $$;
create function pg_temp.pq_key(g int) returns text language sql immutable as $$
 select left(encode(sha256(convert_to('pq-key-' || g, 'UTF8')), 'hex'), 40) $$;
create function pg_temp.req(r jsonb) returns jsonb language sql as $$
 select jsonb_build_object('payload',r::text,'payload_sha256',encode(sha256(convert_to(r::text,'UTF8')),'hex'),
  'expected',jsonb_build_array(jsonb_build_object('chunk_hash',encode(sha256(convert_to('c'||(r->>'source_key')||(r->>'text'),'UTF8')),'hex'),
    'embed_hash',encode(sha256(convert_to('e'||(r->>'source_key')||(r->>'text'),'UTF8')),'hex'),'chunk_index',0,'source_kind','document',
    'char_from',0,'char_to',length(r->>'text'),'content',r->>'text','token_count',4,'chunker_version',4)),
  'pages','[]'::jsonb,'sections','[]'::jsonb) $$;
create function pg_temp.pq(g int) returns jsonb language plpgsql as $$
declare txt text := 'LOK SABHA UNSTARRED QUESTION ' || g || '. ANSWER. A written answer.';
begin
 return pg_temp.req(jsonb_build_object('source_key',pg_temp.pq_key(g),'title','Subject ' || g,'text',txt,
   'text_sha256',encode(sha256(convert_to(txt,'UTF8')),'hex'),'desk_tier','national','desk_feature','Parliamentary Question Database',
   'file_name','AU' || (1000+g) || '_fx.pdf','file_url',pg_temp.pq_url(g),'document_key_suggested','pq:ls:187:AU' || (1000+g) || '_fx',
   'licence_class','gov_open',
   'citation',jsonb_build_object('kind','parliamentary_question','house','Lok Sabha','session','187','subject','Subject ' || g,
     'ministry','MINISTRY OF FIXTURES','answered_on','02.04.2026'),
   'review',jsonb_build_object('status','eligible','checks',jsonb_build_object('identity',true,'completeness',true,'sensitivity',true,'dedupe',true,'rights',true)),
   'pages',jsonb_build_array(jsonb_build_object('page_number',1,'char_from',0,'char_to',0))));
end $$;
create function pg_temp.item(q jsonb) returns jsonb language sql as $$
 select jsonb_build_object('source_key',(q->>'payload')::jsonb->>'source_key','payload_sha256',q->>'payload_sha256',
  'content_sha256',(q->>'payload')::jsonb->>'text_sha256','chunks',jsonb_array_length(q->'expected'),'est_tokens',10) $$;
create function pg_temp.manifest(items jsonb) returns text language sql as $$
 select encode(sha256(convert_to(coalesce(string_agg(concat_ws(E'\t', e->>'source_key', e->>'payload_sha256', e->>'content_sha256',
   e->>'chunks', e->>'est_tokens') || E'\n', '' order by e->>'source_key' collate "C"), ''), 'UTF8')), 'hex')
 from jsonb_array_elements(items) e $$;
-- A sealed batch of one collection over these requests, registered; returns the batch id.
create temp sequence salt start 11;
create function pg_temp.batch(c text, reqs jsonb) returns uuid language plpgsql as $$
declare items jsonb := (select jsonb_agg(pg_temp.item(q) || jsonb_build_object('est_tokens', nextval('pg_temp.salt'))) from jsonb_array_elements(reqs) q);
  v jsonb; b uuid;
begin
 v := pg_temp.i_open(jsonb_build_object('collection',c,'manifest_sha256',pg_temp.manifest(items),'items_planned',jsonb_array_length(items),
   'chunks_planned',(select sum((e->>'chunks')::int) from jsonb_array_elements(items) e),
   'est_tokens',(select sum((e->>'est_tokens')::int) from jsonb_array_elements(items) e),'est_cost_usd',1,'runner_commit','abcdef1'));
 b := (v->>'batch_id')::uuid;
 perform pg_temp.i_add(b, items);
 perform pg_temp.i_seal(b);
 v := pg_temp.i_reg(b, reqs);
 if (v#>>'{totals,admitted}')::int is distinct from jsonb_array_length(reqs) then raise exception 'FAIL registration: %', v; end if;
 return b;
end $$;
-- ingest_batch_resume as service_role; over is merged into a valid decision.
create function pg_temp.resume(b uuid, over jsonb default '{}') returns jsonb language sql as $$
 select pg_temp.svc(format('select public.ingest_batch_resume(%L, %L)', b,
   (jsonb_build_object('decision_id','fixture-resume','approver','Fixture Owner','evidence_sha256',repeat('d',64)) || over)::text)) $$;
-- Everything of one batch the functions write: the batch, its items, its jobs, its events.
create function pg_temp.ledger(p uuid) returns text language sql as $$
 select md5(concat_ws('|', (select to_jsonb(x)::text from public.ingest_batches x where id = p),
   (select string_agg(to_jsonb(i)::text, ',' order by source_key) from public.ingest_batch_items i where batch_id = p),
   (select string_agg(to_jsonb(j)::text, ',' order by id) from public.ingest_jobs j where batch_id = p),
   (select string_agg(to_jsonb(e)::text, ',' order by id) from public.ingest_batch_events e where batch_id = p))) $$;

create function pg_temp.cp(d text, r text, over jsonb default '{}') returns text language sql as $$
 select (jsonb_build_object('decision_id',d,'reason',r,'approver','Fixture Owner','evidence_sha256',repeat('c',64)) || over)::text $$;
create function pg_temp.cl(b uuid, d text, r text, over jsonb default '{}') returns jsonb language sql as $$
 select pg_temp.svc(format('select public.ingest_batch_close(%L, %L::jsonb)', b, pg_temp.cp(d, r, over))) $$;
create function pg_temp.st(b uuid) returns jsonb language sql as $$
 select pg_temp.svc(format('select public.ingest_batch_status(%L, null)', b)) $$;
create function pg_temp.fail(j uuid) returns void language sql as $$
 update public.ingest_jobs set status = 'failed', error_code = 'embed_failed', finished_at = now() where id = j $$;
create function pg_temp.done(j uuid) returns void language sql as $$
 update public.ingest_jobs set status = 'succeeded', stage = 'done', finished_at = now() where id = j $$;
-- The batch's jobs in item order: j(b, n) is the n-th (1-based) by source key.
create function pg_temp.j(b uuid, n int) returns uuid language sql as $$
 select job_id from public.ingest_batch_items where batch_id = b and outcome = 'admitted' order by source_key offset n - 1 limit 1 $$;
-- What a close must never change: every job, item and document of the batch.
create function pg_temp.kept(p uuid) returns text language sql as $$
 select md5(concat_ws('|',
   (select string_agg(to_jsonb(i)::text, ',' order by source_key) from public.ingest_batch_items i where batch_id = p),
   (select string_agg(to_jsonb(j)::text, ',' order by id) from public.ingest_jobs j where batch_id = p),
   (select string_agg(to_jsonb(d)::text, ',' order by id) from public.documents d where id in (select document_id from public.ingest_batch_items where batch_id = p)))) $$;

insert into public.desk_rows(tier,feature,row_key,row,record_text,snapshot_at)
select 'national','Parliamentary Question Database','q' || g,
  jsonb_build_object('id','q' || g,'house','Lok Sabha','date','2026-04-02','ministry','MINISTRY OF FIXTURES','subject','Subject ' || g,
   'mp_name','Member','source_url',pg_temp.pq_url(g)), 'Subject ' || g, now()
from generate_series(1, 100) g;
select pg_temp.policy('national-pq');
select pg_temp.policy('national-pq-fragile', jsonb_build_object('stop_thresholds',jsonb_build_object('refusal_share',1,'failure_rate',0.4,'uncertain_max',1,'min_decided',2)));
update public.ingest_settings set max_running = 8, claim_batch = 8;
-- A function's writes are not seen by the rest of the statement that made them, so each result is saved to a table first.


-- ═══ (a) F326: a job that fails after its requeue; the batch is stopped; it is closed with the failures named ═══

create temp table a as select pg_temp.batch('national-pq', jsonb_build_array(pg_temp.pq(1), pg_temp.pq(2), pg_temp.pq(3))) b;
select pg_temp.done(pg_temp.j(b, 1)), pg_temp.fail(pg_temp.j(b, 2)), pg_temp.fail(pg_temp.j(b, 3)) from a;
create temp table a_c0 as select pg_temp.cl(b, 'fx-1', 'reason') r from a;
select pg_temp.ok((select r->>'refused' = 'jobs_not_final' and jsonb_array_length(r->'blocking_jobs') = 2 from a_c0)
  and (select state from public.ingest_batches where id = (select b from a)) = 'registered'
  and not exists(select 1 from public.ingest_batch_events where batch_id = (select b from a) and event = 'closed'),
  'a: two failed jobs not yet requeued: refused jobs_not_final, both listed, nothing written');
create temp table a_q1 as select pg_temp.i_requeue(b, array[pg_temp.j(b, 2), pg_temp.j(b, 3)]) r from a;
select pg_temp.ok((select bool_and(e->>'outcome' = 'requeued') from a_q1, jsonb_array_elements(r->'results') e), 'a: both failed jobs are requeued once');
create temp table a_c1 as select pg_temp.cl(b, 'fx-1', 'reason') r from a;
select pg_temp.ok((select r->>'refused' = 'jobs_not_final' and jsonb_array_length(r->'blocking_jobs') = 2 and r->'blocking_jobs'->0->>'status' = 'queued' from a_c1),
  'a: requeued (queued) jobs: refused jobs_not_final');
select pg_temp.fail(pg_temp.j(b, 2)) from a;
create temp table a_c2 as select pg_temp.cl(b, 'fx-1', 'reason') r from a;
select pg_temp.ok((select r->>'refused' = 'jobs_not_final' and jsonb_array_length(r->'blocking_jobs') = 1
                          and (r->'blocking_jobs'->0->>'job_id')::uuid = pg_temp.j((select b from a), 3) from a_c2),
  'a: one failed again after its requeue, one still queued: refused, only the queued one blocks');
select pg_temp.fail(pg_temp.j(b, 3)) from a;
create temp table a_q2 as select pg_temp.i_requeue(b, array[pg_temp.j(b, 2)]) r from a;
select pg_temp.ok((select r#>>'{results,0,reason}' = 'failed_after_requeue' and r->>'state' = 'stopped' from a_q2)
  and (select stop_reason = 'failed_after_requeue' and stopped_from = 'registered' from public.ingest_batches where id = (select b from a)),
  'a: the second requeue is refused failed_after_requeue and stops the batch (the defect F326 closes)');
create temp table a_before as select pg_temp.kept(b) k from a;
create temp table a_c3 as select pg_temp.cl(b, 'fx-decision-7', 'two documents cannot be embedded; owner accepts') r from a;
select pg_temp.ok((select r->>'state' = 'closed_with_failures' and (r->>'already')::boolean = false from a_c3)
  and (select state = 'closed_with_failures' and stop_reason is null and stopped_from is null and stopped_at is null
        from public.ingest_batches where id = (select b from a)),
  'a: a stopped batch is closed: new state, the stop cleared');
select pg_temp.ok((select count(*) from public.ingest_batch_events where batch_id = (select b from a) and event = 'closed') = 1
  and (select detail->>'decision_id' = 'fx-decision-7' and detail->>'reason' = 'two documents cannot be embedded; owner accepts'
              and (detail->>'was_stopped')::boolean and detail->>'stop_reason' = 'failed_after_requeue' and detail->>'from' = 'registered'
         from public.ingest_batch_events where batch_id = (select b from a) and event = 'closed'),
  'a: one closed event carries the decision, the reason and the stop it replaced');
select pg_temp.ok((select jsonb_array_length(detail->'failed_jobs') = 2
              and (select array_agg(f->>'source_key' order by f->>'source_key') from jsonb_array_elements(detail->'failed_jobs') f)
                  = (select array_agg(source_key order by source_key) from public.ingest_batch_items
                      where batch_id = (select b from a) and job_id in (pg_temp.j((select b from a), 2), pg_temp.j((select b from a), 3)))
              and (select bool_and((f->>'job_id')::uuid in (pg_temp.j((select b from a), 2), pg_temp.j((select b from a), 3)) and f->>'error_code' = 'embed_failed')
                     from jsonb_array_elements(detail->'failed_jobs') f)
         from public.ingest_batch_events where batch_id = (select b from a) and event = 'closed'),
  'a: the failed jobs are named by job id and source key, with their error code');
select pg_temp.ok((select pg_temp.kept(b) = (select k from a_before) from a), 'a: nothing was deleted or changed: every item, job and document is as before');
-- Idempotent: a second call, even with another decision, returns the record and writes nothing.
create temp table a_c4 as select pg_temp.cl(b, 'fx-other', 'another reason') r from a;
select pg_temp.ok((select (r->>'already')::boolean and r->'closure'->>'decision_id' = 'fx-decision-7' and r->>'state' = 'closed_with_failures' from a_c4)
  and (select count(*) from public.ingest_batch_events where batch_id = (select b from a) and event = 'closed') = 1
  and (select pg_temp.kept(b) = (select k from a_before) from a),
  'a: closing again is idempotent: the first decision is returned, no new event');
-- A closed batch stays closed and distinguishable.
create temp table a_s as select pg_temp.st(b) r from a;
select pg_temp.ok((select r->>'state' = 'closed_with_failures' and r->'closure'->>'decision_id' = 'fx-decision-7' and (r#>>'{jobs,failed}')::int = 2 from a_s),
  'a: status reports closed_with_failures, the closure and the failed count');
select pg_temp.ok(public.ingest_batch_block_reason((select b from a)) = 'closed', 'a: a closed batch is blocked from claims (closed)');
select pg_temp.refused(format('select public.ingest_batch_stop(%L, %L)', (select b from a), 'operator_stop'), 'is closed');
select pg_temp.refused(format('select public.ingest_batch_resume(%L, %L)', (select b from a),
  '{"decision_id":"d","approver":"x","evidence_sha256":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"}'), 'not stopped');
create temp table a_q3 as select pg_temp.i_requeue(b, array[pg_temp.j(b, 2), pg_temp.j(b, 3)]) r from a;
select pg_temp.ok((select bool_and(e->>'outcome' = 'refused') and (array_agg(e->>'reason' order by ord))[1] = 'failed_after_requeue' from a_q3, jsonb_array_elements(r->'results') with ordinality t(e, ord))
  and (select state from public.ingest_batches where id = (select b from a)) = 'closed_with_failures'
  and (select pg_temp.kept(b) = (select k from a_before) from a), 'a: requeue of a closed batch''s jobs is refused and writes nothing');
-- An operator retries one job outside the batch functions: the claim must neither take it nor fail.
select public.ingest_retry(pg_temp.j(b, 2)) from a;
create temp table a_c5 as select count(*) n from public.ingest_claim(8, interval '5 minutes');
select pg_temp.ok((select n from a_c5) = 0 and (select state from public.ingest_batches where id = (select b from a)) = 'closed_with_failures'
  and (select status from public.ingest_jobs where id = pg_temp.j((select b from a), 2)) = 'queued',
  'a: the claim leaves a closed batch''s retried job alone and does not stop the batch');

select pg_temp.svc(format('select public.ingest_cancel(%L)', pg_temp.j((select b from a), 2)));
select pg_temp.ok((select status from public.ingest_jobs where id = pg_temp.j((select b from a), 2)) = 'cancelled', 'a: an operator-retried job of a closed batch is cancelled (ingest_cancel), as the header says');

-- ═══ (b) Refusals: blank decision, wrong state, wrong jobs ═══════════════════

create temp table b as select pg_temp.batch('national-pq', jsonb_build_array(pg_temp.pq(4), pg_temp.pq(5))) b;
select pg_temp.refused(format('select public.ingest_batch_close(%L, %L::jsonb)', (select b from b), pg_temp.cp('', 'reason')), 'are required');
select pg_temp.refused(format('select public.ingest_batch_close(%L, %L::jsonb)', (select b from b), pg_temp.cp('   ', 'reason')), 'are required');
select pg_temp.refused(format('select public.ingest_batch_close(%L, %L::jsonb)', (select b from b), pg_temp.cp('d', E' \t\n')), 'are required');
select pg_temp.refused(format('select public.ingest_batch_close(%L, %L::jsonb)', (select b from b), pg_temp.cp('d', 'r', '{"decision_id":null}')), 'are required');
select pg_temp.refused(format('select public.ingest_batch_close(%L, %L::jsonb)', (select b from b), pg_temp.cp('d', 'r', '{"reason":null}')), 'are required');
select pg_temp.refused(format('select public.ingest_batch_close(%L, %L::jsonb)', (select b from b), pg_temp.cp(repeat('x', 201), 'reason')), 'are required');
select pg_temp.refused(format('select public.ingest_batch_close(%L, %L::jsonb)', (select b from b), pg_temp.cp('d', 'r', '{"approver":"  "}')), 'are required');
select pg_temp.refused(format('select public.ingest_batch_close(%L, %L::jsonb)', (select b from b), pg_temp.cp('d', 'r', '{"approver":null}')), 'are required');
select pg_temp.refused(format('select public.ingest_batch_close(%L, %L::jsonb)', (select b from b), pg_temp.cp('d', 'r', '{"evidence_sha256":"abc"}')), 'are required');
select pg_temp.refused(format('select public.ingest_batch_close(%L, %L::jsonb)', (select b from b), pg_temp.cp('d', 'r', '{"evidence_sha256":null}')), 'are required');
select pg_temp.refused(format('select public.ingest_batch_close(%L, %L::jsonb)', (select b from b), '[1]'), 'are required');
select pg_temp.refused(format('select public.ingest_batch_close(%L, %L::jsonb)', gen_random_uuid(), pg_temp.cp('d', 'reason')), 'does not exist');
select pg_temp.ok(not exists(select 1 from public.ingest_batch_events where batch_id = (select b from b) and event = 'closed')
  and (select state from public.ingest_batches where id = (select b from b)) = 'registered', 'b: blank or oversized decision or reason: refused, nothing written');
-- Queued jobs: not closable.
create temp table b1 as select pg_temp.cl(b, 'd', 'r') r from b;
select pg_temp.ok((select r->>'refused' = 'jobs_not_final' from b1), 'b: all jobs queued: refused jobs_not_final');
-- All succeeded: nothing failed, nothing to close (and, once status runs, it is indexed).
select pg_temp.done(pg_temp.j(b, 1)), pg_temp.done(pg_temp.j(b, 2)) from b;
create temp table b2 as select pg_temp.cl(b, 'd', 'r') r from b;
select pg_temp.ok((select r->>'refused' = 'no_failed_jobs' from b2), 'b: all succeeded, still registered: refused no_failed_jobs');
create temp table b2s as select pg_temp.st(b) r from b;
create temp table b3 as select pg_temp.cl(b, 'd', 'r') r from b;
select pg_temp.ok((select r->>'state' from b2s) = 'indexed' and (select r->>'refused' = 'batch_state' and r->>'state' = 'indexed' from b3),
  'b: an indexed batch cannot be closed (refused batch_state): indexed and closed_with_failures stay distinct');
-- A running job, then a cancelled one (final: listed in the event).
create temp table c as select pg_temp.batch('national-pq', jsonb_build_array(pg_temp.pq(6), pg_temp.pq(7), pg_temp.pq(8))) b;
select pg_temp.done(pg_temp.j(b, 1)), pg_temp.fail(pg_temp.j(b, 2)) from c;
select pg_temp.i_requeue(b, array[pg_temp.j(b, 2)]) from c;
select pg_temp.fail(pg_temp.j(b, 2)) from c;
update public.ingest_jobs set status = 'running', claim_token = gen_random_uuid(), lease_until = now() + interval '1 hour' where id = (select pg_temp.j(b, 3) from c);
create temp table c2 as select pg_temp.cl(b, 'd', 'r') r from c;
select pg_temp.ok((select r->>'refused' = 'jobs_not_final' and r->'blocking_jobs'->0->>'status' = 'running' and (r->>'blocking_total')::int = 1 from c2), 'c: a running job: refused jobs_not_final');
update public.ingest_jobs set status = 'cancelled', claim_token = null, lease_until = null where id = (select pg_temp.j(b, 3) from c);
create temp table c3 as select pg_temp.cl(b, 'd-c', 'r') r from c;
select pg_temp.ok((select r->>'state' = 'closed_with_failures' and jsonb_array_length(r#>'{closure,failed_jobs}') = 1
                          and jsonb_array_length(r#>'{closure,cancelled_jobs}') = 1
                          and (r#>>'{closure,cancelled_jobs,0,job_id}')::uuid = pg_temp.j((select b from c), 3)
                          and r#>>'{closure,approver}' = 'Fixture Owner' and r#>>'{closure,evidence_sha256}' = repeat('c', 64) from c3)
  and (select count(*) from public.ingest_batch_events where batch_id = (select b from c) and event = 'closed') = 1,
  'c: a cancelled job is final and listed as cancelled_jobs; the failure named; approver and evidence recorded (a never-stopped batch)');
-- A batch of cancelled jobs and successes only has nothing to close.
-- More than 50 blocking jobs: the list is capped, the total is not.
create temp table big as select pg_temp.batch('national-pq', (select jsonb_agg(pg_temp.pq(g) order by g) from generate_series(41, 95) g)) b;
create temp table big1 as select pg_temp.cl(b, 'd', 'r') r from big;
select pg_temp.ok((select r->>'refused' = 'jobs_not_final' and (r->>'blocking_total')::int = 55 and jsonb_array_length(r->'blocking_jobs') = 50 from big1),
  'big: 55 queued jobs: refused jobs_not_final, 50 listed, the total says 55');
-- Set them aside so later claims of the fixture do not hand them out.
update public.ingest_jobs set status = 'cancelled' where batch_id = (select b from big);
-- Uncertain jobs need reconciliation, not closure.
create temp table u as select pg_temp.batch('national-pq', jsonb_build_array(pg_temp.pq(96), pg_temp.pq(97))) b;
select pg_temp.done(pg_temp.j(b, 1)) from u;
update public.ingest_jobs set status = 'failed', error_code = 'text_outcome_uncertain', finished_at = now() where id = (select pg_temp.j(b, 2) from u);
select pg_temp.i_requeue(b, array[pg_temp.j(b, 2)]) from u;
update public.ingest_jobs set status = 'failed', error_code = 'text_outcome_uncertain', finished_at = now() where id = (select pg_temp.j(b, 2) from u);
create temp table u1 as select pg_temp.cl(b, 'd', 'r') r from u;
select pg_temp.ok((select r->>'refused' = 'uncertain_jobs' and (r->>'uncertain_total')::int = 1
                          and (r->'uncertain_jobs'->0->>'job_id')::uuid = pg_temp.j((select b from u), 2) from u1)
  and (select state from public.ingest_batches where id = (select b from u)) = 'registered',
  'u: a job failed as text_outcome_uncertain (even after its requeue): refused uncertain_jobs, listed, nothing written');
-- An open batch (not yet registered) and a batch stopped before registration is complete are not closable.
create temp table o as select pg_temp.i_open(jsonb_build_object('collection','national-pq','manifest_sha256',repeat('a',64),'items_planned',1,
  'chunks_planned',1,'est_tokens',1,'est_cost_usd',1,'runner_commit','abcdef1'))->>'batch_id' as b;
create temp table o1 as select pg_temp.cl(b::uuid, 'd', 'r') r from o;
select pg_temp.ok((select r->>'refused' = 'batch_state' and r->>'state' = 'open' from o1), 'o: an open batch: refused batch_state');
-- A stopped batch (stopped from registered) whose failed job has no requeue yet.
create temp table s as select pg_temp.batch('national-pq', jsonb_build_array(pg_temp.pq(9), pg_temp.pq(10))) b;
select pg_temp.done(pg_temp.j(b, 1)), pg_temp.fail(pg_temp.j(b, 2)) from s;
select pg_temp.svc(format('select public.ingest_batch_stop(%L, %L)', b, 'operator_stop')) from s;
create temp table s1 as select pg_temp.cl(b, 'd', 'r') r from s;
select pg_temp.ok((select r->>'refused' = 'jobs_not_final' from s1) and (select state from public.ingest_batches where id = (select b from s)) = 'stopped',
  's: a stopped batch with a failed job never requeued: refused, and still stopped');

-- ═══ (c) Who may close ═══════════════════════════════════════════════════════

select pg_temp.ok((select count(*) from pg_proc where proname = 'ingest_batch_close' and pronamespace = 'public'::regnamespace) = 1
  and (select prosecdef and proconfig = array['search_path=public, extensions, pg_temp'] from pg_proc
        where oid = 'public.ingest_batch_close(uuid,jsonb)'::regprocedure), 'p: one ingest_batch_close, security definer, search_path ends with pg_temp');
select pg_temp.ok(has_function_privilege('service_role', 'public.ingest_batch_close(uuid,jsonb)', 'execute')
  and not exists(select 1 from unnest(array['public','anon','authenticated','corpus_ingest']) r
                  where has_function_privilege(r, 'public.ingest_batch_close(uuid,jsonb)', 'execute')),
  'p: service_role closes; PUBLIC, anon, authenticated and corpus_ingest may not');
select b as s_batch from s \gset
set local role corpus_ingest;
select pg_temp.refused(format('select public.ingest_batch_close(%L, %L::jsonb)', :'s_batch', pg_temp.cp('d', 'r')), 'permission denied for function ingest_batch_close');
reset role;
set local role authenticated;
select pg_temp.refused(format('select public.ingest_batch_close(%L, %L::jsonb)', :'s_batch', pg_temp.cp('d', 'r')), 'permission denied for function ingest_batch_close');
reset role;
set local role anon;
select pg_temp.refused(format('select public.ingest_batch_close(%L, %L::jsonb)', :'s_batch', pg_temp.cp('d', 'r')), 'permission denied for function ingest_batch_close');
reset role;
-- The neighbours keep their grants (restated, not widened).
select pg_temp.ok(has_function_privilege('corpus_ingest', 'public.ingest_batch_status(uuid,text[])', 'execute')
  and has_function_privilege('service_role', 'public.ingest_batch_status(uuid,text[])', 'execute')
  and has_function_privilege('corpus_ingest', 'public.ingest_batch_stop(uuid,text)', 'execute')
  and has_function_privilege('service_role', 'public.ingest_batch_stop(uuid,text)', 'execute')
  and has_function_privilege('service_role', 'public.ingest_batch_resume(uuid,jsonb)', 'execute')
  and not exists(select 1 from unnest(array['public','anon','authenticated','corpus_ingest']) r where has_function_privilege(r, 'public.ingest_batch_resume(uuid,jsonb)', 'execute'))
  and not exists(select 1 from unnest(array['public','anon','authenticated']) r, unnest(array[
        'public.ingest_batch_status(uuid,text[])','public.ingest_batch_stop(uuid,text)','public.ingest_batch_block_reason(uuid)',
        'public.ingest_batch_mark_stopped(uuid,text,boolean)','public.ingest_jobs_count_failure()']) f
       where has_function_privilege(r, f::regprocedure, 'execute'))
  and not exists(select 1 from unnest(array['corpus_ingest','service_role']) r, unnest(array[
        'public.ingest_batch_block_reason(uuid)','public.ingest_batch_mark_stopped(uuid,text,boolean)','public.ingest_jobs_count_failure()']) f
       where has_function_privilege(r, f::regprocedure, 'execute')),
  'p: status and stop keep corpus_ingest and service_role; block_reason, mark_stopped and the trigger function stay owner-only');

-- ═══ (d) F327: the failure rate counts failures ever seen ═══════════════════

-- failure_rate 0.4, min_decided 2. Five jobs: two succeed, one fails and is requeued, one fails, one is left queued.
create temp table f as select pg_temp.batch('national-pq-fragile', jsonb_build_array(pg_temp.pq(11), pg_temp.pq(12), pg_temp.pq(13), pg_temp.pq(14), pg_temp.pq(15))) b;
select pg_temp.done(pg_temp.j(b, 1)), pg_temp.done(pg_temp.j(b, 2)), pg_temp.fail(pg_temp.j(b, 3)) from f;
select pg_temp.ok((select failures_seen from public.ingest_jobs where id = pg_temp.j((select b from f), 3)) = 1
  and (select bool_and(failures_seen = 0) from public.ingest_jobs where id in (pg_temp.j((select b from f), 1), pg_temp.j((select b from f), 2),
        pg_temp.j((select b from f), 4), pg_temp.j((select b from f), 5))), 'f: a job marked failed counts one failure seen; the others none');
select pg_temp.ok(public.ingest_batch_block_reason((select b from f)) is null, 'f: 1 failure of 3 decided (0.33) is under the 0.4 limit');
create temp table f_q as select pg_temp.i_requeue(b, array[pg_temp.j(b, 3)]) r from f;
select pg_temp.ok((select r#>>'{results,0,outcome}' = 'requeued' from f_q)
  and (select status from public.ingest_jobs where id = pg_temp.j((select b from f), 3)) = 'queued'
  and (select failures_seen from public.ingest_jobs where id = pg_temp.j((select b from f), 3)) = 1,
  'f: the requeue makes the job queued; its failure stays counted');
select pg_temp.fail(pg_temp.j(b, 4)) from f;
-- Old rule: 1 failed (job 4) of 3 decided (jobs 1, 2, 4) = 0.33, no stop. New rule: jobs 3 and 4 failed at some time, of 4 decided = 0.5.
select pg_temp.ok(public.ingest_batch_block_reason((select b from f)) = 'failure_rate',
  'f: a failure that was requeued still counts: 2 of 4 (0.5) is over 0.4; only the current statuses would say 1 of 3 (0.33)');
create temp table f_s as select pg_temp.st(b) r from f;
select pg_temp.ok((select (r#>>'{jobs,failed}')::int = 1 and (r#>>'{jobs,ever_failed}')::int = 2 and (r#>>'{jobs,queued}')::int = 2 from f_s),
  'f: status shows 1 failed now, 2 ever failed');
create temp table f_c as select count(*) n from public.ingest_claim(8, interval '5 minutes');
select pg_temp.ok((select n from f_c) = 0 and (select state = 'stopped' and stop_reason = 'failure_rate' from public.ingest_batches where id = (select b from f)),
  'f: the claim stops the batch for failure_rate and hands out nothing');
-- The same job failing a second time is one job, two failures seen.
select pg_temp.svc(format('select public.ingest_batch_resume(%L, %L)', b,
  '{"decision_id":"d","approver":"x","evidence_sha256":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"}')) from f;
select pg_temp.fail(pg_temp.j(b, 3)) from f;
select pg_temp.ok((select failures_seen from public.ingest_jobs where id = pg_temp.j((select b from f), 3)) = 2
  and (select (r#>>'{jobs,ever_failed}')::int from (select pg_temp.st((select b from f)) r) x) = 2,
  'f: a job that fails twice has failures_seen 2 and counts once in ever_failed');
-- A succeeded job that failed once is one job in numerator and denominator (ratio never above 1).
select pg_temp.done(pg_temp.j(b, 3)) from f;
select pg_temp.ok((select failures_seen from public.ingest_jobs where id = pg_temp.j((select b from f), 3)) = 2
  and (select (r#>>'{jobs,ever_failed}')::int from (select pg_temp.st((select b from f)) r) x) = 2, 'f: succeeding later does not erase the failures');

-- Jobs outside a batch are not touched by the trigger.
create temp table g as select pg_temp.batch('national-pq', jsonb_build_array(pg_temp.pq(16), pg_temp.pq(17))) b;
update public.ingest_jobs set batch_id = null where id = (select pg_temp.j(b, 1) from g);
select pg_temp.fail(pg_temp.j(b, 1)), pg_temp.fail(pg_temp.j(b, 2)) from g;
select pg_temp.ok((select failures_seen from public.ingest_jobs where id = pg_temp.j((select b from g), 1)) = 0
  and (select failures_seen from public.ingest_jobs where id = pg_temp.j((select b from g), 2)) = 1,
  'g: a job without a batch is not counted (the trigger leaves other desks'' jobs alone); a batch job is');
-- A job already failed and updated again is not counted twice.
update public.ingest_jobs set last_error = 'again' where id = (select pg_temp.j(b, 2) from g);
update public.ingest_jobs set status = 'failed', error_code = 'embed_failed_again' where id = (select pg_temp.j(b, 2) from g);
select pg_temp.ok((select failures_seen from public.ingest_jobs where id = pg_temp.j((select b from g), 2)) = 1, 'g: an update of an already failed job does not count again');


-- ═══ (e) The F291 path with this migration: a recorded resume acknowledges the failures; a requeue alone does not ═══
-- (ingest_batch_resume_requeue.sql runs on this chain too, so "resume with requeue lets the batch proceed" is asserted with it.)

-- Leftover queued jobs of the earlier cases are set aside so the claims below see only this batch.
update public.ingest_jobs set status = 'cancelled' where status = 'queued';
create temp table r as select pg_temp.batch('national-pq-fragile', jsonb_build_array(pg_temp.pq(18), pg_temp.pq(19), pg_temp.pq(20))) b;
select pg_temp.done(pg_temp.j(b, 1)), pg_temp.fail(pg_temp.j(b, 2)) from r;
create temp table r_c1 as select count(*) n from public.ingest_claim(8, interval '5 minutes');
select pg_temp.ok((select n from r_c1) = 0 and (select stop_reason from public.ingest_batches where id = (select b from r)) = 'failure_rate',
  'r: 1 failed of 2 decided (0.5, over 0.4): the claim stops the batch');
select pg_temp.ok((select failures_acknowledged from public.ingest_jobs where id = pg_temp.j((select b from r), 2)) = 0, 'r: nothing is acknowledged before a resume');
create temp table r_res as select pg_temp.resume(b, '{"requeue_failed":true}') r from r;
select pg_temp.ok((select (r->>'requeued')::int = 1 and r->>'still_blocked' is null from r_res)
  and (select status from public.ingest_jobs where id = pg_temp.j((select b from r), 2)) = 'queued'
  and (select failures_seen = 1 and failures_acknowledged = 1 from public.ingest_jobs where id = pg_temp.j((select b from r), 2))
  and (select detail->'acknowledged_jobs' = jsonb_build_array(pg_temp.j((select b from r), 2)) from public.ingest_batch_events
        where batch_id = (select b from r) and event = 'resumed'),
  'r: resume acknowledges the failure (seen 1, acknowledged 1, listed in the resumed event), requeues the job, and nothing blocks the batch');
create temp table r_c2 as select array_agg(id order by id) ids from public.ingest_claim(8, interval '5 minutes');
select pg_temp.ok((select ids from r_c2) = (select array_agg(x order by x) from unnest(array[pg_temp.j((select b from r), 2), pg_temp.j((select b from r), 3)]) x)
  and (select state from public.ingest_batches where id = (select b from r)) = 'registered',
  'r: the next claim hands out the jobs: the batch proceeds');
-- A job that fails again after the acknowledgement counts again.
select pg_temp.fail(pg_temp.j(b, 2)) from r;
select pg_temp.ok((select failures_seen = 2 and failures_acknowledged = 1 from public.ingest_jobs where id = pg_temp.j((select b from r), 2))
  and public.ingest_batch_block_reason((select b from r)) = 'failure_rate',
  'r: failing again after the acknowledgement counts again (seen 2, acknowledged 1): failure_rate');
create temp table r_q as select pg_temp.i_requeue(b, array[pg_temp.j(b, 2)]) r from r;
select pg_temp.ok((select r#>>'{results,0,reason}' = 'failed_after_requeue' from r_q)
  and (select failures_acknowledged from public.ingest_jobs where id = pg_temp.j((select b from r), 2)) = 1,
  'r: the automatic requeue is refused (one requeue only) and writes no baseline');
update public.ingest_jobs set status = 'succeeded', stage = 'done', claim_token = null, lease_until = null where id = pg_temp.j((select b from r), 3);
create temp table r_c3 as select pg_temp.cl(b, 'fx-r', 'owner accepts the failed document') r from r;
select pg_temp.ok((select r->>'state' = 'closed_with_failures' and jsonb_array_length(r#>'{closure,failed_jobs}') = 1 from r_c3)
  and (select detail->>'stop_reason' = 'failed_after_requeue' from public.ingest_batch_events where batch_id = (select b from r) and event = 'closed'),
  'r: the stopped batch is closed with the failed job named, the failed_after_requeue stop recorded');

-- A requeue alone writes no baseline (batch f of (d)), and the check keeps the baseline at or under what was seen.
select pg_temp.ok((select failures_acknowledged from public.ingest_jobs where id = pg_temp.j((select b from f), 3)) = 1
  and (select failures_acknowledged from public.ingest_jobs where id = pg_temp.j((select b from f), 4)) = 1, 'e: after the resume in (d) the acknowledged jobs equal what was seen then');
select pg_temp.refused(format('update public.ingest_jobs set failures_acknowledged = failures_seen + 1 where id = %L', pg_temp.j((select b from f), 1)),
  'ingest_jobs_failures_acknowledged');

-- The claim's attempts_exhausted sweep marks a job failed: the trigger sees that path.
create temp table x as select pg_temp.batch('national-pq', jsonb_build_array(pg_temp.pq(98), pg_temp.pq(99))) b;
update public.ingest_jobs set attempts = 6, next_attempt_at = now() - interval '1 minute' where id = (select pg_temp.j(b, 1) from x);
create temp table x_c as select count(*) n from public.ingest_claim(8, interval '5 minutes');
select pg_temp.ok((select status = 'failed' and error_code = 'attempts_exhausted' and failures_seen = 1 from public.ingest_jobs where id = pg_temp.j((select b from x), 1)),
  'x: a job failed by the claim''s attempts_exhausted sweep counts one failure seen');

-- The migration's own constraints.
select pg_temp.ok(exists(select 1 from pg_constraint where conname = 'ingest_batches_state_check' and convalidated and pg_get_constraintdef(oid) like '%closed_with_failures%')
  and exists(select 1 from pg_constraint where conname = 'ingest_batch_events_event_check' and convalidated and pg_get_constraintdef(oid) like '%closed%')
  and (select count(*) from pg_constraint where conrelid = 'public.ingest_batches'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%accepted%') = 1,
  'k: the state and event constraints allow the new values, validated, and the old state check is gone');
rollback;
