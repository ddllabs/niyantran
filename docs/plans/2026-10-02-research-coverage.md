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

**T1, recorded 2026-10-02** (`75da871`, `5da1c85`).
- **The set:** 15 questions on 15 bills, 65 points and 60 passages, pinned by chunk ID and hash.
  Each point is found by an anchor phrase, which also matches same-named copies; two real copies
  qualify.
- **The check script** passes against the replica. The scorer and hash-check tests fail on
  mutation.
- **The spot-check sheet** is `research/2026-10-02-coverage-spot-check.md`, with the owner.

**T3, recorded 2026-10-02.**
- **`research-chat/dig.ts`:** S1 and S2, and the nudge message.
- **`AgentDeps.digNudge`** is off by default. The nudge fires once a turn, in research, never on
  a conversational turn, and only with search budget left.
- **Tests:** 9 signal tests and 5 agent tests. The agent tests failed first. Removing the
  conversational or once-a-turn guard, the other-law filter, or the provision check each fails a
  test.
- **S1's worst-case firing rate** is 13% (spec amendment 1).
- **Checks:** Deno (855) and lint pass.

**T4, recorded 2026-10-02.**
- **`COVERAGE_CHECK`** goes after the fixed research guidance and before the persona, only when
  `PromptInput.coverageCheck` is set. The handler never sets it, so production prompts and their
  cache are unchanged.
- **The prompt test** failed first.

**T5 harness, recorded 2026-10-02** (before the spot-check).
- **`run.ts`:**
  - variants `v46`, `check`, `nudge` and `both`, on the deployed default code, each sending a
    `session_id`;
  - a `coverage` kind fed from the set, with the coverage score and full coverage per answer;
  - a count of nudged answers.
- **A one-question smoke run** passed and was deleted.
- **A headroom probe** ran with no decision taken on it: `v46` only, all 15 coverage questions,
  one pass, $0.44 (`eval/agent/results/2026-10-02T17-43-04-191Z.json`).
  - Coverage is 87.7%, and 10 of 15 questions are fully covered. Every citation was valid and
    every answer cited the expected bill.
  - **The eight missed points** are provisions later in the bill than the first search reached:
    - consequence clauses (State Emblem 7(2), Technology Bank 13);
    - procedure (Cultural Heritage 7 and 8; Domestic Violence 9, 16 and 18);
    - an extension (Population Policy 5).
  - **The pass mark is reachable by full coverage** (+3 questions, 13 of 15). A 10-point gain
    would need near-perfect answers (97.7%).
  - **One miss lies outside S1's reach.** Technology Bank clause 13 refers back to clause 10, but
    no cited passage refers forward to 13. Only fix A addresses it.
