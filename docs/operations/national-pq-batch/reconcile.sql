-- Read-only reconciliation of the client's Lok Sabha answer batches (b01-b06) against live NTER.
-- Status: Living (2026-10-29). Writes nothing. Each statement is independent; run one at a time.
-- Selects the batches by decision prefix; the result figures of 2026-10-29 are in reconciliation-2026-10-29.md.
-- Rule 6 (2026-10-29): production reads only inside a read-only transaction that is rolled back.

-- 1. Per batch: registered, indexed, chunks/vectors, text hashes, links, jobs, spend, fingerprint.
begin transaction read only;
with d as (select id, source_key, file_url, indexed_at, content_sha256, ocr_text,
                  substring(metadata->'review'->>'decision_id' from 'national-pq-(b\d+)') b
             from public.documents where metadata->'review'->>'decision_id' like 'owner-authorized-20261027-national-pq-b%'),
c as (select d.id, count(k.id) n, count(k.embedding) v, bool_and(k.id is null or vector_dims(k.embedding) = 1536) dims
        from d left join public.document_chunks k on k.document_id = d.id group by 1),
j as (select d.id, count(g.id) jobs, count(*) filter (where g.status = 'succeeded') ok,
             count(*) filter (where g.status in ('queued','running')) pend, sum(g.embed_cost_usd) cost, sum(g.embed_tokens) tok, sum(g.ocr_pages) ocr
        from d left join public.ingest_jobs g on g.document_id = d.id group by 1),
l as (select d.id, count(x.*) links, bool_and(x.source_url = d.file_url) url_eq, bool_and(x.text_sha256 = d.content_sha256) txt_eq
        from d left join public.record_document_links x on x.document_id = d.id group by 1),
r as (select d.id, count(q.*) rows_by_url from d left join public.desk_rows q
        on q.tier = 'national' and q.feature = 'Parliamentary Question Database' and q.row->>'source_url' = d.file_url group by 1)
select b, count(*) docs, count(indexed_at) indexed, sum(c.n) chunks, sum(c.v) vectors, bool_and(c.dims) all_1536,
  count(*) filter (where content_sha256 = encode(sha256(convert_to(ocr_text,'UTF8')),'hex')) text_hash_valid,
  count(*) filter (where l.links > 0) linked_docs, sum(l.links) links, sum(r.rows_by_url) rows_by_url,
  count(*) filter (where l.links = r.rows_by_url) links_equal_rows, bool_and(coalesce(l.url_eq, true)) url_eq, bool_and(coalesce(l.txt_eq, true)) text_eq,
  sum(j.jobs) jobs, sum(j.ok) succeeded, sum(j.pend) pending, sum(j.ocr) ocr_pages, sum(j.tok) tokens, round(sum(j.cost)::numeric, 6) cost_usd,
  encode(sha256(convert_to(string_agg(d.source_key || '|' || c.n || '|' || d.content_sha256, e'\n' order by d.source_key),'UTF8')),'hex') fingerprint
from d join c using (id) join j using (id) join l using (id) join r using (id) group by b order by b;
rollback;

-- 2. Per document (export): document id, source key, exact URL, answer key, text hash, chunks, vectors, listing tuples, link decision.
begin transaction read only;
select substring(d.metadata->'review'->>'decision_id' from 'national-pq-(b\d+-t\d+)') batch_tranche,
       d.id document_id, d.source_key, d.file_url, d.metadata->>'document_key_suggested' answer_key, d.content_sha256,
       d.indexed_at, (select count(*) from public.document_chunks k where k.document_id = d.id) chunks,
       (select count(k.embedding) from public.document_chunks k where k.document_id = d.id) vectors,
       (select jsonb_agg(jsonb_build_array(l.tier, l.feature, l.row_key) order by l.row_key::int)
          from public.record_document_links l where l.document_id = d.id) listing_tuples,
       (select string_agg(distinct l.decision_id, ',') from public.record_document_links l where l.document_id = d.id) link_decision,
       (select string_agg(g.status, ',') from public.ingest_jobs g where g.document_id = d.id) job_status
from public.documents d
where d.metadata->'review'->>'decision_id' like 'owner-authorized-20261027-national-pq-b%'
order by 1, d.source_key;
rollback;

-- 3. Per-batch hash of the complete per-document tuple
--    id|source_key|file_url|content_sha256|chunks|vectors|answer_key|linked row_keys (sorted by source_key).
begin transaction read only;
with d as (select id, source_key, file_url, content_sha256, metadata->>'document_key_suggested' ak,
                  substring(metadata->'review'->>'decision_id' from 'national-pq-(b\d+)') b
             from public.documents where metadata->'review'->>'decision_id' like 'owner-authorized-20261027-national-pq-b%')
select b, count(*), encode(sha256(convert_to(string_agg(concat_ws('|', d.id, d.source_key, d.file_url, d.content_sha256,
         (select count(*) from public.document_chunks k where k.document_id = d.id),
         (select count(k.embedding) from public.document_chunks k where k.document_id = d.id), d.ak,
         (select string_agg(l.row_key, ',' order by l.row_key::int) from public.record_document_links l where l.document_id = d.id)),
         e'\n' order by d.source_key),'UTF8')),'hex') tuple_sha256
from d group by b order by b;
rollback;

-- 4. Caller visibility: the same documents, chunks and links as a signed-in (authenticated) reader under RLS.
begin transaction read only;
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true) is null;
select (select count(*) from public.documents where metadata->'review'->>'decision_id' like 'owner-authorized-20261027-national-pq-b%') docs,
       (select count(*) from public.document_chunks k join public.documents d on d.id = k.document_id
         where d.metadata->'review'->>'decision_id' like 'owner-authorized-20261027-national-pq-b%') chunks,
       (select count(*) from public.record_document_links l join public.documents d on d.id = l.document_id
         where d.metadata->'review'->>'decision_id' like 'owner-authorized-20261027-national-pq-b%') links;
rollback;

-- 5. Answer files on the listing with no document (by URL, answer key or older pack path): the next cohort's universe.
begin transaction read only;
with u as materialized (select distinct r.row->>'source_url' url from public.desk_rows r
                         where r.tier = 'national' and r.feature = 'Parliamentary Question Database'),
uk as materialized (select url, public.pq_answer_key(url) k from u),
dk as materialized (select public.pq_answer_key(file_url) k from public.documents where desk_tier = 'national' and file_url like 'https://sansad.in/%'
     union select metadata->>'document_key_suggested' from public.documents where desk_tier = 'national' and metadata ? 'document_key_suggested'),
pk as materialized (select lower(regexp_replace(metadata->>'source_path','^.*/','')) f from public.documents
                     where desk_tier = 'national' and desk_feature = 'Parliamentary Question Database' and metadata ? 'source_path')
select count(*) answer_files, count(*) filter (where k in (select k from dk)) held_by_document,
  count(*) filter (where k not in (select k from dk where k is not null)
                     and lower(split_part(k,':',3) || '_' || split_part(k,':',4) || '.pdf') in (select f from pk)) held_by_pack_path,
  count(*) filter (where k is not null and k not in (select k from dk where k is not null)
                     and lower(split_part(k,':',3) || '_' || split_part(k,':',4) || '.pdf') not in (select f from pk where f is not null)) open_answers
from uk;
rollback;
