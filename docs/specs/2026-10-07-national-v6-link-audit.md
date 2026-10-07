# National v6 popup and destination audit

> **Status: Living.** Local audit and fixes authorized by the owner on 2026-10-07. No publication or authentication changes.

F88 acceptance subtask. Trace every National sector/module/popup through its canonical terminal route; verify the directory, source and chart links. The layout-only preview reloads the real app at a canonical hash; a logged-out app renders MarketingSite even with a valid module hash. Preserve authentication and entitlement gates. Explain this in the preview instead of claiming authenticated end-to-end acceptance.

Fix scope: shared frame terminal anchors and tests, National summary projection/API adapter/loader and their tests where popup metadata misdescribes a workspace, local ignored preview clarification, this record and F88. Do not modify specialized workspace data, provider behavior, billing or auth. Exact canonical routes must survive display aliases, punctuation and URL encoding. Every module CTA must expose its target as a hyperlink and normal in-app clicks must retain shell callbacks.

Confirmed source audit: Delimitation server and workspace share allocateSeats(753), Manifestos share UNION_PROMISES, and Morning Brief/Statements have equivalent feed families with independent retrieval. The initial suspicion of unrelated feeds was rejected after following server/nationalFeed.mjs. Correct stale Delimitation/Manifesto limitations and source-mode labels; preserve exact existing data and disclose independent live snapshots. Preserve validated unavailable metadata on HTTP502 while rejecting malformed/mismatched envelopes.

Ordered work: reproduce preview handoff; independently audit17 identities; write failing canonical-link and summary-parity/HTTP502 guards; implement focused fixes; execute all17 popup/URL handoffs, directory destinations, chart and source link inventory; focused tests, full Vitest/Deno for src/lib changes, lint/build/router import/diff check; record per-module evidence. Signed-in shell verification remains pending if no signed-in session is available. Static source URLs can be inventoried without claiming remote availability.


## Executed audit and fixes

All17 browser popup selections produced matching card title/dialog heading/canonical href/callback. These were actual components with local summaries, using an ignored callback-observation harness to avoid repeatedly reloading live feeds. Every href round-tripped through the actual resolver with the exact National feature. This proves dispatch identity, not signed-in workspace rendering. The initial unrelated-source suspicion was rejected by following server/nationalFeed.mjs: shared allocateSeats/UNION_PROMISES and equivalent live reporting families are present.

| Popup | Expected workspace | Canonical route and callback |
|---|---|---|
| Bill Passage Probability Index | Bill register table | Exact match; `/national/Bill%20Passage%20Probability%20Index` |
| Policy Intelligence Graph | PolicyGraphDesk | Exact match; `/national/Policy%20Intelligence%20Graph` |
| Parliamentary Question Database | Question register table | Exact match; `/national/Parliamentary%20Question%20Database` |
| Policy Pipeline Tracker | Policy pipeline table | Exact match; `/national/Policy%20Pipeline%20Tracker%20(Draft-to-Gazette)` |
| Regulatory Body Watch | Regulatory table | Exact match; `/national/Regulatory%20Body%20Watch%20(RBI%2FSEBI%2FTRAI%2FCCI)` |
| Candidate Affidavit Database | Candidate table | Exact match; `/national/Candidate%20Affidavit%20Database%20(Structured%20%2B%20API)` |
| Delimitation Impact Simulator | DelimitationDesk | Exact match; `/national/Delimitation%20Impact%20Simulator` |
| LS Manifestos & Promises | ManifestosDesk | Exact match; `/national/LS%20Manifestos%20%26%20Promises%20Tracker` |
| MP Profiles & Performance | MpCardsDesk | Exact match; `/national/MP%20Profiles%20%26%20Performance%20(MPLAD%2C%20attendance%2C%20debates)` |
| National Morning Brief | MorningBriefDesk | Exact match; `/national/National%20Morning%20Brief%20(Auto-digest)` |
| Statements & Quote Tracker | StatementsDesk | Exact match; `/national/Statement%20%26%20Quote%20Tracker%20with%20Contradiction%20Detection` |
| Cabinet Decisions | Cabinet table | Exact match; `/national/Cabinet%20Decisions` |
| Central Tender Aggregator | Tender table | Exact match; `/national/Central%20Tender%20Aggregator%20%2B%20Constituency%20Filter` |
| Bureaucratic Transfers (AGMUT) | Transfer table | Exact match; `/national/Bureaucratic%20Transfers%20%E2%80%94%20AGMUT%20Cadre` |
| Centre-Sanctioned Projects | ProjectsDesk | Exact match; `/national/Centre-sanctioned%20Projects%20%26%20Completion%20Rate` |
| Budget Utilisation & Schemes | BudgetDesk | Exact match; `/national/Budget%20Utilisation%20%26%20Schemes` |
| Industry Updates (Ministry Data) | IndustryDesk | Exact match; `/national/Industry%20Updates%20(Ministry%20Data)` |

Nine All sections buttons emitted their exact intended desk IDs (Home, Global, National, State, Law, Economics, Carbon, Sports, Entertainment). Existing onDesk/resolver remains responsible for access and canonical hashes. View data opened Bills by sector with real stages and no external link; bars share that same dialog callback. Source anchors remained explicit HTTP/HTTPS external references with noopener/noreferrer. Credits remains the local copied credits asset.

Homepage reproduction: actual preview bill popup action loaded `/#/national/Bill%20Passage%20Probability%20Index` while the application rendered MarketingSite with Sign in. App.jsx deliberately gates terminal rendering on the session. After fixes the actual Projects hyperlink also navigated to its exact canonical app URL. No auth/session bypass or credential inspection. Authenticated workspace/Back and access-policy checks remain pending owner local sign-in; requested through the asynchronous question.

Fixed: inspectable canonical terminal hyperlinks (normal click preserves shell callbacks, modified click uses the browser); valid HTTP502 unavailable metadata preserved after strict envelope validation; Delimitation labeled illustrative simulation/projection outputs, its inherited unrelated news-search links removed; Manifestos labeled curated promises rather than news; Morning Brief/Statements explain independent live retrieval and person scope; Projects fields now Programme/Domain/Verifiable status/Activity. Source data and specialized workspaces unchanged. The ignored preview now clearly states that terminal links require sign-in on this host.

Guards failed before each fix: missing terminal href; discarded HTTP502 explanation; simulator/manifesto wrong modes; programme field omissions; unrelated Delimitation source links. Restored checks passed. Independent read-only final review reported no required findings.

## External source HTTP checks

18 unique source URLs inventoried from the settled browser popups. HEAD checked status/redirects;403/405/timeouts or ambiguous redirects received a normal GET follow-up. No TLS checks bypassed; no bodies stored. A successful HTTP response does not prove the underlying data is exhaustive/current. Live feed counts and links can change with subsequent retrieval.

| Source target | Observed result |
|---|---|
| `https://elibrary.sansad.in/` | 200 |
| `https://sansad.in/api_rs/legislation/getBills?page=1&size=100&sortOn=billIntroducedDate&sortBy=desc` | 200 |
| `https://www.rbi.org.in/notifications_rss.xml` | 200 |
| `https://www.rbi.org.in/pressreleases_rss.xml` | 200 |
| `https://www.sebi.gov.in/sebirss.xml` | 200 |
| `https://manifesto.inc.in/` | 200 |
| `https://sansad.in/api_ls/member?page=1&size=100` | 200 |
| `https://news.google.com/rss/search?q=%22Narendra%20Modi%22%20India&hl=en-IN&gl=IN&ceid=IN:en` | 200 |
| `https://dataverse.harvard.edu/api/datasets/:persistentId/?persistentId=doi:10.7910/DVN/26863` | 200 |
| `https://eprocure.gov.in/epublish/app?page=FrontEndTendersByOrganisation&service=page` | 500 |
| `https://mha.gov.in/` | 200 |
| `https://services.delhi.gov.in/orders/378` | 200 |
| `https://ipm.mospi.gov.in/` | CERT_HAS_EXPIRED |
| `https://www.indiabudget.gov.in/` | 200 |
| `https://api.worldbank.org/v2/country/IND/indicator/NV.IND.MANF.ZS?format=json&date=2000:2030&per_page=100` | 200 |
| `https://api.worldbank.org/v2/country/IND/indicator/NV.IND.TOTL.ZS?format=json&date=2000:2030&per_page=100` | 200 |
| `https://www.bjp.org/manifesto` | 200 |
| `https://api.gdeltproject.org/api/v2/doc/doc?query=%22Narendra%20Modi%22%20sourcecountry%3AIN&mode=artlist&format=json&sort=datedesc&timespan=3d&maxrecords=40` | 429 |

15 targets responded200. Procurement returned500; GDELT429; IPM/MOSPI failed with CERT_HAS_EXPIRED. These are retained as source-integration follow-up F89 rather than silently replacing authoritative/source-registry targets with guessed alternatives. MHA redirected to the Hindi government site; it was not a National/Home route.

## Verification and remaining limits

- `npm test -- src/desks/landing/DeskLandingFrame.test.jsx src/desks/useNationalLanding.test.js src/lib/nationalLandingSummary.test.js src/lib/nationalLandingApi.test.js`:28 passed after initial fixes. Final full `npm test`:152 files/2183 passed after source-link guard/fix.
- `deno test -A --config supabase/functions/deno.json supabase/functions`:862 passed,0 failed.
- `npm run lint`, `npm run build`, router import and `git diff --check`:passed. Existing deskBrief static/dynamic import and >500kB chunk warnings remain. No standalone type-check.
- Browser evidence:17 module callbacks,9 directory callbacks, chart dialog, actual bill/Projects URL handoffs, actual corrected Projects metadata. Screenshot `/private/tmp/national-v6-popup-fixed.jpg` is transient. Callback audit fixture is not a production/session bypass.
- Signed-in terminal screens and Back remain unverified; do not claim all17 authenticated destinations have been exercised. Main/production remain unchanged; local task branch only.
