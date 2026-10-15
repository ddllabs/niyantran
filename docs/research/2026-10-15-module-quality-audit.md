> **Status: Historical (dated 2026-10-15).** Read-only audit of every desk module on production (one request per module, 15:45–15:50 UTC; 6 re-checked). Raw answers were kept outside the repo.

# Module data-quality audit — production, 2026-10-15

Read-only. Nothing in the repository, Supabase or Vercel was changed. Every module in `DESK_CATALOGUE`
(`src/desks/landing/deskCatalogue.js`), less the three in `src/lib/plannedModules.js`, was requested once
from `https://niyantran-six.vercel.app/api/feature-feed?tier=<tier>&feature=<feature>&_=<n>` (117 requests,
one every 1.1 s, 2026-10-15 ~15:45–15:50 UTC). Six modules were requested a second time (see "Re-probes").
Raw answers: `$TMPDIR/mqa/bodies/*.json` (`/tmp/claude-501/mqa`). Scripts: `fetch.mjs`, `analyse.mjs`, `report.mjs`.

## Method — measured vs inferred

**Measured (executed against production answers):**
- Columns shown = `feedColumns(feature, rows)` from `src/lib/columns.js` (the function `DeskView.jsx:380` uses),
  default columns only; the cell value = `cellOf()`. Date columns = columns flagged `date` or labelled
  DATE / PUBLISHED / AS OF / FILED / TABLED / ORDER / RELEASE / DEADLINE / LAST VERIFIED etc.
- "Dated" = rows whose date column parses with `parseDate()` (`src/lib/format.js`); bare years are counted as "year only".
- Badge = `resolveDataState(feed).label` (`src/lib/dataState.js`), the badge `DeskView.jsx:752-754` renders.
  Header freshness = the expression `DeskView.jsx:731-736` builds (`stored copy · as of …`, `last 7 days`, `register · as of …`).
  Source line = `plainSourceLine()` (`src/lib/plainSourceNote.js`).
- Empty columns = shown columns empty in >50% of the first 50 rows. Duplicates = repeated normalised titles / links.
- Keyword relevance checks (crude regexes over **all** rows) for 12 news modules; reported as "keyword check".

**Judged (by reading 15 evenly spaced rows per module):** on-topic count against the module's displayed title,
its group description and the feature name. Strict: central/foreign items in a State module, UPSC study notes,
sports or celebrity items in a politics module = off-topic.

**Inferred (from reading code/docs, not executed):** the systemic causes below, unless marked "measured".

## Totals

| Verdict | Modules |
|---|---|
| BROKEN | 3 |
| MAJOR | 23 |
| MINOR | 60 |
| OK | 31 |

- **28 modules show a green LIVE badge on stored/archived data** (measured: badge = LIVE while the header says
  "stored copy · …" or the adapter is `embedded`/`register`).
- **61 of the 62 scheduled modules (`server/feedSchedule.mjs` FEED_SCHEDULE) were answered by the live path,
  not the feed store** (measured: `served` ≠ `store`); only the SDL tracker and the RBI/MLA registers came from the store.
- **Re-probes** (second request ~10 min later): Election Forecast Aggregator 0 → 50 rows, Box Office 0 → 245,
  Music India 0 → 25, Music US 0 → 25 (first answers were empty "OFFLINE" after the 4 s limit with nothing stored);
  NSE/BSE Delayed Market Feed archive both times (prices 2026-07-14); national Cabinet Decisions 1 stored row both times.

## Summary table (worst first)

Columns: rows = real rows (status rows excluded); served/adapter/kind (fb = `fallback: true`); badge as rendered;
dated share in the shown date column; newest usable date and its age in days; on-topic of 15 sampled.

| # | Verdict | Desk · Module | Rows | Served / adapter | Badge | Dated (date col) | Newest (age d) | On-topic /15 | Problems |
|---|---|---|---|---|---|---|---|---|---|
| 97 | **BROKEN** | State · Municipal Watch | 100 | live/news-search | LIVE | 100/100 100% (DATE) | 2026-10-15 (0) | 1/15 | Search is India ("Municipal" OR "Watch"): 1/100 rows about municipalities |
| 98 | **BROKEN** | State · Panchayat Watch | 100 | live/news-search | LIVE | 100/100 100% (DATE) | 2026-10-15 (0) | 1/15 | Search is India ("Panchayat" OR "Watch"): 3/100 rows about panchayats |
| 101 | **BROKEN** | State · State Tender Aggregator (State e-Procurement) | 0 | live/scrape | PLANNED | 0/0 – (DATE) | – | 0/15 | 0 rows, 'Module planned' though the catalogue marks it configured (scrape adapter, extraction not scheduled) |
| 61 | **MAJOR** | Carbon · Carbon Registry Wire | 24 | live/api | LIVE | 10/24 42% (Date) | 2026-10-12 (2) | 15/15 | Date empty in 14/24 (all Isometric rows); source line names only Verra |
| 45 | **MAJOR** | Economics · NSE/BSE Delayed Market Feed | 144 | archive/embedded/finance-pack fb | — | 144/144 100% (LAST, AS OF) | 2026-07-14 (92) | 15/15 | 'Delayed market feed' served from archive on both probes; prices as of 2026-07-14 (92 days) |
| 55 | **MAJOR** | Economics · Election Forecast Aggregator | 0 [probe 2: 50 rows] | archive/api | OFFLINE | no date column | – | 15/15 | Probe 1: 0 rows, OFFLINE (4 s limit, nothing stored). Probe 2: 50 rows, but 33/50 markets already resolved (2022–2026) |
| 19 | **MAJOR** | Global · Geopolitics News Wire | 25 | live/news-search | LIVE | 25/25 100% (PUBLISHED) | 2026-10-15 (0) | 6/15 | Rows are BBC World's general feed, not geopolitics (~40% on topic) |
| 22 | **MAJOR** | Global · Heads of State | 43 | live/embedded/dossier | LIVE | no date column | – | 9/15 | 19 of 43 leaders shown as 'Not verified' (US, UK, Germany, Japan, Pakistan, Bangladesh…): the pack stores office names, not holders; NEXT TRANSITION 'Not reported' in all 43; LIVE badge on stored pack |
| 31 | **MAJOR** | Global · Global Commodities | 24 | live/embedded/dossier | LIVE | no date column | – | 15/15 | Commodity prices are 'illustrative' levels as of 2026-07 yet carry a LIVE badge (the note's 'no live price feed' trips the LIVE rule) |
| 36 | **MAJOR** | Law · District Court Case Tracker | 52 | live/news-search | LIVE | 52/52 100% (DATE) | 2026-10-15 (0) | 8/15 | ~53% on topic: Supreme Court, High Court and protest stories mixed in |
| 39 | **MAJOR** | Law · Judge & bench reporting | 36 | live/news-search | LIVE | 36/36 100% (DATE) | 2026-10-15 (0) | 6/15 | ~40% on topic: US, Israeli and Azerbaijani courts |
| 41 | **MAJOR** | Law · ICJ Proceedings | 51 | live/news-search | LIVE | 51/51 100% (DATE) | 2026-10-15 (0) | 2/15 | ~15% on topic; keyword check: 8/51 rows name the ICJ |
| 3 | **MAJOR** | National · Policy Pipeline Tracker | 20 | live/api | LIVE | 20/20 100% (LAST OFFICIAL ACTION) | 2026-10-14 (0) | 1/15 | Rows are the generic PIB press-release feed, not draft-to-gazette policy items (~1/15 on topic) |
| 11 | **MAJOR** | National · Cabinet Decisions | 1 | live/embedded fb | — | 1/1 100% (Date) | 2026-05-11 (156) | 1/1 | Only 1 stored decision (2026-05-12, 156 days old); live PIB window (20 releases) had none, although Union Cabinet decisions of 14 Oct 2026 (IDBI stake sale, railway PLB, NSAP) appear in the State Cabinet module |
| 12 | **MAJOR** | National · Central Tender Aggregator | 10 | live/embedded fb | — | 10/10 100% (DEADLINE) | 2026-07-13 (94) | 10/10 | 10 stored eProcure tenders, all deadlines 10–13 Jul 2026 (expired) while status says Open; value/ministry/location empty |
| 14 | **MAJOR** | National · Centre-Sanctioned Projects | 8 | live/embedded | — | no date column | – | 8/8 | Rows carry programme/domain/verifiable_status/activity, but the column preset expects World Bank keys (project_name, status, totalamt), so the table shows only PROJECT |
| 88 | **MAJOR** | State · MLA Defection & Anti-defection Case Tracker | 50 | live/news-search | LIVE | 50/50 100% (DATE) | 2026-09-26 (18) | 15/15 | On topic, but no row in the last 17 days; items back to 2019 under a LIVE badge |
| 90 | **MAJOR** | State · State Governance Brief | 120 | live/news-search | LIVE | 100/120 83% (DATE) | 2026-10-15 (0) | 7/15 | 20 national PIB rows first, all undated; wire matches 'cabinet'/'secretariat' nationally; ~47% state-specific (keyword check 46/120) |
| 91 | **MAJOR** | State · Governor Assent Tracker | 25 | live/news-search | LIVE | 25/25 100% (DATE) | 2026-10-15 (0) | 3/15 | ~20% about assent; keyword check 3/25 |
| 92 | **MAJOR** | State · Assembly Proceedings Digest (Vernacular, Translated) | 42 | live/news-search | LIVE | 42/42 100% (DATE) | 2026-10-15 (0) | 10/15 | ~67% on topic; English news search, nothing vernacular or translated as the title claims |
| 93 | **MAJOR** | State · MLA Report Card + Statement Tracker | 497 | live/api | LIVE | no date column | – | 13/15 | 400 Wikidata identities + 97 news rows; no report-card metrics; raw SPARQL column names (PERSONLABEL, POSITIONLABEL) |
| 94 | **MAJOR** | State · Legislative Productivity Comparison | 50 | live/news-search | LIVE | 50/50 100% (DATE) | 2026-09-27 (17) | 15/15 | On topic, but newest 17 days; items back to 2020 under a LIVE badge |
| 103 | **MAJOR** | State · Cabinet Decisions | 100 | live/news-search | LIVE | 100/100 100% (Date) | 2026-10-15 (0) | 7/15 | Same query as national Cabinet Decisions with no state filter; ~47% state cabinets (keyword check 35/100) |
| 107 | **MAJOR** | State · CAG Audit Tracker | 37 | live/news-search | LIVE | 37/37 100% (DATE) | 2026-10-15 (0) | 3/15 | ~20% about CAG audits; keyword check 10/37 name the CAG |
| 110 | **MAJOR** | State · District Performance Tracker (Composite) | 500 | live/api | LIVE | no date column | – | 15/15 | Wikidata district directory (population, area), capped at 500 of ~780 districts; no performance measure; note just 'Live api feed.' |
| 116 | **MAJOR** | State · District Media Monitor (Vernacular District Editions) | 52 | live/news-search | LIVE | 52/52 100% (DATE) | 2026-10-15 (0) | 9/15 | ~60% Indian district news; US local news matched by 'India'→'Indian'; nothing vernacular |
| 56 | **MINOR** | Carbon · Global Carbon Pricing Tracker | 52 | live/embedded/carbon-pack | — | no date column | – | 15/15 | Year only; no as-of date |
| 57 | **MINOR** | Carbon · Carbon Price Monitor | 242 | live/embedded/carbon-pack | — | no date column | – | 15/15 | Annual OWID prices, newest year 2025 |
| 59 | **MINOR** | Carbon · Carbon Border (CBAM) Watch | 7 | live/embedded/carbon-pack | — | 7/7 100% (Date) | 2025-12-31 (287) | 7/7 | Newest milestone 2026-01-01 (287 days) |
| 60 | **MINOR** | Carbon · India CCTS & Green Credits | 6 | live/embedded/carbon-pack | — | 6/6 100% (Date) | 2025-09-30 (379) | 6/6 | Newest milestone 2025-10-01 (379 days) |
| 62 | **MINOR** | Carbon · Climate Newswire | 72 | live/api | LIVE | 72/72 100% (Published) | 2026-10-14 (0) | 10/15 | ~67% on climate (Mongabay biodiversity items); HTML entities unescaped |
| 51 | **MINOR** | Economics · DGFT trade notifications | 229 | live/embedded/finance-pack | — | 229/229 100% (DATE) | 2026-08-04 (71) | 15/15 | DGFT notifications; newest 2026-08-05 (71 days), stored |
| 52 | **MINOR** | Economics · Indian enterprise chief executives | 84 | live/api | LIVE | no date column | – | 13/15 | Alphabetical Wikidata CEO identities incl. foreign firms and tiny start-ups |
| 53 | **MINOR** | Economics · PIB technology reporting | 103 | live/api | LIVE | 100/103 97% (DATE) | 2026-10-15 (0) | 12/15 | Displayed as "PIB technology reporting" but 100/103 rows are Google News (3 PIB rows, undated) |
| 54 | **MINOR** | Economics · Prediction Market Political Odds | 250 | live/api | LIVE | 250/250 100% (CLOSES) | 2026-10-15 (-1) | 11/15 | 46/250 markets already closed; 2 close dates 9999-12-31; YES % empty in 38/50 (multi-choice) |
| 72 | **MINOR** | Entertainment · Indian film identities & reported gross | 0 [probe 2: 245 rows] | archive/api | OFFLINE | no date column | – | 15/15 | Probe 1: 0 rows OFFLINE (timeout, nothing stored); probe 2: 245 Wikidata films (title is honest) |
| 73 | **MINOR** | Entertainment · Entertainment News Wire | 10 | live/api | LIVE | 10/10 100% (PUBLISHED) | 2026-10-14 (0) | 10/10 | Only 10 rows; titles carry raw HTML entities (&#8216;) |
| 75 | **MINOR** | Entertainment · Music Charts — India Top 25 | 0 [probe 2: 25 rows] | archive/api | OFFLINE | no date column | – | 15/15 | Probe 1: 0 rows OFFLINE (timeout); probe 2: 25 iTunes rows (Apple Music empty); no chart date |
| 76 | **MINOR** | Entertainment · Music Charts — United States Top 25 | 0 [probe 2: 25 rows] | archive/api | OFFLINE | no date column | – | 15/15 | Probe 1: 0 rows OFFLINE (timeout, nothing stored); probe 2: 25 rows; no chart date |
| 17 | **MINOR** | Global · Open Fronts | 88 | live/embedded/table | LIVE | 88/88 100% (LAST VERIFIED) | 2026-09-07 (38) | 15/15 | LIVE badge on a stored register (last verified 2026-09-07, 38 days) |
| 18 | **MINOR** | Global · Global Intelligence | 10 | live/embedded/table | LIVE | 10/10 100% (AS OF) | 2026-09-07 (38) | 10/10 | LIVE badge on a stored 10-row India defence-procurement register; title 'Global Intelligence' |
| 20 | **MINOR** | Global · Alliances | 46 | live/embedded/dossier | — | 46/46 100% (LATEST VERIFIED) | 2025-11-22 (326) | 15/15 | LATEST VERIFIED column holds founding/event dates back to 1951; newest 2025-11-22 (326 days) |
| 21 | **MINOR** | Global · Sanctions | 18 | live/embedded/dossier | LIVE | no date column | – | 15/15 | LIVE badge on a stored programme register (as of 2026-07); note's word 'Live' (about /api/opensanctions) triggers the badge |
| 23 | **MINOR** | Global · Infra | 10 | live/embedded/dossier | LIVE | no date column | – | 10/10 | LIVE badge on stored 10-row register; no dates |
| 24 | **MINOR** | Global · Nuclear Watch | 112 | live/embedded/dossier | LIVE | 0/112 0% (LATEST VERIFIED) | – | 15/15 | LATEST VERIFIED column holds boilerplate text, no dates (0/112); LIVE badge on stored register |
| 25 | **MINOR** | Global · Upcoming launches | 12 | live/live/dossier | — | 12/12 100% (LAUNCH / COMMISSIONED) | 2026-10-15 (-1) | 12/12 | Live Space Devs launches but shown without a LIVE badge and described as 'Stored records'; 11/12 dates are scheduled future launches (expected) |
| 26 | **MINOR** | Global · Maritime Choke-Points | 18 | live/embedded/dossier | LIVE | no date column | – | 15/15 | LIVE badge on stored register (as of 2026-07); no dates |
| 27 | **MINOR** | Global · Global Aid | 16 | live/embedded/dossier | LIVE | 16/16 100% (DATA THROUGH) | 2026-06-30 (106) | 15/15 | FUNDED empty in 14/16; data through 2024-10..2026-06; LIVE badge on stored register |
| 28 | **MINOR** | Global · Energy & Critical Minerals | 14 | live/embedded/dossier | LIVE | no date column | – | 14/14 | Critical-minerals dossier (title says Energy & Critical Minerals); raw columns ID/LAT/LON/INTENSITY; illustrative levels with a LIVE badge (the note's "No live price feed" trips the LIVE rule) |
| 29 | **MINOR** | Global · World Constitutions | 188 | live/live | LIVE | no date column | – | 15/15 | 46/188 country names with underscores (Bahamas_the, Cape_Verde); year only |
| 33 | **MINOR** | Law · Supreme Court Orders & Judgments | 220 | live/embedded/law-pack | — | 220/220 100% (ORDER DATE) | 2026-07-02 (104) | 15/15 | Stored orders (honestly labelled); newest 2026-07-03 (104 days) |
| 34 | **MINOR** | Law · Supreme Court orders by topic | 220 | live/embedded/law-pack | — | 220/220 100% (ORDER DATE) | 2026-07-02 (104) | 15/15 | Same 220 stored Supreme Court rows as the Judgment Feed, regrouped (reused feed); newest 104 days |
| 37 | **MINOR** | Law · NGT Environmental Litigation Tracker | 47 | live/news-search | LIVE | 47/47 100% (DATE) | 2026-10-15 (0) | 12/15 | ~80% on topic |
| 38 | **MINOR** | Law · CAT & Consumer Disputes (NCDRC) Watch | 49 | live/news-search | LIVE | 49/49 100% (DATE) | 2026-10-15 (0) | 12/15 | ~80% on topic |
| 40 | **MINOR** | Law · ICC Proceedings | 100 | live/news-search | LIVE | 100/100 100% (DATE) | 2026-10-15 (0) | 15/15 | On topic but dominated by one story (US sanctions on ICC) repeated across outlets |
| 43 | **MINOR** | Law · NCLT / NCLAT (Insolvency) | 434 | live/embedded/law-pack | — | 434/434 100% (ORDER, DATE) | 2026-08-07 (68) | 15/15 | Newest 2026-08-07 (69 days); NCLAT absent (disclosed) |
| 44 | **MINOR** | Law · Sector Tribunals (ITAT / TDSAT / SAT / DRT) | 80 | live/news-search | LIVE | 80/80 100% (DATE) | 2026-10-15 (0) | 15/15 | All sampled rows ITAT (mostly personal-tax explainers); TDSAT/SAT/DRT absent |
| 0 | **MINOR** | National · Bill Passage Probability Index | 9819 | live/embedded | LIVE | 9819/9819 100% (Introduced) | 2026-08-09 (67) | 15/15 | LIVE badge on a stored Sansad register (stored copy · as of 07 Sep 2026); every one of 9,819 bill dates is one day early (date_introduced 2026-08-09 19:00 vs source_date_raw 2026-08-10) |
| 1 | **MINOR** | National · Policy Intelligence Graph | 9819 | live/embedded/graph | LIVE | 9819/9819 100% (DATE) | 2026-08-09 (67) | 15/15 | Same 9,819-row bill register as Bill Passage (reused feed); same one-day-early date shift; LIVE badge on stored data |
| 2 | **MINOR** | National · Parliamentary Question Database | 8000 | live/embedded | LIVE | 8000/8000 100% (TABLED) | 2026-04-01 (196) | 15/15 | 8,000-row sample of the PQ register, newest 2026-04-01 (197 days); LIVE badge on stored data; 1,359 repeated question subjects (clubbed questions) |
| 4 | **MINOR** | National · Regulatory Body Watch | 171 | live/live | LIVE | 141/171 82% (DATE) | 2026-10-15 (0) | 15/15 | 30/171 rows undated; stored register rows back to 2024-11 mixed with live RBI/SEBI items (note says so) |
| 5 | **MINOR** | National · Candidate Affidavit Database | 483 | live/embedded | LIVE | no date column | – | 15/15 | LIVE badge on a stored MyNeta 2024 register; no as-of date |
| 6 | **MINOR** | National · Delimitation Impact Simulator | 36 | live/internal/simulator | LIVE | no date column | – | 15/15 | Simulation rows, but LIVE badge and source links point to a Google News search (India "Delimitation" OR "Impact") |
| 8 | **MINOR** | National · MP Profiles & Performance | 782 | live/embedded/cards | LIVE | no date column | – | 15/15 | LIVE badge on stored MP register; no as-of date; attendance empty (disclosed) |
| 10 | **MINOR** | National · Statements & Quote Tracker | 100 | live/news-search/wire | LIVE | 100/100 100% (DATE) | 2026-10-15 (0) | 9/15 | Media mentions of Modi, many not statements by him (disclosed); no contradiction detection |
| 13 | **MINOR** | National · Bureaucratic Transfers (AGMUT) | 29 | live/embedded | LIVE | 29/29 100% (ORDER) | 2026-06-10 (126) | 15/15 | LIVE badge on stored AGMUT register; newest order 2026-06-10 (127 days) |
| 15 | **MINOR** | National · Budget Utilisation & Schemes | 13 | live/embedded | — | no date column | – | 13/13 | Curated allocation figures; VALUE and NOTE empty in 8/13 |
| 16 | **MINOR** | National · Industry Updates (Ministry Data) | 26 | live/live | LIVE | 0/26 0% (YEAR) | – | 15/15 | World Bank industry % of GDP by year, not ministry data as the title says; YEAR only |
| 64 | **MINOR** | Sports · Fixtures & Results — World Leagues | 7 | live/api | LIVE | 7/7 100% (DATE) | 2026-10-15 (-1) | 7/7 | Only 7 rows for four leagues; an IPL row from 2026-05-31 |
| 69 | **MINOR** | Sports · Sports Business & Media Rights | 80 | live/api | LIVE | no date column | – | 15/15 | League names/owners only; no business or media-rights data (disclosed) |
| 70 | **MINOR** | Sports · Athlete Index | 150 | live/api | LIVE | no date column | – | 15/15 | SPORT '—' on some rows; 4 duplicate names; no ranking |
| 79 | **MINOR** | State · Constituency Register | 40 | live/embedded/geo-pack | LIVE | no date column | – | 15/15 | Goa only (40 seats) presented as a State register; LIVE badge on stored pack; 'date not recorded' |
| 80 | **MINOR** | State · Roll Demography | 40 | live/embedded/geo-pack | LIVE | no date column | – | 15/15 | Goa only; LIVE badge on stored pack; no as-of |
| 81 | **MINOR** | State · Community Bloc Matrix | 40 | live/embedded/geo-pack | LIVE | no date column | – | 15/15 | Goa only, modelled; LIVE badge on stored pack |
| 82 | **MINOR** | State · Election Results 2017–2024 | 40 | live/embedded/geo-pack | LIVE | no date column | – | 15/15 | Goa only; LIVE badge on stored pack |
| 83 | **MINOR** | State · Split-Ticket & Competitiveness | 40 | live/embedded/geo-pack | LIVE | no date column | – | 15/15 | Goa only; LIVE badge on stored pack |
| 84 | **MINOR** | State · SIR Roll Churn | 40 | live/embedded/geo-pack | LIVE | no date column | – | 15/15 | Goa only; LIVE badge on stored pack |
| 85 | **MINOR** | State · Registration Gap | 40 | live/embedded/geo-pack | LIVE | no date column | – | 15/15 | Goa only; LIVE badge on stored pack |
| 86 | **MINOR** | State · Booth-level Results Database | 1731 | live/embedded/geo-pack | LIVE | no date column | – | 15/15 | Goa only; LIVE badge on stored pack |
| 87 | **MINOR** | State · Party Organisation Map | 31 | live/register/register | LIVE | no date column | – | 15/15 | LIVE badge and 'Live · 31 records' on a register as of 19 Aug 2026 |
| 89 | **MINOR** | State · Booth Political History | 1731 | live/embedded/geo-pack | LIVE | no date column | – | 15/15 | Goa only; LIVE badge on stored pack |
| 95 | **MINOR** | State · Governor Friction & President's Rule Tracker | 74 | live/news-search | LIVE | 74/74 100% (DATE) | 2026-10-07 (7) | 15/15 | On topic; newest 7 days; items back to 2017 mixed in |
| 99 | **MINOR** | State · Local Governance Brief | 11 | live/embedded/geo-pack | LIVE | no date column | – | 11/11 | Goa only; LIVE badge on stored pack |
| 100 | **MINOR** | State · Bureaucrat Transfer & Posting Tracker (State Cadre) | 58 | live/news-search | LIVE | 58/58 100% (DATE) | 2026-10-15 (0) | 13/15 | Mostly on topic; junk titles |
| 102 | **MINOR** | State · Centre-State Fund Flow Tracker | 11 | live/api/budget-xlsx | LIVE | 0/11 0% (DATE) | – | 11/11 | 11 national Union Budget aggregate lines; only 4 are centre→state transfers; nothing state-wise |
| 108 | **MINOR** | State · Cross-State Comparison Engine | 25 | live/register | LIVE | no date column | – | 15/15 | LIVE badge and 'Live' source line on the stored RBI handbook (as of 11 Dec 2025) |
| 58 | **OK** | Carbon · ETS & Tax Adoption Timeline | 52 | live/embedded/carbon-pack | — | 0/52 0% (Tax since, ETS since) | – | 15/15 |  |
| 46 | **OK** | Economics · Global exchange index quotes | 5 | live/api | LIVE | 5/5 100% (LAST, AS OF) | 2026-10-14 (0) | 5/5 |  |
| 47 | **OK** | Economics · Country GDP observations | 186 | live/api | LIVE | no date column | – | 15/15 | Year only |
| 48 | **OK** | Economics · GDP, CPI & employment indicators | 186 | live/api | LIVE | no date column | – | 15/15 | PMI absent (disclosed) |
| 49 | **OK** | Economics · India GDP growth baseline | 36 | live/api | LIVE | no date column | – | 15/15 | Displayed title is honest (India GDP growth baseline) |
| 50 | **OK** | Economics · India electricity-access series | 25 | live/api | LIVE | no date column | – | 15/15 | Displayed title is honest (India electricity-access series); World Bank yearly series |
| 71 | **OK** | Entertainment · TV & Streaming Tonight | 113 | live/api | LIVE | no date column | – | 15/15 | Mostly US network schedule |
| 74 | **OK** | Entertainment · Bollywood & Film Wire | 100 | live/api | LIVE | 100/100 100% (PUBLISHED) | 2026-10-14 (0) | 15/15 |  |
| 77 | **OK** | Entertainment · OTT & studio owner identities | 87 | live/api | LIVE | no date column | – | 15/15 | Title says owner identities |
| 78 | **OK** | Entertainment · Public follower observations | 246 | live/api | LIVE | no date column | – | 15/15 |  |
| 30 | **OK** | Global · Growth Indicators | 20 | live/live | LIVE | no date column | – | 15/15 |  |
| 32 | **OK** | Global · Global Trade | 20 | live/live | LIVE | no date column | – | 15/15 |  |
| 35 | **OK** | Law · Allahabad High Court reporting | 73 | live/news-search | LIVE | 73/73 100% (DATE) | 2026-10-15 (0) | 15/15 |  |
| 42 | **OK** | Law · WTO Dispute Settlement | 646 | live/embedded/law-pack | — | 646/646 100% (REQUESTED) | 2026-07-26 (80) | 15/15 | Register as of 13 Oct 2026 |
| 7 | **OK** | National · LS Manifestos & Promises | 10 | live/embedded | — | no date column | – | 10/10 | Curated, as of Jan 2026, labelled curated |
| 9 | **OK** | National · National Morning Brief | 220 | live/news-search/panel | LIVE | 220/220 100% (DATE) | 2026-10-15 (0) | 15/15 | General national news brief; dates present (PIB rows enriched with release-page dates) |
| 63 | **OK** | Sports · Cricket Wire | 100 | live/api | LIVE | 100/100 100% (PUBLISHED) | 2026-10-14 (0) | 15/15 |  |
| 65 | **OK** | Sports · Football Wire | 81 | live/api | LIVE | 81/81 100% (PUBLISHED) | 2026-10-14 (0) | 15/15 | 5 duplicate headlines |
| 66 | **OK** | Sports · ISL Tracker | 169 | live/api | LIVE | 169/169 100% (DATE) | 2026-10-15 (-1) | 15/15 | Fixtures span two seasons (71 future-dated, expected) |
| 67 | **OK** | Sports · Indian Sports Wire | 100 | live/api | LIVE | 100/100 100% (PUBLISHED) | 2026-10-14 (0) | 15/15 |  |
| 68 | **OK** | Sports · Sports Governance & Policy | 97 | live/api | LIVE | 97/97 100% (DATE) | 2026-10-14 (0) | 15/15 | 3 duplicate headlines (dedup by link only) |
| 96 | **OK** | State · MLA Directory | 496 | store/register/register | — | 496/496 100% (AS OF) | 2026-08-18 (57) | 15/15 | Store register, as of 19 Aug 2026 |
| 104 | **OK** | State · State Economic Data (GSDP, sectors) | 455 | store/register/register | — | no date column | – | 15/15 | RBI handbook register as of 11 Dec 2025 |
| 105 | **OK** | State · State Fiscal Deep-Dive | 476 | store/register/register | — | no date column | – | 15/15 |  |
| 106 | **OK** | State · SDL Auction & Borrowing Tracker | 67 | store/api | — | 67/67 100% (RELEASE) | 2026-10-14 (0) | 15/15 | Yield/price empty for notices (results only) |
| 109 | **OK** | State · NITI Aayog State Indices | 142 | store/register/register | — | no date column | – | 15/15 |  |
| 111 | **OK** | State · State Health & Nutrition Indicators | 490 | store/register/register | — | no date column | – | 15/15 | State-level, not district (title says State …) |
| 112 | **OK** | State · State Education Indicators | 444 | store/register/register | — | no date column | – | 15/15 |  |
| 113 | **OK** | State · State Economic & Livelihood Indicators | 429 | store/register/register | — | no date column | – | 15/15 |  |
| 114 | **OK** | State · State Agriculture & Rural Indicators | 476 | store/register/register | — | no date column | – | 15/15 |  |
| 115 | **OK** | State · State Infrastructure & Connectivity | 487 | store/register/register | — | no date column | – | 15/15 |  |

## Systemic causes (with file:line)

### C1. The LIVE badge is the default, and the word "live" in a note turns a stored pack LIVE — 28 modules
- `src/lib/dataState.js:152-157`: any answer that is not `fallback`, not a store answer, not curated and not a
  known pack kind falls through to `DATA_STATE.live`. Embedded registers with an empty `kind` (Bill Passage,
  Policy Graph, PQ Database, Candidate Affidavits, MP Profiles, AGMUT Transfers, Open Fronts, Global Intelligence,
  Cross-State Comparison, Party Map) take this path. *Measured: badge LIVE with "stored copy · as of …" beside it.*
- `src/lib/dataState.js:134-143`: for `geo-pack|…|dossier` kinds the rule is `/live/i.test(blob)`. Notes that say the
  data is **not** live contain the word: Goa geo-pack "…not the live table", Global Commodities "no live price feed is
  connected", Energy "No live price feed", Heads of State "not a live Wikidata table", Sanctions/Maritime/Global Aid/Infra
  "Live … is served at /api/…", Nuclear "live overlay". *Measured: all of these render LIVE.*
- Feeder: `server/featureFeed.mjs:3679-3690` serves an archive with `adapter: 'embedded'` and
  `fallback: Boolean(liveUrls.length)` (3687), i.e. `fallback: false` when no live URL exists, so the page has no flag to say "stored".
- The inverse also happens: Satellite Infrastructure ("Upcoming launches") is a live Space Devs call
  (`adapter: 'live'`, `kind: 'dossier'`) and gets no badge and the source line "Stored records from The Space Devs".

### C2. PIB press releases are pasted, undated, into modules that are not about them
- `server/featureFeed.mjs:3245-3262` (State Governance Brief) prepends up to 40 rows from `PIB_PRESS_RSS`
  (`:212`) — every ministry's national releases — with `section: 'Government wire (PIB)'`, ahead of the state wire.
  *Measured: 20 PIB rows (India–Japan JWG, DRI gold seizure, customs weed seizure, Asian Games), DATE "—" on all 20.*
- PIB's English RSS has no `pubDate` (`server/nationalFeed.mjs:197` says so); `parseRssOrXml` (`featureFeed.mjs:774`)
  leaves `date` empty. The national loaders call `enrichPibEnglish` (`nationalFeed.mjs:173-235`), which reads the
  release page for the date; the State Governance Brief branch and the generic news-topic branch
  (`featureFeed.mjs:3507-3516`, `wantsPibWire` `:431-435`) do not. *Measured: Policy Pipeline's PIB rows 20/20 dated;
  State Governance Brief's PIB rows 0/20 dated; AI & Tech's 3 PIB rows undated.*
- `server/nationalFeed.mjs:292-311` (Policy Pipeline Tracker) shows the raw PIB press + features feeds with no filter
  for drafts, notifications or gazettes. *Measured: ~1/15 rows about a policy in the pipeline.*

### C3. Name-derived search queries frozen into the registry ("Watch" is searched as a word) — BROKEN modules
- `topicQueryForFeature` (`server/featureFeed.mjs:397-418`) builds `India ("word1" OR "word2"…)` from the module
  name, dropping only `TOPIC_STOP` words (`:302-329`), which lacks "watch", "impact", "report", "card".
  The generated URLs are stored as `primaryFeedUrl` in `src/data/source-registry.json:2472` (Municipal Watch:
  `India ("Municipal" OR "Watch")`), `:2503` (Panchayat Watch: `India ("Panchayat" OR "Watch")`), `:798`
  (Delimitation: `India ("Delimitation" OR "Impact")`), and as `source` in `src/data/html-feature-map.json:1916, 1934, 808`.
  The generic live path (`featureFeed.mjs:3664-3677`, note "Live news-search feed.") serves whatever they return.
  *Measured: Municipal Watch 1/100 rows about municipalities ("where to watch live streaming", Bloomberg "Watch …" videos);
  Panchayat Watch 3/100.*

### C4. Shared or national-scope queries in State modules, with no state or title guard
- `FEATURE_TOPIC_Q['cabinet decisions']` (`featureFeed.mjs:336-337`) has no state term and serves State Cabinet
  Decisions (registry `primaryFeedUrl`); matching is by substring both ways (`:399-401`, `n.includes(k) || k.includes(n)`),
  so one key can capture several modules. *Measured: State Cabinet Decisions ~47% state cabinets (IDBI stake sale,
  railway bonus, NSAP — Union decisions).*
- `stateGovernanceNewsRssUrl` (`:187-196`) / `FEATURE_TOPIC_Q['state governance brief']` (`:344-345`) use bare
  `cabinet OR secretariat`, which matches the Union Cabinet, the Cabinet Secretariat and central-employee stories.
- `'governor assent tracker'` (`:334-335`), `'cag audit tracker'` (`:340`) match UPSC study notes (Vajiram & Ravi,
  GK Today), governor appointments and generic "report"/"audit" stories. *Measured: Governor Assent 3/25 keyword hits;
  CAG 10/37 rows name the CAG.*
- The F196 modules have a title guard (`src/lib/curatedNews.js:55-67`, `spec.title` / `spec.exclude`), and they are the
  most on-topic news modules; the older news modules have none.

### C5. "India" matches "Indian"; HC/judge queries have no India term
- `districtMediaNewsRssUrl` (`featureFeed.mjs:176-185`): `India (district …) (… school …)` returns US local news
  ("Indian River County schools", "Menominee Indian High School"). *Measured: 4/15 sampled rows are US local news.*
- `FEATURE_TOPIC_Q['hc judge profiles & bench analytics']` and ICJ (`:363-369`) carry no India term / no
  case-level terms: US state supreme courts, Israel, Azerbaijan; the ICJ module is mostly Nobel-prize coverage.

### C6. No age cut on news rows; Google's `when:7d` is not enforced
- `curatedNewsRows` (`src/lib/curatedNews.js:55-67`) and `parseRssOrXml` (`featureFeed.mjs:753-803`) keep every item
  Google returns. *Measured: MLA Defection newest 2026-09-26, oldest 2019; Legislative Productivity newest 2026-09-27,
  oldest 2020; Governor Friction oldest 2017 — all with a LIVE badge.* (Inferred: Google ignores `when:7d` for these
  long boolean queries.)

### C7. Store not serving; 4 s live limit with nothing stored → empty or months-old answers
- 61/62 scheduled modules answered live (measured). `docs/plans/open-work.md:726-731` records that `serve` is
  switched on "class by class" after the timer runs, and Cabinet's 79-decision register is loaded "with `serve` off" —
  so the store does not yet back these modules (inferred from docs; not checked in the database).
- `LIVE_TIME_LIMIT_MS = 4000` (`featureFeed.mjs:3824`); past it `serveArchiveFor` (`:3922-3945`) answers from files,
  and returns an empty "OFFLINE" answer when none exist. *Measured: Election Forecast, Box Office, both Music Charts empty
  on probe 1, filled on probe 2; NSE/BSE archive (2026-07-14) on both probes.*
- National Cabinet Decisions (`server/nationalFeed.mjs:614-650`) looks only at PIB's latest ~20 releases and otherwise
  shows the shipped archive, which holds **one** decision (2026-05-12). *Measured; meanwhile the State Cabinet module
  shows Union Cabinet decisions of 14 Oct 2026.*

### C8. Data defects in shipped packs
- `public/data/embedded_csv/national_bill_tracker.json`: `date_introduced`/`date` are 5 h behind `source_date_raw`
  ("2026-08-09 19:00:00" vs "2026-08-10 00:00:00.0"). *Measured: 9,819/9,819 rows show the date one day early*
  (Bill Passage and Policy Intelligence Graph).
- `src/data/leaders.json`: 19 of 44 entries hold an office ("US President", "UK Prime Minister"), so
  `flattenLeader` (`src/lib/globalResources.js:46-68`) shows "Not verified" for the US, UK, Germany, Japan, Pakistan…
- Central Tender archive: 10 rows, `status: "Open"` with deadlines 10–13 Jul 2026.
- Carbon Registry Wire: Isometric rows come from an extracted list with no dates (`featureFeed.mjs:~2205-2211`); 14/24 undated.
- World Constitutions: 46/188 names are slugs (`Bahamas_the`, `Cape_Verde`).

### C9. Column presets that do not match the rows
- `src/lib/columns.js:225-231` (Centre-sanctioned projects) expects World Bank keys (`project_name`, `status`,
  `totalamt`, `boardapprovaldate`); the stored rows have `programme`, `domain`, `verifiable_status`, `activity`.
  *Measured: the table shows a single PROJECT column.*
- MLA Report Card / District Performance Tracker have no preset, so raw SPARQL names show (PERSONLABEL,
  POSITIONLABEL, DISTRICTLABEL). Energy shows ID / LAT / LON / INTENSITY.

### C10. Modules reusing another module's rows
- Policy Intelligence Graph = Bill Passage register (same 9,819 rows). Supreme Court orders by topic = Supreme Court
  Orders & Judgments (same 220 rows). Delimitation Impact Simulator lists a Google News search link. State Cabinet
  Decisions uses the national cabinet query. (Measured: identical row sets / links.)

## Proposed fixes, grouped by cause (one fix repairs many modules)

1. **C1 badge (28 modules, one file).** In `src/lib/dataState.js`, return LIVE only when the answer positively says
   live: `adapter` in {api, live, news-search} and not `embedded`/`register`/pack kind; drop the `/live/i.test(blob)`
   rule (or test for an explicit `meta.live === true`). Have `featureFeed.mjs:3679-3690` and the pack branches set
   `kind` (e.g. `'register'`) so stored answers are recognisable. Add a test that a note containing "no live price feed"
   is not LIVE, and that the Space Devs answer is LIVE. Fixes: every module in the LIVE-on-stored list.
2. **C2 PIB (State Governance Brief, AI & Tech, news-topic modules).** Remove the PIB block from State Governance Brief
   (PIB is the Union government); if PIB is kept anywhere, pass rows through `enrichPibEnglish` for dates and filter to
   the module's topic (as the AI slice does with `isTechTitle`). For Policy Pipeline, filter PIB to draft/notification/
   rules/gazette/consultation titles, or retitle it.
3. **C3 name-derived queries (Municipal Watch, Panchayat Watch, Delimitation).** Add curated `FEATURE_TOPIC_Q` entries
   (e.g. municipal corporation / civic body / mayor; gram panchayat / sarpanch / zilla parishad), add "watch", "impact"
   and similar to `TOPIC_STOP`, and regenerate the frozen `primaryFeedUrl`/`source` strings in
   `source-registry.json` and `html-feature-map.json` (data change; needs the data-migration approval in AGENTS.md).
   Better: build news URLs at request time only (as F189 does for `openLiveFallback`) so names never freeze into data.
   Remove the Google News link from the Delimitation simulator.
4. **C4/C5 title guards for every news module.** Extend the F196 `curatedNews.js` guard (`spec.title` / `spec.exclude`)
   to all news-search modules: State modules require a state/UT name or "state government"/CM, exclude "Union Cabinet",
   "Centre", "central government employees", UPSC/GK study sites (Vajiram, GK Today, Insights IAS); State Cabinet gets
   its own query (`"state cabinet" OR "<State> cabinet"`); Governor Assent requires assent/bill/ordinance; CAG requires
   "CAG"/"Comptroller"; ICJ requires "ICJ"/"International Court of Justice"; HC judges require "High Court" + India;
   District Media excludes `Indian River|Indian Creek|County|High School` or uses `"India"` with `-Indian` alternatives.
   Fixes ~12 modules.
5. **C6 age cut.** Drop news rows older than the module's window (7 days, or 30 for the slow F196 topics) after parsing,
   and dedupe by normalised headline, not only by link. Fixes MLA Defection, Legislative Productivity, Governor Friction,
   ICC/Sports Governance duplicates.
6. **C7 store and stored fallback.** Turn `serve` on for the scheduled classes as planned (open-work C7), starting with
   `official` (Cabinet register) and `charts`/`markets`/`reference`; until then, give modules with no archive (Music
   Charts, Box Office, Election Forecast) a last-good snapshot so the 4 s limit never yields an empty page. Keep NSE/BSE
   labelled stored, or remove "Delayed market feed" wording while it has no live source.
7. **C8 data packs (data-migration task).** Re-derive bill dates from `source_date_raw` (no timezone conversion);
   fill holder names in `leaders.json` or hide placeholder rows; mark expired tenders Closed or drop them; give Isometric
   rows their publication dates; prettify constitution slugs.
8. **C9 columns.** Fix the Centre-sanctioned preset to the stored keys; add presets for MLA Report Card, District
   Performance and Energy.
9. **Smaller items.** Filter resolved Manifold markets out of the Election Forecast and Political Odds boards (or sort
   them below open ones) and drop `9999-12-31` close dates (`server/financeApi.mjs:308-322`); unescape HTML entities in
   Variety / Carbon Brief titles; scope the Goa geo-pack modules' titles or subtitles to "Goa"; rename or relabel
   "Assembly Proceedings Digest (Vernacular, Translated)" and "District Media Monitor (Vernacular …)" — nothing is
   vernacular or translated; mark "State Tender Aggregator" `configured: false` (it answers "Module planned").

## Limits of this audit
- One request per module (six re-probed); live news changes by the minute, so counts are a snapshot.
- Relevance is a human judgement on 15 rows; keyword checks are crude and only support it.
- I did not query the database (no SQL against production); "serve is off" is inferred from `docs/plans/open-work.md`.
- Landing summaries (`/api/*-landing`) were not probed; they use `serveFeatureFeedWithBackup` directly and can differ.

## Per-module detail

### 97. State · Municipal Watch — BROKEN
- Request: tier=local, feature=Municipal Watch; HTTP 200, 792 ms, served=live, adapter=news-search, fallback=false
- Page claims: badge "LIVE"; header freshness "—"; source line "Live · 100 stories from Google News"; meta.status "—"
- Note: Live news-search feed.
- Row hosts: news.google.com 100
- Columns shown: DATE · TITLE · SUMMARY · PUBLISHER; date columns: DATE; dated 100/100; newest 2026-10-15; oldest 2026-10-09; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 1/15 judged on topic; off-topic examples: Denmark Open 2026 badminton: Know where to watch live streaming \| Watch Canada Minister Anand Says Ties with India Have Improved (Bloomberg) \| Tilak Varma run out… WATCH video
- Sample:
  - <Tue, 13 Oct 2026 06:00:00> India: End Crackdown on Protesters, Arbitrary Detentions - Human Rights Watch {Human Rights Watch}
  - <Mon, 12 Oct 2026 09:46:00> Denmark Open 2026 badminton: Know where to watch live streaming in India - Olympics {Olympics}
  - <Thu, 15 Oct 2026 15:03:00> IND-W vs ZIM-W T20 2026: Smriti Mandhana era begins as India host Zimbabwe - schedule, where to watch live - O {
  - <Sat, 10 Oct 2026 10:30:00> Watch: Gyanesh Kumar Row: How did the ECI delete 13 crore voters during the SIR \| Insight India - The Hindu {The
  - <Thu, 15 Oct 2026 00:00:00> Watch Canada Minister Anand Says Ties with India Have Improved - Bloomberg.com {Bloomberg.com}
  - <Tue, 13 Oct 2026 00:00:00> Watch In Full: Blackstone's Gray on India's Modi, AI Buildout - Bloomberg.com {Bloomberg.com}
  - <Wed, 14 Oct 2026 00:00:00> Watch India's NIIF Eyes $800M Data Center Investment - Bloomberg.com {Bloomberg.com}
  - <Thu, 15 Oct 2026 00:00:00> Watch Gor: US-India Close to Landing Trade Deal - Bloomberg.com {Bloomberg.com}
  - <Mon, 12 Oct 2026 15:19:17> Rahul Gandhi leads opposition march to top court to demand election chief resign - BBC {BBC}
  - <Sat, 10 Oct 2026 07:00:00> Stumped \| Harmanpreet Kaur: What legacy does India's trailblazing captain leave? - BBC {BBC}
  - <Thu, 15 Oct 2026 00:00:00> Watch US Ambassador to India on Growing Business Ties - Bloomberg.com {Bloomberg.com}
  - <Wed, 14 Oct 2026 06:17:31> Watch India Courts Global Investment Amid Escalating Protest Crackdown - Bloomberg.com {Bloomberg.com}
  - <Tue, 13 Oct 2026 07:38:41> Gandhinagar civic polls: BJP wins 38 seats, Congress secures 5, AAP draws a blank - India Today {India Today}
  - <Mon, 12 Oct 2026 06:06:00> Watch: Tanker off Oman catches fire after drone attack; two of 11 Indians missing - The Times of India {The Time
  - <Mon, 12 Oct 2026 05:55:25> Tilak Varma run out during India vs West Indies 3rd T20I, WATCH video - Sportstar {Sportstar}

### 98. State · Panchayat Watch — BROKEN
- Request: tier=local, feature=Panchayat Watch; HTTP 200, 748 ms, served=live, adapter=news-search, fallback=false
- Page claims: badge "LIVE"; header freshness "—"; source line "Live · 100 stories from Google News"; meta.status "—"
- Note: Live news-search feed.
- Row hosts: news.google.com 100
- Columns shown: DATE · TITLE · SUMMARY · PUBLISHER; date columns: DATE; dated 100/100; newest 2026-10-15; oldest 2026-10-08; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 1 rows (e.g. allahabad high court orders up panchayat polls within three  ×2); duplicate links: 0 rows
- Relevance: 1/15 judged on topic; off-topic examples: DP World India Championship 2026 golf: where to watch \| Watch: Cristiano Ronaldo finds the net \| Forget Rolex, Thailand's power players want a $60 Casio watch
- Sample:
  - <Wed, 14 Oct 2026 09:28:00> DP World India Championship 2026 golf: Know schedule and where to watch live streaming and telecast - Olympics {
  - <Wed, 14 Oct 2026 07:05:32> CJP's Saurav Das, Ashutosh Ranka: India's 'cockroach' leaders jailed after holding protest - BBC {BBC}
  - <Tue, 13 Oct 2026 12:30:01> India Champions Vs West Indies Champions Live Streaming: When And Where To Watch WCL 2026 Match - NDTV Profit {N
  - <Sat, 10 Oct 2026 12:29:31> 'Cockroach' group leaders among hundreds detained in Delhi protest - BBC {BBC}
  - <Tue, 13 Oct 2026 00:00:00> Watch Modi Says India Is The Mother Of Democracy - Bloomberg.com {Bloomberg.com}
  - <Sat, 10 Oct 2026 10:30:00> Watch: Gyanesh Kumar Row: How did the ECI delete 13 crore voters during the SIR \| Insight India - The Hindu {The
  - <Wed, 14 Oct 2026 14:24:24> Allahabad High Court orders UP panchayat polls within three months - India Today {India Today}
  - <Thu, 15 Oct 2026 00:00:00> Watch Canada Minister Anand Says Ties with India Have Improved - Bloomberg.com {Bloomberg.com}
  - <Sat, 10 Oct 2026 02:36:00> Watch: Cristiano Ronaldo finds the net after controversial Portugal break - The Times of India {The Times of Ind
  - <Fri, 09 Oct 2026 07:19:24> Meet India's feisty Gen Z protester who is taking on Modi - BBC {BBC}
  - <Tue, 13 Oct 2026 00:00:00> Watch Sitharaman: Investor Interest in India Extends Beyond AI - Bloomberg.com {Bloomberg.com}
  - <Tue, 13 Oct 2026 00:00:00> Watch India, Africa Leaders on Emerging Market Investment - Bloomberg.com {Bloomberg.com}
  - <Thu, 08 Oct 2026 22:57:15> Central forces called, entry points under watch: Delhi braces for protests over weekend - The Indian Express {Th
  - <Tue, 13 Oct 2026 06:11:00> IMF World Economic Outlook: 10 economies to watch for growth in FY27 and FY28 - Where does India stand? - WION {
  - <Wed, 14 Oct 2026 16:43:31> Forget Rolex, Thailand's power players want a $60 Casio watch from their PM - India Today {India Today}

### 101. State · State Tender Aggregator (State e-Procurement) — BROKEN
- Request: tier=state, feature=State Tender Aggregator (State e-Procurement); HTTP 200, 70 ms, served=live, adapter=scrape, fallback=false
- Page claims: badge "PLANNED"; header freshness "—"; source line "Source: eprocure.gov.in"; meta.status "—"
- Note: Live extraction is not scheduled for this adapter. No records were invented.
- Row hosts: —
- Columns shown: DATE · TITLE; date columns: DATE; dated 0/0; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 0/15 judged on topic
- Sample:


### 61. Carbon · Carbon Registry Wire — MAJOR
- Request: tier=climate, feature=Carbon Registry Wire; HTTP 200, 337 ms, served=live, adapter=api, fallback=false
- Page claims: badge "LIVE"; header freshness "—"; source line "Live · 24 records from verra.org"; meta.status "—"
- Note: Registry publications from Verra, Puro.earth and Isometric where a dated public notice exists. Not a GDELT search. Verra from live RSS. Isometric from the extracted publication list. Puro.earth has no public RSS.
- Row hosts: isometric.com 14, verra.org 10
- Columns shown: Publication · Registry · Date; date columns: Date; dated 10/24; newest 2026-10-12; oldest 2026-09-20; future-dated 0
- Empty >50% (first 50 rows): Date(14/24 empty); duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 15/15 judged on topic
- Sample:
  - <2026-10-13> Verra IFM Methodology Now Eligible under Singapore’s International Carbon Credit Framework
  - <2026-10-12> Verra Approves First Credits Under Rice Methodology
  - <2026-10-06> Verra Approves First Credits Under Food Loss and Waste Methodology
  - <2026-10-05> Projects Open for Public Comment: October 5, 2026
  - <2026-09-29> Consultation and RFP: New CO2 Capture Module Under CCS Methodology
  - <2026-09-28> Verra Secures ICVCM Approval for Carbon Capture and Storage Methodology
  - <2026-09-21> Projects Open for Public Comment: September 21, 2026
  - <—> A new module for energy emissions accounting
  - <—> A new protocol for electrolytic seawater mineralization
  - <—> Advancing energy emissions accounting for carbon removal
  - <—> Aligning incentives
  - <—> Bringing isometrics scientific rigor to trees
  - <—> Certified protocol for biochar production and storage
  - <—> Contributing to critical research
  - <—> Developing direct air capture

### 45. Economics · NSE/BSE Delayed Market Feed — MAJOR
- Request: tier=finance, feature=NSE/BSE Delayed Market Feed; HTTP 200, 4079 ms, served=archive, adapter=embedded, kind=finance-pack, fallback=true
- Page claims: badge "none"; header freshness "stored copy · as of 15 Jul 2026"; source line "Latest stored records"; meta.status "—"
- Note: Showing the latest stored records. Live data is still loading.
- Row hosts: nseindia.com 144
- Columns shown: INDEX / STOCK · VENUE · LAST · CHANGE · CHG % · AS OF · OPEN; date columns: LAST, AS OF; dated 144/144; newest 2026-07-14; oldest 2026-07-14; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 3 rows (e.g. nifty bharat bond index ×4); duplicate links: 143 rows
- Relevance: 15/15 judged on topic
- Sample:
  - <24270.85> NIFTY 50
  - <62190.3> NIFTY MIDCAP 100
  - <25317.6> NIFTY MICROCAP 250
  - <1512.3> NIFTY MEDIA
  - <32244.4> NIFTY FINANCIAL SERVICES EX-BANK
  - <12016.95> NIFTY50 VALUE 20
  - <20142.55> NIFTY100 LOW VOLATILITY 30
  - <8623.4> NIFTY TOP 10 EQUAL WEIGHT
  - <15162.4> NIFTY200 VALUE 30
  - <43385.85> NIFTY TOTAL MARKET MOMENTUM QUALITY 50
  - <31075.9> NIFTY SERVICES SECTOR
  - <8127.85> NIFTY INDIA TOURISM
  - <18381.85> NIFTY MIDSMALL INDIA CONSUMPTION
  - <2012.55> NIFTY WAVES
  - <3143.77> NIFTY COMPOSITE G-SEC INDEX

### 55. Economics · Election Forecast Aggregator — MAJOR
- Request: tier=finance, feature=Election Forecast Aggregator; HTTP 200, 4124 ms, served=archive, adapter=api, fallback=false
- Page claims: badge "OFFLINE"; header freshness "stored copy · date not recorded"; source line "Latest stored records"; meta.status "—"
- Note: Live data is taking longer than usual.
- Row hosts: —
- Columns shown: MARKET; date columns: none; dated 0/0; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Re-probe: 50 rows, served=live, newest 2026-08-02, oldest 2022-03-06
- Relevance: 15/15 judged on topic
- Sample:
  - <2030-01-01> Will Narendra Modi cease to be Prime Minister of India before 2030?
  - <2029-05-31> Who will be the BJP's PM candidate for the Indian General Election expected in 2029?
  - <2029-12-31> Will India hold the general elections in 2029 or not?
  - <2030-01-01> Will the 2024 be the last time Modi runs for the office of the Prime Minister?
  - <2027-03-10> How many seats will BJP win in the 2027 Uttar Pradesh Assembly election?
  - <2027-03-10> How many seats will BJP win in the 2027 Manipur Assembly election?
  - <2026-04-30> 2026 West Bengal Legislative Assembly Elections Winner
  - <2025-11-23> PM Modi (BJP) wins Bihar election?
  - <2024-12-31> Will India adopt a 'One nation, one election' system by 2025?
  - <2024-06-12> Who will be sworn in as the Prime Minister of India after the 2024 election?
  - <2024-06-05> How many seats will the ruling BJP-led National Democratic Alliance win in the 2024 Indian General Election?
  - <2024-06-04> How many seats in the Lok Sabha will the National Democratic Alliance (NDA) win in the next Indian general ele
  - <2024-05-31> Will Rahul Gandhi (leader of India's main opposition party) be in prison in May 2024 (the next Indian general 
  - <2024-03-12> Will State Bank of India release electoral bond data before the first vote is polled for the 2024 General Elec
  - <2023-12-07> Will KCR be the next CM of Telangana ?

### 19. Global · Geopolitics News Wire — MAJOR
- Request: tier=geopolitics, feature=Geopolitics News Wire; HTTP 200, 1000 ms, served=live, adapter=news-search, fallback=false
- Page claims: badge "LIVE"; header freshness "to the present"; source line "Live · 25 stories from BBC World"; meta.status "LIVE · BBC WORLD"
- Note: BBC World news feed. Reporting, not an official government dataset.
- Row hosts: bbc.co.uk 25
- Columns shown: HEADLINE · SOURCE · PUBLISHED; date columns: PUBLISHED; dated 25/25; newest 2026-10-15; oldest 2026-10-13; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 6/15 judged on topic; off-topic examples: Trump calls off livestream for Fort Hood shooter's execution \| Australian woman charged with lacing colleague's curry with snail poison \| Brooklyn shop in 'surreal' row with Kelly Clarkson
- Sample:
  - <Thu, 15 Oct 2026 15:17:21> Trump calls off livestream for Fort Hood shooter's execution by firing squad
  - <Thu, 15 Oct 2026 15:09:15> Russia accuses Ukraine of attacking oil refinery after Zelensky says strikes to resume
  - <Thu, 15 Oct 2026 10:05:29> Two dead in Istanbul after heaviest rainfall in 84 years, governor says
  - <Thu, 15 Oct 2026 08:41:04> White House defends new press secretary over her legal credentials
  - <Thu, 15 Oct 2026 10:51:53> Obama says drift towards extremism 'not inevitable'
  - <Wed, 14 Oct 2026 22:19:13> At the Brooklyn shop in 'surreal' row with Kelly Clarkson over mechanical bird
  - <Thu, 15 Oct 2026 04:17:45> Australian woman charged with lacing colleague's curry with snail poison
  - <Thu, 15 Oct 2026 06:24:45> North Korea and China open new bridge after 12-year delay
  - <Wed, 14 Oct 2026 20:29:05> Student protesters attack government buildings in Albania
  - <Thu, 15 Oct 2026 11:25:19> Why is Starlink internet so important on the battlefield in Ukraine?
  - <Thu, 15 Oct 2026 05:00:23> Hundreds of IDF investigations into killings still have no public outcome, BBC Verify finds
  - <Wed, 14 Oct 2026 23:32:11> India and China aren't friends - but Nepal wants to unite them against climate threats
  - <Thu, 15 Oct 2026 15:05:29> Watch: Pupils heard 'cracking' sound heard moments before Pakistan school roof collapse
  - <Thu, 15 Oct 2026 03:26:36> 'Nowhere to escape' - Indonesians share footage of orange haze blanketing towns
  - <Tue, 13 Oct 2026 22:00:20> Why the lonely in China are hiring 'temporary children'

### 22. Global · Heads of State — MAJOR
- Request: tier=geopolitics, feature=Heads of State; HTTP 200, 63 ms, served=live, adapter=embedded, kind=dossier, fallback=false
- Page claims: badge "LIVE"; header freshness "stored copy · as of 01 Jul 2026"; source line "Stored records from the published source"; meta.status "—"
- Note: Original HTML world-leaders register. As-of the pack date; not a live Wikidata table.
- Row hosts: wikidata.org 43
- Columns shown: COUNTRY · NAME · OFFICE · STATUS · TERM START · NEXT TRANSITION; date columns: none; dated 0/43; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 18 rows (e.g. not verified ×19); duplicate links: 42 rows
- Relevance: 9/15 judged on topic
- Sample:
  - Narendra Modi
  - Xi Jinping
  - Benjamin Netanyahu
  - Not verified
  - Lula da Silva
  - Kim Jong Un
  - Not verified
  - Not verified
  - Cyril Ramaphosa
  - William Ruto
  - Javier Milei
  - Viktor Orban
  - Ferdinand Marcos Jr.
  - Not verified
  - Venezuela (Maduro)

### 31. Global · Global Commodities — MAJOR
- Request: tier=geopolitics, feature=Global Commodities; HTTP 200, 54 ms, served=live, adapter=embedded, kind=dossier, fallback=false
- Page claims: badge "LIVE"; header freshness "stored copy · as of 01 Jul 2026"; source line "Stored records from the published source"; meta.status "AS OF 2026-07 · 24 BENCHMARKS"
- Note: Illustrative benchmark levels from the terminal's pack, as of 2026-07; no live price feed is connected.
- Row hosts: worldbank.org 24
- Columns shown: BENCHMARK · GROUP · LEVEL · CHANGE; date columns: none; dated 0/24; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 23 rows
- Relevance: 15/15 judged on topic
- Sample:
  - Brent crude
  - WTI crude
  - US Henry Hub
  - Thermal coal
  - Copper
  - Nickel
  - Zinc
  - Tin
  - Gold
  - Platinum
  - Wheat
  - Corn
  - Palm oil
  - Sugar
  - Coffee (Arabica)

### 36. Law · District Court Case Tracker — MAJOR
- Request: tier=judiciary, feature=District Court Case Tracker; HTTP 200, 882 ms, served=live, adapter=news-search, fallback=false
- Page claims: badge "LIVE"; header freshness "last 7 days"; source line "Live · 52 stories from Google News"; meta.status "LIVE · NEWS RSS"
- Note: 52 coverage rows (Google News RSS — court / litigation coverage. Not an official docket or cause list.).
- Row hosts: news.google.com 52; sections: COVERAGE — GOOGLE NEWS RSS 52
- Columns shown: DATE · TITLE · SUMMARY · PUBLISHER · SECTION; date columns: DATE; dated 52/52; newest 2026-10-15; oldest 2026-10-08; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 2 rows (e.g. india news ×3); duplicate links: 0 rows
- Relevance: 8/15 judged on topic; off-topic examples: Supreme Court Seeks States' Reply To PIL On Vacancies \| FPJ Exclusive: Para Swimmer Niranjan Mukundan \| Bombay HC Calls Out Bandra Society
- Sample:
  - <Wed, 14 Oct 2026 17:12:56> YouTuber Dhruv Rathee Gets Delhi Court Summons In Case Over 2018 'BJP IT Cell' Video - NDTV [COVERAGE — GOOGLE N
  - <Wed, 14 Oct 2026 12:37:49> Mumbai court junks plea for FIR against former minister Ashok Gajapathi Raju, Air India ex-CMD in flight s - T [
  - <Wed, 14 Oct 2026 13:47:00> Gag orders by proxy: Siddaramaiah joins long list of politicians obtaining pre-trial injunctions from Bengalur [
  - <Fri, 09 Oct 2026 11:56:23> Supreme Court Seeks States’ Reply To PIL On Vacancies In Electricity Regulatory Commissions - LawChakra [COVERAG
  - <Wed, 14 Oct 2026 11:47:48> 590 Days After Blue Drum Was Sealed, Meerut Murder Ends In Death Sentences - NDTV [COVERAGE — GOOGLE NEWS RSS] {
  - <Wed, 14 Oct 2026 10:52:14> Muskan, boyfriend Sahil Shukla sentenced to death by district court in Meerut blue drum murder case - India TV [
  - <Tue, 13 Oct 2026 02:57:33> Court Grants Bail to Luthra Brothers in Goa's Birch Nightclub NOC Forgery Case - Republic World [COVERAGE — GOOG
  - <Wed, 14 Oct 2026 17:14:42> No Lame Excuses: Supreme Court Slams ECI Over Missing Sringeri Poll Footage - Free Press Journal [COVERAGE — GOO
  - <Sun, 11 Oct 2026 08:17:50> ‘Heading Back To My Village’: Abhijeet Dipke After Release From Delhi Police Detention - Free Press Journal [COV
  - <Thu, 08 Oct 2026 21:04:13> Bombay HC Calls Out Bandra Society’s ‘Double Standard’ Over Basement Membership, Upholds Developer’s - Free Pr [
  - <Sun, 11 Oct 2026 09:00:22> FPJ Exclusive \| People See 19 Surgeries, I See 107 Medals For India: Para Swimmer Niranjan Mukundan Opens Up - [
  - <Mon, 12 Oct 2026 09:00:39> Ab Poora Desh Jantar Mantar Banega: CJPs Abhijeet Dipke After Delhi Police De-notifies Protest Site - Free Pre [
  - <Fri, 09 Oct 2026 10:48:59> CJP Protest: Don’t Completely Stop Metro, Train Services In Delhi Ahead Of October 10 Agitation, SC Tells - Fr [
  - <Tue, 13 Oct 2026 00:28:22> India News \| Goa: Court Grants Bail to Luthra Brothers in Birch Nightclub NOC Forgery Case - LatestLY [COVERAGE 
  - <Wed, 14 Oct 2026 13:58:00> Will Meerut Blue Drum Murder Accused Muskan And Sahil Be Hanged? What Indian Death Penalty Rules Say - The Dai [

### 39. Law · Judge & bench reporting — MAJOR
- Request: tier=judiciary, feature=HC Judge Profiles & Bench Analytics; HTTP 200, 601 ms, served=live, adapter=news-search, fallback=false
- Page claims: badge "LIVE"; header freshness "last 7 days"; source line "Live · 36 stories from Google News"; meta.status "LIVE · NEWS RSS"
- Note: 36 coverage rows (Google News RSS — court / litigation coverage. Not an official docket or cause list.).
- Row hosts: news.google.com 36; sections: COVERAGE — GOOGLE NEWS RSS 36
- Columns shown: DATE · TITLE · SUMMARY · PUBLISHER · SECTION; date columns: DATE; dated 36/36; newest 2026-10-15; oldest 2026-10-08; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 6/15 judged on topic; off-topic examples: Republicans can confirm a Supreme Court justice if Democrats take the Senate \| 2026 Texas Judicial Elections \| 39 newly appointed judges sworn in at Azerbaijan's Supreme Court
- Sample:
  - <Mon, 12 Oct 2026 12:30:32> President transfers Justice T. Vinod Kumar to Telangana High Court - SCC Online [COVERAGE — GOOGLE NEWS RSS] {SC
  - <Tue, 13 Oct 2026 05:11:55> Calcutta High Court Mulls Metal Detectors On Court Premises After Attacks On Lawyers - Live Law [COVERAGE — GOOG
  - <Mon, 12 Oct 2026 18:31:08> Justice T. Vinod Kumar Transferred Back to Telangana High Court from Madras High Court - Deccan Chronicle [COVER
  - <Thu, 15 Oct 2026 09:49:14> Supreme Court Justice Yael Willner appointed to Judicial Selection Committee - The Times of Israel [COVERAGE — G
  - <Wed, 14 Oct 2026 12:23:29> Republicans can confirm a Supreme Court justice if Democrats take the Senate, but at what cost? - The Conversa [
  - <Tue, 13 Oct 2026 14:35:02> Justice Indira Banerjee explains why fewer women are appointed as arbitrators - Bar and Bench [COVERAGE — GOOGLE
  - <Tue, 13 Oct 2026 07:04:01> Justice T. Vinod Kumar returns to Telangana High Court - Hyderabad Mail [COVERAGE — GOOGLE NEWS RSS] {Hyderabad 
  - <Tue, 13 Oct 2026 13:18:00> Madras high court gets two new additional judges - The Times of India [COVERAGE — GOOGLE NEWS RSS] {The Times of
  - <Tue, 13 Oct 2026 07:26:00> Who is CJI Surya Kant? Education, career amid Supreme Court Bar Association row over resignation call - Educat [
  - <Mon, 12 Oct 2026 14:55:21> Supreme Court Breaks Tradition: Three New Judges to Take Oath in Afternoon - Pragativadi [COVERAGE — GOOGLE NEWS
  - <Sat, 10 Oct 2026 11:10:20> Yes or no? Here are the Chronicle’s endorsements for California Supreme Court and appeals courts - San Francis [
  - <Mon, 12 Oct 2026 21:22:19> 2026 Texas Judicial Elections: Full guide to Supreme Court and Criminal Appeals candidates - KRIS 6 News Corpu [
  - <Wed, 14 Oct 2026 23:42:00> Candidates are on the ballot, but can't serve if voters elect them \| Finley - The Detroit News [COVERAGE — GOOGL
  - <Mon, 12 Oct 2026 12:33:00> 39 newly appointed judges sworn in at Azerbaijan’s Supreme Court - Operativ Məlumat Mərkəzi [COVERAGE — GOOGLE N
  - <Thu, 15 Oct 2026 14:42:32> Allahabad High Court Transfers 35 Judicial Officers: Satyendra Kumar Named Unnao District Judge - Indianmaster [

### 41. Law · ICJ Proceedings — MAJOR
- Request: tier=judiciary, feature=ICJ Proceedings; HTTP 200, 598 ms, served=live, adapter=news-search, fallback=false
- Page claims: badge "LIVE"; header freshness "last 7 days"; source line "Live · 51 stories from Google News"; meta.status "LIVE · NEWS RSS"
- Note: 51 coverage rows (Google News RSS — court / litigation coverage. Not an official docket or cause list.).
- Row hosts: news.google.com 51; sections: COVERAGE — GOOGLE NEWS RSS 51
- Columns shown: DATE · TITLE · SUMMARY · PUBLISHER · SECTION; date columns: DATE; dated 51/51; newest 2026-10-15; oldest 2026-10-08; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 1 rows (e.g. türkiye condemns colombia’s decision to relocate its embassy ×2); duplicate links: 0 rows
- Relevance: 2/15 judged on topic; off-topic examples: Nobel Peace Prize awarded to Navi Pillay (several outlets) \| United Nations - Global Issues (Britannica) \| Who pays for the climate catastrophe? (DW)
- Sample:
  - <Fri, 09 Oct 2026 07:00:00> Electing ICJ Judges: The Complex Battle for a Seat on the World’s Highest Court - Center on International Coop [
  - <Fri, 09 Oct 2026 16:09:28> Nobel Peace Prize awarded to Navi Pillay of International Court of Justice - CBC [COVERAGE — GOOGLE NEWS RSS] {C
  - <Sat, 10 Oct 2026 05:00:00> United Nations - Global Issues, Reforms, Solutions - Britannica [COVERAGE — GOOGLE NEWS RSS] {Britannica}
  - <Tue, 13 Oct 2026 12:50:16> Who pays for the climate catastrophe? - DW.com [COVERAGE — GOOGLE NEWS RSS] {DW.com}
  - <Fri, 09 Oct 2026 09:03:34> South Africa's Navi Pillay wins 2026 Nobel Peace Prize - France 24 [COVERAGE — GOOGLE NEWS RSS] {France 24}
  - <Fri, 09 Oct 2026 15:20:05> Israel a rare dissenting voice as praise pours in for Nobel Peace Prize winner Navi Pillay - France 24 [COVERAGE
  - <Fri, 09 Oct 2026 11:15:47> Nobel Peace Prize committee hails importance of international law - Newsinenglish.no [COVERAGE — GOOGLE NEWS RSS
  - <Fri, 09 Oct 2026 11:27:35> Former ICC judge Navi Pillay awarded Nobel Peace Prize - DutchNews.nl [COVERAGE — GOOGLE NEWS RSS] {DutchNews.nl
  - <Fri, 09 Oct 2026 09:57:00> Navi Pillay wins 2026 Nobel Peace Prize for advancing international justice - CHOSUNBIZ - Chosunbiz [COVERAGE — 
  - <Fri, 09 Oct 2026 12:18:00> South Africa's Navanethem ‘Navi’ Pillay wins 2026 Nobel Peace Prize - Saudi Gazette [COVERAGE — GOOGLE NEWS RSS]
  - <Fri, 09 Oct 2026 15:32:59> Israel scolds pick amid Pillay Nobel Peace Prize praise - https://aapnews.aap.com.au/ [COVERAGE — GOOGLE NEWS RS
  - <Fri, 09 Oct 2026 09:24:00> JUST IN: Ex-UN Human Rights Chief Navi Pillay Wins 2026 Nobel Peace Prize - TVC News [COVERAGE — GOOGLE NEWS RSS
  - <Fri, 09 Oct 2026 11:05:32> South African human rights lawyer Navi Pillay awarded Nobel peace prize - Moneyweb [COVERAGE — GOOGLE NEWS RSS] 
  - <Wed, 14 Oct 2026 20:02:29> Fonseca: Belize-Guatemala Relations Still Face Challenges - Greater Belize Media [COVERAGE — GOOGLE NEWS RSS] {G
  - <Wed, 14 Oct 2026 21:03:53> Belize protests Guatemala’s violation of our airspace - Amandala Newspaper [COVERAGE — GOOGLE NEWS RSS] {Amandal

### 3. National · Policy Pipeline Tracker — MAJOR
- Request: tier=national, feature=Policy Pipeline Tracker (Draft-to-Gazette); HTTP 200, 1572 ms, served=live, adapter=api, fallback=false
- Page claims: badge "LIVE"; header freshness "to the present"; source line "Live · 20 records from Press Information Bureau"; meta.status "LIVE · PIB RSS · EN"
- Note: Live PIB RSS with English titles resolved from PressReleasePage (EN cookie). Draft-to-gazette stages are not in the RSS.
- Row hosts: pib.gov.in 20
- Columns shown: POLICY · STAGE · LAST OFFICIAL ACTION; date columns: LAST OFFICIAL ACTION; dated 20/20; newest 2026-10-14; oldest 2026-10-14; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 1/15 judged on topic; off-topic examples: 12th session of India – Japan Joint Working Group (JWG) on Roads \| DRI seizes around 6.2 kg foreign-origin gold \| PM interacts with the contingent of Indian athletes (Asian Games)
- Sample:
  - <2026-10-15> National Workshop held on “Strengthening Digital Data Systems and Evidence-Based Learning” under Deendayal Ant {Press Informati
  - <2026-10-15> India’s Ramsar Site tally reaches 103 with addition of Sukhna Wetland (Chandigarh) and Sauj Jheel (UP) {Press Information Burea
  - <2026-10-15> 12th session of India – Japan Joint Working Group (JWG) on Roads and Road Transportation Sector {Press Information Bureau}
  - <2026-10-15> Prime Minister Shri Narendra Modi interacts with the contingent of Indian athletes who participated in Asian G {Press Informati
  - <2026-10-15> PRESS COMMUNIQUE {Press Information Bureau}
  - <2026-10-15> SHILP SAMAGAM MELA 2026-Mysuru {Press Information Bureau}
  - <2026-10-15> Union Home Minister and Minister of Cooperation Shri Amit Shah congratulates Assam CM and Assam Police for sus {Press Informati
  - <2026-10-15> Customs officers detect 148.67 kg hydroponic weed from Bangkok at air cargo complex at IGI Airport {Press Information Bureau}
  - <2026-10-15> DRI seizes around 6.2 kg foreign-origin gold; busts sophisticated gold smuggling modus operandi through unacco {Press Informati
  - <2026-10-15> Directorate of Revenue Intelligence (DRI) and Central Bureau of Narcotics (CBN) destroy 2.87 Hectares (7.08 Ac {Press Informati
  - <2026-10-15> Dr. Mansukh Mandaviya asks National Sports Federations to strengthen pipeline of champions at Asian Games revi {Press Informati
  - <2026-10-15> Union Commerce and Industry Minister Shri Piyush Goyal Launches National Strategic Trade Command Centre at Van {Press Informati
  - <2026-10-15> ‘Swachhata se Samman, Har Varg ka Utthan’ {Press Information Bureau}
  - <2026-10-15> Mahila Kisan Diwas 2026 celebrated today {Press Information Bureau}
  - <2026-10-15> TDB-DST supports Development and Commercialisation of Indigenous 32-Slice CT Scanner by Panacea Medical Techno {Press Informati

### 11. National · Cabinet Decisions — MAJOR
- Request: tier=national, feature=Cabinet Decisions; HTTP 200, 516 ms, served=live, adapter=embedded, fallback=true
- Page claims: badge "none"; header freshness "stored copy · as of 07 Sep 2026"; source line "Latest stored records"; meta.status "STORED · LAST-KNOWN-GOOD"
- Note: No Cabinet decision in the latest PIB window (20 releases checked). Showing the stored Cabinet decisions.
- Row hosts: pib.gov.in 1
- Columns shown: Decision · Ministry · Date · Source; date columns: Date; dated 1/1; newest 2026-05-11; oldest 2026-05-11; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 1/15 judged on topic
- Sample:
  - <2026-05-12> Cabinet approves Minimum Support Prices (MSP) for Kharif Crops for Marketing Season 2026-27

### 12. National · Central Tender Aggregator — MAJOR
- Request: tier=national, feature=Central Tender Aggregator + Constituency Filter; HTTP 200, 81 ms, served=live, adapter=embedded, fallback=true
- Page claims: badge "none"; header freshness "stored copy · date not recorded"; source line "Latest stored records"; meta.status "ARCHIVE · EPROCURE LAST-KNOWN-GOOD"
- Note: eProcure is HTML-gated. value_inr, sector, ministry_department and location are empty in all rows — Total Value must not print ₹0. GeM BidPlus robots.txt bars automated retrieval.
- Row hosts: eprocure.gov.in 10
- Columns shown: TENDER ID · TENDER · DEADLINE; date columns: DEADLINE; dated 10/10; newest 2026-07-13; oldest 2026-07-10; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 10/15 judged on topic
- Sample:
  - <13-Jul-2026 03:00 PM> 1. M/o various schemes under NA.II (EZ).SH-    Providing, fixing and installation of piezometer with digital w
  - <13-Jul-2026 03:00 PM> 2. M/o Various Schemes under NA.II (EZ)S.H.-Replacement of existing G.S. sheet roof AND painting of external F
  - <13-Jul-2026 03:00 PM> 3. M/o Various schemes under NA.II (EZ) Sub-Head- Day to day Cleaning and scavenging of  24m, 30m AND 45m R/W 
  - <13-Jul-2026 03:00 PM> 4. M/o Various Schemes underNA.II (EZ).S.H.-Repair AND maintenance of QAC Zonal Lab i/c painting, plaster, roo
  - <13-Jul-2026 03:00 PM> 5. M/o Various Schemes under NA.II (EZ)S.H.-Cleaning of Chocked Sewer line by diesel running vehicle mounting 
  - <10-Jul-2026 12:00 PM> 6. Repair and maintenance of 630 KVA Transformer installed at near main gate of BSF campus Paloura under Ftr H
  - <13-Jul-2026 03:00 PM> 7.  M/o Various schemes under NA.II (EZ) Sub-Head	-Cleaning of toilet, pantries, sweeping, moping of DDA Utsav
  - <13-Jul-2026 03:00 PM> 8. M/o various schemes under NA.II (EZ).SH-    Providing, fixing AND installation of piezometer with digital w
  - <13-Jul-2026 11:00 AM> 9. Water Proofing treatment of roof of Strachey Hall
  - <13-Jul-2026 11:00 AM> 10. 1 Raising of Back side Boundary wall about 3 feet height and Re fixing of existing grill at Begum Sultan J

### 14. National · Centre-Sanctioned Projects — MAJOR
- Request: tier=national, feature=Centre-sanctioned Projects & Completion Rate; HTTP 200, 73 ms, served=live, adapter=embedded, fallback=false
- Page claims: badge "none"; header freshness "stored copy · as of 01 Jan 2026"; source line "Stored records from mospi.gov.in"; meta.status "CURATED · AS OF JAN 2026"
- Note: Eight flagship programmes. PAIMANA not wired — no original/revised cost, expenditure or end dates. Winning bidder is dropped (refuted).
- Row hosts: (none) 8
- Columns shown: PROJECT; date columns: none; dated 0/8; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 8/15 judged on topic
- Sample:
  - PM Gati Shakti
  - Bharatmala Pariyojana
  - Sagarmala
  - Dedicated Freight Corridors
  - Jal Jeevan Mission
  - PMAY (urban + rural)
  - Vande Bharat programme
  - Smart Cities Mission

### 88. State · MLA Defection & Anti-defection Case Tracker — MAJOR
- Request: tier=state, feature=MLA Defection & Anti-defection Case Tracker; HTTP 200, 262 ms, served=live, adapter=news-search, fallback=false
- Page claims: badge "LIVE"; header freshness "—"; source line "Live · 50 stories from Google News"; meta.status "LIVE · NEWS RSS"
- Note: Google News search for MLA defections, anti-defection (Tenth Schedule) cases, disqualification petitions and Speakers' decisions. Reporting only: not a register of defections or of pending petitions.
- Row hosts: news.google.com 50
- Columns shown: DATE · TITLE · SUMMARY · PUBLISHER; date columns: DATE; dated 50/50; newest 2026-09-26; oldest 2019-03-26; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 15/15 judged on topic
- Sample:
  - <2026-09-27> 111 sitting MPs, MLAs switched parties in 4 years, 26% of them joined BJP: ADR - India Today {India Today}
  - <2026-09-25> 111 MPs, MLAs changed parties after winning elections since 2022: ADR - Rediff {Rediff}
  - <2026-06-28> What voters think about defection? Switching party unethical &amp; for power, personal gains: Survey - Deccan  {Deccan Herald}
  - <2026-04-25> Chadha's Move To Merge With BJP Adds To Growing List Of 'Defections' Testing Law - ETV Bharat {ETV Bharat}
  - <2025-11-18> ‘Finish it by next week or face contempt’: Supreme Court slams Telangana Speaker over 10 BRS MLAs’ disqualific {The Indian Expr
  - <2025-11-13> Calcutta High Court Cancels Mukul Roy’s MLA Membership: ‘Anti-Defection Law Turned Into a Joke,’ Says Suvendu  {LawChakra}
  - <2025-06-06> Mukhtar Ansari’s MLA son Abbas deliberately disqualified by govt: Akhilesh - ThePrint {ThePrint}
  - <2024-09-29> India’s anti-defection law: Four decades of failure - The Week {The Week}
  - <2024-07-06> BRS continues to leak MLAs, seventh party leader joins Congress in Telangana - The Indian Express {The Indian Express}
  - <2024-02-29> Twin boost? Kaliaganj MLA joins BJP; former Congress leader believed to be next - The Indian Express {The Indian Express}
  - <2023-09-11> Former BJP Legislator Joins Congress In Madhya Pradesh Ahead Of Polls - NDTV {NDTV}
  - <2021-11-24> Uttar Pradesh: Rebel Congress MLA Aditi Singh joins BJP - The Times of India {The Times of India}
  - <2021-06-28> Despite multiple defections, no disqualification recorded in Bengal Assembly in past decade - The New Indian E {The New Indian 
  - <2020-11-28> MLA Mihir Goswami quits TMC, joins BJP - The Indian Express {The Indian Express}
  - <2019-06-08> MLAs' defection: Telangana Congress leader Vikramarka launches 36-hour fast - The Times of India {The Times of India}

### 90. State · State Governance Brief — MAJOR
- Request: tier=state, feature=State Governance Brief; HTTP 200, 144 ms, served=live, adapter=news-search, fallback=false
- Page claims: badge "LIVE"; header freshness "last 7 days"; source line "Live · 120 stories from Press Information Bureau and Google News"; meta.status "LIVE · PIB / NEWS RSS"
- Note: 20 PIB · 100 state coverage (Google News RSS — state government / CM / Vidhan Sabha coverage). Not a personalised governance digest.
- Row hosts: news.google.com 100, pib.gov.in 20; sections: Government wire (PIB) 20, State coverage 100
- Columns shown: DATE · TITLE · SECTION · SOURCE · SUMMARY · PUBLISHER; date columns: DATE; dated 100/120; newest 2026-10-15; oldest 2026-10-09; future-dated 0
- Empty >50% (first 50 rows): SOURCE(30/50 empty); duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 7/15 judged on topic; off-topic examples: Cabinet approves Rs 52,878 crore sale of 60.72% stake in IDBI Bank (Union Cabinet) \| DA hike for central government employees \| PIB: 12th session of India – Japan JWG on Roads (DATE —)
- Sample:
  - <—> National Workshop held on “Strengthening Digital Data Systems and Evidence-Based Learning” under Deendayal Ant [Government wire (PIB)] {
  - <—> Union Home Minister and Minister of Cooperation Shri Amit Shah congratulates Assam CM and Assam Police for sus [Government wire (PIB)] {
  - <—> ‘Swachhata se Samman, Har Varg ka Utthan’ [Government wire (PIB)] {PIB}
  - <Thu, 15 Oct 2026 04:19:02> "Difficult": Chennai Auto Drivers On Chief Minister Vijay's Free Bus Scheme - NDTV [State coverage] {NDTV}
  - <Wed, 14 Oct 2026 11:42:00> Cabinet approves Rs 52,878 crore sale of 60.72% stake in IDBI Bank to Fairfax entity - DD India [State coverage]
  - <Wed, 14 Oct 2026 10:42:00> Cabinet Secretariat Recruitment Through GATE 2026: Apply for Jobs - Careers360 [State coverage] {Careers360}
  - <Tue, 13 Oct 2026 12:49:00> L Murugan writes to PM Modi seeking exit from Union Cabinet, says wants to return to grassroots - The Times of [
  - <Wed, 14 Oct 2026 13:48:58> Bengal Cabinet sanctions 45,185 new recruitments – here are the departments - The Indian Express [State coverage
  - <Thu, 15 Oct 2026 12:51:03> Karnataka cabinet rejects Ring Road murder case accused’s clemency plea - ThePrint [State coverage] {ThePrint}
  - <Wed, 14 Oct 2026 14:33:12> Taking the Secretariat to the village square: Why doorstep governance actually works - The Week [State coverage]
  - <Wed, 14 Oct 2026 08:54:58> Karnataka to be long-term partner of Czech Republic, says CM Shivakumar; invites firms to invest beyond Bengal [
  - <Mon, 12 Oct 2026 10:14:53> DA hike for central government employees: AIDEF urges cabinet secretary, Finance Ministry to announce DA h - T [
  - <Wed, 14 Oct 2026 05:49:00> ‘Public rejected Congress, AAP’: Rekha Gupta targets INDIA bloc over SIR protest, alleges political agenda - A [
  - <Wed, 14 Oct 2026 06:19:24> Meghalaya Cabinet Clears name change - Indian Cooperative [State coverage] {Indian Cooperative}
  - <Wed, 14 Oct 2026 11:21:56> Cabinet approves Fairfax's ₹52,878-crore bid for IDBI Bank; largest FDI ever in India's financial sector - Ups [

### 91. State · Governor Assent Tracker — MAJOR
- Request: tier=state, feature=Governor Assent Tracker; HTTP 200, 114 ms, served=live, adapter=news-search, fallback=false
- Page claims: badge "LIVE"; header freshness "—"; source line "Live · 25 stories from Google News"; meta.status "—"
- Note: Live news-search feed.
- Row hosts: news.google.com 25
- Columns shown: DATE · TITLE · SUMMARY · PUBLISHER; date columns: DATE; dated 25/25; newest 2026-10-15; oldest 2026-10-09; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 3/15 judged on topic; off-topic examples: Sarkaria Commission, Recommendations, Significance, UPSC PYQs (Vajiram & Ravi) \| Gilgit-Baltistan Assembly passes 'amended' Local Govt Act \| Gujarat seals four warehouses over cattle-feed adulteration
- Sample:
  - <Mon, 12 Oct 2026 10:39:55> 6th Schedule of Indian Constitution, Provisions, States, Articles - Vajiram &amp; Ravi {Vajiram & Ravi}
  - <Sun, 11 Oct 2026 21:33:38> Supreme Court Dismisses Writ Petitions Challenging Ordinance on Village Officers' Abolition — Upholds Governor {
  - <Wed, 14 Oct 2026 02:00:39> Deadline for industrial nod reduced after Governor's assent - DT Next {DT Next}
  - <Tue, 13 Oct 2026 03:04:29> Tamil Nadu CM Vijay greets Arlekar on full-time Governor appointment - The New Indian Express {The New Indian Ex
  - <Thu, 15 Oct 2026 08:54:28> OPINION \| When silence becomes a constitutional problem - The Week {The Week}
  - <Tue, 13 Oct 2026 03:46:13> Ex-Minister Was Walking With Grandson, Then A Call That He Is New Governor - NDTV {NDTV}
  - <Mon, 12 Oct 2026 11:48:35> Sarkaria Commission, Recommendations, Significance, UPSC PYQs - Vajiram &amp; Ravi {Vajiram & Ravi}
  - <Mon, 12 Oct 2026 05:40:33> Pardoning Powers of the President, Article 72, Principles, Provisions - Vajiram &amp; Ravi {Vajiram & Ravi}
  - <Sun, 11 Oct 2026 11:13:59> Indian Constitution Amendments, List, Process, Limitations - Vajiram &amp; Ravi {Vajiram & Ravi}
  - <Fri, 09 Oct 2026 20:23:33> Omar Abdullah invites GCC firms to invest in J&amp;K, create jobs for local youth - thekashmirimages.com {thekas
  - <Thu, 15 Oct 2026 01:58:30> Gilgit-Baltistan Assembly passes ‘amended’ Local Govt Act 2026 - Dawn {Dawn}
  - <Tue, 13 Oct 2026 06:39:18> President Murmu Orders Gubernatorial Reshuffle Across Six States - illustrated Daily News {illustrated Daily New
  - <Mon, 12 Oct 2026 18:20:51> Gujarat seals four warehouses over suspected cattle-feed adulteration; stock worth Rs 25 crore under scrutiny  {
  - <Tue, 13 Oct 2026 04:26:42> Sudha Yadav Appointed Karnataka Governor, State Gets Second Woman - Dainik Jagran MP CG {Dainik Jagran MP CG}
  - <Tue, 13 Oct 2026 02:23:00> Karnataka HC Strikes Down SC-ST Quota Over 50 Per Cent Limit Breach, Terms It Unconstitutional - The Daily Jag {

### 92. State · Assembly Proceedings Digest (Vernacular, Translated) — MAJOR
- Request: tier=state, feature=Assembly Proceedings Digest (Vernacular, Translated); HTTP 200, 136 ms, served=live, adapter=news-search, fallback=false
- Page claims: badge "LIVE"; header freshness "—"; source line "Live · 42 stories from Google News"; meta.status "—"
- Note: Live news-search feed.
- Row hosts: news.google.com 42
- Columns shown: DATE · TITLE · SUMMARY · PUBLISHER; date columns: DATE; dated 42/42; newest 2026-10-15; oldest 2026-10-08; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 10/15 judged on topic; off-topic examples: Ramlila reflects values of Indian civilisation, says Delhi Assembly Speaker \| 'Two-language policy should not remain just on paper': P Chidambaram \| Keralam Congress raises stink over poll process
- Sample:
  - <Mon, 12 Oct 2026 08:12:55> State legislatures are the heartbeat of Indian democracy: Vice President C. P. Radhakrishnan - News On AIR {News
  - <Fri, 09 Oct 2026 16:51:10> Punjab Assembly session to begin on Oct 22 - ThePrint {ThePrint}
  - <Mon, 12 Oct 2026 16:32:00> Kerala assembly passes resolution seeking removal of CEC - The Statesman {The Statesman}
  - <Tue, 13 Oct 2026 05:47:21> Keralam Congress raises stink over poll process that brought it to power - India Today {India Today}
  - <Sun, 11 Oct 2026 14:01:00> Ramlila reflects values of Indian civilisation, says Delhi Assembly Speaker Vijender Gupta - ANI News {ANI News}
  - <Sun, 11 Oct 2026 14:32:00> Assembly session likely to witness heated exchanges, protests - The Times of India {The Times of India}
  - <Wed, 14 Oct 2026 17:38:00> State assembly session at Gairsain from Oct 27 - The Times of India {The Times of India}
  - <Tue, 13 Oct 2026 02:01:00> LDF walkout from Keralam Assembly over police action at University Hostel - The New Indian Express {The New Indi
  - <Sun, 11 Oct 2026 13:16:00> Kerala CM likely to move resolution in State As… - United News of India {United News of India}
  - <Tue, 13 Oct 2026 09:57:16> First in India: Keralam introduces Bill to regulate elderly care services - The South First {The South First}
  - <Mon, 12 Oct 2026 08:03:18> Kerala Assembly Resolution Seeks CEC Gyanesh Kumar’s Removal, Restoration of Voter Rights - www.nationpathindi {
  - <Sun, 11 Oct 2026 13:43:00> "Two-language policy should not remain just on paper": P Chidambaram - www.indiagazette.com {www.indiagazette.co
  - <Thu, 08 Oct 2026 21:59:38> BJP Revives West Bengal Renaming Proposal, Eyes Bill In Next Assembly Session - BW Businessworld {BW Businesswor
  - <Mon, 12 Oct 2026 08:43:07> Murder threats, head injuries and 'suspicious' start-line of anti-CEC march animate first day of Assembly sess {
  - <Mon, 12 Oct 2026 07:58:37> Keralam Assembly passes resolution for removal of CEC - The Siasat Daily {The Siasat Daily}

### 93. State · MLA Report Card + Statement Tracker — MAJOR
- Request: tier=state, feature=MLA Report Card + Statement Tracker; HTTP 200, 367 ms, served=live, adapter=api, fallback=false
- Page claims: badge "LIVE"; header freshness "to the present"; source line "Live · 497 records from Wikidata and Google News"; meta.status "—"
- Note: 400 MLA profiles (wikidata) · 97 coverage rows (Google News RSS MLA/assembly coverage). Not a complete attendance/questions meter — UP pack is empty on disk; Wikidata supplies identities.
- Row hosts: wikidata.org 400, news.google.com 97; sections: MLA profiles 400, Statement / coverage wire 97
- Columns shown: TITLE · PERSON · PERSONLABEL · POSITIONLABEL · STATELABEL · POSITION · STATE; date columns: none; dated 0/497; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 5 rows (e.g. ashok anand ×2; abdul ghafoor ×2; india news ×4); duplicate links: 0 rows
- Relevance: 13/15 judged on topic; off-topic examples: Q16318086 (unlabelled Wikidata id) \| 'Make in India' transforming economy: MLA Reasi
- Sample:
  - Akbaruddin Owaisi [MLA profiles]
  - Guntakandla Jagadish Reddy [MLA profiles]
  - T.Raja Singh Lodh [MLA profiles]
  - Koppula Eshwar [MLA profiles]
  - Dansari Anasuya [MLA profiles]
  - Namassivayam [MLA profiles]
  - Kamisetty Parasuram Naidu [MLA profiles]
  - Pani Taram [MLA profiles]
  - Tenzing Norbu Thongdok [MLA profiles]
  - Rajesh Tacho [MLA profiles]
  - Ram Kripal Sinha [MLA profiles]
  - Q16318086 [MLA profiles]
  - Gajendra Prasad Himanshu [MLA profiles]
  - ‘Make in India’ transforming economy, creating opportunities for youth: MLA Reasi - Daily Excelsior [Statement / coverage wire] {Daily Excel
  - Darbar Sahib management files complaint against AAP MLA over caste bias charge, seeks legal action - The Tribu [Statement / coverage wire] {

### 94. State · Legislative Productivity Comparison — MAJOR
- Request: tier=state, feature=Legislative Productivity Comparison; HTTP 200, 239 ms, served=live, adapter=news-search, fallback=false
- Page claims: badge "LIVE"; header freshness "—"; source line "Live · 50 stories from Google News"; meta.status "LIVE · NEWS RSS"
- Note: Google News search for state assembly sessions: sittings, sessions cut short or adjourned sine die, bills passed, walkouts. News coverage only: sittings, hours and bills-passed counts are not measured or compared.
- Row hosts: news.google.com 50
- Columns shown: DATE · TITLE · SUMMARY · PUBLISHER; date columns: DATE; dated 50/50; newest 2026-09-27; oldest 2017-02-21; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 2 rows (e.g. assembly adjourned sine die ×2; monsoon session: maharashtra assembly adjourned due to heavy ×2); duplicate links: 0 rows
- Relevance: 15/15 judged on topic
- Sample:
  - <2026-09-28> Assembly adjourned sine die - The Times of India {The Times of India}
  - <2026-09-07> Telangana Assembly adjourned shortly after monsoon session begins - Awaz The Voice {Awaz The Voice}
  - <2026-08-24> Karnataka \| The monsoon legislature session that was...or wasn’t - Deccan Herald {Deccan Herald}
  - <2026-07-29> Assembly adjourned sine die - The Times of India {The Times of India}
  - <2026-07-06> Monsoon session: Maharashtra assembly adjourned due to heavy rains in Mumbai - ThePrint {ThePrint}
  - <2026-03-17> 10 govt Bills passed during 28-day Mizoram assembly session - ThePrint {ThePrint}
  - <2026-02-05> Goa assembly budget session from March 6-27 - The Times of India {The Times of India}
  - <2025-12-06> NDA slams Tejashwi for skipping many sittings in winter session of Assembly - The New Indian Express {The New Indian Express}
  - <2025-09-01> Monsoon session of Raj Assembly commences on stormy note; Oppn Congress protests over ‘Vote Theft’ - The State {The Statesman}
  - <2025-03-25> Bill to regulate coaching centers stalled as Rajasthan Assembly session adjourned indefinitely - The New India {The New Indian 
  - <2024-12-20> Madhya Pradesh 5-Day Assembly Session Concludes; 10 Bills Passed Amid High-Voltage Drama and Protest - LatestL {LatestLY}
  - <2024-02-29> Two Amendment Bills Passed by Assembly on Eve of Budget Session - Vibes Of India {Vibes Of India}
  - <2023-09-30> Amid huge uproar, Odisha Legislative Assembly adjourned till 4 pm - ANI News {ANI News}
  - <2023-02-13> Assembly adjourned sine-die; no CAG report this time - The Hans India {The Hans India}
  - <2020-10-22> Punjab assembly session ends, 7 more bills passed - The Times of India {The Times of India}

### 103. State · Cabinet Decisions — MAJOR
- Request: tier=state, feature=Cabinet Decisions; HTTP 200, 137 ms, served=live, adapter=news-search, fallback=false
- Page claims: badge "LIVE"; header freshness "—"; source line "Live · 100 stories from Google News"; meta.status "—"
- Note: Live news-search feed.
- Row hosts: news.google.com 100
- Columns shown: Decision · Date · Source; date columns: Date; dated 100/100; newest 2026-10-15; oldest 2026-10-09; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 3 rows (e.g. cabinet approves productivity linked bonus (plb) for 78 days ×3; cabinet approves fairfax's rs 52,878-cr bid for idbi bank; l ×2); duplicate links: 0 rows
- Relevance: 7/15 judged on topic; off-topic examples: Cabinet approves Rs 52,878 crore sale of 60.72% stake in IDBI Bank \| Cabinet approves Productivity Linked Bonus for 78 days to Railway Employees \| Cabinet approves continuation of the National Social Assistance Programme
- Sample:
  - <Wed, 14 Oct 2026 15:52:42> Cabinet approves continuation of the National Social Assistance Programme for five years from 2026-27 to 2030- {
  - <Wed, 14 Oct 2026 10:04:00> From 'Indira Gandhi' to 'PM': Cabinet approves renaming of pension schemes - The Times of India {The Times of In
  - <Wed, 14 Oct 2026 11:42:00> Cabinet approves Rs 52,878 crore sale of 60.72% stake in IDBI Bank to Fairfax entity - DD India {DD India}
  - <Wed, 14 Oct 2026 10:41:04> Cabinet approves 78-day bonus for 11.4 lakh railway employees, up to Rs 17,951 each - The Indian Express {The In
  - <Sat, 10 Oct 2026 14:49:18> Himachal Cabinet approves 12,000 new jobs in departments - ThePrint {ThePrint}
  - <Wed, 14 Oct 2026 10:47:06> Cabinet approves strategic restructuring of IDBI Bank - The Indian Express {The Indian Express}
  - <Wed, 14 Oct 2026 07:11:18> Over 28 lakh students to get free textbooks in Odisha amid error row - India Today {India Today}
  - <Tue, 13 Oct 2026 18:50:27> Odisha Cabinet approves free textbooks for 28.7 lakh students, ₹500-crore urban drainage scheme \| India News - {
  - <Wed, 14 Oct 2026 12:05:28> Centre Approves 60.72% Stake Sale In IDBI Bank To Fairfax For Rs 52,878 Crore - NDTV {NDTV}
  - <Fri, 09 Oct 2026 23:03:00> UP Cabinet passes proposal to rename Noida airport as Narendra Modi International Airport - The Indian Express {
  - <Sat, 10 Oct 2026 18:39:00> Himachal cabinet clears 14,000 posts, 4,800 for 100 CBSE schools - The Times of India {The Times of India}
  - <Tue, 13 Oct 2026 09:51:52> Meghalaya cabinet approves closure of Cherra Cement, writes off Rs 24.43 crore in dues - India Today NE {India T
  - <Tue, 13 Oct 2026 10:42:23> Meghalaya Cabinet approves MSME facilitation ordinance to simplify business clearances - India Today NE {India T
  - <Wed, 14 Oct 2026 14:25:27> Diwali Package: Cabinet Clears ₹2,009 Cr Railway Bonus, Extends Social Security Cover Till 2031 - Outlook Indi {
  - <Wed, 14 Oct 2026 17:07:00> Cabinet approves Productivity Linked Bonus (PLB) for 78 days to Railway Employees - India's News.Net {India's Ne

### 107. State · CAG Audit Tracker — MAJOR
- Request: tier=state, feature=CAG Audit Tracker; HTTP 200, 209 ms, served=live, adapter=news-search, fallback=false
- Page claims: badge "LIVE"; header freshness "—"; source line "Live · 37 stories from Google News"; meta.status "—"
- Note: Live news-search feed.
- Row hosts: news.google.com 37
- Columns shown: DATE · TITLE · SUMMARY · PUBLISHER; date columns: DATE; dated 37/37; newest 2026-10-15; oldest 2026-10-08; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 3/15 judged on topic; off-topic examples: Constitutional Bodies, List, Key Institutions (Vajiram & Ravi) \| Orissa Minerals Development: Who Has Been Named Statutory Auditor for FY27? \| Kishan Reddy Accuses Rahul Of Undermining Institutions
- Sample:
  - <Wed, 14 Oct 2026 13:43:14> CAG and ICSSR organise nationwide Research Article Competition for young scholars - News On AIR {News On AIR}
  - <Thu, 08 Oct 2026 17:52:11> PAC grills Sports Authority of India over delayed projects, coach postings - The New Indian Express {The New Ind
  - <Wed, 14 Oct 2026 13:22:49> Ministry of Cooperation Mandates New Audit Framework to Strengthen Transparency and Governance in Multi - DD N {
  - <Tue, 13 Oct 2026 07:37:28> Odisha Collects ₹24,455 Crore in Excise Duty Over Five Years, CAG Report Reveals - Aabkari Times {Aabkari Times}
  - <Tue, 13 Oct 2026 05:30:20> Constitutional Bodies, List, Key Institutions - Vajiram &amp; Ravi {Vajiram & Ravi}
  - <Thu, 15 Oct 2026 09:17:53> Ministry of Petroleum: Akshay Gopal Posted As Deputy Secy on Four-Year Deputation - NorthBlockSouthBlock {NorthB
  - <Mon, 12 Oct 2026 00:51:27> Reforming India’s Tribunal System - Press Information Bureau {Press Information Bureau}
  - <Tue, 13 Oct 2026 11:37:00> CAG flags irregularities in Rebuild Kerala's roadworks, cites Rs 67.49 crore in undue benefits to contractors  {
  - <Wed, 14 Oct 2026 12:59:18> NPS investment in startups: AINPSEF writes to PM Modi seeking probe and asks for dissolution of NPS Trust - Th {
  - <Wed, 14 Oct 2026 12:38:00> Orissa Minerals Development (NSE:ORISSAMINE): Who Has Been Named Statutory Auditor for FY27? - Kalkine India {Ka
  - <Wed, 14 Oct 2026 17:57:47> Uneven Access: Mapping Disparities In Basic Urban Amenities Across Indian Cities - IMPRI Impact and Policy Res {
  - <Fri, 09 Oct 2026 18:35:00> Rahul undermining constitutional bodies: Kishan - The Times of India {The Times of India}
  - <Thu, 15 Oct 2026 14:51:22> Key Institutions Regulating Cooperative Societies in India - GK Today {GK Today}
  - <Fri, 09 Oct 2026 17:56:59> Kishan Reddy Accuses Rahul Of Undermining Institutions - Deccan Chronicle {Deccan Chronicle}
  - <Mon, 12 Oct 2026 03:48:49> CAG Report Flags Gaps in Post-Delivery Care at Bihar Hospitals; Only One of 24 Maternal Deaths Reviewed on Tim {

### 110. State · District Performance Tracker (Composite) — MAJOR
- Request: tier=state, feature=District Performance Tracker (Composite); HTTP 200, 408 ms, served=live, adapter=api, fallback=false
- Page claims: badge "LIVE"; header freshness "—"; source line "Live · 500 records from Wikidata"; meta.status "—"
- Note: Live api feed.
- Row hosts: wikidata.org 500
- Columns shown: TITLE · DISTRICT · POPULATION · AREA · DISTRICTLABEL; date columns: none; dated 0/500; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 5 rows (e.g. warangal district ×2; pratapgarh district ×2; bilaspur district ×2); duplicate links: 3 rows
- Relevance: 15/15 judged on topic
- Sample:
  - Ariyalur district
  - Anantapuramu district
  - West Siang district
  - Tumkur district
  - Sawai Madhopur district
  - Bidar district
  - Bhojpur district
  - Supaul district
  - Sirohi district
  - Rajsamand district
  - Katni district
  - Thane district
  - Sitapur district
  - Yamunanagar district
  - Koraput district

### 116. State · District Media Monitor (Vernacular District Editions) — MAJOR
- Request: tier=state, feature=District Media Monitor (Vernacular District Editions); HTTP 200, 159 ms, served=live, adapter=news-search, fallback=false
- Page claims: badge "LIVE"; header freshness "last 7 days"; source line "Live · 52 stories from Google News"; meta.status "LIVE · NEWS RSS"
- Note: Live Google News RSS — India district / local-admin coverage themes.
- Row hosts: news.google.com 52
- Columns shown: DATE · TITLE · SUMMARY · PUBLISHER; date columns: DATE; dated 52/52; newest 2026-10-15; oldest 2026-10-09; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 9/15 judged on topic; off-topic examples: Menominee Indian High School evacuated after threat (WBAY, US) \| Indian River County schools open search for new superintendent \| 6th Schedule of Indian Constitution (Vajiram & Ravi)
- Sample:
  - <Sat, 10 Oct 2026 15:03:56> INDIA bloc to protest against SIR in Kalaburagi on October 13 - The Hindu {The Hindu}
  - <Mon, 12 Oct 2026 10:39:55> 6th Schedule of Indian Constitution, Provisions, States, Articles - Vajiram &amp; Ravi {Vajiram & Ravi}
  - <Fri, 09 Oct 2026 17:38:00> PM Modi Condoles Deaths in Road Accident in Gujarat’s Kutch - DD India {DD India}
  - <Wed, 14 Oct 2026 07:59:15> 13 children die after overloaded boat capsizes in India - South China Morning Post {South China Morning Post}
  - <Tue, 13 Oct 2026 23:56:46> 80 newborn deaths at Madhya Pradesh hospital in six months, BJP MLA calls for probe - The Indian Express {The In
  - <Mon, 12 Oct 2026 00:49:00> A proposed nuclear plant runs into resistance even before takeoff in Madhya Pradesh - The Indian Express {The In
  - <Wed, 14 Oct 2026 05:06:00> At least 80 newborns die at Madhya Pradesh Hospital over six months, BJP MLA demands probe - WION {WION}
  - <Mon, 12 Oct 2026 01:22:58> Rewa Nuclear Power Project Faces Village Opposition as Residents Question Site Surveys and Consent - www.natio {
  - <Mon, 12 Oct 2026 01:21:09> As rising waters flood homes and temples, villagers protest India’s $87 billion river-linking project - WTVB {WT
  - <Fri, 09 Oct 2026 17:21:00> Menominee Indian High School evacuated after threat - WBAY {WBAY}
  - <Tue, 13 Oct 2026 16:10:20> Beyond the lunch line: Indian Creek’s free meals and nutrition highlighted - WTOV {WTOV}
  - <Mon, 12 Oct 2026 15:43:44> Misplaced cellphone sparks false weapon rumor at Vero Beach High School - WPEC {WPEC}
  - <Tue, 13 Oct 2026 13:18:23> Indian River County schools open search for new superintendent - Sebastian Daily {Sebastian Daily}
  - <Sun, 11 Oct 2026 10:27:26> School Holiday Tomorrow: Are Schools Open or Closed on October 12 Due to Navratri Festival 2026? Check Latest  {
  - <Fri, 09 Oct 2026 00:16:16> INDIA bloc continues protest in Khammam - The Hans India {The Hans India}

### 56. Carbon · Global Carbon Pricing Tracker — MINOR
- Request: tier=climate, feature=Global Carbon Pricing Tracker; HTTP 200, 200 ms, served=live, adapter=embedded, kind=carbon-pack, fallback=false
- Page claims: badge "none"; header freshness "stored copy · date not recorded"; source line "Stored records from ourworldindata.org"; meta.status "—"
- Note: Extracted jurisdiction carbon-price table (instrument, coverage, emissions-weighted USD/t). World Bank EN.GHG.CO2 is emissions, not a price, and was not used.
- Row hosts: ourworldindata.org 52
- Columns shown: Jurisdiction · ETS · Tax · Coverage % · USD / tCO2e · Year; date columns: none; dated 0/52; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 51 rows
- Relevance: 15/15 judged on topic
- Sample:
  - Albania
  - Australia
  - Bulgaria
  - Colombia
  - Czechia
  - France
  - Hungary
  - Italy
  - Latvia
  - Malta
  - Netherlands
  - Portugal
  - Slovakia
  - Spain
  - Ukraine

### 57. Carbon · Carbon Price Monitor — MINOR
- Request: tier=climate, feature=Carbon Price Monitor; HTTP 200, 77 ms, served=live, adapter=embedded, kind=carbon-pack, fallback=false
- Page claims: badge "none"; header freshness "stored copy · as of 01 Jan 2025"; source line "Stored records from ourworldindata.org"; meta.status "—"
- Note: Extracted emissions-weighted carbon price by jurisdiction and year (USD/tCO2e). Not a news search.
- Row hosts: ourworldindata.org 242
- Columns shown: Jurisdiction · Year · Weighted USD/t · ETS USD/t; date columns: none; dated 0/242; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 241 rows
- Relevance: 15/15 judged on topic
- Sample:
  - Canada 2025
  - Japan 2024
  - Switzerland 2023
  - Canada 2021
  - Japan 2020
  - Switzerland 2019
  - Canada 2017
  - Japan 2016
  - United Kingdom 2015
  - France 2013
  - United Kingdom 2012
  - Sweden 2010
  - Sweden 2008
  - Germany 2005
  - Sweden 1998

### 59. Carbon · Carbon Border (CBAM) Watch — MINOR
- Request: tier=climate, feature=Carbon Border (CBAM) Watch; HTTP 200, 76 ms, served=live, adapter=embedded, kind=carbon-pack, fallback=false
- Page claims: badge "none"; header freshness "stored copy · as of 01 Jan 2026"; source line "Stored records from taxation-customs.ec.europa.eu, commerce.gov.in and others"; meta.status "—"
- Note: Extracted EU/UK CBAM milestone table with official sources (EUR-Lex, Commission, GOV.UK). Not a news search.
- Row hosts: taxation-customs.ec.europa.eu 4, commerce.gov.in 1, gov.uk 1, eur-lex.europa.eu 1
- Columns shown: Milestone · Jurisdiction · Date · Scope / note; date columns: Date; dated 7/7; newest 2025-12-31; oldest 2023-05-16; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 3 rows
- Relevance: 7/15 judged on topic
- Sample:
  - <2026-01-01> CBAM definitive regime starts
  - <2025-02-26> CBAM 'Omnibus I' simplification proposed
  - <2024-05-15> India-EU CBAM consultations
  - <2024-01-31> First CBAM reporting deadline
  - <2023-12-18> UK confirms its own CBAM
  - <2023-10-01> CBAM transitional period begins
  - <2023-05-17> EU CBAM regulation enters into force

### 60. Carbon · India CCTS & Green Credits — MINOR
- Request: tier=climate, feature=India CCTS & Green Credits; HTTP 200, 80 ms, served=live, adapter=embedded, kind=carbon-pack, fallback=false
- Page claims: badge "none"; header freshness "stored copy · as of 01 Oct 2025"; source line "Stored records from powermin.gov.in, beeindia.gov.in and others"; meta.status "—"
- Note: Extracted CCTS and Green Credit Programme milestones with MoP/BEE/MoEFCC sources. Not a news search.
- Row hosts: beeindia.gov.in 4, powermin.gov.in 1, moefcc.gov.in 1
- Columns shown: Milestone · Date · Legal basis / note; date columns: Date; dated 6/6; newest 2025-09-30; oldest 2022-12-18; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 3 rows
- Relevance: 6/15 judged on topic
- Sample:
  - <2022-12-19> Energy Conservation (Amendment) Act enables carbon market
  - <2023-06-28> Carbon Credit Trading Scheme (CCTS) notified
  - <2023-10-13> Green Credit Programme notified
  - <2024-03-01> CCTS amendment adds offset mechanism
  - <2025-04-01> Compliance targets for first sectors
  - <2025-10-01> Trading platform readiness

### 62. Carbon · Climate Newswire — MINOR
- Request: tier=climate, feature=Climate Newswire; HTTP 200, 2707 ms, served=live, adapter=api, fallback=false
- Page claims: badge "LIVE"; header freshness "—"; source line "Live · 72 records from carbonbrief.org, india.mongabay.com and others"; meta.status "—"
- Note: Headlines from Carbon Brief, Mongabay India and Climate Home News. Not a generic GDELT climate search. Live outlet RSS.
- Row hosts: climatechangenews.com 40, india.mongabay.com 20, carbonbrief.org 11, interactive.carbonbrief.org 1
- Columns shown: Headline · Source · Published; date columns: Published; dated 72/72; newest 2026-10-14; oldest 2026-09-15; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 10/15 judged on topic; off-topic examples: Invaders get better at competition in introduced ranges: Study \| Study identifies rare case of moth and lichen association \| The giants with one horn
- Sample:
  - <2026-10-15> Invaders get better at competition in introduced ranges: Study
  - <2026-10-14> Global deforestation slowed in 2025 but Brazil&#8217;s election could undo &#8220;fragile&#8221; gains
  - <2026-10-13> SE Asia speeds up plan for connected clean power grid after oil shock
  - <2026-10-12> Governments that support climate science must stand firm against naysayers
  - <2026-10-08> Study identifies rare case of moth and lichen association
  - <2026-10-07> The giants with one horn
  - <2026-10-06> Forgotten vegetables could help make our diets more resilient
  - <2026-10-05> Protests over dam heat up as crackdown on activists continues
  - <2026-10-02> As COP31 co-host, Australia should make its polluters pay for climate damage
  - <2026-09-29> Brazil confident new rainforest fund will reach $10bn donor milestone
  - <2026-09-25> COP31 attendees told not to interfere in Türkiye&#8217;s &#8220;internal affairs&#8221;
  - <2026-09-24> Push for cooking to be part of COP31&#8217;s electrification agenda
  - <2026-09-23> The response to Nepal&#8217;s disaster is a test for global climate institutions
  - <2026-09-22> COP31 electrification pledge leaves out clean power commitment
  - <2026-09-21> COP31 presidency announces AI pledge as UN climate chief says Big Tech &#8216;on thin ice&#8217;

### 51. Economics · DGFT trade notifications — MINOR
- Request: tier=finance, feature=Trade Agreements & Economic Sanctions; HTTP 200, 82 ms, served=live, adapter=embedded, kind=finance-pack, fallback=false
- Page claims: badge "none"; header freshness "stored copy · as of 05 Aug 2026"; source line "Stored records from content.dgft.gov.in"; meta.status "—"
- Note: Extracted DGFT notifications (India trade policy). OFAC/EU lists and WTO tariff schedules are not in this pack.
- Row hosts: content.dgft.gov.in 227, dgft.gov.in 2
- Columns shown: NOTIFICATION · NO. · DATE · YEAR; date columns: DATE; dated 229/229; newest 2026-08-04; oldest 2023-08-27; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 18 rows (e.g. streamlining of halal certification process for meat and mea ×3; amendment in export policy of wheat ×2; amendment in export policy condition under hsn 1006 of sched ×2); duplicate links: 1 rows
- Relevance: 15/15 judged on topic
- Sample:
  - <2026-08-05> Introduction of Inventory-based Cross-border E-Commerce Export Framework under FTP
  - <2026-04-27> Amendment in export policy of Wheat - regarding.
  - <2026-03-31> Extension in Minimum Import Price (MIP) Condition of specific items covered under Chapter 48 of ITC HS, 2022, 
  - <2026-02-05> Amendment in Import Policy and policy condition of Umbrellas covered under Chapter 66 of Schedule-I (Import Po
  - <2025-10-15> Amendment in Import Policy Condition of specific ITC (HS) Codes of Chapter 29 and 38 of ITC (HS), 2022- Schedu
  - <2025-08-28> Amendment in Para 2.03(A) (i) (g) of the Foreign Trade Policy, 2023 laying down enabling provisions for import
  - <2025-05-26> Alignment of RoDTEP Schedule consequent to changes in the First Schedule of Customs Tariff Act w.e.f. 01.05.20
  - <2025-03-20> Extension of RoDTEP for AA/SEZ/EOU upto 5.2.2025
  - <2025-01-13> Notification of Schedule-II (Export Policy) of ITC(HS) 2022, in sync with Finance Act 2024 dated 16.08.2024 -r
  - <2024-10-01> Imposition of Minimum Import Price on Synthetic Knitted Fabrics up to 31st December 2024 –reg.
  - <2024-07-05> Amendment in policy condition of S. No. 55 &57 Chapter 10- Schedule -2, ITC(HS) Export Policy, 2018-reg.
  - <2024-04-15> Imposition of Port restrictions on supply of Prohibited/Restricted essential commodities to the Republic of Ma
  - <2024-03-11> Enabling provisions for import of inputs that are subjected to mandatory Quality Control Orders (QCOs) by Adva
  - <2024-01-15> Amendment in policy condition of silver covered under Chapter 71 of Schedule - 1 (Import Policy) of ITC (HS) 2
  - <2023-10-28> Imposition of Minimum Export Price on export of Onions

### 52. Economics · Indian enterprise chief executives — MINOR
- Request: tier=finance, feature=Top Financial & Business Players; HTTP 200, 2744 ms, served=live, adapter=api, fallback=false
- Page claims: badge "LIVE"; header freshness "—"; source line "Live · 84 records from Wikidata"; meta.status "—"
- Note: Wikidata chief-executive identity for Indian enterprises. No rankings, no financials, no market cap (market cap is price).
- Row hosts: wikidata.org 84
- Columns shown: CHIEF EXECUTIVE · ENTERPRISE; date columns: none; dated 0/84; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 4 rows
- Relevance: 13/15 judged on topic; off-topic examples: Zander Lurie (SurveyMonkey) \| James Miles-Lambert
- Sample:
  - Nabahat Khan
  - Sanjiv Bajaj
  - Raju Manocha
  - Mohit Gujral
  - Grandhi Mallikarjuna Rao
  - James Miles-Lambert
  - Kashish Kanojia
  - S. N. Subrahmanyan
  - Roshan Kulkarni
  - Rohit Kumar
  - Nishanth Dongari
  - Akash Kumar
  - Hemant K. Rohera
  - Zander Lurie
  - Natarajan Chandrasekaran

### 53. Economics · PIB technology reporting — MINOR
- Request: tier=finance, feature=AI & the Tech Industry; HTTP 200, 393 ms, served=live, adapter=api, fallback=false
- Page claims: badge "LIVE"; header freshness "—"; source line "Live · 103 records from Press Information Bureau and Google News"; meta.status "—"
- Note: PIB press releases about technology, plus a Google News search for Indian AI and technology news. Private investment databases are licensed and are not substituted.
- Row hosts: news.google.com 100, pib.gov.in 3
- Columns shown: DATE · TITLE · SUMMARY · PUBLISHER; date columns: DATE; dated 100/103; newest 2026-10-15; oldest 2026-10-08; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 12/15 judged on topic; off-topic examples: The EU's next chapter in AI is agentic (OpenAI) \| Financing the AI boom: corporate bond markets (CEPR) \| AI for the Real Economy: Our Series A in Zenzap
- Sample:
  - <Thu, 15 Oct 2026 14:52:00> India, Europe must jointly develop AI-driven automotive technology: Nasscom Vice Chairperson - ANI News {ANI New
  - <Thu, 15 Oct 2026 12:19:54> Google Brings AI-Powered Crop Research &amp; Business Tools To India - Analytics India Magazine {Analytics India
  - <Thu, 15 Oct 2026 10:37:59> Hyderabad-based CtrlS Datacenters planned to invest Rs 10,000 crore in a 150 MW hyperscale AI factory in Bodh  {
  - <Thu, 15 Oct 2026 09:14:46> Moneycontrol Pro Panorama \| As the AI rout deepens, will Indian equities rise? - Moneycontrol.com {Moneycontrol.
  - <Thu, 15 Oct 2026 07:57:14> AI Data Centers in India: Challenges and NITI Aayog’s Recommendations - INSIGHTS IAS {INSIGHTS IAS}
  - <Thu, 15 Oct 2026 05:21:10> The Chip at the Centre: India’s Semiconductor Path to Military Power – Part II - Raksha Anirveda {Raksha Anirved
  - <Wed, 14 Oct 2026 22:21:51> AI for the Real Economy: Our Series A in Zenzap - Lightspeed Venture Partners {Lightspeed Venture Partners}
  - <Wed, 14 Oct 2026 16:07:00> Google.org commits $15 million to boost AI adoption among India's MSMEs - The Times of India {The Times of India
  - <Wed, 14 Oct 2026 11:29:33> Lightstorm bets $500 mn on fibre networks to tap India’s AI data centre boom - Livemint {Livemint}
  - <Wed, 14 Oct 2026 09:03:47> The EU’s next chapter in AI is agentic - OpenAI {OpenAI}
  - <Tue, 13 Oct 2026 23:58:26> Financing the AI boom: Winners and losers in corporate bond markets - CEPR {CEPR}
  - <Tue, 13 Oct 2026 07:00:00> AI services may account for almost half of Infosys’ work in 2-3 years: CEO Salil Parekh - People Matters - HR  {
  - <Mon, 12 Oct 2026 03:56:22> AI liability and regulation for India's GCCs - Bar and Bench {Bar and Bench}
  - <Sat, 10 Oct 2026 13:41:55> AI data-centre boom puts India’s power grid under pressure, drives up upgrade costs - The Hindu {The Hindu}
  - <Fri, 09 Oct 2026 05:56:56> Absence of AI in equities will become India's strength in a year: CEA - Business Standard {Business Standard}

### 54. Economics · Prediction Market Political Odds — MINOR
- Request: tier=finance, feature=Prediction Market Political Odds; HTTP 200, 1802 ms, served=live, adapter=api, fallback=false
- Page claims: badge "LIVE"; header freshness "—"; source line "Live · 250 records from manifold.markets"; meta.status "—"
- Note: Manifold markets flagged political, ranked by recent volume. Snapshot if live polling is down. Not an Indian-election board. Live Manifold polling.
- Row hosts: manifold.markets 250
- Columns shown: MARKET · YES % · VOL 24H · VOLUME · CLOSES; date columns: CLOSES; dated 250/250; newest 2026-10-15; oldest 2023-10-02; future-dated 203; absurd 9999-12-30,9999-12-30
- Empty >50% (first 50 rows): YES %(38/50 empty); duplicate titles: 3 rows (e.g. will chuck schumer lead the senate democrats after 2026 elec ×2; in 2028, will ai be at least as big a political issue as abo ×2; will ai become a strategic geopolitical weapon by 2040? ×2); duplicate links: 0 rows
- Relevance: 11/15 judged on topic; off-topic examples: Nothing Ever Happens: Febuary \| Will New POLITICS markets be generated by market close? \| Political opinions stock market
- Sample:
  - <2026-10-27> Israel election: Which party will win the most seats?
  - <2026-11-03> US Average Gas Price Is $5.000 or more on Election Day 2026?
  - <2026-11-03> Who will win the 2026 United States Senate election in Iowa?
  - <2026-11-03> Democrats win the 2026 Special Election for Senate in Florida?
  - <2026-11-04> Which party will win the 2026 U.S. House election in Michigan's 5th District?
  - <2026-11-03> Who will win the 2026 Alaska House election?
  - <2026-11-04> Which party will win the 2026 U.S. House election in Pennsylvania's 11th District?
  - <2026-12-31> At least 20 pardoned Jan 6 rioters involved in politically motivated violence by end of 2026
  - <2026-09-19> Which Swedish political party will successfully form a government next?
  - <2026-10-06> Will New POLITICS markets be generated by market close?
  - <2026-10-14> Will the Nobel Peace Prize Winner in 2026 hold political office at the time of the award?
  - <9999-12-31> Political opinions stock market
  - <2025-10-01> Will Jeremy Corbyn lead a registered political party by the end of 2025?
  - <2027-01-01> Will Iran still be charging tolls in the strait of hermuz on January 1st, 2027?
  - <2026-01-31> Nothing Ever Happens: Febuary

### 72. Entertainment · Indian film identities & reported gross — MINOR
- Request: tier=entertainment, feature=Box Office Tracker; HTTP 200, 4165 ms, served=archive, adapter=api, fallback=false
- Page claims: badge "OFFLINE"; header freshness "stored copy · date not recorded"; source line "Latest stored records"; meta.status "—"
- Note: Live data is taking longer than usual.
- Row hosts: —
- Columns shown: FILM; date columns: none; dated 0/0; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Re-probe: 245 rows, served=live, newest 2026-10-15, oldest 2025-08-02
- Relevance: 15/15 judged on topic
- Sample:
  - <2027-01-01> King
  - <2026-08-21> Bethlehem Kudumba Unit
  - <2026-07-03> Alpha
  - <2026-05-22> Chand Mera Dil
  - <2026-05-01> Pratyabartan
  - <2026-04-01> Persimmon of My Love
  - <2026-02-27> Son Of
  - <2026-01-30> Mardaani 3
  - <2026-01-02> Akal Bisarjan
  - <2025-12-25> Projapoti 2
  - <2025-11-30> Bohu 420
  - <2025-11-07> Teen Paayancha Ghoda
  - <2025-10-10> Tora Mora Prema
  - <2025-09-12> Kanya
  - <2025-08-28> Lokah Chapter 1: Chandra

### 73. Entertainment · Entertainment News Wire — MINOR
- Request: tier=entertainment, feature=Entertainment News Wire; HTTP 200, 167 ms, served=live, adapter=api, fallback=false
- Page claims: badge "LIVE"; header freshness "—"; source line "Live · 10 stories from Variety"; meta.status "—"
- Note: Variety RSS — screen-trade headlines. Not a GDELT search.
- Row hosts: variety.com 10
- Columns shown: HEADLINE · SOURCE · PUBLISHED; date columns: PUBLISHED; dated 10/10; newest 2026-10-14; oldest 2026-10-14; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 10/15 judged on topic
- Sample:
  - <2026-10-15> &#8216;Love of Your Life&#8217; Director Rachel Morrison on  Margaret Qualley&#8217;s &#8216;Wild Range,&#8217
  - <2026-10-15> &#8216;La Bola Negra&#8217; Soundtrack Features New Music From Composer Raül Refree
  - <2026-10-15> Bollywood Actor Imran Khan Heads to High Court to Fight Order to Leave India Over Election Protest
  - <2026-10-15> Guillermo del Toro Pays Tribute to Late ‘E.T.’ Designer Carlo Rambaldi Ahead of Hollywood Walk of Fame Honor: 
  - <2026-10-15> How Do You Get ‘Friday the 13th’ Fans to Care About Jason’s Mom? ‘Crystal Lake’ Team on Their Ambitious Attemp
  - <2026-10-15> &#8216;Wildwood&#8217;s&#8217; Murder of the Crows Sequence Took Laika&#8217;s Artisans Over Five Years to Com
  - <2026-10-15> &#8216;Sheriff Country&#8217; Hits Series High of 5.5 Million Viewers as CBS Wins Premiere Week With Eight of 
  - <2026-10-15> See-Saw Films Heads on Mediawan Sale, Why ‘Tenzing’ Was Their ‘Most Challenging’ Movie Yet and the ‘World Buil
  - <2026-10-15> Al Pacino to Be Honored With SAG-AFTRA Life Achievement Award
  - <2026-10-15> ‘Schitt’s Creek’ Star Sarah Levy’s ‘Run’ Boarded by Mise En Scene Company for Sales, First Look Unveiled (EXCL

### 75. Entertainment · Music Charts — India Top 25 — MINOR
- Request: tier=entertainment, feature=Music Charts — India Top 25; HTTP 200, 4168 ms, served=archive, adapter=api, fallback=false
- Page claims: badge "OFFLINE"; header freshness "stored copy · date not recorded"; source line "Latest stored records"; meta.status "—"
- Note: Live data is taking longer than usual.
- Row hosts: —
- Columns shown: TRACK; date columns: none; dated 0/0; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Re-probe: 25 rows, served=live, newest —, oldest —
- Relevance: 15/15 judged on topic
- Sample:
  - SWIM
  - BAD TIMES
  - The Child In Us
  - Boston
  - Alfaaz - Vocals
  - Iphone Ringtone Trap (Remix)
  - Raindance
  - Hriday Mein Jinke Sitaram
  - One Sun One Moon
  - Magale (From "Baththa")
  - Premada Oorali Title Song (From “Premada Oorali”) - (Version 2)
  - F1
  - Attention
  - Bad Times (Extended Version)
  - How Else to Name It?

### 76. Entertainment · Music Charts — United States Top 25 — MINOR
- Request: tier=entertainment, feature=Music Charts — Global Top 25; HTTP 200, 4236 ms, served=archive, adapter=api, fallback=false
- Page claims: badge "OFFLINE"; header freshness "stored copy · date not recorded"; source line "Latest stored records"; meta.status "—"
- Note: Live data is taking longer than usual.
- Row hosts: —
- Columns shown: TRACK; date columns: none; dated 0/0; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Re-probe: 25 rows, served=live, newest —, oldest —
- Relevance: 15/15 judged on topic
- Sample:
  - Solar Eclipse
  - Choosin' Texas
  - Quebec
  - Nicole Kidman
  - Cold Shoulder
  - Been By Now
  - stupid song
  - the cure
  - Freestyle
  - Wicked Games
  - I Can't Love You Anymore
  - LIKE ME (feat. 42 Dugg & Lil Baby)
  - Be Her
  - I’m Spent
  - Dead Fresh

### 17. Global · Open Fronts — MINOR
- Request: tier=geopolitics, feature=Open Fronts; HTTP 200, 73 ms, served=live, adapter=embedded, kind=table, fallback=false
- Page claims: badge "LIVE"; header freshness "stored copy · as of 07 Sep 2026"; source line "Stored records from the published source"; meta.status "—"
- Note: Open Fronts conflict register (geopolitics_war_tracker). Structured theatres, not a news search.
- Row hosts: (none) 88
- Columns shown: CONFLICT · REGION · TYPE · STATUS · INTENSITY · TREND · LAST VERIFIED; date columns: LAST VERIFIED; dated 88/88; newest 2026-09-07; oldest 2026-09-07; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 15/15 judged on topic
- Sample:
  - <2026-09-07T16:55:06.648Z> Russia–Ukraine War
  - <2026-09-07T16:55:06.648Z> Israel–Hezbollah (Lebanon)
  - <2026-09-07T16:55:06.648Z> Israel — West Bank unrest
  - <2026-09-07T16:55:06.648Z> Western Sahara (Morocco–Polisario)
  - <2026-09-07T16:55:06.648Z> Nigeria — Boko Haram / ISWAP
  - <2026-09-07T16:55:06.648Z> Senegal — Casamance
  - <2026-09-07T16:55:06.648Z> Rwanda–Burundi tensions
  - <2026-09-07T16:55:06.648Z> Ethiopia–Somalia (Somaliland port)
  - <2026-09-07T16:55:06.648Z> Mozambique — Cabo Delgado (ISIS-M)
  - <2026-09-07T16:55:06.648Z> India — Manipur ethnic conflict
  - <2026-09-07T16:55:06.648Z> China–Bhutan border
  - <2026-09-07T16:55:06.648Z> Taiwan Strait tensions
  - <2026-09-07T16:55:06.648Z> Haiti — Gang crisis
  - <2026-09-07T16:55:06.648Z> Central America — El Salvador crackdown
  - <2026-09-07T16:55:06.648Z> Cyprus — Division

### 18. Global · Global Intelligence — MINOR
- Request: tier=geopolitics, feature=Global Intelligence; HTTP 200, 58 ms, served=live, adapter=embedded, kind=table, fallback=false
- Page claims: badge "LIVE"; header freshness "stored copy · as of 07 Sep 2026"; source line "Stored records from the published source"; meta.status "—"
- Note: Defence procurement register (geopolitics_defense_procurement). Structured programmes, not a news search.
- Row hosts: (none) 10
- Columns shown: PROGRAMME · VENDOR / ORIGIN · CATEGORY · STAGE · AS OF; date columns: AS OF; dated 10/10; newest 2026-09-07; oldest 2026-09-07; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 10/15 judged on topic
- Sample:
  - <2026-09-07T16:55:06.648Z> Rafale Marine (Rafale-M) Naval Fighter
  - <2026-09-07T16:55:06.648Z> S-400 Triumf Air Defense System
  - <2026-09-07T16:55:06.648Z> P-75I Submarines
  - <2026-09-07T16:55:06.648Z> MQ-9B SkyGuardian/SeaGuardian Drones
  - <2026-09-07T16:55:06.648Z> Tejas Mk1A Light Combat Aircraft
  - <2026-09-07T16:55:06.648Z> Agni-Prime Ballistic Missile
  - <2026-09-07T16:55:06.648Z> Apache AH-64E & Chinook Helicopters
  - <2026-09-07T16:55:06.648Z> Astra Beyond-Visual-Range Air-to-Air Missile
  - <2026-09-07T16:55:06.648Z> Project 75 Kalvari-class Submarines
  - <2026-09-07T16:55:06.648Z> Akash-NG Air Defense Missile

### 20. Global · Alliances — MINOR
- Request: tier=geopolitics, feature=Alliances; HTTP 200, 76 ms, served=live, adapter=embedded, kind=dossier, fallback=false
- Page claims: badge "none"; header freshness "stored copy · as of 22 Aug 2026"; source line "Stored records from nato.int, european-union.europa.eu and others"; meta.status "—"
- Note: Original HTML alliance and bloc register. Source-linked dossiers, not GDELT.
- Row hosts: mea.gov.in 2, state.gov 2, nato.int 1, european-union.europa.eu 1, brics.br 1, eng.sectsco.org 1
- Columns shown: ALLIANCE · REGION · STRUCTURE · MEMBERS · OBLIGATION · LATEST VERIFIED; date columns: LATEST VERIFIED; dated 46/46; newest 2025-11-22; oldest 1951-08-31; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 15/15 judged on topic
- Sample:
  - <07 Mar 2024> North Atlantic Treaty Organization
  - <01 Sep 2025> Shanghai Cooperation Organisation
  - <12 Aug 2024> Australia-United Kingdom-United States Partnership
  - <23 Feb 2024> Collective Security Treaty Organization
  - <20 Feb 2024> Organisation for Economic Co-operation and Development
  - <08 Jul 2024> Southern Common Market
  - <22 Jun 2025> Organisation of Islamic Cooperation
  - <15 Jul 2024> Southern African Development Community
  - <23 Oct 2024> Five Power Defence Arrangements
  - <28 Jul 2024> United States-Japan Alliance
  - <14 Jul 2022> India-Israel-United Arab Emirates-United States Group
  - <04 Apr 2025> Bay of Bengal Initiative for Multi-Sectoral Technical and Economic Cooperation
  - <02 Jun 2023> Regional Comprehensive Economic Partnership
  - <12 Feb 2024> Weimar Triangle
  - <25 Sep 2024> Mexico-Indonesia-Republic of Korea-Türkiye-Australia Partnership

### 21. Global · Sanctions — MINOR
- Request: tier=geopolitics, feature=Sanctions; HTTP 200, 85 ms, served=live, adapter=embedded, kind=dossier, fallback=false
- Page claims: badge "LIVE"; header freshness "stored copy · as of 01 Jul 2026"; source line "Stored records from sanctionssearch.ofac.treas.gov, ofac.treasury.gov and others"; meta.status "—"
- Note: Original HTML sanctions programme register. Live OpenSanctions lists are served at /api/opensanctions.
- Row hosts: ofac.treasury.gov 14, sanctionssearch.ofac.treas.gov 1, un.org 1, sanctionsmap.eu 1, cbp.gov 1
- Columns shown: PROGRAMME / TARGET · ISSUER · SCOPE · LISTED ENTITIES · STATUS; date columns: none; dated 0/18; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 13 rows
- Relevance: 15/15 judged on topic
- Sample:
  - Russia — Ukraine-related
  - Iran — Nuclear / IRGC / UAV
  - North Korea (DPRK)
  - Myanmar — Junta
  - Venezuela
  - Cuba embargo
  - Zimbabwe
  - Nicaragua
  - Wagner / Africa Corps
  - Houthis (Ansar Allah)
  - Cyber / Ransomware actors
  - China — Xinjiang / UFLPA
  - Drug cartels (fentanyl)
  - Mali / AES actors
  - Global Magnitsky (human rights)

### 23. Global · Infra — MINOR
- Request: tier=geopolitics, feature=Infra; HTTP 200, 73 ms, served=live, adapter=embedded, kind=dossier, fallback=false
- Page claims: badge "LIVE"; header freshness "stored copy · as of 01 Jul 2026"; source line "Stored records from the published source"; meta.status "—"
- Note: Original HTML strategic infrastructure register. Live World Bank projects are served at /api/wb-projects.
- Row hosts: (none) 10
- Columns shown: PROJECT · SECTOR · REGION · STATUS; date columns: none; dated 0/10; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 10/15 judged on topic
- Sample:
  - Vadhavan Port
  - Great Nicobar International Container Transshipment Terminal
  - Chabahar Port (Shahid Beheshti Terminal)
  - Sittwe Port & Kaladan Multi-Modal Transit Corridor
  - Trincomalee/Colombo Port Strategic Stake
  - Agalega Islands Airstrip & Jetty
  - Sagarmala Port Modernization Programme
  - Mumbai Trans Harbour Link (Atal Setu)
  - INS Visakhapatnam-class Destroyers (Project 15B)
  - P-75I Submarine Programme

### 24. Global · Nuclear Watch — MINOR
- Request: tier=geopolitics, feature=Nuclear Watch; HTTP 200, 72 ms, served=live, adapter=embedded, kind=dossier, fallback=false
- Page claims: badge "LIVE"; header freshness "stored copy · as of 24 Aug 2026"; source line "Stored records from pris.iaea.org, iaea.org and others"; meta.status "—"
- Note: Original HTML nuclear facility register. FAS/SIPRI arsenal estimates are attached as a live overlay, not a live count.
- Row hosts: pris.iaea.org 52, nucleus.iaea.org 14, oecd-nea.org 13, infcis.iaea.org 12, iaea.org 11, sipri.org 10
- Columns shown: FACILITY · COUNTRY · CLASS · OPERATIONAL STATUS · SAFEGUARDS / SECURITY · LATEST VERIFIED; date columns: LATEST VERIFIED; dated 0/112; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 105 rows
- Relevance: 15/15 judged on topic
- Sample:
  - <Public-source record chec> Zaporizhzhia Nuclear Power Plant
  - <Public-source record chec> Fordow Fuel Enrichment Plant
  - <Public-source record chec> Pelindaba nuclear complex
  - <Public-source record chec> Bruce Nuclear Generating Station
  - <Public-source record chec> Palo Verde Generating Station
  - <Public-source record chec> Lawrence Livermore National Laboratory
  - <Public-source record chec> Laguna Verde Nuclear Power Plant
  - <Public-source record chec> Cattenom Nuclear Power Plant
  - <Public-source record chec> CEA Valduc
  - <Public-source record chec> Temelín Nuclear Power Plant
  - <Public-source record chec> Belarusian Nuclear Power Plant
  - <Public-source record chec> Rokkasho Nuclear Fuel Cycle Facilities
  - <Public-source record chec> HANARO
  - <Public-source record chec> Kudankulam Nuclear Power Plant
  - <Public-source record chec> Khushab nuclear complex

### 25. Global · Upcoming launches — MINOR
- Request: tier=geopolitics, feature=Satellite Infrastructure; HTTP 200, 1284 ms, served=live, adapter=live, kind=dossier, fallback=false
- Page claims: badge "none"; header freshness "—"; source line "Stored records from The Space Devs"; meta.status "—"
- Note: The Space Devs upcoming launches. CelesTrak last-30-days is served at /api/celestrak.
- Row hosts: (none) 12
- Columns shown: ASSET / CONSTELLATION · OPERATOR · COUNTRY · ORBIT / PAD · STATUS · LAUNCH / COMMISSIONED; date columns: LAUNCH / COMMISSIONED; dated 12/12; newest 2026-10-15; oldest 2026-10-15; future-dated 11
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 12/15 judged on topic
- Sample:
  - <2026-10-15 23:57> Falcon 9 Block 5 \| USSF-481
  - <2026-10-19 10:30> Falcon 9 Block 5 \| Bandwagon 5 (Dedicated Mid-Inclination Rideshare)
  - <2026-10-19 19:41> H3-24 \| Martian Moons eXploration (MMX)
  - <2026-10-20 22:14> Falcon 9 Block 5 \| Starlink Group 15-15
  - <2026-10-21 00:00> Electron \| We're Not Hawking Around (3x HawkEye 360)
  - <2026-10-24 05:29> Falcon 9 Block 5 \| Starlink Group 15-16
  - <2026-10-29 00:00> Vulcan VC6L \| Amazon Leo (LV-01)
  - <2026-10-31 00:00> GSLV Mk II \| IRNSS-1L (NVS-03)
  - <2026-10-31 00:00> Long March 12A \| Flight 2
  - <2026-10-31 00:00> SSLV \| AayulSAT-1A & others
  - <2026-11-04 00:00> Electron \| The Sea God Surveys (iQPS Launch 9)
  - <2026-11-10 00:00> Electron \| The Mountain God Rises (iQPS Launch 10)

### 26. Global · Maritime Choke-Points — MINOR
- Request: tier=geopolitics, feature=Maritime Choke-Points; HTTP 200, 56 ms, served=live, adapter=embedded, kind=dossier, fallback=false
- Page claims: badge "LIVE"; header freshness "stored copy · as of 01 Jul 2026"; source line "Stored records from eia.gov, unctad.org and others"; meta.status "—"
- Note: Original HTML maritime chokepoint register. Live IMF PortWatch transits are served at /api/portwatch.
- Row hosts: eia.gov 5, unctad.org 4, csis.org 4, suezcanal.gov.eg 1, pancanal.com 1, mfa.gov.tr 1
- Columns shown: CHOKEPOINT · REGION · SHARE OF FLOW · CURRENT RISK; date columns: none; dated 0/18; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 10 rows
- Relevance: 15/15 judged on topic
- Sample:
  - Strait of Hormuz
  - Strait of Malacca
  - Suez Canal
  - Bab-el-Mandeb
  - Panama Canal
  - Danish Straits
  - Cape of Good Hope
  - Taiwan Strait
  - Strait of Gibraltar
  - Lombok / Makassar
  - Kerch Strait
  - Hodeidah (port)
  - Djibouti (port/bases)
  - Gwadar (port, CPEC)
  - Hambantota (port)

### 27. Global · Global Aid — MINOR
- Request: tier=geopolitics, feature=Global Aid; HTTP 200, 69 ms, served=live, adapter=embedded, kind=dossier, fallback=false
- Page claims: badge "LIVE"; header freshness "stored copy · date not recorded"; source line "Stored records from un.org, unicef.org and others"; meta.status "—"
- Note: Original HTML global aid appeal register. Live OCHA FTS is served at /api/fts.
- Row hosts: unicef.org 10, un.org 1, fao.org 1, who.int 1, ida.worldbank.org 1, unhcr.org 1
- Columns shown: PROGRAMME · INSTITUTION / REGION · REQUIREMENT · FUNDED · DATA THROUGH; date columns: DATA THROUGH; dated 16/16; newest 2026-06-30; oldest 2024-10-31; future-dated 0
- Empty >50% (first 50 rows): FUNDED(14/16 empty); duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 15/15 judged on topic
- Sample:
  - <08 Dec 2025> UN Global Humanitarian Appeal 2026
  - <Dec 2025> UNICEF Humanitarian Action for Children 2026
  - <Dec 2025> FAO Global Emergency & Resilience Appeal 2026
  - <15 Jan 2025> WHO Health Emergency Appeal 2025
  - <Jul 2026> IDA21 Concessional Financing Package
  - <Nov 2024> UNHCR Global Appeal 2025
  - <Jul 2026> WFP 2026 Operational Plan
  - <Dec 2025> Afghanistan HAC 2026
  - <30 Jun 2026> Sudan HAC 2026
  - <Feb 2026> State of Palestine HAC 2026
  - <Dec 2025> Somalia HAC 2026
  - <Mar 2026> Yemen HAC 2026
  - <Dec 2025> Haiti HAC 2026
  - <10 Dec 2025> Ukraine HAC 2026
  - <Mar 2026> Burkina Faso HAC 2026

### 28. Global · Energy & Critical Minerals — MINOR
- Request: tier=geopolitics, feature=Energy; HTTP 200, 65 ms, served=live, adapter=embedded, kind=dossier, fallback=false
- Page claims: badge "LIVE"; header freshness "stored copy · as of 01 Jul 2026"; source line "Stored records from usgs.gov, eia.gov and others"; meta.status "—"
- Note: Illustrative levels. No live price feed is connected.
- Row hosts: usgs.gov 12, iea.org 1, world-nuclear.org 1
- Columns shown: TITLE · ID · NAME · REGION · LAT · LON · INTENSITY; date columns: none; dated 0/14; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 11 rows
- Relevance: 14/15 judged on topic
- Sample:
  - Lithium
  - Cobalt
  - Nickel
  - Rare earths (REEs)
  - Uranium
  - Gallium & Germanium
  - Copper
  - Graphite
  - Manganese
  - Platinum-group (PGMs)
  - Antimony
  - Tin
  - Tungsten
  - Phosphate

### 29. Global · World Constitutions — MINOR
- Request: tier=geopolitics, feature=World Constitutions; HTTP 200, 829 ms, served=live, adapter=live, fallback=false
- Page claims: badge "LIVE"; header freshness "—"; source line "Live · 188 records from Constitute Project"; meta.status "LIVE · CONSTITUTE PROJECT · CACHED 7D"
- Note: Constitute Project constitutions currently in force. Cached up to 7 days.
- Row hosts: constituteproject.org 188
- Columns shown: COUNTRY · ENACTED; date columns: none; dated 0/188; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 15/15 judged on topic
- Sample:
  - Afghanistan
  - Bahrain
  - Bulgaria
  - Cote_d_Ivoire
  - El_Salvador
  - Greece
  - Ireland
  - Lao_People_s_Democratic_Republic__the
  - Mali
  - Myanmar
  - Panama
  - Rwanda
  - Slovenia
  - Taiwan
  - Ukraine

### 33. Law · Supreme Court Orders & Judgments — MINOR
- Request: tier=judiciary, feature=Supreme Court Order & Judgment Feed; HTTP 200, 90 ms, served=live, adapter=embedded, kind=law-pack, fallback=false
- Page claims: badge "none"; header freshness "stored copy · as of 07 Sep 2026"; source line "Stored records from sci.gov.in"; meta.status "—"
- Note: Extracted Supreme Court order table (case title, diary, date, PDF). Not a news search.
- Row hosts: sci.gov.in 220
- Columns shown: CASE · DIARY · ORDER DATE · COURT; date columns: ORDER DATE; dated 220/220; newest 2026-07-02; oldest 2026-06-24; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 15/15 judged on topic
- Sample:
  - <03-Jul-2026> A.G. KUMAR VS. STATE REP. BY INSPECTOR OF POLICE
  - <03-Jul-2026> GHANSHYAM TIWARI VS. THE CENTRAL BUREAU OF INVESTIGATION
  - <03-Jul-2026> V S KUMARAN VS. K B RAJU
  - <03-Jul-2026> TASVIR SINGH VS. VIRENDER SINGH
  - <03-Jul-2026> APSRTC (NOW KNOWN AS TELANGANA STATE ROAD TRANSPORT CORPORATION (TGSRTC) REP. BY ITS SENIOR LAW OFFICER K. KIR
  - <03-Jul-2026> ANIL CHANDRAIYA SHANGARAPU VS. ALFRAN CHAND USMAN KHAN
  - <03-Jul-2026> SAMEEM BEGUM VS. K. VENKAT SWAMY
  - <03-Jul-2026> THE SUPREINTENDENT OF POST VS. SANTRAM PATRE
  - <03-Jul-2026> RAJAPATHI AMMAL VS. TAMISELVI
  - <02-Jul-2026> DWARIKA NATH SAHU VS. BAHAGI KALITA (DEAD) THR. L.RS
  - <03-Jul-2026> ALAMGIR SARDAR VS. THE STATE OF WEST BENGAL
  - <25-Jun-2026> AARYA MANTRI VS. STATE OF MAHARASHTRA
  - <29-Jun-2026> THE DISTRICT COLLECTOR VS. M PITCHAI KANNU
  - <01-Jul-2026> DHARMENDER KUMAR VS. THE STATE OF HIMACHAL PRADESH
  - <02-Jul-2026> RAJU VS. THE STATE OF KARNATAKA

### 34. Law · Supreme Court orders by topic — MINOR
- Request: tier=judiciary, feature=Order Archive by Topic (Cross-Court); HTTP 200, 71 ms, served=live, adapter=embedded, kind=law-pack, fallback=false
- Page claims: badge "none"; header freshness "stored copy · as of 07 Sep 2026"; source line "Stored records from sci.gov.in"; meta.status "—"
- Note: Same extracted order table, grouped by subject. Topic is a classifier, not a recommendation.
- Row hosts: sci.gov.in 220
- Columns shown: CASE · DIARY · ORDER DATE · COURT; date columns: ORDER DATE; dated 220/220; newest 2026-07-02; oldest 2026-06-24; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 15/15 judged on topic
- Sample:
  - <03-Jul-2026> A.G. KUMAR VS. STATE REP. BY INSPECTOR OF POLICE
  - <30-Jun-2026> JAGSEER SINGH @ JAGSIR SINGH VS. STATE OF HARYANA
  - <03-Jul-2026> TARIQ KHAN VS. STATE OF RAJASTHAN
  - <03-Jul-2026> LAKSHMI GANAPATHI POULTRIES VS. CHATTU KOTESWARAMMA
  - <03-Jul-2026> BIJAYA KUMAR MALIK VS. THE STATE
  - <03-Jul-2026> SAYAR SINGH VS. JAGDISH SINGH
  - <03-Jul-2026> AMIT UDAYBHANSINGH SENGAR VS. DEEPA
  - <03-Jul-2026> SAKIR ALI VS. SABNAM KHATOON
  - <03-Jul-2026> PONSELVAM VS. K.KALAISELVI
  - <02-Jul-2026> BOXING RAI @ RAMAKANT RAI VS. THE STATE OF BIHAR
  - <02-Jul-2026> DWARIKA NATH SAHU VS. BAHAGI KALITA (DEAD) THR. L.RS
  - <02-Jul-2026> JAYASHREE SANJAY JAGDALE VS. THE HIGH COURT OF JUDICATURE AT BOMBAY
  - <02-Jul-2026> KALLU ALIAS ARUN VS. THE STATE OF UTTAR PRADESH
  - <02-Jul-2026> AKASH VS. THE STATE OF HIMACHAL PRADESH
  - <01-Jul-2026> RAJESH SINGH ALIAS NEETU VS. STATE OF HIMACHAL PRADESH

### 37. Law · NGT Environmental Litigation Tracker — MINOR
- Request: tier=judiciary, feature=NGT Environmental Litigation Tracker; HTTP 200, 821 ms, served=live, adapter=news-search, fallback=false
- Page claims: badge "LIVE"; header freshness "last 7 days"; source line "Live · 47 stories from Google News"; meta.status "LIVE · NEWS RSS"
- Note: 47 coverage rows (Google News RSS — court / litigation coverage. Not an official docket or cause list.).
- Row hosts: news.google.com 47; sections: COVERAGE — GOOGLE NEWS RSS 47
- Columns shown: DATE · TITLE · SUMMARY · PUBLISHER · SECTION; date columns: DATE; dated 47/47; newest 2026-10-15; oldest 2026-10-08; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 12/15 judged on topic; off-topic examples: Delhi Court Issues Fresh Summons To YouTuber Dhruv Rathee \| Lake protection drive runs into local resistance \| Punjab forest department OKs proceedings… liquor vends
- Sample:
  - <Wed, 14 Oct 2026 11:30:04> National Green Tribunal Forms Panel To Assess Allegations Of Illegal Sand Mining At Betwa River - Live Law [COVE
  - <Tue, 13 Oct 2026 17:39:00> NGT directs Himachal to clarify decision on Koksar’s carrying capacity - The Times of India [COVERAGE — GOOGLE N
  - <Wed, 14 Oct 2026 03:35:37> NGT directs Chennai civic body to link building approvals with construction waste compliance - Prop News Time [C
  - <Fri, 09 Oct 2026 04:37:34> NGT halts dumping of chromium-bearing waste at abandoned quarry on Odisha college premises - The New Indian Ex [
  - <Thu, 15 Oct 2026 04:50:35> AYUSH institute shifted from forest land: Odisha government to NGT - The New Indian Express [COVERAGE — GOOGLE N
  - <Fri, 09 Oct 2026 05:55:25> NGT seeks replies from Uttarakhand govt over alleged sewage, waste lapses on Kedarnath route - The New Indian  [
  - <Wed, 14 Oct 2026 13:56:09> Delhi Court Issues Fresh Summons To YouTuber Dhruv Rathee In 2018 Defamation Case - Live Law [COVERAGE — GOOGLE 
  - <Mon, 12 Oct 2026 17:39:00> BBMB fined for breaching pollution norms - The Times of India [COVERAGE — GOOGLE NEWS RSS] {The Times of India}
  - <Sun, 11 Oct 2026 00:30:00> Lake protection drive runs into local resistance - Bangalore Mirror [COVERAGE — GOOGLE NEWS RSS] {Bangalore Mirr
  - <Thu, 08 Oct 2026 16:13:18> NGT cracks down on BMC’s Micro Composting Centre - OrissaPOST [COVERAGE — GOOGLE NEWS RSS] {OrissaPOST}
  - <Thu, 15 Oct 2026 02:45:35> NGT orders probe into resort on forest land - OrissaPOST [COVERAGE — GOOGLE NEWS RSS] {OrissaPOST}
  - <Tue, 13 Oct 2026 03:15:04> Mormugao Port Channel Deepening Halted by NGT - Urban Acres [COVERAGE — GOOGLE NEWS RSS] {Urban Acres}
  - <Sat, 10 Oct 2026 17:33:00> Punjab forest department OKs proceedings against officials over liquor vends on protected forest land - The Ti [
  - <Sat, 10 Oct 2026 13:11:55> Bhubaneswar Composting Centre Faces NGT Action Over Missing Authorisation - Urban Acres [COVERAGE — GOOGLE NEWS 
  - <Fri, 09 Oct 2026 15:03:55> Mumbai: NGT Holds Western Railway Responsible For Mahim Track Garbage, MPCB Calculates ₹1.59 Crore - Free Pres [

### 38. Law · CAT & Consumer Disputes (NCDRC) Watch — MINOR
- Request: tier=judiciary, feature=CAT & Consumer Disputes (NCDRC) Watch; HTTP 200, 745 ms, served=live, adapter=news-search, fallback=false
- Page claims: badge "LIVE"; header freshness "last 7 days"; source line "Live · 49 stories from Google News"; meta.status "LIVE · NEWS RSS"
- Note: 49 coverage rows (Google News RSS — court / litigation coverage. Not an official docket or cause list.).
- Row hosts: news.google.com 49; sections: COVERAGE — GOOGLE NEWS RSS 49
- Columns shown: DATE · TITLE · SUMMARY · PUBLISHER · SECTION; date columns: DATE; dated 49/49; newest 2026-10-15; oldest 2026-10-08; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 12/15 judged on topic; off-topic examples: SBI MCLR rates hiked from today \| Telangana HC Reserves Order on IAS Officer Amrapali's Cadre Plea \| Homebuyer paid Rs 15 lakh… builder threatened
- Sample:
  - <Wed, 14 Oct 2026 03:20:22> Delhi Consumer Commission Directs United India Insurance To Pay ₹38,000 For Stolen Motorcycle Despite... - Liv [
  - <Tue, 13 Oct 2026 05:58:04> Failure To Refund Cancelled Bus Ticket Amounts To Deficiency In Service: Consumer Commission Directs KSRTC To  [
  - <Wed, 14 Oct 2026 06:22:51> Missed Flight, Rs 83,800 Compensation: Bengaluru Consumer Commission Rules Against Travel Agent - NDTV Profit [C
  - <Mon, 12 Oct 2026 04:00:23> Consumer forum finds deficiency in service, orders Wellness clinic to pay Rs 86,200 to patient over... - Medic [
  - <Fri, 09 Oct 2026 01:30:48> Railways not liable if passenger not careful about belongings: Consumer commission - The Indian Express [COVERAG
  - <Fri, 09 Oct 2026 05:58:33> Consumer Forum Rejects Rs 5 Lakh Claim Against Railways for Train Luggage Theft - Law Trend [COVERAGE — GOOGLE N
  - <Sun, 11 Oct 2026 05:30:44> Silk Saree Zari Quality Dispute: NCDRC Remands Cases After Test Report Shows Low Silver Content - Live Law [COVE
  - <Wed, 14 Oct 2026 06:30:34> LIC Cannot Reject Death Insurance Claim over Heart Disease Diagnosed after Proposal, Rules NCDRC - Moneylife [CO
  - <Tue, 13 Oct 2026 12:08:49> Consumer Forum Orders Wellness Clinic to Pay Rs 86,200 Over Incomplete Cryotherapy Treatment for Weight... - M [
  - <Thu, 15 Oct 2026 09:48:35> SBI MCLR rates hiked from today, October 15: Will your loan EMI rise? Check new rates - Upstox [COVERAGE — GOOGL
  - <Fri, 09 Oct 2026 18:09:14> CAT Jammu Imposes Rs 10,000 Cost On Senior Advocate For Appearing Without Uniform - LawChakra [COVERAGE — GOOGLE
  - <Thu, 15 Oct 2026 07:56:39> Homebuyer paid Rs 15 lakh for a Rs 10.41 lakh flat, builder then threatened and asked Rs 20 lakh more; he - Th [
  - <Tue, 13 Oct 2026 10:19:06> Patna Consumer Commission Orders Seller to Refund Rs 1.30 Lakh, Pay Rs 85,000 Compensation - Patna Press [COVERA
  - <Thu, 08 Oct 2026 16:48:49> Mumbai Consumer Commission Pulls Up Developers For Reselling Booked Flat At Inflated Price - Free Press Journa [
  - <Wed, 14 Oct 2026 09:46:28> Telangana HC Reserves Order on IAS Officer Amrapali's Cadre Plea - The Chenab Times [COVERAGE — GOOGLE NEWS RSS]

### 40. Law · ICC Proceedings — MINOR
- Request: tier=judiciary, feature=ICC Proceedings; HTTP 200, 687 ms, served=live, adapter=news-search, fallback=false
- Page claims: badge "LIVE"; header freshness "last 7 days"; source line "Live · 100 stories from Google News"; meta.status "LIVE · NEWS RSS"
- Note: 100 coverage rows (Google News RSS — court / litigation coverage. Not an official docket or cause list.).
- Row hosts: news.google.com 100; sections: COVERAGE — GOOGLE NEWS RSS 100
- Columns shown: DATE · TITLE · SUMMARY · PUBLISHER · SECTION; date columns: DATE; dated 100/100; newest 2026-10-15; oldest 2026-10-09; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 6 rows (e.g. icc prosecutor condemns us sanctions, says work will continu ×2; reactions to us imposing sanctions on international criminal ×2; us imposes sanctions on international criminal court, hours  ×2); duplicate links: 0 rows
- Relevance: 15/15 judged on topic
- Sample:
  - <Fri, 09 Oct 2026 15:21:52> The ICC strongly rejects US sanctions against the institution - \| International Criminal Court [COVERAGE — GOOGL
  - <Sat, 10 Oct 2026 15:46:05> Why is the US sanctioning the International Criminal Court? - Al Jazeera [COVERAGE — GOOGLE NEWS RSS] {Al Jazeer
  - <Fri, 09 Oct 2026 15:11:00> US imposes new sanctions on international criminal court - The Guardian [COVERAGE — GOOGLE NEWS RSS] {The Guardi
  - <Fri, 09 Oct 2026 20:46:16> DAWN's Statement on U.S. Sanctions on the Entire International Criminal Court - Democracy for the Arab World N [
  - <Fri, 09 Oct 2026 14:00:40> Exclusive-US imposes sanctions on International Criminal Court, hours after former judge wins Nobel - ThePrint [
  - <Fri, 09 Oct 2026 16:00:16> Reactions to US imposing sanctions on International Criminal Court - ThePrint [COVERAGE — GOOGLE NEWS RSS] {TheP
  - <Fri, 09 Oct 2026 14:09:00> ICC Prosecutor Condemns US Sanctions, Says Work Will Continue - U.S. News &amp; World Report [COVERAGE — GOOGLE 
  - <Fri, 09 Oct 2026 22:02:00> U.S. sanctions ICC after former judge wins Nobel Peace Prize - The Japan Times [COVERAGE — GOOGLE NEWS RSS] {The
  - <Mon, 12 Oct 2026 07:49:00> US imposes sanctions on International Criminal Court, hours after former judge wins Nobel - Polity.org.za [COVER
  - <Fri, 09 Oct 2026 14:11:52> US imposes sanctions on International Criminal Court, hours after former judge wins Nobel - Internazionale [COVE
  - <Mon, 12 Oct 2026 06:51:38> Statement on the International Criminal Court following announcement of US sanctions - The European Sting [COVER
  - <Fri, 09 Oct 2026 17:43:37> Trump escalates war on International Criminal Court with deep sanctions - Courthouse News [COVERAGE — GOOGLE NEW
  - <Wed, 14 Oct 2026 21:56:49> The EU is in no hurry to protect the International Criminal Court from Trump's sanctions – Brussels has chosen [
  - <Wed, 14 Oct 2026 00:22:23> Washington Policy Weekly: United States Sanctions International Criminal Court - Arab Center Washington DC [COVE
  - <Thu, 15 Oct 2026 13:30:00> Trump’s new sanctions could dismantle the International Criminal Court - The Hill [COVERAGE — GOOGLE NEWS RSS] {

### 43. Law · NCLT / NCLAT (Insolvency) — MINOR
- Request: tier=judiciary, feature=NCLT / NCLAT (Insolvency); HTTP 200, 77 ms, served=live, adapter=embedded, kind=law-pack, fallback=false
- Page claims: badge "none"; header freshness "stored copy · as of 08 Aug 2026"; source line "Stored records from ibbi.gov.in"; meta.status "—"
- Note: Extracted NCLT orders plus IBBI public announcements. NCLAT bodies are not in this pack.
- Row hosts: ibbi.gov.in 434
- Columns shown: ENTITY · MATTER · ORDER · SOURCE · DATE · IP; date columns: ORDER, DATE; dated 434/434; newest 2026-08-07; oldest 2026-05-14; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 4 rows (e.g. approval of resolution plan ×3; in the matter of citron infraprojects limited [c.p. (ib)/122 ×2; in the matter of superfine metals private limited [cp (ib) n ×2); duplicate links: 0 rows
- Relevance: 15/15 judged on topic
- Sample:
  - <Public Announcement of Vo> KOBELCO MACHINERY INDIA PRIVATE LIMITED
  - <Admission - Final Order> In the matter of ARTHUR TURNKEY PROJECTS LIMITED [CP IB (IBC) 123/KB/2026]
  - <Admission - Final Order> In the matter of ANMOL NIRYAT PVT.LTD. [61/KB/2026]
  - <Public Announcement of Co> RAJA UDYOG PRIVATE LIMITED
  - <Public Announcement of Co> ALVI TECH SERVICES PVT LTD
  - <Public Announcement of Co> OZONE PROJECTS PRIVATE LIMITED
  - <Public Announcement of Co> PARORCH DEVELOPERS LLP
  - <Others> In the matter of Shree Vardhman Buildprop Private Limited [I.A. 3699 ND 2024 in C.P. IB 445 (ND) of 2023]
  - <Others> In the matter of BIL Vyapar Limited [I.A. (IB) No. 203/KB of 2026 in CP (IB) No. 46/KB of 2025]
  - <Public Announcement of Co> M.U. BUILDCON PRIVATE LIMITED
  - <Public Announcement of Co> VARIDHI COTSPIN PRIVATE LIMITED
  - <Public Announcement of Vo> TRUE NORTH SOFTWARE PRIVATE LIMITED
  - <Public Announcement of Vo> FRISCHMANN PRABHU INDIA DESIGN SERVICES PRIVATE LIMITED
  - <Public Announcement of Li> J R AGROTECH PRIVATE LIMITED
  - <Public Announcement of Vo> Asian Chemical Works (Bombay) Private Limited

### 44. Law · Sector Tribunals (ITAT / TDSAT / SAT / DRT) — MINOR
- Request: tier=judiciary, feature=Sector Tribunals (ITAT / TDSAT / SAT / DRT); HTTP 200, 867 ms, served=live, adapter=news-search, fallback=false
- Page claims: badge "LIVE"; header freshness "last 7 days"; source line "Live · 80 stories from Google News"; meta.status "LIVE · NEWS RSS"
- Note: 80 coverage rows (Google News RSS — court / litigation coverage. Not an official docket or cause list.).
- Row hosts: news.google.com 80; sections: COVERAGE — GOOGLE NEWS RSS 80
- Columns shown: DATE · TITLE · SUMMARY · PUBLISHER · SECTION; date columns: DATE; dated 80/80; newest 2026-10-15; oldest 2026-10-08; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 15/15 judged on topic
- Sample:
  - <Wed, 14 Oct 2026 04:32:00> Man jointly bought Rs 80 lakh property with father and wife but didn't file ITR; taxman added Rs 55.2 lak - Th [
  - <Mon, 12 Oct 2026 17:47:37> Sold property but did not file ITR? ITAT gives taxpayer another chance to contest ₹90.09 lakh income tax penal [
  - <Tue, 13 Oct 2026 10:15:13> Sold TDRs for ₹6.02 crore? ITAT clarifies capital gains tax rules for landowners - Livemint [COVERAGE — GOOGLE N
  - <Fri, 09 Oct 2026 08:23:39> Not updating her PAN address cost this senior citizen ₹5,000, but ITAT still gave another chance in an ancestr [
  - <Tue, 13 Oct 2026 11:09:40> Received money to vacate your flat for redevelopment? ITAT clarifies when the compensation may be tax-free - L [
  - <Thu, 15 Oct 2026 13:37:11> ITAT Mumbai Restores Appeal After Condoning 86-Day Delay: Committee Transition Held as Sufficient Cause - TaxC [
  - <Fri, 09 Oct 2026 22:01:53> Can the Income Tax Appellate Tribunal Stay Penalty Recovery? Supreme Court Clarifies - The Law Observer [COVERAG
  - <Thu, 08 Oct 2026 19:15:05> ITAT Agra Directs DVO Reference for Property Valuation: Section 56(2)(vii)(b) Addition of ₹13.24 Lakh Set Asid [
  - <Fri, 09 Oct 2026 07:00:00> Delhi High Court raps Income Tax Department for 30-year locker seizure, orders swift implementation of ITAT re [
  - <Thu, 15 Oct 2026 13:56:00> Maruti Suzuki Gets Favourable ITAT Order with ₹13,000 Cr Positive Impact - PSU Connect [COVERAGE — GOOGLE NEWS R
  - <Sat, 10 Oct 2026 11:59:58> ITAT Remands Ex-Parte Appeal for Fresh Adjudication - StudyCafe [COVERAGE — GOOGLE NEWS RSS] {StudyCafe}
  - <Sun, 11 Oct 2026 06:05:58> ITAT Sets Aside Ex-Parte CIT(A) Order Over Alleged Wrong Email Notice, Directs Fresh Hearing After Service at  [
  - <Sat, 10 Oct 2026 17:03:58> ITAT Condones 115-Day Delay in Appeal To Provide Substantive Justice - StudyCafe [COVERAGE — GOOGLE NEWS RSS] {S
  - <Tue, 13 Oct 2026 09:06:06> ITAT Quashes Section 201Order for Non-Compliance with Mandatory DIN Requirement - StudyCafe [COVERAGE — GOOGLE N
  - <Sat, 10 Oct 2026 11:02:29> S. 14A Can’t Apply To Interest Received From Own Head Office: ITAT - Juris Hour [COVERAGE — GOOGLE NEWS RSS] {Ju

### 0. National · Bill Passage Probability Index — MINOR
- Request: tier=national, feature=Bill Passage Probability Index; HTTP 200, 705 ms, served=live, adapter=embedded, fallback=false
- Page claims: badge "LIVE"; header freshness "stored copy · as of 07 Sep 2026"; source line "Stored records from Sansad"; meta.status "REGISTER · SANSAD / PRS ARCHIVE"
- Note: national_bill_tracker.csv — 1952–present. Sansad getBills is not wired for refresh. current_stage only; no passing date, so passed-per-year is not drawn. probability_score is a stored column, not a simulator.
- Row hosts: sansad.in 9819
- Columns shown: Bill · House · Sector · Stage · Introduced; date columns: Introduced; dated 9819/9819; newest 2026-08-09; oldest 1952-05-15; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 232 rows (e.g. the bharatiya nyaya sanhita (amendment) bill, 2024 ×2; the national food security (amendment) bill, 2024 ×2; the sexual harassment of women at workplace (prevention, pro ×2); duplicate links: 9818 rows
- Relevance: 15/15 judged on topic
- Sample:
  - <2026-08-09 19:00:00> THE NATIONAL CO-OPERATIVE DEVELOPMENT CORPORATION (AMENDMENT) BILL, 2026
  - <2023-08-03 19:00:00> The Constitution (Amendment) Bill, 2022 (Amendment of article 58).
  - <2021-08-08 19:00:00> The National Commission for Homoeopathy (Amendment) Bill, 2021
  - <2018-08-02 19:00:00> The Maintenance and Welfare of  Parents and Senior Citizens (Amendment) Bill, 2018 (Insertion of  new Chapter 
  - <2016-03-10 19:00:00> The Compulsory Imparting of Moral Education in Educational Institutions Bill, 2016
  - <2014-02-16 19:00:00> The Appropriation (Railways) Bill, 2014.
  - <2010-04-29 19:00:00> The Central Universities (Conditions of Service of Non-Teaching Staff) Bill, 2010
  - <2006-07-30 19:00:00> The Tripura University Bill, 2006
  - <2003-05-01 19:00:00> The Railways (Amendment) Bill, 2003
  - <1999-12-16 19:00:00> The Protection of Human Rights (Amendment) Bill, 1999 (Amendment of section 2, etc.)
  - <1993-12-20 19:00:00> The Appropriation (No. 5) Bill, 1993
  - <1988-03-17 19:00:00> The Appropriation (Vote on Account) Bill, 1988
  - <1980-03-14 19:00:00> The Bihar Appropriation (Vote on Account) Bill, 1980
  - <1969-03-18 19:00:00> The Appropriation (No. 2) Bill, 1969
  - <1960-12-05 19:00:00> The Appropriation (Railways) No. 5 Bill, 1960.

### 1. National · Policy Intelligence Graph — MINOR
- Request: tier=national, feature=Policy Intelligence Graph; HTTP 200, 241 ms, served=live, adapter=embedded, kind=graph, fallback=false
- Page claims: badge "LIVE"; header freshness "stored copy · as of 07 Sep 2026"; source line "Stored records from Sansad"; meta.status "REGISTER · SANSAD / PRS ARCHIVE"
- Note: Sansad getBills is not wired for refresh. Register holds current_stage only — passed counts are stage labels, not passing dates.
- Row hosts: sansad.in 9819
- Columns shown: DATE · TITLE · ID · BILL NAME · BILL NUMBER · HOUSE · SECTOR; date columns: DATE; dated 9819/9819; newest 2026-08-09; oldest 1952-05-15; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 232 rows (e.g. the bharatiya nyaya sanhita (amendment) bill, 2024 ×2; the national food security (amendment) bill, 2024 ×2; the sexual harassment of women at workplace (prevention, pro ×2); duplicate links: 9818 rows
- Relevance: 15/15 judged on topic
- Sample:
  - <2026-08-09 19:00:00> THE NATIONAL CO-OPERATIVE DEVELOPMENT CORPORATION (AMENDMENT) BILL, 2026
  - <2023-08-03 19:00:00> The Constitution (Amendment) Bill, 2022 (Amendment of article 58).
  - <2021-08-08 19:00:00> The National Commission for Homoeopathy (Amendment) Bill, 2021
  - <2018-08-02 19:00:00> The Maintenance and Welfare of  Parents and Senior Citizens (Amendment) Bill, 2018 (Insertion of  new Chapter 
  - <2016-03-10 19:00:00> The Compulsory Imparting of Moral Education in Educational Institutions Bill, 2016
  - <2014-02-16 19:00:00> The Appropriation (Railways) Bill, 2014.
  - <2010-04-29 19:00:00> The Central Universities (Conditions of Service of Non-Teaching Staff) Bill, 2010
  - <2006-07-30 19:00:00> The Tripura University Bill, 2006
  - <2003-05-01 19:00:00> The Railways (Amendment) Bill, 2003
  - <1999-12-16 19:00:00> The Protection of Human Rights (Amendment) Bill, 1999 (Amendment of section 2, etc.)
  - <1993-12-20 19:00:00> The Appropriation (No. 5) Bill, 1993
  - <1988-03-17 19:00:00> The Appropriation (Vote on Account) Bill, 1988
  - <1980-03-14 19:00:00> The Bihar Appropriation (Vote on Account) Bill, 1980
  - <1969-03-18 19:00:00> The Appropriation (No. 2) Bill, 1969
  - <1960-12-05 19:00:00> The Appropriation (Railways) No. 5 Bill, 1960.

### 2. National · Parliamentary Question Database — MINOR
- Request: tier=national, feature=Parliamentary Question Database; HTTP 200, 320 ms, served=live, adapter=embedded, fallback=false
- Page claims: badge "LIVE"; header freshness "stored copy · as of 07 Sep 2026"; source line "Stored records from Sansad"; meta.status "ARCHIVE · LARGEST NATIONAL DATASET"
- Note: Answer text is absent from every row. elibrary.sansad.in DSpace is not wired. Sub-label is honest about a loaded sample.
- Row hosts: sansad.in 8000
- Columns shown: QUESTION · MEMBER · MINISTRY · TYPE · TABLED · HOUSE; date columns: TABLED; dated 8000/8000; newest 2026-04-01; oldest 2024-07-21; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 7921 rows (e.g. mani a ×109; raja a ×123; brijmohan agrawal ×139); duplicate links: 1160 rows
- Relevance: 15/15 judged on topic
- Sample:
  - <2026-04-02> Mani A
  - <2025-03-20> Damodar Agrawal
  - <2025-04-03> C N Annadurai
  - <2026-02-09> Bhumare Sandipanrao Asaram
  - <2024-11-25> T R Baalu
  - <2025-08-06> G M Harish Balayogi
  - <2025-04-04> Shobhanaben Mahendrasinh Baraiya
  - <2024-12-05> E T Mohammed Basheer
  - <2025-02-10> Ummeda Ram Beniwal
  - <2025-12-04> Sukhdeo Bhagat
  - <2026-02-11> Vinod Kumar Bind
  - <2024-07-30> Satpal Brahamchari
  - <2025-08-19> Charanjit Singh Channi
  - <2025-07-23> Devusinh Chauhan
  - <2026-03-12> Lumbaram Choudhary

### 4. National · Regulatory Body Watch — MINOR
- Request: tier=national, feature=Regulatory Body Watch (RBI/SEBI/TRAI/CCI); HTTP 200, 357 ms, served=live, adapter=live, fallback=false
- Page claims: badge "LIVE"; header freshness "—"; source line "Live · 171 records from rbi.org.in and sebi.gov.in"; meta.status "LIVE · REGULATOR RSS"
- Note: RBI notifications, RBI press releases and SEBI (50 live items from 3 of 3 feeds), with the stored register behind them. TRAI, CBDT, IBBI and CCI are not connected.
- Row hosts: rbi.org.in 116, sebi.gov.in 55
- Columns shown: INSTRUMENT · REGULATOR · TYPE · DATE; date columns: DATE; dated 141/171; newest 2026-10-15; oldest 2024-11-10; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 13 rows (e.g. auction of state government securities ×3; risk management and inter-bank dealings ×3; auction of 91-day, 182-day and 364-day treasury bills ×2); duplicate links: 0 rows
- Relevance: 15/15 judged on topic
- Sample:
  - <Thu, 15 Oct 2026 17:50:00> Auction of State Government Securities
  - <Sat, 10 Oct 2026 01:20:00> Risk Management and Inter-Bank Dealings - Foreign Exchange Risk Reserve
  - <2026-08-10> RBI imposes monetary penalty on The Amravati District Central Co-operative Bank Ltd., Maharashtra
  - <2026-08-06> Reserve Bank of India (All India Financial Institutions - Responsible Business Conduct) Third Amendment Direct
  - <2026-07-03> Reserve Bank of India imposes monetary penalty on Bank of Baroda
  - <2026-07-02> RBI imposes monetary penalty on Dharmavir Sambhaji Urban Cooperative Bank Ltd., Pune, Maharashtra
  - <2026-07-01> Money Market Operations as on June 30, 2026
  - <2026-06-30> Result of Yield/Price Based Auction of State Government Securities
  - <2026-06-29> Money Market Operations as on June 28, 2026
  - <2026-06-25> Calendar for Auction of Government of India Treasury Bills
  - <2026-06-25> RBI to conduct 4-day Variable Rate Repo (VRR) auction under LAF on June 25, 2026
  - <2025-10-15> Master Circular for issue and listing of Non-convertible Securities, Securitised Debt Instruments, Security Re
  - <2025-06-17> Master Circular for Stock Brokers
  - <14 Oct, 2026 +0530> SEBI’s PolicyTwin Prototype Wins First Place at the C:&gt;DIR Global ‘Agentic Regulator’ Hackathon
  - <13 Oct, 2026 +0530> Notice of attachment dated October 13,2026 issued against Shreyanse Finance Ltd under RC No. 7708 of 2024 in t

### 5. National · Candidate Affidavit Database — MINOR
- Request: tier=national, feature=Candidate Affidavit Database (Structured + API); HTTP 200, 79 ms, served=live, adapter=embedded, fallback=false
- Page claims: badge "LIVE"; header freshness "stored copy · date not recorded"; source line "Stored records from dataverse.harvard.edu"; meta.status "REGISTER · LICENCE-BLOCKED TO EXTEND"
- Note: MyNeta / ADR basis already shipped. ADR terms bar commercial use, resale, redistribution and scraping. ECI + kaarana/AffidavitManagement is the compliant re-source and is not wired. No crimometer score.
- Row hosts: myneta.info 483
- Columns shown: CANDIDATE · CONSTITUENCY · PARTY · CASES · EDUCATION · ASSETS (₹ CR) · LIABILITIES (₹ CR); date columns: none; dated 0/483; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 15/15 judged on topic
- Sample:
  - Aashtikar Patil Nagesh Bapurao
  - Anil Firojiya
  - Bajrang Manohar Sonwane
  - Captain Brijesh Chowta
  - Dilip Saikia
  - Dr.Mallu Ravi
  - Haribhai Patel
  - K E Prakash
  - Kota Srinivas Poojary
  - Manoj Tiwari
  - Pankaj Chaudhary
  - Rahul Singh Lodhi
  - Rodmal Nagar
  - Shashank Mani
  - Swami Sachchidanand Hari Sakshi

### 6. National · Delimitation Impact Simulator — MINOR
- Request: tier=national, feature=Delimitation Impact Simulator; HTTP 200, 102 ms, served=live, adapter=internal, kind=simulator, fallback=false
- Page claims: badge "LIVE"; header freshness "through 2036"; source line "Live · 36 stories from Google News"; meta.status "SIMULATION · LARGEST REMAINDER · NCP 2011–36 · ILLUSTRATIVE"
- Note: SIMULATION · LARGEST REMAINDER · NCP 2011–36 PROJECTIONS · ILLUSTRATIVE. Analytics consume this output so the pane is not “unwired”.
- Row hosts: (none) 36
- Columns shown: TITLE · NAME · POP · NOW · PROJ · D; date columns: none; dated 0/36; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 15/15 judged on topic
- Sample:
  - Uttar Pradesh
  - Maharashtra
  - Madhya Pradesh
  - Karnataka
  - Haryana
  - Odisha
  - Andhra Pradesh
  - Punjab
  - Uttarakhand
  - Himachal Pradesh
  - Manipur
  - Arunachal Pradesh
  - Mizoram
  - Andaman & Nicobar
  - Lakshadweep

### 8. National · MP Profiles & Performance — MINOR
- Request: tier=national, feature=MP Profiles & Performance (MPLAD, attendance, debates); HTTP 200, 112 ms, served=live, adapter=embedded, kind=cards, fallback=false
- Page claims: badge "LIVE"; header freshness "stored copy · date not recorded"; source line "Stored records from Sansad"; meta.status "REGISTER · LOK SABHA AND RAJYA SABHA"
- Note: national_mp_report_card.csv — current house. Attendance empty in every row. Committees filled on most rows; blanks read “not recorded”, never “none”.
- Row hosts: sansad.in 782
- Columns shown: MEMBER · PARTY · SEAT · STATE · QUESTIONS; date columns: none; dated 0/782; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 15/15 judged on topic
- Sample:
  - Mani A
  - Misha Bharti
  - Adhikari Deepak Dev
  - Manish Jaiswal
  - Dean Kuriakose
  - Janardan Mishra
  - Chandrakant Raghunath Patil
  - Ashok Kumar Rawat
  - Vishnu Datt Sharma
  - Parimal Suklabaidya
  - Yaduveer Wadiyar
  - Chintakayala, Shri Vijay
  - Konyak, Smt. S. Phangnon
  - Pathak, Dr. Sandeep Kumar
  - Shukla, Shri Rajeev

### 10. National · Statements & Quote Tracker — MINOR
- Request: tier=national, feature=Statement & Quote Tracker with Contradiction Detection; HTTP 200, 996 ms, served=live, adapter=news-search, kind=wire, fallback=false
- Page claims: badge "LIVE"; header freshness "last 7 days"; source line "Live · 100 stories from Google News"; meta.status "LIVE · NEWS SEARCH"
- Note: Google News coverage of "Narendra Modi" from the last 7 days. Media mentions, not a statement archive; no contradiction verdict.
- Row hosts: news.google.com 100
- Columns shown: DATE · TITLE · SUMMARY · PUBLISHER · PERSON; date columns: DATE; dated 100/100; newest 2026-10-15; oldest 2026-10-09; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 1 rows (e.g. pm modi welcomes bloomberg’s plans to expand presence in ind ×2); duplicate links: 0 rows
- Relevance: 9/15 judged on topic; off-topic examples: UP Cabinet passes proposal to rename Noida airport as Narendra Modi International Airport \| 'Enormous potential' for India-Canada ties: Canadian Foreign Minister \| Indian leaders want nation to power the AI age (SCMP)
- Sample:
  - <Mon, 12 Oct 2026 12:08:50> India’s Narendra Modi faces ‘bitter pill’ as Cockroach protests mount - Financial Times {Financial Times}
  - <Sat, 10 Oct 2026 02:39:52> Modi at 25 is staring at a cascade of crises. A perfect storm is building - ThePrint {ThePrint}
  - <Sun, 11 Oct 2026 13:36:18> Why Vijay’s temple visit with Narendra Modi goes beyond routine protocol - The Indian Express {The Indian Expres
  - <Thu, 15 Oct 2026 14:55:35> PM Narendra Modi felicitates Indian cricket team's Asian Games gold-medalists: Updates and everything that hap {
  - <Sun, 11 Oct 2026 15:24:15> Coffee With Rahul Gandhi, Metro Ride With PM Modi: Vijay's Balancing Act - NDTV {NDTV}
  - <Tue, 13 Oct 2026 07:46:24> After Days of Unprecedented Police Action on Citizens, PM Modi Says India Mother of Democracy - TheWire.in {TheW
  - <Tue, 13 Oct 2026 23:46:00> India a global growth partner, reforms our conviction, not compulsion: PM Modi - The Indian Express {The Indian 
  - <Wed, 14 Oct 2026 02:37:01> PM pitches India as stable ally amid global uncertainty and weaponised supply chains - Telegraph India {Telegrap
  - <Fri, 09 Oct 2026 23:03:00> UP Cabinet passes proposal to rename Noida airport as Narendra Modi International Airport - The Indian Express {
  - <Wed, 14 Oct 2026 14:35:59> ‘Enormous potential’ for India-Canada ties amidst global uncertainty: Canadian Foreign Minister - The Hindu {The
  - <Tue, 13 Oct 2026 07:01:16> Indian leaders want nation to power the AI age, but some residents are pushing back - South China Morning Post {
  - <Thu, 15 Oct 2026 15:28:52> Over ₹36,000 Crore Allocated to Expand Khelo India, Strengthen Sports Federations: PM Modi - DD News {DD News}
  - <Tue, 13 Oct 2026 06:00:21> India 'mother of democracy', does not grow at anyone's expense: PM Modi - Business Standard {Business Standard}
  - <Tue, 13 Oct 2026 08:23:04> ‘We grow with the world’: PM Modi pitches India as global growth partner - The Federal {The Federal}
  - <Tue, 13 Oct 2026 14:30:50> PM Modi speaks to Mark Carney, praises positive momentum in India-Canada relations - India Today {India Today}

### 13. National · Bureaucratic Transfers (AGMUT) — MINOR
- Request: tier=national, feature=Bureaucratic Transfers — AGMUT Cadre; HTTP 200, 76 ms, served=live, adapter=embedded, fallback=false
- Page claims: badge "LIVE"; header freshness "stored copy · as of 11 Jun 2026"; source line "Stored records from mha.gov.in and services.delhi.gov.in"; meta.status "REGISTER · GAZETTED ORDERS"
- Note: AGMUT cadre transfer register as gazetted. services.delhi.gov.in/orders/378 is not wired. Awards are not a field.
- Row hosts: mha.gov.in 29
- Columns shown: OFFICER · CADRE · STATE / UT · NEW POSTING · ORDER; date columns: ORDER; dated 29/29; newest 2026-06-10; oldest 2024-07-04; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 15/15 judged on topic
- Sample:
  - <2024-07-05> Chanchal Yadav
  - <2024-07-12> Dr. A Koan
  - <2024-10-07> Shri Vivek Gogia
  - <2024-12-02> Shri Viplav Kumar Choudhry
  - <2025-03-26> Shri Sandeep Kumar Singh
  - <2025-05-26> Rajesh Khurana
  - <2025-05-09> Shri Neeraj Semwal
  - <2025-07-31> Sh. S.B.K. Singh
  - <2026-06-11> Shri Himanshu Nigam
  - <2024-11-14> Sanjiv Kumar
  - <2025-06-23> Anil Shukla
  - <2025-07-16> Shri Tharun Patnaik Madala
  - <2024-09-11> Suvigya S Chandra
  - <2024-12-13> Sh. B L Suresh, IPS
  - <2025-05-05> Gurpal Singh

### 15. National · Budget Utilisation & Schemes — MINOR
- Request: tier=national, feature=Budget Utilisation & Schemes; HTTP 200, 69 ms, served=live, adapter=embedded, fallback=false
- Page claims: badge "none"; header freshness "stored copy · as of 01 Jan 2026"; source line "Stored records from Union Budget"; meta.status "CURATED · APPROXIMATE"
- Note: CURATED · VERIFY AGAINST INDIABUDGET.GOV.IN. PDF is authoritative if Excel disagrees. Allocation only — scheme-level utilisation is refuted.
- Row hosts: (none) 13
- Columns shown: TITLE · KIND · SCHEME · ALLOCATION CR · VALUE · NOTE; date columns: none; dated 0/13; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): VALUE(8/13 empty); NOTE(8/13 empty); duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 13/15 judged on topic
- Sample:
  - Total expenditure
  - Capital expenditure
  - Fiscal deficit target
  - Receipts (excl. borrowings)
  - Income-tax relief
  - MGNREGA
  - Jal Jeevan Mission
  - PM-KISAN
  - Samagra Shiksha
  - National Health Mission
  - PM Gram Sadak Yojana
  - PM-POSHAN
  - Ayushman Bharat PM-JAY

### 16. National · Industry Updates (Ministry Data) — MINOR
- Request: tier=national, feature=Industry Updates (Ministry Data); HTTP 200, 221 ms, served=live, adapter=live, fallback=false
- Page claims: badge "LIVE"; header freshness "—"; source line "Live · 26 records from World Bank"; meta.status "LIVE · WORLD BANK WDI"
- Note: World Bank NV.IND.MANF.ZS / NV.IND.TOTL.ZS — India, % of GDP. Units and issuing authority on the chart. Fiscal deficit, forex, IIP, WPI are not wired.
- Row hosts: (none) 26
- Columns shown: YEAR · INDUSTRY % OF GDP · ECONOMY; date columns: YEAR; dated 0/26; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 25 rows (e.g. manufacturing, value added (% of gdp) ×26); duplicate links: 0 rows
- Relevance: 15/15 judged on topic
- Sample:
  - <2025> Manufacturing, value added (% of GDP)
  - <2024> Manufacturing, value added (% of GDP)
  - <2022> Manufacturing, value added (% of GDP)
  - <2020> Manufacturing, value added (% of GDP)
  - <2019> Manufacturing, value added (% of GDP)
  - <2017> Manufacturing, value added (% of GDP)
  - <2015> Manufacturing, value added (% of GDP)
  - <2013> Manufacturing, value added (% of GDP)
  - <2012> Manufacturing, value added (% of GDP)
  - <2010> Manufacturing, value added (% of GDP)
  - <2008> Manufacturing, value added (% of GDP)
  - <2006> Manufacturing, value added (% of GDP)
  - <2005> Manufacturing, value added (% of GDP)
  - <2003> Manufacturing, value added (% of GDP)
  - <2001> Manufacturing, value added (% of GDP)

### 64. Sports · Fixtures & Results — World Leagues — MINOR
- Request: tier=sports, feature=Fixtures & Results — World Leagues; HTTP 200, 582 ms, served=live, adapter=api, fallback=false
- Page claims: badge "LIVE"; header freshness "—"; source line "Live · 7 records from TheSportsDB"; meta.status "—"
- Note: TheSportsDB next and last events for Premier League, NBA, IPL and La Liga. Not a news search.
- Row hosts: thesportsdb.com 7
- Columns shown: FIXTURE · LEAGUE · DATE · HOME · AWAY · HS · AS; date columns: DATE; dated 7/7; newest 2026-10-15; oldest 2026-05-30; future-dated 1
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 7/15 judged on topic
- Sample:
  - <2026-10-17> Everton vs Chelsea
  - <2026-10-16> Deportivo de A Coruña vs Levante
  - <2026-10-15> New York Knicks vs Toronto Raptors
  - <2026-10-15> Los Angeles Clippers vs Denver Nuggets
  - <2026-10-12> Coventry City vs Newcastle United
  - <2026-10-12> Levante vs Sevilla
  - <2026-05-31> Gujarat Titans vs Royal Challengers Bangalore

### 69. Sports · Sports Business & Media Rights — MINOR
- Request: tier=sports, feature=Sports Business & Media Rights; HTTP 200, 1919 ms, served=live, adapter=api, fallback=false
- Page claims: badge "LIVE"; header freshness "—"; source line "Live · 80 records from Wikidata"; meta.status "—"
- Note: Wikidata Indian leagues and owners. Broadcast rights valuations and sponsorships are not in this pull.
- Row hosts: wikidata.org 80
- Columns shown: LEAGUE · OWNER; date columns: none; dated 0/80; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 15/15 judged on topic
- Sample:
  - 2022–23 Indian Elite League
  - Assam State Premier League
  - Bombay Gold Cup
  - Elite Pro Basketball League
  - Golf Premier League
  - Indian Cricket League
  - Indian Super League
  - Kashmir Champions League
  - Kumite 1 League
  - Malabar Premier League
  - Mumbai Football League
  - Odisha Tennis Premier League
  - Pune Football League
  - Shillong Premier League
  - Tamil Nadu Women’s League

### 70. Sports · Athlete Index — MINOR
- Request: tier=sports, feature=Athlete Index; HTTP 200, 1487 ms, served=live, adapter=api, fallback=false
- Page claims: badge "LIVE"; header freshness "—"; source line "Live · 150 records from Wikidata"; meta.status "—"
- Note: Wikidata people with occupation athlete and country India. Rankings, medals and endorsements are not in this pull.
- Row hosts: wikidata.org 150
- Columns shown: ATHLETE · SPORT; date columns: none; dated 0/150; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 4 rows (e.g. abaan shah sajeer ×3; amlan borgohain ×2; deepa malik ×2); duplicate links: 4 rows
- Relevance: 15/15 judged on topic
- Sample:
  - A. Maria Irudayam
  - Amlan Borgohain
  - Bachu Achyutharamaiah
  - Deepa Malik
  - Harbans Lal
  - Jhano Hansdah
  - Lalitha Killaka
  - Mohammad Shams Aalam Shaikh
  - Nupuur Patil
  - Prithipal Chatterjee
  - Ravivarman Sharmila
  - S. Ilavazhagi
  - Sanjivani Jadhav
  - Sidhant Pande
  - Valasamgari Bhavani

### 79. State · Constituency Register — MINOR
- Request: tier=state, feature=Constituency Register; HTTP 200, 87 ms, served=live, adapter=embedded, kind=geo-pack, fallback=false
- Page claims: badge "LIVE"; header freshness "stored copy · date not recorded"; source line "Stored records from the published source"; meta.status "—"
- Note: Ingested Goa geography pack — SIR final roll 2026 · elections 2017–2024 only. The workbook GitHub URL is the extract source, not the live table. Constituency Register is seat-level (AC).
- Row hosts: (none) 40
- Columns shown: CONSTITUENCY · AC · DISTRICT · ELECTORS · BOOTHS · LEADING BLOC (EST.) · LEAD %; date columns: none; dated 0/40; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 15/15 judged on topic
- Sample:
  - Mandrem
  - Bicholim
  - Siolim
  - Porvorim
  - Panaji
  - St. Andre
  - Sanquelim
  - Valpoi
  - Siroda
  - Vasco-da-Gama
  - Cortalim
  - Fatorda
  - Navelim
  - Velim
  - Sanvordem

### 80. State · Roll Demography — MINOR
- Request: tier=state, feature=Roll Demography; HTTP 200, 85 ms, served=live, adapter=embedded, kind=geo-pack, fallback=false
- Page claims: badge "LIVE"; header freshness "stored copy · date not recorded"; source line "Stored records from the published source"; meta.status "—"
- Note: Ingested Goa geography pack — SIR final roll 2026 · elections 2017–2024 only. The workbook GitHub URL is the extract source, not the live table.
- Row hosts: (none) 40
- Columns shown: CONSTITUENCY · AC · ELECTORS · MALE · FEMALE · SEX RATIO · MEDIAN AGE; date columns: none; dated 0/40; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 15/15 judged on topic
- Sample:
  - Mandrem
  - Bicholim
  - Siolim
  - Porvorim
  - Panaji
  - St. Andre
  - Sanquelim
  - Valpoi
  - Siroda
  - Vasco-da-Gama
  - Cortalim
  - Fatorda
  - Navelim
  - Velim
  - Sanvordem

### 81. State · Community Bloc Matrix — MINOR
- Request: tier=state, feature=Community Bloc Matrix; HTTP 200, 203 ms, served=live, adapter=embedded, kind=geo-pack, fallback=false
- Page claims: badge "LIVE"; header freshness "stored copy · date not recorded"; source line "Stored records from the published source"; meta.status "—"
- Note: Ingested Goa geography pack — SIR final roll 2026 · elections 2017–2024 only. The workbook GitHub URL is the extract source, not the live table.
- Row hosts: (none) 40
- Columns shown: CONSTITUENCY · AC · ELECTORS · CATHOLIC % · MUSLIM % · HINDU ST % · HINDU OBC %; date columns: none; dated 0/40; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 15/15 judged on topic
- Sample:
  - Mandrem
  - Bicholim
  - Siolim
  - Porvorim
  - Panaji
  - St. Andre
  - Sanquelim
  - Valpoi
  - Siroda
  - Vasco-da-Gama
  - Cortalim
  - Fatorda
  - Navelim
  - Velim
  - Sanvordem

### 82. State · Election Results 2017–2024 — MINOR
- Request: tier=state, feature=Election Results 2017–2024; HTTP 200, 67 ms, served=live, adapter=embedded, kind=geo-pack, fallback=false
- Page claims: badge "LIVE"; header freshness "stored copy · date not recorded"; source line "Stored records from the published source"; meta.status "—"
- Note: Ingested Goa geography pack — SIR final roll 2026 · elections 2017–2024 only. The workbook GitHub URL is the extract source, not the live table.
- Row hosts: (none) 40
- Columns shown: CONSTITUENCY · AC · 2017 · 2019 · 2022 · 2022 % · 2022 MARGIN; date columns: none; dated 0/40; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 15/15 judged on topic
- Sample:
  - Mandrem
  - Bicholim
  - Siolim
  - Porvorim
  - Panaji
  - St. Andre
  - Sanquelim
  - Valpoi
  - Siroda
  - Vasco-da-Gama
  - Cortalim
  - Fatorda
  - Navelim
  - Velim
  - Sanvordem

### 83. State · Split-Ticket & Competitiveness — MINOR
- Request: tier=state, feature=Split-Ticket & Competitiveness; HTTP 200, 65 ms, served=live, adapter=embedded, kind=geo-pack, fallback=false
- Page claims: badge "LIVE"; header freshness "stored copy · date not recorded"; source line "Stored records from the published source"; meta.status "—"
- Note: Ingested Goa geography pack — SIR final roll 2026 · elections 2017–2024 only. The workbook GitHub URL is the extract source, not the live table.
- Row hosts: (none) 40
- Columns shown: CONSTITUENCY · AC · AC 2022 % · LS 2024 % · SPLIT GAP · IN-PLAY ELECTORS · IN-PLAY %; date columns: none; dated 0/40; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 15/15 judged on topic
- Sample:
  - Mandrem
  - Bicholim
  - Siolim
  - Porvorim
  - Panaji
  - St. Andre
  - Sanquelim
  - Valpoi
  - Siroda
  - Vasco-da-Gama
  - Cortalim
  - Fatorda
  - Navelim
  - Velim
  - Sanvordem

### 84. State · SIR Roll Churn — MINOR
- Request: tier=state, feature=SIR Roll Churn; HTTP 200, 131 ms, served=live, adapter=embedded, kind=geo-pack, fallback=false
- Page claims: badge "LIVE"; header freshness "stored copy · date not recorded"; source line "Stored records from the published source"; meta.status "—"
- Note: Ingested Goa geography pack — SIR final roll 2026 · elections 2017–2024 only. The workbook GitHub URL is the extract source, not the live table.
- Row hosts: (none) 40
- Columns shown: CONSTITUENCY · AC · DRAFT · FINAL · ADDED · REMOVED · NET; date columns: none; dated 0/40; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 15/15 judged on topic
- Sample:
  - Mandrem
  - Bicholim
  - Siolim
  - Porvorim
  - Panaji
  - St. Andre
  - Sanquelim
  - Valpoi
  - Siroda
  - Vasco-da-Gama
  - Cortalim
  - Fatorda
  - Navelim
  - Velim
  - Sanvordem

### 85. State · Registration Gap — MINOR
- Request: tier=state, feature=Registration Gap; HTTP 200, 66 ms, served=live, adapter=embedded, kind=geo-pack, fallback=false
- Page claims: badge "LIVE"; header freshness "stored copy · date not recorded"; source line "Stored records from the published source"; meta.status "—"
- Note: Ingested Goa geography pack — SIR final roll 2026 · elections 2017–2024 only. The workbook GitHub URL is the extract source, not the live table.
- Row hosts: (none) 40
- Columns shown: CONSTITUENCY · AC · ELECTORS · AGED 18-19 · MISSING 18-19 · % OF SEAT; date columns: none; dated 0/40; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 15/15 judged on topic
- Sample:
  - Vasco-da-Gama
  - Canacona
  - Valpoi
  - Santa Cruz
  - Sanquelim
  - Curchorem
  - Pernem (SC)
  - Siolim
  - Velim
  - Marcaim
  - Fatorda
  - Dabolim
  - Nuvem
  - Benaulim
  - Mormugao

### 86. State · Booth-level Results Database — MINOR
- Request: tier=local, feature=Booth-level Results Database; HTTP 200, 165 ms, served=live, adapter=embedded, kind=geo-pack, fallback=false
- Page claims: badge "LIVE"; header freshness "stored copy · date not recorded"; source line "Stored records from the published source"; meta.status "—"
- Note: Ingested Goa geography pack — SIR final roll 2026 · elections 2017–2024 only. The workbook GitHub URL is the extract source, not the live table.
- Row hosts: (none) 1731
- Columns shown: BOOTH · STATION · ELECTORS · 2022 BAND · 2022 · 2024 · 2024 MARGIN; date columns: none; dated 0/1731; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 1 rows (e.g. booth 35 · government primary schoo! (west wing) ×2); duplicate links: 0 rows
- Relevance: 15/15 judged on topic
- Sample:
  - Booth 1 · Government Primary School, Tiracol
  - Booth 17 · Govt. Primary School, Gauthanwada, Usap
  - Booth 6 · St. Francis Xavier's High School, Siolim (South Wing)
  - Booth 3 · Govt. Primary School (West Wing) Carrem, Socorro
  - Booth 8 · Department of Goa Gazetteer and Historical Records
  - Booth 5 · Government Primary School, Navelim Divar
  - Booth 32 · Govt. Primary School, Khadchal, Surla
  - Booth 40 · Govt. Primary School, Par
  - Booth 15 · Government Primary School (East Wing)
  - Booth 15 · St. Andrew's High School, Vasco-da-Gama (Room
  - Booth 10 · Fr. Agnel Primary School, New Building (South
  - Booth 42 · St. Anthony School, (Primary School), Pajifond
  - Booth 35 · Govt. Primary School, (Room No. 2), Housing
  - Booth 21 · Government Primary School, Adnem, Quepem Goa
  - Booth 40 · Shree Sharda English High School, Sanvordem

### 87. State · Party Organisation Map — MINOR
- Request: tier=state, feature=Party Organisation Map; HTTP 200, 70 ms, served=live, adapter=register, kind=register, fallback=false
- Page claims: badge "LIVE"; header freshness "stored copy · as of 19 Aug 2026"; source line "Live · 31 records from Wikidata, Wikipedia and others"; meta.status "—"
- Note: Party seat strength in 31 state assemblies, counted from the MLA register (4,103 MLAs, as of 2026-08-19; 1 vacant seat left out).
- Row hosts: (none) 31
- Columns shown: STATE · SEATS · LARGEST PARTY · ITS SEATS · SHARE % · MAJORITY · SEATS BY PARTY; date columns: none; dated 0/31; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 15/15 judged on topic
- Sample:
  - Andhra Pradesh
  - Assam
  - Chhattisgarh
  - Goa
  - Haryana
  - Jammu & Kashmir
  - Karnataka
  - Madhya Pradesh
  - Manipur
  - Mizoram
  - Odisha
  - Punjab
  - Sikkim
  - Telangana
  - Uttar Pradesh

### 89. State · Booth Political History — MINOR
- Request: tier=local, feature=Booth Political History; HTTP 200, 140 ms, served=live, adapter=embedded, kind=geo-pack, fallback=false
- Page claims: badge "LIVE"; header freshness "stored copy · date not recorded"; source line "Stored records from the published source"; meta.status "—"
- Note: Ingested Goa geography pack — SIR final roll 2026 · elections 2017–2024 only. The workbook GitHub URL is the extract source, not the live table.
- Row hosts: (none) 1731
- Columns shown: BOOTH · STATION · 2017 · 2019 · 2022 · 2024 · FLIPS; date columns: none; dated 0/1731; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 1 rows (e.g. booth 35 · government primary schoo! (west wing) ×2); duplicate links: 0 rows
- Relevance: 15/15 judged on topic
- Sample:
  - Booth 1 · Government Primary School, Tiracol
  - Booth 17 · Govt. Primary School, Gauthanwada, Usap
  - Booth 6 · St. Francis Xavier's High School, Siolim (South Wing)
  - Booth 3 · Govt. Primary School (West Wing) Carrem, Socorro
  - Booth 8 · Department of Goa Gazetteer and Historical Records
  - Booth 5 · Government Primary School, Navelim Divar
  - Booth 32 · Govt. Primary School, Khadchal, Surla
  - Booth 40 · Govt. Primary School, Par
  - Booth 15 · Government Primary School (East Wing)
  - Booth 15 · St. Andrew's High School, Vasco-da-Gama (Room
  - Booth 10 · Fr. Agnel Primary School, New Building (South
  - Booth 42 · St. Anthony School, (Primary School), Pajifond
  - Booth 35 · Govt. Primary School, (Room No. 2), Housing
  - Booth 21 · Government Primary School, Adnem, Quepem Goa
  - Booth 40 · Shree Sharda English High School, Sanvordem

### 95. State · Governor Friction & President's Rule Tracker — MINOR
- Request: tier=state, feature=Governor Friction & President's Rule Tracker; HTTP 200, 483 ms, served=live, adapter=news-search, fallback=false
- Page claims: badge "LIVE"; header freshness "—"; source line "Live · 74 stories from Google News"; meta.status "LIVE · NEWS RSS"
- Note: Google News search for disputes between governors and state governments: walkouts and rows over the governor's address, withheld assent, Raj Bhavan standoffs, President's Rule (Article 356). Reporting, not a register of proclamations or withheld bills.
- Row hosts: news.google.com 74
- Columns shown: DATE · TITLE · SUMMARY · PUBLISHER; date columns: DATE; dated 74/74; newest 2026-10-07; oldest 2017-07-04; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 15/15 judged on topic
- Sample:
  - <2026-10-08> INDIA bloc leaders clash with police during Raj Bhavan march in Patna, Tejashwi detained - The Statesman {The Statesman}
  - <2026-06-18> Tamil Nadu Assembly Ensures Smooth Governor’s Address As National Anthem Played Twice Under TVK Government - F {Free Press Jour
  - <2026-01-22> Governor’s walkout sparks Karnataka showdown: Thawar Gehlot exits joint sitting mid-address; Congress cries br {The Times of In
  - <2026-01-20> Mic switched off, text had inaccuracies, says Lok Bhavan on Tamil Nadu Governor address row - The Tribune {The Tribune}
  - <2026-01-20> "National Anthem Must Be Respected": Tamil Nadu Governor Skips Key Speech - NDTV {NDTV}
  - <2025-12-17> Rare thaw: Kerala Governor, CM resolve V-C row, agree on 2 names - The Indian Express {The Indian Express}
  - <2025-06-20> After Raj Bhavan row, Kerala minister says textbooks to cover Governor's powers - India Today {India Today}
  - <2025-06-06> CPI attacks Kerala Governor over use of Bharat Mata portrait with saffron flag at Raj Bhavan - Deccan Herald {Deccan Herald}
  - <2025-01-31> One event, two venues: Tamil Nadu Governor Ravi, DMK govt clash over Martyrs’ Day observance - The Indian Expr {The Indian Expr
  - <2025-01-07> DMK Stages Statewide Protest Against Tamil Nadu Governor RN Ravi Over Assembly Walkout - ABP Live English {ABP Live English}
  - <2024-05-03> West Bengal Governor Sexual Harassment Row: Mamata Banerjee Lashes Out at CV Ananda Bose for - LatestLY {LatestLY}
  - <2023-11-06> Amid ticket row, Governor plays host to cricket fans, watches live match on screen at Raj Bhavan - The Indian  {The Indian Expr
  - <2023-04-07> ‘Bills Withheld Are Dead’, ‘Anti-Sterlite Protests Had Foreign Funding’: TN Governor R N Ravi’s remarks spark  {The Indian Expr
  - <2023-01-09> Tamil Nadu Governor Walks Out Amid Row With MK Stalin Over His Speech - NDTV {NDTV}
  - <2021-12-13> Kerala row and beyond: Governor’s role in state, central universities - The Indian Express {The Indian Express}

### 99. State · Local Governance Brief — MINOR
- Request: tier=local, feature=Local Governance Brief; HTTP 200, 78 ms, served=live, adapter=embedded, kind=geo-pack, fallback=false
- Page claims: badge "LIVE"; header freshness "stored copy · date not recorded"; source line "Stored records from the published source"; meta.status "—"
- Note: Ingested Goa geography pack — SIR final roll 2026 · elections 2017–2024 only. The workbook GitHub URL is the extract source, not the live table. Local Governance Brief rolls seats up by district×taluka — it is not a second Constituency Register.
- Row hosts: (none) 11
- Columns shown: TALUKA · DISTRICT · SEATS · ELECTORS · BOOTHS · STATUS MIX · LEADING BLOC (EST.); date columns: none; dated 0/11; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 11/15 judged on topic
- Sample:
  - Bardez, North Goa
  - Bicholim, North Goa
  - Pernem, North Goa
  - Ponda, North Goa
  - Sattari, North Goa
  - Tiswadi, North Goa
  - Canacona, South Goa
  - Mormugao, South Goa
  - Quepem, South Goa
  - Salcete, South Goa
  - Sanguem, South Goa

### 100. State · Bureaucrat Transfer & Posting Tracker (State Cadre) — MINOR
- Request: tier=state, feature=Bureaucrat Transfer & Posting Tracker (State Cadre); HTTP 200, 148 ms, served=live, adapter=news-search, fallback=false
- Page claims: badge "LIVE"; header freshness "—"; source line "Live · 58 stories from Google News"; meta.status "—"
- Note: Live news-search feed.
- Row hosts: news.google.com 58
- Columns shown: DATE · TITLE · SUMMARY · PUBLISHER; date columns: DATE; dated 58/58; newest 2026-10-15; oldest 2026-10-09; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 1 rows (e.g. india news ×2); duplicate links: 0 rows
- Relevance: 13/15 judged on topic; off-topic examples: Yogesh Kumar IAS Biography: Age, Batch, Cadre (Legend Officers) \| India News - LatestLY
- Sample:
  - <Sun, 11 Oct 2026 06:21:56> Haryana Police shake-up: IPS officer Navdeep Virk is human rights DG, 35 officers transferred in all - ThePrin {
  - <Sat, 10 Oct 2026 02:00:57> 100 Senior Jammu And Kashmir Police Officers Transferred In Major Reshuffle - NDTV {NDTV}
  - <Sat, 10 Oct 2026 16:07:02> IAS Officer Govind Jaiswal Posted To Jammu &amp; Kashmir Segment - Daily Excelsior {Daily Excelsior}
  - <Fri, 09 Oct 2026 22:01:41> Supreme Court Dismisses Petitioner IAS Officer in Challenge to Transfer from Chief Secretary Post Under Articl {
  - <Wed, 14 Oct 2026 08:15:51> Yogesh Kumar IAS Biography: Age, Batch, Cadre, Education &amp; Posting - Legend Officers {Legend Officers}
  - <Sat, 10 Oct 2026 22:33:03> IAS officer Jaiswal posted to JK segment - Daily Excelsior {Daily Excelsior}
  - <Fri, 09 Oct 2026 23:05:08> Govt Transfers 100 Senior J&amp;K Police Officers in Major Reshuffle - Kashmir Observer {Kashmir Observer}
  - <Thu, 15 Oct 2026 03:59:07> AP IAS officer Vikas Marmat transferred after Bengaluru pub row - Hyderabad Mail {Hyderabad Mail}
  - <Sun, 11 Oct 2026 07:17:12> Who Is Dr Navjot Simi? IPS Officer Transferred to Bihar CID, Know Her UPSC Rank, Education and IAS Husband - I {
  - <Thu, 15 Oct 2026 04:48:01> IAS Vikas Marmat Transferred From KADA After Bengaluru Pub Incident; Triggers Scrutiny in Andhra Pradesh - Ind {
  - <Tue, 13 Oct 2026 03:10:05> Andhra Pradesh Transfers 11 IAS Officers, Amrapali Kata Gets Tourism and Culture Department - Indianmastermind {
  - <Fri, 09 Oct 2026 07:39:01> Who Is A Karthik? Senior IAS Officer Named Tamil Nadu Home Secretary; Rajesh Lakhoni Returns to TNPDCL - India {
  - <Wed, 14 Oct 2026 07:02:21> West Bengal Govt Transfers 4 IAS Officers; Mukta Arya Appointed WBPDCL CMD - Indianmasterminds {Indianmastermind
  - <Mon, 12 Oct 2026 03:44:36> Bihar Police Transfers 29 Officers, Including 2 IPS &amp; 27 BPS; Narayan Upadhyay Appointed SDPO Phulwarishar {
  - <Fri, 09 Oct 2026 01:10:23> India News - LatestLY {LatestLY}

### 102. State · Centre-State Fund Flow Tracker — MINOR
- Request: tier=state, feature=Centre-State Fund Flow Tracker; HTTP 200, 407 ms, served=live, adapter=api, kind=budget-xlsx, fallback=false
- Page claims: badge "LIVE"; header freshness "through 2026-27"; source line "Live · 11 records from Union Budget"; meta.status "LIVE · BUDGET XLSX"
- Note: Live Union Budget Statement 1 (stat1.xlsx) — Expenditure Profile summary. ₹ crore. Transfer lines 5–8 are the centre→state block.
- Row hosts: indiabudget.gov.in 11
- Columns shown: DATE · TITLE · LINE · CATEGORY · IS AGGREGATE · UNIT · PROFILE; date columns: DATE; dated 0/11; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 10 rows
- Relevance: 11/15 judged on topic
- Sample:
  - <2026-2027> Central Expenditure (2+3+4)
  - <2026-2027> Establishment
  - <2026-2027> Central Sector Schemes
  - <2026-2027> Other Central Expenditure
  - <2026-2027> Transfers (6+7+8)
  - <2026-2027> Centrally Sponsored Schemes
  - <2026-2027> Finance Commission Transfers
  - <2026-2027> Other Transfers
  - <2026-2027> Total Expenditure through Budget (1+5)
  - <2026-2027> Resources of Public Enterprises
  - <2026-2027> Total Expenditure through Budget and Resources of Public Enterprises (9+10)

### 108. State · Cross-State Comparison Engine — MINOR
- Request: tier=state, feature=Cross-State Comparison Engine; HTTP 200, 147 ms, served=live, adapter=register, fallback=false
- Page claims: badge "LIVE"; header freshness "stored copy · as of 11 Dec 2025"; source line "Live · 25 records from rbi.org.in"; meta.status "RBI HANDBOOK · STATE LEVEL"
- Note: RBI Handbook of Statistics on Indian States, 2024-25 edition (published 11 Dec 2025); state level. Table 21: Gross State Domestic Product (Current Prices) (₹ Lakh): every state ranked, highest value first (rank 1 is the largest figure, not the best), with the year before; each indicator’s latest yea
- Row hosts: rbi.org.in 25
- Columns shown: RANK · STATE · INDICATOR · YEAR · VALUE · UNIT · YEAR BEFORE; date columns: none; dated 0/25; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 24 rows
- Relevance: 15/15 judged on topic
- Sample:
  - Maharashtra · Gross State Domestic Product · 2024-25
  - Tamil Nadu · Gross State Domestic Product · 2024-25
  - Karnataka · Gross State Domestic Product · 2024-25
  - Rajasthan · Gross State Domestic Product · 2024-25
  - Telangana · Gross State Domestic Product · 2024-25
  - Madhya Pradesh · Gross State Domestic Product · 2024-25
  - Delhi · Gross State Domestic Product · 2024-25
  - Haryana · Gross State Domestic Product · 2024-25
  - Odisha · Gross State Domestic Product · 2024-25
  - Assam · Gross State Domestic Product · 2024-25
  - Chhattisgarh · Gross State Domestic Product · 2024-25
  - Uttarakhand · Gross State Domestic Product · 2024-25
  - Himachal Pradesh · Gross State Domestic Product · 2024-25
  - Tripura · Gross State Domestic Product · 2024-25
  - Puducherry · Gross State Domestic Product · 2024-25

### 58. Carbon · ETS & Tax Adoption Timeline — OK
- Request: tier=climate, feature=ETS & Tax Adoption Timeline; HTTP 200, 84 ms, served=live, adapter=embedded, kind=carbon-pack, fallback=false
- Page claims: badge "none"; header freshness "stored copy · date not recorded"; source line "Stored records from ourworldindata.org"; meta.status "—"
- Note: Extracted first carbon-pricing year by jurisdiction — ETS against tax, from the 1990 Nordic pioneers. Not a news search.
- Row hosts: ourworldindata.org 52
- Columns shown: Jurisdiction · First year · Tax since · ETS since · Instruments; date columns: Tax since, ETS since; dated 0/52; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 51 rows
- Relevance: 15/15 judged on topic
- Sample:
  - <1990> Finland
  - <1991> Sweden
  - <2000> Estonia
  - <—> Cyprus
  - <—> Germany
  - <—> Italy
  - <—> Malta
  - <—> Spain
  - <2008> Canada
  - <—> New Zealand
  - <2011> Ukraine
  - <—> Kazakhstan
  - <—> South Korea
  - <2019> Singapore
  - <2022> Uruguay

### 46. Economics · Global exchange index quotes — OK
- Request: tier=finance, feature=Live Global Stock Exchanges; HTTP 200, 416 ms, served=live, adapter=api, fallback=false
- Page claims: badge "LIVE"; header freshness "—"; source line "Live · 5 records from query1.finance.yahoo.com"; meta.status "—"
- Note: Yahoo last quotes for NYSE, NASDAQ, TSX, Tadawul and ASX index levels. Stooq CSV is JS-gated from this host. Not a licensed tick feed.
- Row hosts: finance.yahoo.com 5
- Columns shown: INDEX · VENUE · LAST · CHANGE · CHG % · AS OF; date columns: LAST, AS OF; dated 5/5; newest 2026-10-14; oldest 2026-10-14; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 5/15 judged on topic
- Sample:
  - <7724.4> S&P 500
  - <26594.3> NASDAQ Composite
  - <35861.43> S&P/TSX Composite
  - <10106.54> Tadawul All Share
  - <8719.7> S&P/ASX 200

### 47. Economics · Country GDP observations — OK
- Request: tier=finance, feature=Economic Overview of All Countries; HTTP 200, 258 ms, served=live, adapter=api, fallback=false
- Page claims: badge "LIVE"; header freshness "—"; source line "Live · 186 records from World Bank"; meta.status "—"
- Note: World Bank NY.GDP.MKTP.CD, most recent non-empty year per country. Aggregates excluded.
- Row hosts: data.worldbank.org 186
- Columns shown: ECONOMY · YEAR · GDP (US$ BN); date columns: none; dated 0/186; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 185 rows
- Relevance: 15/15 judged on topic
- Sample:
  - United States
  - Korea, Rep.
  - Sweden
  - Hong Kong SAR, China
  - Algeria
  - Ecuador
  - Serbia
  - Bolivia
  - Libya
  - Albania
  - Mozambique
  - Rwanda
  - Barbados
  - Cabo Verde
  - Vanuatu

### 48. Economics · GDP, CPI & employment indicators — OK
- Request: tier=finance, feature=Key Financial Indicators (GDP, CPI, PMI, Emp-to-Pop); HTTP 200, 845 ms, served=live, adapter=api, fallback=false
- Page claims: badge "LIVE"; header freshness "—"; source line "Live · 186 records from World Bank"; meta.status "—"
- Note: World Bank GDP growth, CPI, and employment-to-population. PMI is licensed (S&P Global) and is not in this table.
- Row hosts: data.worldbank.org 186
- Columns shown: ECONOMY · YEAR · GDP GROWTH % · CPI % · EMP-TO-POP %; date columns: none; dated 0/186; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 185 rows
- Relevance: 15/15 judged on topic
- Sample:
  - Guyana
  - India
  - Cabo Verde
  - Mali
  - Macao SAR, China
  - Philippines
  - Albania
  - Bahrain
  - Congo, Rep.
  - Tonga
  - Thailand
  - Portugal
  - United Kingdom
  - France
  - Finland

### 49. Economics · India GDP growth baseline — OK
- Request: tier=finance, feature=Economic Simulator; HTTP 200, 155 ms, served=live, adapter=api, fallback=false
- Page claims: badge "LIVE"; header freshness "through 2025"; source line "Live · 36 records from World Bank"; meta.status "LIVE · WORLD BANK WDI"
- Note: World Bank India GDP growth (annual %, NY.GDP.MKTP.KD.ZG). Historical baseline for the desk — not a forecast engine, and no scenario outcomes are invented.
- Row hosts: data.worldbank.org 36
- Columns shown: YEAR · COUNTRY · SERIES · GDP GROWTH % · UNIT; date columns: none; dated 0/36; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 35 rows
- Relevance: 15/15 judged on topic
- Sample:
  - India GDP growth 2025
  - India GDP growth 2023
  - India GDP growth 2021
  - India GDP growth 2018
  - India GDP growth 2016
  - India GDP growth 2013
  - India GDP growth 2011
  - India GDP growth 2009
  - India GDP growth 2006
  - India GDP growth 2004
  - India GDP growth 2001
  - India GDP growth 1999
  - India GDP growth 1997
  - India GDP growth 1994
  - India GDP growth 1992

### 50. Economics · India electricity-access series — OK
- Request: tier=finance, feature=Sector Policy — Power/Energy/Green/Critical Minerals; HTTP 200, 127 ms, served=live, adapter=api, fallback=false
- Page claims: badge "LIVE"; header freshness "—"; source line "Live · 25 records from World Bank"; meta.status "—"
- Note: World Bank India electricity-access series. Not a ministry gazette. CEA/Grid India/PPAC are not in this pack. The 8-row policy pipeline links to Google News and is not used here.
- Row hosts: data.worldbank.org 25
- Columns shown: YEAR · COUNTRY · SERIES · VALUE; date columns: none; dated 0/25; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 24 rows
- Relevance: 15/15 judged on topic
- Sample:
  - India electricity access 2024
  - India electricity access 2023
  - India electricity access 2021
  - India electricity access 2019
  - India electricity access 2018
  - India electricity access 2016
  - India electricity access 2014
  - India electricity access 2013
  - India electricity access 2011
  - India electricity access 2009
  - India electricity access 2008
  - India electricity access 2006
  - India electricity access 2004
  - India electricity access 2003
  - India electricity access 2001

### 71. Entertainment · TV & Streaming Tonight — OK
- Request: tier=entertainment, feature=TV & Streaming Tonight; HTTP 200, 923 ms, served=live, adapter=api, fallback=false
- Page claims: badge "LIVE"; header freshness "—"; source line "Live · 113 records from TVmaze"; meta.status "—"
- Note: TVmaze schedule for India and the United States — show, network and airtime. Not a GDELT search.
- Row hosts: tvmaze.com 113
- Columns shown: SHOW · NETWORK · COUNTRY · AIRTIME · EPISODE; date columns: none; dated 0/113; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 2 rows (e.g. max & the midknights ×2; american horror story ×2); duplicate links: 0 rows
- Relevance: 15/15 judged on topic
- Sample:
  - Bigg Boss
  - FOX & Friends
  - Money, Power, Politics with Stephanie Ruhle
  - TODAY with Jenna & Sheinelle
  - NewsNation Live with Nichole Berlie
  - GMA3
  - Let's Make a Deal
  - ABC News Live Reports
  - CBS Evening News
  - The Ingraham Angle
  - Hell's Kitchen
  - 9-1-1: Nashville
  - War
  - Grey's Anatomy
  - CNN NewsNight with Abby Phillip

### 74. Entertainment · Bollywood & Film Wire — OK
- Request: tier=entertainment, feature=Bollywood & Film Wire; HTTP 200, 514 ms, served=live, adapter=api, fallback=false
- Page claims: badge "LIVE"; header freshness "—"; source line "Live · 100 records from NDTV Movies"; meta.status "—"
- Note: NDTV Movies RSS, with Google News Bollywood as the declared fallback wire. Not a GDELT search. NDTV Movies RSS.
- Row hosts: (none) 100
- Columns shown: HEADLINE · SOURCE · PUBLISHED; date columns: PUBLISHED; dated 100/100; newest 2026-10-14; oldest 2026-10-12; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 15/15 judged on topic
- Sample:
  - <2026-10-15> Ramayana English Trailer: Yash's 'Fire And Fury' Clashes With Ranbir Kapoor's 'Perfect Man'
  - <2026-10-15> When Imran Khan Said He Wanted An Indian Passport, Spoke About Being Unable To Vote
  - <2026-10-15> YouTuber Sourav Joshi Criticised After Asking Wife Avantika To Drink From Pet Dog Oreo's Water Bowl
  - <2026-10-15> 'I Was Mouthing His Dialogues': Jailer 2 Actor Mirnaa Recalls Watching Petta With Rajinikanth
  - <2026-10-15> Jailer 2 X Review: Internet Calls Rajinikanth's Film A 'Banger Of An Entertainer'
  - <2026-10-15> "My Life Will Go To My Grave": Salman Khan Says Biopic On His Life 'Will Never Be Made'
  - <2026-10-14> Salman Khan Calls Ranveer Singh A "Very Secure" Actor, Praises His Dhurandhar Performance
  - <2026-10-14> 'Sleep With Me': Niti Taylor Recalls Casting Couch Demand By Telugu Director That Made Her Quit Films
  - <2026-10-14> "Nayyi Navelli Will Show My Lighter Side": Yami Gautam
  - <2026-10-14> 'Roti Se Pehla Pyaar Hua': Anil Kapoor Asked Nana Patekar When He Fell In Love For The First Time
  - <2026-10-14> 'Bollywood Mocked Him': Rajinikanth Recalls Amitabh Bachchan Working 18 Hours A Day To Repay Rs 90-Crore Debt
  - <2026-10-14> The Raja Saab Producer Claims Prabhas' Horror-Comedy Flopped Due To Sankranthi Release
  - <2026-10-13> Raju Srivastava Was Hurt After Finishing Third On Laughter Challenge, Recalls Shekhar Suman
  - <2026-10-13> What Irrfan Khan Told Nana Patekar When He Was Very Sick
  - <2026-10-13> "I Approach This Film With Gratitude": Ravie Dubey On His Bollywood Debut With Ramayana

### 77. Entertainment · OTT & studio owner identities — OK
- Request: tier=entertainment, feature=OTT & Studio Intelligence; HTTP 200, 1377 ms, served=live, adapter=api, fallback=false
- Page claims: badge "LIVE"; header freshness "—"; source line "Live · 87 records from Wikidata"; meta.status "—"
- Note: Wikidata Indian video-on-demand services and film production companies with owners. Not TRAI subscriber, pricing or slate tables.
- Row hosts: wikidata.org 87
- Columns shown: NAME · KIND · OWNER; date columns: none; dated 0/87; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 15/15 judged on topic
- Sample:
  - 2D Entertainment
  - Applause Entertainment
  - B62 Studios
  - Big Bang Entertainments
  - East India Film Company
  - Friday Filmworks
  - Guru Dutt Films
  - Kamakshi Movies
  - M.H. Films Productions
  - Minerva Movietone
  - NIC ARTS
  - Phantom Films
  - S3 Movies
  - T-Series
  - Villagers Film Studio

### 78. Entertainment · Public follower observations — OK
- Request: tier=entertainment, feature=Celebrity Influence Index; HTTP 200, 3389 ms, served=live, adapter=api, fallback=false
- Page claims: badge "LIVE"; header freshness "—"; source line "Live · 246 records from Wikidata"; meta.status "—"
- Note: Wikidata Indian actors, singers and directors with a public follower count (P8687). Brand slates and box-office pull are not in this pull.
- Row hosts: wikidata.org 246
- Columns shown: PERSON · FOLLOWERS (WD); date columns: none; dated 0/246; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 15/15 judged on topic
- Sample:
  - Amitabh Bachchan
  - Amit Bhadana
  - Smriti Irani
  - Sivakartikeyan
  - Jubin Nautiyal
  - Boman Irani
  - Asha Bhosle
  - Mahesh Bhatt
  - Varun Tej
  - K. Selvaraghavan
  - Kiara Advani
  - Sonu Kakkar
  - Amrinder Gill
  - Satish Ray
  - Lakshmi Manchu

### 30. Global · Growth Indicators — OK
- Request: tier=geopolitics, feature=Growth Indicators; HTTP 200, 1629 ms, served=live, adapter=live, fallback=false
- Page claims: badge "LIVE"; header freshness "—"; source line "Live · 20 records from World Bank"; meta.status "LIVE · WORLD BANK · CACHED 24H"
- Note: World Bank open data — GDP growth, inflation and unemployment. Cached up to 24 hours.
- Row hosts: data.worldbank.org 20
- Columns shown: ECONOMY · REAL GDP GROWTH (%) · INFLATION (%) · UNEMPLOYMENT (%) · PERIOD; date columns: none; dated 0/20; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 19 rows
- Relevance: 15/15 judged on topic
- Sample:
  - India
  - Indonesia
  - China
  - Turkiye
  - Spain
  - Brazil
  - Netherlands
  - Canada
  - Australia
  - Switzerland
  - Japan
  - Korea, Rep.
  - France
  - Mexico
  - Italy

### 32. Global · Global Trade — OK
- Request: tier=geopolitics, feature=Global Trade; HTTP 200, 133 ms, served=live, adapter=live, fallback=false
- Page claims: badge "LIVE"; header freshness "—"; source line "Live · 20 records from World Bank"; meta.status "LIVE · WORLD BANK · CACHED 24H"
- Note: World Bank open data — merchandise exports and trade as a share of GDP. Cached up to 24 hours.
- Row hosts: data.worldbank.org 20
- Columns shown: ECONOMY · YEAR · MERCH. EXPORTS (US$ BN) · TRADE (% OF GDP); date columns: none; dated 0/20; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 19 rows
- Relevance: 15/15 judged on topic
- Sample:
  - China
  - United States
  - Germany
  - Japan
  - Italy
  - Korea, Rep.
  - Mexico
  - United Kingdom
  - Canada
  - India
  - Spain
  - Russian Federation
  - Australia
  - Saudi Arabia
  - Indonesia

### 35. Law · Allahabad High Court reporting — OK
- Request: tier=judiciary, feature=UP High Court (Allahabad) Order Feed; HTTP 200, 603 ms, served=live, adapter=news-search, fallback=false
- Page claims: badge "LIVE"; header freshness "last 7 days"; source line "Live · 73 stories from Google News"; meta.status "LIVE · NEWS RSS"
- Note: 73 coverage rows (Google News RSS — court / litigation coverage. Not an official docket or cause list.).
- Row hosts: news.google.com 73; sections: COVERAGE — GOOGLE NEWS RSS 73
- Columns shown: DATE · TITLE · SUMMARY · PUBLISHER · SECTION; date columns: DATE; dated 73/73; newest 2026-10-15; oldest 2026-10-08; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 15/15 judged on topic
- Sample:
  - <Tue, 13 Oct 2026 15:15:21> 'Oudh Bar Must Lead By Example In Democratic Conduct': Allahabad High Court Calls For Free, Fair &amp;... - Li [
  - <Wed, 14 Oct 2026 09:40:40> Allahabad High Court Flags Concern Over MP/MLA Cases Listed Before Non-Designated Courts, Low In Cause... - Li [
  - <Mon, 12 Oct 2026 08:49:21> POCSO Case: Allahabad High Court Questions UP Education System After Class V-Educated Girl Fails To Read... -  [
  - <Thu, 15 Oct 2026 05:00:43> Writ Petition Not Maintainable Once Statutory Revision Against Same Order Is Withdrawn As 'Not Pressed':... -  [
  - <Thu, 08 Oct 2026 21:30:34> No anticipatory bail plea to be heard in POCSO cases without hearing victim: Allahabad High Court - The Indian [
  - <Thu, 08 Oct 2026 18:01:29> Allahabad High Court Asks How ‘Aandolanjeevi’ Found Way Into NSA Detention Order Of Journalist Satyam Verma -  [
  - <Sun, 11 Oct 2026 07:41:14> Ayushman Bharat: Allahabad High Court Upholds Hospital De-Empanelment For Charging Rs 9,000 For Blood Units -  [
  - <Mon, 12 Oct 2026 10:03:56> Allahabad High Court Orders Gratuity for Aided Madrasa Staff Retiring at 62 - Clarion India [COVERAGE — GOOGLE N
  - <Tue, 13 Oct 2026 06:10:58> Coaching Academy, Azamgarh School To Face State Inquiry, Allahabad High Court Orders - LawChakra [COVERAGE — GOO
  - <Wed, 14 Oct 2026 16:56:12> Ambedkar Nagar Delimitation Challenge Rejected By Allahabad High Court Over Delay - LawChakra [COVERAGE — GOOGLE
  - <Sat, 10 Oct 2026 13:50:07> Allahabad High Court Holds Doctrine Of Necessity Can Save Administrative Exercise From Becoming Futile - LawCh [
  - <Fri, 09 Oct 2026 10:13:01> Allahabad High Court Waives Special Marriage Act Notice Publication For Interfaith Couple Fearing Threats - La [
  - <Tue, 13 Oct 2026 11:57:00> Allahabad High Court praises Azamgarh SSP for adopting two girls orphaned in triple murder case - The Statesma [
  - <Fri, 09 Oct 2026 06:05:41> Victim Must Be Heard Before Granting Anticipatory Bail in POCSO Cases: Allahabad High Court Issues Directions  [
  - <Wed, 14 Oct 2026 17:17:31> Allahabad High Court Orders UP Panchayat Elections Within 3 Months, Details Inside - Zoom News [COVERAGE — GOOGL

### 42. Law · WTO Dispute Settlement — OK
- Request: tier=judiciary, feature=WTO Dispute Settlement; HTTP 200, 112 ms, served=live, adapter=embedded, kind=law-pack, fallback=false
- Page claims: badge "none"; header freshness "stored copy · as of 13 Oct 2026"; source line "Stored records from wto.org"; meta.status "—"
- Note: The WTO dispute settlement register (DS1 onward), as the WTO publishes it: parties, stage and dates. Collected from wto.org; the official case page is the authority.
- Row hosts: wto.org 646
- Columns shown: DS · DISPUTE · COMPLAINANT · RESPONDENT · STAGE · REQUESTED; date columns: REQUESTED; dated 646/646; newest 2026-07-26; oldest 1995-01-09; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 138 rows (e.g. measures concerning agricultural products from ukraine ×3; anti-dumping and countervailing measures on biodiesel from a ×2; certain measures concerning palm oil and oil palm crop-based ×2); duplicate links: 0 rows
- Relevance: 15/15 judged on topic
- Sample:
  - <2026-07-27> Additional Duties on Certain Products from Brazil {World Trade Organization}
  - <2021-06-24> Anti-Dumping and Countervailing Duty Measures on Certain Products from China {World Trade Organization}
  - <2018-07-16> Additional Duties on Certain Products from the United States {World Trade Organization}
  - <2016-12-15> Tariff Rate Quotas for Certain Agricultural Products {World Trade Organization}
  - <2013-12-23> Cost Adjustment Methodologies and Certain Anti-Dumping Measures on Imports from Russia {World Trade Organization}
  - <2012-03-13> Measures Related to the Exportation of Rare Earths, Tungsten and Molybdenum {World Trade Organization}
  - <2008-12-19> Grants, Loans and Other Incentives {World Trade Organization}
  - <2006-06-06> Customs Bond Directive for Merchandise Subject to Anti-Dumping/Countervailing Duties {World Trade Organization}
  - <2003-10-08> Measures Affecting the Importation and Internal Sale of Cigarettes {World Trade Organization}
  - <2002-05-21> Definitive Safeguard Measures on Imports of Certain Steel Products {World Trade Organization}
  - <2000-12-20> Provisional Anti-Dumping Measure on Electric Transformers {World Trade Organization}
  - <1999-05-21> Measures Relating to the Development of a Flight Management System {World Trade Organization}
  - <1998-05-05> Certain Income Tax Measures Constituting Subsidies {World Trade Organization}
  - <1997-06-04> Taxes on Alcoholic Beverages {World Trade Organization}
  - <1996-06-13> Measures Affecting Consumer Photographic Film and Paper {World Trade Organization}

### 7. National · LS Manifestos & Promises — OK
- Request: tier=national, feature=LS Manifestos & Promises Tracker; HTTP 200, 72 ms, served=live, adapter=embedded, fallback=false
- Page claims: badge "none"; header freshness "stored copy · as of 01 Jan 2024"; source line "Stored records from bjp.org and manifesto.inc.in"; meta.status "CURATED · VERIFY AGAINST GAZETTE / PIB"
- Note: CURATED · AS OF JAN 2026 · VERIFY AGAINST GAZETTE / PIB. Verifiable status, not fulfilled/broken. Sarkari Vaade 346-commitment package is not ingested (licence unresolved).
- Row hosts: (none) 10
- Columns shown: TITLE · PROMISE · DOMAIN · VERIFIABLE STATUS · CYCLE; date columns: none; dated 0/10; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 10/15 judged on topic
- Sample:
  - Ayushman Bharat cover for all citizens 70+
  - 3 crore additional PMAY houses
  - One Nation One Election
  - Uniform Civil Code
  - Free foodgrain (PMGKAY) for 5 years
  - 3 crore Lakhpati Didis
  - Women’s reservation (Nari Shakti Vandan)
  - Mudra loan ceiling to ₹20 lakh
  - Anti paper-leak law
  - Vande Bharat & rail modernisation

### 9. National · National Morning Brief — OK
- Request: tier=national, feature=National Morning Brief (Auto-digest); HTTP 200, 1472 ms, served=live, adapter=news-search, kind=panel, fallback=false
- Page claims: badge "LIVE"; header freshness "last 3 days"; source line "Live · 220 stories from Press Information Bureau and Google News"; meta.status "LIVE · PIB + WIRES"
- Note: Morning Brief: top stories 100, PIB 20, economy 100. Not a personalised digest.
- Row hosts: news.google.com 200, pib.gov.in 20; sections: Top of the Day 100, Government Wire 20, Economy 100
- Columns shown: DATE · TITLE · SUMMARY · PUBLISHER · SECTION · SOURCE; date columns: DATE; dated 220/220; newest 2026-10-15; oldest 2026-10-12; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 7 rows (e.g. india’s innovation quagmire ×2; india's rbi has spent half of $140 billion fx capital haul i ×2; india may need rate hikes, tax cuts to buoy rupee, analysts  ×2); duplicate links: 1 rows
- Relevance: 15/15 judged on topic
- Sample:
  - <Thu, 15 Oct 2026 12:14:56> Gyanesh Kumar Row Puts Modi Government Under Pressure - Frontline Magazine [Top of the Day] {Frontline Magazine}
  - <Thu, 15 Oct 2026 02:28:13> Ankita Bhandari murder: Parents released after detention, issue ultimatum to government - The Hindu [Top of the 
  - <Tue, 13 Oct 2026 17:09:32> India’s government fails to crush Gen Z protests - The Economist [Top of the Day] {The Economist}
  - <Tue, 13 Oct 2026 17:18:00> UNION MINISTER OF STATE FOR DoNER DELIVERS VALEDICTORY ADDRESS AT THE NORTH EAST BANKERS’ CONCLAVE 3.0 - DIPR  [
  - <Thu, 15 Oct 2026 06:34:30> Goa’s twin airports: Building a new logistics hub for India’s pharmaceutical industry - ET Government [Top of th
  - <Tue, 13 Oct 2026 12:07:33> How protests have shaped India: From anti-Hindi agitation to farm laws - Al Jazeera [Top of the Day] {Al Jazeera
  - <Tue, 13 Oct 2026 13:55:00> NIFTEM-K Hosts India–Canada Roundtable on Pulse Protein Innovation, Value Addition and Strategic Partnerships  [
  - <2026-10-15> 12th session of India – Japan Joint Working Group (JWG) on Roads and Road Transportation Sector [Government Wire] {Press Inform
  - <2026-10-15> Mahila Kisan Diwas 2026 celebrated today [Government Wire] {Press Information Bureau}
  - <Thu, 15 Oct 2026 08:55:28> Lenders Flag Freeze in Rupee Forwards, Market Distortions to RBI - Bloomberg.com [Economy] {Bloomberg.com}
  - <Thu, 15 Oct 2026 11:30:09> Jio taps stock markets for Rs30,200 crore in landmark IPO - Forbes India [Economy] {Forbes India}
  - <Thu, 15 Oct 2026 10:50:00> How is India assessing Rupee? Sitharaman answers difficult question, explains investment trends - The Economic [
  - <Thu, 15 Oct 2026 01:30:11> IMF’s map of a broken world has one asterisk—India - ThePrint [Economy] {ThePrint}
  - <Thu, 15 Oct 2026 04:52:00> Jio Returns for Meta, Alphabet, KKR Crimped by Long Rupee Slide - Bloomberg.com [Economy] {Bloomberg.com}
  - <Thu, 15 Oct 2026 07:32:45> RBI FX Curbs Knock India’s Rupee Forwards Out Of Line - Finimize [Economy] {Finimize}

### 63. Sports · Cricket Wire — OK
- Request: tier=sports, feature=Cricket Wire; HTTP 200, 341 ms, served=live, adapter=api, fallback=false
- Page claims: badge "LIVE"; header freshness "—"; source line "Live · 100 stories from ESPNcricinfo"; meta.status "—"
- Note: ESPNcricinfo story RSS — matches, results and reports. Not a GDELT search.
- Row hosts: cricinfo.com 100
- Columns shown: HEADLINE · SOURCE · PUBLISHED; date columns: PUBLISHED; dated 100/100; newest 2026-10-14; oldest 2026-10-08; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 0 rows
- Relevance: 15/15 judged on topic
- Sample:
  - <2026-10-15> Cameron Green in doubt for Gqeberha Test
  - <2026-10-15> Stubbs dropped, Rickelton to keep wickets in Gqeberha Test
  - <2026-10-14> Rahmat Shah calls hard-fought Abu Dhabi draw 'equal to a win'
  - <2026-10-14> Jack Leach not on England radar for Bangladesh tour
  - <2026-10-14> 'We should have taken all ten wickets' - Shanto rues missed chances
  - <2026-10-13> Sadikur 149 crushes Barishal; Chattogram move to No. 1 on NCL table
  - <2026-10-13> Another batting paradise greets India and West Indies in Hyderabad
  - <2026-10-13> Ollie Pope withdraws from Afghanistan Premier League T20 draft
  - <2026-10-12> Rishabh Pant ruled out of first two four-dayers against New Zealand A
  - <2026-10-12> Watching videos of Kohli, hitting the deck: how Australia A conquered India
  - <2026-10-11> Farhan and Sadaqat help Pakistan seal series in style
  - <2026-10-11> Ward, Doran, Hope help Tasmania hold off Abbott and New South Wales
  - <2026-10-10> Aliss Al Islam in Litton-led Bangladesh squad for ODI tri-series
  - <2026-10-10> Raza leads Zimbabwe in Ngarava's absence at UAE tri-series
  - <2026-10-09> Australia struggle as Nortje and Jansen make their mark

### 65. Sports · Football Wire — OK
- Request: tier=sports, feature=Football Wire; HTTP 200, 337 ms, served=live, adapter=api, fallback=false
- Page claims: badge "LIVE"; header freshness "—"; source line "Live · 81 stories from BBC Sport"; meta.status "—"
- Note: BBC Sport football RSS. Not a GDELT search.
- Row hosts: bbc.co.uk 81
- Columns shown: HEADLINE · SOURCE · PUBLISHED; date columns: PUBLISHED; dated 81/81; newest 2026-10-14; oldest 2026-08-03; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 5 rows (e.g. why souness rejected barcelona when he left liverpool ×2; arsenal's injured caldentey out for up to 10 weeks ×2; hibs ban fans group for three games after disorder ×2); duplicate links: 6 rows
- Relevance: 15/15 judged on topic
- Sample:
  - <2026-10-15> Infantino apologises to Fifa Council - but told he is still not fit to lead
  - <2026-10-15> Why Souness rejected Barcelona when he left Liverpool
  - <2026-10-15> Southgate does not see return to Premier League management
  - <2026-10-15> Listen: Will Celtic bounce back in Lisbon - and how will Hearts start?
  - <2026-10-14> Martinez's future at Man Utd in doubt - Thursday's gossip
  - <2026-10-14> 'Players won't like it' - Martinez apologises, but is the damage done?
  - <2026-10-14> Bodo/Glimt impress in win over Dortmund
  - <2026-10-14> Millwall's Neil criticised over racial abuse stoppage comments
  - <2026-10-14> Semenyo 'froze' after alleged racist abuse, court told
  - <2026-10-14> Wolves striker Jimenez to have knee surgery
  - <2026-10-14> Cliftonville stripped of League Cup win as treble hopes end
  - <2026-10-13> Were any current Man City players signed during charges period?
  - <2026-10-10> Manager ins and outs - 2026-27
  - <2026-09-24> Ever wondered what it's like to work on Match of the Day?
  - <2026-09-05> Arsenal had more than 20 players on shortlist to capitalise on title win

### 66. Sports · ISL Tracker — OK
- Request: tier=sports, feature=ISL Tracker; HTTP 200, 1733 ms, served=live, adapter=api, fallback=false
- Page claims: badge "LIVE"; header freshness "—"; source line "Live · 169 records from ESPN"; meta.status "—"
- Note: ESPN Indian Super League scoreboard. TheSportsDB ISL is the fallback if ESPN is empty. ESPN scoreboard.
- Row hosts: espn.com 169
- Columns shown: FIXTURE · LEAGUE · DATE · HOME · AWAY · HS · AS; date columns: DATE; dated 169/169; newest 2026-10-15; oldest 2026-02-13; future-dated 71
- Empty >50% (first 50 rows): none; duplicate titles: 36 rows (e.g. mumbai city fc at punjab fc ×2; sc east bengal at inter kashi ×2; mumbai city fc at kerala blasters fc ×2); duplicate links: 0 rows
- Relevance: 15/15 judged on topic
- Sample:
  - <2026-10-16> Mohun Bagan Super Giant at Sporting Club Delhi
  - <2026-10-28> Sporting Club Delhi at FC Goa
  - <2026-11-20> Sporting Club Delhi at SC East Bengal
  - <2026-12-04> Bengaluru FC at Odisha FC
  - <2026-12-13> FC Goa at Churchill Brothers
  - <2026-12-22> Mohun Bagan Super Giant at FC Goa
  - <2027-01-15> Churchill Brothers at Odisha FC
  - <2026-05-21> SC East Bengal at Inter Kashi
  - <2026-05-11> Punjab FC at SC East Bengal
  - <2026-05-01> FC Goa at Jamshedpur FC
  - <2026-04-18> Mumbai City FC at FC Goa
  - <2026-04-09> Mumbai City FC at Jamshedpur FC
  - <2026-03-20> Mumbai City FC at Mohun Bagan Super Giant
  - <2026-03-06> Odisha FC at Mohun Bagan Super Giant
  - <2026-02-23> Chennaiyin FC at Mohun Bagan Super Giant

### 67. Sports · Indian Sports Wire — OK
- Request: tier=sports, feature=Indian Sports Wire; HTTP 200, 1084 ms, served=live, adapter=api, fallback=false
- Page claims: badge "LIVE"; header freshness "—"; source line "Live · 100 stories from Google News"; meta.status "—"
- Note: Google News RSS for India hockey, badminton, kabaddi, athletics and chess (7 days). Not a GDELT search.
- Row hosts: news.google.com 100
- Columns shown: HEADLINE · SOURCE · PUBLISHED; date columns: PUBLISHED; dated 100/100; newest 2026-10-14; oldest 2026-10-08; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 1 rows (e.g. latest hockey news and updates ×2); duplicate links: 0 rows
- Relevance: 15/15 judged on topic
- Sample:
  - <2026-10-15> Have Indian Sports Federations Ruined their sports? Update 20 in Athletics in India by Rupinder Singh - RunBlo
  - <2026-10-15> Telangana edge Goa 3-2 in Hockey India Men’s National Championship - Telangana Today
  - <2026-10-15> Rapid Fire Raid ft. Milan Dahiya (Patna Pirates) \| PKL Unplugged - Pro Kabaddi League
  - <2026-10-14> WFM Cera Dagariya Wins MP Senior State Championship 2026 - ChessBase India
  - <2026-10-14> Shivtrinetra Group Felicitates Asian Games Hockey Gold Medallists - Rediff
  - <2026-10-14> Hockey India Forcing Retirement On Four Senior Stars? Players Fume Over Shock Exit Reports - Outlook India
  - <2026-10-13> Indian Hockey Stars Unaware Of Imminent Retirement - Rediff
  - <2026-10-13> 51st Indian Sub-Junior (Under15) Open Chess Championships 2026 - ChessBase India
  - <2026-10-13> Manipur CM Recognises Asian Games Hockey Gold Medallists - Rediff
  - <2026-10-13> Asian Champions Trophy: India retain Asian Games gold-winning squad - Indian Sports Home
  - <2026-10-12> Day 3 Results \| 16th Hockey India Senior Men National Championship 2026: Division ‘B’ and ‘C’ - Hockey India
  - <2026-10-12> Thrilling Draws Mark Hockey India Senior Men National Championship - Rediff
  - <2026-10-12> How Anish Giri Ended Up Playing for an All-Girls Chess Team - ChessBase India
  - <2026-10-12> BJD, BJP spar over HI notice to Odisha hockey association - The Times of India
  - <2026-10-09> Latest Hockey News and Updates - Hockey India

### 68. Sports · Sports Governance & Policy — OK
- Request: tier=sports, feature=Sports Governance & Policy; HTTP 200, 799 ms, served=live, adapter=api, fallback=false
- Page claims: badge "LIVE"; header freshness "—"; source line "Live · 97 stories from Google News"; meta.status "LIVE · NEWS RSS"
- Note: Google News search for the sports ministry, sports federations, the Indian Olympic Association, anti-doping (NADA) and sports governance law. Reporting, not an official MYAS or National Sports Code register.
- Row hosts: news.google.com 97
- Columns shown: DATE · TITLE · SUMMARY · PUBLISHER; date columns: DATE; dated 97/97; newest 2026-10-14; oldest 2026-04-15; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 3 rows (e.g. sports ministry suspends table tennis federation of india ×2; union minister dr. mansukh mandaviya calls for transparent s ×2; government enforces anti-doping laws to strengthen clean spo ×2); duplicate links: 0 rows
- Relevance: 15/15 judged on topic
- Sample:
  - <2026-10-15> Sports ministry reviews India’s Asian Games performance, demands results and future-proofing - The Hindu {The Hindu}
  - <2026-10-15> IIM Shillong and Sports Ministry Launch Sports Policy Call for Papers to Shape India’s Olympic Ambitions - Spo {Sportscape Maga
  - <2026-10-14> Indian Sports Ministry to meet after spending Rs 7 billion on Asian Games athletes - Gulf News {Gulf News}
  - <2026-10-13> NADA provisionally suspends distance running coach Mohd. Yunus Khan of Army Sports Institute - Indian Sports H {Indian Sports H
  - <2026-10-10> IOA elections on December 5, athlete commission polls scheduled for November 3 - India Today {India Today}
  - <2026-10-08> Sports Ministry To Review India's Asian Games Performance, TOPS Funding - Rediff {Rediff}
  - <2026-10-07> Sports Ministry forms seven-member panel to resolve Hockey India League uncertainty - Sportstar {Sportstar}
  - <2026-10-07> India Positions Amdavad for 2036 Olympic Bid as IOA Outlines 'Rising Together' Vision - GujaratSamachar Englis {GujaratSamachar
  - <2026-09-24> YES BANK strengthens partnership with the Indian Olympic Association for Asian Games 2026 - Adgully.com {Adgully.com}
  - <2026-09-15> Hockey India dispute: Sports Ministry awaits amicable resolution before intervening - India Today {India Today}
  - <2026-08-24> Youth Affairs and Sports Ministry to organise nationwide ‘Khelo India Samvaad’ programme on August 27 - News O {News On AIR}
  - <2026-08-12> Sports ministry suspends Table Tennis Federation of India recognition over governance issues - The Times of In {The Times of In
  - <2026-08-08> National Sports Governance Act 2025: From Ad-Hoc Oversight to Statutory Reform in Indian Sports - IMPRI Impact {IMPRI Impact an
  - <2026-07-17> Govt notifies two Anti-Doping Act for clean sport - News On AIR {News On AIR}
  - <2026-06-30> Sports Governance in India - Vision IAS {Vision IAS}

### 96. State · MLA Directory — OK
- Request: tier=state, feature=MLA Directory; HTTP 200, 190 ms, served=store, adapter=register, kind=register, fallback=false, register
- Page claims: badge "none"; header freshness "register · as of 19 Aug 2026"; source line "Register · as of 19 Aug 2026 · 496 records from Wikidata, Wikipedia and others"; meta.status "—"
- Note: 16 MLAs from each of the 31 states and union territories in the stored register of 4,104. A state's own list holds all of its MLAs.
- Row hosts: wikidata.org 483, en.wikipedia.org 13
- Columns shown: TITLE · AS OF · PARTY · STATE · PERSON · POSITION · STATELABEL; date columns: AS OF; dated 496/496; newest 2026-08-18; oldest 2026-07-13; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 5 rows
- Relevance: 15/15 judged on topic
- Sample:
  - <2026-07-14> Satyanarayana Pithani
  - <2026-07-14> Zubair Anam Mazumder
  - <2026-07-14> Raghavendra Kumar Singh
  - <2026-07-17> Michael Lobo
  - <2026-07-14> Arti Singh Rao
  - <2026-07-14> Rameshwar Singh Thakur
  - <2026-07-14> Laxman Savadi
  - <2026-07-14> Bisahulal Singh
  - <2026-07-14> Yumnam Radheshyam
  - <2026-07-14> Lalnghinglova Hmar
  - <2026-07-17> Sarada Prasanna Jena
  - <2026-07-14> Kulwant Singh Sidhu
  - <2026-08-19> Sonam Venchungpa
  - <2026-07-14> Tellam Venkata Rao
  - <2026-07-14> Sanjay Kumar Sharma

### 104. State · State Economic Data (GSDP, sectors) — OK
- Request: tier=state, feature=State Economic Data (GSDP, sectors); HTTP 200, 225 ms, served=store, adapter=register, kind=register, fallback=false, register
- Page claims: badge "none"; header freshness "register · as of 11 Dec 2025"; source line "Register · as of 11 Dec 2025 · 455 records from rbi.org.in"; meta.status "—"
- Note: RBI Handbook of Statistics on Indian States, 2024-25 edition (published 11 Dec 2025); state level. Table 21: Gross State Domestic Product (Current Prices) (₹ Lakh): 455 figures. Source: National Statistical Office, Ministry of Statistics and Programme Implementation, Government of India. Stored regi
- Row hosts: rbi.org.in 455
- Columns shown: STATE · INDICATOR · YEAR · VALUE · UNIT · PRICES · TABLE; date columns: none; dated 0/455; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 454 rows
- Relevance: 15/15 judged on topic
- Sample:
  - Andhra Pradesh · Gross State Domestic Product · 2024-25
  - Chandigarh · Gross State Domestic Product · 2023-24
  - Arunachal Pradesh · Gross State Domestic Product · 2022-23
  - West Bengal · Gross State Domestic Product · 2022-23
  - Tripura · Gross State Domestic Product · 2021-22
  - Sikkim · Gross State Domestic Product · 2020-21
  - Punjab · Gross State Domestic Product · 2019-20
  - Nagaland · Gross State Domestic Product · 2018-19
  - Manipur · Gross State Domestic Product · 2017-18
  - Madhya Pradesh · Gross State Domestic Product · 2016-17
  - Jharkhand · Gross State Domestic Product · 2015-16
  - Haryana · Gross State Domestic Product · 2014-15
  - Goa · Gross State Domestic Product · 2013-14
  - Chandigarh · Gross State Domestic Product · 2012-13
  - Arunachal Pradesh · Gross State Domestic Product · 2011-12

### 105. State · State Fiscal Deep-Dive — OK
- Request: tier=state, feature=State Fiscal Deep-Dive; HTTP 200, 587 ms, served=store, adapter=register, kind=register, fallback=false, register
- Page claims: badge "none"; header freshness "register · as of 11 Dec 2025"; source line "Register · as of 11 Dec 2025 · 476 records from rbi.org.in"; meta.status "—"
- Note: RBI Handbook of Statistics on Indian States, 2024-25 edition (published 11 Dec 2025); state level. Table 164: State-wise Gross Fiscal Deficit (₹ Crore): the newest 476 of its 661 figures: 15 whole years, 2010-11 to 2024-25; older years are on the table's page. Source: 'Handbook of Statistics on Stat
- Row hosts: rbi.org.in 476
- Columns shown: STATE · INDICATOR · YEAR · VALUE · UNIT · ESTIMATE · TABLE; date columns: none; dated 0/476; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 475 rows
- Relevance: 15/15 judged on topic
- Sample:
  - Andhra Pradesh · Gross Fiscal Deficit · 2024-25
  - All India · Gross Fiscal Deficit · 2024-25
  - All India · Gross Fiscal Deficit · 2023-24
  - All India · Gross Fiscal Deficit · 2022-23
  - Puducherry · Gross Fiscal Deficit · 2021-22
  - Puducherry · Gross Fiscal Deficit · 2020-21
  - Puducherry · Gross Fiscal Deficit · 2019-20
  - Puducherry · Gross Fiscal Deficit · 2018-19
  - Delhi · Gross Fiscal Deficit · 2017-18
  - Delhi · Gross Fiscal Deficit · 2016-17
  - Delhi · Gross Fiscal Deficit · 2015-16
  - Delhi · Gross Fiscal Deficit · 2014-15
  - Delhi · Gross Fiscal Deficit · 2013-14
  - Puducherry · Gross Fiscal Deficit · 2012-13
  - All India · Gross Fiscal Deficit · 2011-12

### 106. State · SDL Auction & Borrowing Tracker — OK
- Request: tier=state, feature=SDL Auction & Borrowing Tracker; HTTP 200, 109 ms, served=store, adapter=api, fallback=false
- Page claims: badge "none"; header freshness "updated 2 min ago"; source line "Updated 2 min ago · 67 records from rbi.org.in"; meta.status "LIVE · RBI PRESS RELEASES"
- Note: RBI press releases on State Government Securities (SDL) auctions: notices (amount to be raised, tenor, re-issue) and results (amount accepted, cut-off yield or price), one row per security. RBI's feed lists its latest ten releases; the store keeps every auction release it has seen, so the history st
- Row hosts: rbi.org.in 67
- Columns shown: RELEASE · STAGE · STATE · NOTIFIED (₹ CR) · ACCEPTED (₹ CR) · CUT-OFF YIELD % · CUT-OFF PRICE ₹; date columns: RELEASE; dated 67/67; newest 2026-10-14; oldest 2026-06-24; future-dated 0
- Empty >50% (first 50 rows): ACCEPTED (₹ CR)(45/50 empty); CUT-OFF YIELD %(45/50 empty); CUT-OFF PRICE ₹(48/50 empty); duplicate titles: 18 rows (e.g. andhra pradesh · auction notified · ₹1,000 crore ×2; gujarat · auction notified · ₹1,000 crore ×2; madhya pradesh · auction notified · ₹2,000 crore ×2); duplicate links: 63 rows
- Relevance: 15/15 judged on topic
- Sample:
  - <2026-10-15> Andhra Pradesh · auction notified · ₹1,000 crore
  - <2026-10-15> Jammu & Kashmir · auction notified · ₹800 crore
  - <2026-10-15> Maharashtra · auction notified · ₹1,500 crore
  - <2026-10-15> Punjab · auction notified · ₹700 crore
  - <2026-10-15> Rajasthan · auction notified · ₹1,000 crore
  - <2026-07-03> Bihar · auction notified · ₹1,200 crore
  - <2026-07-03> Himachal Pradesh · auction notified · ₹700 crore
  - <2026-07-03> Kerala · auction notified · ₹800 crore
  - <2026-07-03> Sikkim · auction notified · ₹200 crore
  - <2026-07-03> Uttar Pradesh · auction notified · ₹1,000 crore
  - <2026-07-03> West Bengal · auction notified · ₹2,200 crore
  - <2026-06-30> Punjab · auction result · ₹500 crore
  - <2026-06-30> Telangana · auction result · ₹2,000 crore
  - <2026-06-25> Assam · auction notified · ₹1,000 crore
  - <2026-06-25> Rajasthan · auction notified · ₹750 crore

### 109. State · NITI Aayog State Indices — OK
- Request: tier=state, feature=NITI Aayog State Indices; HTTP 200, 104 ms, served=store, adapter=register, kind=register, fallback=false, register
- Page claims: badge "none"; header freshness "register · as of 11 Dec 2025"; source line "Register · as of 11 Dec 2025 · 142 records from rbi.org.in"; meta.status "—"
- Note: RBI Handbook of Statistics on Indian States, 2024-25 edition (published 11 Dec 2025); state level. Table 106: State-wise Sustainable Development Goals (SDGs) Score: 142 figures. Source: NITI Aayog, Government of India. Stored register loaded from tmp/rbi-handbook/handbook-2024-25.json; not refreshed
- Row hosts: rbi.org.in 142
- Columns shown: STATE · INDICATOR · YEAR · VALUE · TABLE; date columns: none; dated 0/142; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 141 rows
- Relevance: 15/15 judged on topic
- Sample:
  - Andaman & Nicobar Islands · Sustainable Development Goals (SDGs) Score · 2023
  - Gujarat · Sustainable Development Goals (SDGs) Score · 2023
  - Madhya Pradesh · Sustainable Development Goals (SDGs) Score · 2023
  - Sikkim · Sustainable Development Goals (SDGs) Score · 2023
  - Andhra Pradesh · Sustainable Development Goals (SDGs) Score · 2020
  - Himachal Pradesh · Sustainable Development Goals (SDGs) Score · 2020
  - Manipur · Sustainable Development Goals (SDGs) Score · 2020
  - Telangana · Sustainable Development Goals (SDGs) Score · 2020
  - Assam · Sustainable Development Goals (SDGs) Score · 2019
  - Jharkhand · Sustainable Development Goals (SDGs) Score · 2019
  - Nagaland · Sustainable Development Goals (SDGs) Score · 2019
  - Uttarakhand · Sustainable Development Goals (SDGs) Score · 2019
  - Chhattisgarh · Sustainable Development Goals (SDGs) Score · 2018
  - Lakshadweep · Sustainable Development Goals (SDGs) Score · 2018
  - Punjab · Sustainable Development Goals (SDGs) Score · 2018

### 111. State · State Health & Nutrition Indicators — OK
- Request: tier=state, feature=District Health & Nutrition Indicators; HTTP 200, 160 ms, served=store, adapter=register, kind=register, fallback=false, register
- Page claims: badge "none"; header freshness "register · as of 11 Dec 2025"; source line "Register · as of 11 Dec 2025 · 490 records from rbi.org.in"; meta.status "—"
- Note: RBI Handbook of Statistics on Indian States, 2024-25 edition (published 11 Dec 2025); state level. Table 2: State-wise Birth Rate (Per Thousand): the newest 490 of its 694 figures: 14 whole years, 2010 to 2023; older years are on the table's page. Source: Sample Registration System (SRS) Bulletin, v
- Row hosts: rbi.org.in 490
- Columns shown: STATE · INDICATOR · YEAR · VALUE · UNIT · TABLE; date columns: none; dated 0/490; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 489 rows
- Relevance: 15/15 judged on topic
- Sample:
  - Andaman & Nicobar Islands · Birth Rate · 2023
  - Uttar Pradesh · Birth Rate · 2023
  - Tamil Nadu · Birth Rate · 2022
  - Punjab · Birth Rate · 2021
  - Mizoram · Birth Rate · 2020
  - Manipur · Birth Rate · 2019
  - Madhya Pradesh · Birth Rate · 2018
  - Karnataka · Birth Rate · 2017
  - Jammu & Kashmir · Birth Rate · 2016
  - Haryana · Birth Rate · 2015
  - Delhi · Birth Rate · 2014
  - Chandigarh · Birth Rate · 2013
  - Bihar · Birth Rate · 2012
  - Arunachal Pradesh · Birth Rate · 2011
  - Andhra Pradesh · Birth Rate · 2010

### 112. State · State Education Indicators — OK
- Request: tier=state, feature=District Education Indicators; HTTP 200, 167 ms, served=store, adapter=register, kind=register, fallback=false, register
- Page claims: badge "none"; header freshness "register · as of 11 Dec 2025"; source line "Register · as of 11 Dec 2025 · 444 records from rbi.org.in"; meta.status "—"
- Note: RBI Handbook of Statistics on Indian States, 2024-25 edition (published 11 Dec 2025); state level. Table 1: State-wise Gross Enrolment Ratio: the newest 444 of its 888 figures: 1 whole years, 2024-25 to 2024-25; older years are on the table's page. Source: Report on Unified District Information Syst
- Row hosts: rbi.org.in 444
- Columns shown: STATE · INDICATOR · YEAR · VALUE · TABLE; date columns: none; dated 0/444; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 443 rows
- Relevance: 15/15 judged on topic
- Sample:
  - Andaman & Nicobar Islands · Gross Enrolment Ratio · Foundational (Pre-Primary to Class II) · Male · 2024-25
  - Arunachal Pradesh · Gross Enrolment Ratio · Preparatory (Class III to Class V) · Total · 2024-25
  - Bihar · Gross Enrolment Ratio · Secondary (Class IX to XII) · Total · 2024-25
  - Dadra & Nagar Haveli and Daman & Diu · Gross Enrolment Ratio · Preparatory (Class III to Class V) · Female · 2
  - Goa · Gross Enrolment Ratio · Secondary (Class IX to XII) · Female · 2024-25
  - Himachal Pradesh · Gross Enrolment Ratio · Preparatory (Class III to Class V) · Female · 2024-25
  - Jharkhand · Gross Enrolment Ratio · Secondary (Class IX to XII) · Male · 2024-25
  - Ladakh · Gross Enrolment Ratio · Preparatory (Class III to Class V) · Male · 2024-25
  - Madhya Pradesh · Gross Enrolment Ratio · Middle (Class VI to Class VIII) · Total · 2024-25
  - Meghalaya · Gross Enrolment Ratio · Foundational (Pre-Primary to Class II) · Total · 2024-25
  - Nagaland · Gross Enrolment Ratio · Middle (Class VI to Class VIII) · Total · 2024-25
  - Punjab · Gross Enrolment Ratio · Foundational (Pre-Primary to Class II) · Female · 2024-25
  - Sikkim · Gross Enrolment Ratio · Middle (Class VI to Class VIII) · Female · 2024-25
  - Tripura · Gross Enrolment Ratio · Foundational (Pre-Primary to Class II) · Male · 2024-25
  - Uttarakhand · Gross Enrolment Ratio · Middle (Class VI to Class VIII) · Male · 2024-25

### 113. State · State Economic & Livelihood Indicators — OK
- Request: tier=state, feature=District Economic & Livelihood Indicators; HTTP 200, 129 ms, served=store, adapter=register, kind=register, fallback=false, register
- Page claims: badge "none"; header freshness "register · as of 11 Dec 2025"; source line "Register · as of 11 Dec 2025 · 429 records from rbi.org.in"; meta.status "—"
- Note: RBI Handbook of Statistics on Indian States, 2024-25 edition (published 11 Dec 2025); state level. Table 8: State-wise Unemployment Rate: Usual Status (Adjusted) (Rural) (Per Thousands): the newest 429 of its 1224 figures: 4 whole years, 2020-21 to 2023-24; older years are on the table's page. Sourc
- Row hosts: rbi.org.in 429
- Columns shown: STATE · INDICATOR · YEAR · VALUE · UNIT · TABLE; date columns: none; dated 0/429; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 428 rows
- Relevance: 15/15 judged on topic
- Sample:
  - Andhra Pradesh · Unemployment Rate: Usual Status (Adjusted) (Rural) · Rural Male · 2023-24
  - Uttar Pradesh · Unemployment Rate: Usual Status (Adjusted) (Rural) · Rural Male · 2023-24
  - Rajasthan · Unemployment Rate: Usual Status (Adjusted) (Rural) · Rural Female · 2023-24
  - Maharashtra · Unemployment Rate: Usual Status (Adjusted) (Rural) · Rural Overall · 2023-24
  - Himachal Pradesh · Unemployment Rate: Usual Status (Adjusted) (Rural) · Rural Male · 2022-23
  - Assam · Unemployment Rate: Usual Status (Adjusted) (Rural) · Rural Female · 2022-23
  - Andaman & Nicobar Islands · Unemployment Rate: Usual Status (Adjusted) (Rural) · Rural Female · 2022-23
  - Sikkim · Unemployment Rate: Usual Status (Adjusted) (Rural) · Rural Overall · 2022-23
  - Maharashtra · Unemployment Rate: Usual Status (Adjusted) (Rural) · Rural Male · 2021-22
  - Haryana · Unemployment Rate: Usual Status (Adjusted) (Rural) · Rural Female · 2021-22
  - Arunachal Pradesh · Unemployment Rate: Usual Status (Adjusted) (Rural) · Rural Overall · 2021-22
  - West Bengal · Unemployment Rate: Usual Status (Adjusted) (Rural) · Rural Overall · 2021-22
  - Rajasthan · Unemployment Rate: Usual Status (Adjusted) (Rural) · Rural Male · 2020-21
  - Madhya Pradesh · Unemployment Rate: Usual Status (Adjusted) (Rural) · Rural Female · 2020-21
  - Gujarat · Unemployment Rate: Usual Status (Adjusted) (Rural) · Rural Overall · 2020-21

### 114. State · State Agriculture & Rural Indicators — OK
- Request: tier=state, feature=District Agriculture & Rural Indicators; HTTP 200, 139 ms, served=store, adapter=register, kind=register, fallback=false, register
- Page claims: badge "none"; header freshness "register · as of 11 Dec 2025"; source line "Register · as of 11 Dec 2025 · 476 records from rbi.org.in"; meta.status "—"
- Note: RBI Handbook of Statistics on Indian States, 2024-25 edition (published 11 Dec 2025); state level. Table 53: State-wise Pattern of Land Use - Gross Sown Area (Thousand Hectares): the newest 476 of its 631 figures: 15 whole years, 2009-10 to 2023-24; older years are on the table's page. Source: Land 
- Row hosts: rbi.org.in 476
- Columns shown: STATE · INDICATOR · YEAR · VALUE · UNIT · TABLE; date columns: none; dated 0/476; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 475 rows
- Relevance: 15/15 judged on topic
- Sample:
  - Andhra Pradesh · Pattern of Land Use - Gross Sown Area · 2023-24
  - All India · Pattern of Land Use - Gross Sown Area · 2023-24
  - All India · Pattern of Land Use - Gross Sown Area · 2022-23
  - All India · Pattern of Land Use - Gross Sown Area · 2021-22
  - West Bengal · Pattern of Land Use - Gross Sown Area · 2020-21
  - West Bengal · Pattern of Land Use - Gross Sown Area · 2019-20
  - West Bengal · Pattern of Land Use - Gross Sown Area · 2018-19
  - West Bengal · Pattern of Land Use - Gross Sown Area · 2017-18
  - Uttarakhand · Pattern of Land Use - Gross Sown Area · 2016-17
  - Uttarakhand · Pattern of Land Use - Gross Sown Area · 2015-16
  - Uttarakhand · Pattern of Land Use - Gross Sown Area · 2014-15
  - Uttarakhand · Pattern of Land Use - Gross Sown Area · 2013-14
  - Uttarakhand · Pattern of Land Use - Gross Sown Area · 2012-13
  - West Bengal · Pattern of Land Use - Gross Sown Area · 2011-12
  - All India · Pattern of Land Use - Gross Sown Area · 2010-11

### 115. State · State Infrastructure & Connectivity — OK
- Request: tier=state, feature=District Infrastructure & Connectivity; HTTP 200, 126 ms, served=store, adapter=register, kind=register, fallback=false, register
- Page claims: badge "none"; header freshness "register · as of 11 Dec 2025"; source line "Register · as of 11 Dec 2025 · 487 records from rbi.org.in"; meta.status "—"
- Note: RBI Handbook of Statistics on Indian States, 2024-25 edition (published 11 Dec 2025); state level. Table 138: State-wise Per Capita Availability of Power: the newest 487 of its 722 figures: 14 whole years, 2011-12 to 2024-25; older years are on the table's page. Source: Central Electricity Authority
- Row hosts: rbi.org.in 487
- Columns shown: STATE · INDICATOR · YEAR · VALUE · TABLE; date columns: none; dated 0/487; newest —; oldest —; future-dated 0
- Empty >50% (first 50 rows): none; duplicate titles: 0 rows; duplicate links: 486 rows
- Relevance: 15/15 judged on topic
- Sample:
  - Andaman & Nicobar Islands · Per Capita Availability of Power · Kilowatt-Hour · 2024-25
  - Uttarakhand · Per Capita Availability of Power · Kilowatt-Hour · 2024-25
  - Telangana · Per Capita Availability of Power · Kilowatt-Hour · 2023-24
  - Sikkim · Per Capita Availability of Power · Kilowatt-Hour · 2022-23
  - Puducherry · Per Capita Availability of Power · Kilowatt-Hour · 2021-22
  - Nagaland · Per Capita Availability of Power · Kilowatt-Hour · 2020-21
  - Manipur · Per Capita Availability of Power · Kilowatt-Hour · 2019-20
  - Madhya Pradesh · Per Capita Availability of Power · Kilowatt-Hour · 2018-19
  - Karnataka · Per Capita Availability of Power · Kilowatt-Hour · 2017-18
  - Jammu & Kashmir · Per Capita Availability of Power · Kilowatt-Hour · 2016-17
  - Gujarat · Per Capita Availability of Power · Kilowatt-Hour · 2015-16
  - Delhi · Per Capita Availability of Power · Kilowatt-Hour · 2014-15
  - Bihar · Per Capita Availability of Power · Kilowatt-Hour · 2013-14
  - Assam · Per Capita Availability of Power · Kilowatt-Hour · 2012-13
  - Andhra Pradesh · Per Capita Availability of Power · Kilowatt-Hour · 2011-12
