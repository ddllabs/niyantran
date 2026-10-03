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

Implemented locally on 2026-10-04, pending owner review and landing.

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

