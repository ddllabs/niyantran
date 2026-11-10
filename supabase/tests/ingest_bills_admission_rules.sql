-- F307: the Bills admission rules. Disposable fixture. run.sh uses the ingest_bills_adapter chain, then
-- 20261110120000_bills_admission_rules (as a non-superuser). Spec: docs/specs/2026-11-10-bills-admission-rules.md.
--
-- It first runs every ingest_bills_adapter case on the replaced function, so the original rules are proved unchanged,
-- then the cases of the new rules: the listing's key, file names with dots, the hardened file_url rule, the
-- database-side ambiguity rule, and the whitespace of the listing's year.
\i supabase/tests/ingest_bills_adapter.sql

-- The links of one record's document, through documents.source_key.
create function pg_temp.rows_of(q jsonb) returns text[] language sql as $$
 select coalesce(array_agg(l.row_key order by l.row_key), '{}') from public.record_document_links l
   join public.documents d on d.id = l.document_id where d.source_key = (q->>'payload')::jsonb->>'source_key' $$;
-- A record's key as bill_admission_key reads it.
create function pg_temp.key_of(q jsonb) returns text language sql as $$
 select public.bill_admission_key((q->>'payload')::jsonb) $$;

-- ═══ The listing's key ════════════════════════════════
-- The citation's year differs from the year closing the name: the key may be the listing's own (billDocumentKey).
select pg_temp.bill_row('r60', '60', 'Lok Sabha', '2025-03-04', pg_temp.bill_name(60));
select pg_temp.ok(pg_temp.reg('national-bills', pg_temp.bill(60, '{}', '{"bill_year":"2024"}'))->>'outcome' = 'admitted',
  'a bill under the listing key (the name''s year) is admitted');
select pg_temp.ok(pg_temp.rows_of(pg_temp.bill(60, '{}', '{"bill_year":"2024"}')) = '{r60}'
   and (select metadata->>'document_key' from public.documents
         where source_key = (pg_temp.bill(60, '{}', '{"bill_year":"2024"}')->>'payload')::jsonb->>'source_key') = 'bill:2025:60',
  'it is linked to the row of the listing key, through its own document');
-- The name gives no year: the year of introduced_on decides.
select pg_temp.bill_row('r61', '61', 'Lok Sabha', '2024-12-30', 'The Fixture Measure Number 61 Bill');
select pg_temp.ok(pg_temp.reg('national-bills', pg_temp.bill(61, '{"document_key":"bill:2024:61"}',
  '{"bill_name":"The Fixture Measure Number 61 Bill","introduced_on":"2024-12-30"}'))->>'outcome' = 'admitted',
  'the listing key falls back to the year of introduced_on');
-- The name's year wins over the date's.
select pg_temp.refusal('national-bills', pg_temp.bill(75, '{"document_key":"bill:2023:75"}',
  '{"bill_year":"2024","introduced_on":"2023-01-01"}'), 'bill_identity_incomplete');
-- The listing key's row has another name: the name still decides.
select pg_temp.bill_row('r62', '62', 'Lok Sabha', '2025-03-04', 'Quite A Different Measure Bill, 2025');
select pg_temp.refusal('national-bills', pg_temp.bill(62, '{}', '{"bill_year":"2024"}'), 'bill_identity_mismatch');
-- A third year is neither key.
select pg_temp.refusal('national-bills', pg_temp.bill(63, '{"document_key":"bill:2023:63"}', '{"bill_year":"2024"}'), 'bill_identity_incomplete');
-- No year in the name and no valid date: there is no listing key, and the citation key is not the record's.
select pg_temp.refusal('national-bills', pg_temp.bill(64, '{"document_key":"bill:2024:64"}',
  '{"bill_name":"The Fixture Measure Number 64 Bill","introduced_on":"2024-02-31"}'), 'bill_identity_incomplete');
select pg_temp.refusal('national-bills', pg_temp.bill(65, '{"document_key":"bill:2024:65"}',
  '{"bill_name":"The Fixture Measure Number 65 Bill"}'), 'bill_identity_incomplete');

-- ═══ The database refuses a listing key that a citation key also answers ═══
-- Rows of the same name and house under both keys: which is the bill's is not for the record to say.
select pg_temp.bill_row('r71l', '71', 'Lok Sabha', '2025-03-04', pg_temp.bill_name(71));
select pg_temp.bill_row('r71c', '71', 'Lok Sabha', '2024-03-04', 'The Fixture Measure Number 71 Bill, 2024');
select pg_temp.refusal('national-bills', pg_temp.bill(71, '{}', '{"bill_year":"2024"}'), 'bill_identity_incomplete');
-- The citation key itself is not touched by the rule.
select pg_temp.ok(pg_temp.reg('national-bills', pg_temp.bill(71, '{"document_key":"bill:2024:71"}', '{"bill_year":"2024"}'))->>'outcome' = 'admitted',
  'the citation key is admitted where both keys have a row');
-- A row of another name, or of another house, under the citation key does not block the listing key.
select pg_temp.bill_row('r72l', '72', 'Lok Sabha', '2025-03-04', pg_temp.bill_name(72));
select pg_temp.bill_row('r72c', '72', 'Lok Sabha', '2024-03-04', 'Quite A Different Measure Bill, 2024');
select pg_temp.ok(pg_temp.reg('national-bills', pg_temp.bill(72, '{}', '{"bill_year":"2024"}'))->>'outcome' = 'admitted',
  'a row of another name under the citation key does not block');
select pg_temp.bill_row('r73l', '73', 'Lok Sabha', '2025-03-04', pg_temp.bill_name(73));
select pg_temp.bill_row('r73c', '73', 'Rajya Sabha', '2024-03-04', 'The Fixture Measure Number 73 Bill, 2024');
select pg_temp.ok(pg_temp.reg('national-bills', pg_temp.bill(73, '{}', '{"bill_year":"2024"}'))->>'outcome' = 'admitted',
  'a row of the other house under the citation key does not block');

-- ═══ File names ═══════════════════════════════════════
-- Runs of dots and spaces in a file name are not parent segments.
select pg_temp.bill_row('r66', '66', 'Lok Sabha', '2025-03-04', pg_temp.bill_name(66));
select pg_temp.ok(pg_temp.reg('national-bills', pg_temp.bill(66, '{"file_url":"https://sansad.in/getFile/BillsTexts/LSBillTexts/Asintroduced/591LS%20As%20Int....pdf"}'))->>'outcome' = 'admitted',
  'a file name with a run of dots is admitted');
select pg_temp.bill_row('r69', '69', 'Lok Sabha', '2025-03-04', pg_temp.bill_name(69));
select pg_temp.ok(pg_temp.reg('national-bills', pg_temp.bill(69, '{"file_url":"https://sansad.in/getFile/BillsTexts/x/591LS As Int....pdf"}'))->>'outcome' = 'admitted',
  'a file name with spaces and dots is admitted');
-- Dots after the query or fragment start are not path segments.
select pg_temp.bill_row('r67', '67', 'Lok Sabha', '2025-03-04', pg_temp.bill_name(67));
select pg_temp.ok(pg_temp.reg('national-bills', pg_temp.bill(67, '{"file_url":"https://sansad.in/getFile/BillsTexts/x/67.pdf?next=/../a"}'))->>'outcome' = 'admitted',
  'a /../ after the query starts is not a path segment');
select pg_temp.bill_row('r70', '70', 'Lok Sabha', '2025-03-04', pg_temp.bill_name(70));
select pg_temp.ok(pg_temp.reg('national-bills', pg_temp.bill(70, '{"file_url":"https://sansad.in/getFile/BillsTexts/x/70.pdf#/../a"}'))->>'outcome' = 'admitted',
  'a /../ after the fragment starts is not a path segment');
-- Parent and current segments, plain, encoded or with parameters; encoded separators; control characters; backslashes.
select pg_temp.bill_row('r68', '68', 'Lok Sabha', '2025-03-04', pg_temp.bill_name(68));
select pg_temp.refusal('national-bills', pg_temp.bill(68, jsonb_build_object('file_url', 'https://sansad.in/getFile/BillsTexts/' || u)),
  'bill_identity_incomplete')
 from unnest(array['../68.pdf', './68.pdf', '%2e%2e/68.pdf', '%2E./68.pdf', '.%2e/68.pdf', 'x/..', 'x/..?a=1',
   'x/..' || chr(13) || '/a.pdf', 'x/..' || chr(10) || '/a.pdf', 'x/.' || chr(9) || './a.pdf', 'x/..;/a.pdf',
   'x/%2e%2e%3b/a.pdf', 'x/..;v=1/a.pdf', 'x/..%2fa.pdf', 'x/..%2F..%2Fa.pdf', 'x/%2e%2e%5ca.pdf', 'x/a%2Fb.pdf',
   'x\68.pdf', 'x/68' || chr(127) || '.pdf']) u;

-- ═══ The whitespace of the listing's year is JavaScript's ═══
-- U+FEFF and the line separators close a name as JavaScript's \s sees them; U+0085 and U+180E do not.
create function pg_temp.ly_key(name_end text) returns text language sql as $$
 select pg_temp.key_of(pg_temp.bill(76, '{"document_key":"bill:2025:76"}',
   jsonb_build_object('bill_year','2024','bill_name','The Fixture Measure Number 76 Bill,' || name_end || '2025'))) $$;
select pg_temp.ok(pg_temp.ly_key(chr(65279)) = 'bill:2025:76', 'U+FEFF before the year is whitespace');
select pg_temp.ok(pg_temp.ly_key(chr(160)) = 'bill:2025:76', 'U+00A0 is whitespace');
select pg_temp.ok(pg_temp.ly_key(chr(8232)) = 'bill:2025:76', 'U+2028 is whitespace');
select pg_temp.ok(pg_temp.ly_key(chr(12288)) = 'bill:2025:76', 'U+3000 is whitespace');
select pg_temp.ok(pg_temp.ly_key(' ') = 'bill:2025:76', 'a space is whitespace');
select pg_temp.ok(pg_temp.ly_key(chr(133)) is null, 'U+0085 is not whitespace');
select pg_temp.ok(pg_temp.ly_key(chr(6158)) is null, 'U+180E is not whitespace');

rollback;
