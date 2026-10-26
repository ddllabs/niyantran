-- Read-only operator checks for owner-authorized-20261026-law-batch-6 (1,000 IBBI_NCLT orders (2025 + 2024), tranches T1-T5).
-- Selects every document whose registered review decision belongs to batch 5 and returns one aggregate row.
-- Per-document identity: `fp` is sha256 over the sorted (collate "C") lines `source_key|actual_chunks|content_sha256`
-- joined with '\n'. Computed the same way from ../law-batch-6-prep/cohort-batch6-UNSIGNED.tsv (source_key,
-- chunks_estimate, text_sha256) it is fabf4f469466b1e983567357707ba4fb06d5f92a78ec74c8476ae9ecd6ea512d, so a match
-- proves the exact cohort keys, per-document chunk counts and text hashes.
-- Expected after batch 6 (2026-10-26): docs 1000, indexed 1000, chunks 30973, missing_vec 0, bad_dims 0, stored_hash_ok 1000,
-- one_job 1000, ok_jobs 1000, ocr 0, published 1000, url_ok 1000, one_mem 1000, records 1000, one_doc_per_record 1000,
-- created_new 1000, new_law_records 1000 (all reviewed proposals were create-listing).
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
 where i.payload::jsonb#>>'{review,decision_id}' like 'owner-authorized-20261026-law-batch-6-%')
select count(*) docs, count(indexed_at) indexed, sum(chunks) chunks, sum(missing_vec) missing_vec, sum(bad_dims) bad_dims,
 count(*) filter (where stored_hash_ok) stored_hash_ok, count(*) filter (where jobs=1) one_job, count(*) filter (where job_status='succeeded') ok_jobs,
 sum(tok) tokens, sum(cost) cost, sum(ocr) ocr, min(job_created) first_job, max(indexed_at) last_indexed,
 count(*) filter (where pub='published') published,
 count(*) filter (where url_ok) url_ok, count(*) filter (where mem=1) one_mem, count(distinct record_id) records,
 count(*) filter (where docs_per_record=1) one_doc_per_record,
 count(*) filter (where row_key like 'law-order:%' and rc >= '2026-10-26 12:00:00+00') created_new,
 (select count(*) from law_records where created_at >= '2026-10-26 12:00:00+00') new_law_records,
 encode(sha256(convert_to(string_agg(source_key||'|'||chunks||'|'||content_sha256, E'\n' order by source_key collate "C"),'UTF8')),'hex') fp
from b;
