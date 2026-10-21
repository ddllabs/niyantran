# AutoPay implementation plan

> **Status: Living.** Implementation/Test Preview authorized2026-10-21. Owner-authorized scoped delegation. Product/source
> contract: ../specs/2026-10-21-billing-autopay.md. Sole open task tracker:
> open-work.md, O6 AutoPay. Existing manual/v2 records remain intact.

## Priority revision — manual release first2026-10-21

Owner directs manual billing toward Live with48-hour access-only expiry grace;
AutoPay slices below are deferred. Implementation is in progress under O6; no Live activation is authorized.
The user approved preserving the original billing anchor for renewals during grace.

1. **Freeze manual grace/renewal semantics (S).** Read canonical entitlement,
   quote/capture and paid-period behavior; identify all consumers and exact write
   scopes before editing code. Scope: this spec/plan and relevant read-only
   inventory. Resolve continuous renewal anchor during grace and explicit Free
   selection. Acceptance: one timeline forT-7d,T-2d,T,T+48h, payment success and
   failure, with unchanged charge/allocation rules unless specifically approved.
2. **Server-enforced grace (M slices).** Versioned additive SQL + disposable SQL
   fixture first; then server/Edge access consumers and client entitlement adapter
   with focused tests. Freeze the exact migration/RPC interfaces after inventory.
   Likely scopes: src/lib/entitlementStore.js, planEntitlements.js,
   supabase/functions/research-chat/index.ts and their tests; no direct profile
   date extension. Prove grace deadline works even if scheduler/browser is down,
   no first-purchase/failed-upgrade grace, no new or extended credit lots, no reset
   on retries, and authenticated ownership/mode separation. Depends:1.
3. **Manual renewal notices (M).** Scope: BillingWorkspace.jsx/PlanCycleReview.jsx,
   their tests and central credit/account notice module selected by inventory.
   Paid-expiry reminders, truthful payment-failure copy, grace deadline, Renew
   action and Free transition. No AutoPay promise, ticker or outbound messaging.
   Prove no duplicate notices and desktop/mobile/keyboard behavior. Depends:2.
4. **Manual launch acceptance (S).** Execute existing/new focused regression,
   full JS and Deno suites, disposable SQL omission-vacuity/concurrency, lint,
   build, bundle and router import. Rehearse genuine Test purchase, top-up,
   upgrade/downgrade, manual renewal, failed/browser-closed checkout recovery,
   duplicate webhook and refund reconciliation. Time travel only locally.
   Obtain concrete shared-migration approval before activation; Test Preview
   publication follows both required CI jobs on exact SHA. Depends:2–3.
5. **Controlled Live pilot (S).** Produce release evidence and rollback instructions,
   separately authorize Production publication/configuration and scoped Live keys/
   webhook setup, then one owner-authorized real payment with invoice/credit/
   webhook reconciliation before opening checkout publicly. No claim of readiness
   from standalone mandate tests. Depends:4; explicit release authority required.

### Frozen interfaces and assignments

The supervisor owns client entitlement storage/access deadlines, TerminalShell,
server payment routing and their tests. SQL and UI execute concurrently in
supervisor-created managed worktrees, with disjoint scopes. An independent
GPT-6 Astra reviewer has read-only access to all three diffs.

- SQL agent: `supabase/migrations/20261021123000_billing_manual_grace.sql`,
  `supabase/tests/billing_manual_grace.sql`, optional matching concurrency shell
  fixture and `supabase/tests/run.sh` only.
- UI agent: `BillingWorkspace.jsx`, `PlanCycleReview.jsx`, their tests,
  `billingWorkspace.css`, `BillingRenewalNotice.jsx`, `manualRenewalNotice.js`,
  `publicPlans.js` and their tests; optional `PlanChoices` and its tests only.
- SQL exports `my_entitlement_manual()` (own authenticated read),
  `billing_effective_profile_manual(uuid)` (service-only access read), and
  service-only `billing_cycle_v3(text,jsonb)` / `billing_cycle_capture_v3`, and
  authenticated `my_credits_cycle_v3()` for actual purchased allowance.
  Financial period end remains unchanged. New access fields are `access_until`,
  `grace_until`, `in_grace`, `source_period_id`; browser adapters use camelCase.
- A narrow trigger on private.billing_plan_changes preserves an already-effective
  Free instruction across retained old writers. Pre-expiry cancellation and paid
  fulfilment remain allowed. Hosted approval must include this immediate shared effect.
- The resolver is separate from existing global financial entitlement functions.
  Historical cycle-v1/v2 captures remain recoverable. New quotes use cycle-v3.
- During grace, any paid plan is a full-price anchored renewal; explicit Free
  takes effect immediately and cannot be revived by canceling an expired choice.
  No credit expiry/allocation is extended by access grace.

Verification commands below remain applicable. Focused client, server routing,
and Edge access cases have passing execution, including causal RED/GREEN guards.
An open-session boundary test fails with the transition watcher removed and
passes with it restored. Full integration verification and hosted activation
remain pending. Production checkout and Live credentials are unchanged.

## Deferred AutoPay slices and dependencies

1. **Provider feasibility and contract freeze (S).** Verify merchant Cards/UPI
   access, initial charge vs authentication, future starts, finite duration,
   cancellation and replacement mandates. Scope: this spec/plan plus a dated
   provider evidence file under docs/research/. Owner-authorized Test execution is limited to scoped feasibility objects;
   merchant access requests and terms require separate authority. Acceptance:
   demonstrate or explicitly reject UPI plan changes without overlapping debit;
   settle late-payment/legacy transition policy. Depends:none. Gate: do not write
   a financially incomplete integration around unproven UPI handoff assumptions.
2. **Subscription identity and operation safety (M).** Scope: one additive
   migration, supabase/tests/billing_subscriptions.sql, runner, new server
   subscription adapter and focused tests. Private mappings, operation intent,
   unique identity/collector claims, ACLs and mode separation. Acceptance: causal
   RED/GREEN for ownership, duplicate requests, different payload/same key and
   ambiguous provider-create response. Depends:1.
3. **New buyer enrollment (M).** Scope: server/subscriptionService.mjs,
   server/billingApi.mjs, new src/lib/subscriptions.js and tests. Review/authorize
   first-period subscription using provider-verified recipe. Acceptance: consent
   alone grants nothing; confirmed full payment binds buyer/cycle once; browser
   close and stale response remain recoverable. Depends:2.
4. **Recurring settlement (M).** Scope: service/webhook adapter, one settlement
   migration, SQL fixture/runner, focused webhook tests. Map captured recurring
   payment into existing period/ledger/internal invoice atomically. Acceptance:
   one grant/invoice through concurrent invoice/subscription/payment events;
   wrong amount/mode/merchant/buyer fail closed; unpaid invoice and auth token do
   not grant. Depends:3. Checkpoint: enrollment + second cycle green with no UI
   redesign; prove payment/order and subscription paths cannot both fulfil.
5. **Plan changes (M per sub-slice).** First preserve daily upgrade quote/delta
   and synchronize future collector; then lower/Free scheduling and replacement
   authorization. Scope each slice: new subscription service, one private RPC
   migration/fixture and relevant client tests. Acceptance: same anchor/delta,
   free downgrade/cancel, one future collector, replacement failure visible and
   compensable. Fault injection at every provider/DB boundary required. Depends:4.
6. **Access-only grace (M).** Scope: one versioned entitlement SQL migration,
   canonical server/Edge access consumer(s), src/lib/entitlementStore.js plus
   focused fixtures/tests. Audit actual consumer list first. Acceptance: exactly
   paid-end+48h, no credit mint/rollover/expiry extension, no grace for first
   failed signup/intentional cancellation, effective Free at deadline despite
   worker outage; late original-cycle settlement once. Depends:4, policy freeze1.
7. **Automatic reconciliation (M).** Scope: new worker entry/adapter, provider
   operation service, focused tests and reviewed scheduler config. Acceptance:
   leases, bounded batches/backoff, crash recovery, alerts and independent kill
   switches; no extra debit from unknown outcome or manual retry races. Test
   provider retries beyond grace and merchant/provider outage. Depends:4–6.
8. **Customer billing experience (two M slices).** First required consent,
   AutoPay state/manage/cancel/payment method. Then centralized renewal/failure/
   grace banners and one-off toasts. Scope: new AutoPay control component/client,
   credits/BillingWorkspace.jsx, PlanCycleReview.jsx, statusMessages and targeted
   styles/tests; existing top-up/history placements retained. Acceptance: clear
   next amount/date, pending versus paid, existing consent migration, mobile/
   keyboard/focus tests; no duplicate invoices or repeated toast/ticker. Depends:7.
9. **Real Test acceptance (S record).** Scope: test execution/evidence only.
   Cards and UPI mandates, renewal, duplicate delivery, changed/revoked mandate,
   plan replacement, failed debit/recovery, refund and browser-close paths. Owner
   handles required authorization actions. Reconcile provider invoice/payment,
   event inbox, canonical grants/invoice and browser. Local clock fixtures cover
   expiry/grace; do not rewrite hosted dates. Depends:8, separately authorized
   shared migration/provider writes/Test release. No Live key change.
10. **Controlled release (S record).** Scope: evidence plus separately authorized
    merge/deployment/configuration. Both mandatory CI jobs on exact release SHA,
    required main PR, closed Production checkout first. Live pilot buyer gate,
    narrow Live configuration, consented real payment/renewal verification, logs
    and rollback/collection-stop runbook before public opening. Stop Test ingress
    exceptions/checkout after rehearsal as scoped. Depends:9 and explicit release
    authorization. Do not equate closing new checkout with stopping AutoPay.

## Verification commands and evidence

No implementation tests executed yet. Commands at the
appropriate implementation slices: causal focused `npx vitest run <new files>`;
`npm test`; `deno test -A --config supabase/functions/deno.json supabase/functions`;
`npm run test:sql` (disposable, omission-vacuity + real contention); `npm run lint`;
`npm run build`; `npm run check:bundle`;
`node -e "import('./api/router.js').then(() => console.log('router import ok'))"`;
`git diff --check`. No standalone typecheck exists. Test each new guard fails
without the implementation. Production/private financial rows are not fixtures.

## Risk checkpoints

- After1: owner-visible product contract and provider feasibility resolved.
- After4: canonical finance conserved and idempotency/crash evidence reproduced.
- After7: subscriber cancellation,48h grace and provider retries do not conflict
  with collection safety. Refund/support route established.
- After9: source-proven features become real provider execution evidence. Only
  then consider10; no planning approval authorizes activation.

The manual-first priority revision above supersedes this earlier AutoPay-first ordering; keep its
rehearsal evidence and outstanding cases under O6 rather than marking them done.

## Feasibility execution2026-10-21

Read the active Arc Test dashboard and matched existing captured Test payment
pay_TqUnP5SVFOf0iB to the application's merchant history. The live settings screen
at /app/subscriptions/settings shows Card Recurring enabled and eMandate enabled,
but UPI AutoPay explicitly says "Not enabled for your account. Request access to
enable it." The initial subscription landing page generically says both are
automatically enabled; the actual settings are authoritative. Created Test plan `plan_TqVvAH5liaGxNz` (Plus399 monthly) and customer-bound
Test subscription `sub_TqW6q4rFMdrxeX`, limited to two cycles with authorization
link expiry22 October2026 and outgoing email unchecked. The dashboard confirms
Created / Awaiting authorisation and zero payments; its issued first-charge
order is `order_TqW6qemuSSI3gk`. No mandate or payment is verified. The detail
timeline generically says "created and sent" despite email being unchecked;
actual message delivery is unverified. No payment-method toggle was changed. Owner subsequently approved the UPI
access request. Clicking Request on21 October navigated to
`/app/payment-methods/upi-qr`, then redirected to Home without a confirmation.
Returning to subscription settings still shows Not enabled and Request. Request
submission is unconfirmed; do not claim pending approval or enabled capability. This blocks proof of the
mandate handoff required by slice1 and a release claiming both methods verified.
No runtime code, hosted SQL, Production checkout or Live credentials changed.

Source inventory: grace must be distinct from paid period and credit expiry.
public.entitlement_from, billing_effective_profile (used by research-chat),
src/lib/entitlementStore.js and planEntitlements.js all require a consistent
effective-access deadline; extending profile.plan_period_end risks changing
credit allocation and must not be used as a shortcut. Existing worker lacks
subscription reconciliation; current webhook dispatcher assumes orders/payments.
Official Test docs confirm future-start authorization is distinct from a paid
cycle and provide a dashboard action to simulate subsequent charges. Those
features have not yet been executed for this merchant.

## Test UPI enrollment observed2026-10-21

Settings reloaded and still reports UPI Not enabled. Nevertheless the owner
completed the existing Test checkout while browser control changed hands. The
provider detail for `sub_TqW6q4rFMdrxeX` confirms Active, method upi, authorization
completed and mandate created/auto-charging enabled at16:54:46 IST, one Paid399
payment `pay_TqXaYLzaMESWOI`, order `order_TqW6qemuSSI3gk`, next399 collection
21 November2026. This proves Test enrollment despite contradictory settings;
it does not prove Live capability, recurring charge, cancellation/replacement
or app fulfillment. The application subscription integration remains unimplemented.
Card-only Test enrollment remains outstanding. A separate draft was opened via
Duplicate, but no second subscription was created or authorized. Native capture/
control errors interrupted draft progression; inspect actual screen before
resuming. No keys, Production checkout, hosted SQL or runtime code changed.

Owner supplied the separately created card-test link on21 October. It resolves
to `sub_TqXuyvNkM5X7Aj` in Razorpay Test mode,399 payable now. Agent opened
Start Subscription and selected Cards; left empty card fields for owner
authorization. No card information entered or saved and no second payment
verified yet. Checkout handoff proof captured locally. The checkout renders
varying recurring-until labels by method (25 vs28 November); authoritative
cycle dates still need reconciliation, not acceptance from that copy alone.

## Card enrollment verified2026-10-21

After owner authorization, Test dashboard confirms `sub_TqXuyvNkM5X7Aj` Active,
method card, one Paid399 payment `pay_TqYIiaeD5jNXHV` against
`order_TqXuzWpsQ4WtUg`. Authorization and mandate creation/auto-charging
recorded at17:36:34 IST; next charge399 on21 November2026; two cycles total.
This proves provider Test card enrollment/first charge, not renewal, webhook
settlement into the application, grace, or Live capability. Both card and UPI
initial mandates are now observed; source integration remains unimplemented.

Opened card payment details: Captured399 INR confirmed; Visa Test card ending4366;
provider invoice `inv_TqXuzQ08yG9X6h`. Capture timeline is21 October17:37 IST.
No refund or further charge triggered.

## Verification prerequisite — F236

The full suite exposed six age-dependent RSS fixture failures across four
unmodified test files. The supervisor owns a separate test-only prerequisite:
`src/lib/gdeltOff.test.js`, `gdeltCleanup.test.js`, `newsTopicRoute.test.js`,
`pibEnglishFeed.test.js`. Use fresh dates relative to the test clock, preserving
all assertions and runtime freshness rules. Baseline full run and isolated
GDELT failures reproduce the defect. Run the four files, then the full suite.
Track the finding only in open-work F236; do not alter feed implementations.

## Integration evidence — in progress2026-10-21

- Root full application suite:6522/6522 passed after UI review fixes and boundary
  wallet refresh. Deno1174/1174 passed; lint/build/bundle/router/diff checks passed.
- The first SQL attempt was sandbox-blocked at the local Docker socket. The
  rerun with local Docker access passed all53 disposable fixtures and53 omission
  checks, including real concurrent capture with lock contention.
- Independent Astra review found and the supervisor/agents corrected six issues:
  v3 actual allocation read; malformed deadlines; legacy cancellation reviving
  effective Free; transient expiry-read recovery; pre-expiry grace copy; applied
  Free cancellation UI. Open-session wallet refresh was added at explicit
  rechecks independently of entitlement success. No continuous polling.
- In-app browser: current deployed Pro account remains logged in; isolated local
  fixture renders T-7d/T-2d/grace/lapsed notices and correct IST deadlines. Mouse
  and keyboard renewal/recovery actions work. This is presentation evidence,
  not hosted grace/payment acceptance; no hosted dates rewritten for tests.
- Hosted research-chat v69 source retained locally for rollback.37 files match
  localHEAD except the existing plan lookup in index.ts. Existing v2 quote,
  capture and credit-reader definition hashes exactly match disposable baseline.
  Hosted new RPCs remain absent. Concrete shared SQL/trigger/Edge activation
  approval requested; no activation or Test publication yet.

Shared activation approved and executed: hosted migration20261021140246,
research-chatv70; ACLs/trigger, unchanged legacy hashes and37 runtime bundle files
verified. Original financial/access end for active Pro retained. Test Preview
publication and exact-SHA mandatory CI still pending. See manual-grace evidence.
