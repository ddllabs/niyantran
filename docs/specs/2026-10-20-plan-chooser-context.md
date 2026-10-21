# Contextual plan chooser

> **Status: Normative.** Billing design follow-up requested2026-10-20.

Current chooser stacks a prominent Free button, saved next-plan card and generic purchase review even when the current plan cannot yet renew. Retain the accepted plan cards and all financial rules; modernize only the area below them.

Show one contextual summary: saved unpaid choice (including when already selected), current-plan/renewal timing, downgrade confirmation, quoted purchase, quote loading or actionable error. Quiet Free action belongs to a separated footer. Saved choice has compact date/unpaid status and Remove action, with manual renewal review only when eligible. Current plan before seven-day window issues no quote request. Downgrade review retains zero due today and current access end; primary confirms future selection without Checkout. Server quote determines price/credits/coverage for upgrade/start/renewal; calculation and rollover details are progressively disclosed. Keep server quote id, expiry guard, request lock, cancellation and account ownership intact. Card choice never pays or changes a schedule.

Scope: src/shell/credits/PlanCycleReview.jsx, its test, billingWorkspace.css and focused supporting presentational test/fixture only if needed. No financial API, database, grants, keys, invoices, plan cards or surrounding page changes. Existing Test Preview publication scope only; Production untouched.

Acceptance: saved choice never duplicates review; no premature renewal call; correct loading/error/retry and expired-quote state; quoted checkout bound to id; free downgrade/cancel paths; keyboard/mobile/dark states. Focused RED/GREEN, npm test/lint/build/check:bundle and isolated browser fixture; authenticated Preview read/selection only, no payment or schedule mutation.
