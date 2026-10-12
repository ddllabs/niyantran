# Terminal follow-up implementation plan

> **Status: Living.** Owner authorized implementation on 2026-10-12.
> T0–T6 completed locally on task/terminal-follow-up; owner acceptance remains pending.
> No push, deployment or main merge in this task.

Index: [approved capability map and Git inventory](2026-10-12-terminal-follow-up-capabilities.md).
Specs: [discovery](../specs/2026-10-12-desk-module-discovery.md),
[header](../specs/2026-10-12-terminal-header-controls.md),
[free access](../specs/2026-10-12-free-desk-access.md).
Open items: F96–F98 in open-work.md; that file remains the sole work tracker.

## Integration contract

Work sequentially on task/terminal-follow-up created from local main 7c38800
before implementation. No extra merge is needed. Keep all existing corpus
modifications in place; do not stash, reset or stage them. Snapshot every dirty
path and the shared tracker before each implementation/commit/merge. Stage
exact assigned UI/test/document paths only; inspect staged diff before commit.
The new planning entries are additive to the tracker, whose pre-existing
corpus content must remain byte-for-byte intact.

Shared interfaces: canonical presentation groups define every restored module;
deskHash/onFeature define routes; deskDefaults stays unchanged. Header reads
existing v6Landing/theme/reload state. Free-access helpers change commercial
capabilities, not authentication or stored subscription truth. Header and
access tasks share TerminalShell and therefore must not run concurrently.

## Completed tasks

### T0 — Establish implementation baseline and boundary audit

Dependencies: owner approved all three specs and this plan before implementation.
Write scope: this plan and the three specs only, if evidence needs correction.
Read all capability consumers and signup/upgrade/export entry points; locate
active normative commercial docs without changing historical records. Confirm
known-desk validation and app account/auth boundaries. Re-snapshot corpus and
run the relevant existing focused tests before modifying behavior. Stop and
amend scope if the audit requires backend or marketing changes. No production
queries or writes. Deliver evidence and exact revised scopes before T1.

### T1 — Restore direct module discovery (F96)

Dependencies: T0. Write scope (3 files):
src/desks/landing/DeskLandingFrame.jsx, deskLandingV6.css and
DeskLandingFrame.test.jsx. Add the global disclosure and per-sector accordions;
reuse groups, summaries and canonical href handling. Acceptance: all 120
direct module links available after expansion, all 35 defaults unchanged,
source filter independent, no module popup, accessible responsive layout.
Verification: discovery spec focused command; browser eight-desk traversal,
keyboard, modified clicks, both themes, 320/390px, zoom/reduced motion.

### T2 — Make header controls meaningful (F97)

Dependencies: T1 verified. Write scope (at most 3 files):
src/shell/TerminalShell.jsx, Icons.jsx if required, TerminalShell.test.jsx.
Remove bell, condition refresh visibility on route, add sun/moon and explicit
next-action labels. Acceptance: eight landing headers hide refresh; Home/module
controls retain their behavior; theme toggles both ways with correct labels.
Verification: header spec focused command and actual browser refresh/theme
clicks. Search remaining bell/info references before deleting any icon case.

Checkpoint A: verify T1/T2 together, lint/build, compare corpus hashes and
review diff. Commit discovery and header separately after verification; no
corpus content enters either commit. Owner can review the visible UI before
the commercial capability policy is activated.

### T3 — Decouple desk capabilities from paid plans (F98)

Dependencies: checkpoint A and T0 boundary audit. Write scope (2 files):
src/lib/planEntitlements.js and planEntitlements.server.test.js.
All authorized signed-in fixtures get known desks, uncapped available feed
rows, copying and exporting. Keep stored entitlement truth unchanged; do not
grant fake paid status. Acceptance: free/trial/expired/loading/paid fixtures
and every persona have consistent capabilities, unknown desk IDs are safely
handled, 41+ row feeds are preserved. Focused command:
`npm test -- src/lib/planEntitlements.server.test.js`.

### T3a — Remove subscription-metadata entry wait

Boundary audit and independent review found App still waited for subscription
metadata before rendering the terminal. Approved unavailable-entitlement
contract requires entry independently of this request. Write scope (2 files):
src/App.jsx and src/App.gate.test.jsx. Remove only this commercial wait; keep
verified identity publication, persona, marketing and admin authorization.
Regression guard failed against the old wait, then passed. Browser execution
with an unresolved RPC rendered National; signup entered with the same condition.

### T4 — Remove terminal commercial interruptions

Dependencies: T3/T3a. Write scope (5 files):
src/shell/TerminalShell.jsx, TerminalShell.test.jsx,
DeskDirectory.jsx, DeskDirectory.test.jsx and RestrictedDeskRoute.jsx.
Remove navigation/trial/clipboard/export upgrade interception and terminal
View plans/Upgrade entry points; show all desks in navigation and search.
Do not delete shared billing or restricted-route modules without a complete
reference audit and an explicit inventory amendment. Acceptance: all landing,
module, direct-link and back/forward entry paths open without paywall; copy
and export work and preserve failure handling. Focused command:
`npm test -- src/shell/TerminalShell.test.jsx src/shell/DeskDirectory.test.jsx`.

### T5 — Remove signup plan selection

Dependencies: T4. Write scope (5 files):
src/marketing/SignupPage.jsx, SignupPage.test.jsx (new),
src/lib/signupFlow.js, signupFlow.test.js and src/marketing/uiDefects.test.jsx.
The existing verification-state test follows the removed plan state; its
contrast and persona keyboard assertions remain intact.
Session-bearing signup enters; verification-required signup waits for email;
legacy plan URLs remain valid but do not start trials. Preserve persona and
Google auth. Acceptance: no normal signup trial/checkout call or plan-step UI,
and authentication error/verification states remain intact. Focused command:
`npm test -- src/lib/signupFlow.test.js src/marketing/SignupPage.test.jsx
src/marketing/loginAuthorization.test.js src/lib/localUserAuthorization.test.js`.

Checkpoint B: T3–T5 form one coherent free-access commit after full verification;
do not leave a policy-only commit presented as complete while signup/prompts
still disagree. Preserve authentication denial tests while replacing superseded
commercial denial assertions. Spec review must settle any commercial document
conflict before changing a normative rule. Historical docs are not rewritten.

### T6 — Integrated verification and review

Dependencies: T1–T5. No application write scope. Evidence/docs scope:
this plan, open-work.md and a new
docs/research/2026-10-12-terminal-follow-up-local-run.md and a supersession
amendment to docs/specs/2026-10-07-desk-v6-foundation-national.md. Any behavioral fix
returns to its owning task and reruns affected checks.

Run exactly:

```bash
npm test
deno test -A --config supabase/functions/deno.json supabase/functions
npm run lint
npm run build
node scripts/verify-desk-v6-assets.mjs
```

Run focused checks per task first. Prove each material regression guard detects
the prior defect or an intentional wrong-destination/policy mutation before
relying on its green result. Restore mutations immediately; never mutate
corpus sources. No standalone type-check exists. Router import is required only
if api/ or server/ changes are subsequently authorized; SQL fixtures are required
for authorized SQL changes and use disposable local databases only.

Browser matrix: eight real landing components, all 35 default routes and all
120 restored module destinations; free/trial/paid/expired/loading fixtures;
State context; direct links/back/forward; copy/export with 41+ rows;
signup enter/verify/legacy plan URLs with mocked auth; header behavior on
landing/Home/ordinary and representative specialized module; light/dark,
keyboard, touch, 320/390px and desktop, 200% CSS body zoom and reduced motion (native browser zoom was not executed).
Verify AI inside clicks remain open, outside clicks close, returning to
landing closes, and chat draft/history persist. Capture console failures and
network errors. Clearly distinguish isolated/mocked evidence from live auth,
payments or real AI; none of those production operations is authorized here.

Review acceptance evidence against each spec, inspect exact staged diff and
secrets, and compare all corpus hashes and original tracker text. Record
commands/results/warnings and any unverified path. This task leaves the verified commits on the requested task branch; no push, deployment, remote branch
deletion or worktree pruning. Move only completed F96–F98 entries to Done
with verified commit hashes. Do not mark owner acceptance on the owner's behalf.

## Risks and deliberately excluded work

- Large module catalogues need compact collapsed sectors rather than rendering
  every record beneath the hero; no extra record requests are allowed.
- Authentication and commercial policy are different boundaries; helper edits
  must not create anonymous access or bypass disabled/admin account guards.
- Entitlement metadata may remain for billing history and AI controls; removing
  desk payment gates is not permission to delete those systems.
- Marketing pricing copy may need later owner scope, and the separate reference
  deployment remains F94. No realtime feed implementation or branch cleanup.
- Shared dirty open-work.md requires exact staged-hunk discipline; all other
  corpus files are forbidden write/stage scopes for this initiative.

## Completion evidence

Discovery `66c7944`; header `540f99d` and unused bell declaration `12a148c`;
free access `ec89cdc`. The bell declaration had no remaining callers; info
remains used by AnalyticsViz. No broader dead-code removal occurred.
Full checks: 2,504 Vitest tests / 185 files, 880 Deno tests, lint, build and
asset verification passed. Existing build chunk-size warning remains.
[Executed browser matrix, guard failures, boundaries and preservation audit](../research/2026-10-12-terminal-follow-up-local-run.md).
All code tasks are complete locally; no owner acceptance is inferred.

## Owner preview correction

Owner rejected the accordion design after local preview and requested the
original V6 explorer component, retaining direct picture links with a sector
selector inside the explorer. F100 and the [restoration plan](2026-10-12-v6-explorer-restoration.md) supersede T1’s layout. Prior execution evidence remains dated history.
