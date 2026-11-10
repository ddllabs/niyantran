-- F314: Bills records were shown another bill's documents (docs/specs/2026-11-10-shared-bill-keys.md).
--
-- A Bills row's key is bill:<title year>:<number> (billDocumentKey in src/lib/deskRows.js): it has no house and no
-- introduction date, so two different bills can share it (396 of 9,415 keys on NTER on 2026-11-10). The resolver
-- returned every document holding a row's key, so each row on a shared key was also shown the other bill's documents.
--
-- It changes one function, public.record_resolve_document_keys(text[]), and only its bill branch: when another row on
-- the same key names a different bill, a document belongs to this row only when its title is this row's bill, names
-- compared as public.bill_norm compares them (names only: one bill spans both Houses, so the house cannot decide; on
-- a shared key a bill's document titled otherwise, an Act or a Hindi title, is not shown to it). A key that only one
-- bill uses resolves exactly as before, and so do
-- document-id keys, law-record keys and explicit record links. Signature, language, volatility, security invoker,
-- search_path and grants are unchanged. Rollback: the previous definition, 20261027185747_record_document_associations.

begin;
create or replace function public.record_resolve_document_keys(p_keys text[])
returns table(document_key text,document_id uuid,coverage text)
language plpgsql stable security invoker set search_path=public,extensions as $$
declare key text; parts jsonb; direct_id uuid; stored_key text; stored_row jsonb; row_name text; shared boolean;
begin
 if coalesce(cardinality(p_keys),0)>24 then raise exception 'too many record keys'; end if;
 foreach key in array coalesce(p_keys,'{}') loop
  if key is null or length(key)>1024 then continue; end if;
  if starts_with(key,'document-id:') then
   begin direct_id:=substring(key from 13)::uuid;
   exception when invalid_text_representation then
    return query select key,null::uuid,'unavailable'::text;
    continue;
   end;
   return query
    with target as (
     select d.id,d.indexed_at,
      (select count(*)>0 and bool_and(c.embedding is not null) from public.document_chunks c where c.document_id=d.id) as vectors
     from public.documents d where d.id=direct_id
    )
    select key,case when t.indexed_at is not null and t.vectors then t.id else null end,
     case when t.id is null then 'unavailable' when t.indexed_at is null then 'registered'
      when not coalesce(t.vectors,false) then 'incomplete' else 'full' end
    from (values(1)) anchor(n) left join target t on true;
   continue;
  end if;
  if not starts_with(key,'desk-record:') then continue; end if;
  begin parts:=substring(key from 13)::jsonb; exception when others then continue; end;
  if jsonb_typeof(parts)<>'array' or jsonb_array_length(parts)<>3 then continue; end if;
  -- Browser identity is only a tuple pointer. Read the current authoritative
  -- row key under caller RLS; never accept the browser's cached Bill/Law key.
  select r.document_key,r.row into stored_key,stored_row from public.desk_rows r
   where r.tier=parts->>0 and r.feature=parts->>1 and r.row_key=parts->>2;
  if not found then continue; end if;
  -- F314: a bill key is shared when another row on it names a different bill. Then only the documents whose
  -- title is this row's bill belong to it. Names compare as public.bill_norm does (closing year removed,
  -- letters and digits only), written out because the caller may not execute bill_norm.
  shared:=false;
  if starts_with(stored_key,'bill:') then
   row_name:=regexp_replace(lower(regexp_replace(coalesce(stored_row->>'bill_name',stored_row->>'title',''),
     ',?\s*[0-9]{4}\s*\.?\s*$','')),'[^a-z0-9]+','','g');
   -- row_name is never null (coalesce above): a null would make NOT IN below unknown and the key read as unshared.
   shared:=exists(select 1 from public.desk_rows o
    where o.tier=parts->>0 and o.feature=parts->>1 and o.document_key=stored_key and o.row_key<>parts->>2
     and regexp_replace(lower(regexp_replace(coalesce(o.row->>'bill_name',o.row->>'title',''),
       ',?\s*[0-9]{4}\s*\.?\s*$','')),'[^a-z0-9]+','','g') not in ('',row_name));
  end if;
  if starts_with(stored_key,'bill:') or starts_with(stored_key,'law-record:') then
   return query
    with target as (
     select d.id,d.indexed_at,
      (select count(*)>0 and bool_and(c.embedding is not null) from public.document_chunks c where c.document_id=d.id) as vectors
     from public.documents d
     where d.desk_tier=parts->>0 and d.desk_feature=parts->>1
      and ((starts_with(stored_key,'bill:') and d.metadata->>'document_key'=stored_key
        and (not shared or (row_name<>'' and regexp_replace(lower(regexp_replace(coalesce(d.title,''),
          ',?\s*[0-9]{4}\s*\.?\s*$','')),'[^a-z0-9]+','','g')=row_name)))
        or (starts_with(stored_key,'law-record:') and d.id in (
         select l.document_id from public.law_resolve_document_keys(array[stored_key]) l)))
    ), status as (
     select case when count(*)=0 then 'unmapped'
      when bool_and(indexed_at is not null and vectors) then 'full'
      when bool_or(indexed_at is not null and vectors) then 'partial'
      when bool_or(indexed_at is null) then 'registered'
      else 'incomplete' end as state from target
    )
    select key,case when t.indexed_at is not null and t.vectors then t.id else null end,s.state
    from status s left join target t on true;
   continue;
  end if;

  return query
   with links as (
    select l.document_id as linked_id,l.expected_link_count,d.id,d.indexed_at,
     coalesce(d.content_sha256=l.text_sha256 and d.file_url=l.source_url and d.desk_tier=l.tier and d.desk_feature=l.feature
      and r.row->>'source_url'=l.source_url and encode(sha256(convert_to(r.row::text,'UTF8')),'hex')=l.row_sha256
      and encode(sha256(convert_to(jsonb_build_object('source_key',d.source_key,'metadata',d.metadata)::text,'UTF8')),'hex')=l.document_identity_sha256,false) as identity_ok,
     (select count(*)>0 and bool_and(c.embedding is not null) from public.document_chunks c where c.document_id=d.id) as vectors
    from public.desk_rows r join public.record_document_links l using(tier,feature,row_key)
    left join public.documents d on d.id=l.document_id
    where r.tier=parts->>0 and r.feature=parts->>1 and r.row_key=parts->>2
   ), status as (
    select case when count(*)=0 then 'unmapped'
     when count(*)=max(expected_link_count) and bool_and(id is not null and identity_ok and indexed_at is not null and vectors) then 'full'
     when bool_or(id is not null and identity_ok and indexed_at is not null and vectors) then 'partial'
     when bool_or(id is null) then 'unavailable'
     when bool_or(not identity_ok) then 'held'
     when bool_or(indexed_at is null) then 'registered'
     else 'incomplete' end as state from links
   )
   select key,case when l.identity_ok and l.indexed_at is not null and l.vectors then l.id else null end,s.state
   from status s left join links l on true
   where exists(select 1 from public.desk_rows r where r.tier=parts->>0 and r.feature=parts->>1 and r.row_key=parts->>2);
 end loop;
end $$;

revoke all on function public.record_resolve_document_keys(text[]) from public,anon;
grant execute on function public.record_resolve_document_keys(text[]) to authenticated,service_role;
commit;
