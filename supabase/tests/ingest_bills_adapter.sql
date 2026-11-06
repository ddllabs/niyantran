-- F275: Bills through a sealed batch. Disposable fixture. run.sh uses the ingest_admission_scans chain, then
-- 20261107120000_bills_adapter (as a non-superuser). Spec: docs/specs/2026-11-07-bills-adapter.md.
--
-- It first runs every ingest_register_batch case on the replaced functions, so questions and Law are proved
-- unchanged, then every Bills outcome.
\i supabase/tests/ingest_register_batch.sql

create function pg_temp.bill_url(g int) returns text language sql immutable as $$
 select 'https://sansad.in/getFile/BillsTexts/LSBillTexts/Asintroduced/' || g || '_2025.pdf?source=legislation' $$;
create function pg_temp.bill_name(g int) returns text language sql immutable as $$
 select 'The Fixture Measure Number ' || g || ' Bill, 2025' $$;
-- A bill record: a question-shaped request with a bill's identity over it.
create function pg_temp.bill(g int, over jsonb default '{}', cite jsonb default '{}') returns jsonb language sql as $$
 select pg_temp.pq(9000 + g, jsonb_build_object('desk_feature','Bill Passage Probability Index','title',pg_temp.bill_name(g),
   'file_url',pg_temp.bill_url(g),'file_name',g || '_2025.pdf','document_key','bill:2025:' || g,'document_role','as_introduced',
   'citation',jsonb_build_object('kind','bill','bill_number',g::text,'bill_year','2025','house','Lok Sabha',
     'bill_name',pg_temp.bill_name(g),'status','Pending','introduced_on','2025-03-04') || cite)
   || case when over ? 'tag' then jsonb_build_object('source_key',left(encode(sha256(convert_to('bill-' || g || (over->>'tag'),'UTF8')),'hex'),40)) else '{}' end
   || over,
   'BILL NO. ' || g || ' OF 2025. ' || pg_temp.bill_name(g) || coalesce(' ' || (over->>'tag'), '')) $$;
-- The stored key is built as billDocumentKey in src/lib/deskRows.js builds it: the title's year, else the date's.
create function pg_temp.bill_row(k text, n text, house text, d text, name text) returns void language sql as $$
 insert into public.desk_rows(tier,feature,row_key,row,record_text,snapshot_at,document_key)
 values ('national','Bill Passage Probability Index',k,
  jsonb_build_object('id',k,'bill_number',n,'house',house,'date_introduced',d,'bill_name',name,'source_url','https://sansad.in/rs/legislation'),
  name, now(), 'bill:' || coalesce(substring(name from ',\s*([0-9]{4})\s*\.?\s*$'), left(d,4)) || ':' || n) $$;
create function pg_temp.reg(c text, q jsonb) returns jsonb language plpgsql as $$
 begin return pg_temp.i_reg(pg_temp.batch(c, jsonb_build_array(q)), jsonb_build_array(q))#>'{results,0}'; end $$;
create function pg_temp.links(q jsonb) returns bigint language sql as $$
 select count(*) from public.record_document_links l join public.documents d on d.id = l.document_id
  where d.source_key = (q->>'payload')::jsonb->>'source_key' $$;

select pg_temp.policy('national-bills', jsonb_build_object(
  'admitted',jsonb_build_array(jsonb_build_object('desk_tier','national','desk_feature','Bill Passage Probability Index','adapter','national_bills'))));
select pg_temp.policy('national-bills-checked', jsonb_build_object(
  'admitted',jsonb_build_array(jsonb_build_object('desk_tier','national','desk_feature','Bill Passage Probability Index','adapter','national_bills',
    'required_checks',jsonb_build_array('bill_identity')))));

-- ═══ Admission and links ══════════════════════════════
select pg_temp.bill_row('r1', '1', 'Lok Sabha', '2025-03-04', pg_temp.bill_name(1));
select pg_temp.bill_row('r1rs', '1', 'Rajya Sabha', '2025-03-04', 'Another Measure Bill, 2025');
select pg_temp.bill_row('r1old', '1', 'Lok Sabha', '2019-03-04', 'The Old Measure Bill, 2019');
select pg_temp.ok(pg_temp.reg('national-bills', pg_temp.bill(1))->>'outcome' = 'admitted', 'a bill is admitted');
select pg_temp.ok((select count(*) from public.record_document_links l where l.row_key = 'r1') = 1
   and pg_temp.links(pg_temp.bill(1)) = 1, 'linked to its row only: not the other house, not the other year');
select pg_temp.ok((select role || decision_id || feature from public.record_document_links where row_key = 'r1')
   = 'as_introducedadmission:bill-key-v1Bill Passage Probability Index', 'the link records role, decision and desk');
select pg_temp.ok((select metadata->>'bill_number' = '1' and metadata->>'bill_year' = '2025' and metadata->>'house' = 'Lok Sabha'
    and metadata->>'status' = 'Pending' and metadata->>'document_key' = 'bill:2025:1' and metadata->>'document_role' = 'as_introduced'
    and desk_feature = 'Bill Passage Probability Index' and desk_tier = 'national' from public.documents
   where source_key = (pg_temp.bill(1)->>'payload')::jsonb->>'source_key'), 'the document carries the fields the app reads');

-- A bill has several documents: each role once, each row linked to both.
select pg_temp.ok(pg_temp.reg('national-bills', pg_temp.bill(1, jsonb_build_object('document_role','synopsis','tag','synopsis',
  'file_url','https://sansad.in/getFile/BillsPDFFiles/synopsis/1-2025.pdf?source=loksabhadocs')))->>'outcome' = 'admitted', 'a second document of one bill');
select pg_temp.ok((select bool_and(expected_link_count = 2) from public.record_document_links where row_key = 'r1'), 'the link count follows');

-- Year: the row's name and its date disagree on 744 live rows. The stored key decides, as it does for every reader.
select pg_temp.bill_row('r2', '2', 'Lok Sabha', '2024-12-30', pg_temp.bill_name(2));
select pg_temp.ok(pg_temp.reg('national-bills', pg_temp.bill(2))->>'outcome' = 'admitted', 'the name''s year decides the stored key');
select pg_temp.bill_row('r3', '3', 'Lok Sabha', '2025-02-01', 'The Fixture Measure Number 3 Bill');
select pg_temp.ok(pg_temp.reg('national-bills', pg_temp.bill(3))->>'outcome' = 'admitted', 'the date decides when the name has no year');

-- One key can hold rows of two bills: the whole name picks.
select pg_temp.bill_row('r4a', '4', 'Lok Sabha', '2025-02-01', pg_temp.bill_name(4));
select pg_temp.bill_row('r4b', '4', 'Lok Sabha', '2025-02-02', 'Quite A Different Measure Bill, 2025');
select pg_temp.ok(pg_temp.reg('national-bills', pg_temp.bill(4))->>'outcome' = 'admitted', 'the name picks the bill');
select pg_temp.ok((select array_agg(row_key) from public.record_document_links where row_key like 'r4%') = '{r4a}', 'only that bill is linked');
-- One bill listed twice: both rows link.
select pg_temp.bill_row('r5a', '5', 'Lok Sabha', '2025-02-01', pg_temp.bill_name(5));
select pg_temp.bill_row('r5b', '5', 'Lok Sabha', '2025-02-03', upper(pg_temp.bill_name(5)));
select pg_temp.ok((pg_temp.reg('national-bills', pg_temp.bill(5))->>'links')::int = 2, 'every row of the one bill is linked');

-- ═══ Refusals, each writing nothing ═══════════════════
select pg_temp.refusal('national-bills', pg_temp.bill(20), 'no_desk_row');
select pg_temp.bill_row('r21', '21', 'Lok Sabha', '2019-01-01', 'The Fixture Measure Number 21 Bill, 2019');
select pg_temp.refusal('national-bills', pg_temp.bill(21), 'no_desk_row');   -- another year
select pg_temp.bill_row('r22', '22', 'Rajya Sabha', '2025-01-01', pg_temp.bill_name(22));
select pg_temp.refusal('national-bills', pg_temp.bill(22), 'no_desk_row');   -- another house
select pg_temp.bill_row('r23', '23', 'Lok Sabha', '2025-01-01', 'Quite A Different Measure Bill, 2025');
select pg_temp.refusal('national-bills', pg_temp.bill(23), 'bill_identity_mismatch');
select pg_temp.bill_row('r24', '24', 'Lok Sabha', '2025-01-01', pg_temp.bill_name(99));
select pg_temp.refusal('national-bills', pg_temp.bill(24), 'bill_identity_mismatch');   -- a title never links across numbers
-- Containment is not enough: a part of a name, or a bill with a longer name, never links.
select pg_temp.bill_row('r25', '25', 'Lok Sabha', '2025-01-01', pg_temp.bill_name(25) || ' extended, 2025');
select pg_temp.refusal('national-bills', pg_temp.bill(25), 'bill_identity_mismatch');
select pg_temp.refusal('national-bills', pg_temp.bill(26, '{"document_key":"bill:2024:26"}'), 'bill_identity_incomplete');
select pg_temp.refusal('national-bills', pg_temp.bill(27, '{"document_role":"memo"}'), 'bill_identity_incomplete');
select pg_temp.refusal('national-bills', pg_temp.bill(28, '{"file_url":"https://example.com/28_2025.pdf"}'), 'bill_identity_incomplete');
select pg_temp.refusal('national-bills', pg_temp.bill(29, '{"file_url":"https://sansad.in/getFile/BillsTexts/../29.pdf"}'), 'bill_identity_incomplete');
select pg_temp.refusal('national-bills', pg_temp.bill(30, '{}', '{"house":"Vidhan Sabha"}'), 'bill_identity_incomplete');
select pg_temp.refusal('national-bills', pg_temp.bill(31, '{}', '{"bill_number":"xiv"}'), 'bill_identity_incomplete');
select pg_temp.refusal('national-bills', pg_temp.bill(32, '{}', '{"bill_year":"25"}'), 'bill_identity_incomplete');
select pg_temp.refusal('national-bills', pg_temp.bill(33, '{}', '{"bill_name":"---"}'), 'bill_identity_incomplete');
select pg_temp.refusal('national-bills', pg_temp.bill(34, '{}', '{"bill_name":"Bill"}'), 'bill_identity_incomplete');
select pg_temp.refusal('national-bills', pg_temp.bill(35, '{}', jsonb_build_object('bill_name',U&'\092C\0940\091F\093E \0935\093F\0927\0947\092F\0915, 2025')), 'bill_identity_incomplete');
select pg_temp.refusal('national-bills', pg_temp.bill(36, '{"document_role":"corrigendum"}'), 'bill_identity_incomplete');
-- A held URL, and a held role of the bill.
select pg_temp.refusal('national-bills', pg_temp.bill(1, jsonb_build_object('tag','copy','document_role','as_passed_lok_sabha')), 'file_url_held');
select pg_temp.refusal('national-bills', pg_temp.bill(1, jsonb_build_object('tag','copy',
  'file_url','https://sansad.in/getFile/BillsTexts/LSBillTexts/Asintroduced/1_2025_other.pdf')), 'bill_role_held');
-- Errata can repeat for a bill.
select pg_temp.ok(pg_temp.reg('national-bills', pg_temp.bill(1, jsonb_build_object('tag','errata one','document_role','errata',
  'file_url','https://sansad.in/getFile/BillsTexts/LSBillTexts/Errata/1_a.pdf')))->>'outcome' = 'admitted', 'a first erratum');
select pg_temp.ok(pg_temp.reg('national-bills', pg_temp.bill(1, jsonb_build_object('tag','errata two','document_role','errata',
  'file_url','https://sansad.in/getFile/BillsTexts/LSBillTexts/Errata/1_b.pdf')))->>'outcome' = 'admitted', 'a second erratum of one bill');
-- A key has no house: the other house's bill with that number keeps its own role.
select pg_temp.bill_row('r6l', '6', 'Lok Sabha', '2025-01-01', pg_temp.bill_name(6));
select pg_temp.bill_row('r6r', '6', 'Rajya Sabha', '2025-01-01', pg_temp.bill_name(6));
select pg_temp.ok(pg_temp.reg('national-bills', pg_temp.bill(6))->>'outcome' = 'admitted', 'the Lok Sabha bill');
select pg_temp.ok(pg_temp.reg('national-bills', pg_temp.bill(6, jsonb_build_object('tag','rs',
   'file_url','https://sansad.in/getFile/BillsTexts/RSBillTexts/Asintroduced/6_2025.pdf'), '{"house":"Rajya Sabha"}'))->>'outcome' = 'admitted',
  'the Rajya Sabha bill with that number');
select pg_temp.ok((select count(*) from public.record_document_links where row_key in ('r6l','r6r')) = 2, 'each linked to its own house''s row');
-- A dry run says what would happen and writes nothing.
select pg_temp.bill_row('r7', '7', 'Lok Sabha', '2025-01-01', pg_temp.bill_name(7));
do $$ declare q jsonb := pg_temp.bill(7); before text := pg_temp.corpus(); res jsonb; begin
 res := pg_temp.i_reg(pg_temp.batch('national-bills', jsonb_build_array(q)), jsonb_build_array(q), true);
 perform pg_temp.ok(res#>>'{results,0,outcome}' = 'would_admit', 'a dry run reports would_admit');
 perform pg_temp.ok(pg_temp.corpus() = before and pg_temp.links(q) = 0, 'a dry run writes no document and no link');
end $$;

-- Questions and bills do not cross.
select pg_temp.refusal('national-pq', pg_temp.bill(1, '{"tag":"cross"}'), 'collection_not_admitted');
select pg_temp.refusal('national-bills', pg_temp.pq(13), 'collection_not_admitted');

-- If a race gets past the lookups, the database still holds: one file, one role of a bill.
select pg_temp.refused($q$insert into public.documents(source_key,title,file_url,desk_tier,desk_feature,content_sha256,ocr_text)
  values (repeat('7',40),'Race','$q$ || pg_temp.bill_url(1) || $q$','national','Bill Passage Probability Index',repeat('7',64),'x')$q$,
  'documents_bill_file_url');
select pg_temp.refused($q$insert into public.documents(source_key,title,file_url,desk_tier,desk_feature,content_sha256,ocr_text,metadata)
  values (repeat('6',40),'Race','https://sansad.in/getFile/BillsTexts/race.pdf','national','Bill Passage Probability Index',repeat('6',64),'x',
  '{"document_key":"bill:2025:1","document_role":"as_introduced","house":"Lok Sabha"}')$q$, 'documents_bill_key_role');

-- ═══ The owner's text check, as a policy setting ══════
select pg_temp.bill_row('r40', '40', 'Lok Sabha', '2025-01-01', pg_temp.bill_name(40));
select pg_temp.refusal('national-bills-checked', pg_temp.bill(40), 'review_incomplete');
select pg_temp.ok(pg_temp.reg('national-bills-checked', pg_temp.bill(40, jsonb_build_object('review',
   ((pg_temp.bill(40)->>'payload')::jsonb->'review') || jsonb_build_object('checks',((pg_temp.bill(40)->>'payload')::jsonb#>'{review,checks}') || '{"bill_identity":true}'))))->>'outcome' = 'admitted',
  'a required check admits once it was made');

-- ═══ One way in, and no new door ══════════════════════
select pg_temp.refused($q$select public.ingest_register_text_unmapped(pg_temp.bill(41))$q$, 'Bills enter through a sealed batch');
select pg_temp.ok(not has_function_privilege('corpus_ingest', 'public.ingest_bill_rows(text,text,text)', 'execute')
   and not has_function_privilege('service_role', 'public.ingest_bill_rows(text,text,text)', 'execute')
   and not has_function_privilege('corpus_ingest', 'public.bill_admission_key(jsonb)', 'execute')
   and not has_function_privilege('anon', 'public.bill_norm(text)', 'execute'), 'the helpers are owner-only');
select pg_temp.ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=public, extensions, pg_temp'])
   from pg_proc p where p.proname in ('ingest_bill_rows','bill_admission_key')), 'definer helpers search pg_temp last');

-- ═══ Cost: no walk of the bills ═══════════════════════
create function pg_temp.reads(t text) returns bigint language sql as $$
 select coalesce(seq_tup_read,0) + coalesce(idx_tup_fetch,0) from pg_stat_xact_user_tables where relname = t $$;
insert into public.documents(source_key,title,file_url,desk_tier,desk_feature,content_sha256,ocr_text,metadata)
select repeat('c',8) || md5('seed' || g), 'Seed ' || g, pg_temp.bill_url(100000 + g),'national','Bill Passage Probability Index',
       md5('seedtext' || g) || md5('s' || g),'x',
       jsonb_build_object('document_key','bill:2025:' || (100000 + g),'document_role','as_introduced','house','Lok Sabha')
  from generate_series(1,3000) g;
select pg_temp.bill_row('s' || g, (200000 + g)::text, 'Lok Sabha', '2025-01-01', 'Seed Row ' || g) from generate_series(1,3000) g;
select pg_temp.bill_row('c' || g, (500 + g)::text, 'Lok Sabha', '2025-01-01', pg_temp.bill_name(500 + g)) from generate_series(1,50) g;
analyze public.documents;
analyze public.desk_rows;
create temp table bill_cost as select pg_temp.reads('documents') d0, pg_temp.reads('desk_rows') r0;
do $$ declare qs jsonb := (select jsonb_agg(pg_temp.bill(500 + g)) from generate_series(1,50) g); res jsonb; begin
 res := pg_temp.i_reg(pg_temp.batch('national-bills', qs), qs);
 perform pg_temp.ok((res#>>'{totals,admitted}')::int = 50, '50 bills admitted in one call: ' || (res->'totals')::text);
end $$;
select pg_temp.ok(pg_temp.reads('documents') - d0 < 1500, 'documents read by lookups, not walked: ' || (pg_temp.reads('documents') - d0)) from bill_cost;
select pg_temp.ok(pg_temp.reads('desk_rows') - r0 < 1500, 'desk_rows read by lookups, not walked: ' || (pg_temp.reads('desk_rows') - r0)) from bill_cost;
select pg_temp.ok(pg_get_functiondef('public.ingest_admit_document(jsonb,jsonb)'::regprocedure) !~* 'x\.id\s+limit\s+1',
  'no lookup orders and limits in the same query as its scan');

rollback;
