-- F264. Read-only privileged inspection, never caller-visibility or admission proof.
-- Security: only authenticated active platform admins enter the definer RPC; no actor
-- argument or service-role bypass. Helpers have no API grants. Fixed empty search_path.
-- Page entities first; max100 entities, max24 links/record, max1000 chunks/document.
-- A request inspects at most100 distinct documents, deduplicating shared answers.
-- Limits are explicit diagnostics, never a claim that omitted sources are absent.
-- No stored text, embeddings, payloads or full-corpus totals/hashes are returned.
-- Down: drop function public.admin_corpus_readiness(jsonb);
--       drop function public.admin_readiness_document(uuid);
--       drop index public.documents_readiness_cohort; drop index public.documents_readiness_page;
--       drop index public.documents_readiness_legacy_key;
create index documents_readiness_page on public.documents(desk_tier,desk_feature,id);
create index documents_readiness_cohort on public.documents(desk_tier,desk_feature,(metadata#>>'{review,decision_id}'),id);
create index documents_readiness_legacy_key on public.documents((metadata->>'document_key'),id);

create function public.admin_readiness_document(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 with d as (select id,source_key,title,desk_tier,desk_feature,content_sha256,indexed_at,metadata,file_url
  from public.documents where id=p_id),
 c as materialized (select embedding is not null as vector_ready from public.document_chunks where document_id=p_id order by chunk_index,id limit 1001),
 stats as (select count(*) as chunks,count(*) filter(where vector_ready) as vectors from c)
 select jsonb_build_object('document_id',d.id,'source_key',d.source_key,'title',left(d.title,500),
  'source_url',d.file_url,'text_sha256',d.content_sha256,'indexed',d.indexed_at is not null,'chunks_scanned',s.chunks,'vectors_scanned',s.vectors,
  'inspection_limited',s.chunks>1000,
  'index_state',case when d.indexed_at is null then 'registered' when s.chunks>1000 then 'inspection_limited'
   when s.chunks=0 or s.vectors<>s.chunks then 'incomplete' else 'indexed' end,
  'cohort',d.metadata#>>'{review,decision_id}',
  'association_kind',case
   when exists(select 1 from public.law_document_links l where l.document_id=d.id) then 'law'
   when exists(select 1 from public.record_document_links l where l.document_id=d.id) then 'ordinary'
   when starts_with(d.metadata->>'document_key','bill:') and exists(select 1 from public.desk_rows r where r.tier=d.desk_tier and r.feature=d.desk_feature and r.document_key=d.metadata->>'document_key') then 'bill'
   when nullif(d.metadata->>'document_key','') is not null then 'unresolved_legacy_key'
   else 'unassociated' end,
  'publication_state',case when d.desk_tier<>'law' then 'not_managed'
   when exists(select 1 from public.law_document_links l join public.law_records r on r.id=l.record_id where l.document_id=d.id and not r.visible) then 'hidden'
   else coalesce((select p.status from public.law_publications p where p.document_id=d.id),'not_managed') end,
  'job',(select jsonb_build_object('job_id',j.id,'status',j.status,'stage',j.stage,'error_code',j.error_code)
   from public.ingest_jobs j where j.document_id=d.id order by j.created_at desc,j.id desc limit 1))
 from d cross join stats s
$$;
revoke all on function public.admin_readiness_document(uuid) from public,anon,authenticated,service_role;

create function public.admin_corpus_readiness(p jsonb) returns jsonb
language plpgsql stable security definer set search_path=''  as $$
declare k text:=p->>'kind'; t text:=p->>'tier'; f text:=p->>'feature'; n int:=coalesce((p->>'limit')::int,50);
 ids jsonb:=coalesce(p->'ids','[]'); cohort text:=p->>'cohort'; cursor jsonb; after_key text; item jsonb; items jsonb:='[]';
 rec record; links jsonb; docs jsonb; link record; detail jsonb; more boolean:=false; last_key text; valid boolean; ready int; link_count int; held boolean; inspected int:=0; cache jsonb:='{}';
begin
 if auth.uid() is null or not coalesce(public.is_platform_admin(),false) then
  raise exception 'platform admins only' using errcode='42501'; end if;
 if k not in ('records','documents') or k is null or t is null or f is null or length(t) not between 1 and 300 or length(f) not between 1 and 300
  or n not between 1 and 100 or jsonb_typeof(ids)<>'array' or jsonb_array_length(ids)>100
  or (cohort is not null and (k<>'documents' or length(cohort) not between 1 and 300)) then raise exception 'invalid readiness bounds'; end if;
 if exists(select 1 from jsonb_array_elements(ids) x where jsonb_typeof(x)<>'string' or length(x#>>'{}') not between 1 and 1024) then raise exception 'invalid exact ids'; end if;
 if k='documents' then perform (x#>>'{}')::uuid from jsonb_array_elements(ids) x; end if;
 if p->>'cursor' is not null then
  if length(p->>'cursor')>4096 then raise exception 'invalid readiness cursor'; end if;
  cursor:=(p->>'cursor')::jsonb;
  if cursor->>'kind' is distinct from k or cursor->>'tier' is distinct from t or cursor->>'feature' is distinct from f
   or cursor->>'cohort' is distinct from cohort or cursor->'ids' is distinct from ids
   or nullif(cursor->>'after','') is null or length(cursor->>'after')>1024 then raise exception 'cursor filter mismatch'; end if;
  after_key:=cursor->>'after';
  if k='documents' then perform after_key::uuid; end if;
 end if;
 if k='documents' then
  for rec in select d.id from public.documents d where d.desk_tier=t and d.desk_feature=f
   and (after_key is null or d.id>after_key::uuid)
   and (ids='[]' or d.id in(select (x#>>'{}')::uuid from jsonb_array_elements(ids) x))
   and (cohort is null or d.metadata#>>'{review,decision_id}'=cohort) order by d.id limit n+1
  loop
   if jsonb_array_length(items)=n then more:=true; exit; end if;
   items:=items||jsonb_build_array(public.admin_readiness_document(rec.id)); last_key:=rec.id::text;
  end loop;
 else
  for rec in select r.tier,r.feature,r.row_key,r.document_key,r.row from public.desk_rows r where r.tier=t and r.feature=f
   and (after_key is null or r.row_key>after_key)
   and (ids='[]' or to_jsonb(r.row_key)<@ids) order by r.row_key limit n+1
  loop
   if jsonb_array_length(items)=n then more:=true; exit; end if;
   docs:='[]'; ready:=0; held:=false;
   -- Each adapter stays authoritative; null legacy keys do not imply no links.
   if starts_with(rec.document_key,'law-record:') then
    select coalesce(jsonb_agg(x),'[]') into links from (
     select l.document_id,(d.content_sha256=l.text_sha256) as identity_ok,l.role,l.adapter_version::text as version,
      (r.visible and coalesce((select s.active from public.law_listing_settings s where s.singleton),false)) as published
     from public.law_document_links l join public.law_records r on r.id=l.record_id join public.documents d on d.id=l.document_id
     where 'law-record:'||r.id::text=rec.document_key order by l.document_id limit 25) x;
   elsif starts_with(rec.document_key,'bill:') then
    select coalesce(jsonb_agg(x),'[]') into links from (
     select d.id as document_id,true as identity_ok,'document'::text as role,'legacy'::text as version,true as published
     from public.documents d where d.metadata->>'document_key'=rec.document_key and d.desk_tier=t and d.desk_feature=f order by d.id limit 25) x;
   else
    select coalesce(jsonb_agg(x),'[]') into links from (
     select l.document_id,l.role,l.version,l.expected_link_count,true as published,
      coalesce(d.content_sha256=l.text_sha256 and d.file_url=l.source_url and d.desk_tier=l.tier and d.desk_feature=l.feature
       and rec.row->>'source_url'=l.source_url
       and encode(pg_catalog.sha256(convert_to(rec.row::text,'UTF8')),'hex')=l.row_sha256
       and encode(pg_catalog.sha256(convert_to(jsonb_build_object('source_key',d.source_key,'metadata',d.metadata)::text,'UTF8')),'hex')=l.document_identity_sha256,false) as identity_ok
     from public.record_document_links l left join public.documents d on d.id=l.document_id
     where l.tier=t and l.feature=f and l.row_key=rec.row_key order by l.document_id limit 25) x;
   end if;
   link_count:=jsonb_array_length(links);
   if not starts_with(coalesce(rec.document_key,''),'law-record:') and not starts_with(coalesce(rec.document_key,''),'bill:') and link_count<=24 then
    held:=exists(select 1 from jsonb_array_elements(links) x where (x->>'expected_link_count')::int is distinct from link_count);
   end if;
   for link in select * from jsonb_to_recordset(links) as x(document_id uuid,identity_ok boolean,role text,version text,published boolean) limit 24 loop
    detail:=cache->link.document_id::text;
    if detail is null then
     if inspected>=100 then detail:=jsonb_build_object('document_id',link.document_id,'index_state','inspection_limited','inspection_limited',true);
     else detail:=public.admin_readiness_document(link.document_id); inspected:=inspected+1;
      cache:=cache||jsonb_build_object(link.document_id::text,detail); end if;
    end if;
    valid:=link.identity_ok and link.published and detail->>'index_state'='indexed';
    if valid then ready:=ready+1; end if;
    held:=held or not link.identity_ok;
    docs:=docs||jsonb_build_array(detail||jsonb_build_object('identity_ok',link.identity_ok,'role',link.role,'version',link.version,'published',link.published));
   end loop;
   item:=jsonb_build_object('row_key',rec.row_key,'document_key',rec.document_key,
    'title',left(coalesce(rec.row->>'subject',rec.row->>'title',rec.row_key),500),
    'association_adapter',case when starts_with(rec.document_key,'law-record:') then 'law' when starts_with(rec.document_key,'bill:') then 'bill' else 'ordinary' end,
    'state',case when link_count>24 then 'inspection_limited' when held then 'held' when link_count=0 then 'unmapped'
     when exists(select 1 from jsonb_array_elements(docs) x where (x->>'inspection_limited')::boolean) then 'inspection_limited' when ready=link_count then 'privileged_ready' when ready>0 then 'partial' else 'not_ready' end,
    'links_limited',link_count>24,'ready_documents',ready,'documents',docs);
   items:=items||jsonb_build_array(item); last_key:=rec.row_key;
  end loop;
 end if;
 return jsonb_build_object('contract_version',1,'visibility','admin','observed_at',statement_timestamp(),
  'items',items,'has_more',more,'next_cursor',case when more then jsonb_build_object('kind',k,'tier',t,'feature',f,'ids',ids,'cohort',cohort,'after',last_key)::text else null end);
end $$;
revoke all on function public.admin_corpus_readiness(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_corpus_readiness(jsonb) to authenticated;
