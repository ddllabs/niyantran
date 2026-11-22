-- F372: the pack's Bill corrigenda enter the Bills desk without a file link. Spec: docs/specs/2026-11-21-bill-corrigenda-route.md.
--
-- NOT APPLIED. Applying it needs the developer's specific yes, after a rolled-back dry run (see "Apply").
--
-- The 365 corrigenda of National v1.1 (doc_type bill_corrigendum) have no file link (file_url is null for all of them),
-- and the Bills adapter admits only a bill with an official sansad.in file. Its identity rule is
-- public.bill_admission_key(jsonb); the link written for each listing row (record_document_links.source_url) is
-- NOT NULL. This file makes two changes, and only these:
--   1. public.bill_admission_key: the file_url clause is now "an official sansad.in file, as before, OR no file_url at all
--      on a record whose document_role is errata and whose doc_type is bill_corrigendum". Every other clause (number,
--      year, house, name, role, key, the listing key's ambiguity guard) is as 20261110120000 wrote it, character for
--      character; the signature, language, volatility (stable), security definer, search_path and revokes are as it left
--      them. A given file_url, empty or not, is still held to the official rule: the second branch needs it to be null.
--   2. public.record_document_links.source_url may be null, and only on an errata link: the column loses NOT NULL and a
--      check (record_links_source_url_errata) says "source_url is not null, or the link is the Bills
--      desk's errata (role = 'errata' and feature = 'Bill Passage Probability Index')". The admission writes the
--      link with doc.file_url, which is null for these documents. The Bills resolver (record_resolve_document_keys, bill
--      branch, 20261110180000) matches a bill's documents by metadata->>'document_key' and never reads the link's
--      source_url, so a corrigendum shows on its bill's row as any other document of the bill does; the other branch
--      compares source_url with the document's file_url and treats a null as no match, which no errata link reaches.
-- ingest_admit_document is not replaced: its Bills branch reads the key from bill_admission_key, finds the file by
-- file_url (a null matches nothing: `x.file_url = null`), and holds no role for errata (bill_role_held excludes it), so a
-- corrigendum is refused only for what any bill is refused for (no_desk_row, bill_identity_mismatch, duplicate_text).
-- The unique index documents_bill_file_url ignores nulls. ingest_register_batch locks `coalesce(file_url, source_key)`.
--
-- Depends on 20261110120000_bills_admission_rules.sql (the body this replaces; the guard below compares its md5) and
-- 20261027185747_record_document_associations.sql (the table). It does not depend on the five-desk migration.
--
-- Apply, with separate approval, in this order:
--   1. Deploy ingest-worker and admin-ingest from the commit that carries the same rule in
--      supabase/functions/_shared/suppliedText.ts. The worker re-prepares every stored payload with that file, and the old
--      code refuses a bill without a sansad.in file_url.
--   2. Pause the worker (cron job 4), then run this file by psql (F283; never db push). It commits itself: the supervisor
--      inserts its history row (version 20261125090000, name bill_corrigenda_route) into supabase_migrations.schema_migrations
--      immediately after it applies.
--   Dry run: replace the trailing commit with rollback, and before it admit one fixture corrigendum and one bill with no
--   file_url (the first admitted, the second refused bill_identity_incomplete), comparing md5(prosrc) of
--   bill_admission_key before and after. An outer transaction does not work: the file commits itself.
-- Locks: ALTER TABLE ... DROP NOT NULL and ADD CONSTRAINT take an ACCESS EXCLUSIVE lock on record_document_links until the
-- commit (lock_timeout 10 s below; the table is read by the resolver, and the add is a scan of its rows).
--
-- A hand-restored rollback body will not match the md5 guard, by design: re-applying this file after one fails closed.
--
-- Rollback, in one transaction, clean only before the first corrigendum is admitted. After that the corrigenda's documents,
-- jobs and links stay until a reviewed step removes them (the restored function would refuse their payloads and the
-- NOT NULL cannot return while their links are null):
--   begin;
--   set local lock_timeout = '10s';
--   alter table public.record_document_links drop constraint record_links_source_url_errata;
--   alter table public.record_document_links alter column source_url set not null;
--   create or replace function public.bill_admission_key(r jsonb) returns text
--   language sql stable security definer set search_path = public, extensions, pg_temp as $f$
--    select case
--      when r->>'file_url' ~ '^https://sansad\.in/getFile/(BillsTexts|BillsPDFFiles)/'
--       and r->>'file_url' !~ '[\x01-\x1f\x7f\\]'
--       and split_part(split_part(r->>'file_url', '?', 1), '#', 1) !~* '%2f|%5c'
--       and split_part(split_part(r->>'file_url', '?', 1), '#', 1) !~* '(^|/)(\.|%2e){1,2}((;|%3b)[^/]*)?(/|$)'
--       and n ~ '^([0-9]+|[IVXLCDM]+)$' and y ~ '^[0-9]{4}$'
--       and r#>>'{citation,house}' in ('Lok Sabha','Rajya Sabha')
--       and length(public.bill_norm(r#>>'{citation,bill_name}')) >= 8
--       and r->>'document_role' in ('as_introduced','as_passed_lok_sabha','as_passed_rajya_sabha','as_passed_both_houses',
--                                   'gazette_notification','synopsis','errata')
--       and r->>'document_key' in ('bill:' || y || ':' || n, 'bill:' || ly || ':' || n)
--       and not (r->>'document_key' = 'bill:' || ly || ':' || n and r->>'document_key' <> 'bill:' || y || ':' || n
--                and exists (select 1 from public.desk_rows q
--                             where q.tier = 'national' and q.feature = 'Bill Passage Probability Index'
--                               and q.document_key = 'bill:' || y || ':' || n
--                               and q.row->>'house' = r#>>'{citation,house}'
--                               and public.bill_norm(q.row->>'bill_name') = public.bill_norm(r#>>'{citation,bill_name}')))
--      then r->>'document_key' end
--     from (select r#>>'{citation,bill_number}' n, r#>>'{citation,bill_year}' y,
--                  coalesce(substring(r#>>'{citation,bill_name}' from
--                             E',[\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]*([0-9]{4})[\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]*\\.?[\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]*$'),
--                           case when r#>>'{citation,introduced_on}' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
--                                 and pg_input_is_valid(r#>>'{citation,introduced_on}', 'date')
--                                then left(r#>>'{citation,introduced_on}', 4) end) ly) f
--   $f$;
--   revoke all on function public.bill_admission_key(jsonb) from public, anon, authenticated, service_role;
--   delete from supabase_migrations.schema_migrations where version = '20261125090000';
--   commit;
-- and redeploy ingest-worker and admin-ingest from the commit before this change.

begin;
set local lock_timeout = '10s';

do $$
begin
  if to_regprocedure('public.bill_admission_key(jsonb)') is null or to_regprocedure('public.ingest_bill_rows(text,text,text,text)') is null then
    raise exception 'apply 20261110120000_bills_admission_rules.sql first' using errcode = '55000';
  end if;
  if (select p.provolatile from pg_proc p where p.oid = to_regprocedure('public.bill_admission_key(jsonb)')) is distinct from 's' then
    raise exception 'apply 20261110120000_bills_admission_rules.sql first (bill_admission_key is not stable)' using errcode = '55000';
  end if;
  -- Nothing changed on the database since 20261110120000 is overwritten unseen: its body, byte for byte.
  if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.bill_admission_key(jsonb)'))
       is distinct from '8f2b1173d26cc8a4d2ece9426a9cce77' then
    raise exception 'public.bill_admission_key is not the body 20261110120000_bills_admission_rules.sql wrote; compare it before applying'
      using errcode = '55000';
  end if;
  if (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = to_regprocedure('public.bill_admission_key(jsonb)'))
       is distinct from current_user then
    raise exception 'public.bill_admission_key is not owned by the applying role %; apply as its owner', current_user
      using errcode = '42501';
  end if;
  if exists (select 1 from pg_constraint where conname = 'record_links_source_url_errata') then
    raise exception '20261125090000_bill_corrigenda_route.sql is already applied (record_links_source_url_errata exists)'
      using errcode = '55000';
  end if;
  if (select a.attnotnull from pg_attribute a where a.attrelid = 'public.record_document_links'::regclass and a.attname = 'source_url')
       is distinct from true then
    raise exception 'record_document_links.source_url is already nullable; compare the table before applying' using errcode = '55000';
  end if;
end $$;

create or replace function public.bill_admission_key(r jsonb) returns text
language sql stable security definer set search_path = public, extensions, pg_temp as $$
 select case
   when (
     (r->>'file_url' ~ '^https://sansad\.in/getFile/(BillsTexts|BillsPDFFiles)/'
      and r->>'file_url' !~ '[\x01-\x1f\x7f\\]'
      and split_part(split_part(r->>'file_url', '?', 1), '#', 1) !~* '%2f|%5c'
      and split_part(split_part(r->>'file_url', '?', 1), '#', 1) !~* '(^|/)(\.|%2e){1,2}((;|%3b)[^/]*)?(/|$)')
     or (r->>'file_url' is null and r->>'document_role' = 'errata' and r->>'doc_type' = 'bill_corrigendum'))
    and n ~ '^([0-9]+|[IVXLCDM]+)$' and y ~ '^[0-9]{4}$'
    and r#>>'{citation,house}' in ('Lok Sabha','Rajya Sabha')
    and length(public.bill_norm(r#>>'{citation,bill_name}')) >= 8
    and r->>'document_role' in ('as_introduced','as_passed_lok_sabha','as_passed_rajya_sabha','as_passed_both_houses',
                                'gazette_notification','synopsis','errata')
    and r->>'document_key' in ('bill:' || y || ':' || n, 'bill:' || ly || ':' || n)
    and not (r->>'document_key' = 'bill:' || ly || ':' || n and r->>'document_key' <> 'bill:' || y || ':' || n
             and exists (select 1 from public.desk_rows q
                          where q.tier = 'national' and q.feature = 'Bill Passage Probability Index'
                            and q.document_key = 'bill:' || y || ':' || n
                            and q.row->>'house' = r#>>'{citation,house}'
                            and public.bill_norm(q.row->>'bill_name') = public.bill_norm(r#>>'{citation,bill_name}')))
   then r->>'document_key' end
  from (select r#>>'{citation,bill_number}' n, r#>>'{citation,bill_year}' y,
               coalesce(substring(r#>>'{citation,bill_name}' from
                          E',[\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]*([0-9]{4})[\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]*\\.?[\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]*$'),
                        case when r#>>'{citation,introduced_on}' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                              and pg_input_is_valid(r#>>'{citation,introduced_on}', 'date')
                             then left(r#>>'{citation,introduced_on}', 4) end) ly) f
$$;
revoke all on function public.bill_admission_key(jsonb) from public, anon, authenticated, service_role;

alter table public.record_document_links alter column source_url drop not null;
alter table public.record_document_links add constraint record_links_source_url_errata
  check (source_url is not null or (role = 'errata' and feature = 'Bill Passage Probability Index'));

-- Self-check: the function is the new one, still owner-only, stable and definer; the constraint is in place.
do $$
begin
  if (select p.provolatile from pg_proc p where p.oid = to_regprocedure('public.bill_admission_key(jsonb)')) is distinct from 's'
     or not (select p.prosecdef from pg_proc p where p.oid = to_regprocedure('public.bill_admission_key(jsonb)'))
     or has_function_privilege('anon', 'public.bill_admission_key(jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.bill_admission_key(jsonb)', 'execute')
     or has_function_privilege('service_role', 'public.bill_admission_key(jsonb)', 'execute') then
    raise exception 'bill_corrigenda_route: bill_admission_key lost its mode or its privileges';
  end if;
  if public.bill_admission_key(jsonb_build_object('file_url', null, 'document_role', 'errata', 'doc_type', 'bill_corrigendum',
       'document_key', 'bill:2025:1', 'citation', jsonb_build_object('bill_number', '1', 'bill_year', '2025', 'house', 'Lok Sabha',
       'bill_name', 'The Fixture Measure Number 1 Bill, 2025'))) is distinct from 'bill:2025:1' then
    raise exception 'bill_corrigenda_route: a corrigendum with no file link is not admitted by bill_admission_key';
  end if;
  if public.bill_admission_key(jsonb_build_object('file_url', null, 'document_role', 'as_introduced', 'doc_type', 'bill_corrigendum',
       'document_key', 'bill:2025:1', 'citation', jsonb_build_object('bill_number', '1', 'bill_year', '2025', 'house', 'Lok Sabha',
       'bill_name', 'The Fixture Measure Number 1 Bill, 2025'))) is not null then
    raise exception 'bill_corrigenda_route: a bill with no file link is admitted by bill_admission_key';
  end if;
end $$;

commit;
