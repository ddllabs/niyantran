# Module: desk-navigation

> **Status: Living.** Owner approved scope and implementation on 2026-10-12.

## Outcome

Home and internal workspaces offer the same top-level desk navigation as landing
pages. Remove the desktop left desk rail from those views, reclaiming its width.
Keep the sector/module menu as a distinct navigation level.

## Scope

src/shell/TerminalShell.jsx, DeskDirectory.jsx, DeskRail.jsx, deskDirectory.css,
deskRail.css, narrowly related src/index.css shell grid rules and colocated tests.
Inventory imports before deciding whether unused rail files can be removed.
DeskNav.jsx only if placement requires it; preserve its module selection behavior.

## Acceptance

1. One visible top-level navigation: Home plus eight desks, consistent labels,
   current-desk indication and keyboard focus across landing/workspace/record.
2. No duplicate desktop left desk rail; module navigation remains independently
   usable. At small widths use horizontal scrolling with visible focus, not
   clipped labels or a nine-column squeeze.
3. All eight desk destinations open; all 35 picture-card defaults and 120 sibling
   modules remain reachable through explorer and module menus/search. Deep links,
   browser back/forward, copy/export and record selection retain behavior.
4. Returning to any landing closes the AI panel; existing outside-click dismissal
   and preservation of mounted conversation state do not regress.
5. Free signed-in access remains: no Upgrade lock or commercial row cap.
   Authentication/account authorization and AI limits stay intact.
6. Verify loaded/empty/error routes honestly: unavailable provider data is an
   identified backend dependency, not a reason to invent content or widen scope.

Use index.md commands and eight-desk browser matrix. This module is access
verification plus UI navigation, not new backend integrations for every module.
