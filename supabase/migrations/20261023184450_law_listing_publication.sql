-- Law publication is separate from immutable text ingestion. No seed/backfill is executed here.
create table public.law_listing_settings(singleton boolean primary key default true check(singleton), seeded boolean not null default false, active boolean not null default false);
insert into public.law_listing_settings values(true,false,false);
create table public.law_records(
 id uuid primary key default gen_random_uuid(), row_key text not null unique,
 record_type text not null check(record_type in ('tribunal_order','announcement')),
 forum text not null, order_date text not null, case_number text,
 source_url text not null, row_data jsonb not null,
 visible boolean not null default true, created_at timestamptz not null default now()
);
create index law_records_source_url on public.law_records(source_url);
create table public.law_source_memberships(
 source_key text primary key, record_id uuid not null references public.law_records(id),
 owner text not null check(owner in ('baseline','corpus')), evidence jsonb not null default '{}'
);
create table public.law_document_links(
 document_id uuid primary key references public.documents(id),
 record_id uuid not null references public.law_records(id),
 text_sha256 text not null, language text, role text not null default 'order',
 adapter_version int not null default 1, evidence_sha256 text not null,
 published_at timestamptz not null default now()
);
create index law_document_links_record on public.law_document_links(record_id);
create table public.law_publications(
 document_id uuid primary key references public.documents(id),
 status text not null check(status in ('pending','held','published')),
 fingerprint text not null, decision_id text not null, approver text not null,
 evidence_sha256 text not null, actor uuid, reasons jsonb not null default '[]',
 attempts int not null default 0, last_error text, updated_at timestamptz not null default now()
);
alter table public.law_listing_settings enable row level security;
alter table public.law_records enable row level security;
alter table public.law_source_memberships enable row level security;
alter table public.law_document_links enable row level security;
alter table public.law_publications enable row level security;
revoke all on public.law_listing_settings,public.law_records,public.law_source_memberships,public.law_document_links,public.law_publications from public,anon,authenticated,service_role;
grant select on public.law_listing_settings,public.law_records to anon,authenticated;
grant select on public.law_document_links to authenticated;
grant select on public.law_listing_settings,public.law_records,public.law_source_memberships,public.law_document_links,public.law_publications to service_role;
create policy law_settings_read on public.law_listing_settings for select to anon,authenticated using(true);
create policy law_records_read on public.law_records for select to anon,authenticated using(visible and exists(select 1 from public.law_listing_settings where active));
create policy law_links_read on public.law_document_links for select to authenticated using(exists(select 1 from public.law_records r where r.id=record_id));

-- Internal policy predicate avoids recursive documents -> links -> documents RLS.
create function public.law_document_is_published(p_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.law_document_links l join public.law_records r on r.id=l.record_id where l.document_id=p_id and r.visible)
$$;
revoke all on function public.law_document_is_published(uuid) from public,anon;
grant execute on function public.law_document_is_published(uuid) to authenticated,service_role;
create policy law_documents_serving on public.documents as restrictive for select to authenticated using(
 not (starts_with(source_key,'law:trib:IBBI_NCLT:') and metadata->>'origin'='supplied-text')
 or not exists(select 1 from public.law_listing_settings where active)
 or public.law_document_is_published(id));
create policy law_chunks_serving on public.document_chunks as restrictive for select to authenticated using(
 exists(select 1 from public.documents d where d.id=document_id));
create policy law_pages_serving on public.document_pages as restrictive for select to authenticated using(
 exists(select 1 from public.documents d where d.id=document_id));
create policy law_blocks_serving on public.document_page_blocks as restrictive for select to authenticated using(
 exists(select 1 from public.documents d where d.id=document_id));
create policy law_images_serving on public.document_page_images as restrictive for select to authenticated using(
 exists(select 1 from public.documents d where d.id=document_id));
create policy law_desk_serving on public.desk_rows as restrictive for select to authenticated using(
 tier<>'law' or feature<>'NCLT / NCLAT (Insolvency)' or not exists(select 1 from public.law_listing_settings where active)
 or exists(select 1 from public.law_records r where r.row_key=desk_rows.row_key));

create function public.law_seed_listings() returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare x record; rid uuid; n int:=0;
begin
 perform pg_advisory_xact_lock(724892);
 if (select seeded from public.law_listing_settings) then return jsonb_build_object('seeded',true,'existing',true); end if;
 for x in select * from public.desk_rows where tier='law' and feature='NCLT / NCLAT (Insolvency)' order by row_key loop
  if coalesce(x.row->>'source_url','')='' or x.row->>'court' not in ('NCLT','IBBI') or coalesce(x.row->>'date','')='' then raise exception 'law listing: invalid baseline row %',x.row_key; end if;
  insert into public.law_records(row_key,record_type,forum,order_date,case_number,source_url,row_data)
  values(x.row_key,case when x.row->>'court'='IBBI' then 'announcement' else 'tribunal_order' end,x.row->>'court',x.row->>'date',nullif(x.row->>'case_number',''),x.row->>'source_url',x.row)
  returning id into rid;
  insert into public.law_source_memberships(source_key,record_id,owner) values('baseline:'||x.row_key,rid,'baseline');
  update public.law_records set row_data=row_data||jsonb_build_object('id',x.row_key,'record_id',rid,'document_key','law-record:'||rid,'availability','source-only','record_type',record_type) where id=rid;
  update public.desk_rows set row=(select row_data from public.law_records where id=rid),
   record_text=(select row_data::text from public.law_records where id=rid),document_key='law-record:'||rid
   where tier=x.tier and feature=x.feature and row_key=x.row_key;
  n:=n+1;
 end loop;
 if n=0 then raise exception 'law listing: empty baseline'; end if;
 update public.law_listing_settings set seeded=true;
 return jsonb_build_object('active',false,'seeded',true,'records',n);
end $$;

-- This read-only function validates both prepared pre-admission records and immutable stored inputs.
create function public.law_reconcile(p jsonb) returns jsonb
language plpgsql stable security definer set search_path=public,extensions as $$
declare r jsonb; d public.documents%rowtype; m public.law_records%rowtype; reasons jsonb:='[]';
 matches jsonb; cnt int; fp text; published boolean:=false; supplied boolean:=false;
begin
 if p ? 'record' then r:=p->'record'; supplied:=true;
 else
  select * into d from public.documents where id=(p->>'document_id')::uuid;
  if not found then raise exception 'law listing: document not found'; end if;
  select payload::jsonb into r from public.ingest_text_inputs where document_id=d.id;
  if r is null then raise exception 'law listing: not supplied text'; end if;
  if p->>'text_sha256' is distinct from d.content_sha256 then raise exception 'law listing: text hash mismatch'; end if;
 end if;
 if not (select seeded from public.law_listing_settings) then reasons:=reasons||'"listing_not_seeded"'::jsonb; end if;
 if not starts_with(coalesce(r->>'source_key',''),'law:trib:IBBI_NCLT:') or r->>'desk_tier' is distinct from 'law'
 or r->>'desk_feature' is distinct from 'NCLT / NCLAT (Insolvency)'
 or r#>>'{citation,kind}' is distinct from 'tribunal_order' or r#>>'{citation,forum}' is distinct from 'NCLT'
 or r#>>'{citation,source}' is distinct from 'IBBI_NCLT'
 or coalesce(r#>>'{citation,case_number}','')='' or coalesce(r#>>'{citation,order_date}','') !~ '^\d{4}-\d{2}-\d{2}$'
 or coalesce(r->>'file_url','') !~ '^https://ibbi\.gov\.in/uploads/order/[A-Za-z0-9_.-]+\.pdf$'
 then reasons:=reasons||'"unsupported_or_incomplete_identity"'::jsonb; end if;
 if r#>>'{review,status}' is distinct from 'eligible' or r#>>'{review,source_key}' is distinct from r->>'source_key'
 or r#>>'{review,text_sha256}' is distinct from r->>'text_sha256'
 or coalesce(r#>>'{review,rules_sha256}','') !~ '^[a-f0-9]{64}$'
 or coalesce(r#>>'{review,decision_id}','')='' or coalesce(r#>>'{review,package_id}','')=''
 or coalesce(r#>>'{review,mapping_version}','')=''
 or r#>'{review,checks}' is distinct from '{"identity":true,"completeness":true,"sensitivity":true,"dedupe":true,"rights":true}'::jsonb
 then reasons:=reasons||'"policy_not_verified"'::jsonb; end if;
 if supplied then
  select * into d from public.documents where source_key=r->>'source_key';
  if found and (d.content_sha256 is distinct from r->>'text_sha256' or not exists(
   select 1 from public.ingest_text_inputs i where i.document_id=d.id and i.payload::jsonb=r)) then reasons:=reasons||'"immutable_source_conflict"'::jsonb; end if;
 end if;
 if exists(select 1 from public.documents other where other.file_url=r->>'file_url' and other.source_key is distinct from r->>'source_key') then
  reasons:=reasons||'"existing_url_alias_requires_review"'::jsonb;
 end if;
 begin
  if (r#>>'{citation,order_date}')::date::text is distinct from r#>>'{citation,order_date}' then reasons:=reasons||'"invalid_order_date"'::jsonb; end if;
 exception when others then reasons:=reasons||'"invalid_order_date"'::jsonb;
 end;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'),count(*) into matches,cnt from (
  select distinct lr.* from public.law_records lr left join public.law_source_memberships sm on sm.record_id=lr.id
  where sm.source_key=r->>'source_key' or lr.source_url=r->>'file_url'
 ) x;
 if cnt>1 then reasons:=reasons||'"ambiguous_listing"'::jsonb;
 elsif cnt=1 then
  select * into m from jsonb_populate_record(null::public.law_records,matches->0);
  if not m.visible or m.record_type<>'tribunal_order' or m.forum<>'NCLT' or m.order_date is distinct from r#>>'{citation,order_date}'
   or (m.case_number is not null and m.case_number is distinct from r#>>'{citation,case_number}')
   or m.source_url is distinct from r->>'file_url' then reasons:=reasons||'"listing_identity_conflict"'::jsonb; end if;
  if exists(select 1 from public.law_document_links l where l.record_id=m.id and l.document_id is distinct from d.id) then reasons:=reasons||'"revision_requires_review"'::jsonb; end if;
 end if;
 if d.id is not null then
  select exists(select 1 from public.law_document_links l where l.document_id=d.id and l.record_id=m.id and l.text_sha256=d.content_sha256) into published;
 end if;
 fp:=encode(sha256(convert_to(jsonb_build_object('contract',1,'source_key',r->>'source_key','text_sha256',r->>'text_sha256',
  'citation',r->'citation','review',r->'review','matches',matches,
  'links',(select coalesce(jsonb_agg(to_jsonb(l) order by l.document_id),'[]') from public.law_document_links l where l.record_id=m.id))::text,'UTF8')),'hex');
 return jsonb_build_object('contract_version',1,'status',case when jsonb_array_length(reasons)>0 then 'held' when published then 'published' else 'ready' end,
 'action',case when jsonb_array_length(reasons)>0 then 'hold' when m.id is null then 'create-listing' else 'link-existing' end,
 'document_id',d.id,'record_id',m.id,'row_key',m.row_key,'document_key',case when m.id is not null then 'law-record:'||m.id end,
 'fingerprint',fp,'reasons',reasons,'indexed',d.indexed_at is not null);
end $$;

create function public.law_publication_status(p_document uuid) returns jsonb
language sql stable security definer set search_path=public as $$
 select jsonb_build_object('contract_version',1,'document_id',p_document,'status',coalesce(p.status,'unmapped'),
 'fingerprint',p.fingerprint,'record_id',r.id,'row_key',r.row_key,'document_key',case when r.id is not null then 'law-record:'||r.id end,
 'reasons',coalesce(p.reasons,'[]'::jsonb),'attempts',coalesce(p.attempts,0),'last_error',p.last_error)
 from (select p_document id) v left join public.law_publications p on p.document_id=v.id
 left join public.law_document_links l on l.document_id=v.id left join public.law_records r on r.id=l.record_id
$$;

create function public.law_publish(p jsonb) returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare d public.documents%rowtype; r jsonb; proposal jsonb; rid uuid; rk text; visible_row jsonb; pub public.law_publications%rowtype;
begin
 perform pg_advisory_xact_lock(724892);
 select * into d from public.documents where id=(p->>'document_id')::uuid;
 if not found then raise exception 'law listing: document not found'; end if;
 proposal:=public.law_reconcile(p);
 if proposal->>'status'='published' then return public.law_publication_status(d.id); end if;
 if proposal->>'status'='held' then return proposal; end if;
 if p->>'expected_fingerprint' is distinct from proposal->>'fingerprint' then raise exception 'law listing: stale mapping'; end if;
 if length(coalesce(p->>'decision_id','')) not between 1 and 200 or length(coalesce(p->>'approver','')) not between 1 and 200
 or coalesce(p->>'evidence_sha256','') !~ '^[a-f0-9]{64}$' then raise exception 'law listing: decision evidence required'; end if;
 insert into public.law_publications(document_id,status,fingerprint,decision_id,approver,evidence_sha256,actor)
 values(d.id,'pending',proposal->>'fingerprint',p->>'decision_id',p->>'approver',p->>'evidence_sha256',(p->>'actor')::uuid)
 on conflict(document_id) do update set fingerprint=excluded.fingerprint,decision_id=excluded.decision_id,approver=excluded.approver,evidence_sha256=excluded.evidence_sha256,actor=excluded.actor,status='pending',reasons='[]',updated_at=now();
 select * into pub from public.law_publications where document_id=d.id for update;
 if pub.fingerprint is distinct from proposal->>'fingerprint' then raise exception 'law listing: stale mapping'; end if;
 if d.indexed_at is null then return public.law_publication_status(d.id); end if;
 select payload::jsonb into r from public.ingest_text_inputs where document_id=d.id;
 rid:=(proposal->>'record_id')::uuid;
 if rid is null then
  rid:=gen_random_uuid(); rk:='law-order:'||rid;
  visible_row:=jsonb_build_object('id',rk,'title',d.title,'subject',d.title,'court','NCLT','date',r#>>'{citation,order_date}',
   'case_number',r#>>'{citation,case_number}','source_url',d.file_url,'source_key',d.source_key,'record_type','tribunal_order');
  insert into public.law_records(id,row_key,record_type,forum,order_date,case_number,source_url,row_data)
  values(rid,rk,'tribunal_order','NCLT',r#>>'{citation,order_date}',r#>>'{citation,case_number}',d.file_url,visible_row);
 else select row_key,row_data into rk,visible_row from public.law_records where id=rid for update; end if;
 insert into public.law_source_memberships(source_key,record_id,owner,evidence) values(d.source_key,rid,'corpus',jsonb_build_object('text_sha256',d.content_sha256,'decision_id',pub.decision_id))
 on conflict(source_key) do nothing;
 if not exists(select 1 from public.law_source_memberships where source_key=d.source_key and record_id=rid) then raise exception 'law listing: source association conflict'; end if;
 insert into public.law_document_links(document_id,record_id,text_sha256,language,evidence_sha256)
 values(d.id,rid,d.content_sha256,r->>'language',pub.evidence_sha256);
 visible_row:=visible_row||jsonb_build_object('id',rk,'record_id',rid,'document_key','law-record:'||rid,'availability','indexed','record_type','tribunal_order','case_number',r#>>'{citation,case_number}','source_key',d.source_key);
 update public.law_records set row_data=visible_row,case_number=coalesce(case_number,r#>>'{citation,case_number}') where id=rid;
 insert into public.desk_rows(tier,feature,row_key,row,record_text,snapshot_at,document_key)
 values('law','NCLT / NCLAT (Insolvency)',rk,visible_row,visible_row::text,now(),'law-record:'||rid)
 on conflict(tier,feature,row_key) do update set row=excluded.row,record_text=excluded.record_text,document_key=excluded.document_key;
 update public.law_publications set status='published',attempts=attempts+1,last_error=null,reasons='[]',updated_at=now() where document_id=d.id;
 return public.law_publication_status(d.id);
end $$;

-- Preserve the immutable implementation, but require a current server mapping before new paid work.
alter function public.ingest_register_text(jsonb) rename to ingest_register_text_unmapped;
revoke all on function public.ingest_register_text_unmapped(jsonb) from public,anon,authenticated,service_role;
create function public.ingest_register_text(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r jsonb; proposal jsonb; result jsonb;
begin
 r:=(p->>'payload')::jsonb;
 if starts_with(coalesce(r->>'source_key',''),'law:') then
  perform pg_advisory_xact_lock(724892);
  if not exists(select 1 from public.documents where source_key=r->>'source_key') then
   proposal:=public.law_reconcile(jsonb_build_object('record',r));
   if proposal->>'status'='held' then raise exception 'law listing: admission held %',proposal->'reasons'; end if;
   if p->>'mapping_fingerprint' is distinct from proposal->>'fingerprint' then raise exception 'law listing: stale mapping'; end if;
  end if;
 end if;
 result:=public.ingest_register_text_unmapped(p);
 if result->>'existing'='false' then
  update public.law_publications set actor=(p->>'actor')::uuid where document_id=(result->>'document_id')::uuid and actor is null;
 end if;
 return result;
end $$;
revoke all on function public.ingest_register_text(jsonb) from public,anon,authenticated;
grant execute on function public.ingest_register_text(jsonb) to service_role;

-- All supplied-text activation uses publication -> job -> document lock order.
-- An exact registration retry must never hold publication while activation holds document.
alter function public.ingest_text_activate(uuid,uuid,bigint,numeric) rename to ingest_text_activate_unmapped;
revoke all on function public.ingest_text_activate_unmapped(uuid,uuid,bigint,numeric) from public,anon,authenticated,service_role;
create function public.ingest_text_activate(p_job uuid,p_token uuid,p_tokens bigint,p_cost numeric) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(724892);
 return public.ingest_text_activate_unmapped(p_job,p_token,p_tokens,p_cost);
end $$;
revoke all on function public.ingest_text_activate(uuid,uuid,bigint,numeric) from public,anon,authenticated;
grant execute on function public.ingest_text_activate(uuid,uuid,bigint,numeric) to service_role;

-- Intake and activation are in the existing registration/activation transaction. No embedding calls.
create function public.law_prepare_intent() returns trigger
language plpgsql security definer set search_path=public as $$
declare r jsonb; proposal jsonb;
begin
 r:=new.payload::jsonb;
 if not starts_with(coalesce(r->>'source_key',''),'law:trib:IBBI_NCLT:') then return new; end if;
 perform pg_advisory_xact_lock(724892);
 proposal:=public.law_reconcile(jsonb_build_object('record',r));
 if jsonb_array_length(proposal->'reasons')>0 then raise exception 'law listing: admission held %',proposal->'reasons'; end if;
 insert into public.law_publications(document_id,status,fingerprint,decision_id,approver,evidence_sha256)
 values(new.document_id,'pending',proposal->>'fingerprint',r#>>'{review,decision_id}','approved supplied-text review',r#>>'{review,rules_sha256}');
 return new;
end $$;
create trigger law_prepare_intent after insert on public.ingest_text_inputs for each row execute function public.law_prepare_intent();
create function public.law_indexed_publication() returns trigger
language plpgsql security definer set search_path=public as $$
declare pub public.law_publications%rowtype; receipt jsonb;
begin
 if old.indexed_at is not null or new.indexed_at is null then return new; end if;
 select * into pub from public.law_publications where document_id=new.id;
 if not found then return new; end if;
 begin
  receipt:=public.law_publish(jsonb_build_object('document_id',new.id,'text_sha256',new.content_sha256,
   'expected_fingerprint',pub.fingerprint,'decision_id',pub.decision_id,'approver',pub.approver,'evidence_sha256',pub.evidence_sha256,'actor',pub.actor));
  if receipt->>'status'='held' then update public.law_publications set status='held',reasons=receipt->'reasons',attempts=attempts+1 where document_id=new.id; end if;
 exception when others then
  update public.law_publications set status='pending',last_error=left(sqlerrm,500),attempts=attempts+1,updated_at=now() where document_id=new.id;
 end;
 return new;
end $$;
create trigger law_indexed_publication after update of indexed_at on public.documents for each row execute function public.law_indexed_publication();

-- Legacy source refresh may neither erase nor overwrite a canonical owned projection.
create function public.law_protect_projection() returns trigger
language plpgsql security definer set search_path=public as $$
declare r public.law_records%rowtype;
begin
 if old.tier='law' and old.feature='NCLT / NCLAT (Insolvency)' then
  select * into r from public.law_records where row_key=old.row_key;
  if found then
   if tg_op='DELETE' then return null; end if;
   if new.row is distinct from r.row_data or new.document_key is distinct from 'law-record:'||r.id or new.record_text is distinct from r.row_data::text or new.row_key<>old.row_key or new.tier<>old.tier or new.feature<>old.feature then return old; end if;
  end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
create trigger law_protect_projection before update or delete on public.desk_rows for each row execute function public.law_protect_projection();

-- Activation is deliberately separate: seed/reconcile while legacy serving remains live.
create function public.law_activate_listings() returns jsonb
language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(724892);
 if not (select seeded from public.law_listing_settings) then raise exception 'law listing: seed first'; end if;
 if exists(select 1 from public.documents d where starts_with(d.source_key,'law:trib:IBBI_NCLT:') and d.metadata->>'origin'='supplied-text'
  and d.indexed_at is not null and not public.law_document_is_published(d.id)) then raise exception 'law listing: indexed orphan blocks activation'; end if;
 if exists(select 1 from public.law_records r where not exists(select 1 from public.desk_rows s where s.tier='law' and s.feature='NCLT / NCLAT (Insolvency)' and s.row_key=r.row_key and s.row=r.row_data and s.document_key='law-record:'||r.id)) then raise exception 'law listing: projection mismatch'; end if;
 update public.law_listing_settings set active=true;
 return jsonb_build_object('active',true);
end $$;

create function public.law_listing_page(p jsonb default '{}') returns jsonb
language plpgsql stable security invoker set search_path=public as $$
declare pg int:=coalesce((p->>'page')::int,1); sz int:=coalesce((p->>'pageSize')::int,50);
 q text:=coalesce(p->>'q',''); ky text:=nullif(p->>'key',''); sorting text:=coalesce(p->>'sort','date'); direction text:=coalesce(p->>'dir','desc');
 f jsonb:=coalesce(p->'filter','[]'); answer jsonb;
begin
 if not (select active from public.law_listing_settings) then return jsonb_build_object('active',false,'rows','[]'::jsonb,'total',0,'totalAll',0,'page',pg,'pageSize',sz); end if;
 if pg<1 or pg>1000000 or sz<1 or sz>200 or length(q)>300 or sorting not in ('date','title','court','record_type','availability','source_url') or direction not in ('asc','desc')
 or jsonb_typeof(f)<>'array' then raise exception 'law listing: unsupported page query'; end if;
 if exists(select 1 from jsonb_array_elements(f) e where jsonb_typeof(e)<>'object' or coalesce(e->>'col','') not in ('availability','record_type','court') or jsonb_typeof(e->'value') is distinct from 'string' or exists(select 1 from jsonb_object_keys(e) k where k not in ('col','value')))
 or exists(select 1 from jsonb_object_keys(p) k where k not in ('q','key','sort','dir','filter','page','pageSize')) then raise exception 'law listing: unsupported page query'; end if;
 with base as(select r.id,r.row_key,r.row_data||jsonb_build_object('id',r.row_key,'record_id',r.id,'record_type',r.record_type,
  'availability',coalesce(r.row_data->>'availability','source-only'),'document_key','law-record:'||r.id) item from public.law_records r),
 filtered as(select * from base where (q='' or item::text ilike '%'||replace(replace(replace(q,'\','\\'),'%','\%'),'_','\_')||'%')
  and (ky is null or row_key=ky or id::text=ky or 'law-record:'||id=ky)
  and not exists(select 1 from jsonb_array_elements(f) e where not exists(select 1 from jsonb_array_elements(f) alt where alt->>'col'=e->>'col' and item->>(e->>'col')=alt->>'value'))),
 page_rows as(select * from filtered order by case when direction='asc' then item->>sorting end asc nulls last,
 case when direction='desc' then item->>sorting end desc nulls last,row_key limit sz offset (pg-1)*sz)
 select jsonb_build_object('active',true,'rows',coalesce((select jsonb_agg(item) from page_rows),'[]'),
 'total',(select count(*) from filtered),'totalAll',(select count(*) from base),'page',pg,'pageSize',sz) into answer;
 return answer;
end $$;
create function public.law_resolve_document_keys(p_keys text[]) returns table(document_key text,document_id uuid)
language plpgsql stable security invoker set search_path=public as $$
begin
 if coalesce(cardinality(p_keys),0)>12 then raise exception 'law listing: at most twelve keys'; end if;
 return query select 'law-record:'||l.record_id,l.document_id from public.law_document_links l
 join public.documents d on d.id=l.document_id where d.indexed_at is not null and 'law-record:'||l.record_id=any(p_keys);
end $$;
revoke all on function public.law_seed_listings(),public.law_activate_listings(),public.law_reconcile(jsonb),public.law_publish(jsonb),public.law_publication_status(uuid),public.law_prepare_intent(),public.law_indexed_publication(),public.law_protect_projection(),public.law_listing_page(jsonb),public.law_resolve_document_keys(text[]) from public,anon,authenticated,service_role;
grant execute on function public.law_seed_listings(),public.law_activate_listings(),public.law_reconcile(jsonb),public.law_publish(jsonb),public.law_publication_status(uuid) to service_role;
grant execute on function public.law_listing_page(jsonb) to anon,authenticated,service_role;
grant execute on function public.law_resolve_document_keys(text[]) to authenticated,service_role;
