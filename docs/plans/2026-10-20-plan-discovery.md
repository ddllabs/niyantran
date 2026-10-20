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
