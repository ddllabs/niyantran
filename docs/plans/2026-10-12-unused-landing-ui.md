# F93 unused landing UI removal

> **Status: Living.** Sequential; no delegation. Implements [spec](../specs/2026-10-12-unused-landing-ui.md). Owner approved the exact removal inventory and local checks; no push/deployment.

1. Hash all 94 existing dirty files, establish the pre-removal production build, and prepare a temporary browser fixture outside the repository.
2. Remove only the 12 spec-listed files. No runtime interface changes; active landings and corpus work remain unchanged.
3. Run `npm run lint`, `npm test`, `deno test -A --config supabase/functions/deno.json supabase/functions`, `node scripts/verify-desk-v6-assets.mjs`, `npm run build -- --outDir /private/tmp/niyantran-f93-cleanup/build-after` and `git diff --check`. Compare all pre/post build files by SHA-256.
4. Use the real eight landing content components with fixed summaries and local assets in a browser fixture. Check rendering, source filtering, sector selection, module dialogs and module handoffs; inspect errors and responsive/dark variants. No production requests.
5. Recheck preservation hashes; review exact deletions and record executed evidence and limitations here. Keep this change uncommitted on the existing task branch to avoid integrating or staging the corpus work. Update only F93's tracker entry, preserving all corpus tracker text.

Write scope: the 12 removal targets, these two documents, and only F93's paragraph in `docs/plans/open-work.md`. Generated checks/fixture/output stay under `/private/tmp/niyantran-f93-cleanup/`. Checkout stays on `task/corpus-single-pilot-20261009`; no branch switch, commit, merge, push or deployment in this task.

## Executed evidence — 2026-10-12

- Removed exactly the 12 listed files: 1,129 lines. Active v6 components, summary hooks, catalogue, generic fallback and assets were not edited.
- `npm run lint`: passed, no warnings/errors.
- `npm test`: passed, 183 files / 2,468 tests.
- `deno test -A --config supabase/functions/deno.json supabase/functions`: passed, 880 tests.
- `node scripts/verify-desk-v6-assets.mjs`: passed; reference assets and configurations match.
- `npm run build -- --outDir /private/tmp/niyantran-f93-cleanup/build-before` and the equivalent `build-after` command: passed. SHA-256 comparison of all 318 generated files: identical. Existing mixed static/dynamic import and large-chunk warnings remain.
- `git diff --check`: passed.
- Browser fixture uses all eight actual content components, their actual CSS/catalogue/assets and fixed local summaries, with data fetching blocked. National, Global, Law, Economics, Carbon, Sports, Entertainment and State each passed source filtering, last-sector selection, module dialog opening and canonical module handoff at desktop and 390px mobile. All eight also rendered dark backgrounds at 1200px; no horizontal document overflow or broken images in these checks. Standalone browser console: no warnings/errors.
- An earlier iframe-based run logged a MutationObserver error during tool interaction and a combined browser call timed out. The full standalone responsive/dark rerun completed cleanly. The origin of that earlier error is unproven; it was not reproduced on standalone pages.
- Browser evidence is isolated UI verification, not a signed-in production or live-source test. The identical complete production output independently establishes no shipped runtime or asset change from these deletions.
- Existing dirty-file SHA-256 snapshot contains 94 paths. Preserve 93 paths byte-for-byte; the shared tracker changes only its F93 paragraph. Corpus source, scripts, data, tests and documentation remain untouched.

Local verification complete; F93 remains open pending a verified commit/integration. No commit, merge, push or deployment performed. SQL fixtures were not run because no SQL or authorization behavior changed.
