# Unused top-up refund correction

> **Status: Living.** F238 is tracked in open-work.

Spec: [contract](../specs/2026-10-21-unused-topup-refund.md).

1. Delegated sequential SQL slice in current checkout: one CLI-created migration, `supabase/tests/billing_unused_topup_refund.sql`, fixture registration in `supabase/tests/run.sh`. Fixed RPC interfaces from spec. No hosted actions. Prove causal/omission failure.
2. Supervisor consumer slice after SQL: `server/paymentService.mjs`, `server/billingApi.mjs`, matching src/lib tests, `src/shell/credits/BillingHistory.jsx` and tests, admin help text in `BillingReviews.jsx` if needed. Preserve review inputs.
3. Independent read-only reviewer. Focused/full Vitest, Deno, all SQL fixtures, lint/build/bundle/router import/diff checks.
4. Concrete shared migration and exact Test review approval, then activation, branch publication, both mandatory CI jobs and Test Preview alias verification. Reconcile exact target lot/debit, unrelated lots/Max/end/debt/invoice, browser refund status and retry once. Record limitations.

No Production checkout/settings, Live keys, main release or automatic benefit reversal.

## Read-only hosted baseline (2026-10-21)

Payment full refund: rfnd_Tqay4SAwZpaBoL processed, ₹499; fulfilment remains recorded.
Order724e3257-ef0e-4304-b81f-646423ab1dae owns lot96e19dd0-b418-42a6-8dc8-1892ff70e72f, original purchase source, granted/remaining20000, zero draws, expires2027-10-21T14:25:11.37748Z. Wallet789737.8665, debt0; no unswept or unresolved holds. Unrelated-lot fingerprint80024f1a853e6614cf3da7af5798d71b; sale-invoice fingerprint94ea987758b673f2ea918427f90ec579. Max remains active to2026-11-21T08:39:30.252932Z. No benefit review submitted.

Supabase changelog and current database-function guidance inspected; no relevant API/schema breaking change for these additive RPCs. No dependency or platform upgrade.

## Local implementation and verification

Migration `20261021150010_billing_unused_topup_refund.sql` SHA256 `802ead788028b3f04e91e31dcf26a67e27e147e7bf076493c2f5d1c20ef78489` adds only the two service-only RPCs. Existing review inputs retained; server overwrites actor/account/mode. Unsupported original top-up reversal returns a fixed409. Unmatched sale invoices say Invoice issued rather than asserting payment/refund status without order facts.

- Focused API/history RED:7 failed before fix; original unsupported API/status expectations reproduced. Unmatched-invoice RED:1 failed before fix; GREEN6 history cases. Focused API/payment/history126 passed.
- Agent disposable SQL fixture and omission-vacuity passed. Global-FIFO mutant failed preservation of unrelated earlier lots; history mutant failed refund fact projection.
- Supervisor full `npm test`:421 files /6530 passed, final run126.14s. `deno test -A --config supabase/functions/deno.json supabase/functions`:1174 passed.
- Supervisor `npm run test:sql`:54 fixtures /54 omission-vacuity checks passed, including existing actual capture contention tests. No hosted test fixtures.
- `npm run lint`, `npm run build`, `npm run check:bundle`, router import and `git diff --check` passed. Initial JS181169 bytes gzip; no new build advisory. Public data diff empty.
- Independent Astra reviewer approved SQL and final consumer diff with no actionable findings, subject to these gates.
- Shared security-advisor baseline retains29 intentional RLS/no-policy information findings and20 authenticated SECURITY DEFINER warnings on existing functions. Neither new RPC is activated yet. No changes to those existing interfaces.

Hosted activation, Test publication and exact reviewed debit remain pending owner approval. Proposed operation: process refund adjustment5417da89-1036-4528-aaec-295d08e174bb with20000 credits removed, no restoration or period action, reason identifying processed full Test refund; then acknowledge purchase_review5326eb5c-f90f-45b6-8c26-4e82765ef92b with zero benefit change. Recheck lot/hold eligibility before acting and compare the frozen baseline afterward. No provider cash action, automatic reversal, Production checkout/key change or Live switch.
