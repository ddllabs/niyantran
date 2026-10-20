# Open plan chooser and rollover retirement preparation

> **Status: Normative.** Owner scope,2026-10-21.

Keep Choose your plan always visible, retain current-plan badge and explicit confirmation, remove open/close toggle and duplicated saved-choice summary. Preserve billing history position. Repair stale billing subsection anchors while retaining legacy page compatibility and page-scoped/reduced-motion scrolling.

Remove future 10% rollover benefit promises from pricing,billing UI and Terms/Refund copy (update affected dates). This supersedes earlier frontend rollover copy requirements only. Do not claim the backend has stopped granting rollover yet. Preserve actual rollover lot/history rendering and spendable balances. No SQL/data/Production change in this frontend phase.

Acceptance: chooser visible on bare billing route and after updates; current plan retained; actual navigation scrolls to the intended current section without scrolling terminal header; old layout target fallback works; no new rollover promise in pricing/checkout. Existing financial checks unchanged. Backend retirement inventory and next steps tracked separately.
