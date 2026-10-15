# Module pages that cannot scroll, are cut off, or lose their menu (F203)

> **Status: Living.** Owner request 2026-10-16, UI only. Built on `task/module-scroll`.

## Owner report

"Scroll is frozen on this page" (MP Report Cards); "hovering on any of these elements sometimes auto
closes the popup … not persistent"; "in one of the MP related pages … the top section was being cut
off"; "on most of these pages, either scroll is stuck or views are cut off … why isn't the UI of the
tables consistent all across?"

## Findings (measured on production, read-only, all 120 desk modules)

Each module was opened at 1440 × 900 and at 1200 × 800, and `main.main-col` (the module area, which
hides overflow) was checked for content it clips.

- **Two layouts.** 101 modules use the shared table (`.feed-col`) and none of them clip. The other 19
  are hand-built pages: 8 National panels (`.nat-panel`) and 11 bespoke pages inside `.alliances-wrap`
  (MP cards, alliances, dashboards, maps). Every defect is in those 19.
- **The bottom 36 px is cut off (7 modules):** Delimitation Impact Simulator, LS Manifestos & Promises,
  National Morning Brief, Statement & Quote Tracker, Budget Utilisation & Schemes, Industry Updates,
  Centre-State Fund Flow. `.nat-panel` is `height: 100%` with `padding: 12px 16px 24px` in content-box
  sizing, so it is always 36 px taller than the area; the area hides the rest.
- **No scroll at all (2 modules):** MP Profiles & Performance (18,010 px of cards unreachable) and
  Centre-sanctioned Projects. Their `.alliances-wrap` has `min-height: 100%` and no overflow, so it
  grows past the area, and the area hides it.
- **The top cut off:** `main.main-col` is `overflow: hidden`, which a browser still scrolls for focus
  and `scrollIntoView`. On a page taller than the area (the MP cards), focusing a card further down
  scrolls the hidden area, the top disappears, and the wheel cannot bring it back.
- **The right side cut off (3 modules at 1200 px):** Alliances, Sanctions and Global Aid. Their column
  is about 570 px wide beside the map, and the feed bar (`minmax(260px, 1fr) auto`, 412 px of stats)
  and the tool row (230 px + 3 × 108 px) do not fit; their narrow layouts switch only on the window
  width (1280 px for two tool columns, 640 px for one), not on the column's.
- **The menu "closing" on hover:** a category menu (240 px) is wider than its tab and reaches under the
  next tab. Moving the pointer down-right from a tab to its menu crosses the neighbouring tab, which
  switches the open menu at once (the owner's screenshot shows "Electoral Data" underlined with the
  Representative & Media menu open). The menu's position is also read once, so it drifts if the row
  scrolls sideways.

## Expected outcome

- `main.main-col` is `overflow: clip` (it cannot be scrolled, even by focus), so content can never be
  shifted out of reach; whatever scrolls is the page's own scroller.
- `.nat-panel` is `box-sizing: border-box`, so it fits the area exactly and scrolls inside.
- A bespoke page's `.alliances-wrap` directly in the desk is the page's scroller: `height: 100%`,
  `overflow-y: auto`, `overscroll-behavior: contain` (the rule F196's party map added for itself,
  made general).
- The Alliances desk lays out by its own width (a container query at 720 px): the feed bar and tool
  row stack, and the stats wrap.
- Category menus: moving onto another tab while a menu is open switches only after the pointer rests
  there for 160 ms (leaving it cancels), so a diagonal move to the menu keeps it; the menu follows its
  tab when the row scrolls or the window resizes.
- Table styles are not unified in this change (see "Not in this change").

## Acceptance evidence

- Unit tests: the CSS rules above, the menu's switch delay (pure function) and its wiring.
- The 120-module measurement re-run with the change in place (desktop and 1200 px): no clipping.
- `npm run lint`, `npm test`, `npm run build`, `node scripts/check-bundle.mjs`.

## Not in this change

Making the 19 hand-built pages use the shared table look. That is a design decision per page (some
are cards, maps or simulators, not tables); options go to the owner separately.

## Review and checks (2026-10-16)

Independent `agent-skills:code-reviewer` on `53130d9`: approve. Taken up: the Alliances container
rules are scoped to `.alw-desk` so the later 1280 px window rule cannot undo them; the transit-map
and policy-graph module areas clip too; `overflow: hidden` stays first as the fallback for Safari
before 16; the menu looks its row up once so its scroll listener is always removed.

Browser check on the signed-in local preview:
- The 12 affected modules at 1440 × 900 and the worst at 1200 × 800: nothing clipped, nothing cut on
  the right.
- MP Profiles: focusing card 200 scrolls the card list (9,090 px), the module area stays at 0, and the
  header can be scrolled back to.
- Menus (simulated pointer): passing over the next tab for 60 ms keeps the Electoral menu; reaching the
  menu keeps it; resting on the next tab for 250 ms switches.
- `check:bundle` fails on `main` before this change too (222,128 bytes against a 221,993 limit, from
  other work); this change adds nothing to the main bundle.
