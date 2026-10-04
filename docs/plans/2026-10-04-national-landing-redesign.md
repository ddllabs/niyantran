# National landing redesign: implementation allocation

> **Status: Living.** Approved for local implementation by owner “go”, 2026-10-04. Implementation branch `task/national-landing-redesign`; publication remains separately authorized.

## Inputs and decision

[Spec](../specs/2026-10-04-national-landing-redesign.md), [audit](../research/2026-10-04-national-landing-audit.md), owner HTML in Downloads. Tracker: F81 in [open work](open-work.md). Planning branch: `task/national-landing-plan`, baseline `f5c0617`. Homepage globe work stays separate.

Recommend sequential work through the summary contract and first integrated UI. There is one data contract and one landing entry point; immediate parallel agents would duplicate decisions and risk shared edits. Once these are proven, isolated art/motion work can run alongside behavior verification. The owner has requested planning before dispatch; no dispatch happens now.

## Ordered tasks and exact proposed write scopes

Each task has one exclusive owner. Supervisor owns integration and docs. Existing files outside a task's listed scope are read-only; a necessary expansion is resolved before editing.

| Task | Owner / write scope (maximum five files) | Depends on | Exit evidence |
| --- | --- | --- | --- |
| T1 summary contract and runtime spike | Data implementer: `src/lib/nationalLandingSummary.js`, `src/lib/nationalLandingSummary.test.js`, `server/nationalLandingSummary.mjs`, `src/lib/nationalLandingApi.test.js` | Owner approves scope | Existing `prepareDeskFeed` imports safely in plain Node; all module count/column/provenance projections agree. If extraction is required, stop and revise scopes before modifying shared shaping. |
| T2 summary endpoint integration | Data implementer: `server/nationalLandingSummary.mjs`, `src/lib/nationalLandingApi.test.js`, `server/featureFeed.mjs`, `api/router.js` | T1 | GET-only per-module summary in Vite and Vercel router; canonical whitelist, same feed adapter, no credentials/new ingestion; bounded caching uses existing resource semantics. Response contains no rows and meets size budget. |
| T3 progressive landing state | UI implementer: `src/desks/useNationalLanding.js`, `src/desks/useNationalLanding.test.js` | T2 | Three-request bound, shared bill/graph identity, abort on unmount, independent ready/error/empty states, retry and partial totals. Static summary failure remains unknown. |
| T4 National composition and navigation | UI implementer: `src/desks/NationalLandingView.jsx`, `src/desks/nationalLanding.css`, `src/desks/NationalLandingView.test.jsx`, `src/desks/DeskLandingView.jsx`, `src/lib/deskLanding.test.jsx` | T3 | National dispatcher only; five groups/12 canonical routes; sector chart with real data; search and keyboard/touch disclosure; current sibling desks still pass. |
| T5 illustration and motion polish | Motion implementer: `src/desks/NationalLandingArtwork.jsx`, `src/desks/nationalLandingArtwork.css`, `src/desks/NationalLandingArtwork.test.jsx` | T4 fixed props/layout | Parliament and five SVG illustrations; reduced-motion, offscreen/hidden-tab pause, no focus/data delays. Supervisor integrates into T4 component after exclusive ownership returns. |
| T6 integration verification | Supervisor/reviewer: the three task documents and `docs/plans/open-work.md`; product fixes return to their original exclusive owner | T1–T5 | Independent review, command/browser evidence, scope/security diff inspection, local coherent commits; no publication. |

## Interfaces fixed before optional parallel work

- Endpoint proposal: `GET /api/national-landing?feature=<canonical-id>` with explicit allowlist of National's current catalog. Handler returns the spec summary envelope, not feed rows. Shared resource keys prevent duplicate bill retrieval; graph presentation schema remains graph-specific.
- Projection takes raw envelope plus prepared feed, keeping source mode/freshness evidence separate from scrubbed display labels. Error and unknown are explicit; no regex can silently transform missing provenance into live status.
- Hook exposes summaries by canonical ID, progress/resource counts, bill sector aggregates and retry; components never parse provider/storage metadata.
- Artwork accepts a scene only; it knows nothing about feeds, auth or routing. The parent motion controller and scoped CSS manage pause/reduced-motion states. No mockup content inside SVG carries product data.
- Existing `onFeature` contract is unchanged. National dispatcher retains the shared component for all other desk IDs.

## Checkpoints

1. Owner reviews the concrete spec and allocations before code or agent dispatch.
2. T1 is a go/no-go gate: plain Node compatibility and shaping parity must execute. Do not implement a second independent set of expiry/language rules. Any helper extraction or endpoint caching change gets a revised scope first.
3. After T2/T3, measure request size, concurrency, first useful render under a slow Cabinet feed, cancellation and fallback behavior. No hardcoded production counts. Summary snapshots need explicit freshness; no promise of instantaneous agreement between separate time-varying requests.
4. After T4, inspect National desktop/phone and sibling desk routes before decorative polish. Keep data states usable with zero animation.
5. T5 may be delegated only after owner authorization and onboarding (`docs/agents/onboarding.md`), fixed props and disjoint scope. T4 component/CSS remain single-owner. A separate reviewer may inspect without writing product files.
6. Supervisor reproduces evidence, commits locally and reports for acceptance. Push, PR, merge into main and deploy are separately owner-directed.

## Verification commands for implementation

- Focused Vitest on new projection, endpoint, hook, National component and artwork tests, plus `src/lib/deskLanding.test.jsx`, `src/lib/deskCatalog.test.js`, `src/lib/deskRowsFeed.test.js`.
- `npm run lint`; `npm run build`.
- `node -e "import('./api/router.js').then(() => console.log('router import ok'))"`.
- `npm test` and `deno test -A --config supabase/functions/deno.json supabase/functions` because T1 changes `src/lib`. Record exact failures/warnings; no invented type-check.
- Browser: 360/768/1440 px; light/dark; reduced motion; keyboard and touch; National/search/filter/all routes; Global/State unchanged; loading/error/retry/empty/partial counts; hidden-tab animation pause. Use local mocked upstream fixtures, not live database writes.
- Defect guards demonstrate red first for double-counted bill resource, error-as-zero, expired tender count and wrong chart field. Do not mirror implementation-only tests.

## Research-stage verification

Existing focused baseline tests passed (three files, 12 tests), plain Node import of `prepareDeskFeed` passed, and documentation whitespace checks passed. The remaining T1 gate is executable summary parity, not uncertainty about the current helper import.

The audit records read-only GET and SQL executions. No implementation acceptance is claimed. Documentation checks and existing baseline focused tests are recorded at the end of this task; full build/test gates belong to implementation.

## Deliberately untouched issues

Existing database row-key collisions, missing/partial source coverage, older budget snapshots and general PIB-versus-Cabinet relevance need separate data work if the owner wants them corrected. F81 tracks the redesign's truthful labels and boundaries, not a mandate to alter those sources. Global/State investigation can inform later separate designs, but there is no State mockup in this input.

## Scope amendment 1

Server endpoint tests live under `src/lib/nationalLandingApi.test.js` because Vitest includes only `src/**/*.test.{js,jsx}`. Shared display shaping imports in Node without extraction. Vite summaries reuse its existing backup fallback; Vercel summaries use the existing Vercel feature adapter, preserving environment-specific parity. Sequential implementation is authorized; no agents dispatched.

## Local implementation checkpoint (2026-10-05)

This checkpoint describes the first, subsequently rejected static adaptation. T1–T5 implemented sequentially by the supervisor; no task agents dispatched. T6 local checks completed as recorded in [verification](2026-10-05-national-landing-verification.md). Independent review and signed-in shell/owner acceptance remain pending before integration. No publication performed. Static artwork needs no hidden-tab animation controller; directory rows do not animate on filtering. The obsolete National flagship entry was removed from the shared landing configuration as part of replacing that view.

## Fidelity and shared navigation continuation (2026-10-05)

Owner answered all scope questions: map the rail to current desk tabs/routes, replace the selector and retain the other topbar controls; finish National first and defer Global/State redesign. Active goal is reference-faithful National plus shared navigation, verified locally and shown for review. Continue sequentially; no agents dispatched or publication authorized.

| Task | Exact write scope | Dependency | Evidence |
| --- | --- | --- | --- |
| T7 original artwork and motion | `src/desks/NationalLandingArtwork.jsx`, `src/desks/nationalLandingArtwork.css`, `src/desks/useNationalMotion.js` | Existing data interface fixed | Original Parliament/five tiles, unique SVG IDs, tilt/parallax/reveal, reduced-motion and hidden/offscreen pause |
| T8 faithful composition | `src/desks/NationalLandingView.jsx`, `src/desks/nationalLanding.css`, `src/desks/NationalLandingView.test.jsx`, `src/lib/deskLanding.test.jsx` | T7 | Existing 12 routes, real totals, inert nonmatches, disclosure, controls and responsive reference comparison |
| T9 shared desk rail | `src/shell/DeskRail.jsx`, `src/shell/deskRail.css`, `src/shell/DeskNav.jsx`, `src/shell/TerminalShell.jsx`, `src/shell/DeskRail.test.jsx` | Fixed existing onDesk/tabs/lockedIds interfaces | Active route, persona list and lock markers preserved; topbar/bucket controls retained; responsive shell |
| T10 verification and local review | Task spec/plan, tracker, new dated verification report | T7–T9 | Focused/full checks as required, browser comparison, coherent local commits and UI review evidence |

Motion contract follows the reference durations: 900ms entrances, 500ms spring card reset/80ms pointer tilt, 1200ms tile zoom/tracks, 350ms field popup, 400ms segmented thumb, 800ms lower reveal; tile loops 1.2–9s and clouds 110s. All decorative motion is disabled with reduced motion, pauses when hidden/offscreen and does not change data or delay navigation. CSS is National-scoped; assets contain no product counts. Summary endpoints and shaping remain unchanged.

## Continuation checkpoint

T7–T9 saved locally in `6aefc5a`; independent source review reported no remaining blockers after corrections. [Executed evidence and limits](2026-10-05-national-fidelity-verification.md). Owner UI acceptance and signed-in/zoom/reduced-motion runtime gates remain in F81. The active goal remains open through those gates. Local preview is retained for review; no push or deployment.

T10 continuation: verify visibility/reduced-motion transitions and pending pointer frames with deterministic event tests in `src/desks/useNationalMotion.test.js`; correct defects only in `src/desks/useNationalMotion.js`. Motion must remain disabled even if a pointer frame was queued before a visibility or preference change. Run the focused test, full Vitest suite, lint and build. Record this as synthetic controller evidence, not native browser-media acceptance.

Authenticated checkpoint: owner signed in locally; all12 landing buttons and Back, current-account Economics lock, sibling rail routing and full-shell responsive widths executed successfully. [Evidence](2026-10-05-national-authenticated-verification.md). Owner review and native browser motion/zoom checks remain pending. No publication.
