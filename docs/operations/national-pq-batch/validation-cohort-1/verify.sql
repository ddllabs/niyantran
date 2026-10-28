-- Validation cohort 1: read-only verification after submission (one aggregate row). Writes nothing.
-- Status: Living (2026-10-29). Expected when complete: docs 100, indexed 100, text_hash_valid 100, chunks 829,
-- vectors 829, all_1536 true, national 100, linked_docs 100, links 114, links_equal_rows 100, url_eq true, text_eq true,
-- one_job_ok 100, ocr_pages 0, fingerprint equal to the plan (cohort.json documents; README), cost <= 0.05.
with d as (
  select * from public.documents
  where desk_feature = 'Parliamentary Question Database' and metadata->>'origin' = 'supplied-text'
    and metadata->'review'->>'decision_id' = 'national-pq-validation-20261029-v100'
), c as (
  select d.id, count(k.id) n, count(k.embedding) v, bool_and(k.id is null or vector_dims(k.embedding) = 1536) dims
  from d left join public.document_chunks k on k.document_id = d.id group by 1
), j as (
  select d.id, count(g.id) jobs, count(*) filter (where g.status = 'succeeded') ok, sum(g.ocr_pages) ocr,
         sum(g.embed_tokens) tok, sum(g.embed_cost_usd) cost
  from d left join public.ingest_jobs g on g.document_id = d.id group by 1
), l as (
  select d.id, count(x.*) links, bool_and(x.source_url = d.file_url) url_eq, bool_and(x.text_sha256 = d.content_sha256) txt_eq,
         string_agg(distinct x.decision_id, ',') link_decisions
  from d left join public.record_document_links x on x.document_id = d.id group by 1
), r as (
  select d.id, count(q.*) rows_by_url from d left join public.desk_rows q
    on q.tier = 'national' and q.feature = 'Parliamentary Question Database' and q.row->>'source_url' = d.file_url group by 1
)
select count(*) docs, count(indexed_at) indexed,
       count(*) filter (where d.content_sha256 = encode(sha256(convert_to(d.ocr_text, 'UTF8')), 'hex')) text_hash_valid,
       sum(c.n) chunks, sum(c.v) vectors, bool_and(c.dims) all_1536,
       count(*) filter (where d.desk_tier = 'national') national,
       count(*) filter (where l.links > 0) linked_docs, sum(l.links) links, count(*) filter (where l.links = r.rows_by_url) links_equal_rows,
       bool_and(coalesce(l.url_eq, false)) url_eq, bool_and(coalesce(l.txt_eq, false)) text_eq,
       string_agg(distinct l.link_decisions, ' | ') link_decisions,
       count(*) filter (where j.jobs = 1 and j.ok = 1) one_job_ok, sum(j.ocr) ocr_pages, sum(j.tok) tokens, round(sum(j.cost)::numeric, 6) cost_usd,
       encode(sha256(convert_to(string_agg(d.source_key || '|' || c.n || '|' || d.content_sha256, e'\n' order by d.source_key), 'UTF8')), 'hex') fingerprint
from d join c using (id) join j using (id) join l using (id) join r using (id);
