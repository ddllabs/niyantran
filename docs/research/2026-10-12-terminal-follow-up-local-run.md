# Terminal follow-up local execution

> **Status: Historical (2026-10-12).** Executed evidence for the three owner-approved specs. Local task branch only; owner acceptance remains pending.

## Outcome and exact scope

Implemented sequentially on `task/terminal-follow-up` from local main `7c38800`.
Main was not changed. No push, deployment, production mutation, remote branch
removal or worktree pruning occurred.

- Discovery `66c7944`: src/desks/landing/DeskLandingFrame.jsx,
  deskLandingV6.css, DeskLandingFrame.test.jsx and discovery spec. Optional
  collapsed native disclosure below the 35 picture cards exposes all 120
  modules through per-sector accordions and canonical direct links. Sources
  filter affects picture cards only. Approved defaults are unchanged.
- Header `540f99d` / `12a148c`: src/shell/TerminalShell.jsx,
  TerminalShell.test.jsx, Icons.jsx and header spec. Disabled bell removed;
  its unused declaration removed after a reference search. Info remains used
  by AnalyticsViz. Refresh is hidden on eight landings; Home/workspace refresh
  remains. Theme uses sun/moon and explicit next-action labels.
- Free access `ec89cdc`: src/lib/planEntitlements.js and server test;
  src/lib/signupFlow.js and test; src/marketing/SignupPage.jsx, new
  SignupPage.test.jsx and uiDefects.test.jsx; src/shell/TerminalShell.jsx and
  test, DeskDirectory.jsx and test, RestrictedDeskRoute.jsx; src/App.jsx and
  App.gate.test.jsx; free-access spec. All authorized signed-in accounts get
  known desks, copying/export and all available rows without commercial caps.
  No Upgrade modal or signup plan step. Unknown desks and inactive/absent
  accounts remain denied by capabilities. Identity/profile, admin and persona
  boundaries remain; stored entitlements and AI quotas are unchanged.
- Documentation: capability map, implementation plan, this evidence, an
  explicit amendment to the normative 2026-10-07 foundation spec, and only
  this task's F96–F99 tracker entries. F99 records excluded marketing copy and
  retired commercial UI inventory; no broader removal was performed.

Independent read-only review identified an App subscription wait that could
block entry indefinitely despite free capabilities. Removed that wait and
made signup's entitlement refresh nonblocking; TerminalShell still refreshes
subscription facts in the background. Independent re-review found no remaining
blocker in the reviewed diff. It was source review; execution below was done
by the supervising agent.

## Executed checks

| Command | Outcome |
| --- | --- |
| `npm test` | 185 files, 2,504 tests passed |
| `deno test -A --config supabase/functions/deno.json supabase/functions` | 880 passed, 0 failed |
| `npm run lint` | Passed, no warnings |
| `npm run build` | Passed; existing bundle-size warning remains |
| `node scripts/verify-desk-v6-assets.mjs` | 41 byte-identical assets, 40 named images and 9 visual configurations passed |
| `git diff --check` | Passed |

Focused discovery/header and free-access/auth/signup checks passed before the
full suite. Guards were first executed against the previous behavior: the
new UI assertions failed (9 failures), free-access policy assertions failed
(12 failures), the legacy signup metadata assertion failed, and the pending
entitlement App entry assertion failed. They then passed with the changes.
Existing verification contrast and persona keyboard tests remain; their state
fixture was adjusted to the removal of plan-selection state.

Build warning: main chunk approximately 2,498.56 kB (gzip 681.15 kB), above
Vite's existing 500 kB warning threshold. This task did not address splitting.
There is no standalone type-check. Router import/SQL fixtures were not needed:
this task changed no api/, server/, Supabase or SQL file. Deno covered the
working checkout, including the owner's pre-existing corpus changes; those
changes were neither edited nor committed by this task.

## Browser execution and limits

Fresh isolated headless Chrome profiles against local fixtures on port 5180;
real landing components, shell, App, SignupPage, DeskView, HomeDesk and Budget
workspace. Auth, entitlement RPCs, summaries, external feeds and AI provider
calls were mocked at service boundaries. No real account/payment/AI operation
was executed. Browser scripts and raw logs are temporary evidence under
`/private/tmp/niyantran-follow-up/`, not durable source dependencies.

- All eight landings: National 17, Global 16, Law 12, Economics 11,
  Carbon 7, Sports 8, Entertainment 8, State 41 module links. Each of the
  120 links was clicked and returned to the landing without a popup.
- All 35 picture cards clicked; canonical destinations matched their hrefs.
  Unit checks independently assert approved default mappings.
- 32 real-shell landing cases: eight desks × free/trial/paid/expired metadata;
  no Upgrade labels, disabled bell or landing refresh. All desks remain in
  directory/search; deep links and browser back/forward worked.
- Unresolved entitlement RPC: real App rendered National and real signup
  entered without waiting. Legacy paid-plan signup URLs submit free metadata;
  session/verification/error paths covered by event-handler tests and browser
  enter/verify flows. Google provider service itself was not invoked.
- Free-account ordinary Economics workspace and shell feed retained 55 rows.
  Native clipboard copied a record and the existing downloadJson export
  downloaded all 55 rows. Normal copy events were not intercepted. Export
  failure handling remains existing code; no production export was attempted.
- Real Home rendered fixture update 1, then refresh fetched fresh=1 and
  rendered update 2. Ordinary workspace refresh reloaded its feed. Specialized
  Budget workspace rendered its curated page; refresh reloaded the feed
  envelope without pretending its curated static tables became live.
- Native disclosure keyboard Enter/Tab, modified module click opening the
  canonical new tab, theme toggles both directions, 320/390/1440 widths,
  reduced motion and 200% CSS body zoom passed. Native browser zoom and an
  emulated coarse-pointer/touch-specific session were not executed.
- AI inside clicks remained open; outside clicks and landing return closed
  it. Draft retention checked in all eight desk contexts using a stateful
  mocked AI child and real panel lifecycle. Real model streaming was excluded.
- No JavaScript page errors in the matrix; shell matrix reported no console
  errors/warnings. Desktop/light and mobile/dark captures were visually
  inspected after animations settled. Mock counts are fixture counts.

## Corpus preservation and Git boundary

Before planning, 94 existing dirty paths were hashed. All 93 paths other than
open-work.md retained their exact SHA-256 hashes. Removing only this task's
tracker inserts reproduces the original tracker hash exactly. No corpus path
was staged. The tracker index candidate was reconstructed from HEAD with only
F96–F99 additions, preserving the original corpus tracker diff in the working
checkout. Commits use explicit UI/test/doc paths; no generated artifacts,
credentials or environment files were included.

The original application on port 5173 remains available for owner review.
Public pricing still advertises five core desks and retired commercial UI
files remain outside scope; F99 records the follow-up. AI controls, billing
history, corpus work and the reference deployment issue F94 remain untouched.
