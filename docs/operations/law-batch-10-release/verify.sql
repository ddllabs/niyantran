-- Read-only operator checks for owner-authorized-20261026-law-auto-b10 (autopilot batch 10: 1,000 IBBI_NCLT orders from 2023
-- p00009-p00013 and 2022 p00001-p00006, tranches T1-T5). Selects every document whose registered review decision belongs to batch 10 and returns one
-- aggregate row.
-- Per-document identity: `fp` is sha256 over the sorted (collate "C") lines `source_key|actual_chunks|content_sha256`
-- joined with '\n'. Computed the same way from cohort-b10-UNSIGNED.tsv (source_key, chunks_estimate, text_sha256) it is
-- 8e3f687b10017b0c0db388d598cdec8f67fbbe0a6d4241ebeeafe1c075907cd1, so a match proves the exact cohort keys, per-document
-- chunk counts and text hashes.
-- Expected: docs 1000, indexed 1000, chunks 22647, missing_vec 0, bad_dims 0, stored_hash_ok 1000, one_job 1000,
-- ok_jobs 1000, ocr 0, published 1000, url_ok 1000, one_mem 1000, records 1000, one_doc_per_record 1000,
-- created_new 1000 (every listing created at or after its document's first job; all proposals were create-listing).
with b as (
 select doc.id, doc.source_key, doc.indexed_at, doc.content_sha256, doc.file_url,
  doc.content_sha256 = encode(sha256(convert_to(doc.ocr_text,'UTF8')),'hex') stored_hash_ok,
  (select count(*) from document_chunks c where c.document_id=doc.id) chunks,
  (select count(*) from document_chunks c where c.document_id=doc.id and c.embedding is null) missing_vec,
  (select count(*) from document_chunks c where c.document_id=doc.id and vector_dims(c.embedding)<>1536) bad_dims,
  (select count(*) from ingest_jobs j where j.document_id=doc.id) jobs,
  (select max(j.status) from ingest_jobs j where j.document_id=doc.id) job_status,
  (select sum(j.embed_tokens) from ingest_jobs j where j.document_id=doc.id) tok,
  (select sum(j.embed_cost_usd) from ingest_jobs j where j.document_id=doc.id) cost,
  (select sum(j.ocr_pages) from ingest_jobs j where j.document_id=doc.id) ocr,
  (select min(j.created_at) from ingest_jobs j where j.document_id=doc.id) job_created,
  p.status pub, l.record_id, r.row_key, r.created_at rc, r.source_url = doc.file_url url_ok,
  (select count(*) from law_source_memberships m where m.source_key=doc.source_key) mem,
  (select count(*) from law_document_links l2 where l2.record_id=l.record_id) docs_per_record
 from documents doc join ingest_text_inputs i on i.document_id=doc.id
 left join law_publications p on p.document_id=doc.id
 left join law_document_links l on l.document_id=doc.id
 left join law_records r on r.id=l.record_id
 where i.payload::jsonb#>>'{review,decision_id}' like 'owner-authorized-20261026-law-auto-b10-%')
select count(*) docs, count(indexed_at) indexed, sum(chunks) chunks, sum(missing_vec) missing_vec, sum(bad_dims) bad_dims,
 count(*) filter (where stored_hash_ok) stored_hash_ok, count(*) filter (where jobs=1) one_job, count(*) filter (where job_status='succeeded') ok_jobs,
 sum(tok) tokens, sum(cost) cost, sum(ocr) ocr, min(job_created) first_job, max(indexed_at) last_indexed,
 count(*) filter (where pub='published') published,
 count(*) filter (where url_ok) url_ok, count(*) filter (where mem=1) one_mem, count(distinct record_id) records,
 count(*) filter (where docs_per_record=1) one_doc_per_record,
 count(*) filter (where row_key like 'law-order:%' and rc >= job_created) created_new,
 encode(sha256(convert_to(string_agg(source_key||'|'||chunks||'|'||content_sha256, E'\n' order by source_key collate "C"),'UTF8')),'hex') fp
from b;
