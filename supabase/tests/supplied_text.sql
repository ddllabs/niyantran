-- Disposable fixture; run.sh uses corpus_records chain + supplied_text_connection migration.
\set ON_ERROR_STOP on
begin;
set search_path = public, extensions;
create function pg_temp.ok(v boolean, label text) returns void language plpgsql as $$begin
 if v is distinct from true then raise exception 'FAIL %', label; end if; raise notice 'PASS %', label; end$$;
create function pg_temp.refused(q text, pattern text) returns void language plpgsql as $$begin
 begin execute q; exception when others then
 if position(pattern in sqlerrm)=0 then raise exception 'wrong refusal: %',sqlerrm; end if; return; end;
 raise exception 'accepted unsafe operation: %',q; end$$;
select pg_temp.ok(not has_function_privilege('authenticated','public.ingest_register_text(jsonb)','execute'), 'registration service only');
select pg_temp.ok(not has_table_privilege('authenticated','public.ingest_text_inputs','select'), 'input private');
create temp table fixture as select jsonb_build_object(
 'source_key','law:hc:test/1','title','Test order','text','A court order.',
 'text_sha256',encode(sha256(convert_to('A court order.','UTF8')),'hex'),
 'desk_tier','law','desk_feature','Order Archive by Topic (Cross-Court)',
 'review',jsonb_build_object('status','eligible'), 'citation',jsonb_build_object('case_number','1'))::text payload;
create temp table request as select jsonb_build_object('payload',payload,
 'payload_sha256',encode(sha256(convert_to(payload,'UTF8')),'hex'),
 'expected',jsonb_build_array(jsonb_build_object('chunk_hash',repeat('a',64),'embed_hash',repeat('b',64),'chunk_index',0,'source_kind','document','char_from',0,'char_to',14,'content','A court order.','token_count',4,'chunker_version',4)),
 'pages',jsonb_build_array(), 'sections',jsonb_build_array()) p from fixture;
create temp table registered as select public.ingest_register_text(p) r from request;
select pg_temp.ok((select public.ingest_register_text(p)->>'job_id' from request)=(select r->>'job_id' from registered), 'exact retry same job');
select pg_temp.ok((select count(*) from public.documents)=1, 'one source');
select pg_temp.refused($q$select public.ingest_register_text(p || '{"payload_sha256":"bad"}'::jsonb) from request$q$, 'hash');
create temp table claim as select * from public.ingest_claim(1,interval '5 minutes');
select pg_temp.ok((select input_kind='supplied_text' and stage='index' and pages_total=0 from claim), 'skip OCR without fake pages');
select pg_temp.refused($q$select public.ingest_text_activate(id,claim_token,0,0) from claim$q$, 'incomplete');
select pg_temp.refused($q$select public.ingest_text_commit(id,gen_random_uuid(),'[]'::jsonb) from claim$q$, 'claim');
select pg_temp.refused($q$select public.ingest_text_commit(id,claim_token,'[{"chunk_hash":"bad"}]'::jsonb) from claim$q$, 'chunk');
select public.ingest_text_commit(id,claim_token,jsonb_build_array(jsonb_build_object(
 'chunk_hash',repeat('a',64),'embed_hash',repeat('b',64),'chunk_index',0,'source_kind','document','char_from',0,'char_to',14,
 'content','A court order.','token_count',4,'chunker_version',4,'embedding',to_jsonb(array_fill(0.01::real,array[1536]))))) from claim;
select public.ingest_text_activate(id,claim_token,0,0) from claim;
select pg_temp.ok((select indexed_at is not null and chunker_version=4 and ocr_text='A court order.' from public.documents), 'activation preserves exact text');
select pg_temp.ok((select stage='done' and ocr_pages=0 and ocr_cost_usd=0 from public.ingest_jobs), 'existing queue completed without OCR');
select pg_temp.refused($q$select public.ingest_text_commit(id,claim_token,'[]'::jsonb) from claim$q$, 'claim');
-- Changed payload, even descriptive metadata, cannot overwrite an existing source.
update fixture set payload=(payload::jsonb || '{"title":"Changed"}'::jsonb)::text;
update request set p=p || (select jsonb_build_object('payload',payload,'payload_sha256',encode(sha256(convert_to(payload,'UTF8')),'hex')) from fixture);
select pg_temp.refused($q$select public.ingest_register_text(p) from request$q$, 'conflict');
select pg_temp.refused($q$update public.documents set ocr_text='overwrite'$q$, 'immutable');
select pg_temp.refused($q$update public.documents set indexed_at=null$q$, 'immutable');
-- A worker that disappeared cannot be automatically sent to a paid step again.
update public.ingest_jobs set status='running',stage='index',claim_token=gen_random_uuid(),lease_until=now()-interval '1 second';
select pg_temp.ok((select count(*) from public.ingest_claim(1,interval '5 minutes'))=0, 'expired supplied-text work held');
select pg_temp.ok((select status='failed' and error_code='text_outcome_uncertain' from public.ingest_jobs),'uncertain work requires reconciliation');
rollback;
