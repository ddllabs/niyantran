# Chat reading space and durations (F71)

> **Status: Historical (2026-10-04).** Owner approved 2026-10-04.

Current: dock defaults to 36%, long headers force wide tables, expanded flow
shows reasoning tokens and no duration split. The owner wants chat as wide as
the desk and agrees to user-facing durations instead of tokens.

Outcome: one shared 50% dock default; explicit remembered widths and current
bounds/resizing/expansion retained. Table headers and long text may wrap; wider
tables still scroll. Expanded activity displays known Searching, Processing,
Writing durations, without reasoning-token counts. Processing is the existing
residual timing, not measured model reasoning; no invented missing durations.
Live flow stays open until completion (F70).

Acceptance: equal default geometry at desktop widths, saved width respected,
mobile stacking unchanged; representative three-column table fits, wider table
can scroll; zero/missing/invalid duration and token rendering checks pass.
Scope: sidePanelModel, index.css, chat-presentation.css, ResearchFlow,
ActivityTicker timing prop wiring, focused tests and task records.
Exclude backend changes, provider reasoning exposure and production publication.
