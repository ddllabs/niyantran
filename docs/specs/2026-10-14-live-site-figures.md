# Spec: live, database-backed figures on the marketing site (F142)

> **Status: Living.** Owner request 2026-10-14: "I hope every number that's coming is database-backed.
> If tomorrow we add new records, the frontend UI would reflect the new records." Owner accepted the
> recommendation: one public counts endpoint, cached, with the last measured figures as a fallback.
> Facts below were read from the code and docs on 2026-10-14; no database was queried.

## Current state

| Figure | Shown on | Source today | Updates with new records? |
|---|---|---|---|
| 9,817 bills | Home hero, home KPI, home ribbon, pricing hero | `SITE_FIGURES.bills`, typed from a read-only NTER query on 2026-10-12 (`docs/specs/2026-10-12-legal-policies.md:145-155`; the SQL text was not recorded) | No |
| 3,431 documents | Home ribbon, pricing hero | `SITE_FIGURES.documents`, from the 2026-10-11 batch receipt (`docs/research/2026-10-11-corpus-wide-batch.md:12`) | No |
| 120 modules | Home hero, ribbon, pricing | `DESK_CATALOGUE.length` (code) | When a module is added in code (correct: modules live in code) |
| 246 source endpoints | Home hero | `SITE_FIGURES.endpoints`, recounted from `src/data/source-registry.json` by a test | When the registry changes (correct: it lives in the repo) |
| Carousel: bills, ministries (56), fronts (88) | Coverage carousel | `/api/home/segments` (`server/homeApi.mjs:722-743`) computes them on request, but from the snapshot files in `public/data/embedded_csv/`, cached in memory with no expiry | No (only when snapshots are refreshed) |
| Carousel constants: 543 constituencies, 36 states/UTs, 2 Houses, 6 CBAM sectors, 27 jurisdictions, 25 benches | Coverage carousel | Constants in the payload | Not records; stay as they are |
| "48 MINISTRIES" | Home KPI (`HomePage.jsx:54`) | Hand-typed (F30); the carousel computes 56 | No |

**Access.** `desk_rows`, `documents` and `document_chunks` have RLS with `revoke all … from anon`
(`20260921000003_corpus_and_desk.sql:67-76`, `20260921000015_least_privilege.sql`). The server has a
secret-key client (`getSupabaseAdminClient`, `server/authEmailProvider.mjs:96-113`) already used by
public endpoints such as `/api/marketing/intro-video`. No query anywhere counts the corpus tables, and no
RPC returns corpus counts to the server except `admin_desk_records` (service role, much heavier).

**Definitions (from the code).**
- Bills: rows in `desk_rows` where `tier = 'national'` and `feature = 'Bill Passage Probability Index'`.
  `row_key` comes from the bill's `id`, so this equals distinct bill IDs, as the carousel computes
  (`src/lib/deskRows.js:82-85`, `deskRowsFeed.test.js:19-20`: 9,819 pack rows, 2 key collisions).
  Not `Policy Intelligence Graph`, which holds the same 9,817 rows (never count twice).
- Documents: `documents` with `indexed_at is not null` (set last, after chunks commit; every search
  RPC filters on it).
- Ministries: distinct normalised `row->>'ministry'` in the `Parliamentary Question Database` desk,
  normalised as `homeApi.mjs` does today.
- Fronts: distinct `row->>'conflict_name'` in the global `Open Fronts` desk.

## Outcome

1. **One database function**, `public.site_figures()`: `security definer`, `stable`, fixed
   `search_path`, returning one JSON object `{ bills, documents, ministries, fronts, as_of }` (counts
   only, never row data). Execute is granted to `service_role` only, not `anon`. New migration; applied
   to NTER only with the owner's approval.
2. **One public endpoint**, `GET /api/site-figures` (`server/siteFiguresApi.mjs`, routed in
   `api/router.js` and the Vite dev middleware): calls the function with the secret-key client and
   adds the code-derived `modules` and `endpoints`.
   - Cached in memory for 15 minutes per server instance, and `Cache-Control: public, s-maxage=900,
     stale-while-revalidate=3600` so Vercel's edge serves most visits (overriding the router's default
     `no-store` for this path only).
   - If the database is unreachable or the function fails: the last good value if cached, otherwise
     the measured constants, with `source: 'fallback'`. Never zero or blank.
   - The response says which it is: `source: 'live' | 'cached' | 'fallback'` and `as_of`.
3. **The site reads it.** A small client helper (`useSiteFigures`) renders the constants at once and
   swaps in the live values when the fetch returns; one request per page load, shared by every figure
   on the page. Consumers: the home hero, the home KPI and ribbon (the "48 MINISTRIES" KPI becomes the
   live ministries count, closing that part of F30), and the pricing hero.
4. **The carousel agrees.** `/api/home/segments` takes bills, ministries and fronts from the same
   cached figures, falling back to its snapshot computation, so the carousel and the hero never show
   different bill counts.
5. **Modules and endpoints** stay code-derived, as they are. `SITE_FIGURES` keeps the measured
   constants as the fallback, with the date they were measured.

## Acceptance

- **SQL fixture** (`supabase/tests/`, run by `npm run test:sql` against a disposable local database,
  never NTER): `site_figures()` counts the bill desk only (not the graph desk), only indexed documents,
  distinct ministries and fronts; `anon` and `authenticated` cannot execute it; the vacuity check fails
  without the migration.
- **Unit tests:**
  - the endpoint returns live values from a fake client;
  - it caches for 15 minutes, and falls back to the cached value and then to the constants on error, with the right `source`;
  - the cache header is set on this path only;
  - `useSiteFigures` starts from the constants and applies the response;
  - the carousel uses the live figures when present.

  Each guard is shown to fail without its code.
- `node -e "import('./api/router.js')…"` (router import), `npm run lint`, `npm test`, `npm run build`.
- **After the owner applies the migration:** one read-only check that the endpoint's live counts
  equal direct counts on NTER; then the homepage, carousel and pricing show them in the browser.

## Plan

| Task | Write scope | Owner |
|---|---|---|
| T1 Migration and fixture | new `supabase/migrations/<ts>_site_figures.sql`, new `supabase/tests/<n>_site_figures.sql` | Supervisor |
| T2 Endpoint | new `server/siteFiguresApi.mjs` and test; `api/router.js`; the dev middleware registration | Supervisor |
| T3 Client and pages | `src/lib/siteFigures.js` (`useSiteFigures`) and test; `HomePage.jsx`, `PricingPage.jsx` | Supervisor |
| T4 Carousel | `server/homeApi.mjs` `segmentCounts`; `src/lib/segmentCarousel.test.js` | Supervisor |

Sequential, one branch: `task/live-figures`, after F141.

## Decisions for the owner

1. **Approve the migration** (one read-only `security definer` function, service-role only), and
   applying it to NTER after review. Without it, bills and documents could still be counted directly
   by the server, but ministries and fronts (distinct values) could not, short of paging through
   thousands of rows.
2. **Bills definition:** rows in the bill desk (9,817 today, one per bill ID). The 2026-10-12 note also
   records 9,415 "distinct bill keys", probably distinct linked documents. Keep "bills on record" as
   bill IDs (recommended, matches today's figure) unless you want the other.

## Not in scope

- The carousel's constants (constituencies, states, Houses, CBAM sectors, jurisdictions, benches): they
  describe the system, not records.
- The terminal's own counts (desk landings already count live).
- The other F30 figures besides ministries.
