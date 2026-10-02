-- Disposable PG assertions for search_document_pages
-- (20261002120000_search_document_pages; docs/specs/2026-10-02-viewer-continuous.md, section 4):
-- one overload, SECURITY INVOKER, STABLE, an empty search_path, EXECUTE for authenticated and
-- service_role but not anon or PUBLIC; case-insensitive literal matching over the stored OCR
-- Markdown with its syntax, images, link targets and tags taken out and spacing folded; counts and
-- at most three snippets in the page's own case; the extraction and document filters; the
-- 200-page bound, counted from the reader's page and wrapping to the document's start; short and
-- empty queries; Hindi; and the caller's own read access deciding what is seen (an RLS policy
-- narrowed for one test).
-- Run on corpus_records's chain plus the migration and 20261002180000_search_folding (no-break and
-- other Unicode spaces, NFC), which run.sh applies as a NON-superuser; never against a hosted
-- project. The vacuity check drops the folding migration, so the folding cases must fail without
-- it. Every label is unique.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE FUNCTION pg_temp.assert_true(actual boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF actual IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END; $$;
CREATE FUNCTION pg_temp.rejected(statement text, expected_state text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> expected_state THEN RAISE EXCEPTION 'FAIL: % expected % got %: %', label, expected_state, SQLSTATE, SQLERRM; END IF;
    RAISE NOTICE 'PASS: %', label; RETURN;
  END;
  RAISE EXCEPTION 'FAIL: % accepted', label;
END; $$;

-- ===== 1. Shape and privileges =====
SELECT pg_temp.assert_true((SELECT count(*) FROM pg_proc WHERE proname = 'search_document_pages' AND pronamespace = 'public'::regnamespace) = 1,
                           'one overload of search_document_pages');
SELECT pg_temp.assert_true((SELECT NOT prosecdef AND provolatile = 's' FROM pg_proc WHERE oid = 'public.search_document_pages(uuid, text, text, integer, integer)'::regprocedure),
                           'SECURITY INVOKER and STABLE');
SELECT pg_temp.assert_true((SELECT proconfig = array['search_path=""'] FROM pg_proc WHERE oid = 'public.search_document_pages(uuid, text, text, integer, integer)'::regprocedure),
                           'an empty search_path');
SELECT pg_temp.assert_true((SELECT attgenerated = 's' AND format_type(atttypid, atttypmod) = 'text' FROM pg_attribute
                            WHERE attrelid = 'public.document_pages'::regclass AND attname = 'search_text' AND NOT attisdropped),
                           'document_pages.search_text is a stored generated text column');
SELECT pg_temp.assert_true(has_function_privilege('authenticated', 'public.search_document_pages(uuid, text, text, integer, integer)', 'EXECUTE')
                           AND has_function_privilege('service_role', 'public.search_document_pages(uuid, text, text, integer, integer)', 'EXECUTE'),
                           'authenticated and service_role may execute');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.search_document_pages(uuid, text, text, integer, integer)', 'EXECUTE')
                           AND NOT EXISTS (SELECT FROM pg_proc, aclexplode(proacl) a WHERE oid = 'public.search_document_pages(uuid, text, text, integer, integer)'::regprocedure AND a.grantee = 0),
                           'neither anon nor PUBLIC may execute');

-- ===== 2. Data: one document with two extractions, and another document =====
INSERT INTO documents (id, source_key, title, content_sha256, ocr_text, chunker_version) VALUES
  ('d0000000-0000-4000-8000-000000000001', 'sdp-bill', 'Bill', 'sha-sdp1', 'x', 3),
  ('d0000000-0000-4000-8000-000000000002', 'sdp-other', 'Other', 'sha-sdp2', 'x', 3);
INSERT INTO document_pages (document_id, extract_hash, page_number, text, char_from, char_to) VALUES
  ('d0000000-0000-4000-8000-000000000001', 'x1', 1, E'AS INTRODUCED IN LOK SABHA\n\n**Bill No. 77 of 2025**\n\n# THE NATIONAL BILL', 0, 10),
  ('d0000000-0000-4000-8000-000000000001', 'x1', 2, E'|  Amendment of section 11. | 8. In section 11 of the principal\nAct, a Penalty; a penalty; a PENALTY. |\n| --- | --- |', 11, 20),
  ('d0000000-0000-4000-8000-000000000001', 'x1', 3, E'See ![img-0.jpeg](img-0.jpeg) the [Gazette](https://example.org/g) <sup>1</sup> clause (1) and 100% of a_b, abc, a.c and पूंजीगत व्यय here', 21, 30),
  ('d0000000-0000-4000-8000-000000000001', 'x1', 4, 'nothing to see', 31, 40),
  -- Folding parity with the client (migration 43): a no-break space, an em space, क़ stored
  -- precomposed (U+0958, which NFC writes as U+0915 U+093C), and É.
  ('d0000000-0000-4000-8000-000000000001', 'x1', 5, 'shall pay' || U&'\00A0' || 'the duty under clause' || U&'\2003' || 'nine of the ' || U&'\0958\093E\0928\0942\0928' || ' and the ÉCOLE rules for ' || U&'\0130' || 'STANBUL ' || U&'\039F\0394\039F\03A3', 41, 50),
  ('d0000000-0000-4000-8000-000000000001', 'x0', 2, 'an older extraction with a penalty', 0, 5),
  ('d0000000-0000-4000-8000-000000000002', 'x1', 1, 'another document with a penalty', 0, 5);
CREATE FUNCTION pg_temp.pages(q text, max_pages integer DEFAULT 200) RETURNS integer[] LANGUAGE sql AS $$
  SELECT coalesce(array_agg(page_number ORDER BY page_number), '{}')
    FROM public.search_document_pages('d0000000-0000-4000-8000-000000000001', 'x1', q, max_pages);
$$;
CREATE FUNCTION pg_temp.hits(q text, page integer) RETURNS integer LANGUAGE sql AS $$
  SELECT hits FROM public.search_document_pages('d0000000-0000-4000-8000-000000000001', 'x1', q) WHERE page_number = page;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.pages(text, integer), pg_temp.hits(text, integer) TO authenticated;

SELECT pg_temp.assert_true((SELECT search_text FROM document_pages WHERE document_id = 'd0000000-0000-4000-8000-000000000001' AND extract_hash = 'x1' AND page_number = 1)
                           = 'AS INTRODUCED IN LOK SABHA Bill No. 77 of 2025 THE NATIONAL BILL', 'search_text is the page as a reader sees it');
SELECT pg_temp.rejected($q$UPDATE document_pages SET search_text = 'x'$q$, '428C9', 'search_text cannot be written');

-- ===== 3. Matching, as the authenticated client role =====
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(pg_temp.pages('penalty') = '{2}', 'case-insensitive, and only this document''s given extraction');
SELECT pg_temp.assert_true(pg_temp.hits('penalty', 2) = 3, 'every occurrence on the page is counted');
SELECT pg_temp.assert_true(pg_temp.pages('principal act') = '{2}', 'a line break in the text matches a space in the query');
SELECT pg_temp.assert_true(pg_temp.pages('principal   act') = '{2}', 'runs of spaces in the query are folded');
SELECT pg_temp.assert_true(pg_temp.pages('bill no. 77') = '{1}' AND pg_temp.pages('**bill no. 77**') = '{1}', 'Markdown emphasis is ignored, in the text and in the query');
SELECT pg_temp.assert_true(pg_temp.pages('section 11. 8. in') = '{2}', 'table pipes are ignored, so a margin note runs into its row');
SELECT pg_temp.assert_true(pg_temp.pages('the national bill') = '{1}', 'a heading marker is ignored');
SELECT pg_temp.assert_true((SELECT snippets FROM public.search_document_pages('d0000000-0000-4000-8000-000000000001', 'x1', 'national bill'))
                           = array['AS INTRODUCED IN LOK SABHA Bill No. 77 of 2025 THE NATIONAL BILL'],
                           'one match gives one snippet, never a second cut from the page''s start');
SELECT pg_temp.assert_true(pg_temp.pages('gazette') = '{3}' AND pg_temp.pages('example.org') = '{}' AND pg_temp.pages('img-0') = '{}',
                           'link text is kept; link targets and images are not searched');
SELECT pg_temp.assert_true(pg_temp.pages('sup') = '{}', 'tags are not searched');
SELECT pg_temp.assert_true(pg_temp.pages('(1)') = '{3}' AND pg_temp.hits('(1)', 3) = 1, 'regular-expression characters match literally');
SELECT pg_temp.assert_true(pg_temp.pages('a.c') = '{3}' AND pg_temp.hits('a.c', 3) = 1, 'a dot matches a dot, not any character');
SELECT pg_temp.assert_true(pg_temp.pages('100%') = '{3}' AND pg_temp.pages('%%') = '{}' AND pg_temp.pages('0%') = '{3}', 'a percent sign is literal');
SELECT pg_temp.assert_true(pg_temp.pages('a\c') = '{}' AND pg_temp.pages('a\b') = '{}', 'a backslash is literal');
SELECT pg_temp.assert_true(pg_temp.pages('of a b') = '{3}' AND pg_temp.pages('of a_b') = '{3}', 'an underscore reads as a space (Markdown emphasis), in the text and in the query');
SELECT pg_temp.assert_true(pg_temp.pages('पूंजीगत व्यय') = '{3}', 'Hindi matches');
SELECT pg_temp.assert_true(pg_temp.pages('a') = '{}' AND pg_temp.pages('  ') = '{}' AND pg_temp.pages(NULL) = '{}', 'a query under 2 characters finds nothing');
SELECT pg_temp.assert_true(pg_temp.pages('absent words') = '{}', 'no match, no rows');
SELECT pg_temp.assert_true(pg_temp.pages('pay the duty') = '{5}', 'a no-break space in the text matches a space in the query');
SELECT pg_temp.assert_true(pg_temp.pages('pay' || U&'\00A0' || 'the') = '{5}', 'a no-break space in the query matches too');
SELECT pg_temp.assert_true(pg_temp.pages('clause nine') = '{5}', 'an em space folds to a space');
SELECT pg_temp.assert_true(pg_temp.pages(U&'\0915\093C\093E\0928\0942\0928') = '{5}', 'the client''s NFC query finds text stored precomposed');
SELECT pg_temp.assert_true(pg_temp.pages(U&'\0958\093E\0928\0942\0928') = '{5}', 'a precomposed query finds it too');
SELECT pg_temp.assert_true(pg_temp.pages('école') = '{5}' AND pg_temp.pages('ÉCOLE') = '{5}', 'accented capitals fold to lower case');
-- What the client's lowerAsDatabase mirrors (src/ai/page-viewer/searchModel.js): dotted İ lowers to a
-- plain i, and Σ to σ even at a word's end (no final sigma).
SELECT pg_temp.assert_true(pg_temp.pages('istanbul') = '{5}', 'dotted capital I lowers to a plain i');
SELECT pg_temp.assert_true(pg_temp.pages(U&'\03BF\03B4\03BF\03C3') = '{5}' AND pg_temp.pages(U&'\03BF\03B4\03BF\03C2') = '{}',
                           'a final capital sigma lowers to σ, not ς');
SELECT pg_temp.assert_true(
  (SELECT snippets FROM public.search_document_pages('d0000000-0000-4000-8000-000000000001', 'x1', 'penalty') WHERE page_number = 2)
    = array['ent of section 11. 8. In section 11 of the principal Act, a Penalty; a penalty; a PENALTY. --- ---'],
  'one snippet holds all matches within 60 characters, in the page''s own case (the client trims a cut word)');
RESET ROLE;

-- ===== 4. At most three snippets, and the 200-page bound =====
INSERT INTO document_pages (document_id, extract_hash, page_number, text, char_from, char_to)
  SELECT 'd0000000-0000-4000-8000-000000000002', 'x2', n,
         'word ' || repeat('filler text that runs on for a while before the next ', 2) || 'word ' || repeat('more filler that keeps the matches far apart from each other ', 2) || 'word ' || repeat('yet more filler to keep the matches apart in this page ', 2) || 'word',
         n * 10, n * 10 + 9
    FROM generate_series(1, 205) n;
-- The pages in the order returned, from a start page.
CREATE FUNCTION pg_temp.from_page(start integer) RETURNS integer[] LANGUAGE sql AS $$
  SELECT array_agg(t.page_number ORDER BY t.ord)
    FROM public.search_document_pages('d0000000-0000-4000-8000-000000000002', 'x2', 'word', 200, start) WITH ORDINALITY AS t(page_number, hits, snippets, ord);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.from_page(integer) TO authenticated;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT cardinality(snippets) FROM public.search_document_pages('d0000000-0000-4000-8000-000000000002', 'x2', 'word') WHERE page_number = 1) = 3
                           AND (SELECT hits FROM public.search_document_pages('d0000000-0000-4000-8000-000000000002', 'x2', 'word') WHERE page_number = 1) = 4,
                           'at most three snippets, while every match is counted');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.search_document_pages('d0000000-0000-4000-8000-000000000002', 'x2', 'word')) = 200
                           AND (SELECT count(*) FROM public.search_document_pages('d0000000-0000-4000-8000-000000000002', 'x2', 'word', 5000)) = 200,
                           'at most 200 pages, whatever is asked');
SELECT pg_temp.assert_true((SELECT array_agg(page_number ORDER BY page_number) FROM public.search_document_pages('d0000000-0000-4000-8000-000000000002', 'x2', 'word', 3)) = '{1,2,3}',
                           'a smaller limit is kept, in page order');
-- From the reader's page: the 200 pages from page 10 on, then wrapping to the document's start.
SELECT pg_temp.assert_true((SELECT p[1] = 10 AND p[196] = 205 AND p[197:200] = '{1,2,3,4}' AND cardinality(p) = 200 FROM pg_temp.from_page(10) p),
                           'from the reader''s page: its pages first, in reading order, then the document''s start');
SELECT pg_temp.assert_true((SELECT NOT (p && '{5,6,7,8,9}') FROM pg_temp.from_page(10) p),
                           'the pages just before the reader''s page are the ones left out');
SELECT pg_temp.assert_true(pg_temp.from_page(1) = (SELECT array_agg(n) FROM generate_series(1, 200) n)
                           AND pg_temp.from_page(NULL) = pg_temp.from_page(1) AND pg_temp.from_page(-4) = pg_temp.from_page(1),
                           'from page 1, or no page, is the document''s first 200');
SELECT pg_temp.assert_true(pg_temp.from_page(900) = pg_temp.from_page(1), 'a page past the end wraps to the start');
RESET ROLE;

-- ===== 5. The caller's own read access decides what is seen (SECURITY INVOKER) =====
DROP POLICY document_pages_read ON public.document_pages;
CREATE POLICY document_pages_read_test ON public.document_pages FOR SELECT TO authenticated USING (page_number <> 2);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(pg_temp.pages('penalty') = '{}' AND pg_temp.pages('gazette') = '{3}', 'a page the caller may not read is not searched');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.rejected($q$SELECT * FROM public.search_document_pages('d0000000-0000-4000-8000-000000000001', 'x1', 'penalty')$q$, '42501', 'anon cannot call it');
RESET ROLE;

ROLLBACK;
