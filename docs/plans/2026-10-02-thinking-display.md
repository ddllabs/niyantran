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

**T4. NTER**, each step with its own go-ahead:
1. deploy `research-chat`;
2. push the frontend.

Then the owner checks.
