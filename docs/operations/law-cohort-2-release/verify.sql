-- Read-only operator checks for the exact cohort-2 sources (owner-authorized-20261023-law-cohort-2).
with selected(source_key, expected_chunks) as (values
 ('law:trib:IBBI_NCLT:ibbi_nclt-29f626f45865bd4a',80),
 ('law:trib:IBBI_NCLT:ibbi_nclt-c159d713bbe8a10b',95),
 ('law:trib:IBBI_NCLT:ibbi_nclt-d196e088bd46ae26',42),
 ('law:trib:IBBI_NCLT:ibbi_nclt-d6674663fafe2827',40),
 ('law:trib:IBBI_NCLT:ibbi_nclt-dc33a5004b2451f7',29)
)
select s.source_key,d.id document_id,d.indexed_at,d.chunker_version,
 s.expected_chunks,(select count(*) from public.document_chunks c where c.document_id=d.id) actual_chunks,
 (select count(*) from public.document_chunks c where c.document_id=d.id and c.embedding is null) missing_vectors,
 d.content_sha256 = encode(sha256(convert_to(d.ocr_text,'UTF8')),'hex') text_hash_valid,
 (select encode(sha256(convert_to(string_agg(concat_ws('|', c.chunk_index, c.char_from, c.char_to, c.chunk_hash, c.embed_hash,
    encode(sha256(convert_to(c.content,'UTF8')),'hex')), E'\n' order by c.chunk_index),'UTF8')),'hex')
  from public.document_chunks c where c.document_id=d.id) chunk_fingerprint,
 d.metadata->'citation' citation,d.file_url,d.metadata->>'attribution' attribution,
 j.id job_id,j.status,j.stage,j.ocr_pages,j.ocr_cost_usd,j.embed_tokens,j.embed_cost_usd
from selected s left join public.documents d on d.source_key=s.source_key
left join public.ingest_jobs j on j.document_id=d.id order by s.source_key;
-- Compare chunk_fingerprint, IDs, indexed_at and spend with results.json. Registration is not proof
-- of indexing; this aggregate check does not replace a retrieval/citation test.
