# Billing UI clarity implementation

> **Status: Living.** Sequential supervisor work, 2026-10-21.

Spec: ../specs/2026-10-21-billing-ui-clarity.md.

1. Establish clean task/razorpay-plan and fetched origin state. Inspect current billing UI and Test deployment.
2. Add focused causal guards; update display formatting only, PlanCycleReview/PurchaseReview payment copy, renewal explanations, BillingCreditBreakdown and BillingWorkspace. Keep original credit lots and server quote IDs/amounts unchanged.
3. Update InvoicePreview and scoped billingWorkspace.css. Verify pointer start/end outside, content interaction, Escape, X and focus return.
4. Run focused Vitest, npm test, deno test -A --config supabase/functions/deno.json supabase/functions, npm run lint, npm run build, npm run check:bundle, git diff --check. Browser-check actual components and authenticated Test Preview without payment/schedule mutations.
5. Review, commit, push only task/razorpay-plan. Verify exact READY Preview commit and unchanged Production deployment. Record evidence and close open-work item. No delegation.

## Local verification

- Clean task/razorpay-plan baseline fd053f5, fetched origin equal. Preview dpl_h3ETKXp2dsCLFqdURQLagCXAPfp4 on the same commit. Production baseline dpl_54raBgMjb4oZbtXSWc1KBuDrK4xQ.
- RED: original formatter, renewal wording and provider-specific button fail three new tests. Disabling grouping fails the 64,980 aggregate assertion; disabling outside-click dismissal fails the close spy. Fixes restored.
- Focused: npx vitest run src/shell/PlanBilling.test.jsx src/shell/credits/BillingCreditBreakdown.test.jsx src/shell/credits/InvoicePreview.test.jsx src/lib/billingClient.test.js src/shell/credits/PlanCycleReview.test.jsx — 57 passed.
- npm test — 416 files /6466 tests passed. First run caught one old button-label assertion; it now verifies the provider-neutral button and exact review amount separately.
- deno test -A --config supabase/functions/deno.json supabase/functions — 1172 passed.
- npm run lint, npm run build, npm run check:bundle, git diff --check — passed. No new build warnings; initial JavaScript180773 bytes gzip within budget. SQL/router unchanged, so no SQL or router checks required.
- Review: only display formatter changed in billing helper; checkout quote IDs, amounts and server/invoice generation untouched. Accessible table scopes/caption, original lots retained, expandable grant detail, native modal focus trap and focus return preserved. No new dependencies, timers, financial records or policy changes.

Publication and authenticated browser acceptance pending below.
