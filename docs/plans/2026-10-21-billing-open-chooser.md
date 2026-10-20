# Open chooser/frontend rollover preparation

> **Status: Living.** Sequential supervisor work,2026-10-21.

1. Confirm/fetch clean task/razorpay-plan baseline0f00044. Audit modern/legacy headings and rollover source paths.
2. RED tests: default chooser visibility, actual modern/legacy subsection scrolling, catalog/checkout no-rollover marketing.
3. Write scope: BillingWorkspace,PlanCycleReview,CreditsPage,publicPlans,legalPolicies,scoped billingWorkspace.css and their tests; task records. Remove toggle/duplicated summary state, update subsection labels/targets with legacy fallback. Do not relocate history or change payment flow.
4. Verify focused checks,full application/Edge suites (publicPlans metadata/copy),lint/build/bundle; browser default route/navigation/current badge/history ordering. Continue existing Test Preview only.
5. Record backend analysis: prospective stop of rollover minting; preserve ledger/receipts/historical readers. No Supabase mutation in this phase.

## Local verification

- New visibility/heading-target/catalog guards fail before changes; modern sidebar target assertion fails against old IDs. Extracted scrolling helper verifies modern/legacy resolution and reduced-motion page scroll. Policy guards fail against old10% text/date.
-56 focused tests passed. Full npm test:417 files/6472 passed. Initial full run found the existing UsageSections menu expectation still named old headings; updated expectation,with integration guard checking real rendered targets,then reran full suite green.
- Deno1172 passed; lint,build,bundle,diff checks pass. InitialJS180710bytes gzip within budget. SQL/server unchanged,so no SQL/router execution required.
- Browser baseline: at1200px,old Invoices sidebar action leaves the actual billing-history heading below the viewport (1320px); code targets missing plan-invoices-title.
- Removed choosing/saved-summary state and dead toggle/summary CSS. PlanCycleReview still owns actual schedule/quote confirmation and existing financial flow. BillingHistory stays after top-ups.
- Terms/Refund remove the two carry-forward promises and update only affected policy dates to21October. No cash/refund behavior change. Historical rollover renderer/segment/provenance retained. Backend read-only NTER setting10.00 confirmed; no database mutation.

Test Preview publication and browser acceptance follow.
