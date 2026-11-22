-- F372: the pack's Bill corrigenda enter the Bills desk without a file link. Disposable fixture. run.sh uses the
-- ingest_bills_admission_rules chain, then 20261125090000_bill_corrigenda_route (as a non-superuser). Spec:
-- docs/specs/2026-11-21-bill-corrigenda-route.md.
--
-- It first runs every Bills case (through the include, expanded by run.sh) on the replaced function, so a bill still needs
-- its official file and every refusal is as it was. Then the corrigenda: admitted with no file link, linked to their
-- bill's row, one bill with several of them, each refusal named, and what the migration does not loosen.
\i supabase/tests/ingest_bills_adapter.sql

-- A pack corrigendum of bill g: errata, the pack's type name, no file link, no pages (as the pack gives them).
create function pg_temp.corr(g int, over jsonb default '{}', cite jsonb default '{}') returns jsonb language sql as $$
 select pg_temp.bill(g, jsonb_build_object('tag','corrigendum','doc_type','bill_corrigendum','document_role','errata',
   'file_url',null,'file_name','corr' || g || '.doc','pages','[]'::jsonb,'page_split','none') || over, cite) $$;
create function pg_temp.docs_of(g int) returns bigint language sql as $$
 select count(*) from public.documents where metadata->>'document_key' = 'bill:2025:' || g and metadata->>'document_role' = 'errata' $$;

select pg_temp.policy('national-bill-corrigenda', jsonb_build_object(
  'admitted',jsonb_build_array(jsonb_build_object('desk_tier','national','desk_feature','Bill Passage Probability Index','adapter','national_bills')),
  'require_page_count',false));
-- The same policy as Bills has it: a document with no pages is refused for a policy that wants a page count.
select pg_temp.policy('national-bill-corrigenda-paged', jsonb_build_object(
  'admitted',jsonb_build_array(jsonb_build_object('desk_tier','national','desk_feature','Bill Passage Probability Index','adapter','national_bills')),
  'require_page_count',true));

-- ═══ Admission, linking, repetition ═══════════════════
select pg_temp.bill_row('k1', '701', 'Lok Sabha', '2025-03-04', pg_temp.bill_name(701));
select pg_temp.bill_row('k1rs', '701', 'Rajya Sabha', '2025-03-04', 'Another Measure Bill, 2025');
select pg_temp.ok(pg_temp.reg('national-bill-corrigenda', pg_temp.corr(701))->>'outcome' = 'admitted',
  'a corrigendum with no file link is admitted');
select pg_temp.ok((select file_url is null and file_name = 'corr701.doc' and desk_feature = 'Bill Passage Probability Index'
    and metadata->>'document_key' = 'bill:2025:701' and metadata->>'document_role' = 'errata'
    and metadata->>'doc_type' = 'bill_corrigendum' and metadata->>'house' = 'Lok Sabha' and metadata->>'bill_number' = '701'
    from public.documents where source_key = (pg_temp.corr(701)->>'payload')::jsonb->>'source_key'),
  'the document has no file link and carries the bill, the role and the pack type the app reads');
select pg_temp.ok((select count(*) = 1 and bool_and(l.row_key = 'k1' and l.role = 'errata' and l.source_url is null
    and l.decision_id = 'admission:bill-key-v1') from public.record_document_links l join public.documents d on d.id = l.document_id
    where d.source_key = (pg_temp.corr(701)->>'payload')::jsonb->>'source_key'),
  'linked to its bill''s row only (not the other house''s), as errata, with no source url');
-- Errata repeat: a second corrigendum of one bill, and the bill's own document beside them.
select pg_temp.ok(pg_temp.reg('national-bill-corrigenda', pg_temp.corr(701, jsonb_build_object('tag','corrigendum two')))->>'outcome' = 'admitted',
  'a second corrigendum of the same bill is admitted');
select pg_temp.ok(pg_temp.docs_of(701) = 2 and (select bool_and(expected_link_count = 2) from public.record_document_links where row_key = 'k1'),
  'both stand; the row''s link count follows');
select pg_temp.ok(pg_temp.reg('national-bills', pg_temp.bill(701))->>'outcome' = 'admitted',
  'the bill''s own document, with its official file, is admitted beside its corrigenda');
select pg_temp.ok((select bool_and(expected_link_count = 3) and count(*) = 3 from public.record_document_links where row_key = 'k1'),
  'the row now links the bill and both corrigenda');
-- Several rows of one bill: every row links.
select pg_temp.bill_row('k2a', '702', 'Lok Sabha', '2025-02-01', pg_temp.bill_name(702));
select pg_temp.bill_row('k2b', '702', 'Lok Sabha', '2025-02-03', upper(pg_temp.bill_name(702)));
select pg_temp.ok((pg_temp.reg('national-bill-corrigenda', pg_temp.corr(702))->>'links')::int = 2, 'every listing row of the one bill is linked');
-- The listing's own key (the year closing the name) is the document's key.
select pg_temp.bill_row('k3', '703', 'Lok Sabha', '2025-03-04', pg_temp.bill_name(703));
select pg_temp.ok(pg_temp.reg('national-bill-corrigenda', pg_temp.corr(703, '{"document_key":"bill:2025:703"}', '{"bill_year":"2024"}'))->>'outcome' = 'admitted',
  'a corrigendum under the listing key is admitted');
select pg_temp.ok((select metadata->>'document_key' from public.documents
   where source_key = (pg_temp.corr(703, '{"document_key":"bill:2025:703"}', '{"bill_year":"2024"}')->>'payload')::jsonb->>'source_key') = 'bill:2025:703',
  'and keeps that key');
-- A dry run says what would happen and writes nothing.
select pg_temp.bill_row('k4', '704', 'Lok Sabha', '2025-01-01', pg_temp.bill_name(704));
do $$ declare q jsonb := pg_temp.corr(704); before text := pg_temp.corpus(); res jsonb; begin
 res := pg_temp.i_reg(pg_temp.batch('national-bill-corrigenda', jsonb_build_array(q)), jsonb_build_array(q), true);
 perform pg_temp.ok(res#>>'{results,0,outcome}' = 'would_admit', 'a dry run reports would_admit for a corrigendum');
 perform pg_temp.ok(pg_temp.corpus() = before, 'a dry run writes nothing');
end $$;

-- ═══ Refusals, each writing nothing ═══════════════════
select pg_temp.bill_row('k5', '705', 'Lok Sabha', '2025-01-01', pg_temp.bill_name(705));
-- What marks a corrigendum: the role and the pack's type name, with no file_url. Take one away and it is a bill.
select pg_temp.refusal('national-bill-corrigenda', pg_temp.corr(705, '{"doc_type":"bill"}'), 'bill_identity_incomplete');
select pg_temp.refusal('national-bill-corrigenda', pg_temp.corr(705, '{"doc_type":null}'), 'bill_identity_incomplete');
select pg_temp.refusal('national-bill-corrigenda', pg_temp.corr(705, '{"document_role":"synopsis"}'), 'bill_identity_incomplete');
select pg_temp.refusal('national-bill-corrigenda', pg_temp.corr(705, '{"document_role":"as_introduced"}'), 'bill_identity_incomplete');
select pg_temp.refusal('national-bills', pg_temp.bill(705, '{"file_url":null}'), 'bill_identity_incomplete');          -- a bill with no file
select pg_temp.refusal('national-bills', pg_temp.bill(705, '{"file_url":null,"doc_type":"bill_corrigendum"}'), 'bill_identity_incomplete');
-- A link that is given is held to the official rule, empty or not.
select pg_temp.refusal('national-bill-corrigenda', pg_temp.corr(705, '{"file_url":""}'), 'bill_identity_incomplete');
select pg_temp.refusal('national-bill-corrigenda', pg_temp.corr(705, '{"file_url":"https://example.com/c.pdf"}'), 'bill_identity_incomplete');
select pg_temp.refusal('national-bill-corrigenda', pg_temp.corr(705, '{"file_url":"https://sansad.in/getFile/BillsTexts/../c.pdf"}'), 'bill_identity_incomplete');
-- The same identity rules as a bill: key, house, number, year, name, listing row.
select pg_temp.refusal('national-bill-corrigenda', pg_temp.corr(705, '{"document_key":"bill:2024:705"}'), 'bill_identity_incomplete');
select pg_temp.refusal('national-bill-corrigenda', pg_temp.corr(705, '{}', '{"house":"Vidhan Sabha"}'), 'bill_identity_incomplete');
select pg_temp.refusal('national-bill-corrigenda', pg_temp.corr(705, '{}', '{"bill_number":"x5"}'), 'bill_identity_incomplete');
select pg_temp.refusal('national-bill-corrigenda', pg_temp.corr(705, '{}', '{"bill_name":"Bill"}'), 'bill_identity_incomplete');
select pg_temp.refusal('national-bill-corrigenda', pg_temp.corr(706), 'no_desk_row');
select pg_temp.bill_row('k7', '707', 'Lok Sabha', '2025-01-01', 'Quite A Different Measure Bill, 2025');
select pg_temp.refusal('national-bill-corrigenda', pg_temp.corr(707), 'bill_identity_mismatch');
select pg_temp.bill_row('k8', '708', 'Rajya Sabha', '2025-01-01', pg_temp.bill_name(708));
select pg_temp.refusal('national-bill-corrigenda', pg_temp.corr(708), 'no_desk_row');
-- A corrigendum under the listing key, where a row under the citation key has the same house and name: which of the two
-- bills it corrects is not for the record to say, so the ambiguity guard refuses it (as for a bill).
select pg_temp.bill_row('r709l', '709', 'Lok Sabha', '2025-03-04', pg_temp.bill_name(709));
select pg_temp.bill_row('r709c', '709', 'Lok Sabha', '2024-03-04', 'The Fixture Measure Number 709 Bill, 2024');
select pg_temp.refusal('national-bill-corrigenda', pg_temp.corr(709, '{"document_key":"bill:2025:709"}', '{"bill_year":"2024"}'),
  'bill_identity_incomplete');
-- The citation key itself is still the corrigendum's own, where both keys have a row.
select pg_temp.ok(pg_temp.reg('national-bill-corrigenda', pg_temp.corr(709, '{"document_key":"bill:2024:709"}', '{"bill_year":"2024"}'))->>'outcome' = 'admitted',
  'the citation key is admitted where both keys have a row');
-- A policy that wants a page count refuses a document with none.
select pg_temp.refusal('national-bill-corrigenda-paged', pg_temp.corr(705), 'no_page_count');
-- Questions and bills do not cross, and a corrigendum is a bill's: not a question's collection.
select pg_temp.refusal('national-pq', pg_temp.corr(705, '{"tag":"cross"}'), 'collection_not_admitted');

-- ═══ What the migration does not loosen ═══════════════
-- The link table: a null source url is for errata only.
select pg_temp.refused($q$insert into public.record_document_links(tier,feature,row_key,document_id,role,version,source_url,text_sha256,row_sha256,
    document_identity_sha256,fingerprint,decision_id,approver,evidence_sha256)
  select 'national','Bill Passage Probability Index','k5',d.id,'as_introduced','1',null,'a','b','c','d','x','y','z' from public.documents d limit 1$q$,
  'record_links_source_url_errata');
select pg_temp.refused($q$insert into public.record_document_links(tier,feature,row_key,document_id,role,version,source_url,text_sha256,row_sha256,
    document_identity_sha256,fingerprint,decision_id,approver,evidence_sha256)
  select 'national','Bill Passage Probability Index','k5',d.id,'answer','1',null,'a','b','c','d','x','y','z' from public.documents d limit 1$q$,
  'record_links_source_url_errata');
-- A null source url is for the Bills desk's errata only: errata of another desk's feature is refused too.
select pg_temp.refused($q$insert into public.record_document_links(tier,feature,row_key,document_id,role,version,source_url,text_sha256,row_sha256,
    document_identity_sha256,fingerprint,decision_id,approver,evidence_sha256)
  select 'national','Parliamentary Question Database','k5',d.id,'errata','1',null,'a','b','c','d','x','y','z' from public.documents d limit 1$q$,
  'record_links_source_url_errata');
-- The two unique indexes still hold, and a corrigendum does not trip them: no file_url (null is not a duplicate), and an
-- errata is not a role of its bill (a second one is fine, as above).
select pg_temp.ok(exists (select 1 from pg_indexes where indexname = 'documents_bill_file_url')
   and exists (select 1 from pg_indexes where indexname = 'documents_bill_key_role'), 'the two bill indexes are still there');
select pg_temp.ok((select count(*) from public.documents where desk_feature = 'Bill Passage Probability Index' and file_url is null
   and metadata->>'doc_type' = 'bill_corrigendum') = 5, 'five corrigenda stored with no file link, and no index objected');
-- The helper is as it was: owner-only, stable, definer, search_path last pg_temp.
select pg_temp.ok(not has_function_privilege('corpus_ingest', 'public.bill_admission_key(jsonb)', 'execute')
   and not has_function_privilege('service_role', 'public.bill_admission_key(jsonb)', 'execute')
   and not has_function_privilege('anon', 'public.bill_admission_key(jsonb)', 'execute')
   and not has_function_privilege('authenticated', 'public.bill_admission_key(jsonb)', 'execute'), 'bill_admission_key is owner-only');
select pg_temp.ok((select p.prosecdef and p.provolatile = 's' and p.proconfig @> array['search_path=public, extensions, pg_temp']
   from pg_proc p where p.oid = 'public.bill_admission_key(jsonb)'::regprocedure), 'definer, stable, search_path ends with pg_temp');
-- A search-only desk's file link is still refused when it is a bill's file (the five-desk rule probes this function).
select pg_temp.ok(public.bill_admission_key(jsonb_build_object('file_url','https://sansad.in/getFile/BillsTexts/x/a.pdf','document_role','synopsis',
   'document_key','bill:2025:1','citation',jsonb_build_object('bill_number','1','bill_year','2025','house','Lok Sabha','bill_name',pg_temp.bill_name(1)))) = 'bill:2025:1',
  'a bill file is still read as a bill file');
select pg_temp.ok(public.bill_admission_key(jsonb_build_object('file_url','https://example.com/a.pdf','document_role','errata','doc_type','bill_corrigendum',
   'document_key','bill:2025:1','citation',jsonb_build_object('bill_number','1','bill_year','2025','house','Lok Sabha','bill_name',pg_temp.bill_name(1)))) is null,
  'a non-official file is no bill file, whatever the role and type');

rollback;
