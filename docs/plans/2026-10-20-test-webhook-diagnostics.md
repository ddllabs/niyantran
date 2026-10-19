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

No push/deploy/provider setting/replay/new payment/Production or Live action.
Owner approval pending for a new Test-only diagnostics publication. After release,
first prove the diagnostic logs an unsigned control request, then observe existing
natural provider retries. If real400s produce no category despite the control,
investigate pre-handler platform processing instead of guessing a secret mismatch.
