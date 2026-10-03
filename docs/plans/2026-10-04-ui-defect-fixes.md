# F60 — Frontend defect fixes implementation

> **Status: Historical (2026-10-04).** Implementation and local verification complete.

Spec: [frontend defect fixes](../specs/2026-10-04-ui-defect-fixes.md).
Open-work entry: F60 in `open-work.md`. Integration branch: `task/f60-ui-defect-fixes`.

## Ordered tasks and exclusive scopes

1. Supervisor establishes the clean baseline, records this contract and creates
   three isolated worktrees. No agent commits, delegates, pushes or deploys.
2. Independent implementation tasks may run concurrently:
   - **AI state:** `src/lib/aiConversations.js`, its tests, `src/lib/aiThreads.js`,
     `src/lib/aiDrop.js`, its tests, `src/ai/useResearchThread.js`, its tests.
     Expose errors from optimistic conversation writes, attachment processing state,
     named overflow feedback and reuse file bytes for hashing and extraction.
   - **Shell/desks:** `src/shell/` and `src/desks/` implementation and tests.
     Repair the concrete keyboard, stale-brief, drawer, hidden ticker and graph
     findings. Do not edit shared CSS or library helpers; report any needed change.
   - **Marketing/admin:** `src/marketing/` and `src/admin/` implementation, styles
     and tests. Repair the reviewed accessibility/navigation/contrast defects;
     do not change authentication or billing behavior.
   - **Supervisor AI UI:** `src/ai/AiPanel.jsx`, `AiPanel.test.jsx`,
     `AiMarkdown.jsx`, `AiMarkdown.test.jsx`, `panelLayout.test.js`,
     `research.css`, `usePanelPopovers.js`, `panelPopovers.test.js`, and
     `src/index.css`. Repair reading height, safe breaks,
     popover keyboard/focus, removal state and consume AI-state feedback.
3. Supervisor reviews each uncommitted diff, integrates and verifies material
   evidence. Commit coherent slices locally. Obtain independent review of the
   integrated result before closing the task.
4. Run final checks and local browser scenarios with offline fixtures; record
   exact results and limits here. Retain the UI branch for the next owner brief.

## Fixed AI interfaces

- Conversation state adds `persistenceError: string`, empty by default/reset;
  failure messages use safe fixed copy and are fenced by account/generation.
  An authoritative successful hydration clears the warning.
- Controller view adds `attaching: boolean`; `locked` includes it, while
  `canStop` continues to represent research execution only.
- Controller attachment notices name duplicates and overflow; it admits only the
  remaining slots in the existing 12-item limit. Export `MAX_ATTACHMENTS` through
  `aiThreads.js` so policy is shared. Existing synchronous store APIs remain.
- UI shows processing status, `attachNotice` and `store.persistenceError`, with
  Reload for save failures. No raw server error text is displayed.

## Verification

Each owner runs focused `npm test -- <paths>` with red/green evidence, lint and
build after code changes. AI-state and admin owners also run full `npm test` and
`deno test -A --config supabase/functions/deno.json supabase/functions`.
Supervisor runs those full suites, lint and build on integration. Runtime checks
cover AI layouts at desktop/tablet/phone, keyboard popovers/drawer/rows, pending
attachment feedback, save failure recovery, marketing controls and mobile admin
navigation using local fixtures, never the live project as a write fixture.

## Execution evidence

- Start: clean `main` at `0b45d1e`; `git fetch origin --prune` succeeded and
  `main...origin/main` was `0 0`. No production operation authorized for F60.

### Result and commits

- `8cfe0a4`: account-fenced conversation write warnings, authoritative Reload,
  processing lock, named overflow and shared file-byte reads.
- `7e51a0c`: tablet AI reading height, safe break tokens, native popover Escape,
  history confirmation focus, empty-history Tab exit and disabled removal.
- `9c9fb27`: desk row keyboard selection, sort semantics, drawer focus,
  numeric resize semantics, synchronous brief identity fencing, hidden ticker
  focus exclusion and honest graph controls.
- `9b5ecfb`: accessible marketing/admin controls, coverage destination,
  focus-paused carousel, roving radios/tabs, recovery contrast and inert mobile nav.

### Executed checks

- Final `npm test`: **126 files, 2,068 tests passed**.
- `deno test -A --config supabase/functions/deno.json supabase/functions`:
  **854 passed** on the integrated library/admin changes. Subsequent corrections
  were presentation and test-only; no Edge Function or library code changed.
- Final `npm run lint`, `npm run build`, `git diff --check`: passed.
  Build still reports the existing `deskBrief.js` mixed-import warning and
  chunks larger than 500kB. There is no standalone type-check.
- Initial root regression tests failed on reading height, safe breaks and missing
  feedback. AI-state owner reproduced 11 failures on original implementations;
  shell owner reproduced keyboard/brief/drawer/resize guards and independently
  restored ticker and sort defects; marketing owner reproduced all eight guards.
- Independent review found history mutation/empty-list focus gaps and a dark
  verification-field background. Corrected both. Restoring the empty-history,
  initial-focus and contrast defects made their guards fail; reapplying passed.
  Final independent review found no blockers (86 focused tests passed).

### Local browser evidence and limits

Used an ephemeral Vite fixture outside the repository, importing current source
with a mocked research controller, feed and admin identity; live Supabase imports
were replaced and CSP restricted connections to localhost. No provider call,
account operation or production write was performed.

- At **786 × 977**, reading area **275.9px**, composer/follow-up area **177.2px**;
  the earlier deployed observation was 67.4px. This is local fixture evidence,
  not a new production measurement.
- At **375 × 812**, processing-state reading area **343.8px**, panel width 375px.
  At **1440 × 1000**, reading area **569.8px**, panel width 518.4px.
  The retained draft survived viewport changes.
- Focus menu keyboard open/arrows/Escape, model Escape without closing AI,
  history initial focus, confirmation Cancel focus, cancellation restoration and
  Escape were exercised. Save warning and Reload cleared via the offline fixture.
- Row Enter opened Record; Space toggled it off. Drawer Shift+Tab wrapped to
  its last button; Escape restored its opener and removed background inertness.
- Coverage resolves to the real `coverage` section. Signup ArrowLeft wrapped to
  Academic. The carousel stayed on Legislative with keyboard focus for longer
  than its six-second timer. Admin End selected Academic; closed mobile nav was
  inert/hidden, opening focused Overview and Escape restored Open menu.
- Recovery heading computed `rgb(19,19,19)` on the light card. Verification-field
  contrast and plan-radio behavior were exercised in focused tests without
  creating an account or changing credentials.
- File chooser automation was unreliable and did not establish pending state;
  an explicit offline processing fixture confirmed visible status beside the
  composer and disabled removal. Actual materialization/admission/races were
  verified in controller/helper tests, not an end-to-end live upload.
- Development HMR in the ephemeral fixture emitted duplicate-root warnings
  while its entrypoint was edited. These are fixture warnings, not production
  observations. Browser viewport override was reset and the temporary tab closed.

UI enhancement choices remain with the owner. Broader Live TV/Nuclear tab
patterns are tracked as F61; file size/admission policy as F62. Existing corpus,
payment and PDF profiling follow-ups stay in their existing open-work entries.
The UI branch is retained locally; main, production and remote branches are unchanged.
