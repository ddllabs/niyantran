# AI credits (F111)

> **Status: Living.** Owner decisions 2026-10-14, after the
> [TenderBase review](../research/2026-10-14-ai-credits-reference-review.md).
> Branch `task/ai-credits-spec`, worktree `.claude/worktrees/ai-credits-spec`.
> Plan: [plan](../plans/2026-10-14-ai-credits.md). **Awaiting owner approval;
> no code until then.**

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
8. **Running out mid-answer:** the answer always finishes. The charge never
   takes the balance below zero; we absorb the difference.
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

## Design

### 1. Settings, kept in the database only

- **`credit_settings`** is a single row; no constant is copied in code.

  | Setting | Value |
  |---|---|
  | `usd_to_inr` | **95** (an all-in rate covering forex and OpenRouter's fee; owner to confirm) |
  | `inr_per_credit` | 0.10 |
  | `rollover_pct` | 10 |
  | `signup_credits` | 1000 |
  | `signup_valid` | 30 days |
  | `topup_valid` | 12 months |
  | `min_start_credits` | 20 (about one short answer) |
  | `hold_credits` | 150 (above the dearest normal turn; measured first, plan task 0) |
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
  - It is the sum of remaining amounts in unexpired lots.
  - It is updated in the same transaction as the entry.
  - It is never negative.
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
      - Below `min_start_credits`, it returns `blocked` with the balance. The
        function answers 402 `credits_exhausted`, and no message is created.
      - Otherwise it records a hold of `min(available, hold_credits)` for
        `hold_minutes` and returns its id.

   Two turns started together cannot both spend the last credits, because each
   one's hold reduces what the other can start with.
2. **Claim.** The turn is claimed as now. A replay releases the hold, and the
   claimed message id is attached to the hold.
3. **Run.** The turn is unchanged. Its log rows flush after the durable
   write, as they do now.
4. **Settle.** After the flush, `settle_turn_credits(hold)` reads the
   message's final status and its log rows, charges, and releases the hold.

   | Message status | Charged |
   |---|---|
   | `complete` | every `chat_answer` and `embedding` row with status `success` and a cost |
   | `truncated` | the same (the answer was delivered; open question 2) |
   | `cancelled` (Stop) | the same rows, i.e. what finished before Stop. A call cut off mid-stream reports no cost and is not charged |
   | `error`, `interrupted` | nothing |
   | any | `citation_repair` rows are never charged (they fix our mistakes) |

   - The charge is `min(credits used, balance)`, so the balance stops at zero
     and the rest is absorbed.
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
  - If production requires confirmed emails, it is minted only for a
    confirmed email (open question 4).
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

### 8. What users see

- **Composer.**
  - It shows the balance next to the chat box.
  - It warns at 10% of the cycle allowance (or 10% of the signup grant on
    Free).
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

## Acceptance evidence

- **SQL fixtures, run as the non-superuser migrator.** Each fixture is proved
  non-vacuous by the runner.
  - **Ledger and balance.** The ledger sums to the balance after every
    operation.
  - **Holds.** Two reserves at a balance of 25 credits: the first holds 25 and
    the second is blocked.
  - **Floor.** A charge of 300 on a balance of 120 leaves 0.
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
  - **Privileges and privacy.** `authenticated` and `anon` cannot execute
    any writing function or read a credit table. `my_credits()` returns no USD
    field.
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
  - Rewrite a ledger entry, or let a balance go below zero.
  - Let a gate fail open.
  - Touch billing payment code beyond reading it.

## Open questions (defaults used unless the owner says otherwise)

1. **Exchange rate:** ₹95 per USD, all-in. The owner can check an OpenRouter
   invoice against the bank charge.
2. **Truncated answers** (the model hit its length limit): charged, since the
   answer was delivered with a "cut short" note.
3. **Hold and minimum:** 150 and 20 credits, confirmed by measuring the
   dearest turns in production logs (read-only, plan task 0).
4. **Email confirmation:** the local config has it off, and production is
   unchecked. Each unconfirmed email can claim ₹100 of AI. Default: grant only
   to confirmed emails if production confirms them; otherwise ask the owner
   whether to turn confirmation on.
5. **Existing users at launch:**
   - Free accounts get the signup grant, counted from launch rather than
     their sign-up date.
   - Current paid or manually granted plans get the current cycle's credits.
6. **Shadow-mode length:** about a week, or 50 production turns, whichever
   is later.
