# Restore the original V6 module explorer

> **Reconciled 2026-10-13 (F105):** this work is in `main` and production (`70267e8`). Lines below that call it uncommitted, local only or unmerged describe its state on the date written.

> **Status: Living.** Owner correction and sector-selector decision approved on 2026-10-12. Supersedes the accordion design in the earlier module-discovery spec.

The implementation at 66c7944 introduced a new accordion design rather than
restoring the V6 component the owner intended. Reference authority is
Downloads/nter-all-sections-v6.html, its renderModules function and explorer
markup; application authority is DeskLandingFrame before 9fe245e. Both show
an always-visible selected-sector explorer, left sector heading/description/
coverage badge and right icon/title/count/coverage/arrow module cards, with
responsive grids and existing reveal behavior.

Restore that component/layout below picture cards on all eight desks, using
the existing CSS. Owner chose to retain direct picture-card defaults and add
a sector selector within the explorer. A native labelled select on its left
changes the displayed sector; all sectors remain selectable irrespective of
the picture-card source filter. Text cards are canonical links intercepted by
onFeature on ordinary clicks, preserving modified/middle clicks. No module
popup. Keep the independent data-breakdown dialog and shared ModuleDetail API.

Scope: DeskLandingFrame.jsx, deskLandingV6.css, DeskLandingFrame.test.jsx and deskDefaults.test.jsx;
this spec, a short plan, current discovery spec, foundation amendment and
additive F100 tracker/evidence. No corpus/data, defaults, workspace, account,
AI, header or free-access policy changes. No merge, push or deployment.

Acceptance: reference/class/layout match; initial first sector visible without
expansion; all 35 sector selections expose the exact 120 modules and honest
summary values; all 35 picture-card defaults unchanged; direct module clicks
without dialog; source filter independence; State context intact; keyboard
select/link navigation and modified clicks; light/dark, 320/390/768/1024/1440
widths and reduced motion without overflow. Preserve AI dismissal/draft checks.
Verify a new restoration guard fails against the accordion before relying on
its passing result; run focused checks, full npm test, lint/build/assets.
