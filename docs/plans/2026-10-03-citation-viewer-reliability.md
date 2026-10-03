# F57 citation viewer reliability

> **Status: Historical (2026-10-03).** Verified local implementation `6df6d7c`; supervisor integrated locally. No push or deployment.

Spec: [citation viewer reliability](../specs/2026-10-03-citation-viewer-reliability.md).
Checkout: /private/tmp/niyantran-f57; branch task/f57-citation-viewer, based on local main f0058b1. Origin fetched; main is one documentation commit ahead. The original F56 checkout and 22 pending documentation paths remain untouched.

## Ordered tasks and scopes

1. Supervisor establishes failing slot-order and repeated-navigation guards in adjacent hook tests. Stable DOM order is independent of scheduling priority.
2. Supervisor sequentially updates PdfDocument.jsx/highlights.js and tests: reveal exact range once per citation request, cancel on newer page/search navigation; preserve render limits.
3. Supervisor updates WorkSurface.jsx/PageViewer.jsx/PageControls.jsx and adjacent tests: opening a source is an event; same citation requests reuse viewer state; cited chip remains a button.
4. Delegated fixture agent creates local deterministic PDF browser fixture in /private/tmp/niyantran-f57-fixture on task/f57-viewer-fixture; its exclusive write scope is scripts/viewer-regression/ (disjoint from supervisor source/tests/docs). Supervisor integrates and verifies it under scripts/viewer-regression/ and verifies scrolling, exact ranges, repeated clicks, split/full, fit modes, zoom, search and thumbnails without live services.
5. Independent agent performs read-only review of the spec, changes and guards. No delegation or writes permitted for reviewer. Supervisor resolves findings, independently verifies and commits locally. No push/deploy.

Shared interfaces: WorkSurface passes the viewer object as revealRequest (new identity on every openSource emission). PageViewer converts each changed revealRequest to its existing monotonically sequenced scrollRequest. PdfDocument distinguishes request identity and consumes exact-range reveal only once; non-citation/page/search navigation cancels it. highlighter.get(page) exposes only this viewer's range.

## Verification

Focused: node ./node_modules/vitest/vitest.mjs run src/ai/page-viewer/*.test.* src/ai/WorkSurface.test.jsx
Full: npm test
Quality: npm run lint; npm run build; git diff --check
Browser: localhost fixture with real pdf.js and CSS Highlight ranges; no remote backend or AI requests. Record actual observations and limitations here. No standalone type-check exists. No server, shared lib, admin, Supabase or SQL scope changes, so their specialized suites are not applicable.

## Evidence

- Original focused guard run: 3 failures (slot order `[4,3,5,2]`, repeated open stays page 15, inert cited chip); corrected focused set: 39 passed initially.
- Mutation check: remove WorkSurface request bridge and ignore pending citation state; 5 assertions fail (missing bridge, replay after redraw/fallback, late page/search snap-back). Restore: 22 passed. No skipped tests.
- Final `npm test`: 121 files, 2,029 tests passed (2026-10-03). `npm run lint`: exit 0, no warnings. `npm run build`: exit 0; existing deskBrief mixed import and >500 kB chunk warnings remain. `git diff --check`: exit 0.
- Independent read-only reviewer ran 68 focused tests across WorkSurface, PDF/PageViewer hooks, chrome and highlights, all passed; no required issues after fallback consumption and bridge guard. Reviewer inspected late scale invalidation separately; runtime evidence below is supervisor-executed.
- Fixture agent delivered only scripts/viewer-regression/, without commits. Supervisor reviewed and corrected full-page search folding (query folding truncated page text), loopback websocket CSP for alternate test port, and HMR root cleanup. Scoped ESLint and isolated fixture build passed. Existing dependencies were reused; no install/lock changes.
- Browser: Codex in-app browser, 1440x900 and 1280x720, split panel 600px and compact 400px. Original fixture: next page produced `[13,12,14]`, empty citation Range and zero rectangle; repeat citation stayed page 13. Fixed: ascending `[12,13,14]`, connected text endpoints and nonempty three-line range; repeat returns page 12 without losing query/zoom.
- Fixed browser: split/full return, same-page cited button, far page 2 and return/redraw, full-view thumbnail page 13 and return, fit width/page/text, manual zoom, compact More fit options, PDF/Text switching, search `copper` (1 of 1, orange exact range), retained search after navigation. A native PageDown to page 13 followed by full-view opening stays page 13 (no stale toolbar replay). Observed 2–5 live canvases; existing pool/window cap tests remain green.
- Late rapid fit-switch/return exposed a previous-scale range being consumed before redraw. Invalidate at draw-effect start; fresh browser rapid Fit page → Fit text → return ends with range centre error -0.15px relative to usable pane centre, connected endpoints and clean console. Temporary highlight loss during zoom redraw is expected; scrolling does not invalidate scale.
- Final fresh browser console: no errors/warnings. An earlier fixture HMR duplicate-root warning was corrected and did not occur in the fresh run. Screenshot saved outside the repository in the task visualization folder (citation-viewer-fixed.jpg); synthetic local data only.
- Limitations: no live infrastructure writes, no push/deploy, no Safari run, and no representative heavy-PDF timing trace. The fixture's diagnostic polling adds overhead; it is not a performance benchmark. Heavy-document stutter profiling is tracked as F58; existing Safari follow-up stays F50. Server/shared-lib/admin/Supabase/SQL suites were not separately run because those scopes are unchanged.


Final integration: implementation commit `6df6d7c`; closure documentation follows it. Clean verification checkout fast-forwarded to local main. Original task/f56-documentation-reconciliation checkout retains its 22 pending documentation paths unchanged.
