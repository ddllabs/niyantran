-- National parliamentary questions, batch 1: read-only verification (one aggregate row). Selects the batch by its
-- decision prefix, so no key list is needed. Expected on 2026-10-27 14:20 UTC: docs 1000, indexed 1000, text_hash_valid
-- 1000, chunks 11219, null_vectors 0, all_1536 true, national 1000, mapped 1000, desk_rows_covered 1228,
-- distinct_urls 1000, one_job_ok 1000, ocr_pages 0, tokens 2412145, fingerprint
-- 581081b2650fdc8eb2770cea29f11a53f2eba944ab5e9f46cfeb459cc7f132f4 (equal to plan.json).
with d as (
  select * from public.documents
  where desk_feature = 'Parliamentary Question Database' and metadata->>'origin' = 'supplied-text'
    and metadata->'review'->>'decision_id' like 'owner-authorized-20261027-national-pq-b01-%'
), c as (
  select d.source_key, count(k.id) n, count(*) filter (where k.id is not null and k.embedding is null) nullv,
         bool_and(k.id is null or vector_dims(k.embedding) = 1536) dims
  from d left join public.document_chunks k on k.document_id = d.id group by 1
), j as (
  select d.source_key, count(*) jobs, count(*) filter (where g.status = 'succeeded') ok, sum(g.ocr_pages) ocr,
         sum(g.embed_tokens) tok, sum(g.embed_cost_usd) cost
  from d left join public.ingest_jobs g on g.document_id = d.id group by 1
)
select count(*) docs, count(indexed_at) indexed,
       count(*) filter (where d.content_sha256 = encode(sha256(convert_to(d.ocr_text, 'UTF8')), 'hex')) text_hash_valid,
       sum(c.n) chunks, sum(c.nullv) null_vectors, bool_and(c.dims) all_1536,
       count(*) filter (where d.desk_tier = 'national') national,
       count(*) filter (where exists (select 1 from public.desk_rows r where r.tier = 'national'
                        and r.feature = 'Parliamentary Question Database' and r.row->>'source_url' = d.file_url)) mapped,
       (select count(*) from public.desk_rows r where r.tier = 'national' and r.feature = 'Parliamentary Question Database'
          and r.row->>'source_url' in (select file_url from d)) desk_rows_covered,
       count(distinct d.file_url) distinct_urls, count(*) filter (where j.jobs = 1 and j.ok = 1) one_job_ok,
       sum(j.ocr) ocr_pages, sum(j.tok) tokens, sum(j.cost) cost,
       encode(sha256(convert_to(string_agg(d.source_key || '|' || c.n || '|' || d.content_sha256, e'\n' order by d.source_key), 'UTF8')), 'hex') fingerprint
from d join c using (source_key) join j using (source_key);
