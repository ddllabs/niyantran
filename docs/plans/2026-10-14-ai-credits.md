# Plan: AI credits (F111)

> **Status: Living.** Implements the [spec](../specs/2026-10-14-ai-credits.md)
> once the owner approves it. Branch `task/ai-credits-spec` for the documents.
> Code goes on `task/ai-credits` in its own worktree, branched from `main` when
> work starts.

## How the work is split

- **Order.** The work is sequential. The database interface is fixed first
  (task 1), because every later task calls it.
- **Concurrency.** Tasks 4, 5 and 6 can then run concurrently, because their
  write scopes do not overlap.
- **Commits.** Task agents leave work uncommitted. The supervisor reviews,
  runs every check and commits each task separately.
- **Production.** Nothing touches production without the owner's go-ahead
  naming the action.

## Interfaces fixed before task 2

All of these are service role only unless marked otherwise.

- **`reserve_turn_credits(p_user uuid) → jsonb`**
  - `{ok: true, hold_id, available}` or
    `{ok: false, reason: 'credits_exhausted', balance}`.
  - Settles stale holds and mints due lots first.
- **`attach_turn_hold(p_hold uuid, p_message uuid) → void`**
- **`release_turn_hold(p_hold uuid) → void`**: for a replay or a refused
  claim.
- **`settle_turn_credits(p_hold uuid) → jsonb`**
  - Returns `{charged, balance}`, with `charged` in credits.
  - Idempotent per message.
- **`admin_adjust_credits(p_user uuid, p_credits numeric, p_kind text,
  p_reason text, p_admin uuid) → jsonb`**
  - `p_kind` is `adjustment` or `topup`.
- **`my_credits() → jsonb`** (authenticated, `auth.uid()`)
  - Returns `{balance, held, cycle: {allowance, ends_at}, lots: [{kind,
    remaining, expires_at}], recent: [{message_id, credits}]}`.
  - Credits only, never USD or a rate.
- **research-chat 402 body:** `{error, code: 'credits_exhausted', balance}`.
  The answer's terminal frame gains `credits: number | null`.

## Tasks

### 0. Measure turn cost (read-only, owner go-ahead needed)

- **Query.** One read-only query over production `model_call_logs` for the
  last 30 days, grouped by `message_id`. It reports the cost of each answer
  at p50, p90, p99 and max, split by model and by web on or off.
- **Output.** Set `hold_credits` (spec default 150) and record the figures
  in the spec. The p99 figure is also the deepest a balance should normally
  go below zero.
- Email confirmation was already checked on 2026-10-14: production requires
  it.

### 1. Migration and SQL fixtures

**Write scope**
- `supabase/migrations/2026101xxxxxxx_ai_credits.sql` (header with F111, the
  spec link and a Down block).
- `supabase/tests/ai_credits.sql`.
- Its registration in `supabase/tests/run.sh`.

**Steps** (each fixture written first and run to fail)
1. Tables:
   - `credit_settings` (one row), `credit_plan_allowances`;
   - `credit_lots`, `credit_ledger`, `credit_lot_draws`, `credit_wallets`,
     `credit_holds`.
   - Every table has RLS on with no user policies, and SELECT revoked from
     `anon` and `authenticated`.
2. Internal helpers: mint due lots, expire lots, draw in expiry order, and
   settle one hold. Each takes the wallet row lock.
3. The interface functions above, with fixed `search_path`, revoked from
   `PUBLIC`, `anon` and `authenticated`, and granted per the interface list.
4. The fixtures listed in the spec's acceptance evidence, including the
   privilege checks run as `authenticated`.

**Verify**
- `npm run test:sql`, including the vacuity check.

### Checkpoint A

- Fixtures pass.
- The supervisor reviews the SQL with a security pass (`security-auditor`)
  before any code calls it.

### 2. research-chat: reserve and settle

**Write scope**
- `supabase/functions/research-chat/handler.ts`, `index.ts`,
  `persistence.ts` and their tests.
- `supabase/functions/_shared/chatStream.ts` and its test.

**Steps** (tests first)
1. Reserve runs before claim. A blocked reserve returns 402
   `credits_exhausted`, and no message is created. A reserve error returns
   503.
2. `CREDITS_ENFORCED` unset means shadow: a blocked reserve is logged and
   the turn runs.
3. After the claim, the hold is attached. A replay releases it.
4. After the telemetry flush, settle runs, bounded like the flush. Its
   result goes into the terminal frame when the stream is still open. A
   settle error is logged and never fails the turn.

**Verify**
- `deno test -A --config supabase/functions/deno.json supabase/functions`.

### 3. transcribe-audio cost log

**Write scope**
- `supabase/functions/transcribe-audio/handler.ts`, `index.ts` and
  `handler_test.ts`.

**Steps**
- One `model_call_logs` row per call (`caller 'transcribe-audio'`), never
  charged.

**Verify**
- The Deno suite.

### Checkpoint B

- Both test suites pass.
- Local run 1 on a scratch Supabase stack:
  - reserve and settle;
  - a balance going negative, and being repaid from the next lot;
  - Stop charges the part used;
  - an error charges nothing;
  - two tabs at a low balance.
- Spend under $0.25.

### 4. Credits in the answer and the composer

**Write scope**
- `src/ai/AiPanel.jsx`, `ChatSubmit.jsx` and `MessageRow.jsx`.
- `src/ai/useResearchThread.js`.
- A new `src/ai/CreditBalance.jsx` and `src/lib/credits.js` (calls
  `my_credits`, formats credits and the rupee hint).
- The matching tests and CSS.

**Steps**
- Balance chip.
- Low-balance warning.
- Blocked state with Upgrade or Buy credits.
- Per-answer credits, including "No credits used".

### 5. Plan & billing panel

**Write scope**
- `src/shell/PlanBilling.jsx` and its tests.

**Steps**
- Balance, rupee hint, a breakdown by expiry, and credits used this cycle.
- "Top-ups coming soon" while checkout is closed.

### 6. Admin balance and adjustment

**Write scope**
- `server/usersApi.mjs`, `src/admin/AdminPages.jsx` and their tests.

**Steps**
- Show each user's balance.
- Grant or remove credits, or grant a top-up, with a reason. The ledger
  records the admin.

**Verify**
- Router import check.
- Vitest.

### 7. Pricing and policy copy (owner approves the text first)

**Write scope**
- `src/lib/publicPlans.js`, `src/lib/legalPolicies.js` and their tests.

**Steps**
- The supervisor drafts the wording in the spec.
- The owner approves it.
- Then it is applied.

### Checkpoint C (before any production step)

- `npm run lint`, `npm run build`, `npm test`, the Deno suite and
  `npm run test:sql` all pass.
- The router import check passes.
- Local run 2, end to end in the browser:
  - a Free user spends the signup grant and is blocked;
  - an admin grants a top-up;
  - a Plus user crosses a cycle, and the rollover is correct.
- The owner reviews screenshots.

### 8. Production, each step on the owner's go-ahead

1. Apply the migration.
2. Deploy `research-chat` and `transcribe-audio` in shadow mode.
3. Push `main` (Vercel).
4. Shadow week: check that each answer's charge matches its logged cost.
   Record this in `docs/agents/coordination.md`.
5. The owner sets `CREDITS_ENFORCED=1`, and the function is redeployed.

**Rollback**
- Unset `CREDITS_ENFORCED`. This restores the old behaviour with no
  migration rollback.
- The migration's Down block drops only the new objects.

## Risks

| Risk | Mitigation |
|---|---|
| A wallet lock slows every turn | One indexed row lock per reserve and settle; measured in local run 1 |
| A balance goes deep below zero | The hold allows one answer at a time when low; task 0 measures the dearest answer |
| Free users leave debt unpaid | At most one answer's cost each; they are then blocked |
| Charges drift from OpenRouter's bill | Shadow week comparison; the rate is a database setting |
| Repeated Free sign-ups | ₹100 each; production requires a confirmed email |
| The copy promises the old rule | Task 7 lands with the rest, before enforcement |
