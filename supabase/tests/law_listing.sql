-- Disposable Law publication contract. No production corpus.
\set ON_ERROR_STOP on
begin;
set search_path=public,extensions;
create function pg_temp.ok(v boolean,label text) returns void language plpgsql as $$begin
 if v is distinct from true then raise exception 'FAIL %',label; end if; raise notice 'PASS %',label; end$$;
create function pg_temp.refused(q text,pattern text) returns void language plpgsql as $$begin
 begin execute q; exception when others then
 if position(pattern in sqlerrm)=0 then raise exception 'wrong refusal: %',sqlerrm; end if; return; end;
 raise exception 'accepted unsafe operation: %',q; end$$;
select pg_temp.ok((public.law_listing_page('{}')->>'active')::boolean=false,'inactive before explicit seed');

select pg_temp.ok(not has_function_privilege('authenticated','public.law_publish(jsonb)','execute'),'publication service only');
select pg_temp.ok(not has_table_privilege('anon','public.law_document_links','select'),'anon cannot read attachments');
select pg_temp.ok(not has_table_privilege('authenticated','public.law_publications','select'),'decision records private');
insert into public.desk_rows(tier,feature,row_key,row,record_text,snapshot_at) values
('law','NCLT / NCLAT (Insolvency)','legacy-order','{"title":"Existing Company","court":"NCLT","date":"2026-07-08","source_url":"https://ibbi.gov.in/uploads/order/one.pdf"}','Existing Company',now()),
('law','NCLT / NCLAT (Insolvency)','legacy-announcement','{"title":"Future Company","court":"IBBI","date":"2026-07-11","source_url":"https://ibbi.gov.in/uploads/announcement/two.pdf"}','Future Company',now());
select public.law_seed_listings();
select pg_temp.ok((public.law_listing_page('{}')->>'active')::boolean=false,'seed does not activate serving');
select pg_temp.ok((select bool_and(document_key like 'law-record:%') from public.desk_rows),'seed keys shared with global search');
select public.law_activate_listings();
select pg_temp.ok((public.law_listing_page('{}')->>'total')::int=2,'baseline seeded');
select pg_temp.ok((public.law_listing_page('{"pageSize":200}')->>'total')::int=2,'standard 200 row page accepted');
select pg_temp.ok((public.law_listing_page('{"key":"legacy-order"}')->'rows'->0->>'id')='legacy-order','legacy row key preserved');
insert into auth.users(id,email) values('11111111-1111-4111-8111-111111111111','fixture@example.invalid') on conflict do nothing;
create function pg_temp.request(k text,u text,dt text default '2026-07-08') returns jsonb language sql as $$
 with r as(select jsonb_build_object('source_key',k,'title','Future Company','text','A court order.',
 'text_sha256',encode(sha256(convert_to('A court order.','UTF8')),'hex'),'file_url',u,
 'desk_tier','law','desk_feature','NCLT / NCLAT (Insolvency)',
 'citation',jsonb_build_object('kind','tribunal_order','forum','NCLT','source','IBBI_NCLT','case_number','CP/1/2026','order_date',dt),
 'review',jsonb_build_object('status','eligible','source_key',k,'text_sha256',encode(sha256(convert_to('A court order.','UTF8')),'hex'),
 'rules_sha256',repeat('c',64),'package_id','fixture-pack','mapping_version','1','decision_id','fixture-approved',
 'checks','{"identity":true,"completeness":true,"sensitivity":true,"dedupe":true,"rights":true}'::jsonb))::text payload)
 select jsonb_build_object('actor','11111111-1111-4111-8111-111111111111','payload',payload,'payload_sha256',encode(sha256(convert_to(payload,'UTF8')),'hex'),
 'expected',jsonb_build_array(jsonb_build_object('chunk_hash',repeat('a',64),'embed_hash',repeat('b',64),'chunk_index',0,'source_kind','document','char_from',0,'char_to',14,'content','A court order.','token_count',4,'chunker_version',4)),
 'pages',jsonb_build_array(),'sections',jsonb_build_array()) from r
$$;
-- A previously indexed document without a publication remains readable until explicit cutover.
savepoint previous_indexed;
update public.law_listing_settings set active=false;
insert into public.documents(source_key,title,file_url,desk_tier,desk_feature,content_sha256,ocr_text,indexed_at,metadata)
 values('law:trib:IBBI_NCLT:previous','Previous','https://ibbi.gov.in/uploads/order/previous.pdf','law','NCLT / NCLAT (Insolvency)',repeat('a',64),'Previous',now(),'{"origin":"supplied-text"}');
select public.law_seed_listings();
select pg_temp.ok((public.law_listing_page('{}')->>'active')::boolean=false,'repeated seed never activates');
select pg_temp.refused('select public.law_activate_listings()','indexed orphan');
set local role authenticated;
select pg_temp.ok((select count(*) from public.documents)=1,'existing indexed corpus remains readable before cutover');
reset role;
rollback to previous_indexed;
select pg_temp.refused($q$select public.ingest_register_text(pg_temp.request('law:hc:unsupported','https://ibbi.gov.in/uploads/order/unsupported.pdf'))$q$,'admission held');
savepoint legacy_retry;
select public.ingest_register_text_unmapped(pg_temp.request('law:hc:legacy','https://ibbi.gov.in/uploads/order/legacy.pdf'));
select pg_temp.ok(public.ingest_register_text(pg_temp.request('law:hc:legacy','https://ibbi.gov.in/uploads/order/legacy.pdf'))->>'existing'='true','preexisting unsupported exact retries preserved');
rollback to legacy_retry;
select pg_temp.ok(not has_function_privilege('service_role','public.ingest_register_text_unmapped(jsonb)','execute'),'legacy implementation not directly callable by service');
create temp table inputs as select pg_temp.request('law:trib:IBBI_NCLT:one','https://ibbi.gov.in/uploads/order/one.pdf') p;
select pg_temp.ok(public.law_reconcile(jsonb_build_object('record',(p->>'payload')::jsonb))->>'action'='link-existing','pre-admission matches exact order') from inputs;
select pg_temp.ok(public.law_reconcile(jsonb_build_object('record',((p->>'payload')::jsonb)||'{"file_url":"https://evil.test/one.pdf"}'::jsonb))->>'status'='held','unofficial URL held') from inputs;
select pg_temp.ok(public.law_reconcile(jsonb_build_object('record',jsonb_set((p->>'payload')::jsonb,'{citation,order_date}','"2026-07-09"')))->>'status'='held','date conflict held') from inputs;
select pg_temp.ok(public.law_reconcile(jsonb_build_object('record',jsonb_set((p->>'payload')::jsonb,'{review,checks,rights}','false')))->>'status'='held','policy held') from inputs;
select pg_temp.refused($q$select public.ingest_register_text(p||jsonb_build_object('mapping_fingerprint',repeat('0',64))) from inputs$q$,'stale mapping');
create temp table registered as select public.ingest_register_text(p||jsonb_build_object('mapping_fingerprint',public.law_reconcile(jsonb_build_object('record',(p->>'payload')::jsonb))->>'fingerprint')) r from inputs;
select pg_temp.ok((select count(*) from public.law_publications where status='pending')=1,'intent atomic with admission');
select pg_temp.ok(public.law_reconcile(jsonb_build_object('record',(pg_temp.request('law:trib:IBBI_NCLT:alias','https://ibbi.gov.in/uploads/order/one.pdf')->>'payload')::jsonb))->>'status'='held','same URL alias held before paid work');
select pg_temp.refused($q$select public.ingest_register_text(pg_temp.request('law:trib:IBBI_NCLT:wrongdate','https://ibbi.gov.in/uploads/order/one.pdf','2026-07-09'))$q$,'admission held');

create temp table claim as select * from public.ingest_claim(1,interval '5 minutes');
select public.ingest_text_commit(id,claim_token,jsonb_build_array(jsonb_build_object('chunk_hash',repeat('a',64),'embed_hash',repeat('b',64),'chunk_index',0,'source_kind','document','char_from',0,'char_to',14,'content','A court order.','token_count',4,'chunker_version',4,'embedding',to_jsonb(array_fill(0.01::real,array[1536]))))) from claim;
select public.ingest_text_activate(id,claim_token,0,0) from claim;
select pg_temp.ok((select status from public.law_publications)='published','index activation automatically publishes');
select pg_temp.ok((select count(*) from public.law_records)=2,'existing listing no duplicate');
select pg_temp.ok((select actor='11111111-1111-4111-8111-111111111111'::uuid from public.law_publications),'authenticated registration actor retained through auto publication');
select pg_temp.ok((select row->>'case_number'='CP/1/2026' from public.desk_rows where row_key='legacy-order'),'verified case number searchable on existing listing');
select pg_temp.ok((select document_key like 'law-record:%' from public.desk_rows where row_key='legacy-order'),'search projection linked');
select pg_temp.ok(public.law_reconcile(jsonb_build_object('record',(p->>'payload')::jsonb))->>'status'='published','exact rerun published') from inputs;
select pg_temp.ok(public.ingest_register_text(p)->>'existing'='true','exact ingestion retry unchanged') from inputs;
select pg_temp.ok((select count(*) from public.document_chunks)=1,'exact retry no chunks changed');
-- Other desks retain their normal refresh behavior.
insert into public.desk_rows(tier,feature,row_key,row,record_text,snapshot_at) values('national','fixture','other-desk','{}','Other',now());
delete from public.desk_rows where row_key='other-desk';
select pg_temp.ok(not exists(select 1 from public.desk_rows where row_key='other-desk'),'other desks can refresh normally');
-- Source refresh cannot delete or overwrite managed rows.
delete from public.desk_rows where row_key='legacy-order';
update public.desk_rows set row='{"title":"bad refresh"}' where row_key='legacy-order';
update public.desk_rows set document_key=null,record_text='overwrite' where row_key='legacy-order';
select pg_temp.ok((select document_key like 'law-record:%' and record_text=row::text from public.desk_rows where row_key='legacy-order'),'refresh cannot erase key or search text');
select pg_temp.ok((select row->>'title'='Existing Company' from public.desk_rows where row_key='legacy-order'),'refresh preserves projection');
-- Same company announcement is not the order. A new order gets a distinct listing.
truncate inputs,registered,claim;
insert into inputs select pg_temp.request('law:trib:IBBI_NCLT:two','https://ibbi.gov.in/uploads/order/two.pdf');
select pg_temp.ok(public.law_reconcile(jsonb_build_object('record',(p->>'payload')::jsonb))->>'action'='create-listing','announcement not matched by company') from inputs;
insert into registered select public.ingest_register_text(p||jsonb_build_object('mapping_fingerprint',public.law_reconcile(jsonb_build_object('record',(p->>'payload')::jsonb))->>'fingerprint')) from inputs;
-- Force a projection failure AFTER indexing. Durable pending state must survive.
create function pg_temp.fail_projection() returns trigger language plpgsql as $$begin raise exception 'fixture projection unavailable'; end$$;
create trigger fixture_failure before insert on public.desk_rows for each row execute function pg_temp.fail_projection();
insert into claim select * from public.ingest_claim(1,interval '5 minutes');
select public.ingest_text_commit(id,claim_token,jsonb_build_array(jsonb_build_object('chunk_hash',repeat('a',64),'embed_hash',repeat('b',64),'chunk_index',0,'source_kind','document','char_from',0,'char_to',14,'content','A court order.','token_count',4,'chunker_version',4,'embedding',to_jsonb(array_fill(0.01::real,array[1536]))))) from claim;
select public.ingest_text_activate(id,claim_token,0,0) from claim;
select pg_temp.ok((select status='pending' and last_error like '%projection unavailable%' from public.law_publications where document_id=(select (r->>'document_id')::uuid from registered)),'publication error remains pending');
select pg_temp.refused('select public.law_activate_listings()','indexed orphan');
select pg_temp.ok((select status='succeeded' from public.ingest_jobs where id=(select (r->>'job_id')::uuid from registered)),'publication error never fails indexing');
drop trigger fixture_failure on public.desk_rows;
create temp table frozen as select md5(string_agg(to_jsonb(c)::text,'' order by id)) h from public.document_chunks c;
create temp table proposal as select public.law_reconcile(jsonb_build_object('document_id',r->>'document_id','text_sha256',encode(sha256(convert_to('A court order.','UTF8')),'hex'))) p from registered;
select pg_temp.refused($q$select public.law_publish(p||jsonb_build_object('text_sha256',encode(sha256(convert_to('A court order.','UTF8')),'hex'),'expected_fingerprint',repeat('0',64),'decision_id','approved','approver','Fixture','evidence_sha256',repeat('c',64))) from proposal$q$,'stale mapping');
select public.law_publish(p||jsonb_build_object('text_sha256',encode(sha256(convert_to('A court order.','UTF8')),'hex'),'expected_fingerprint',p->>'fingerprint','decision_id','approved','approver','Fixture','evidence_sha256',repeat('c',64))) from proposal;
select pg_temp.ok((select count(*) from public.law_records)=3,'new order distinct listing');
select pg_temp.ok((select h from frozen)=(select md5(string_agg(to_jsonb(c)::text,'' order by id)) from public.document_chunks c),'metadata retry leaves chunks and vectors byte-identical');
select pg_temp.ok((public.law_listing_page('{"q":"Future","filter":[{"col":"record_type","value":"tribunal_order"}]}')->>'total')::int=1,'filter and query exact counts');
select pg_temp.ok((public.law_listing_page('{"filter":[{"col":"record_type","value":"tribunal_order"},{"col":"record_type","value":"announcement"}]}')->>'total')::int=3,'same-column filters OR');
select pg_temp.refused($q$select public.law_listing_page('{"filter":[{"col":"title","value":"x"}]}')$q$,'unsupported');
select pg_temp.refused($q$select * from public.law_resolve_document_keys(array_fill('x'::text,array[13]))$q$,'twelve');
set local role authenticated;
select pg_temp.ok((select count(*) from public.law_resolve_document_keys(array(select 'law-record:'||id from public.law_records)))=2,'caller resolves indexed attachments');
reset role;
update public.law_records set visible=false where row_key='legacy-order';
set local role authenticated;
select pg_temp.ok((select count(*) from public.documents)=1,'hidden record denied from documents');
select pg_temp.ok((select count(*) from public.document_chunks)=1,'hidden record denied from chunks');
select pg_temp.ok((select count(*) from public.desk_rows)=2,'hidden record denied from global search projection');
reset role;
set local role anon;
select pg_temp.ok((public.law_listing_page('{}')->>'total')::int=2,'public page obeys visibility');
reset role;
rollback;
