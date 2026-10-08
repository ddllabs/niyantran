# Desk v6 shell repair

**Status: Living — owner approved and included in existing goal on2026-10-08; local implementation verified; authenticated/manual acceptance pending.**

## Problem and outcome

Owner reported deployed header misalignment and exposed cream space below all desk landings at1416×977. Reference: Downloads/nter-all-sections-v6.html, header markup131–136 and responsive rules83–91. Current application header has four direct groups but inherits three grid columns. Desktop auto-placement sends account controls into an implicit row. Live inspection at718×977 also shows workspace ending at977 but main-col ending at643.4; background-only repair would not establish correct content geometry. The one-column guide workspace still mounts SidePanel: verify computed grid rows and visibility before selecting the repair.

Match reference hierarchy while retaining production controls. All sections and Find a module are genuine reference features; move them into a coherent utility group. Preserve source data, imagery, card sizes, interactions, terminal routes, access policy and AI state.

## Layout contract

- Wide desktop: one aligned header row, brand left, compact desk navigation next, utilities right: All sections, Find a module, existing language/TV/account controls. Header height remains68px when it fits. No implicit grid rows or overlapping controls.
- Intermediate widths: deliberate two-row header; brand and utilities above, horizontally scrollable desk navigation below. Switch based on measured fit, including all eight desks, upgrade labels and Hindi labels; do not assume the mock's1150px threshold accommodates production controls.
- Narrow widths: explicit compact arrangement with reachable search/directory/account controls; no document horizontal overflow. Preserve language control and existing logout/profile access. Navigation alone may scroll horizontally. Verify200% native zoom.
- Landing workspace fills remaining viewport height. Desk surface covers that area; compact content stays compact, with ordinary whitespace below when short. Long content scrolls in one deliberate container with reachable footer/popups. No fixed content height or enlarged cards to fill the window.
- Keep module workspace layout separate. Side-panel hidden state consumes no landing grid track; opening AI uses an explicit layout. Do not unmount an active chat merely to repair geometry: drafts, threads and streams must survive landing/module navigation.

## Ordered tasks and write scopes

1. **Reproduce and freeze baseline.** Read-only scope: TerminalShell.jsx, SidePanel.jsx, index.css, deskDirectory.css and reference. Capture DOM bounding boxes/computed rows at1416×977,1700×1000,1024×768,768×977,360×800; landing, module and AI-open states. Acceptance: identify actual row/background cause, capture failing assertions for header overlap and viewport fill before fixing.
2. **Header slice.** Scope: src/shell/TerminalShell.jsx, src/shell/deskDirectory.css and focused shell test (reuse existing or add src/shell/deskShellLayout.test.jsx). Dependencies:1. Group/place controls explicitly and integrate desk navigation into the reference hierarchy. Preserve callbacks, shortcuts and account behavior. Acceptance: wide one-row header; deliberate responsive rows; no duplicated navigation or inaccessible controls. Verify focused tests and real-browser geometry before continuing.
3. **Workspace slice.** Scope: narrow guide-mode selectors in src/index.css and src/shell/deskDirectory.css; TerminalShell.jsx/SidePanel.jsx only if baseline proves a lifecycle-safe change necessary. Dependencies:1–2. Acceptance: full remaining viewport surface, no unintended grid rows or cream strip, single intended scrolling region; module panels/AI-open and restored chat state unaffected. Verify short/long landings and landing→module→Back with chat draft.
4. **Integrated acceptance.** Scope: this plan and docs/plans/open-work.md, necessary focused regressions only. Dependencies:2–3. Check all eight desk landings, permitted/restricted modules and Home;360/768/1024/1416/1700 widths, light/dark and English/Hindi labels. Check directory/search keyboard opening, Escape/focus restoration, profile and Live TV placement, native200% zoom, long module list and popup scroll. Assert geometry, not only page overflow: account controls contained in header, aligned centers on desktop, tabs below responsive header, workspace/main surface reaches viewport bottom. Run npm test, npm run lint, npm run build and git diff --check; Deno suite if src/lib/admin/supabase changes become necessary (currently excluded). Independent review and owner preview required before claiming acceptance.

## Delivery and exclusions

Work sequentially on current task/desk-v6-state after plan approval, with separate verified header/workspace checkpoints. Do not modify other desk data or repair unrelated feeds. No auth/billing/provider/database changes. No push/deployment/main merge unless separately authorized for this repair. Existing broader goal's native motion/touch/STT gates remain open. Record implementation commit hashes and exact runtime results here and under F91; do not call a green build visual acceptance.

## Goal amendment

Owner explicitly included F91 in the existing R0–R7 goal and authorized completion on2026-10-08. State implementation/appearance acceptance is retained as an additional delivered slice. F91 is required for closure alongside the remaining native touch/coarse-pointer, reduced-motion/hidden-tab and live microphone acceptance checks. No new goal is created; the tool's objective is immutable while unfinished, so this document and the sole open-work tracker record the amendment. The owner was asked to restore the local signed-in browser session and report remaining manual checks; independent controlled-fixture work continues meanwhile.

## Local candidate evidence — 2026-10-08

Implemented header utility grouping and moved the shared desk tabs into the header. Wide screens use one row; intermediate screens deliberately put desk tabs below utilities; narrow screens use explicit compact utility rows. Hidden side panels no longer reserve a second landing workspace row. Light/dark main surfaces and the landing minimum height cover the viewport. The mobile account menu follows its trigger rather than the old fixed54px anchor. SidePanel and AI lifecycle code are unchanged.

Executed verification:
- New TerminalShell hierarchy regression failed before the repair (1failed/3passed), then passed. Independent shell/directory/frame checks:15passed.
- `npm run lint`: passed. `npm run build`: passed in2m58s; existing chunk-size/mixed-import warnings remain.
- Full default-worker runs encountered unchanged5s PDF timing failures (first also a deskRowsFeed timeout). Focused `npx vitest run src/lib/corpusUpload.test.js`:71passed without increasing timeout. Final `npx vitest run --maxWorkers=1`:184files/2465tests passed in101.25s.
- `git diff --check`: passed.
- Controlled browser fixture renders real shell/components with a mocked account/entitlement provider; it is not authenticated deployment acceptance. All eight landings checked at360/768/1024/1416/1700/1900×977. Together with additional Hindi samples,59geometry observations have no document overflow, misplaced account row or workspace/main-bottom failure. At1416, header bottom92, utilities bottom45.5, main/workspace bottom977. At1900 the header is one row. Light/dark surface checked. Mobile profile menu at360: x18,y130.5,width330,bottom410.4 within viewport977. Search and directory open, Escape closes and restores trigger focus. LiveTV opens and its Close control works at718px; fixture broadcast APIs are unavailable, so playback is not claimed. Opening AI on a module and navigating to a landing retains its mounted selected panel; the authenticated composer remains disabled in this fixture.
- Temporary geometry artifact: `/private/tmp/shell-repair-geometry.json`; screenshot: `/private/tmp/shell-repair-1416-final.png`. Temporary fixtures/artifacts remain untracked.

Not yet executed: authenticated local chat draft/stream survival, free-plan Upgrade-label fit, native200% zoom of this repaired shell, touch/coarse pointer, reduced-motion/hidden-tab behavior and live microphone transcription. The controlled fixture cannot submit AI because it has no authenticated session; it does not replace these checks. Local sign-in/manual checks were requested from the owner. No publication or goal-complete claim until required acceptance is obtained.

Independent final re-review found no code blocker, verified the profile anchor and all59geometry observations. Authenticated/manual gates remain open. Local checkpoint is not publication or owner acceptance.

## Authenticated follow-up — 2026-10-08

Executed signed-in local checks using the owner-authorized test account. English/free-plan Upgrade labels fit at360/768/1024/1416/1700/1900 widths; workspace/main reaches the viewport bottom without document overflow. Hindi samples fit at360/1024/1416/1900; a requested768 observation returned actual360 and is excluded. A real chat composer draft survived module→National landing→browser Back with its exact value; the test draft was then cleared without submitting a chat message. Landing desk navigation was also measured at360×780: static position, top127/bottom163, contained in the header rather than at the bottom.

Additional commands: `deno test -A --config supabase/functions/deno.json supabase/functions`:862passed; `node scripts/verify-desk-v6-assets.mjs`:41 byte-identical assets/40 named images/9 configurations passed; router import passed. No application source changed during these checks.

Live microphone attempt at127.0.0.1:5174 failed with browser `Failed to fetch`. Read-only live OPTIONS probes show that origin receives no Access-Control-Allow-Origin, while localhost:5173 receives its matching header. Client and transcription function files have no diff from main; the configured Supabase→OpenRouter model is openai/whisper-large-v3-turbo. Started the same candidate at the already-allowed localhost:5173 origin. Owner explicitly deferred the voice test until later; cancelled pending dictation. No provider, production settings or CORS changes made. Live transcription remains unverified.

Native Chrome reduced-motion emulation was selected, but page behavior, touch/coarse pointer, hidden-tab behavior and repaired-shell native200% acceptance are not yet proven. Native window access subsequently reported no available windows; do not count that attempt as acceptance. Owner could not recall the page with a bottom navigation issue and suspected an older version; no reproduced additional defect is claimed. Owner authorized updating the branch preview for review. Main/production merge remains outside this publication scope.

## Final candidate acceptance amendment — 2026-10-08

Actual Chrome now verifies shared native200% header/popup scroll, reduced-motion state, an intentional coarse-pointer sector/module tap and hidden-tab pause/recovery. Exact coverage, excluded AX attempts, independent review, unchanged P12 dependency risk and rollback are recorded in [the release candidate](../plans/2026-10-08-desk-v6-release-candidate.md). This supersedes prior pending native checks; live voice remains explicitly owner-deferred. Candidate code is ca70175; main publication and cleanup await the owner.
