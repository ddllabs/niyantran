# Purchased plan display execution plan

> **Status: Living.** Sequential, no delegation. See ../specs/2026-10-20-billing-plan-period-display.md.

1. Inspect catalogue, period/capture/credit rules; lock owned JSON interface. New read RPC returns only id, purchaseId, plan, startsAt, endsAt, credits, status, invoiceId for fulfilled active/scheduled unexpired periods. No financial writes.
2. Add causal SQL/API/client/UI tests before implementation. Implement service-only RPC, authenticated GET /api/billing/plan-periods, client read, isolated component under current plan. Read errors never imply no future purchase. Refresh through existing revision; keyed user instance prevents account crossover.
3. Exercise catalogue and disposable SQL matrix: every upgrade/downgrade pair, renewal, every pack on all four plans, rollover/denomination/expiry and no early future allowance. Preserve financial semantics.
4. Run focused and full required verification, browser fixture, review diff/security. Prepare exact read-only migration and request shared-NTER approval only after reviewable local verification.
5. After approval apply exact migration with readback and financial fingerprints. Push only task/razorpay-plan, verify exact Preview SHA/config/CI and unchanged Production. Record evidence here and O6 tracker. Guide owner through Test top-up then plan lifecycle; do not claim payment acceptance before reconciliation.

## Local execution — 2026-10-20 IST

Implemented service-only STABLE read RPC billing_plan_periods; endpoint accepts
only the verified bearer buyer and configured merchant/mode, ignoring URL scope
claims. Reads canonical fulfilled periods joined to invoices; filters cancelled,
superseded, expired and unfulfilled periods. Dates/status/allowance come from
stored periods, not inferred invoice dates. No entitlement refresh or financial
DML in this RPC. No fulfilment engine or commercial quantity/price changes.

UI shows active/scheduled purchased periods, dates, allowance and invoice link.
Scheduled allowance explicitly excluded from current balance until its start.
Account-keyed component and effect cleanup prevent cross-account/late-response
updates; existing revision refresh reloads periods after payment/status refresh.
Loading, empty and read-error states are distinct. Existing audit history intact.

Causal API/client tests:4 fail before implementation, then pass. UI omission:
4 fail when the component returns null; restored component passes. Disposable SQL
fails without the projection RPC, passes with it; vacuity check also passes.
Matrix executes all9 paid-to-paid transitions (3 upgrades/3 downgrades/3 renewals),
initial paid purchases, all5 packs on Free/Plus/Pro/Max. Exact stored allowances,
one-paisa denomination, current vs deferred model access, no early future grant,
unchanged topups/12-month expiry, capture replay and10% natural-expiry rollover
verified. Fixture explicitly moves prior purchase starts1 second back because
Postgres now() is frozen across its enclosing synthetic transaction. No hosted
synthetic data or provider orders/payments.

Focused5 files148 tests pass. Full407 files6402 app tests pass; Deno1172 pass.
Lint/build/bundle/router and whitespace pass. Initial JS180807 gzip bytes;
no chunk advisory. Full SQL48 fixtures pass, including existing capture/retry concurrency and vacuity checks. New fixture final strengthened
visibility/inactive-buyer checks pass independently. Browser real React/CSS with
synthetic disconnected boundary confirms desktop1280 and mobile320 wrapping,
active Pro + future Plus dates/allowances/invoice links, and manual refresh.
Screenshots /private/tmp/billing-plan-periods-desktop.png and mobile.png.
Temporary browser tab and fixture server closed. No real payment acceptance
claimed. Official Supabase function documentation reviewed:
https://supabase.com/docs/guides/database/functions . Changelog index fetched;
no new API/library feature introduced.

Owner explicitly approved exact shared migration20261019194527 after the
Production boundary clarification. SHA256
2a208f67f41c1ec06208cadcd90760c4cf19885a610deb1818124e0b9b4376dd.
Pre-activation financial fingerprint matches prior release:7 attempts,0 payments/
events/adjustments/periods/invoices; wallets/lots/ledger unchanged. No existing
projection function to overwrite. Production baseline remains dpl_CmCWdRkJMWcskCJqPpABbCdqx7UY,
4a0c981, protection all_except_custom_domains. Security advisor baseline:
27 INFO rls_enabled_no_policy and16 WARN authenticated_security_definer_function_executable;
these are pre-existing; the new RPC is revoked from customers.


## Approved shared activation

Applied exact approved migration after all local gates passed. Hosted history
20261019195351_billing_plan_period_display; canonical function MD5
9c8936a519ecb720d7cdc83c4a0e677a equals the tested local definition. STABLE,
empty search_path and service-only execution verified; anon/authenticated denied.
Real owned Test RPC returns[] (no captured Test plan yet), successfully. Full
before/after financial fingerprints identical across orders/payments/events/
adjustments/periods/invoices/wallets/lots/ledger. Security advisor counts unchanged
from baseline. The approved shared read function is the only hosted mutation.

## Publication boundary and owner rehearsal

Publish only task/razorpay-plan to its existing restricted Test alias. Verify
exact source SHA, READY deployment, auth/method guards, Test configuration and
unchanged Production deployment/protection/disabled billing. Remote CI results
and final deployment identity are reported in the supervising chat after push;
this record contains the pre-publication local and shared SQL acceptance evidence.

Next owner sequence:20,000-credit Test topup, reconcile captured payment/webhook/
invoice and exact credit delta; buy Plus then upgrade to Pro to exercise paid
upgrade; buy queued Plus to exercise downgrade. Each step is reconciled before
the next. All captures remain Test-mode and owner-operated. Never advance hosted
clock or mint future credits to simulate expiry. Future activation, every pack
and all plan-pair accounting are already exercised in disposable SQL. Merchant
readiness, Live keys, live acceptance and other O6 launch gates remain open.


## Owner Test capture reconciliation — 2026-10-20 IST

Read-only investigation after owner-operated payments. Actual IAB screen shows
Pro active through20 Nov2026 and5,66,461 rounded credits. Database verifies:
- topup-500000, ₹10,499, order12a5a5ef-b82b-49c7-acd5-7ad6390bf4bd,
  captured pay_TptSFyyr9aGl2D, fulfilled, invoice NIY/2627/00001;
- plan-pro, ₹999, order35fd134d-a856-4fde-9dbe-8bfd173ca038,
  captured pay_TptT4RvM8aYpY9, fulfilled, invoice NIY/2627/00002.
Each has exactly1 payment,1 invoice,1 lot and1 grant ledger entry. Quantities
500000 and65000 respectively. Seller name/address/support match approved stored
snapshots. Pro period20Oct01:40:12 IST to20Nov01:40:12 IST; topup expiry
20Oct2027. Wallet566460.511 =500000+65000+1460.511 signup; debt0. Monthly
usage0 since activation is correct; earlier usage belongs to the Free period.
No confirmed ₹499 purchase appears in this account's app records; its old
20k-credit attempts remain unconfirmed. No duplicate fulfilment observed.

Webhook acceptance FAILS: verified Test inbox0 events. Vercel exact Test
deployment dpl_3ZmyJcPLw9LrCmXH651ANDqa3KX1 shows42 webhook POSTs all400
between20:09:13 and20:15:20 UTC19Oct (01:39:13–01:45:20 IST20Oct), WAF allow.
No webhook runtime messages. This is receipt rejection before inbox persistence,
not a browser callback/payment grant failure. Unsigned diagnostic returns400
Invalid webhook signature, proving raw bytes reach the signature check for that
probe only; it does NOT prove the cause of signed Razorpay rejection. Dashboard
error text requested from owner because Arc exposes no webpage content even
though navigation works. Do not diagnose secret mismatch without that evidence.
No replay, setting change, provider action, recovery invocation or payment by
agent. Clicking Open invoice in IAB produced no new browser tab; database invoice
verification passed, rendered invoice viewing remains unverified in that browser.

UI review: correct quantities and expiries but thin hierarchy, duplicate current
plan/invoice/history presentation, long visible UUIDs, small period bar lacking a
legend, prominent admin operations and no obvious Test context. Proposed polish:
compact plan/balance summary, separate monthly vs purchased-credit breakdown,
combined transaction/invoice rows, details disclosure for UUIDs, Test badge,
admin tools outside ordinary purchase hierarchy. No UI code edited. Existing
shared account means Test benefits also affect this account on Production; Test
keys do not isolate its wallet or invoice counter. Production web/config and
Live keys unchanged. Screenshot /private/tmp/billing-owner-test-reconciliation.png.

Next: resolve signed webhook400 before calling external acceptance complete.
Account already Pro: Plus purchase is now a queued downgrade, not an upgrade.
To rehearse paid upgrade use Pro->Max before queuing any lower period; or use a
separately allowlisted test buyer for Free->Plus->Pro. No clock/data edits to
force next-cycle activation. All pair arithmetic remains covered by local SQL.
