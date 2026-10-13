-- Live figures for the marketing site (open-work F142; docs/specs/2026-10-14-live-site-figures.md).
--
-- public.site_figures() returns the four record counts the public site shows, as one JSON object:
--
--   { "bills": int, "documents": int, "ministries": int, "fronts": int, "as_of": timestamptz }
--
--   bills       rows of the bill desk: desk_rows where tier = 'national' and feature = 'Bill
--               Passage Probability Index'. row_key comes from the bill's id, so rows = distinct
--               bill IDs. Not 'Policy Intelligence Graph', which holds the same rows (never count
--               twice).
--   documents   documents with indexed_at is not null (set last, after the chunks commit; every
--               search RPC filters on it).
--   ministries  distinct normalised row->>'ministry' in the national 'Parliamentary Question
--               Database' desk; null and empty values do not count.
--   fronts      distinct normalised row->>'conflict_name' in the global 'Open Fronts' desk; same.
--   as_of       now(): when the counts were taken.
--
-- Normalisation matches server/homeApi.mjs segmentCounts (so the carousel and the hero agree):
--   String(v || '').replace(/\s+/g, ' ').trim().toLowerCase(), then filter(Boolean).
-- PostgreSQL's \s depends on the database locale, so the whitespace class is spelled out as
-- JavaScript's: space, \t \n \r \f \v, U+00A0, U+1680, U+2000-U+200A, U+2028, U+2029, U+202F,
-- U+205F, U+3000, U+FEFF. Every run becomes one space and the ends are trimmed. Known edges, none
-- of which occurs in the data (ministry and conflict_name are text): lower() follows the database's
-- collation where JavaScript's toLowerCase is locale-free, so exotic case pairs (for example a
-- dotted capital I) may fold differently; and a JSON number or boolean is counted as its text,
-- where JavaScript counts 0 and false as empty.
--
-- Security: SECURITY DEFINER because desk_rows and documents are closed to anon (RLS plus revoke).
-- It returns aggregate counts only, never a row, a key or any text from a row. EXECUTE is granted
-- to service_role only: the public endpoint (GET /api/site-figures) calls it server-side with the
-- secret key and caches the answer; browsers never call it. Empty search_path, every object
-- schema-qualified, STABLE (reads only).
--
-- Down:
--   drop function public.site_figures();

create function public.site_figures()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'bills', (
      select count(*) from public.desk_rows
       where tier = 'national' and feature = 'Bill Passage Probability Index'
    ),
    'documents', (
      select count(*) from public.documents where indexed_at is not null
    ),
    'ministries', (
      select count(distinct k) from (
        select lower(btrim(regexp_replace(row ->> 'ministry',
                 '[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', ' ', 'g'), ' ')) as k
          from public.desk_rows
         where tier = 'national' and feature = 'Parliamentary Question Database'
      ) q where k <> ''
    ),
    'fronts', (
      select count(distinct k) from (
        select lower(btrim(regexp_replace(row ->> 'conflict_name',
                 '[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', ' ', 'g'), ' ')) as k
          from public.desk_rows
         where tier = 'global' and feature = 'Open Fronts'
      ) q where k <> ''
    ),
    'as_of', now()
  );
$$;

revoke all on function public.site_figures() from public, anon, authenticated;
grant execute on function public.site_figures() to service_role;
