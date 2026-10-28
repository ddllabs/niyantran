-- F266 (spec docs/specs/2026-10-28-parliamentary-records-first.md): Parliamentary question answers are
-- admitted only together with their links to the listing rows that carry the same sansad.in answer
-- file, in the registration transaction; anything that does not corroborate is refused and writes
-- nothing. Law registration is unchanged. No row, document, chunk or vector is altered.
--
-- National admission itself matches what NTER already runs (version 20261027110836 from the client
-- corpus branch, open-work F265), so this replaces that body on NTER and the Law-only body on main.
--
-- Rollback: re-apply the previous body of ingest_register_text_unmapped (20261023184450 chain, or the
-- F265 branch body) and drop pq_answer_key / pq_norm / pq_date. Links already written stay valid and
-- are removed only through record_mapping_remove.

-- The answer document named by a Lok Sabha question URL: pq:ls:<session>:<file stem>. Null otherwise.
create function public.pq_answer_key(url text) returns text
language sql immutable parallel safe set search_path = pg_catalog as $$
 select 'pq:ls:' || m[1] || ':' || m[2]
   from regexp_match(coalesce(url, ''),
     '^https://sansad\.in/getFile/loksabhaquestions/annex/([0-9]{1,4})/([A-Za-z0-9_]{1,64})\.pdf(\?source=pqals)?$') m
$$;

-- Comparison forms used by the F257 planner (scripts/record-mapping-repair.mjs).
create function public.pq_norm(v text) returns text
language sql immutable parallel safe set search_path = pg_catalog as $$
 select nullif(btrim(regexp_replace(lower(normalize(coalesce(v, ''), NFKC)), '[^[:alnum:]]+', ' ', 'g')), '')
$$;
create function public.pq_date(v text) returns text
language sql immutable parallel safe set search_path = pg_catalog as $$
 select case
   when v ~ '^\d{4}-\d{2}-\d{2}$' then v
   when v ~ '^\d{2}\.\d{2}\.\d{4}$' then substr(v, 7, 4) || '-' || substr(v, 4, 2) || '-' || substr(v, 1, 2)
 end
$$;
revoke all on function public.pq_answer_key(text), public.pq_norm(text), public.pq_date(text) from public, anon;
revoke all on function public.pq_answer_key(text), public.pq_norm(text), public.pq_date(text) from authenticated;
grant execute on function public.pq_answer_key(text), public.pq_norm(text), public.pq_date(text) to service_role;

create or replace function public.ingest_register_text_unmapped(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
 r jsonb; d public.documents%rowtype; j public.ingest_jobs%rowtype;
 saved public.ingest_text_inputs%rowtype; h text; expected jsonb; meta jsonb; v_tier text;
 v_key text; c jsonb; w record; n integer := 0; v_rows text[] := '{}';
begin
 if jsonb_typeof(p) is distinct from 'object' or octet_length(p->>'payload') > 4000000 then raise exception 'supplied text: bad payload'; end if;
 h := encode(sha256(convert_to(p->>'payload','UTF8')),'hex');
 if h is null or h is distinct from p->>'payload_sha256' then raise exception 'supplied text: payload hash mismatch'; end if;
 r := (p->>'payload')::jsonb; expected := p->'expected';
 v_tier := case
   when coalesce(r->>'source_key','') like 'law:%' and r->>'desk_tier' = 'law' then 'law'
   when coalesce(r->>'source_key','') ~ '^[0-9a-f]{40}$' and r->>'desk_tier' = 'national'
     and r->>'desk_feature' = 'Parliamentary Question Database'
     and public.pq_answer_key(r->>'file_url') is not null then 'national'
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
   -- F266: the document is the answer file behind one or more question rows, and says so itself.
   v_key := public.pq_answer_key(r->>'file_url');
   c := coalesce(r->'citation', '{}'::jsonb);
   if r ? 'document_key_suggested' and r->>'document_key_suggested' is distinct from v_key then
     raise exception 'supplied text: national question held: answer_key_conflict';
   end if;
   -- One answer file, one document: serialize every admission of this answer whatever its source_key,
   -- then lock the rows, and only then look for another holder (it may have committed meanwhile).
   perform pg_advisory_xact_lock(hashtextextended(v_key,724893));
   for w in select q.row_key, q.row from public.desk_rows q
             where q.tier='national' and q.feature='Parliamentary Question Database'
               and q.row->>'source_url' = r->>'file_url'
             order by q.row_key for update loop
     n := n + 1;
     v_rows := v_rows || w.row_key;
     if public.pq_answer_key(w.row->>'source_url') is distinct from v_key then
       raise exception 'supplied text: national question held: answer_key_conflict'; end if;
     if public.pq_norm(c->>'house') is null or public.pq_norm(c->>'house') is distinct from public.pq_norm(w.row->>'house') then
       raise exception 'supplied text: national question held: house_conflict'; end if;
     if public.pq_norm(c->>'subject') is null or public.pq_norm(c->>'subject') is distinct from public.pq_norm(w.row->>'subject') then
       raise exception 'supplied text: national question held: subject_conflict'; end if;
     if public.pq_date(c->>'answered_on') is null or public.pq_date(c->>'answered_on') is distinct from public.pq_date(w.row->>'date') then
       raise exception 'supplied text: national question held: date_conflict'; end if;
     if public.pq_norm(c->>'ministry') is null or public.pq_norm(c->>'ministry') is distinct from public.pq_norm(w.row->>'ministry') then
       raise exception 'supplied text: national question held: ministry_conflict'; end if;
   end loop;
   if exists(select 1 from public.documents x where x.desk_tier='national'
              and (x.file_url = r->>'file_url' or public.pq_answer_key(x.file_url) = v_key)) then
     raise exception 'supplied text: conflict: another document holds this file_url';
   end if;
   -- Older pack imports carry no file_url; their pack file name names the same answer file.
   if exists(select 1 from public.documents x
              where x.desk_tier='national' and x.desk_feature='Parliamentary Question Database'
                and (x.metadata->>'document_key_suggested' = v_key
                  or lower(regexp_replace(coalesce(x.metadata->>'source_path',''),'^.*/',''))
                     = lower(split_part(v_key,':',3) || '_' || split_part(v_key,':',4) || '.pdf'))) then
     raise exception 'supplied text: conflict: another document holds this answer';
   end if;
   if n = 0 then raise exception 'supplied text: national question has no desk row for its file_url'; end if;
 end if;
 meta := (r - 'text' - 'pages' - 'sections' - 'source_key' - 'title' - 'desk_tier' - 'desk_feature') ||
   jsonb_build_object('origin','supplied-text','text_chunking_mode','section_context_v1','payload_sha256',h,
    'supplied_pages',coalesce(p->'pages','[]'::jsonb),'supplied_sections',coalesce(p->'sections','[]'::jsonb),'citation_offset_encoding','utf16');
 insert into public.documents(source_key,title,file_name,file_url,desk_tier,desk_feature,content_sha256,ocr_text,metadata,source_mime)
 values(r->>'source_key',r->>'title',r->>'file_name',r->>'file_url',v_tier,r->>'desk_feature',r->>'text_sha256',r->>'text',meta,'text/plain') returning * into d;
 insert into public.ingest_text_inputs(document_id,payload,payload_sha256,expected) values(d.id,p->>'payload',h,expected);
 insert into public.ingest_jobs(document_id,input_kind,stage,file_sha256,pages_total,requested_by)
 values(d.id,'supplied_text','index',r->>'text_sha256',jsonb_array_length(coalesce(p->'pages','[]'::jsonb)),(p->>'actor')::uuid) returning * into j;
 if v_tier = 'national' then
   -- The same link record_mapping_apply writes (F257), bound to the admitted document. Indexing later
   -- sets only indexed_at and chunker_version, so the row and document identity hashes stay valid and
   -- the record shows Full text once its vectors exist.
   insert into public.record_document_links(tier,feature,row_key,document_id,role,version,source_url,text_sha256,
     row_sha256,document_identity_sha256,fingerprint,decision_id,approver,evidence_sha256)
   select q.tier,q.feature,q.row_key,d.id,'answer','1',d.file_url,d.content_sha256,
     encode(sha256(convert_to(q.row::text,'UTF8')),'hex'),
     encode(sha256(convert_to(jsonb_build_object('source_key',d.source_key,'metadata',d.metadata)::text,'UTF8')),'hex'),
     public.record_mapping_fingerprint(q.tier,q.feature,q.row_key,d.id),
     'admission:pq-answer-key-v1','supplied-text admission',h
   from public.desk_rows q
   where q.tier='national' and q.feature='Parliamentary Question Database' and q.row_key = any(v_rows);
   update public.record_document_links l
      set expected_link_count=(select count(*) from public.record_document_links x
                                where x.tier=l.tier and x.feature=l.feature and x.row_key=l.row_key)
    where l.tier='national' and l.feature='Parliamentary Question Database'
      and l.row_key = any(v_rows);
 end if;
 return jsonb_build_object('document_id',d.id,'job_id',j.id,'status',j.status,'existing',false,
   'links', case when v_tier = 'national' then n end);
end $$;
revoke all on function public.ingest_register_text_unmapped(jsonb) from public,anon,authenticated,service_role;
