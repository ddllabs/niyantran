# Plan: the research turn's prompt size (`chat-turn-cost`)

> **Status: Living.** Implements `docs/specs/2026-10-02-chat-turn-cost.md` (F41, F46 D1).
> - The tasks run in order, test-first, and each is committed once verified.
> - Deploying `research-chat` waits for its own go-ahead.

### T1. The agent's two limits
- **Acceptance:**
  - `WIDENED_TOP_K = 15`: every widened search (unconfined under a confining focus, or a retry
    after an empty scope or module) asks for 15 passages; scoped and broad searches ask for the
    default.
  - `TOOL_REPLY_CHARS = 24_000`: a `search_documents` reply keeps passages in order until the
    next would cross the budget, and always keeps the first. Only kept passages get handles and
    join the turn's chunks.
  - Both are agent options (`widenedTopK`, `toolReplyChars`); `null` turns each off (v44), so the
    benchmark compares the two on one code base.
  - Deno tests, failing first.
- **Files:** `research-chat/agent.ts`, `agent_test.ts`.

### T2. Wiring
- **Acceptance:** `topK` flows from the agent to `search()`:
  `handler.ts` passes it in the retrieval context, and `index.ts` hands it to `search`. The
  handler test covers it.
- **Files:** `research-chat/handler.ts`, `index.ts`, tests.

### T3. Measurement (paid, about $4–6 on OpenRouter)
- **Acceptance:**
  - `scripts/bench-agent/run.ts` records per-call prompt tokens;
  - a `widened` kind runs the narrow questions under `attached` focus with no document (unkeyed);
  - variants `v44` (both limits off) and `capped` (both on), on narrow, broad and widened
    questions;
  - results and the depth pass mark recorded in `docs/research/2026-10-02-turn-cost-benchmark.md`.
- **Decision:** a limit that fails the pass mark is turned off before deploying.

### Checkpoint
- Deno tests, lint and the build pass.
- **Go-ahead:** deploying `research-chat`.
