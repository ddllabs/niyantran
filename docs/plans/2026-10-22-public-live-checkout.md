# Public Live checkout — F241

> **Status: Living.** 2026-10-22.

## Specification
Current Production is closed and Live eligibility is owner-only. The owner explicitly requests checkout for everyone. Add an explicit server-only BILLING_LIVE_PUBLIC=1 flag that permits authenticated Live buyers without a pilot allowlist. Keep the checkout kill switch, ready checks, Test allowlist, immutable quotes, authentication, ownership and webhook signatures unchanged. No SQL, credentials, webhook events, AutoPay or real payment changes.

## Ordered plan and write scope
1. Integrate published main preserving local evidence.
2. Add causal failing contract tests in src/lib/billingLiveContract.test.js; implement only server/paymentService.mjs.
3. Verify focused tests, full Vitest/Deno, lint, build, bundle and router import. Independent review before publication.
4. Commit and publish task branch; require both CI jobs; PR merge without bypass. Configure Production public/open nonsecret flags for the new deployment only.
5. Verify exact main SHA CI, automatic domain assignment and public config Live-enabled; unauthenticated order remains denied. Document evidence here and open-work.

## Acceptance and rollback
Explicit flag enables new authenticated Live buyers; absent/invalid flag retains pilot fail-closed behavior. Test never becomes public. Closed/not-ready still prevent checkout. Rollback: set BILLING_CHECKOUT_OPEN=0 and redeploy a CI-passed revision; retain recovery. A real Live payment and signed delivery remain unverified and must not be represented as passed.

## Local evidence
- Before implementation: focused contract suite 6 failed / 28 passed; public eligibility and explicit flag parsing fail on previous code.
- After implementation: focused billing 155/155; full Vitest 6547/6547 (421 files), Deno 1174/1174, lint, build, bundle and router import all pass. No test/data changes outside scope.
- Independent reviewer live_pilot_review: no blockers; verified bearer/active-account authorization, immutable identity, Test isolation and retained recovery. Independently reproduced focused155.
- Main branch protection inspected: strict, administrators enforced, both Build and tests and SQL fixtures required.
- Real Live payment and signed webhook delivery are not yet executed. User explicitly directs public launch after this limitation was explained.

## Production release evidence
- Runtime e7317a8d; PR #7 merged as d74798bef145187a2b04695504f83a667f066dc4 after branch CI39685281112 and PR CI39685310597 passed both required jobs.
- Production nonsecret BILLING_LIVE_PUBLIC=1 and BILLING_CHECKOUT_OPEN=1 set for the new deployment. Existing pilot list retained for rollback. Keys, Preview and webhook events unchanged.
- Main CI39686094204 passed both jobs. Vercel dpl_7nu9FCu5vH6XGppSMPzKsoufD9DY READY and automatically aliasAssigned=true, including www.nter.pro and nter.pro.
- Actual www.nter.pro API: config200, enabled=true, checkoutOpen=true, Live key prefix=true, cycleChanges=true, demoFallback=false. No credential values printed.
- Unauthenticated create-order and plan-schedule both401; unsigned webhook400; apex308 to canonical www domain. Browser loads signed-out site and protects billing behind sign-in.
- Public authenticated eligibility is verified by server tests and deployed configuration. No real Live purchase or successful signed Live webhook delivery was performed; end-to-end settlement remains unverified. No claim of completed real payment acceptance.
