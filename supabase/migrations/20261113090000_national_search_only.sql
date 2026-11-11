-- F307 (T2): National desks admitted search-only, Regulatory first. Spec: docs/specs/2026-11-12-regulatory-screen.md,
-- "Admission"; decided 2026-11-12: D1 (ii) the density-only basis, D2 search-only for the linked records, D3 refuse a
-- suggested key already live.
--
-- Purpose. No supplied-text or batch path admitted a Regulatory document: the tier and the adapter were null, so a
-- batch refused it no_adapter. This adds one search-only branch, for the desks in one list (today only Regulatory, in
-- the spelling its documents and chunks use, 'Regulatory Body Watch (RBI SEBI TRAI CCI)'; the listing's slash spelling
-- is not admitted). A search-only document is stored, chunked into its feature's partition and found by search in its
-- feature; it gets no record_document_links row. Identity is the pack's 40-hex source_key.
--
-- Each function below is CREATE OR REPLACE from its body in 20261107120000_bills_adapter.sql, the last file to define
-- it (20261110120000 and 20261112090000 replaced other functions only), with one added branch:
--   ingest_admit_tier              'national' for a 40-hex source_key on a search-only desk.
--   ingest_admit_adapter           'national_search_only' for those desks.
--   ingest_admit_document          the search-only branch, after the policy gates and before duplicate text:
--                                  completeness_basis_missing unless completeness_basis is page_check or density_only;
--                                  file_url_invalid unless a present file_url is at most 2,000 UTF-8 bytes, https on a
--                                  configured host (rbidocs.rbi.org.in, www.rbi.org.in, www.sebi.gov.in) and passes the
--                                  segment rule of bill_admission_key; suggested_key_invalid unless a present (not JSON
--                                  null) document_key_suggested is a JSON string, non-blank after trimming, of at most
--                                  500 UTF-8 bytes (no index row can then be too large, so no value fails a whole call);
--                                  file_url_held when a document of the feature holds the file_url; suggested_key_held
--                                  when one has the same metadata document_key_suggested. The link
--                                  insert stays limited to the two linked adapters. completeness_basis is stored in
--                                  metadata with the rest of the payload.
--   ingest_register_batch          locks the suggested key (else the source_key) and the file_url (else the source_key)
--                                  for this adapter, in the namespace Bills' keys use.
--   ingest_register_text_unmapped  refuses this adapter, as it refuses Bills: one sealed batch is the only way in.
-- ingest_policy_approve needs no change: it accepts a desk whose adapter is ingest_admit_adapter's. Privileges are
-- restated below exactly as 20261102130000_batch_registration.sql set them (lines 628, 1358-1373), not widened.
-- Law, Parliamentary Questions and Bills take exactly the paths they took before.
--
-- Depends on 20261110120000_bills_admission_rules.sql: the guard refuses to run unless its bill_admission_key exists
-- and is stable.
--
-- Backstops: the unique indexes documents_search_only_file_url and documents_search_only_key_suggested. The lookups
-- refuse by name (file_url_held, suggested_key_held) under the registration locks; a unique violation on either index
-- means a race got past both, and it fails that call, which admits nothing.
--
-- Apply, with separate approval (spec T7): first deploy ingest-worker and admin-ingest from the commit that carries
-- the same rules in supabase/functions/_shared/suppliedText.ts, because the worker re-prepares every stored payload
-- and the old code refuses a search-only one. Then pause the worker (cron job 4) and run this by psql (F283). This
-- file commits itself: the supervisor inserts its history row (version 20261113090000, name national_search_only)
-- into supabase_migrations.schema_migrations immediately after it applies. The two unique-index builds take a SHARE
-- lock on documents held until the commit: writers wait for it, and lock_timeout bounds only the wait to acquire the
-- lock, not the build, so the apply is done with the worker paused. The analyze runs after the commit. A duplicate
-- file_url or suggested key among the desk's live documents stops it with nothing done (none of the 474 live
-- Regulatory documents carries a suggested key, measured read-only 2026-11-12).
--
-- Dry run: replace this file's trailing commit with rollback, and put the checks before it (a Regulatory record
-- admitted with no link and its basis stored; each new refusal; a question and a bill as before; the single-document
-- path refusing Regulatory). An outer transaction does not work: the file commits itself.
--
-- Rollback rule: clean only before the first search-only admission. After one, the admitted documents, their jobs and
-- chunks stay until a reviewed step removes them; the restored functions refuse their payloads (no_adapter), and a
-- worker rolled back with a search-only job queued or running fails it (the old adapter refuses its payload), so the
-- worker rolls back only with none queued or running.
--
-- Down, in one transaction (as the migrating role):
--   re-run ingest_admit_tier, ingest_admit_adapter, ingest_admit_document, ingest_register_text_unmapped and
--   ingest_register_batch from 20261107120000_bills_adapter.sql, each as written there (CREATE OR REPLACE), so that
--   their grants stay;
--   drop index public.documents_search_only_file_url;            (unique, on file_url)
--   drop index public.documents_search_only_key_suggested;       (unique, on metadata->>'document_key_suggested')
--   delete from supabase_migrations.schema_migrations where version = '20261113090000';

begin;

do $$
begin
  if (select p.provolatile from pg_proc p where p.oid = to_regprocedure('public.bill_admission_key(jsonb)')) is distinct from 's' then
    raise exception 'apply 20261110120000_bills_admission_rules.sql first';
  end if;
end $$;

set local lock_timeout = '10s';

-- Unique, so that two concurrent runs cannot both admit one file, or one suggested key, to a desk: the lookups refuse
-- by name, and these hold if a race gets past them. The suggested-key index also serves suggested_key_held
-- (documents_pq_key_suggested, 20261106120000, is partial to Parliamentary Questions).
create unique index documents_search_only_file_url on public.documents (file_url)
  where desk_tier = 'national' and desk_feature in ('Regulatory Body Watch (RBI SEBI TRAI CCI)') and file_url is not null;
create unique index documents_search_only_key_suggested on public.documents ((metadata->>'document_key_suggested'))
  where desk_tier = 'national' and desk_feature in ('Regulatory Body Watch (RBI SEBI TRAI CCI)')
    and metadata->>'document_key_suggested' is not null;

create or replace function public.ingest_admit_tier(r jsonb) returns text
language sql immutable security definer set search_path = public, extensions, pg_temp as $$
 select case
   when coalesce(r->>'source_key','') like 'law:%' and r->>'desk_tier' = 'law' then 'law'
   when coalesce(r->>'source_key','') ~ '^[0-9a-f]{40}$' and r->>'desk_tier' = 'national'
     and r->>'desk_feature' = 'Parliamentary Question Database'
     and public.pq_answer_key(r->>'file_url') is not null then 'national'
   when coalesce(r->>'source_key','') ~ '^[0-9a-f]{40}$' and r->>'desk_tier' = 'national'
     and r->>'desk_feature' = 'Bill Passage Probability Index' then 'national'
   when coalesce(r->>'source_key','') ~ '^[0-9a-f]{40}$' and r->>'desk_tier' = 'national'
     and r->>'desk_feature' in ('Regulatory Body Watch (RBI SEBI TRAI CCI)') then 'national'
 end
$$;

create or replace function public.ingest_admit_adapter(r jsonb) returns text
language sql immutable security definer set search_path = public, extensions, pg_temp as $$
 select case
   when r->>'desk_tier' = 'law' then 'law'
   when r->>'desk_tier' = 'national' and r->>'desk_feature' = 'Parliamentary Question Database' then 'lok_sabha_answers'
   when r->>'desk_tier' = 'national' and r->>'desk_feature' = 'Bill Passage Probability Index' then 'national_bills'
   when r->>'desk_tier' = 'national' and r->>'desk_feature' in ('Regulatory Body Watch (RBI SEBI TRAI CCI)') then 'national_search_only'
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
         and x.metadata->>'document_key' = v_key
         and coalesce(x.metadata->>'house', r#>>'{citation,house}') = r#>>'{citation,house}'
         and x.metadata->>'document_role' = v_link_role and v_link_role <> 'errata'
    )
    select m.id, m.source_key into holder from m order by m.id limit 1;
    if found then
      return jsonb_build_object('outcome','refused','reason','bill_role_held',
        'detail',jsonb_build_object('holder_document_id',holder.id,'holder_source_key',holder.source_key));
    end if;
    v := public.ingest_bill_rows(v_key, r#>>'{citation,house}', r#>>'{citation,bill_name}', r#>>'{citation,introduced_on}');
    if (v->>'candidates')::int = 0 then return jsonb_build_object('outcome','refused','reason','no_desk_row'); end if;
    v_rows := array(select jsonb_array_elements_text(v->'rows'));
    if cardinality(v_rows) = 0 then
      return jsonb_build_object('outcome','refused','reason','bill_identity_mismatch','detail',jsonb_build_object('candidates',v->'candidates'));
    end if;
    n := cardinality(v_rows);
  elsif v_adapter = 'national_search_only' then
    -- F307: identity is the pack's source_key. Nothing links (the link insert below names the two linked adapters),
    -- so what this branch guards is what the text rests on and what a reader is sent to.
    if coalesce(r->>'completeness_basis', '') not in ('page_check', 'density_only') then
      return jsonb_build_object('outcome','refused','reason','completeness_basis_missing',
        'detail',jsonb_build_object('completeness_basis',r->'completeness_basis'));
    end if;
    -- A file_url is a configured host's https file, readable as stored: the rule of bill_admission_key (20261110120000).
    -- At most 2,000 UTF-8 bytes, so an index row can always hold it (a longer one failed the whole call at insert).
    if r->>'file_url' is not null and not (
         octet_length(r->>'file_url') <= 2000
         and r->>'file_url' ~ '^https://(rbidocs\.rbi\.org\.in|www\.rbi\.org\.in|www\.sebi\.gov\.in)/'
         and r->>'file_url' !~ '[\x01-\x1f\x7f\\]'
         and split_part(split_part(r->>'file_url', '?', 1), '#', 1) !~* '%2f|%5c'
         and split_part(split_part(r->>'file_url', '?', 1), '#', 1) !~* '(^|/)(\.|%2e){1,2}((;|%3b)[^/]*)?(/|$)') then
      return jsonb_build_object('outcome','refused','reason','file_url_invalid','detail',jsonb_build_object('file_url',left(r->>'file_url',300)));
    end if;
    -- Absent or JSON null is no key. Else a JSON string (5 is not "5"), non-blank after trimming JavaScript's whitespace
    -- (the adapter's trim()), of at most 500 UTF-8 bytes; anything else is refused, never looked up.
    if coalesce(jsonb_typeof(r->'document_key_suggested'), 'null') <> 'null' and (
         jsonb_typeof(r->'document_key_suggested') <> 'string'
         or r->>'document_key_suggested' !~ E'[^\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]'
         or octet_length(r->>'document_key_suggested') > 500) then
      return jsonb_build_object('outcome','refused','reason','suggested_key_invalid');
    end if;
    -- The literal desk list lets each lookup use its partial index whatever plan the function caches.
    if r->>'file_url' is not null then
      with m as materialized (
        select x.id, x.source_key from public.documents x
         where x.desk_tier='national' and x.desk_feature = r->>'desk_feature'
           and x.desk_feature in ('Regulatory Body Watch (RBI SEBI TRAI CCI)') and x.file_url = r->>'file_url'
      )
      select m.id, m.source_key into holder from m order by m.id limit 1;
      if found then
        return jsonb_build_object('outcome','refused','reason','file_url_held',
          'detail',jsonb_build_object('holder_document_id',holder.id,'holder_source_key',holder.source_key));
      end if;
    end if;
    if r->>'document_key_suggested' is not null then
      with m as materialized (
        select x.id, x.source_key from public.documents x
         where x.desk_tier='national' and x.desk_feature = r->>'desk_feature'
           and x.desk_feature in ('Regulatory Body Watch (RBI SEBI TRAI CCI)')
           and x.metadata->>'document_key_suggested' = r->>'document_key_suggested'
      )
      select m.id, m.source_key into holder from m order by m.id limit 1;
      if found then
        return jsonb_build_object('outcome','refused','reason','suggested_key_held',
          'detail',jsonb_build_object('holder_document_id',holder.id,'holder_source_key',holder.source_key));
      end if;
    end if;
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
  if public.ingest_admit_adapter(r) = 'national_search_only' then
    raise exception 'supplied text: search-only documents enter through a sealed batch';
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
    if adapter = 'national_search_only' then
      v_answers := v_answers || coalesce(r->>'document_key_suggested', sk) || coalesce(r->>'file_url', sk);
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

-- Privileges as 20261102130000_batch_registration.sql set them (CREATE OR REPLACE keeps them; restated, not widened):
-- the helpers and the single-document path owner-only, the batch call for corpus_ingest and service_role.
revoke all on function
  public.ingest_admit_tier(jsonb), public.ingest_admit_adapter(jsonb), public.ingest_admit_document(jsonb, jsonb),
  public.ingest_register_text_unmapped(jsonb), public.ingest_register_batch(uuid, jsonb, boolean, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.ingest_register_batch(uuid, jsonb, boolean, boolean) to corpus_ingest, service_role;

commit;
analyze public.documents;
