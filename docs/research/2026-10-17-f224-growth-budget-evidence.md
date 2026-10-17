# F224 Growth request budget verification and release

> **Status: Living.** Owner approved implementation, verification and push/deploy
> 2026-10-17. Release checks must be observed before claiming deployment complete.

## Scope and baseline

Started clean on closure-observations at f4802c3, preserving eb6c7eb/aa174fa and
F224 diagnosis, then created task/f224-growth-budget. Fetched main/origin both
731428f. Pre-release exact-team/project READY rollback target is
`dpl_ERp34386wrtss2MC124xCnC12pqW`, source 731428f. Rollback requires approval.

Only three runtime paths change: resourcesApi.mjs (Growth only), sourceAttempt.mjs
(private active-time JSON helper) and feedStore.mjs (opt-in lifecycle bridge,
closed-host HTTP error metadata and opt-in hard-end admission guard). Standard
host scheduling, module/whole-run budgets, concurrency, source URLs, country set,
other loaders, store SQL and cache policy remain unchanged.

## Executed defect proof and implementation review

- Initial 21-case suite on original runtime: 19 failed / 2 passed.
- Expanded 25-case suite replayed on original resourcesApi/feedStore: 23 failed /
  2 passed. Runtime files restored with try/finally before subsequent checks.
  The first replay also exposed an unhandled rejection in the new direct-load
  test; attached its rejection handler immediately, then replayed: same 23/2
  expected failures with no unhandled error.
- Focused 25-case fixed suite plus existing feedStore/cache suites: 127 passed.
  Full first fixed run: 6,191 passed / 394 files in 93.37 s; Deno 1,155 pass.
- Review added one body-disposal regression: the partly fixed helper leaves a
  failed HTTP body's stream uncancelled before retry. Focused guard failed on
  that helper, then passed after cancellation was added. Final suite has 26
  cases; final full commands are recorded below. No guard disabled or loosened.

The real loadGrowth + refreshDue are exercised, only network/RPC are fake.
Tests cover healthy row/value/missing-value/order/link compatibility, stalled
first/middle/final series with bounded recovery, active budget exhaustion,
permanent errors, invalid JSON/HTTP-200 API errors/pagination, body stalls and
transport disconnects, refused-host policy, direct cache behavior, 38 s queued
without premature timeout and hard-end queued cancellation. Fixed-series logs
are checked for absence of raw transport text/URLs. Worker failure records carry
no replacement items, preserving the existing last-success store contract.

Review: six seconds per attempt, eighteen active seconds total, sequential
series and at most one retry per series. No clock while waiting behind another
module. No native-fetch symbol metadata; the gate strips the opt-in lifecycle
bridge. Queued cancellation cannot become a transport retry. A gate deadline
race found by the cancellation guard is handled only for opted-in requests;
existing module timer determines timeout. Closed-host errors retain their known
HTTP code so 403/429 cannot become a retryable transport failure. All logs use
fixed IDs/codes/numbers, no raw payloads/errors/caller fields. No dependencies.

## Pre-release read-only inventory

Growth store: 20 items, ordered variant/key/content-hash MD5
`61f43147d63f27027dcf2def9da18f4c`, zero failures. fetched_at October 17
15:55:02.002558 UTC, next_due_at October 18 15:55:02.002558 UTC. All ten Edge
Function versions/bundle hashes/verify_jwt settings saved for comparison; none
is deployed by this release. Corpus function versions remain 21/3/4.

## Verification commands

Node/npm used external NODE_OPTIONS preload
`--import=/tmp/niyantran-cleanup-no-env/guard.mjs` to prevent dotenv reads.
No standalone type-check exists. No local SQL/Docker needed for this source-only
change; CI still executes its disposable SQL fixtures.

Final gates and rollout evidence follow after execution. Existing lazy chunk
size warning is preserved; it is not resolved or suppressed under F224.

## Final local gates

| Exact command | Result |
| --- | --- |
| `npm test -- src/lib/growthRequestBudget.test.js src/lib/feedStore.test.js src/lib/apiCachePolicy.test.js` | 128 passed / 3 files, including 26 Growth cases; 8.03 s. |
| `npm test` | 6,192 passed / 394 files; 93.85 s, first full run of final runtime. |
| `deno test -A --config supabase/functions/deno.json supabase/functions` | 1,155 passed, zero failed; 9 s. |
| `npm run lint` | Passed, no errors/warnings. |
| `npm run build` | Passed, 10.16 s; existing >500 kB lazy-chunk warning. |
| `npm run check:bundle` | Passed, 180,393 B gzip initial entry (baseline 180,398), no terminal schemas. |
| `node -e "import('./api/router.js').then(() => console.log('router import ok'))"` | Passed. |
| `git diff --check` | Passed. |

Earlier gates were rerun because the response-body cleanup changed runtime.
No unrelated tests were changed, disabled, timed out later or rerun to hide a
failure. F221 did not reproduce and stays separately open. No SQL/schema/test
fixture change, no source data regeneration and no production write occurred
in local verification. Complete runtime/test diff reviewed against the spec;
only this opt-in request bridge and Growth behavior changed.
