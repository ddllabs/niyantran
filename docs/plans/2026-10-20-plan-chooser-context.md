# Contextual plan chooser plan

> **Status: Historical (2026-10-20).** Completed sequentially; no delegation. Spec: ../specs/2026-10-20-plan-chooser-context.md. Tracked under O6 in open-work.md.

1. Reproduce conflicting states and add focused regression cases. Write scope PlanCycleReview.test.jsx. Prove current renderer fails suppression/renewal/loading tests.
2. Implement contextual state presentation and scoped styles in PlanCycleReview.jsx / billingWorkspace.css. Preserve cards and all server operations; fixed interfaces remain unchanged.
3. Run focused/full unit checks, lint/build/bundle. Browser fixture covers current/saved/downgrade/upgrade/loading/error, mobile/dark and keyboard behavior without external writes.
4. Review, commit and publish under existing Razorpay Test Preview scope; verify authenticated page, preserve current Plus schedule and Production. Record evidence and source hash in tracker.

## Local execution evidence

- Four new cases observed RED against original renderer: premature current-plan quote, duplicate saved downgrade review, empty generic loading form and missing actionable quote error. After implementation all focused10 chooser cases pass, preserving zero-charge schedule, quote-id-bound payment, manual renewal and expiry rejection.
- `npm run lint`, `npm run build`, `npm run check:bundle`, `git diff --check` pass. No new build warnings; initial JS180772 bytes gzip, within existing guard. No API/server/lib/schema changes, so no additional database or Edge deployment.
- Real component/synthetic billing browser fixture: saved choice shown once; current Pro timing shows13Nov renewal/20Nov expiry; upgrade due/credits displayed with calculation disclosure; loading/error/retry recovered; downgrade and Free confirmation keep zero due. No Checkout/provider action. Free keyboard activation retains focus on the stable footer control and requires a separate confirmation.
- 320px mobile review width250px, no page overflow. 768/1024/1440px document widths match viewports; dark theme readable; browser console errors empty. Temporary server, fixture and tab removed; browser viewport reset.
- Cards/header/invoices and surrounding billing page retained. Saved preference is a server-owned unpaid choice; no speculative schedule or payment mutation performed in the real account.

## Release evidence

- Source `7ecc2d9` published on task/razorpay-plan only; Test deployment `dpl_BfPZcvRevcpvRbsrfKU8ZD2w2eTa` reached READY. Logged-in browser confirms saved Plus row with no duplicate review, current Pro note (renewal13Nov/expiry20Nov), quiet Free action, unchanged86,267credit balance and existing Plus preference. No real schedule/cancel/payment action performed; only card selection/read. Console errors empty.
- Final `npm test`:413files/6452tests passed. Final footer copy simplified to “Manual renewal. No automatic charges.”; focused10tests, lint/build/bundle rerun and passed. `git diff --check` clean. No backend/lib/SQL changes; Edge/SQL suites were not rerun for this UI-only follow-up.
- Reviewed branch changes against spec: one contextual summary, server quote id and expiry guard preserved, no automatic scheduling, loading/error/retry, current-plan request suppression and explicit Free confirmation. Plan cards and surrounding billing page preserved.
