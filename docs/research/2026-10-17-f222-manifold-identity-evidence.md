# F222 local verification

> **Status: Living.** Local implementation verified on 2026-10-17;
> production release is pending owner approval.

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
