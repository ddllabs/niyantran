-- admin-records (plan C1): records-first document management. Spec:
-- docs/specs/2026-10-01-rag-v2-admin-upload.md, "Amendment A (revision 3)"
-- (decisions D1-D11, "Design -> SQL"); plan
-- docs/plans/2026-10-01-rag-v2-admin-records.md ("Fixed interfaces -> SQL").
-- The caller is admin-ingest (supabase/functions/admin-ingest/contract.ts:
-- RecordsResult, UnlinkedResult, LinkResult, SwapResult, DeleteResult); it
-- maps each refusal's token to a code, and the unique violation of
-- documents_v2_document_key_unique (by constraint name) to key_held.
--
-- A record is one document key. The link stays
-- documents.metadata->>'document_key' (D1), so research-chat is unchanged.
-- An "ingestion-v2 document" has storage_path set; a legacy one (storage_path
-- null) is never modified here (D3).
--
--   corpus_admin_actions: the audit table (D7). actor and document_id have no
--     foreign key, so history survives account and document deletion; no
--     emails are stored. RLS on, no policies; service_role may only SELECT.
--     The functions below are its only writers, each in the transaction of
--     its change, exactly one row per success; a refusal raises, so it
--     writes none. key / old_key are the acted-on document's document_key
--     after / before the action (null when it holds none); a pending
--     replacement's target is in detail.
--   documents_v2_document_key_unique (D2): at most one ingestion-v2 document
--     per key; legacy duplicates are untouched. A pre-check runs first, so a
--     database with duplicates fails before anything is created, listing them.
--   ingest_jobs_document_created: the "latest job of a document" lookup.
--
-- Refusals are raised as '<function>: <token>: <detail>':
--
--   ingest_link(p_document, p_key, p_expected_key, p_actor) -> {document_id, document_key}
--       not_found, legacy, stale, wrong_desk, key_held (checked in that order)
--   ingest_unlink(p_document, p_expected_key, p_actor) -> {document_id, document_key: null}
--       not_found, legacy, stale (also when the document holds no key)
--   ingest_swap(p_new, p_expected_old, p_actor) -> {document_id, document_key, old_document_id}
--       not_found, not_replacement, stale, not_live, key_held
--   ingest_delete(p_document, p_actor) -> {deleted: true}
--       not_found, not_deletable
--   ingest_discard(p_document, p_actor default null) -> {discarded: true}
--       its four messages of 20261001160000, unchanged; now audited
--   ingest_register(p jsonb)      new refusals: wrong_desk, key_held, conflict
--
-- Rules beyond the spec's text:
--   * Desk names are compared normalised (corpus_desk_name: lower case, each
--     run of non-alphanumerics one space, trimmed) wherever a document's desk
--     (corpus spelling) meets desk_rows or a caller's desk (catalogue
--     spelling). admin_desk_records reads desk_rows by the exact catalogue
--     spelling it is given, so the (tier, feature) index applies.
--   * The desk check (D8, D10), corpus_key_in_desk: a desk_rows row of the
--     tier with document_key = key, under the feature or, for the two bill
--     features of tier national, under either one. A null key never passes.
--   * Every function that sets a key takes pg_advisory_xact_lock(hashtext(
--     'corpus-key:' || key)) after its row locks and before it looks for the
--     key's holder, so register, link and swap of one key are serialised: a
--     second one waits, then sees the first's holder and refuses key_held
--     instead of reaching the unique index.
--   * Link removes a pending link_target/replaces (the document now has its
--     record). Unlink removes document_key only.
--   * Swap locks p_new and p_expected_old in id order, then reads the new
--     document's link_target and replaces; replaces must equal p_expected_old
--     (both may be null) or it is stale. If the old document still holds the
--     target (ingestion-v2 only; a legacy holder is never modified) it loses
--     the key and old_document_id is its id; otherwise the new document is
--     linked directly unless another ingestion-v2 document holds the key.
--   * Delete: an upload (source_key upload:..., storage_path set) in any
--     state. A queued or running job is cancelled first (status cancelled,
--     claim cleared), then the document is deleted and everything cascades;
--     stored objects stay for the sweeper (F38).
--   * ingest_register(p) keeps every rule and result key of 20261001140000
--     and adds, from the top level of p or from p.metadata (the same value
--     in both, or refused):
--       document_key   the key to link;
--       link_target    register unlinked, pending a swap to this key;
--       replaces       the document a replacement replaces (needs a key; it
--                      registers unlinked with link_target = key);
--       no_public_source  a boolean, stored as metadata.no_public_source = true;
--     and, at the top level only, key_check ('desk' from admin-ingest, absent
--     for scripts) and actor (the audit actor; requested_by when absent).
--     With key_check 'desk', the key must pass the desk check for p's
--     desk_tier/desk_feature (wrong_desk) and a key held by another
--     ingestion-v2 document is refused (key_held) unless replaces names the
--     holder. Without it (scripts, D8) the key may be any text; when held it
--     registers unlinked with link_target = key. The four fields are kept
--     out of metadata unless set by these rules. When a key was given the
--     result also has linked, document_key and link_target; an 'attach' audit
--     row is written when a key or link_target is set.
--   * Resume (a failed or cancelled job, the same file): with no key given,
--     as before. A document with no link yet gets the fields under the same
--     checks (audited, detail.resumed = true). A linked document accepts only
--     its own key, without replaces; a pending one only its own target and
--     replaces (re-checked). Anything else, or with key_check 'desk' a desk
--     other than the document's, is refused with conflict. no_public_source
--     true is added when missing.
--   * admin_desk_records lists the requested feature's rows only (for bills,
--     the canonical Bill Passage Probability Index; Policy Intelligence Graph
--     holds the same keys, D10), one entry per key. A record's documents are
--     every document holding the key (any desk, legacy or not) and every
--     ingestion-v2 document targeting it (link_target); each has link_target,
--     the key it waits to swap into, null for one holding the key, so the page
--     tells the holder from a replacement. Status, from those
--     documents and their latest job (created_at desc, id desc):
--       processing        an ingestion-v2 one's latest job is queued or running
--       failed            an ingestion-v2 one is not indexed and its latest
--                         job failed or was cancelled
--       full_text         an indexed ingestion-v2 document holds the key
--       full_text_legacy  an indexed legacy document holds the key
--       record_only       otherwise
--     Search: any of the key's rows has record_text ilike %query%, with \, %
--     and _ escaped. Sort: the newest introduction date among the key's rows
--     (row->>'date_introduced', else row->>'date'; ISO text, so compared as
--     text), nulls last, then key. Limit clamped to 1..50, offset to >= 0;
--     total counts keys after search and status. Coverage counts the
--     feature's keys, those with an indexed holder, and orphaned links:
--     ingestion-v2 documents of the desk (for bills, either bill feature)
--     whose key no desk row of the desk has.
--   * admin_unlinked_documents: ingestion-v2 documents of the desk (for
--     bills, either bill feature) with no key, an orphaned key, or a
--     link_target; title search escaped as above; newest first.
--   * Read functions are security invoker (service_role reads documents,
--     desk_rows and ingest_jobs). corpus_desk_name and corpus_desk_features
--     are granted to service_role for them; corpus_key_in_desk and corpus_link_plan run only
--     inside the security-definer functions and are granted to no one.
--
-- No function here has a SET clause for a custom setting (NTER's migration
-- role is not a superuser). run.sh applies this file as a non-superuser, and
-- executes the pre-check against seeded duplicates and the Down below.
--
-- Down (metadata keys written meanwhile - document_key, link_target,
-- replaces, no_public_source - stay; the audit rows are dropped):
--
--   begin;
--   drop function public.admin_desk_records(text, text, text, text, int, int);
--   drop function public.admin_unlinked_documents(text, text, text, int, int);
--   drop function public.ingest_link(uuid, text, text, uuid);
--   drop function public.ingest_unlink(uuid, text, uuid);
--   drop function public.ingest_swap(uuid, uuid, uuid);
--   drop function public.ingest_delete(uuid, uuid);
--   drop function public.ingest_discard(uuid, uuid);
--   drop function public.ingest_register(jsonb);
--   drop function public.corpus_link_plan(text, text, text, boolean, uuid, boolean, uuid);
--   drop function public.corpus_key_in_desk(text, text, text);
--   drop function public.corpus_desk_features(text, text);
--   drop function public.corpus_desk_name(text);
--   drop index public.documents_v2_document_key_unique;
--   drop index public.ingest_jobs_document_created;
--   drop table public.corpus_admin_actions;
--   -- run 20261001140000_ingestion_v2.sql's "create function public.ingest_register"
--   --   statement and its ingest_register revoke and grant;
--   -- run 20261001160000_ingest_discard.sql's "create function public.ingest_discard"
--   --   statement and its ingest_discard revoke and grant;
--   commit;
--
-- Run it as the role that applied the migration, so the restored functions
-- have the same owner.

-- ---------------------------------------------------------------------------
-- The D2 pre-check. First, so a refused migration has created nothing.

do $$
declare
  v_dups text;
begin
  select string_agg(format('%s -> %s', k, ids), '; ' order by k) into v_dups
    from (select metadata->>'document_key' as k, string_agg(id::text, ', ' order by id) as ids
            from public.documents
           where storage_path is not null and metadata->>'document_key' is not null
           group by 1
          having count(*) > 1) d;
  if v_dups is not null then
    raise exception 'corpus_records: ingestion-v2 documents share a document_key; resolve these before applying: %', v_dups;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The audit table (D7).

create table public.corpus_admin_actions (
  id          uuid        primary key default gen_random_uuid(),
  at          timestamptz not null default now(),
  actor       uuid,                    -- no foreign key: history survives account deletion
  action      text        not null check (action in ('attach', 'link', 'unlink', 'swap', 'delete', 'discard')),
  document_id uuid,                    -- no foreign key: history survives document deletion
  key         text,
  old_key     text,
  detail      jsonb       not null default '{}'::jsonb
);

alter table public.corpus_admin_actions enable row level security;
revoke all on table public.corpus_admin_actions from public, anon, authenticated, service_role;
grant select on table public.corpus_admin_actions to service_role;

-- ---------------------------------------------------------------------------
-- Indexes.

create unique index documents_v2_document_key_unique on public.documents ((metadata->>'document_key'))
  where storage_path is not null and metadata ? 'document_key';
create index ingest_jobs_document_created on public.ingest_jobs (document_id, created_at desc);

-- ---------------------------------------------------------------------------
-- The desk check (D8, D10).

-- A desk name for comparison: lower case, every run of non-alphanumeric
-- characters one space, trimmed. desk_rows and admin-ingest use the catalogue
-- spelling of a desk; documents.desk_tier/desk_feature hold the corpus
-- spelling, which can differ in punctuation and spacing
-- ("(RBI / SEBI / TRAI / CCI)" against "(RBI/SEBI/TRAI/CCI)").
create function public.corpus_desk_name(p text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select btrim(regexp_replace(lower(p), '[^[:alnum:]]+', ' ', 'g'))
$$;

-- The normalised features a desk's keys may come from: both bill features
-- for either one (D10), else the feature itself.
create function public.corpus_desk_features(p_tier text, p_feature text)
returns text[]
language sql
immutable
set search_path = public, extensions
as $$
  select case
           when public.corpus_desk_name(p_tier) = 'national'
                and public.corpus_desk_name(p_feature) in ('bill passage probability index', 'policy intelligence graph')
             then array['bill passage probability index', 'policy intelligence graph']
           else array[public.corpus_desk_name(p_feature)]
         end
$$;

create function public.corpus_key_in_desk(p_tier text, p_feature text, p_key text)
returns boolean
language sql
stable
set search_path = public, extensions
as $$
  select p_key is not null
         and exists (select from public.desk_rows r
                      where r.document_key = p_key
                        and public.corpus_desk_name(r.tier) = public.corpus_desk_name(p_tier)
                        and public.corpus_desk_name(r.feature) = any (public.corpus_desk_features(p_tier, p_feature)))
$$;

-- How a registration links: {document_key} or {link_target[, replaces]}.
-- Raises 'ingest_register: wrong_desk|key_held: ...'. Takes the key's lock.
create function public.corpus_link_plan(p_tier text, p_feature text, p_key text, p_pending boolean,
                                        p_replaces uuid, p_desk boolean, p_self uuid)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  v_holder uuid;
begin
  if p_desk and not public.corpus_key_in_desk(p_tier, p_feature, p_key) then
    raise exception 'ingest_register: wrong_desk: % is not a record of %/%', p_key, coalesce(p_tier, '-'), coalesce(p_feature, '-');
  end if;
  perform pg_advisory_xact_lock(hashtext('corpus-key:' || p_key));
  select id into v_holder
    from public.documents
   where storage_path is not null and metadata->>'document_key' = p_key and id is distinct from p_self
   limit 1;
  if p_pending then
    if p_desk and v_holder is not null and v_holder is distinct from p_replaces then
      raise exception 'ingest_register: key_held: % is held by document %', p_key, v_holder;
    end if;
    return jsonb_build_object('link_target', p_key)
           || case when p_replaces is null then '{}'::jsonb else jsonb_build_object('replaces', p_replaces) end;
  end if;
  if v_holder is not null then
    if p_desk then
      raise exception 'ingest_register: key_held: % is held by document %', p_key, v_holder;
    end if;
    return jsonb_build_object('link_target', p_key);
  end if;
  return jsonb_build_object('document_key', p_key);
end;
$$;

-- ---------------------------------------------------------------------------
-- ingest_register: 20261001140000's function, plus the link fields.

create or replace function public.ingest_register(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  c_bucket    constant text   := 'corpus';
  c_max_bytes constant bigint := 50000000;
  c_fields    constant text[] := array['document_key', 'link_target', 'replaces', 'no_public_source'];
  v_source_key text;
  v_title      text;
  v_file_sha   text;
  v_pages      int;
  v_metadata   jsonb;
  v_files      jsonb;
  v_part       jsonb;
  v_k          int := 0;
  v_offset     int := 0;
  v_index      int;
  v_poffset    int;
  v_pcount     int;
  v_sha        text;
  v_size       bigint;
  v_path       text;
  v_path0      text;
  v_stored     bigint;
  v_doc        public.documents%rowtype;
  v_job        public.ingest_jobs%rowtype;
  v_doc_id     uuid;
  v_job_id     uuid;
  -- Amendment A.
  v_name       text;
  v_desk       boolean;
  v_key        text;
  v_target     text;
  v_want       text;
  v_text       text;
  v_replaces   uuid;
  v_pending    boolean;
  v_nps_json   jsonb;
  v_nps        boolean;
  v_actor      uuid;
  v_link       jsonb := '{}'::jsonb;
  v_exist      jsonb;
  v_meta       jsonb;
  v_result     jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'ingest_register: p must be a json object';
  end if;

  v_source_key := nullif(btrim(p->>'source_key'), '');
  v_title      := nullif(btrim(p->>'title'), '');
  v_file_sha   := p->>'file_sha256';
  v_metadata   := coalesce(p->'metadata', '{}'::jsonb);
  v_files      := p->'files';
  if v_source_key is null then
    raise exception 'ingest_register: source_key is required';
  end if;
  if v_title is null then
    raise exception 'ingest_register: title is required';
  end if;
  if v_file_sha is null or v_file_sha !~ '^[0-9a-f]{64}$' then
    raise exception 'ingest_register: file_sha256 must be 64 lowercase hex characters';
  end if;
  if jsonb_typeof(v_metadata) <> 'object' then
    raise exception 'ingest_register: metadata must be a json object';
  end if;
  if jsonb_typeof(p->'page_count') is distinct from 'number' then
    raise exception 'ingest_register: page_count is required';
  end if;
  v_pages := (p->>'page_count')::int;
  if v_pages < 1 then
    raise exception 'ingest_register: page_count must be at least 1';
  end if;
  if jsonb_typeof(v_files) is distinct from 'array' or jsonb_array_length(v_files) = 0 then
    raise exception 'ingest_register: files must be a non-empty array';
  end if;

  -- Parts, in part_index order: contiguous from 0, each starting where the
  -- previous one ended, content-addressed, and present in the bucket at the
  -- stated size.
  for v_part in
    select e from jsonb_array_elements(v_files) e order by (e->>'part_index')::int
  loop
    v_index   := (v_part->>'part_index')::int;
    v_poffset := (v_part->>'page_offset')::int;
    v_pcount  := (v_part->>'page_count')::int;
    v_sha     := v_part->>'sha256';
    v_size    := (v_part->>'byte_size')::bigint;
    v_path    := v_part->>'storage_path';
    if v_index is distinct from v_k then
      raise exception 'ingest_register: parts must be numbered 0..n-1 without gaps (expected part %, got %)', v_k, v_index;
    end if;
    if v_pcount is null or v_pcount < 1 then
      raise exception 'ingest_register: part % must have page_count of at least 1', v_k;
    end if;
    if v_poffset is distinct from v_offset then
      raise exception 'ingest_register: part % must start at page_offset % (got %)', v_k, v_offset, v_poffset;
    end if;
    if v_sha is null or v_sha !~ '^[0-9a-f]{64}$' then
      raise exception 'ingest_register: part % sha256 must be 64 lowercase hex characters', v_k;
    end if;
    if v_path is distinct from 'files/' || v_sha || '.pdf' then
      raise exception 'ingest_register: part % storage_path must be files/<sha256>.pdf', v_k;
    end if;
    if v_size is null or v_size < 1 or v_size > c_max_bytes then
      raise exception 'ingest_register: part % byte_size must be between 1 and % bytes', v_k, c_max_bytes;
    end if;
    select (o.metadata->>'size')::bigint into v_stored
      from storage.objects o
     where o.bucket_id = c_bucket and o.name = v_path;
    if not found then
      raise exception 'ingest_register: part % object % is not in the % bucket', v_k, v_path, c_bucket;
    end if;
    if v_stored is distinct from v_size then
      raise exception 'ingest_register: part % object % has size %, expected %', v_k, v_path, v_stored, v_size;
    end if;
    if v_k = 0 then
      v_path0 := v_path;
    end if;
    v_offset := v_offset + v_pcount;
    v_k := v_k + 1;
  end loop;
  if v_offset <> v_pages then
    raise exception 'ingest_register: parts cover % pages, page_count is %', v_offset, v_pages;
  end if;
  if v_k = 1 and v_sha <> v_file_sha then
    raise exception 'ingest_register: a single part must be the whole file (sha256 = file_sha256)';
  end if;

  -- The link fields (Amendment A): at the top level or in metadata, never
  -- both with different values; kept out of metadata unless the rules set them.
  if p->>'key_check' is not null and p->>'key_check' <> 'desk' then
    raise exception 'ingest_register: key_check must be ''desk'' or absent';
  end if;
  v_desk := p->>'key_check' is not null;
  foreach v_name in array c_fields loop
    if p ? v_name and v_metadata ? v_name and (p->v_name) is distinct from (v_metadata->v_name) then
      raise exception 'ingest_register: % is given at the top level and in metadata with different values', v_name;
    end if;
  end loop;
  v_key    := nullif(btrim(coalesce(p->>'document_key', v_metadata->>'document_key')), '');
  v_target := nullif(btrim(coalesce(p->>'link_target', v_metadata->>'link_target')), '');
  v_text   := nullif(btrim(coalesce(p->>'replaces', v_metadata->>'replaces')), '');
  if v_text is not null then
    if v_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'ingest_register: replaces must be a document id';
    end if;
    v_replaces := v_text::uuid;
  end if;
  v_nps_json := coalesce(p->'no_public_source', v_metadata->'no_public_source');
  if v_nps_json is not null and jsonb_typeof(v_nps_json) not in ('boolean', 'null') then
    raise exception 'ingest_register: no_public_source must be a boolean';
  end if;
  v_nps := coalesce((v_nps_json #>> '{}')::boolean, false);
  if v_key is not null and v_target is not null and v_key <> v_target then
    raise exception 'ingest_register: document_key and link_target differ';
  end if;
  v_want := coalesce(v_key, v_target);
  if v_replaces is not null and v_want is null then
    raise exception 'ingest_register: replaces needs document_key';
  end if;
  v_pending  := v_target is not null or v_replaces is not null;
  v_actor    := coalesce(nullif(p->>'actor', '')::uuid, nullif(p->>'requested_by', '')::uuid);
  v_metadata := v_metadata - c_fields;

  -- An existing document with this source_key.
  select * into v_doc from public.documents where source_key = v_source_key for update;
  if found then
    if v_doc.storage_path is null then
      raise exception 'ingest_register: % is a legacy document (no storage_path); refused', v_source_key;
    end if;
    if v_doc.file_sha256 is distinct from v_file_sha then
      raise exception 'ingest_register: % exists with a different file; refused', v_source_key;
    end if;
    if v_doc.extract_hash is not null then
      raise exception 'ingest_register: % is already extracted; re-extraction is refused', v_source_key;
    end if;
    if exists (select from public.ingest_jobs
                where document_id = v_doc.id and status in ('queued', 'running', 'succeeded')) then
      raise exception 'ingest_register: % already has an active or succeeded job; refused', v_source_key;
    end if;
    select * into v_job from public.ingest_jobs
     where document_id = v_doc.id and status in ('failed', 'cancelled')
     order by created_at desc, id desc
     limit 1
     for update;
    if not found then
      raise exception 'ingest_register: % has no job to resume; refused', v_source_key;
    end if;

    -- Resume applies the link fields under the same checks, or refuses.
    v_exist := v_doc.metadata;
    if v_want is not null then
      if v_desk and (public.corpus_desk_name(v_doc.desk_tier) is distinct from public.corpus_desk_name(nullif(p->>'desk_tier', ''))
                     or public.corpus_desk_name(v_doc.desk_feature) is distinct from public.corpus_desk_name(nullif(p->>'desk_feature', ''))) then
        raise exception 'ingest_register: conflict: % is registered under desk %/%', v_source_key,
          coalesce(v_doc.desk_tier, '-'), coalesce(v_doc.desk_feature, '-');
      end if;
      if v_exist->>'document_key' is not null then
        if v_want is distinct from v_exist->>'document_key' or v_pending then
          raise exception 'ingest_register: conflict: % is linked to %', v_source_key, v_exist->>'document_key';
        end if;
        if v_desk and not public.corpus_key_in_desk(v_doc.desk_tier, v_doc.desk_feature, v_want) then
          raise exception 'ingest_register: wrong_desk: % is not a record of %/%', v_want,
            coalesce(v_doc.desk_tier, '-'), coalesce(v_doc.desk_feature, '-');
        end if;
      elsif v_exist->>'link_target' is not null then
        if v_want is distinct from v_exist->>'link_target' or v_replaces::text is distinct from v_exist->>'replaces' then
          raise exception 'ingest_register: conflict: % is pending a swap to %', v_source_key, v_exist->>'link_target';
        end if;
        perform public.corpus_link_plan(v_doc.desk_tier, v_doc.desk_feature, v_want, true, v_replaces, v_desk, v_doc.id);
      else
        v_link := public.corpus_link_plan(v_doc.desk_tier, v_doc.desk_feature, v_want, v_pending, v_replaces, v_desk, v_doc.id);
      end if;
    end if;
    if v_nps and (v_exist->>'no_public_source') is distinct from 'true' then
      v_link := v_link || jsonb_build_object('no_public_source', true);
    end if;
    v_meta := v_exist || v_link;
    if v_link <> '{}'::jsonb then
      update public.documents set metadata = v_meta where id = v_doc.id;
    end if;
    if v_link ? 'document_key' or v_link ? 'link_target' then
      insert into public.corpus_admin_actions (actor, action, document_id, key, old_key, detail)
      values (v_actor, 'attach', v_doc.id, v_meta->>'document_key', null,
              jsonb_build_object('linked', v_meta ? 'document_key', 'link_target', v_meta->>'link_target',
                                 'replaces', v_meta->>'replaces', 'resumed', true));
    end if;

    perform public.ingest_retry(v_job.id);
    v_result := jsonb_build_object('document_id', v_doc.id, 'job_id', v_job.id, 'status', 'queued', 'resumed', true);
    if v_want is not null then
      v_result := v_result || jsonb_build_object('linked', (v_meta->>'document_key') is not distinct from v_want,
                                                 'document_key', v_meta->>'document_key', 'link_target', v_meta->>'link_target');
    end if;
    return v_result;
  end if;

  if v_want is not null then
    v_link := public.corpus_link_plan(nullif(p->>'desk_tier', ''), nullif(p->>'desk_feature', ''),
                                      v_want, v_pending, v_replaces, v_desk, null);
  end if;
  if v_nps then
    v_link := v_link || jsonb_build_object('no_public_source', true);
  end if;
  v_meta := v_metadata || v_link;

  insert into public.documents
    (source_key, title, file_name, file_url, desk_tier, desk_feature, metadata,
     content_sha256, ocr_text, page_count, indexed_at,
     storage_path, file_sha256, source_mime)
  values
    (v_source_key, v_title, nullif(p->>'file_name', ''), nullif(p->>'file_url', ''),
     nullif(p->>'desk_tier', ''), nullif(p->>'desk_feature', ''), v_meta,
     encode(sha256(''::bytea), 'hex'), '', v_pages, null,
     v_path0, v_file_sha, 'application/pdf')
  returning id into v_doc_id;

  insert into public.document_files (document_id, part_index, page_offset, page_count, sha256, byte_size, storage_path)
  select v_doc_id, (e->>'part_index')::int, (e->>'page_offset')::int, (e->>'page_count')::int,
         e->>'sha256', (e->>'byte_size')::bigint, e->>'storage_path'
    from jsonb_array_elements(v_files) e;

  insert into public.ingest_jobs (document_id, status, stage, file_sha256, pages_total, next_attempt_at, requested_by)
  values (v_doc_id, 'queued', 'ocr', v_file_sha, v_pages, now(), nullif(p->>'requested_by', '')::uuid)
  returning id into v_job_id;

  v_result := jsonb_build_object('document_id', v_doc_id, 'job_id', v_job_id, 'status', 'queued', 'resumed', false);
  if v_want is not null then
    insert into public.corpus_admin_actions (actor, action, document_id, key, old_key, detail)
    values (v_actor, 'attach', v_doc_id, v_meta->>'document_key', null,
            jsonb_build_object('linked', v_meta ? 'document_key', 'link_target', v_meta->>'link_target',
                               'replaces', v_meta->>'replaces', 'resumed', false));
    v_result := v_result || jsonb_build_object('linked', v_meta ? 'document_key',
                                               'document_key', v_meta->>'document_key', 'link_target', v_meta->>'link_target');
  end if;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- ingest_link and ingest_unlink (compare-and-set, D11).

create function public.ingest_link(p_document uuid, p_key text, p_expected_key text, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_doc    public.documents%rowtype;
  v_old    text;
  v_holder uuid;
begin
  select * into v_doc from public.documents where id = p_document for update;
  if not found then
    raise exception 'ingest_link: not_found: document %', p_document;
  end if;
  if v_doc.storage_path is null then
    raise exception 'ingest_link: legacy: document % is a legacy document and is read-only', p_document;
  end if;
  v_old := v_doc.metadata->>'document_key';
  if v_old is distinct from p_expected_key then
    raise exception 'ingest_link: stale: document % holds %, not %', p_document,
      coalesce(v_old, '(no key)'), coalesce(p_expected_key, '(no key)');
  end if;
  if not public.corpus_key_in_desk(v_doc.desk_tier, v_doc.desk_feature, p_key) then
    raise exception 'ingest_link: wrong_desk: % is not a record of %/%', coalesce(p_key, '(no key)'),
      coalesce(v_doc.desk_tier, '-'), coalesce(v_doc.desk_feature, '-');
  end if;
  perform pg_advisory_xact_lock(hashtext('corpus-key:' || p_key));
  select id into v_holder
    from public.documents
   where storage_path is not null and metadata->>'document_key' = p_key and id <> p_document
   limit 1;
  if v_holder is not null then
    raise exception 'ingest_link: key_held: % is held by document %', p_key, v_holder;
  end if;

  update public.documents
     set metadata = (metadata - 'link_target' - 'replaces') || jsonb_build_object('document_key', p_key)
   where id = p_document;
  insert into public.corpus_admin_actions (actor, action, document_id, key, old_key, detail)
  values (p_actor, 'link', p_document, p_key, v_old,
          jsonb_build_object('link_target', v_doc.metadata->>'link_target', 'replaces', v_doc.metadata->>'replaces'));
  return jsonb_build_object('document_id', p_document, 'document_key', p_key);
end;
$$;

create function public.ingest_unlink(p_document uuid, p_expected_key text, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_doc public.documents%rowtype;
  v_old text;
begin
  select * into v_doc from public.documents where id = p_document for update;
  if not found then
    raise exception 'ingest_unlink: not_found: document %', p_document;
  end if;
  if v_doc.storage_path is null then
    raise exception 'ingest_unlink: legacy: document % is a legacy document and is read-only', p_document;
  end if;
  v_old := v_doc.metadata->>'document_key';
  if v_old is null or v_old is distinct from p_expected_key then
    raise exception 'ingest_unlink: stale: document % holds %, not %', p_document,
      coalesce(v_old, '(no key)'), coalesce(p_expected_key, '(no key)');
  end if;

  update public.documents set metadata = metadata - 'document_key' where id = p_document;
  insert into public.corpus_admin_actions (actor, action, document_id, key, old_key)
  values (p_actor, 'unlink', p_document, null, v_old);
  return jsonb_build_object('document_id', p_document, 'document_key', null);
end;
$$;

-- ---------------------------------------------------------------------------
-- ingest_swap: the second step of Replace (D5).

create function public.ingest_swap(p_new uuid, p_expected_old uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_new    public.documents%rowtype;
  v_old_id uuid;
  v_target text;
  v_holder uuid;
begin
  -- Both rows, in id order, before anything is read.
  perform 1 from public.documents where id in (p_new, p_expected_old) order by id for update;
  select * into v_new from public.documents where id = p_new;
  if not found then
    raise exception 'ingest_swap: not_found: document %', p_new;
  end if;
  v_target := v_new.metadata->>'link_target';
  if v_new.storage_path is null or v_target is null then
    raise exception 'ingest_swap: not_replacement: document % has no link_target', p_new;
  end if;
  if (v_new.metadata->>'replaces') is distinct from p_expected_old::text then
    raise exception 'ingest_swap: stale: document % replaces %, not %', p_new,
      coalesce(v_new.metadata->>'replaces', '(none)'), coalesce(p_expected_old::text, '(none)');
  end if;
  if v_new.indexed_at is null then
    raise exception 'ingest_swap: not_live: document % is not indexed yet', p_new;
  end if;
  perform pg_advisory_xact_lock(hashtext('corpus-key:' || v_target));

  -- Does the old document still hold the target?
  select id into v_old_id
    from public.documents
   where id = p_expected_old and storage_path is not null and metadata->>'document_key' = v_target;
  if v_old_id is null then
    select id into v_holder
      from public.documents
     where storage_path is not null and metadata->>'document_key' = v_target and id <> p_new
     limit 1;
    if v_holder is not null then
      raise exception 'ingest_swap: key_held: % is held by document %', v_target, v_holder;
    end if;
  else
    update public.documents set metadata = metadata - 'document_key' where id = v_old_id;
  end if;

  update public.documents
     set metadata = (metadata - 'link_target' - 'replaces') || jsonb_build_object('document_key', v_target)
   where id = p_new;
  insert into public.corpus_admin_actions (actor, action, document_id, key, old_key, detail)
  values (p_actor, 'swap', p_new, v_target, v_new.metadata->>'document_key',
          jsonb_build_object('old_document_id', v_old_id, 'replaces', p_expected_old));
  return jsonb_build_object('document_id', p_new, 'document_key', v_target, 'old_document_id', v_old_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- ingest_delete: admin uploads only (D4).

create function public.ingest_delete(p_document uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_doc       public.documents%rowtype;
  v_cancelled uuid;
begin
  select * into v_doc from public.documents where id = p_document for update;
  if not found then
    raise exception 'ingest_delete: not_found: document %', p_document;
  end if;
  if v_doc.storage_path is null or not starts_with(v_doc.source_key, 'upload:') then
    raise exception 'ingest_delete: not_deletable: document % is not an admin upload', p_document;
  end if;

  update public.ingest_jobs
     set status      = 'cancelled',
         claim_token = null,
         lease_until = null,
         finished_at = now()
   where document_id = p_document and status in ('queued', 'running')
  returning id into v_cancelled;
  delete from public.documents where id = p_document;

  insert into public.corpus_admin_actions (actor, action, document_id, key, old_key, detail)
  values (p_actor, 'delete', p_document, null, v_doc.metadata->>'document_key',
          jsonb_build_object('source_key', v_doc.source_key, 'file_sha256', v_doc.file_sha256,
                             'link_target', v_doc.metadata->>'link_target', 'cancelled_job', v_cancelled));
  return jsonb_build_object('deleted', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- ingest_discard: 20261001160000's rules, now with an actor and an audit row.

drop function public.ingest_discard(uuid);

create function public.ingest_discard(p_document uuid, p_actor uuid default null)
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
  insert into public.corpus_admin_actions (actor, action, document_id, key, old_key, detail)
  values (p_actor, 'discard', p_document, null, v_doc.metadata->>'document_key',
          jsonb_build_object('source_key', v_doc.source_key, 'file_sha256', v_doc.file_sha256,
                             'link_target', v_doc.metadata->>'link_target'));
  return jsonb_build_object('discarded', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_desk_records: one entry per key of the desk (security invoker).

create function public.admin_desk_records(p_tier text, p_feature text, p_query text, p_status text,
                                          p_limit int, p_offset int)
returns jsonb
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_limit    int  := least(greatest(coalesce(p_limit, 50), 1), 50);
  v_offset   int  := greatest(coalesce(p_offset, 0), 0);
  v_query    text := nullif(btrim(p_query), '');
  v_like     text;
  v_features text[] := public.corpus_desk_features(p_tier, p_feature);
  v_total    int;
  v_records  jsonb;
  v_coverage jsonb;
begin
  if p_status is not null
     and p_status not in ('processing', 'failed', 'full_text', 'full_text_legacy', 'record_only') then
    raise exception 'admin_desk_records: unknown status %', p_status;
  end if;
  if v_query is not null then
    v_like := '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  with hits as (
    select distinct r.document_key as key
      from public.desk_rows r
     where r.tier = p_tier and r.feature = p_feature and r.document_key is not null
       and (v_like is null or r.record_text ilike v_like escape '\')
  ), rows_ as (
    select r.document_key as key, r.row_key, r.row,
           coalesce(r.row->>'date_introduced', r.row->>'date') as date
      from public.desk_rows r
     where r.tier = p_tier and r.feature = p_feature and r.document_key in (select key from hits)
  ), docs as (
    select coalesce(d.metadata->>'document_key', d.metadata->>'link_target') as key,
           d.metadata->>'document_key' is not null as holds,
           d.metadata->>'link_target' as link_target,
           d.id, d.title, d.source_key, d.storage_path is null as legacy, d.indexed_at is not null as indexed,
           d.created_at, j.status as job_status, j.stage as job_stage, j.error_code as job_error
      from public.documents d
      left join lateral (select x.status, x.stage, x.error_code
                           from public.ingest_jobs x
                          where x.document_id = d.id
                          order by x.created_at desc, x.id desc
                          limit 1) j on true
     where d.metadata->>'document_key' in (select key from hits)
        or (d.storage_path is not null and d.metadata->>'link_target' in (select key from hits))
  ), stat as (
    select key,
           bool_or(not legacy and job_status in ('queued', 'running'))                  as processing,
           bool_or(not legacy and not indexed and job_status in ('failed', 'cancelled')) as failed,
           bool_or(holds and not legacy and indexed)                                     as full_text,
           bool_or(holds and legacy and indexed)                                         as full_text_legacy
      from docs
     group by key
  ), dates as (
    select key, max(date) as sort_date from rows_ group by key
  ), keyed as (
    select h.key,
           dt.sort_date,
           case when s.processing then 'processing'
                when s.failed then 'failed'
                when s.full_text then 'full_text'
                when s.full_text_legacy then 'full_text_legacy'
                else 'record_only' end as status
      from hits h
      left join dates dt on dt.key = h.key
      left join stat s on s.key = h.key
  ), filtered as (
    select * from keyed where p_status is null or status = p_status
  ), page as (
    select f.*, row_number() over (order by f.sort_date desc nulls last, f.key) as ord
      from filtered f
     order by f.sort_date desc nulls last, f.key
     limit v_limit offset v_offset
  )
  select (select count(*) from filtered),
         coalesce((select jsonb_agg(jsonb_build_object(
                     'document_key', pg.key,
                     'status', pg.status,
                     'rows', (select jsonb_agg(jsonb_build_object(
                                       'row_key', x.row_key,
                                       'title', coalesce(x.row->>'bill_name', x.row->>'title', x.row->>'name', x.row_key),
                                       'house', x.row->>'house',
                                       'date', x.date)
                                     order by x.date desc nulls last, x.row_key)
                                from (select r.row_key, r.row, coalesce(r.row->>'date_introduced', r.row->>'date') as date
                                        from public.desk_rows r
                                       where r.tier = p_tier and r.feature = p_feature and r.document_key = pg.key) x),
                     'source_hint', (select min(r.row->>'source_url') from public.desk_rows r
                                      where r.tier = p_tier and r.feature = p_feature and r.document_key = pg.key),
                     'documents', coalesce((select jsonb_agg(jsonb_build_object(
                                                      'document_id', d.id,
                                                      'title', d.title,
                                                      'source_key', d.source_key,
                                                      'legacy', d.legacy,
                                                      'indexed', d.indexed,
                                                      'job', case when d.job_status is null then null
                                                                  else jsonb_build_object('status', d.job_status, 'stage', d.job_stage,
                                                                                          'error_code', d.job_error) end,
                                                      'link_target', case when d.holds then null else d.link_target end)
                                                    order by d.holds desc, d.legacy, d.created_at desc, d.id)
                                              from docs d where d.key = pg.key), '[]'::jsonb))
                   order by pg.ord)
                     from page pg), '[]'::jsonb)
    into v_total, v_records;

  select jsonb_build_object(
           'keys', (select count(distinct r.document_key) from public.desk_rows r
                     where r.tier = p_tier and r.feature = p_feature and r.document_key is not null),
           'full_text', (select count(*) from (select distinct r.document_key as key from public.desk_rows r
                                                where r.tier = p_tier and r.feature = p_feature and r.document_key is not null) k
                          where exists (select from public.documents d
                                         where d.metadata->>'document_key' = k.key and d.indexed_at is not null)),
           'orphaned', (select count(*) from public.documents d
                         where d.storage_path is not null
                           and public.corpus_desk_name(d.desk_tier) = public.corpus_desk_name(p_tier)
                           and public.corpus_desk_name(d.desk_feature) = any (v_features)
                           and d.metadata->>'document_key' is not null
                           and not exists (select from public.desk_rows r
                                            where r.document_key = d.metadata->>'document_key'
                                              and public.corpus_desk_name(r.tier) = public.corpus_desk_name(p_tier)
                                              and public.corpus_desk_name(r.feature) = any (v_features))))
    into v_coverage;

  return jsonb_build_object('records', v_records, 'total', v_total, 'coverage', v_coverage);
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_unlinked_documents: documents without a working record link
-- (security invoker).

create function public.admin_unlinked_documents(p_tier text, p_feature text, p_query text, p_limit int, p_offset int)
returns jsonb
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_limit    int  := least(greatest(coalesce(p_limit, 50), 1), 50);
  v_offset   int  := greatest(coalesce(p_offset, 0), 0);
  v_query    text := nullif(btrim(p_query), '');
  v_like     text;
  v_features text[] := public.corpus_desk_features(p_tier, p_feature);
  v_total    int;
  v_docs     jsonb;
begin
  if v_query is not null then
    v_like := '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  with cand as (
    select d.*,
           case when d.metadata->>'document_key' is not null
                     and not exists (select from public.desk_rows r
                                      where r.document_key = d.metadata->>'document_key'
                                        and public.corpus_desk_name(r.tier) = public.corpus_desk_name(p_tier)
                                        and public.corpus_desk_name(r.feature) = any (v_features))
                then d.metadata->>'document_key' end as orphaned_key
      from public.documents d
     where d.storage_path is not null
       and public.corpus_desk_name(d.desk_tier) = public.corpus_desk_name(p_tier)
       and public.corpus_desk_name(d.desk_feature) = any (v_features)
       and (v_like is null or d.title ilike v_like escape '\')
  ), listed as (
    select c.* from cand c
     where c.metadata->>'document_key' is null or c.orphaned_key is not null or c.metadata->>'link_target' is not null
  ), page as (
    select l.*, row_number() over (order by l.created_at desc, l.id) as ord
      from listed l
     order by l.created_at desc, l.id
     limit v_limit offset v_offset
  )
  select (select count(*) from listed),
         coalesce((select jsonb_agg(jsonb_build_object(
                     'document_id', pg.id,
                     'title', pg.title,
                     'source_key', pg.source_key,
                     'legacy', false,
                     'indexed', pg.indexed_at is not null,
                     'job', (select jsonb_build_object('status', x.status, 'stage', x.stage, 'error_code', x.error_code)
                               from public.ingest_jobs x
                              where x.document_id = pg.id
                              order by x.created_at desc, x.id desc
                              limit 1),
                     'orphaned_key', pg.orphaned_key,
                     'link_target', pg.metadata->>'link_target',
                     'replaces', pg.metadata->>'replaces',
                     'created_at', pg.created_at)
                   order by pg.ord)
                     from page pg), '[]'::jsonb)
    into v_total, v_docs;

  return jsonb_build_object('documents', v_docs, 'total', v_total);
end;
$$;

-- ---------------------------------------------------------------------------
-- Execute: the service role only. The two internal helpers are granted to no
-- one: the security-definer functions run them as their owner.

revoke all on function public.corpus_desk_name(text) from public, anon, authenticated;
revoke all on function public.corpus_desk_features(text, text) from public, anon, authenticated;
revoke all on function public.corpus_key_in_desk(text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.corpus_link_plan(text, text, text, boolean, uuid, boolean, uuid) from public, anon, authenticated, service_role;
revoke all on function public.ingest_register(jsonb) from public, anon, authenticated;
revoke all on function public.ingest_link(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.ingest_unlink(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.ingest_swap(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.ingest_delete(uuid, uuid) from public, anon, authenticated;
revoke all on function public.ingest_discard(uuid, uuid) from public, anon, authenticated;
revoke all on function public.admin_desk_records(text, text, text, text, int, int) from public, anon, authenticated;
revoke all on function public.admin_unlinked_documents(text, text, text, int, int) from public, anon, authenticated;
grant execute on function public.corpus_desk_name(text) to service_role;
grant execute on function public.corpus_desk_features(text, text) to service_role;
grant execute on function public.ingest_register(jsonb) to service_role;
grant execute on function public.ingest_link(uuid, text, text, uuid) to service_role;
grant execute on function public.ingest_unlink(uuid, text, uuid) to service_role;
grant execute on function public.ingest_swap(uuid, uuid, uuid) to service_role;
grant execute on function public.ingest_delete(uuid, uuid) to service_role;
grant execute on function public.ingest_discard(uuid, uuid) to service_role;
grant execute on function public.admin_desk_records(text, text, text, text, int, int) to service_role;
grant execute on function public.admin_unlinked_documents(text, text, text, int, int) to service_role;
