-- F266 reviewed refresh (owner, 2026-10-29): the stored Parliamentary question rows gain the session
-- and "Has answer" that src/lib/shapeQuestions.js now derives from each row's sansad.in answer URL, and
-- every record link on those rows is re-bound to the refreshed row in the same transaction. Links keep
-- their document, role, version, decision, approver, evidence and creation time; only the row hash
-- and fingerprint they are bound to change. No document, chunk or vector changes. Any check that
-- fails aborts the whole transaction.
--
--   supabase db query --linked --project-ref <ref> -f scripts/pq-row-refresh.sql
--
-- Then load the question module (scripts/load-desk-rows.mjs --feature "Parliamentary Question Database")
-- so the search text matches; the load guard passes because the rows already equal the shaping.
-- The counts printed at the end may not be shown by every client; confirm with a read query.
--
-- Re-runnable: rows already refreshed are skipped and their links left alone.
begin;
set local statement_timeout = '900s';
set local lock_timeout = '10s';
-- EXCLUSIVE blocks every writer and row lock (admission, record_mapping_apply) but not readers.
lock table public.desk_rows in exclusive mode;

-- The same rules as src/lib/shapeQuestions.js: a field is empty when null, blank, a dash or the
-- shaping's "Not reported"; an existing session or ls_session is kept; Has answer only where no
-- answer field says otherwise.
create temp table pq_refresh on commit drop as
with q as (
  select r.tier, r.feature, r.row_key, r.row,
         split_part(public.pq_answer_key(r.row->>'source_url'), ':', 3) as url_session,
         (select bool_and(btrim(coalesce(r.row->>f, '')) in ('', '—'))
            from unnest(array['answer','answer_text','answer_status','status']) f) as no_answer_field,
         btrim(coalesce(r.row->>'session', '')) in ('', '—', 'Not reported')
           and btrim(coalesce(r.row->>'ls_session', '')) in ('', '—') as no_session
    from public.desk_rows r
   where r.tier = 'national' and r.feature = 'Parliamentary Question Database'
     and public.pq_answer_key(r.row->>'source_url') is not null
)
select tier, feature, row_key, row as old_row,
       row || case when no_session then jsonb_build_object('session', url_session) else '{}'::jsonb end
           || case when no_answer_field then jsonb_build_object('has_answer', 'Yes', 'has_answer_key', 'yes') else '{}'::jsonb end as new_row
  from q
 where (no_session and row->>'session' is distinct from url_session)
    or (no_answer_field and (row->>'has_answer' is distinct from 'Yes' or row->>'has_answer_key' is distinct from 'yes'));

create temp table pq_rebind on commit drop as
select l.* from public.record_document_links l join pq_refresh p using (tier, feature, row_key);

-- Every link to re-bind must be intact before the change (a held link stays held, refused here).
do $$ begin
  if exists (select 1 from pq_rebind l join pq_refresh p using (tier, feature, row_key)
              join public.documents d on d.id = l.document_id
             where l.row_sha256 is distinct from encode(sha256(convert_to(p.old_row::text,'UTF8')),'hex')
                or l.document_identity_sha256 is distinct from encode(sha256(convert_to(jsonb_build_object('source_key',d.source_key,'metadata',d.metadata)::text,'UTF8')),'hex')
                or l.source_url is distinct from d.file_url or l.text_sha256 is distinct from d.content_sha256) then
    raise exception 'pq refresh: a link is not intact before the refresh; nothing changed';
  end if;
  if exists (select 1 from pq_rebind l join public.documents d on d.id = l.document_id
              join public.documents o on o.file_url = d.file_url and o.id <> d.id) then
    raise exception 'pq refresh: another document shares a linked answer URL; review the alias first; nothing changed';
  end if;
end $$;

-- Remove, refresh the row, re-apply: the same service-only functions that wrote the links.
do $$ declare l record; begin
  for l in select * from pq_rebind order by row_key, document_id loop
    perform public.record_mapping_remove(jsonb_build_object('tier',l.tier,'feature',l.feature,'row_key',l.row_key,
      'document_id',l.document_id,'expected_fingerprint',l.fingerprint,'decision_id',l.decision_id,'evidence_sha256',l.evidence_sha256));
  end loop;
end $$;

update public.desk_rows q set row = p.new_row
  from pq_refresh p where q.tier = p.tier and q.feature = p.feature and q.row_key = p.row_key;

do $$ declare l record; begin
  for l in select * from pq_rebind order by row_key, document_id loop
    perform public.record_mapping_apply(jsonb_build_object('tier',l.tier,'feature',l.feature,'row_key',l.row_key,
      'document_id',l.document_id,'role',l.role,'version',l.version,'expected_alias_ids','[]'::jsonb,
      'expected_fingerprint',public.record_mapping_fingerprint(l.tier,l.feature,l.row_key,l.document_id),
      'decision_id',l.decision_id,'approver',l.approver,'evidence_sha256',l.evidence_sha256));
  end loop;
end $$;

update public.record_document_links n set created_at = l.created_at
  from pq_rebind l where n.tier = l.tier and n.feature = l.feature and n.row_key = l.row_key and n.document_id = l.document_id;

-- The same links, each bound to its refreshed row.
do $$ begin
  if (select count(*) from public.record_document_links n join pq_rebind l using (tier, feature, row_key, document_id)
       where n.decision_id = l.decision_id and n.evidence_sha256 = l.evidence_sha256 and n.role = l.role and n.version = l.version
         and n.created_at = l.created_at and n.expected_link_count = l.expected_link_count
         and n.row_sha256 = encode(sha256(convert_to((select q.row from public.desk_rows q where q.tier=n.tier and q.feature=n.feature and q.row_key=n.row_key)::text,'UTF8')),'hex'))
     <> (select count(*) from pq_rebind) then
    raise exception 'pq refresh: re-bound links do not match the links before; nothing changed';
  end if;
  -- No link on a refreshed row, from any source, may still be bound to the old row.
  if exists (select 1 from public.record_document_links n join public.desk_rows q using (tier, feature, row_key)
              join pq_refresh p using (tier, feature, row_key)
             where n.row_sha256 is distinct from encode(sha256(convert_to(q.row::text,'UTF8')),'hex')) then
    raise exception 'pq refresh: a link on a refreshed row is not bound to it; nothing changed';
  end if;
  if (select count(*) from public.desk_rows q join pq_refresh p using (tier, feature, row_key) where q.row = p.new_row)
     <> (select count(*) from pq_refresh) then
    raise exception 'pq refresh: rows not refreshed; nothing changed';
  end if;
end $$;

select (select count(*) from pq_refresh) as rows_refreshed, (select count(*) from pq_rebind) as links_rebound;
commit;
