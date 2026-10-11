# F95 direct desk entry

> **Status: Living.** Sequential implementation; no delegation. [Spec](../specs/2026-10-12-desk-direct-entry.md).

1. Commit verified cleanup separately, staging only its files and F93 tracker paragraph. Completed: `69595a5`. Create `task/desk-direct-entry` while leaving corpus changes in place.
2. Add failing regression tests for direct defaults and landing panel dismissal.
3. Implement the explicit default map and shared landing links. Remove intermediate selection UI; preserve internal sector menus and charts.
4. Add full AI outside dismissal using the existing pointer/keep-zone rules; dismiss on landing context without unmounting chat.
5. Run focused/full tests, lint, build, asset check and isolated browser checks. Verify corpus SHA-256 snapshot and tracker preservation. Commit only UI scope and its documentation; no push/deployment.

Write scope: `src/desks/landing/DeskLandingFrame.jsx`, its tests, new `deskDefaults.js` and tests; `src/shell/TerminalShell.jsx`, `SidePanel.jsx`, `sidePanelModel.js` and their focused tests; related landing snapshot expectations if changed markup requires it; these spec/plan files, the cleanup commit amendment, the existing side-panel spec amendment, and F93/F95 tracker entries only. Temporary fixtures and logs stay in `/private/tmp/niyantran-f95/`. No corpus path may be staged or edited.

## Executed verification — 2026-10-12

- RED: `npm test -- src/desks/landing/deskDefaults.test.jsx src/shell/sidePanelModel.test.js` produced three intended failures: missing direct card links, AI remaining open on landing context, and outside dismissal leaving AI open. Twenty-two existing/contract checks passed.
- GREEN: final full `npm test`: 184 files / 2,472 tests passed. Focused `npm test -- src/desks/landing/deskDefaults.test.jsx src/shell/sidePanelModel.test.js src/ai/citationOverlayModel.test.js`: 80 passed, including all 35 rendered default links, all 120 canonical routes/menu memberships and existing pointer/modal/resize keep-zone rules.
- `npm run lint`: passed with zero warnings/errors.
- `npm run build -- --outDir /private/tmp/niyantran-f95/build-final`: passed. Existing mixed static/dynamic import and large-chunk warnings remain; no dependency changes.
- `node scripts/verify-desk-v6-assets.mjs`: passed; all reference assets/configurations unchanged.
- `deno test -A --config supabase/functions/deno.json supabase/functions`: 880 passed. Run because a related `src/lib/` landing-render test expectation changed; no corpus/server code edited.
- `git diff --check`: passed.
- Browser fixture uses the actual eight landing content components, actual SidePanel/useSidePanel and DeskNav, fixed local summaries, a stateful chat textarea stub and a rail stub. All 35 desktop picture links handed off directly to the approved canonical defaults with no popup. All eight mobile landings (390px) passed a direct handoff and had no broken images or document overflow. All eight dark desktop landings rendered correctly without overflow. Actual National sector menu opened and its Parliamentary Question sibling handoff passed.
- AI browser checks: inside click retains AI; docked and expanded outside clicks hide it; expanded return to landing restores full-width landing; switching landing desks and selecting the same landing hide AI; reopening retains the fixture draft and does not restore stale expansion. Mobile outside click also hides AI. Standalone console: zero warnings/errors. One textarea evaluation timed out immediately after reopening; a fresh DOM snapshot and subsequent value check confirmed the visible preserved draft, and the remaining checks completed.
- Browser verification isolates navigation/panel behavior; it does not send a real chat, authenticate, fetch live feeds, or verify streaming against production. Existing AiPanel remains mounted and its data/provider behavior is unchanged. Screenshot: `/private/tmp/niyantran-f95/landing-desktop.png` (fixture counts, not production data).
- Preservation audit: all 93 pre-existing dirty files outside the shared tracker remain SHA-256 identical to the pre-cleanup snapshot. Tracker corpus content is unchanged; only F93/F95 and blank separators differ. Cleanup and UI staging must exclude every corpus path.

Review found no unresolved implementation blocker. Existing feed limitations, unrelated open-work items, corpus changes and existing build warnings remain outside scope. SQL fixtures were not run; no SQL/authorization changes. No push, deployment or main merge.

## Local completion

Cleanup commit: `69595a5`. UI commit: `9fe245e`, on `task/desk-direct-entry`. F95 moved to Done with the UI hash. Corpus remains uncommitted and excluded from both commits. No main merge, push or deployment.
