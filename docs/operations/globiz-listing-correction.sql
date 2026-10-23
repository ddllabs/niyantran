-- Status: Normative. F243: run only with owner release authorization, after the UI release.
-- Exactly one metadata listing; no ingestion, document, chunk, or job writes.
-- Re-running is a no-op only if the existing row is identical; conflicts refuse.
begin;
do $operation$
declare
  intended public.desk_rows;
  existing public.desk_rows;
begin
  select * into intended from jsonb_populate_record(null::public.desk_rows, $payload${"tier": "law", "feature": "NCLT / NCLAT (Insolvency)", "row_key": "law:trib:ibbi_nclt:ibbi_nclt-29f626f45865bd4a", "row": {"id": "law:trib:IBBI_NCLT:ibbi_nclt-29f626f45865bd4a", "source_key": "law:trib:IBBI_NCLT:ibbi_nclt-29f626f45865bd4a", "title": "In the matter of Globiz Exim Private Limited [C.P. (IB)/595/MB/2025]", "subject": "In the matter of Globiz Exim Private Limited [C.P. (IB)/595/MB/2025]", "entity": "Globiz Exim Private Limited", "date": "2026-07-08", "remarks": "Rejected", "court": "NCLT", "source_url": "https://ibbi.gov.in/uploads/order/7c2928dab0f907c71d2c2aa47f13b6ce.pdf", "entityName": "In the matter of Globiz Exim Private Limited [C.P. (IB)/595/MB/2025]", "eventDate": "2026-07-08", "sourcePublishedAt": "2026-07-08", "sourceName": "ibbi.gov.in"}, "record_text": "Record: In the matter of Globiz Exim Private Limited [C.P. (IB)/595/MB/2025]\nsource_key: law:trib:IBBI_NCLT:ibbi_nclt-29f626f45865bd4a\ntitle: In the matter of Globiz Exim Private Limited [C.P. (IB)/595/MB/2025]\nsubject: In the matter of Globiz Exim Private Limited [C.P. (IB)/595/MB/2025]\nentity: Globiz Exim Private Limited\ndate: 2026-07-08\nremarks: Rejected\ncourt: NCLT\nsource_url: https://ibbi.gov.in/uploads/order/7c2928dab0f907c71d2c2aa47f13b6ce.pdf\nentityName: In the matter of Globiz Exim Private Limited [C.P. (IB)/595/MB/2025]\neventDate: 2026-07-08\nsourcePublishedAt: 2026-07-08\nsourceName: ibbi.gov.in", "document_key": null, "snapshot_at": "2026-10-23T00:00:00Z"}$payload$::jsonb);
  if not exists (
    select 1 from public.documents d where d.id='1597c9df-162a-4d74-860d-1cbf8f5a3bb2'
      and d.source_key=intended.row->>'source_key'
      and d.file_url=intended.row->>'source_url'
      and d.indexed_at is not null
      and d.content_sha256='ee4bf7251aa037c9d358c5433f77b00dc5ff6beebee2976fd813f57b481deddc'
      and (select count(*) from public.document_chunks c where c.document_id=d.id)=80
  ) then raise exception 'Globiz document precondition failed'; end if;
  perform pg_advisory_xact_lock(hashtextextended('F243:Globiz-listing',0));
  select * into existing from public.desk_rows
    where tier=intended.tier and feature=intended.feature and row_key=intended.row_key;
  if found then
    if existing.row is distinct from intended.row or existing.record_text is distinct from intended.record_text
      or existing.document_key is not null then raise exception 'Existing Globiz row differs; reconcile first'; end if;
  else
    if exists (select 1 from public.desk_rows where tier=intended.tier and feature=intended.feature
      and row->>'source_url'=intended.row->>'source_url') then
      raise exception 'Globiz URL already listed under another key';
    end if;
    insert into public.desk_rows(tier,feature,row_key,row,record_text,document_key,snapshot_at,loaded_at)
      values(intended.tier,intended.feature,intended.row_key,intended.row,intended.record_text,null,intended.snapshot_at,now());
  end if;
end
$operation$;
commit;
-- After the authorized insert:
-- analyze public.desk_rows;
-- Verify search_desk_rows('law','NCLT / NCLAT (Insolvency)','Globiz Exim','{}',20)
-- returns this row. Verify document/chunk/job counts and fingerprints are unchanged.
