# F221 preference-test interference diagnosis and proposed scope

> **Status: Living.** Owner authorized diagnosis and a scoped proposal on
> 2026-10-17. Implementation, push and deployment are not authorized by this task.

## What failed and what did not

Original F220 full-run evidence: 6,124 passed / two failures, both in
`src/lib/userPrefsSync.test.js`. Account-switch guard at line 134 expected zero
fetch calls but saw one PIB GET; clean hydration at line 338 expected one call
but saw two. The recorded extra URL is the PIB ViewRss index. The original log
remains in the F220 evidence; subsequent green runs do not erase the defect.

The preference runtime only fetches `/api/user-prefs`; its dependency path does
not fetch PIB. The recorded call is neither a preferences PUT nor evidence of
an account data leak. These broad network-count assertions are meaningful and
must not be removed or changed to ignore unrelated calls.

## Confirmed mechanism

`vitest.config.js` runs files in a single fork. Module isolation/cache resets do
not cancel live promises or real Node timers already created by earlier files.

`src/lib/featureFeedTimeLimit.test.js` creates hanging fetches in several real
Cabinet Decisions cases and returns the archive after a 50-ms test deadline.
`server/featureFeed.mjs:startLive/settleWithin` intentionally leaves the live
attempt running so later callers can receive its result. Its `resetFeedCache`
clears maps, not those pending requests. The test teardown restores global
fetch immediately and does not settle its hanging producer.

After the original request's own 12-second timeout, `tryUrls` continues to the
Cabinet registry's fallback primary URL, the PIB ViewRss index. `fetchText`
looks up global fetch at that later time, so it reaches whichever test now owns
that global. When the consumer is the preference suite, the PIB GET is counted
as a preference-suite request and may also consume a mock response intended
for its actual API. This matches the original URL and both count mismatches.

This is a confirmed producer leak and deterministic reproduction of the
recorded failure mechanism. The original log lacks an async creator stack, so
it does not identify which particular hanging Cabinet test created each of
those original two calls.

## Executed evidence, no runtime or test-file edits

Node/npm used the existing external no-dotenv preload. Current checkout began
clean at main/origin `54c24c4`; the temporary lab ran entirely under /tmp with
an isolated Vitest configuration. All source network calls, browser storage,
Supabase Auth and RPC were mocked. No external network/database writes.

- `npm test -- src/lib/userPrefsSync.test.js`: 36 passed, 609 ms total.
- `npm test -- --config /tmp/f221-diagnosis.config.mjs`: four deterministic cases
  passed, 13.98 s total. It imports the real serveFeatureFeedWithinLimit,
  serveFeatureFeed, hydrateUserPrefs and pushPrefs, not copied implementations.
  Advances the real loader's timer with a controlled clock. No probabilistic
  full-suite reruns were used to look for a lucky green.

| Actual preference scenario | Producer left pending | Producer closed and awaited before replacing fetch |
| --- | --- | --- |
| Server hydration alone, then clean push | 2 total fetches: 1 preference GET + 1 PIB GET; original one-call assertion fails | 1 preference GET, no PIB call; original count holds |
| Account switch during push identity verification | push refused correctly; 1 unrelated PIB GET, no preference request; original zero-call assertion fails | push refused correctly; zero fetches; original count holds |

The control closes the old source mock, rejects outstanding requests and
immediately refuses any subsequent fallback while that same mock still owns
fetch; it then awaits the captured real live promise before installing the
consumer mock. Clearing the cache first by itself does not prevent the leak.

## Proposed scoped fix (small, test only)

Primary write scope: `src/lib/featureFeedTimeLimit.test.js`, with its regression
cases colocated. Documentation scope: this record, sole tracker, cleanup record
and a short approved spec/plan when implementation starts.

1. Replace uncontrolled hanging mocks with a disposable source stub that tracks
   pending rejections. Once disposal begins, reject newly attempted fallbacks
   immediately under the same stub, with abort listeners cleaned up.
2. Capture the real live loader promises launched by those slow-source tests.
   Make teardown asynchronous: dispose the source stub, await those real live
   attempts, then restore global fetch/timers and reset caches. Track/settle
   controlled deferred custom loaders too; do not await a deliberately never-
   resolved fake forever. Keep the production late-answer behavior untouched.
3. Add a producer/consumer regression that crosses the 12-second boundary and
   proves no fallback can reach a replacement fetch mock after teardown. Check
   both observed count patterns, with all source I/O mocked. The guard must
   fail for the current teardown and pass for the disposal sequence.
4. Keep `userPrefsSync.test.js` and runtime preference/auth/billing code unchanged.
   In particular preserve account-switch rejection, bearer ownership, zero
   unwanted uploads and exactly-one hydration checks. Do not filter away PIB
   calls or clear mock history to manufacture passing assertions.

Verification after approval: focused feed timeout + preferences suites and the
new causal guard, then full Vitest, Deno, lint/build/router/bundle per repository
rules. Prove old-teardown failure before relying on the guard. Existing producer
late-live sharing/reuse tests must still pass. No SQL, Docker, migration, backend
function deployment, production API invocation or provider call needed for the
fix. Any publication still needs exact owner authorization.

## M1/M2 and monitoring

Planned T0–T14 changes and F218/F220/F222/F223/F224 are released. T15 remains
open for real daily refresh opportunities. Read-only status during this task:
MLA reference and World Constitutions each have one successful post-rollout
opportunity, zero failures, next due October 18 10:45 / 15:45 UTC. Growth has
zero post-F224 scheduled writer opportunities, next due October 18 15:55 UTC.
No source above three consecutive failures. Hourly automation confirmed ACTIVE.

Earliest expected payment handoff remains late evening October 19 IST if the
next two reference daily opportunities and Growth writer acceptance succeed,
F221 follow-up is addressed as approved, and the final health/CI check passes.
This is conditional, not acceptance or permission to start payments. No manual
refresh can substitute for those elapsed intervals. Corpus remains excluded.

Only local diagnosis/tracker documentation changed. No production, runtime,
tracked test, configuration, data, corpus or payment change; no push/deploy.
