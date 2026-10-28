-- F266: a Parliamentary answer is admitted only with its listing links, in one transaction.
-- Disposable fixture; run.sh uses the record_document_associations chain plus 20261028130000.
\set ON_ERROR_STOP on
begin;
set search_path = public, extensions;
create function pg_temp.ok(v boolean, label text) returns void language plpgsql as $$begin
 if v is distinct from true then raise exception 'FAIL %', label; end if; raise notice 'PASS %', label; end$$;
create function pg_temp.refused(q text, pattern text) returns void language plpgsql as $$begin
 begin execute q; exception when others then
 if position(pattern in sqlerrm)=0 then raise exception 'wrong refusal: %',sqlerrm; end if; return; end;
 raise exception 'accepted unsafe operation: %',q; end$$;

-- The answer key.
select pg_temp.ok(public.pq_answer_key('https://sansad.in/getFile/loksabhaquestions/annex/187/AU6302_KIQmzb.pdf?source=pqals') = 'pq:ls:187:AU6302_KIQmzb', 'key from a listing URL');
select pg_temp.ok(public.pq_answer_key('https://sansad.in/getFile/loksabhaquestions/annex/187/AU6302_KIQmzb.pdf') = 'pq:ls:187:AU6302_KIQmzb', 'key without the query string');
select pg_temp.ok(public.pq_answer_key('http://sansad.in/getFile/loksabhaquestions/annex/187/AU6302_KIQmzb.pdf') is null, 'plain http has no key');
select pg_temp.ok(public.pq_answer_key('https://example.org/getFile/loksabhaquestions/annex/187/AU6302_KIQmzb.pdf') is null, 'other hosts have no key');
select pg_temp.ok(public.pq_answer_key('https://sansad.in/getFile/loksabhaquestions/annex/187/AU6302_KIQmzb.pdf?source=other') is null, 'other query strings have no key');
select pg_temp.ok(public.pq_answer_key(null) is null, 'null has no key');
select pg_temp.ok(public.pq_date('02.04.2026') = '2026-04-02' and public.pq_date('2026-04-02') = '2026-04-02' and public.pq_date('2 Apr 2026') is null, 'answer dates compared as ISO');

-- Two members asked the same question (one answer file); a third row is another answer.
insert into public.desk_rows(tier,feature,row_key,row,record_text,snapshot_at) values
 ('national','Parliamentary Question Database','7820',jsonb_build_object('id','7820','house','Lok Sabha','date','2026-04-02','ministry','MICRO, SMALL AND MEDIUM ENTERPRISES','subject','Expanding Khadi Production in Tamil Nadu','mp_name','Mani A','source_url','https://sansad.in/getFile/loksabhaquestions/annex/187/AU6302_KIQmzb.pdf?source=pqals'),'Khadi',now()),
 ('national','Parliamentary Question Database','7821',jsonb_build_object('id','7821','house','Lok Sabha','date','2026-04-02','ministry','MICRO, SMALL AND MEDIUM ENTERPRISES','subject','Expanding Khadi Production in Tamil Nadu','mp_name','Second Member','source_url','https://sansad.in/getFile/loksabhaquestions/annex/187/AU6302_KIQmzb.pdf?source=pqals'),'Khadi',now()),
 ('national','Parliamentary Question Database','9',jsonb_build_object('id','9','house','Lok Sabha','date','2026-03-18','ministry','COMMUNICATIONS','subject','BharatNet connectivity in Tamil Nadu','mp_name','Mani A','source_url','https://sansad.in/getFile/loksabhaquestions/annex/187/AU4229_uPmDeg.pdf?source=pqals'),'BharatNet',now());

create function pg_temp.request(over jsonb) returns jsonb language plpgsql as $$
declare r jsonb; payload text; t text := 'LOK SABHA UNSTARRED QUESTION NO. 6302 ANSWER A written answer.';
begin
 r := jsonb_build_object(
  'source_key', repeat('a',40), 'title','Expanding Khadi Production in Tamil Nadu', 'text', t,
  'text_sha256', encode(sha256(convert_to(t,'UTF8')),'hex'),
  'desk_tier','national', 'desk_feature','Parliamentary Question Database',
  'file_name','AU6302_KIQmzb.pdf',
  'file_url','https://sansad.in/getFile/loksabhaquestions/annex/187/AU6302_KIQmzb.pdf?source=pqals',
  'document_key_suggested','pq:ls:187:AU6302_KIQmzb',
  'citation', jsonb_build_object('kind','parliamentary_question','house','Lok Sabha','session','187','question_no','6302',
     'subject','Expanding Khadi Production in Tamil Nadu','ministry','MICRO, SMALL AND MEDIUM ENTERPRISES','answered_on','02.04.2026'),
  'review', jsonb_build_object('status','eligible','checks',jsonb_build_object('identity',true,'completeness',true,'sensitivity',true,'dedupe',true,'rights',true))
 ) || over;
 payload := r::text;
 return jsonb_build_object('payload',payload,'payload_sha256',encode(sha256(convert_to(payload,'UTF8')),'hex'),
  'expected',jsonb_build_array(jsonb_build_object('chunk_hash',repeat('c',64),'embed_hash',repeat('d',64),'chunk_index',0,'source_kind','document',
    'char_from',0,'char_to',length(t),'content',t,'token_count',12,'chunker_version',4)),
  'pages','[]'::jsonb,'sections','[]'::jsonb);
end $$;

-- Refusals write nothing: no document, job, input or link.
select pg_temp.refused($q$select public.ingest_register_text(pg_temp.request('{"citation":{"kind":"parliamentary_question","house":"Lok Sabha","subject":"Another subject","ministry":"MICRO, SMALL AND MEDIUM ENTERPRISES","answered_on":"02.04.2026"}}'))$q$, 'subject_conflict');
select pg_temp.refused($q$select public.ingest_register_text(pg_temp.request('{"citation":{"kind":"parliamentary_question","house":"Rajya Sabha","subject":"Expanding Khadi Production in Tamil Nadu","ministry":"MICRO, SMALL AND MEDIUM ENTERPRISES","answered_on":"02.04.2026"}}'))$q$, 'house_conflict');
select pg_temp.refused($q$select public.ingest_register_text(pg_temp.request('{"citation":{"kind":"parliamentary_question","house":"Lok Sabha","subject":"Expanding Khadi Production in Tamil Nadu","ministry":"MICRO, SMALL AND MEDIUM ENTERPRISES","answered_on":"03.04.2026"}}'))$q$, 'date_conflict');
select pg_temp.refused($q$select public.ingest_register_text(pg_temp.request('{"citation":{"kind":"parliamentary_question","house":"Lok Sabha","subject":"Expanding Khadi Production in Tamil Nadu","ministry":"COMMUNICATIONS","answered_on":"02.04.2026"}}'))$q$, 'ministry_conflict');
select pg_temp.refused($q$select public.ingest_register_text(pg_temp.request('{"citation":{"kind":"parliamentary_question","house":"Lok Sabha","ministry":"MICRO, SMALL AND MEDIUM ENTERPRISES","answered_on":"02.04.2026"}}'))$q$, 'subject_conflict');
select pg_temp.refused($q$select public.ingest_register_text(pg_temp.request('{"document_key_suggested":"pq:ls:187:AU9999_other"}'))$q$, 'answer_key_conflict');
select pg_temp.refused($q$select public.ingest_register_text(pg_temp.request('{"file_url":"https://sansad.in/getFile/loksabhaquestions/annex/187/AU1111_noRow.pdf?source=pqals","document_key_suggested":"pq:ls:187:AU1111_noRow"}'))$q$, 'no desk row');
select pg_temp.refused($q$select public.ingest_register_text(pg_temp.request('{"file_url":"https://example.org/AU6302_KIQmzb.pdf"}'))$q$, 'invalid source');
select pg_temp.refused($q$select public.ingest_register_text(pg_temp.request('{"desk_feature":"Bill Passage Probability Index"}'))$q$, 'invalid source');
-- Each refusal is an exception, so its transaction writes nothing; this only confirms no state leaked.
select pg_temp.ok((select count(*) from public.documents)=0 and (select count(*) from public.ingest_jobs)=0
  and (select count(*) from public.ingest_text_inputs)=0 and (select count(*) from public.record_document_links)=0, 'no state after refusals');

-- An older pack import of the same answer (no file_url, pack path only) blocks a second copy.
savepoint pack_copy;
insert into public.documents(source_key,title,desk_tier,desk_feature,content_sha256,ocr_text,metadata)
 values(repeat('e',40),'Older pack copy','national','Parliamentary Question Database',repeat('f',64),'x',
  '{"source_path":"01 Legislative & Policy Intelligence/Parliamentary Question Database/PDFs/187_AU6302_KIQmzb.pdf"}');
select pg_temp.refused($q$select public.ingest_register_text(pg_temp.request('{}'))$q$, 'holds this answer');
rollback to pack_copy;

-- The same answer under its URL without ?source=pqals also blocks a second copy.
savepoint url_variant;
insert into public.documents(source_key,title,file_url,desk_tier,desk_feature,content_sha256,ocr_text)
 values(repeat('9',40),'URL variant copy','https://sansad.in/getFile/loksabhaquestions/annex/187/AU6302_KIQmzb.pdf','national','Parliamentary Question Database',repeat('8',64),'x');
select pg_temp.refused($q$select public.ingest_register_text(pg_temp.request('{}'))$q$, 'holds this file_url');
rollback to url_variant;

-- Admission writes the document and both members' links together.
create temp table registered as select public.ingest_register_text(pg_temp.request('{}')) r;
grant select on registered to authenticated;
select pg_temp.ok((select (r->>'existing')::boolean = false and (r->>'links')::int = 2 from registered), 'admitted with two links');
select pg_temp.ok((select count(*) from public.record_document_links where document_id=(select (r->>'document_id')::uuid from registered))=2, 'both member rows linked');
select pg_temp.ok((select bool_and(expected_link_count=1 and role='answer' and version='1' and decision_id='admission:pq-answer-key-v1') from public.record_document_links), 'each row expects one answer');
select pg_temp.ok((select count(*) from public.record_document_links where row_key='9')=0, 'other answers untouched');
select pg_temp.ok((select public.ingest_register_text(pg_temp.request('{}'))->>'job_id')=(select r->>'job_id' from registered)
  and (select count(*) from public.record_document_links)=2 and (select count(*) from public.documents)=1, 'exact retry adds nothing');
select pg_temp.refused($q$select public.ingest_register_text(pg_temp.request('{"source_key":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}'))$q$, 'holds this file_url');

-- Before indexing the record is registered, after indexing it is Full text.
set local role authenticated;
select pg_temp.ok((select bool_and(coverage='registered' and document_id is null) from public.record_resolve_document_keys(array['desk-record:["national","Parliamentary Question Database","7820"]'])), 'registered before indexing');
reset role;
create temp table claim as select * from public.ingest_claim(1, interval '5 minutes');
select public.ingest_text_commit(id,claim_token,jsonb_build_array(jsonb_build_object(
 'chunk_hash',repeat('c',64),'embed_hash',repeat('d',64),'chunk_index',0,'source_kind','document','char_from',0,
 'char_to',length('LOK SABHA UNSTARRED QUESTION NO. 6302 ANSWER A written answer.'),
 'content','LOK SABHA UNSTARRED QUESTION NO. 6302 ANSWER A written answer.','token_count',12,'chunker_version',4,
 'embedding',to_jsonb(array_fill(0.01::real,array[1536]))))) from claim;
select public.ingest_text_activate(id,claim_token,0,0) from claim;
set local role authenticated;
select pg_temp.ok((select count(*) from public.record_resolve_document_keys(array[
  'desk-record:["national","Parliamentary Question Database","7820"]','desk-record:["national","Parliamentary Question Database","7821"]'])
  where coverage='full' and document_id=(select (r->>'document_id')::uuid from registered))=2, 'both rows Full text after indexing');
select pg_temp.ok((select bool_and(coverage='unmapped') from public.record_resolve_document_keys(array['desk-record:["national","Parliamentary Question Database","9"]'])), 'unlinked answer stays unmapped');
reset role;
select pg_temp.ok(not has_function_privilege('authenticated','public.ingest_register_text(jsonb)','execute'), 'registration stays service only');
select pg_temp.ok(not has_function_privilege('authenticated','public.pq_answer_key(text)','execute')
  and not has_function_privilege('anon','public.pq_answer_key(text)','execute')
  and has_function_privilege('service_role','public.pq_answer_key(text)','execute'), 'answer key helper is service only');

-- Law through the replaced body: registered as Law, no question links, exact retry idempotent.
create temp table law_request as select jsonb_build_object('payload',payload,'payload_sha256',encode(sha256(convert_to(payload,'UTF8')),'hex'),
 'expected',jsonb_build_array(jsonb_build_object('chunk_hash',repeat('1',64),'embed_hash',repeat('2',64),'chunk_index',0,'source_kind','document',
   'char_from',0,'char_to',14,'content','A court order.','token_count',4,'chunker_version',4)),'pages','[]'::jsonb,'sections','[]'::jsonb) p
 from (select jsonb_build_object('source_key','law:hc:test/1','title','Test order','text','A court order.',
   'text_sha256',encode(sha256(convert_to('A court order.','UTF8')),'hex'),'desk_tier','law','desk_feature','Order Archive by Topic (Cross-Court)',
   'review',jsonb_build_object('status','eligible'),'citation',jsonb_build_object('case_number','1'))::text payload) f;
create temp table law_registered as select public.ingest_register_text_unmapped(p) r from law_request;
select pg_temp.ok((select (r->>'existing')::boolean=false and r->'links'='null'::jsonb from law_registered)
  and (select desk_tier='law' from public.documents where id=(select (r->>'document_id')::uuid from law_registered))
  and (select count(*) from public.record_document_links where document_id=(select (r->>'document_id')::uuid from law_registered))=0, 'Law registers as before, without links');
select pg_temp.ok((select public.ingest_register_text_unmapped(p)->>'job_id' from law_request)=(select r->>'job_id' from law_registered), 'Law exact retry same job');
rollback;
