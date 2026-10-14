# Spec: globe position and sizes (F177)

> **Status: Living.** Owner request 2026-10-14: on Pricing the globe sits at the extreme right; give it
> padding. On the homepage make the globe 5% larger; on sign-in and sign-up make it 5% smaller. "The
> globe" means the whole globe box (Earth, orbits, labels, pause control), not the Earth alone. Built
> on its own branch, `task/globe-layout`, from the pushed `main`; nothing shared with other work.

## Current state (browser check on the local copy, 2026-10-14)

Globe box, as left edge / width / gap to the screen's right edge, in CSS pixels:

| Screen | Home | Pricing | Sign in | Sign up |
|---|---|---|---|---|
| 1920×1080 | 873 / 756 / 291 | 1496 / 400 / **24** | 863 / 806 / 251 | 148 / 905 |
| 1440×900 | 633 / 756 / 51 | 1016 / 400 / **24** | 620 / 765 / 56 | 106 / 517 |
| 1200×800 | 529 / 623 / 48 | 776 / 400 / **24** | 854 / 310 / 36 | 95 / 310 |
| 900×900 | 399 / 469 / 32 | hidden | 216 / 469 / 216 | 36 / 280 |
| 390×844 | 22 / 346 / 22 | hidden | 12 / 366 / 12 | 12 / 366 |

- **Pricing** (`.mkt-pr-earth`, `marketing.css`): the globe column is the last grid track of the
  hero, flush with the content edge, 24 px from the screen; a label reaches 18 px from it.
- **Home** (`.nd-globe-column`, `homeHero.css`): `width: 100%`, capped at
  `min(756px, 100svh - 144px)`, centred with auto margins.
- **Sign in / sign up** (`.mkt-globe-slot > .nter-globe-scene`, `marketing.css`): the scene is 93.75%
  of its box beside the form, 100% in a box under 440 px, and `min(156.25%, 100vw - 24px)` in the
  stacked layouts.

## Outcome

1. **Pricing:** from 1025 px up (where the globe shows), the hero keeps `clamp(32px, 5vw, 96px)`
   of padding on its right (`box-sizing: border-box`), so the globe and its labels sit inside the
   page instead of on the edge. Size unchanged (400 px).
2. **Home:** the globe box is 5% larger at every width: `width: 105%`, cap
   `min(756px, 100svh - 144px) × 1.05`, kept centred on its column (`justify-self: center`, which
   also centres it when it is wider than the column). Phones: 105% of the column, inside the
   screen's gutter.
3. **Sign in / sign up:** the globe box is 5% smaller at every width. The three scene widths are
   multiplied by `--globe-scale`, which the two pages set to 0.95; Pricing keeps 1.

## Acceptance evidence

- Browser measurements at the five screens above: Pricing gap ≥ 24 + 32 px with the width unchanged;
  Home scene width × 1.05 (±1 px) and centred on the old centre (±1 px); sign-in and sign-up scene
  width × 0.95 (±1 px), same centre; no horizontal scroll on any page.
- Tests in `src/marketing/DataGlobe.test.jsx` ("globe position and sizes") that fail on the old CSS.
- `npm run lint`, `npm test`, `npm run build`, `node scripts/check-bundle.mjs`.

## Exclusions

The globe itself (`nterGlobe.js`, `nterGlobe.css`), page copy, other layout, and the hidden Pricing
globe below 1025 px.

## As built (browser check on the local copy, 2026-10-14)

Globe box after the change, as left edge / width / gap to the screen's right edge (CSS px). Every
page has no horizontal scroll at every size.

| Screen | Home (× 1.05) | Pricing | Sign in (× 0.95) | Sign up (× 0.95) |
|---|---|---|---|---|
| 1920×1080 | 855 / 794 / 272 | 1400 / 400 / **120** | 883 / 766 / 271 | 170 / 859 |
| 1440×900 | 615 / 794 / 32 | 944 / 400 / **96** | 639 / 727 / 75 | 118 / 491 |
| 1200×800 | 513 / 655 / 32 | 716 / 400 / **84** | 862 / 295 / 44 | 103 / 295 |
| 900×900 | 387 / 493 / 20 | hidden | 227 / 445 / 227 | 43 / 266 |
| 390×844 | 13 / 363 / 13 | hidden | 21 / 348 / 21 | 21 / 348 |

- Every width is the old width × 1.05 or × 0.95 to within 0.1 px, and each globe's centre is where
  it was (to within 0.1 px).
- On Pricing the nearest label is now 136 px from the screen's edge at 1440 px (it was 18 px). At
  1030 px it is 76 px. The heading keeps its left edge, and the plan cards are unchanged.
- On the homepage at 1440×900 the labels stay inside the hero (282–770 px in a hero that spans
  73–843 px).
- The first Pricing attempt put a margin on the globe column. That shrank the globe instead
  (400 → 304 px), so the space moved to the hero's padding. Without `box-sizing: border-box`, that
  padding widened the hero past the page (the heading moved 24 px left), so the rule sets it.
- **Trade-off, for the owner (independent review).** The homepage cap `min(756px, 100svh - 144px)`
  kept the header, hero and "Curated for" strip within one screen. Where the screen's height sets
  the cap, × 1.05 pushes the bottom of the strip below the fold: 1440×900 877 → 915 px; 1366×768
  746 → 772 px. Screens where width sets the size (1920×1080, 1200×800) are unaffected. The
  alternative, `min(756px * 1.05, 100svh - 144px)`, keeps the strip within one screen. It would,
  however, leave the globe unchanged on those screens, which is not what was asked, so it was not
  used.
- Review notes: `justify-self: center` centres the wider box in Chromium (measured). Safari and
  Firefox were not checked. If either aligned it to the start, the box would overflow about 38 px
  on the right at 1440 px, with no clipping or scroll. At 1025 px Pricing's copy narrows from 588 to
  537 px, and the heading wraps to two lines.

## Revision 2 (owner, 2026-10-14, after the local preview)

- **Pricing globe 10% larger** (the owner asked for 5–10%): the column is now
  `calc(min(400px, 34vw) * 1.1)`. At 1440 px the globe is 440 px and still 96 px from the edge, with
  the nearest label 102 px from it. The heading still fits on one line, and the hero ends exactly
  where the notes below begin (589 px), with the labels ending at 508 px. At 1025 px the globe is
  383 px and the copy is 502 px wide (the heading wraps to two lines, as before).
- **Sign-in 5% smaller again**: `--globe-scale: .9` (10% below the original) on sign-in only.
  Sign-up stays at .95. At 1440 px sign-in measures 689 px (originally 765).
