# Sector picture cards select; module cards open (F119)

> **Status: Living.** The owner approved this on 2026-10-13 ("The arrow card
> should not open anything… Make the switching noticeable. Make sure this is
> optimized on phone as well."). It amends
> [desk-direct-entry](2026-10-12-desk-direct-entry.md). Branch
> `task/sector-card-select`.

## Problem

On every desk landing, clicking a picture card opened that sector's default
module page at once. The module cards below switched as well, but the page
changed before the switch could be seen.

## Outcome

- A picture card is a button (`aria-pressed`, `aria-controls` the module
  list). Clicking it selects the sector, stays on the landing and announces
  "<sector>: N modules shown below." The ↗ arrow is removed from the cards.
- The module cards (with their chevron) are the only way into the terminal
  from the landing, and each opens its exact page, as before.
- The switch is visible:
  - the chosen card has an accent ring and a filled number badge;
  - the module explorer glows briefly, a 1.2s ring that the reduced-motion
    and pause rules stop;
  - if the explorer is outside the visible scroll area (a phone, a short
    window, or under the header), it scrolls into view, smoothly, or
    instantly when motion is off;
  - keyboard selection also moves focus to the module list.
- The "Select a sector" dropdown still switches modules, and the matching
  card highlights with it, without the glow or the scroll.
- `DESK_DEFAULTS` (`deskDefaults.js`) no longer drives the UI; its
  membership test is kept.

## Acceptance evidence

- Tests written first and seen failing:
  - `deskDefaults.test.jsx`: cards are buttons, open nothing, have no arrow,
    one is pressed, and they control the list; across all eight desks;
  - `DeskLandingFrame.test.jsx`: four `revealModules` cases (scroll when
    below, leave when visible, instant without motion, focus for keyboard),
    plus one for a list hidden under the header.
  - `deskLanding.test.jsx` (Global) now expects the Geonomics card label
    instead of the old "Open …: Global Trade" label.
- Browser check on a local fixture, since deleted:
  - National at 1440px: cards 3 and 5 switched the explorer and the hash
    stayed `#/national`; a module card then opened
    `#/national/Budget Utilisation & Schemes`;
  - Global at 375px: tapping a card scrolled the explorer from 778px (below
    the 664px content edge) to 138px, with no sideways scroll;
  - Law: the dropdown switched sectors and highlighted the matching card,
    with no glow.
- Lint, `npm test` (2,583), the build and `verify-desk-v6-assets` pass.
