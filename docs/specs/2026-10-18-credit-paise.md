# One-paisa credits and payment prerequisites

> **Status: Living (draft).** Owner requested 2026-10-18. The new credit value
> and top-up eligibility are decided; migration design and payment prices below
> are proposals. No production conversion has run.

## Objective and decisions

One credit represents INR 0.01 of provider AI cost, replacing INR 0.10. Treat
this as a unit redenomination: preserve every user's economic balance, debt,
plan benefit, duration and past consumption. It is not a tenfold price cut or
allowance reduction. Free and paid accounts may buy top-ups; buying credits
does not grant a paid model entitlement. Plans remain monthly INR 399 / 999 /
9,999, no automatic renewal, no GST under the current unregistered assumption.

| Quantity | Before | After |
|---|---:|---:|
| INR per credit | 0.10 | 0.01 |
| Free signup allowance | 1,000 | 10,000 |
| Plus monthly allowance | 2,000 | 20,000 |
| Pro monthly allowance | 6,500 | 65,000 |
| Max monthly allowance | 75,000 | 750,000 |
| Maximum reservation | 300 | 3,000 |
| Fixed low-balance warning without allowance | 200 | 2,000 |
| Administrator adjustment ceiling | 1,000,000 | 10,000,000 |

USD/INR stays 95; rollover stays 10%; hold validity stays five minutes; signup
validity stays 30 days; top-ups stay valid 12 months. Existing expiry dates,
plan periods, provider costs, tokens, payment/invoice amounts and model-access
rules do not change. Credits may remain fractional to four decimal places;
one-paisa unit value does not imply whole-credit rounding.

## Current observed state

Read-only NTER inspection at 2026-10-17 19:30 UTC (October 18 01:00 IST):
three wallets, three lots, twenty ledger entries, seventeen lot draws,
ninety-two charged model-call mappings and eighteen holds. Seventeen charge
entries carry INR-per-credit 0.10 and USD/INR 95. No active unexpired holds or
running unexpired answers at that instant. Recheck at execution; these counts
are evidence, not a hard-coded migration predicate. Prior read-only checks
found both wallet/ledger and wallet/lots-minus-debt reconciled.

Existing credit ledger entries are append-only (ADR 0011). A blanket update
of historical credits/rates would destroy the original charge evidence.
Changing settings alone would devalue existing balances and misreport mixed
history. Neither is acceptable.

## Capability boundaries and dependency order

| Module | Responsibility | Depends on |
|---|---|---|
| credit-unit | Unit metadata, audit-preserving conversion and reconciliation | Existing credit accounting |
| credit-readers | Uniform current-unit usage, estimates, settlement/retry responses | credit-unit contract |
| credit-presentation | Copy, thresholds, administrator amounts and tests | credit-unit/readers contracts |
| payment-fulfilment | Captured plans/top-ups, durable order/event processing, invoices and recovery | Credit cutover, reviewed payment decisions, M1/M2 closure |
| payment-operations | Refund reconciliation, provider test acceptance and activation | payment-fulfilment, legal/account readiness |

This spec fixes the credit change; payment modules remain a capability map for
separate specs. The payment processor MCP is an operator tool, not an
application fulfilment dependency. Corpus ingestion, retrieval expansion,
organisation billing and mandates are excluded.

## Accounting contract

Preserve historical ledger entries and their frozen charge rates byte-for-byte.
Introduce explicit conversion records/entries, with unit and source-lot lineage
that permits reconstruction. Conversion is neither income nor AI usage.
Keep old non-charge entry denomination in a separate private mapping of
pre-cutover ledger IDs to the old unit, captured in the transaction; do not
add historical metadata by updating original ledger rows. New writes identify
the current epoch. Conversion entries carry an explicit operation type and
old/new snapshot; they are accounting bridge entries, not provider spending.
The wallet remains the raw ledger sum including those bridge entries; only
usage/estimate charge projections normalize old units. Do not normalize every
ledger entry and sum it again as a wallet, which would double-convert the bridge.

Recommended prototype, subject to fixture proof:

1. Refresh due accounting at the old rate under exclusive credit-write control;
   reconcile and snapshot the inventoried amounts.
2. For every open old lot with positive remainder R (including future-start
   lots), append an explicit conversion debit -R,
   close that lot without natural-expiry rollover, and create a replacement
   of the same kind/start/expiry/plan holding 10R with an auditable grant.
   Retain original lot, source key, historical draws and ledger entries.
3. For old debt D, append an explicit conversion debit -9D and set debt to 10D.
4. Change rate, allowances and reservation settings in the same transaction;
   persist a deterministic conversion identity and old/new lot mapping.
5. Assert new balance = 10 * old balance, new debt = 10 * old debt,
   balance = ledger sum, and balance = all open lot remainders minus debt. Check numeric
   overflow before modifying anything. Any failed assertion aborts everything.

The prototype must prove per-lot conservation and debt conservation as well as
the wallet equations; extending a ledger kind must update all kind constraints
and reconciliation queries, not bypass them. Do not disguise conversion debits
as natural expiry or trigger a rollover. Do not silently discard zero-remainder
lots, expired unswept lots, a negative balance or a future paid renewal.

Replacement lineage needs explicit handling in signup eligibility, Free cycle
allowance/start/end, monthly mint deduplication and later rollover. In particular,
the replacement's grant is 10R, not necessarily the original signup allowance;
the screen must still report the original economic allowance and normalized
consumption. Keep existing source keys to suppress duplicate lazy grants.
For legacy Free cycles, use original granted G * 10 and original start/expiry
through lineage, for both partially spent and fully spent signup lots. A
zero-remainder lot need not mint a positive replacement, but its cycle lineage
must remain available. New signups report their native new-unit grant.
Use deterministic replacement keys and a persistent conversion marker to
reject a repeated conversion without changing anything.

Historical charge reporting converts each already-rounded charge by
its recorded INR-per-credit / current INR-per-credit. At this cutover old
charges display at 10x and new charges at 1x. Do not recompute settled history
from USD costs, which would change old rounding. Apply conversion to
my_credits used/recent values, my_conversation_credits, all my_usage reports,
model_credit_estimates measured samples and settlement totals for replayed
turns. List-price estimates use the new live setting. Counts and tokens stay
unchanged. A turn containing charge entries from both units must aggregate
correctly. Conversion entries must not inflate usage or model estimates.

Administrator request-id retries require a unit-aware contract: an identical
pre-conversion request must remain exactly-once and return a current-unit
result; reuse with a different payload must reject. The implementation must
not accept a stale browser amount as a new-unit adjustment. Version amount
submissions at the boundary and refuse stale/new mismatches with a reload
instruction. Browser memory caches and already-open tabs must refresh unit
metadata before another amount-bearing action; avoid mixed cached balance and
new charge displays.

Use a stable unit version such as credit-paise-v2 at the API boundary. Inspect
an administrator requestId before enforcing a new version: an identical
previously completed legacy request is compared in its original amount/kind/
reason, never reapplied, and its response amount is normalized to the current
unit. A conflicting payload rejects. An unknown requestId with no version or
the old version rejects before adjustment; new requests require the current
version. Persist unit-aware retry evidence privately for legacy entries and new
requests. Never reinterpret a stale 100-credit submission as 100 new credits.

### Stored conversion inventory

| Object/field | Treatment |
|---|---|
| credit_settings.inr_per_credit | 0.10 -> 0.01 |
| credit_settings.signup_credits / hold_credits | 10x |
| credit_plan_allowances.monthly_credits | 10x |
| credit_wallets.balance / debt | Reconcile and convert through explicit entries/updates |
| Open credit_lots remaining / lineage | Close old, retain original amounts, create mapped positive replacement; retain zero-value cycle lineage |
| credit_holds.credits | Drain active holds; preserve settled historical holds with their epoch, do not treat as active new-unit reservations |
| credit_ledger existing rows, including rates/request IDs | Preserve; private ID/epoch mapping and conversion entries are additive |
| credit_lot_draws / credit_charge_rows | Preserve existing rows and USD costs |
| private.credit_launch_grants / credit_turn_messages | Preserve identity and dates; no denomination amount columns |
| plan_grants / user_profiles / invoices / invoice_counters | No amount, period or entitlement conversion |

Denomination metadata and conversion mapping tables must remain private with
explicit owner-only access, stable identities, constraints and rollback rules.
The local prototype must name final schemas and validate privilege changes.

## Cutover and recovery

Credit writers must participate in a shared cutover barrier before reading
settings, including reserve, settle, my_credits, grants/trigger refresh and
administrator adjustments. reserve/admin currently read settings before the
wallet lock; table locks alone cannot prevent queued stale-rate operations.
Design the barrier and one lock order first, with bounded contention/fail-closed
responses. Do not take wallet locks then wait on a profile lock.

Deploy compatible readers/writers first. A bounded credit-only write pause
must drain active turns, holds, settlement jobs and late cost writes; ordinary
feed reads/refreshes and corpus jobs are not part of the pause. Do not kill a
user's answer or settle it against a half-converted wallet. Recheck actual
activity immediately before the transaction. Resume only after reconciliation
and read-only smoke checks. Specify this operational pause in the release
packet; this draft does not silently alter production flags.

Transactional failure rolls back. After new-unit writes resume, a blind divide
by ten is unsafe: four-decimal new charges may require five decimals in old
units. Recovery is a tested forward correction preserving audit history;
test an inverse only while no post-cutover activity exists. An ordinary client
rollback must keep schema/RPC compatibility and the current denomination.

## Payment consequences and decisions still open

Proposed packs preserving the prior suggested economics:

| New credits | Suggested INR price, not approved |
|---:|---:|
| 20,000 | 499 |
| 50,000 | 1,199 |
| 100,000 | 2,299 |
| 200,000 | 4,399 |
| 500,000 | 10,499 |

Top-ups are available to all account plans, including Free. Existing proposed
prices are not final by implication of this conversion. Require a server-owned
versioned catalogue and a stored order snapshot for eventual fulfilment.
No order, capture, refund, webhook registration or payment activation is
authorized merely by installing the MCP.

Remaining owner inputs before live activation: full registered address,
current GST status, intended lawyer review, merchant readiness and final pack
prices. Earlier renewal/rollover/refund-exception/court questions already have
decisions and should be reconciled in living documents, not reopened.

## Acceptance evidence

- Local disposable SQL fixtures prove conservation, append-only old history,
  once-only conversion, fresh installs, old installations, debt/holds/late
  settlement, future renewals, Free signup lineage, rollover and admin retries.
- Each regression fails with its protected defect restored; SQL fixtures fail
  when their migration is omitted (vacuity check). Reports/estimates agree on
  the same new-unit totals, including mixed-era turns and retained rounding.
- Published plans/legal wording, thresholds, caps and display examples use the
  same unit. Existing INR prices and model access remain unchanged.
- Full lint/build/Vitest/Deno/SQL, router import and relevant browser checks;
  no standalone type-check claim. Execution evidence records exact outcomes.
- Inventoried production reconciliation and controlled release occur only after
  verification and applicable release authorization. M1/M2 T15 is not marked
  complete by this work, and payment implementation waits for its closure.

No migration or application code was executed for this draft. Local SQL tests
will require disposable Docker Postgres containers; remote Razorpay MCP does
not require Docker.
