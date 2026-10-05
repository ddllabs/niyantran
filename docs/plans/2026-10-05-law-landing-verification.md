# Law landing verification — 2026-10-05

> **Status: Historical (2026-10-05).** Local execution evidence; not owner acceptance or publication.

## Implementation
Branch task/law-landing-redesign based on9eb4637 preserves National/Global prerequisites. Law-only dispatcher, prepared projection and canonical local/Vercel GET route; three-worker45s client loading with cancellation/retry. Original reference Supreme Court backdrop (BX250), court/bench/peace/files geometry and palettes, sweep/gavel/clock/file motion, shared hover/parallax/filters/disclosures and real tier chart. Shared ModuleRow adds optional count unit; existing desks keep records by default.

## Source audit
Read-only local feature-feed GETs executed for all12 canonical judiciary modules.220 Supreme Court orders plus the same220 topic view;434 NCLT/IBBI entries; nine reporting feeds (raw58–100 entries at audit). Landing actual execution showed1477 heterogeneous source entries and11/11 measured resources; shared order table counted once. Reporting identity and unavailable official dockets/analytics are visible; source dates remain unavailable unless explicitly supplied. News counts vary by retrieval. No dataset or provider changes. Broader query relevance is F84.

## Executed checks
- npm test:148 files /2152 tests passed,26.28s.
- deno test -A --config supabase/functions/deno.json supabase/functions:862 passed0 failed,7s.
- npm run lint:0 errors/warnings.
- npm run build:passed6.75s; existing deskBrief static/dynamic import and >500KB chunk warnings remain.
- node -e "import('./api/router.js').then(() => console.log('router import ok'))":passed.
- git diff --check:passed.
- Focused Law projection/API/loader/presentation:11 passed. National/Global presentation passed in the full suite.
- Guard defect injections: remove shared-resource key -> dedup guard fails; report all news as entries -> identity guard fails; turn error into0 -> unknown guard fails. Restored source and four projection tests passed. Initial missing-module red run is not relied upon as behavioral proof.

## Signed-in browser execution
Actual app at http://127.0.0.1:5174/#/law, no mock feeds. All12 .nl-open callbacks produced exact canonical routes and their workspace headings; Back returned landing. This proves routing, not every workspace feature or PDF usability. Search insolvency gives1 match/11 inert; Stored filter3 matches. Coverage disclosure showed populated fields, reporting limitations and source links; Escape closed it and restored module focus. All12 source summaries displayed counts/units. Responsive320/768/1440 document width equals viewport width, no horizontal overflow. Light/dark render and Hindi desk label verified, restored English/light/default viewport. Pause sets root motionoff and all seven gavel/clock/file animations paused; resume restores motionon. Offscreen backdrop paused the gavel; lower card entrance finished when visible. Console error inspection returned[].

## Review and limits
Correctness: canonical identity, shared dedup, reporting/count semantics and failure states guarded. Architecture: reuses shared rows, controls and motion; no new dependencies or provider interfaces. Security: fixed whitelist, GET-only and safe HTTP(S) source links; no secrets/data mutations. Performance: bounded projection and request concurrency, existing motion lifecycle reused. Readability follows existing National/Global composition.

Original vector/motion mapping was inspected in source and actual UI. Owner visual approval remains pending; exact pixel equivalence is not claimed. Native reduced-motion/hidden-tab/touch verification remains pending because the prior native-control attempts could not apply emulation; no successful native execution is implied by shared lifecycle unit tests. Publication, main integration, State and all provider/docket fixes excluded.
