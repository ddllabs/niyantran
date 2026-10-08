# Desk v6 release candidate

> **Status: Living.** Candidate audit on 2026-10-08; Owner authorized main publication on2026-10-08; local merge recorded below. Open work remains tracked only in `open-work.md`.

## Candidate and scope

Candidate application checkpoint: `ca70175` on `task/desk-v6-state`. Freshly fetched `origin/main` is `3e85c8f112b5e2588773ddc4c8e68800a93e7a4d`; comparison is 0 main-only / 32 candidate-only commits. Working tree was clean before this evidence amendment. Independent read-only release review found no new blocking code regression and independently imported the router successfully.

Eight canonical desk landing URLs now use v6 presentations. Existing `DeskView`, module workspaces, `HomeDesk` and `SidePanel` remain intact. Authentication, billing, AI/STT, Supabase, environment, deployment and dependency files do not change in this release. Four new read-only landing summary APIs reuse existing feature feeds. No database migration or data-file deletion is part of the release. The release-range inventory contains no deleted files.

## Verification retained from implementation

Final frontend command `npx vitest run --maxWorkers=1`: 184 files / 2,465 tests passed. `npm run lint` and `npm run build` passed; baseline mixed static/dynamic import and chunk-size warnings remain. Deno suite: 862 passed at the backend checkpoint, with no subsequent backend change. Router import and byte-exact asset verifier passed. Browser evidence includes canonical first-click/Back/reclick destinations, allowed/restricted authenticated layouts, eight-desk type/theme checks, all35 sectors at three widths and Hindi samples. Detailed executions and limits remain in the closure, State, shell-repair and explorer-readability documents.

Release-range `git diff --check origin/main...HEAD` reports three extra blank lines at EOF in the closure inventory, original exact-reference image-credit text and LegacyLandingControls. These are cosmetic; the asset-credit file remains byte-identical to the supplied reference. Current working-tree checks are clean.

## Final native acceptance

Actual Chrome, signed into the owner-authorized test account on localhost:5173:

- Explicit native zoom indicator reads200%. National shared header controls remain contained. Bill Passage Probability Index popup shows Close; scrolling the dialog exposes Open in Terminal. This supplements the owner's earlier all-seven-desk200% acceptance and measured all-eight shared-shell geometry matrix.
- Native Rendering setting selected `prefers-reduced-motion: reduce`. National, Global, State and Law display disabled Reduced motion controls. Law runtime inspection confirms the media query and `desk-v6 motion-paused`. The only remaining document animations were existing unrelated background load-bar/spin effects, outside the v6 desk frame.
- Native iPhone SE emulation reports width375, coarse pointer true, hover false and no document horizontal overflow. A deliberate coordinate tap selects Judicial Intelligence; scrolling exposes complete module rows. A deliberate tap on District Court Case Tracker opens its matching popup with `/#/law/District%20Court%20Case%20Tracker`. Escape restores focus to that module. Screenshot: `native-coarse-pointer.png` in the task visualization directory. Earlier offscreen AX attempts aimed at ICJ activated adjacent WTO; these automation attempts are excluded from exact identity evidence. The intentional visible pointer test is retained.
- A read-only delayed diagnostic during an actual newly opened browser tab observes `document.hidden=true`, `desk-v6 motion-paused` and unchanged Law counters. Returning observes hidden false, normal motion and the same counters (1,460 counted entries). No DOM, application state, storage or credentials were modified by diagnostics. This runtime evidence supplements the counter-replay lifecycle guards.

Independent review accepts representative native executions for the shared shell/frame/hook when combined with the already-executed all-desk matrices. It requested a genuine pointer tap rather than AX-only activation; that tap subsequently passed. Device emulation was disabled and DevTools closed after testing. Live voice remains explicitly deferred by the owner and tracked under F76; no live STT pass is claimed. Native Chrome also reports an existing favicon.ico404; no new v6 runtime exception was observed.

## Existing risk and old code

Read-only `npm audit --omit=dev --json` reports zero critical and one high production dependency (`xlsx`0.18.5; prototype pollution and ReDoS advisories; no npm fix). Initial sandbox audit failed DNS; escalated registry audit completed. This unchanged risk was already recorded under P12. The owner approved this UI release with that disclosed risk; remediation remains separately tracked. No unconditional security-safety claim is made. Do not bulk-upgrade dependencies in this UI release.

Unused prior landing helpers/artwork/geometry/styles remain in source. They do not expose parallel old landing pages. F93 tracks optional exact-inventory cleanup; no deletion is authorized here. The older implementation is recoverable from the pre-release main commit and Git history.

## Proposed release and rollback

After explicit owner authorization, fetch origin again and ensure main is still an ancestor with a clean working tree. Integrate the candidate using a merge commit, push main normally, and verify the exact Vercel production deployment reaches READY. Smoke the signed-in National/Global/Law/State landing, a canonical module handoff, directory/search and viewport fill. Keep task branches until production acceptance; deletion needs exact owner authorization.

The merge commit provides a single rollback target: revert its first-parent merge (`git revert -m 1 <release-merge-sha>`), then publish the revert through the ordinary main deployment. No database rollback is required. Preserve the pre-release main SHA above in the final operations record. No main merge or production push has been performed as of this candidate audit.

## Authorized main integration — 2026-10-08

Owner replied “go” to the concrete proposal to merge/push main with the unchanged P12 risk disclosed. Origin fetched again; origin/main remained3e85c8f with0/33 divergence and clean working tree. Supervisor merged453f8ec into main with merge commit `d480b11eb92b453f0d7b08c331e180bfff3d7e57`. The merge tree is byte-identical to the verified candidate; no new application change or conflict resolution. This documentation amendment precedes the approved ordinary push and exact-commit Vercel verification. Task branches remain recoverable; no branch or old-code deletion. Rollback target is the merge commit above using first parent.

## Production publication verification — 2026-10-08

Main pushed at dfd4c45a506f9e78bcd20ce86be63457e6d429ae. Vercel production deployment dpl_HNLRw2cdwJbibdiRK9oJ47PUZ2Lm is READY (39-second build), aliased to https://niyantran-six.vercel.app. GitHub production deployment6941489857 records that exact commit. Browser reloaded after deployment, authorized test-account sign-in succeeded, National/Global/Law/State headings and canonical routes matched, All sections and catalogue search opened, and Bill Passage Probability Index popup opened its existing loaded register. At718×977, main fills the remaining887px below the90px header with no horizontal document overflow.

Runtime error-level scan returned11 Node DEP0169 url.parse deprecation warnings, not an application exception. The separate reference-only Vercel project failed because its configured previews/desk-reference-v6 root does not exist on main; F94 records this outside-scope project setting. No Vercel settings changed. Live voice remains owner-deferred; unchanged P12 remains separately tracked. This final documentation record makes no application change.
