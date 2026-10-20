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

## Owner secret re-entry and Test redeploy — 2026-10-20 IST

Owner confirms saved original webhook secret. Metadata-only read verifies
Sensitive variableVTzpjgqrre24OqVp updated1792505640125, still Preview only /
task/razorpay-plan. No value retrieved. Redeployed exact existing Test commit
caa3212 as dpl_BhTpje1R95zM18MVSHn3rCEa4EoZ, READY with branch alias.
Config remains enabled/open with Test key prefix (value not printed). Existing
source CI39410686188 green attempt1; configuration redeploy changes no source.

Baseline inbox0, fulfilled Test orders2, captured payments2. At19:47 IST there
were no genuine webhook requests in the preceding hour. Owner asked to replay
the existing failed Test payment.captured eventTptTB3J5reLMwT if dashboard offers
it; no new payment or signature bypass. Await genuine delivery before claiming
signature repair or resuming purchases.

Production read shows same runtime commit4a0c981 and checkout disabled; its
currently observed deployment is dpl_54raBgMjb4oZbtXSWc1KBuDrK4xQ (different
from prior observation). This agent invoked only the explicit Preview redeploy;
the separate Production redeployment cause is not established. No Live setting,
key, provider, schema or corpus changes performed here.

## Genuine signed Test acceptance — 2026-10-20 19:54 IST

Owner reports no dashboard replay action, then completes the guided499INR Test
top-up. Existing durable purchase0d11bc2c-243b-44b5-8caa-7d6643924caa /
order_Tptq7O7zpXk4Gh was reused (created19Oct20:31:44 UTC), fulfilled20Oct
14:24:12.829931 UTC. Provider paymentpay_TqC6tbs5B92glY is captured, Test mode,
49900paise. New genuine events all returned200 on the secret-update deployment:
payment.authorized TqC6z3fLwXfRZ1 at14:24:11.514 UTC;
payment.captured TqC6zwVAvIokL6 at14:24:12.344;
order.paid TqC70Q4dxvu1pv at14:24:12.762. Each inbox record is done on attempt1,
last_error NULL. This establishes real HMAC/merchant/inbox acceptance after owner
secret restoration, separately from the earlier unsigned control. No signature
or payload was printed, no validation bypass or source change.

Read-only exact purchase reconciliation:1 captured payment,1 invoice
NIY/2627/00003 total499,1 top-up lot granted/remaining20000 expiring20Oct2027
14:24:12 UTC,1 grant ledger entry20000. Three distinct event types and callback
processing did not duplicate the benefit/invoice. Wallet586286.87, debt0, equals
sum of active remaining lots586286.87. Active Pro65000 allowance and original
20Nov2026 01:40:12 IST end are unchanged. Do not infer duplicate delivery replay
or browser-closed recovery acceptance from these three different events.

Signature blocker resolved for new genuine deliveries. Remaining external
upgrade/queued-downgrade, duplicate/recovery/refund/invoice-view and launch gates
remain open. Old failed event retries were not replayed or claimed repaired.
Agent performed only read-only reconciliation and documentation here; owner
operated the simulated payment. Production web/settings/Live keys unchanged.
