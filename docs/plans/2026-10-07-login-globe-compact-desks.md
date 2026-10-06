# F86 implementation plan

> **Status: Historical (2026-10-07).** Implemented on task/login-globe-compact-desks and merged into main in 6d4b66e.

Spec: ../specs/2026-10-07-login-globe-compact-desks.md.

1. Inspect reference and actual layouts; establish clean branch.
2. Replace login artwork using existing NterEarth interface; scoped responsive CSS and pause control. Write LoginPage.jsx and marketing.css only.
3. Compact shared desk hero/statistics in nationalLanding.css; preserve source artwork and interactions.
4. Browser verification at 320/768/948/1440, all three desks and login; compare reference; npm test, npm run lint, npm run build; review full diff.
5. Record evidence here and track F86 in open-work.md. Commit verified result on task branch, retain for owner review. No merge or push.

No delegated scopes; existing component interface unchanged.

## Verification — 2026-10-07

- Branch created after fetch; main and origin/main both at identical starting point (0/0).
- Focused Earth, login authorization and three desk view tests: 48 passed. Full npm test: 149 files, 2,160 tests passed.
- npm run lint passed. npm run build passed with existing deskBrief mixed-import and large-chunk warnings. git diff --check passed. Final CSS-only corrections verified with lint/build and browser again.
- Browser: real login globe loads; pause attribute toggles on and off. Desktop login at 1280px; narrow form at 320px remains inside x=12..308 after scoped border-box correction; subdued Earth visible above form. Tablet 768px checked.
- Existing local desk preview harness uses real summaries and production components; National, Global and Law inspected at desktop/intermediate widths. National at 320/768, desktop 1440; no document overflow at measured 320/768/948/1440. Hero minimum is 400px, but naturally expands for source labels/statistics; mobile deliberately natural height. All reference artwork retained. No signed-in app route test after server restart because session required sign-in; no authentication performed or data written.
- Reviewed scope: login artwork/state only; no credential, OAuth or session logic changed; no dataset/artwork replacement, no dependencies. Shared NterEarth runtime and its reduced-motion/fallback lifecycle unchanged and existing runtime tests pass. Native OS reduced-motion setting not toggled this task.
- Owner review pending. Retain task branch; no merge, push or production deployment.

## Integration

Owner authorized merge and push on 2026-10-07. Fast-forward merge of 6d4b66e after fetch confirmed main/origin/main starting history identical. Prior owner-review-pending notes above describe the pre-integration state.
