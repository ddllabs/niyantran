# Home feeds: from committed JSON to a scheduled, database-backed pipeline

Status: **Living — parked.** Tracked as P1 in `docs/plans/open-work.md` (updated
2026-09-29). Nothing built, by decision on 2026-09-23. Resume from
section 8 ("Where to pick this up"). Nothing in this document is final, least of
all the table schema, which is a draft for discussion.
(corrected 2026-09-28: several blockers below have since cleared. `main` now
serves `/api/home/*` through `api/router.js`; nter.news articles are stored in
Supabase (`7160391`, serverless plan T6); the home snapshot cache no longer
writes `public/data` (`862c995`); the Vercel and Google sign-in blockers are
resolved as noted in section 8; the `dev` branch is gone. Still open: the table
schema, the news decision and the market-data vendor.)

## 1. What this is about

The Home desk has three live-looking widgets. This plan is only about them —
not the desk modules (Bill Passage etc.), which already live in `desk_rows`.

| Widget | What it shows | Where the data comes from today |
|---|---|---|
| **Markets strip** | 9 quotes with a sparkline: NIFTY 50, SENSEX, NIFTY BANK, INDIA VIX, USD/INR, Brent, Gold, S&P 500, Bitcoin | Yahoo Finance's undocumented chart endpoint (`/api/ohlc`), falling back to `ohlc.json` (2.2 MB) and `finance_market_feed.json` |
| **Latest** | ~9 headlines | RSS from The Wire, OCCRP, Scroll.in, The Hindu |
| **Conflict pulse** | ~8 conflict-reporting items | GDELT DOC 2.0 search, falling back to the static war tracker |

## 2. How it works today, and what is broken

There are two code paths, and they read different files.

> **Correction, 2026-09-24.** "Production" below means a static build of
> `ddllabs/niyantran` `main`, not the live site. The live www.nter.pro (an
> upstream build) **does** serve `/api/home/markets`, `/api/home/pulse` and
> `/api/home/latest`, through upstream's Vercel catch-all `api/router.js`
> (upstream commits b5f706a and f60123b, both 2026-09-21). Checked with a GET to
> each on 2026-09-24: `markets` returned live values (`archive: false`, e.g.
> NIFTY 50 at 23,063), and `latest` returned nter.news articles. `pulse` still
> returned the static war-tracker fallback, beginning "Russia–Ukraine War,
> February 2022". The "three weeks old" statement in point 1 applies only to
> a static build of ddllabs `main`, whose `src/lib/homeStatic.js` reads
> `ohlc.json` and `finance_market_feed.json`. ddllabs `main` has no
> `/api/home/*` handler (its `api/` holds only `api/ai/`).

**Dev server** (`server/homeApi.mjs`, `npm run dev`): fetches live, and on every
read older than 6 hours rewrites `public/data/{markets,news,conflict}.json`.
That is why those three files are always dirty in git. (corrected 2026-09-28:
since `862c995` the cache lives under `writablePath('home-snapshots')` and the
committed files are read-only seeds.)

**Production** (static Vercel build, no `/api/home/*`): `src/lib/homeStatic.js`
reads committed files —
- markets from `ohlc.json` (last committed 2026-09-01) + `finance_market_feed.json` (2026-09-09);
- latest from `nter-news.json`, a deliberate empty placeholder ("editorial feed not wired yet");
- conflict from `conflict.json`.

`markets.json` and `news.json` are never read in production. I said otherwise
on 2026-09-22; that was wrong.

Evidence of what is broken:

1. **Production markets are three weeks old.** Nothing refreshes the two files
   it reads.
2. **"Live" data that is not live.** The committed `conflict.json` (and the one
   on www.nter.pro) begins "Russia–Ukraine War, February 2022" — the static war
   tracker. GDELT failed, the code fell back to the archive, and wrote it with a
   fresh `updated` timestamp. The markets fetcher has the same fall-back-and-
   restamp path. A reader sees a recent time on old content.
3. **The live site is not this repo.** www.nter.pro serves upstream
   (`ItsCloudDev/niyantran`): its `conflict.json` matches upstream's 2026-09-21
   copy, and its JS bundle contains no Supabase client and none of the work
   since 2026-09-21. No commit to `ddllabs/niyantran` reaches it.
4. **Fragile source.** Yahoo's chart endpoint is unofficial and undocumented,
   rate-limits datacenter IPs, and its terms grant no redistribution right — a
   real exposure for a product that bills customers.

## 3. What I proposed before, and why it was the wrong shape

I proposed a scheduled job that refetches and **commits** the JSON files. It
would have fixed the dirty tree and nothing else that matters:

- a static file on Vercel only changes on deploy, so every refresh would have
  been a commit *and* a full site redeploy;
- it would not reach nter.pro at all (point 3);
- it kept the same fragile sources and the fall-back-and-restamp bug.

Data that changes every few minutes does not belong in the repository. It
belongs in the database, written by a scheduled job, read by the app at page
load. You asked the right question: if it is scheduled, fetch it properly and
store it properly.

## 4. Proposed design

### 4.1 Storage (Supabase tables) — DRAFT, to be discussed before any migration

This is a starting point for the schema discussion, not a design to apply.
Open schema questions are listed after the table.

| Table | One row per | Key columns |
|---|---|---|
| `market_quotes` | symbol × fetch | `symbol`, `name`, `last`, `change_pct`, `as_of` (the source's own quote time), `fetched_at`, `source`, `delayed_minutes` |
| `market_closes` | symbol × trading day | `symbol`, `trade_date`, `close` — the sparkline, instead of shipping a 2.2 MB file to every visitor |
| `news_items` | article | `url` (unique), `title`, `outlet`, `published_at`, `fetched_at` |
| `conflict_reports` | article | `url` (unique), `title`, `domain`, `country`, `seen_at`, `fetched_at` |
| `feed_runs` | job run × feed | `feed`, `started_at`, `status`, `rows_written`, `error` — so a silent failure is visible |

Open schema questions:
- One table per feed (above), or one generic `feed_items(feed, key, payload jsonb, as_of)`?
  Per-feed tables are typed and queryable; a generic one is simpler to extend.
- Does `market_quotes` keep every fetch (history, grows ~35K rows/month at the
  proposed cadence) or only the latest per symbol (upsert)? Intraday history is
  only worth keeping if a chart will use it.
- Is the symbol list data (a `market_symbols` table the admin panel can edit) or
  code (the 9 tickers as today)?
- Do news and conflict need de-duplication beyond the URL (the same story from
  syndicated outlets), and do we store summaries/images or only title + link?
- Retention periods, and whether any of this should feed the research corpus
  (it should not by default: headlines are not the record).
- Who may read: public (homepage is public) or signed-in only? Affects RLS and
  whether the unauthenticated marketing homepage can show the widgets.

Proposed, pending the questions above: views `home_markets_latest`,
`home_news_latest` and `home_conflict_latest` give the widgets exactly what they
render; row-level security allows public `select` on the views and writes only
by the service role; news and conflict pruned after 30 days, closes kept.

### 4.2 The job

The same pattern `refresh-model-pricing` already uses: `pg_cron` →
`net.http_post` → an Edge Function, `refresh-home-feeds`, with one fetcher per
feed. Proposed schedule:

| Feed | Cadence | Why |
|---|---|---|
| Markets | every 15 min, 09:00–16:00 IST Mon–Fri; hourly otherwise (crypto, US) | quotes only move in market hours |
| News | every 30 min | RSS updates in minutes; 30 is plenty for a homepage |
| Conflict | hourly | GDELT asks for at most 1 request / 5 s; hourly is polite and enough |

That is roughly 3,000 invocations a month — negligible on the current plan.

**Honesty rules**, each with a test:
- A failed fetch writes a `feed_runs` error row and **nothing else**. The last
  good data stays, with its real timestamp.
- `as_of` is always the source's time, never the fetch time. The widget shows
  its age from `as_of`.
- No fallback content is ever written as if it were live. The static war
  tracker and old OHLC files stay client-side fallbacks, labelled as archive.

### 4.3 Proper sources

**Conflict — GDELT DOC 2.0.** Already a proper source: public, free, no key,
documented, and the widget already says "reporting search, not an official
dataset". Keep it; fix only the failure handling. An official conflict dataset
would be ACLED, which needs registration and has use restrictions — not worth
it for a homepage pulse.

**News — publisher RSS.** Also proper: RSS is the channel publishers offer for
exactly this, headline plus link. Keep it, and consider adding PIB's official
press-release feed, which suits a policy terminal. Open product question: the
production build deliberately shows an empty "nter.news editorial feed"
placeholder instead of wires. Wires, editorial, or both is your call.

**Markets — the only feed without a clean free answer.** Indian index data
(NIFTY, SENSEX, India VIX) is licensed by the exchanges. Scraping the NSE or
BSE websites breaks their terms and gets blocked. The options:

| Option | What you get | Trade-off |
|---|---|---|
| **A. Licensed data API** (e.g. a vendor offering NSE/BSE indices with display rights — confirm coverage and redistribution terms before choosing) | Delayed intraday quotes for all 9 symbols | Monthly cost; the correct option for a paid product |
| **B. Official end-of-day sources, free** | USD/INR reference rate (FBIL), Brent spot (EIA API), S&P 500 close (FRED), Bitcoin (CoinGecko) | No free official source for NIFTY, SENSEX, VIX or gold; the strip becomes "EOD" and loses those rows or keeps them from a vendor |
| **C. Keep Yahoo for now** | Everything, intraday | Unofficial, can break at any time, no redistribution right |

**Recommendation:** A. As a stop-gap, C, with its output labelled "delayed,
unofficial" and every failure logged in `feed_runs`, then switch the fetcher
when a vendor is chosen. Only the fetcher changes; the tables and the widget
stay the same.

### 4.4 Read path

- **Production and the dev app:** the Home desk reads the three views with the
  Supabase client it already has. If the call fails, it falls back to the
  committed files, shown as archive.
- **Dev server:** `/api/home/*` reads the same views. It stops fetching live
  and stops writing `public/data`, so the tree stays clean. The three files
  become frozen fallbacks, refreshed by hand if ever.

## 5. Prerequisite outside this plan

**Deploy source.** nter.pro deploys from upstream `ItsCloudDev/niyantran`.
Nothing here — nor the Supabase auth, research chat or persona work — reaches
the live site until Vercel deploys `ddllabs/niyantran`, or upstream is synced.
Settle this with whoever owns the Vercel project; it decides when any of this
work goes live.

**Update 2026-09-24:** the owner has decided to relink production to a DDL
Labs–owned Vercel project that builds `ddllabs/niyantran` `main`. The current
nter.pro Vercel project and its settings are not accessible, so it will not be
reused. See `docs/niyantran-conflict-audit-and-plan/01-decisions-adr-0005.md` and
`docs/niyantran-conflict-audit-and-plan/03-upstream-integration-plan.md`.

## 6. Phases

| # | Work | Effort | Depends on |
|---|---|---|---|
| 1 | Tables, views, RLS, `feed_runs`; migration with SQL tests | ~0.5 day | — |
| 2 | `refresh-home-feeds` function: GDELT + RSS fetchers, honesty rules, tests; pg_cron schedule | ~1 day | 1 |
| 3 | Markets fetcher behind one interface: Yahoo stop-gap now, vendor later | ~0.5 day, plus vendor integration | 1; vendor choice |
| 4 | Home desk and dev server read the views; stop writing `public/data` (the second half done 2026-09-28, `862c995`) | ~0.5 day | 2 |
| 5 | Backfill `market_closes` for sparklines; remove `ohlc.json` from the page load | ~0.5 day | 3 |

## 7. Decisions needed

1. **Market data:** vendor (A), end-of-day official (B), or Yahoo stop-gap (C) → A later?
2. **News:** wires, the nter.news editorial feed, or both?
3. **Deploy source** for nter.pro (section 5).
4. **Table schema** (section 4.1 and its open questions) — to be agreed before any migration.

## 8. Where to pick this up

Blocked on three things outside the codebase. None of them is a coding task.
(corrected 2026-09-28: only the market-data vendor is still open; the other two
rows are resolved as noted in them.)

| Blocker | Needed from | Unblocks |
|---|---|---|
| **Vercel project access** (who owns it; which repo it deploys) — *updated 2026-09-24: the owner decided to relink production to a new DDL Labs–owned Vercel project building `ddllabs/niyantran` `main`, because the old project is inaccessible*; *resolved 2026-09-28: the DDL Labs project serves `niyantran-six.vercel.app` from `main`; the nter.pro cutover is D2 in `open-work.md`* | ~~Owner of the nter.pro Vercel project (likely ItsCloudDev)~~ DDL Labs: create the new project and relink production to it | Any of this work — and the Supabase auth, research chat and persona work — reaching nter.pro |
| **Market data vendor** chosen (coverage of NSE/BSE indices incl. India VIX, display/redistribution rights, delay, price) | Product/business decision | Phase 3 (markets fetcher) |
| **Google OAuth client ID + secret** — *updated 2026-09-24: a new DDL Labs–owned Google OAuth client can be created for Supabase Auth's native Google provider; the old credentials are not needed*; *2026-09-28: the code port is done (`GoogleSignInButton.jsx` calls `signInWithOAuth`); creating the OAuth client is D2 in `open-work.md`* | ~~Owner of the Google Cloud project whose OAuth client authorises `https://nter.pro` (the dev-branch commits are by ItsCloudDev)~~ DDL Labs: create the OAuth client | Google sign-in port (section 9) |

Resume order once unblocked:
1. Agree the schema (4.1 open questions) and the news decision (7.2).
2. Phases 1 → 2 → 4 (no vendor needed); phase 3 with Yahoo as a labelled
   stop-gap or the chosen vendor; phase 5 last.
3. Before starting, re-check section 2's facts — file dates, what nter.pro
   serves, and whether `homeStatic.js` still reads the same files — since the
   repo and the deploy may have moved on.

## 9. Related parked work: Google sign-in (dev branch)

Recorded here so it is picked up with the same context. (corrected 2026-09-28:
the `dev` branch has been deleted and the port below is done:
`GoogleSignInButton.jsx` uses Supabase's OAuth redirect, and
`server/googleAuth.mjs`, `googleAuthClient.js` and `google-auth-library` are not
in `main`. The bullets are kept as
the record of the decision.)

- `origin/dev` has two commits by ItsCloudDev (5675997 "Add Google Sign-In with
  server ID-token verification", 25723f7 "Reorder signup: persona and details
  first, plan after, Google below create"), branched from 570c3f1 (2026-09-19).
- A test merge into main conflicts in 5 files: `package.json` (1 hunk) and
  `vite.config.js` (1) are trivial; `LoginPage.jsx` (4), `SignupPage.jsx` (9)
  and `package-lock.json` are not.
- **Do not merge.** Dev's Google flow verifies the ID token on the local Node
  server and creates a user in the local SQLite `users` table / browser seat —
  the pre-Supabase model. Main now signs in with Supabase Auth and, since
  8c9c4fb, refuses browser-seat authority. A merged Google user would look
  signed in with no Supabase session: no research chat, no RLS access, no
  persona.
- **Port instead:** keep `GoogleSignInButton.jsx`, the GIS script loader in
  `googleAuthClient.js`, and the signup reorder; replace the server exchange
  with Supabase's Google provider (`signInWithIdToken` or the OAuth redirect).
  Drop `server/googleAuth.mjs`, the `users.google_sub` column and
  `google-auth-library`. New users get a `user_profiles` row from the existing
  `on_auth_user_created` trigger. ~0.5 day.
- Needs, from the user: the OAuth client ID + secret entered in Supabase
  (Authentication → Providers → Google), `http://localhost:5173` added as an
  authorised origin, and Supabase's callback URL as an authorised redirect.
- Neither the dev branch nor any local env file holds the keys (checked
  2026-09-23; `.env.example` on dev has empty `VITE_GOOGLE_CLIENT_ID` /
  `GOOGLE_CLIENT_ID` only).
