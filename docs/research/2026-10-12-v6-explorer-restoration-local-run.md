# V6 explorer restoration local execution

> **Status: Historical (2026-10-12).** Owner-requested correction implemented in 70267e8 on task/terminal-follow-up; owner acceptance remains pending.

Restored the original V6 selected-sector explorer using the local
Downloads/nter-all-sections-v6.html explorer/renderModules and application
component immediately before 9fe245e. The left sector heading, description
and coverage badge, right icon/title/count/coverage/arrow module cards,
responsive grid and reveal/theme styles are reused. Removed the replacement
accordion and its CSS. Owner chose to retain direct picture-card defaults
and add a native labelled sector select inside the explorer. Text cards now
open canonical workspaces directly without the module popup. Data-breakdown
dialog and shared ModuleDetail remain unchanged.

Changed application scope: DeskLandingFrame.jsx, deskLandingV6.css,
DeskLandingFrame.test.jsx and deskDefaults.test.jsx. The latter's no-picker
assertions now target the picture grid specifically; restoring the independent
lower component does not alter direct picture-card entry. Current discovery
spec and foundation amendment now identify the restored explorer as authority.
Earlier dated execution evidence is retained as history.

## Executed evidence

- RED restoration checks: 3 failed / 9 passed against the replacement
  accordion; the visible explorer guard failed before implementation.
- Focused discovery/default/catalogue: 29 tests / 3 files passed.
- Final `npm test`: 2,506 tests / 185 files passed.
- `npm run lint`: passed, no warnings.
- `npm run build`: passed; existing >500 kB chunk warning remains.
- `node scripts/verify-desk-v6-assets.mjs`: 41 byte-identical assets,
  40 named images, credits and 9 visual configurations passed.
- `git diff --check`: passed. Independent read-only review against the
  original component/reference found no concrete regression or blocker.
- Browser traversal: all eight real landing components, 35 sector selections,
  exactly 120 unique module links clicked into their canonical destinations,
  and all 35 picture-card defaults clicked. No module popup appeared.
- Source-filter toggle retained every selector option and selected sector.
  Honest zero/missing/source-count distinctions passed the component test.
- Every desk fit 320/390/768/1024/1440 widths without horizontal overflow;
  both themes rendered. Native keyboard typeahead changed sector and Enter activated
  a module link. Cmd-click opened its exact canonical URL in a new tab and
  retained the parent landing. Data-breakdown dialog still opened/closed.
  Reduced motion and 200% CSS body zoom passed; native browser zoom was not run.
- AI inside/outside/landing-dismissal and draft retention passed across all
  eight desk contexts with real panel lifecycle and a stateful mocked AI child.
- Final desktop/light and mobile/dark captures were visually inspected. No
  JavaScript page errors were recorded in the traversal/keyboard checks.

Browser service boundaries used isolated summaries/auth/feed/AI fixtures on
port 5180, as in the earlier follow-up verification. No live account/payment,
provider call or production mutation was exercised. State used its real
landing presentation/41 canonical destinations; no State context/data code
changed. Native coarse-pointer/touch and real AI streaming were not executed.
Raw logs/scripts/captures are temporary under
/private/tmp/niyantran-explorer-restoration/. An initial modified-click check
waited for a popup event rather than the browser context's background-page
event; the corrected check executed successfully. This was a test harness
correction, not a navigation code change. Native select typeahead was used
for the final keyboard sector-change proof; the headless macOS arrow-menu
sequence did not commit a new selection. Same-tab entry was checked against
the canonical hash rather than assuming the fixture HTML path disappeared.

## Preservation and Git

All 94 pre-existing dirty paths were rehashed. All 93 non-tracker paths are
byte-for-byte unchanged; removing only F100 additions restores the original
tracker hash. Tracker staging was reconstructed from HEAD with only F100;
pre-existing corpus tracker content stays unstaged. Main remains 7c38800.
No corpus files, data, approved defaults, header, access/auth, backend or AI
policy were changed. Deno/SQL/router checks were not required for this UI-only
correction. No merge, push, deployment or worktree/branch cleanup occurred.
The application on 5173 remains available for owner review.
