-- Supplied text for one National module: Lok Sabha question answers (owner decision 2026-10-27).
-- Law registration is unchanged. A National question is admitted only with the citation pack's 40-hex source_key,
-- desk national / 'Parliamentary Question Database', an official https://sansad.in/...pdf file_url that a desk row of
-- that module already carries as its source_url, and no other National document holding the same file_url.
-- Same body as 20261022230537 otherwise; the tier written is the admitted one instead of the constant 'law'.
create or replace function public.ingest_register_text_unmapped(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
 r jsonb; d public.documents%rowtype; j public.ingest_jobs%rowtype;
 saved public.ingest_text_inputs%rowtype; h text; expected jsonb; meta jsonb; v_tier text;
begin
 if jsonb_typeof(p) is distinct from 'object' or octet_length(p->>'payload') > 4000000 then raise exception 'supplied text: bad payload'; end if;
 h := encode(sha256(convert_to(p->>'payload','UTF8')),'hex');
 if h is null or h is distinct from p->>'payload_sha256' then raise exception 'supplied text: payload hash mismatch'; end if;
 r := (p->>'payload')::jsonb; expected := p->'expected';
 v_tier := case
   when coalesce(r->>'source_key','') like 'law:%' and r->>'desk_tier' = 'law' then 'law'
   when coalesce(r->>'source_key','') ~ '^[0-9a-f]{40}$' and r->>'desk_tier' = 'national'
     and r->>'desk_feature' = 'Parliamentary Question Database'
     and coalesce(r->>'file_url','') ~ '^https://sansad\.in/[^[:space:]]*\.pdf(\?[^[:space:]]*)?$' then 'national'
 end;
 if v_tier is null or length(coalesce(r->>'title','')) not between 1 and 300
   or length(coalesce(r->>'text','')) not between 1 and 600000
   or nullif(r->>'desk_feature','') is null
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
 if v_tier = 'national' then
   -- The section mapping: the document is the answer behind an existing question row of the desk.
   if not exists(select 1 from public.desk_rows w where w.tier='national' and w.feature='Parliamentary Question Database'
                 and w.row->>'source_url' = r->>'file_url') then
     raise exception 'supplied text: national question has no desk row for its file_url';
   end if;
   if exists(select 1 from public.documents x where x.desk_tier='national' and x.file_url = r->>'file_url') then
     raise exception 'supplied text: conflict: another document holds this file_url';
   end if;
 end if;
 meta := (r - 'text' - 'pages' - 'sections' - 'source_key' - 'title' - 'desk_tier' - 'desk_feature') ||
   jsonb_build_object('origin','supplied-text','text_chunking_mode','section_context_v1','payload_sha256',h,
    'supplied_pages',coalesce(p->'pages','[]'::jsonb),'supplied_sections',coalesce(p->'sections','[]'::jsonb),'citation_offset_encoding','utf16');
 insert into public.documents(source_key,title,file_name,file_url,desk_tier,desk_feature,content_sha256,ocr_text,metadata,source_mime)
 values(r->>'source_key',r->>'title',r->>'file_name',r->>'file_url',v_tier,r->>'desk_feature',r->>'text_sha256',r->>'text',meta,'text/plain') returning * into d;
 insert into public.ingest_text_inputs(document_id,payload,payload_sha256,expected) values(d.id,p->>'payload',h,expected);
 insert into public.ingest_jobs(document_id,input_kind,stage,file_sha256,pages_total,requested_by)
 values(d.id,'supplied_text','index',r->>'text_sha256',jsonb_array_length(coalesce(p->'pages','[]'::jsonb)),(p->>'actor')::uuid) returning * into j;
 return jsonb_build_object('document_id',d.id,'job_id',j.id,'status',j.status,'existing',false);
end $$;
revoke all on function public.ingest_register_text_unmapped(jsonb) from public,anon,authenticated,service_role;
