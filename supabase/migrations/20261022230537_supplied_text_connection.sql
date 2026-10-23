-- Supplied text enters the existing queue at index. Never overwrites an existing source.
-- Only the authenticated admin Edge handler calls these service-only RPCs.
alter table public.ingest_jobs add column input_kind text not null default 'pdf'
  check (input_kind in ('pdf','supplied_text'));
alter table public.ingest_jobs drop constraint ingest_jobs_pages_total_check;
alter table public.ingest_jobs add constraint ingest_jobs_pages_total_check
  check (pages_total >= 0 and (input_kind = 'supplied_text' or pages_total >= 1));
create table public.ingest_text_inputs (
  document_id uuid primary key references public.documents(id) on delete cascade,
  payload text not null,
  payload_sha256 text not null,
  expected jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.ingest_text_inputs enable row level security;
revoke all on public.ingest_text_inputs from public, anon, authenticated, service_role;
grant select on public.ingest_text_inputs to service_role;

create function public.ingest_register_text(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
 r jsonb; d public.documents%rowtype; j public.ingest_jobs%rowtype;
 saved public.ingest_text_inputs%rowtype; h text; expected jsonb; meta jsonb;
begin
 if jsonb_typeof(p) is distinct from 'object' or octet_length(p->>'payload') > 4000000 then raise exception 'supplied text: bad payload'; end if;
 h := encode(sha256(convert_to(p->>'payload','UTF8')),'hex');
 if h is null or h is distinct from p->>'payload_sha256' then raise exception 'supplied text: payload hash mismatch'; end if;
 r := (p->>'payload')::jsonb; expected := p->'expected';
 if coalesce(r->>'source_key','') not like 'law:%' or length(coalesce(r->>'title','')) not between 1 and 300
   or length(coalesce(r->>'text','')) not between 1 and 600000
   or r->>'desk_tier' is distinct from 'law' or nullif(r->>'desk_feature','') is null
   or r#>>'{review,status}' is distinct from 'eligible'
   or r->>'text_sha256' is distinct from encode(sha256(convert_to(r->>'text','UTF8')),'hex') then
   raise exception 'supplied text: invalid source or text hash';
 end if;
 if jsonb_typeof(expected) is distinct from 'array' or jsonb_array_length(expected) not between 1 and 800 then raise exception 'supplied text: bad chunks'; end if;
 if exists(select 1 from jsonb_array_elements(expected) e where coalesce(e->>'chunk_hash','') !~ '^[a-f0-9]{64}$' or coalesce(e->>'embed_hash','') !~ '^[a-f0-9]{64}$')
   or (select count(distinct e->>'chunk_hash') from jsonb_array_elements(expected) e) <> jsonb_array_length(expected) then raise exception 'supplied text: duplicate or invalid chunks'; end if;
 -- Same lock order on every registration, then row locks. Unique source_key also protects races with older registration paths.
 perform pg_advisory_xact_lock(hashtextextended(r->>'source_key',724891));
 select * into d from public.documents where source_key=r->>'source_key' for update;
 if found then
   select * into saved from public.ingest_text_inputs where document_id=d.id;
   if not found or saved.payload_sha256 <> h or saved.expected <> expected then raise exception 'supplied text: conflict: existing source is immutable'; end if;
   select * into j from public.ingest_jobs where document_id=d.id order by created_at desc,id desc limit 1;
   if not found then raise exception 'supplied text: conflict: missing job'; end if;
   return jsonb_build_object('document_id',d.id,'job_id',j.id,'status',j.status,'existing',true);
 end if;
 meta := (r - 'text' - 'pages' - 'sections' - 'source_key' - 'title' - 'desk_tier' - 'desk_feature') ||
   jsonb_build_object('origin','supplied-text','text_chunking_mode','section_context_v1','payload_sha256',h,
    'supplied_pages',coalesce(p->'pages','[]'::jsonb),'supplied_sections',coalesce(p->'sections','[]'::jsonb),'citation_offset_encoding','utf16');
 insert into public.documents(source_key,title,file_name,file_url,desk_tier,desk_feature,content_sha256,ocr_text,metadata,source_mime)
 values(r->>'source_key',r->>'title',r->>'file_name',r->>'file_url','law',r->>'desk_feature',r->>'text_sha256',r->>'text',meta,'text/plain') returning * into d;
 insert into public.ingest_text_inputs(document_id,payload,payload_sha256,expected) values(d.id,p->>'payload',h,expected);
 insert into public.ingest_jobs(document_id,input_kind,stage,file_sha256,pages_total,requested_by)
 values(d.id,'supplied_text','index',r->>'text_sha256',jsonb_array_length(coalesce(p->'pages','[]'::jsonb)),(p->>'actor')::uuid) returning * into j;
 return jsonb_build_object('document_id',d.id,'job_id',j.id,'status',j.status,'existing',false);
end $$;

create function public.ingest_text_commit(p_job uuid,p_token uuid,p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare j public.ingest_jobs%rowtype; expected jsonb; r jsonb; keep text[];
begin
 select * into j from public.ingest_jobs where id=p_job for update;
 if not found or j.input_kind <> 'supplied_text' or j.status <> 'running' or j.stage <> 'index'
   or j.claim_token is distinct from p_token or j.lease_until <= clock_timestamp() then raise exception 'supplied text: stale claim'; end if;
 select i.expected into expected from public.ingest_text_inputs i where document_id=j.document_id;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>100 then raise exception 'supplied text: chunk slice limit'; end if;
 for r in select * from jsonb_array_elements(p_rows) loop
   if not exists(select 1 from jsonb_array_elements(expected) e where e = r - 'embedding') then raise exception 'supplied text: chunk differs from approved plan'; end if;
 end loop;
 select array_agg(e->>'chunk_hash') into keep from jsonb_array_elements(expected) e;
 return public.chunk_commit(j.document_id,p_rows,keep);
end $$;

create function public.ingest_text_activate(p_job uuid,p_token uuid,p_tokens bigint,p_cost numeric) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare j public.ingest_jobs%rowtype; i public.ingest_text_inputs%rowtype; d public.documents%rowtype; r jsonb;
begin
 select * into j from public.ingest_jobs where id=p_job for update;
 if not found or j.input_kind <> 'supplied_text' or j.status <> 'running' or j.stage <> 'index'
   or j.claim_token is distinct from p_token or j.lease_until <= clock_timestamp() then raise exception 'supplied text: stale claim'; end if;
 if p_tokens is null or p_cost is null or p_tokens<0 or p_cost<0 then raise exception 'supplied text: invalid spend'; end if;
 select * into i from public.ingest_text_inputs where document_id=j.document_id;
 select * into d from public.documents where id=j.document_id for update;
 r := i.payload::jsonb;
 if d.indexed_at is not null or d.ocr_text is distinct from r->>'text' or d.content_sha256 is distinct from r->>'text_sha256' then raise exception 'supplied text: changed document'; end if;
 if (select count(*) from public.document_chunks where document_id=d.id) <> jsonb_array_length(i.expected)
 or exists(select 1 from jsonb_array_elements(i.expected) e where not exists(
   select 1 from public.document_chunks c where c.document_id=d.id and c.chunk_hash=e->>'chunk_hash' and c.embed_hash=e->>'embed_hash' and c.embedding is not null
     and c.content=e->>'content' and c.char_from=(e->>'char_from')::int and c.char_to=(e->>'char_to')::int and c.chunker_version=4)) then
   raise exception 'supplied text: incomplete chunks';
 end if;
 update public.documents set chunker_version=4,indexed_at=now() where id=d.id;
 update public.ingest_jobs set status='succeeded',stage='done',claim_token=null,lease_until=null,finished_at=now(),attempts=0,
   error_code=null,last_error=null,embed_tokens=embed_tokens+p_tokens,embed_cost_usd=embed_cost_usd+p_cost where id=j.id;
 return jsonb_build_object('status','succeeded','stage','done','document_id',d.id);
end $$;
revoke all on function public.ingest_register_text(jsonb),public.ingest_text_commit(uuid,uuid,jsonb),public.ingest_text_activate(uuid,uuid,bigint,numeric) from public,anon,authenticated;
grant execute on function public.ingest_register_text(jsonb),public.ingest_text_commit(uuid,uuid,jsonb),public.ingest_text_activate(uuid,uuid,bigint,numeric) to service_role;

-- Existing queue policy, with a fail-closed expired-claim rule only for supplied text.
create or replace function public.ingest_claim(p_limit int, p_lease interval)
returns setof public.ingest_jobs
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  -- Serialises every claim, so the cap can't be exceeded by two claims racing.
  c_lock_key           constant bigint := 4917230411;
  INGEST_MAX_RUNNING   constant int    := 2;
  INGEST_MAX_ATTEMPTS  constant int    := 6;
  v_free int;
begin
  if p_lease is null or p_lease <= interval '0' then
    raise exception 'ingest_claim: p_lease must be a positive interval';
  end if;
  if p_limit is null or p_limit < 1 then
    return;
  end if;

  perform pg_advisory_xact_lock(c_lock_key);

  -- A killed supplied-text worker can have paid for vectors without committing them.
  -- Hold an expired claim for reconciliation instead of automatically buying them again.
  update public.ingest_jobs set status='failed',claim_token=null,lease_until=null,
    error_code='text_outcome_uncertain',last_error='Expired supplied-text claim; reconcile before retry',finished_at=now()
    where input_kind='supplied_text' and status='running' and lease_until <= now();

  -- A due job already claimed INGEST_MAX_ATTEMPTS times on its step would
  -- exceed the limit with this claim: it fails instead.
  update public.ingest_jobs
     set status      = 'failed',
         claim_token = null,
         lease_until = null,
         error_code  = 'attempts_exhausted',
         last_error  = format('claimed %s times on stage %s without progress', attempts, stage),
         finished_at = now()
   where attempts >= INGEST_MAX_ATTEMPTS
     and ((status = 'queued' and next_attempt_at <= now())
          or (status = 'running' and lease_until <= now()));

  select INGEST_MAX_RUNNING - count(*)::int into v_free
    from public.ingest_jobs
   where status = 'running' and lease_until > now();
  if v_free <= 0 then
    return;
  end if;

  return query
    with picked as (
      select j.id
        from public.ingest_jobs j
       where (j.status = 'queued' and j.next_attempt_at <= now())
          or (j.status = 'running' and j.lease_until <= now())
       order by case when j.status = 'running' then j.lease_until else j.next_attempt_at end, j.created_at, j.id
       limit least(p_limit, v_free)
       for update skip locked
    ), claimed as (
      update public.ingest_jobs j
         set status      = 'running',
             claim_token = gen_random_uuid(),
             lease_until = now() + p_lease,
             attempts    = j.attempts + 1,
             started_at  = coalesce(j.started_at, now())
        from picked
       where j.id = picked.id
      returning j.*
    )
    select * from claimed;
end;
$$;

-- Closes the find-then-upsert race with legacy writers. Imported identities/text/provenance
-- never change through metadata refresh, PDF replacement, or an older ingestion function.
create function public.protect_supplied_text() returns trigger
language plpgsql set search_path=public as $$
begin
 if old.metadata->>'origin' = 'supplied-text' then
   if (to_jsonb(new) - 'updated_at' - 'indexed_at' - 'chunker_version') is distinct from
      (to_jsonb(old) - 'updated_at' - 'indexed_at' - 'chunker_version')
      or (old.indexed_at is not null and (new.indexed_at is distinct from old.indexed_at or new.chunker_version is distinct from old.chunker_version)) then
     raise exception 'supplied text: immutable document';
   end if;
 end if;
 return new;
end $$;
revoke all on function public.protect_supplied_text() from public,anon,authenticated,service_role;
create trigger protect_supplied_text before update on public.documents for each row execute function public.protect_supplied_text();
