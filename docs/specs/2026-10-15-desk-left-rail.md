# Desk rail on module pages (F195)

> **Status: Living.** Owner request 2026-10-15. Built on `task/desk-left-rail` (from
> `task/chat-credits-strip`, so the two merge in order).

## Current state

- Every page shows the desk tabs (`DeskLandingTabs`, Home … Entertainment) as a row in the header.
  On a module page a second row (`DeskNav`, `.desktabs`) shows the desk's categories.
- A left desk rail existed from `6aefc5a` (2026-10-05) to `b0ba405` (2026-10-12, F102: "Remove the
  desktop left desk rail from those views, reclaiming its width", owner-approved). It was 104 px wide,
  icon and name stacked in 64 px buttons, with no collapse. Its files stayed on main, unused.

## Owner decisions (2026-10-15)

"The top-level navigation is fine, but once a person … comes inside National, the subcategories bar
should have the horizontal bar styling. The primary desk landing bars should become a left-side
collapsible menu." The old rail was "a little too thick and wide". This revisits F102 for module
pages only.

1. Collapsed by default: icons only.
2. Expanded, it lies over the page; the page does not reflow.
3. Phones and narrow windows (900 px and below): a Desks button with a drawer.
4. Build it (not a revert): the old rail had no collapse, and `b0ba405` no longer reverts cleanly.

## Expected outcome

- **Landing pages, Home and the credits page:** unchanged; the desk tabs stay in the header.
- **Module pages, over 900 px:**
  - The header loses its desk-tab row; the category row is the only bar under it.
  - A 56 px rail on the left lists the toggle, then every desk the reader has (icon, the current desk
    highlighted, an "Upgrade" mark on a locked desk). Each desk keeps its name for screen readers and
    shows it on hover.
  - The toggle widens the rail to 208 px with names, over the page (shadow, no reflow). It closes on
    the toggle, Escape, a click outside, or picking a desk. It is not remembered between pages: an
    overlay left open would cover the table.
- **Module pages, 900 px and below:** no rail column. A "Desks" button starts the category row and
  opens the rail as a drawer from the left (up to 280 px, 86% of the width) over a dimmed page. Focus
  moves into it and returns to the button on Escape.
- **Escape order:** an open rail is an Escape owner, so the AI panel stays open (F193 `escapeAction`).
- **Motion:** names fade in (160 ms, ease-out); the drawer slides in (220 ms, transform). None with
  reduced motion. Hover styles only on devices that hover.

## Acceptance evidence

- Unit tests: the rail's markup (toggle state and names, current desk, locks, Hindi), the shell
  (module pages render the rail and no desk tabs in the header; landing pages the reverse), the Desks
  button in `DeskNav`, the rail as an Escape owner, the CSS (56 px column, 208 px overlay, drawer at
  900 px). Each new test fails before the change.
- Browser check on the local preview at desktop and phone widths, light and dark.
- `npm run lint`, `npm test`, `npm run build`, `node scripts/check-bundle.mjs`.

## Exclusions

No change to the desks a reader has, to the category menus, to the side panel, or to landing pages.

## As built (2026-10-15)

`DeskRail.jsx` and `deskRail.css` rewritten in place (the F102-era files), `TerminalShell.jsx` (class
`with-desk-rail`, no header tabs on module pages, the rail before `DeskNav`), `DeskNav.jsx` (the Desks
button), `SidePanel.jsx` (`.desk-rail.open` is an Escape owner), regenerated `terminalStyles.js`.

Browser check (signed-in local preview, port 5182):
- 1440 px, a National module: header 65 px after the review fix (was about 107 px with the tab row), rail 56 px, the
  category row from x = 56; open, the rail is 208 px with a shadow and the work area stays 1,384 px;
  focus goes to the current desk; Escape and a press outside close it; the Desks button is hidden.
- 390 px: no rail column, no header tabs, the Desks button shows; it opens a 280 px drawer, full
  height, over a scrim, focus on the current desk; Escape closes it and focus returns to the button;
  no sideways scroll.
- The National landing page keeps the header tabs and has no rail.

## Review (2026-10-15)

Independent `agent-skills:code-reviewer` on `b431fc7`: ready with nits. Fixed:
- The rail closes on any change of page (the shell compares `tab|featureName|account`), so back,
  forward, a category, search or the credits page no longer carry an open rail or drawer along.
- The header's bottom padding now applies (`.terminal.with-desk-rail > .topbar` outranks
  `.with-v6-directory>.topbar`); the redundant border is gone.
- The open rail sits above the category row (z-index 90, under the header's 200).
- It closes when focus leaves it (not when focus goes to the Desks button, whose click toggles it).
- Escape is left to a dialog opened over it.
- The scrim closes from its own click, so a tap on it does not reach the page under it.
- The Desks button is a disclosure (`aria-expanded`, `aria-controls`), no `aria-haspopup`.
Left as found: no focus trap in the phone drawer (it closes when focus leaves it instead).

Rechecked in the browser: header padding 12 px (65 px header); the point above the category row's
middle inside the open rail hits the rail; the rail is closed after leaving and returning to a module;
on a phone the Desks button opens and closes the drawer, a press on the scrim does not close it but its
click does.
