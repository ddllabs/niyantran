# National, Global and Law release verification

> **Status: Historical (2026-10-05).** Final release evidence. Owner authorized completion, cleanup, merge and push.

Scope: National (12 modules), Global (16) and Law (12), shared existing-route desk navigation. State redesign and separate Earth replacement are excluded. Earlier local-only publication restrictions are superseded by the owner's release instruction and the release spec.

## Final polish and review

Corrected singular module counts and first-run tour guidance. Retained the reference's row grid: unequal card heights create intentional row whitespace; masonry would change reference order and composition. Reviewed the outgoing routes, bounded summary adapters and motion lifecycle. No authentication, billing, datasets, credentials or database migrations changed.

Prior signed-in browser evidence covers all 40 canonical module routes and Back, search, inert filtered rows, source filters, keyboard disclosure/Escape focus, light/dark themes, Hindi desk labels, responsive widths and pause/offscreen behavior. See the National authenticated/runtime records, Global verification/continuation and Law verification records.

## Final commands

- Focused landing/motion suite: 14 tests passed. The first run caught one stale plural-string expectation; updated the existing assertion and reran successfully.
- `npm test`: 148 files, 2,152 tests passed (25.28 seconds). First full run preceded that expectation correction and had one failure; final full rerun passed.
- `deno test -A --config supabase/functions/deno.json supabase/functions`: 862 passed, zero failed.
- `npm run lint`: passed without errors or warnings.
- `npm run build`: passed, 2,453 modules transformed. Existing mixed static/dynamic deskBrief import and large chunk warnings remain.
- `node -e "import('./api/router.js').then(() => console.log('router import ok'))"`: passed.
- `git diff --check`: passed.

No standalone type-check exists. No SQL or live database operations were needed.

## Native environment checks

Used Chrome's native DevTools controls on the ignored local layout fixture, which renders the production landing components with real summary endpoints. This supplements the signed-in application route checks; the fixture itself is not evidence of authenticated routing.

- Native `prefers-reduced-motion: reduce`: National, Global and Law each reported reduced=true, root motion=off, zero animations.
- Native iPhone SE profile: coarse pointer=true, hover=false, viewport/page width both 375px. Coverage disclosures opened through native actions on all three desks, exposing their Open register action. This is browser device emulation, not a physical phone test.
- Actual background tab: document.hidden=true and root motion=off. Initial transient running animations settled; a subsequent read of running animation targets returned an empty array. Shared hook disables pointer frames and clears transforms on visibility changes; existing defect-injection lifecycle tests cover the transition.
- Restored motion emulation, desktop device mode and closed the temporary new tab and DevTools window.

## Limits and cleanup

F84 remains separate: some Law modules are reporting feeds, not official court dockets or bench analytics. The landing identifies this coverage. Existing provider gaps, illustrative commodities and sampled parliamentary questions remain disclosed; release does not certify completeness of upstream data or all workspace internals.

Only the primary checkout is currently registered as a Git worktree. Remove only the merged desk task branches after integration; preserve unmerged task/earth-replacement and its remote branch. Existing ignored preview artifacts are preserved. Production follows origin/main; confirm its actual deployment SHA after pushing.
