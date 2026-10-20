# Billing loading repair

> **Status: Living.** Sequential implementation,2026-10-21. Spec: ../specs/2026-10-21-billing-loading.md.

1. Add causal pending-config/error and stable disclosure tests; run RED against audited implementation.
2. Implement pending/error boundary, independent invoice reads and CreditsPage credit props; remove duplicate subscriber and unreachable cycle branch. Reuse the same BillingWorkspace/account instance for pending and ready geometry; keep disclosure present. Scope: src/shell/PlanBilling.jsx,src/shell/credits/CreditsPage.jsx,src/lib/billing.js and focused tests.
3. Polish disclosure without animation; suppress empty compact period placeholder and unnecessary Free period read. Scope: BillingWorkspace.jsx,billingWorkspace.css,PlanPeriods.jsx and focused tests.
4. Run focused/full npm test,Deno,lint/build/bundle/router; inspect diff and browser temporal samples. No SQL change, so no live migration/test fixture.
5. Commit/push task/razorpay-plan and verify exact Test Preview SHA plus stable alias, desktop/mobile disclosure/keyboard behavior, account reload geometry and unchanged Production deployment. Close tracker with implementation hash and evidence.


## Implementation and local verification

Pending/error/Test-ready rendering now stays in one BillingWorkspace instance; known legacy configuration alone mounts the legacy flow. Configuration/invoice reads remain independent. Configuration failures and malformed replies are explicit retryable errors; completeCheckout refuses them without creating an order. CreditsPage supplies the existing credit snapshot, guarded by userId in PlanBilling; the billing subtree key includes account and initial plan. Removed the redundant subscriber/initial refresh and unreachable cycle branch; legacy Purchases receives existing config. Free does not fetch paid periods, and compact paid periods do not insert a temporary empty section.

The native disclosure exists throughout loading and has a full-width44px accent summary, chevron, hover/focus/open states and no entrance animation. No dependency or database changes. Warm initial JS180712 bytes gzip versus180710 before this task (2 bytes difference); this is not a claimed HTTP-latency benchmark.

Causal RED: pending config/error/disclosure tests failed against old behavior (3 failures). Focused final66 tests pass, covering deferred resolution in the same view, retry, no duplicate credit subscriber, previous-account balance rejection, malformed config/no order, existing legacy flow and compact periods. The first full suite exposed an outdated wiring assertion requiring subscription inside PlanBilling; it now asserts ownership in CreditsPage and supplied props. Final full rerun pending. Edge1172/lint/build/bundle/router pass. npm production audit0 known vulnerabilities. SQL fixtures not repeated because no SQL/DB changes.


Verification note: a final full run exposed an existing order-sensitive AdminApp test (`window.matchMedia is not a function` from a browser stub); isolated admin+billing120 tests pass. Removed an obsolete raw window stub from the modified billing tests (no longer needed with page-owned credits); no admin source or test is changed. A fresh full run is required before publication; do not suppress the failure or claim it proves an admin runtime defect. The prior full run also validated6482 tests apart from this unrelated stub failure.


Final local acceptance:417 files/6483 application tests passed, including the admin test; focused admin+billing120 passed. All1172 Edge tests passed. Lint/build/bundle/router pass; production dependency audit0 vulnerabilities. Five-axis review found no server money/authorization contract changes: failures fail closed, snapshots stay user-owned, read effects clean up on account/config retries, loading/ready reuse the account subtree, native details semantics remain. No globally weakened refresh/cache policy, new dependency, SQL or environment change. Preview publication/browser evidence next.
