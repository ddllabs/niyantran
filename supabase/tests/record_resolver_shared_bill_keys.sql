-- F314: a Bills row on a shared bill key resolves only to its own bill's documents. Disposable fixture. run.sh uses
-- the ingest_bills_admission_rules chain, then 20261110180000_record_resolver_shared_bill_keys (as a non-superuser).
-- Spec: docs/specs/2026-11-10-shared-bill-keys.md. Without the migration, the Constitution row is shown the Bills of
-- Lading document, so the fixture fails (the vacuity check).
\set ON_ERROR_STOP on
begin;
set search_path=public,extensions;
create function pg_temp.ok(v boolean,label text) returns void language plpgsql as $$begin
 if v is distinct from true then raise exception 'FAIL %',label; end if; raise notice 'PASS %',label; end$$;

-- Key bill:2025:111 names two bills (as on NTER); bill:2020:5 one bill, whose document is titled as its Act;
-- bill:2001:7 names two bills, one of them on two rows (both Houses); bill:2003:9 two bills and a document named as neither;
-- bill:2004:3 one named row and one with no name; bill:2006:4 two bills, one named only by its row's title. A row in another
-- feature also holds bill:2020:5 and must not make that key shared.
insert into public.desk_rows(tier,feature,row_key,row,record_text,snapshot_at,document_key) values
 ('national','Bill Passage Probability Index','111-a','{"bill_name":"THE CONSTITUTION (ONE HUNDRED AND THIRTIETH AMENDMENT) BILL, 2025","house":"Lok Sabha"}','c',now(),'bill:2025:111'),
 ('national','Bill Passage Probability Index','111-b','{"bill_name":"THE BILLS OF LADING BILL, 2025","house":"Lok Sabha"}','b',now(),'bill:2025:111'),
 ('national','Bill Passage Probability Index','5-a','{"bill_name":"THE X BILL, 2020","house":"Lok Sabha"}','x',now(),'bill:2020:5'),
 ('national','Bill Passage Probability Index','7-ls','{"bill_name":"THE Y BILL, 2001","house":"Lok Sabha"}','y',now(),'bill:2001:7'),
 ('national','Bill Passage Probability Index','7-rs','{"bill_name":"The Y Bill,2001","house":"Rajya Sabha"}','y',now(),'bill:2001:7'),
 ('national','Bill Passage Probability Index','7-z','{"bill_name":"THE Z BILL, 2001","house":"Lok Sabha"}','z',now(),'bill:2001:7'),
 ('national','Bill Passage Probability Index','9-p','{"bill_name":"THE P BILL, 2003","house":"Lok Sabha"}','p',now(),'bill:2003:9'),
 ('national','Bill Passage Probability Index','9-q','{"bill_name":"THE Q BILL, 2003","house":"Lok Sabha"}','q',now(),'bill:2003:9'),
 ('national','Bill Passage Probability Index','3-n','{}','n',now(),'bill:2004:3'),
 ('national','Bill Passage Probability Index','3-m','{"bill_name":"THE M BILL, 2004"}','m',now(),'bill:2004:3'),
 ('national','Bill Passage Probability Index','4-t','{"title":"THE T BILL, 2006"}','t',now(),'bill:2006:4'),
 ('national','Bill Passage Probability Index','4-u','{"bill_name":"THE U BILL, 2006"}','u',now(),'bill:2006:4'),
 ('national','Other Feature','5-other','{"bill_name":"THE OTHER BILL, 2020"}','o',now(),'bill:2020:5');
insert into public.documents(id,source_key,title,desk_tier,desk_feature,content_sha256,ocr_text,chunker_version,indexed_at,metadata) values
 ('f3140000-0000-4000-8000-000000000001','f314-const','THE CONSTITUTION (ONE HUNDRED AND THIRTIETH AMENDMENT) BILL, 2025','national','Bill Passage Probability Index',repeat('1',64),'c',4,null,'{"document_key":"bill:2025:111"}'),
 ('f3140000-0000-4000-8000-000000000002','f314-lading','The Bills of Lading Bill, 2025','national','Bill Passage Probability Index',repeat('2',64),'b',4,now(),'{"document_key":"bill:2025:111"}'),
 ('f3140000-0000-4000-8000-000000000003','f314-x','The X Act, 2020','national','Bill Passage Probability Index',repeat('3',64),'x',4,now(),'{"document_key":"bill:2020:5"}'),
 ('f3140000-0000-4000-8000-000000000004','f314-y','THE Y BILL, 2001','national','Bill Passage Probability Index',repeat('4',64),'y',4,now(),'{"document_key":"bill:2001:7"}'),
 ('f3140000-0000-4000-8000-000000000005','f314-z','THE Z BILL, 2001','national','Bill Passage Probability Index',repeat('5',64),'z',4,now(),'{"document_key":"bill:2001:7"}'),
 ('f3140000-0000-4000-8000-000000000006','f314-r','THE R BILL, 2003','national','Bill Passage Probability Index',repeat('6',64),'r',4,now(),'{"document_key":"bill:2003:9"}'),
 ('f3140000-0000-4000-8000-000000000007','f314-m','THE M BILL, 2004','national','Bill Passage Probability Index',repeat('7',64),'m',4,now(),'{"document_key":"bill:2004:3"}'),
 ('f3140000-0000-4000-8000-000000000008','f314-t','The T Bill, 2006','national','Bill Passage Probability Index',repeat('8',64),'t',4,now(),'{"document_key":"bill:2006:4"}'),
 ('f3140000-0000-4000-8000-000000000009','f314-u','The U Bill, 2006','national','Bill Passage Probability Index',repeat('9',64),'u',4,now(),'{"document_key":"bill:2006:4"}');
insert into public.document_chunks(document_id,desk_tier,desk_feature,chunk_hash,chunk_index,char_from,char_to,content,chunker_version,embedding)
 select d.id,d.desk_tier,d.desk_feature,repeat('c',63)||right(d.id::text,1),0,0,1,'t',4,array_fill(0.01::real,array[1536])::vector
   from public.documents d where d.source_key like 'f314-%' and d.indexed_at is not null;

create function pg_temp.r(row_key text) returns table(document_id uuid,coverage text) language sql as $$
 select x.document_id,x.coverage from public.record_resolve_document_keys(
   array['desk-record:'||jsonb_build_array('national','Bill Passage Probability Index',row_key)::text]) x $$;
create function pg_temp.docs(row_key text) returns text language sql as $$
 select coalesce(string_agg(right(document_id::text,1),',' order by document_id),'') from pg_temp.r(row_key) $$;
create function pg_temp.cov(row_key text) returns text language sql as $$ select min(coverage) from pg_temp.r(row_key) $$;

-- The resolver writes bill_norm's expression out (signed-in callers may not execute bill_norm): it appears three
-- times in the function, and the same expression agrees with bill_norm on awkward names.
create function pg_temp.norm_copy(v text) returns text language sql as
 $$ select regexp_replace(lower(regexp_replace(coalesce(v,''),',?\s*[0-9]{4}\s*\.?\s*$','')),'[^a-z0-9]+','','g') $$;
select pg_temp.ok((select (length(src)-length(replace(src,frag,'')))/length(frag)=3
   from (select pg_get_functiondef('public.record_resolve_document_keys(text[])'::regprocedure) src,
                $f$',?\s*[0-9]{4}\s*\.?\s*$','')),'[^a-z0-9]+','','g')$f$ frag) x),
  'the resolver holds bill_norm''s expression three times');
select pg_temp.ok((select bool_and(pg_temp.norm_copy(v) is not distinct from public.bill_norm(v)) from unnest(array[
   null,'','The X Bill, 2020','THE X BILL,2020.','The X Bill 2020 ','a'||chr(9)||'b, 2020','The Y Bill, 2001 2002',
   'The Z (Amendment) Bill, 1999','Bill, 20201','विधेयक, 2020','O''Brien\Bill, 2010']) v),
  'that expression agrees with bill_norm');

set local role authenticated;
select pg_temp.ok(pg_temp.docs('111-b')='2' and pg_temp.cov('111-b')='full','the Bills of Lading row: its own document, full');
select pg_temp.ok(pg_temp.docs('111-a')='' and pg_temp.cov('111-a')='registered',
  'the Constitution row is not shown the Bills of Lading document; its own held document reads registered');
select pg_temp.ok(pg_temp.docs('5-a')='3' and pg_temp.cov('5-a')='full','a key only one bill uses resolves as before, titles aside');
select pg_temp.ok(pg_temp.docs('7-ls')='4' and pg_temp.docs('7-rs')='4','one bill on two rows (spacing and year aside) keeps its document on both');
select pg_temp.ok(pg_temp.docs('7-z')='5','the other bill on that key gets only its own document');
select pg_temp.ok(pg_temp.docs('9-p')='' and pg_temp.cov('9-p')='unmapped' and pg_temp.docs('9-q')='',
  'a document named as neither bill on a shared key is shown to neither');
select pg_temp.ok(pg_temp.docs('3-n')='' and pg_temp.cov('3-n')='unmapped','a row with no name on a shared key gets no document');
select pg_temp.ok(pg_temp.docs('3-m')='7' and pg_temp.cov('3-m')='full','a named row beside an unnamed one is not shared');
select pg_temp.ok(pg_temp.docs('4-t')='8' and pg_temp.docs('4-u')='9','a row named only by its title is matched by it');
select pg_temp.ok(pg_temp.docs('5-a')='3','a row in another feature on the same key does not make it shared');
reset role;
select pg_temp.ok((select provolatile='s' and not prosecdef from pg_proc where oid='public.record_resolve_document_keys(text[])'::regprocedure),
  'still stable and security invoker');
select pg_temp.ok(not has_function_privilege('anon','public.record_resolve_document_keys(text[])','execute')
  and has_function_privilege('authenticated','public.record_resolve_document_keys(text[])','execute'),'grants unchanged');
rollback;
