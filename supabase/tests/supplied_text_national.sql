-- Disposable fixture; run.sh uses the law_listing chain + 20261027120000_supplied_text_national_questions.
-- National question answers through supplied text; Law registration unchanged. No production corpus.
\set ON_ERROR_STOP on
begin;
set search_path = public, extensions;
create function pg_temp.ok(v boolean, label text) returns void language plpgsql as $$begin
 if v is distinct from true then raise exception 'FAIL %', label; end if; raise notice 'PASS %', label; end$$;
create function pg_temp.refused(q text, pattern text) returns void language plpgsql as $$begin
 begin execute q; exception when others then
 if position(pattern in sqlerrm)=0 then raise exception 'wrong refusal: %',sqlerrm; end if; return; end;
 raise exception 'accepted unsafe operation: %',q; end$$;
-- A registration request exactly as admin-ingest builds it (payload, its hash, one approved chunk).
create function pg_temp.req(k text, tier text, feat text, u text, body text default 'A written answer.') returns jsonb
language sql as $$
 with r as (select jsonb_build_object('source_key',k,'title','Lok Sabha Unstarred Question No. 1: Test','text',body,
   'text_sha256',encode(sha256(convert_to(body,'UTF8')),'hex'),'desk_tier',tier,'desk_feature',feat,
   'review',jsonb_build_object('status','eligible'),'citation',jsonb_build_object('question_no','1'))
   || case when u is null then '{}'::jsonb else jsonb_build_object('file_url',u) end as j)
 select jsonb_build_object('payload',j::text,'payload_sha256',encode(sha256(convert_to(j::text,'UTF8')),'hex'),
   'expected',jsonb_build_array(jsonb_build_object('chunk_hash',repeat('a',64),'embed_hash',repeat('b',64),'chunk_index',0,
     'source_kind','document','char_from',0,'char_to',length(body),'content',body,'token_count',4,'chunker_version',4)),
   'pages','[]'::jsonb,'sections','[]'::jsonb) from r
$$;
select pg_temp.ok(not has_function_privilege('authenticated','public.ingest_register_text_unmapped(jsonb)','execute'), 'inner registration not callable by users');
select pg_temp.ok(not has_function_privilege('service_role','public.ingest_register_text_unmapped(jsonb)','execute'), 'inner registration only through the mapped wrapper');
select pg_temp.ok(not has_function_privilege('authenticated','public.ingest_register_text(jsonb)','execute'), 'registration service only');
insert into public.desk_rows(tier,feature,row_key,row,record_text,snapshot_at) values
 ('national','Parliamentary Question Database','7830','{"subject":"Test","source_url":"https://sansad.in/getFile/loksabhaquestions/annex/184/AU1_aaaaaa.pdf?source=pqals"}','Test',now()),
 ('national','Bill Passage Probability Index','b1','{"source_url":"https://sansad.in/getFile/BillsTexts/one.pdf"}','Bill',now());
-- 1. A mapped National question registers under its own desk and queues index without OCR.
create temp table nat as select public.ingest_register_text(pg_temp.req(repeat('1',40),'national','Parliamentary Question Database',
  'https://sansad.in/getFile/loksabhaquestions/annex/184/AU1_aaaaaa.pdf?source=pqals')) r;
select pg_temp.ok((select r->>'existing' from nat)='false', 'national question registered');
select pg_temp.ok((select desk_tier='national' and desk_feature='Parliamentary Question Database' and metadata->>'origin'='supplied-text'
  and file_url='https://sansad.in/getFile/loksabhaquestions/annex/184/AU1_aaaaaa.pdf?source=pqals' and ocr_text='A written answer.'
  from public.documents where source_key=repeat('1',40)), 'stored under the National question desk with exact text');
select pg_temp.ok((select input_kind='supplied_text' and stage='index' and status='queued' from public.ingest_jobs j join nat on j.id=(nat.r->>'job_id')::uuid), 'existing queue at index, no OCR');
select pg_temp.ok((select public.ingest_register_text(pg_temp.req(repeat('1',40),'national','Parliamentary Question Database',
  'https://sansad.in/getFile/loksabhaquestions/annex/184/AU1_aaaaaa.pdf?source=pqals'))->>'job_id')=(select r->>'job_id' from nat), 'exact retry same job');
-- 2. Refusals: duplicate URL, no desk row, wrong host, wrong module, wrong key shape, no URL.
select pg_temp.refused($q$select public.ingest_register_text(pg_temp.req(repeat('2',40),'national','Parliamentary Question Database','https://sansad.in/getFile/loksabhaquestions/annex/184/AU1_aaaaaa.pdf?source=pqals','Other text.'))$q$, 'another document holds this file_url');
select pg_temp.refused($q$select public.ingest_register_text(pg_temp.req(repeat('3',40),'national','Parliamentary Question Database','https://sansad.in/getFile/loksabhaquestions/annex/184/AU9_unknown.pdf?source=pqals'))$q$, 'no desk row');
select pg_temp.refused($q$select public.ingest_register_text(pg_temp.req(repeat('4',40),'national','Parliamentary Question Database','https://example.org/AU1_aaaaaa.pdf'))$q$, 'invalid source');
select pg_temp.refused($q$select public.ingest_register_text(pg_temp.req(repeat('5',40),'national','Bill Passage Probability Index','https://sansad.in/getFile/BillsTexts/one.pdf'))$q$, 'invalid source');
select pg_temp.refused($q$select public.ingest_register_text(pg_temp.req('national:'||repeat('6',31),'national','Parliamentary Question Database','https://sansad.in/getFile/loksabhaquestions/annex/184/AU1_aaaaaa.pdf?source=pqals'))$q$, 'invalid source');
select pg_temp.refused($q$select public.ingest_register_text(pg_temp.req(repeat('7',40),'national','Parliamentary Question Database',null))$q$, 'invalid source');
select pg_temp.refused($q$select public.ingest_register_text(pg_temp.req(repeat('8',40),'law','Parliamentary Question Database','https://sansad.in/getFile/loksabhaquestions/annex/184/AU1_aaaaaa.pdf'))$q$, 'invalid source');
select pg_temp.refused($q$select public.ingest_register_text_unmapped(pg_temp.req('law:hc:x','national','Parliamentary Question Database','https://sansad.in/getFile/loksabhaquestions/annex/184/AU1_aaaaaa.pdf'))$q$, 'invalid source');
-- A legacy document already holding the key is never overwritten.
insert into public.documents(source_key,title,desk_tier,desk_feature,content_sha256,ocr_text) values(repeat('9',40),'Legacy','national','Parliamentary Question Database',repeat('c',64),'Legacy text');
select pg_temp.refused($q$select public.ingest_register_text(pg_temp.req(repeat('9',40),'national','Parliamentary Question Database','https://sansad.in/getFile/loksabhaquestions/annex/184/AU1_aaaaaa.pdf?source=pqals'))$q$, 'immutable');
select pg_temp.ok((select ocr_text='Legacy text' from public.documents where source_key=repeat('9',40)), 'legacy text untouched');
select pg_temp.ok((select count(*) from public.documents where desk_tier='national')=2, 'no refused registration wrote a document');
-- 3. Law is unchanged: the mapped wrapper still holds unsupported Law sources; the inner path still writes tier law.
select pg_temp.refused($q$select public.ingest_register_text(pg_temp.req('law:hc:unsupported','law','Order Archive by Topic (Cross-Court)','https://ibbi.gov.in/uploads/order/x.pdf'))$q$, 'admission held');
select public.ingest_register_text_unmapped(pg_temp.req('law:hc:direct','law','Order Archive by Topic (Cross-Court)','https://ibbi.gov.in/uploads/order/y.pdf'));
select pg_temp.ok((select desk_tier='law' from public.documents where source_key='law:hc:direct'), 'law registration still writes tier law');
select pg_temp.refused($q$select public.ingest_register_text_unmapped(pg_temp.req('law:hc:other','national','Order Archive by Topic (Cross-Court)','https://ibbi.gov.in/uploads/order/z.pdf'))$q$, 'invalid source');
rollback;
