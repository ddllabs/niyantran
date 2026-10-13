# ADR 0011: One credit wallet per user, on an append-only ledger

> **Status: Normative.** Owner decisions of 2026-10-14 (F111). Spec:
> [AI credits](../specs/2026-10-14-ai-credits.md). Evidence:
> [TenderBase review](../research/2026-10-14-ai-credits-reference-review.md).

## Context

Niyantran sells plans priced on AI credits, but nothing meters or limits AI
use. Every AI call is already logged with its provider cost
(`model_call_logs.cost_usd`, ADR 0002).

TenderBase, built on the same stack, charges organisations through a
log-then-trigger ledger. Its pattern is sound. Its implementation has defects
that lose money or lock customers out:

- **Partial billing.** Only the last round of a turn is billed.
- **Broken renewal.** Renewal inserts a negative grant that a check
  constraint forbids.
- **Rewritten history.** The "frozen" ledger was rewritten twice.
- **Overdraw.** Concurrent turns overdraw because the gate reserves nothing.

The ledger is expensive to change once it holds real balances. Its shape is
therefore recorded here.

## Decision

1. **The wallet belongs to a user.** Niyantran's organisations are dormant.
   Every credit table is keyed by `user_id`. An organisation wallet can be
   added later as a second owner type without reshaping the entries.
2. **Credits are worth a fixed amount of AI cost:** 1 credit = ₹0.10 of
   provider cost at a single database rate (₹95 per USD).
   - Margin comes from how many credits each plan grants, not from a markup
     on each charge.
   - Users see credits with a rupee hint, never dollars.
3. **Credits arrive in lots** (signup, monthly, rollover, top-up,
   adjustment), each with its own expiry. Spending draws the lot that expires
   first.
4. **The ledger is append-only.**
   - Every change is a signed entry: grant, charge, expiry, adjustment.
   - Nothing is updated or deleted, and a correction is a new entry. This is
     enforced by privilege: no role has UPDATE or DELETE on the ledger.
   - The one exception is deleting the account. Its credit rows cascade with
     it, honouring erasure requests and "unused credits lapse on closure".
   - Each charge stores the rate it used.
   - Each charged log row is recorded once, so a late or repeated settlement
     can never charge a row twice.
5. **Debt lives on the wallet, never in a lot.**
   - A charge larger than the remaining lots leaves the balance negative.
   - The next lot repays the debt before it is usable.
   - No lot and no grant is ever negative.
6. **A turn reserves before it runs and settles after.**
   - A hold under a per-user row lock keeps concurrent turns from spending the
     same credits. Holds are keyed by the turn.
   - Settlement reads the turn's logged cost and its final status, so the
     database decides what is charged.
   - Every hold also gets one sweep after it expires, which catches log rows
     that committed late.
7. **A plan's credits follow its payments.** Each paid month is exactly one
   lot. Manual grants are cut into monthly lots. Nothing is anchored to a
   calendar date that could drift or double up.
8. **The database is the only writer and the only source of rates.**
   - Writing functions are `SECURITY DEFINER`, executable by `service_role`
     only.
   - Users read their credits through one function scoped to `auth.uid()`.
   - No rate or allowance is copied into code.

## Consequences

- **Correctness lives in SQL.** Billing correctness is proved by SQL fixtures
  (ledger sums to balance, holds, debt, expiry, privileges), not by Edge code.
- **Some unpaid debt is accepted.** A Free user who never pays leaves at most
  one answer's cost unpaid. The hold bounds this to roughly one answer.
- **Lazy lot handling.** Lots are minted and expired lazily, when a user
  reserves or reads, so there is no renewal cron to fail for everyone at once.
- **Organisations later** need a second owner column and a policy for
  pooling. That is a migration, not a redesign.
- **Rate changes** apply to later charges only.

## Rejected

- **TenderBase's grants, charges and recomputed rollup.** The balance can
  drift from its parts, and the design needs negative grants.
- **A markup on each charge.** It hides the margin in every entry. Per-plan
  allowances say the same thing once.
- **Cutting an answer off when credits run out.** The owner chose to let it
  finish and carry the debt.
