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

Release CI, production commit/response and browser results will be recorded
after the authorized push/deploy.
