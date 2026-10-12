# Drag a record to AI from any panel tab (F113)

> **Status: Living.** Done and owner-confirmed on production 2026-10-13. Approved 2026-10-13 ("go ahead with both"). Branch
> `task/panel-drag-ai` from `main` at `75d44cf`.

## Problem

A bill or row dragged to the right-hand panel was accepted only while the AI
research tab was open. Over Desk, Record or the collapsed handle the drop did
nothing, so the reader had to open AI first and drag again.

## Outcome

- A Niyantran record (`application/x-niyantran-ai`) or a file dragged over the
  panel switches it to AI research, from Desk, Record or collapsed (which
  expands). The chat's existing drop frame then shows. Other drags (plain
  text) are ignored.
- A drop the chat takes is handled as before. A drop elsewhere on the panel
  (the tab bar), or one made before the chat's thread has loaded, is handed to
  the chat as its seed (`niy-ai-open`), which waits until the chat is ready, so
  the item is not lost.

## Acceptance evidence

- Tests written first and seen failing: `panelDragProps` in
  `SidePanel.test.jsx` (5) and `isAiDrag` / `handOffAiDrop` in
  `aiDrop.test.js` (4).
- Browser (local fixture, since deleted), with dispatched drag events from a
  Bill Passage row: Desk → AI, Record → AI, collapsed → AI expanded; a drop on
  the chat before it was ready and a drop on the tab bar each raised
  `niy-ai-open` with the row; a plain-text drag was not accepted.
- A real attach in a signed-in chat: the fixture had no session and agents do
  not sign in; the owner confirmed on production on 2026-10-13 that a dragged
  bill attaches.
- `npm run lint`, `npm test` (2,578), `npm run build`, Deno tests (881) pass.

## Scope and exclusions

`src/shell/SidePanel.jsx`, `src/lib/aiDrop.js`, `src/ai/AiPanel.jsx` and their
tests. Excluded: pages where the panel is hidden (no rail and AI closed; there
is no panel to drop on), drag styling changes.

Known quirk (unchanged behaviour of the seed path): a files-only hand-off while
a row is selected also attaches the selected row.
