# Spec: the AI chat's drop outline, duplicate attachments and Reload (`chat-attach-fixes`)

> **Status: Living.** Owner-approved on 2026-10-03: "Only when needed" for Reload, and "Yes, both"
> for the outline and duplicate handling. These were found in a local browser run the same day.

## Current state (measured)

**The drop outline shows only on the sides.** `.ai-shell.drop` draws a dashed outline 6 px inside
the chat. The toolbar (the top 48 px) and the composer (the bottom 167 px) are positioned and
have white backgrounds, so they paint over it. It shows only along the sides of the transparent
thread.

**Duplicates.** `attachmentIdentity` (`lib/aiDrop.js`) keys an attachment on its kind, title, desk,
module, URL, text length and `document_id`. `addChatAttachments` then skips a match silently.
- **The same file twice:** skipped, with nothing said.
- **A different file with the same name:** also skipped, which is wrong. A file's text sits inside
  `files`, so only its name is compared. Two different `notes.txt` files, and two different
  `report.pdf` files, each gave one chip.
- **The same bill, dragged from the table and then "Ask AI" on its record:** attached twice. The
  drag records desk `''` and the seed records `'national'`; the document key `bill:2026:156` is the
  same.

**Reload is always shown.** It re-fetches the saved messages, which matters only when:
- the connection was lost and the outcome is unknown;
- research is still running;
- a stop awaits the saved result;
- a load failed ("Try Reload");
- a message is still running.

The rest of the time it costs a row of about 34 px.

## Expected outcome

1. **The drop frame is an overlay above the toolbar, thread and composer:** a dashed border 6 px
   inside the chat, on all four sides and corners. It takes no pointer events.
2. **Identity:**
   - **A row** with a `document_key` is identified by that key, so the same bill is one chip by
     any route. A row without one keeps its title and module, but not its desk.
   - **A dropped file** is identified by its name, size and a SHA-256 of its bytes, recorded once
     when it is read.

   Stored attachments without these fields keep the old identity.
3. **A flag.** When an attach skips anything as already attached, a status line under the chips
   reads "Already attached: <names>". It clears on the next attach or send.
4. **Reload appears only in the situations above,** beside the message that calls for it. The row
   is not rendered when there is nothing to show.

## Acceptance evidence

- **Vitest, failing first:**
  - row identity by document key across the drag and seed shapes;
  - file identity by content (same name with different bytes is two chips; the same bytes is
    one);
  - the attach result naming the skipped items, and the panel's status line;
  - Reload hidden when idle and shown in each situation;
  - the CSS overlay frame.
- **A local browser run:**
  - the frame visible on all four sides;
  - two different same-named files give two chips, and the same file twice gives one chip and the
    note;
  - a bill dragged and then "Ask AI" gives one chip and the note;
  - no Reload when idle.
- **Lint, Vitest and the build pass.**

## Scope

`src/lib/aiDrop.js`, `src/lib/aiConversations.js`, `src/ai/useResearchThread.js`,
`src/ai/AiPanel.jsx`, `src/index.css`, and the tests.

## Exclusions

No change to what an attachment sends, and no server change.

## Recorded 2026-10-03 (built and checked locally)

- **Built:**
  - `attachmentIdentity` uses the document key, then a file's fingerprint, and leaves out the desk
    for rows;
  - `partitionAttachments` is shared by the store and the thread;
  - `filesFromDrop` records `fingerprint` (size and SHA-256);
  - the thread's `attachNotice` clears on attach, send, a new chat or a chat switch;
  - the panel shows the note and computes `needsReload`, and the controls row renders only with
    content;
  - the drop frame is `.ai-shell.drop::after`.
- **Tests:** 8 new tests across `aiDrop`, `useResearchThread`, `AiPanel` and `panelLayout`, each
  failing first.
- **Checks:** lint, Vitest (2,022) and the build pass.
- **A local browser run at 1440 × 900:**
  - idle, there is no controls row and no Reload;
  - the frame is a dashed 2 px border 6 px inside, at z-index 40, visible on all four sides;
  - `notes.txt` twice gives one chip and "Already attached: notes.txt";
  - a different file named `notes.txt` gives a second chip and no note;
  - a bill dragged from the table and then "Ask AI" gives one chip and "Already attached: THE
    NATIONAL CO-OPERATIVE DEVELOPMENT CORPORATION (AMENDMENT) BILL, 2026".
- **Noted, not changed:** two different files with the same name both show as "notes.txt".
