# F222 local verification

> **Status: Living.** Local implementation verified on 2026-10-17. Owner
> subsequently approved push/deploy; production verification completed.

## Scope and baseline

Runtime commit: `294a273` on `task/f222-market-ids`. Began from clean `main`
at `2dd8ecd`; `git fetch origin` succeeded and comparison was 0 ahead / 0 behind.
One checkout, only the origin remote. No push, merge to main or deployment.

`src/lib/econPack.js` adds optional bounded `market_id` to Political Odds and
Election Forecast rows. The provider ID passes through the existing serializer
and reader. `src/lib/manifoldIdentity.test.js` covers both real loaders with
synthetic network responses and the existing store serializer/reader with
injected RPC. No live database was used as a write-test target.

## Read-only findings before implementation

Four public Manifold slug GETs answered 200 with these provider IDs:

| Slug | ID |
| --- | --- |
| multi-year-market-will-ai-be-as-big | ID6kwWLe5F8myzBfcQrh |
| will-abortion-be-a-big-political-is | pLKLenwiuup5T33rTFuP |
| will-bjp-remain-the-ruling-party-in | KaQNzjn59n6ZFJUULr5E |
| will-india-hold-the-general-electio | 71HrZB6BABAlBDVAqryB |

All four returned `creatorUsername: _deleted_`, `isResolved: false` and future
closing timestamps. The BJP probability was `0.796892931957953`, matching the
stored rounded 79.7. No source request was added to the production pipeline.
The initial sandboxed public requests failed DNS; the same four bounded GETs
succeeded with network access. These were public reads, not forced feed runs.

The preceding database review observed 61 default (`''`) and 197 named variants
in feed_state, no NULL variants, no orphan items/daily rows, and no future
feed_daily.day. The BJP market had one daily snapshot on each of October 15–17
and one feed_items record. No exact duplicate JSON payload occurred within the
same feed/variant/day. Matching titles on different market URLs were distinct
source markets. Raw prediction `date` and `close_time` both mean market closes;
the current board columns already label them CLOSES. No data cleanup was justified.

## Executed verification

Every Node/npm command below used
`NODE_OPTIONS='--import=/tmp/niyantran-cleanup-no-env/guard.mjs'` to prevent
dotenv reads. The guard is external local tooling, not a repository change.

| Command | Result |
| --- | --- |
| `npm test -- src/lib/manifoldIdentity.test.js` before runtime edit | 5 failed / 16 passed; required IDs were undefined in both loaders, both serialized outputs and the political-row projector. Expected red evidence. |
| `npm test -- src/lib/manifoldIdentity.test.js src/lib/electionMarkets.test.js src/lib/econLive.test.js src/lib/feedStore.test.js src/lib/feedServe.test.js src/lib/feedSchedule.test.js` | 206 passed across 6 files; 7.25 seconds. |
| `npm test` | 6,147 passed across 392 files; 85.54 seconds; first full run passed. |
| `deno test -A --config supabase/functions/deno.json supabase/functions` | 1,155 passed, 0 failed; 6 seconds. |
| `npm run lint` | Passed, zero errors/warnings. |
| `npm run build` | Passed; 6.04 seconds; existing warning for lazy chunks above 500 kB. |
| `npm run check:bundle` | Passed; initial entry 180,393 B gzip, 5 B below baseline; no terminal schemas. |
| `node -e "import('./api/router.js').then(() => console.log('router import ok'))"` | Passed: router import ok. |
| `git diff --check` | Passed before implementation commit. |

The 21 new cases include absent/null/non-string/empty/malformed/oversize IDs,
same-question distinct markets, valid IDs from deleted creators, future closing
dates, legacy rows without IDs, and ID preservation through JSON serialization
and reading. Adding metadata leaves item keys identical and changes the content
hash, as expected for an enriched row. No claim is made of an executed SQL
transaction or deployed behavior. Focused tests print expected feed fallback
diagnostics; the full suites also emit their existing failure-path diagnostics.
The previously recorded F221 preference-test interference did not reproduce in
this full run and remains open; no preferences changes were made.

## Review, release and limitations

Reviewed the full runtime/test diff against the spec: eight additive runtime
lines, no new network calls or dependencies, valid bounded string metadata only,
no key-generation/filter changes, and no schema or permissions changes. Explicit
columns do not expose an extra UI column. Historical daily rows are not rewritten.

After an approved release, normal refreshes will enrich returned markets under
their existing keys and update the current daily observation. Earlier daily
snapshots remain untouched. URL-based storage identity still depends on URLs;
switching it to provider IDs would be a separate approved migration. This task
does not claim to eliminate URL churn or compare independent markets as one.

No production writes, forced refreshes, schedules/serve flags, Edge Functions,
model calls, SQL migrations, data-file edits or Docker containers were used.
Corpus ingestion and payment integration remain out of scope. The existing
closure follow-up was not changed, and this metadata improvement adds no M1/M2
closure gate. Reverting the mapper commit is sufficient rollback; optional
stored IDs can remain without affecting existing readers.

## Authorized release — 2026-10-17

Owner explicitly approved pushing/deploying F222 and requested that closure
monitoring continue, corpus stay excluded and payment integration stay held.
Fetched origin before release: main still equalled origin/main at `2dd8ecd`,
working tree clean. Runtime/test files remain exactly the verified `294a273`
versions; later task commits contain scope/evidence/closure documentation.

Release target independently read back from the Vercel project API and explicit
project inspect: `ddl-labs/niyantran`, project
`prj_6UiaDz2rkTOmqIOaXnCAs92V7d86`, team
`team_QFu1p3ObeXmlMQczPBcZb582`. The checkout has no CLI project link, so an
unqualified inspect reported link_required; explicit project-name inspection
succeeded without linking or changing configuration. The authenticated API
fallback stayed in the exact approved team/project.

Pushed branch head `e1a5557314e812638ee94976f843e75ac6feadad` after recording
the owner's release approval. Ordinary branch CI
[39034204827](https://github.com/ddllabs/niyantran/actions/runs/39034204827)
passed Build and tests plus SQL fixtures on attempt 1. Preview
`dpl_2ejTW1cpNsHwEf1gNQJomJNFgm8W`
(`niyantran-qgth6x625-ddl-labs.vercel.app`) is READY. After that green,
fast-forwarded main and pushed the same head. No retries, cancellations, empty
commits, config changes or manual duplicate deployments.

Production deployment `dpl_CPAJgveM9dZ5AZSYKP7mjDaf5wmx`
(`niyantran-98cdfv4z3-ddl-labs.vercel.app`) is READY at `e1a5557`.
The production alias answered both `/api/feature-feed` requests with HTTP 200,
`served: store`: Political Odds 204 rows and Election Forecast 17 rows, initially
without IDs because their stored records still came from the 12:50 UTC refresh.
This verifies legacy record compatibility, not enriched storage yet.

Pre-release October 15–16 prediction daily history: 598 rows, fingerprint
`a2816d41c3197f48fe4877beeffe6695`, computed from ordered feed identity, item
key, day, JSON payload and recorded timestamp. Read back unchanged at 12:59 UTC.
Cron job 5 stays active `*/5 * * * *` and targets the expected production Vercel
refresh URL (boolean-only command check). Normal next due times are just after
13:05 UTC, so the 13:10 scheduled poll is the expected enrichment opportunity.
No forced refresh or due-time adjustment.

Bounded runtime error/fatal scan for this deployment, 12:56:00–12:57:39 UTC:
10 records, all existing Node DEP0169 `url.parse` deprecation warnings; zero
other error records, no pagination remainder. This is a bounded observation,
not a claim of no errors outside that window.

Main CI [39034521190](https://github.com/ddllabs/niyantran/actions/runs/39034521190)
passed both app and SQL jobs on attempt 1. No source/config/dependency changes
exist between the tested `294a273` implementation and the release head.
All ten Edge Function versions, bundle hashes and verify_jwt settings read back
identical to the pre-release inventory; ingestion functions remain
ingest-documents v21, ingest-worker v3 and admin-ingest v4. No Edge Function was
invoked or deployed for this check.

### First ordinary refresh and served IDs

The real 13:10 UTC cron opportunity completed successfully, without any forced
refresh or scheduler change. Political Odds started at 13:10:00.172 and recorded
204 items at 13:10:02.555622; Election Forecast started at 13:10:00.173 and
recorded 17 at 13:10:07.683078. Both outcomes ok, both new_items zero, both
consecutive_failures zero. All 204 / 17 current items have valid distinct IDs.
Today's daily observations also have those 204 / 17 IDs under existing keys.

The production alias returned HTTP 200 / served store for both feeds after the
refresh: 204 of 204 Political Odds rows and 17 of 17 Election Forecast rows
carry distinct IDs, with fetchedAt matching the database refresh timestamps.
The BJP record still has the original
`url:manifold.markets/_deleted_/will-bjp-remain-the-ruling-party-in#25988011376fe828`
key, now with `market_id: KaQNzjn59n6ZFJUULr5E`; its closing date remains
2030-12-31. The 598 October 15–16 daily records retain fingerprint
`a2816d41c3197f48fe4877beeffe6695` exactly. Thus the executed refresh enriched
current records and preserved the older daily payloads/timestamps.

### Bounded request-log finding outside F222

Request-log scan for this production deployment over 12:56–13:11 UTC returned
two HTTP 502s, both GET `/api/state-landing`, at 13:08:57.209 and 13:08:58.060
UTC. No pagination remainder or excluded intervals. These are outside the two
F222 feed API paths; the log records omit the feature/query, so cause and
affected summary are not established. Do not infer that the deployment is
globally error-free from the successful prediction APIs, or label these errors
pre-existing without comparative evidence. Recorded separately as F223, no
state-landing changes under this release.

### Release disposition

F222 is released and its normal refresh/storage/API behavior is verified.
Runtime commit `294a273`, first production release head `e1a5557`. The final
documentation checkpoint contains no runtime/config changes and gets ordinary
CI/deployment verification; its result must not be counted before completion.
Hourly closure follow-up remains ACTIVE; daily reference gates, separate F221
and F223 remain open. No corpus changes, paid calls or payment integration.
