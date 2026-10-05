# Global fidelity continuation

> **Status: Historical (2026-10-05).** Local continuation after owner “Continue”, following checkpoint `5cc1708`. No production actions.

## Reference review

Compared the supplied `nter-desk-landing-v2.html` artwork and CSS with the actual Global implementation. Corrected `src/desks/GlobalLandingArtwork.jsx` and `src/desks/globalLanding.css`:

| Before | After | Why |
| --- | --- | --- |
| Four approximate gradient pairs | Original blue, violet, teal and amber pairs | Match reference tile colors |
| Middle flag .95 opacity; satellite panels fully opaque | .85 flag; .9 panels | Preserve original vector fills |
| Radar phase offsets and symmetric pulse | 0/1.2/2.4-second phases and original ease-out fade envelope | Preserve scan/blip timing |
| Ship moved upward without roll | 3px downward bob and −1.2-degree roll | Match original ship motion |
| Animated globe starts .6 radians ahead | Starts at zero; .6 only for initially reduced motion | Match reference starting longitude while retaining the static frame |

The shared reference card timing remains intentional under the owner's exact-fidelity instruction; it was not replaced with generic shorter animation timings. Pause, reduced-motion, fine-pointer, visibility and offscreen safeguards remain in place. Review verdict: approve the local code checkpoint; runtime acceptance remains subject to the native checks below and owner visual review.

## Execution

- Signed-in in-app DOM showed all five original gradient pairs, radar delays0/1.2/2.4s and ship keyframe `translateY(3px) rotate(-1.2deg)`.
- `src/desks/GlobalLandingArtwork.test.jsx` adds four lifecycle checks: initially reduced motion draws a static frame; hidden/reduced transitions cancel queued frames and resume when cleared; cleanup cancels frames, disconnects observers and removes environmental event listeners.
- Guard proof: temporarily removed both environmental restrictions; three tests failed for missing static draw / uncancelled frame, and passed after restoring the source.
- Focused artwork, Global, National and shared motion checks:15 tests passed. `npm test`:144 files,2,141 tests passed. `npm run lint` and `npm run build`: passed. Existing mixed-import and large-bundle warnings remain. No lib/server/Edge changes; the previous862-test Deno result remains the latest execution for that unchanged scope.
- Native Chrome loaded the existing ignored component harness and Global with real summaries. Rendering panel was visible. Coordinate interaction failed; semantic selector click/keyboard left the reduced-motion value at No emulation. This does not prove reduced-motion execution. The temporary agent tab and its DevTools were closed, leaving the pre-existing New Tab intact.

## Remaining gates

Native reduced-motion, hidden-tab and touch execution, and owner visual acceptance remain F82. Unit lifecycle evidence does not substitute for these native checks. No push, deployment, PR or main merge.
