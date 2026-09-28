# Spec: T6, nter.news articles to Supabase

> **Status: Historical (2026-09-28).** Landed in `7160391`; migration
> `20260928150000_nter_news_articles` applied to NTER the same day. Task C2
> of `docs/plans/2026-09-28-remaining-work.md`. The owner decided D4 on
> 2026-09-28: build a small table rather than choose between 503 and the
> lossy `/tmp` copy.

## Current state (read in the code on 2026-09-28)

- `POST /api/news/ingest` (bearer `NTER_TERMINAL_API_KEY`) writes articles
  pushed by nter.news into an in-process copy plus a JSON file under
  `writablePath()`. On Vercel the file is per instance and lost on cold
  starts.
- Locally, the same write also rewrites the committed
  `public/data/nter-news.json` seed, a protected data file.
- The home "Latest" rail reads that copy and falls back to the seed.
- `NTER_TERMINAL_API_KEY` is not set on Vercel, so production refuses every
  push with 503.

## Expected outcome

1. `public.nter_news_articles` holds the articles, touched only by the
   server key. `upsert_nter_article(jsonb)` matches the same article by
   `article_id`, then by link, and skips an older revision. It keeps the
   newest 200.
2. `ingestNterArticle` is async and upserts through the function. A store
   failure answers 503, and a bad payload still answers 400 without
   touching the store.
3. `serveNterLatest` is async and reads the newest rows. It falls back to
   the committed seed (every row flagged `fallback: true`) only when the
   table is empty or unreachable. Nothing is written to disk anywhere.
4. The guard's `nterNews writes writablePath('nter-news.json')` offender
   is removed.
5. Owner action: set `NTER_TERMINAL_API_KEY` on Vercel (it must match
   `nter_news_live_` followed by at least 16 characters), and configure
   nter.news to push to `https://niyantran-six.vercel.app/api/news/ingest`.

## Acceptance evidence

- SQL fixture `supabase/tests/nter_news_articles.sql`, covering grants,
  create, update, stale skip, link match, the 200 cap, and bad input. It
  fails without the migration.
- `src/lib/nterNewsStore.test.js`, covering ingest through the function,
  the stale skip, 503, 400 before any store call, reads, and seed fallback.
  Five of its six tests failed first.
- `npm test`, the build, the router import, the Deno suite and
  `npm run test:sql` pass.
