-- Search folding parity with the citation viewer (docs/specs/2026-10-02-viewer-f50.md, item 1).
--
-- Migration 42 folded only what PostgreSQL's \s matches, which under en_US.utf8 is not a no-break
-- space (U+00A0) or an em space (U+2003), and it did not normalise. The client folds every space
-- JavaScript's \s matches and applies NFC, so a page could show a match the database never listed
-- (or the reverse): text with a no-break space, or क़ stored precomposed (U+0958, which NFC writes
-- as U+0915 U+093C).
--
-- Now both sides fold alike: NFC first, then that full set of spaces and the Markdown marks
-- (# * _ | `) as one space. The column's expression is set in place (PostgreSQL 17), which
-- rewrites document_pages; the function is replaced with its signature, owner, grants and
-- security settings unchanged.
--
-- Down: set the column's expression back, and re-run the create function, from
-- 20261002120000_search_document_pages.sql.
alter table public.document_pages
  alter column search_text set expression as (
    btrim(regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(normalize(text, NFC), '!\[[^\]]*\]\([^)]*\)', ' ', 'g'),
          '\[([^\]]*)\]\([^)]*\)', '\1', 'g'),
        '<[^>]+>', ' ', 'g'),
      '[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff#*_|`]+', ' ', 'g'))
  );

create or replace function public.search_document_pages(
  p_document_id  uuid,
  p_extract_hash text,
  p_query        text,
  p_max_pages    integer default 200,
  p_from_page    integer default 1
)
returns table (page_number integer, hits integer, snippets text[])
language sql
stable
security invoker
set search_path = ''
as $$
  with needle as (
    select lower(q) as lq, char_length(q) as len
      from (select left(btrim(regexp_replace(normalize(coalesce(p_query, ''), NFC), '[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff#*_|`]+', ' ', 'g')), 200) as q) folded
  )
  select dp.page_number,
         ((char_length(l.lt) - char_length(replace(l.lt, n.lq, ''))) / n.len)::integer as hits,
         -- CASE, not just NULL arithmetic: greatest() ignores a NULL, so a missing match would
         -- still cut a snippet from the start of the page.
         array_remove(array[
           case when s1.at is not null then substring(dp.search_text from greatest(s1.at - 60, 1) for least(s1.at, 61) - 1 + n.len + 60) end,
           case when s2.at is not null then substring(dp.search_text from greatest(s2.at - 60, 1) for least(s2.at, 61) - 1 + n.len + 60) end,
           case when s3.at is not null then substring(dp.search_text from greatest(s3.at - 60, 1) for least(s3.at, 61) - 1 + n.len + 60) end
         ], null) as snippets
    from public.document_pages dp
    cross join needle n
    -- Literal, case-insensitive matching on the lower-cased page: strpos and replace, no patterns.
    -- OFFSET 0 keeps the planner from copying lower() into each use (five times a matching page).
    cross join lateral (select lower(dp.search_text) as lt offset 0) l
    -- Up to three snippets, each from 60 characters before a match to 60 after it; the next is
    -- looked for only after the previous one ends, so matches close together share a snippet.
    cross join lateral (select nullif(strpos(l.lt, n.lq), 0) as at) s1
    cross join lateral (select s1.at + n.len + 59 + nullif(strpos(substr(l.lt, s1.at + n.len + 60), n.lq), 0) as at) s2
    cross join lateral (select s2.at + n.len + 59 + nullif(strpos(substr(l.lt, s2.at + n.len + 60), n.lq), 0) as at) s3
   where dp.document_id = p_document_id
     and dp.extract_hash = p_extract_hash
     and n.len >= 2
     and s1.at is not null
   -- From the reader's page on, then the pages before it.
   order by dp.page_number < greatest(coalesce(p_from_page, 1), 1), dp.page_number
   limit least(greatest(coalesce(p_max_pages, 200), 1), 200);
$$;
