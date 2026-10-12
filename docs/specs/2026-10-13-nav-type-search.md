# Terminal navigation, type scale and search (F112)

> **Status: Living.** The owner approved the plan on 2026-10-13 ("go ahead with
> both"). Branch `task/nav-type-search`, from `main` at `1940b02`.

## Problem

The owner reviewed the signed-in terminal and raised four points:

- Home showed a second row that said "Choose a desk to begin", although Home
  is already the default view.
- The primary desk tabs (Home, Global, National and the rest) were small and
  hard to tell apart from secondary text.
- The desk landing pages used nearly one size and one weight for headings,
  stats, card titles and descriptions, so the page had no visible order.
- The search box was narrow, and its label ("Find a module") undersold that it
  also finds desks and records.

## Outcome

- Home shows no module row. The module navigation row appears only on module
  routes (`with-module-navigation`).
- The desk tabs are 40px tall and use 14px text. The current desk has an
  accent tint, a heavier weight and a 2px underline. The wrapped row is not
  animated when the user prefers reduced motion.
- Landing pages use one type scale under `.desk-v6.desk-v6`:
  - hero h1: 40–58px, weight 700;
  - section h2: 24px, weight 700;
  - stat values: 30px, weight 700;
  - card titles: 15px, weight 650;
  - descriptions: 12–15px;
  - eyebrows and status text: 11px.
  Sector cards grow to fit their text (minimum height 228px). Text inside
  the artwork is unchanged.
- The search box is 260–440px wide (30vw) and 40px tall, with the label
  "Search desks, modules and records" (Hindi: "डेस्क, मॉड्यूल और रिकॉर्ड
  खोजें") and a ⌘K key cap. It spans the full width on phones.

## Acceptance evidence

- `TerminalShell.test.jsx` "Home is the default view" failed before the
  change and passes after it. `DeskCatalogueSearch.test.jsx` expects the new
  label.
- Browser check (local fixture, since deleted). Pages checked: Home,
  `#/national`, `#/global`, `#/carbon` and a Carbon module. Viewports: 1440px,
  768px and 360px, in light and dark. No page scrolled sideways, and no
  sector card clipped its text.
- `npm run lint`, `npm test` (2,569 tests), `npm run build` and
  `node scripts/verify-desk-v6-assets.mjs` all pass.

## Scope

In scope: `src/shell/DeskNav.jsx`, `src/shell/TerminalShell.jsx`,
`src/shell/DeskCatalogueSearch.jsx`, their tests,
`src/shell/deskDirectory.css`, `src/shell/deskCatalogueSearch.css` and
`src/desks/landing/deskLandingV6.css`.

Excluded: the marketing site, module content, the artwork images and their
overlay labels, and the drag-to-AI panel change (F113).

## Amendment 1 — 2026-10-13: hero height

The owner reported the desk heroes cut off: the hero kept its fixed height
(242–298px) while the title grew, so "Explore the desk" was clipped under the
stats strip and the floating insight card ran into the photo label. The hero
now grows with its content (`height:auto`, 28px bottom padding), with a
minimum of 288px (320px from 1700px and at 850px and below; none on phones),
and the insight card text is 11px.

Evidence (local fixture, measured on all eight desks at 360, 800, 1000, 1440
and 1800px): the button sits at least 35px inside the hero, the insight card
no longer overlaps the photo label or the title, and phones do not scroll
sideways.
