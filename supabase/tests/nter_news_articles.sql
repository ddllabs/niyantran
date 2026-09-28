-- Disposable PG assertions for T6 nter.news articles. Run on the isolated
-- least-privilege fixture plus research-turn persistence and
-- 20260928150000_nter_news_articles.sql; never against a hosted project.
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(actual boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF actual IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END; $$;
CREATE FUNCTION pg_temp.rejected(statement text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'PASS: % (%)', label, SQLSTATE; RETURN;
  END;
  RAISE EXCEPTION 'FAIL: % accepted', label;
END; $$;

SELECT pg_temp.assert_true(to_regclass('public.nter_news_articles') IS NOT NULL, 'articles table exists');
SELECT pg_temp.assert_true((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.nter_news_articles'::regclass), 'RLS is enabled');
DO $$
DECLARE actor text; privilege text;
BEGIN
  FOREACH actor IN ARRAY ARRAY['anon','authenticated','public'] LOOP
    FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'] LOOP
      PERFORM pg_temp.assert_true(NOT has_table_privilege(actor, 'public.nter_news_articles', privilege), actor || ' cannot ' || privilege || ' articles');
    END LOOP;
    PERFORM pg_temp.assert_true(NOT has_function_privilege(actor, 'public.upsert_nter_article(jsonb)', 'EXECUTE'), actor || ' cannot upsert articles');
  END LOOP;
  PERFORM pg_temp.assert_true(has_function_privilege('service_role', 'public.upsert_nter_article(jsonb)', 'EXECUTE'), 'service_role can upsert');
END $$;

CREATE FUNCTION pg_temp.art(id text, link text, title text, updated text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('article_id', id, 'link', link, 'title', title, 'updated_at', updated,
    'published_at', '2026-09-28T08:00:00Z', 'dek', 'Summary', 'src', 'nter.news');
$$;

SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(public.upsert_nter_article(pg_temp.art('a1', 'https://nter.news/a1', 'First', '2026-09-28T09:00:00Z')) = 'created', 'a new article is created');
SELECT pg_temp.assert_true(public.upsert_nter_article(pg_temp.art('a1', 'https://nter.news/a1', 'First, revised', '2026-09-28T10:00:00Z')) = 'updated', 'a newer revision updates it');
SELECT pg_temp.assert_true(public.upsert_nter_article(pg_temp.art('a1', 'https://nter.news/a1', 'First, stale', '2026-09-28T09:30:00Z')) = 'skipped_stale', 'an older revision is skipped');
SELECT pg_temp.assert_true((SELECT title FROM public.nter_news_articles WHERE article_id = 'a1') = 'First, revised', 'the newest title is kept');
SELECT pg_temp.assert_true(public.upsert_nter_article(pg_temp.art('a1-renamed', 'https://nter.news/a1', 'First, new id', '2026-09-28T11:00:00Z')) = 'updated', 'the same link under a new id is the same article');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.nter_news_articles) = 1, 'still one article');
SELECT pg_temp.assert_true(public.upsert_nter_article(jsonb_build_object('link', 'https://nter.news/nolink-id', 'title', 'By link only')) = 'created', 'an article with only a link is keyed by it');
SELECT pg_temp.rejected($$SELECT public.upsert_nter_article(jsonb_build_object('article_id', 'x'))$$, 'an article without a title is refused');
SELECT pg_temp.rejected($$SELECT public.upsert_nter_article(jsonb_build_object('title', 'No id'))$$, 'an article without id or link is refused');

-- Only the newest 200 are kept.
DO $$
DECLARE i integer;
BEGIN
  FOR i IN 1..205 LOOP
    PERFORM public.upsert_nter_article(pg_temp.art('bulk' || i, 'https://nter.news/bulk' || i, 'Bulk ' || i,
      to_char(timestamptz '2026-09-29T00:00:00Z' + (i || ' minutes')::interval, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
  END LOOP;
END $$;
SELECT pg_temp.assert_true((SELECT count(*) FROM public.nter_news_articles) = 200, 'the table keeps 200 articles');
SELECT pg_temp.assert_true(EXISTS (SELECT FROM public.nter_news_articles WHERE article_id = 'bulk205'), 'the newest is kept');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM public.nter_news_articles WHERE article_id = 'a1'), 'the oldest is dropped');
RESET ROLE;
ROLLBACK;
