-- Read-only operator checks for the exact five-source pilot.
with selected(source_key, expected_chunks) as (values
 ('law:trib:IBBI_NCLT:ibbi_nclt-078f589727146592',53),
 ('law:trib:IBBI_NCLT:ibbi_nclt-3ba8779ec3d364ef',38),
 ('law:trib:IBBI_NCLT:ibbi_nclt-6ebdc4363316bb97',40),
 ('law:trib:IBBI_NCLT:ibbi_nclt-8b07cefd73faeaf1',75),
 ('law:trib:IBBI_NCLT:ibbi_nclt-96b36e83a18fb8bc',35)
)
select s.source_key,d.id document_id,d.indexed_at,d.chunker_version,
 s.expected_chunks,(select count(*) from public.document_chunks c where c.document_id=d.id) actual_chunks,
 (select count(*) from public.document_chunks c where c.document_id=d.id and c.embedding is null) missing_vectors,
 d.content_sha256 = encode(sha256(convert_to(d.ocr_text,'UTF8')),'hex') text_hash_valid,
 d.metadata->'citation' citation,d.file_url,d.metadata->>'attribution' attribution,
 j.id job_id,j.status,j.stage,j.ocr_pages,j.ocr_cost_usd,j.embed_tokens,j.embed_cost_usd
from selected s left join public.documents d on d.source_key=s.source_key
left join public.ingest_jobs j on j.document_id=d.id order by s.source_key;
-- Save the first result and compare after the exact-manifest rerun: all document/job IDs,
-- indexed_at, chunk counts and spend must remain unchanged. This aggregate check is not
-- a replacement for testing actual retrieval/citation behavior.
