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

## Owner-approved activation (2026-10-21)

Owner approved the exact additive shared migration, Test Preview publication and bounded Test refund review. Applied local migration20261021150010 as hosted20261021154431_billing_unused_topup_refund. Both functions owned by postgres, executable only by service_role (anon/authenticated denied). Original review/list definition hashes remain d94f857d2a5effd56e36d3ced89c1a0c / e1fb9b3ccfb8f3f8de4c0e7fbe410228. Wallet remains789737.8665 immediately after DDL. Security advisor groups/counts unchanged (29 info/20 existing authenticated-definer warnings); neither new function flagged.

Published exact runtime05907f123ed0f6f336a8b4fba2510ff254f22762 to task/razorpay-plan. CI39628495879 is running; Previewdpl_2m9SYxq1cbdvrAEBLeVsdTDbt8YU created from exact Git SHA with target omitted (Preview), no settings overrides. Release/financial acceptance remains pending.

CI provider discrepancy: attempt1 workflow completed success at15:50:52Z and SQL job passed, but Build and tests job/check119320072243 remained in_progress with no conclusion despite all steps, including Complete job, success. Preview correctly stayed STAGED/aliasAssignedfalse. Reran only that stuck job on the unchanged exact SHA; no bypass or configuration change. Final CI/alias result pending.

## Release gate reconciliation (2026-10-21)

Attempt2 of CI39628495879 passed both required checks on05907f123ed0f6f336a8b4fba2510ff254f22762: Build and tests119324793147 and SQL fixtures119324796328. Direct GitHub checks API reconfirmed completed/success after the owner signed in.

A fresh same-SHA Previewdpl_EnRgSpCSm6Ba2gKrbhsWxRDKDoML built READY but still has aliasAssignedfalse. Vercel retained stale running Git-provider results. Requested normal reevaluation of the existing two check definitions via the documented create-check-run endpoint; replacement runs ckr_44177b78-9c77-4bf9-95fe-75a083d51076 and ckr_957b77f8-90dc-4e5f-8a67-d6e2ebdba0d6 remain queued. No definition, status override, manual alias assignment or Production setting change. Further repeated builds are not justified; provider check synchronization needs resolution. GitHub integration/event delivery is a hypothesis, not a confirmed root cause.

Read-only financial reconciliation after owner sign-in: wallet789737.8665/debt0, target lot20000 untouched with0 draws,0 unswept holds, both exact adjustments unreviewed. Deferred financial submission through the older deployed UI; hosted migration is active, but runtime publication and end-to-end refund acceptance remain incomplete. Owner approval for the bounded review remains valid.

Owner requested synchronization repair. In-app browser inspection confirms Vercel installation163314252 is active, scoped to ddllabs/niyantran, with actions read and checks/status permissions; project Git connection is intact. No permissions changed. Earlier verified deploymentdpl_CvdwvjTMbNT67cSLUWjibvRJsutL used source=git and released automatically; blocked retries use source=cli with matching Git SHA metadata. This difference is diagnostic evidence, not a proven cause. Publish these evidence-only notes through the authorized Test branch to exercise a fresh Git-triggered release and fresh CI checks. Preserve both mandatory checks and all Production settings.
