# Spec: the AI Research thinking display (`thinking-display`)

> **Status: Normative — approved by the owner on 2026-10-02.**
> Owner decisions, 2026-10-02:
> - option A, "real progress";
> - sources are shown while the answer is worked out;
> - a collapsed summary when the turn finishes;
> - the robot card is dropped.
>
> **Amendment, 2026-10-04 (F63, owner-approved chat polish):** the live ticker
> starts collapsed and details remain available on demand. The finished count
> is labeled citations (Hindi: उद्धरण), not distinct sources/documents. The
> residual `reasoning_ms` bucket is labeled Other processing, regardless of
> token usage; it does not measure thinking duration. These rules supersede
> the initial open state and timing wording below.
>
> **Amendment, 2026-10-04 (F65):**
> [Research flow](2026-10-04-research-flow.md) governs the current presentation:
> highlighted model/effort summary, open monoline recorded stages and query/result
> badges. The subsequent owner amendment removes the technical disclosure and
> keeps the exact model ID and requested effort at the top.
> Measured reasoning-token counts may appear; private reasoning prose is not
> exposed or reconstructed. The collapsed default and honest timing labels above
> remain in force.
>
> **Amendment, 2026-10-04 (F70/F71):** live stages start expanded, then
> collapse when generation finishes. Manual disclosure remains available.
> User-facing token counts are replaced with known Searching, Processing and
> Writing durations; Processing is residual elapsed time, including waiting.
> This supersedes the collapsed live default and optional token display above.
> [Reading-space spec](2026-10-04-chat-reading-space.md) records this change.

> The model's own reasoning text (option B) is out of scope. Evidence:
> `docs/research/2026-10-02-chat-experience-review.md` (C1–C5). Tracked as open-work F46.

## Current state

From Send to the answer, a turn shows:
1. the "NyAI is thinking" card (`NyAiThinking.jsx`). It actually covers the client's identity
   re-check, not server work;
2. a differently styled ticker (`ActivityTicker.jsx`). Its stage label, "Reviewing the
   question.", repeats on every model round (six times in the recorded turn), and it is also the
   finished summary.

Searches show their terms and result counts live. They do not say what was found.

## Expected outcome

**1. One indicator from Send.**
- The ticker mounts as soon as the question is submitted, in place of the card, with the label
  "Starting…". It is open, at a fixed position under the reader's question.
- `NyAiThinking.jsx` and `nyAiThinking.css` are removed.

**2. Labels describe what is happening, once each:**

| When | Label |
| --- | --- |
| The first research round | "Reading the question" |
| Each later research round | "Reading the results" (shown once, not once per round) |
| An answer-only round | "Writing the answer" |
| The first answer text, if no round said so | "Writing the answer" |
| A search starting | "Searching “<terms>”…" |
| A search finished | "Searched “<terms>” · 40 passages", or "Looked up <module> · 8 rows" |

- Scope-widening notices are unchanged.
- The live header shows the current label and an **elapsed clock** (m:ss), counted from Send.

**3. Sources while it works.** A finished document search lists what it found:
- **At most 3 documents,** in result order;
- **for each, its title and up to 5 page numbers** (pages only for page-aware documents);
- **one shared line under the steps,** "Found so far: <title> (p. 4, 7, 9) · …". It lists each
  document once, merging pages across searches.
- **Server:** these are retrieved candidates, not citations, so the wording is "Found", never
  "Sources". The end frame of `search_documents` and its saved activity row gain
  `found: [{ document_id, title, pages: number[] }]`, built server-side from the chunks the search
  returned.
- No chunk text is sent. A desk-row search sends no `found` list.

**4. Finished: a collapsed summary line.**
- **Format:** "5 searches · 3 sources · 53 s".
  - "searches" counts finished searches;
  - "sources" counts the answer's readable citations;
  - each part is omitted when it is zero.
- **Expanding it** shows the steps, the "Found" line, and the timing line ("searched 4s ·
  thought/waited 37s · wrote 11s"). That timing line already exists.
- **It stays collapsed** unless the reader opens it.
- **Legacy saved turns** render with the same summary format. They have no `found` lists, so they
  have no "Found" line.

## Acceptance evidence

- **Tests, each shown red first:**
  - the label mapping (rounds → one label each);
  - the summary line;
  - `found` built from chunks: 3 documents at most, 5 pages each, no text;
  - the client merges the `found` lists;
  - the ticker renders on submit with no card;
  - legacy activity rows still render.
- **Repository checks:**
  - `npm run lint`;
  - `npm test`;
  - `deno test` for `research-chat`;
  - `npm run build`;
  - `check:bundle`;
  - the router import.
- **A local browser run** with the bill attached:
  - one indicator from Send, with no card;
  - the clock advances;
  - the "Found" line names the bill and its pages;
  - the label changes from round to round;
  - the collapsed summary;
  - reload parity.
- **On NTER,** each step with its own go-ahead: deploy `research-chat`, then push the frontend.

## Scope

**Write scope:**
- `supabase/functions/research-chat/{agent,handler}.ts` and their tests;
- `supabase/functions/_shared/chatStream.ts` (the tool frame type);
- `src/lib/researchChat.js` (`found` passes through on merge);
- `src/ai/ActivityTicker.jsx`, `src/ai/AiPanel.jsx`, `src/ai/research.css`;
- removing `src/ai/NyAiThinking.jsx` and `src/ai/nyAiThinking.css`;
- the related tests.

**Exclusions:**
- the model's reasoning text;
- streaming the answer as it is written;
- the panel's loading in stages;
- the agent loop's speed and cost;
- keeping the reader's open/closed choice across the swap from the live turn to the saved one;
- the phone dock height (F47).

## Order

**Frontend and server together.** The client tolerates frames without `found` (the old server)
and the server's new field (an older client ignores unknown keys), so either side can ship first.
# F64 amendment (2026-10-04)

> **Status: Normative.** The owner-approved
> [activity-details spec](2026-10-04-activity-details.md) supersedes model
> headings, timing prose and search-state rendering. Model/requested effort now
> belong in the accordion; action and timing measurements appear as structured
> rows. Backend measurement additions are local until separately deployed.
