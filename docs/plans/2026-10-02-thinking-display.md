# Plan: the AI Research thinking display

> **Status: Living (2026-10-02).** Implements `docs/specs/2026-10-02-thinking-display.md`. Branch:
> `task/thinking-display`. Tracked as open-work F46.

## Tasks

**T1. Server: labels and `found`** (S).
- **Files:**
  - `research-chat/agent.ts`: `TraceStep.found` from the result chunks, at most 3 documents with
    up to 5 pages each;
  - `research-chat/handler.ts`: the round labels; `found` on the end frame and the saved
    activity row;
  - `_shared/chatStream.ts`;
  - the tests.
- **Interface:** `found?: { document_id: string; title: string; pages: number[] }[]`.
- **Verify:**
  - `deno test -A --config supabase/functions/deno.json supabase/functions`;
  - the router import.

**T2. Client: one indicator, labels, Found line, summary** (M; after T1's interface is fixed, so
it can run in parallel).
- **Files:** `src/lib/researchChat.js`, `src/ai/ActivityTicker.jsx`, `src/ai/AiPanel.jsx`,
  `src/ai/research.css`, and the tests. `NyAiThinking.jsx` and `nyAiThinking.css` are removed.
- **Verify:** `npm run lint`, `npm test`, `npm run build`, `npm run check:bundle`.

**T3. Local browser run.** The bill is attached on the local stack; record a turn from Send to the
reload.

**Result (2026-10-02, executed): pass after two fixes.**
- **Setup:** `c234e51`, on the local stack. The bill was OCR'd for $0.048. Two answers cost $0.023.
- **Live recording:**
  - "Starting…" (0:00);
  - "Reading the question";
  - "Searching “Clause 11 whistleblower defence procurement”…";
  - "Searched … · 40 passages", with "Found so far: The Classified Information and Espionage
    Control Bill, 2025 (p. 1, 4, 5, 6, 9)";
  - "Reading the results" (said once) and "Writing the answer";
  - collapsed to "1 search · 9 sources · 22 s", with the clock at 0:22.
- No NyAI card appeared.
- **Reload parity:** the saved turns showed the same summaries, steps, Found lines and timing.
- **Fixed in the run:**
  1. **An empty indicator beside the saved answer.** As the answer was saved, the in-flight
     block flashed "Starting…" for about 33 ms: the stream clears a moment before `submitting`
     drops.
  2. **"Found so far" on a finished turn.** It now reads "Found".
- **Not changed:** the answer still arrives as one block (`writing_ms` about 0). That belongs to
  the speed discussion.

**T4. NTER**, each step with its own go-ahead:
1. deploy `research-chat`;
2. push the frontend.

Then the owner checks.
