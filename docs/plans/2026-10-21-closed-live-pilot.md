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

## Release acceptance

- PR https://github.com/ddllabs/niyantran/pull/6 merged as `f8eabcbf3da7795d4204e4959c7d6cf0d23aa279` after push and PR CI succeeded; strict main protections remained enforced for administrators.
- Main CI `39638877797`: Build and tests and SQL fixtures (disposable Postgres) both success.
- Preview `dpl_2y5BNFwCTTeydFEeh7uagBA2CL19` and Production `dpl_2ozSNjA5VH4umSwqHfHqADQ3ZNaP` observed READY/aliasAssigned=false during CI, then aliasAssigned=true/checks succeeded automatically. Production aliases include www.nter.pro and nter.pro. No overrides used.
- Public Production config executed: enabled=false, checkoutOpen=false, keyId empty, no allowlist exposure. Unauthenticated create-order POST returned401. In-app browser confirmed the same public config. Production browser was signed out; no authenticated Production purchase was attempted. Test Preview UI retained Max,769738 displayed credits and refund-recorded history.
- Live credentials were neither read nor modified. Owner may now configure Production RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_ACCOUNT_ID and a distinct RAZORPAY_WEBHOOK_SECRET for https://www.nter.pro/api/billing/webhook. Keep BILLING_CHECKOUT_OPEN=0 and owner allowlist unchanged during configuration; credential verification and restricted real-payment pilot remain next steps. AutoPay remains deferred.
- Original provider event-delay root cause remains unproven; normal Git CI release worked end-to-end for this release.
