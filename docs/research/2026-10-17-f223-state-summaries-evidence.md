# F223 verification and release evidence

> **Status: Living.** Owner approved the scoped implementation and push/deploy
> on 2026-10-17. Local and production checks passed; final CI/documentation checkpoint is verified separately after publication.

## Baseline and scope

Started from clean main/origin at `5302dc3` after fetch. Preserved local
documentation-only closure observations `1107bff` and `2d361e0` by fast-forwarding
them onto `task/f223-state-summaries`. No unrelated runtime changes.

Both routers now choose the existing stored-first loader only for State
`MLA Directory` and `MLA Report Card + Statement Tracker`. The State projector
carries fetchedAt and stale/ageMinutes without replacing asOf. The shared
server adapter warns only with validated catalogue feature names, fixed reason
codes and allowlisted served values on failed summaries. Raw exception text,
source diagnostic strings and caller values are not included in the new logs.
Other routes, counts, sources, timers, dataset keys and permissions are unchanged.

Read-only diagnosis before implementation: 35/36 State summaries passed; MLA
Directory 502 in 4.15 s versus its module store 200 in 0.59 s. A subsequent
summary returned 200, consistent with late-live cache behavior. The two original
13:08 UTC request logs omit feature/query; their exact modules remain unknown.
Local execution of the proposed canonical helper against actual module responses
returned ready/store counts (Directory 496 sampled rows, Profiles 500) without
calling the deliberately failed injected upstream. This diagnosis is not proof
of the identity of both original requests.

## Executed local verification

Node/npm commands used the existing external
`NODE_OPTIONS='--import=/tmp/niyantran-cleanup-no-env/guard.mjs'` preload, which
prevents dotenv reads. The repository has no standalone type-check.

| Command/check | Result |
| --- | --- |
| New `stateLandingStored.test.js` against original four-file runtime | 9 failed / 10 passed. Fresh/stale store selection and diagnostics guards fail as intended. Original runtime restored only inside a try/finally diagnostic; fixed files restored afterward. |
| Only original State projection, fixed routing retained; focused metadata name filter | 6 failed, 13 cases not selected. Counts/store selection work but fetchedAt/stale metadata is absent. Fixed projection restored afterward. |
| `npm test -- src/lib/stateLandingStored.test.js src/lib/stateLandingApi.test.js src/lib/stateLandingSummary.test.js src/lib/stateLandingParity.test.js` | 143 passed across 4 files; 2.46 s. |
| `npm test` | 6,166 passed across 393 files; 90.35 s, first full run. |
| `deno test -A --config supabase/functions/deno.json supabase/functions` | 1,155 passed, 0 failed; 6 s. |
| `npm run lint` | Passed, zero errors/warnings. |
| `npm run build` | Passed; 6.76 s. Existing large lazy-chunk warning remains. |
| `npm run check:bundle` | Passed: 180,393 B gzip initial entry, 5 B below baseline, no terminal schemas. |
| `node -e "import('./api/router.js').then(() => console.log('router import ok'))"` | Passed. |
| `git diff --check` | Passed. |

The first new-suite run before the final diagnostic case had 8 failed / 10
passed; the final 19-case suite was replayed on the original runtime as above.
Existing parity tests exercise all 36 configured State modules and print
expected failed-source warnings; new structured warnings are expected in those
failure fixtures. No tests disabled or timeouts raised. F221 did not reproduce
in this full run and remains separately open. No local SQL/Docker test was
needed because no SQL, schema, permissions or migration changed.

## Pre-release read-only production inventory

At 15:31 UTC, both MLA stores were serving and had zero failures:

| Store | Variants | Items | Ordered variant/key/content-hash MD5 |
| --- | ---: | ---: | --- |
| MLA Directory | 31 | 4,104 | ae68f9f99db892082df56511d58f0a08 |
| MLA Profiles | 1 | 500 | d68df47816e5534b63095b00d646a242 |

Directory fetched October 15 08:56:42–08:57:08 UTC; Profiles fetched October 17
10:45:02 UTC. The directory's normal cross-state response is 496 sampled rows,
with a note identifying the full 4,104-item register. No completeness change.
Cron job 5 remains active every five minutes and its command targets the expected
Vercel refresh endpoint (boolean-only check, no secret/command retrieved).

All ten Edge Function versions/bundle hashes/verify_jwt settings inventoried for
comparison. Ingestion versions: ingest-documents 21, ingest-worker 3, admin-ingest
4; research-chat 66 and desk-brief 17. No function invocation/redeploy or schema
write is part of this release.

Vercel exact project/team readback confirms pre-release READY deployment
`dpl_9x4jNNLXBW1iNySGQ6WADtji4JNs` at `5302dc3` as the rollback target.
Rollback requires owner approval. No secrets, protected data files, forced feed
refreshes, production data/config/timer/serve writes, model calls, corpus work
or payment work were used. Hourly closure follow-up stays active.

## Review

Reviewed four runtime files plus the 19-case suite against the approved spec:
one exact-feature selector shared by both routers; canonical store/freshness/
fallback logic reused, no duplicated storage rules; time metadata additive;
safe bounded log fields only; no dependencies, extra network calls or migrations.
The two adjacent loader comments were corrected after checks; their semantics
match the verified code. The complete runtime will also be exercised in CI.
Production and final CI evidence must be observed before claiming release done.


## Approved release and production acceptance

Runtime commit `0c1319c056b1198c182bd16f032920a47e687771` was pushed on the
approved task branch after local gates. Branch CI
[39045568101](https://github.com/ddllabs/niyantran/actions/runs/39045568101)
passed both app and disposable-Postgres SQL jobs on attempt 1. Main was
fast-forwarded and pushed without overwriting any work. Production deployment
`dpl_8cMAHjxjfBroGdaPLeHz1MwNuJdp`,
`niyantran-bhsqf7919-ddl-labs.vercel.app`, is READY at that exact source, with
`niyantran-six.vercel.app` alias. Team/project scope was checked explicitly.
Main CI
[39045994021](https://github.com/ddllabs/niyantran/actions/runs/39045994021)
also passed both app and SQL jobs on attempt 1. Final documentation publication
CI/deployment is checked after push and reported separately. No retry, cancelled
run or empty commit was used.

Read-only production acceptance at approximately 15:40 UTC:

| Feature | Summary/module HTTP | Summary time | Summary count / module rows | Full stored count | Provenance |
| --- | --- | --- | --- | --- | --- |
| MLA Directory | 200 / 200 | 0.804 s | 496 / 496 | 4,104 | store |
| MLA Profiles | 200 / 200 | 0.637 s | 500 / 500 | 500 | store |

Both source notes exactly match their module responses. Directory fetchedAt is
`2026-10-15T08:57:08.221Z`, Profiles `2026-10-17T10:45:02.365Z`, exactly matching
the corresponding modules. Both retain null asOf, no stale flag, and no rows in
the summary response. These are executed production checks, not a claim based
only on code. No cache-bypass/refresh request was sent.

Read-only post-deployment store fingerprints match the pre-release inventory
exactly (4,104 Directory / 500 Profiles); all ten Edge Function versions,
bundle hashes and verify_jwt settings also match exactly. No function or
migration was deployed. The original two 13:08 failure feature names remain
unknown; this closes the reproduced MLA routing defect without identifying
those original requests retroactively.

A bounded deployment request/error query, as observed around 15:41 UTC, returned
zero HTTP 5xx and no pagination/excluded intervals. Runtime errors returned ten
known Node DEP0169 url.parse deprecation warnings, zero other error records.
Requested bounds were 15:38–15:42 UTC; the observation occurred before the end
bound, so this is evidence only through the actual query time, not a guarantee
about the entire requested interval. This does not establish absence of all
future errors or errors on unrelated deployments.

Closure health remains separate: feed-refresh job 5 active every five minutes
at the expected Vercel URL, six recent cron successes; 70 serving modules / 257
variants, zero sources above three failures. Fixtures and charts completed a
fifth ordinary hourly opportunity at 14:55 UTC. Reference daily observations
remain pending; no forced refresh, model call, corpus or payment operation.
Hourly follow-up remains ACTIVE. Existing large lazy-chunk and Node deprecation
warnings, the separate F221 isolation finding and F219 documentation work remain.
