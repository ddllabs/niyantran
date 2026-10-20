# Billing loading repair

> **Status: Historical (2026-10-21).** Completed implementation and Test release. Spec: ../specs/2026-10-21-billing-loading.md.

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


## Deployed browser acceptance

Implementation91f540f42515f6fc5dfe3c4c9fe6ce6a8bf61005 pushed to task/razorpay-plan. Vercel dpl_GZpXw32oizGJFhiPbEHkTrQn4Qbz READY; stable Razorpay Preview alias resolves to it.

Desktop1416x977 reload: no legacy DOM in320 sampled reads. Account appears1288ms at339px high with44px summary, configuration completes2045ms, credits arrive2156ms; height stays339px, chooser top594px stays fixed across balance arrival. These elapsed observations start after reload returns, not FCP/CLS or a controlled latency benchmark. Mobile390x844 warm reload: account420ms at479px, balance1542ms, height479px throughout,44px summary and no page overflow. Config/balance/history remain independent; no fake balance or automatic checkout. No captured console errors.

Native summary Enter expands/collapses, correct accessible states and expiry table. Visual desktop/mobile screenshots: /private/tmp/billing-loading-desktop.png,/private/tmp/billing-loading-breakdown-open.png,/private/tmp/billing-loading-mobile.png. Browser viewport restored. No payment was initiated. The prior legacy flash and36px account insertion shift are absent in these measured loads. No claim about global cold-cache server latency, long-session RUM or unrelated page shifts.

Production baseline and post-release verification use dpl_54raBgMjb4oZbtXSWc1KBuDrK4xQ /4a0c98109da97caba1fe312c8e9db056dfde7df5. No Production deploy/settings, Live keys, SQL, balances or purchase records changed. Only authorized Test Preview publication occurred.
