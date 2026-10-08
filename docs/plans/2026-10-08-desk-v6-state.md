# State desk v6 — implementation proposal

> **Status: Living.** Owner approved implementation with “go” after confirming State-only scope on 2026-10-08.

Spec: [State scope](../specs/2026-10-08-desk-v6-state.md). Tracker: F88, `open-work.md`.

## Branch and release sequence

The existing seven-desk acceptance remains tracked independently. Owner has confirmed native 200% zoom, hover/pan/Pause/Resume and subsequently the stagger behavior; reduced-motion/touch/hidden-tab and live microphone checks remain outstanding. This State plan does not mark that goal complete.

Execution branch is `task/desk-v6-state`, created from the existing integration candidate `8f1e12e` to preserve its required shared v6 dependencies. The supervisor stated this dependency before branching; main was not merged or changed. Before any release, review this stacked dependency and the separate seven-desk acceptance. Keep State local until review; push for a Vercel preview only with authorization. Previews share the live database and are not disposable data fixtures.

Default sequential execution. Independent review can be delegated after a concrete slice exists; agents receive onboarding, this spec, the active plan and exclusive write scopes. No concurrent shared-frame/catalogue edits.

## Ordered slices

### S0 — resolve geography and inventory (no application changes)

Owner confirmed State-only transfer, with no separate Local page. Audit all 35 reference State entries plus 14 currently exposed State entries and their Local overlap. Record exact tier, feature, dataset, adapter, geographic fields, supported filters, source availability, count unit and terminal destination. Execute read-only probes; distinguish configured mappings from working sources. Approve handling of existing-only modules before retiring any navigation entry.

Write scope: State spec, this plan, `docs/research/2026-10-08-state-source-audit.md`, `docs/plans/open-work.md`. Exit: owner-approved inventory, supported geography behavior and coverage matrix. No assumption that all 35 sources work.

### S1 — presentation mapping

Depends on S0. Add `src/desks/landing/statePresentation.js` and `statePresentation.test.jsx`; update `deskCatalogue.js` and `deskCatalogue.test.js` only to the approved scope. Reuse `deskImages.js` as-is unless the parity audit identifies a concrete mismatch. Preserve canonical Local identities and the frozen grounding inventory. Exit: exact names, groups, images and route targets proven; no UI/source side effects yet.

### S2 — source summaries

Depends on S0 and S1's fixed module identity list. Add `src/lib/stateLandingSummary.js`, its focused test, `src/desks/useStateLanding.js` and its test. Define measured summaries against existing adapters and reject mismatched resource/tier identities. Keep cancellation, bounded loading and retry consistent with existing desks. First determine whether existing endpoints can provide adequate summaries; if a new server route is necessary, stop to specify a separate server/API slice with exact files and verification before dispatch. Exit: executed success/empty/error/partial source evidence and meaningful negative regression checks.

### S3 — State landing and shell handoff

Depends on S1–S2. Add `src/desks/StateLandingView.jsx` and its test, update `src/desks/DeskLandingView.jsx`. Use `DeskLandingFrame` for reference hover, sector selection, directory and module dialogs. Bind metrics and any supported chart to S2 summaries. Reuse existing styles initially; any shared-frame/style change needs its own narrow reviewed scope so seven accepted desks do not regress. Exit: a local State preview with functioning approved modules, truthful unavailable states and retained Local access.

### S4 — functional and visual acceptance

Depends on S3. Audit every approved module CTA: first click, Back/reclick, reload, exact destination and protected/unavailable behavior. Verify sector/search/availability filters, All Sections, popup metadata/source links, retry and keyboard focus. Compare exact images, spacing and interactions to the State reference at 360/768/1440/1700, light/dark, English/Hindi labels. Execute or obtain explicit owner confirmation for native zoom, touch and motion checks; preserve execution evidence instead of treating code reading as acceptance.

Write scope: source audit, State spec, this plan and open-work tracker. Exit: independent review, owner acceptance and exact verification record. Publication and cleanup are separate authorized actions. The reference Local page is excluded from this task.

## Verification commands

For relevant focused files: `npx vitest run <changed-test-paths>` (replace paths with the actual dispatch's tests). Before candidate acceptance: `npm test`, `npm run lint`, `npm run build`. Because S2 changes `src/lib/`, also run `deno test -A --config supabase/functions/deno.json supabase/functions`. If server/API changes are approved, additionally run `node -e "import('./api/router.js').then(() => console.log('router import ok'))"`. Run `git diff --check` for every slice. Do not claim a nonexistent standalone type-check or live feed freshness from a green build.

## Planning evidence

Planning was followed by authorized implementation and read-only source probes; see the source audit and verification record below. The known State/Local tier mismatch is an audit target, not a claimed runtime failure. Remaining source and product decisions are explicit prerequisites above.

## Scope amendments during execution

S0 source audit executed. S1 mapping/catalogue complete; S2 summary projection/loader complete using existing feeds, with no new server endpoint. S3 State dispatch and shared frame implemented. Narrow shared-frame amendment: State sets `coverageCounts` so its sector cards show measured-module counts; other desks retain their previous record-count behavior. Catalogue-summary dispatch now supports canonical State/Local-tier entries; State shell uses the v6 wide layout. S4 browser verification and final review are recorded below.

## Verification record — local candidate, 2026-10-08

- Source audit:41 read-only canonical feature-feed requests completed. The direct API returned generic news for HTML-only entries; client/projector guards exclude those. A final browser observation exposed the no-shipped-register empty fallback; its regression guard failed before the correction and now reports unavailable rather than verified zero.
- New navigation regression failed against the old14-entry State navigation before the expansion; source-identity regression failed before the strict tier/feature guard. Logs: `/private/tmp/state-mapping-red.log`, `state-summary-red.log`, `state-empty-red.log`.
- Final full application suite: `npm test`,184 files/2464 tests passed,30.59s. Initial parallel build/test run had an unrelated5000ms PDF inspection timeout plus the old-State architecture expectation; the architecture assertion was updated for the intended migration, and the unchanged PDF test passed on the subsequent full runs.
- Independent read-only review identified and verified corrections for modeled-data disclosure and mixed-unit aggregation;10 focused/frame/motion/catalogue files,151 tests passed. Supervisor subsequently added and verified the no-shipped-register regression.
- Actual signed-in shell: all41 State module popups executed first-click, Back/reclick and reload. Every URL remained exact `#/state/<canonical feature>`; no Home/National fallback, and the module workspace mounted instead of the landing. Planned entries showed their own planned workspace. All14 old destinations remain available. One CAG automation sequence lost its popup and was excluded; fresh inspection and complete retest passed. Evidence: `/private/tmp/state-v6-route-evidence.json`.
- Actual signed-in geometry:16 observations across360/768/1440/1700,English/Hindi-label light/dark; effective widths matched requests, no page overflow, all six State photos loaded. Eight sampled English-theme module dialogs fit and restored focus to their module trigger. Evidence: `/private/tmp/state-v6-viewport-evidence.json`.
- State Pause/Resume and source-filter pressed state executed successfully. These are UI-state observations, not claims that native hover,200% zoom,touch,reduced-motion or hidden-tab behavior was independently reverified for State. Those native/owner acceptance checks remain pending.
- Exact assets: `node scripts/verify-desk-v6-assets.mjs` passed41 byte-identical assets,40 names and9 configurations against the frozen reference.
- No API/server files changed, so router import was not required. No type-check is defined. Existing build mixed-import and large-chunk warnings remain; no provider/schema/data-collection change, push, main merge or deployment occurred.

- Final `npm run lint` passed with no warnings; `npm run build` passed in10.84s with the existing mixed-import and large-chunk warnings. `deno test -A --config supabase/functions/deno.json supabase/functions` passed862 tests in9s. `git diff --check` passed. Exact logs: `/private/tmp/state-final-lint.log`, `/private/tmp/state-final-build.log`, `/private/tmp/state-final-deno.log`.

Owner accepted the State appearance ("Looks good") on2026-10-08 and authorized pushing the current branch. Implementation checkpoint: `8c7ab38` on `task/desk-v6-state`, stacked on the seven-desk integration candidate. Native/device acceptance remains pending; the broader R0–R7 goal is not declared complete. Current-branch publication is authorized; main merge and cleanup are not authorized by this request.
