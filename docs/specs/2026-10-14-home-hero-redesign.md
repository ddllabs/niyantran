# Spec: homepage header, hero, globe and "Curated for" strip (F140)

> **Status: Living.** Owner request 2026-10-13, after the client's review of the design
> `NTER-Homepage-Final.html` and the globe package `globe-animation/` (both in the owner's Downloads,
> not in the repo). On `task/home-hero`, in its own worktree, in parallel with the AI-credits work.

## Decisions (owner, from the client, 2026-10-13)

1. The UI elements, colour scheme and colour pattern follow the design exactly: white, the brand
   palette (blue #293FA5, purple #572C91, red #C2353D, sand #E5D3BB, ink #252425, muted #716D79,
   line #E7E3EA) and its type scale. The data and links stay ours: we are the source of truth.
2. The hero's mouse-follow effect goes.
3. Each globe label opens its desk landing or terminal page.
4. The design's "200+ authoritative sources" becomes the seed source count. Measured from
   `src/data/source-registry.json` on 2026-10-14: 246 unique source endpoint URLs across 138 modules
   (55 named providers). The old hand-typed "211+" was an earlier count and is banned by
   `siteFigures.test.js`, so the figure is a constant that a test recounts from the registry.
5. Header: ours, with the design's improvements, and not thick: keep it sticky and 72 px; add
   "Data coverage"; move "Sign in" beside the "Get started ↗" button; the "BY NTER.PRO" sub-line and
   the red dash under the current page.

## Current state

- `src/marketing/MarketingSite.jsx`: cream, frosted, sticky 72 px header; links Home · Pricing ·
  Sign in · Get Started; a ☰ menu on phones.
- `src/marketing/HomePage.jsx` hero: cream with diagonal brand shapes, scan line and grid; a
  mouse-follow parallax; "● LIVE · RESEARCH TERMINAL · SYS/READY_"; the headline; a mono telemetry
  line (modules, bills, documents); three buttons; `AuthEarth` with the six personas fixed around it.
- `AuthEarth` stays for the sign-in, sign-up and pricing pages; only the homepage changes globe.

## Outcome

**Header (all marketing pages).** White, sticky, 72 px, bottom line #EEEAF0. Logo with "TERMINAL"
and "BY NTER.PRO" beneath. Links Home · Data coverage · Pricing (12 px, 600); the current page in
blue with a 12×3 px red dash. Actions: "Sign in" (text) and "Get started ↗" (blue button, purple on
hover). Phones keep the ☰ menu holding every link. "Data coverage" scrolls to the coverage section
(from other pages, it opens Home and scrolls).

**Hero (homepage).** As the design:
- white, with the design's radial colour clouds (sand, purple, blue, red) around the globe only;
- "✳ THE RESEARCH TERMINAL" eyebrow (red spark, purple text);
- the headline on four set lines, "Government," blue, "Policy" purple, the full stop red; 600
  weight; the design's size and tracking;
- the hook on two lines, then the description;
- "Open the terminal ↗" (primary) and "See plans" (secondary); "View data coverage ↓" link;
- the figures row under a line: **9,817** Bills on record (blue) · **120** Research modules (purple,
  `DESK_CATALOGUE.length`) · **246** Source endpoints (red, `SITE_FIGURES.endpoints`). Numbers come
  from `src/lib/siteFigures.js`;
- no mouse-follow, no scan line, grid or diagonal shapes.

**Globe.** The design's component (`<nter-data-globe>`): WebGL Earth with drifting clouds, ocean
glint and halo; two inclined orbits (52 s, 61 s) whose seven labels scale with depth, pass behind
Earth (hidden and not clickable there) and return; rings drawn behind and in front of Earth; pauses
on hover or focus, offscreen, in a hidden tab and for reduced motion; a still image without WebGL.
Adapted, not copied whole:
- textures load from our existing files `/brand/auth-earth/{day,clouds,oceans}.jpg` instead of 3.3 MB
  of embedded base64; the NASA fallback becomes `/brand/auth-earth/fallback.jpg`;
- the embedded Inter font is dropped (the site already uses Inter);
- the module loads after first paint (dynamic import), as `AuthEarth` does;
- credits: the NASA fallback is added to `public/brand/auth-earth/CREDITS.md`.

**Globe labels → destinations** (signed out: the destination is remembered and the visitor signs in
first, the coverage carousel's existing hand-off through `niyantranLand` / `niyantranFeature`):

| Label | Key | Opens |
|---|---|---|
| Bills | `bills` | National · Bill Passage Probability Index (the bill register) |
| Laws & judgments | `law` | Law desk landing |
| Regulatory notes | `regulatory` | National · Regulatory Body Watch (RBI/SEBI/TRAI/CCI) |
| News & reporting | `news` | Terminal Home (hot topics, latest and news) |
| Parliamentary questions | `questions` | National · Parliamentary Question Database |
| Economic indicators | `economics` | Economics desk landing |
| Global affairs | `global` | Global desk landing |

**"Curated for" strip (new, under the hero).** As the design: a 3 px four-colour bar on top (blue
0–29 %, purple 29–53 %, sand 53–76 %, red 76–100 %), a tinted band, "CURATED FOR" and the six
personas from `src/lib/personas.js` with the design's icon tiles. Each scrolls to our "Built for the
way you work" personas section.

## Acceptance

- Tests: the figures come from `siteFigures.js`, and `endpoints` equals the registry's unique source
  URL count; each globe key maps to the table above and hands off through the existing keys; the
  header has the new links and order; no mouse-follow handler on the hero; the strip lists the six
  personas. Each guard is shown to fail without its code.
- Browser at 1440, 1366, 939 and 375 px: layout, colours and spacing match the design screenshot;
  labels pass behind Earth and return; a label click hands off; reduced motion pauses the globe; no
  horizontal scroll; the sign-in and pricing pages still show `AuthEarth`.
- `npm run lint`, `npm test`, `npm run build`.

## Plan

| Task | Write scope | Owner |
|---|---|---|
| T1 Globe module | new `src/marketing/nterGlobe.js`, `src/marketing/nterGlobe.css`, its test; new `public/brand/auth-earth/fallback.jpg`; `public/brand/auth-earth/CREDITS.md` | Task agent |
| T2 Header | `src/marketing/MarketingSite.jsx`, header rules in `src/marketing/marketing.css` | Supervisor |
| T3 Hero, strip, figures | `src/marketing/HomePage.jsx`, hero and strip rules in `marketing.css`, `src/lib/siteFigures.js` and its test | Supervisor, after T1's interface |

T1's interface is fixed now: `import('./nterGlobe.js')` defines `<nter-data-globe>` (guarded), which
fires a bubbling `data-select` event with `{ key }`; `nterGlobe.css` styles `.nter-globe-scene` and
`.data-orbit-*`.

## Not in scope

The homepage sections below the strip (the design has its own versions; a later request), the
pricing and sign-in pages, and the terminal.
