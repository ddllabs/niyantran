# One header on every page (F120)

> **Status: Living.** Owner request 2026-10-13: "This page is not
> consistent… especially the home page all sections are not present. The
> search bar looks different." Branch `task/consistent-header`.

## Problem

The header controls depended on the page:

- "All sections" appeared only on the eight desk landings;
- refresh appeared only on Home and module pages;
- below about 1,110px the search box shrank to its 260px minimum and cut its
  label short ("Search desks, modules a…").

The box itself was identical (measured 360px at 1200px on every page). Only
its neighbours and position changed.

## Outcome

- `DeskDirectory` ("All sections") renders on every page.
- Refresh renders on every page:
  - on Home and module pages it is "Refresh feed", as before;
  - on landings it is "Refresh desk summaries", and the landing view is keyed
    by the reload count, so its summaries are requested again.

  This reverses the 2026-10-12 decision to hide it there as ineffective.
- The search button has an explicit `aria-label` (the full label). Below
  1,110px it shows the short label "Search the terminal" ("टर्मिनल में खोजें")
  instead of truncating.

## Acceptance evidence

- Tests written first and seen failing:
  - `TerminalShell.test.jsx`: All sections, search and refresh on Home, two
    landings and a module page; the landing refresh label on all eight
    desks; the feed refresh on Home and a module;
  - `DeskCatalogueSearch.test.jsx`: both labels and the `aria-label`.
- Browser check on a local fixture, since deleted:
  - at 1200px, Home, National and a module page show the same controls, with
    the search box at the same position and width (x 488, 360px) and its
    full label uncut;
  - at 1440px the full label fits (432px);
  - at 939px and 375px the short label shows, uncut;
  - nothing overflows or scrolls sideways at any of these widths.
- Lint, `npm test` (2,587) and the build pass.
