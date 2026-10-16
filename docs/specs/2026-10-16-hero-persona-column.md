# Homepage hero: persona column and coverage box (F212)

> **Status: Living.** Owner request 2026-10-16, UI only. Built on `task/F212-hero-persona-column`.

## Reference

The client's `NTER-Final-Developer-Kit` (top section v5: `hero/top-screen.html`, `top-screen.css`,
`personas/personas.js`, `top-screen-v5-preview.png`). It is a reference mockup, not code to integrate:
only what changes the page is carried over, and every figure comes from our own system.

## Current state

The hero (`src/marketing/HomePage.jsx`, `homeHero.css`) has two columns: the copy with three figures
under it, and the globe. A separate horizontal "Curated for" strip of the six personas sits below the
hero; each opens that persona in the personas section further down.

## Expected outcome (owner decisions 2026-10-16)

1. **Persona column.** The strip moves into a third hero column: "CURATED FOR", "Find your
   perspective.", "One platform. Built around you.", six cards (icon tile, plural name, the
   reference's one-line subtitle) and the hint "Choose a role. Discover your view." The strip is
   removed.
2. **Persona popover.** Hovering (mouse) or focusing a card previews its popover; clicking keeps it
   open, clicking the open card again closes it; Escape, ×, or a press outside closes it (Escape and ×
   return focus to the card). Content is the reference's, word for word: kicker "YOUR NTER
   PERSPECTIVE", the plural name, the description, two points, and "Explore this perspective", which
   opens that persona in our personas section (the reference links to the persona's section on the
   same page). The text lives in `src/lib/personas.js` beside the personas.
3. **Coverage box.** The three figures under the copy become a full-width box under the hero, "THE
   RECORD, AT A GLANCE", with seven figures: bills on record and ministries (live counts), research
   modules, source endpoints, intelligence desks (the desk count already used by pricing and the proof
   card: 8), houses covered (2) and coverage since (1952) from `preview-figures.json`. No date line:
   the site shows no date for its figures.
4. **Look.** The reference's card, popover and box styling, the large coloured figures, and its
   layouts: three columns from 1101 px; copy across the top with the globe and a 200 px persona column
   from 701 to 1100 px; one column below 701 px with cards two across and the popover below them.
   Coverage box seven across, four across up to 1100 px, two across below 701 px.

## Not changing

The header, the hero copy and buttons, the globe (and its pause button), fonts, every section below
the hero. Not carried over: the reference's Replay button and first-card auto-preview (owner agreed),
its globe copy, scripts, font and hard-coded figures.

## Acceptance evidence

- Static-render tests: the column's six cards in order with names and subtitles; the popover content
  per persona; the seven figures from the system sources; the strip and the old figure row gone.
- Unit tests for the popover state (hover, focus, click to pin and unpin, leave, Escape, outside).
- Each new test shown failing against the defect it guards.
- `npm run lint`, `npm test`, `npm run build`, `node scripts/check-bundle.mjs`.
- Browser check at 1440 × 900, 1280 × 720, 1024 × 768, 768 × 1024 and 375 × 812: hover, click, Escape
  and the explore link; no horizontal scroll; the hero and box fit the first screen on a laptop.
- Keyboard check in the browser (real key presses): Enter on a card moves focus into its popover, so
  every persona's explore link is reachable; the explore link moves focus to the personas heading;
  Escape pressed elsewhere on the page closes the popover without moving focus or scrolling.

## Review fixes (independent review, 2026-10-16)

The reference's script carried three focus defects, fixed here: tabbing towards the popover opened each
later card in turn (only Academics' link was reachable); Escape anywhere pulled focus back to the hero;
the explore link left focus on the page body. Also: a mouse-focused card no longer holds a preview open
after the pointer leaves, the leave timer is cancelled by focus and click, focus rings use the purple
(3:1 on white), card hover applies only on devices that hover, the shell keeps `overflow: hidden`
before `clip` for Safari before 16, and a pinned popover on a phone scrolls into view.

Raised for the owner: the reference's smallest text (8 px hint, 8.5 px subtitles in light grey) is below
the 4.5:1 contrast for body text. F213 (owner 2026-10-16, "make it a bit larger"): subtitles and hint
10 px (10.5 px on phones), the popover kicker 9 px, nothing in the column or box below 9 px; colours
unchanged.
