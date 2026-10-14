# Plan: AI credits (F111)

> **Status: Living.** This plan is the working log for F111: progress is
> ticked here as it happens. It implements the
> [spec](../specs/2026-10-14-ai-credits.md), approved by the owner on
> 2026-10-14, and the decision record
> [ADR 0011](../decisions/0011-per-user-credit-ledger.md).
> - **Branches.** Code goes on `task/ai-credits`, in worktree
>   `.claude/worktrees/ai-credits`, branched from `main` when the owner says
>   start. Concurrent UI tasks get their own worktrees (see the table).
> - **Start.** Nothing starts before the owner's word to start.
> - **Production.** Nothing goes to production without the owner's go-ahead
>   naming the step.

## Method

- **Skills.** Every task starts with `using-agent-skills`. The supervisor
  uses:
  - `planning-and-task-breakdown` (this plan);
  - `incremental-implementation` and `test-driven-development` (each task);
  - `security-and-hardening` and `code-review-and-quality` (the reviews);
  - `git-workflow-and-versioning` (commits).
- **Order.** The work is sequential by default (coordination protocol).
  Tasks run concurrently only when their write scopes are disjoint and the
  spec's §12 contracts already fix their interface.
- **Dispatch.**
  - Each task agent gets `docs/agents/onboarding.md` first.
  - Each dispatch uses the onboarding template: task, this plan, checkout,
    branch, exclusive write scope and verification.
  - Agents leave work uncommitted. The supervisor reviews, re-runs every check
    and commits each task on its own.
- **The supervisor's own share.** Task 0, task 7 (copy, after the owner's
  wording approval), every checkpoint, the local runs and all production
  steps.

| Task | Who | Model | Runs |
|---|---|---|---|
| 1 Database | task agent | Opus | alone; everything else depends on it |
| 1R Security review | `security-auditor` agent | Opus | after 1, before anything calls it |
| 2a, 2b research-chat | task agent (one agent, two increments) | Opus | after checkpoint A |
| 3 Dictation log | task agent | Sonnet | alongside 2a/2b, own worktree |
| 4a, 4b Chat UI | task agent | Sonnet | after checkpoint B, own worktree |
| 5 Plan & billing | task agent | Sonnet | alongside 4, own worktree |
| 6 Admin | task agent | Sonnet | alongside 4 and 5, own worktree |
| 7 Copy | supervisor | — | after the owner approves the wording |
| R Whole review | `code-reviewer` agent | Opus | before checkpoint C |

At most three agents run at once.

## Progress

- [x] Task 0: answer costs measured (2026-10-14; spec, Current state);
  `hold_credits` set to 300.
- [x] Task 1: database (`9e7559e`; 144 assertions, vacuity ok, two guard-removal proofs; full `npm run test:sql` green)
- [x] Review 1R: 3 defects + 7 minor, all fixed with failing-first fixtures
- [x] Checkpoint A (full `npm run test:sql` green, 26 fixtures, re-run by the supervisor)
- [x] Task 2a: reserve and claim (`8a2cec2`)
- [x] Task 2b: settle and frames, Stop-round cost in the background (`8a2cec2`)
- [x] Task 3: dictation log (`bb3004d`, merged `3c6c9af`)
- [x] Checkpoint B (local run 1): every case as expected, $0.03 spent ([evidence](../research/2026-10-14-ai-credits-local-run-1.md))
- [x] Task 4a: credits library and composer (`5b48a3d` store, `f4e25bd`)
- [x] Task 4b: per-answer credits (`f4e25bd`; shell listener by the supervisor)
- [x] Task 5: Plan & billing (`ccbefa2`, merged `87552f9`)
- [x] Task 6: admin (`8fef4ee`, merged `21a97b3`)
- [x] Task 7: copy (owner approved the §10.1 wording as written, 2026-10-14)
- [x] Review R: no critical findings; 2 important + 7 minor + nits fixed (`21d5c2d` frontend, `c035c2c` backend)
- [x] Checkpoint C (local run 2 in the browser, desktop and phone, $0.02; [evidence](../research/2026-10-14-ai-credits-local-run-2.md))
- [ ] Production steps 1–5 (each on the owner's go-ahead)

## Tasks

### 0. Measure answer costs (done)

- **What was run.** A read-only aggregate over production `model_call_logs`
  for 30 days, plus two aggregate counts on `auth.users` for email
  confirmation. Results are in the spec.

### 1. Database (migration and SQL fixtures)

**Write scope**
- `supabase/migrations/20261015xxxxxx_ai_credits.sql`, with a header naming
  F111, the spec link and a Down block.
- `supabase/tests/ai_credits.sql`.
- Its registration in `supabase/tests/run.sh`.

**Builds**
- Spec §12: the tables, invariants, functions and privileges.
- The `plan_grants` trigger, and the launch backfill for paid profiles that
  have no grant row (spec §4).
- The index on `model_call_logs (message_id)`.
- Helpers live in the `private` schema.
- The dollar-leak closure in §7:
  - revoke `authenticated` SELECT on `model_call_logs` and
    `chat_turn_traces`;
  - remove the cost keys from `chat_messages.usage`.
- Seeds:
  - `credit_settings` (95, 0.10, 10, 1000, 30 days, 12 months, 300,
    5 minutes; `launch_at` = when the migration is applied);
  - `credit_plan_allowances` (plus 2000, pro 6500, max 75000).

**Acceptance criteria**
- Every fixture in the spec's acceptance list passes as the non-superuser
  migrator.
- The runner's vacuity check fails it without the migration.
- `has_function_privilege` holds for `anon`, `authenticated` and
  `service_role` on every function the migration adds (enumerated from
  `pg_proc`).

**Verify**
- `npm run test:sql`.

**TenderBase reference** (read only;
`DDL Labs codebase/tenderbase-onboard/supabase/migrations/`)
- **The gate pattern.** `20260905211310` (`check_credit_cap`) for the order
  of checks. Do **not** copy its missing caller check.
- **Reservation against in-flight work.** `20260905170938`
  (`check_ingestion_credit_serialised`) for reserving against in-flight work
  under a lock. Do **not** copy its `p_org IS NULL → not blocked` (fail open).
- **Cycle maths.** `20260817191203` and `20260817202411`
  (`ensure_org_credit_period`) for the cycle maths. Do **not** copy the
  negative grant, the 10%-of-grant rollover (ours is 10% of the leftover) or
  the hourly cron.

### Checkpoint A

- Task 1's fixtures pass.
- Review 1R (`security-auditor`) has read the migration against spec §7 and
  §12, and every finding is fixed or answered.
- The supervisor re-runs `npm run test:sql`.

### 2a. research-chat: reserve before claim

**Write scope**
- `supabase/functions/research-chat/handler.ts`, `index.ts`,
  `persistence.ts` and their tests.

**Acceptance criteria**
- `reserve_turn_credits(user, turn_key, enforced)` runs before
  `claim_research_turn`. A replay is answered before reserve, as it is
  today.
- **Blocked.** A blocked reserve returns 402
  `{error, code:'credits_exhausted', balance}` and creates no message.
- **Error.** A reserve error returns 503, so the gate never fails open.
- **Shadow.** `CREDITS_ENFORCED` unset means shadow: a blocked reserve still
  holds, is logged, and the turn runs.
- **Retry.** A retry of the same `turn_key` gets its own hold back, not a 402.

**Verify**
- `deno test -A --config supabase/functions/deno.json supabase/functions`.

### 2b. research-chat: settle, frames and no dollars in messages

**Write scope**
- `supabase/functions/research-chat/handler.ts`, `telemetry.ts` and their
  tests.
- `supabase/functions/_shared/chatStream.ts` and its test.

**Acceptance criteria**
- **Settle.** `settle_turn_credits(user, turn_key)` runs after the telemetry
  flush, with a 3-second limit. A settle error or timeout is logged and never
  fails the turn.
- **Frame.** The terminal frame is sent before the flush today, as it should
  stay, so the answer is not delayed. After settle, a `credits` frame is sent
  if the stream is still open. Otherwise the client reads
  `my_conversation_credits`. The implementer reads the stream lifecycle and
  picks the one that works, without moving the terminal frame later.
- **The round cut off by Stop.** The recorder fetches its cost from
  OpenRouter's generation endpoint by generation id, bounded, during the
  flush.
  - First, one probe (`source-driven-development`) confirms the endpoint
    reports cost for an aborted stream, and how soon.
  - If it does not, the row stays uncharged and logged, and the spec is
    amended.
- **No dollars.** The `usage` saved on `chat_messages` has no cost key at
  any depth (including `observed`).
- **Order.** A test proves the settle happens after the flush. A Stop test
  proves the cut-off round is charged when its cost is known.

**Verify**
- The Deno suite.

**TenderBase reference.** Its talk-to-tender logs only the last round
(review §4.1). Our recorder already logs every attempt; keep it that way.

### 3. Dictation cost log (concurrent with 2a/2b)

**Write scope**
- `supabase/functions/transcribe-audio/handler.ts`, `index.ts` and
  `handler_test.ts`.

**Acceptance criteria**
- One `model_call_logs` row per call (`caller 'transcribe-audio'`), with
  cost when OpenRouter reports it.
- A log failure never fails the dictation.
- It is never charged.

**Verify**
- The Deno suite.

### Checkpoint B (local run 1, on a scratch Supabase stack)

- **Turns run.** Real OpenRouter turns:
  - a normal answer;
  - Stop midway;
  - a forced error;
  - two tabs on a low balance;
  - a balance taken negative, then repaid by an admin grant.
- **Checks.** Each charge equals logged cost × 950 (to 4 decimals). The ledger
  sums to the balance.
- **Spend.** Under $0.40 of the $1.00 test budget.

### 4a. Credits library and composer

**Write scope**
- New `src/ai/CreditBalance.jsx`. The shared store `src/lib/creditsStore.js`
  was written by the supervisor before dispatch, as the fixed interface for
  tasks 4, 5 and 6 (read only for them).
- `src/ai/ChatSubmit.jsx` and `src/ai/AiPanel.jsx`.
- Their tests and CSS.

**Acceptance criteria**
- `creditsStore.js` (done) calls `my_credits`, and formats credits and the
  rupee hint from the server's `inr_per_credit`.
- **Balance chip.** It shows next to the chat box, including a negative
  balance with "taken from your next credits".
- **Warning.** The low-balance warning shows at 10% of the allowance.
- **Blocked state.** The 402 state shows the balance plus Upgrade and Buy
  credits, which open Plan & billing.

### 4b. Credits on each answer

**Write scope**
- `src/ai/MessageRow.jsx`, `src/ai/useResearchThread.js` and
  `src/lib/researchChat.js`.
- Their tests.

**Acceptance criteria**
- **Finished answers.** A finished answer shows its credits from the frame,
  and from `my_conversation_credits` after reload.
- **Failed answers** say "No credits used".
- **Stopped answers** show what they were charged.

### 5. Plan & billing (concurrent with 4)

**Write scope**
- `src/shell/PlanBilling.jsx` and its tests.

**Acceptance criteria**
- Balance with the rupee hint.
- Lots by expiry.
- This cycle's use.
- Recent answers with credits.
- "Top-ups coming soon" while checkout is closed.
- No dollars anywhere.

**TenderBase reference**
- `src/components/storage/AiUsageCard.tsx` for the layout of used and left.
- `AiActivityTurnTable.tsx` for credits first, rupees second. We list answers
  only: no model rows and no dollars.

### 6. Admin (concurrent with 4 and 5)

**Write scope**
- `server/usersApi.mjs` and `src/admin/AdminPages.jsx`.
- Their tests.

**Acceptance criteria**
- **Balance.** The Users page shows each user's balance.
- **Adjustment.** An admin can grant credits, remove credits or grant a
  top-up, with a required reason. This goes through the existing admin check,
  then `admin_adjust_credits`.
- **Errors** are shown plainly.

**Verify**
- Router import check:
  `node -e "import('./api/router.js').then(() => console.log('router import ok'))"`.
- Vitest.

### 7. Pricing and policy copy (supervisor)

**Write scope**
- `src/lib/publicPlans.js`, `src/lib/legalPolicies.js` and their tests.

**Steps**
1. The wording is drafted in the spec.
2. The owner approves it.
3. It is applied.

**Acceptance criteria**
- No page still says "unused credits carry forward" or "remain".
- The credit amounts match `credit_plan_allowances`.

### Review R

- A `code-reviewer` agent reads the whole branch diff against the spec.
  - Correctness, security, simplicity and tests.
  - Findings are fixed or answered before checkpoint C.

### Checkpoint C (before any production step)

- **Checks.** These all pass: `npm run lint`, `npm run build`, `npm test`,
  the Deno suite, `npm run test:sql` and the router import.
- **Local run 2, end to end in the browser:**
  - a Free user spends the grant and is blocked;
  - an admin grants a top-up;
  - a Plus user crosses a cycle with the correct rollover;
  - phone and desktop widths.
- **Owner review.** Screenshots go to the owner.

### Production (each step on the owner's go-ahead)

1. Apply the migration.
2. Deploy `research-chat` and `transcribe-audio` in shadow mode.
3. Push `main` (Vercel).
4. Shadow week: each answer's charge matches its logged cost. Record this in
   `docs/agents/coordination.md`.
5. The owner sets `CREDITS_ENFORCED=1`, and `research-chat` is redeployed.

**Rollback**
- Unset `CREDITS_ENFORCED`. Turns then run unblocked, and no migration is
  undone.
- The migration's Down block drops only the new objects.

## Risks

| Risk | Mitigation |
|---|---|
| The wallet lock slows turns | One indexed row lock per reserve and settle; timed in local run 1 |
| A balance goes deep below zero | Hold 300 credits ≥ the dearest measured answer; one answer at a time when low |
| Free users leave debt unpaid | At most one answer's cost each; they are then blocked |
| Charges drift from OpenRouter's bill | Shadow-week comparison; the rate is a database setting |
| Repeated Free sign-ups | ₹100 each; production requires a confirmed email |
| The copy still promises the old rule | Task 7 lands with the rest, before enforcement |
| Expensive models drain credits fast (Claude Sonnet 5: about 12 answers on Plus) | The model picker's cost diamonds stay. Per-model credit estimates are a follow-up if users are surprised |
