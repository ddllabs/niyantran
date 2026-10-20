# Desk sector flip implementation

> **Status: Historical (2026-10-21).**

Spec: ../specs/2026-10-21-desk-sector-flip.md.

1. Isolate task/desk-sector-flip from main; coordinate with billing chat; preserve shared checkout.
2. Replace old explorer expectations with card discovery/accessibility and canonical routing tests; establish RED.
3. Implement shared flip presentation and focus behavior, preserving data and module navigation.
4. Run focused tests, npm test, npm run lint, npm run build and npm run check:bundle. Browser-check Global and desk variants locally, including narrow layouts and keyboard.
5. Show owner local Global; no deployment until review. Sequential implementation, no delegation.

Write scope: src/desks/landing/DeskLandingFrame.jsx, deskLandingV6.css, DeskLandingFrame.test.jsx, deskDefaults.test.jsx, useDeskLandingMotion.js and its test if necessary; task docs and docs/plans/open-work.md.

## Local verification (2026-10-21)

Implementation is uncommitted in /private/tmp/nter-desk-sector-flip-20261021, branch task/desk-sector-flip, based on main 9d89c1b0. Billing chat was informed before creating the checkout. Shared Razorpay files were not edited.

Changed runtime paths: src/desks/landing/DeskLandingFrame.jsx, deskLandingV6.css and useDeskLandingMotion.js. Related test scope includes SectorCard.test.jsx, DeskLandingFrame.test.jsx, deskDefaults.test.jsx, useDeskLandingMotion.test.jsx, six desk adapter tests, and src/lib/deskLanding.test.jsx. Existing route/data fetching contracts unchanged. State's eleven-module groups use wider two-column cards/lists; mobile retains full lists with page scrolling.

- RED: new embedded-module and inert-face assertions failed on old explorer (2 failures).
- npm test -- src/desks src/lib/deskLanding.test.jsx: 490 passed.
- npm test: final 403 files / 6292 tests passed. Initial run had superseded-layout assertions and a transient admin matchMedia failure; the admin test passed individually and the final full suite passed without admin code changes.
- deno test -A --config supabase/functions/deno.json supabase/functions: 1172 passed.
- npm run lint, npm run build, npm run check:bundle: passed.
- git diff --check: passed.
- No SQL/router/schema changes; SQL fixtures and router import not applicable to this presentation-only implementation.

IAB execution: eight desks, 35 cards and 120 links; one open card, focus to first module, Escape restores front focus, filter-empty state and return to All, module callback destination, dark theme, motion-paused flip (0s transition), no broken loaded images. Global responsive iframe inspections at 320/768/1024/1440; narrow description clipping corrected. State eleven-module reverse visually inspected. OS reduced-motion CSS is shared with existing motion support; manual pause verified, no OS preference changed.

Local preview: http://127.0.0.1:5184/.local-desk-preview.html, Vite bound to loopback. Untracked .local-desk-preview.html/.jsx and .local-responsive.html are review-only harnesses, excluded from integration. Global uses GlobalLandingContent; other choices use the shared frame with real presentations. No production auth/summary connection: counts unavailable and module callbacks display destinations rather than opening authenticated terminals. Full signed-in integration remains a verification gap until an authorized configured preview. Temporary preview hot-reload caused duplicate-root warnings during development; harness disposal added and fresh reload used for final review.

No commit, merge, push, deployment, billing or production action. Owner visual review pending.

## Owner visual refinement

Image uses remaining front height with a 240px minimum; content stays grouped at the bottom. Shared sector-action class styles both CTAs. Reverse background has a pointer-only dismissal target behind content, with explicit Back/Escape for keyboard. Module hover/focus uses accent background, leading accent and arrow feedback. Causal regression failed before the new background target; 244 focused landing tests pass. Browser verifies blank reverse area closes with focus restoration and module activation preserves the open state/destination.

Refinement lint/build/bundle and diff checks pass. Browser computed styles confirm both CTA faces use 13px/600 type and matching 1px separators; keyboard module focus activates the same accent treatment as hover. Global image measured 262px versus 192px content at the current tablet viewport. No authenticated or production operations.

Final refinement npm test: 403 files / 6293 tests passed. Changes remain uncommitted and local; owner review pending.

Second refinement: no-arrow assertion failed against previous cards, then passed across eight desks. Module rows use 14px vertical/12px horizontal padding, 6px gaps, full-row accent highlight and shared shadow, without inset stripe. Focus outline retained. 244 focused tests, lint, build and bundle pass; browser confirms arrow-free fronts/backs/module rows and padded keyboard highlight.

Arrow/spacing refinement final full suite: 403 files / 6293 tests passed. Still local/uncommitted; nothing deployed.

Owner interaction clarification: restore outer-card 4px hover lift and ink/near-black hover border, retain deep-blue selected reverse border (#012EA1 in light theme). Inner module hover uses 2px lift and ink border with existing type/theme tokens. Outer lift is separate from inner Y rotation. Paused/reduced motion suppress both lifts. Browser measured closed hovered transform translateY(-4px), border rgb(25,25,25); flipped hovered transform translateY(-4px), border rgb(1,46,161). CSS-only refinement: 244 focused tests, lint, build and bundle pass; prior full suite 6293 remains the latest full-suite run. No production action.

## Integration authorization and verification

Owner reviewed the local refinements and authorized push and merge. Runtime/tests committed as `a51b07d`; earlier uncommitted/pending statements above describe development checkpoints. Final review confirms only three runtime files, related tests and task documentation. Local preview harnesses remain untracked and excluded. Existing consolidated main history contains documentation only. No Razorpay files included. Publication will respect current mandatory CI gates; production completion is not claimed by this record.
