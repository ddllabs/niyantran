# Plan discovery implementation

> **Status: Living.** Sequential, no delegation. Spec: ../specs/2026-10-20-plan-discovery.md.

1. Preserve dirty checkout-history/webhook evidence; inspect shell, profile,
   billing cards and entitlement semantics on task/razorpay-plan.
2. Add causal allowance/badge tests. Extract presentation-only PlanChoices.jsx
   for billing and dialog; keep existing checkout handlers unchanged.
3. Implement PlanChangeDialog.jsx with native dialog focus/Escape/restore,
   current plan and explicit effective timing. Review hands off to the existing
   billing page; no Checkout within a native top-layer dialog.
4. Wire the account Change plan action and active badge in TerminalShell.jsx /
   credits/BalancePill.jsx; style in upgrade.css / credits/creditsPage.css.
5. Verify focused UI/service tests, full npm test, lint/build/bundle, and synthetic
   local browser desktop/mobile keyboard interactions. No lib/admin/Supabase
   behavior changes; no Deno/SQL rerun needed unless scope changes. Record
   exact results here and in sole open-work tracker. Leave local, unpublished.

## Local execution — 2026-10-20 IST

PlanChoices now shares billing/dialog card presentation and displays the existing
catalogue allowance on each card. ProfileCredits accepts the server-active paid
plan from TerminalShell, validates Plus/Pro/Max and shows a badge below the ring;
Free/unknown/lapsed receive no paid badge. Account menu Change plan opens a lazy
native PlanChangeDialog with current plan/date and explicit selection timing.
Review hands off to goAccount('billing', {plan}); existing selected-plan review
and payment handlers remain unchanged. Native dialog closes before any Checkout
opens, avoiding a top-layer conflict with Razorpay. No new pricing or accounting
logic. Existing checkout-history and webhook evidence edits preserved.

Four allowance/badge guards failed before implementation, then passed. Focused
shell/profile/wiring74 and dialog/billing/profile/service107 tests pass. Full
application408 files6421 tests pass. Final lint/build/check:bundle and whitespace
check pass; initial JS180804 gzip bytes, no chunk warning. Final styling correction
adds current-plan dashed border in the popup (initially scoped only to billing).
No functional JS changed after the full run. Tests use existing no-dotenv preload.

Additional disposable Docker verification: npm run test:sql --
billing_plan_period_display passes, including vacuity failure without its migration.
Existing paid-plan matrix checks future periods/allowances without early credit
minting. No hosted SQL execution or clock edits. Deno not rerun for UI-only source.

Browser: actual dialog/PlanChoices rendered in a synthetic local React harness,
with current Pro through20Nov2026. Plus selection preserves that access until
period end; explicit Review hands off Plus and closes modal. Native :modal state
confirmed, keyboard navigation remains modal, Escape closes and restores account
trigger focus. Desktop and390x844 mobile inspected; no horizontal page/dialog
overflow. Screenshot /private/tmp/plan-picker-local-desktop.png and
/private/tmp/plan-picker-local-mobile.png. Harness uses a synthetic account trigger;
actual profile badge rendering has the paid/invalid unit cases above. Full
authenticated shell/payment end-to-end acceptance remains separately pending.
Temporary tab/server closed and viewport reset.

Manual React/security review: fixed active-plan allowlist, server entitlement
source, current/future separation, no effect-triggered purchase, explicit review,
accessible dialog name/close/focus, shared cards and lazy dialog bundle. No provider,
schema, secret, Production/Live or corpus change. Source/test/docs are uncommitted
and unpublished on task/razorpay-plan. Webhook secret secure re-entry still pending.

## Test publication authorization — 2026-10-20 IST

Owner now explicitly requests deployment to the Razorpay Vercel branch. Release
scope includes the verified plan-discovery UI and earlier checkout-history cleanup,
plus preserved documentation evidence. Push only task/razorpay-plan; use its Git
Preview deployment, verify exact commit/alias/CI and unchanged Production target.
No merge/main push, environment/Live secret edit, shared-database migration or
provider action. Prior local-only state above describes pre-approval execution.

## Test Preview release — 2026-10-20 IST

Verified UI and preserved evidence committed/pushed as
7aa3cc31e97fd839d92a95f6e3b707bf4f4ae977 on task/razorpay-plan. Vercel
dpl_2EZ2aLSNLxQy9cLk7XGPiGCFHkr3 READY at that exact commit, branch alias
https://niyantran-git-task-razorpay-plan-ddl-labs.vercel.app.

Actual authenticated IAB verification: active Pro badge/menu Change plan,
native picker current Pro/date, all three credit allowances, Plus effective
timing and explicit Review handoff to billing?plan=plus work. Cancelled selection
after read-only verification and restored ordinary billing URL. No Checkout,
order creation, payment, recovery or provider action. Old unpaid disclosure is
absent; two completed purchases/invoices and balance566461 rounded remain
visible. Browser error count0. Screenshot
/private/tmp/razorpay-plan-preview-release.png.

Production remains READY at4a0c98109da97caba1fe312c8e9db056dfde7df5 /
dpl_CmCWdRkJMWcskCJqPpABbCdqx7UY; config enabled=false/checkoutOpen=false.
No environment, Live key, schema or corpus changes. Original CI39393838099
passed both app/Edge and disposable database jobs on attempt1 at exact7aa3cc3.
Only annotation is the GitHub runner Ubuntu26 label-migration notice.
Post-release evidence edits are local; they do not change deployed runtime.

## Attached plan badge polish — owner request, 2026-10-20 IST

Scope/spec: move the paid badge onto the bottom edge of its48px profile circle,
and distinguish Plus blue / Pro purple / Max gold in light and dark themes.
Use a fixed validated data-plan hook; retain text labels and existing accessible
account name. No entitlement, payment, dropdown, ring or credit behavior change.
Write scope credits/BalancePill.jsx and credits/creditsPage.css plus task evidence.
Sequential: inspect current styling, adjust placement/palettes, verify existing
profile tests and lint/build/bundle, inspect all six theme/plan combinations in
a synthetic local browser. No new tests for static styling. Leave local;
previous Test publication approval applied to7aa3cc3, not a new publication.

Verified locally: existing profile/balance25 tests, lint/build/check:bundle and
whitespace check pass; initial JS180805 gzip bytes. Actual ProfileCredits SSR
rendered for all three plans in both themes in a local synthetic browser fixture.
Measured badge bounding boxes cross the circle's bottom edge in all6 cases;
contrast ratios light Plus6.78/Pro7.35/Max5.75 and dark8.88/9.26/10.40, all
above4.5:1. Screenshot /private/tmp/attached-plan-badges.png; temporary tab/server
closed. Styling and a validated data attribute only; no new test, full-suite
rerun or financial/backend change. Uncommitted/unpublished; Production/Live
unchanged. Earlier release evidence edits preserved.

Owner explicitly approves Test-branch deployment of the attached badge styling
on2026-10-20. Publish only task/razorpay-plan and verify exact Preview commit,
live Pro badge and CI; Production and Live configuration stay unchanged. Local
styling verification above is the pre-publication baseline.

Attached badge release: caa3212e1b49f815e509e35af033c0dba904a423 pushed to
task/razorpay-plan; dpl_8pp5Soxo6nhdkQAU8XeLvJskQNhp READY at exact commit
and existing branch alias. Original CI39410686188 app/Edge and SQL jobs passed
attempt1 (only runner-label migration annotation). Authenticated IAB Pro badge
has measured circle overlap and purple palette; screenshot
/private/tmp/attached-badge-live-preview.png. Production remains4a0c981 /
dpl_CmCWdRkJMWcskCJqPpABbCdqx7UY. No environment/key/schema/provider mutation.

Live-readiness read-only snapshot: Test inbox0, Test adjustments0; exactly2
captured/fulfilled products (500k top-up10499INR and Pro999INR). No confirmed
499INR top-up or genuine signed-event acceptance. Callback success does not
prove webhook recovery. Invoice Open again produced no new IAB view; stored
invoices are verified, rendered-view acceptance is still pending. Current
balance differs from earlier screenshot through ordinary account usage; no
purchase/grant action was performed by this release. Remaining release phases:
1 webhook-secret resolution and signed delivery/dedup/browser-independent
recovery;2 owner Test purchase/upgrade/queued-downgrade/invoice and bounded
refund/review acceptance;3 final readiness (merchant/legal, M1/M2 closure
sign-off, recovery operator/backlog monitoring, rollback/Test-exception cleanup,
secure Live provisioning);4 separately approved closed Production release and
owner-operated bounded Live pilot/reconciliation before opening checkout.
Automated accounting/security coverage and earlier independent review exist;
do not describe remaining provider acceptance as complete. This is a readiness
audit, not approval to run refunds/payments or change Live settings.

## Current-plan versus Popular badge — owner request, 2026-10-20 IST

Current shared em styling gives both labels the same purple palette. Scope:
upgrade.css only plus this record/tracker. Render Current plan with green active
state, a border and6px corners in both themes; Popular retains its purple
recommendation treatment. No plan selection/payment behavior changes. Verify
existing billing/dialog tests, lint/build/bundle and synthetic browser cards in
both themes. Leave local; no publication request for this styling slice yet.

Owner-operated Pro->Max Test upgrade reconciled read-only: purchase
0cc7a4e5-8c7f-4706-aa66-4199db2d6ac0, captured Test paymentpay_TqCENSy9FZxpHX,
999900paise, invoice NIY/2627/00004 total9999, exactly1 lot/grant750000.
Active Max period20Oct14:31:16.857113 UTC to20Nov same UTC time; prior Pro
period superseded at upgrade and its65000 unused monthly credits removed.
Signup1286.87 plus topups500000+20000 preserved. Wallet1271286.87, debt0:
586286.87 -65000 +750000. Authorized/captured/order.paid events each done
attempt1 and last_error NULL. No duplicate financial effect. Queued downgrade
and other provider acceptance remain pending; no agent payment/production action.

During investigation a new owner-operated Plus Test purchase appeared:
3aa45faf-5b38-4003-99b6-8a2791d0f134, captured39900paise, invoice
NIY/2627/00005 total399. Plus is scheduled20Nov14:31:16.857113 UTC through
20Dec same UTC time, credits20000. No lot or ledger entry exists for this future
purchase (both counts0); Max remains active, wallet1271286.87 debt0 unchanged.
All3 Plus events done attempt1, last_error NULL. Runtime webhooks for both
Max14:31:15–16 and Plus14:34:39–40 UTC returned200. Queued downgrade purchase
acceptance is confirmed; real future activation is not simulated or claimed.

Styling verification:31 existing billing/dialog tests, lint/build/check:bundle
and whitespace pass. Initial JS180806 gzip bytes; no chunk warning. Actual
shared card component rendered in both themes with synthetic Max entitlement:
Popular computed purple, Current plan computed green/bordered in both cases.
Screenshot /private/tmp/current-popular-plan-labels.png; local tab/server closed.
No new tests or full-suite rerun for two static CSS overrides. Styling remains
uncommitted/unpublished; Production, Live keys and corpus unchanged.

Owner now explicitly approves Test-only publication of the already-verified
Current plan/Popular CSS update. No new billing implementation is authorized.
Owner challenges the commercial model: full-price immediate upgrades and paid
queued lower-plan months do not match expected account-plan changes. Prior
accounting acceptance proves the prepaid-period code executes its contract,
not that this product policy is suitable for launch. O6 release is held pending
discussion/reconfirmation of upgrade proration, credit adjustment and free
downgrade scheduling; no contract rewrite, financial cleanup or refund here.
