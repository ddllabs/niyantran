# F65 implementation plan

> **Status: Living.** Local `task/f65-research-flow`, based on `91728a6`.
> [Spec](../specs/2026-10-04-research-flow.md). Supervisor works sequentially.

1. Restore source inline numbers and one action in `SourceList.jsx`; update
   `ChatPresentation.test.jsx` and source tests with a failing guard first.
2. Extract disclosure presentation into `ResearchFlow.jsx`; keep ticker
   orchestration/step filtering in `ActivityTicker.jsx`. Actual steps enter via
   props; usage is the existing `m.usage`/`stream.usage`, not a new API.
   Rewire panel/message and focused tests. Diagnostics use native details.
3. Replace superseded styles in `chat-presentation.css` with connected timeline,
   source surfaces and summary hierarchy. No global CSS. CSS motion gate: tens
   of turns/day, state indication; only active glyph animates. Pointer-only
   160ms caret transition, instant keyboard toggles; no content entry animation.
4. Verify focused red/green, full `npm test`, `npm run lint`, `npm run build`,
   `git diff --check`; offline browser and code/motion review. No library/server
   edits, so Deno/router/SQL suites not required for this increment.
5. Record exact evidence, commit locally and keep task branch for owner review.
   No push/deployment. Leave the normal localhost server running for the owner.

## Evidence

Implemented locally in `f47ccb4` on 2026-10-04, pending owner review and landing.

- Red: `npm test -- src/ai/ChatPresentation.test.jsx src/ai/ResearchFlow.test.jsx`
  failed for the extra Cited passages disclosure and missing new flow module.
  `npm test -- src/ai/ActivityTicker.test.jsx` additionally failed for a legacy
  requested-only model, before its summary guard was corrected.
- Focused green: the five presentation/source/ticker/component suites passed
  63 tests before the additional legacy regression guard.
- Final `npm test`: 129 files, 2,083 tests passed, exit 0.
- Final `npm run lint`: exit 0, no errors or warnings.
- Final `npm run build`: exit 0. Existing warnings remain: deskBrief has both
  static and dynamic imports; generated chunks exceed 500 kB.
- `git diff --check`: clean. No standalone type-check exists.
- Real-component offline browser: 320, 375, 768, 1024 and 1440px widths, 977px
  height; no horizontal overflow in the chat or flow. Light/dark source surface
  checked, border 0px. Technical details default closed. Native Enter toggles
  both disclosures; keyboard caret transition computed 0s. Pointer caret
  transition computed 0.16s. Completed glyph animation none; active search had
  exactly one current stage and an opacity animation. Actual query, returned
  count, and measured ms displayed. Source row selected citation 1 and opened
  Work mode. Fixture document unavailable is expected: no real document/provider
  calls are made. Stop exercised with the isolated simulated stream.
- Hot reload of the temporary fixture produced duplicate-createRoot warnings;
  a fresh fixture tab had no error/warning logs. Fixture files remain outside
  the repository. Screenshots: `/private/tmp/f65-research-flow.jpg`,
  `/private/tmp/f65-sources.jpg`, `/private/tmp/f65-research-dark.jpg`.
- Reduced motion reviewed in CSS, not emulated through OS preferences: active
  animation disabled with static opacity 1; caret transition disabled. Runtime
  streaming/state checks used synthetic events; no live provider timing or
  private reasoning prose was verified or added.
- Diff review: source navigation preserved, no nested interactive controls,
  no server/dependency edits, unknown/negative token counts omitted, zero kept,
  failed/cancelled actions do not claim returned passages. Exact model IDs and
  diagnostic grids confined to native Technical details. Requested-only model
  turns retain their summary. No production integration writes.

### Motion review — Approve for local review

| Before | After | Why |
| --- | --- | --- |
| Undifferentiated activity details | Static connected stage icons and result badges | Makes actual progress readable without moving text |
| Plain disclosure caret | 160ms transform for pointer, instant for keyboard | Confirms pointer interaction without delaying keyboard use |
| Active dot | Opacity pulse only while working; static when completed/reduced motion | Communicates ongoing work without layout or reading movement |

Ingredients: existing Lucide icons and CSS opacity/transform, no new runtime.
Feel check: active work is visible, completed answers are quiet, interruption
and keyboard toggles remain immediate. F66 recovery and backend telemetry
publication are deliberately outside this increment. No push/deployment.


## Owner annotation amendment, 2026-10-04

Sequential write scope: ticker/flow, scoped CSS, their focused tests and F65
docs/tracker. Remove tinted summary surface, then remove Technical details and
unused diagnostic aggregation, showing exact model ID/requested effort at top.
Update superseded tests while preserving failed/missing/zero action guards.
Verify red/green, full Vitest, lint/build and offline browser; commit locally.
F67 backend telemetry is a read-only finding; no deployment or backend change.

Amendment verification:
- Red: focused ResearchFlow/ActivityTicker guards failed for the remaining
  Technical details and missing visible model ID; 47 focused tests green after.
- `npm test`: 129 files, 2,083 passed. `npm run lint`: exit 0, no warnings.
  `npm run build`: exit 0, unchanged deskBrief mixed-import and large-chunk
  warnings. `git diff --check`: clean.
- Fresh offline real-component fixture: computed summary background transparent,
  exact model ID and Thinking: Low visible; zero technical disclosures. No chat
  overflow at 375/1095px. No warning/error console entries. Screenshot
  `/private/tmp/f65-summary-amendment.jpg`. No provider calls or saved user
  conversation inspected. Removed obsolete diagnostic table tests in favor of
  guards for the amended UI; token/action safety guards remain.
- Read-only finding: research-chat `sendTerminal` uses
  `Number(row.usage?.reasoning_tokens) || 0`, collapsing missing into zero. The
  real annotated turn's actual provider usage is unverified. F67 tracks the
  backend correction; it was not changed or deployed here.
- Same local task branch, no publication. Normal localhost server retained.


## Inline model and suggestion-pill amendment

Sequential scope: ActivityTicker, SuggestionPills, scoped CSS, focused tests and
F65 docs. Replace the third header line with inline version/ID tooltip. Restore
all suggestions as horizontally scrolling pills, retaining draft-only picking,
held/disabled behavior and labelled-list semantics. Verify red/green, full tests,
lint/build, browser narrow/desktop and third-pill draft selection. No backend.

Pill amendment evidence: the new no-disclosure/all-three-buttons guard failed
before implementation; focused suites passed 15 tests after. Final `npm test`
passed 2,084 tests in 129 files; lint passed without warnings; build passed with
existing mixed-import/large-chunk warnings. `git diff --check` clean. Offline
real-component browser at 375/1095px: flex pill row, 999px radius, all three
buttons, no disclosure and no panel overflow. Third question filled/focused
the draft, retaining one user message (no send). Exact-ID tooltip/version
verified by markup guard. Screenshot `/private/tmp/f65-inline-pills.jpg`.
No backend changes, provider calls, push or deployment.

## Message identity/action amendment

Sequential scope: MessageRow/MessageActions, ticker icon wrapper, scoped CSS,
focused tests and F65 docs. Red/green for removed visible labels and named
icon-only Copy. Preserve copy reference payload/error reporting; clean up the
success-reset timer on unmount. Full tests/lint/build, offline browser success,
reset and failure checks. No backend or publication.

Message amendment evidence: both new label guards failed before implementation;
6 focused tests passed after. Final `npm test`: 129 files, 2,085 passed. Lint
passed without warnings; build passed with the existing mixed-import and large
chunk warnings; `git diff --check` clean. Real-component offline browser confirmed
empty Copy button text, accessible Copy answer/Answer copied names, check icon
after successful copy and reset to Copy after two seconds. Simulated clipboard
rejection kept the visible failure message. User bubble contained the question
and original timestamp without You. Theme-aware lavender badge observed.
Screenshot `/private/tmp/f65-message-icons.jpg`; no live provider calls.
Review: reference-copy content unchanged, timer cleanup on unmount, no extra
identity row or answer background. Existing active-only motion retained.
