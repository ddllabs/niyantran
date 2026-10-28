-- Disposable local fixture. Chain: record_document_associations + admin_corpus_readiness.
\set ON_ERROR_STOP on
begin;
set search_path=public,extensions;
create function pg_temp.ok(v boolean,label text) returns void language plpgsql as $$begin
 if v is distinct from true then raise exception 'FAIL %',label; end if; raise notice 'PASS %',label; end$$;
create function pg_temp.refused(q text,pattern text) returns void language plpgsql as $$begin
 begin execute q; exception when others then
 if position(pattern in sqlerrm)=0 then raise exception 'wrong refusal: %',sqlerrm; end if; return; end;
 raise exception 'accepted unsafe operation: %',q; end$$;
select pg_temp.ok(to_regprocedure('public.admin_corpus_readiness(jsonb)') is not null,'readiness migration installed');
insert into auth.users(id,email) values('00000000-0000-4000-8000-0000000fed01','reader@example.test'),('00000000-0000-4000-8000-0000000fed02','admin@example.test');
update user_profiles set role='admin' where user_id='00000000-0000-4000-8000-0000000fed02';
select pg_temp.ok(not has_function_privilege('anon','public.admin_corpus_readiness(jsonb)','execute'),'anonymous cannot inspect');
select pg_temp.ok(not has_function_privilege('service_role','public.admin_corpus_readiness(jsonb)','execute'),'service token not a user');
select pg_temp.ok(not has_function_privilege('authenticated','public.admin_readiness_document(uuid)','execute'),'private helper not API');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000fed01',true);
select pg_temp.refused($q$select admin_corpus_readiness('{"kind":"records","tier":"national","feature":"Parliamentary Question Database"}')$q$,'platform admins only');
reset role;
insert into desk_rows(tier,feature,row_key,row,record_text,snapshot_at)
 select 'national','Parliamentary Question Database',lpad(n::text,3,'0'),jsonb_build_object('subject','Shared answer','source_url','https://sansad.in/a.pdf'),'Question',now() from generate_series(1,102)n;
insert into documents(id,source_key,title,file_url,desk_tier,desk_feature,content_sha256,ocr_text,indexed_at,metadata) values
 ('11111111-1111-4111-8111-111111111111','fixture-linked','Answer','https://sansad.in/a.pdf','national','Parliamentary Question Database',repeat('a',64),'Answer',now(),'{"review":{"decision_id":"cohort-one"}}'),
 ('22222222-2222-4222-8222-222222222222','fixture-unassociated','Unassociated',null,'national','Parliamentary Question Database',repeat('a',64),'Answer',null,'{}');
insert into document_chunks(document_id,chunk_hash,chunk_index,char_from,char_to,content,chunker_version,embedding)
 values('11111111-1111-4111-8111-111111111111',repeat('b',64),0,0,6,'Answer',4,array_fill(0.01::real,array[1536])::vector);
select record_mapping_apply(jsonb_build_object('tier',r.tier,'feature',r.feature,'row_key',r.row_key,'document_id','11111111-1111-4111-8111-111111111111','role','answer','version','1','decision_id','local','approver','Fixture','evidence_sha256',repeat('c',64),'expected_fingerprint',record_mapping_fingerprint(r.tier,r.feature,r.row_key,'11111111-1111-4111-8111-111111111111')))
 from desk_rows r where r.row_key in('001','002');
create temp table base(q jsonb);insert into base values('{"kind":"records","tier":"national","feature":"Parliamentary Question Database"}');
grant select on base to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000fed02',true);
create temp table first_page as select admin_corpus_readiness(q) result from base;
select pg_temp.ok((select jsonb_array_length(result->'items')=50 and (result->>'has_more')::boolean and not result?'total' and result->>'visibility'='admin' from first_page),'default page bounded with no whole-corpus total');
select pg_temp.ok((select result#>>'{items,0,state}'='privileged_ready' and result#>>'{items,0,documents,0,association_kind}'='ordinary' and result#>>'{items,1,documents,0,document_id}'='11111111-1111-4111-8111-111111111111' from first_page),'null legacy key and shared answer retain ordinary links');
select pg_temp.ok((select result#>>'{items,2,state}'='unmapped' from first_page),'unmapped remains technical diagnostic');
select pg_temp.ok((select admin_corpus_readiness(q||jsonb_build_object('cursor',result->>'next_cursor'))#>>'{items,0,row_key}'='051' from base,first_page),'keyset next page starts after last row');
select pg_temp.ok((select jsonb_array_length(admin_corpus_readiness(q||'{"limit":100}')->'items')=100 from base),'maximum page100 accepted');
select pg_temp.refused($q$select admin_corpus_readiness(q||'{"limit":101}') from base$q$,'invalid readiness bounds');
select pg_temp.refused($q$select admin_corpus_readiness(q||'{"cohort":"not-a-record-filter"}') from base$q$,'invalid readiness bounds');
select pg_temp.refused($q$select admin_corpus_readiness(q||jsonb_build_object('feature','Other','cursor',result->>'next_cursor')) from base,first_page$q$,'cursor filter mismatch');
select pg_temp.ok((select jsonb_array_length(admin_corpus_readiness(q||'{"ids":["002"]}')->'items')=1 from base),'exact row filter');
select pg_temp.ok((select admin_corpus_readiness(q||'{"kind":"documents","cohort":"cohort-one"}')#>>'{items,0,document_id}'='11111111-1111-4111-8111-111111111111' from base),'exact document cohort');
select pg_temp.ok((select admin_corpus_readiness(q||'{"kind":"documents","ids":["22222222-2222-4222-8222-222222222222"]}')#>>'{items,0,association_kind}'='unassociated' from base),'no links is not proof of intentional standalone');
reset role;
-- An inconsistent expected sibling count cannot establish complete readiness.
savepoint missing_sibling;
update record_document_links set expected_link_count=2 where row_key='001';
set local role authenticated;
select pg_temp.ok((select admin_corpus_readiness(q||'{"ids":["001"]}')#>>'{items,0,state}'='held' from base),'missing expected sibling held');
reset role;
rollback to missing_sibling;
-- Missing embeddings and stale mapping remain separate diagnostics.
update document_chunks set embedding=null;
set local role authenticated;
select pg_temp.ok((select admin_corpus_readiness(q||'{"ids":["001"]}')#>>'{items,0,documents,0,index_state}'='incomplete' from base),'missing vectors do not report ready');
reset role;
update documents set metadata=metadata||'{"changed":true}' where id='11111111-1111-4111-8111-111111111111';
set local role authenticated;
select pg_temp.ok((select admin_corpus_readiness(q||'{"ids":["001"]}')#>>'{items,0,state}'='held' from base),'stale mapping held');
reset role;
-- Canonical Law attachment is independent from legacy document keys and can be hidden.
insert into documents(id,source_key,title,desk_tier,desk_feature,content_sha256,ocr_text) values('33333333-3333-4333-8333-333333333333','law-fixture','Law','law','NCLT / NCLAT (Insolvency)',repeat('d',64),'Order');
insert into law_records(id,row_key,record_type,forum,order_date,source_url,row_data,visible) values('44444444-4444-4444-8444-444444444444','law-fixture','tribunal_order','NCLT','2026-01-01','https://ibbi.gov.in/a.pdf','{}',false);
insert into law_document_links(document_id,record_id,text_sha256,evidence_sha256) values('33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444',repeat('d',64),repeat('d',64));
set local role authenticated;
select pg_temp.ok((select j#>>'{items,0,association_kind}'='law' and j#>>'{items,0,publication_state}'='hidden' from (select admin_corpus_readiness('{"kind":"documents","tier":"law","feature":"NCLT / NCLAT (Insolvency)"}') j)x),'hidden canonical Law link never called standalone');
reset role;
-- Readiness did not mutate documents, links, jobs or corpus content.
select pg_temp.ok((select count(*) from documents)=3 and (select count(*) from record_document_links)=2 and (select count(*) from ingest_jobs)=0,'inspection creates no corpus or queue writes');

-- Five records with24 sources each cross the global100-document inspection budget.
insert into desk_rows(tier,feature,row_key,row,record_text,snapshot_at)
 select 'national','Budget fixture',n::text,jsonb_build_object('source_url','https://sansad.in/budget-'||n||'.pdf'),'Budget',now() from generate_series(1,5)n;
insert into documents(id,source_key,title,file_url,desk_tier,desk_feature,content_sha256,ocr_text)
 select md5('budget-'||n)::uuid,'budget-'||n,'Budget','https://sansad.in/budget-'||((n-1)/24+1)||'.pdf','national','Budget fixture',repeat('f',64),'Budget' from generate_series(1,120)n;
insert into record_document_links(tier,feature,row_key,document_id,role,version,source_url,text_sha256,row_sha256,document_identity_sha256,expected_link_count,fingerprint,decision_id,approver,evidence_sha256)
 select r.tier,r.feature,r.row_key,d.id,'document','1',d.file_url,d.content_sha256,
  encode(sha256(convert_to(r.row::text,'UTF8')),'hex'),encode(sha256(convert_to(jsonb_build_object('source_key',d.source_key,'metadata',d.metadata)::text,'UTF8')),'hex'),24,repeat('f',64),'budget','Fixture',repeat('f',64)
 from desk_rows r join documents d on d.file_url=r.row->>'source_url' where r.feature='Budget fixture';
set local role authenticated;
select pg_temp.ok((select j#>>'{items,4,state}'='inspection_limited'
 and (select count(*) from jsonb_array_elements(j->'items') i cross join lateral jsonb_array_elements(i->'documents') d where d->>'index_state'<>'inspection_limited')=100
 from (select admin_corpus_readiness('{"kind":"records","tier":"national","feature":"Budget fixture"}')j)x),'global inspection budget yields unknown after100 distinct documents');
reset role;
rollback;
