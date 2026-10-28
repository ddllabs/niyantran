-- F266: read-only inventory of Parliamentary question documents that have no record link yet, in the
-- page format scripts/record-mapping-repair.mjs plans from. Writes nothing. Run with
--   supabase db query --linked --project-ref <ref> -f scripts/record-mapping-inventory.sql > raw.json
-- then extract rows[0].page into <dir>/page-1.json. Documents already linked are excluded, because
-- record_mapping_apply refuses to re-approve an existing link under a different decision.
with docs as (
  select d.*
    from public.documents d
   where d.desk_tier = 'national' and d.desk_feature = 'Parliamentary Question Database'
     and not exists (select 1 from public.record_document_links l where l.document_id = d.id)
)
select jsonb_build_object(
  'captured_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'documents', coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'source_key', d.source_key, 'title', d.title, 'file_url', d.file_url,
    'content_sha256', d.content_sha256, 'indexed_at', d.indexed_at,
    'desk_tier', d.desk_tier, 'desk_feature', d.desk_feature,
    'chunks', (select count(*) from public.document_chunks c where c.document_id = d.id),
    'vectors', (select count(*) from public.document_chunks c where c.document_id = d.id and c.embedding is not null),
    'url_aliases', (select count(*) from public.documents o where o.file_url = d.file_url and o.id <> d.id),
    'citation', d.metadata->'citation', 'review', d.metadata->'review',
    'document_key_suggested', d.metadata->>'document_key_suggested',
    'source_path', d.metadata->>'source_path',
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'tier', r.tier, 'feature', r.feature, 'row_key', r.row_key, 'row', r.row,
        'expected_fingerprint', public.record_mapping_fingerprint(r.tier, r.feature, r.row_key, d.id)) order by r.row_key)
      from public.desk_rows r
      where r.tier = 'national' and r.feature = 'Parliamentary Question Database'
        and d.file_url is not null and r.row->>'source_url' = d.file_url), '[]'::jsonb)
  ) order by d.id), '[]'::jsonb)) as page
from docs d;
