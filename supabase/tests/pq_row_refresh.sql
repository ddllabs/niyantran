-- F266: the reviewed refresh of the stored question rows re-binds their links in one transaction.
-- Disposable fixture; run.sh uses the pq_admission_links chain and inlines scripts/pq-row-refresh.sql.
\set ON_ERROR_STOP on
set search_path = public, extensions;
create function pg_temp.ok(v boolean, label text) returns void language plpgsql as $$begin
 if v is distinct from true then raise exception 'FAIL %', label; end if; raise notice 'PASS %', label; end$$;

-- Rows as the loader stored them before F266: session and Has answer "Not reported".
insert into public.desk_rows(tier,feature,row_key,row,record_text,snapshot_at)
select 'national','Parliamentary Question Database',k,jsonb_build_object('id',k,'house','Lok Sabha','date','2026-04-02','ministry','MICRO, SMALL AND MEDIUM ENTERPRISES',
  'subject','Expanding Khadi Production in Tamil Nadu','mp_name',mp,'session','Not reported','has_answer','Not reported','has_answer_key','unknown',
  'source_url','https://sansad.in/getFile/loksabhaquestions/annex/187/AU6302_KIQmzb.pdf?source=pqals'),'Khadi',now()
from (values ('7820','Mani A'),('7821','Second Member')) v(k,mp);
insert into public.desk_rows(tier,feature,row_key,row,record_text,snapshot_at) values
 ('national','Parliamentary Question Database','9',jsonb_build_object('id','9','house','Lok Sabha','session','Not reported','has_answer','Not reported','has_answer_key','unknown',
   'source_url','https://sansad.in/getFile/loksabhaquestions/annex/187/AU4229_uPmDeg.pdf?source=pqals'),'BharatNet',now()),
 ('national','Parliamentary Question Database','10',jsonb_build_object('id','10','house','Lok Sabha','session','Not reported','has_answer','Not reported','has_answer_key','unknown',
   'source_url','https://example.org/not-an-answer.pdf'),'Other',now());

-- One admitted, indexed answer linked to both member rows (the F266 admission path).
create temp table req as select (select jsonb_build_object('payload',payload,'payload_sha256',encode(sha256(convert_to(payload,'UTF8')),'hex'),
  'expected',jsonb_build_array(jsonb_build_object('chunk_hash',repeat('c',64),'embed_hash',repeat('d',64),'chunk_index',0,'source_kind','document',
    'char_from',0,'char_to',length(t),'content',t,'token_count',12,'chunker_version',4)),'pages','[]'::jsonb,'sections','[]'::jsonb)
 from (select t, jsonb_build_object('source_key',repeat('a',40),'title','Khadi','text',t,'text_sha256',encode(sha256(convert_to(t,'UTF8')),'hex'),
   'desk_tier','national','desk_feature','Parliamentary Question Database',
   'file_url','https://sansad.in/getFile/loksabhaquestions/annex/187/AU6302_KIQmzb.pdf?source=pqals',
   'citation',jsonb_build_object('house','Lok Sabha','subject','Expanding Khadi Production in Tamil Nadu','ministry','MICRO, SMALL AND MEDIUM ENTERPRISES','answered_on','02.04.2026'),
   'review',jsonb_build_object('status','eligible'))::text payload
  from (select 'LOK SABHA ANSWER A written answer.'::text t) x) y) p;
select public.ingest_register_text((select p from req));
create temp table claim as select * from public.ingest_claim(1, interval '5 minutes');
select public.ingest_text_commit(id,claim_token,jsonb_build_array(jsonb_build_object('chunk_hash',repeat('c',64),'embed_hash',repeat('d',64),'chunk_index',0,
 'source_kind','document','char_from',0,'char_to',34,'content','LOK SABHA ANSWER A written answer.','token_count',12,'chunker_version',4,
 'embedding',to_jsonb(array_fill(0.01::real,array[1536]))))) from claim;
select public.ingest_text_activate(id,claim_token,0,0) from claim;
create temp table before_links as select * from public.record_document_links;
grant select on before_links to authenticated;
select pg_temp.ok((select count(*) from before_links)=2, 'two links before');

-- Without re-binding, changed rows lose Full text: the Full text assertion below can fail.
begin;
update public.desk_rows set row = row || '{"session":"187","has_answer":"Yes","has_answer_key":"yes"}'::jsonb where row_key in ('7820','7821');
set local role authenticated;
select pg_temp.ok((select count(*) from public.record_resolve_document_keys(array[
  'desk-record:["national","Parliamentary Question Database","7820"]','desk-record:["national","Parliamentary Question Database","7821"]'])
  where coverage='full')=0, 'rows changed without re-binding are not Full text');
rollback;

-- A link that is not intact refuses the whole refresh: rows and links stay as they were.
update public.record_document_links set row_sha256 = repeat('0',64) where row_key = '7820';
\set ON_ERROR_STOP off
\i scripts/pq-row-refresh.sql
\set ON_ERROR_STOP on
select pg_temp.ok((select row->>'session'='Not reported' from public.desk_rows where row_key='7820')
  and (select row->>'session'='Not reported' from public.desk_rows where row_key='9')
  and (select count(*) from public.record_document_links)=2
  and (select row_sha256=repeat('0',64) from public.record_document_links where row_key='7820'), 'a broken link aborts the whole refresh');
update public.record_document_links l set row_sha256 = b.row_sha256 from before_links b where l.row_key = b.row_key and l.document_id = b.document_id;

-- A load that changed these rows would leave the links held; the refresh re-binds them.
\i scripts/pq-row-refresh.sql

select pg_temp.ok((select row->>'session'='187' and row->>'has_answer'='Yes' and row->>'has_answer_key'='yes'
  from public.desk_rows where row_key='7820'), 'row refreshed from its answer URL');
select pg_temp.ok((select row->>'session'='187' from public.desk_rows where row_key='9'), 'unlinked rows refreshed too');
select pg_temp.ok((select row->>'session'='Not reported' and row->>'has_answer'='Not reported' from public.desk_rows where row_key='10'), 'rows without an answer URL untouched');
select pg_temp.ok((select count(*) from public.record_document_links n join before_links b using (tier,feature,row_key,document_id)
  where n.decision_id=b.decision_id and n.evidence_sha256=b.evidence_sha256 and n.created_at=b.created_at and n.row_sha256<>b.row_sha256)=2,
  'same links, same decision and time, bound to the new rows');
set role authenticated;
select pg_temp.ok((select count(*) from public.record_resolve_document_keys(array[
  'desk-record:["national","Parliamentary Question Database","7820"]','desk-record:["national","Parliamentary Question Database","7821"]'])
  where coverage='full')=2, 'both rows still Full text');
reset role;

-- Re-running changes nothing.
create temp table after_first as select * from public.record_document_links;
\i scripts/pq-row-refresh.sql
select pg_temp.ok((select count(*) from public.record_document_links n join after_first a using (tier,feature,row_key,document_id)
  where n.fingerprint=a.fingerprint and n.row_sha256=a.row_sha256)=2, 'second run is a no-op');
