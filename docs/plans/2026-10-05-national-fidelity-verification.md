# National fidelity continuation: local verification

> **Status: Historical (2026-10-05).** Evidence for the reference fidelity continuation on `task/national-landing-redesign`; not a production release or owner acceptance.

Local product commit: `6aefc5a`. Working tree clean after the accompanying evidence commit.

## Changed scope

National view, scoped styles, original owner SVG artwork and a parent motion controller; shared desk rail, module strip and four-line shell integration; focused presentation/rail guards; spec, plan and tracker. Summary APIs, feed shaping, module workspaces, account/entitlement callbacks and data packs are unchanged in this continuation. Global/State landings were not redesigned.

## Executed commands

- `npm test`: 138 files, 2,118 tests passed. Run before final motion/layering corrections; focused checks repeated after them.
- `deno test -A --config supabase/functions/deno.json supabase/functions`: 862 passed, 0 failed.
- `npx vitest run src/desks/NationalLandingView.test.jsx src/shell/DeskRail.test.jsx src/lib/deskLanding.test.jsx src/desks/useNationalLanding.test.js src/lib/nationalLandingSummary.test.js`: five files, 13 tests passed after final source changes.
- `npm run lint`: passed, no warnings.
- `npm run build`: passed. Existing mixed static/dynamic `deskBrief.js` import and >500 KB chunk warnings remain.
- `git diff --check`: passed.
- Guard proof: old remove-on-filter behavior failed the new inert/context test (1 button instead of 12). Temporarily selecting Home instead of the actual desk failed the rail active-label assertion; restored code passed. An initial weaker rail assertion did not catch this mutation and was strengthened before reliance.

## Browser executions

Local ignored layout harness imports the actual National view, sibling landing dispatcher, DeskRail and DeskNav. Data uses existing local `/api/national-landing` source summaries. Harness module callbacks display the selected canonical module; it is not an authenticated production workspace.

- Widths 1440, 768 and 360: document scroll width equals viewport width, no horizontal page overflow. Desktop rail width104, tablet80; phone rail becomes a56px horizontal strip. Module buckets remain above content.
- Original Parliament and all five tile scenes rendered; corrected the reference's `mics` asset-key mapping to the presentation's `microphones` name.
- Fine-pointer card interaction showed a matrix3d tilt, reference lift shadow and tile zoom (~1.05 during transition to1.06).
- Searching `affidavit`: 12 modules remain in context,11 inert/aria-hidden and exactly1 matching module in accessible navigation.
- Coverage button exposes fields, real limitations/date/source link; Escape hides popup, collapses button and restores main module focus. Hover/focus card layering is z10 over adjacent cards.
- Pause immediately after reload while all five cards still had `nl-card` entrances: root motionoff, all card opacity1/transformnone, hero opacity1, animation play statepaused. Resume returned motionon; offscreen tile remainedpaused.
- Global and State rail selections render the unchanged standard landing; returning National renders the redesigned component. Canonical callbacks and lock checks are preserved by source inspection, not an executed signed-in route test.
- Both themes checked; dark backdrop opacity override corrected at responsive widths.
- Console warning/error log at final capture was empty. Viewport override reset and local preview retained.

## Independent review

`ui_shell_desks` read the current spec/plan and source without edits. It identified popup stacking, pausing during entrance and offscreen-node pausing issues. Supervisor corrected them, reproduced early Pause and Escape behavior in the browser, and reviewer reported no remaining code blockers. Reviewer independently ran the two presentation/rail suites (4/4) and whitespace check; it did not claim browser evidence.

## Explicit limits and remaining acceptance

- Signed-in full shell route/Back/entitlement checks require a local authenticated session. No auth bypass or fake signed-in account was used.
- Native200% browser zoom did not activate in the in-app browser; Chrome connection timed out. Viewport testing is not claimed as actual200% zoom.
- Actual OS reduced-motion and document-hidden runtime states remain unexecuted. CSS and the visibility-change listener were reviewed. Opening another in-app tab left `document.hidden=false`, so that experiment is not evidence of hidden-tab suspension. Manual pause/offscreen suspension did execute.
- Touch disclosure uses an explicit button, but touch-device hover capability was not emulated; 360px width is not proof of a coarse pointer.
- Unsupported reference modules, fabricated totals/freshness, count-up numbers and snapshot-as-live pulses are intentionally omitted. The current reference has17 National modules, while production has12. Exact-copy claims must exclude these data-driven differences and the approved shared rail.
- No push, deploy, PR, main integration or data publication performed. F81 remains open for owner acceptance and remaining runtime gates.

Preview: `http://127.0.0.1:5174/tmp/national-preview.html`. Screenshot: the task visualization directory's `national-fidelity-preview.png`; harness is ignored and is not production content.
