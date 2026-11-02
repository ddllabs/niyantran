-- C3b characterization of the single-document path. ingest_register_text and
-- ingest_register_text_unmapped became one-document wrappers over the batch admission core
-- (20261102130000); every message and result shape below is the one they had before, compared
-- whole, not by substring. Only the last section is new behaviour (design 11, Q3): the
-- duplicate-text refusal. Run on the chain without 20261102130000, everything before that section
-- passes; that is the parity evidence, and the section is why the vacuity check fails.
-- Disposable fixture; run.sh uses the pq_admission_links chain, the corpus_ingest bootstrap and
-- 20261102130000 (as a non-superuser).
\set ON_ERROR_STOP on
begin;
set search_path = public, extensions;
create function pg_temp.ok(v boolean, label text) returns void language plpgsql as $$begin
 if v is distinct from true then raise exception 'FAIL %', label; end if; raise notice 'PASS %', label; end$$;
-- The whole error message of a statement, or 'ok'.
create function pg_temp.msg(q text) returns text language plpgsql as $$begin
 begin execute q; exception when others then return sqlerrm; end; return 'ok'; end$$;
create function pg_temp.is(q text, want text, label text) returns void language plpgsql as $$declare got text := pg_temp.msg(q); begin
 if got is distinct from want then raise exception 'FAIL % - got: %', label, got; end if; raise notice 'PASS %', label; end$$;

insert into auth.users(id,email) values('11111111-1111-4111-8111-111111111111','parity@example.invalid') on conflict do nothing;
insert into public.desk_rows(tier,feature,row_key,row,record_text,snapshot_at) values
 ('national','Parliamentary Question Database','7820',jsonb_build_object('id','7820','house','Lok Sabha','date','2026-04-02','ministry','MICRO, SMALL AND MEDIUM ENTERPRISES','subject','Expanding Khadi Production in Tamil Nadu','source_url','https://sansad.in/getFile/loksabhaquestions/annex/187/AU6302_KIQmzb.pdf?source=pqals'),'Khadi',now()),
 ('national','Parliamentary Question Database','7821',jsonb_build_object('id','7821','house','Lok Sabha','date','2026-04-02','ministry','MICRO, SMALL AND MEDIUM ENTERPRISES','subject','Expanding Khadi Production in Tamil Nadu','source_url','https://sansad.in/getFile/loksabhaquestions/annex/187/AU6302_KIQmzb.pdf?source=pqals'),'Khadi',now()),
 ('law','NCLT / NCLAT (Insolvency)','legacy-order','{"title":"Existing Company","court":"NCLT","date":"2026-07-08","source_url":"https://ibbi.gov.in/uploads/order/one.pdf"}','Existing Company',now());
select public.law_seed_listings();

create function pg_temp.wrap(r jsonb) returns jsonb language sql as $$
 select jsonb_build_object('actor','11111111-1111-4111-8111-111111111111','payload',r::text,'payload_sha256',encode(sha256(convert_to(r::text,'UTF8')),'hex'),
  'expected',jsonb_build_array(jsonb_build_object('chunk_hash',encode(sha256(convert_to('c'||(r->>'text'),'UTF8')),'hex'),'embed_hash',repeat('d',64),
    'chunk_index',0,'source_kind','document','char_from',0,'char_to',length(r->>'text'),'content',r->>'text','token_count',12,'chunker_version',4)),
  'pages','[]'::jsonb,'sections','[]'::jsonb) $$;
create function pg_temp.pq(over jsonb default '{}') returns jsonb language sql as $$
 select pg_temp.wrap(jsonb_build_object('source_key',repeat('a',40),'title','Expanding Khadi Production in Tamil Nadu','text','A written answer.',
  'text_sha256',encode(sha256(convert_to('A written answer.','UTF8')),'hex'),'desk_tier','national','desk_feature','Parliamentary Question Database',
  'file_url','https://sansad.in/getFile/loksabhaquestions/annex/187/AU6302_KIQmzb.pdf?source=pqals','document_key_suggested','pq:ls:187:AU6302_KIQmzb',
  'citation',jsonb_build_object('house','Lok Sabha','subject','Expanding Khadi Production in Tamil Nadu','ministry','MICRO, SMALL AND MEDIUM ENTERPRISES','answered_on','02.04.2026'),
  'review',jsonb_build_object('status','eligible')) || over) $$;
create function pg_temp.law(k text, u text, over jsonb default '{}', t text default null) returns jsonb language sql as $$
 select pg_temp.wrap(jsonb_build_object('source_key',k,'title','Future Company','text',coalesce(t,'A court order for '||k),
  'text_sha256',encode(sha256(convert_to(coalesce(t,'A court order for '||k),'UTF8')),'hex'),'file_url',u,'desk_tier','law','desk_feature','NCLT / NCLAT (Insolvency)',
  'citation',jsonb_build_object('kind','tribunal_order','forum','NCLT','source','IBBI_NCLT','case_number','CP/1/2026','order_date','2026-07-08'),
  'review',jsonb_build_object('status','eligible','source_key',k,'text_sha256',encode(sha256(convert_to(coalesce(t,'A court order for '||k),'UTF8')),'hex'),
   'rules_sha256',repeat('c',64),'package_id','fixture-pack','mapping_version','1','decision_id','fixture-approved',
   'checks','{"identity":true,"completeness":true,"sensitivity":true,"dedupe":true,"rights":true}'::jsonb)) || over) $$;
create function pg_temp.fp(q jsonb) returns text language sql as $$
 select public.law_reconcile(jsonb_build_object('record',(q->>'payload')::jsonb))->>'fingerprint' $$;

-- ═══ Messages, whole ═════════════════════════════════════════════════════════

select pg_temp.is($q$select public.ingest_register_text('[]')$q$, 'supplied text: bad payload', 'not an object');
select pg_temp.is($q$select public.ingest_register_text(jsonb_build_object('payload',to_jsonb(repeat('x',4000001))::text,'payload_sha256','x'))$q$,
  'supplied text: bad payload', 'payload over 4,000,000 octets');
select pg_temp.is($q$select public.ingest_register_text(pg_temp.pq() || '{"payload_sha256":"bad"}')$q$, 'supplied text: payload hash mismatch', 'payload hash');
select pg_temp.is($q$select public.ingest_register_text(jsonb_build_object('payload','{bad','payload_sha256',encode(sha256(convert_to('{bad','UTF8')),'hex')))$q$,
  'invalid input syntax for type json', 'an unparseable payload raises the cast error');
select pg_temp.is($q$select public.ingest_register_text_unmapped(jsonb_build_object('payload','{bad','payload_sha256','x'))$q$,
  'supplied text: payload hash mismatch', 'unmapped: the hash before the cast');
select pg_temp.is($q$select public.ingest_register_text_unmapped(jsonb_build_object('payload','{bad','payload_sha256',encode(sha256(convert_to('{bad','UTF8')),'hex')))$q$,
  'invalid input syntax for type json', 'unmapped: then the cast error');
select pg_temp.is($q$select public.ingest_register_text(pg_temp.pq('{"text_sha256":"0"}'))$q$, 'supplied text: invalid source or text hash', 'text hash');
select pg_temp.is($q$select public.ingest_register_text(pg_temp.pq('{"desk_feature":"Bill Passage Probability Index"}'))$q$, 'supplied text: invalid source or text hash', 'other National feature');
select pg_temp.is($q$select public.ingest_register_text(pg_temp.pq() || '{"expected":[]}')$q$, 'supplied text: bad chunks', 'empty chunk plan');
select pg_temp.is($q$select public.ingest_register_text(pg_temp.pq() || '{"expected":{}}')$q$, 'supplied text: bad chunks', 'chunk plan not an array');
select pg_temp.is($q$select public.ingest_register_text(jsonb_set(pg_temp.pq(), '{expected,0,embed_hash}', '"x"'))$q$, 'supplied text: duplicate or invalid chunks', 'invalid chunk hash');
select pg_temp.is($q$select public.ingest_register_text(pg_temp.pq('{"document_key_suggested":"pq:ls:187:AU9999_other"}'))$q$, 'supplied text: national question held: answer_key_conflict', 'answer key');
select pg_temp.is($q$select public.ingest_register_text(pg_temp.pq('{"citation":{"house":"Rajya Sabha","subject":"Expanding Khadi Production in Tamil Nadu","ministry":"MICRO, SMALL AND MEDIUM ENTERPRISES","answered_on":"02.04.2026"}}'))$q$,
  'supplied text: national question held: house_conflict', 'house');
select pg_temp.is($q$select public.ingest_register_text(pg_temp.pq('{"citation":{"house":"Lok Sabha","subject":"Other","ministry":"MICRO, SMALL AND MEDIUM ENTERPRISES","answered_on":"02.04.2026"}}'))$q$,
  'supplied text: national question held: subject_conflict', 'subject');
select pg_temp.is($q$select public.ingest_register_text(pg_temp.pq('{"citation":{"house":"Lok Sabha","subject":"Expanding Khadi Production in Tamil Nadu","ministry":"MICRO, SMALL AND MEDIUM ENTERPRISES","answered_on":"03.04.2026"}}'))$q$,
  'supplied text: national question held: date_conflict', 'date');
select pg_temp.is($q$select public.ingest_register_text(pg_temp.pq('{"citation":{"house":"Lok Sabha","subject":"Expanding Khadi Production in Tamil Nadu","ministry":"OTHER","answered_on":"02.04.2026"}}'))$q$,
  'supplied text: national question held: ministry_conflict', 'ministry');
select pg_temp.is($q$select public.ingest_register_text(pg_temp.pq('{"file_url":"https://sansad.in/getFile/loksabhaquestions/annex/187/AU1111_noRow.pdf?source=pqals","document_key_suggested":"pq:ls:187:AU1111_noRow"}'))$q$,
  'supplied text: national question has no desk row for its file_url', 'no desk row');
savepoint holders;
insert into public.documents(source_key,title,file_url,desk_tier,desk_feature,content_sha256,ocr_text)
 values(repeat('9',40),'URL variant','https://sansad.in/getFile/loksabhaquestions/annex/187/AU6302_KIQmzb.pdf','national','Parliamentary Question Database',repeat('8',64),'x');
select pg_temp.is($q$select public.ingest_register_text(pg_temp.pq())$q$, 'supplied text: conflict: another document holds this file_url', 'file_url held');
rollback to holders;
insert into public.documents(source_key,title,desk_tier,desk_feature,content_sha256,ocr_text,metadata)
 values(repeat('e',40),'Older pack copy','national','Parliamentary Question Database',repeat('f',64),'x','{"source_path":"x/187_AU6302_KIQmzb.pdf"}');
select pg_temp.is($q$select public.ingest_register_text(pg_temp.pq())$q$, 'supplied text: conflict: another document holds this answer', 'answer held');
rollback to holders;
insert into public.documents(source_key,title,desk_tier,desk_feature,content_sha256,ocr_text)
 values(repeat('a',40),'ingest-documents row','national','Parliamentary Question Database',repeat('7',64),'x');
select pg_temp.is($q$select public.ingest_register_text(pg_temp.pq())$q$, 'supplied text: conflict: existing source is immutable', 'a source without supplied text');
rollback to holders;
-- Law, first: held by law_reconcile even when the payload hash is also wrong (the old order).
create temp table held_reasons as select public.law_reconcile(jsonb_build_object('record',(pg_temp.law('law:hc:unsupported','https://ibbi.gov.in/uploads/order/u.pdf')->>'payload')::jsonb))->'reasons' r;
select pg_temp.is($q$select public.ingest_register_text(pg_temp.law('law:hc:unsupported','https://ibbi.gov.in/uploads/order/u.pdf') || '{"payload_sha256":"bad"}')$q$,
  (select 'law listing: admission held ' || r::text from held_reasons), 'Law held, before the payload hash');
select pg_temp.ok((select r::text from held_reasons) = '["unsupported_or_incomplete_identity"]', 'the held reasons as law_reconcile lists them');
select pg_temp.is($q$select public.ingest_register_text(pg_temp.law('law:trib:IBBI_NCLT:one','https://ibbi.gov.in/uploads/order/one.pdf') || '{"mapping_fingerprint":"0"}')$q$,
  'law listing: stale mapping', 'Law stale mapping');
select pg_temp.ok((select count(*) from public.documents)=0 and (select count(*) from public.ingest_jobs)=0 and (select count(*) from public.record_document_links)=0
  and (select count(*) from public.law_publications)=0, 'no refusal wrote anything');

-- ═══ Results, whole ══════════════════════════════════════════════════════════

create temp table pq_new as select public.ingest_register_text(pg_temp.pq()) r;
select pg_temp.ok((select array_agg(k order by k) from pq_new, jsonb_object_keys(r) k) = array['document_id','existing','job_id','links','status']
  and (select r->'existing'='false'::jsonb and r->'links'='2'::jsonb and r->>'status'='queued' from pq_new), 'new answer: {document_id, job_id, status, existing:false, links:2}');
select pg_temp.ok((select requested_by='11111111-1111-4111-8111-111111111111' and to_jsonb(j)->>'batch_id' is null from public.ingest_jobs j), 'the actor is the job''s requester, as before');
create temp table pq_again as select public.ingest_register_text(pg_temp.pq()) r;
select pg_temp.ok((select r from pq_again) = (select jsonb_build_object('document_id',r->'document_id','job_id',r->'job_id','status','queued','existing',true) from pq_new),
  'exact retry: {document_id, job_id, status, existing:true}, nothing else');
select pg_temp.is($q$select public.ingest_register_text(pg_temp.pq('{"title":"Changed"}'))$q$, 'supplied text: conflict: existing source is immutable', 'changed payload, same key');
select pg_temp.is($q$select public.ingest_register_text(pg_temp.pq('{"source_key":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}'))$q$, 'supplied text: conflict: another document holds this file_url', 'second key for the answer');
delete from public.ingest_jobs;
select pg_temp.is($q$select public.ingest_register_text(pg_temp.pq())$q$, 'supplied text: conflict: missing job', 'missing job');
create temp table law_new as select public.ingest_register_text(pg_temp.law('law:trib:IBBI_NCLT:one','https://ibbi.gov.in/uploads/order/one.pdf')
  || jsonb_build_object('mapping_fingerprint', pg_temp.fp(pg_temp.law('law:trib:IBBI_NCLT:one','https://ibbi.gov.in/uploads/order/one.pdf')))) r;
select pg_temp.ok((select r ? 'links' and r->'links'='null'::jsonb and r->'existing'='false'::jsonb from law_new)
  and (select actor='11111111-1111-4111-8111-111111111111' and status='pending' from public.law_publications), 'new Law: links null, publication intent with its actor');
select pg_temp.ok((select (public.ingest_register_text(pg_temp.law('law:trib:IBBI_NCLT:one','https://ibbi.gov.in/uploads/order/one.pdf'))->>'existing')::boolean),
  'Law exact retry needs no fingerprint (the source exists)');
select pg_temp.ok(not has_function_privilege('service_role','public.ingest_register_text_unmapped(jsonb)','execute')
  and has_function_privilege('service_role','public.ingest_register_text(jsonb)','execute')
  and not has_function_privilege('authenticated','public.ingest_register_text(jsonb)','execute'), 'grants unchanged');

-- servable is a batch-path gate only: the single-document path admits a payload that carries
-- servable false, as it always did (admin-ingest's prepareSuppliedText drops the field anyway).
create temp table unservable as select pg_temp.law('law:trib:IBBI_NCLT:unservable','https://ibbi.gov.in/uploads/order/unservable.pdf','{"servable":false}') q;
select pg_temp.ok((select (public.ingest_register_text(q || jsonb_build_object('mapping_fingerprint',pg_temp.fp(q)))->>'existing')::boolean = false from unservable),
  'the single path admits servable false, as before');

-- ═══ New (design 11, Q3): one text, one document ═════════════════════════════

create temp table copy as select pg_temp.law('law:trib:IBBI_NCLT:copy','https://ibbi.gov.in/uploads/order/copy.pdf','{}','A written answer.') q;
select pg_temp.ok((select public.law_reconcile(jsonb_build_object('record',(q->>'payload')::jsonb))->>'status' from copy) = 'ready', 'the copy is otherwise admissible');
select pg_temp.is((select format('select public.ingest_register_text(%L::jsonb)', q || jsonb_build_object('mapping_fingerprint',pg_temp.fp(q))) from copy),
  'supplied text: conflict: another document holds this text', 'the same text under another key is refused');
rollback;
