# F223 verification and release evidence

> **Status: Living.** Owner approved the scoped implementation and push/deploy
> on 2026-10-17. Local verification complete; release verification in progress.

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
