-- Local-only mapping and permission fixture; no corpus content or hosted writes.
\set ON_ERROR_STOP on
begin;
set search_path=public,extensions;
create function pg_temp.ok(v boolean,label text) returns void language plpgsql as $$begin
 if v is distinct from true then raise exception 'FAIL %',label; end if; raise notice 'PASS %',label; end$$;
create function pg_temp.refused(q text,pattern text) returns void language plpgsql as $$begin
 begin execute q; exception when others then
 if position(pattern in sqlerrm)=0 then raise exception 'wrong refusal: %',sqlerrm; end if; return; end;
 raise exception 'accepted unsafe operation: %',q; end$$;
select pg_temp.ok(to_regclass('public.record_document_links') is not null,'shared association contract exists');
insert into public.desk_rows(tier,feature,row_key,row,record_text,snapshot_at) values
 ('national','Parliamentary Question Database','234','{"subject":"Film support","house":"Lok Sabha","source_url":"https://sansad.in/a.pdf"}','Film support',now()),
 ('national','Parliamentary Question Database','235','{"subject":"Film support","house":"Lok Sabha","source_url":"https://sansad.in/a.pdf"}','Film support second MP',now()),
 ('state','Other','234','{"source_url":"https://sansad.in/a.pdf"}','Unrelated',now());
insert into public.documents(id,source_key,title,file_url,desk_tier,desk_feature,content_sha256,ocr_text,indexed_at)
 values('11111111-1111-4111-8111-111111111111','fixture-film','Film support','https://sansad.in/a.pdf','national','Parliamentary Question Database',repeat('a',64),'Film support',now());
insert into public.document_chunks(document_id,chunk_hash,chunk_index,char_from,char_to,content,chunker_version,embedding)
 values('11111111-1111-4111-8111-111111111111',repeat('b',64),0,0,12,'Film support',4,array_fill(0.01::real,array[1536])::vector);
create temp table proposal as select jsonb_build_object('tier','national','feature','Parliamentary Question Database','row_key','234','document_id','11111111-1111-4111-8111-111111111111','role','answer','version','1','decision_id','fixture-reviewed','approver','Fixture','evidence_sha256',repeat('c',64),'expected_fingerprint',public.record_mapping_fingerprint('national','Parliamentary Question Database','234','11111111-1111-4111-8111-111111111111')) p;
select public.record_mapping_apply(p) from proposal;
select public.record_mapping_apply(p) from proposal;
select pg_temp.ok((select count(*) from public.record_document_links)=1,'idempotent link');
select public.record_mapping_apply(p||jsonb_build_object('row_key','235','expected_fingerprint',public.record_mapping_fingerprint('national','Parliamentary Question Database','235','11111111-1111-4111-8111-111111111111'))) from proposal;
select pg_temp.ok((select count(*) from public.documents)=1,'multiple MPs do not duplicate document');
select pg_temp.refused($q$select public.record_mapping_apply(p||'{"expected_fingerprint":"stale"}') from proposal$q$,'stale');
select pg_temp.refused($q$select public.record_mapping_apply(p||jsonb_build_object('tier','state','feature','Other','expected_fingerprint',public.record_mapping_fingerprint('state','Other','234','11111111-1111-4111-8111-111111111111'))) from proposal$q$,'identity');
select pg_temp.refused($q$select public.record_mapping_apply(p||'{"approver":"Changed"}') from proposal$q$,'conflict');
select pg_temp.ok(not has_function_privilege('authenticated','public.record_mapping_apply(jsonb)','execute'),'user cannot approve links');
select pg_temp.ok(not has_table_privilege('authenticated','public.record_document_links','insert'),'user cannot forge link');
select pg_temp.ok(not has_function_privilege('anon','public.record_resolve_document_keys(text[])','execute'),'anon cannot inspect coverage');
set local role authenticated;
select pg_temp.ok((select count(*) from public.record_resolve_document_keys(array['desk-record:["national","Parliamentary Question Database","234"]']) where coverage='full' and document_id='11111111-1111-4111-8111-111111111111')=1,'caller gets exact linked document');
select pg_temp.ok((select bool_and(document_id is null and coverage='unmapped') from public.record_resolve_document_keys(array['desk-record:["state","Other","234"]'])),'same ordinal in another desk not linked');
select pg_temp.ok((select count(*) from public.record_resolve_document_keys(array['desk-record:bad']))=0,'malformed key fails closed');
reset role;
set local role authenticated;
select pg_temp.ok((select count(*) from record_resolve_document_keys(array['document-id:11111111-1111-4111-8111-111111111111']) where coverage='full' and document_id='11111111-1111-4111-8111-111111111111')=1,'direct indexed document resolves');
select pg_temp.ok((select count(*)=1 and bool_and(coverage='unavailable' and document_id is null) from record_resolve_document_keys(array['document-id:99999999-9999-4999-8999-999999999999'])),'missing direct ID unavailable');
select pg_temp.ok((select count(*)=1 and bool_and(coverage='unavailable' and document_id is null) from record_resolve_document_keys(array['document-id:bad'])),'malformed direct ID unavailable');
reset role;
savepoint not_indexed;
update documents set indexed_at=null;
set local role authenticated;
select pg_temp.ok((select count(*)=1 and bool_and(coverage='registered' and document_id is null) from record_resolve_document_keys(array['document-id:11111111-1111-4111-8111-111111111111'])),'unindexed direct document registered');
reset role;
rollback to not_indexed;
savepoint no_chunks;
delete from document_chunks;
set local role authenticated;
select pg_temp.ok((select count(*)=1 and bool_and(coverage='incomplete' and document_id is null) from record_resolve_document_keys(array['document-id:11111111-1111-4111-8111-111111111111'])),'direct document without chunks incomplete');
reset role;
rollback to no_chunks;
savepoint stale_metadata;
update documents set metadata=metadata||'{"case_number":"changed"}';
set local role authenticated;
select pg_temp.ok((select bool_and(coverage='held' and document_id is null) from record_resolve_document_keys(array['desk-record:["national","Parliamentary Question Database","234"]'])),'changed document metadata invalidates mapping');
reset role;
rollback to stale_metadata;
savepoint stale_key;
update documents set source_key='changed-source';
set local role authenticated;
select pg_temp.ok((select bool_and(coverage='held' and document_id is null) from record_resolve_document_keys(array['desk-record:["national","Parliamentary Question Database","234"]'])),'changed source key invalidates mapping');
reset role;
rollback to stale_key;
savepoint legacy_keys;
insert into desk_rows(tier,feature,row_key,row,record_text,snapshot_at,document_key) values
('national','Bill Passage Index','bill-row','{}','Bill',now(),'bill:current');
insert into documents(id,source_key,title,desk_tier,desk_feature,content_sha256,ocr_text,indexed_at,metadata)
values('44444444-4444-4444-8444-444444444444','bill-fixture','Bill','national','Bill Passage Index',repeat('e',64),'Bill',now(),'{"document_key":"bill:current"}');
insert into document_chunks(document_id,chunk_hash,chunk_index,char_from,char_to,content,chunker_version,embedding)
values('44444444-4444-4444-8444-444444444444',repeat('e',64),0,0,4,'Bill',4,array_fill(0.01::real,array[1536])::vector);
set local role authenticated;
select pg_temp.ok((select count(*)=1 and bool_and(document_id='44444444-4444-4444-8444-444444444444' and coverage='full' and document_key='desk-record:["national","Bill Passage Index","bill-row"]') from record_resolve_document_keys(array['desk-record:["national","Bill Passage Index","bill-row"]'])),'tuple delegates current stored bill key');
reset role;
insert into desk_rows(tier,feature,row_key,row,record_text,snapshot_at,document_key)
values('state','Other','cross-desk-bill','{}','Wrong desk',now(),'bill:current');
set local role authenticated;
select pg_temp.ok((select count(*)=1 and bool_and(coverage='unmapped' and document_id is null) from record_resolve_document_keys(array['desk-record:["state","Other","cross-desk-bill"]'])),'stored legacy key cannot resolve a document from another desk');
reset role;
update documents set indexed_at=null where id='44444444-4444-4444-8444-444444444444';
set local role authenticated;
select pg_temp.ok((select count(*)=1 and bool_and(coverage='registered' and document_id is null) from record_resolve_document_keys(array['desk-record:["national","Bill Passage Index","bill-row"]'])),'stored bill key reports registered without ID');
reset role;
update documents set indexed_at=now() where id='44444444-4444-4444-8444-444444444444';
update document_chunks set embedding=null where document_id='44444444-4444-4444-8444-444444444444';
set local role authenticated;
select pg_temp.ok((select count(*)=1 and bool_and(coverage='incomplete' and document_id is null) from record_resolve_document_keys(array['desk-record:["national","Bill Passage Index","bill-row"]'])),'stored bill key requires all vectors');
reset role;
update document_chunks set embedding=array_fill(0.01::real,array[1536])::vector where document_id='44444444-4444-4444-8444-444444444444';
insert into documents(id,source_key,title,desk_tier,desk_feature,content_sha256,ocr_text,metadata)
values('66666666-6666-4666-8666-666666666666','bill-fixture-v2','Bill v2','national','Bill Passage Index',repeat('f',64),'Bill','{"document_key":"bill:current"}');
set local role authenticated;
select pg_temp.ok((select count(*)=2 and bool_and(coverage='partial') and count(document_id)=1 from record_resolve_document_keys(array['desk-record:["national","Bill Passage Index","bill-row"]'])),'stored bill key reports partial across versions');
reset role;
update desk_rows set document_key='bill:new' where row_key='bill-row';
set local role authenticated;
select pg_temp.ok((select count(*)=1 and bool_and(document_id is null and coverage='unmapped') from record_resolve_document_keys(array['desk-record:["national","Bill Passage Index","bill-row"]'])),'changed stored bill key never uses old indexed document');
reset role;
update desk_rows set document_key=null where row_key='bill-row';
set local role authenticated;
select pg_temp.ok((select count(*)=1 and bool_and(document_id is null and coverage='unmapped') from record_resolve_document_keys(array['desk-record:["national","Bill Passage Index","bill-row"]'])),'cleared stored bill key never uses old indexed document');
reset role;
insert into law_records(id,row_key,record_type,forum,order_date,source_url,row_data)
values('55555555-5555-4555-8555-555555555555','law-fixture','tribunal_order','NCLT','2026-01-01','https://ibbi.gov.in/order.pdf','{}');
insert into desk_rows(tier,feature,row_key,row,record_text,snapshot_at,document_key)
values('law','NCLT / NCLAT (Insolvency)','law-fixture','{}','Law',now(),'law-record:55555555-5555-4555-8555-555555555555');
-- Reassign this fixture document only after Bill assertions: Law resolution
-- must satisfy its own desk identity as well as the publication adapter.
update documents set desk_tier='law',desk_feature='NCLT / NCLAT (Insolvency)',
 source_key='law:trib:IBBI_NCLT:fixture',metadata='{"origin":"supplied-text"}'
 where id='44444444-4444-4444-8444-444444444444';
insert into law_document_links(document_id,record_id,text_sha256,evidence_sha256)
values('44444444-4444-4444-8444-444444444444','55555555-5555-4555-8555-555555555555',repeat('e',64),repeat('f',64));
update law_listing_settings set active=true;
set local role authenticated;
select pg_temp.ok((select count(*)=1 and bool_and(coverage='full') from record_resolve_document_keys(array['desk-record:["law","NCLT / NCLAT (Insolvency)","law-fixture"]'])),'tuple delegates published Law key');
reset role;
update law_records set visible=false where row_key='law-fixture';
set local role authenticated;
select pg_temp.ok((select count(*) from record_resolve_document_keys(array['desk-record:["law","NCLT / NCLAT (Insolvency)","law-fixture"]']))=0,'hidden Law listing does not disclose a document');
reset role;
rollback to legacy_keys;
savepoint concurrent_alias;
insert into documents(id,source_key,title,file_url,desk_tier,desk_feature,content_sha256,ocr_text,indexed_at)
select '33333333-3333-4333-8333-333333333333','new-alias',title,file_url,desk_tier,desk_feature,content_sha256,ocr_text,indexed_at from documents where id='11111111-1111-4111-8111-111111111111';
select pg_temp.refused($q$select record_mapping_apply(p) from proposal$q$,'alias');
rollback to concurrent_alias;
savepoint mixed_visibility;
insert into documents(id,source_key,title,file_url,desk_tier,desk_feature,content_sha256,ocr_text,indexed_at)
select '22222222-2222-4222-8222-222222222222','fixture-film-v2',title,file_url,desk_tier,desk_feature,content_sha256,ocr_text,indexed_at from documents where id='11111111-1111-4111-8111-111111111111';
insert into document_chunks(document_id,chunk_hash,chunk_index,char_from,char_to,content,chunker_version,embedding)
select '22222222-2222-4222-8222-222222222222',repeat('d',64),chunk_index,char_from,char_to,content,chunker_version,embedding from document_chunks;
select record_mapping_apply(p||jsonb_build_object('document_id','22222222-2222-4222-8222-222222222222','version','2','expected_alias_ids',jsonb_build_array('11111111-1111-4111-8111-111111111111'),'expected_fingerprint',record_mapping_fingerprint('national','Parliamentary Question Database','234','22222222-2222-4222-8222-222222222222'))) from proposal;
select pg_temp.ok((select count(*)=2 and bool_and(expected_link_count=2) from record_document_links where row_key='234'),'writer updates expected count on every sibling');
set local role authenticated;
select pg_temp.ok((select count(*)=2 and bool_and(coverage='full') from record_resolve_document_keys(array['desk-record:["national","Parliamentary Question Database","234"]'])),'multiple visible ready documents are full');
reset role;
create policy fixture_mixed_hidden on documents as restrictive for select to authenticated using(id<>'22222222-2222-4222-8222-222222222222');
set local role authenticated;
select pg_temp.ok((select count(*)=1 and bool_and(coverage='partial' and document_id='11111111-1111-4111-8111-111111111111') from record_resolve_document_keys(array['desk-record:["national","Parliamentary Question Database","234"]'])),'visible subset is partial and hidden ID is not disclosed');
reset role;
create temp table removal as select jsonb_build_object('tier',tier,'feature',feature,'row_key',row_key,'document_id',document_id,'expected_fingerprint',fingerprint,'decision_id',decision_id,'evidence_sha256',evidence_sha256) p from record_document_links where document_id='22222222-2222-4222-8222-222222222222';
select pg_temp.refused($q$select record_mapping_remove(p||jsonb_build_object('evidence_sha256',repeat('f',64))) from removal$q$,'conflict');
select pg_temp.refused($q$select record_mapping_remove(p||jsonb_build_object('expected_fingerprint',repeat('f',64))) from removal$q$,'conflict');
select pg_temp.refused($q$select record_mapping_remove(p||'{"decision_id":"wrong"}') from removal$q$,'conflict');
select pg_temp.ok((select record_mapping_remove(p)->>'status'='removed' from removal),'approved removal removes exact link');
select pg_temp.ok((select record_mapping_remove(p)->>'status'='already_absent' from removal),'removal rerun is idempotent');
select pg_temp.ok((select count(*)=1 and bool_and(expected_link_count=1) from record_document_links where row_key='234'),'removal recounts surviving sibling');
select pg_temp.ok((select count(*) from documents)=2 and (select count(*) from document_chunks)=2,'removal preserves documents and chunks');
select pg_temp.ok(not has_function_privilege('authenticated','record_mapping_remove(jsonb)','EXECUTE') and not has_function_privilege('anon','record_mapping_remove(jsonb)','EXECUTE'),'removal service-only');
set local role authenticated;
select pg_temp.ok((select count(*)=1 and bool_and(coverage='full') from record_resolve_document_keys(array['desk-record:["national","Parliamentary Question Database","234"]'])),'remaining visible sibling is full after approved removal');
reset role;
rollback to mixed_visibility;
savepoint stale_row;
update public.desk_rows set row=row||'{"house":"Rajya Sabha"}' where row_key='234' and tier='national';
set local role authenticated;
select pg_temp.ok((select bool_and(coverage='held' and document_id is null) from public.record_resolve_document_keys(array['desk-record:["national","Parliamentary Question Database","234"]'])),'stale reviewed row held');
reset role;
rollback to stale_row;
update public.document_chunks set embedding=null;
set local role authenticated;
select pg_temp.ok((select bool_and(coverage='incomplete' and document_id is null) from public.record_resolve_document_keys(array['desk-record:["national","Parliamentary Question Database","234"]'])),'missing vector is not full text');
select pg_temp.ok((select count(*)=1 and bool_and(coverage='incomplete' and document_id is null) from record_resolve_document_keys(array['document-id:11111111-1111-4111-8111-111111111111'])),'direct document with missing vector incomplete');
reset role;
update public.document_chunks set embedding=array_fill(0.01::real,array[1536])::vector;
-- Permission parity: resolver is SECURITY INVOKER and cannot leak a forbidden document.
create policy fixture_hidden on public.documents as restrictive for select to authenticated using(false);
set local role authenticated;
select pg_temp.ok((select count(*) from public.record_document_links)=0,'hidden document link cannot be inspected directly');
select pg_temp.ok((select bool_and(document_id is null and coverage='unmapped') from public.record_resolve_document_keys(array['desk-record:["national","Parliamentary Question Database","234"]'])),'RLS document not exposed');
select pg_temp.ok((select count(*)=1 and bool_and(coverage='unavailable' and document_id is null) from record_resolve_document_keys(array['document-id:11111111-1111-4111-8111-111111111111'])),'direct hidden document unavailable without ID disclosure');
reset role;
rollback;
