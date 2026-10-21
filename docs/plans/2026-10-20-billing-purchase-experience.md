# Billing purchase experience plan

> **Status: Living.** Implemented locally; owner subsequently approved Test Preview publication and main integration.

Spec: ../specs/2026-10-20-billing-purchase-experience.md. Sequential on existing
task/razorpay-plan; retain all pre-existing modified documentation.

1. Reproduce direct checkout and cluttered history. Write scope: Purchases.jsx,
   Purchases.test.jsx, new PurchaseHistory.jsx/test. Separate actionable unresolved
   states from unconfirmed checkout attempts without deleting or deduplicating audit rows.
2. Add explicit review and current-plan clarity. Write scope: new PurchaseReview.jsx,
   PlanBilling.jsx/test, Purchases.jsx, creditsPage.css. Use existing catalogue and
   server-validated Checkout; do not create orders until explicit confirmation.
3. Fix UI read-error reporting and refresh propagation. Write scope: billing.js,
   client tests, BillingReviews.jsx, parent/child UI tests. Collapse admin tools.
   SQL operator-list defect stays tracked separately.
4. Verify focused/full Vitest, Deno (billing library scope), lint/build/bundle/router,
   local fixture desktop/mobile and whitespace/security review. Record exact
   evidence here and existing open-work tracker. No hosted mutations or payments.

## Local execution — 2026-10-20 IST

Implemented review-first top-up selection and shared plan review, current-plan
badge/border, dated/amount/reference history, collapsed unconfirmed attempts and
admin tools. Unknown/reconciling/review purchases remain visible outside the
attempt disclosure. No row deletion, deduplication or fabricated cancellation.
The disclosure deliberately says unconfirmed rather than asserting no provider
payment exists. Invoice, credit, entitlement and history reads refresh together
after successful checkout; read failures reject and have explicit UI errors.
Existing stable intent and signature/capture/financial core unchanged.

Causal evidence: three new top-up/history regressions fail against original UI;
three billing read-error regressions fail against original billing.js (restored
with finally after the check). Final focused six files136 tests pass, including
service/API duplicate-payment protections, explicit confirmation and same-render
double-click protection. Full Deno1155 pass. Lint, build, bundle, router import
and git diff --check pass. Initial JS180770 gzip bytes.

Full app run:405 files,6363 pass/5 fail. Four failures are dated law/WTO feed
fixtures; current main7a10c32 already contains fixed-clock corrections absent
from this billing branch. The fifth is feedStore slow-database budget timing;
isolated rerun passes all feedStore tests, while four unchanged publisher
fixture failures reproduce. Do not claim full-suite green or edit unrelated
feeds in this UI scope. Initial verification attempt also exposed an incomplete
temporary dotenv guard; corrected existsSync guard before final run. No dotenv
contents were read. Final focused run includes the subsequently added click guard.

Actual IAB browser fixture: real components/CSS with synthetic stubbed billing
reads and checkout, no Supabase/provider connection. Observed default collapsed
attempts/admin controls; pack selection review without Checkout; simulated
confirmation updates visible history; current Pro badge and Plus downgrade
review preserving access; explicit operator-read error. Screenshot inspection
at desktop859px and iframe320px shows wrapped cards and disclosures. No claim
of a real payment, mobile payment gateway, or hosted acceptance. Browser DOM
API cannot inspect iframe contentDocument; mobile evidence is screenshot only.
Local screenshot /private/tmp/billing-review-desktop.png.

Uncommitted on task/razorpay-plan. Four pre-existing dirty documents retained;
only open-work gains this task paragraph. No push/deploy/config/key/provider/DB/
corpus operation. Remaining acceptance blockers: operator SQL ambiguity, queued
plan projection, stale-plan order preflight, newer-main integration and actual
Test capture/webhook/plan lifecycle rehearsal.

## Continuation

Owner approved operator SQL/stale-plan fixes, latest-main integration and Test-only
publication. UI preserved in89bab64, main integrated indc9a5e7. Full integrated
app6386/Deno1172/SQL47 and lint/build/bundle/router now pass. See
2026-10-20-billing-preflight-release.md for migration and release evidence.
