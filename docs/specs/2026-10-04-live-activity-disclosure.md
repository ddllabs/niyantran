# Live activity disclosure (F70)

> **Status: Historical (2026-10-04).** Owner requested 2026-10-04.

Current state: ActivityTicker defaults closed. The owner verified live icons
and steps work after manually expanding it. Expected: start expanded during
an active turn, retain the manual chevron, collapse on completion, and allow
reopening the completed trace. A new active turn opens again. No visual,
stream protocol, token usage, provider or deployment changes.

Acceptance: initial active render exposes steps; active/inactive transitions
reset disclosure appropriately; manual toggles persist within a phase.
Scope: ActivityTicker.jsx, its tests, affected prior expectations and task docs.
