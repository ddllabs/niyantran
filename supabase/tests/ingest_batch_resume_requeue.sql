-- F291: a batch stopped as uncertain_count could not recover; ingest_batch_resume may now requeue its failed jobs.
-- Disposable fixture. run.sh uses the ingest_register_batch chain, then 20261112090000_batch_resume_requeue (as a
-- non-superuser). The helpers are ingest_register_batch.sql's, the few this needs.
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

insert into public.desk_rows(tier,feature,row_key,row,record_text,snapshot_at)
select 'national','Parliamentary Question Database','q' || g,
  jsonb_build_object('id','q' || g,'house','Lok Sabha','date','2026-04-02','ministry','MINISTRY OF FIXTURES','subject','Subject ' || g,
   'mp_name','Member','source_url',pg_temp.pq_url(g)), 'Subject ' || g, now()
from generate_series(1, 14) g;
select pg_temp.policy('national-pq');
select pg_temp.policy('national-pq-certain', jsonb_build_object('stop_thresholds',jsonb_build_object('refusal_share',1,'failure_rate',1,'uncertain_max',0,'min_decided',1)));
select pg_temp.policy('national-pq-fragile', jsonb_build_object('stop_thresholds',jsonb_build_object('refusal_share',1,'failure_rate',0.4,'uncertain_max',1,'min_decided',2)));
update public.ingest_settings set max_running = 8, claim_batch = 8;
-- A claim's or a requeue's writes are not seen by the rest of the statement that made them, so each result is saved
-- to a table first and looked at in the next statement.

-- ═══ (a) Three uncertain jobs against uncertain_max 1: requeue stops the batch ═══

create temp table a as select pg_temp.batch('national-pq', jsonb_build_array(pg_temp.pq(1), pg_temp.pq(2), pg_temp.pq(3))) b;
create temp table a_jobs as select id from public.ingest_jobs where batch_id = (select b from a);
-- Another batch whose job failed ordinarily and was never requeued: resuming A must not touch it.
create temp table o as select pg_temp.batch('national-pq', jsonb_build_array(pg_temp.pq(4))) b;
update public.ingest_jobs set status = 'failed', error_code = 'embed_failed', finished_at = now() where batch_id = (select b from o);
create temp table a_c1 as select count(*) n from public.ingest_claim(8, interval '5 minutes');
select pg_temp.ok((select n from a_c1) = 3, 'a: the batch''s three jobs are claimed');
update public.ingest_jobs set lease_until = now() - interval '1 second' where batch_id = (select b from a);
create temp table a_c2 as select count(*) n from public.ingest_claim(8, interval '5 minutes');
select pg_temp.ok((select n from a_c2) = 0
  and (select bool_and(status = 'failed' and error_code = 'text_outcome_uncertain') from public.ingest_jobs where id in (select id from a_jobs))
  and (select state from public.ingest_batches where id = (select b from a)) = 'registered',
  'a: the expired claims are held as text_outcome_uncertain; the claim does not stop the batch');
create temp table a_q1 as select pg_temp.i_requeue(b, (select array_agg(id) from a_jobs)) r from a;
select pg_temp.ok((select r#>>'{results,0,reason}' from a_q1) = 'uncertain_count'
  and (select state = 'stopped' and stop_reason = 'uncertain_count' and stopped_from = 'registered' from public.ingest_batches where id = (select b from a))
  and (select bool_and(status = 'failed') from public.ingest_jobs where id in (select id from a_jobs)),
  'a: requeue is refused as uncertain_count and the batch is stopped');

-- ═══ (b) Resume without the flag: as before, and requeue is refused again ═══

create temp table a_res1 as select pg_temp.resume(b) r from a;
select pg_temp.ok((select array_agg(k order by k) from a_res1, jsonb_object_keys(r) k) = array['batch_id','est_cost_usd','state']
  and (select r->>'state' from a_res1) = 'registered'
  and (select state from public.ingest_batches where id = (select b from a)) = 'registered', 'b: resume without the flag returns what it did');
create temp table a_q2 as select pg_temp.i_requeue(b, (select array_agg(id) from a_jobs)) r from a;
select pg_temp.ok((select r#>>'{results,0,reason}' from a_q2) = 'uncertain_count'
  and (select state = 'stopped' and stop_reason = 'uncertain_count' from public.ingest_batches where id = (select b from a)),
  'b: and requeue stops it again (the defect, unchanged without the flag)');
create temp table a_q2f as select pg_temp.resume(b, '{"requeue_failed":false}') r from a;
select pg_temp.ok((select array_agg(k order by k) from a_q2f, jsonb_object_keys(r) k) = array['batch_id','est_cost_usd','state']
  and (select bool_and(status = 'failed') from public.ingest_jobs where id in (select id from a_jobs))
  and (select count(*) from public.ingest_batch_events where batch_id = (select b from a) and event = 'requeued') = 0,
  'b: requeue_failed false is the same as no flag');
select pg_temp.ok(not exists(select 1 from public.ingest_batch_events where batch_id = (select b from a) and event = 'resumed' and detail ? 'requeue_failed')
  and (select count(*) from public.ingest_batch_events where batch_id = (select b from a) and event = 'resumed') = 2,
  'b: a resume without the flag writes its event as before');
create temp table a_q3 as select pg_temp.i_requeue(b, (select array_agg(id) from a_jobs)) r from a;

-- ═══ (c) Resume with requeue_failed: every never-requeued failed job is queued ═══

create temp table o_snap as select pg_temp.ledger(b) h from o;
create temp table a_res2 as select pg_temp.resume(b, '{"requeue_failed":true}') r from a;
select pg_temp.ok((select (r->>'requeued')::int = 3 and (r->>'left_failed')::int = 0 and r->'blocking_jobs' = '[]'::jsonb
   and (r->>'running')::int = 0 and r ? 'still_blocked' and r->>'still_blocked' is null and r->>'state' = 'registered' from a_res2),
  'c: requeued 3, left_failed 0, blocking_jobs [], running 0, still_blocked null');
select pg_temp.ok((select bool_and(status = 'queued' and attempts = 0 and error_code is null) from public.ingest_jobs where id in (select id from a_jobs))
  and (select bool_and(requeues = 1) from public.ingest_batch_items where batch_id = (select b from a)), 'c: the jobs are queued and each item''s requeues is 1');
select pg_temp.ok((select array_agg((detail->>'job_id')::uuid order by id) from public.ingest_batch_events
    where batch_id = (select b from a) and event = 'requeued' and detail->>'via' = 'resume' and detail->>'decision_id' = 'fixture-resume'
      and detail->>'error_code' = 'text_outcome_uncertain')
  = (select array_agg(id order by id) from a_jobs), 'c: three requeued events, in job-id order, with the decision id and via');
select pg_temp.ok((select detail->'requeue_failed' = 'true'::jsonb and detail->>'decision_id' = 'fixture-resume' from public.ingest_batch_events
    where batch_id = (select b from a) and event = 'resumed' order by id desc limit 1), 'c: the flagged resumed event carries requeue_failed true');
select pg_temp.ok((select string_agg(event, ',' order by id) from public.ingest_batch_events where batch_id = (select b from a))
  = 'stopped,resumed,stopped,resumed,stopped,resumed,requeued,requeued,requeued', 'c: the ledger records every step');
select pg_temp.ok((select h from o_snap) = (select pg_temp.ledger(b) from o)
  and (select status = 'failed' from public.ingest_jobs where batch_id = (select b from o)),
  'c: another batch''s failed job, items and events are untouched');

-- ═══ (d) The next claim hands the jobs out and the batch is not stopped ═══

create temp table a_c3 as select * from public.ingest_claim(8, interval '5 minutes');
select pg_temp.ok((select array_agg(id order by id) from a_c3) = (select array_agg(id order by id) from a_jobs)
  and (select state from public.ingest_batches where id = (select b from a)) = 'registered', 'd: a claim hands out the batch''s jobs, the batch runs');

-- ═══ (f) A flag that is not a JSON boolean is refused and changes nothing ═══

create temp table a_snap as select pg_temp.ledger(b) h from a;
select pg_temp.refused(format('select pg_temp.resume(%L, %L::jsonb)', b, '{"requeue_failed":"true"}'), 'requeue_failed must be true or false') from a;
select pg_temp.refused(format('select pg_temp.resume(%L, %L::jsonb)', b, '{"requeue_failed":1}'), 'requeue_failed must be true or false') from a;
select pg_temp.refused(format('select pg_temp.resume(%L, %L::jsonb)', b, '{"requeue_failed":null}'), 'requeue_failed must be true or false') from a;
select pg_temp.ok((select h from a_snap) = (select pg_temp.ledger(b) from a), 'f: a non-boolean flag is refused, nothing changed');
-- Resuming a batch that is not stopped raises as before, with or without the flag.
select pg_temp.refused(format('select pg_temp.resume(%L)', b), 'is registered, not stopped') from a;
select pg_temp.refused(format('select pg_temp.resume(%L, %L::jsonb)', b, '{"requeue_failed":true}'), 'is registered, not stopped') from a;
update public.ingest_jobs set status = 'cancelled', claim_token = null, lease_until = null where status in ('queued','running');

-- ═══ (e, g) Left: a job requeued once, a job with no item; moved: an ordinary failure; untouched: a running job ═══

-- uncertain_max 0. Jobs in id order x, y, z, w, all claimed. x was requeued once and is uncertain again; y failed
-- ordinarily, never requeued; z is still running; w failed and has no item row (no function writes a batch job without
-- an item: it is built here, directly, as the defensive case).
create temp table e as select pg_temp.batch('national-pq-certain', jsonb_build_array(pg_temp.pq(5), pg_temp.pq(6), pg_temp.pq(7), pg_temp.pq(8))) b;
create temp table e_jobs as select a[1] x, a[2] y, a[3] z, a[4] w
  from (select array_agg(id order by id) a from public.ingest_jobs where batch_id = (select b from e)) j;
create temp table e_c1 as select count(*) n from public.ingest_claim(8, interval '5 minutes');
select pg_temp.ok((select n from e_c1) = 4, 'e: the batch''s four jobs are claimed');
update public.ingest_batch_items set requeues = 1 where job_id = (select x from e_jobs);
delete from public.ingest_batch_items where job_id = (select w from e_jobs);
update public.ingest_jobs set status = 'failed', claim_token = null, lease_until = null, finished_at = now(),
  error_code = case when id = (select x from e_jobs) then 'text_outcome_uncertain' else 'embed_failed' end
 where id in (select x from e_jobs union all select y from e_jobs union all select w from e_jobs);
create temp table z_before as select to_jsonb(j) h from public.ingest_jobs j where id = (select z from e_jobs);
create temp table e_q as select pg_temp.i_requeue(b, array[(select y from e_jobs)]) r from e;
select pg_temp.ok((select r#>>'{results,0,reason}' from e_q) = 'uncertain_count'
  and (select state from public.ingest_batches where id = (select b from e)) = 'stopped', 'e: requeue of the ordinary failure is refused, the batch stops');
create temp table e_res as select pg_temp.resume(b, '{"requeue_failed":true}') r from e;
select pg_temp.ok((select (r->>'requeued')::int = 1 and (r->>'left_failed')::int = 2 and (r->>'running')::int = 1
   and r->'blocking_jobs' = (select jsonb_build_array(x, w) from e_jobs) and r->>'still_blocked' = 'uncertain_count'
   and r->>'state' = 'registered' from e_res)
  and (select state from public.ingest_batches where id = (select b from e)) = 'registered',
  'e: resumed although still blocked; requeued 1, left_failed 2, blocking_jobs [x, w], running 1');
select pg_temp.ok((select status = 'failed' and error_code = 'text_outcome_uncertain' from public.ingest_jobs where id = (select x from e_jobs))
  and (select requeues from public.ingest_batch_items where job_id = (select x from e_jobs)) = 1, 'e: the job already requeued once is left as it was');
select pg_temp.ok((select status = 'failed' and error_code = 'embed_failed' from public.ingest_jobs where id = (select w from e_jobs))
  and not exists(select 1 from public.ingest_batch_events where batch_id = (select b from e) and event = 'requeued' and (detail->>'job_id')::uuid = (select w from e_jobs)),
  'e: the failed job with no item is left and listed as blocking');
select pg_temp.ok((select h from z_before) = (select to_jsonb(j) from public.ingest_jobs j where id = (select z from e_jobs))
  and not exists(select 1 from public.ingest_batch_events where batch_id = (select b from e) and event = 'requeued' and (detail->>'job_id')::uuid = (select z from e_jobs)),
  'e: the running job is left alone, counted only in running');
select pg_temp.ok((select status = 'queued' from public.ingest_jobs where id = (select y from e_jobs))
  and (select requeues from public.ingest_batch_items where job_id = (select y from e_jobs)) = 1
  and (select count(*) from public.ingest_batch_events where batch_id = (select b from e) and event = 'requeued'
        and (detail->>'job_id')::uuid = (select y from e_jobs) and detail->>'error_code' = 'embed_failed' and detail->>'via' = 'resume') = 1,
  'g: an ordinary failed job with no requeue is requeued too');
create temp table e_c as select count(*) n from public.ingest_claim(8, interval '5 minutes');
select pg_temp.ok((select n from e_c) = 0
  and (select state = 'stopped' and stop_reason = 'uncertain_count' from public.ingest_batches where id = (select b from e)),
  'e: still blocked, the next claim stops it with the reason resume reported');
update public.ingest_jobs set status = 'cancelled', claim_token = null, lease_until = null where status in ('queued','running');

-- ═══ failure_rate: resume requeues the failures and the batch is no longer blocked ═══

-- failure_rate 0.4, min_decided 2: one succeeded and one failed of two decided, one queued. The worker's own reports
-- leave exactly these states (as ingest_register_batch.sql sets them).
create temp table f as select pg_temp.batch('national-pq-fragile', jsonb_build_array(pg_temp.pq(9), pg_temp.pq(10), pg_temp.pq(11))) b;
create temp table f_jobs as select a[1] f1, a[2] f2, a[3] f3
  from (select array_agg(id order by id) a from public.ingest_jobs where batch_id = (select b from f)) j;
update public.ingest_jobs set status = 'succeeded', stage = 'done', finished_at = now() where id = (select f1 from f_jobs);
update public.ingest_jobs set status = 'failed', error_code = 'embed_failed', finished_at = now() where id = (select f2 from f_jobs);
create temp table f_c as select count(*) n from public.ingest_claim(8, interval '5 minutes');
select pg_temp.ok((select n from f_c) = 0 and (select stop_reason from public.ingest_batches where id = (select b from f)) = 'failure_rate',
  'failure_rate: the claim stops the batch');
create temp table f_res as select pg_temp.resume(b, '{"requeue_failed":true}') r from f;
select pg_temp.ok((select (r->>'requeued')::int = 1 and (r->>'left_failed')::int = 0 and r ? 'still_blocked' and r->>'still_blocked' is null from f_res)
  and (select status from public.ingest_jobs where id = (select f2 from f_jobs)) = 'queued', 'failure_rate: requeued 1, still_blocked null');
update public.ingest_jobs set status = 'cancelled', claim_token = null, lease_until = null where status in ('queued','running');

-- ═══ spend_ceiling: still blocked unless est_cost_usd is raised in the same call ═══

-- The batch's reservation is 1; one job reported 1 spent, one failed, one queued.
create temp table s as select pg_temp.batch('national-pq', jsonb_build_array(pg_temp.pq(12), pg_temp.pq(13), pg_temp.pq(14))) b;
create temp table s_jobs as select a[1] s1, a[2] s2, a[3] s3
  from (select array_agg(id order by id) a from public.ingest_jobs where batch_id = (select b from s)) j;
update public.ingest_jobs set status = 'succeeded', stage = 'done', embed_cost_usd = 1, finished_at = now() where id = (select s1 from s_jobs);
update public.ingest_jobs set status = 'failed', error_code = 'embed_failed', finished_at = now() where id = (select s2 from s_jobs);
create temp table s_c1 as select count(*) n from public.ingest_claim(8, interval '5 minutes');
select pg_temp.ok((select n from s_c1) = 0 and (select stop_reason from public.ingest_batches where id = (select b from s)) = 'spend_ceiling',
  'spend_ceiling: the claim stops the batch');
create temp table s_res1 as select pg_temp.resume(b, '{"requeue_failed":true}') r from s;
select pg_temp.ok((select (r->>'requeued')::int = 1 and r->>'still_blocked' = 'spend_ceiling' and r->>'state' = 'registered' from s_res1),
  'spend_ceiling: without a raise it resumes, requeues 1, and reports still_blocked spend_ceiling');
create temp table s_c2 as select count(*) n from public.ingest_claim(8, interval '5 minutes');
select pg_temp.ok((select n from s_c2) = 0 and (select stop_reason from public.ingest_batches where id = (select b from s)) = 'spend_ceiling',
  'spend_ceiling: and the next claim stops it again');
create temp table s_res2 as select pg_temp.resume(b, '{"requeue_failed":true,"est_cost_usd":5}') r from s;
select pg_temp.ok((select (r->>'requeued')::int = 0 and r ? 'still_blocked' and r->>'still_blocked' is null and (r->>'est_cost_usd')::numeric = 5 from s_res2),
  'spend_ceiling: with est_cost_usd raised in the same call, still_blocked is null');
create temp table s_c3 as select array_agg(id order by id) ids from public.ingest_claim(8, interval '5 minutes');
select pg_temp.ok((select ids from s_c3) = (select array[s2, s3] from s_jobs) and (select state from public.ingest_batches where id = (select b from s)) = 'registered',
  'spend_ceiling: then the claim hands out its jobs');

-- ═══ (h) Who may resume: unchanged ══════════════════════════════════════════

select pg_temp.ok((select count(*) from pg_proc where proname = 'ingest_batch_resume' and pronamespace = 'public'::regnamespace) = 1
  and (select prosecdef and proconfig = array['search_path=public, extensions, pg_temp'] from pg_proc
        where oid = 'public.ingest_batch_resume(uuid,jsonb)'::regprocedure), 'h: one ingest_batch_resume, security definer, search_path ends with pg_temp');
select pg_temp.ok(has_function_privilege('service_role', 'public.ingest_batch_resume(uuid,jsonb)', 'execute')
  and not exists(select 1 from unnest(array['public','anon','authenticated','corpus_ingest']) r
                  where has_function_privilege(r, 'public.ingest_batch_resume(uuid,jsonb)', 'execute')),
  'h: service_role resumes; PUBLIC, anon, authenticated and corpus_ingest may not');
select b as e_batch from e \gset
set local role corpus_ingest;
select pg_temp.refused(format('select public.ingest_batch_resume(%L, %L)', :'e_batch', '{"requeue_failed":true}'), 'permission denied for function ingest_batch_resume');
reset role;
set local role authenticated;
select pg_temp.refused(format('select public.ingest_batch_resume(%L, %L)', :'e_batch', '{"requeue_failed":true}'), 'permission denied for function ingest_batch_resume');
reset role;
rollback;
