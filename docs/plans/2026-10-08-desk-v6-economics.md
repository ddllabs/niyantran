# Economics v6 implementation plan

> **Status: Living.** Approved plan implemented locally, 2026-10-08; owner review pending.

[Spec and source map](../specs/2026-10-08-desk-v6-economics.md). Overall capability `economics` follows Law in [integration plan](2026-10-07-desk-v6-integration.md). Progress is tracked only under F88 in [open work](open-work.md); this document defines task scopes, not a second checklist.

## Local workflow and dependencies

Keep `task/desk-v6-integration`, preserve existing National/Global/Law commits, and leave main untouched. No additional permanent branch or remote environment. Sequential source contract → compact API → client → page → shell → acceptance. Each task leaves existing pages functioning; supervisor creates coherent local commits after review and checks. No push/deployment/main merge is part of this plan.

User has authorized supervised agents for this initiative. Use one tightly scoped worker at a time after interfaces are fixed; root owns API registration, dispatcher and shell. A separate read-only reviewer may inspect completed scopes. Workers receive onboarding, this spec/plan, exclusive paths and verification; no commit, push or redelegation. No worktrees needed for sequential workers. Browser control remains supervisor-owned. Carbon is a later separately scoped slice after Economics review.

## E1 — Freeze Economics presentation and route map

Write scope: new `src/desks/landing/economicsPresentation.js` and `economicsPresentation.test.jsx`.

Define four reference groups, all eleven canonical finance entries, coverage-aware descriptions and exact existing `DESK_VISUALS.economics` imagery. No mock metrics or availability. Keep display aliases distinct from feature identity.

Acceptance: four groups with 2/3/4/2 entries; all identities resolve exactly; asset selection/order equals reference. Verification: focused presentation test including every feature-map identity and image; guard fails after wrong tier or missing entry is restored. Dependencies: reviewed spec. Size: two files.

## E2 — Project actual source summaries

Write scope: new `src/lib/economicsLandingSummary.js`, `economicsLandingSummary.test.js`.

Freeze `ECONOMICS_FEATURES` and `projectEconomicsSummary` version-1 contract before consumers. Reuse prepareDeskFeed and populated-column logic. Treat deliberate election status as unavailable, provider failures as error, valid empty feed as empty. Add safe links, honest limitations, metadata periods, units and small exchange count breakdown; no raw rows in response. Confirm aggregate behavior uses measured resource identities and never incompatible values.

Acceptance: 144 quotes/31 political rows/229 DGFT entries in offline fixtures; status rows do not count; live and fallback identity distinct; absent fields/date remain unreported. Verification: fixture tests for every module and adapter branch, plus guard failures for raw Manifold count, status count, missing PMI/forecast, news as quotes, and false zero. Dependencies: E1 identity map. Size: two files. Run both repository suites when this src/lib slice lands.

Checkpoint A: root reviews coverage table against actual envelopes and existing workspace columns. Stop for a source mismatch requiring provider/schema expansion; do not silently repair it.

## E3a — Read-only server boundary

Write scope: new `server/economicsLandingSummary.mjs`, `src/lib/economicsLandingApi.test.js`.

Expose `serveEconomicsLanding(searchParams, loadFeed)` with exact feature allowlist and forced finance tier. Injectable feed loader for bounded local fixtures; use existing feature-feed path in runtime.

Acceptance: all eleven served, unknown rejected, supplied foreign tier ignored; returned source failure preserves valid metadata. Verification: focused server boundary tests and projector tests. Dependencies: E2 contract. Size: two files.

## E3b — Register local and deployed API paths

Supervisor-only write scope: `server/featureFeed.mjs`, `api/router.js`, `src/lib/economicsLandingApi.test.js`.

Add `/api/economics-landing` to existing landing handler routing, retaining GET-only behavior and status conventions. Do not modify providers, feed logic, billing or authentication.

Acceptance: local and router paths call the identical handler; 400 unknown/405 wrong method; existing three landing paths unchanged. Verification: API tests, router import, lint and build; controlled local endpoint fixtures. Dependencies: E3a. Size: three files.

## E4 — Cancellable client loader

Write scope: new `src/desks/useEconomicsLanding.js`, `useEconomicsLanding.test.js`.

Use existing bounded queue pattern with three workers, per-request timeout, abort cleanup, response identity validation and per-module retry. Preserve useful error/unavailable coverage responses.

Acceptance: no callback after cancellation; retry only requested failed module; invalid version/identity rejected; unknown count remains null. Verification: fake-timer/fetch queue tests and malformed/502/error cases. Dependencies: E3b. Size: two files.

Checkpoint B: root executes offline projection and actual local endpoints, records live vs snapshot results separately, verifies response excludes raw rows and unsupported fields. Provider outage does not block truthful UI but must be visible.

## E5 — Economics page adapter

Write scope: new `src/desks/EconomicsLandingView.jsx`, `EconomicsLandingView.test.jsx`; new `economicsLanding.css` only if an Economics-specific hero theme adjustment is demonstrated necessary.

Compose shared frame with Economics presentation, real counts, provenance, retry, source-dependent chart and existing callback. Prefer existing shared geometry over a new layout system.

Acceptance: full eleven-entry catalogue, source-aware totals and dialogs; loading/empty/error/unavailable transitions; no mock numbers or unsupported forecasts. Verification: content tests, all eleven callback/href assertions, no news-as-quotes or zero-on-error, shared frame regressions. Dependencies: E1,E4. Size: two or three files.

### E5b — Measured chart hook

Supervisor-only write scope: `src/desks/landing/DeskLandingFrame.jsx` and `DeskLandingFrame.test.jsx`. Inspection found the shared frame only accepts bills/sector charts. Add an optional `dataHighlight` contract (items/count/title/unit/description/asOf) for quote counts by exchange, preserving every existing desk default. Red test for supplied exchange label/unit must fail before implementation; existing frame tests remain green. Depends on E2 and E5; size two files.

## E6 — Shell handoff and preview integration

Supervisor-only tracked write scope: `src/desks/DeskLandingView.jsx`, `src/shell/TerminalShell.jsx`, `src/desks/landing/economicsPresentation.test.jsx`. Ignored local `tmp/desk-v6-preview.html` may add Economics selection for review; it is not a delivered product path.

Register Economics dispatcher and empty-feature v6 shell mode; keep canonical finance handoff and terminal layout/access behavior. Existing non-curated feature fallback must be verified rather than enlarging the curated catalogue opportunistically. Any genuine missing route/access mapping requires a separate exact subtask within this capability before fixing.

Acceptance: all eleven correct terminal destinations first click and Back/reclick; existing National/Global/Law dispatch tests pass; controls preserved. Verification: focused dispatcher/route tests and authenticated browser execution. Dependencies: E5. Size: up to four tracked files.

## E7 — Independent acceptance and owner review

Read-only reviewer scope: Economics diff, source/route contract, existing pages regression risk. Supervisor fixes material findings only through a named narrow task. Documentation write scope: this plan, Economics spec, overall integration plan and F88 entry.

Execute full Vitest, Deno (src/lib changes), lint, build, router import, exact asset verification and diff check. Browser: reference and app at same 360/768/1440/1700 widths/theme/sector/motion, all four cards/all eleven popups, source links, search/filter/directory/data dialogs, Escape and focus return, retry, pause, first navigation and Back. Check native zoom/touch/OS reduced-motion/hidden-tab behavior if environment permits; record limits explicitly. Include loading/error fixture evidence and actual source evidence with dates, without user data or secrets.

Acceptance: no wrong CTA, missing image, mock field, false-live badge, page overflow or console error caused by the slice; independent review clear; owner receives actual local URLs and comparison evidence. Completion does not imply owner acceptance. Native environmental cases and provider failures cannot be called passed without execution.

## Risks and exclusions

Highest risk is presenting configured registry coverage as implemented data. Resolve this in E2 before polishing visuals. Reference marketing copy about scenario tools, investments or forecasts needs adjacent real-coverage qualifications. Historical observations are not current quotes; last retrieval is not publication time. Combined records are not a homogeneous economic indicator.

The previously observed preview → full-app startup flash stays separate; auth is excluded. State/Local, Carbon, Sports, Entertainment, provider repair, new finance capabilities, database changes, main merge, remote publication and cleanup remain outside this slice. Existing build warnings must be recorded, not silently classified as new regressions.

## Delivery checkpoint

E1–E6 implemented locally; E7 independent source/code review is clear and full repository verification passes. Exact source counts, commands, browser evidence and limits are recorded in the spec acceptance section. Supervisor added the narrowly scoped E5b measured-chart interface and Economics-only dark hero correction. Existing National/Global/Law defaults are preserved. Owner preview review, signed-in Economics handoff (current account lacks access), native-device cases and publication remain pending. No provider, database, account or billing repair was included.
