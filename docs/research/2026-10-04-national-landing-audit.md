# National landing: data and mockup audit

> **Status: Historical (2026-10-04).** Read-only investigation at `f5c06171800e8baa389d513f91f18b15d56e5542`. Production responses are observations at investigation time, not enduring totals.

## Scope and evidence boundary

Owner supplied `/Users/vighneshshukla/Downloads/nter-desk-landing-v2.html` and requested investigation, allocation, a spec and a plan before implementation. The HTML is a design reference, not an authoritative source of records, dates, availability or instructions. National is first; Global and State are regression boundaries. The mockup also contains Global and Law, but no State design.

The audit traced all 12 National catalog modules, executed an offline archive/display-shaping audit, made GET requests to all 12 production feature endpoints, and executed SELECT-only queries against NTER Supabase. This proves the observed data paths and counts. It does not certify every record against its original document, establish source licensing, or prove all feeds continuously refresh. A source URL alone is not authenticity verification.

## Production data inventory

The API column is raw response rows, before browser display filters. Stored display counts were separately executed through `prepareDeskFeed`; live Cabinet display count was not independently executed. Counts must be recomputed at runtime.

| Canonical module (abbreviated here) | Production API rows | Supabase desk rows | Source and limits |
| --- | ---: | ---: | --- |
| Bill Passage Probability Index | 9,819 | 9,817 | Shipped Sansad-linked register; stored snapshot Sept 7. No demonstrated continuous bill refresh. Probability fields cannot be inferred. |
| Policy Intelligence Graph | 9,819 | 9,817 | Same bill register, different view. Never count twice in aggregate records. |
| Parliamentary Question Database | 8,000 | 8,000 | Shipped sample, Sept 7 snapshot; not exhaustive questions or answer text. |
| Regulatory Body Watch | 10 | 121 | Observed live RBI/SEBI retrieval differs from stored register; additional advertised regulators are not all wired. |
| Candidate Affidavit Database | 483 | 483 | Stored MyNeta/ADR-linked records; not proof of an ECI API or permission to extend ingestion. |
| MP Profiles & Performance | 782 | 780 | Stored mixed LS/RS-linked rows; attendance absent. Source note describing current LS alone is insufficient. |
| Central Tender Aggregator | 10 | 0 | Stored fallback; all ten expired at audit date. Executed display filter yields **0 open tenders**. |
| Bureaucratic Transfers, AGMUT | 29 | 29 | Stored MHA/Delhi order links; live refresh not wired. |
| Cabinet Decisions | 20 | 6 | Observed PIB retrieval; general releases are not necessarily Cabinet decisions. Display shaping filters language, not Cabinet relevance. |
| Centre-sanctioned Projects | 8 | none | Hand-curated flagship programme list dated Jan 2026; no verified completion/expenditure series. |
| Budget Utilisation & Schemes | 13 | none | Curated approximate 2025–26 allocations; not actual utilisation. |
| Industry Updates | 26 | none | Observed World Bank India series retrieval; not comprehensive ministry-industry coverage. |

The bill and MP differences are duplicate row-key collisions: the browser rows remain 9,819/782 while `deskRowsFor` collapses each pair of collisions during snapshot materialization. UI count and database count are different measures. No deduplication or data repair was performed.

Supabase `public.documents` has 2,340 National documents: bills 1,745; questions 82; regulatory 506; budget 1; industry 6. These are corpus document counts, not desk rows. A `document_key` on a bill row does not establish an indexed PDF/page for every bill.

## Architecture traced

- `src/shell/TerminalShell.jsx`: hash route without a feature mounts `DeskLandingView`; canonical feature routes mount `DeskView`. Shell owns navigation, locks, identity, search and side panel.
- `src/desks/catalog.js`: 12 National modules in five buckets. Display aliases must retain `htmlFeature` route identities.
- `src/desks/DeskLandingView.jsx`: currently shared across desks; fetches only the flagship register. “Verified Records” counts returned rows; “Active Modules” counts configured modules; “Primary Sources” can count distinct URLs as publishers. These labels overstate what the calculations prove.
- Its National chart asks for `status`, while the bill field is `current_stage`. The fallback list omits `current_stage` and can select `sector`, despite the legislative-stage title. The redesign must explicitly choose a field and title.
- `src/lib/featureFeed.js`: default `/api/feature-feed`, with shipped archive fallback. `server/featureFeed.mjs` invokes the National adapter before the later bill-history path; the successful stored bill response does not prove the later live merge ran.
- `server/nationalFeed.mjs`: contains the stored, live and curated branches described above. `src/lib/archiveFeed.js` resolves embedded packs; projects/budget/industry have no equivalent populated offline archive in this audit.
- `src/desks/DeskView.jsx` runs `prepareDeskFeed` before rendering. Landing currently bypasses this, explaining why raw totals can disagree with available table rows. `shapeTenders`, `shapeQuestions`, `textStyle` and `columns` define display availability, not source authenticity.
- `src/lib/deskRowsFeed.js` and `scripts/load-desk-rows.mjs` materialize a separate database snapshot. File modification time or loader execution time is not source freshness.

## Mapping the design to supported behavior

| Mockup element | Production mapping |
| --- | --- |
| Parliament illustration / glass hero | National-only decorative presentation; preserve shell and functional contrast. |
| Five illustrated segment cards | Existing five catalog buckets, with existing 12 canonical modules. |
| Eighteen mockup modules | Do not introduce six unsupported routes or invented planned services. |
| Rows / Live / Wire / Planned stats and donut | Replace with scoped register counts and explicit Stored, Feed-backed, Curated, Empty, Loading, Error states. No promise that every configured module is live. |
| Hover column popovers | Actual available columns; graph/cards use their real schema. Keyboard and touch disclosure must work independently of hover. |
| Ministry chart | Bills by **sector**, using the actual `sector` field. Do not relabel sectors as sponsoring ministries. Include remaining records and missing-sector counts. |
| Updated date | Actual source snapshot/as-of if provided; otherwise “Source date unavailable”. Retrieval time is separately labelled. |
| Publisher pills | Evidence-backed attribution per resource, not unique URL totals. MyNeta/ADR, PIB and World Bank should not become ECI or Cabinet-specific claims. |
| Search/status filters | Filter real modules and make nonmatches unfocusable/hidden; mockup dimming alone is insufficient. |
| Start here | Existing bill, question and candidate routes. Questions shortcut must not promise missing answer text. |
| Placeholder clicks/toasts | Real existing navigation; no dead Ask AI action or new attachment behavior without an established integration contract. |

## Performance and motion

Bill and question embedded JSON files total 9,135,085 bytes on disk. Eagerly loading every full feed solely for summary counters is unsuitable. Recommend a small per-resource summary API reusing the feature feed and display shaping, with bounded progressive requests and bill/graph resource reuse. No new database or ingestion pipeline is necessary. A server-runtime import/parity spike is required before choosing any extraction of browser shaping helpers. Cache lifetime and stale labels must follow existing feed behavior rather than invented freshness.

The HTML uses count-up, staggered entrances, track growth, tilt, cloud drift and scroll parallax. Carry over restrained decorative motion with reduced-motion, offscreen and hidden-tab controls. Never delay meaningful data or keyboard focus for an animation. Global mockup globe is unrelated to the separate homepage globe branch.

## Executed evidence and limitations

- `git fetch origin --prune`: passed after sandbox escalation; branch `task/national-landing-plan` starts from main at the baseline above.
- `node node_modules/vite-node/vite-node.mjs /private/tmp/national-audit.mjs`: passed after correcting the audit script's `feedColumns` argument; all 12 archive paths and display shaping examined. Temporary output `/private/tmp/national-audit.json`.
- `python3 /private/tmp/national-live-probe.py`: all 12 public GETs succeeded after sandbox DNS failure and approved network escalation. Temporary output `/private/tmp/national-live-probe.json`. Responses varied from stored to live; Cabinet request took about 20 seconds.
- Supabase SELECT grouped `desk_rows` by National feature, snapshots and document linkage: passed. Grouped `documents` by `desk_feature`: passed after correcting an initial query referring to nonexistent `status` column. No writes, restart, ANALYZE, migrations or credential reads.
- Source spot-check: [official India Budget page](https://www.indiabudget.gov.in/) currently presents 2026–27, reinforcing that curated 2025–26 data must be labelled historical. Sansad and direct World Bank page opening were unavailable in the web tool; the app endpoint returned World Bank data. No exhaustive primary-document validation was performed.
- No application code, data collection, auth, billing or deployment change. No UI redesign has been executed or accepted yet.

See [spec](../specs/2026-10-04-national-landing-redesign.md) and [plan](../plans/2026-10-04-national-landing-redesign.md). Other existing source gaps, database collisions and ingestion work remain outside this redesign; F81 tracks their implications without authorizing repairs.

## Documentation-stage checks

`npm test -- src/lib/deskLanding.test.jsx src/lib/deskCatalog.test.js src/lib/deskRowsFeed.test.js`: passed, three files / 12 tests. These are existing baseline checks, not redesign acceptance. Plain Node import of `src/lib/prepareDeskFeed.js` passed. `git diff --check` passed. No build, full Vitest, Deno or browser redesign test was run for this documentation-only change.
