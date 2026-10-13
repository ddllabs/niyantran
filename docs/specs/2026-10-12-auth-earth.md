# Photographic interactive Earth for authentication

> **Status: Historical (2026-10-12).** Retired by F141 on 2026-10-14: the client's data globe
> replaced `AuthEarth` on every page and `AuthEarth` was deleted; see
> [the one-globe spec](../specs/2026-10-14-one-globe.md). Kept as the record of what it was.
> Originally: Owner authorized implementation on 2026-10-12.

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


## Amendment 1 — orbits, India start view (owner, 2026-10-12)

Owner review of the local preview asked for the homepage hero's orbit rings and
moving satellites on the new globe. Scope chosen by the owner: sign-in and
signup only; the homepage NterEarth stays unchanged.

- **Orbits:** the three homepage rings (blue `53,111,255`, purple
  `176,123,255`, gold `222,185,126`; radii 1.25–1.42 globe radii, same
  flattening and tilt), each carrying two glowing satellites with a short
  fading trail, same per-ring speeds and phases. The rings are fixed in space:
  dragging turns the globe, not the rings. The globe hides the far half of
  each ring.
- **India start view:** the globe opens with India (about 79°E, 22°N) facing
  the viewer, then spins eastward as before.
- **Motion:** default slow spin. Dragging moves the globe; on release it keeps
  spinning from where it was left, with no jump. Satellites keep moving while
  the globe is held. Pause stops everything; reduced motion, a hidden tab and
  offscreen still own no animation frame (static rings and satellites).
- **Size:** the globe keeps its current on-screen size; the rings may extend
  beyond the drag area without taking pointer input or causing horizontal
  page overflow.

Write scope: `src/marketing/authEarthScene.js` and its test, `AuthEarth.jsx`
if needed, auth-scoped `marketing.css`, this spec, the plan and open-work F103.
No homepage, data, backend or authentication handler changes; no new
dependency or asset.

Acceptance: focused tests for the India view (checked against Three.js sphere
UV mapping), ring and satellite count, satellites moving during a drag without
the globe auto-spinning, and continuity after release, each shown failing
first; full `npm test`, lint and build; local login/signup at
360/768/1024/1440 with no overlap or overflow, no console errors.

### Amendment 1 execution evidence (2026-10-12, uncommitted on task/client-ui-spec)

- Red first: four new or changed tests in `authEarthScene.test.js` failed
  against the previous scene (India view, three rings / six satellites,
  satellites moving during a drag, frames kept during a drag). A UV-layout
  guard confirms the lon/lat mapping against the real `SphereGeometry`.
- Mutation checks: restoring the old start rotation fails the India test;
  letting the globe auto-spin while held, or stopping frames during a drag,
  fails the drag tests. Each restored implementation passes.
- `npm test`: 188 files / 2,521 tests pass. `npm run lint`: zero warnings.
  `npm run build`: passes; lazy auth scene 522 kB minified / 132 kB gzip
  (was 517 / 131). Existing large-chunk and mixed-import warnings remain.
  `git diff --check` passes. No new dependency or asset.
- Local browser (existing dev server, 127.0.0.1:5173): login opens with India
  centre-front; rings pass behind the globe; satellites glow with trails.
  A leftward drag brings East Asia forward and the spin continues from there.
  Login and signup at 360/768/1024/1440: no horizontal overflow, rings clear
  of the form cards (the transparent canvas corner meets the signup card at
  1440 only, with no drawing there). Zero console errors.
- Ring opacity and dot sizes are raised above the homepage values because the
  auth pages are light. Homepage NterEarth unchanged. Owner visual acceptance
  pending.


## Amendment 2 — clean first paint, persona labels (owner, 2026-10-12)

Owner review of amendment 1 on local:

- **First paint:** while textures load the page showed the fallback photo
  (Earth on black space, cropped to a circle), then the canvas with its rings
  first clipped to that circle and then released: a black border and a jump.
  Now nothing is shown while loading; globe and rings fade in together once
  ready. The photo appears only when the globe cannot load.
- **Persona labels:** the homepage hero's six persona cards (same look, icon,
  hover/focus reveal of what each persona gets) sit around the globe on both
  auth pages. On signup a card selects that persona in the form's "Who are
  you working as?" list (same state). On sign-in a card only reveals. Cards
  are outside the drag area, and are hidden when the globe area is too narrow
  (as the homepage hides them on smaller screens).

Write scope adds `SignupPage.jsx` (pass the persona state) and its test, and
a new `AuthEarth.test.jsx`. No homepage, persona data, authentication handler
or signup submission change.

### Amendment 2 execution evidence (2026-10-12, uncommitted on task/client-ui-spec)

- Red first: four tests in new `AuthEarth.test.jsx` (no stand-in photo while
  loading or ready, photo on failure; six labels outside the drag area;
  sign-in label reveals without selecting; signup label selects) and one in
  `SignupPage.test.jsx` (globe labels drive the form's persona state) failed
  before the change, then passed.
- `npm test`: 189 files / 2,526 tests pass. Lint zero warnings; build passes
  (auth scene chunk unchanged at 522 kB / 132 kB gzip); `git diff --check`.
- Local browser: on reload the view goes loading (no image) → ready, then the
  canvas fades in with globe and rings together. Hover on a sign-in label
  reveals its list; clicking "Legal Researcher" on the signup globe checks the
  same form radio and marks the label pressed. Widths 360–1440 on both pages:
  no horizontal overflow, labels never overlap a form card or leave the
  screen; labels show when the globe area is at least 440 px (about 1330 px
  viewports; side pair from 500 px), hidden below. Zero console errors.

### Amendment 3 — label spacing matches the homepage (owner, 2026-10-12)

Owner: label spacing differed from the homepage banner; space them out along
the orbit band. Measured on the homepage at 1440: label centres sit at
(±1.04r, ±0.89r) and (±1.56r, 0) from the globe centre (r = globe radius).
The auth labels now use exactly those offsets: when shown, the globe takes the
middle 60% of its area and positions are container-relative (`cqi`). As on the
homepage at narrower widths, the side pair drops first (area under 600 px);
no labels under 440 px. On ≥1330 px screens the sign-in globe area widens into
the free space beside the card, and the signup globe area takes its column.

Evidence (local, iframe geometry sweep, 1024–1920 px): every visible label's
centre is within 0.02r of the homepage offsets; no label overlaps another or
a form card; no horizontal overflow. Sign-in: six labels from 1330 px, globe
353–423 px. Signup: four corner labels at 1330–1440 (globe 229–271 px), six
from about 1600 px (368 px at 1680). Below 1330 both pages keep the earlier
label-free globe. Lint, marketing tests and build pass. Screenshots were not
captured (browser pane hidden); owner visual review pending.

### Amendment 4 — no blue rim (owner, 2026-10-12)

The additive light-blue atmosphere shell (scale 1.025) around the globe is
removed; the surface and cloud layers are unchanged. Focused globe tests (11),
lint and build pass; local sign-in at 1440 shows a clean edge.

### Amendment 5 — same globe on the homepage hero (owner, 2026-10-12)

The owner reversed amendment 1's auth-only scope: the homepage hero now uses
the same globe (photographic surface, India start, rings and satellites, drag,
Pause, credit) in place of the NterEarth canvas. `AuthEarth labels={false}`
leaves the hero's existing six persona labels in charge; the hero's separate
Pause button is replaced by the globe's own controls (dark-hero colours).
Sizing reuses the old canvas geometry (r = 0.228 × min(880px, 155%); view
min(491px, 86.5%), min(312px, 83.7%) under 561 px) and centres on the view,
so the hero labels keep their exact offsets.

Evidence: red-first tests (`labels={false}` renders no labels; homepage uses
the shared globe and not NterEarth). Full `npm test` 189 files / 2,527 tests,
lint exit 0, build. Local homepage at 1440: globe radius 201 px (was 200),
hero labels at (±1.04r, ±0.89r) and (±1.56r, 0), drag works, zero console
errors. At 360/768 the page is 15 px wider than the viewport with or without
the globe; hiding `.mkt-trivia-inner` removes it (existing F80).
`NterEarth.jsx` and `public/brand/earth/` are no longer rendered but are kept
(F106).

### Amendment 6 — minimal controls, credit in the footer (owner, 2026-10-12)

The "Drag to explore" hint and the text Pause button are removed. A 32 px
pause/play icon remains (accessible name "Pause globe" / "Resume globe",
`aria-pressed`) because the globe moves on its own indefinitely (WCAG 2.2.2);
reduced-motion users already get a still globe. It sits in the view's
bottom-right corner, or bottom-centre below the globe wherever persona labels
surround it (sign-in/signup label layout, homepage hero from 561 px).
The CC BY 4.0 credit moves from beside the globe to the marketing footer's
bottom row: "Earth imagery adapted from Solar System Scope · CC BY 4.0",
linking the source and the licence. The footer is site-wide but not rendered
on the auth pages; this is the licence's "reasonable manner" reading, not
legal advice.

Evidence: red-first tests (pause icon only, no hint or link by the globe;
footer carries source and licence links). Full `npm test` 190 files / 2,529
tests, lint exit 0, build. Local browser (dev server restarted after the
earlier one stopped): pause toggles, never overlaps a label at 360/768/1280/
1440 on all three pages; footer credit visible with both links; homepage
labels keep their offsets; zero console errors. Homepage 15 px overflow at
360/768 remains the existing F80 trivia block.

### Amendment 7 — the same globe on the pricing page (owner, 2026-10-12)

The pricing header showed a flat globe image with SVG rings, absolutely
positioned so the plan cards cut across it. It now uses the shared globe
(`AuthEarth labels={false}`) in a second column of the header, in the flow, so
the notes and cards start below it; hidden at 1024 px and under, as the old
image was. Red-first source test in `publicPlans.test.js`; `npm test` 193
files / 2,553 tests, lint, build. Browser: globe whole and above the notes at
1100–1920 px, no overflow at 360–1920 px, zero console errors on a fresh tab
(pricing, home, signup).
