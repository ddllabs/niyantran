# Side panel collapsed by default on module pages (F114)

> **Status: Living.** The owner approved this on 2026-10-13 ("go ahead"). It
> replaces amendment 2's rule in the
> [side-panel spec](2026-10-03-side-panel.md) that "a page load always opens
> the panel". Branch `task/panel-collapsed-default`, from `main` at `b9a14aa`.

## Problem

On module pages the right-hand panel opened on Desk at half the workspace, so
the table was squeezed: the owner's screenshot shows the Sector column cut off.
Landing pages already start with the panel out of the way.

## Outcome

- A module page loads with the panel collapsed to the slim bar. The table gets
  the full width: 1,384px instead of about 930px at a 1440px window.
- Clicking a row opens the panel on Record, as before.
- The panel collapses again when:
  - the selection is cleared;
  - AI is closed with no row selected;
  - the user moves to another module, unless AI is in use.
- Picking up a record or file anywhere on a module page opens AI at once, on
  the first `dragenter`, so the drop target is the full panel rather than the
  slim bar (F113 covers drops on the panel).
- The slim bar still opens Desk, Record or AI with one click. Desk is mounted
  when it is first opened.
- Unchanged:
  - landings and desks without a rail;
  - "Ask AI" entry points;
  - outside dismissal;
  - the stacked bar below the narrow-screen breakpoint.

## Acceptance evidence

- Tests written first and seen failing: seven `sidePanelModel.test.js`
  expectations rewritten for the new resting rule, and two `dragOpensAi` tests
  in `SidePanel.test.jsx`.
- Browser check on a local fixture, since deleted, on Bill Passage Probability
  Index at 1440px:
  - load: collapsed, 32px bar, table 1,384px;
  - row click: Record open;
  - another module and back: collapsed;
  - picking up a row: AI open;
  - a plain-text drag: nothing.
- At 768px the collapsed bar is the existing stacked bar, with no sideways
  scroll.
- Lint, `npm test` (2,580 tests) and the build pass.

## Exclusions

Remembering a reader's open or collapsed choice across modules is deferred
until it is asked for.
