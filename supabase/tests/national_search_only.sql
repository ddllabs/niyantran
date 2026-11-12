-- F307 (T2): National desks admitted search-only, Regulatory first. Disposable fixture. run.sh uses the
-- ingest_bills_admission_rules chain, then 20261113090000_national_search_only (as a non-superuser).
-- Spec: docs/specs/2026-11-12-regulatory-screen.md, "Admission".
--
-- It first runs every case of the Bills rules, of Bills, and of questions and Law (through their includes) on the
-- replaced functions, so the three live paths are proved unchanged. One included expectation is rewritten, on purpose,
-- by run.sh's include: ingest_register_batch.sql sends a question that claims Regulatory's spelling to the question
-- policy and expected no_adapter; the desk now has an adapter, so the policy refuses it as collection_not_admitted.
-- Then every search-only outcome: admitted with no link and its basis stored, each new refusal, the policy gates, the
-- locks, the indexes, the single-document path, privileges and cost.
\i supabase/tests/ingest_bills_admission_rules.sql

-- A Regulatory pack record (synthetic): the corpus spelling, a pack suggested key, an official RBI file, a basis.
-- g picks the source key (through pq's question number) and the text; over replaces fields; t replaces the text.
create function pg_temp.rg(g int, over jsonb default '{}', t text default null, pages int default 1) returns jsonb language sql as $$
 select pg_temp.pq(7000 + g, jsonb_build_object('desk_feature','Regulatory Body Watch (RBI SEBI TRAI CCI)','title','Fixture circular ' || g,
   'file_url','https://rbidocs.rbi.org.in/rdocs/notification/PDFs/FX' || g || '.PDF','file_name','FX' || g || '.PDF',
   'document_key_suggested','reg:rbi:fx' || g,'doc_type','regulatory','licence_class','govt_material_confirm_counsel',
   'completeness_basis','page_check',
   'citation',jsonb_build_object('kind','regulatory','regulator','RBI','regulator_name','Reserve Bank of India',
     'title','Fixture circular ' || g,'date','2025-04-01','source','rbi.org.in')) || over,
   coalesce(t, 'RESERVE BANK OF INDIA. FIXTURE CIRCULAR ' || g || '. The text of a synthetic circular.'), pages) $$;
create function pg_temp.doc_of(q jsonb) returns public.documents language sql as $$
 select d from public.documents d where d.source_key = (q->>'payload')::jsonb->>'source_key' $$;
-- Is the transaction-scoped advisory lock of this admission value (namespace 724893) held by this session?
create function pg_temp.locked(v text) returns boolean language sql as $$
 select exists(select 1 from pg_locks l where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.objsubid = 1
   and l.classid::bigint = ((hashtextextended(v, 724893) >> 32) & 4294967295)
   and l.objid::bigint = (hashtextextended(v, 724893) & 4294967295)) $$;

-- ═══ The policy: one adapter for the corpus spelling ══
select pg_temp.ok(pg_temp.policy('national-regulatory', jsonb_build_object(
  'admitted',jsonb_build_array(jsonb_build_object('desk_tier','national','desk_feature','Regulatory Body Watch (RBI SEBI TRAI CCI)',
    'adapter','national_search_only')),
  'licence_classes',jsonb_build_array('govt_material_confirm_counsel'),'require_page_count',true))->>'active' = 'true',
  'a search-only policy is approved for the corpus spelling');
select pg_temp.refused($q$select pg_temp.policy('reg-slash', jsonb_build_object('admitted',jsonb_build_array(jsonb_build_object(
  'desk_tier','national','desk_feature','Regulatory Body Watch (RBI/SEBI/TRAI/CCI)','adapter','national_search_only'))))$q$, 'invalid admitted desk');
select pg_temp.refused($q$select pg_temp.policy('reg-wrong-adapter', jsonb_build_object('admitted',jsonb_build_array(jsonb_build_object(
  'desk_tier','national','desk_feature','Regulatory Body Watch (RBI SEBI TRAI CCI)','adapter','national_bills'))))$q$, 'invalid admitted desk');
select pg_temp.refused($q$select pg_temp.policy('pq-search-only', jsonb_build_object('admitted',jsonb_build_array(jsonb_build_object(
  'desk_tier','national','desk_feature','Parliamentary Question Database','adapter','national_search_only'))))$q$, 'invalid admitted desk');
select pg_temp.ok(public.ingest_admit_adapter('{"desk_tier":"national","desk_feature":"Regulatory Body Watch (RBI SEBI TRAI CCI)"}') = 'national_search_only'
   and public.ingest_admit_adapter('{"desk_tier":"national","desk_feature":"Regulatory Body Watch (RBI/SEBI/TRAI/CCI)"}') is null
   and public.ingest_admit_adapter('{"desk_tier":"state","desk_feature":"Regulatory Body Watch (RBI SEBI TRAI CCI)"}') is null,
  'the adapter names the corpus spelling on the National tier only');
select pg_temp.ok(public.ingest_admit_tier(jsonb_build_object('source_key',repeat('a',40),'desk_tier','national','desk_feature','Regulatory Body Watch (RBI SEBI TRAI CCI)')) = 'national'
   and public.ingest_admit_tier(jsonb_build_object('source_key','reg:rbi:x','desk_tier','national','desk_feature','Regulatory Body Watch (RBI SEBI TRAI CCI)')) is null
   and public.ingest_admit_tier(jsonb_build_object('source_key',repeat('A',40),'desk_tier','national','desk_feature','Regulatory Body Watch (RBI SEBI TRAI CCI)')) is null,
  'the tier: National for a 40-hex source_key only');

-- ═══ Admission, with no link ══════════════════════════
create temp table links0 as select count(*) n from public.record_document_links;
-- A listing row in the listing spelling that names the same file: search-only links nothing even so.
insert into public.desk_rows(tier,feature,row_key,row,record_text,snapshot_at)
 values ('national','Regulatory Body Watch (RBI/SEBI/TRAI/CCI)','1',
  jsonb_build_object('id','1','title','Fixture circular 1','source_url','https://rbidocs.rbi.org.in/rdocs/notification/PDFs/FX1.PDF'),'Fixture circular 1',now());
create temp table reg1 as select pg_temp.reg('national-regulatory', pg_temp.rg(1)) res;
select pg_temp.ok(res = jsonb_build_object('source_key',(pg_temp.rg(1)->>'payload')::jsonb->>'source_key',
    'outcome','admitted','document_id',(pg_temp.doc_of(pg_temp.rg(1))).id,'job_id',(select j.id from public.ingest_jobs j where j.document_id = (pg_temp.doc_of(pg_temp.rg(1))).id),
    'job_status','queued','links',null),
  'a Regulatory record is admitted, its job queued, with no link count') from reg1;
select pg_temp.ok((select d.desk_tier = 'national' and d.desk_feature = 'Regulatory Body Watch (RBI SEBI TRAI CCI)'
    and d.file_url = 'https://rbidocs.rbi.org.in/rdocs/notification/PDFs/FX1.PDF' and d.metadata->>'completeness_basis' = 'page_check'
    and d.metadata->>'document_key_suggested' = 'reg:rbi:fx1' and d.metadata->>'origin' = 'supplied-text' and d.content_sha256 = (pg_temp.rg(1)->>'payload')::jsonb->>'text_sha256'
    and not (d.metadata ? 'bill_number') from pg_temp.doc_of(pg_temp.rg(1)) d),
  'stored under the corpus spelling with its file_url, suggested key and completeness basis');
select pg_temp.ok((select count(*) from public.ingest_text_inputs t where t.document_id = (pg_temp.doc_of(pg_temp.rg(1))).id) = 1,
  'its payload is kept for the worker');
select pg_temp.ok(pg_temp.links(pg_temp.rg(1)) = 0 and (select count(*) from public.record_document_links) = (select n from links0),
  'no record_document_links row, not even for a listing row naming the same file');
select pg_temp.ok(pg_temp.locked('reg:rbi:fx1') and pg_temp.locked('https://rbidocs.rbi.org.in/rdocs/notification/PDFs/FX1.PDF'),
  'registration locked the suggested key and the file_url');
-- No file_url: the source_key stands in for the URL lock, and the basis may be density_only.
select pg_temp.ok(pg_temp.reg('national-regulatory', pg_temp.rg(2, '{"file_url":null,"file_name":null,"completeness_basis":"density_only"}'))->>'outcome' = 'admitted',
  'a record with no file_url is admitted on the density-only basis');
select pg_temp.ok((select d.file_url is null and d.metadata->>'completeness_basis' = 'density_only'
   from pg_temp.doc_of(pg_temp.rg(2, '{"file_url":null,"file_name":null,"completeness_basis":"density_only"}')) d), 'stored with no file_url and its basis');
select pg_temp.ok(pg_temp.locked((pg_temp.rg(2)->>'payload')::jsonb->>'source_key') and pg_temp.locked('reg:rbi:fx2'),
  'with no file_url, the source_key is locked in its place');
-- With no suggested key, the source_key stands in for it.
select pg_temp.ok(pg_temp.reg('national-regulatory', pg_temp.rg(3, '{"document_key_suggested":null}'))->>'outcome' = 'admitted'
   and pg_temp.locked((pg_temp.rg(3)->>'payload')::jsonb->>'source_key'), 'a record with no suggested key is admitted, its source_key locked');
-- Each configured host; a query string and a run of dots in a file name are not segments.
select pg_temp.ok(pg_temp.reg('national-regulatory', pg_temp.rg(4, '{"file_url":"https://www.sebi.gov.in/legal/circulars/apr-2025/fixture_4.html"}'))->>'outcome' = 'admitted',
  'www.sebi.gov.in');
select pg_temp.ok(pg_temp.reg('national-regulatory', pg_temp.rg(5, '{"file_url":"https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=5&Mode=0"}'))->>'outcome' = 'admitted',
  'www.rbi.org.in with a query');
select pg_temp.ok(pg_temp.reg('national-regulatory', pg_temp.rg(6, '{"file_url":"https://rbidocs.rbi.org.in/rdocs/x/FX 6....PDF?next=/../a"}'))->>'outcome' = 'admitted',
  'dots in a file name, and dots after the query, pass');
-- The same record again: existing, nothing new written.
do $$ declare before text := pg_temp.corpus(); res jsonb; begin
 res := pg_temp.reg('national-regulatory', pg_temp.rg(1));
 perform pg_temp.ok(res->>'outcome' = 'existing' and pg_temp.corpus() = before, 'registering it again finds it: existing, nothing written');
end $$;
-- A dry run says what would happen and writes nothing.
do $$ declare q jsonb := pg_temp.rg(7); before text := pg_temp.corpus(); res jsonb; begin
 res := pg_temp.i_reg(pg_temp.batch('national-regulatory', jsonb_build_array(q)), jsonb_build_array(q), true);
 perform pg_temp.ok(res#>>'{results,0,outcome}' = 'would_admit' and pg_temp.corpus() = before, 'a dry run reports would_admit and writes nothing');
end $$;

-- ═══ The new refusals, each writing nothing ═══════════
select pg_temp.refusal('national-regulatory', pg_temp.rg(20, '{"completeness_basis":null}'), 'completeness_basis_missing');
select pg_temp.refusal('national-regulatory', pg_temp.rg(21, '{"completeness_basis":"invented"}'), 'completeness_basis_missing');
select pg_temp.refusal('national-regulatory', pg_temp.rg(22, '{"completeness_basis":"Page_check"}'), 'completeness_basis_missing');
select pg_temp.refusal('national-regulatory', pg_temp.rg(23, '{"completeness_basis":"density_only "}'), 'completeness_basis_missing');
select pg_temp.refusal('national-regulatory', pg_temp.rg(24, '{"completeness_basis":true}'), 'completeness_basis_missing');
select pg_temp.refusal('national-regulatory', pg_temp.rg(25, '{"completeness_basis":["page_check"]}'), 'completeness_basis_missing');
-- The basis is judged before the URL.
select pg_temp.refusal('national-regulatory', pg_temp.rg(26, '{"completeness_basis":null,"file_url":"http://example.com/a.pdf"}'), 'completeness_basis_missing');
select pg_temp.refusal('national-regulatory', pg_temp.rg(30 + g, jsonb_build_object('file_url', u)), 'file_url_invalid')
  from (values (1, ''), (2, 'http://rbidocs.rbi.org.in/rdocs/a.pdf'), (3, 'HTTPS://rbidocs.rbi.org.in/rdocs/a.pdf'),
    (4, 'https://RBIDOCS.rbi.org.in/rdocs/a.pdf'), (5, 'https://rbi.org.in/rdocs/a.pdf'), (6, 'https://sebi.gov.in/legal/a.html'),
    (7, 'https://rbidocs.rbi.org.in.example.com/a.pdf'), (8, 'https://example.com/https://rbidocs.rbi.org.in/a.pdf'),
    (9, 'https://user@rbidocs.rbi.org.in/a.pdf'), (10, 'https://rbidocs.rbi.org.in:443/a.pdf'), (11, 'https://rbidocs.rbi.org.in'),
    (12, 'https://rbidocs.rbi.org.in/rdocs/../a.pdf'), (13, 'https://rbidocs.rbi.org.in/rdocs/./a.pdf'),
    (14, 'https://rbidocs.rbi.org.in/rdocs/%2e%2e/a.pdf'), (15, 'https://rbidocs.rbi.org.in/rdocs/..%2fa.pdf'),
    (16, 'https://rbidocs.rbi.org.in/rdocs/x%5Ca.pdf'), (17, E'https://rbidocs.rbi.org.in/rdocs/x\\a.pdf'),
    (18, 'https://rbidocs.rbi.org.in/rdocs/..;/a.pdf'), (19, E'https://rbidocs.rbi.org.in/rdocs/x/..\r/a.pdf'),
    (20, E'https://rbidocs.rbi.org.in/rdocs/x/.\t./a.pdf'), (21, 'https://rbidocs.rbi.org.in/rdocs/x/..'),
    (22, 'https://sansad.in/getFile/loksabhaquestions/annex/187/AU6302_KIQmzb.pdf?source=pqals')) v(g, u);
-- ═══ Lengths and the key's shape ══════════════════════
-- A value an index row cannot hold must be refused by reason, never fail the call: in UTF-8 bytes, a file_url of at
-- most 2,000 and a document_key_suggested of at most 500 (the adapter measures the same).
create function pg_temp.url_of(n int, ch text default 'a') returns text language sql immutable as $$
 select 'https://rbidocs.rbi.org.in/rdocs/' || repeat(ch, n) || '.PDF' $$;   -- 37 bytes besides the repeat
select pg_temp.ok(octet_length(pg_temp.url_of(1963)) = 2000 and octet_length(pg_temp.url_of(1000, 'é')) = 2037
   and length(pg_temp.url_of(1000, 'é')) = 1037, 'the URL builders measure what they claim');
select pg_temp.ok(pg_temp.reg('national-regulatory', pg_temp.rg(220, jsonb_build_object('file_url', pg_temp.url_of(1963))))->>'outcome' = 'admitted',
  'a file_url of exactly 2,000 bytes is admitted');
select pg_temp.refusal('national-regulatory', pg_temp.rg(221, jsonb_build_object('file_url', pg_temp.url_of(1964))), 'file_url_invalid');
select pg_temp.refusal('national-regulatory', pg_temp.rg(222, jsonb_build_object('file_url', pg_temp.url_of(2900))), 'file_url_invalid');
select pg_temp.refusal('national-regulatory', pg_temp.rg(223, jsonb_build_object('file_url', pg_temp.url_of(1000, 'é'))), 'file_url_invalid');
select pg_temp.ok(pg_temp.reg('national-regulatory', pg_temp.rg(224, jsonb_build_object('document_key_suggested', 'reg:' || repeat('k', 496))))->>'outcome' = 'admitted',
  'a document_key_suggested of exactly 500 bytes is admitted');
select pg_temp.refusal('national-regulatory', pg_temp.rg(225, jsonb_build_object('document_key_suggested', 'reg:' || repeat('k', 497))), 'suggested_key_invalid');
select pg_temp.refusal('national-regulatory', pg_temp.rg(226, jsonb_build_object('document_key_suggested', 'reg:' || repeat('k', 2900))), 'suggested_key_invalid');
select pg_temp.refusal('national-regulatory', pg_temp.rg(227, jsonb_build_object('document_key_suggested', 'reg:' || repeat('é', 249))), 'suggested_key_invalid');
-- The key is a JSON string, non-blank after trimming JavaScript's whitespace; absent or null is no key.
select pg_temp.refusal('national-regulatory', pg_temp.rg(228 + g, jsonb_build_object('document_key_suggested', k)), 'suggested_key_invalid')
  from (values (0, '5'::jsonb), (1, '""'), (2, '"   "'), (3, to_jsonb(E'\t\n'::text)), (4, to_jsonb(U&'\3000'::text)), (5, to_jsonb(U&'\FEFF\00A0'::text)),
               (6, 'true'), (7, '{"k":"reg:x"}'), (8, '["reg:x"]')) v(g, k);
select pg_temp.ok(pg_temp.reg('national-regulatory', pg_temp.rg(240, '{"document_key_suggested":"5"}'))->>'outcome' = 'admitted', 'the string "5" is a key');
select pg_temp.refusal('national-regulatory', pg_temp.rg(241, '{"document_key_suggested":5}'), 'suggested_key_invalid');   -- not held: 5 is not "5"
select pg_temp.refusal('national-regulatory', pg_temp.rg(242, '{"document_key_suggested":"5"}'), 'suggested_key_held');
-- The URL is judged before the key.
select pg_temp.refusal('national-regulatory', pg_temp.rg(243, jsonb_build_object('file_url', pg_temp.url_of(2900), 'document_key_suggested', '')), 'file_url_invalid');
-- In one call, the over-long values are refused by reason and the good records around them are admitted.
do $$ declare qs jsonb := jsonb_build_array(pg_temp.rg(250), pg_temp.rg(251, jsonb_build_object('file_url', pg_temp.url_of(2900))),
   pg_temp.rg(252, jsonb_build_object('document_key_suggested', 'reg:' || repeat('k', 2900))), pg_temp.rg(253));
   before int := (select count(*) from public.documents); res jsonb; begin
 res := pg_temp.i_reg(pg_temp.batch('national-regulatory', qs), qs);
 perform pg_temp.ok((res->>'written')::boolean and res#>>'{results,0,outcome}' = 'admitted' and res#>>'{results,1,reason}' = 'file_url_invalid'
   and res#>>'{results,2,reason}' = 'suggested_key_invalid' and res#>>'{results,3,outcome}' = 'admitted'
   and (select count(*) from public.documents) = before + 2,
   'over-long values do not abort the call: ' || (res->'totals')::text);
end $$;

-- Held by a document of the feature: the file (a pack import with the same URL, or an admitted one), the suggested key.
select pg_temp.refusal('national-regulatory', pg_temp.rg(60, '{"file_url":"https://rbidocs.rbi.org.in/rdocs/notification/PDFs/FX1.PDF"}'), 'file_url_held');
insert into public.documents(source_key,title,file_url,desk_tier,desk_feature,content_sha256,ocr_text,metadata)
 values (repeat('4',40),'First pass import','https://rbidocs.rbi.org.in/rdocs/legacy/L1.PDF','national','Regulatory Body Watch (RBI SEBI TRAI CCI)',
  repeat('4',64),'x','{"document_key_suggested":"reg:rbi:legacy1"}');
select pg_temp.refusal('national-regulatory', pg_temp.rg(61, '{"file_url":"https://rbidocs.rbi.org.in/rdocs/legacy/L1.PDF"}'), 'file_url_held');
select pg_temp.refusal('national-regulatory', pg_temp.rg(62, '{"document_key_suggested":"reg:rbi:fx1"}'), 'suggested_key_held');
select pg_temp.refusal('national-regulatory', pg_temp.rg(63, '{"document_key_suggested":"reg:rbi:legacy1","file_url":null}'), 'suggested_key_held');
-- The URL is judged before the key.
select pg_temp.refusal('national-regulatory', pg_temp.rg(64, '{"document_key_suggested":"reg:rbi:fx1","file_url":"https://rbidocs.rbi.org.in/rdocs/legacy/L1.PDF"}'), 'file_url_held');
-- Another feature's document holds neither for this desk.
insert into public.documents(source_key,title,file_url,desk_tier,desk_feature,content_sha256,ocr_text,metadata)
 values (repeat('3',40),'Another desk','https://rbidocs.rbi.org.in/rdocs/other/O1.PDF','national','Parliamentary Question Database',
  repeat('3',64),'x','{"document_key_suggested":"reg:rbi:other1"}');
select pg_temp.ok(pg_temp.reg('national-regulatory', pg_temp.rg(65, '{"file_url":"https://rbidocs.rbi.org.in/rdocs/other/O1.PDF","document_key_suggested":"reg:rbi:other1"}'))->>'outcome' = 'admitted',
  'a URL or key held only by another desk does not hold');
-- One call, two records with one file or one key: the first is admitted, the second sees it.
do $$ declare qs jsonb := jsonb_build_array(pg_temp.rg(66), pg_temp.rg(67, '{"file_url":"https://rbidocs.rbi.org.in/rdocs/notification/PDFs/FX66.PDF"}'),
   pg_temp.rg(68, '{"document_key_suggested":"reg:rbi:fx66"}')); res jsonb; begin
 res := pg_temp.i_reg(pg_temp.batch('national-regulatory', qs), qs);
 perform pg_temp.ok(res#>>'{results,0,outcome}' = 'admitted' and res#>>'{results,1,reason}' = 'file_url_held'
   and res#>>'{results,2,reason}' = 'suggested_key_held', 'within one call, a later record sees an earlier one''s file and key: ' || (res->'totals')::text);
end $$;
-- The source already live, from the first corpus pass (no stored payload): legacy, as for every desk.
insert into public.documents(source_key,title,desk_tier,desk_feature,content_sha256,ocr_text)
 values ((pg_temp.rg(69)->>'payload')::jsonb->>'source_key','First pass','national','Regulatory Body Watch (RBI SEBI TRAI CCI)',repeat('2',64),'x');
select pg_temp.refusal('national-regulatory', pg_temp.rg(69), 'legacy_source');
-- One text, one document.
select pg_temp.refusal('national-regulatory', pg_temp.rg(70, '{}', 'RESERVE BANK OF INDIA. FIXTURE CIRCULAR 1. The text of a synthetic circular.'), 'duplicate_text');

-- ═══ Every other gate still runs ══════════════════════
select pg_temp.refusal('national-regulatory', pg_temp.rg(80, '{"licence_class":"gov_open"}'), 'licence_not_admitted');
select pg_temp.refusal('national-regulatory', pg_temp.rg(81, '{"servable":false}'), 'not_servable');
select pg_temp.refusal('national-regulatory', pg_temp.rg(82, '{"n_chars":1}'), 'n_chars_mismatch');
select pg_temp.refusal('national-regulatory', pg_temp.rg(83, '{}', null, 0), 'no_page_count');
select pg_temp.refusal('national-regulatory', pg_temp.rg(84, '{}', repeat('t', 2999), 5), 'thin_text');
select pg_temp.refusal('national-regulatory', pg_temp.rg(85, '{}', E'A shifted \x01 font'), 'control_codes');
-- Only the corpus spelling has an adapter; a question or a bill is not this collection's; a bad key has no tier.
select pg_temp.refusal('national-regulatory', pg_temp.rg(86, '{"desk_feature":"Regulatory Body Watch (RBI/SEBI/TRAI/CCI)"}'), 'no_adapter');
select pg_temp.refusal('national-regulatory', pg_temp.pq(74), 'collection_not_admitted');
select pg_temp.refusal('national-regulatory', pg_temp.bill(87, '{"tag":"reg"}'), 'collection_not_admitted');
select pg_temp.refusal('national-pq', pg_temp.rg(88), 'collection_not_admitted');
select pg_temp.refusal('national-bills', pg_temp.rg(89), 'collection_not_admitted');
select pg_temp.refusal('national-regulatory', pg_temp.rg(90, '{"source_key":"reg:rbi:fx90"}'), 'invalid_source_or_text_hash');

-- ═══ One way in, and no new door ══════════════════════
select pg_temp.refused($q$select public.ingest_register_text_unmapped(pg_temp.rg(91))$q$, 'search-only documents enter through a sealed batch');
select pg_temp.refused($q$select public.ingest_register_text(pg_temp.rg(92))$q$, 'search-only documents enter through a sealed batch');
-- If a race gets past the lookups, the database still holds one file per desk.
select pg_temp.refused($q$insert into public.documents(source_key,title,file_url,desk_tier,desk_feature,content_sha256,ocr_text)
  values (repeat('1',40),'Race','https://rbidocs.rbi.org.in/rdocs/notification/PDFs/FX1.PDF','national','Regulatory Body Watch (RBI SEBI TRAI CCI)',repeat('1',64),'x')$q$,
  'documents_search_only_file_url');
-- And one suggested key per desk (the backstop: a race that passed the lookup and the lock ends in this violation).
select pg_temp.refused($q$insert into public.documents(source_key,title,desk_tier,desk_feature,content_sha256,ocr_text,metadata)
  values (repeat('0',40),'Race','national','Regulatory Body Watch (RBI SEBI TRAI CCI)',repeat('0',64),'x','{"document_key_suggested":"reg:rbi:fx1"}')$q$,
  'documents_search_only_key_suggested');
-- Documents with no suggested key are not constrained by it.
insert into public.documents(source_key,title,desk_tier,desk_feature,content_sha256,ocr_text)
 values (repeat('a',8) || repeat('0',32),'No key 1','national','Regulatory Body Watch (RBI SEBI TRAI CCI)',repeat('a',64),'x'),
        (repeat('b',8) || repeat('0',32),'No key 2','national','Regulatory Body Watch (RBI SEBI TRAI CCI)',repeat('b',64),'x');
select pg_temp.ok(true, 'documents of the desk with no suggested key coexist');
select pg_temp.ok((select string_agg(indexname || ': ' || regexp_replace(indexdef, '^.* USING ', ''), ' | ' order by indexname) from pg_indexes
   where indexname in ('documents_search_only_file_url', 'documents_search_only_key_suggested'))
  = 'documents_search_only_file_url: btree (file_url) WHERE ((desk_tier = ''national''::text) AND (desk_feature = ''Regulatory Body Watch (RBI SEBI TRAI CCI)''::text) AND (file_url IS NOT NULL))'
  || ' | documents_search_only_key_suggested: btree (((metadata ->> ''document_key_suggested''::text))) WHERE ((desk_tier = ''national''::text) AND (desk_feature = ''Regulatory Body Watch (RBI SEBI TRAI CCI)''::text) AND ((metadata ->> ''document_key_suggested''::text) IS NOT NULL))'
  and (select indisunique from pg_index where indexrelid = 'public.documents_search_only_file_url'::regclass)
  and (select indisunique from pg_index where indexrelid = 'public.documents_search_only_key_suggested'::regclass),
  'a unique file_url index and a unique suggested-key index, both partial to the search-only desk');
-- Privileges are those the functions had: owner-only helpers; the batch call for the runner and service_role only.
select pg_temp.ok(not exists(select 1 from unnest(array['public.ingest_admit_tier(jsonb)','public.ingest_admit_adapter(jsonb)',
     'public.ingest_admit_document(jsonb,jsonb)','public.ingest_register_text_unmapped(jsonb)']) f,
     unnest(array['public','anon','authenticated','service_role','corpus_ingest']) r
   where has_function_privilege(r, f, 'execute')),
  'the replaced helpers and the single path stay owner-only');
select pg_temp.ok(has_function_privilege('corpus_ingest','public.ingest_register_batch(uuid,jsonb,boolean,boolean)','execute')
   and has_function_privilege('service_role','public.ingest_register_batch(uuid,jsonb,boolean,boolean)','execute')
   and not has_function_privilege('anon','public.ingest_register_batch(uuid,jsonb,boolean,boolean)','execute')
   and not has_function_privilege('authenticated','public.ingest_register_batch(uuid,jsonb,boolean,boolean)','execute')
   and (select proacl::text from pg_proc where oid = 'public.ingest_register_batch(uuid,jsonb,boolean,boolean)'::regprocedure)
       = '{nter_migrator=X/nter_migrator,corpus_ingest=X/nter_migrator,service_role=X/nter_migrator}',
  'ingest_register_batch: the runner and service_role, nothing wider');
select pg_temp.ok((select bool_and(p.prosecdef and p.proconfig = array['search_path=public, extensions, pg_temp'])
     and string_agg(p.proname || ':' || p.provolatile::text, ',' order by p.proname)
       = 'ingest_admit_adapter:i,ingest_admit_document:v,ingest_admit_tier:i,ingest_register_batch:v,ingest_register_text_unmapped:v'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('ingest_admit_tier','ingest_admit_adapter','ingest_admit_document','ingest_register_batch','ingest_register_text_unmapped')),
  'definer, search path and volatility unchanged');

-- ═══ Cost: no walk of the desk ════════════════════════
insert into public.documents(source_key,title,file_url,desk_tier,desk_feature,content_sha256,ocr_text,metadata)
select repeat('d',8) || md5('reg-seed' || g), 'Reg seed ' || g, 'https://rbidocs.rbi.org.in/rdocs/seed/S' || g || '.PDF',
       'national','Regulatory Body Watch (RBI SEBI TRAI CCI)', md5('regseedtext' || g) || md5('r' || g),'x',
       jsonb_build_object('document_key_suggested','reg:rbi:seed' || g)
  from generate_series(1,3000) g;
analyze public.documents;
create temp table reg_cost as select pg_temp.reads('documents') d0;
do $$ declare qs jsonb := (select jsonb_agg(pg_temp.rg(100 + g)) from generate_series(1,50) g); res jsonb; begin
 res := pg_temp.i_reg(pg_temp.batch('national-regulatory', qs), qs);
 perform pg_temp.ok((res#>>'{totals,admitted}')::int = 50, '50 Regulatory records admitted in one call: ' || (res->'totals')::text);
end $$;
select pg_temp.ok(pg_temp.reads('documents') - d0 < 1500, 'documents read by lookups, not walked: ' || (pg_temp.reads('documents') - d0)) from reg_cost;

rollback;
