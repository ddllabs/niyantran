-- F290: registration must not scan the corpus once per document. Spec:
-- docs/specs/2026-11-06-admission-scans.md. Evidence: docs/research/2026-11-06-ingestion-load-proof.md.
--
-- ingest_admit_document ran three scans per National document. On a full-size copy a real 100-document
-- ingest_register_batch call was cancelled at corpus_ingest's 60 s limit, and the cost grows with the corpus.
--
-- An index alone does not fix it. With ORDER BY id LIMIT 1 and a handful of estimated matches, the planner
-- walks the primary key and evaluates the predicate on every row, and it can flip back to that plan after any
-- automatic analyze. So each lookup now reads its matches in a MATERIALIZED CTE, with no ordering or limit
-- inside, and orders outside it. The planner cannot walk the primary key to satisfy an ordering it cannot see.
-- Each OR becomes a UNION ALL, so both arms can use an index. A row matching both arms appears twice, which
-- is harmless under LIMIT 1. Same holder, same refusal: this changes the plan, not the answer. The old file_url
-- arm is gone: admission refuses a National document with no answer key, and one URL has one key, so the key
-- lookup finds every row that arm found.
--
-- ingest_admit_lock locked question rows through a subquery of unknown size, which hashed the whole desk once
-- per call. It now passes an array, so desk_rows_pq_source_url can serve it. The planner keeps no statistics for a
-- partial expression index and guesses each URL at 0.5% of the desk, so at 20 or more URLs it still read the desk.
-- desk_rows_source_url_stats gives it the real distribution.
--
-- Depends on 20261102130000_batch_registration.sql, which is not on NTER yet: apply this straight after it.
-- Indexes are built plainly, like documents_content_sha256 there, so writes to documents and desk_rows wait
-- for the build. It took about 9 s on 36,500 documents and 62,000 desk rows; NTER has 17,609 and 144,196.
-- All or nothing, in one transaction, and it refuses to run ahead of the batch migration: run first, these
-- SECURITY DEFINER functions would be created with default grants.
--
-- Rollback, in one transaction:
--   re-run the ingest_admit_lock and ingest_admit_document definitions from
--   20261102130000_batch_registration.sql, written as CREATE OR REPLACE so that their grants stay;
--   drop statistics public.desk_rows_source_url_stats;
--   drop index public.documents_national_answer_key;
--   drop index public.documents_pq_key_suggested;
--   drop index public.documents_pq_source_file;
--   drop index public.desk_rows_pq_source_url;
--   delete from supabase_migrations.schema_migrations where version = '20261106120000';

begin;
set local lock_timeout = '10s';

do $$
begin
  if to_regprocedure('public.ingest_admit_document(jsonb,jsonb)') is null
     or to_regprocedure('public.ingest_admit_lock(boolean,text[],text[],text[],jsonb)') is null then
    raise exception 'apply 20261102130000_batch_registration.sql first';
  end if;
end $$;

create index documents_national_answer_key on public.documents (public.pq_answer_key(file_url))
  where desk_tier = 'national';
create index documents_pq_key_suggested on public.documents ((metadata->>'document_key_suggested'))
  where desk_tier = 'national' and desk_feature = 'Parliamentary Question Database';
create index documents_pq_source_file
  on public.documents (lower(regexp_replace(coalesce(metadata->>'source_path',''),'^.*/','')))
  where desk_tier = 'national' and desk_feature = 'Parliamentary Question Database';
create index desk_rows_pq_source_url on public.desk_rows ((row->>'source_url'))
  where tier = 'national' and feature = 'Parliamentary Question Database';
create statistics public.desk_rows_source_url_stats on (row->>'source_url') from public.desk_rows;
analyze public.documents;
analyze public.desk_rows;

create or replace function public.ingest_admit_lock(p_law boolean, p_sources text[], p_texts text[], p_answers text[], p_pq jsonb)
returns text[]
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare k bigint; v_existing text[]; v_urls text[];
begin
  if p_law then perform pg_advisory_xact_lock(724892); end if;
  foreach k in array coalesce((select array_agg(distinct hashtextextended(s, 724891) order by hashtextextended(s, 724891))
                                 from unnest(p_sources) s where s is not null), '{}') loop
    perform pg_advisory_xact_lock(k);
  end loop;
  foreach k in array coalesce((select array_agg(distinct hashtextextended(s, 724894) order by hashtextextended(s, 724894))
                                 from unnest(p_texts) s
                                where s is not null and s <> 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'), '{}') loop
    perform pg_advisory_xact_lock(k);
  end loop;
  foreach k in array coalesce((select array_agg(distinct hashtextextended(s, 724893) order by hashtextextended(s, 724893))
                                 from unnest(p_answers) s where s is not null), '{}') loop
    perform pg_advisory_xact_lock(k);
  end loop;
  select coalesce(array_agg(x.source_key order by x.source_key), '{}') into v_existing from (
    select d.source_key from public.documents d where d.source_key = any(p_sources) order by d.source_key for share
  ) x;
  -- An array, not a subquery: the planner guesses a subquery's size and hashes the whole desk.
  select coalesce(array_agg(e->>'file_url'), '{}') into v_urls from jsonb_array_elements(coalesce(p_pq, '[]')) e
   where not (e->>'source_key' = any(v_existing));
  perform 1 from (
    select 1 from public.desk_rows q
     where q.tier = 'national' and q.feature = 'Parliamentary Question Database'
       and q.row->>'source_url' = any(v_urls)
     order by q.tier, q.feature, q.row_key for update
  ) x;
  return v_existing;
end $$;

create or replace function public.ingest_admit_document(d jsonb, o jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  p jsonb := d->'p'; r jsonb := d->'r'; h text := d->>'h'; expected jsonb := (d->'p')->'expected';
  pol jsonb := o->'policy'; v_batch uuid := (o->>'batch_id')::uuid;
  doc public.documents%rowtype; saved public.ingest_text_inputs%rowtype; j public.ingest_jobs%rowtype;
  v_tier text := public.ingest_admit_tier(r); v_text text := r->>'text';
  v_key text; c jsonb; w record; n integer := 0; v_rows text[] := '{}'; holder record; v jsonb;
  meta jsonb; lc text; k text; np int; c_empty constant text := 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
begin
  select * into doc from public.documents where source_key = r->>'source_key';
  if found then
    select * into saved from public.ingest_text_inputs where document_id = doc.id;
    if not found then
      return jsonb_build_object('outcome','refused','reason','legacy_source','detail',jsonb_build_object('document_id',doc.id));
    end if;
    if saved.payload_sha256 <> h or saved.expected <> expected then
      return jsonb_build_object('outcome','refused','reason','immutable_conflict','detail',jsonb_build_object('document_id',doc.id));
    end if;
    select * into j from public.ingest_jobs where document_id = doc.id order by created_at desc, id desc limit 1;
    if not found then
      return jsonb_build_object('outcome','refused','reason','missing_job','detail',jsonb_build_object('document_id',doc.id));
    end if;
    return jsonb_build_object('outcome','existing','document_id',doc.id,'job_id',j.id,'job_status',j.status);
  end if;

  if pol is not null then
    lc := coalesce(r->>'licence_class', '');
    if lc like '%PERSONAL_DATA%' or not (lc = any(array(select jsonb_array_elements_text(pol->'licence_classes')))) then
      return jsonb_build_object('outcome','refused','reason','licence_not_admitted','detail',jsonb_build_object('licence_class',lc));
    end if;
    if r->'servable' = 'false'::jsonb then
      return jsonb_build_object('outcome','refused','reason','not_servable');
    end if;
    for k in select jsonb_array_elements_text(coalesce(d->'required_checks', '[]')) loop
      if r#>'{review,checks}'->k is distinct from 'true'::jsonb then
        return jsonb_build_object('outcome','refused','reason','review_incomplete','detail',jsonb_build_object('check',k));
      end if;
    end loop;
    if coalesce(jsonb_typeof(r->'n_chars'),'null') <> 'null' and r->'n_chars' <> to_jsonb(length(v_text)) then
      return jsonb_build_object('outcome','refused','reason','n_chars_mismatch',
        'detail',jsonb_build_object('declared',r->'n_chars','actual',length(v_text)));
    end if;
    np := case when jsonb_typeof(r->'pages') = 'array' then jsonb_array_length(r->'pages') else 0 end;
    foreach k in array array['n_pages','page_count'] loop
      if coalesce(jsonb_typeof(r->k),'null') <> 'null' and r->k <> to_jsonb(np) then
        return jsonb_build_object('outcome','refused','reason','page_count_mismatch',
          'detail',jsonb_build_object('field',k,'declared',r->k,'pages',np));
      end if;
    end loop;
    if v_text ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]' then
      return jsonb_build_object('outcome','refused','reason','control_codes');
    end if;
    -- Declared counts equal the page spans (checked above), so the spans are the page count.
    if np = 0 then
      if (pol->>'require_page_count')::boolean then
        return jsonb_build_object('outcome','refused','reason','no_page_count');
      end if;
    elsif np >= (pol->>'min_pages_for_density')::int
      and length(v_text)::numeric / np < (pol->>'min_chars_per_page')::numeric then
      return jsonb_build_object('outcome','refused','reason','thin_text','detail',jsonb_build_object(
        'n_pages',np,'chars',length(v_text),'chars_per_page',round(length(v_text)::numeric / np, 1),'file_url',r->>'file_url'));
    end if;
  end if;

  if coalesce((o->>'law_check')::boolean, false) and starts_with(coalesce(r->>'source_key',''), 'law:') then
    v := public.ingest_admit_law(r, p->>'mapping_fingerprint');
    if v is not null then return jsonb_build_object('outcome','refused') || v; end if;
  end if;

  if v_tier = 'national' then
    -- F266: the document is the answer file behind one or more question rows, and says so itself.
    v_key := public.pq_answer_key(r->>'file_url');
    c := coalesce(r->'citation', '{}'::jsonb);
    if r ? 'document_key_suggested' and r->>'document_key_suggested' is distinct from v_key then
      return jsonb_build_object('outcome','refused','reason','answer_key_conflict');
    end if;
    for w in select q.row_key, q.row from public.desk_rows q
              where q.tier='national' and q.feature='Parliamentary Question Database'
                and q.row->>'source_url' = r->>'file_url'
              order by q.row_key for update loop
      n := n + 1;
      v_rows := v_rows || w.row_key;
      if public.pq_answer_key(w.row->>'source_url') is distinct from v_key then
        return jsonb_build_object('outcome','refused','reason','answer_key_conflict','detail',jsonb_build_object('row_key',w.row_key)); end if;
      if public.pq_norm(c->>'house') is null or public.pq_norm(c->>'house') is distinct from public.pq_norm(w.row->>'house') then
        return jsonb_build_object('outcome','refused','reason','house_conflict','detail',jsonb_build_object('row_key',w.row_key)); end if;
      if public.pq_norm(c->>'subject') is null or public.pq_norm(c->>'subject') is distinct from public.pq_norm(w.row->>'subject') then
        return jsonb_build_object('outcome','refused','reason','subject_conflict','detail',jsonb_build_object('row_key',w.row_key)); end if;
      if public.pq_date(c->>'answered_on') is null or public.pq_date(c->>'answered_on') is distinct from public.pq_date(w.row->>'date') then
        return jsonb_build_object('outcome','refused','reason','date_conflict','detail',jsonb_build_object('row_key',w.row_key)); end if;
      if public.pq_norm(c->>'ministry') is null or public.pq_norm(c->>'ministry') is distinct from public.pq_norm(w.row->>'ministry') then
        return jsonb_build_object('outcome','refused','reason','ministry_conflict','detail',jsonb_build_object('row_key',w.row_key)); end if;
    end loop;
    with m as materialized (
      select x.id, x.source_key from public.documents x
       where x.desk_tier='national' and public.pq_answer_key(x.file_url) = v_key
    )
    select m.id, m.source_key into holder from m order by m.id limit 1;
    if found then
      return jsonb_build_object('outcome','refused','reason','file_url_held',
        'detail',jsonb_build_object('holder_document_id',holder.id,'holder_source_key',holder.source_key));
    end if;
    -- Older pack imports carry no file_url; their pack file name names the same answer file.
    with m as materialized (
      select x.id, x.source_key from public.documents x
       where x.desk_tier='national' and x.desk_feature='Parliamentary Question Database'
         and x.metadata->>'document_key_suggested' = v_key
      union all
      select x.id, x.source_key from public.documents x
       where x.desk_tier='national' and x.desk_feature='Parliamentary Question Database'
         and lower(regexp_replace(coalesce(x.metadata->>'source_path',''),'^.*/',''))
             = lower(split_part(v_key,':',3) || '_' || split_part(v_key,':',4) || '.pdf')
    )
    select m.id, m.source_key into holder from m order by m.id limit 1;
    if found then
      return jsonb_build_object('outcome','refused','reason','answer_held',
        'detail',jsonb_build_object('holder_document_id',holder.id,'holder_source_key',holder.source_key));
    end if;
    if n = 0 then return jsonb_build_object('outcome','refused','reason','no_desk_row'); end if;
  end if;

  -- Design 3: one text, one document. The holder is named, never its text.
  with m as materialized (
    select x.id, x.source_key from public.documents x
     where x.content_sha256 = r->>'text_sha256' and x.source_key <> r->>'source_key'
       and x.content_sha256 <> 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  )
  select m.id, m.source_key into holder from m order by m.id limit 1;
  if found then
    return jsonb_build_object('outcome','refused','reason','duplicate_text',
      'detail',jsonb_build_object('holder_document_id',holder.id,'holder_source_key',holder.source_key));
  end if;

  meta := (r - 'text' - 'pages' - 'sections' - 'source_key' - 'title' - 'desk_tier' - 'desk_feature') ||
    jsonb_build_object('origin','supplied-text','text_chunking_mode','section_context_v1','payload_sha256',h,
     'supplied_pages',coalesce(p->'pages','[]'::jsonb),'supplied_sections',coalesce(p->'sections','[]'::jsonb),'citation_offset_encoding','utf16');
  insert into public.documents(source_key,title,file_name,file_url,desk_tier,desk_feature,content_sha256,ocr_text,metadata,source_mime)
  values(r->>'source_key',r->>'title',r->>'file_name',r->>'file_url',v_tier,r->>'desk_feature',r->>'text_sha256',r->>'text',meta,'text/plain') returning * into doc;
  insert into public.ingest_text_inputs(document_id,payload,payload_sha256,expected) values(doc.id,p->>'payload',h,expected);
  -- requested_by references auth.users: a batch has no person behind it (design 1), so it stays null.
  insert into public.ingest_jobs(document_id,input_kind,stage,file_sha256,pages_total,requested_by,batch_id)
  values(doc.id,'supplied_text','index',r->>'text_sha256',jsonb_array_length(coalesce(p->'pages','[]'::jsonb)),
         case when v_batch is null then (p->>'actor')::uuid end, v_batch) returning * into j;
  if v_tier = 'national' then
    -- The same link record_mapping_apply writes (F257), bound to the admitted document.
    insert into public.record_document_links(tier,feature,row_key,document_id,role,version,source_url,text_sha256,
      row_sha256,document_identity_sha256,fingerprint,decision_id,approver,evidence_sha256)
    select q.tier,q.feature,q.row_key,doc.id,'answer','1',doc.file_url,doc.content_sha256,
      encode(sha256(convert_to(q.row::text,'UTF8')),'hex'),
      encode(sha256(convert_to(jsonb_build_object('source_key',doc.source_key,'metadata',doc.metadata)::text,'UTF8')),'hex'),
      public.record_mapping_fingerprint(q.tier,q.feature,q.row_key,doc.id),
      'admission:pq-answer-key-v1','supplied-text admission',h
    from public.desk_rows q
    where q.tier='national' and q.feature='Parliamentary Question Database' and q.row_key = any(v_rows);
    update public.record_document_links l
       set expected_link_count=(select count(*) from public.record_document_links x
                                 where x.tier=l.tier and x.feature=l.feature and x.row_key=l.row_key)
     where l.tier='national' and l.feature='Parliamentary Question Database'
       and l.row_key = any(v_rows);
  end if;
  return jsonb_build_object('outcome','admitted','document_id',doc.id,'job_id',j.id,'job_status',j.status,
    'links', case when v_tier = 'national' then n end);
end $$;

commit;
