# Plan: questions that sound simple but need digging (`research-coverage`)

> **Status: Living.** Implements `docs/specs/2026-10-02-research-coverage.md` (F53).
> - The tasks run in order. The code tasks are test-first, and each task is committed once
>   verified.
> - The measurement waits for the owner's spot-check (T2).
> - Deploying `research-chat` waits for its own go-ahead.

### T1. The coverage test set and its score
- **Acceptance:**
  - `eval/agent/coverage.v1.jsonl` holds about 15 questions on replica bills. Each has 2–5
    points, and each point names its passages by chunk ID and `chunk_hash`.
  - A check script confirms every pinned passage exists with its hash.
  - It rejects a question whose points all sit in one passage.
  - Five questions are drawn for the owner's spot-check.
- **Files:** `eval/agent/coverage.v1.jsonl`, `scripts/bench-agent/coverage.ts`.

### T2. The owner's spot-check
- **Acceptance:** the owner reviews five questions, each with its points and passage text. The
  result and any fixes are recorded in the spec.
- **Gate:** T5 does not start before it.

### T3. The nudge (fix B), off by default
- **Acceptance:**
  - Pure functions for S1 (an unfollowed section, clause or Schedule reference) and S2 (**Not in
    record.** after fewer than two searches).
  - An agent option `digNudge` (default off) that retracts the draft and sends the nudge once per
    turn. It never fires with the search budget spent, or on a conversational turn.
  - Deno tests fail first.
- **Files:** `supabase/functions/research-chat/agent.ts`, `agent_test.ts` (a new small module
  only if `agent.ts` would grow unreadable).

### T4. The coverage check (fix A), off by default
- **Acceptance:**
  - A prompt option `coverageCheck` (default off) adds the coverage-check paragraph.
  - The handler and production leave it off.
  - The prompt test fails first.
- **Files:** `supabase/functions/research-chat/prompt.ts`, `prompt_test.ts`.

### T5. Measurement (paid, about $3–4, local)
- **Acceptance:**
  - Variants `v46`, `check`, `nudge` and `both`, plus the coverage score, in
    `scripts/bench-agent/run.ts`.
  - Two passes over the coverage set, 10 narrow questions and 15 briefs, with the order rotated.
  - Ten answers per variant read by hand.
  - Results in `docs/research/2026-10-02-research-coverage.md`.

### T6. Decision
- **Acceptance:**
  - The pass marks are applied as the spec states.
  - A passing fix is turned on by default, with tests, and its deploy waits for a go-ahead.
  - With none passing, the risk is recorded with its measured size.

### Checkpoint
- Lint, both suites and the build pass.
- **Go-aheads:** the `research-chat` deploy, if a fix ships, and the push.
