# Photographic interactive Earth for authentication

> **Status: Living.** Owner authorized implementation on 2026-10-12.

Current sign-in uses a stylized canvas Earth; signup uses a static PNG with
added rings. Replace both with one real textured 3D sphere, matching the natural
Global banner direction. Reuse Solar System Scope surface/cloud/lighting textures
(CC BY 4.0), hosted locally with attribution. No downloaded model is necessary.

Outcome: matched desktop globe size, slow rotation, pointer drag and keyboard
rotation, Pause/Resume, reduced-motion respect, responsive composition and a
photographic still fallback on texture/WebGL failure. No signup decoration rings.
Only auth pages use the new component; homepage and Global banner stay unchanged.

Write scope: src/marketing AuthEarth component/renderer/tests, LoginPage.jsx,
SignupPage.jsx, scoped marketing.css, new public/brand/auth-earth assets and
credit file, package manifests, this spec/plan/open-work. No existing data asset
replacement, corpus/backend/authentication handler changes, merge/push/deploy.

Acceptance: actual login/signup browser preview at 360/768/1440, natural textured
sphere (including other hemisphere when dragged), matching desktop geometry,
controls/keyboard/motion policies, resize/unmount cleanup, static fallback,
auth fields reachable, no page errors; focused tests, full npm test, lint/build.
Lifecycle guard must fail when frame-stop behavior is removed. Record asset sizes,
bundle impact and fixture boundaries. Owner visual acceptance remains pending.


## Execution evidence

Implemented locally in 9e6f12c on task/client-ui-spec. Three.js 0.185.0 (MIT) is dynamically
imported for auth pages only; existing homepage renderer and Global banner stay
unchanged. Local textures total approximately 2.2 MiB: 4096x2048 day surface,
2048x1024 clouds and ocean reflection mask. Source/licence/modification attribution
is in public/brand/auth-earth/CREDITS.md and linked beside the globe.

- `npm test`: 188 files, 2,517 tests pass. Four new lifecycle tests cover paused
  frames, no resume jumps, reduced motion, hidden tab/offscreen, drag suspension,
  disposal, texture failure, timeout and late completion. Removing frame
  cancellation caused the guard to fail; restored implementation passes.
- `npm run lint`, `npm run build`, `git diff --check`: pass. Existing mixed
  deskBrief import/large-chunk warnings remain; the lazy auth scene chunk adds
  approximately 131 KiB gzip (517 KiB minified), not to the initial entry bundle.
- npm production dependency audit: no Three.js advisory. Existing high-severity
  xlsx advisory remains outside this UI scope; no automatic audit fixes applied.
- Actual local App auth pages: no horizontal overflow or globe/card overlap at
  360/768/900/1024/1440. Login851–999 overlap found during independent review,
  fixed with stacked layout through999px. Globe uses shared desktop sizing and
  responsive smaller sizes when signup's wider form constrains the illustration.
- Actual signup screenshot pixel comparison: pause remains still; pointer drag
  and arrow-key rotation change the hemisphere. Keyboard focus is visible.
  Controls/textures load without submitting either authentication form.
  Keyboard navigation reaches the signup Create account button in view;
  both auth tabs report zero captured console errors.
- Isolated local fixture using actual component/renderer: deliberately losing
  WebGL context removes canvas and displays existing photographic poster.
  Reduced motion/hidden/offscreen policies proved with focused unit execution;
  no claim of changing the user's OS motion setting.

Browser preview is local at http://127.0.0.1:5173/#/signup and #/login. No live
authentication submission, corpus write, homepage redesign, merge, push or deploy.
Final visual acceptance and integration remain with the owner.
