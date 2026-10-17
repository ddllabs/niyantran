# AI credits (F111)

> **Status: Living.** Owner decisions and approval 2026-10-14. Code starts
> only on the owner's word to start.

**Related documents**

**Current owner amendment, 2026-10-18 (F225):** one credit is to represent
INR0.01 rather than INR0.10; preserve existing value through a 10x conversion.
Top-ups are for Free and paid accounts, with model access still plan-based.
The [conversion specification](2026-10-18-credit-paise.md) and
[ordered plan](../plans/2026-10-18-credit-paise.md) record the completed production conversion. The settings, quantities and
executed behavior below preserve the original ten-paisa launch context;
current balances, allowances and charge projections use the F225 one-paisa
contract. Historical stored entries retain their original denomination.
Historical charge rates and immutable ledger records must be retained.

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
6. **Failed turns are free when the user received nothing.** A failure is
   ours, not the user's. A failed turn that still delivered answer text is
   charged (settled question 7).
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
  | `hold_minutes` | 5 |
  | `launch_at` | when credits went live (2026-10-14); balances are real from then |

  **Why five minutes:** a turn ends by 120 s (`research-chat`'s execution
  deadline). The hold must outlive the deadline plus the log flush plus the
  settle; 5 minutes does, and a crashed turn blocks a low balance for 5
  minutes at most.
- **`credit_plan_allowances`** has one row per paid plan with its monthly
  credits.
- **Rate changes** apply to later charges only. Each charge stores the rate it
  used, so no separate history table is needed.
- **Credits for a charge** are `round(sum(cost_usd) × usd_to_inr ÷
  inr_per_credit, 4)`, summed over the rows that charge covers. That is
  `cost_usd × 950` today.

### 2. Lots and the ledger

- **Lots.** Credits enter as lots: signup, monthly, rollover, top-up and
  adjustment. Each lot has its granted amount, its remaining amount, its
  validity window and its source.
- **Spending order.** Spending draws from the usable lot that expires first,
  where usable means `starts_at ≤ now < expires_at`. Plan and rollover credits
  therefore go before top-ups.
- **Ledger.** Every change to the balance is one signed entry: grant (+),
  charge (−), expiry (−) or adjustment (±). Entries are never edited or
  deleted: `service_role` has no UPDATE or DELETE on the ledger. The one
  exception is the account-deletion cascade (§12).
- **Wallet balance and debt.**
  - The balance is the sum of `remaining` in usable lots, minus `debt`. It is
    updated in the same transaction as the entry, and **always equals the sum
    of the user's ledger entries**.
  - A lot never goes below zero. Whatever a charge cannot draw from lots is
    added to `debt`.
  - A new lot first pays off `debt`. This repayment is a draw recorded in
    `credit_lot_draws`, **not a ledger entry**, because it moves credits
    between a lot and the debt without changing the balance.
  - Worked example: lots 120, charge 300. The ledger records −300, the lots
    fall to 0, the debt is 180 and the balance −180. A 2,000 monthly grant
    then records +2,000, and the draw takes 180 for repayment: the lot keeps
    1,820, the debt is 0, and the balance is 1,820, which matches the ledger
    sum.
- **Idempotency.**
  - Each charged log row is recorded once: `model_call_logs.id` is unique in
    `credit_charge_rows`.
  - Each grant is unique per source.
  - Each admin adjustment is unique per request id.

### 3. A turn

1. **Reserve.** Before the turn is claimed, research-chat calls
   `reserve_turn_credits(user, turn_key)`. The hold is keyed by the turn, so
   a retry of the same turn gets the same hold back rather than a 402. Under a
   lock on the user's wallet (never the profile), it works in this fixed order,
   which every writer uses:
   1. Sweeps holds that have **expired** (§3 step 5).
   2. Expires lots past their date and mints their rollovers.
   3. Mints lots that are due (§4).
   4. Repays debt from new lots.
   5. Checks *available = balance − active holds*.
      - At zero or below, it returns `{ok:false, reason:'credits_exhausted',
        balance}`. The function answers 402 and no message is created
        (enforced for everyone from 2026-10-14; owner: remove the shadow
        concept). When the balance is positive but held by answers
        still running, the 402 adds `held: true` and says so, instead of
        "no credits left".
      - When no new turn starts after reserve (the claim fails or returns
        anything but a running or finished turn), the hold is released at
        once, so it does not block the user for its five minutes.
      - Otherwise it records a hold of `min(available, hold_credits)` and
        returns `{ok:true, hold:{credits, expires_at}, available, balance}`
        (the hold is identified by the turn; §12).

   **The hold is only about answers running at the same time.** It never
   charges anything, and a user asking one question at a time never notices
   it.
   - **The risk without it:** with 10 credits, a user could start five answers
     in five tabs at once. All five would pass the "above zero" check and
     finish, hundreds of credits below zero.
   - **With it:** the first answer holds those 10 credits, so the others are
     told to wait.
   - **At a healthy balance,** answers run side by side as before.
2. **Claim.** The turn is claimed as now. Settlement later finds the message
   through `research_turns` using `(user_id, turn_key)`, so the hold needs no
   message id.
3. **Run.** The turn runs unchanged, and its log rows flush after the durable
   write.
4. **Settle.** After the flush, the handler calls
   `settle_turn_credits(user, turn_key)`, with a 3-second limit. It charges
   the turn's chargeable rows that are not yet charged (§3.1), then marks the
   hold settled.
   - A settle error or timeout is logged and never fails the answer.
   - The credits then arrive as their own `{credits}` frame after `done`.
     It is `null` when the settle is pending or failed, or when a round cut
     off by Stop is still waiting for its cost; the sweep then finishes the
     job. The client either reads past `done` for it or calls
     `my_conversation_credits` (task 4b).
   - Settle treats a message still `running` past its `execution_expires_at`
     as `interrupted`.
5. **Sweep.** Every hold gets one final pass after it expires, inside a later
   reserve or `my_credits()`. The pass charges any chargeable row that
   committed late (after a timed-out flush), then marks the hold swept. Before
   expiry, only the handler settles, so a sweep can never race a flush.
6. **Fail closed.** If reserve errors, the turn does not start: 503, "AI
   credits could not be checked".

#### 3.1 What is charged

| The turn | Charged |
|---|---|
| `complete`, `truncated` | every `chat_answer` and `embedding` row of the turn with status `success` or `aborted` and a cost |
| `cancelled` (Stop) | the same: everything spent up to Stop, including the round cut off mid-stream (its cost is fetched, below) |
| `error`, `interrupted`, **and the saved answer is empty** | nothing (our failure; the user got nothing) |
| `error`, `interrupted`, **with saved answer text** | charged as `complete`, because the user received an answer (owner, settled question 7) |
| any | `citation_repair` rows, never |

- **The round cut off by Stop.** OpenRouter sends a call's cost only at the
  end of its stream, so the round Stop cuts off reports none.
  - A probe on 2026-10-14 found the generation endpoint reports an aborted
    stream's cost 8–15 s after the abort, with about 60 tokens billed after
    the abort. A lookup inside the flush therefore misses.
  - After the response has closed, a background job polls the generation
    endpoint for up to about 25 s and writes the cost onto the log row. The
    hold's sweep, after it expires, charges it.
  - If the runtime stops first, the row stays uncharged and is logged.
- **A row reported as `success` with no cost** is logged as a warning, never
  silently charged as zero.

### 4. Cycles, rollover and expiry

- **Lazy minting.** Lots are minted when the user next reserves or reads
  their credits, so no cron job is needed. Minting covers only the current
  cycle: a user away for three months does not collect three months of
  credits.
- **Paid plans.** Each `plan_grants` row with `source = 'payment'` is exactly
  one cycle, `[base, period_end)`.
  - `base` follows `grant_paid_plan`'s own rule: the previous grant's
    `period_end` if that grant was the same plan, active, and ending after
    this grant's `created_at`; otherwise this grant's `created_at`.
  - The cycle's monthly lot has `source_key 'grant:<plan_grants.id>'`. It
    becomes usable at `base` (an early renewal waits its turn) and expires at
    `period_end`.
  - Every lot therefore matches one month that was actually paid for. One
    payment can never mint two lots, and lapse dates do not drift at month
    ends.
- **Manual plans** (admin grants, and current plans at launch).
  - Monthly cycles run from the grant's `created_at` until `period_end`, or
    indefinitely when the end is NULL. Each cycle mints its own lot,
    `source_key 'grant:<id>:<n>'`.
  - **Launch backfill.** A profile on a paid plan at launch with no
    `plan_grants` row is treated as one manual grant made at `launch_at`,
    ending at its `plan_period_end`.
- **Plan taken away or changed by an admin.** A manual grant to Free, or to a
  different plan, ends the open monthly lot at once, with no rollover. This
  way an admin switching plans back and forth cannot mint credits. A paid
  upgrade keeps the old lot to its own expiry, because that month was paid.
- **Rollover.** When a monthly lot reaches its natural expiry, 10% of its
  remainder becomes a rollover lot. That lot expires at the source lot's
  `expires_at` + 1 month, even if the plan has lapsed. Rollover lots never
  roll again.
- **Signup lot.**
  - One per user, `source_key 'signup'`, with 1,000 credits.
  - It is valid from minting until `greatest(auth.users.created_at,
    launch_at) + 30 days`, and is not minted after that date. Existing Free
    accounts get 30 days from launch; a new account gets 30 days from
    sign-up, and does not get a fresh 30 days by staying away.
  - It is minted only when `auth.users.email_confirmed_at` is set. Production
    already requires a confirmed email for email sign-ups, and Google
    sign-ins arrive confirmed. This was checked on 2026-10-14 with two
    aggregate counts over `auth.users`: all 4 email sign-ups were sent a link,
    and 2 never confirmed. No personal data was read.
- **Expiry.** An expired lot's remainder becomes an expiry entry, so the
  ledger stays complete.

### 5. Plan changes

- **Upgrade, paid now.** `grant_paid_plan` starts the new plan at once (current
  behaviour). The new grant mints its lot, and the old lot keeps its expiry.
- **Downgrade at the next cycle.** This needs `grant_paid_plan` to queue a
  lower plan instead of starting it now. That is billing code, so it is
  recorded for O6. Until checkout opens, plans change only by admin grant
  (§4).
- **Lapse.** At `plan_period_end` the user is Free. Their monthly credits
  expire into a rollover; rollover and top-up lots stay until their own
  dates.
- **Re-subscribing after a lapse** is a new grant with `base = created_at`:
  a new cycle starting that day.

### 6. What spends credits

| Call | Charged | Note |
|---|---|---|
| research-chat answer rounds, retrieval embeddings, web search | yes | web search is already inside `cost_usd` |
| citation repair | no | our correction |
| desk-brief | no | shared and cached per record; decided under F123 |
| transcribe-audio (dictation) | no | gains a `model_call_logs` row so its cost is visible |
| admin ingestion, OCR | no | platform cost |

#### 6.1 Which plans may use a model (F150, owner 2026-10-14)

- **Per model.** `ai_models.min_plan` (`app_plan`, default `plus`) is the
  lowest plan that may use a model; plans rank free < plus < pro < max.
- **Seeded free:** Gemini Flash-class, DeepSeek, Luna and Haiku. Everything
  else, and any model added later, needs a paid plan until an admin changes
  it. The owner decides plan-by-plan access per model later.
- **research-chat** reads the caller's plan from `user_profiles` with the
  service client, only when the chosen model or a failover the chain could
  reach is above Free, and applies
  `entitlement_from`'s rule (a lapsed paid plan, or an account that is not
  active, counts as Free). Below `min_plan` it answers 403
  `{error: 'This model is available on paid plans.', code:
  'model_requires_plan'}` before reserve, so nothing is held or created. A
  plan read that fails answers 503 `plan_unavailable`.
- The failover chain (requested, default, cheapest other) is built only from
  the models the plan allows, so a paid model never answers for a Free user;
  with no allowed fallback the turn fails as it would with none available.

### 7. Reading credits, and privacy

- **`my_credits()`**, called as the signed-in user via `auth.uid()`, returns:
  - the balance, and what is held;
  - the lots, with kind, remaining and expiry;
  - this cycle's allowance and the cycle end;
  - the credits charged per recent answer.
- **No dollars.** It returns no dollars and no exchange rate.
- **No direct table access.** Credit tables have RLS on and no user
  policies.
- **Privileges.**
  - Every function is `SECURITY DEFINER` with `SET search_path = ''` and
    `SET TimeZone = 'UTC'`.
  - **Executable by `service_role` only:** everything except the two `my_`
    functions, revoked from `PUBLIC`, `anon` and `authenticated`.
  - **Internal helpers** (mint, expire, draw, sweep) live in a `private`
    schema that only the owner can use. Supabase's default privileges grant
    EXECUTE on new `public` functions to `anon` and `authenticated`, so no
    helper may sit in `public`.
  - **The one exception:** `my_credits()` writes (it mints, expires and
    sweeps for the caller only) and is granted to `authenticated`. It is
    `VOLATILE`, and its only input is `auth.uid()`.
  - **The fixture** enumerates every function the migration adds in `public`
    and `private`, through `pg_proc`, and checks `has_function_privilege` for
    each role.
- **Answer frames.** The answer stream carries credits only, never cost.
- **Closing today's dollar leaks.**
  - The migration drops the `authenticated` SELECT on `model_call_logs` and
    `chat_turn_traces`. Nothing in the app reads them.
  - research-chat stops writing any cost into `chat_messages.usage`. That
    covers the top-level `cost_usd` and `web_search_cost_usd`, and the
    `observed` block's `cost_usd` and `cost_usd_from`.
  - A BEFORE INSERT OR UPDATE trigger on `chat_messages` strips the same keys
    from any new write, so dollars cannot return before (or regardless of)
    the research-chat change (review 1R, M3).
  - The migration strips those keys from existing rows. A fixture checks, as
    `authenticated`, that no row matches
    `jsonb_path_exists(usage, 'strict $.**.cost_usd')`.
  - `model_pricing` stays readable, because the model picker uses it and it
    holds public list prices.
  - Dollars still follow from credits ÷ 950. Hiding them is a display
    choice, not a secret, and no further fixtures are needed.

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
  - It shows a breakdown by expiry, plus credits used this cycle
    (`my_credits().used_this_cycle`: answers charged since the current
    monthly lot began, or on Free since the signup lot began; none when there
    is neither).
  - It lists recent answers with their credits: date, conversation title and
    credits. This follows TenderBase's per-turn cost view, without dollars or
    model rows.
- **Model picker.** It keeps its cost diamonds. Per-model estimates come
  from `model_credit_estimates()` (F151, §12); showing them is UI work.

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

#### 10.1 Wording (approved by the owner as written, 2026-10-14)

**Pricing page** (`src/lib/publicPlans.js`)

| Place | Now | Proposed |
|---|---|---|
| Free card | "AI research assistant with starter credits" | "1,000 AI credits to start, valid 30 days" |
| Plus card | "More monthly AI credits" / "Unused credits carry forward" | "2,000 AI credits every month" / "10% of unused credits roll over for a month" |
| Pro card | "Higher monthly AI credits" / "Unused credits carry forward" | "6,500 AI credits every month" / "10% of unused credits roll over for a month" |
| Max card | "Highest monthly AI credits" / "Unused credits carry forward" | "75,000 AI credits every month" / "10% of unused credits roll over for a month" |
| Compare table, "Monthly AI credits" | Starter / More / Higher / Highest | 1,000 to start / 2,000 / 6,500 / 75,000 |
| Compare table, "Unused credits carry forward" | ✓ ✓ ✓ ✓ | Row renamed "Unused credits roll over": — / 10% for a month / 10% for a month / 10% for a month |
| "AI credits" chip | "allowances published before paid plans open" | "a typical answer uses about 20 credits; larger models use more" |

The "about 20 credits" figure comes from the measured median of 21 credits
per answer (Current state).

**Terms, "Plans, credits and billing"** (`src/lib/legalPolicies.js`)

- **"What plans include", replacing the current bullet:**
  > Paid plans differ in AI credits and, when personal file storage is introduced, storage. One credit is worth ₹0.10 of AI processing. An answer uses credits according to the AI processing it needs (tokens and web searches), so longer answers and larger models use more. How many credits each plan includes is published on the Pricing page; we may change it for future billing months with notice.
- **"Credits", replacing "Unused credits remain available…":**
  > New accounts receive 1,000 credits once, valid for 30 days. Paid plans add their monthly credits at the start of each paid month, valid until that month ends. Up to 10% of a month's unused plan credits carry into the next month and expire at its end. Top-up credits, when offered, are valid for 12 months. Credits are used in the order they expire. Credits have no cash value and cannot be transferred.
- **New bullet, "How answers are charged":**
  > An answer that fails without giving you any text uses no credits. If you stop an answer, the part already produced is charged. An answer always finishes: if it costs more than your remaining credits, your balance can go below zero, and the difference is taken from your next credits.

**Refund policy, "Unused credits"**
> Unused credits have no cash value and are not refunded. Up to 10% of a month's unused plan credits carry into the next month; the rest expire at the end of the month.

**Unchanged:** "On closure … unused credits lapse" (Suspension and closure),
and the refund clause about partly used months.

### 11. Rollout

1. **Migration, function and site,** each with the owner's go-ahead.
2. **Enforced for everyone from 2026-10-14** (owner: remove the shadow
   concept). research-chat always calls `reserve_turn_credits(user,
   turn_key, true)` and no longer reads `CREDITS_ENFORCED`. Balances were not
   reset. (Superseded: a shadow week behind `CREDITS_ENFORCED` was planned.)

### 12. Schema and function contracts

This is the interface every later task builds on. The migration may add
indexes, checks and `private` helpers, but may not change these shapes without
a spec amendment. Amounts are `numeric(14,4)` credits.

**Tables**
- RLS is on, with no user policies.
- All privileges, including column grants, are revoked from `PUBLIC`, `anon`
  and `authenticated`.
- `service_role` gets SELECT only (review 1R, M6). Every write goes through
  the SECURITY DEFINER functions, which keep the invariants under the wallet
  lock. The "UPDATE allowed" notes below describe what those functions do,
  not grants.
- Every `user_id` references `auth.users ON DELETE CASCADE`. Deleting an
  account therefore deletes its credit history, which fits "unused credits
  lapse on closure" and erasure requests (settled question 8).

| Table | Key columns and rules |
|---|---|
| `credit_settings` | One row (`id boolean PK CHECK (id)`): the §1 settings, plus `updated_at` and `updated_by`. UPDATE allowed |
| `credit_plan_allowances` | `plan app_plan PK` (paid plans only), `monthly_credits > 0`. UPDATE allowed |
| `credit_wallets` | `user_id PK`, `balance`, `debt ≥ 0`, `updated_at`. UPDATE allowed |
| `credit_lots` | `id uuid PK`, `user_id`, `kind` ∈ signup, monthly, rollover, topup, adjustment; `granted > 0`; `0 ≤ remaining ≤ granted`; `starts_at < expires_at`; `source_key`, `UNIQUE (user_id, source_key)`; `plan app_plan null`; `created_by null`; `note null`; `closed_at null` (expired or ended). UPDATE allowed on `remaining` and `closed_at` |
| `credit_ledger` | `id uuid PK`, `user_id`, `kind` ∈ grant, charge, expiry, adjustment; signed `credits`; `lot_id null`; `turn_key null` (charges); `request_id null UNIQUE` (admin adjustments); for charges, the `usd_to_inr` and `inr_per_credit` used; `created_by null`, `note null`, `created_at`. **No UPDATE or DELETE for anyone**, so it is append-only by privilege. Only the account-deletion cascade removes rows |
| `credit_charge_rows` | `model_call_log_id PK`, `ledger_id → credit_ledger`, `cost_usd`. One row per charged log row, so a row is never charged twice |
| `credit_lot_draws` | `id`, `lot_id`, `ledger_id null`, `reason` ∈ charge, removal, repayment; `credits > 0`; `created_at` |
| `credit_holds` | `(user_id, turn_key) PK`, `credits > 0`, `created_at`, `expires_at`, `settled_at null`, `swept_at null`, `shadow_blocked boolean`. UPDATE allowed on `settled_at` and `swept_at` |

**Index added to an existing table:** `model_call_logs (message_id)`, which
settle and sweep read.

**Invariants** (each one a fixture)
- `credit_wallets.balance` = sum of the user's `credit_ledger.credits`.
- For each lot, `granted − remaining` = its draws + its expiry entry.
- `debt` = (charges + removals) − (their draws) − (repayment draws).
- No lot is negative, and no grant is negative.

**Functions**
- All are `SECURITY DEFINER`, with `SET search_path = ''` and
  `SET TimeZone = 'UTC'`.
- Helpers live in `private`.
- Every writer takes the wallet row lock (`FOR UPDATE`) and never locks
  `user_profiles`. Grants to a plan lock the profile first and the wallet
  second, so there is one lock order.

| Function | Caller | Contract |
|---|---|---|
| `reserve_turn_credits(p_user uuid, p_turn_key text, p_enforced boolean) → jsonb` | service_role | Runs the §3 order. An existing hold for the turn is returned unchanged. Returns `{ok, hold:{credits, expires_at}, available, balance}`, with `reason:'credits_exhausted'` when `available ≤ 0`. Creates no hold when blocked and `p_enforced` is true. Creates one marked `shadow_blocked` when blocked and `p_enforced` is false; research-chat always passes true since 2026-10-14 |
| `settle_turn_credits(p_user uuid, p_turn_key text) → jsonb` | service_role | Finds the message through `research_turns`. Returns `{state:'pending'}` while it is `running` and inside its deadline. Otherwise it charges the turn's uncharged chargeable rows (§3.1) as one ledger entry, sets `settled_at`, and returns `{state:'charged'\|'free', credits, balance}`. Idempotent. A message deleted with its conversation is charged from its logs |
| `admin_adjust_credits(p_user, p_credits, p_kind, p_reason, p_admin, p_request_id uuid) → jsonb` | service_role | `p_kind` is adjustment or topup, and `p_reason` must not be empty. A repeated `p_request_id` returns the first result. Positive: mints a lot (a top-up valid `topup_valid`, an adjustment valid 12 months). Negative: an adjustment entry that draws lots and may create debt |
| `credits_on_plan_grant()` | trigger on `plan_grants` | Applies §4: a payment grant becomes one cycle, and a manual change ends the open monthly lot |
| `my_credits() → jsonb` | authenticated | For `auth.uid()` only. It sweeps, expires and mints first. Returns `{balance, held, debt, plan, inr_per_credit, cycle:{allowance, ends_at}, used_this_cycle, lots:[{kind, remaining, expires_at}], recent:[{conversation_id, title, credits, created_at}]}`: `recent` is the last 20 charged answers. `used_this_cycle` is the credits charged to the user's answers (charge entries, as a positive number) since the cycle start: the `starts_at` of the current open monthly lot, else on Free the open signup lot's; null when there is neither. `inr_per_credit` (₹0.10) is the published value of a credit, used for the rupee hint, so the UI copies no rate. No USD and no exchange rate |
| `my_conversation_credits(p_conversation uuid) → jsonb` | authenticated | `[{message_id, credits}]` for the caller's own conversation, read only, so reloaded answers show their credits |
| `model_credit_estimates() → jsonb` (F151) | authenticated | `[{model_id, credits, basis}]` for every enabled `ai_models` row, in picker order. `measured`: the median credits per answer over 30 days when the model has at least 10 charged answers (charges summed per turn; a turn belongs to its earliest charged `chat_answer` row's `model_requested`). Else `list_price`: `round((prompt_usd × 30,000 + completion_usd × 2,000) × usd_to_inr ÷ inr_per_credit)`. `none` with `credits` null when unpriced. Whole credits, at least 1; no USD, rupees or rate. STABLE, read only; not executable by `PUBLIC`, `anon` or `service_role` |

**Columns added by `20261014230000_credit_estimates_and_effort.sql`:**
`ai_models.min_plan` (§6.1) and `model_call_logs.reasoning_effort` (P3: the
effort the turn asked for, `off` when none, on every research-chat row; CHECKed
against `validate.ts` `REASONING_VALUES`, null for older rows and other
callers).

The `my_` functions and `model_credit_estimates()` are the only ones granted
to `authenticated`; nothing is granted to `anon`.

## Acceptance evidence

**SQL fixtures**
- Each fixture runs as the non-superuser migrator, and the runner proves it
  non-vacuous.
- **Invariants.** Every §12 invariant holds after each operation below.
- **Holds.**
  - Two reserves at a balance of 25 for different turns: the first holds 25
    and the second is blocked.
  - The same turn reserved twice gets its first hold back.
  - When enforcement is off, a blocked turn still gets a `shadow_blocked`
    hold and is charged at settle.
- **Debt.**
  - A charge of 300 on lots of 120 leaves −180, and the reserve is then
    blocked.
  - A new 2,000 monthly lot leaves 1,820, through a repayment draw.
  - No ledger entry is written for the repayment, and the ledger still sums
    to the balance.
- **What is charged.**
  - Each row of the §3.1 table is charged as stated.
  - Repair rows are never charged.
  - A `success` row with no cost is not charged.
- **Settle and sweep.**
  - Settle is idempotent.
  - A log row committed after the settle is charged by the sweep, once.
  - Before a hold expires, the sweep does not touch it.
  - A turn still `running` past its deadline settles as `interrupted`.
  - A deleted conversation is still charged from its logs.
- **Lots.**
  - Spending draws the earliest-expiring usable lot.
  - An early renewal's lot is unusable until its `base`.
  - The 10% rollover is right, and a rollover never rolls.
  - A plan paid on 31 January does not drift at month ends.
  - A user away for three months gets the current cycle only.
- **Plan changes.**
  - One payment mints exactly one lot, including a re-subscription after a
    lapse.
  - A paid upgrade keeps the old lot.
  - An admin grant to Free, or to another plan, ends the open monthly lot
    with no rollover.
  - A paid plan at launch with no `plan_grants` row gets its current cycle.
- **Signup.**
  - Minted once, and only for a confirmed email.
  - Expires at `greatest(created_at, launch_at) + 30 days`.
  - Not minted after that date.
- **Top-ups and adjustments.**
  - Top-ups expire at 12 months.
  - A repeated admin `request_id` grants once.
- **Privileges and privacy.**
  - For every function the migration adds, `has_function_privilege` matches
    §12 for `anon`, `authenticated` and `service_role`.
  - `authenticated` cannot read any credit table, `model_call_logs` or
    `chat_turn_traces`.
  - `service_role` cannot UPDATE or DELETE `credit_ledger`.
  - Deleting an account cascades its credit rows.
  - No `chat_messages.usage` matches `strict $.**.cost_usd`.
  - `my_credits()` has no USD key.

**Deno tests (research-chat)**
- Reserve runs before the claim.
  - Blocked: 402 `credits_exhausted`, and no message (always enforced).
  - Reserve error: 503.
- Settle runs after the flush and within 3 seconds. A settle error or
  timeout leaves `credits: null` and does not fail the turn.
- The round cut off by Stop gets its cost from the generation endpoint, and
  stays uncharged if none arrives.
- No cost key is written into `chat_messages.usage`.

**Deno tests (transcribe-audio)**
- A log row is written, and the call is never charged.

**Vitest**
- The composer shows the balance (including negative), the warning and the
  blocked state.
- Per-answer credits show, including "No credits used".
- Plan & billing: the breakdown and recent answers render, with no dollars.
- The admin adjustment needs a reason.
- The copy changes are in place.

**Repository checks**
- `npm run lint`, `npm run build`, both test suites, `npm run test:sql` and
  the router import.

**Local end-to-end runs (scratch Supabase stack, real OpenRouter)**
- A Plus user answers, stops a turn, uses two tabs at a low balance, and
  goes negative and is repaid.
- Each charge equals logged cost × 950.
- Total test spend is at most $1.00.

**After deploy (shadow week; removed by the owner, 2026-10-14)**
- Each answer's credits match its logged cost, over at least 50 production
  turns.

## Scope

**In scope**
- The tables, functions, fixtures and migration above.
- research-chat's reserve and settle, and the cost of a stopped round.
- The transcribe-audio log row.
- The composer, answer, Plan & billing and admin UI.
- The pricing and policy copy.
- Docs.

**Excluded**
- Razorpay orders for plans and top-ups, and the downgrade queue in
  `grant_paid_plan` (both O6).
- Organisations and seats (P2).
- NYAI gating (the model does not exist yet).
- Per-feature limits, and charging briefs, dictation or indexing.
- Limiting expensive models on a low balance. (Per-model estimates are
  F151 and plan-gated models F150, §6.1 and §12, added 2026-10-14.)
- GST.

## Boundaries

- **Always.**
  - Write tests first, and prove each fixture fails without its migration.
  - Keep rates and allowances in the database only.
  - Keep dollars out of every user-facing response.
  - Use the §3 order in every writer.
- **Ask first.**
  - Any change to the published copy wording.
  - The migration, function deploy and push to production.
  - Switching enforcement on.
- **Never.**
  - Edit or delete a ledger entry, or let a lot go below zero (debt lives on
    the wallet).
  - Let a gate fail open.
  - Put a credit helper in `public`.
  - Touch billing payment code beyond reading it.

## Settled questions (owner, 2026-10-14)

1. **Exchange rate:** ₹95 per USD, fixed.
2. **Truncated answers:** charged.
3. **Minimum to start:** none; any balance above zero starts an answer.
   - The answer always finishes and may leave the balance negative.
   - The hold (300 credits, above the dearest measured answer) only stops
     several answers at once from running far below zero.
4. **Email confirmation:** production already requires it for email
   sign-ups. Resend on the company domain is separate work.
5. **Existing users at launch:**
   - Free accounts get 30 days from launch.
   - Paid and manually granted plans get the current cycle's credits.
6. **Shadow mode:** one week, on real balances. (Superseded 2026-10-14:
   enforced for everyone; the owner removed the shadow concept.)

## Design review (2026-10-14)

- **Who reviewed.** A fresh-context `security-auditor` reviewed this spec
  against the code before any implementation.
- **Critical findings, all fixed above:**
  - Anchor cycles could mint two lots for one payment. Cycles now follow the
    payment grants (§4).
  - A reserve-time settle could race the log flush and make answers free.
    Only the handler settles before a hold expires, and charges are per log
    row (§3, §12).
  - Failed turns that still deliver text: settled as charged (question 7).
  - A round cut off by Stop reported no cost. It is now fetched (§3.1).
- **Important findings, all fixed above:**
  - Repayment broke the ledger sum.
  - The reserve order was wrong.
  - Shadow mode skipped exhausted users.
  - Helpers were exposed by default privileges.
  - `usage.observed` still carried dollars.
  - The hold was too long and the settle limit too short.
  - The launch backfill was missing.
  - An admin could mint credits by switching plans.
  - Account deletion clashed with the append-only ledger.
  - Lock order.
- **Minor findings, adopted:**
  - UTC in every function.
  - Rounding rule.
  - Admin idempotency.
  - Uncosted rows logged.
  - Rollover expiry after a lapse.
  - Holds keyed by turn, which also fixes a retry getting 402.
  - The settings history table was dropped.

#### 12.x Amendment, 2026-10-14: usage reports (F153)

Added by migration `20261014233000_credit_usage_reports`, per
[the usage page spec](2026-10-14-credits-usage-page.md) (Decision 1):

- `my_usage_summary(p_from, p_to)`, `my_usage_timeseries(p_from, p_to, p_bucket)` and
  `my_usage_activity(p_offset, p_limit, p_grouped, p_model, p_status, p_kind)`: SECURITY
  DEFINER, `search_path ''`, TimeZone UTC, STABLE, `authenticated` only, scoped to `auth.uid()`,
  IST buckets, clamped inputs, credits only (no USD key).
- `my_credits()` gains `cycle.starts_at` (the start `used_this_cycle` counts from), and `recent`
  reads the latest 200 charge entries before it aggregates.
- Index `research_turns (user_id, created_at DESC)`.

## Implementation notes (task 1, accepted 2026-10-14)

Choices made in `20261014200000_ai_credits.sql` where this spec was silent;
none changes a §12 contract.

- **Launch backfill.** Paid profiles with no `plan_grants` row are recorded
  in `private.credit_launch_grants`, and their lots are keyed `launch:<n>`.
  No `plan_grants` rows are invented. Production had none on 2026-10-14.
- **Deleted conversations.** Deleting a conversation clears
  `research_turns.assistant_message_id`. A trigger therefore keeps each
  turn's message id in `private.credit_turn_messages`, and such a turn is
  charged from its logs as `complete`.
- **Manual grants.**
  - Every manual grant, including the same plan, ends the open monthly lots,
    and its cycles stop at the user's next grant. An admin re-granting the
    same plan therefore refills the month. This is accepted, because an
    admin can grant credits directly anyway.
  - A payment never ends an open lot.
- **Lot timing.** Lots are minted only once usable, and a rollover that
  would already be expired is skipped.
- **Shadow holds.** A shadow-blocked hold is full size but does not count
  against other turns, so shadow behaves as enforcement would. Unused since
  2026-10-14: research-chat always passes `p_enforced = true`.
- **`my_conversation_credits`** lists charged answers only. A missing answer
  means no credits were used.
- **The usage scrub** disables `research_result_immutable` for its one
  UPDATE, inside the migration transaction, under an exclusive lock.
- **Out of scope, for O6.** `grant_paid_plan` chains renewal ends by +1
  month, so billing dates drift after a 31st (31 Jan → 28 Feb → 28 Mar).
  Lots follow the grants exactly.

## Settled after the design review (owner, 2026-10-14)

7. **Failed turns that still showed text are charged.** A turn ending
   `error` or `interrupted` is free only when no answer text was saved.
   - When text was delivered, it is charged as `complete` (§3.1).
   - This amends decision 6: "free" means the user received nothing.
8. **Deleting an account deletes its credit history** (§12, cascade).
   Invoices stay in the billing tables.

No questions are open. Code starts on the owner's word.
