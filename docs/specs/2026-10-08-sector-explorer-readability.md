# Shared sector explorer readability

**Status: Living — owner authorized implementation on2026-10-08.**

The shared v6 sector explorer currently uses7–11px type with pale metadata, including breakpoint rules that shrink actionable module names. Owner approved larger type, stronger contrast and more comfortable rows while preserving the reference character.

Outcome:14px module names with600 weight,12px metadata/descriptions/badges,16px sector heading and10px eyebrow. Secondary text must meet4.5:1 contrast on light/dark explorer surfaces. Keep source-backed values, exact module destinations, image assets and popup behavior. Avoid fixed heights, clipping and document overflow. At widths<=1150px place the introduction above the module grid; retain two columns where comfortably possible and one at<=560px.

Sequential plan/write scope: first record baseline browser metrics, then edit only src/desks/landing/deskLandingV6.css, verify shared National/Global/Law/Economics/Carbon/Sports/Entertainment/State explorers at360/718/1024/1416/1900 in light/dark, including long labels and a popup handoff. Run existing focused frame/presentation tests, lint, production build and diff check. Record outcomes here and F92 in docs/plans/open-work.md; commit locally on task/desk-v6-state. No main merge, provider changes, new data or unrelated typography changes. Existing goal's pending native acceptance remains separately tracked.

## Implementation and evidence

Readable base typography now applies at every breakpoint; removed the later shrink overrides. Secondary colors use a scoped light/dark variable. Below1150px the introduction sits above two module columns; below560px the list uses one column. Larger rows retain natural height. Screenshot review caught the old module-list height cap slicing through a row; removed all internal max-height/overflow rules so the page scrolls normally and the full grid is visible.

Executed baseline on the deployed718px page: module names10px, metadata8px/color rgb(138,150,167). First local browser matrix:80 observations, eight desks×five widths×light/dark; all names14px/metadata12px, no horizontal text clipping/document overflow. Contrast5.41:1 light,8.71:1 dark; independent review also verified hover contrast>=4.5:1. Final containment matrix after height-cap removal:105 observations, all35sectors at360/718/1416; no vertical grid/text clipping or horizontal overflow. Nine additional Hindi National/State/Law width samples passed. An overly long intermediate batch timed out and was excluded; reran final measurements in smaller batches. Evidence artifact `/private/tmp/explorer-final-sectors.json`.

National popup retained exact href `/#/national/Bill%20Passage%20Probability%20Index`; clicking changed the browser to that canonical URL, then Back restored the preview. This URL check does not claim authenticated module content acceptance. Escape closes popup and restores the module trigger focus. Signed-in localhost:5173 National real-shell screenshot shows the complete explorer and aligned header. Screenshot `/Users/vighneshshukla/.codex/visualizations/2026/10/03/01a100ed-6924-76a3-8647-747036b0757a/explorer-readability.png`. Preview-only bottom desk controls are not the application header.

Verification: focused frame/presentation suite70passed; final full `npx vitest run --maxWorkers=1`:184files/2465passed; final `npm run lint` passed; final `npm run build` passed in6.05s with existing mixed-import/chunk-size warnings; `git diff --check` passed. Independent final CSS review found no blocker and confirmed no fixed/clipping explorer ancestors. No backend/auth/provider/data files changed; Deno/SQL suites not repeated for this CSS-only slice. Owner visual review and broader native gates remain pending; no main merge or publication performed for this slice.

## Final candidate acceptance amendment — 2026-10-08

Actual Chrome now verifies shared native200% header/popup scroll, reduced-motion state, an intentional coarse-pointer sector/module tap and hidden-tab pause/recovery. Exact coverage, excluded AX attempts, independent review, unchanged P12 dependency risk and rollback are recorded in [the release candidate](../plans/2026-10-08-desk-v6-release-candidate.md). This supersedes prior pending native checks; live voice remains explicitly owner-deferred. Candidate code is ca70175; main publication and cleanup await the owner.
