-- admin-upload (plan B1): ingest_discard, the way out of an upload that never
-- went live, and the index admin-ingest's prepare looks a file up by. Spec:
-- docs/specs/2026-10-01-rag-v2-admin-upload.md (decision 6, "ingest_discard");
-- plan docs/plans/2026-10-01-rag-v2-admin-upload.md ("Fixed interfaces -> SQL").
-- The caller is admin-ingest's discard action
-- (supabase/functions/admin-ingest/contract.ts), which maps the refusals below
-- to a 409 not_discardable. Additive: no existing table, row or function
-- changes.
--
--   ingest_discard(p_document uuid) -> jsonb    returns {"discarded": true}
--
--   * It locks the document row first (for update), as ingest_register does
--     before it resumes a job, so a registration that re-queues this
--     document's job cannot slip in between the checks and the delete: a
--     discard that waited on the lock checks the jobs committed meanwhile.
--   * Then it refuses, with exactly one of these messages:
--       ingest_discard: document not found
--       ingest_discard: not an upload                    (source_key does not start with upload:)
--       ingest_discard: already live                     (indexed_at or extract_hash is set)
--       ingest_discard: has an active or succeeded job   (a queued, running or succeeded job)
--     So only an upload whose jobs all failed or were cancelled is discarded.
--   * Otherwise it deletes the document. Every dependent row cascades (each
--     foreign key to documents is on delete cascade): document_chunks (0003),
--     document_pages, document_page_blocks, document_page_images (page
--     contract), document_files, document_ocr_pages and ingest_jobs
--     (ingestion-v2). Stored objects in the corpus bucket are left for the
--     staging and orphan sweeper: they are content-addressed and may be shared.
--   * Security definer, search_path public, extensions; execute revoked from
--     public, anon and authenticated, granted to service_role.
--
--   documents_file_sha256: a partial btree on documents(file_sha256) where it is
--   not null (legacy rows have it null). Not unique: the same file may sit
--   under an upload: key and an R7 corpus key.
--
-- No function here has a SET clause for a custom setting (NTER's migration
-- role is not a superuser). run.sh applies this file as a non-superuser.
--
-- Down (nothing depends on either object; discarded documents stay deleted):
--
--   begin;
--   drop function public.ingest_discard(uuid);
--   drop index public.documents_file_sha256;
--   commit;

-- ---------------------------------------------------------------------------
-- The index for prepare's lookup by file hash.

create index documents_file_sha256 on public.documents (file_sha256) where file_sha256 is not null;

-- ---------------------------------------------------------------------------
-- ingest_discard.

create function public.ingest_discard(p_document uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_doc public.documents%rowtype;
begin
  select * into v_doc from public.documents where id = p_document for update;
  if not found then
    raise exception 'ingest_discard: document not found';
  end if;
  if not starts_with(v_doc.source_key, 'upload:') then
    raise exception 'ingest_discard: not an upload';
  end if;
  if v_doc.indexed_at is not null or v_doc.extract_hash is not null then
    raise exception 'ingest_discard: already live';
  end if;
  if exists (select from public.ingest_jobs
              where document_id = p_document and status in ('queued', 'running', 'succeeded')) then
    raise exception 'ingest_discard: has an active or succeeded job';
  end if;

  delete from public.documents where id = p_document;
  return jsonb_build_object('discarded', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Execute: the service role only.

revoke all on function public.ingest_discard(uuid) from public, anon, authenticated;
grant execute on function public.ingest_discard(uuid) to service_role;
