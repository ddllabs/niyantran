# In-app plan and billing screen (F110)

> **Status: Living.** Owner approved the plan on 2026-10-12. Branch
> `task/upgrade-screen` from `main` at `3790883`.

## Problem

The server can quote, open a Razorpay order, verify a payment, grant one month
and issue an invoice, but no screen uses it: a signed-in user cannot see plans,
pay or find invoices, and the pricing page's buttons lead to signup. Razorpay
reviews the payment flow behind a test login before activating the account.

## Owner decisions (2026-10-12)

- Renewal: pay for each month; remind the user near the end date. No mandate.
- Plan changes: upgrades only while a plan is active, starting now; unused days
  of the old plan are not refunded (matches the refund policy). Buying the same
  plan adds a month after the current end.
- Go-live: checkout stays closed until AI credits exist (F111), even after
  Razorpay keys are added; a server switch opens it.

## Outcome

- "Plan & billing" in the profile menu opens a panel: current plan and end date,
  Plus / Pro / Max in rupees from `publicPlans.js`, a pay button per choice,
  the renewal reminder, and the user's invoices (open as the printable invoice).
- While checkout is closed the panel says online payments open soon and how to
  reach us; it never shows a payment that did not happen. After a verified
  payment it shows only what the server returned.
- A signed-in user's plan buttons on the pricing page open the panel.
- Server: checkout opens only when Razorpay keys exist and
  `BILLING_CHECKOUT_OPEN=1`; `create-order` refuses a lower plan while a higher
  one is active.

## Scope

`src/lib/publicPlans.js` (plan ranks and purchase rule shared with the
server), `src/lib/billing.js`, new `src/shell/PlanBilling.jsx`,
`src/shell/TerminalShell.jsx`, `src/shell/upgrade.css`,
`src/marketing/PricingPage.jsx`, `src/marketing/MarketingSite.jsx`,
`server/billingApi.mjs`, `.env.example`, tests. No database change.
Excluded: credits (F111), subscriptions/mandates, Razorpay keys, deployment.

## Acceptance

Red-first tests for the purchase rule, the closed-checkout switch, the
server's downgrade refusal and each panel state (free, active, renewal due,
checkout closed, paying, verified, failed, invoices). Full `npm test`, Deno,
lint, build, router import; browser check of the panel and the pricing hand-off
with payments closed (no real or test payment without keys).

## Execution evidence (2026-10-13, branch `task/upgrade-screen`)

- Red first: purchase rule (`publicPlans.test.js`), checkout switch and
  downgrade refusal (`billingApi.test.js`), seven panel states
  (`PlanBilling.test.jsx`) and the wiring (`planBillingWiring.test.js`) failed
  before the change, then passed.
- `npm test` 195 files / 2,568 tests; Deno 881; lint exit 0; build; router
  import ok; `git diff --check`.
- Browser: a temporary local page (deleted afterwards) rendered the real panel
  with the real checkout code against the local dev server, which has no
  Razorpay keys. Active Pro: Plus unavailable, Pro marked current, Max chosen
  with the no-refund note, pay button disabled with "Online payments open
  soon"; Plus ending in 3 days: renewal reminder; Free at 375 px: three plans
  stacked, no overflow; Escape closes; invoices "No invoices yet"; no console
  errors. Signed out, a pricing plan button still opens signup with no
  hand-off. The signed-in terminal menu itself was not exercised in a browser
  (agents do not sign in); its wiring is covered by tests.
- No database change. Checkout remains closed in production until Razorpay
  keys exist and `BILLING_CHECKOUT_OPEN=1` is set.
