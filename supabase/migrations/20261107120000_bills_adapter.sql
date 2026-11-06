-- F275: Bills enter through a sealed batch, linked to their listing rows. Spec: docs/specs/2026-11-07-bills-adapter.md.
--
-- A question answer finds its listing rows by URL. That cannot work here: all 9,817 bill rows carry the same
-- source_url, a listing page. So a bill matches on desk_rows.document_key, the key every reader of bills already
-- joins on, then house, then the whole bill name with its year removed. A name only chooses among rows that already
-- share the key, and it must match exactly. On the 2,764 live bills with a key, this identifies one bill for 2,646
-- and refuses 118, with none ambiguous.
--
-- New refusals: bill_identity_incomplete, bill_role_held, bill_identity_mismatch, and for this adapter file_url_held
-- and no_desk_row. A policy can require review check bill_identity, the owner's text check, which the runner makes.
-- The single-document path refuses Bills.
--
-- Depends on 20261106120000_admission_scans.sql, whose functions this replaces. Not on NTER. To apply, with separate
-- approval: first deploy ingest-worker and admin-ingest from this commit, because the worker re-prepares a bill and the
-- old code refuses one. Then run this by psql (F283) with the worker paused: the index builds block writers to
-- documents and desk_rows until the commit. The analyze runs after the commit. A duplicate stops it with nothing done.
--
-- Rollback, in one transaction, before any bill is admitted. After that, admitted bills stay until their documents,
-- jobs and links are removed by a reviewed step: these functions cannot process them.
--   re-run ingest_admit_document from 20261106120000_admission_scans.sql; re-run ingest_admit_tier,
--   ingest_admit_adapter, ingest_register_text_unmapped and ingest_register_batch from
--   20261102130000_batch_registration.sql; each written as CREATE OR REPLACE so that its grants stay;
--   drop function public.ingest_bill_rows(text, text, text);
--   drop function public.bill_admission_key(jsonb);
--   drop function public.bill_norm(text);
--   drop index public.documents_bill_file_url;
--   drop index public.documents_bill_key_role;
--   delete from supabase_migrations.schema_migrations where version = '20261107120000';

begin;
set local lock_timeout = '10s';

do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'desk_rows_pq_source_url') then
    raise exception 'apply 20261106120000_admission_scans.sql first';
  end if;
end $$;

-- Unique, so that two concurrent runs cannot both admit one file or one role of a bill in one house: the lookups
-- below refuse by name, and these hold if a race gets past them. Errata can repeat for a bill. Live bills have no
-- duplicate of either.
create unique index documents_bill_file_url on public.documents (file_url)
  where desk_tier = 'national' and desk_feature = 'Bill Passage Probability Index';
create unique index documents_bill_key_role
  on public.documents ((metadata->>'document_key'), (metadata->>'house'), (metadata->>'document_role'))
  where desk_tier = 'national' and desk_feature = 'Bill Passage Probability Index' and metadata->>'document_role' <> 'errata';

-- A bill's name for comparison: its closing year removed, then letters and digits only, so that punctuation and
-- case cannot decide a match. Devanagari normalises away, so a Hindi name is incomplete, never a match.
create function public.bill_norm(v text) returns text
language sql immutable parallel safe set search_path = pg_catalog, pg_temp as $$
 select regexp_replace(lower(regexp_replace(coalesce(v, ''), ',?\s*[0-9]{4}\s*\.?\s*$', '')), '[^a-z0-9]+', '', 'g')
$$;

-- The bill a record claims to be: its key, or null when the record does not fully and consistently say so.
create function public.bill_admission_key(r jsonb) returns text
language sql immutable security definer set search_path = public, extensions, pg_temp as $$
 select case
   when r->>'file_url' ~ '^https://sansad\.in/getFile/(BillsTexts|BillsPDFFiles)/' and r->>'file_url' !~ '\.\.'
    and n ~ '^([0-9]+|[IVXLCDM]+)$' and y ~ '^[0-9]{4}$'
    and r#>>'{citation,house}' in ('Lok Sabha','Rajya Sabha')
    and length(public.bill_norm(r#>>'{citation,bill_name}')) >= 8
    and r->>'document_role' in ('as_introduced','as_passed_lok_sabha','as_passed_rajya_sabha','as_passed_both_houses',
                                'gazette_notification','synopsis','errata')
    and r->>'document_key' = 'bill:' || y || ':' || n
   then r->>'document_key' end
  from (select r#>>'{citation,bill_number}' n, r#>>'{citation,bill_year}' y) f
$$;

-- The listing rows of one bill, locked in row_key order. candidates: rows with this key in this house. rows: those
-- whose whole name matches, which are every listing of the one bill.
create function public.ingest_bill_rows(p_key text, p_house text, p_name text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_name text := public.bill_norm(p_name); v_candidates int; v_rows jsonb;
begin
  with c as materialized (
    select q.row_key, public.bill_norm(q.row->>'bill_name') nm from public.desk_rows q
     where q.tier = 'national' and q.feature = 'Bill Passage Probability Index'
       and q.document_key = p_key and q.row->>'house' = p_house
     order by q.row_key for update of q
  )
  select (select count(*) from c),
         (select coalesce(jsonb_agg(c.row_key order by c.row_key), '[]') from c where c.nm = v_name)
    into v_candidates, v_rows;
  return jsonb_build_object('candidates', v_candidates, 'rows', v_rows);
end $$;
revoke all on function public.bill_norm(text), public.bill_admission_key(jsonb), public.ingest_bill_rows(text, text, text)
  from public, anon, authenticated, service_role;

create or replace function public.ingest_admit_tier(r jsonb) returns text
language sql immutable security definer set search_path = public, extensions, pg_temp as $$
 select case
   when coalesce(r->>'source_key','') like 'law:%' and r->>'desk_tier' = 'law' then 'law'
   when coalesce(r->>'source_key','') ~ '^[0-9a-f]{40}$' and r->>'desk_tier' = 'national'
     and r->>'desk_feature' = 'Parliamentary Question Database'
     and public.pq_answer_key(r->>'file_url') is not null then 'national'
   when coalesce(r->>'source_key','') ~ '^[0-9a-f]{40}$' and r->>'desk_tier' = 'national'
     and r->>'desk_feature' = 'Bill Passage Probability Index' then 'national'
 end
$$;

create or replace function public.ingest_admit_adapter(r jsonb) returns text
language sql immutable security definer set search_path = public, extensions, pg_temp as $$
 select case
   when r->>'desk_tier' = 'law' then 'law'
   when r->>'desk_tier' = 'national' and r->>'desk_feature' = 'Parliamentary Question Database' then 'lok_sabha_answers'
   when r->>'desk_tier' = 'national' and r->>'desk_feature' = 'Bill Passage Probability Index' then 'national_bills'
 end
$$;

create or replace function public.ingest_admit_document(d jsonb, o jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  p jsonb := d->'p'; r jsonb := d->'r'; h text := d->>'h'; expected jsonb := (d->'p')->'expected';
  pol jsonb := o->'policy'; v_batch uuid := (o->>'batch_id')::uuid;
  doc public.documents%rowtype; saved public.ingest_text_inputs%rowtype; j public.ingest_jobs%rowtype;
  v_tier text := public.ingest_admit_tier(r); v_text text := r->>'text';
  v_adapter text := public.ingest_admit_adapter(r); v_link_role text := 'answer'; v_decision text := 'admission:pq-answer-key-v1';
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

  if v_adapter = 'lok_sabha_answers' then
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
  elsif v_adapter = 'national_bills' then
    -- F275: every listing row carries the same source_url, so identity is the stored key and the house, and the
    -- whole bill name then picks among those rows. The name never links on its own.
    v_key := public.bill_admission_key(r);
    if v_key is null then return jsonb_build_object('outcome','refused','reason','bill_identity_incomplete'); end if;
    v_link_role := r->>'document_role';
    v_decision := 'admission:bill-key-v1';
    with m as materialized (
      select x.id, x.source_key from public.documents x
       where x.desk_tier='national' and x.desk_feature='Bill Passage Probability Index' and x.file_url = r->>'file_url'
    )
    select m.id, m.source_key into holder from m order by m.id limit 1;
    if found then
      return jsonb_build_object('outcome','refused','reason','file_url_held',
        'detail',jsonb_build_object('holder_document_id',holder.id,'holder_source_key',holder.source_key));
    end if;
    with m as materialized (
      select x.id, x.source_key from public.documents x
       where x.desk_tier='national' and x.desk_feature='Bill Passage Probability Index'
         and x.metadata->>'document_key' = v_key and x.metadata->>'house' = r#>>'{citation,house}'
         and x.metadata->>'document_role' = v_link_role and v_link_role <> 'errata'
    )
    select m.id, m.source_key into holder from m order by m.id limit 1;
    if found then
      return jsonb_build_object('outcome','refused','reason','bill_role_held',
        'detail',jsonb_build_object('holder_document_id',holder.id,'holder_source_key',holder.source_key));
    end if;
    v := public.ingest_bill_rows(v_key, r#>>'{citation,house}', r#>>'{citation,bill_name}');
    if (v->>'candidates')::int = 0 then return jsonb_build_object('outcome','refused','reason','no_desk_row'); end if;
    v_rows := array(select jsonb_array_elements_text(v->'rows'));
    if cardinality(v_rows) = 0 then
      return jsonb_build_object('outcome','refused','reason','bill_identity_mismatch','detail',jsonb_build_object('candidates',v->'candidates'));
    end if;
    n := cardinality(v_rows);
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
  if v_adapter = 'national_bills' then
    meta := meta || jsonb_build_object('bill_number',r#>>'{citation,bill_number}','bill_year',r#>>'{citation,bill_year}',
      'house',r#>>'{citation,house}') || coalesce(jsonb_strip_nulls(jsonb_build_object('status',r#>>'{citation,status}')), '{}');
  end if;
  insert into public.documents(source_key,title,file_name,file_url,desk_tier,desk_feature,content_sha256,ocr_text,metadata,source_mime)
  values(r->>'source_key',r->>'title',r->>'file_name',r->>'file_url',v_tier,r->>'desk_feature',r->>'text_sha256',r->>'text',meta,'text/plain') returning * into doc;
  insert into public.ingest_text_inputs(document_id,payload,payload_sha256,expected) values(doc.id,p->>'payload',h,expected);
  -- requested_by references auth.users: a batch has no person behind it (design 1), so it stays null.
  insert into public.ingest_jobs(document_id,input_kind,stage,file_sha256,pages_total,requested_by,batch_id)
  values(doc.id,'supplied_text','index',r->>'text_sha256',jsonb_array_length(coalesce(p->'pages','[]'::jsonb)),
         case when v_batch is null then (p->>'actor')::uuid end, v_batch) returning * into j;
  if v_adapter in ('lok_sabha_answers','national_bills') then
    -- The same link record_mapping_apply writes (F257), bound to the admitted document.
    insert into public.record_document_links(tier,feature,row_key,document_id,role,version,source_url,text_sha256,
      row_sha256,document_identity_sha256,fingerprint,decision_id,approver,evidence_sha256)
    select q.tier,q.feature,q.row_key,doc.id,v_link_role,'1',doc.file_url,doc.content_sha256,
      encode(sha256(convert_to(q.row::text,'UTF8')),'hex'),
      encode(sha256(convert_to(jsonb_build_object('source_key',doc.source_key,'metadata',doc.metadata)::text,'UTF8')),'hex'),
      public.record_mapping_fingerprint(q.tier,q.feature,q.row_key,doc.id),
      v_decision,'supplied-text admission',h
    from public.desk_rows q
    where q.tier='national' and q.feature=r->>'desk_feature' and q.row_key = any(v_rows);
    update public.record_document_links l
       set expected_link_count=(select count(*) from public.record_document_links x
                                 where x.tier=l.tier and x.feature=l.feature and x.row_key=l.row_key)
     where l.tier='national' and l.feature=r->>'desk_feature'
       and l.row_key = any(v_rows);
  end if;
  return jsonb_build_object('outcome','admitted','document_id',doc.id,'job_id',j.id,'job_status',j.status,
    'links', case when v_adapter in ('lok_sabha_answers','national_bills') then n end);
end $$;

create or replace function public.ingest_register_text_unmapped(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v jsonb; r jsonb; reason text; res jsonb; national boolean;
begin
  v := public.ingest_admit_parse(p);
  reason := v->>'reason';
  -- An unparseable payload raised the cast error here before; keep it.
  if v->>'detail' = 'invalid_json' then perform (p->>'payload')::jsonb; end if;
  if reason is not null then raise exception '%', public.ingest_admit_message(reason, null); end if;
  r := v->'r';
  if public.ingest_admit_adapter(r) = 'national_bills' then
    raise exception 'supplied text: Bills enter through a sealed batch';
  end if;
  reason := public.ingest_admit_shape(r, p->'expected');
  if reason is not null then raise exception '%', public.ingest_admit_message(reason, null); end if;
  national := public.ingest_admit_tier(r) = 'national';
  perform public.ingest_admit_lock(false, array[r->>'source_key'], array[r->>'text_sha256'],
    case when national then array[public.pq_answer_key(r->>'file_url')] else '{}'::text[] end,
    case when national then jsonb_build_array(jsonb_build_object('source_key',r->>'source_key','file_url',r->>'file_url')) else '[]'::jsonb end);
  res := public.ingest_admit_document(jsonb_build_object('p',p,'r',r,'h',v->>'h'), jsonb_build_object('law_check',false));
  if res->>'outcome' = 'refused' then raise exception '%', public.ingest_admit_message(res->>'reason', res->'detail'); end if;
  if res->>'outcome' = 'existing' then
    return jsonb_build_object('document_id',res->'document_id','job_id',res->'job_id','status',res->'job_status','existing',true);
  end if;
  return jsonb_build_object('document_id',res->'document_id','job_id',res->'job_id','status',res->'job_status','existing',false,
    'links',res->'links');
end $$;

create or replace function public.ingest_register_batch(p_batch uuid, p_documents jsonb,
                                             p_dry_run boolean default false,
                                             p_all_or_nothing boolean default false) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  b public.ingest_batches%rowtype; pol jsonb; item public.ingest_batch_items%rowtype;
  dry boolean := coalesce(p_dry_run, false); aon boolean := coalesce(p_all_or_nothing, false);
  n int; i int; e jsonb; v jsonb; r jsonb; sk text; adapter text; entry jsonb; reason text; call_reason text;
  parsed jsonb[]; res jsonb[]; pend jsonb[]; seen text[] := '{}';
  v_sources text[] := '{}'; v_texts text[] := '{}'; v_answers text[] := '{}'; v_pq jsonb := '[]'; v_law boolean := false;
  rolled_back boolean := false; out jsonb; results jsonb := '[]'; by_reason jsonb := '{}'; ocr jsonb := '[]';
  t_adm int := 0; t_ex int := 0; t_ref int := 0; t_would int := 0;
  st jsonb; v_decided bigint; w record; v_state text; v_stop text; counts jsonb;
begin
  if p_batch is null then raise exception 'ingest_register_batch: p_batch is required'; end if;
  if jsonb_typeof(p_documents) is distinct from 'array' or jsonb_array_length(p_documents) not between 1 and 100 then
    raise exception 'ingest_register_batch: p_documents must be an array of 1 to 100 documents';
  end if;
  if octet_length(p_documents::text) > 8000000 then
    raise exception 'ingest_register_batch: a call carries at most 8 MB of documents';
  end if;
  select * into b from public.ingest_batches where id = p_batch for update;
  if not found then raise exception 'ingest_register_batch: batch % does not exist', p_batch; end if;
  pol := b.policy;
  n := jsonb_array_length(p_documents);
  parsed := array_fill(null::jsonb, array[n]); res := parsed; pend := parsed;
  call_reason := case b.state when 'open' then 'batch_not_sealed' when 'stopped' then 'batch_stopped' end;

  -- 1. Checks that need no lock: payload, manifest, adapter, collection, shape.
  for i in 1..n loop
    e := p_documents->(i-1);
    v := public.ingest_admit_parse(e);
    sk := (v->'r')->>'source_key';
    if v ? 'reason' then
      res[i] := jsonb_build_object('source_key',null,'outcome','refused','reason',v->>'reason'); continue;
    end if;
    r := v->'r';
    if sk is not null and sk = any(seen) then
      raise exception 'ingest_register_batch: source_key % appears more than once in one call', sk;
    end if;
    seen := seen || sk;
    if call_reason is not null then
      res[i] := jsonb_build_object('source_key',sk,'outcome','refused','reason',call_reason); continue;
    end if;
    if (e ? 'pages' and jsonb_typeof(e->'pages') is distinct from 'array')
      or (e ? 'sections' and jsonb_typeof(e->'sections') is distinct from 'array') then
      res[i] := jsonb_build_object('source_key',sk,'outcome','refused','reason','bad_payload','detail','pages and sections must be arrays'); continue;
    end if;
    select * into item from public.ingest_batch_items where batch_id = b.id and source_key = sk;
    if not found then
      res[i] := jsonb_build_object('source_key',sk,'outcome','refused','reason','not_in_manifest'); continue;
    end if;
    if item.outcome = 'refused' then  -- decided earlier in this batch: the recorded verdict, nothing written
      res[i] := jsonb_build_object('source_key',sk,'outcome','refused','reason',item.reason,'detail',item.detail,'replayed',true); continue;
    end if;
    reason := case
      when item.payload_sha256 <> v->>'h' then 'payload_sha256'
      when item.content_sha256 is distinct from r->>'text_sha256' then 'content_sha256'
      when jsonb_typeof(e->'expected') = 'array' and jsonb_array_length(e->'expected') <> item.chunks then 'chunks' end;
    if reason is not null then
      res[i] := jsonb_build_object('source_key',sk,'outcome','refused','reason','manifest_mismatch','detail',jsonb_build_object('field',reason)); continue;
    end if;
    -- From here a verdict is about the exact manifest document, so it is recorded in the ledger.
    adapter := public.ingest_admit_adapter(r);
    select x into entry from jsonb_array_elements(pol->'admitted') x
     where x->>'desk_tier' = r->>'desk_tier' and x->>'desk_feature' = r->>'desk_feature' and x->>'adapter' = adapter limit 1;
    reason := case when adapter is null then 'no_adapter' when entry is null then 'collection_not_admitted'
                   else public.ingest_admit_shape(r, e->'expected') end;
    if reason is not null then
      res[i] := jsonb_build_object('source_key',sk,'outcome','refused','reason',reason);
      if item.outcome = 'planned' then pend[i] := res[i]; end if;
      continue;
    end if;
    parsed[i] := jsonb_build_object('p',e,'r',r,'h',v->>'h','required_checks',coalesce(entry->'required_checks','[]'::jsonb),
                                    'item_outcome',item.outcome);
    v_sources := v_sources || sk;
    v_texts := v_texts || (r->>'text_sha256');
    if adapter = 'law' then v_law := true; end if;
    if adapter = 'national_bills' then
      v_answers := v_answers || coalesce(public.bill_admission_key(r), sk) || coalesce(r->>'file_url', sk);
    end if;
    if adapter = 'lok_sabha_answers' then
      v_answers := v_answers || public.pq_answer_key(r->>'file_url');
      v_pq := v_pq || jsonb_build_array(jsonb_build_object('source_key',sk,'file_url',r->>'file_url'));
    end if;
  end loop;

  -- 2. Every lock, in the one order.
  if cardinality(v_sources) > 0 then
    perform public.ingest_admit_lock(v_law, v_sources, v_texts, v_answers, v_pq);
  end if;

  -- 3. Verdicts and writes, document by document, so a later document sees an earlier one's
  --    writes. A dry run, or an all-or-nothing call with a refusal, rolls this block back: the
  --    verdicts come from the same code that writes, and nothing is written.
  begin
    for i in 1..n loop
      if pend[i] is not null then
        update public.ingest_batch_items set outcome='refused', reason=pend[i]->>'reason', detail=pend[i]->'detail', decided_at=now()
         where batch_id = b.id and source_key = pend[i]->>'source_key' and outcome = 'planned';
      end if;
      if parsed[i] is null then continue; end if;
      sk := parsed[i]->'r'->>'source_key';
      out := jsonb_build_object('source_key',sk) || public.ingest_admit_document(parsed[i],
               jsonb_build_object('batch_id',b.id,'policy',pol,'law_check',true));
      if out->>'outcome' = 'admitted' then
        update public.ingest_batch_items set outcome='admitted', reason=null, detail=null,
          document_id=(out->>'document_id')::uuid, job_id=(out->>'job_id')::uuid, decided_at=now()
         where batch_id = b.id and source_key = sk;
      elsif parsed[i]->>'item_outcome' = 'planned' then
        update public.ingest_batch_items set outcome=out->>'outcome', reason=out->>'reason', detail=out->'detail',
          document_id=(out->>'document_id')::uuid, job_id=(out->>'job_id')::uuid, decided_at=now()
         where batch_id = b.id and source_key = sk;
      end if;
      res[i] := out;
    end loop;
    if dry or (aon and exists(select 1 from unnest(res) x where x->>'outcome' = 'refused')) then
      raise exception using errcode = 'NB001', message = 'ingest_register_batch: rolled back';
    end if;
  exception when sqlstate 'NB001' then
    rolled_back := true;
  end;

  for i in 1..n loop
    out := res[i];
    if rolled_back and out->>'outcome' = 'admitted' then
      out := (out - 'document_id' - 'job_id' - 'job_status' - 'links') || jsonb_build_object('outcome','would_admit');
    end if;
    case out->>'outcome'
      when 'admitted' then t_adm := t_adm + 1;
      when 'existing' then t_ex := t_ex + 1;
      when 'would_admit' then t_would := t_would + 1;
      else
        t_ref := t_ref + 1;
        by_reason := by_reason || jsonb_build_object(out->>'reason', coalesce((by_reason->>(out->>'reason'))::int,0) + 1);
        if out->>'reason' = 'thin_text' then
          ocr := ocr || jsonb_build_array(jsonb_build_object('source_key',out->>'source_key','file_url',out#>>'{detail,file_url}'));
        end if;
    end case;
    results := results || jsonb_build_array(out);
  end loop;

  -- 4. Batch state and the refusal stop rule (real calls only).
  v_state := b.state;
  if not rolled_back and call_reason is null then
    if v_state = 'sealed' then v_state := 'registering'; end if;
    if v_state = 'registering' and not exists(select 1 from public.ingest_batch_items where batch_id = b.id and outcome = 'planned') then
      v_state := 'registered';
    end if;
    if v_state <> b.state then
      update public.ingest_batches set state = v_state, updated_at = now() where id = b.id;
    end if;
    st := pol->'stop_thresholds';
    select count(*) into v_decided from public.ingest_batch_items where batch_id = b.id and outcome <> 'planned';
    if v_decided >= (st->>'min_decided')::numeric then
      for w in select i.reason, count(*) cnt from public.ingest_batch_items i where i.batch_id = b.id and i.outcome = 'refused'
                group by i.reason order by count(*) desc, i.reason loop
        if w.cnt::numeric / v_decided > coalesce((st->'refusal_share_by_reason'->>w.reason)::numeric, (st->>'refusal_share')::numeric) then
          v_stop := 'refusal_share:' || w.reason; exit;
        end if;
      end loop;
      if v_stop is not null and public.ingest_batch_mark_stopped(b.id, v_stop, false) then v_state := 'stopped'; end if;
    end if;
  end if;

  select jsonb_build_object('items',count(*),'planned',count(*) filter (where outcome='planned'),
    'admitted',count(*) filter (where outcome='admitted'),'existing',count(*) filter (where outcome='existing'),
    'refused',count(*) filter (where outcome='refused')) into counts
    from public.ingest_batch_items where batch_id = b.id;
  return jsonb_build_object('batch_id',b.id,'dry_run',dry,'written',not rolled_back and call_reason is null,
    'results',results,
    'totals',jsonb_build_object('admitted',t_adm,'existing',t_ex,'refused',t_ref,'would_admit',t_would,'by_reason',by_reason),
    'ocr_route',ocr,
    'batch',jsonb_build_object('state',v_state,'stop_reason',(select stop_reason from public.ingest_batches where id=b.id)) || counts);
end $$;

commit;
analyze public.documents;
analyze public.desk_rows;
