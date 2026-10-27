-- F257: additive reviewed associations. No backfill, OCR, chunks or vectors are changed.
create table public.record_document_links (
 tier text not null, feature text not null, row_key text not null,
 document_id uuid not null references public.documents(id),
 role text not null, version text not null,
 source_url text not null, text_sha256 text not null, row_sha256 text not null, document_identity_sha256 text not null,
 expected_link_count integer not null default 1 check(expected_link_count>0),
 fingerprint text not null, decision_id text not null, approver text not null,
 evidence_sha256 text not null, created_at timestamptz not null default now(),
 primary key(tier,feature,row_key,document_id),
 foreign key(tier,feature,row_key) references public.desk_rows(tier,feature,row_key)
);
create index record_document_links_document on public.record_document_links(document_id);
alter table public.record_document_links enable row level security;
revoke all on public.record_document_links from public,anon,authenticated,service_role;
grant select on public.record_document_links to authenticated,service_role;
create policy record_links_read on public.record_document_links for select to authenticated using(
 exists(select 1 from public.desk_rows r where r.tier=record_document_links.tier and r.feature=record_document_links.feature and r.row_key=record_document_links.row_key)
 and exists(select 1 from public.documents d where d.id=record_document_links.document_id));

-- Bound to full immutable identities and current chunk/index state. Review is invalidated by change.
create function public.record_mapping_fingerprint(t text,f text,k text,did uuid) returns text
language sql stable security definer set search_path=public,extensions as $$
 select encode(sha256(convert_to(jsonb_build_object('tier',r.tier,'feature',r.feature,'row_key',r.row_key,'row',r.row,
 'document_id',d.id,'source_key',d.source_key,'file_url',d.file_url,'text_sha256',d.content_sha256,
 'metadata',d.metadata,'indexed_at',d.indexed_at,'chunks',(select coalesce(jsonb_agg(jsonb_build_array(c.id,c.chunk_hash,c.chunk_index,c.embedding is not null) order by c.chunk_index,c.id),'[]') from public.document_chunks c where c.document_id=d.id))::text,'UTF8')),'hex')
 from public.desk_rows r cross join public.documents d where r.tier=t and r.feature=f and r.row_key=k and d.id=did
$$;
revoke all on function public.record_mapping_fingerprint(text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.record_mapping_fingerprint(text,text,text,uuid) to service_role;

-- Service-only explicit approval, never fuzzy matching or publication bypass. Existing Law/bill
-- contracts retain ownership. Other collections require reviewed full source identity.
create function public.record_mapping_apply(p jsonb) returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare r public.desk_rows%rowtype; d public.documents%rowtype; fp text; old public.record_document_links%rowtype; expected_aliases text[]; actual_aliases text[];
begin
 select * into r from public.desk_rows where tier=p->>'tier' and feature=p->>'feature' and row_key=p->>'row_key' for update;
 if not found then raise exception 'mapping row missing'; end if;
 select * into d from public.documents where id=(p->>'document_id')::uuid for share;
 if not found then raise exception 'mapping document missing'; end if;
 if r.tier='law' or r.document_key like 'bill:%' or d.metadata->>'document_key' like 'bill:%' then raise exception 'use existing collection adapter'; end if;
 if r.tier is distinct from d.desk_tier or r.feature is distinct from d.desk_feature
 or coalesce(r.row->>'source_url','')='' or r.row->>'source_url' is distinct from d.file_url
 then raise exception 'mapping identity conflict'; end if;
 -- A second review precondition: peers sharing the exact source URL must match
 -- the reviewed IDs. Automatic PQ plans pass []; explicit revision adapters may
 -- bind known peers. This catches a new alias after an inventory fingerprint.
 if jsonb_typeof(coalesce(p->'expected_alias_ids','[]'::jsonb))<>'array' then raise exception 'source alias conflict'; end if;
 select coalesce(array_agg((x.value::uuid)::text order by (x.value::uuid)::text),'{}') into expected_aliases
 from jsonb_array_elements_text(coalesce(p->'expected_alias_ids','[]'::jsonb)) x;
 if cardinality(expected_aliases)<>(select count(distinct a) from unnest(expected_aliases)a) then raise exception 'source alias conflict'; end if;
 select coalesce(array_agg(other.id::text order by other.id::text),'{}') into actual_aliases
 from public.documents other where other.file_url=d.file_url and other.id<>d.id;
 if expected_aliases is distinct from actual_aliases then raise exception 'source alias conflict'; end if;
 fp:=public.record_mapping_fingerprint(r.tier,r.feature,r.row_key,d.id);
 if fp is null or fp is distinct from p->>'expected_fingerprint' then raise exception 'stale mapping review'; end if;
 if coalesce(p->>'decision_id','')='' or coalesce(p->>'approver','')='' or coalesce(p->>'role','')='' or coalesce(p->>'version','')=''
 or coalesce(p->>'evidence_sha256','') !~ '^[a-f0-9]{64}$' then raise exception 'mapping approval evidence required'; end if;
 insert into public.record_document_links(tier,feature,row_key,document_id,role,version,source_url,text_sha256,row_sha256,document_identity_sha256,fingerprint,decision_id,approver,evidence_sha256)
 values(r.tier,r.feature,r.row_key,d.id,p->>'role',p->>'version',d.file_url,d.content_sha256,encode(sha256(convert_to(r.row::text,'UTF8')),'hex'),encode(sha256(convert_to(jsonb_build_object('source_key',d.source_key,'metadata',d.metadata)::text,'UTF8')),'hex'),fp,p->>'decision_id',p->>'approver',p->>'evidence_sha256') on conflict do nothing;
 select * into old from public.record_document_links where tier=r.tier and feature=r.feature and row_key=r.row_key and document_id=d.id;
 if old.fingerprint<>fp or old.role<>p->>'role' or old.version<>p->>'version' or old.decision_id<>p->>'decision_id' or old.approver<>p->>'approver' or old.evidence_sha256<>p->>'evidence_sha256' then raise exception 'existing mapping conflict'; end if;
 -- The record lock serializes all approvals for this tuple. Each visible link
 -- carries the total so RLS-hidden siblings cannot turn partial coverage into full.
 update public.record_document_links l set expected_link_count=(select count(*) from public.record_document_links x where x.tier=r.tier and x.feature=r.feature and x.row_key=r.row_key)
 where l.tier=r.tier and l.feature=r.feature and l.row_key=r.row_key;
 return jsonb_build_object('status','mapped','document_id',d.id,'row_key',r.row_key);
end $$;
revoke all on function public.record_mapping_apply(jsonb) from public,anon,authenticated;
grant execute on function public.record_mapping_apply(jsonb) to service_role;

-- Association-only rollback, bound to the exact reviewed stored link. The
-- row lock serializes approval/removal and sibling coverage maintenance.
create function public.record_mapping_remove(p jsonb) returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare r public.desk_rows%rowtype; old public.record_document_links%rowtype; did uuid;
begin
 if coalesce(p->>'expected_fingerprint','') !~ '^[a-f0-9]{64}$'
 or coalesce(p->>'evidence_sha256','') !~ '^[a-f0-9]{64}$'
 or coalesce(p->>'decision_id','')='' then raise exception 'removal evidence required'; end if;
 did:=(p->>'document_id')::uuid;
 if did is null then raise exception 'removal document required'; end if;
 select * into r from public.desk_rows where tier=p->>'tier' and feature=p->>'feature' and row_key=p->>'row_key' for update;
 if not found then return jsonb_build_object('status','already_absent'); end if;
 if r.tier='law' or r.document_key like 'bill:%' then raise exception 'use existing collection adapter'; end if;
 select * into old from public.record_document_links where tier=r.tier and feature=r.feature and row_key=r.row_key and document_id=did;
 if not found then return jsonb_build_object('status','already_absent'); end if;
 if old.fingerprint is distinct from p->>'expected_fingerprint'
 or old.decision_id is distinct from p->>'decision_id'
 or old.evidence_sha256 is distinct from p->>'evidence_sha256' then raise exception 'removal evidence conflict'; end if;
 delete from public.record_document_links where tier=r.tier and feature=r.feature and row_key=r.row_key and document_id=did;
 update public.record_document_links l set expected_link_count=(select count(*) from public.record_document_links x where x.tier=r.tier and x.feature=r.feature and x.row_key=r.row_key)
 where l.tier=r.tier and l.feature=r.feature and l.row_key=r.row_key;
 return jsonb_build_object('status','removed','document_id',did,'row_key',r.row_key);
end $$;
revoke all on function public.record_mapping_remove(jsonb) from public,anon,authenticated;
grant execute on function public.record_mapping_remove(jsonb) to service_role;

-- Same callable contract for browser coverage and server retrieval. RLS is never bypassed.
-- Missing/inaccessible links cannot disclose document IDs. All linked sources must be ready
-- for a Full Text badge; individually ready IDs can still be searched in a partial record.
create function public.record_resolve_document_keys(p_keys text[])
returns table(document_key text,document_id uuid,coverage text)
language plpgsql stable security invoker set search_path=public,extensions as $$
declare key text; parts jsonb; direct_id uuid; stored_key text;
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
  select r.document_key into stored_key from public.desk_rows r
   where r.tier=parts->>0 and r.feature=parts->>1 and r.row_key=parts->>2;
  if not found then continue; end if;
  if starts_with(stored_key,'bill:') or starts_with(stored_key,'law-record:') then
   return query
    with target as (
     select d.id,d.indexed_at,
      (select count(*)>0 and bool_and(c.embedding is not null) from public.document_chunks c where c.document_id=d.id) as vectors
     from public.documents d
     where d.desk_tier=parts->>0 and d.desk_feature=parts->>1
      and ((starts_with(stored_key,'bill:') and d.metadata->>'document_key'=stored_key)
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
