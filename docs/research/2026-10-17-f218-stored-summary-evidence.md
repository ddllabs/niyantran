# F218 execution and release evidence

> **Status: Living.** 2026-10-17. Owner authorized verification, push and deploy.

## Baseline and implementation

Clean main and fetched origin/main both `dbaa415`; origin is the DDL Labs fork.
Task branch `task/f218-stored-summary`. Last known production deployment
`dpl_D6np52MsRsyCRyj9jMXrkzP34XZV` READY at that same commit, exact project
`prj_6UiaDz2rkTOmqIOaXnCAs92V7d86`, team `team_QFu1p3ObeXmlMQczPBcZb582`.

Fresh pre-change production GETs: summary 200/live, count 12; module 200/store,
12 prepared rows, fetched `2026-10-17T10:10:04.033Z`. This upstream recovery
does not invalidate the earlier recorded summary 502. The routing difference
is the root cause of avoidable source dependency.

Both routers now choose the existing stored-first module loader only for the
canonical Satellite Infrastructure Global summary. Other landing loaders are
unchanged. Summary keeps `served`, `fetchedAt`, and stale/age markers. It retains
the prepared-row count, source links and incomplete-inventory limitation; a
fetch timestamp is not represented as a source observation date.

## Regression and local gates

Tests mock external fetch with a synthetic database URL/key and real RPC
envelopes; real routers, store reader, source adapter and projection execute.
Production mode prevents local backup workbooks from masking an upstream outage.
Loader caches are disabled only inside test requests. No real services are
called by the new tests.

- Initial production-mode red: 4 failed / 14 passed. Fresh and stale snapshot
  cases returned 502 in both original routers.
- Restoring only `api/router.js` to live-first: one fresh-store regression fails
  (502 versus 200), the Vite regression passes. Restoring only Vite routing:
  the opposite fails. Fixed source restored after each experiment.
- Fresh snapshot returns its two prepared launches and source without any
  upstream call. Stale snapshot returns its original time and age after failed
  live read. Missing, disabled, empty and beyond-ceiling snapshots keep outage
  semantics; ceiling test asserts the ceiling rejection itself. Missing-store
  live success still works. Validation and POST rejection make no data calls.

Node commands use the existing temporary no-dotenv preload through
`NODE_OPTIONS=--import=/tmp/niyantran-cleanup-no-env/guard.mjs`, preventing local
environment file reads. No credential files were opened.

| Command | Result |
| --- | --- |
| `npm test -- src/lib/globalLandingApi.test.js src/lib/feedServe.test.js src/lib/feedStoreRows.test.js src/lib/globalLandingSummary.test.js` | 146/146 pass |
| `npm test` | 391 files, 6,126 tests pass, 84.47 seconds |
| `npm test -- src/lib/globalLandingApi.test.js` after tightening ceiling fixture/assertion | 18/18 pass |
| `deno test -A --config supabase/functions/deno.json supabase/functions` | 1,150 pass, zero failed |
| `npm run lint` | Pass, zero warnings |
| `npm run build` | Pass, 5.42 seconds; existing >500 KB lazy chunk warning |
| `npm run check:bundle` | Pass, entry 180,398 B gzip, no increase/schema leak |
| `node -e "import('./api/router.js').then(() => console.log('router import ok'))"` | Pass |
| `git diff --check` | Pass |

The full suite preceded the final test-only ceiling-fixture tightening; focused
tests passed afterwards. Exact committed source will also run in CI before
production. No local SQL/container run is needed for this route-only fix; CI's
unchanged disposable SQL job remains a release gate. No standalone typecheck.

## Review and scope

Reviewed tests first, then every implementation path for correctness, bounded
reads, compatibility, errors, security and count/source honesty. Reuses canonical
store semantics and keeps input validation ahead of I/O. No new dependency,
service grants, provider calls, configuration, schema or data migration.
No corpus, payment or protected dataset changes. Existing large lazy chunk and
runtime DEP0169 warnings are outside this fix.

## Closure status

Read-only production check: 70 distinct modules / 257 variants serving, zero
states above three consecutive failures. World Constitutions has 188 keys and
its next daily check at October 17 15:40 UTC; MLA reference last refreshed at
October 17 10:45 UTC with 500 records, next due October 18 10:45 UTC. Real daily
opportunities have not elapsed. T15 stays open and payment work has not started.
The owner's hourly follow-up remains responsible for these real windows.

## Authorized release and production verification

Code commit `0e2ebfb8ccf4b55cf31d335b5a0540729d05be85` pushed first to the
task branch. [Branch CI 39028020440](https://github.com/ddllabs/niyantran/actions/runs/39028020440)
passed both jobs on first attempt: 391 files / 6,126 Vitest tests, 1,150 Deno
tests, lint/build/router import and unchanged-public-data check; 41 SQL fixtures,
41 vacuity checks and 10 Down/reapply checks. Fast-forward merged main and pushed
with owner approval. [Main CI 39028299148](https://github.com/ddllabs/niyantran/actions/runs/39028299148)
also passed both jobs on first attempt. No retry or empty commit.

Vercel production deployment `dpl_GFrsGgPzU3A8mjzmHuGUoYrcQeaX`,
`https://niyantran-nckhgd2m7-ddl-labs.vercel.app`, target production, is READY
at that exact code commit in the verified team/project. CLI inspection confirms
the `niyantran-six.vercel.app` alias. No database or Edge Function deployment.

Read-only production GETs with cache-bypassing probe parameters:

| Endpoint | Result |
| --- | --- |
| Satellite Global landing | 200, ready, count 12, `served: store`, 775 ms |
| Satellite module | 200, 12 prepared rows, `served: store`, 450 ms |
| Both Satellite responses | Same `fetchedAt: 2026-10-17T11:15:01.824Z`; source observation date remains honestly null |
| Global Commodities summary | 200, intentionally unavailable/null count |
| Nuclear Watch summary | 200, ready, count 112, unchanged source date |

Satellite summary preserves The Space Devs source link and the “not a complete
satellite or constellation inventory” limitation. Summary has no full rows.
The scheduled source refreshed naturally during this task; no manual refresh.

Isolated Chrome at 1280×844 and 390×844 loaded the real Global landing components
and summary loader through a local GET-only proxy to the production Satellite
summary. Both show “Upcoming launches” with 12 records and the correct canonical
module href/navigation callback. No page errors or horizontal overflow. No
production authentication/session, analytics writes or external page requests.
Only this module's summary was loaded in the harness; other module placeholders
are deliberate. Initial harness attempts exposed missing temporary dependency
linkage and an incorrect assumed detail-dialog interaction; corrected the harness
to test actual direct module navigation. Final ordinary and reduced-motion runs
pass; stable mobile screenshot visually inspected. No product code was changed
to accommodate the harness. Temporary harness compilation emits a Babel size
notice for React DOM; the production build warning remains the known lazy chunk.

Bounded logs for the exact deployment: request query `httpStatus >= 500`,
11:06:56–11:21:56 UTC, returned zero records, no further page. Runtime error query,
11:07:32–11:22:32 UTC, returned nine records, all existing DEP0169 `url.parse`
deprecation warnings; zero other errors and no further page. These are bounded
observations, not a long-duration reliability claim. GitHub also warns of its
upcoming Ubuntu 26 runner-image transition; no workflow change in this task.

F218 is closed in the tracker with the code hash. The follow-up documentation
commit records these actual results; T15, F219 and newly observed F220 remain open. Corpus ingestion
and payment integration remain untouched.

## Later documentation CI failure — F220

Documentation commit `d77ee6b85789a50ffb46321cd86098102f0c5c09` contains no
changes under api/server/src/supabase, configuration or dependency files compared
with the verified F218 commit. Its production deployment
`dpl_FuSD477XLfANhMQVWKLi3TFfafQ6` is READY and the final alias GETs again return
12/store from summary and module with the same fetched time.

[Documentation CI 39028606428](https://github.com/ddllabs/niyantran/actions/runs/39028606428)
passed lint/build/router/Vitest/public-data and the full SQL job, but Deno reports
1,149 pass / 1 fail: “F199: an answer call that has written nothing by the reserve
line is cut and rewritten at the lower effort”, `agent_test.ts:2036`. The fourth
request's reasoning is high instead of low. The test's `reserveIn(80)` and runtime
watchdog use real elapsed time; exact race/cause and runtime impact are not yet
established. Both files are unchanged from the pre-F218 baseline; their last
test commit is `71f4897`.

Read-only diagnosis command, five separate local executions:

```bash
deno test -A --config supabase/functions/deno.json --filter 'F199: an answer call that has written nothing' supabase/functions/research-chat/agent_test.ts
```

All five focused executions pass. This does not erase the failed CI run or prove
the runtime safe at the boundary. No CI rerun, extra model call, research source
edit or production mutation was used for diagnosis. Recorded F220 in the sole
tracker under the rule to report defects outside the write scope. Overall T15
closure now includes clearing this finding as well as real scheduled intervals;
the earlier three first-attempt green runs remain historical evidence. F218's
local, code-CI and production/browser acceptance evidence remains valid.
