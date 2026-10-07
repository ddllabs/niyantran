# Seven-desk v6 closure

> **Status: Living.** Owner approved R0–R7 on2026-10-08. Work tracked only in F88/F90, docs/plans/open-work.md. Ordered scopes and commands: docs/plans/2026-10-07-desk-v6-integration.md.

The seven implemented landing presentations contain79 canonical entries (National17,Global16,Law12,Economics11,Carbon7,Sports8,Entertainment8). The curated shell catalogue exposes only61 of these. Reference catalogue search is missing. Locked deep links are rewritten to the persona desk, which disguises the requested destination. Source summaries already distinguish unavailable data from measured counts; those contracts remain authoritative.

## Catalogue interface

`src/desks/landing/deskCatalogue.js` exports `DESK_CATALOGUE` (array of entries) and `searchDeskCatalogue(query)` (all matching entries, deterministic presentation order). Each entry has `id` (tier:feature), `tab`, `tier`, `feature`, `title`, `desk`, `groupId`, `group`, `description`, `aliases`, `fields`, and `configured`. Derive entries from the seven shipped presentation exports; verify exact tier/feature against html-feature-map. Configured is identity only, never evidence of live availability. Fields are configured schema labels, never claims about populated data. Aliases include canonical and truthful display titles. Do not fetch records or copy reference numbers into the catalogue. Search matches all whitespace-separated terms over desk/group/aliases/description/fields, case-insensitively. Blank query returns the catalogue.

Extend the curated seven-desk navigation only with these approved canonical entries, with their presentation grouping/order; retain existing State/local navigation. Avoid a circular import: catalogue identity must not depend on catalog.js. Existing source/workspace adapters remain unchanged. No same-title cross-tier substitution.

## Discovery interface

A reference-style catalogue dialog presents desk/sector/module metadata and exact destinations, keyboard selection, Escape, focus restoration, and empty results. Its module identity comes from the catalogue. One topbar discovery entry must integrate catalogue discovery while retaining existing server record search and DictationButton. Record queries remain debounced and restricted to entitled desks. Locked catalogue entries remain discoverable and visibly restricted; discovering them must not query their protected records. Catalogue counts are module counts, not record totals. Final component boundaries may be simplified after review without duplicating the search control.

## Restricted destinations

A canonical requested URL is preserved when access is denied. Render an explicit restricted destination identifying desk/module and a Back action; upgrade remains available. Do not mount DeskView, landing fetch hooks, protected side-panel context or workspace requests for a denied route. Back/forward, reload, initial deep link and in-app selection use the same access decision. Dismissing upgrade never changes the requested destination. Entitlement functions and backend authorization remain unchanged. Use controlled local tests, never production account mutation or credentials.

## Acceptance and exclusions

Prove catalogue completeness against all79 exact reference routes and record each of66 deferred geography entries separately in audit evidence. Prove guards fail with missing catalogue entries and original denied-route redirect. Execute focused tests per slice, lint/build/diff checks, then independent review. R5/R6 require actual browser interaction and same-viewport reference comparisons, not only source inspection. Distinguish fixtures from real provider execution. Full final checks and evidence are specified in R7. State/Local, missing providers, F84 Law source relevance and F89 external-site repair are excluded and remain open. No push/deploy/main merge or branch deletion is authorized by this goal.
