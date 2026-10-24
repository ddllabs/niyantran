-- Read-only: audit ledger rows for every ingested Law document, as one JSON array (32 fields per row, in job order).
-- Feed the four output columns to nter-law-ledger.py as LEDGER_RAW = {"n", "md5", "len", "rows"} (or gzip+base64 "gz_b64").
with x as (
 select d.id, d.source_key, d.title, d.file_url, d.content_sha256, d.created_at, d.indexed_at,
  i.payload::jsonb pl,
  (select count(*) from document_chunks c where c.document_id = d.id) chunks,
  j.id job_id, j.status job_status, j.embed_tokens, j.embed_cost_usd, j.ocr_pages, j.created_at job_created,
  p.status pub_status, p.decision_id pub_decision, p.approver pub_approver,
  l.record_id, l.published_at, r.row_key, r.created_at rec_created, r.record_type, r.forum,
  (select m.owner from law_source_memberships m where m.source_key = d.source_key limit 1) membership_owner
 from documents d
 left join ingest_text_inputs i on i.document_id = d.id
 left join ingest_jobs j on j.document_id = d.id
 left join law_publications p on p.document_id = d.id
 left join law_document_links l on l.document_id = d.id
 left join law_records r on r.id = l.record_id
 where d.source_key like 'law:%'),
a as (
 select jsonb_agg(jsonb_build_array(
  regexp_replace(pl#>>'{review,decision_id}', '-[0-9]+$', ''), pl#>>'{review,decision_id}', source_key, title,
  pl#>>'{citation,case_number}', pl#>>'{citation,order_date}', pl->>'n_pages', file_url, id, content_sha256, chunks,
  job_id, job_status, embed_tokens, embed_cost_usd, ocr_pages,
  to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), to_char(indexed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  record_id, row_key, record_type, forum, to_char(rec_created at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), membership_owner,
  pub_status, pub_decision, pub_approver, to_char(published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  pl#>>'{review,rules_sha256}', pl#>>'{review,package_id}', pl#>>'{review,mapping_version}', pl#>>'{review,file_sha256}')
  order by job_created, source_key) j, count(*) n
 from x)
select n, md5(j::text) md5, length(j::text) len, j::text rows from a;
