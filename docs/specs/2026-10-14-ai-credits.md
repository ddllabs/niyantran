# AI credits (F111)

> **Status: Living.** Owner decisions and approval 2026-10-14. Code starts
> only on the owner's word to start.

**Related documents**

| Document | What it holds |
|---|---|
| [Plan](../plans/2026-10-14-ai-credits.md) | Tasks, agents, checkpoints and progress (the working log) |
| [ADR 0011](../decisions/0011-per-user-credit-ledger.md) | Why the ledger has this shape |
| [TenderBase review](../research/2026-10-14-ai-credits-reference-review.md) | What was copied, changed or avoided, and why |
| [Open work, F111](../plans/open-work.md) | Tracking line |

## Objective

Every AI answer spends credits from the user's own wallet. Plans add credits
each month, Free users get a one-time grant, and a user who has run out is
told so before an answer starts, never cut off in the middle of one. Users
see credits, with a rupee hint, and never see dollars. Razorpay (O6) later
sells plans and top-ups into the same wallet; F111 builds everything except
the payment.

## Owner decisions (2026-10-14)

1. **Copy TenderBase's pattern.** Every AI call writes a log row, and the
   database turns that log into a ledger charge at a frozen rate. Avoid its
   defects (review §4).
2. **Wallet per user.** Niyantran has no organisations in use. The ledger is
   keyed so organisations can be added later (P2) without reshaping it.
3. **1 credit = 10 paise of AI cost.** AI cost is the provider cost in
   rupees. The rupee hint shown to users is that same figure.
4. **Credits per plan.** Higher plans get more AI per rupee; a credit is
   worth the same on every plan.

   | Plan | Price | AI cost included | Credits | Valid |
   |---|---|---|---|---|
   | Free | ₹0 | ₹100, once | **1,000** | 30 days, never refilled |
   | Plus | ₹399 / month | ₹200 | **2,000** a month | to the end of the cycle |
   | Pro | ₹999 / month | ₹650 | **6,500** a month | to the end of the cycle |
   | Max | ₹9,999 / month | ₹7,500 | **75,000** a month | to the end of the cycle |
   | Top-up | set in O6 | — | per pack | **12 months** |

5. **Rollover: 10% of a cycle's unused plan credits** carry into the next
   cycle only, then expire. Rolled-over credits never roll again, so credits
   cannot pile up. A Plus user who used nothing carries 200.
6. **Failed turns are free.** A failure is ours, not the user's.
7. **Stop charges the part already used.**
8. **Running out mid-answer: the answer always finishes, and the balance may
   go negative** (owner, second answer of 2026-10-14). A user with 50 credits
   whose answer costs 100 ends at −50. The −50 comes out of their next
   credits: the next month, a top-up or an admin grant. A user may start an
   answer with any balance above zero.
9. **Downgrade takes effect at the next cycle.** The current plan and its
   credits run to the end of the paid period.
10. **Top-ups: yes, valid 12 months.** Buying them is O6.
11. **Only AI answers spend credits.** Briefs and dictation stay free for now
    (supervisor's recommendation, owner 2026-10-14); dictation gets a cost log.
    Indexing a user's own files may be charged when file upload exists.

## Current state (main at `b2fa8bd`)

- **Plan.** It lives on `user_profiles` (`plan`, `plan_status`,
  `plan_period_end`, `plan_source`). `grant_paid_plan()` (one month per
  payment) and `grant_manual_plan()` write it, service role only, and
  `plan_grants` logs each grant. A different plan starts at once; the same plan
  extends from the current end.
- **Usage log.** research-chat writes one `model_call_logs` row per provider
  attempt (`chat_answer`, `citation_repair`, `embedding`).
  - `cost_usd` is OpenRouter's `usage.cost`, else tokens × `model_pricing`.
  - Web search cost is inside `cost_usd`.
  - Rows are flushed after the turn's durable write.
- **Turn outcome.** It is recorded on `chat_messages.status`:
  - `complete` and `truncated` (the model hit its length limit);
  - `cancelled` (the user pressed Stop);
  - `error` and `interrupted` (the runtime stopped).
- **Turn lifecycle.** Turns are claimed by `claim_research_turn` and
  finished by `finalize_research_turn`.
- **No enforcement and no credits anywhere.**
  - The pricing page says "Unused credits carry forward"
    (`src/lib/publicPlans.js`).
  - The policies say unused credits "remain" (`src/lib/legalPolicies.js:121,163`).
  - Checkout is closed (`BILLING_CHECKOUT_OPEN`).
- **transcribe-audio** calls a paid model and writes no log row.
- **Dollars are readable by the user**, though no screen shows them:
  - `model_call_logs` has an own-rows SELECT policy for `authenticated`, and
    nothing in `src/` reads it.
  - `chat_messages.usage` stores the turn's `cost_usd`, and users can select
    their own messages. The app reads only the reasoning tokens from it.
- **What answers cost** (production, last 30 days, measured 2026-10-14):
  - 129 answers in total.
  - Per answer, in credits: median 21, p90 50, p99 190, maximum 301.
  - By model (median): Flash-Lite 8, Gemini 3.7 Flash 17, Gemini 3.8 Flash
    28, Claude Sonnet 5 170.
  - Embeddings round to zero, and no successful call is missing its cost.
  - Plus (2,000 credits) is about 95 typical answers, or about 12 on Claude
    Sonnet 5.

## Design

### 1. Settings, kept in the database only

- **`credit_settings`** is a single row; no constant is copied in code.

  | Setting | Value |
  |---|---|
  | `usd_to_inr` | **95**, fixed by the owner (all-in: forex and OpenRouter's fee) |
  | `inr_per_credit` | 0.10 |
  | `rollover_pct` | 10 |
  | `signup_credits` | 1000 |
  | `signup_valid` | 30 days |
  | `topup_valid` | 12 months |
  | `hold_credits` | 300 (the dearest answer measured was 301) |
  | `hold_minutes` | 30 |

- **`credit_plan_allowances`** has one row per paid plan with its monthly
  credits.
- **Rate history.** Changes take effect for later charges only. Each charge
  stores the rate it used, so history is never rewritten.
- **Credits for a turn** are `cost_usd × usd_to_inr ÷ inr_per_credit`. That
  is `cost_usd × 950` today: a short answer at $0.015 costs about 14 credits.

### 2. Lots and the ledger

- **Lots.** Credits enter as **lots**: signup, monthly, rollover, top-up and
  adjustment. Each lot has its granted amount, its remaining amount, its
  expiry and its source (plan cycle, admin, later a payment id).
- **Spending order.** Spending draws from the lot that expires first. Plan
  and rollover credits go before top-ups, which last 12 months.
- **Ledger.** Every change is one signed entry in a ledger, and is never
  edited:
  - grant (+);
  - charge (−);
  - expiry (−);
  - adjustment (±).
  - Each charge records which lots it drew from.
- **Wallet balance.**
  - It is the sum of remaining amounts in unexpired lots, minus the wallet's
    `debt`.
  - It is updated in the same transaction as the entry.
  - A lot never goes below zero. A charge larger than the lots holds adds the
    rest to `debt`.
  - Any new lot first pays off the debt, as a ledger entry, before the rest
    is usable.
  - A fixture proves that the ledger sums to the balance.
- **Idempotency.** A charge is unique per answer (`message_id`), and a grant
  is unique per source.

### 3. A turn

1. **Reserve.** Before the turn is claimed, research-chat calls
   `reserve_turn_credits(user)`. Under a lock on the user's wallet, it does
   four things in order:
   1. Settles any finished but unsettled turn of this user (step 4).
   2. Mints any lot that is due (§4).
   3. Expires any lot that is past its date.
   4. Checks *available = balance − active holds*.
      - At zero or below, it returns `blocked` with the balance. The function
        answers 402 `credits_exhausted`, and no message is created.
      - Otherwise it records a hold of `min(available, hold_credits)` for
        `hold_minutes` and returns its id.

   **The hold is only about answers running at the same time.** It never
   charges anything and is invisible to a user asking one question at a time.

   - **Without it:** a user with 10 credits could open five tabs and start
     five answers at once. All five would pass the "above zero" check and
     finish, leaving the balance hundreds of credits negative.
   - **With it:** the first answer holds those 10 credits, so the others are
     told to wait until it finishes.
   - **At a healthy balance:** several answers can run side by side as
     before.
   - **Bound:** a balance can therefore go negative by about one answer, not
     by many.
2. **Claim.** The turn is claimed as now. A replay releases the hold, and the
   claimed message id is attached to the hold.
3. **Run.** The turn is unchanged. Its log rows flush after the durable
   write, as they do now.
4. **Settle.** After the flush, `settle_turn_credits(hold)` reads the
   message's final status and its log rows, charges, and releases the hold.

   | Message status | Charged |
   |---|---|
   | `complete` | every `chat_answer` and `embedding` row with status `success` and a cost |
   | `truncated` | the same (the answer was delivered; owner 2026-10-14) |
   | `cancelled` (Stop) | the same rows, i.e. what finished before Stop. A call cut off mid-stream reports no cost and is not charged |
   | `error`, `interrupted` | nothing |
   | any | `citation_repair` rows are never charged (they fix our mistakes) |

   - The charge is the full credits used. Whatever the lots cannot cover
     becomes debt (§2), so the balance can end below zero.
   - A Free user who never pays leaves that debt unpaid: one answer's cost at
     most.
   - A settle that never runs, because the function died, is done at the
     user's next reserve once the hold has expired. A hold with no message
     simply lapses.
5. **Fail closed.** If the reserve call errors, the turn does not start: 503
   with "AI credits could not be checked". Settle errors are logged and retried
   at the next reserve. They never fail the answer.

### 4. Cycles, rollover and expiry

- **Lazy minting.** Lots are minted when the user next reserves or reads
  their credits, so no cron job is needed.
- **Monthly lot.**
  - While the profile has an active paid plan, the user has one monthly lot
    for the current cycle.
  - The lot expires at the cycle end.
  - Cycles run monthly from the plan's start, up to `plan_period_end`. A manual
    grant with no end runs monthly indefinitely.
- **Rollover lot.**
  - When a cycle's monthly lot expires, 10% of its remaining credits becomes a
    rollover lot that expires one cycle later.
  - This happens even if the plan has lapsed.
  - Rollover lots themselves are never rolled.
- **Signup lot.**
  - Each user gets one signup lot, minted once at their first reserve or read,
    with a unique key per user.
  - It holds 1,000 credits and expires 30 days after it is minted. This
    gives existing Free accounts the same 30 days from launch (open
    question 5).
  - Production already requires a confirmed email for email sign-ups. An
    unconfirmed account cannot sign in, so it cannot reach the grant. Google
    sign-ins arrive confirmed. The grant is still minted only when
    `email_confirmed_at` is set. (Checked 2026-10-14 with two aggregate
    counts over `auth.users`: all 4 email sign-ups were sent a link, 2 never
    confirmed. No personal data was read.)
- **Expiry.** An expired lot's remainder becomes an expiry entry, so the
  ledger stays complete.

### 5. Plan changes

- **Upgrade (a different, higher plan paid now).** `grant_paid_plan` starts
  the new plan at once (current behaviour). The new cycle's lot is minted. The
  old monthly lot keeps its own expiry, so its unused credits are not lost.
- **Downgrade at the next cycle** needs `grant_paid_plan` to queue a lower
  plan instead of starting it now. That function is billing code, so the
  change is recorded for O6. Until checkout opens, plans change only by admin
  grant.
- **Lapse.** At `plan_period_end` the user is Free. Monthly credits expire;
  rollover and top-up lots stay until their own dates.

### 6. What spends credits

| Call | Charged | Note |
|---|---|---|
| research-chat answer rounds, retrieval embeddings, web search | yes | web search is already inside `cost_usd` |
| citation repair | no | our correction |
| desk-brief | no | shared and cached per record; decided under F123 |
| transcribe-audio (dictation) | no | gains a `model_call_logs` row so its cost is visible |
| admin ingestion, OCR | no | platform cost |

### 7. Reading credits, and privacy

- **`my_credits()`**, called as the signed-in user via `auth.uid()`, returns:
  - the balance, and what is held;
  - the lots, with kind, remaining and expiry;
  - this cycle's allowance and the cycle end;
  - the credits charged per recent answer.
- **No dollars.** It returns no dollars and no exchange rate.
- **No direct table access.** Credit tables have RLS on and no user
  policies.
- **Privileges.** Every writing function is `SECURITY DEFINER` with a fixed
  `search_path`, revoked from `PUBLIC`, `anon` and `authenticated`, and
  granted to `service_role` only. A fixture checks this as the
  `authenticated` role.
- **Answer frames.** The answer stream carries credits only, never cost.
- **Closing today's dollar leaks.**
  - The migration drops the `authenticated` SELECT on `model_call_logs` and
    `chat_turn_traces`. Nothing in the app reads them.
  - research-chat stops writing `cost_usd` and `web_search_cost_usd` into
    `chat_messages.usage`. The migration removes those two keys from existing
    rows.
  - `model_pricing` stays readable, because the model picker uses it and it
    holds public list prices.

### 8. What users see

- **Composer.**
  - It shows the balance next to the chat box.
  - It warns at 10% of the cycle allowance (or 10% of the signup grant on
    Free).
  - A negative balance shows as such: "−50 credits · taken from your next
    credits".
  - When the reserve is blocked, it shows the balance and a way forward:
    "Upgrade" or "Buy credits". Each opens Plan & billing, which says top-ups
    are coming soon while checkout is closed.
- **Each answer.** The finished answer shows the credits it used ("38
  credits"), including after reload. A stopped answer shows what it was
  charged. A failed one says "No credits used".
- **Plan & billing panel.**
  - It shows the balance in credits with the rupee hint ("2,000 credits ·
    ₹200 of AI").
  - It shows a breakdown by expiry, plus credits used this cycle.
  - It lists recent answers with their credits: date, conversation title and
    credits. This follows TenderBase's per-turn cost view, without dollars or
    model rows.
- **Model picker.** It keeps its cost diamonds; per-model credit estimates
  can come later.

### 9. Admin

- **Users page.** It shows each user's balance.
- **Adjustments.**
  - An admin can grant or remove credits, with a reason, as an adjustment lot
    or a negative entry.
  - The adjustment goes through the existing admin route
    (`server/usersApi.mjs`), which already requires an admin, to a service-role
    RPC.
  - The ledger records who made it.
- **Top-ups before checkout.** An admin can grant a top-up lot by hand
  (12 months) until O6 sells them.

### 10. Published copy (owner approves the wording)

- **Pricing** (`src/lib/publicPlans.js`).
  - Real credit amounts per plan, in place of "Starter / More / Higher /
    Highest".
  - "10% of unused monthly credits roll over for one month", in place of
    "Unused credits carry forward".
  - A line on what an answer typically costs.
- **Policies** (`src/lib/legalPolicies.js`).
  - The unused-credits clauses (121, 163) state the rollover rule, the 30-day
    Free grant and the 12-month top-ups.
  - The "Plans, credits and billing" clause says one credit is 10 paise of AI
    processing.

### 11. Rollout

1. **Migration, function and site,** each with the owner's go-ahead.
2. **Shadow mode first.** Ledger, holds and charges run for real, but a
   blocked reserve is only logged, controlled by the switch
   `CREDITS_ENFORCED` (unset means shadow). The owner then compares charges
   with OpenRouter's bill.
3. **Enforcement.** The owner sets `CREDITS_ENFORCED=1`.

### 12. Schema and function contracts

This is the interface every later task builds on. The migration may add
indexes, checks and private helpers, but not change these shapes without a
spec amendment. Amounts are `numeric(14,4)` credits.

**Tables** (RLS on, no user policies, all privileges revoked from `PUBLIC`,
`anon` and `authenticated`, including column grants; `service_role` only)

| Table | Key columns and rules |
|---|---|
| `credit_settings` | One row (`id boolean PK CHECK (id)`): `usd_to_inr`, `inr_per_credit`, `rollover_pct` (0–100), `signup_credits`, `signup_valid interval`, `topup_valid interval`, `hold_credits`, `hold_minutes`, `updated_at`, `updated_by`. Every change copies the old row to `credit_settings_history` |
| `credit_plan_allowances` | `plan app_plan PK` (paid plans only), `monthly_credits > 0` |
| `credit_wallets` | `user_id PK → auth.users ON DELETE CASCADE`, `balance`, `debt ≥ 0`, `cycle_anchor timestamptz null`, `updated_at`. `balance` = sum of usable lot `remaining` − `debt`, kept in step in the same transaction |
| `credit_lots` | `id uuid PK`, `user_id`, `kind` ∈ signup, monthly, rollover, topup, adjustment; `granted > 0`; `0 ≤ remaining ≤ granted`; `starts_at < expires_at`; `source_key text`, `UNIQUE (user_id, source_key)`; `plan app_plan null`; `created_by uuid null`; `note text null`; `expired_at null` |
| `credit_ledger` | `id uuid PK`, `user_id`, `kind` ∈ grant, charge, expiry, adjustment; signed `credits`; `lot_id null` (grant, expiry); `message_id uuid null` with a partial unique index on (`message_id`) where `kind = 'charge'`; for charges, `cost_usd`, `usd_to_inr` and `inr_per_credit` as used; `created_by`, `note`, `created_at`. Append-only: an `UPDATE`/`DELETE` trigger raises |
| `credit_lot_draws` | `ledger_id → credit_ledger`, `lot_id → credit_lots`, `credits > 0`, `created_at`. A charge or a removal may gain draws later, when debt is repaid from a new lot |
| `credit_holds` | `id uuid PK`, `user_id`, `credits > 0`, `message_id null`, `created_at`, `expires_at`, `settled_at null`, `released_at null`. Active means not settled, not released and not expired |

**Invariants** (each a fixture)
- `wallet.balance` = sum(`ledger.credits`) for the user.
- Lot accounting, for each lot: `granted` − `remaining` = draws on it +
  its expiry entry.
- `debt` = charges and removals − their draws.
- No lot is negative, and no grant is negative.

**Cycles and the plan.**
- An `AFTER INSERT` trigger on `plan_grants` sets
  `credit_wallets.cycle_anchor`.
  - When the plan differs from the one active before the grant, the anchor is
    the grant time.
  - A same-plan renewal leaves it unchanged.
  - A grant to Free clears it.
- Cycle *n* is [anchor + *n* months, anchor + *n*+1 months), clamped to
  `plan_period_end`.
- The monthly lot for cycle *n* has `source_key` `monthly:<anchor>:<n>`, and
  is minted only once its cycle has started.
- **Mint order.** Each new lot first repays `debt`, in the same transaction,
  through draws against the oldest charges.

**Functions** (`SECURITY DEFINER`, `SET search_path = ''`)

| Function | Caller | Contract |
|---|---|---|
| `reserve_turn_credits(p_user uuid) → jsonb` | service_role | Locks the wallet row (creating it if missing). Settles holds that expired with a message, and releases those without. Mints due lots and expires past ones. Then returns `{ok:true, hold_id, available}`, or `{ok:false, reason:'credits_exhausted', balance}` when `balance − active holds ≤ 0` |
| `attach_turn_hold(p_hold uuid, p_message uuid) → void` | service_role | Raises unless the hold is active and the message belongs to the hold's user |
| `release_turn_hold(p_hold uuid) → void` | service_role | Idempotent |
| `settle_turn_credits(p_hold uuid) → jsonb` | service_role | Returns `{state:'pending'}` while the message is `running`. Otherwise it applies the §3 table to `model_call_logs` rows with that `message_id`, writes at most one charge, marks the hold settled, and returns `{state:'charged'\|'free', credits, balance}`. Idempotent. A message deleted with its conversation is charged from its logs, which have no foreign key and survive |
| `admin_adjust_credits(p_user, p_credits, p_kind, p_reason, p_admin) → jsonb` | service_role | Takes `p_kind` adjustment or topup and a non-empty reason. A positive amount mints a lot (a top-up valid `topup_valid`, an adjustment for 12 months). A negative amount writes an adjustment entry that draws lots and may create debt |
| `my_credits() → jsonb` | authenticated | For `auth.uid()` only, minting and expiring first. Returns `{balance, held, debt, plan, cycle:{allowance, ends_at}, lots:[{kind, remaining, expires_at}], recent:[{message_id, conversation_id, title, credits, created_at}]}` (the last 20 charges). No USD, no rate |
| `my_conversation_credits(p_conversation uuid) → jsonb` | authenticated | `[{message_id, credits}]` for the caller's own conversation, so reloaded answers show their credits |

Every function above is revoked from `PUBLIC` and `anon`, and from
`authenticated` except the two `my_` functions. A fixture checks this through
`has_function_privilege` for each role.

## Acceptance evidence

- **SQL fixtures, run as the non-superuser migrator.** Each fixture is proved
  non-vacuous by the runner.
  - **Ledger and balance.** The ledger sums to the balance after every
    operation.
  - **Holds.** Two reserves at a balance of 25 credits: the first holds 25 and
    the second is blocked.
  - **Debt.**
    - A charge of 300 on a balance of 120 leaves −180.
    - At −180, a reserve is blocked.
    - A new 2,000-credit monthly lot leaves a balance of 1,820, and the
      repayment is a ledger entry.
  - **Status rules.** Each row of the §3 table is charged as stated: complete,
    truncated, cancelled, error, interrupted, and repair rows.
  - **Idempotency.** A second settle of the same answer charges nothing.
  - **Lots.**
    - Spending draws the earliest-expiring lot first.
    - Monthly minting and the 10% rollover give the right figures, and a
      rollover never rolls.
    - Signup is minted once, and expires 30 days after minting.
    - Top-ups expire at 12 months.
    - An expiry writes an entry.
  - **Privileges and privacy.**
    - `authenticated` and `anon` cannot execute any writing function or read
      a credit table.
    - `authenticated` can no longer read `model_call_logs`.
    - `my_credits()` returns no USD field.
    - No `chat_messages.usage` keeps a cost key.
  - **Append-only.** An UPDATE or DELETE on `credit_ledger` raises.
  - **Deleted conversation.** A turn whose conversation was deleted before
    settling is still charged from its logs.
  - **Plan changes.**
    - An upgrade grant starts a new cycle lot, and the old lot keeps its
      expiry.
    - A same-plan renewal keeps the anchor.
    - A lapse mints no further monthly lot, and its rollover is still
      minted.
- **Deno tests (research-chat).**
  - Reserve is called before claim, and a blocked reserve returns 402 with no
    message.
  - A reserve error returns 503.
  - A replay releases its hold.
  - Settle runs after the flush, and a settle error does not fail the turn.
  - Shadow mode does not block.
- **Deno tests (transcribe-audio).** A log row is written, and the call is
  never charged.
- **Vitest.**
  - The composer shows the balance, the warning and the blocked state.
  - Per-answer credits show, including "No credits used".
  - The Plan & billing breakdown renders.
  - The admin adjustment works.
  - The copy changes are in place.
- **Repository checks.** `npm run lint`, `npm run build`, both test suites
  and `npm run test:sql`.
- **Local end-to-end run on a scratch Supabase stack, with real OpenRouter.**
  - A Plus user answers, stops a turn and runs out.
  - Charges are checked against `cost_usd` × 950.
  - Spend cap $0.50.
- **After deploy (shadow mode).** For each turn, credits charged match its
  logged cost, over at least 50 production turns.

## Scope

**In scope:**
- The tables, functions, fixtures and migration above.
- research-chat's reserve and settle.
- The transcribe-audio log row.
- The composer, answer, Plan & billing and admin UI.
- The pricing and policy copy.
- Docs.

**Excluded:**
- Razorpay orders for plans and top-ups, and the downgrade queue in
  `grant_paid_plan` (both O6).
- Organisations and seats (P2).
- NYAI gating (the model does not exist yet).
- Per-feature limits, and charging briefs, dictation or indexing.
- Per-model credit estimates in the picker.
- GST.

## Boundaries

- **Always.**
  - Write tests first, and prove each fixture fails without its migration.
  - Keep rates and allowances in the database only.
  - Keep dollars out of every user-facing response.
- **Ask first.**
  - Any change to the published copy wording.
  - The migration, function deploy and push to production.
  - Switching enforcement on.
  - Any production read used to measure holds.
- **Never.**
  - Rewrite a ledger entry, or let a lot go below zero (debt lives on the
    wallet).
  - Let a gate fail open.
  - Touch billing payment code beyond reading it.

## Settled questions (owner, 2026-10-14)

1. **Exchange rate:** ₹95 per USD, fixed.
2. **Truncated answers:** charged.
3. **Minimum to start:** none; any balance above zero starts an answer.
   - The answer always finishes and may leave the balance negative.
   - The hold stays, only to stop several answers at once from running far
     below zero.
   - Its size (150) is checked against the dearest real answers in plan
     task 0.
4. **Email confirmation:** production already requires it for email
   sign-ups, so nothing changes. Moving the emails to Resend on the
   company domain is separate work and needs no change here.
5. **Existing users at launch:**
   - Free accounts get their 30 days from launch.
   - Paid and manually granted plans get the current cycle's credits.
6. **Shadow mode:** one week.

## Open

- Approval of the spec as a whole.
