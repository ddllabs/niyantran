# Law landing redesign

> **Status: Normative.** Owner authorized Law instead of State on 2026-10-05. Local implementation only.

## Outcome
Replace Law's generic landing with the Law composition in Downloads/nter-desk-landing-v2.html: Supreme Court backdrop, court/bench/peace/files vectors, reference hover, parallax, highlights, disclosures and source filters. Keep the current four groups and all12 canonical callbacks, shared rail, access checks and other desks. State is excluded.

## Current evidence and data contract
Read-only local API execution found220 Supreme Court rows and220 topic rows sharing that same table,434 NCLT/IBBI entries, and nine news-search modules. Observed raw news counts vary (58–100); prepareDeskFeed must shape counts identically to the workspaces. News is reporting coverage, never dockets, cases, judge profiles or bench analytics. Broad provider queries do not establish topic-specific completeness. Supreme Court PDFs may require a live court session. NCLAT coverage is not established by the NCLT/IBBI pack.

GET /api/law-landing?feature=<canonical> projects the existing judiciary prepared feed into version1 count, resourceKey, availability, sourceMode, populated columns, safe source links, explicit source date and limitations. sourceMode stored only for embedded tables; news-search is feed-backed with reporting identity. Exclude status rows; error is unknown, legitimate empty is0. Deduplicate the Supreme Court and topic views using resourceKey judiciary-sc-orders. Counts remain heterogeneous entries, not unique cases. No full rows returned; bounded sources/fields and three concurrent45s cancellable requests with per-module retry.

## Acceptance
All12 routes/Back, search/inert source filters, keyboard disclosures/Escape/focus and shared rail work. No mock counts, invented freshness, case completeness or official-news identity. Court and tribunal tier chart displays actual prepared counts and shared-table limits. Match original vector geometry/palettes and gavel/clock/file timing. Pause, reduced-motion, hidden and offscreen use the existing shared motion lifecycle. Check responsive320/768/1440, dark/light and Hindi desk label. Verify focused/full Vitest, Deno, lint/build/router import; prove critical guards fail for their defect. Native browser limitations and owner visual acceptance recorded separately.

## Structure and style
React/Vite JSX and scoped CSS, following National/Global composition. New Law projection/server/hook/artwork/view and colocated tests; minimal dispatcher/router extensions. Example: `const count = available ? rows.length : null;` retains unknown rather than false zero.

## Boundaries
Always retain canonical routes and exact provenance. No new dependencies, provider changes, ingestion, data collection edits, authentication/billing, main merge, push or deployment. New source integration is a separate owner decision. Broad reporting-query quality is disclosed and tracked separately.

## Commands
npm test -- --run src/lib/lawLandingSummary.test.js src/lib/lawLandingApi.test.js src/desks/LawLandingView.test.jsx src/desks/useLawLanding.test.js
npm test
deno test -A --config supabase/functions/deno.json supabase/functions
npm run lint
npm run build
node -e "import('./api/router.js').then(() => console.log('router import ok'))"
