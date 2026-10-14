# Admin "API status" screen and the "800+ APIs" — audit

Status: Historical (dated 2026-10-14). Read-only audit of `main` at `05ddc2f`. Nothing in the repository was changed.

Evidence labels: **Measured** = a command was run on 2026-10-14 (results in `module-audit/probe/`). **Read** = read from code at `05ddc2f`.

## Short answer to the owner

- **Same APIs, different place.** The API status screen calls no outside API itself. For each of its 138 rows, "Refresh", "Refresh live", "Refresh all" and the automatic sweep call our own `/api/feature-feed?tier=…&feature=…`. The module pages call the same route, and so do F154, F159 and F160 (read). The outside sources behind it (Google News, PIB, World Bank, Wikidata, GDELT…) are the ones the module feed work deals with.
- **The screen never shows "Success 200".** No HTTP status code appears anywhere on it (read: `src/admin/AdminPages.jsx`, `src/lib/refreshFeeds.js`, `src/lib/apiStatus.js`; no "Success" or status-code string). It shows a coloured pill (Live / Archive / Local pack / Inactive), a row count and "Last refreshed N ago". The "API URL" column links to the upstream URL, such as a Google News RSS search, and opening that link in a browser would show the source answering. That may be where the owner saw "200". This is a guess and was not verified.
- **On production the pill is mostly hard-coded.** It comes from a curated list of 40 rows plus a regex rule over the registry. Before any network call it reads 130 Live / 3 Archive / 0 Local / 5 Inactive, and after a full probe of all 138 rows against production it still reads **130 / 3 / 0 / 5** (measured). The probe changes only the "Rows" and "Last refreshed" cells. In 11 rows the probe's own verdict was the opposite of the pill, and the screen kept the pill.
- **"Live" on this screen does not mean live data.** Of the 130 rows labelled Live, 71 got live rows from an outside source in time. 49 serve a stored register (no outside call at all, for example the Goa booth packs and the Open Fronts register). 5 served stored rows because live failed or ran out of time. 4 served nothing. 1 (Transit) is never requested on the live site.
- **"800+ APIs" is not a count of APIs.** No "800" figure appears in the code or the docs. The closest number is about **817 distinct website hosts** in the URLs inside our shipped data files (796,669 distinct URLs). These are per-row source links: court judgment PDFs, sanctioned companies' websites, news articles. 727 of those hosts appear in exactly one URL. The real API inventory is much smaller: **138 registry connectors**, **246 unique registry source URLs** (the figure the marketing site uses, `src/lib/siteFigures.js:16`), **32 registry domains**, about **60 hosts** in server code, and **269 outside requests to roughly 20 hosts** in one live pass of every module (F160 spec §1.4, recorded).
- **Where it duplicates work:** the screen keeps its own refresh cadence (default 6 h, kept in the admin's browser). It ignores the registry's own `refreshMinutes`, which F160 plans to use, and duplicates the optional admin "Feeds" tab that F160 proposes (spec §4.9 and Q6). F160's spec never mentions this screen. Recommendation (§6): rebuild this tab on F160's `feed_snapshots`/`feed_health` and drop the browser-side probing and the hard-coded verdicts. Until F160 lands, it can show what `/api/feature-feed` actually reports (`served`, `fallback`, `source.adapter`, real row count, newest row date).

## 1. What the screen does (read; production mode measured)

### 1.1 Where the list comes from
- `src/admin/AdminApp.jsx:20` adds the nav item `{ id: 'apis', label: 'API status' }`, and `:205` renders `<ApisPage />`.
- `ApisPage` (`src/admin/AdminPages.jsx:216`) builds its rows as `decorateApis(classifyApis())`.
- `classifyApis()` (`src/lib/apiStatus.js:154-175`) maps **every entry of `src/data/source-registry.json`: 138 entries** (measured). That is not "tens of thousands of sourceUrls". The registry's `sourceUrls` fields hold **277 URLs in total, 252 distinct** when split on whitespace and `|,;`, or **246** with the site's own counter (`registryEndpointCount`, `src/lib/siteFigures.js:20-26`). The registry covers 138 of the 169 modules in `html-feature-map.json`. The other 31 are the HTML-ONLY State (15) and Local (16) planned modules, which the screen does not list.
- The status comes first from the hard-coded **`CURATED` list (`apiStatus.js:10-51`, 40 rows, all 40 match a registry entry)**, else from `heuristic()` (`:85-152`). The heuristic labels any entry whose URL contains `news.google.com` or `gdeltproject.org` as Live (`isNewsSearchFeed`, `:70-83`) even when it has 0 rows. In the registry, 131 entries list `api.gdeltproject.org` and 59 list `news.google.com`.
- Static result (measured with the real module): **130 Live, 3 Archive, 0 Local, 5 Inactive**. 88 of the 130 carry a generic "Live News RSS / reporting search configured · probe the desk to confirm current rows" or "…· archive fallback ready" note (56 + 24 + 8).
- Every registry entry also carries the fixed strings `sourceStatus: "Direct feed configured"`, `directFeedCheck: "PASS"`, `access: "Open/Keyless direct feed"` and `auth: "none"` (138 of 138). These are seed metadata, not results of any check.

### 1.2 What "Refresh" / "Refresh live" / "Refresh all" / auto-sweep request
| Trigger | Code | What it requests |
|---|---|---|
| Row "Refresh" | `AdminPages.jsx:259-266` → `refreshOne` (`refreshFeeds.js:249-253`) → `probeOne` (`:48-56`) → `fetchFeature({tier, feature})` (`src/lib/featureFeed.js:180`) | `GET /api/feature-feed?tier=<htmlTier>&feature=<htmlFeature>` (`featureFeed.js:246-256`, `requestFeatureFeed` `:79-88`), same origin. If that has no real rows: the shipped archive, `fetchArchiveFeature` (`src/lib/archiveFeed.js:314`), which reads `/data/embedded_csv/<dataset>.json` (`:254`, `:263`) and, for a few modules, `/api/constitutions` (`:589`), `/api/growth` (`:612`) or a GDELT URL (`:637`) |
| "Refresh live" / "Refresh all" | `AdminPages.jsx:49-53` → `sweepApis({scope})` (`refreshFeeds.js:220-247`) | The same probe for every row whose *static* status is Live (130) or for all 138, three at a time (`CONCURRENCY = 3`, `:16`). Then `fetch('/api/home/refresh')` (`:238`), but only when `liveApiEnabled()`, which is false on production (below) |
| Auto sweep | `AdminApp.jsx:105-116`: every 30 s while an admin tab is open, `if (isDue()) sweepApis({scope:'live'})` | Same as "Refresh live". It runs only in an open, signed-in admin browser tab. There is no server cron |
| Page open | `AdminPages.jsx:225-231` (also Overview `:141-144`) | `healStaticHostProbes()` rewrites stored probes (no network). `healStaleInactiveProbes()` re-probes, but only when `liveApiEnabled()` |
| Transit row | `featureFeed.js:188-226` | `/api/air` only when `liveApiEnabled()`; on production it goes straight to the shipped `seaborne_ais.json` (measured: 200, no rows) |

There is no HEAD or ping request, and the browser never calls an upstream URL directly. The upstream call happens inside our Vercel function (`server/featureFeed.mjs`, `serveFeatureFeedWithBackup` → `serveFeatureFeedWithinLimit` `:3740-3767`, with F154's 4 s limit). The real screen sends the same URL as the module pages, with no cache-buster, so it may get Vercel's edge-cached answer (edge policy for `/api/feature-feed`: `src/lib/apiCachePolicy.js:29`, `api/router.js:76`, `:166`). A "Refresh" therefore does not force a fresh pull, and it warms or pins the same edge cache readers use.

### 1.3 What counts as "success"
`outcome()` (`refreshFeeds.js:18-46`). The HTTP status is never read. `hasRealRows(body)` (`archiveFeed.js:308-312`) checks only that row 0 is not `status: 'source_status'`.
- **On production:** `liveApiEnabled()` is false, and real rows with a static status of Live give `status: 'live'`, whatever `fallback` or `served` says (`:30-32`). A shipped pack, a 4-second timeout answer and a stored register all count as Live.
- `liveApiEnabled()` (`src/lib/apiMode.js:7-15`) is false in a production build unless `VITE_LIVE_API=1`. **Measured in the live bundle:** `assets/index-C_ewO1Dh.js` contains `function XR(){try{return!1}catch{return!1}}` (liveApiEnabled), followed by `FE`/`QR` returning `!0` (homeLiveApiEnabled, featureFeedApiEnabled).
- `decorateApis()` (`refreshFeeds.js:74-139`) then overrides the probe for display. On a static host a Live row's archive, inactive or local probe is shown as Live (`:83-90`). An Inactive or Archive row's Live probe is shown as the static status (`:91-93`). A Live row's Inactive probe is discarded (`probe = null`, `:94-105`). A hard-coded list of 13 registry keys has Archive probes promoted to Live (`:106-125`, repeated in `healStaleInactiveProbes` `:169-189`).
- **Net effect, measured:** the pill equals the static classification for all 138 rows after a full probe.

### 1.4 Where results are saved; the "saved cadence"
- **Only in the admin's browser `localStorage`:** `niyantranRefreshCfg` = `{intervalHours, lastLiveSweep, lastFullSweep, auto}` and `niyantranRefreshProbes` = `{[registryKey]: {ok, fallback, rows, status, error, at}}` (`src/lib/refreshStore.js:1-2`, `:26-64`). No database, no server and no other admin sees them. The progress bar lives in module memory (`:7-14`).
- **Cadence:** `DEFAULT_INTERVAL_HOURS = 6` (`refreshStore.js:5`). The admin can save 0.25 to 72 h (`AdminPages.jsx:55-64`). It governs only when an open admin tab re-probes, and only the "due" marker in the table (`:318`, `:338-342`). It does not change when data is fetched for readers. The registry's per-source `refreshMinutes` (5 min to 1 week) is returned by `classifyApis` (`apiStatus.js:169`) but never shown or used.

### 1.5 Does a "Live" pill mean the module shows fresh rows?
No. See the table in §3. Concrete cases (measured on production, 2026-10-14 14:35–14:38 UTC):
- **National Morning Brief**: pill **Live**, Rows "—". Production: 200 in 4.07 s, `served: 'archive'`, one status row only ("Live data is taking longer than usual."). The probe returned `inactive`, and `decorateApis` discarded it.
- **Top Financial & Business Players** (`economics-business-leaders`): pill **Live**. Production: 4.07 s, `served: 'archive'`, 0 real rows.
- **Transit**: pill **Live**. Production page path: no `/api/feature-feed` call at all, and the shipped `seaborne_ais.json` has no rows.
- **State Fiscal Deep-Dive** (`state-state-finances`) and **Election Forecast Aggregator**: pill **Live**. Production: status row only ("Live extraction is not scheduled for this adapter." / "No Indian election-forecast table exists in this pack.").
- **Geopolitics News Wire**, **NSE/BSE Market Feed**, **Athlete Index**, **Global Music Charts**, **Sports Governance**: pill **Live**. Production: `served: 'archive'`, `fallback: true`, stored rows from the shipped backup. Geopolitics News Wire's newest row is dated 2026-09-10.
- 49 rows labelled **Live** have `source.adapter: 'embedded'`/`'internal'`. Production answers them in 60–300 ms from shipped files, for example Bills (9,819 rows, newest 2026-08-09), Questions (8,000, newest 2026-04-02), the seven Goa booth modules (1,731 each), MP report cards, and Heads of State ("As-of the pack date; not a live Wikidata table").

### 1.6 Stale hard-coded verdicts in `CURATED` (measured against production)
| CURATED row (`apiStatus.js`) | Hard-coded | Production now |
|---|---|---|
| `:22` Cabinet Decisions | archive, "PIB RSS not reachable" | `served: 'live'`, PIB RSS answered in 1.1 s, 1 Cabinet release dated 2026-10-14 ("1 of 20 latest releases"); F125 filter |
| `:21` Regulatory Body Watch | archive, "API not reachable" | `served: 'live'`, RBI/SEBI RSS, 10 rows, newest 2026-10-12 |
| `:50` National Morning Brief | live, "PIB RSS + GDELT … · News RSS fallback" | nothing (4 s limit, status row only). The module page itself uses `/api/rss`, which is 404 on production (F166) |
| `:11` Transit | live, "OpenSky air via /api/air" | `/api/air` is not called on production (`liveApiEnabled` false) |
| `:16` Top Financial & Business Players | live, "Wikidata SPARQL" | nothing (4 s limit) |
| `:48` Geopolitics News Wire | live, "GDELT … else live BBC World RSS (still Live, not Archive)" | stored backup rows (`fallback: true`), newest 2026-09-10 |
| `:28,32,36,43,45` "Google News / GDELT reporting search …" (Alliances, Nuclear Watch, Critical Minerals, AGMUT transfers, Manifestos) | live | all `source.adapter: 'embedded'`: the shipped register, no news search |

Heuristic Inactive rows that do serve data: `economics-world-exchanges` (5 live Yahoo rows), `economics-sector-policy` (25 World Bank rows), `economics-ai-and-tech` (67 stored backup rows), `state-state-tenders` (25 stored backup rows).

## 2. "800+ APIs": where the number could come from (measured)
| What is counted | Count | Source |
|---|---|---|
| Registry connectors (rows on the API status screen) | **138** | `src/data/source-registry.json` |
| Modules in the catalogue | 169 (138 + 31 planned HTML-ONLY) | `src/data/html-feature-map.json` |
| Registry `endpointCount` summed | 266 | registry field |
| Unique registry source URLs (marketing figure) | **246** (252 with a looser split) | `src/lib/siteFigures.js:16` |
| Distinct registry `primaryFeedUrl`s | 121, on 30 hosts | registry |
| Distinct registry domains | 32 (`api.gdeltproject.org` in 131 entries, `news.google.com` 59, `api.github.com` 13, `query.wikidata.org` 11, `api.worldbank.org` 9, …) | registry `domains` |
| Hosts written as literals in server code | about 60 (including non-data hosts: YouTube, Unsplash, Resend, Razorpay, Supabase) | `grep` over `server/*.mjs`, `api/router.js` |
| Outside requests in one live pass of every module | 269 requests from 114 modules; main hosts news.google.com, query.wikidata.org, api.worldbank.org, www.pib.gov.in, api.gdeltproject.org, api.manifold.markets, plus about 10 others | F160 spec §1.4 (recorded, not re-run) |
| **Distinct hosts in URLs inside shipped data** (`public/data`, `src/data`, `backup/*.xlsx`) | **≈ 817** (796,669 distinct URLs) | measured. 661,116 URLs are High Court judgment PDFs on one S3 host. `backup/GLOBAL/F04_Sanctions.xlsx` alone holds 362 hosts (359 found nowhere else: sanctioned entities' websites). 727 hosts occur in exactly one URL |

So the only "800+" in the repository is the number of distinct websites that individual records link to as their source. Those are citations, not APIs we call. The server builds modules from roughly 20–30 outside hosts and 246 configured endpoint URLs (most of them Google News or GDELT search URLs). The owner's figure may instead come from the original upstream product pitch, which is not in this repository; this was not verified.

## 3. Screen verdict vs production reality, per registry entry (measured)

Method: `module-audit/probe/run.mjs` imports the real `src/lib/apiStatus.js`, `src/lib/refreshFeeds.js` and `src/lib/featureFeed.js` under `vite-node` in production mode. The run confirmed `liveApiEnabled() === false` and `featureFeedApiEnabled() === true`, matching the live bundle. It stubs `localStorage`/`window`, rewrites same-origin paths to `https://niyantran-six.vercel.app`, adds `&_audit=<n>` to each `/api/feature-feed` request to skip the edge cache, sends one request at a time at most once every 1.05 s, and blocks any direct browser-side call to an outside host (none of the 138 probes attempted one). It then runs `probeOne` for all 138 rows and `decorateApis` for what the screen would show. Started 2026-10-14T14:35:19Z, finished 14:38:11Z, 138 of 138 done; 138 requests in all (137 `/api/feature-feed` and 1 shipped data file for Transit), all HTTP 200, all `x-vercel-cache: MISS`.

Reality classes, from the production body: **A** = an outside source answered in time (`served: 'live'`, `fallback: false`, adapter `api`/`news-search`/`live`/…, real rows > 0). **B** = a stored register with no outside call (`source.adapter` `embedded`/`internal`). **C** = stored rows with `served: 'archive'`. **D** = nothing (status row only). **E** = `fallback: true` with `served: 'live'`. **F** = not requested.

| Screen pill \ reality | A live | B stored register | C stored (served archive) | D nothing | E fallback | F not requested |
|---|---|---|---|---|---|---|
| Live (130) | 71 | **49** | **5** | **4** | 0 | **1** |
| Archive (3) | **2** | 0 | 0 | 0 | 1 | 0 |
| Inactive (5) | **2** | 0 | **2** | 1 | 0 | 0 |

65 of 138 rows are mismatches, marked in the table below: Live but not A, or not Live but serving rows. Raw data: `probe/full.json` (every request and body summary), `probe/table.json`, `probe/full.log`.


Columns: "Rows column" is what the screen's Rows cell would show after the probe (`lastRows`, or the registry's `embeddedRows` when `decorateApis` discarded the probe). "ms" is the production function's response time for that request. "Newest row date" is the latest `date`/`published` value among the returned rows (blank when the rows carry no date).

| # | Registry key | Screen pill (after probe) | Rows column | Production `/api/feature-feed` now | served / fallback / source.adapter | ms | Newest row date | Verdict |
|---|---|---|---|---|---|---|---|---|
| 1 | global-open-fronts | live | 88 | B: stored register, no outside call (88 real rows) | live / false / embedded | 165 | – | **mismatch** |
| 2 | global-conflicts | live | 14 | B: stored register, no outside call (14 real rows) | live / false / embedded | 69 | 2024-12-01 | **mismatch** |
| 3 | global-global-intelligence | live | 10 | B: stored register, no outside call (10 real rows) | live / false / embedded | 72 | – | **mismatch** |
| 4 | global-transit | live | — | F: no /api/feature-feed call (static host skips /api/air); shipped file has no rows (– real rows) | – / – / – | – | – | **mismatch** |
| 5 | global-alliances | live | 46 | B: stored register, no outside call (46 real rows) | live / false / embedded | 64 | – | **mismatch** |
| 6 | global-sanctions | live | 18 | B: stored register, no outside call (18 real rows) | live / false / embedded | 75 | – | **mismatch** |
| 7 | global-global-aid | live | 16 | B: stored register, no outside call (16 real rows) | live / false / embedded | 74 | – | **mismatch** |
| 8 | global-infra | live | 10 | B: stored register, no outside call (10 real rows) | live / false / embedded | 69 | – | **mismatch** |
| 9 | global-nuclear-watch | live | 112 | B: stored register, no outside call (112 real rows) | live / false / embedded | 87 | – | **mismatch** |
| 10 | global-satellite-infrastructure | live | 12 | A: outside source answered in time (12 real rows) | live / false / live | 67 | – | consistent |
| 11 | global-maritime-choke-points | live | 18 | B: stored register, no outside call (18 real rows) | live / false / embedded | 79 | – | **mismatch** |
| 12 | global-world-constitutions | live | 188 | A: outside source answered in time (188 real rows) | live / false / live | 68 | – | consistent |
| 13 | global-growth-indicators | live | 20 | A: outside source answered in time (20 real rows) | live / false / live | 64 | – | consistent |
| 14 | global-geopolitics-news-wire | live | 38 | C: stored rows (served: archive — time limit or live failure) (38 real rows) | archive / true / embedded | 4122 | 2026-09-10 | **mismatch** |
| 15 | global-heads-of-state | live | 43 | B: stored register, no outside call (43 real rows) | live / false / embedded | 65 | – | **mismatch** |
| 16 | global-global-commodities | live | 24 | B: stored register, no outside call (24 real rows) | live / false / embedded | 61 | – | **mismatch** |
| 17 | global-global-trade | live | 20 | A: outside source answered in time (20 real rows) | live / false / live | 63 | – | consistent |
| 18 | global-critical-minerals | live | 10 | B: stored register, no outside call (10 real rows) | live / false / embedded | 78 | – | **mismatch** |
| 19 | global-energy | live | 14 | B: stored register, no outside call (14 real rows) | live / false / embedded | 67 | – | **mismatch** |
| 20 | national-bill-passage-index | live | 9819 | B: stored register, no outside call (9819 real rows) | live / false / embedded | 298 | 2026-08-09 | **mismatch** |
| 21 | national-policy-intelligence-graph | live | 9819 | B: stored register, no outside call (9819 real rows) | live / false / embedded | 153 | 2026-08-09 | **mismatch** |
| 22 | national-policy-pipeline | live | 20 | A: outside source answered in time (20 real rows) | live / false / api | 1008 | 2026-10-14 | consistent |
| 23 | national-parliamentary-questions | live | 8000 | B: stored register, no outside call (8000 real rows) | live / false / embedded | 222 | 2026-04-02 | **mismatch** |
| 24 | national-regulatory-watch | archive | 10 | A: outside source answered in time (10 real rows) | live / false / live | 111 | 2026-10-12 | **mismatch** |
| 25 | national-candidate-affidavits | live | 483 | B: stored register, no outside call (483 real rows) | live / false / embedded | 67 | – | **mismatch** |
| 26 | national-delimitation-simulator | live | 36 | B: stored register, no outside call (36 real rows) | live / false / internal | 65 | – | **mismatch** |
| 27 | national-manifestos-and-promises | live | 10 | B: stored register, no outside call (10 real rows) | live / false / embedded | 67 | – | **mismatch** |
| 28 | national-statements-and-contradictions | live | 106 | A: outside source answered in time (106 real rows) | live / false / news-search | 4063 | 2026-10-14 | consistent |
| 29 | national-mp-report-cards | live | 782 | B: stored register, no outside call (782 real rows) | live / false / embedded | 72 | – | **mismatch** |
| 30 | national-morning-brief | live | — | D: nothing — served: archive, status row only (0 real rows) | archive / false / news-search | 4067 | 2026-10-14 | **mismatch** |
| 31 | national-central-tenders | archive | 10 | E: stored rows — live source failed inside (10 real rows) | live / true / embedded | 62 | – | consistent |
| 32 | national-ias-ips-transfers-agmut | live | 29 | B: stored register, no outside call (29 real rows) | live / false / embedded | 79 | – | **mismatch** |
| 33 | national-cabinet-decisions | archive | 1 | A: outside source answered in time (1 real rows) | live / false / live | 1092 | 2026-10-14 | **mismatch** |
| 34 | national-central-projects | live | 8 | B: stored register, no outside call (8 real rows) | live / false / embedded | 169 | – | **mismatch** |
| 35 | national-budget-and-schemes | live | 13 | B: stored register, no outside call (13 real rows) | live / false / embedded | 65 | – | **mismatch** |
| 36 | national-industry-updates | live | 26 | A: outside source answered in time (26 real rows) | live / false / live | 216 | 2025-01-01 | consistent |
| 37 | state-constituency-register | live | 40 | B: stored register, no outside call (40 real rows) | live / false / embedded | 78 | – | **mismatch** |
| 38 | state-election-results-2017-2024 | live | 40 | B: stored register, no outside call (40 real rows) | live / false / embedded | 70 | – | **mismatch** |
| 39 | state-split-ticket-and-competitiveness | live | 40 | B: stored register, no outside call (40 real rows) | live / false / embedded | 78 | – | **mismatch** |
| 40 | state-mla-directory | live | 500 | A: outside source answered in time (500 real rows) | live / false / api | 261 | – | consistent |
| 41 | state-mla-performanc-meter | live | 495 | A: outside source answered in time (495 real rows) | live / false / api | 858 | 2026-10-14 | consistent |
| 42 | state-roll-demography | live | 40 | B: stored register, no outside call (40 real rows) | live / false / embedded | 69 | – | **mismatch** |
| 43 | state-community-bloc-matrix | live | 40 | B: stored register, no outside call (40 real rows) | live / false / embedded | 82 | – | **mismatch** |
| 44 | state-sir-roll-churn | live | 40 | B: stored register, no outside call (40 real rows) | live / false / embedded | 103 | – | **mismatch** |
| 45 | state-registration-gap | live | 40 | B: stored register, no outside call (40 real rows) | live / false / embedded | 118 | – | **mismatch** |
| 46 | state-district-media-monitor | live | 53 | A: outside source answered in time (53 real rows) | live / false / news-search | 78 | 2026-10-14 | consistent |
| 47 | state-district-profiles | live | 500 | A: outside source answered in time (500 real rows) | live / false / api | 304 | – | consistent |
| 48 | state-state-governance-brief | live | 120 | A: outside source answered in time (120 real rows) | live / false / news-search | 935 | 2026-10-14 | consistent |
| 49 | state-assembly-proceedings | live | 37 | A: outside source answered in time (37 real rows) | live / false / news-search | 604 | 2026-10-14 | consistent |
| 50 | state-governor-and-assent | live | 24 | A: outside source answered in time (24 real rows) | live / false / news-search | 459 | 2026-10-14 | consistent |
| 51 | state-cabinet-decisions | live | 100 | A: outside source answered in time (100 real rows) | live / false / news-search | 732 | 2026-10-14 | consistent |
| 52 | state-state-cadre-transfers | live | 56 | A: outside source answered in time (56 real rows) | live / false / news-search | 591 | 2026-10-14 | consistent |
| 53 | state-state-tenders | inactive | 25 | C: stored rows (served: archive — time limit or live failure) (25 real rows) | archive / true / embedded | 64 | 2026-09-10 | **mismatch** |
| 54 | state-cag-audit-tracker | live | 39 | A: outside source answered in time (39 real rows) | live / false / news-search | 66 | 2026-10-14 | consistent |
| 55 | state-state-finances | live | — | D: nothing — status row only (0 real rows) | live / false / download-or-html | 64 | 2026-10-14 | **mismatch** |
| 56 | state-centre-state-fund-flows | live | 11 | A: outside source answered in time (11 real rows) | live / false / api | 156 | – | consistent |
| 57 | local-local-governance-brief | live | 11 | B: stored register, no outside call (11 real rows) | live / false / embedded | 72 | – | **mismatch** |
| 58 | local-booth-level-results | live | 1731 | B: stored register, no outside call (1731 real rows) | live / false / embedded | 97 | – | **mismatch** |
| 59 | local-booth-register | live | 1731 | B: stored register, no outside call (1731 real rows) | live / false / embedded | 138 | – | **mismatch** |
| 60 | local-booth-demography | live | 1731 | B: stored register, no outside call (1731 real rows) | live / false / embedded | 112 | – | **mismatch** |
| 61 | local-booth-bloc-composition | live | 1731 | B: stored register, no outside call (1731 real rows) | live / false / embedded | 143 | – | **mismatch** |
| 62 | local-booth-level-roll-churn | live | 1731 | B: stored register, no outside call (1731 real rows) | live / false / embedded | 108 | – | **mismatch** |
| 63 | local-booth-political-history | live | 1731 | B: stored register, no outside call (1731 real rows) | live / false / embedded | 190 | – | **mismatch** |
| 64 | local-swing-booths | live | 20 | B: stored register, no outside call (20 real rows) | live / false / embedded | 93 | – | **mismatch** |
| 65 | local-anchor-booths | live | 20 | B: stored register, no outside call (20 real rows) | live / false / embedded | 76 | – | **mismatch** |
| 66 | local-hyperlocal-news | live | 100 | A: outside source answered in time (100 real rows) | live / false / news-search | 1106 | 2026-10-14 | consistent |
| 67 | local-municipal-watch | live | 100 | A: outside source answered in time (100 real rows) | live / false / news-search | 817 | 2026-10-14 | consistent |
| 68 | local-panchayat-watch | live | 100 | A: outside source answered in time (100 real rows) | live / false / news-search | 764 | 2026-10-14 | consistent |
| 69 | local-municipal-tenders | inactive | 0 | D: nothing — status row only (0 real rows) | live / false / scrape | 79 | 2026-10-14 | consistent |
| 70 | local-municipal-finance | live | 100 | A: outside source answered in time (100 real rows) | live / false / news-search | 919 | 2026-10-14 | consistent |
| 71 | local-mgnrega-works | live | 100 | A: outside source answered in time (100 real rows) | live / false / news-search | 960 | 2026-10-14 | consistent |
| 72 | local-gpdp-fund-tracker | live | 100 | A: outside source answered in time (100 real rows) | live / false / news-search | 879 | 2026-10-14 | consistent |
| 73 | local-councillor-and-pradhan-cards | live | 100 | A: outside source answered in time (100 real rows) | live / false / news-search | 953 | 2026-10-14 | consistent |
| 74 | local-local-officer-directory | live | 100 | A: outside source answered in time (100 real rows) | live / false / news-search | 963 | 2026-10-14 | consistent |
| 75 | law-supreme-court-feed | live | 220 | B: stored register, no outside call (220 real rows) | live / false / embedded | 81 | 2026-07-02 | **mismatch** |
| 76 | law-order-archive | live | 220 | B: stored register, no outside call (220 real rows) | live / false / embedded | 85 | 2026-07-02 | **mismatch** |
| 77 | law-district-court-case-tracker | live | 55 | A: outside source answered in time (55 real rows) | live / false / news-search | 186 | 2026-10-14 | consistent |
| 78 | law-allahabad-hc-feed | live | 76 | A: outside source answered in time (76 real rows) | live / false / news-search | 71 | 2026-10-14 | consistent |
| 79 | law-ngt-litigation | live | 49 | A: outside source answered in time (49 real rows) | live / false / news-search | 83 | 2026-10-14 | consistent |
| 80 | law-cat-and-ncdrc-watch | live | 50 | A: outside source answered in time (50 real rows) | live / false / news-search | 518 | 2026-10-14 | consistent |
| 81 | law-constitution-benches | live | 16 | A: outside source answered in time (16 real rows) | live / false / news-search | 387 | 2026-10-14 | consistent |
| 82 | law-hc-pil-tracker | live | 65 | A: outside source answered in time (65 real rows) | live / false / news-search | 747 | 2026-10-14 | consistent |
| 83 | law-hc-vs-state | live | 100 | A: outside source answered in time (100 real rows) | live / false / news-search | 682 | 2026-10-14 | consistent |
| 84 | law-judge-analytics | live | 100 | A: outside source answered in time (100 real rows) | live / false / news-search | 1018 | 2026-10-14 | consistent |
| 85 | law-pendency-and-disposal | live | 100 | A: outside source answered in time (100 real rows) | live / false / news-search | 838 | 2026-10-14 | consistent |
| 86 | law-citation-network | live | 100 | A: outside source answered in time (100 real rows) | live / false / news-search | 995 | 2026-10-14 | consistent |
| 87 | law-hc-pendency | live | 51 | A: outside source answered in time (51 real rows) | live / false / news-search | 636 | 2026-10-14 | consistent |
| 88 | law-hc-bench-analytics | live | 38 | A: outside source answered in time (38 real rows) | live / false / news-search | 619 | 2026-10-14 | consistent |
| 89 | law-district-pendency | live | 100 | A: outside source answered in time (100 real rows) | live / false / news-search | 770 | 2026-10-14 | consistent |
| 90 | law-case-law-library | live | 55 | A: outside source answered in time (55 real rows) | live / false / news-search | 765 | 2026-10-14 | consistent |
| 91 | law-icc-proceedings | live | 100 | A: outside source answered in time (100 real rows) | live / false / news-search | 672 | 2026-10-14 | consistent |
| 92 | law-icj-proceedings | live | 49 | A: outside source answered in time (49 real rows) | live / false / news-search | 511 | 2026-10-14 | consistent |
| 93 | law-wto-dispute-settlement | live | 646 | B: stored register, no outside call (646 real rows) | live / false / embedded | 71 | 2026-07-27 | **mismatch** |
| 94 | law-regional-courts | live | 100 | A: outside source answered in time (100 real rows) | live / false / news-search | 1068 | 2026-10-14 | consistent |
| 95 | law-us-supreme-court | live | 20 | A: outside source answered in time (20 real rows) | live / false / api | 2772 | 2026-09-25 | consistent |
| 96 | law-commonwealth-courts | live | 100 | A: outside source answered in time (100 real rows) | live / false / news-search | 1016 | 2026-10-14 | consistent |
| 97 | law-insolvency-courts | live | 434 | B: stored register, no outside call (434 real rows) | live / false / embedded | 76 | 2026-08-08 | **mismatch** |
| 98 | law-sector-tribunals | live | 78 | A: outside source answered in time (78 real rows) | live / false / news-search | 554 | 2026-10-14 | consistent |
| 99 | law-hearing-scheduler | live | 100 | A: outside source answered in time (100 real rows) | live / false / news-search | 1181 | 2026-10-14 | consistent |
| 100 | law-hc-cause-lists | live | 100 | A: outside source answered in time (100 real rows) | live / false / news-search | 753 | 2026-10-14 | consistent |
| 101 | law-district-court-cause-lists | live | 100 | A: outside source answered in time (100 real rows) | live / false / news-search | 742 | 2026-10-14 | consistent |
| 102 | law-court-directory | live | 100 | A: outside source answered in time (100 real rows) | live / false / news-search | 662 | 2026-10-14 | consistent |
| 103 | law-prisons-and-undertrials | live | 100 | A: outside source answered in time (100 real rows) | live / false / news-search | 765 | 2026-10-14 | consistent |
| 104 | law-legal-aid-and-lok-adalats | live | 100 | A: outside source answered in time (100 real rows) | live / false / news-search | 711 | 2026-10-14 | consistent |
| 105 | economics-equity-market-feed | live | 144 | C: stored rows (served: archive — time limit or live failure) (144 real rows) | archive / true / embedded | 4066 | – | **mismatch** |
| 106 | economics-world-exchanges | inactive | 5 | A: outside source answered in time (5 real rows) | live / false / api | 437 | 2026-10-14 | **mismatch** |
| 107 | economics-country-economies | live | 186 | A: outside source answered in time (186 real rows) | live / false / api | 208 | – | consistent |
| 108 | economics-key-indicators | live | 186 | A: outside source answered in time (186 real rows) | live / false / api | 144 | – | consistent |
| 109 | economics-trade-and-sanctions | live | 229 | B: stored register, no outside call (229 real rows) | live / false / embedded | 68 | 2026-08-05 | **mismatch** |
| 110 | economics-economic-simulator | live | 36 | A: outside source answered in time (36 real rows) | live / false / api | 111 | 2025-01-01 | consistent |
| 111 | economics-sector-policy | inactive | 25 | A: outside source answered in time (25 real rows) | live / false / api | 113 | – | **mismatch** |
| 112 | economics-business-leaders | live | — | D: nothing — served: archive, status row only (0 real rows) | archive / false / api | 4068 | 2026-10-14 | **mismatch** |
| 113 | economics-ai-and-tech | inactive | 67 | C: stored rows (served: archive — time limit or live failure) (67 real rows) | archive / true / embedded | 252 | 2026-09-10 | **mismatch** |
| 114 | economics-political-prediction-markets | live | 250 | A: outside source answered in time (250 real rows) | live / false / api | 2510 | 9999-12-31 | consistent |
| 115 | economics-election-forecasts | live | — | D: nothing — status row only (0 real rows) | live / false / news-search | 64 | 2026-10-14 | **mismatch** |
| 116 | carbon-carbon-border-cbam-watch | live | 7 | B: stored register, no outside call (7 real rows) | live / false / embedded | 75 | 2026-01-01 | **mismatch** |
| 117 | carbon-global-carbon-pricing-tracker | live | 52 | B: stored register, no outside call (52 real rows) | live / false / embedded | 61 | – | **mismatch** |
| 118 | carbon-carbon-price-monitor | live | 242 | B: stored register, no outside call (242 real rows) | live / false / embedded | 60 | 2025-01-01 | **mismatch** |
| 119 | carbon-ets-and-tax-adoption-timeline | live | 52 | B: stored register, no outside call (52 real rows) | live / false / embedded | 73 | – | **mismatch** |
| 120 | carbon-india-ccts-and-green-credits | live | 6 | B: stored register, no outside call (6 real rows) | live / false / embedded | 70 | 2025-10-01 | **mismatch** |
| 121 | carbon-carbon-registry-wire | live | 24 | A: outside source answered in time (24 real rows) | live / false / api | 198 | 2026-10-13 | consistent |
| 122 | carbon-climate-newswire | live | 72 | A: outside source answered in time (72 real rows) | live / false / api | 3030 | 2026-10-14 | consistent |
| 123 | sports-cricket-wire | live | 100 | A: outside source answered in time (100 real rows) | live / false / api | 181 | 2026-10-14 | consistent |
| 124 | sports-fixtures-and-results-world-leagues | live | 7 | A: outside source answered in time (7 real rows) | live / false / api | 470 | 2026-10-17 | consistent |
| 125 | sports-football-wire | live | 80 | A: outside source answered in time (80 real rows) | live / false / api | 266 | 2026-10-14 | consistent |
| 126 | sports-isl-tracker | live | 1 | A: outside source answered in time (1 real rows) | live / false / api | 380 | 2026-10-14 | consistent |
| 127 | sports-indian-sports-wire | live | 100 | A: outside source answered in time (100 real rows) | live / false / api | 719 | 2026-10-14 | consistent |
| 128 | sports-sports-governance-and-policy | live | 34 | C: stored rows (served: archive — time limit or live failure) (34 real rows) | archive / true / embedded | 84 | 2026-09-10 | **mismatch** |
| 129 | sports-sports-business-and-media-rights | live | 80 | A: outside source answered in time (80 real rows) | live / false / api | 249 | – | consistent |
| 130 | sports-athlete-index | live | 500 | C: stored rows (served: archive — time limit or live failure) (500 real rows) | archive / true / embedded | 4566 | – | **mismatch** |
| 131 | entertainment-tv-and-streaming-tonight | live | 133 | A: outside source answered in time (133 real rows) | live / false / api | 979 | 2026-10-15 | consistent |
| 132 | entertainment-box-office-tracker | live | 245 | A: outside source answered in time (245 real rows) | live / false / api | 246 | 2027-01-01 | consistent |
| 133 | entertainment-entertainment-news-wire | live | 10 | A: outside source answered in time (10 real rows) | live / false / api | 93 | 2026-10-14 | consistent |
| 134 | entertainment-bollywood-and-film-wire | live | 100 | A: outside source answered in time (100 real rows) | live / false / api | 1081 | 2026-10-14 | consistent |
| 135 | entertainment-music-charts-india-top-25 | live | 25 | A: outside source answered in time (25 real rows) | live / false / api | 1801 | 2026-10-05 | consistent |
| 136 | entertainment-music-charts-global-top-25 | live | 100 | C: stored rows (served: archive — time limit or live failure) (100 real rows) | archive / true / embedded | 4105 | 2026-08-27 | **mismatch** |
| 137 | entertainment-ott-and-studio-intelligence | live | 87 | A: outside source answered in time (87 real rows) | live / false / api | 246 | – | consistent |
| 138 | entertainment-celebrity-influence-index | live | 246 | A: outside source answered in time (246 real rows) | live / false / api | 128 | – | consistent |

## 4. Same APIs, or reinventing the wheel?

**The same pipeline.** Every row on the screen is one module's `/api/feature-feed` call, the request the module page makes (`src/desks/DeskView.jsx:196,204`, `DeskLandingView.jsx:77` → `fetchFeature`).
- **F154** put a 4 s limit on that route's server side (`serveFeatureFeedWithinLimit`).
- **F159** changed the wording and retries readers see when that route answers `served: 'archive'`.
- **F160** proposes moving that route's outside fetches into scheduled jobs that write `feed_snapshots`/`feed_runs`.

So the screen observes the same upstream sources that F154, F159 and F160 deal with. The modules are not being fixed against a different set of APIs.

**What overlaps or conflicts:**
1. **Two refresh schedules plus a third planned.**
   - The admin's browser cadence: default 6 h, in localStorage, and it runs only while an admin tab is open.
   - The registry's `refreshMinutes`: 61 entries at 15 min, 4 at 60 min, 69 at 6 h, 3 weekly, 1 at 5 min; unused today.
   - F160's per-class schedule, which reads `refreshMinutes`.
   
   The admin "Refresh" does not refresh anything for readers. At most it warms the edge cache for the same URL.
2. **Two "is this source healthy?" views.** This tab, and F160's `feed_health` view plus its optional admin "Feeds" tab (spec §4.9, open question 6). The F160 spec does not mention this tab. Without a decision there will be two admin health screens with different answers.
3. **Load on the sources.** "Refresh all" makes the admin's browser pull every module (138 function calls, three at a time). Each one goes out live when the edge cache misses, including PIB's 41-request modules and GDELT, which already rate-limits us (F160 §1.4). F160's design avoids this; the screen bypasses it.
4. **Hard-coded truth.** The 40 `CURATED` rows, 13 hard-coded promotion keys (`refreshFeeds.js:110-122`, `:172-184`), and regex note matching (`:24-27`) decide the pill. Every fix to a module (F125 Cabinet filter, F159 notes, F166) leaves this screen stale unless someone edits these lists too. The audit's open-work entry already notes that "status labels in `src/lib/apiStatus.js` call embedded packs 'live'" (`docs/plans/open-work.md:237`), and this is still true (49 rows).

## 5. Other findings (out of scope, reported only)
- **`/api/home/refresh` from the sweep (`refreshFeeds.js:238`):** this call is skipped on production (`liveApiEnabled` false). The route itself is public (F167).
- **Morning Brief on the live site:** cannot load at all (F166). The screen shows it as Live.
- **Edge-cached pending answers:** an empty `served: 'archive'` answer is edge-cached (F168). A probe without a cache-buster can read that cached empty answer.
- **`hasRealRows` checks only row 0** (`archiveFeed.js:308-312`). A body that mixes a status row with real rows would be judged by its first row only. Not observed in this run.

## 6. Recommended fix for the screen (not implemented)
Recommended direction: make the tab a read-out of server-side truth, not a browser-side prober with hard-coded verdicts.

**Phase 0, now, small (no F160 dependency):**
1. Delete `CURATED`, the regex heuristic and the hard-coded promotion lists as sources of the pill (`apiStatus.js:10-152`, `refreshFeeds.js:18-46`, `:74-214`).
2. Derive each row's state only from the `/api/feature-feed` body the pages also get:
   - `served` (`live` | `archive`), `fallback` and `source.adapter`. Show `embedded`/`internal` as "Stored register (no outside source)", not Live.
   - The real row count, the newest row date, and `source.diagnostic` as the reason.
3. Show "Live" only for `served: 'live'`, `fallback: false`, a non-embedded adapter and real rows > 0. Today that is 75 of 138, not 130.
4. Show response time, and say whether the answer came from the edge cache (`x-vercel-cache`).
5. Show the registry `refreshMinutes` instead of a browser-only cadence. Remove the auto-sweep (`AdminApp.jsx:105-116`), or make it explicitly "check now" with a cache-buster and a polite rate.
6. Keep the HTTP status visible if the owner wants a "200" column, but label it plainly. A 200 from `/api/feature-feed` is returned even when the module shows nothing (Morning Brief: 200 with 0 rows).

**With F160 phase 1:**
- Replace the probing entirely with a read of `feed_health`/`feed_snapshots` (age vs interval, `status` ok/fallback/empty, `row_count`, `fetched_at`, `consecutive_failures`, `last_error`) and recent `feed_runs` (per-host status, ms, 429s).
- This is the "Feeds" tab F160 already proposes. Record in F160 (spec §4.9 / Q6 and `docs/plans/open-work.md`) that it **replaces** the API status tab rather than adding a second one.
- The Overview tab's KPI cards and "Fleet mix" (`AdminPages.jsx:136-213`) read the same data and need the same change.

## 7. Verification record
| Command / step | Outcome |
|---|---|
| `node` count over `src/data/source-registry.json` | 138 entries; 277 sourceUrls (252 distinct); 32 domains; 121 distinct primaryFeedUrls; `endpointCount` sum 266 |
| `vite-node --mode production probe/static.mjs` (real `classifyApis`) | 130 Live / 3 Archive / 0 Local / 5 Inactive; 40 CURATED rows, all matched |
| `curl` of production `index.html`, `assets/index-C_ewO1Dh.js`, `assets/AdminApp-buAmvbaW.js` | live build has `liveApiEnabled` compiled to `return!1`; admin chunk contains the same sweep/`/api/home/refresh` code |
| `NODE_ENV=production vite-node --mode production probe/run.mjs` (unsandboxed; Node fetch is blocked in the sandbox) | 138/138 probed against production, 138 requests, all 200, ≤ 1 request per 1.05 s, 0 blocked outside calls; screen after probe = 130/3/0/5 |
| Python scan of URLs in `public/data`, `src/data`, `backup/*.xlsx` | ≈ 817 distinct hosts, 796,669 distinct URLs |
| `grep` for "800+", "800 APIs", "Success", status codes in `src/admin`, `src/lib`, `docs`, `README.md` | no such figure or label |

Not verified: what the owner saw as "Success 200"; whether a real signed-in admin's localStorage holds older probes (the production admin was not opened, per the no-sign-in rule); and whether the edge-cached answers a real (non-cache-busted) probe would get differ from the cache-busted answers measured here. No lint, build or tests were run because no code was changed. Working tree untouched; outputs are only under `module-audit/`.
