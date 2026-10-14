# Spec: serve module data from the database, filled by scheduled jobs (F160)

> **Status: Living.** Owner, 2026-10-14 (verbatim): "The 4-second API pull is a live pull, right?
> That's why, every time on page reload, we are pulling it, or we are also caching it. Eventually, we
> would keep this as a part of our database … so that this feed becomes a combination of both live
> pull and data-backed entries, right? Isn't that how production applications work? What's your
> suggestion?" Then: "write the F160 spec". Follows F154, F156, F157, F159 and F164. **Not approved
> yet:** see section 11.
>
> **Revised 2026-10-14:** the owner's answers to section 11 are recorded in the
> [F169 plan](../plans/2026-10-14-module-data-repair.md), phase 4. Section 4.2's one-snapshot-per-module
> storage is replaced there by records-first storage (every item kept, rules 1 to 3 of the
> [F170 spec](2026-10-14-document-text-rules.md)); the rest of this design stands.
>
> **Evidence.** "Measured" means a command was run on 2026-10-14: scripts run with Node against this
> checkout at `11cc881` (the real `server/featureFeed.mjs`, every live source called once, one after
> another, from the owner's Mac), and a few read-only GET requests to production
> (`https://niyantran-six.vercel.app`, function in `bom1`). "Read" means read from the code at
> `11cc881`. "Recorded" means taken from a dated record in `docs/agents/coordination.md` or
> `docs/plans/open-work.md` and not re-checked here (no production SQL was run for this spec).
> "Estimated" means worked out from measured numbers. The measuring scripts were throwaway and are not
> in the repository.

## In plain words

Today, when someone opens a module, our server goes out to the source (Google News, PIB, World Bank,
Wikidata …) at that moment, waits up to 4 seconds, and if the source is slow it shows stored rows or
an apology. Vercel then keeps the answer for 5 minutes. So the first visitor after a quiet spell waits,
slow sources show "Live data is taking longer than usual", and a few modules show nothing at all.

Yes: production applications usually separate **fetching** from **serving**. A background job visits
each source on a timetable (news every 30 minutes, government feeds every hour, reference data once a
day) and saves the result in our database. Pages then read the saved copy, which takes a fraction of
a second, and say "Updated 12 min ago". The visitor never waits for an outside website. If a source
is down, the page keeps showing the last good copy and the job tries again later.

The recommendation: a timer inside our Supabase database starts a refresh every minute; the refresh
runs on our existing Vercel server, which already knows how to read every source; results go into
two new tables; module pages and desk landing counts read those tables. Start with the slowest
modules (Morning Brief, Statement Tracker, Economic Overview, Geopolitics News Wire), watch for a
week, then move the rest.

## What you'll notice

- Every migrated module opens in well under a second, every time, including the first visit of the
  day. No "Live data is taking longer than usual", no "Loading live count…" on landing pages.
- The module header says when the data was last fetched, for example "Updated 12 min ago".
- Morning Brief and the Statement Tracker show items on the live site. Today they cannot: their pages
  call a route that does not exist on the live site (section 1.3).
- News is at most about 30 minutes old (today it can be seconds old, or a day-old cached copy, or
  missing). Markets every 15 minutes. Slow-moving data (World Bank, Wikidata) once a day.
- When a source breaks, its module keeps showing the last good copy with an older "Updated" time,
  instead of an error. An admin check lists sources that keep failing.
- Outside websites are asked far less often and at a steady rate, so we are less likely to be
  blocked (GDELT already refuses us: section 1.4).

## 1. Current state

### 1.1 How a module gets its data today (read; times measured)

| Step | Where | What happens |
|---|---|---|
| Browser opens a module | `src/lib/featureFeed.js` `fetchFeature` / `archiveFirst` (F154) | Starts the shipped archive and `GET /api/feature-feed` together; if the API has not answered in 0.5 s, the archive shows with "Refreshing live data…" |
| Edge | `api/router.js` `cachePolicyFor`, `API_CACHE` | A 2xx answer is kept by Vercel's CDN 300 s, stale up to 1 day; an archive answer (`served: 'archive'`) 60 s; errors `no-store` |
| Function | `serveFeatureFeedWithBackup` → `serveFeatureFeedWithinLimit` (`server/featureFeed.mjs:3740`) | Runs the live pull (`serveFeatureFeed`) for at most 4 s (`LIVE_TIME_LIMIT_MS`). One live attempt per module per instance; a late live answer is reused on that instance for 10 min (`LATE_LIVE_MS`) |
| Past 4 s | `serveArchiveFor` | Re-runs the same feed code with every live source refusing (`archivePass`), so each module takes its own stored fallback (files in `src/data`, `public/data`) |
| Still empty | `applyBackupFallback` | A backup workbook, only for the four packs on the live function (Satellite Infrastructure, Growth Indicators, Global Trade, Athlete Index; F156) |
| Landing counts | `server/*LandingSummary.mjs` | The eight `/api/*-landing` routes call the same loader and project a count; each summary function takes the loader as a parameter (`serveNationalLanding(searchParams, loadFeed)`) |
| Paged registers | `server/featurePage.mjs` (F156) | Bills and Questions: pages cut in memory from the whole register (shipped files) |
| Morning Brief, Statement Tracker pages | `src/desks/MorningBriefDesk.jsx`, `StatementsDesk.jsx` | Fetch their own items in the browser through `/api/rss`, not through `/api/feature-feed` |

Measured on production, 2026-10-14:

- Geopolitics News Wire module, edge `MISS`: 200 in **5.9 s**.
- Morning Brief landing count, `MISS`: **502 in 4.2 s** (`no-store`), as F154 recorded.
- Morning Brief module, `MISS`: 200 in 4.5 s with **no rows**: one status row "Source offline or
  empty … no last-known-good archive", `served: 'archive'`, note "Live data is taking longer than
  usual." The edge then kept that empty answer: the next two requests were `HIT` in 0.12 s, age 31 s.
- `/api/home/latest`, which reads `nter_news_articles` from Supabase on every request (no edge
  cache): **0.20–0.34 s** total, three requests. This is the best measured stand-in for a module
  answer read from the database.
- `/api/rss`: **404** (no route on the live function).

### 1.2 The 169 modules by where their data comes from (measured)

Every module in `src/data/html-feature-map.json` was run twice: once with all network refused (what
the server can answer from stored files) and once live, unbounded up to 60 s, one module at a time.
"Stored copy" means the server's archive pass returns real rows.

| Class | Modules | Live time p50 / p90 / max | Over 4 s | Examples |
|---|---|---|---|---|
| Live only, no stored copy anywhere | 44 | 0.9 s / 4.5 s / 60 s (cap) | 6 | Morning Brief, Statement Tracker, Economic Overview, Entertainment News Wire, most Law court modules, Hyperlocal News |
| Live, and only a backup workbook behind it | 32 | 0.9 s / 4.5 s / 21 s | 4 | Music Charts India, Athlete Index, Fixtures & Results, Global Trade (on the live site only 4 of these packs exist; F156) |
| Live, with a stored copy | 7 | 1.5 s / 16.9 s / 16.9 s | 2 | Cabinet Decisions, Policy Pipeline, NSE/BSE, Prediction Market Odds, Climate Newswire |
| Stored only (no network call even when live) | 50 | instant | 0 | Bills, Questions, Open Fronts, MP Profiles, booth modules, WTO disputes |
| Planned in the catalogue (no source of record; the desk does not request them) | 31 | 1.0 s / 1.3 s | 0 | 15 State and 16 Local modules (F157) |
| No data (status row only) | 5 | – | – | State Tender Aggregator, State Fiscal Deep-Dive, Election Forecast Aggregator |

- **83 modules call outside sources when someone opens them** (the first three rows). 12 of them took
  longer than 4 s in this run. Three failed outright: Morning Brief (still running at 60 s), Top
  Financial & Business Players (Wikidata timed out at 45 s), AI & the Tech Industry.
- Live answers are capped at 500 rows (`MAX_ROWS`). A live module's answer is 69 KB raw at the median,
  97 KB at p90, 248 KB at most (MLA Report Card); 6.7 MB for all live modules together.
- The registry already holds a refresh interval per source (`refreshMinutes` in
  `src/data/source-registry.json`): 15 min for 61 entries, 60 for 4, 360 for 69, a week for 3, 5 min
  for 1 (Transit). Nothing uses it today.

### 1.3 Morning Brief and the Statement Tracker on the live site (measured and read)

Both pages fetch through `/api/rss` (`MorningBriefDesk.jsx:51-53`, `StatementsDesk.jsx:45-47`), only
when `liveApiEnabled()` is true, which in a production build is false unless `VITE_LIVE_API=1`
(`src/lib/apiMode.js`). `/api/rss` answers 404 on production (measured). Either way the live pages
cannot show items; they show a plain "not available" message (F164). The server already builds the
same content: `server/nationalFeed.mjs:504` builds Morning Brief's three sections (Top of the Day,
Government Wire, Economy, tagged in `section`), and `:439` the Statement Tracker for the first of the
eight `STATEMENT_LEADERS` only (`src/data/nationalCurated.js:94`). The page lets the reader switch
between all eight.

### 1.4 The sources (measured)

One live pass, 269 outside requests from 114 modules (the 83 above plus the 31 planned ones):

| Host | Modules (first source) | Requests | Time p50 / max | Result |
|---|---|---|---|---|
| news.google.com | 40 (75 counting planned) | 76 | 0.83 s / 1.7 s | all 200 |
| query.wikidata.org | 9 | 9 | 2.5 s / 45 s | 8 × 200, 1 timeout |
| api.worldbank.org | 7 | 13 | 0.15 s / 0.21 s | all 200 |
| www.pib.gov.in | 5 | **125** | 0.12 s / 0.55 s | all 200 |
| api.gdeltproject.org | 3 | 6 | **11.9 s** / 12 s | **4 × 429 (rate limited), 2 timeouts** |
| api.manifold.markets | 1 | 3 | 6.3 s / 8.4 s | 200 |
| www.nseindia.com | 1 | 1 | 12 s | timeout |
| rss.marketingtools.apple.com | 2 | 2 | 20 s | 1 timeout |
| Others (BBC, ESPN, TheSportsDB, TVmaze, Yahoo, RBI, CourtListener, Verra, …) | 1–2 each | 1–5 each | 0.2–4.3 s | mostly 200; ESPN TLS error |

- **PIB:** Morning Brief, Policy Pipeline and Cabinet Decisions each make the same 41 requests (the
  release list plus one page per release for the English text). Morning Brief's 41 took 14.1 s.
- **GDELT** refused every request from this network. The code already paces GDELT at one request per
  5.5 s per server instance (`GDELT_GAP_MS`) and caches answers 10 min (`GDELT_CACHE_MS`); that is per
  instance, so several instances can still exceed it. Whether the live function in `bom1` is refused
  too was not measured.
- **CPU (measured, 8 modules):** 10–40 ms of CPU per news module, about 340 ms for a PIB module, out of
  0.6–4.5 s of waiting. A refresh is mostly waiting on the network.
- **How often the data really changes (read from the sources' nature, not measured):** news searches
  and wires, minutes to hours; PIB and regulators, a few times a day; markets, minutes during trading
  hours; World Bank, Wikidata and constitutions, days to months.

### 1.5 What is in Supabase already (read; counts recorded)

- **`desk_rows`** (migration `20260921000003`, `document_key` added in `0011`): primary key
  `(tier, feature, row_key)`, `row jsonb`, `record_text`, `snapshot_at`, `loaded_at`. Recorded
  2026-09-28: 34,184 rows over 34 modules, 89 MB. Indexes: `desk_rows_row_gin` (jsonb) and a 24 MB
  trigram GIN on `record_text`, both `fastupdate = off`; autovacuum scale factors 0.05 (`084135`).
  - **Loaded from shipped files only**, by `scripts/load-desk-rows.mjs` through the desk's own shaping
    pipeline (`src/lib/deskRowsFeed.js`: `fetchArchiveFeature` → `prepareDeskFeed` → `toDeskRow`),
    with network refused. It writes only differences and **deletes keys a module no longer shows**.
  - **Read by the AI:** `search_desk_rows` (text match with `ilike` on `record_text`, no embeddings)
    and `research-chat`'s `findDeskRow`, which looks a cited row up by `(tier, feature, row_key)` when
    it becomes a citation (`supabase/functions/research-chat/index.ts:428`). Also counted by
    `site_figures()` for the public site (bills, ministries, fronts).
  - RLS: signed-in users may read; anon gets nothing; only the service role writes.
  - Tier names differ from the feed's: `desk_rows` uses desk tab ids (`national`, `global`, `state`),
    the feed uses `htmlTier` (`geopolitics`, `judiciary`, `local`, …).
- **No list on screen reads `desk_rows`** (F156 §1.3). Updating it never costs embeddings; only
  `document_chunks` carry embeddings, and F160 does not touch documents or chunks. The 2,338 legacy
  documents are never modified (`docs/plans/2026-10-01-rag-v2-admin-records.md`).
- **`nter_news_articles`** (`20260928150000`): service-role only (RLS on, every grant revoked from
  anon and authenticated); filled by `POST /api/news/ingest` (bearer `NTER_TERMINAL_API_KEY`) through
  `upsert_nter_article()`, which keeps the newest 200; read by the Vercel function with the server's
  secret key (`getSupabaseAdminClient`), falling back to a committed seed. **This is the pattern F160
  follows.**
- The Vercel function already holds `SUPABASE_URL` and `SUPABASE_SECRET_KEY` server-side and uses them
  for analytics, nter.news and site figures (read).

### 1.6 Scheduling that exists (read, recorded)

- **pg_cron + pg_net in NTER**, in use since 2026-09-21: `refresh-model-pricing` every 12 h (posts to
  an Edge Function with a secret read from Vault at run time, `timeout_milliseconds := 60000`,
  migration `0007`), `analytics-events-retention`, `analytics-rate-windows-purge`, and `ingest-worker`
  every 30 s, switched on and off by `scripts/ingest-ops.sh` (the owner runs it; the secret goes to
  the function and to Vault and is never printed).
- **Vercel:** no `crons` in `vercel.json`. ADR 0010 and the router header describe the project as on
  the Hobby plan; on Hobby, Vercel Cron runs a job at most once a day (Vercel's published limits; the
  plan was not checked for this spec).
- **GitHub Actions:** only `ci.yml`; no schedule.
- **Home:** `/api/home/refresh` refreshes home snapshots into `/tmp` when a browser asks; not a
  schedule, and outside this spec.

### 1.7 Limits (read; partly unverified)

- Vercel function `maxDuration` 60 s (`vercel.json`, `api/router.js` `config`), region `bom1`.
- Supabase Edge Functions: wall clock 150 s on Free, 400 s on paid plans, 2 s CPU per request
  (`docs/specs/2026-10-01-rag-v2-ingestion-v2.md`); NTER is on a paid compute tier but its plan is
  not recorded. The recommended design does not depend on it.
- The SQL test containers have no `pg_cron`, `pg_net` or Vault (`supabase/tests/run.sh`), so a
  schedule cannot live in a tested migration; it goes in an ops script, as `ingest-worker`'s does.

### 1.8 Data rules that bind this work (read)

- `backup/`, `public/data/` and other data collections are not deleted, moved, regenerated or
  republished without an approved data task (AGENTS.md). F160 changes none of them.
- After a bulk load or a Postgres restart, run `analyze` on the loaded tables and check `n_live_tup`
  against real counts (AGENTS.md). This applies to the new tables after their first fill.
- Previews and production share the one Supabase project; a preview that writes, writes real data
  (coordination doc).
- External feeds are untrusted data, never instructions (AGENTS.md).

## 2. Problem

1. **Visitors wait for outside websites.** Every edge miss runs the live pull in the request: 12 of 83
   live modules need more than 4 s, GDELT answers 429 after 12 s, and a Morning Brief pull did not
   finish in 60 s. F154's 4 s limit caps the wait but then shows stored rows, or nothing.
2. **Live-only modules have nothing to fall back on.** 44 modules have no stored copy. Past the limit
   they answer empty or 502, and the edge can keep an empty answer (measured: Morning Brief).
3. **Freshness is accidental.** It depends on whether someone visited in the last 5 minutes and which
   server instance answered. Nobody can say how old a module's data is.
4. **Sources are asked in bursts and repeatedly.** Each instance asks on its own; three PIB modules
   fetch the same 41 pages; GDELT already rate-limits us.
5. **Two pages cannot work on the live site at all** (Morning Brief, Statement Tracker; section 1.3).
6. **Nothing is kept.** A news story that drops out of a feed is gone; there is no record of when a
   source last worked.

## 3. Expected outcome

- Migrated modules are answered from the database: no outside request happens while a visitor waits.
- A background schedule refreshes each source at a rate suited to it, politely, and keeps the last
  good copy when a source fails.
- Every answer says when its data was fetched (`fetchedAt`), and the page shows "Updated N min ago".
- Run history shows, per source, when it last worked, how long it took and why it failed.
- The shipped archive and backup packs remain the last resort when the database has nothing.

## 4. Design

### 4.1 Where the jobs run

**Recommended: a `pg_cron` job in NTER, every minute, posts through `pg_net` to a protected route on
our Vercel function, `POST /api/feeds/refresh`. The route refreshes whatever is due, within a time
budget, and writes the results to Supabase.**

| Option | For | Against |
|---|---|---|
| **pg_cron + pg_net → Vercel route (recommended)** | Reuses `server/featureFeed.mjs` unchanged (3,861 lines, Node, reads `src/data`/`public/data`); any frequency; the pattern, Vault secret and ops script already exist (`ingest-worker`, pricing); schedule and run history live next to the data; database (ap-south-1) and function (`bom1`) are both in Mumbai | Two systems in one path; 60 s per invocation, so work is split across ticks |
| Vercel Cron → same route | One vendor for code and schedule | At most daily on Hobby (plan unverified); schedule changes need a deploy |
| Supabase Edge Function (Deno) doing the fetching | Runs next to the database, 400 s wall clock on paid plans | The feed code would have to be ported or bundled into Deno with its data files: two copies that drift |
| GitHub Actions schedule | Free, long runs | At least 5 min, often delayed, runs in the US, a third place for secrets and logs |

Details:

- The cron job body is one `net.http_post` with the secret read from Vault at run time
  (`feed_refresh_secret`), `timeout_milliseconds := 55000`; same shape as `ingest-ops.sh`.
- The route checks the header `x-feed-refresh-secret` against `FEED_REFRESH_SECRET` (server-only, set
  for **Production only** in Vercel, never a `VITE_` variable) with a timing-safe compare, as
  `authorizeNterRequest` does. It refuses when the secret is unset or `VERCEL_ENV` is not
  `production`, so previews never write.
- The route is `POST` only, `no-store`, and returns a short summary (modules done, failed, skipped).

### 4.2 Storage

**Recommended: two new tables, not `desk_rows`.**

Why not `desk_rows`: it is the AI's citable record set, built by a different pipeline (desk shaping,
tab ids, flattened rows) from shipped files. Writing live rows there every 30 minutes would delete rows
that an answer has cited (the loader prunes missing keys and `findDeskRow` looks them up later),
churn its 24 MB trigram index with non-HOT updates, and change the public site's figures. Pages need
the whole feed answer (`source`, `coverage`, `meta`, notes), not flattened rows. Adding live modules to
AI search is a separate decision (question 4).

`public.feed_snapshots`, one row per module (and per variant):

| Column | Meaning |
|---|---|
| `tier`, `feature`, `variant` | Key. `variant` is `''` except for the Statement Tracker's leaders |
| `body jsonb` | The feed answer exactly as `/api/feature-feed` returns it (at most 500 rows; refused above 2 MB) |
| `row_count`, `content_hash` | For "unchanged" detection and checks |
| `status` | `ok`, `fallback` (only the module's own stored fallback was available), `empty` |
| `fetched_at` | Last time the source answered with real rows (shown as "Updated …") |
| `changed_at` | Last time the content changed |
| `checked_at` | Last attempt, whatever its result |
| `interval_minutes`, `next_due_at` | Schedule, copied from code on every claim |
| `consecutive_failures`, `last_error` | Short reason; never a stack or a secret |
| `lease_until` | Set while a run holds the module |
| `serve boolean default true` | Per-module switch to stop serving from the database without a deploy |

`public.feed_runs`, one row per attempt: `id`, `tier`, `feature`, `variant`, `started_at`, `ms`,
`status` (`ok`, `unchanged`, `failed`, `timeout`, `fallback`), `row_count`, `hosts` (host:status list),
`error`. Kept 30 days (daily purge job, guarded like the analytics retention job).

SQL functions (service role only, empty `search_path`, schema-qualified):

- `feed_claim_due(p_modules jsonb, p_limit int, p_lease_seconds int)`: inserts rows for modules that
  have none (due now), updates intervals, and returns up to `p_limit` due modules, oldest first, with
  `for update skip locked`, setting their lease. It returns nothing while another run holds a live
  lease, so runs never overlap.
- `feed_record(p jsonb)`: writes one outcome and its `feed_runs` row in one transaction, applying the
  rules in 4.4.
- `feed_health` view: per module, age, interval, `stale` (older than 3 × interval), failures, last
  error.

### 4.3 Which modules, how often

**Recommended classes (estimated load from the measured pass):**

| Class | Modules | Every | Runs a day | Outside requests a day |
|---|---|---|---|---|
| News searches and wires (Google News, BBC, outlet feeds, GDELT, Apple charts) | 50 | 30 min | 2,400 | about 2,700 |
| Markets (NSE/BSE, Yahoo exchanges, Manifold odds) | 3 | 15 min | 288 | about 860 |
| Official and event feeds (PIB, RBI, courts, Verra, fixtures, TV tonight, launches) | 13 | 60 min | 312 | about 3,600 before de-duplication, about 1,600 after |
| Reference data (Wikidata, World Bank, Constitute) | 16 | daily | 16 | about 22 |
| Statement Tracker leaders (variants) | 8 | 6 h | 32 | about 64 |
| **Total** | **82 + 8 variants** | | **about 3,050** | **about 5,300 (7,300 without de-duplication)** |

- Not scheduled: the 50 stored-only modules (nothing to fetch), the 31 planned and 5 no-data modules,
  Bills and Questions (shipped registers), **Transit** (aircraft positions: real-time, stays live),
  Live TV and Home (separate routes; Home feeds are parked until their schema is agreed).
- The class interval is a code table (`server/feedSchedule.mjs`), seeded from the registry's
  `refreshMinutes`, never more often than the registry says, never more often than every 15 minutes.
- Today, a busy module is pulled once per 5 minutes per edge region and per instance; the schedule is
  less traffic to each source, not more.

### 4.4 A refresh run

1. The route asks `feed_claim_due` for up to 12 due modules with a 90 s lease.
2. It runs them **4 at a time, at most 1 request in flight per host**, with a run-wide memo so a URL is
   fetched once per run (PIB's 41 pages are shared by the three PIB modules) and GDELT keeps its 5.5 s
   pacing.
3. **A 429 or a timeout from a host closes that host for the rest of the run**; modules fall straight
   to their next source (GDELT → Google News already exists in the code).
4. Each module gets at most 45 s; no module starts after 30 s into the run; the route answers before
   55 s. Morning Brief must fit: with the memo and the closed-host rule it skips the 12 s GDELT
   refusals (measured 60 s today); task T2 measures it.
5. The live pull is the existing `serveFeatureFeed` (unbounded, outside any request), plus a `person`
   parameter for the Statement Tracker (T2).
6. Outcome rules in `feed_record`:
   - Real rows and not a fallback: store `body` if the hash changed (`ok`), else only touch
     `fetched_at`/`checked_at` (`unchanged`; no large row rewrite). Next due: now + interval.
   - Failure, empty answer, or only the module's own stored fallback: keep the stored `body`, add one
     to `consecutive_failures`, retry after 2, 4, 8, 16 … minutes, never later than the interval. If
     nothing was stored yet, store the fallback answer as `status = 'fallback'`, so the page has what
     it has today.
   - No retries inside a run; the backoff is the retry.
7. **Optional for news (question 3):** instead of replacing, merge the new stories with the stored
   ones by link, keep those first seen in the last 7 days, newest first, at most 500, each with
   `first_seen`. This is the "live plus data-backed entries" the owner described.

### 4.5 Serving

- `/api/feature-feed` and the eight landing routes get one loader, `serveStoredOrLive` (new
  `server/feedStore.mjs`). For a module in the schedule, with `serve = true`:
  - read its snapshot by primary key (2 s timeout);
  - answer `{ ...body, served: 'stored', fetchedAt, updated: fetchedAt }`;
  - snapshot missing, the read failed, or (during rollout only) older than 3 × interval: today's path
    (`serveFeatureFeedWithBackup`).
- After phase 3, the fallback changes to the shipped archive pass only: **no live request on the
  request path** for scheduled modules. A stale snapshot is still served, with its age shown.
- Landing routes need no new code beyond passing the new loader: each `serve*Landing` already takes
  its loader as a parameter.
- Edge caching is unchanged: a stored answer is a normal 2xx and keeps 300 s / stale 1 day. The page
  computes "N min ago" from `fetchedAt`, so the label is right even from a cached copy.
- Paged modules (Bills, Questions) keep F156's in-memory paging: they are shipped registers, not
  scheduled. Moving their search into SQL is not needed for speed (F156 measured 0.19–0.82 s).
- Module page: `freshnessLabel` (`src/lib/plainSourceNote.js`) shows "Updated 12 min ago" for
  `served: 'stored'` (today it formats `updated` as a date). F159's retry and F154's archive-first
  race stay for unscheduled modules; for stored answers they never trigger.
- Local development without database credentials falls back to today's live path.

### 4.6 Morning Brief and the Statement Tracker pages

- Morning Brief reads `/api/feature-feed` and groups rows by `section` (Top of the Day, Government
  Wire, Economy), instead of calling `/api/rss`.
- The Statement Tracker reads `/api/feature-feed?…&person=<leader>`; the job stores all eight leaders
  as variants, every 6 hours.
- `/api/rss` stays a local-development route; nothing on the live site calls it after this.

### 4.7 The shipped archive, the backup packs and AI search

- The shipped archive (`public/data`, `src/data`) and the four deployed backup packs stay exactly as
  they are, as the last resort when the database has no snapshot (first deploy, outage). No seeding
  from them: the first runs fill every scheduled module within about 15 minutes, and a module whose
  source fails first time stores its own fallback answer (4.4).
- Retiring a shipped archive once its module is reliably stored would be a separate approved data
  task (exclusion).
- `desk_rows`, `document_chunks` and the AI tools are unchanged. No embeddings are created.

### 4.8 Security

- Both tables: RLS on, every grant revoked from `anon` and `authenticated`, read and write by the
  service role only (as `nter_news_articles`). Browsers read through `/api/feature-feed`; the data is
  public-source data and holds no user data.
- Two secrets, both generated by the owner's script (`scripts/feed-ops.sh secret`, modelled on
  `ingest-ops.sh`): the Vercel Production variable `FEED_REFRESH_SECRET` and the Vault entry
  `feed_refresh_secret`. Never in a `VITE_` variable, the cron job text, logs, docs or fixtures.
- Stored bodies are untrusted text, shown by React as text, as today. A 2 MB cap per body.
- The route does nothing for GET, wrong or missing secret, or a non-production deployment.

### 4.9 Observability

- `feed_runs` and `feed_health` answer: what is stale, what keeps failing, how long each source takes.
- `scripts/feed-ops.sh status`: the cron job, the stale and failing modules, runs and failures in the
  last 24 h, table sizes. No secret values.
- `cron.job_run_details` and `net._http_response` show whether ticks fired and what the route answered.
- An admin "Feeds" tab is optional (question 6). Automatic alerts (email when a source has failed 5
  times or is older than 3 × its interval) are a follow-up (question 6).

### 4.10 Cost and limits (estimated)

| Item | Estimate |
|---|---|
| `feed_snapshots` | about 90 rows, about 7 MB of JSON before compression |
| Rewrites | at most about 170 MB of JSON a day if every run changed; less, as unchanged runs touch only small columns; reclaimed by autovacuum |
| `feed_runs` | about 3,050 rows a day, under 1 MB a day, about 30 MB at 30 days |
| Vercel invocations | 1,440 ticks a day, about 43,000 a month; most idle |
| Vercel time | about 2.8 h of wall time a day (sum of measured pull times; mostly waiting on the network); about 2 min of CPU a day |
| Supabase | 1,440 `pg_net` posts a day; about 3,000 small writes; one primary-key read per edge miss |
| Outside requests | about 5,300 a day, steady |
| Embeddings | none |

Plan limits were not checked: if the project is on Vercel Hobby, its monthly function allowances and
its terms for commercial use should be confirmed (risk 5).

## 5. Rollout and rollback

| Phase | What | Gate to the next |
|---|---|---|
| 0. Foundation | Migration, refresh route, ops script; refresh runs on a local Supabase stack; nothing served from it | Local dry run passes (section 6) |
| 1. Slowest live-only modules | Owner applies the migration, sets the secrets, turns the schedule on for all 82 + 8 (filling the table costs nothing visible); serve from the database for Morning Brief, Statement Tracker (8 leaders), Economic Overview, Geopolitics News Wire; the two pages switch to the feed | One week: freshness and speed targets met |
| 2. News and markets | Serve the other 49 news modules and 3 market modules | One week |
| 3. Everything scheduled | Official and reference classes; the request path stops calling live sources for scheduled modules; optional admin tab | Done |

- The served list is a code list per phase (`STORED_FEEDS` in `server/feedSchedule.mjs`).
- **Rollback without a deploy:** `update feed_snapshots set serve = false where …` (one module or
  all) puts the request path back on today's behaviour. `scripts/feed-ops.sh schedule off` stops the
  jobs; served snapshots then age, and phase 1–2 modules fall back to the live path past 3 × interval.
- Full rollback: revert the serving commit; the tables can stay.

## 6. Acceptance evidence

| # | Evidence | Target |
|---|---|---|
| 1 | SQL fixture `supabase/tests/feed_snapshots.sql` under `npm run test:sql`, with its vacuity proof | anon and authenticated can neither read nor write; the claim skips leased rows and returns nothing while a run holds a lease; a failure keeps `body` and backs off; "unchanged" does not rewrite `body`; the 2 MB cap refuses |
| 2 | Vitest for the route | missing, wrong or non-production secret → 401/403 and nothing claimed; budget and per-host limit respected; a 429 closes the host for the run; each test shown to fail without its code |
| 3 | Vitest for serving | stored answer carries `served: 'stored'` and `fetchedAt`; missing, failed or switched-off snapshot falls back; **after phase 3 a scheduled module's request makes no outside fetch** (global `fetch` asserted untouched) |
| 4 | Local dry run: `supabase start`, the dev server, ticks posted for an hour | every scheduled module stored or recorded as failing; Morning Brief finishes within 45 s; `analyze` run after the first fill |
| 5 | Production, phase 1 (after the owner's push and go-ahead), 20 cold and 20 repeat requests per module | first byte < 300 ms on an edge hit and < 800 ms on a miss (baseline: 0.12 s hit, 0.20–0.34 s DB-backed miss); no 502 and no "Live data is taking longer than usual" from the four modules' landings or pages |
| 6 | One week of `feed_runs` per phase | ≥ 95 % of modules refreshed within their interval + 5 min; no module older than 3 × interval for more than an hour unless its source is down; 429s per day reported per host |
| 7 | Browser check on production | Morning Brief shows its three sections; the Statement Tracker switches leaders; headers say "Updated N min ago" |
| 8 | Standard gates | `npm run lint`, `npm test`, `deno test …`, `npm run build`, router import |

## 7. Scope

- New: `supabase/migrations/<ts>_feed_snapshots.sql`, `supabase/tests/feed_snapshots.sql`,
  `server/feedSchedule.mjs`, `server/feedStore.mjs`, `server/feedRefresh.mjs`, `scripts/feed-ops.sh`,
  their tests.
- Changed: `api/router.js` (the refresh route and the loader), `server/featureFeed.mjs` (Vite
  middleware uses the loader; run-wide fetch memo and closed-host hook), `server/nationalFeed.mjs`
  (`person`), `src/lib/plainSourceNote.js`, `src/desks/MorningBriefDesk.jsx`,
  `src/desks/StatementsDesk.jsx`, `src/lib/featureFeed.js` if needed.
- Deployment configuration (sensitive scope): one Vercel Production variable; no `vercel.json` change.
- Production actions, each needing the owner's authorization: the migration, the secrets, the
  schedule, the pushes per phase.
- Records: `docs/plans/open-work.md` (F160), the coordination operations record, and an ADR for the
  scheduler and storage choice.

## 8. Exclusions

- `desk_rows`, `document_chunks`, embeddings, the AI tools and the 2,338 legacy documents.
- Changing, regenerating or retiring anything under `public/data/`, `src/data/` or `backup/`.
- Bills and Questions (shipped registers) and SQL-side paging.
- Transit, Live TV, Home markets, latest and pulse, nter.news ingest.
- The 31 planned and 5 no-data modules; new sources.
- Email or chat alerting (question 6).
- Changing Vercel or Supabase plans.

## 9. Risks

1. **A source changes or blocks us.** Mitigated: last good copy is kept and its age shown; backoff;
   closed-host rule; `feed_health` lists it. The page cannot hide data older than the owner would like
   (question 5 sets the wording).
2. **A bad but valid answer replaces a good one** (for example a source returning 3 rows instead of
   300). Recorded in `feed_runs`; a "row count fell by more than 80 %" warning in `feed_health`;
   not blocked automatically in this spec.
3. **Write churn on large JSON rows.** Mitigated by not rewriting unchanged bodies; table size is part
   of `feed-ops.sh status`; reconsider replacing whole bodies if it grows past 500 MB.
4. **pg_net or the cron job stops silently.** Visible in `cron.job_run_details`, `feed_health`, and the
   "Updated" time on every page.
5. **Plan limits.** Vercel function allowances and terms on the current plan (recorded as Hobby,
   unverified) should be confirmed before phase 1.
6. **Previews share the database.** The route refuses outside production; previews only read.
7. **GDELT from `bom1`** may be refused as it is from the owner's network; the three modules that start
   with GDELT already fall back to Google News or BBC.

## 10. Implementation plan outline

One after another on `task/scheduled-module-data`; each task runs `npm run lint`, `npm test`,
`npm run build` and the router import; T1 also `npm run test:sql`; T1 and T4 the Deno suite if
`supabase/` changes.

| # | Task | Write scope | Depends on | Focused checks |
|---|---|---|---|---|
| T0 | ADR 0012 "scheduled feeds: pg_cron to the Vercel function, stored in feed tables" | `docs/decisions/0012-*.md` | Owner approval of this spec | Review |
| T1 | Tables, functions, view, retention | the migration, `supabase/tests/feed_snapshots.sql`, `supabase/tests/run.sh` if the fixture needs a line | T0 | `npm run test:sql` (fixture and vacuity) |
| T2 | Refresh: schedule table, run, memo, closed host, `person` | `server/feedSchedule.mjs`, `server/feedRefresh.mjs`, `server/featureFeed.mjs` (hooks only), `server/nationalFeed.mjs`, `api/router.js` (route only), tests | T1 | `npx vitest run src/lib/feedRefresh.test.js`; Morning Brief timed against real sources |
| T3 | Ops script | `scripts/feed-ops.sh` | T1 | Shell check; dry run against the local stack (`schedule on/off`, `kick`, `status`) |
| T4 | Local dry run and record | `docs/research/<date>-scheduled-feeds-local-run.md` | T2, T3 | Section 6 row 4 |
| T5 | Serving and the two pages | `server/feedStore.mjs`, `api/router.js` (loader), `server/featureFeed.mjs` (middleware), `src/lib/plainSourceNote.js`, `src/desks/MorningBriefDesk.jsx`, `src/desks/StatementsDesk.jsx`, tests | T2 | `npx vitest run src/lib/feedStore.test.js src/desks src/lib/plainSourceNote.test.js`; browser check on `npm run dev` |
| T6 | Phase 1 go-live (owner-authorized) | production only; record in `docs/agents/coordination.md`, `open-work.md` | T4, T5, push | Section 6 rows 5–7 |
| T7 | Phases 2 and 3 | `server/feedSchedule.mjs` (served list), request-path change in `server/feedStore.mjs`; optional admin tab | T6 plus a week each | Section 6 rows 3, 5, 6 |

Only T7's last phase records F160 as done in `open-work.md`.

## 11. Open questions for the owner

**Owner's answers, 2026-10-14:** the timer runs every **5 minutes**, not every minute ("Every minute
is too much"); the other recommendations below are adopted. F160 is now phase 4 of
[F169](2026-10-14-module-data-repair.md). Question 8 (the Vercel plan) is still open.


1. **Where the timer runs.**
   - **Recommendation:** pg_cron in Supabase calling our Vercel server (4.1). It already runs four jobs
     this way, works at any frequency on the current plans and needs no code port.
2. **How fresh each class should be.**
   - **Recommendation:** news 30 min, markets 15 min, PIB and other official feeds 60 min, reference
     data daily, Statement Tracker leaders 6 h (4.3). The registry asks 15 min for news; 30 halves the
     load and news searches over several days change slowly.
3. **Keep a rolling history for news ("live plus data-backed").**
   - **Recommendation:** yes, from phase 2: news modules keep stories first seen in the last 7 days,
     up to 500, newest first (4.4 step 7). Phase 1 replaces, so the first measurements are clean.
4. **Should scheduled live data also feed AI search (`desk_rows`)?**
   - **Recommendation:** not in F160. Cited rows would disappear as news turns over. If wanted, a
     separate item: a daily copy of selected modules with rows kept for as long as they may be cited.
5. **What a page says when its copy is old.**
   - **Recommendation:** always "Updated N min/h ago"; past 3 × the interval add "The source hasn't
     responded since then." No error card while any copy exists.
6. **Alerts and an admin view.**
   - **Recommendation:** phase 1 uses `feed-ops.sh status` and SQL; add the admin "Feeds" tab in phase
     3; an email alert later, once a week of runs shows what normal looks like.
7. **Order against O6 (Razorpay).**
   - **Recommendation:** T0–T4 (nothing visible, no production change) can run alongside O6; phase 1
     go-live after O6 ships, or before it if the Morning Brief and Statement Tracker gaps matter more.
8. **Confirm the Vercel plan.** The repository's records say Hobby; the plan could not be read
   (2026-10-14). The design itself works on Hobby, because the timer runs in Supabase, but about
   2.8 hours of function time a day (4.10) must fit the plan's limits, and Vercel's Hobby plan is
   for non-commercial use only, which matters for a site selling paid plans regardless of F160.
   - **Recommendation:** confirm the plan in the Vercel dashboard (Settings → Billing); move the
     DDL Labs team to Pro before paid plans go on sale (O6), if it is not already.

## Amendment A: records-first storage (2026-10-15)

Owner decisions of 2026-10-14 and 2026-10-15, recorded in
[ADR 0012](../decisions/0012-scheduled-feeds-records-first.md). This replaces section 4.2's
one-snapshot-per-module table. Sections 4.1 (where the jobs run), 4.4 (a refresh run), 4.5
(serving) and 4.8 (security) stand, read with "items" for "snapshot".

- **Tables:**
  - `feed_items` (one row per item: `tier`, `feature`, `variant`, `item_key`, the served `row`,
    `title`, `url`, `published_at`, `first_seen`, `last_seen`, `kind`, `content_hash`; unique on
    module, variant and item key);
  - `feed_state` (per module and variant: class, interval, `next_due_at`, lease, failures, last
    error, `fetched_at`, `checked_at`, the answer's note, links and coverage, `serve`);
  - `feed_runs` (30 days);
  - `feed_daily` (measurement summaries).
- **Which modules, how often:**
  - `server/feedSchedule.mjs` lists the 58 modules whose loaders call an outside source (measured
    2026-10-15), with seven classes: markets 15 min, news 30, official, events and charts 60,
    Statement Tracker leaders 6 h, reference daily.
  - A test keeps the list equal to what the loaders call.
  - This replaces the class table in section 4.3, whose counts came from a different measure.
- **Item keys:** `itemKeyFor` (bills by `bill:<year>:<number>`, else the link without tracking
  parameters, else a hash of title and date).
- **Keeping rules:** by class kind, run daily by `pg_cron` (ADR 0012, decision 3).
- **Serving:** newest items first, paged like Bills (F156), with "Updated N min ago" from
  `fetched_at`.
- **Go-live order:**
  1. Migration.
  2. Code pushed, switched off.
  3. Secret set.
  4. Timer on after the Vercel upgrade.
  5. One day storing without serving.
  6. Serving switched on class by class.
