# AI credits: TenderBase reference review and Niyantran gap

> **Status:** Historical (dated 2026-10-14). A code reading of TenderBase
> (`DDL Labs codebase/tenderbase-onboard`, not a git checkout, not executed)
> and of Niyantran `origin/main` at `e323dca`, made before the F111 spec.
> **Evidence class:** code reading only. Nothing was run, built or called, and
> nothing here says what TenderBase has deployed. Items marked **(re-read)**
> were read a second time by the supervisor at the cited lines; the rest come
> from four read-only reviews (database, Edge Functions, frontend, Niyantran).
> TenderBase paths are relative to its repo root; migrations are cited by
> timestamp prefix.

## Why

Owner, 2026-10-14: TenderBase already runs credits on the same stack
(OpenRouter, Exa web search, Supabase). Its coding agent (Lovable) wrote an
engineering description of that system. The owner asked for that description
to be checked against the code, for independent findings, and then for a
separate plan for Niyantran's credits (F111). Razorpay (O6) follows F111.

## 1. Verdict

The description is a simplified and partly wrong account of the code.

- **The shape is right.** There is a per-call log (`model_call_logs`), and an
  `AFTER INSERT` trigger turns each row into one ledger row (`credit_charges`,
  unique per log row) at a frozen exchange rate. A rollup table holds
  balances. A gate RPC runs before each chat turn and the function returns 402
  when it blocks.
- **The real system is larger.** It also has billing periods with an anchor
  day, an hourly renewal cron, a 10% rollover cap, org and per-agent budgets
  with a hard stop, connector billing, a retry queue for failed charges, and a
  reservation for document indexing. None of this is in the description.
- **The code has defects that lose money or lock customers out** (§4). The
  worst two are that the main chat bills only the last round of a turn, and
  that an organisation which overspends breaks its own monthly renewal.

The pattern is worth adopting. The implementation should not be copied
as-is.

## 2. The description, claim by claim

| Claim | Finding | Evidence |
|---|---|---|
| ₹95 per USD, ₹5 per credit, 0% markup | True **today**, but in **three** places that can drift: the `fx_rates` table, the Edge constants, and **₹83** in run-agent's per-turn ceiling. The frontend hard-codes ×5 in three more files. | `supabase/functions/_shared/credits.ts:10-14` **(re-read)**; `run-agent/usage.ts:115`; `src/hooks/useModelUsage.ts:471`, `src/lib/drive/indexing.ts:198`, `src/utils/aiActivityExport.ts:91` |
| `fx_rates` baseline row with markup 0 | The 1970 baseline row was back-filled with a **30%** markup by a column default. Markup 0 is a second row, added later. | migrations 20260817191203:2-4, 20260905150942:5-6 |
| "Frozen" FX and credits per charge | The ledger was **rewritten twice**: once dividing every charge by 5, once removing the 30% markup from all history. Neither rewrite left a reversal entry. | 20260817182854:51-53; 20260905150942:80-84 |
| `credit_charges` unique per `model_call_log_id` | True, but that column is now nullable. A charge comes from either a model call or a tool call. | 20260905211310:236-248 |
| Status check `success, error, aborted, blocked` | The check allows ten values, `ok` among them. | 20260817180334:4-6 |
| Signup grant once per organisation, by `kind` | It is keyed on `reason = 'signup_grant'`. `kind` has six values (adds `purchase_drawdown` and `manual`). | 20260817175334:59-60; 20260817191203:72-84 |
| Balance clamped with `GREATEST(0, …)` | Not clamped: the balance can go negative. | 20260817191203:143 |
| `check_credit_cap(p_org)` blocks at zero | Also takes `p_entity`. It first renews the period under a row lock, then checks the wallet, the tool cap and the org cap. | 20260905211310:427-520 |
| Gate fails closed with 402 `credit_limit_reached` | **Partly.** talk-to-tender fails **open** if the gate throws. run-agent ignores a gate error. ask-ai fails closed but sends no `code`. | `talk-to-tender/handler.ts:646` **(re-read)**; `run-agent/index.ts:302-316`; `ask-ai/index.ts:270-282` |
| Web search declared as a function tool `openrouter:web_search` with `{query}` | **Wrong in the description; right in the code.** The code sends OpenRouter's server tool `{type:'openrouter:web_search', parameters:{engine:'exa', …, max_uses}}`, the same shape Niyantran uses. | `_shared/agent-core/webSearch.ts:44-54` |
| A telemetry row per call, written even on disconnect | ask-ai and run-agent write a row per step. **talk-to-tender writes one row per turn, carrying only the last round's cost** (§4.1). | see §4.1 |
| UI: usage card, chart, activity dialog | Present. The chart toggles credits, tokens and calls (three options, not two). Latency is never shown in the UI. Only owners and admins see any of it; members see nothing. | `src/components/storage/*`, `AiActivityTurnTable.tsx` |
| "Users never see USD" | Only true at render time. `cost_usd` and `markup_pct` are sent to the browser, and `anon` can read `model_pricing`. | `useModelUsage.ts:53-95`; 20260817175334:14-15; 20260817215823:16-25 |

## 3. What the description leaves out

- **Billing periods.**
  - Each organisation has a billing anchor day in IST and a `monthly_grant_credits` value (default 100).
  - `ensure_org_credit_period` renews lazily whenever the gate runs, and cron `credit-period-renewal-hourly` renews in the background.
  - Rollover is capped at 10% of the monthly grant.
  - The signup grant counts as the first month's 100 credits and expires at that period's end.
  - Evidence: 20260817191203, 20260817202411.
- **Budgets.**
  - `organisation_credit_settings` holds an org-wide monthly cap; `organisation_entity_credit_settings` holds per-tool or per-agent caps.
  - Each cap has a "pause AI when reached" hard stop.
  - Owners and admins edit both through RLS from `AiBudgetsCard.tsx`.
- **Connector billing.** `tool_call_logs`, `price_tool_call` and `charge_tool_call` charge Composio calls at a flat $0.0003.
- **Failed-charge queue.** `unbilled_usage_events`, with an hourly replay (20260905162909).
- **Indexing reservation.**
  - `check_ingestion_credit_serialised` takes an advisory lock and holds 0.05 credit for each in-flight job.
  - It is the only reservation anywhere; chat has none.
- **Daily rollup and reporting RPCs.** A daily usage table and a set of views and RPCs feed the usage card, chart and CSV export.
- **What does not exist.** There are no plans, subscriptions, payments, top-ups, invoices or GST, in either SQL or UI.
  - Nothing writes a `purchase` grant.
  - There is no admin RPC to grant credits.
  - There is no refund or reversal.
  - The UI says "until the wallet is topped up" but has no way to top up.
  - The 402 message tells the user to "raise the cap", even when the wallet is simply empty.

## 4. Defects found

### 4.1 The main chat under-bills multi-round turns (re-read)

- **Where the cost is kept.** One `openRouterResult` object is created per request (`talk-to-tender/index.ts:147`). Every round's stream gets the same object (`:585`).
- **How each round overwrites it.** The stream reader merges each usage chunk into `result.meta` (`_shared/agent-core/openrouterStream.ts:200`). Each round therefore replaces the previous round's `usage.cost`.
- **What gets logged.** `getUsage()` returns that one object (`index.ts:672-677`), and the handler writes a single `chat_answer` row from it (`handler.ts:1579`). Nothing sums the rounds.
- **Effect.** A turn can run up to 16 steps plus 2 continuations, so most of a long turn's spend goes uncharged.

### 4.2 An overspent organisation breaks its renewal (re-read)

- **The cause.** At rollover, the final `ensure_org_credit_period` inserts a grant of `credits = -v_overflow` with kind `purchase_drawdown` (20260817202411:62-64). `credit_grants.credits` carries `CHECK (credits > 0)` (20260817175334:47), and no migration drops it. (The `drop constraint` in 20260817191203:81 is the `kind` check.)
- **Effect on the organisation (inferred, not run).** Once usage beats the allowance, every later gate call errors. The chat functions fail closed on a gate error, so that organisation stays locked out.
- **Effect on everyone else (inferred).** The hourly cron has no per-org exception handling, so one such organisation stops renewal for all of them.
- Overspending is easy, because of §4.4.

### 4.3 Stopped, failed and capped turns are free

- **What the trigger charges.** Only `success` or `ok` rows (20260905150942:23-27).
- **Why that leaks.**
  - An aborted, errored or blocked turn costs the platform every round OpenRouter completed, but the user pays nothing.
  - Pressing Stop just before the final answer makes the turn free.
  - When run-agent hits its per-turn credit ceiling, it marks the turn failed, so the whole expensive turn is free (`run-agent/index.ts:1037-1043, 1399-1403`).
- **A related gap.** A `cost_usd` filled in later by an UPDATE is never charged.

### 4.4 No reservation for chat, so concurrent turns overdraw

- **How the gate works.** It locks the organisation row but changes no balance.
- **Concurrent turns.** N concurrent turns at a balance of 0.01 all pass.
- **A single turn.** Once admitted, a turn can spend without limit: 16+ rounds, `max_tokens` up to 100k, and a growing context.
- **What overdraws.** Nothing in the code prevents it. A negative balance then triggers §4.2.

### 4.5 Gate RPCs callable across organisations (inferred from Supabase defaults; live privileges unchecked)

- **`check_credit_cap`.**
  - It is `SECURITY DEFINER`, accepts any `p_org`, and has no `auth.uid()` check.
  - It is revoked only from `public` and `anon`. Supabase grants EXECUTE to `authenticated` by default, so it is probably still callable by signed-in users.
- **The other three.** `ensure_org_credit_period`, `refresh_org_credit_balance` and `close_and_renew_credit_periods` have no revoke at all.
- **What follows.**
  - A signed-in user could probably read another organisation's balance and caps.
  - They could also trigger its renewal and row lock.

### 4.6 Paid calls that are ungated or unlogged

| Call | Gated | Cost logged |
|---|---|---|
| voice-to-text (OpenAI Whisper, called directly) | no | no |
| talk-to-tender: per-search embeddings | via the turn gate | no |
| talk-to-tender: compaction | via the turn gate | no |
| run-report: embeddings | via the turn gate | no |
| capture-ocr-fixture | no | no |
| generate-about (n8n) | no | no |
| optimize-* | no | yes (charged after the fact) |

### 4.7 Smaller defects

- **Failed connector charges never replay.** They are parked without `caller` and `purpose`, so the hourly replay into `model_call_logs` fails every hour.
- **Budget caps were rescaled, grants were not.** Caps were divided by 1.3 when the markup was removed.
- **Deleting a log row deletes its charge.** The foreign key cascades.
- **Two precisions.** Model charges round INR to 4 decimals, tool charges to 6.
- **Inconsistent 402 surfaces.**
  - The 402 is shown twice: a banner and a toast.
  - It points to two different tab names.
  - It offers no top-up.
- **Cost per charge grows with history.** Every charge re-sums the
  organisation's whole ledger to refresh the balance.

## 5. Niyantran today

Source: `origin/main` at `e323dca`.

- **Identity is per user.**
  - The `organisations` tables exist but are dormant: signup writes `organisation_id = null`, and `create_organisation()` raises.
  - The plan lives on `user_profiles` (`plan`, `plan_status`, `plan_period_end`, `plan_source`).
  - `my_entitlement()` reads the plan.
  - `grant_paid_plan` and `grant_manual_plan` are callable only by the service role, and `plan_grants` has a unique `payment_id` (`supabase/migrations/20260929100000_plan_entitlements.sql`, `20261012120000_inr_plans.sql`).
- **Telemetry is already better than TenderBase's.**
  - research-chat writes one `model_call_logs` row **per provider attempt**: every round, citation repair and embeddings. Each row records `aborted` or `error` honestly.
  - Cost is OpenRouter's `usage.cost`, else tokens × `model_pricing` (`supabase/functions/research-chat/telemetry.ts:92-108, 192-209`).
  - Web search adds `web_search_count` and `web_search_cost_usd`, the latter as an attributed share that is never added on top of the call's cost (`20261013140000_web_search.sql:46-50`).
  - Only the service role writes, and users read only their own rows.
  - The rows are flushed after the turn's durable write (`research-chat/handler.ts:403-412`).
- **No enforcement anywhere.**
  - No credit, quota or per-user limit exists.
  - research-chat never reads the plan.
  - The "$1.00 web-search cap" was a test budget in a plan document, not code.
  - The only limits are per turn: 12 steps, 10 searches, 3 web searches, 2 continuations (`research-chat/agent.ts:27`, `_shared/webSearch.ts:10-16`).
- **User-triggered paid paths.**
  - research-chat (logged).
  - desk-brief (logged).
  - transcribe-audio (**not logged**; `transcribe-audio/handler.ts:60-63`).
  - Ingestion is admin-only and counts as platform cost.
- **Published commitments** (`src/lib/legalPolicies.js`, `src/lib/publicPlans.js`).
  - Credits are consumed by tokens.
  - Unused credits carry forward.
  - Unused credits lapse on account closure.
  - Credits have no cash value and are not refundable.
  - NYAI is Pro/Max only.
  - Allowances are "published before paid plans open".
  - `BILLING_CHECKOUT_OPEN` keeps checkout closed until F111.
- **UI.**
  - Plan & billing panel (`src/shell/PlanBilling.jsx`).
  - Admin manual plan grant.
  - A 1–3 diamond cost hint in the model picker.
  - No usage or credits display for users.

## 6. What to take, change or avoid

**Take:**
- The log-then-trigger ledger: one charge per log row, a unique key, written by the database, not by Edge code.
- The rate frozen on each charge, from a dated rate table.
- Showing users credits, with rupees as a hint.
- The per-turn cost breakdown, with repair calls marked "no charge".
- Credits per 1M tokens in the model picker.
- Readable failure reasons.
- A complete CSV export.

**Change:**
- **Wallet per user, keyed for a later organisation.** Niyantran is per user. Organisations (P2) can come later without reshaping the ledger.
- **One signed ledger instead of grants, charges and a re-summed rollup.**
  - Entries are grant (+), charge (−), expiry (−) and adjustment (±).
  - The balance is updated in the same transaction as the entry.
  - A negative balance is a normal state with a stated policy, not a negative grant that violates a check.
  - Corrections are new entries, never rewrites.
- **One source for the rate.** It lives in the database. Edge code and the browser read it from there, and no file holds a constant.
- **A reservation per turn.**
  - The turn starts by holding a ceiling sized from the turn budget.
  - It settles to the actual charge at the end.
  - A per-user lock covers the hold, so concurrent turns cannot all pass on the same balance.
- **Periods tied to the plan record Niyantran already has** (`plan_period_end`, `grant_paid_plan`), instead of a separate anchor day and cron.

**Avoid:**
- Billing only part of a turn.
- Free stopped or failed turns, for spend that has already happened.
- A gate that fails open on any path.
- `SECURITY DEFINER` RPCs that take another user's id, or that are left executable by `PUBLIC`.
- Paid calls with no log (transcribe-audio).
- Copies of the rate in code.
- Rewriting history.
- A 402 with no way forward.
- Sending provider USD to the browser.

## 7. Decisions the owner needs to make

These shape the spec; none can be inferred from the code.

1. **Value of a credit** in rupees, and the **markup** over provider cost.
   - TenderBase uses ₹5 per credit with no markup.
   - With no markup, payment fees and infrastructure are paid out of plan revenue.
2. **Monthly credits per plan**: Free, Plus ₹399, Pro ₹999, Max ₹9,999.
3. **Carry-forward.**
   - The published copy says unused credits carry forward, and TenderBase caps rollover at 10%.
   - The rule is needed for: all credits or a cap; any expiry; and what happens on downgrade or lapse.
4. **Stopped and failed turns.** Charge the spend that has already happened (recommended), or absorb it.
5. **Running out mid-turn.**
   - Either let the turn finish and carry a small negative balance into the next grant (recommended, bounded by the reservation),
   - or cut the answer off.
6. **Top-up packs.** Can users buy credits outside a plan? This needs one-off Razorpay orders.
7. **Which features spend credits.** Examples: desk briefs, dictation, web search. And which are free to the user.

## Related

- [Web search reference review](2026-10-13-web-search.md)
- [TenderBase reference patterns (2026-09-20)](2026-09-20-tenderbase-reference-patterns.md)
- [ADR 0002: OpenRouter gateway](../decisions/0002-openrouter-gateway-and-embedding-baseline.md)
- [INR billing spec](../specs/2026-10-12-inr-billing.md)
