-- F374 (Tasks 1 and 2): five more National desks admitted search-only, each file link checked against its own desk's
-- hosts. Spec: docs/specs/2026-11-19-five-desk-search-only-route.md, Design point 1 (accepted by the developer as written,
-- 2026-11-19). It extends 20261113090000_national_search_only.sql (spec docs/specs/2026-11-12-regulatory-screen.md,
-- "Admission"), which built the branch for Regulatory alone.
--
-- Purpose. Registration refuses the five desks no_adapter. The search-only desks become six, each named as its documents
-- and the packs spell desk_feature, tier 'national':
--   'Regulatory Body Watch (RBI SEBI TRAI CCI)'               rbidocs.rbi.org.in, www.rbi.org.in, www.sebi.gov.in (as before)
--   'Budget Utilisation & Schemes'                            www.indiabudget.gov.in
--   'Cabinet Decisions'                                       www.pib.gov.in
--   'Bureaucratic Transfers — AGMUT Cadre'  (U+2014 dash)     mha.gov.in
--   'Industry Updates (Ministry Data)'                        www.dpiit.gov.in, eaindustry.nic.in, www.mospi.gov.in, mospi.gov.in
--   'MP Profiles & Performance (MPLAD attendance debates)'    sansad.in
-- The host was one list shared by every search-only desk; it is now checked per desk, so a record of one desk carrying
-- another desk's host is refused file_url_invalid. A record with no file_url stays admissible, as before.
--
-- One definition of which desks are search-only and which hosts each may name: the new helper
--   public.ingest_search_only_desks() returns table(desk_feature text, hosts text[])   immutable, owner-only
-- It reads no table, so it is security invoker (a definer would grant nothing it needs); search_path is set as for its
-- neighbours. ingest_admit_tier, ingest_admit_adapter and the host check read it. Two places cannot: the predicates of
-- the two partial unique indexes and the two "already held" lookups keep a literal list, so that each lookup is proved
-- to use its partial index whatever plan the function caches (as 20261113090000 chose). The self-check at the end of
-- this file refuses to commit unless both index predicates name exactly the helper's desks; the fixture checks the
-- lookups' lists the same way.
--
-- Functions, each CREATE OR REPLACE from its body in 20261113090000_national_search_only.sql, the last file to define it
-- (checked with grep over supabase/migrations: no file after 20261113090000 defines any of them; 20261114090000 to
-- 20261122090000 replace other functions only), changed only as named:
--   ingest_admit_tier      lines 87-99.  The search-only line reads `r->>'desk_feature' in (select desk_feature from
--                          public.ingest_search_only_desks())` in place of the one-desk literal list.
--   ingest_admit_adapter   lines 101-109. The same replacement on its search-only line.
--   ingest_admit_document  lines 111-365. In the search-only branch only: the host alternation
--                          `^https://(rbidocs\.rbi\.org\.in|www\.rbi\.org\.in|www\.sebi\.gov\.in)/` becomes the host
--                          between `^https://` and the first `/`, compared exactly with the record's own desk's hosts
--                          from the helper (no match, or no slash after the host, is file_url_invalid, as before).
--                          Also file_url_invalid, for every search-only desk: a question-answer file
--                          (public.pq_answer_key(file_url) is not null) or a bill file (public.bill_admission_key accepts
--                          the URL inside a fixed well-formed probe record, so the Bills adapter's own URL rule decides; no
--                          regex is copied). sansad.in serves both, and an MP Profiles document holding an answer file
--                          would block that answer's linked admission (the question branch's file_url_held lookup has no
--                          desk filter). The two lookups' literal desk list gains the five desks, and the suggested-key
--                          lookup also reads `<> ''` so that it implies the key index's predicate (admission never
--                          looks up '': it refuses it suggested_key_invalid first). Every other line is unchanged.
-- Not replaced, because they name the adapter, not a desk or a host: ingest_register_batch (locks the suggested key, else
-- the source_key, and the file_url, else the source_key, for adapter national_search_only, whatever its desk) and
-- ingest_register_text_unmapped (refuses adapter national_search_only: one sealed batch is the only way in). The guard
-- below checks that both are byte for byte the bodies 20261113090000 wrote. ingest_policy_approve needs no change: it accepts a desk whose adapter
-- is ingest_admit_adapter's. Law, Parliamentary Questions and Bills take exactly the paths they took before.
--
-- Indexes. documents_search_only_file_url and documents_search_only_key_suggested are dropped and created again over the
-- six desks, now keyed by (desk_feature, value): the lookups refuse a file_url or suggested key held by a document of the
-- SAME desk, so the backstop holds the same rule (for Regulatory alone this is the rule it held before; the host lists
-- are disjoint, so no new admission can carry one file into two desks). The lookups' predicates imply the indexes'.
-- The suggested-key index now excludes '' as well as null: admission never writes '', and an older path's empty keys
-- (two in one desk) must not stop the apply.
--
-- Existing rows (NTER holds about 26,000 documents, among them 1 Budget and 6 Industry documents admitted by an older
-- path, not read for this file). Building a unique index over rows that already share a value fails. Before anything is
-- replaced, the guard below looks for two documents of one of the six desks sharing a file_url or a suggested key and
-- stops the migration naming each desk, the value and its documents' ids, with nothing done. It never deletes or alters
-- a row: such a pair is resolved by a separate reviewed step. A row too large for an index entry would fail the build,
-- which also rolls everything back. Rows of these desks with no file_url, or with no or an empty suggested key, are not
-- constrained and not reported.
--
-- Guards (each stops the migration with nothing done):
--   * bill_admission_key exists and is stable (20261110120000; the URL rule's dependency, as in 20261113090000);
--   * the helper does not exist yet (this file has not been applied);
--   * ingest_admit_tier, ingest_admit_adapter, ingest_admit_document, ingest_register_batch and
--     ingest_register_text_unmapped are byte for byte the bodies 20261113090000 wrote (md5 of prosrc), so nothing changed
--     on the database since is overwritten unseen, and the two not replaced still carry their search-only branches;
--   * the applying role owns the three replaced functions (pg_get_userbyid(proowner) = current_user): a member that is
--     not the owner would create a helper the definer functions, running as their owner, might not be able to execute;
--   * both unique indexes exist with exactly 20261113090000's definitions;
--   * no duplicate among the existing documents of the six desks, as above.
--
-- Privileges are restated exactly as 20261113090000 restated them (from 20261102130000_batch_registration.sql), not
-- widened: the three replaced functions owner-only; the new helper owner-only too (revoked from public, anon,
-- authenticated and service_role, as the migrating role's default privileges would otherwise grant it). Each function
-- keeps its security mode (definer), its search_path (public, extensions, pg_temp) and its volatility.
--
-- Apply, with separate approval (spec Task 5): first deploy ingest-worker and admin-ingest from the commit that carries
-- the same desks and hosts in supabase/functions/_shared/suppliedText.ts, because the worker re-prepares every stored
-- payload and the old code refuses a payload of the five desks. Then pause the worker (cron job 4) and run this by psql
-- (F283; never db push). This file commits itself: the supervisor inserts its history row (version 20261123090000, name
-- national_search_only_five_desks) into supabase_migrations.schema_migrations immediately after it applies.
-- Locks: the function replacements take no lock on documents. The index work comes last, in two steps:
--   1. the two new indexes are built under temporary names (documents_search_only_file_url_f374,
--      documents_search_only_key_suggested_f374): each build takes a SHARE lock on public.documents, held until the
--      commit, so writes wait (the worker is paused) and reads, search included, continue;
--   2. with lock_timeout 2s, the two old indexes are dropped and the new ones renamed into place: DROP INDEX takes an
--      ACCESS EXCLUSIVE lock, held until the commit, so reads wait only for the drops, the renames and the self-check.
--      While that lock is awaited, new readers queue behind it, for at most the 2 s (the app's search limit is 4 s).
-- A lock_timeout failure (55P03) at either step rolls the whole file back, nothing changed; run it again at a quieter
-- moment. lock_timeout bounds the wait to acquire a lock, not a build. The analyze runs after the commit.
--
-- Dry run: replace this file's trailing commit with rollback, and put the checks before it (a record of each new desk
-- admitted with its own host; each refused with another desk's host; a Regulatory record admitted as before; a question
-- and a bill as before), comparing md5(prosrc) of the replaced functions before and after. An outer transaction does not
-- work: the file commits itself.
--
-- Rollback rule: clean only before the first admission of one of the five desks. After one, its documents, jobs and
-- chunks stay until a reviewed step removes them; the restored functions refuse their payloads (no_adapter), and a
-- worker rolled back with such a job queued or running fails it, so the worker rolls back only with none queued or
-- running. Regulatory documents admitted meanwhile are unaffected by the rollback. The two Edge Functions that import
-- supabase/functions/_shared/suppliedText.ts, ingest-worker (supplied-step.ts) and admin-ingest (handler.ts), are
-- redeployed from the commit before this change, after the Down section has run.
--
-- Down, in one transaction (as the migrating role), in the same lock order as the apply:
--   set local lock_timeout = '10s';
--   re-run ingest_admit_tier, ingest_admit_adapter and ingest_admit_document from 20261113090000_national_search_only.sql
--   (lines 87-365), each as written there (CREATE OR REPLACE), so that their grants stay;
--   drop function public.ingest_search_only_desks();
--   re-run the two create unique index statements of 20261113090000 (lines 81-85), each with _f374 appended to its name;
--   set local lock_timeout = '2s';
--   drop index public.documents_search_only_file_url;
--   drop index public.documents_search_only_key_suggested;
--   alter index public.documents_search_only_file_url_f374 rename to documents_search_only_file_url;
--   alter index public.documents_search_only_key_suggested_f374 rename to documents_search_only_key_suggested;
--   delete from supabase_migrations.schema_migrations where version = '20261123090000';
--   commit;
--   analyze public.documents;

begin;

set local lock_timeout = '10s';

do $$
declare
  f record; v text;
begin
  if (select p.provolatile from pg_proc p where p.oid = to_regprocedure('public.bill_admission_key(jsonb)')) is distinct from 's' then
    raise exception 'apply 20261110120000_bills_admission_rules.sql first';
  end if;
  if to_regprocedure('public.ingest_search_only_desks()') is not null then
    raise exception '20261123090000_national_search_only_five_desks.sql is already applied (ingest_search_only_desks exists)'
      using errcode = '55000';
  end if;
  for f in select * from (values
      ('public.ingest_admit_tier(jsonb)', '7a7de46fbba39404771f9d6bfba41a10', true),
      ('public.ingest_admit_adapter(jsonb)', '4090fe6177be52ca6d458c4920018d54', true),
      ('public.ingest_admit_document(jsonb,jsonb)', '3ab8eae647c2843e2c99c746443748fd', true),
      ('public.ingest_register_batch(uuid,jsonb,boolean,boolean)', '1d91963c56bc2893004317f6c2f0b77a', false),
      ('public.ingest_register_text_unmapped(jsonb)', '9a6514f6415c7dffffa0c594c9babfc5', false)) x(fn, h, replaced) loop
    if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure(f.fn)) is distinct from f.h then
      raise exception '% is not the body 20261113090000_national_search_only.sql wrote; compare it before applying', f.fn
        using errcode = '55000';
    end if;
    if f.replaced and (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = to_regprocedure(f.fn)) is distinct from current_user then
      raise exception '% is owned by %, not by the applying role %; apply as its owner', f.fn,
        (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = to_regprocedure(f.fn)), current_user
        using errcode = '42501';
    end if;
  end loop;
  if (select pg_get_indexdef(to_regclass('public.documents_search_only_file_url'))) is distinct from
       'CREATE UNIQUE INDEX documents_search_only_file_url ON public.documents USING btree (file_url) WHERE ((desk_tier = ''national''::text) AND (desk_feature = ''Regulatory Body Watch (RBI SEBI TRAI CCI)''::text) AND (file_url IS NOT NULL))'
     or (select pg_get_indexdef(to_regclass('public.documents_search_only_key_suggested'))) is distinct from
       'CREATE UNIQUE INDEX documents_search_only_key_suggested ON public.documents USING btree (((metadata ->> ''document_key_suggested''::text))) WHERE ((desk_tier = ''national''::text) AND (desk_feature = ''Regulatory Body Watch (RBI SEBI TRAI CCI)''::text) AND ((metadata ->> ''document_key_suggested''::text) IS NOT NULL))' then
    raise exception 'the two unique indexes of 20261113090000_national_search_only.sql are missing or differ'
      using errcode = '55000';
  end if;
  -- Existing documents that the widened unique indexes could not hold: refuse by name, change nothing.
  select string_agg(format('%s %s %s: %s', k.desk_feature, k.what, left(k.value, 300), k.ids), '; ' order by k.desk_feature, k.what, k.value)
    into v
    from (select d.desk_feature, 'file_url' what, d.file_url value, string_agg(d.id::text, ', ' order by d.id) ids
            from public.documents d
           where d.desk_tier = 'national' and d.file_url is not null
             and d.desk_feature in ('Regulatory Body Watch (RBI SEBI TRAI CCI)', 'Budget Utilisation & Schemes', 'Cabinet Decisions',
               'Bureaucratic Transfers — AGMUT Cadre', 'Industry Updates (Ministry Data)', 'MP Profiles & Performance (MPLAD attendance debates)')
           group by d.desk_feature, d.file_url having count(*) > 1
          union all
          select d.desk_feature, 'document_key_suggested', d.metadata->>'document_key_suggested', string_agg(d.id::text, ', ' order by d.id)
            from public.documents d
           where d.desk_tier = 'national' and d.metadata->>'document_key_suggested' <> ''
             and d.desk_feature in ('Regulatory Body Watch (RBI SEBI TRAI CCI)', 'Budget Utilisation & Schemes', 'Cabinet Decisions',
               'Bureaucratic Transfers — AGMUT Cadre', 'Industry Updates (Ministry Data)', 'MP Profiles & Performance (MPLAD attendance debates)')
           group by d.desk_feature, d.metadata->>'document_key_suggested' having count(*) > 1) k;
  if v is not null then
    raise exception 'documents of one search-only desk share a value the unique indexes would hold; resolve them by a reviewed step before applying, nothing was changed: %', v
      using errcode = '23505';
  end if;
end $$;

-- The search-only desks and the hosts each one's file_url may name, exactly (supabase/functions/_shared/suppliedText.ts
-- holds the same table).
create function public.ingest_search_only_desks() returns table(desk_feature text, hosts text[])
language sql immutable set search_path = public, extensions, pg_temp as $$
 select v.desk_feature, v.hosts from (values
   ('Regulatory Body Watch (RBI SEBI TRAI CCI)', array['rbidocs.rbi.org.in', 'www.rbi.org.in', 'www.sebi.gov.in']),
   ('Budget Utilisation & Schemes', array['www.indiabudget.gov.in']),
   ('Cabinet Decisions', array['www.pib.gov.in']),
   ('Bureaucratic Transfers — AGMUT Cadre', array['mha.gov.in']),
   ('Industry Updates (Ministry Data)', array['www.dpiit.gov.in', 'eaindustry.nic.in', 'www.mospi.gov.in', 'mospi.gov.in']),
   ('MP Profiles & Performance (MPLAD attendance debates)', array['sansad.in'])
 ) v(desk_feature, hosts)
$$;

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
     and r->>'desk_feature' in (select desk_feature from public.ingest_search_only_desks()) then 'national'
 end
$$;

create or replace function public.ingest_admit_adapter(r jsonb) returns text
language sql immutable security definer set search_path = public, extensions, pg_temp as $$
 select case
   when r->>'desk_tier' = 'law' then 'law'
   when r->>'desk_tier' = 'national' and r->>'desk_feature' = 'Parliamentary Question Database' then 'lok_sabha_answers'
   when r->>'desk_tier' = 'national' and r->>'desk_feature' = 'Bill Passage Probability Index' then 'national_bills'
   when r->>'desk_tier' = 'national' and r->>'desk_feature' in (select desk_feature from public.ingest_search_only_desks()) then 'national_search_only'
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
         and exists(select 1 from public.ingest_search_only_desks() s where s.desk_feature = r->>'desk_feature'
                       and substring(r->>'file_url' from '^https://([^/]*)/') = any(s.hosts))
         -- Not a file a linked adapter owns: a question answer, or a bill file as the Bills adapter's URL rule reads it.
         and public.pq_answer_key(r->>'file_url') is null
         and public.bill_admission_key(jsonb_build_object('file_url', r->>'file_url', 'document_role', 'synopsis',
               'document_key', 'bill:2000:1', 'citation', jsonb_build_object('bill_number', '1', 'bill_year', '2000',
               'house', 'Lok Sabha', 'bill_name', 'Search-only probe bill, 2000'))) is null
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
           and x.desk_feature in ('Regulatory Body Watch (RBI SEBI TRAI CCI)', 'Budget Utilisation & Schemes', 'Cabinet Decisions',
             'Bureaucratic Transfers — AGMUT Cadre', 'Industry Updates (Ministry Data)', 'MP Profiles & Performance (MPLAD attendance debates)')
           and x.file_url = r->>'file_url'
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
           and x.desk_feature in ('Regulatory Body Watch (RBI SEBI TRAI CCI)', 'Budget Utilisation & Schemes', 'Cabinet Decisions',
             'Bureaucratic Transfers — AGMUT Cadre', 'Industry Updates (Ministry Data)', 'MP Profiles & Performance (MPLAD attendance debates)')
           and x.metadata->>'document_key_suggested' <> '' and x.metadata->>'document_key_suggested' = r->>'document_key_suggested'
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

-- Privileges as 20261113090000 restated them (CREATE OR REPLACE keeps them; restated, not widened): the helpers owner-only.
-- The new helper is revoked from the same roles, since the migrating role's default privileges would grant it.
revoke all on function
  public.ingest_search_only_desks(), public.ingest_admit_tier(jsonb), public.ingest_admit_adapter(jsonb),
  public.ingest_admit_document(jsonb, jsonb)
  from public, anon, authenticated, service_role;

-- Unique, so that two concurrent runs cannot both admit one file, or one suggested key, to a desk: the lookups refuse by
-- name, and these hold if a race gets past them. Step 1: build the new indexes under temporary names (SHARE lock: writes
-- wait, reads continue).
create unique index documents_search_only_file_url_f374 on public.documents (desk_feature, file_url)
  where desk_tier = 'national' and desk_feature in ('Regulatory Body Watch (RBI SEBI TRAI CCI)', 'Budget Utilisation & Schemes',
    'Cabinet Decisions', 'Bureaucratic Transfers — AGMUT Cadre', 'Industry Updates (Ministry Data)',
    'MP Profiles & Performance (MPLAD attendance debates)') and file_url is not null;
create unique index documents_search_only_key_suggested_f374 on public.documents (desk_feature, (metadata->>'document_key_suggested'))
  where desk_tier = 'national' and desk_feature in ('Regulatory Body Watch (RBI SEBI TRAI CCI)', 'Budget Utilisation & Schemes',
    'Cabinet Decisions', 'Bureaucratic Transfers — AGMUT Cadre', 'Industry Updates (Ministry Data)',
    'MP Profiles & Performance (MPLAD attendance debates)') and metadata->>'document_key_suggested' <> '';

-- Step 2: swap them in. DROP INDEX takes ACCESS EXCLUSIVE on documents until the commit; only the drops, the renames and
-- the self-check follow it. A wait over 2 s fails the file, which rolls back whole.
set local lock_timeout = '2s';
drop index public.documents_search_only_file_url;
drop index public.documents_search_only_key_suggested;
alter index public.documents_search_only_file_url_f374 rename to documents_search_only_file_url;
alter index public.documents_search_only_key_suggested_f374 rename to documents_search_only_key_suggested;

-- Self-check: each index predicate names exactly the helper's desks (the literal lists cannot read the helper), and a
-- definer function can execute the new helper.
do $$
declare want text[] := array(select s.desk_feature from public.ingest_search_only_desks() s order by 1); got text[]; ix text;
begin
  foreach ix in array array['public.documents_search_only_file_url', 'public.documents_search_only_key_suggested'] loop
    -- The predicate reads ... desk_feature = ANY (ARRAY['...'::text, ...]) ...: the names inside the one ARRAY.
    got := array(select m[1] from regexp_matches(substring(pg_get_expr((select i.indpred from pg_index i where i.indexrelid = ix::regclass),
                   'public.documents'::regclass) from 'ARRAY\[([^]]*)\]'), '''([^'']*)''::text', 'g') m order by 1);
    if got is distinct from want then
      raise exception '% lists % but the helper lists %', ix, got, want using errcode = '55000';
    end if;
  end loop;
  if public.ingest_admit_adapter('{"desk_tier":"national","desk_feature":"Cabinet Decisions"}') is distinct from 'national_search_only' then
    raise exception 'ingest_admit_adapter does not admit a search-only desk after the apply' using errcode = '55000';
  end if;
end $$;

commit;
analyze public.documents;
