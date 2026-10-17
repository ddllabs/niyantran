# F224 Growth Indicators read-only diagnosis

> **Status: Living.** Read-only diagnosis authorized 2026-10-17; backend changes,
> push/deploy and forced refresh are not authorized by this task.

## Observed production evidence

Growth Indicators uses the geopolitics default variant, daily reference schedule
(1,440 minutes). Two ordinary refreshes on October 17 failed: 15:45:00.454 UTC
and 15:50:00.671 UTC. feed_runs records timeout after 20,007 / 20,008 ms with
exact reason `no answer within the module limit of 20 s`. They retained the
20 previously successful rows, last fetched October 16 15:40 UTC.

The next ordinary refresh at 15:55:01.582 UTC recovered without an intervention:
356 ms, unchanged, 20 items. State failures reset to zero, fetched_at
15:55:02.002558 UTC, next due October 18 15:55:02 UTC. A public read-only module
GET then returned HTTP 200/store, 20 rows, matching fetchedAt, no stale flag,
in 0.324 seconds. No refresh endpoint was invoked.

## Code and bounded reproduction

`server/resourcesApi.mjs:loadGrowth` launches GDP growth, inflation and
unemployment requests for the existing 20-country set via Promise.all. Each
getJson starts a 25-second timer. `server/feedStore.mjs:RunGate` intentionally
serializes requests to the same host, including response-body reads. The
refresh module budget is 20 seconds (time spent only waiting behind another
request is excluded, active request times accumulate). Cache bypass during
refresh is deliberate, so a previously cached answer cannot manufacture success.

A temporary local diagnostic called the real loadGrowth and refreshDue with
mock fetch and RPC: three 30-ms requests succeed concurrently outside refresh
(three active requests), but the actual host gate times out under a scaled
60-ms module budget after two requests start. No real database/network calls
were made by that diagnostic. This demonstrates the cumulative-latency risk;
it does not prove which request stalled in the actual production failures.
Production errors provide no per-indicator timing or status.

Three bounded public upstream GETs of the exact current single-series URLs
all returned HTTP 200 and 20 records: GDP 0.326 s, CPI 0.261 s, unemployment
0.477 s from the diagnostic client. Local reachability/timing is not Vercel
region evidence. Together with natural recovery, evidence fits a transient
upstream/network stall, exposed by the request/deadline mismatch. No persistent
source outage, schema/store defect, rate-limit code or data corruption proved.

## Proposed fix and exclusions

No emergency production change is justified after natural recovery. Proposed
narrow follow-up, subject to owner approval and a spec/plan:

1. Growth-specific per-indicator diagnostics: fixed series identifier, elapsed
   time, bounded status/reason code. Never raw bodies, credentials or full URLs.
2. Align Growth request timeout/cancellation with the worker's existing budget.
   Bound any transient retry by the remaining budget; at most one retry for
   retryable transport/5xx failure, none for 403/429 or invalid responses. Do not
   raise global deadlines, concurrency, host limits or change the scheduler.
   Exact per-request allocation must be tested with the real host gate, including
   queue time and cancellation; do not replace one timeout with early false failures.
3. Preserve all-or-failure semantics for the three requested series, existing
   country set, row keys, values and missing-value behavior. Keep the last good
   stored data if any required request fails; never record a partial answer as
   a complete successful refresh or invent zeroes.
4. Prove guards fail on the old behavior: stalled first/middle/final request,
   cumulative slow requests, cancellation of queued work, transient recovery,
   permanent errors and healthy unchanged output. Run both full test suites,
   lint/build/router checks before proposing rollout. Final production acceptance
   must use the next real scheduled refresh, not a forced retry.

Single-call batching is a possible later optimization, not a deployable fix yet.
The official World Bank API documents semicolon-separated indicators plus a
source ID: [API call structures](https://datahelpdesk.worldbank.org/knowledgebase/articles/898581-api-basic-call-structures).
However, the proposed full-set multi-indicator query and a two-country control
both returned HTTP 502 in bounded public probes; an earlier full-set attempt
also failed HTTP. No claim of batch compatibility or stable latency is made.
Do not replace the currently working source path on that evidence.

## Scope and closure

Only diagnosis/tracker documentation changed locally. No backend source, SQL,
Edge Function, production data, serve flag, timer, dependency, corpus or payment
change. No secrets/dotenv/credential-folder reads, no provider calls. Working
production remains `731428f`. Hourly closure checks remain ACTIVE. Retries and
repeated reads do not count as independent daily opportunities; T15 remains open.
