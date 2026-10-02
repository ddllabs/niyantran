# Spec: the research turn's prompt size (`chat-turn-cost`): F41, and F46's agent-loop cost

> **Status: Living.** Approved by the owner on 2026-10-02:
> - "Measure, then cap", with earlier rounds never summarised away;
> - the student persona stays as it is; its cost is only reported. It covers open-work F41 and the cost and speed
> item still open from F46 (`research/2026-10-02-chat-experience-review.md`, D1).
> - Deploying `research-chat` waits for its own go-ahead.
> - Paid benchmark runs are named in the plan with their estimated cost.

## Current state (read from code, 2026-10-02; `supabase/functions/`)

- **Every round of the agent loop re-sends the whole conversation of the turn**
  (`research-chat/agent.ts:611`): the system prompt, history, the question, every earlier tool
  reply and every draft.
- **A `search_documents` reply** carries up to 40 passages (`_shared/retrieval.ts:52`), each
  untruncated. Chunks are about 1,000 characters and can reach 6,000. That makes roughly 10–13k
  tokens per search, so a 4–5-search brief sends tens of thousands of prompt tokens per call.
- **Nothing bounds prompt size.** The budget counts calls and searches only:
  `{maxSteps: 12, maxSearches: 10, maxContinuations: 2}` (`agent.ts:18`).
- **A widened search** retries without its scope and returns a full 40 passages from the whole
  corpus (`agent.ts:461-509`). The scoped search had found nothing, so those passages are the least
  likely to be on target. The four widened cases are `empty`, `unresolved`, `unkeyed` and
  `feature-empty`.
- **The system prompt** is about 5k tokens, but about 17k with the student persona: `student.md` is
  48,816 characters, against 1.2–1.9k for the others.
- **Measured:**
  - one turn re-sent 170,367 prompt tokens over 6 calls, in 53 s, for $0.105 (review D1);
  - F41's widened bill question waited 65 s, 46 s of it one Gemini call on a 25,850-token prompt;
  - in the local benchmark, a call after one search used 8–18k prompt tokens.
- **The benchmark** (`scripts/bench-agent/run.ts`) never widens, because it always runs `broad`
  focus with no scope, and it records prompt tokens per question, not per call.

## Problem

Prompt size grows with every search and is never bounded, and a model call's time grows with its
prompt. Widened turns are the worst case: the most passages, the least relevance.

The owner's standing priority is depth over speed (answer-speed amendment 1): a cap must not cost
research depth.

## Expected outcome

1. **Measure first.** The benchmark gains:
   - per-call prompt tokens and call time;
   - a `widened` variant (attached focus with no resolvable document, so `unkeyed`);
   - a `desk` variant whose module filter misses (`feature-empty`).

   It reports prompt tokens per call (p50/p90/max) by variant.
2. **A smaller widened retry.** A widened search returns at most 15 passages (`WIDENED_TOP_K`)
   instead of 40. The first, scoped search keeps 40.
3. **A cap on each tool reply.** A `search_documents` reply keeps its passages in similarity order
   and stops adding them once it reaches a character budget (`TOOL_REPLY_CHARS`, proposed 24,000,
   about 6k tokens). Handles are assigned only to passages kept, so citations stay valid.
   - The value is set from step 1's numbers. It applies only if the depth pass mark below holds.
4. **No compaction of earlier rounds.** Earlier tool replies are not summarised away. That would
   cost citation depth and break the prompt cache. This is excluded unless the measurement shows
   2 and 3 are not enough.
5. **The student persona's size** is reported to the owner with its share of every call (about
   12k tokens). It is not changed here.

**The depth pass mark:** the one from amendment 1, now for each variant against the current v44
code (`presearch2`):
- searches, distinct documents and distinct pages cited are not lower on average;
- citations stay 100% valid;
- the expected-document rate is not lower;

on narrow questions and briefs. The widened variant must cite at least as validly.

## Acceptance evidence

- **Agent tests, failing first:**
  - a widened search asks for 15 passages;
  - a reply over the budget stops at the passage that would cross it, and gives no handle to
    passages left out;
  - an unscoped first search still asks for 40.
- **Benchmark:** before and after, on the same questions. Prompt tokens per call, total and
  first-word time, cost, and the depth pass mark, recorded in
  `docs/research/2026-10-02-turn-cost-benchmark.md`.
- **Checks:** Deno tests, lint and the build pass.

## Scope

`supabase/functions/research-chat/agent.ts` (and `index.ts` wiring of `topK`),
`supabase/functions/_shared/retrieval.ts` (a `topK` argument), `scripts/bench-agent/run.ts`,
tests, docs.

## Exclusions

- The frontend.
- Retrieval quality (reranking is P6).
- The persona files.
- Prompt-cache changes (the Gemini breakpoint decision stays parked).
