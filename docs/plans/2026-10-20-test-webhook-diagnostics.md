# Test webhook diagnostics plan

> **Status: Living.** Sequential, no delegation. Spec ../specs/2026-10-20-test-webhook-diagnostics.md.

1. Preserve existing dirty reconciliation documents. Reproduce missing stage logs in injected route tests; no hosted fixtures.
2. Add allowlisted category/status logging only for Test webhook errors. Review no financial/signature/control-flow changes and no raw data logging.
3. Run focused and full app/Deno/lint/build/bundle/router checks. Record exact results. Prepare a reviewable local commit.
4. Request owner approval before pushing/deploying this diagnostics patch to task/razorpay-plan. Production web/Live configuration remain unchanged.
5. If approved, verify exact Test deployment/CI, observe natural existing retries and inspect fixed categories. Resolve confirmed root cause in a separately scoped fix; never weaken authentication or grant benefits again.


## Local verification — 2026-10-20 IST

Five category tests failed before instrumentation and pass after it; Live/unrelated
silence test passes unchanged. Focused billing API/service2 files114 tests pass.
Full407 files6408 application tests pass; Deno1172 pass. npm run lint, npm run
build, npm run check:bundle and router import pass; initial JS180807 gzip bytes,
no chunk warning. All npm/router commands use the existing temporary no-dotenv
preload. Direct injected unexpected-error check verifies only processing/503 is
logged, arbitrary exception text is absent from logs/response, and Live emits no
Test diagnostic. Whitespace check passes. No SQL changed or rerun for this patch;
previous48-fixture accounting acceptance remains separately recorded.

Manual correctness/security review: only fixed Map values and a bounded numeric
status can reach console.warn; code runs exclusively for the webhook URL with
server mode test. Existing catch response and all financial/signature/merchant/
inbox/retry logic unchanged. No new dependency, SDK, RPC or environment flag.
Existing dirty reconciliation records preserved. Exact signed-delivery failure
still unconfirmed; this patch observes it rather than bypassing validation.

At local verification there was no push/deploy/provider setting/replay/new payment/Production or Live action.
Owner approval was pending for a new Test-only diagnostics publication. After release,
first prove the diagnostic logs an unsigned control request, then observe existing
natural provider retries. If real400s produce no category despite the control,
investigate pre-handler platform processing instead of guessing a secret mismatch.

## Approved Test release — 2026-10-20 IST

Owner explicitly approved Test-only push and deployment of `6100095`.
Pushed `61000957e76e44b42f53e9c96748776c01d32596` to `task/razorpay-plan`;
Vercel `dpl_izDrfEvZ4xyKfViHwvDxrHFse8mo` is READY at that exact SHA and the
existing branch alias. Original CI run39321500694 passed on attempt1, including
application/Edge tests and disposable SQL acceptance. The runner emitted only
its Ubuntu26 label-migration notice.

One unsigned control at20:43:10 UTC October19 returned400 and emitted the
expected fixed `signature` category. This was an agent control, **not a Razorpay
delivery**, and establishes logging only. At20:47 UTC no natural retry had
reached this deployment; the actual signed-delivery failure remains unresolved.
Read-only reconciliation still reports0 Test events,2 fulfilled Test orders
and2 captured Test payments. No replay or additional payment was invoked.

Production remains READY at `4a0c98109da97caba1fe312c8e9db056dfde7df5`,
deployment `dpl_CmCWdRkJMWcskCJqPpABbCdqx7UY`; its billing config remains
enabled=false/checkoutOpen=false and protection remains all_except_custom_domains.
No secret, environment, provider setting, schema, balance or Live change.
Release evidence update is local; no second deployment is required to observe retries.

### Genuine retry observation — 20:51–20:52 UTC October19

Three real incoming retries on the new deployment emitted `signature`/400:
20:51:57.403 UTC request4vqh6-1792443117367-f0562241ca5e,
20:51:57.624 UTC requestb8n8k-1792443117368-de3eccfdb235,
20:52:03.892 UTC requestncx54-1792443123871-d3e4dd77244c.
These are separate from the unsigned20:43 control. The signed-delivery
rejection stage is now established: signature validation fails before merchant,
event-inbox or fulfilment processing. This does not distinguish a webhook-secret
mismatch from altered raw bytes or a missing/malformed signature. No secret was
read or changed, validation bypassed, replay forced or benefit granted. Next
scope is to establish which signature input differs while keeping secrets private;
webhook acceptance and subsequent plan rehearsal remain open.

## Signature investigation — owner approved Test fix, 2026-10-20 IST

Scope: establish the signature mismatch, repair only the Test configuration or
proven code defect, redeploy Test Preview and verify a real delivery before
further purchases. Preserve Production/Live keys, strict HMAC and idempotency;
no corpus or shared-database migration. Preserve the three local release-evidence
document edits. No delegation required.

Ordered checks: inspect branch-scoped configuration metadata, trace request raw
bytes and HMAC against official provider rules, run focused verification, then
correct a proven mismatch and redeploy the exact Test branch. Verify genuine
incoming delivery, durable inbox processing and unchanged purchase benefits.
Code changes, if needed, stay in paymentService/billingApi and their tests;
configuration changes stay Preview + task/razorpay-plan only.

Observed: webhook-secret metadata is Sensitive, target preview only, gitBranch
task/razorpay-plan, idVTzpjgqrre24OqVp. Secret values were not retrieved.
Owner confirms the original webhook secret is available. Requested secure
re-entry of that original value into this one Vercel variable, leaving the
Razorpay webhook and API credentials unchanged; awaiting owner save.

Focused billing service/API114 tests pass. A separate synthetic execution used
the installed official Vercel runtime's actual restoreBody implementation with
already-consumed request streams. Three compact/whitespace/Unicode/escaped-JSON
cases preserve exact bytes; correct HMAC accepted, wrong-secret HMAC rejected;
lazy body parser never invoked. This validates the local adapter and algorithm,
not hosted provider-byte equivalence. No code defect established, no speculative
source change. Razorpay documents HMAC-SHA256 over original raw bytes and that
old event retries retain the original secret:
https://raw.githubusercontent.com/razorpay/markdown-docs/master/webhooks/validate-test.md.
