# Current nter.news homepage preview

Status: **Living.** Owner approved implementation and a separate Vercel Preview on 2026-10-25. Production and Supabase data must stay untouched.

## Current state and problem
Main baseline 348ae6b1 is clean and synchronized. HomeDesk has a bundled investigation, dataset topic ticker and two news sections; the live latest endpoint returns September fallback rows while nter.news/feed.xml publishes October articles. News shares a six-hour browser cache with market/conflict data. The public marketing rail also reads /api/home/latest. The existing publisher/CMS migration is separate.

## Expected outcome
Preserve the Home component layout/classes, ads, market strip, watchlist and conflict sidebar. Replace editorial hero, hot topics and both news sections with public nter.news articles. Use only the fixed HTTPS RSS URL, excerpts and public images; no scraping or member body import. Public news rail uses the same fresh endpoint without redesign. Default feed window 12, at most 40 rows; canonical publisher URLs and original dates retained, invalid links/dates rejected, newest first and deduplicated by canonical link. No HTML is injected. Publisher category is displayed as supplied, not asserted as independently verified.

## Acceptance evidence
A current RSS item appears in the API, hero, ticker, main feed and sidebar with correct link/date/Unicode; old bundled investigation is absent. Feed checks every five minutes, visible page polls every minute, manual refresh revalidates. A successful empty feed clears previous rows. Errors serve a clearly marked previous successful feed for at most 24 hours, or honest unavailable state on a cold instance. Cache age is fetch age; article age is separate. No fabricated publication dates or false live labels. Desktop/mobile layouts match existing structure and articles open nter.news. Offline tests cover XML validation/DTD rejection, unsafe URLs, response bounds, timeout, concurrency, cache expiry, empty results and stale failure. Regression tests must fail against the old code first.

## Boundaries and risk
Scope: server/newsRss.mjs and tests; server/homeApi.mjs latest path; API latest headers/options; src/lib/nterNewsClient.js, homeCache.js, homeStatic.js and news freshness helper; HomeDesk/editorial image fallback/ticker; public rail freshness text; related tests; package manifests; task docs. Source collections, public/data, backup, Supabase code/schema, credentials, auth/billing/analytics logic, deployment config and vendor hosting unchanged. No Supabase writes for feed storage. Existing app sign-in/research features retain shared live backend, so acceptance uses mocked local signed-in fixtures and public preview endpoints; no payments or research submissions. No main merge, production promotion or domain changes. The user authorizes push of task/nter-news-rss-preview and Preview deployment only.

## Cache and resilience
Five-minute per-instance memory cache and Vercel CDN cache, with capped stale response; memory may disappear on a cold start and no durability guarantee is made. Short failure backoff prevents retry storms. Respect fresh request with no-store. Last successful response in browser can survive reload on that preview origin, but successful empty feed must replace old data. RSS only exposes a bounded window; this is not full CMS synchronization and cannot guarantee complete unpublish history. Do not add a database or persistent external service.

## Style and checks
Existing React/ESM style; tests in src with Vitest. Run npm test, npm run lint, npm run build, npm run check:bundle, router import, Deno suite and both required GitHub CI jobs. SQL fixtures run in CI because local Docker is unavailable. New dependency pinned and native npm audit inspected. Local verification blocks external/Supabase traffic; live read probe explicitly allows public nter.news only. Browser fixtures use fake local identity, never weaken deployed auth. Final deployed commit, preview URL, CI, freshness and unchanged production SHA recorded in plan.
