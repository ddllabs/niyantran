# Closed Live pilot release

> **Status: Living.** Tracks F239/F240 in open-work.

1. Inspect Git/CI/Vercel state and complete billing branch diff against main. Preserve all existing work.
2. Add causal RED tests for Live eligibility, malformed config, spoofed identity, closed checkout and recovery. Write scope: server/paymentService.mjs; src/lib/paymentService.test.js, billingApi.test.js, billingLiveContract.test.js. Implement one shared mode-aware buyer predicate; no schema changes.
3. Independent read-only review, then focused tests, npm test, Deno suite, lint, build, bundle and router import. SQL fixtures required in CI for the full release branch; existing local F238 54-fixture evidence retained.
4. Configure only Production's nonsecret Live pilot UUID allowlist and closed-checkout flag. Push Test branch, verify both CI jobs and automatic Preview alias. Open/attach PR, merge only after required checks pass and branch is up to date. Verify main CI and automatic Production alias before browser/public endpoint acceptance.
5. Record deployed commit, final gate state, checkout-disabled probes and owner credential handoff. Do not activate Live keys or payments.

## Verification before publication

- Causal RED: 7 intended gate failures / 139 passing tests before implementation.
- GREEN: 153 focused tests; full JavaScript suite 6,538/6,538; Deno 1,174/1,174; lint, production build, bundle budget and router import passed.
- Independent Astra review: no P1/P2 findings in pilot guard and reviewed billing release boundaries; historical SQL verification not independently replayed by reviewer. Both CI jobs remain mandatory.
- Production metadata had no Razorpay credentials. Added only `BILLING_CHECKOUT_OPEN=0` and owner UUID `BILLING_LIVE_BUYER_IDS`; no credentials read or changed.
- Second normal Git deployment `dpl_FpBueWaiGpTrFUAhqaSPYz6NzXfV` for `7ec9e77e` is READY with automatic alias assignment. The normal Git release path has recovered; delayed provider processing cause is still unproven. No gate bypass or manual alias used.
