# National motion transition verification

> **Status: Historical (2026-10-05).** Local continuation evidence; not owner acceptance or a release.

## Reproduction and correction

The actual motion hook was executed with deterministic event targets and frame scheduling. Three guards failed before correction: a pointer frame queued before document hiding, reduced-motion activation or pointer leave restored the card transform after reset. The prior implementation left that frame scheduled. Reset now cancels queued frames, and the frame callback checks current motion eligibility before writing transforms. No data, routing, auth or sibling landing behavior changed.

The five tests cover these three races, resuming only when both visibility and preference permit it, and keeping manual pause in force. React effect/ref mounting and browser environment APIs are test doubles; this is controller execution evidence, not proof of actual OS media settings or native hidden-tab behavior.

## Executed verification

- Before fix: `npx vitest run src/desks/useNationalMotion.test.js` — three failed, two passed; failures were stale transforms, not setup errors.
- After fix: `npm test` — 139 files and 2,123 tests passed, including all five motion guards.
- `npm run lint` — passed, no warnings.
- `npm run build` — passed; existing mixed static/dynamic `deskBrief.js` import and >500 KB chunk warnings remain.
- `git diff --check` — passed.
- Actual local preview after reload: source summaries loaded, pointer over a card produced perspective/rotate transforms and `tilting=true`; moving outside National cleared transform and `tilting=false`. Final console warning/error log empty.
- Visiting `http://127.0.0.1:5174/#/national` still rendered the signed-out marketing page with Sign in, so signed-in route/Back/lock checks remain unavailable. The temporary check tab was closed; the layout preview is retained.

## Remaining gates

F81 remains open for owner visual review, signed-in shell checks, native200% zoom, actual reduced-motion/hidden-tab/coarse-pointer runtime evidence. The prior fidelity report remains an immutable record of its checkpoint. No push, deployment, PR, main integration, auth bypass or fabricated account used.
