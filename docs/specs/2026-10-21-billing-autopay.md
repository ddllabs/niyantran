# AutoPay and renewal experience

> **Status: Living.** Implementation and Test Preview release authorized2026-10-21. Replaces the manual-only direction
> for future paid purchases once implemented and separately released. The manual-first
> priority below governs this release; deferred AutoPay is not enabled. Production checkout and Live
> keys remain unchanged; shared database activation requires its concrete scope.

## Current release priority — owner decision2026-10-21

Manual billing plus48-hour access-only expiry grace is the first release target.
AutoPay integration, recurring collection and AutoPay notices are deferred; their
contract below is retained for a later release and does not gate manual launch.
Both standalone provider Test mandates succeeded (card and UPI); subsequent
collection and Live capability are still unverified. Settings' UPI-disabled copy
must not erase actual successful Test enrollment evidence.

Grace is for an existing paid period expiring without a confirmed next paid
period. A failed initial purchase or mid-cycle upgrade creates no new grace;
failed upgrades leave the existing paid plan intact. Approved scope: retain the
expiring plan's model eligibility until the original paid-through timestamp plus
48 elapsed hours; monthly credits expire normally, valid purchased top-ups and
welcome credits remain usable, and every AI request still needs sufficient funds.
No new credits, rollover, automatic debit or repeated extension. A confirmed paid
next period takes precedence. Explicit Free selection is honoured at the
paid end rather than overridden with grace; Free chosen during grace applies immediately.

Manual reminders:7 days and2 days before expiry, prominent expired/grace notice
with exact deadline and Renew action, and Free status after deadline. Do not call
an absent manual renewal a bounced or failed automatic debit. Show an actual
payment failure only with evidence of a failed attempt. No custom email/SMS in
this scope. Avoid repeated toasts and navigation-dependent access enforcement.

The owner-approved renewal-during-grace contract
retains the original monthly anchor for continuous renewal;
late payment after grace follows the new-purchase rule. Do not silently change
existing quote/capture dates, charges or grant quantities while adding access.
Inventory public/client, server and Edge authorization consumers first. Grace
must use a distinct effective-access deadline, never extend financial period or
credit-lot expiry dates. Shared NTER activation and Production release each need
their concrete reviewable scope/approval; this planning decision changes neither.

## Authority and current evidence

Owner requests an AutoPay plan and explicitly selects:
- AutoPay required for new paid plans.
- 48-hour payment-failure grace retains paid model eligibility only: no new
  monthly credits, no extension of expired monthly credits, no rollover.

The cycle-v2 implementation is deployed to Razorpay Test Preview at a0ea65f.
It creates one-time orders with daily IST prorated upgrades, free lower-plan
preferences and seven-day manual renewal. Top-ups are one-time orders. Current
webhook processing expects payment/order/refund/dispute events, not subscription
cycles; merely adding subscription event subscriptions will not implement AutoPay.
Existing recovery is admin-triggered and bounded; vercel.json has no billing cron.
Entitlement expiry currently returns Free, so changing browser messaging alone
cannot implement grace. Billing suppresses the shared renewal status message;
the current account card shows dates but lacks a prominent renewal reminder.

Observed rehearsal2026-10-21: Plus399 captured, top-up499 captured and Pro upgrade600
captured; one invoice per payment, correct grants and processed events. Free
downgrade preference save/cancel preserves Pro and finances. Failed-payment,
browser-close recovery and refund rehearsal remain unfinished under O6.
The earlier welcome-balance change was888.706 credits of three AI usage charges,
not a billing debit. Do not use stale displayed balances as new test baselines.

## Proposed product contract

Prices/allowances remain Plus399/20,000, Pro999/65,000, Max9,999/750,000 credits
per monthly period. Require explicit recurring authorization in provider Checkout;
describe amount, frequency, first charge, next date and cancellation before consent.
No pre-existing customer is silently enrolled. Honour existing paid/future periods;
recommended transition requires consent for the next new paid month, including
legacy renewal. Keep old order recovery operational. Free and one-time top-ups
do not require a mandate; no automatic top-up or usage-based debit in this release.

Razorpay Subscriptions is the initial provider choice; it fits fixed monthly
pricing. The merchant Test settings show Cards enabled and UPI AutoPay not enabled.
Card authorization/renewal and UPI access/flow remain unverified.
Do not advertise a payment method before its merchant capability and Test flow
pass. No guarantee that every bank/card/app supports a mandate.

### User journeys

| Event | Proposed effect |
| --- | --- |
| Free chooses paid plan | Review recurring terms, authorize mandate, verify full first-period payment; only then paid entitlement + one allowance + paid invoice. |
| Authorization-only token payment | Record authorization separately; never treat a small/refunded authentication payment as plan revenue or grant credits. |
| Existing manual paid user enables AutoPay | Preserve current period; schedule first full collection at its end, no second full charge now. Account for existing prepaid future periods. |
| Renewal succeeds | One payment settles one renewal cycle; one monthly lot/period/invoice, no rollover; browser need not be open. |
| Higher plan mid-cycle | Retain current daily price/credit delta and cycle end; explicitly pay the upgrade delta once; arrange higher next-cycle AutoPay with confirmed authorization. No second provider proration. |
| Lower plan | Nothing charged today; current entitlement/credits continue. Confirm lower next collection, not merely a local preference. Surface reauthorization if required. |
| Free / turn off AutoPay | Confirm cancellation of future provider collections; retain paid access to expiry. No failure grace for intentional non-renewal. |
| First payment fails or mandate incomplete | Remain Free; no paid grace or paid allocation before a first successful period. |
| Renewal fails / unresolved collection | Qualified existing subscriber enters at most48 hours of access-only grace from original paid expiry; no new credits, monthly lots expire normally. |
| Grace ends unpaid | Effective plan Free. Valid top-up/welcome credits survive with Free model eligibility. |
| Retry later succeeds | Recommended: settle the original renewal cycle and restore paid access only for its remaining window, with its one allocation. Keep original anchor. No retrospective usage grant, no extra cycle from delivery time. |
| Update payment method / revoke mandate externally | Reconcile authoritative provider state; clearly show whether future collections remain authorized. No grant on state change alone. |
| Top-up during grace | Add purchased credits once; does not cure unpaid subscription or extend grace; available model access follows effective entitlement. |

Grace applies to a previously paid subscriber expected to renew with AutoPay,
not Free signups, a cancelled mandate or repeated UI retry. Deadline is the paid
period end+48 hours (elapsed time), displayed in Asia/Kolkata; duplicate events
never restart it. Missing/late webhook is reconciliation work, not proof of failure
or permission for indefinite access. If grace user has no unexpired credits, AI
remains unavailable despite retained model eligibility. All AI calls still reserve
and debit canonical wallet credits; no browser-only entitlement exception.

### Notifications

Persistent account/billing notice at7 days before expected debit: plan, amount,
date and manage/cancel action. At2 days, emphasize next collection; coordinate with
Razorpay notices rather than assuming our banner satisfies provider requirements.
Failure: payment action and absolute grace deadline. Grace end: Free status and
restore access action. Pending payment: confirming/reconciling, not a second Pay
button. Success/cancellation: one short toast plus persistent state. Dismissal of
an informational reminder must not hide an unresolved failed-payment warning.
No scrolling ticker; no repeating toast on each navigation. Derive notice state
centrally and show it consistently in billing, profile and credit pages. Own custom
email/SMS delivery is excluded from initial scope; verify provider notifications.

## Provider constraints and design gates

1. UPI subscription updates: official update API documents UPI update rejection.
   Prove the supported replacement-mandate/cancellation handoff in Test before
   promising seamless UPI upgrades/downgrades. At most one expected collector per
   account/cycle. Existing authorization must not silently approve a higher amount.
   If provider constraints prevent a safe handoff, stop and revisit the design;
   do not ship a card-only assumption as UPI support.
2. Provider retries can continue throughT+3 for cards/UPI, longer than our48-hour
   access grace. Recommended: keep provider retries and disclose them; after48h
   access can be Free while collection remains pending. A later captured charge
   settles the original advertised cycle. User cancellation must reconcile any
   in-flight collection; never promise cancellation can reverse a captured debit.
3. Do not expose an independent one-time renewal Pay button while an AutoPay
   collection is pending. Prefer provider-supported payment-method/recovery flows.
   One-time fallback would need confirmed retry suppression and double-capture
   compensation; exclude it from v1 until proven.
4. Provider subscription state is not paid entitlement. An active/authenticated
   mandate, issued invoice or browser success is insufficient evidence of a full
   captured payment for this buyer/merchant/mode/cycle/amount/currency.
5. Mid-cycle upgrades are two systems, not one transaction. Persist intent and
   compensating recovery stages before provider mutations. Inject failure between
   mandate change, delta payment and local fulfilment. Never silently leave two
   collectors, lose a paid upgrade, or claim next-price synchronization succeeded.
6. Freeze a provider-verified first-charge/authorization recipe: avoid both an
   upfront full amount and an immediate recurring full charge. Subscription finite
   total_count/end behaviour and renewal consent need an explicit UI contract.

## Backend proposal (names provisional, interfaces fixed before coding)

Keep public.credit_wallets/credit_lots/credit_ledger, public.invoices and private
billing_plan_periods as canonical finance. Extend existing service-only billing
boundaries; avoid a second wallet or duplicate invoice system. Proposed private
RLS tables: billing_subscription_catalog (versioned plan mapping by merchant/mode),
billing_subscriptions (buyer/provider binding, consent, provider and local state),
billing_subscription_cycles (unique provider invoice and subscription/window,
settlement/grace/collection state), billing_subscription_operations (durable intent,
idempotency, leases, unknown-result recovery and compensation).

Every mutation is buyer-scoped and merchant/mode-scoped; unique constraints enforce
one expected collector/cycle and one payment financial effect across order and
subscription webhook paths. Different successful payments for one cycle enter
overpayment review, never grant twice. Provider-issued unpaid invoices are payment
requests; internal invoices are issued only after captured fulfilment. Show one
customer-facing paid receipt with provider reference, not duplicate paid rows.

Draft API: GET /api/billing/subscription-state; POST subscription-start,
subscription-verify, subscription-change, subscription-cancel and
subscription-payment-method. Preserve current top-up and owned recovery routes.
Client provides only plan/intent/idempotency/expected-state version; amount,
buyer, dates, mandate binding and mode come from trusted server state. Responses
separate providerState, collectionState, effectivePlan, paidThrough, graceUntil,
nextCollection and requiredAction. Never return raw provider payloads or secrets.
Same key+different body fails; unknown POST outcome is recovered by exact identity,
never blindly repeated. Provider idempotency support must be proven per operation.

Extend original-byte HMAC verification and durable inbox with a minimal whitelist
for subscription/invoice/payment identity, and dispatch by event kind. Fetch the
authoritative subscription/invoice/payment graph; grant through atomic SQL once.
Duplicate/out-of-order events cannot overwrite newer confirmed cancellation or
regrant a cycle. Handle refunds/disputes/reversals without erasing paid history.

Add a bounded authenticated server worker with leases/backoff and alerts for
unresolved subscription operations/events. Grace deadlines must be enforced by
server entitlement reads/AI authorization even if the worker is down. Never give
cron access by exposing the current admin route without authentication. Exact
scheduled platform/config is selected during implementation, not assumed present.

## Acceptance and release boundary

Disposable SQL + mocked-provider causal tests first; real Test mandate lifecycle
after explicit provider-operation approval. Both card and UPI workflows must pass,
including reauthorization/refusal paths. Verify API→provider→webhook→DB→UI for
each financial scenario. Time-travel locally forT-7,T-2,T,T+48h,T+3 and Jan31 /
Feb / leap-year anchors; do not wait a month or mutate hosted dates as a fixture.
Test invoice/payment duplicate delivery, concurrent manual/AutoPay renewal attempts,
worker crash after provider success, wrong buyer/merchant/mode, unknown POST result,
mandate revocation, method change, cancelled/unpaid expiry, late capture, refund and
UPI replacement failure. Migration authorization/rollback are tested locally.

Owner subsequently authorizes implementation, card/UPI Test verification and
Test Preview deployment. Merchant access requests/terms and shared Production
effects require separate concrete authority. Implementation remains behind Test
and pilot gates. Shared NTER migration
requires its concrete narrow approval; Production/Live activation separate. New
checkout kill switch must not disable already authorized recurring debits silently:
document independent enrollment/recurring-collection/recovery controls and how to
stop future provider collections. Apply mandatory CI/exact-SHA alias checks.

## Decisions still to verify / approve before implementation

- Merchant subscription/Card/UPI capability; UPI replacement and scheduling proof.
- Original-cycle settlement on late retries (recommended), including captures after
  the whole window ended; such captures enter review rather than granting expired
  or current-cycle benefits incorrectly.
- Exact mandate cancellation cutoff/reauthorization flow and finite duration.
- Legacy users require AutoPay for next new renewal (recommended transition).
- App access-only48h grace coexists with disclosedT+3 provider retries; no promise
  that all provider charging stops at the grace deadline.

## Primary sources checked2026-10-21

- https://razorpay.com/docs/payments/subscriptions/
- https://razorpay.com/docs/payments/subscriptions/supported-payment-methods
- https://razorpay.com/docs/api/payments/subscriptions/update-subscription
- https://razorpay.com/docs/api/payments/subscriptions/create-subscription
- https://razorpay.com/docs/api/payments/subscriptions/cancel-subscription
- https://razorpay.com/docs/payments/subscriptions/payment-retries
- https://razorpay.com/docs/payments/subscriptions/notifications
- https://razorpay.com/docs/payments/subscriptions/subscribe-to-webhooks

Provider capabilities above are documentation evidence, not a successful merchant
Test execution. Current behaviour is code inspection plus the recorded rehearsal.
