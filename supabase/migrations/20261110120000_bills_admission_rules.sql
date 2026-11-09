-- F307 follow-up: the rules of bill_admission_key, from the Bills proof (docs/specs/2026-11-10-bills-admission-rules.md).
--
-- It changes one function, public.bill_admission_key(jsonb), and nothing else:
--   1. A bill's document_key may be either of two keys: the citation key, bill:<citation.bill_year>:<citation.bill_number>
--      (as before), or the listing key, which is how the listing builds its own (billDocumentKey in src/lib/deskRows.js):
--      the year closing citation.bill_name, else the year of citation.introduced_on when that is a valid YYYY-MM-DD date,
--      then citation.bill_number. The whitespace before that year is JavaScript's \s, written out, because Postgres' \s
--      differs (it lacks U+FEFF and has U+0085). ingest_bill_rows is unchanged: it still finds the listing rows by the
--      key and the house, then by the whole normalised name and the 3-day date window.
--   2. The listing key is refused (null, so admission says bill_identity_incomplete) when it differs from the citation key
--      and the listing has a row under the citation key with the same house and the same normalised name: that bill is
--      listed under both keys, and which one is the record's is not for the record to say. This is the one place the
--      function reads a table (desk_rows, by its document_key index), so it is now stable, not immutable.
--   3. The file_url rule "contains .." becomes, on the URL as stored: no control character (U+0000 to U+001F, U+007F), no
--      backslash; and on the part before any ? or #: no %2f or %5c (encoded separators, any case), and no path segment
--      that is . or .. (also percent-encoded, any case), with or without a path parameter (;... or %3b...). A file name
--      with a run of dots (591LS As Int....pdf) is then admitted; a URL parser that strips a tab or a line break, or
--      reads a parameter, can no longer read a different path than the one stored.
-- The signature, language, security definer, search_path and revokes are those of 20261107120000_bills_adapter.sql.
--
-- Depends on 20261107120000_bills_adapter.sql (bill_norm, bill_admission_key, ingest_bill_rows) and on the
-- desk_rows_document_key index of 20260921000011.
--
-- Apply order: first deploy ingest-worker and admin-ingest from the commit that carries the same rules in
-- supabase/functions/_shared/suppliedText.ts (until then the function is looser than the database, which still refuses).
-- Then run this by psql (F283) with the worker paused (cron job 4), in one transaction with its schema_migrations row.
-- A dry run: replace this file's trailing commit; with rollback; (an outer transaction does not work, the file commits
-- itself).
--
-- Rollback, in one transaction: the body of public.bill_admission_key as 20261107120000_bills_adapter.sql created it,
-- written create or replace because that file wrote create function:
--   begin;
--   create or replace function public.bill_admission_key(r jsonb) returns text
--   language sql immutable security definer set search_path = public, extensions, pg_temp as $f$
--    select case
--      when r->>'file_url' ~ '^https://sansad\.in/getFile/(BillsTexts|BillsPDFFiles)/' and r->>'file_url' !~ '\.\.'
--       and n ~ '^([0-9]+|[IVXLCDM]+)$' and y ~ '^[0-9]{4}$'
--       and r#>>'{citation,house}' in ('Lok Sabha','Rajya Sabha')
--       and length(public.bill_norm(r#>>'{citation,bill_name}')) >= 8
--       and r->>'document_role' in ('as_introduced','as_passed_lok_sabha','as_passed_rajya_sabha','as_passed_both_houses',
--                                   'gazette_notification','synopsis','errata')
--       and r->>'document_key' = 'bill:' || y || ':' || n
--      then r->>'document_key' end
--     from (select r#>>'{citation,bill_number}' n, r#>>'{citation,bill_year}' y) f
--   $f$;
--   revoke all on function public.bill_admission_key(jsonb) from public, anon, authenticated, service_role;
--   delete from supabase_migrations.schema_migrations where version = '20261110120000';
--   commit;
-- Bills already admitted under a listing key stay; they are correct under the listing's own rule.

begin;
set local lock_timeout = '10s';

do $$
begin
  if to_regprocedure('public.bill_admission_key(jsonb)') is null or to_regprocedure('public.ingest_bill_rows(text,text,text,text)') is null then
    raise exception 'apply 20261107120000_bills_adapter.sql first';
  end if;
end $$;

create or replace function public.bill_admission_key(r jsonb) returns text
language sql stable security definer set search_path = public, extensions, pg_temp as $$
 select case
   when r->>'file_url' ~ '^https://sansad\.in/getFile/(BillsTexts|BillsPDFFiles)/'
    and r->>'file_url' !~ '[\x01-\x1f\x7f\\]'
    and split_part(split_part(r->>'file_url', '?', 1), '#', 1) !~* '%2f|%5c'
    and split_part(split_part(r->>'file_url', '?', 1), '#', 1) !~* '(^|/)(\.|%2e){1,2}((;|%3b)[^/]*)?(/|$)'
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

commit;
