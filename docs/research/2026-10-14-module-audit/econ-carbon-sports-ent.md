# Economics, Carbon, Sports, Entertainment — module audit

Status: Historical (dated 2026-10-14). Read-only audit at commit 05ddc2f; production deployment 11cc881 (dpl_Fr4Apq9DXDCJ5aCwfiUjx1yVTwFA).

Evidence: **measured** = prod GET /api/feature-feed (two sequential passes ~10 min apart, cache-busted, all x-vercel-cache MISS), local `serveFeatureFeed` with no time limit, curl/Node of upstreams, archive pass and backup workbooks read locally. **Read** = code paths and history.

## Verdict counts (34 modules)

- STORED-ONLY: 7
- LIVE-OK: 17
- LIVE-BROKEN: 2
- LIVE-SLOW: 6
- PLANNED/EMPTY: 2

## ECONOMICS

| Module | Prod run1 rows (served, ms) | Prod run2 rows (served, ms) | Local live rows (ms) | Stored: archive / backup | Verdict | Cause → fix |
|---|---|---|---|---|---|---|
| NSE/BSE Delayed Market Feed | 144 (archive, stored, 4239) | 144 (live, stored, 4236) | 144 (12019) | 144 / 500 (2021-09-06..2023-09-08) | STORED-ONLY (2026-07-15) | Live NSE call never succeeds (bot User-Agent stalls to timeout); every answer is the frozen 2026-07-15 quote snapshot, and the prepared rows drop the as_of date so the reader cannot see the age. → Send the browser USER_AGENT (as PIB already does) for nseindia.com, with a ~3 s timeout; verify from Vercel bom1 (NSE may also need a cookie preflight on the homepage). Carry as_of into rows so the snapshot date is shown. |
| Live Global Stock Exchanges | 5 (live, 499) | 5 (live, 85) | 5 (2624) | 0 / 500 (2021-09-07..2023-08-31) | LIVE-OK | 5 rows = the 5 configured venues, not a regression. → If more coverage is wanted, extend WORLD_BOARD (e.g. ^NSEI, ^BSESN, ^FTSE, ^N225, ^HSI, ^GDAXI). Registry entry still says Stooq/licensed; correct it. |
| Economic Overview of All Countries | 186 (live, 223) | 186 (live, 64) | 186 (454) | 0 / 0 | LIVE-OK | — → None needed. No stored copy exists, so a World Bank outage gives a status row; consider a snapshot. |
| Key Financial Indicators (GDP, CPI, PMI, Emp-to-Pop) | 186 (live, 287) | 186 (live, 69) | 186 (220) | 0 / 500 (1960-01-01..2025-01-01) | LIVE-OK | — → None. PMI is not supplied (licensed) - label already says so. |
| Sector Policy — Power/Energy/Green/Critical Minerals | 25 (live, 99) | 25 (live, 72) | 25 (98) | 0 / 267 (2023-08-28..2026-08-05) | LIVE-OK | Live and working, but the module shows 25 yearly electricity-access observations, not a policy register; the title promises more than the source supplies. → Product decision: either rename/scope the module or add a real policy source (CEA/MNRE/Mines notifications). |
| Economic Simulator | 36 (live, 112) | 36 (live, 57) | 36 (105) | 0 / 0 | LIVE-OK | — → None for data. No scenario engine exists (labelled). |
| Trade Agreements & Economic Sanctions | 229 (live, stored, 74) | 229 (live, stored, 64) | 229 (1) | 229 / 0 | STORED-ONLY (DGFT notifications, newest year 2026-27) | No live source wired; serves a stored DGFT list. adapter "embedded" served as "live" because it is a file read. → Wire a live DGFT notification scrape or OFAC/EU sanctions list; correct the registry (Comtrade is not used). |
| Top Financial & Business Players | 0 (archive, 4060) | 0 (archive, 4080) | 0 (36216) — Source offline or empty | 0 / 0 | LIVE-BROKEN | Wikidata query times out (HTTP 504 at WDQS); no stored snapshot; production answers a status row after 4 s. → Rewrite the SPARQL without wdt:P279* (e.g. companies with P414 stock exchange = NSE Q638740 / BSE Q12749, or P31 in a fixed list) and keep a stored snapshot for the archive pass. |
| AI & the Tech Industry | 67 (archive, backup, 182) | 67 (archive, backup, 173) | 0 (432) — Source offline or empty | 0 / 67 (2026-08-27..2026-09-10) | LIVE-BROKEN (prod shows STORED backup, 2026-09-10) | PIB redirect to the Hindi feed; English filter empties it. → Use https://www.pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3&reg=3 here and in PIB_PRESS_RSS (featureFeed.mjs:213, used by other desks - report to their auditor). Add a test with a Hindi-only body. |
| Prediction Market Political Odds | 31 (archive, stored, 4057) | 250 (live, 67) | 250 (4289) | 31 / 500 | LIVE-SLOW | Three sequential Manifold calls total ~4.3-5 s, over the 4 s limit; archive is a 31-row snapshot (vs 250 live). → Fetch the three searches in parallel (Promise.all) so the live answer lands in ~2.3 s; refresh the stored snapshot. |
| Election Forecast Aggregator | 0 (live, 51) | 0 (live, 65) | 0 (0) — Source offline or empty | 0 / 0 | PLANNED/EMPTY | No forecast source exists by design. → Product decision; keep labelled as planned. |

## CARBON

| Module | Prod run1 rows (served, ms) | Prod run2 rows (served, ms) | Local live rows (ms) | Stored: archive / backup | Verdict | Cause → fix |
|---|---|---|---|---|---|---|
| Global Carbon Pricing Tracker | 52 (live, stored, 72) | 52 (live, stored, 56) | 52 (3) | 52 / 346 (1990-01-01..2025-01-01) | STORED-ONLY (data year 2025) | Extracted table; no live source (World Bank Carbon Pricing Dashboard is not wired). → Schedule a refresh from the World Bank Carbon Pricing Dashboard export (F160 scheduled data). |
| Carbon Price Monitor | 242 (live, stored, 69) | 242 (live, stored, 68) | 242 (3) | 242 / 0 | STORED-ONLY (data year 2025) | Extracted table; registry claims Google News, code never calls it. → Scheduled refresh; correct the registry adapter. |
| ETS & Tax Adoption Timeline | 52 (live, stored, 57) | 52 (live, stored, 60) | 52 (2) | 52 / 0 | STORED-ONLY (through 2025) | Reference table; slow-changing, acceptable. → Annual refresh. |
| Carbon Border (CBAM) Watch | 7 (live, stored, 59) | 7 (live, stored, 68) | 7 (2) | 7 / 7 (2023-05-17..2026-01-01) | STORED-ONLY (newest milestone 2026-01-01) | Hand-extracted milestone table; small by nature. → Add later milestones (2026 definitive-period acts) on a schedule. |
| India CCTS & Green Credits | 6 (live, stored, 60) | 6 (live, stored, 63) | 6 (1) | 6 / 6 (2022-12-19..2025-10-01) | STORED-ONLY (newest 2025-10-01) | Hand-extracted; one year without update. → Refresh from BEE/MoEFCC notifications. |
| Carbon Registry Wire | 24 (live, 218) | 24 (live, 126) | 24 (703) | 24 / 500 | LIVE-OK | Live Verra items merged with stored Isometric/Puro rows (labelled as a blend). → None urgent. |
| Climate Newswire | 72 (live, 2701) | 72 (live, 2427) | 72 (2985) | 38 / 0 | LIVE-OK (near limit) | — → Watch latency; refresh stored snapshot. |

## SPORTS

| Module | Prod run1 rows (served, ms) | Prod run2 rows (served, ms) | Local live rows (ms) | Stored: archive / backup | Verdict | Cause → fix |
|---|---|---|---|---|---|---|
| Cricket Wire | 100 (live, 201) | 100 (live, 206) | 100 (731) | 0 / 74 (2026-03-28..2026-05-31) | LIVE-OK | — → No stored copy for the archive pass; add one. |
| Fixtures & Results — World Leagues | 7 (live, 467) | 7 (live, 79) | 7 (806) | 0 / 0 | LIVE-OK (thin: 7 rows) | Upstream free-tier limit of one event per request. → Use ESPN scoreboards with ?dates=YYYY&limit=400 per league (eng.1, esp.1, nba) or a paid TheSportsDB key. |
| Football Wire | 80 (live, 389) | 80 (live, 309) | 80 (335) | 0 / 500 (2025-01-01..2026-03-22) | LIVE-OK | — → None. |
| ISL Tracker | 1 (live, 324) | 1 (live, 62) | 1 (618) | 0 / 325 (2024-01-31..2026-05-21) | LIVE-OK (but 1 row - the owner's "reduced to 1") | Live API, but queried without a date range, so only today's matchday is returned. → Query ?dates=<season years>&limit=400 (or two year queries across the season) and keep the default call as the live-score overlay. |
| Indian Sports Wire | 100 (live, 1106) | 100 (live, 718) | 100 (1198) | 0 / 71 (2026-08-31..2026-09-10) | LIVE-OK | — → None. |
| Sports Governance & Policy | 34 (archive, backup, 121) | 34 (archive, backup, 78) | 0 (1) — Module planned | 0 / 34 (2026-08-29..2026-09-10) | PLANNED/EMPTY (prod shows STORED backup headlines, 2026-09-10) | No source; backup fallback fills a planned module with month-old news labelled "exhaustive". → Exclude planned modules from applyBackupFallback, or wire a real MYAS source. |
| Sports Business & Media Rights | 80 (live, 992) | 80 (live, 1003) | 80 (16304) | 0 / 0 | LIVE-SLOW (cold Wikidata up to 16 s) | Wikidata latency; no stored copy. → Stored snapshot refreshed daily; serve it first. |
| Athlete Index | 151 (live, 1147) | 500 (archive, backup, 4587) | 151 (770) | 0 / 500 | LIVE-SLOW | Wikidata over 4 s on cold instances; count flips 151/500. → Serve a stored snapshot (the F64 pack already exists) as the primary and refresh it on a schedule; make live and backup the same query so counts agree. |

## ENTERTAINMENT

| Module | Prod run1 rows (served, ms) | Prod run2 rows (served, ms) | Local live rows (ms) | Stored: archive / backup | Verdict | Cause → fix |
|---|---|---|---|---|---|---|
| TV & Streaming Tonight | 133 (live, 1009) | 133 (live, 996) | 133 (1505) | 0 / 500 (2026-09-07..2026-09-09) | LIVE-OK | — → None. |
| Box Office Tracker | 245 (live, 2791) | 100 (archive, backup, 4143) | 245 (15945) | 0 / 100 (2026-08-31..2026-09-10) | LIVE-SLOW | Wikidata 3-16 s; when over 4 s production shows news headlines instead of films (different content). → Stored Wikidata snapshot as archive; drop F66 headlines as a stand-in. |
| Entertainment News Wire | 0 (live, 575) | 10 (live, 84) | 0 (781) — Source offline or empty | 0 / 0 | LIVE-OK (intermittent; 10 rows) | Variety feed occasionally fails/slow; nothing to fall back to. → Add a second outlet (Hollywood Reporter / Deadline RSS) and a stored last-good copy. |
| Bollywood & Film Wire | 100 (live, 1122) | 100 (live, 672) | 100 (1376) | 0 / 0 | LIVE-OK | — → None. |
| Music Charts — India Top 25 | 25 (live, 1305) | 100 (archive, backup, 4117) | 25 (20799) | 0 / 100 (1992-01-01..2026-09-04) | LIVE-SLOW | Apple RSS sometimes slow; over 4 s production shows a 100-row backup (Sept chart + catalogue back to 1992) as a "Top 25". → 20 s FETCH_MS -> ~3 s with iTunes fallback in parallel; store the last good 25 rows. |
| Music Charts — Global Top 25 | 25 (live, 1387) | 25 (live, 1192) | 25 (3738) | 0 / 100 (1982-11-29..2026-08-27) | LIVE-OK | — → Same as India chart (shorter timeout). |
| OTT & Studio Intelligence | 87 (live, 1187) | 87 (live, 1718) | 87 (2660) | 0 / 500 (2026-09-07..2026-09-09) | LIVE-OK | — → Backup F69 is a TV schedule; if ever served it would show the wrong content - remove or replace. |
| Celebrity Influence Index | 246 (live, 2297) | 0 (archive, 4076) | 246 (33739) | 0 / 0 | LIVE-SLOW (0 rows on cold requests) | Wikidata query 2-34 s; no stored copy and no backup, so a cold request shows nothing. → Stored snapshot refreshed daily; simplify the query. |

## Findings (answers to the owner's questions)

**"Reduced to 1" in these desks is ISL Tracker, and it is the live API.** ESPN's `ind.1/scoreboard` with no date returns only today's matchday: 1 match on 2026-10-14 (measured). That code has not changed since 2026-09-01. The 325-row Excel backup (F61, ISL 2024 to 2026-05-21) is used only when live returns 0, so one live match hides it. Fix: `?dates=2026&limit=400` returns 154 events, 58 of them upcoming (measured).

**Are we pulling the real sources?** For 23 of 34 modules, yes: production fetches the named upstream and the rows are current (dated 2026-10-14 or later where rows carry dates). 7 modules are stored extracts only and no live call is made: NSE quotes frozen at 2026-07-15, DGFT, and five Carbon tables dated 2025 to 2026-01. 2 modules are planned. 2 are broken (below).

**What really reduced counts today was F154 (719a7eb, 2026-10-14).** Before it, production waited up to 60 s for live data and had no backup fallback. Now a cold request gives up after 4 s. Measured flips between the two production passes:
- Prediction Markets: 31 → 250
- Athlete Index: 151 → 500 (backup)
- Box Office: 245 Wikidata films → 100 news headlines (backup)
- India Music: 25 → 100 (backup)
- Celebrity Index: 246 → 0

Counts now depend on which serverless instance answers.

**Broken:**
1. **AI & the Tech Industry:** PIB now redirects the English RSS (`Lang=1`) to the Hindi feed (`Lang=2&reg=48`). The English-only filter then leaves 0 rows. Adding `&reg=3` returns the English feed (measured). The same URL constant `PIB_PRESS_RSS` (featureFeed.mjs:213) is used by other desks.
2. **Top Financial & Business Players:** the Wikidata SPARQL query returns HTTP 504 after 67 s at WDQS (measured). There is no stored copy, so the module is empty everywhere.

**NSE live is not licence-gated in practice from this Mac.** curl and Node with a Chrome User-Agent get 200 in under 0.3 s. `fetchText` sends the bot User-Agent, which NSE stalls until the 12 s timeout. This was not verified from Vercel's bom1 IPs.

**The backup-pack scope on production is wider than vercel.json says.** `includeFiles` names only 4 packs (F156, cf2115a), but deployment 11cc881 served packs F53, F63, F66 and F67 (measured). This is probably file tracing of `server/backupFeed.mjs`. Several packs hold different content from the module they back:
- F66: news headlines for Box Office
- F69: a TV schedule for OTT
- F63: news for the planned Governance module, labelled "Exhaustive shipped backup"

**Thin by upstream:**
- Fixtures (7): TheSportsDB's free key returns 1 event per call (measured).
- Global Exchanges (5): only 5 symbols are configured.
- Variety (10): the feed carries only 10 items and failed intermittently.

## Not verified / out of scope
- NSE with a browser User-Agent from Vercel. The Wikidata timings from bom1 are inferred from the 4 s cut-offs.
- Backup `newest` dates are taken from the first 500 rows the loader reads, not the whole workbook.
- `PIB_PRESS_RSS` on other desks, and the `backupPacksDeploy.test.js` claim versus the deployed bundle, are reported here, not fixed.
