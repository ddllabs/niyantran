# F224 Growth Indicators request budget

> **Status: Normative.** Owner approved scoped implementation, verification and
> push/deploy on 2026-10-17. No corpus or payment work.

## Current state and outcome

[Read-only diagnosis](../research/2026-10-17-f224-growth-indicators-diagnosis.md)
records two 20-second worker timeouts followed by natural recovery. Three
25-second World Bank calls are serialized by the refresh host gate. Production
logs cannot identify the stalled series. Preserve all existing source URLs,
20-country set, row projection, cache policy and missing-value semantics.

Growth alone will fetch its three series sequentially. Each attempt has at most
6 seconds of active request/body time; all attempts together have 18 seconds.
One retry per series is allowed for transport failure, active timeout or HTTP
500/502/503/504, only within remaining budget. Never retry 403/429, other HTTP
errors, malformed JSON or invalid/paginated response shape. No partial successful
answer or cache write if a required request fails. The worker still retains its
last successful store; its module limit remains 20 seconds.

A private request lifecycle hook pauses the attempt clock while RunGate queues
for a host, starts it at source admission, and propagates worker cancellation.
Only Growth opts into this hook; other loaders retain exact behavior. Hard worker
end/cancellation outranks retry. Logs contain only constant series IDs, attempt,
code, optional HTTP status and measured active milliseconds, never raw errors,
URLs, bodies or caller data. Use success info and failure warnings.

## Scope and evidence

Runtime: `server/resourcesApi.mjs`, `server/sourceAttempt.mjs` (new narrow active
request helper), `server/feedStore.mjs` (optional lifecycle hook only). Tests:
`src/lib/growthRequestBudget.test.js` new; existing feedStore/cache/API suites.
Docs: this spec/plan, diagnosis/evidence, cleanup record, tracker and coordination
Operations entry. No SQL, Edge Function, feed schedule, permission, deployment
configuration, source replacement, forced refresh or data repair.

Prove red/green through real loadGrowth + refreshDue with only network/RPC fake;
healthy projection, three series stalls/recovery, budget exhaustion, 403/429 and
invalid response refusal, queued time exclusion, queued cancellation and safe
logs. Full Vitest/Deno, lint/build/router/bundle and original CI app/SQL gates.
Deployment must match main. Public stored GET must preserve rows/fetch metadata.
Post-deploy writer acceptance waits for the next genuine scheduled daily refresh;
never force refresh or claim a stored GET exercised the new writer. T15 remains
open until its real observation gates pass; hourly follow-up continues.
