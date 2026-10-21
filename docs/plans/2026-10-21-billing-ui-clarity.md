# Billing UI clarity implementation

> **Status: Historical (2026-10-21).** Completed sequential supervisor work.

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

## Test Preview verification

- Runtime implementation2292928 pushed only to task/razorpay-plan. READY dpl_DSccXjZ4rT6DFbMVhjwGaRWqqtaN, exact2292928ec6214752065c4e578b92e26ceb5cb705. Stable Razorpay Test alias resolves to it. Advisory CI39488401975 completed successfully.
- Signed-in real account: Pro active until20Nov, renew from13Nov with next period beginning20Nov. Balance86167, monthly64980, topup20000 remain unchanged. Original monthly20000+44980 grants expand under the combined monthly row; signup13Nov and topup20Oct2027 remain separate.
- Real invoice00009 displays logo, service dates and exact599.74INR. Content click keeps it open; backdrop, Escape and X each close it and restore View invoice focus. OS print/export not executed.
- Top-up selection shows exact499INR and Pay online, then local selection cancelled. No checkout/payment or schedule/cancel action submitted, no new purchase or balance adjustment.
- Browser at320/390/768/1440 widths and dark mode: credit table fits and expiry/type values remain readable. Tablet account client/scroll widths equal738px. Browser console errors:0. Original light theme and viewport restored. Proof /private/tmp/billing-ui-clarity-preview.png (untracked local artifact).
- Production nter.pro remains exactly dpl_54raBgMjb4oZbtXSWc1KBuDrK4xQ. No settings, database, Edge deployment, Production branch or Live credential change.
- Final review correction: renewal footer applies only to active paid plans; Free says No monthly subscription. New Free-copy test fails before correction, passes after. Release-focused59 tests, lint/build/bundle pass; initialJavaScript180772bytes gzip. Final application suite and follow-up publication recorded below.

Final application rerun after the Free-copy correction:416 files/6466 tests passed (106.52s). Earlier Edge suite1172 passed remains applicable; no Edge code changed. Publication authorized only for task/razorpay-plan Test Preview.
