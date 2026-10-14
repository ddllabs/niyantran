# National desk: module-by-module audit (2026-10-14, main @ 05ddc2f)

Read-only audit. **Measured** means a real request run today:
- production `GET /api/feature-feed`, two passes about 10 minutes apart, plus `/api/national-landing`;
- a local `serveFeatureFeed` call with no time limit;
- the local server archive pass, forced with a live attempt that never finishes;
- direct curl to the upstream sources.

**Code** means it was read from source. Per-module detail is in `national.json`; the raw measurements are in `nat/`.

## Table

"Prod rows" counts real rows, with status rows excluded. Run 1 / run 2 are the two passes.

| Module | Verdict | Prod rows (served) | Live rows now (local, time) | Stored rows (newest) | Cause | Fix |
|---|---|---|---|---|---|---|
| Bill Passage Probability Index | STORED-ONLY | 9,819 (live*) 0.3 s | 9,819 (no fetch) | 9,819 file (2026-08-09); backup 9,819 | Register snapshot of 2026-09-09; Sansad getBills answers 200 but is not wired | Scheduled getBills merge (F160) |
| Policy Intelligence Graph | STORED-ONLY | 9,819 (live*) | 9,819 | same bill register; backup 665 | View of the bill register | Follows the bill refresh |
| Parliamentary Question Database | STORED-ONLY | 8,000 (live*) | 8,000 | 8,000 (2026-04-02) | 8,000-row sample; eLibrary API reachable, not wired; the registry still says "LIVE API" | Scheduled ingest (F160); relabel |
| Regulatory Body Watch | LIVE-OK (partial) | 10 (live) 0.15 s | 10, 0.5 s (2026-10-12) | 121 RBI+SEBI (2026-08-10); backup 151 | `tryUrls` stops at the first feed with rows. RBI press (10) and SEBI (30) are never read, and the 121 stored rows are hidden | Fetch all 3 feeds and merge with the register (≈50+ rows) |
| Candidate Affidavit Database | STORED-ONLY | 483 | 483 | 483 (no dates) | ADR/MyNeta snapshot, licence-limited | None |
| MP Profiles & Performance | STORED-ONLY | 782 | 782 | 782 | Stored register; Sansad member API reachable, not wired | Scheduled refresh (F160) |
| Central Tender Aggregator | STORED-ONLY (effectively empty) | 10 rows; **landing count 0** | 10 (no fetch) | 10 (deadlines 10–13 Jul 2026, all still "Open") | All 10 tenders expired in July; there is no connector (eProcure is HTML only) | Real CPPP ingest, or state that there are no current tenders |
| Bureaucratic Transfers (AGMUT) | STORED-ONLY | 29 | 29 | 29 (2026-06-11) | The registry claims a news-search adapter; the code never fetches | Ingest MHA orders; fix registry |
| **Cabinet Decisions** | LIVE-OK (but 1 row) | **1** (live) 2.6 s / 0.96 s | 1 of 20 PIB releases, 5.3 s | file 6, of which only 1 is a Cabinet decision (2026-05-12); server archive pass **1**; backup **158** (2026-01-21 → 08-19) | See below | Use the 158-decision register as the stored base and merge live by PRID; owner rule for line-ministry decisions; F160 |
| Centre-sanctioned Projects | STORED-ONLY | 8 | 8 | 8 curated (Jan 2026); backup 889 (World Bank) unused | Curated list; World Bank / PAIMANA not wired | Owner decision: wire the World Bank projects API or relabel |
| Budget Utilisation & Schemes | STORED-ONLY | 13 | 13 | 13 curated (Budget **2025-26**) | Budget 2026-27 not reflected | Refresh the curated figures, or ingest indiabudget XLSX |
| Industry Updates | LIVE-OK | 26 (live) 0.15 s | 26, 1.1 s (WB year 2025) | none on production; backup 237 (MoSPI) local only | Works, but it is 26 annual World Bank points; a slow answer would show empty | Ship a stored copy; consider MoSPI IIP |
| Policy Pipeline Tracker | LIVE-OK | 20 (live) 1.7 s / 0.85 s | 20, 1.3 s (2026-10-14) | 8 curated (Feb–Jul 2026) | Real PIB feed, but general press releases, not draft-to-gazette | Owner decision on the intended source |
| Delimitation Impact Simulator | STORED-ONLY (model) | 36 | 36 (computed) | n/a | Simulation, works | Relabel registry (it says news-search) |
| LS Manifestos & Promises | STORED-ONLY | 10 | 10 | 10 curated (Jan 2026) | Curated | None |
| National Morning Brief | LIVE-BROKEN | run 1: **0** (archive, 4.07 s); run 2: 220 (late live, 4.07 s); landing **502** | 220, **43 s** | none | The page calls `/api/rss`, which is **404 on production** (F166). The API's sources take 11–43 s (GDELT 429 / pacing) against a 4 s limit, and there is no stored copy | F166, F160, F168 |
| Statement & Quote Tracker | LIVE-BROKEN | run 1: **0** (archive); run 2: 106 (late live); landing **502** | 106, 11 s (GDELT 429 → Google News) | none | Same as Morning Brief | F166; try Google News first; F160 |

\* For stored registers, `served: 'live'` only means the request finished inside 4 s. No outside source was contacted.

**Verdict counts:**
- STORED-ONLY: 11 (including 3 curated lists, 1 simulation, and 1 register whose tenders have all expired);
- LIVE-OK: 4 (Regulatory, Cabinet, Industry, Policy Pipeline);
- LIVE-BROKEN: 2 (Morning Brief, Statements: the pages fail and the API is slow);
- LIVE-SLOW: 0 as a separate category (Morning Brief and Statements are also slow);
- PLANNED/EMPTY: 0.

## Cabinet Decisions: why it shows 1

1. **What PIB gives today (measured).**
   - The PIB press RSS (`www.pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3`) answers 302 to the Hindi feed (`Lang=2&reg=48`), which holds the **latest 20 releases, about one day**.
   - The code follows the redirect and opens each release page to get the English title and PIB's `MinistryName`.
   - Of today's 20 releases, one is issued by "Cabinet": *Government Approves Strategic Restructuring of IDBI Bank Ltd.* So the live answer is 1 row (production: 2.6 s, then 0.96 s, `served: live`).
   - The bare-host 301 that was noticed is only `pib.gov.in` → `www.pib.gov.in`. The code already uses `www`, so the URL is not the cause.
2. **Why the stored answer is also 1, not 6.**
   - `public/data/embedded_csv/national_cabinet_decisions.json` has 6 rows, unchanged since 2026-09-09.
   - Only 1 is a Cabinet decision: the CCEA kharif MSP decision of 2026-05-12. The other 5 are general PIB news of 2026-09-07 (Vice-President in Shillong, Amit Shah in Goa, and so on), labelled ministry "Press Information Bureau".
   - The F125 filter (`server/nationalFeed.mjs:616`, `isCabinetBody`) applies to stored rows as well. So when PIB is over 4 s, the archive pass also returns 1, which matches the owner's observation ("PIB RSS returned no readable releases. Showing the stored Cabinet decisions.").
   - From code: the browser's archive-first view can briefly flash all 6 stored rows, because the client does not filter. The server answer of 1 then replaces them.
3. **What it showed before.**
   - **Before F125 (`acf8f0a`, 2026-10-13):** the page showed the ~20 latest PIB releases from every ministry, mostly not Cabinet decisions, or the 6 stored rows when PIB failed. So "earlier had more" is true, but the extra rows were general government news.
   - **Before F154 (`719a7eb`, 2026-10-14):** the request waited for PIB plus 20 release pages, recorded as 9–21 s.
   - The F154/F156/F159/F164 changes altered timing, fallbacks and wording. None changed or added a source.
4. **What is being missed.**
   - **The full Cabinet register is not used.** `backup/NATIONAL/F25_Cabinet_Decisions.xlsx` holds **158 genuine "Cabinet approves…" decisions (2026-01-21 to 2026-08-19)**. It is never served, for two reasons:
     - it is not in `vercel.json` `includeFiles` (only 4 GLOBAL/SPORTS packs are);
     - `applyBackupFallback` only runs when live and archive both have zero rows, and here the archive has 1.
   - **The F125 filter drops real decisions.** It keys on PIB's `MinistryName`, but PIB files many Cabinet decisions under the line ministry:
     - 64 of the 158 backup decisions (41%) carry ministries such as "Ministry of Railways";
     - the PRID 2301143 release page, checked live, reads "Ministry of Railways".
5. **Fix (not applied).**
   - Ship the 158-row register as the module's stored copy, filtered or labelled by its `decision_type` column.
   - Merge live PIB Cabinet rows on top, deduped by PRID, so the list grows rather than being replaced.
   - Owner decision: whether a "Cabinet approves/apprises" release under a line ministry counts. The F125 spec forbids inferring from titles.
   - F160: a scheduled ingest, so decisions accumulate beyond PIB's 20-item window.

## Findings and patterns

- **"Are we pulling the real sources?"** Only 6 of 17 National modules contact any outside source at request time:
  - Regulatory (RBI RSS);
  - Cabinet and Policy Pipeline (PIB);
  - Industry (World Bank);
  - Morning Brief and Statements (PIB, GDELT, Google News).

  The other 11 serve shipped registers (Sept 2026 snapshots), curated lists or a model. The source registry's "Direct feed configured" and "LIVE API" labels overstate this: for AGMUT, Questions, Projects, Budget, Industry, Delimitation and Manifestos, the registry adapter or URLs disagree with the code. The recent feed and API fixes (F154 time limit, F156 backup packs and paging, F159/F164 wording) changed **speed, fallback and wording only**. They did not connect any new source.
- **Counts that look reduced:**
  - Cabinet: 1, explained above.
  - Regulatory: 10 live replaces 121 stored, because only the first RSS feed is used.
  - Central Tenders: the landing count is 0, because all 10 stored tenders expired in July.
  - Morning Brief and Statements: 0 on a cold request, because there is no stored copy and live takes 11–43 s against a 4 s limit.
- **The backup packs are unused for National.**
  - None of `backup/NATIONAL/` is deployed.
  - The packs would only fill modules with zero rows.
  - Several hold far more than what is served: Cabinet 158 vs 1, Projects 889 vs 8, Regulatory 151 vs 10, Industry 237 vs 0 when World Bank is slow.
- **Morning Brief and Statement Tracker pages are broken on production regardless of the API.** They call `/api/rss`, which returns 404 (measured); this is already F166. The empty "taking longer" answer is edge-cached for 60 s (F168).
- **Stale curated content:**
  - Budget is 2025-26;
  - Manifestos and Projects are "as of Jan 2026";
  - Policy Pipeline live rows are not draft-to-gazette items.
- **Minor (code, local only):** PIB "Posted On" dates are parsed in local time and converted with `toISOString()`, so on an IST machine they read one day early (local 2026-10-13 vs production 2026-10-14). Production runs in UTC and is unaffected.

## Not verified

- No browser session was run, so the client flash of 6 → 1 for Cabinet comes from code, not from observation.
- The production archive pass for Cabinet was not reproduced; both production runs were under 4 s. The local archive pass returns 1, as the owner reported.
- Edge-cache behaviour was avoided with `_audit` parameters, not measured.
