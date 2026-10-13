# Spec: globe handover and page speed (F145)

> **Status: Living.** Owner request 2026-10-14, from the client:
> - **The flash.** Since the new globe arrived, every page with a globe briefly shows a globe on a
>   black background before the real globe appears and starts moving.
> - **Speed.** Pages have felt slow since the globe was added.
>
> The owner accepted the recommendations and asked for this spec. **Owner decisions, 2026-10-14:**
> the GIF becomes a still (option a), the `vercel.json` caching rule is approved, and the unused
> files may be removed. The findings below were measured on
> 2026-10-14 against a production build (`vite preview`) and the live site's headers, unless marked
> as read from the code.

## Current state

### The flash

- `<nter-data-globe>` (`src/marketing/nterGlobe.js`) shows a stand-in image until WebGL is ready,
  then fades over 0.5 s (`.data-orbit-earth` opacity transition, `nterGlobe.css`).
- **The stand-in is the problem.** `/brand/auth-earth/fallback.jpg` is a 1600 × 900 photo of Earth
  on black space, cropped into a circle. It shows a different face of Earth (Africa) at a slightly
  different size than the shader's globe. It came in the client's globe package (byte-identical to
  the package's embedded `fallback`), so F140 inherited it.
- **It happens on every page change.** Each page (home, sign-in, sign-up, pricing) mounts its own
  `DataGlobe`, so each change builds a new element. That element creates a new WebGL context,
  re-unpacks the three Earth images on the main thread, recompiles the shader and starts its motion
  from time 0.
  - Measured, with everything already downloaded on a fast Mac: the stand-in shows for 100–155 ms
    per page change, then the 0.5 s fade begins. There was one long task of 75 ms on the first
    change.
- Read from the code: on unmount the old WebGL context is never released. It stays alive until
  garbage collection, holding a 4096 × 2048 texture (about 32 MB of GPU memory). Browsers allow
  about 16 live contexts and then drop the oldest.

### Page weight: first visit to the signed-out homepage

| Item | Measured | Note |
|---|---|---|
| `/brand/globe.gif` | **34.4 MB** (960 × 540, 401 frames) | The walkthrough video's backdrop (`HomePage.jsx:496`), shown at most 460 px wide, at 55% opacity and darkened. It loads eagerly although it is below the fold. Added 2026-09-21 by the former developer; it predates the 3D globe. |
| Main script `index-*.js` | 2,565 KB (about 720 KB compressed) | `App.jsx` statically imports `TerminalShell`, `AdminApp` and `PersonaChooser`, so a signed-out visitor downloads the whole terminal. |
| Main stylesheet | 451 KB | Includes the terminal's CSS for the same reason. |
| Earth images | 2,276 KB | `day.jpg` 4096 × 2048 (1,089 KB), `clouds.jpg` 2048 × 1024 (943 KB), `oceans.jpg` 2048 × 1024 (244 KB). The largest globe drawn is about 480 CSS px across. |
| Stand-in `fallback.jpg` | 143 KB | Replaced by the still below. |
| `/brand/logo.png` | 164 KB (624 × 621) | Shown about 28 px wide. |

- Off the homepage: the forgot-password and reset-password pages spin `/brand/globe.png`, which is
  2 MB.

### Caching (live site)

- Every file is served with `cache-control: public, max-age=0, must-revalidate`. That includes the
  hashed `/assets/*` files, whose names change on every release. `vercel.json` sets no `headers`.

## Outcome

### Step 1: what the client feels

1. **No black flash.** The stand-in is replaced by a still of our own globe:
   - rendered from the same shader at time 0;
   - transparent background;
   - the size of the whole globe box, so the Earth sits exactly where the moving globe draws it.

   The fade from the still to the moving globe is invisible.
2. **The globe carries over between pages.**
   - The three Earth images are fetched and decoded once per visit, off the main thread
     (`createImageBitmap`), and every later globe reuses them.
   - The animation time is shared, so the next page's globe continues from where the last one was,
     instead of restarting.
   - A globe whose images are already in hand draws on its first frame with no fade.
   - An unmounted globe releases its WebGL context (`WEBGL_lose_context`).
3. **The 34 MB GIF goes.** The walkthrough backdrop becomes a small image that loads lazily (see
   open question 1). Its look stays the same: same position, opacity, darkening and slow CSS spin.

### Step 2: the rest

4. **Signed-out visitors don't download the terminal.**
   - `TerminalShell`, `AdminApp` and `PersonaChooser` load on demand (`React.lazy`) behind a plain
     loading state.
   - The sign-in and sign-up pages start fetching the terminal in the background after they mount,
     so signing in doesn't wait for it.
5. **Smaller Earth images, with the same look at the sizes drawn:**
   - `day` at 2048 × 1024;
   - `clouds` at 2048 × 1024;
   - `oceans` at 1024 × 512.

   All three are WebP. Measured in a trial: about 0.66 MB in total, against 2.28 MB. `CREDITS.md`
   records the resizing (CC BY 4.0 allows adaptation with attribution).
6. **Small logo and globe images.**
   - A 128 px copy of the logo (`logo-128.webp`; drawn at most 52 px) is used wherever it is shown small. `logo.png` stays as the favicon
     and share image, and the admin-set favicon override is untouched.
   - A WebP copy of `globe.png` serves the forgot-password and reset-password pages.
7. **Caching (needs approval, deployment config).** In `vercel.json`:
   - `/assets/*` is cached for a year as immutable, because the file names are content hashes;
   - `/brand/*` is cached for a day, with a week of stale-while-revalidate.

   Changed brand files get new names (or a `?v=` bump), so a stale copy is never served.

## Acceptance

### Tests

Each guard is shown to fail without its code.

- The globe:
  - uses the transparent still, not `fallback.jpg`;
  - a second element reuses the first's decoded images without fetching again;
  - a new element starts at the shared time;
  - disconnecting releases the WebGL context;
  - an element with cached images is ready without the fade class.
- `HomePage` no longer references `globe.gif`, and its backdrop image is lazy.
- `App.jsx` imports `TerminalShell`, `AdminApp` and `PersonaChooser` lazily. A build check confirms
  that the signed-out entry chunk contains no terminal module.
- A size budget on images under `public/brand` that the marketing pages reference: none over
  600 KB.
- `vercel.json` carries the two cache rules (once approved).

### Browser, production build

- **Flash.** Walk home → sign-in → pricing → sign-up → home twice:
  - no frame shows a black background;
  - after the first page, every globe is ready on its first frame and continues the previous one's
    time;
  - no WebGL-context warning in the console after 20 page changes.

  The browser pane must be visible for this, because a hidden pane pauses motion.
- **Weight.** A first visit to the signed-out homepage downloads under 2 MB in total, against about
  40 MB. The before and after for each row of the table above are recorded.
- **Look.** Side-by-side screenshots of the globe and the walkthrough backdrop, before and after, at
  1440 and 375 px, for the owner and client to approve before merge.
- **Signed in.** Signing in from sign-in and opening a desk still work, and a signed-in reload goes
  straight to the terminal.

### After deploy (owner's push)

- `curl -I` on the live site shows the new cache headers.

### Gates

- `npm run lint`, `npm test`, `npm run build`, and the router import check.

## Plan

| Task | Write scope | Depends on |
|---|---|---|
| T1 Globe handover | `nterGlobe.js`, `nterGlobe.css`, new `public/brand/auth-earth/globe-still.webp`, the globe tests | None |
| T2 Walkthrough backdrop | `HomePage.jsx` (backdrop only), its `marketing.css` rule, the new backdrop image, `homeHero.test.jsx` | None |
| *Checkpoint: owner and client look at T1 and T2* | | |
| T3 Terminal on demand | `App.jsx`, `LoginPage.jsx` and `SignupPage.jsx` (prefetch only), an App test, a build-chunk check | T1 |
| T4 Smaller images | new WebP textures and `TEXTURE_URLS`, `CREDITS.md`, the small logo and its `<img>` uses, the WebP `globe.png` for forgot and reset | T1 |
| T5 Caching | `vercel.json` and its test | Owner approval |

The tasks run in order on one branch, `task/page-speed`. I'm the supervisor and do them myself, with
an independent review before merge. I push only on the owner's word.

## As built (2026-10-14, `task/page-speed`)

Measured on production builds of `main` (before) and the branch (after), signed out:

| First homepage visit | Before | After |
|---|---|---|
| Walkthrough backdrop | 34.4 MB GIF | 11 KB still (`walkthrough-globe.webp`), lazy |
| Main script (gzip) | 722,868 B | 219,578 B (`TerminalShell`, `AdminApp`, `PersonaChooser` are their own chunks) |
| Main stylesheet | 462 KB | 462 KB. The terminal split (T3) left it byte-identical, measured before and after T3. Across the branch, only the intended globe rules (T1) and the loading and error styles (review) are added. The lazy modules' styles stay in the entry through the generated `src/shell/terminalStyles.js`, and `check:bundle` now fails if any other stylesheet is emitted. |
| Earth images | 2,276 KB (JPEG) | 525 KB (WebP; 2.5 of 255 mean difference per channel at the largest globe) |
| Stand-in | 143 KB black-background photo | 87 KB transparent still of our own globe |
| Logo | 164 KB | 4 KB (`logo-128.webp`; the favicon, share image and an admin-set favicon unchanged) |
| Total | about 40 MB (about 37.7 MB over the wire) | about 2.0 MB decoded, about 0.94 MB over the wire |

- **Page changes (dev, 24 changes):** every globe after the first was ready at once with no fade
  (`globe-instant`) and continued the previous globe's time. No WebGL warnings appeared.
- **Screenshots:** before and after at 858 px, and after at 375 px (no sideways scroll), show the
  still and the moving globe identical at t = 0, and the same globe and backdrop before and after.
- Also in this change:
  - `scripts/bundle-baseline.json` is re-measured. On `main` it was already 76,697 B gzip over its
    stale baseline.
  - `CREDITS.md` records the re-encoding and the new still.
- `globe-still.webp` and `walkthrough-globe.webp` were rendered in the browser from the shader and
  from the GIF's first frame, then encoded with `cwebp`.
- **Review (independent, 2026-10-14):** nothing critical. Fixed:
  - A late lost-context event from an old canvas no longer breaks a reconnected globe.
  - A failed download of the terminal reloads once (`vite:preloadError`, at most once a minute) and
    otherwise shows a Reload screen (`ChunkBoundary`), not a white page.
  - A signed-in visitor's terminal download starts at start-up.
  - The Earth turns only once drawn, so a slow first load starts from the still.
  - A context made before a texture failure is released.
  - The import scanner ignores comments.
  - The default logo matches with or without `?v=`.
  - Tests reset the shared state.
- **After the push (2026-10-14):** live headers as intended. Vercel also sends the one-year header
  with a 404 under `/assets/`. That includes the news snapshot's missing `/assets/uploads/` images
  (F146). The owner approved narrowing the rule to top-level build files (`/assets/([^/]+)`); Vite
  emits no subfolders.
- Still to check after the owner's push:
  - the cache headers on the live site;
  - that a missing `/assets/` file does not come back with the one-year header (`curl -I` on a made-up
    name).

## Not in scope

- Moving forgot-password and reset-password to the new globe: a page change, not a speed fix.
- Removing the unused `three` package (a dependency change, noted under F141).
- Further splitting of the terminal's own bundle, including the 1.4 MB PDF worker, which already
  loads only on demand.
- The F140 notes on the globe's focus listeners and the rear label that stays clickable through
  Earth.
