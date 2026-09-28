-- T6: articles pushed by nter.news (POST /api/news/ingest) move from the
-- per-instance /tmp JSON file to Postgres (owner decision 2026-09-28: build
-- this small table now rather than choose between 503 and the lossy copy).
--
-- Only the server touches it: the ingest route writes through
-- upsert_nter_article() and the home "Latest" read selects with the server
-- key. Clients get nothing. The newest 200 articles are kept.

BEGIN;

CREATE TABLE public.nter_news_articles (
  article_id   text        PRIMARY KEY CHECK (length(article_id) BETWEEN 1 AND 500),
  link         text        CHECK (link IS NULL OR length(link) BETWEEN 1 AND 2000),
  title        text        NOT NULL CHECK (length(title) BETWEEN 1 AND 1000),
  published_at timestamptz,
  updated_at   timestamptz NOT NULL,
  row          jsonb       NOT NULL CHECK (jsonb_typeof(row) = 'object'),
  received_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX nter_news_articles_link_key ON public.nter_news_articles (link) WHERE link IS NOT NULL;
CREATE INDEX nter_news_articles_recent_idx ON public.nter_news_articles (updated_at DESC);

ALTER TABLE public.nter_news_articles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nter_news_articles FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.nter_news_articles TO service_role;

-- Upserts one normalised article row (server/nterNews.mjs articleToRow).
-- The same article is matched by article_id, then by link. An older revision
-- (updated_at earlier than the stored one) is skipped. Returns 'created',
-- 'updated' or 'skipped_stale'.
CREATE FUNCTION public.upsert_nter_article(p jsonb)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_id      text        := nullif(btrim(p ->> 'article_id'), '');
  v_link    text        := nullif(btrim(p ->> 'link'), '');
  v_title   text        := btrim(coalesce(p ->> 'title', ''));
  v_updated timestamptz := coalesce(nullif(p ->> 'updated_at', '')::timestamptz, now());
  v_pub     timestamptz := nullif(p ->> 'published_at', '')::timestamptz;
  v_prev    public.nter_news_articles;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR v_title = '' OR coalesce(v_id, v_link) IS NULL THEN
    RAISE EXCEPTION 'article needs a title and an article_id or link' USING ERRCODE = '22023';
  END IF;
  v_id := coalesce(v_id, v_link);

  SELECT * INTO v_prev FROM public.nter_news_articles a
   WHERE a.article_id = v_id OR (v_link IS NOT NULL AND a.link = v_link)
   ORDER BY (a.article_id = v_id) DESC
   LIMIT 1
   FOR UPDATE;

  IF FOUND THEN
    IF v_updated < v_prev.updated_at THEN
      RETURN 'skipped_stale';
    END IF;
    UPDATE public.nter_news_articles
       SET link = coalesce(v_link, link), title = v_title, published_at = coalesce(v_pub, published_at),
           updated_at = v_updated, row = p, received_at = now()
     WHERE article_id = v_prev.article_id;
    RETURN 'updated';
  END IF;

  INSERT INTO public.nter_news_articles (article_id, link, title, published_at, updated_at, row)
  VALUES (v_id, v_link, v_title, v_pub, v_updated, p);

  DELETE FROM public.nter_news_articles
   WHERE article_id IN (
     SELECT article_id FROM public.nter_news_articles
      ORDER BY updated_at DESC, received_at DESC
     OFFSET 200
   );
  RETURN 'created';
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_nter_article(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_nter_article(jsonb) TO service_role;

COMMIT;
