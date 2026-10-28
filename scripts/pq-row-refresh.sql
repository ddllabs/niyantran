-- F266 reviewed refresh (owner, 2026-10-29): the stored Parliamentary question rows gain the session
-- and "Has answer" that src/lib/shapeQuestions.js now derives from each row's sansad.in answer URL, and
-- every record link on those rows is re-bound to the refreshed row in the same transaction. Links keep
-- their document, role, version, decision, approver, evidence and creation time; only the row hash
-- and fingerprint they are bound to change. No document, chunk or vector changes. Any check that
-- fails aborts the whole transaction.
--
--   supabase db query --linked --project-ref <ref> -f scripts/pq-row-refresh.sql
--
-- Re-runnable: rows already refreshed are skipped and their links left alone.
begin;
set local statement_timeout = '900s';
set local lock_timeout = '10s';
lock table public.desk_rows in share row exclusive mode;

create temp table pq_refresh on commit drop as
select q.tier, q.feature, q.row_key, q.row as old_row,
       q.row || jsonb_build_object('session', split_part(public.pq_answer_key(q.row->>'source_url'), ':', 3),
                                   'has_answer', 'Yes', 'has_answer_key', 'yes') as new_row
  from public.desk_rows q
 where q.tier = 'national' and q.feature = 'Parliamentary Question Database'
   and public.pq_answer_key(q.row->>'source_url') is not null
   and btrim(concat_ws('', q.row->>'answer', q.row->>'answer_text', q.row->>'answer_status', q.row->>'status')) in ('', '—')
   and (q.row->>'session' is distinct from split_part(public.pq_answer_key(q.row->>'source_url'), ':', 3)
     or q.row->>'has_answer' is distinct from 'Yes' or q.row->>'has_answer_key' is distinct from 'yes');

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
  if (select count(*) from public.desk_rows q join pq_refresh p using (tier, feature, row_key) where q.row = p.new_row)
     <> (select count(*) from pq_refresh) then
    raise exception 'pq refresh: rows not refreshed; nothing changed';
  end if;
end $$;

select (select count(*) from pq_refresh) as rows_refreshed, (select count(*) from pq_rebind) as links_rebound;
commit;
