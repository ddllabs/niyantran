# F221 test producer disposal evidence

> **Status: Living.** Authorized implementation and publication, October 17, 2026.

## Scope and mechanism

Only test source `src/lib/featureFeedTimeLimit.test.js` changes. The source stub
owns abort listeners and pending rejections. Disposal also refuses new fallbacks;
real live promises and controlled deferred loaders settle before fetch/timers
are restored and caches reset. Sharing and late-answer reuse remain tested.
Preferences source and all 36 preference tests are unchanged. No backend, SQL,
configuration, stored data, corpus ingestion or payment changes.

Base main/origin 54c24c4; preserved local diagnosis fbf3c07 and observation
34d6702 on task/f221-test-isolation. All npm/Node commands use
`NODE_OPTIONS='--import=/tmp/niyantran-cleanup-no-env/guard.mjs'`.

## Red/green execution

- `npm test -- src/lib/featureFeedTimeLimit.test.js -t 'feed producer isolation'`:
  original teardown fails both new cases, expected zero/one replacement fetch
  calls but received one/two. Real Cabinet loader, mocked source/network, fake
  clock crossing its 12-second deadline; no copied loader implementation.
  Log: /tmp/f221-red.log.
- `npm test -- src/lib/featureFeedTimeLimit.test.js src/lib/userPrefsSync.test.js`:
  58/58 pass after disposal, including unchanged preferences and late-answer cases.
  Log: /tmp/f221-focused.log. Guard subsequently strengthened to also require
  the PIB ViewRss fallback stayed under the disposed source and await its producer;
  final complete suite verifies that strengthened guard.
- `deno test -A --config supabase/functions/deno.json supabase/functions`:
  1,155 passed / zero failed (12 s).
- `npm run lint`: pass, zero errors/warnings.
- `npm run build`: pass (7.25 s); existing >500 kB chunk warning remains.
- `npm run check:bundle`: pass, entry 180,393 gzip bytes, limit 182,446.
- `node -e "import('./api/router.js').then(() => console.log('router import ok'))"`:
  pass, router import ok.
- `npm test`: 394 files / 6,194 tests passed, zero failed (179.76 s).
  Log: /tmp/f221-vitest.log. Both strengthened F221 guards pass.
- `git diff --check`: pass. Publication evidence follows when available.

## Read-only closure observation

At 17:08 UTC, production cron job 5 active */5 at expected Vercel refresh route;
latest three cron runs succeeded. 70 serving modules / 257 variants, zero
consecutive failures anywhere; last half-hour outcomes 14 ok / 23 unchanged.
Fixtures and both charts made a seventh genuine hourly observation at 17:05,
charts retain 25 rows each, fixtures latest 19. Daily references have not reached
the next interval. World Constitutions 188, zero failures, next October 18 15:45;
Growth 20, zero failures, post-F224 writer acceptance due October 18 after 15:55.
MLA reference (stored as MLA Report Card + Statement Tracker) has 500 items,
zero failures, next due October 18 10:45 UTC. Hourly closure automation remains ACTIVE. No refresh invoked or production write.
T15 remains open; payments held and corpus excluded.

## Review

Reviewed the causal assertions before the disposal code. The replacement mock is
not filtered or cleared: its total call count remains the asserted outcome.
Existing timeout and late-answer assertions are retained. Abort listeners are
removed on settlement; fallback requests reject while the original stub still
owns fetch. Custom deferred loaders are resolved, avoiding forever-pending test
promises. Final cleanup restores global state even after a test assertion fails.
The wrappers only capture injected live promises; production modules are imported
unchanged. No new dependency, global Vitest option, timeout increase or credential
access. Runtime, preference source and preference test diff against 54c24c4 is
empty. No required review finding remains. Local SQL fixtures are unnecessary for
this test-only change; the original branch/main CI SQL jobs will still be checked.

## Publication

Owner-approved task branch/main commit 389dbed8fdcee9f11963540c747c33cddb255953.
Branch CI 39052609249 and main CI 39052960359 both passed application and SQL
fixture jobs on attempt 1; no retry/cancellation. Preview
`dpl_13rS5n5qVHAFTNRSRGXGSKorx7BR` and production
`dpl_EC2dNBS1rX9ZPrcEBJDJydXmoqWh` READY at that exact SHA. Production URL
https://niyantran-six.vercel.app, deployment niyantran-9ukoy1j6a-ddl-labs.vercel.app.
Authenticated CLI GET used exact project prj_6UiaDz2rkTOmqIOaXnCAs92V7d86 and
team team_QFu1p3ObeXmlMQczPBcZb582; no environment/credential file read.

Final documentation records F221 Done and keeps T15 open. This prose-only
follow-up does not require a repeat local code suite; its actual deployment and
original CI are checked after publication. Existing Vite large-chunk warning and
GitHub's ubuntu-latest migration notice remain informational. No backend rollback
needed; revert the test-only commit on a task branch if required. Production
rollback to pre-F221 dpl_7zhiGvtmhrZ3zb83xYyNg9i4ZMgT / 54c24c4 requires owner
approval. No Edge Function, schema/data, cron, serving flag, corpus or payment
change. Hourly monitor ACTIVE; no overall M1/M2 closure claimed.
