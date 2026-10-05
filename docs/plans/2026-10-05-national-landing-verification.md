# National landing: local verification

> **Status: Historical (2026-10-05).** Executed evidence for F81 on `task/national-landing-redesign`, based on main `f5c0617`. Local implementation is reviewable; this record does not assert production deployment or owner acceptance.

## Implemented scope

National-only dispatcher, Parliament hero and five static SVG group illustrations, all 12 canonical module buttons, module search/source-mode filtering, keyboard-native coverage disclosures, bill-sector chart, light/dark and responsive styling. New summary projection uses the existing `prepareDeskFeed`; existing feed adapters and local backup behavior are reused. GET-only summary endpoints are wired into Vite and the Vercel router. Three concurrent client requests, bill/graph deduplication, per-source error/empty states, cancellation and retry preserve progressive rendering. Summary responses contain no register rows. No new dependencies, data ingestion, auth/billing/database changes, Global/State redesign or publication.

## Commands and outcomes

- `npm test`: 137 files, 2,116 tests passed on final code.
- `deno test -A --config supabase/functions/deno.json supabase/functions`: 862 tests passed; no Edge Function files changed.
- `npm run lint`: passed, zero warnings.
- `npm run build`: passed. Existing mixed static/dynamic `deskBrief.js` import and chunks exceeding 500 KB warnings remain.
- `node -e "import('./api/router.js').then(() => console.log('router import ok'))"`: passed.
- `git diff --check`: passed before commits.
- Initial focused projection/API/hook/UI tests failed before implementation. Three temporary mutations were individually rejected: stage used as sector, raw feed bypassing tender expiry, and graph double-counting the shared bill register. Original code restored; focused tests then passed.
- `node /private/tmp/national-summary-parity.mjs`: offline real-feed parity passed for all 12 modules against prepared feed, using a process-local failed-fetch stub. Bills/graph 9,819 each; questions 8,000; stored regulators 121; affidavits 483; MP profiles 782; expired tenders 0; AGMUT 29; stored Cabinet 6; programmes 8; budget 13. Industry failure remained unavailable, not zero. Summary sizes 533–1,167 bytes, below 30 KB. The temporary script is not a repository test or production source.
- Local GET summary returned HTTP 200, 9,819 prepared bill records and an explicit unavailable source date. Router tests exercised GET-only and feature validation in both handlers.

## Browser evidence and limits

A temporary local harness rendered the actual landing component against the real local endpoint, without changing authentication. It was removed after checks. Desktop 1,440 px, tablet 768 px and phone 360 px had no horizontal page overflow in DOM measurements. Both themes inspected. Search narrowed modules, source filtering showed curated entries only, no-results showed Clear filters, native disclosure opened with Enter, and a candidate button delivered its canonical ID. Controlled unavailable summaries rendered as unavailable; retry resumed real progressive loading. Real successful loading reached 11 unique resources / 12 modules and 19,190 combined available records at that observation; this fluctuating value is not hardcoded. Empty tenders displayed 0 available records. Global and State actual shared components retained their existing layouts and charts, with SSR regression guards passing.

Saved screenshots: desktop `/Users/vighneshshukla/.codex/visualizations/2026/10/03/01a100ed-6924-76a3-8647-747036b0757a/national-landing-desktop.jpg`; sibling observations `/private/tmp/national-global-regression.jpg` and `/private/tmp/national-state-regression.jpg`. Temporary viewport override reset and browser restored to the local National route.

Reduced motion is enforced by the CSS media gate, inspected in source; OS reduced-motion emulation was not executed. Actual 200% browser zoom remains unchecked. The local session was signed out, so full shell navigation, all route destinations, browser Back and subscription locks require signed-in acceptance. No authentication bypass was added. Component tests and canonical callback evidence do not substitute for that check. Independent review remains required before merging. F81 stays open pending integration and owner acceptance.

## Deliberately untouched

Existing source gaps, database/feed count mismatches and row-key collisions remain documented in the audit. Source refresh/coverage/licensing repairs, homepage globe work and other desks remain outside this branch. No credentials or data packs were changed. No push, deployment, PR or main merge performed.

## Local commits

- `0e76d15`: prepared-feed projection and API.
- `a40b363`: National landing composition, artwork, progressive state and regression checks.

Documentation is saved in a following local commit. These commits have not been integrated into main.
