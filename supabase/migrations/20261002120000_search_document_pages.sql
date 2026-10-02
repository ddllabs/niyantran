-- Search in one document's stored page text, for the citation viewer
-- (docs/specs/2026-10-02-viewer-continuous.md, section 4).
--
-- document_pages.search_text: the page's stored OCR Markdown as a reader sees it, kept by
-- PostgreSQL itself (a stored generated column; nothing writes it). Images, link targets, tags and
-- Markdown syntax (# * _ | `) are taken out, and every run of spacing or line breaks is one space.
-- It exists for speed: folding the text in the search itself cost 286 ms on a generated
-- 1,000-page document, against a 50 ms budget, because every page was rewritten on every query.
--
-- search_document_pages(document, extraction, query, max pages, from page): for each page of that
-- extraction holding the query, at most 200 pages, the page number, how many times the query occurs,
-- and up to three snippets of about 60 characters either side of a match (the client trims a cut
-- word; matches within a snippet's trailing 60 characters share it). The query is folded the same
-- way and matched literally and case-insensitively (strpos on lower-cased text, so no character in
-- it is special); under 2 characters it finds nothing. The pages come in reading order from the
-- reader's page (p_from_page, default 1), wrapping to the document's start, so the 200 kept are
-- the ones the reader reaches first; a long document's common word never loses the matches near
-- the reader to the bound.
--
-- SECURITY INVOKER: the caller's existing read grant and policy on document_pages decide what it
-- can see. STABLE, an empty search_path, a bounded result. EXECUTE for authenticated and
-- service_role only.
--
-- Down:
--   drop function public.search_document_pages(uuid, text, text, integer, integer);
--   alter table public.document_pages drop column search_text;

alter table public.document_pages
  add column search_text text generated always as (
    btrim(regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(text, '!\[[^\]]*\]\([^)]*\)', ' ', 'g'),
          '\[([^\]]*)\]\([^)]*\)', '\1', 'g'),
        '<[^>]+>', ' ', 'g'),
      '[\s#*_|`]+', ' ', 'g'))
  ) stored;

create function public.search_document_pages(
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
      from (select left(btrim(regexp_replace(coalesce(p_query, ''), '[\s#*_|`]+', ' ', 'g')), 200) as q) folded
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

revoke all on function public.search_document_pages(uuid, text, text, integer, integer) from public, anon;
grant execute on function public.search_document_pages(uuid, text, text, integer, integer) to authenticated, service_role;
