# Billing cycle changes

> **Status: Normative.** Owner approved 2026-10-20: prorated upgrades, free downgrade scheduling, manual renewal, unchanged 10% rollover, Test Preview publication, cleanup of named owner's Test purchases. Supersedes prepaid-change semantics only for the new contract.

## Outcome and scope
One active paid entitlement per cycle. Price and incremental credits use the same remaining-time fraction of the original cycle. Upgrade keeps cycle end and unspent existing lots. No full allowance reset. Downgrade is an unpaid, replaceable next-plan instruction, never an order. Manual renewal is an explicit next-month purchase, offered within seven days of expiry; at most one paid future renewal. Expiry without payment returns effective access to Free. Top-ups remain fixed packs, plan-independent, valid 12 months. Existing 10% natural-expiry rollover remains.

## Contract
Database calculates quotes from authenticated buyer's current period, catalogue and clock. Quote persists for ten minutes (never beyond current expiry); captures after expiry/stale plan go to review, never silently recalculate price. Amount rounds to paise; incremental credits round to four decimals using the identical fraction. Orders bind quote identity and request identity, buyer/account/mode and grant version. Minimum provider amount is checked before creating an order; very late tiny upgrades direct user to choose a plan after expiry. Separate downgrade preference changes cannot mint credits or create payments/invoices. A paid renewal locks its purchased next plan; change requires support rather than silent replacement. New upgrade requires no already-paid future period. Upgrade explicitly cancels any unpaid next-plan preference; review communicates this.

## Architecture
New service-only RPCs and private tables; existing billing RPCs/triggers are not replaced. New snapshot contract routes capture to new RPC; legacy capture stays available for old orders. New contract starts/renewals retain existing period/grant engine; upgrade creates a linked revision of the active period with the original dates and cumulative allowance, supersedes the previous revision without closing its credit lots, and pre-mints only the incremental allowance under its canonical source key. The existing grant refresh therefore cannot mint it again. Legacy source keys preserve existing lots and rollover. Quote/order/period links preserve invoice provenance.

## Acceptance
All paid-plan upgrade pairs at cycle start/middle/end; exact price/credit deltas; repeated upgrades; usage/topup preservation; same-cycle date; quote expiry/stale/concurrent capture; idempotent orders/events/capture; free schedule create/replace/cancel and Free selection; no charge/credits before paid renewal; expiry/manual renewal; seven-day renewal limit and no stacked renewals; 10% rollover, no rollover-of-rollover; account/mode/role isolation. UI displays authoritative amount/dates/credits, unpaid preference and renewal requirement. No optimistic plan grants.

## Boundaries
No main push, Production deployment/settings, Live keys, corpus or unrelated users. Shared NTER additive schema activation and named Test account cleanup must be bounded and independently verified. Cleanup deletes only frozen Test order graph, preserves signup/usage, reconciles wallet, keeps invoice sequence monotonic, retains provider-side records. Delayed deleted Test events must not recreate grants.

## Verification
Vitest focused and full: `npm test`; `npm run lint`; `npm run build`; `npm run check:bundle`; router import; `deno test -A --config supabase/functions/deno.json supabase/functions`; SQL runner plus concurrency and vacuity checks. Real browser review/start/schedule/renew controls without agent payment. Owner executes genuine Test payment acceptance.

## Reference
Razorpay's [Orders contract](https://github.com/razorpay/markdown-docs/blob/master/api/orders/create.md) requires integer subunits and an INR1 minimum. New Test plan orders below100paise are rejected with explicit expiry guidance. Supabase [function permissions](https://supabase.com/docs/guides/database/functions) inform explicit privilege revocation/search paths. No new SDK/dependency is added.
