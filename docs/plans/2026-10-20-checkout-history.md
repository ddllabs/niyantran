# Customer purchase history plan

> **Status: Living.** Sequential, no delegation. Spec: ../specs/2026-10-20-checkout-history.md.

1. Preserve existing local webhook evidence edits; inspect current classification
   and purchase tests on task/razorpay-plan.
2. Replace unpaid-disclosure expectation with a mixed-history regression proving
   unpaid/retryable attempts are hidden and unresolved/paid records remain.
   Run it red before the change; align existing Purchases.test.jsx visibility
   expectations while retaining each status case.
3. Remove only unpaid-attempt rendering from PurchaseHistory.jsx; keep stored
   records and retry/fulfilment behavior unchanged.
4. Run focused purchase/service/API checks, npm test, npm run lint, npm run build,
   npm run check:bundle; inspect a synthetic local browser rendering. No Deno/SQL
   changes; no database/provider/secret/Production action. Record outcomes.
5. Leave the verified fix local for review; no new publication authorization is
   inferred from the earlier webhook-only Test deployment approval.

## Local execution — 2026-10-20 IST

Removed only the unpaid-attempt disclosure from PurchaseHistory.jsx. Existing
classification, backend responses, stored attempts, request IDs, safe retries
and duplicate-payment guards are unchanged. Completed/refunded purchases and
creating/reconciling/review records continue to render; no timeout is treated
as payment failure. Admin operations unaffected.

Two render regressions failed before the change and pass after. Initial full
run6407/6409 exposed two earlier Purchases.test.jsx expectations for displaying
unpaid records; updated those expectations without removing status cases.
Final npm test407 files6409 tests pass. Focused purchase experience/service/API
120 tests pass. npm run lint, npm run build, npm run check:bundle and git diff
--check pass; initial JS180805 gzip bytes, no chunk warning. Commands used the
existing no-dotenv preload. No API/server/SQL/Edge source changed, so no router,
Deno or SQL execution required for this display-only slice.

Actual local browser rendering of the bundled component with synthetic records
confirmed completed/refund rows, visible confirmation/review warnings and absent
abandoned attempts. Screenshot /private/tmp/checkout-history-local.png. Fixture
server and temporary browser tab closed. No owner account interaction or hosted
payment call. Local code review confirms the diff removes rendering only.

Source/test/task records remain uncommitted and unpublished on task/razorpay-plan;
earlier webhook investigation evidence edits are preserved. Production, Live
keys, corpus and provider state unchanged. Original webhook secret re-entry is
still pending separately before webhook verification can resume.

Owner subsequently approved Test-only publication with the plan-discovery UI
on2026-10-20. Release/commit/deployment evidence is recorded in that plan. No
Production/Live or financial mutation is part of publication.
