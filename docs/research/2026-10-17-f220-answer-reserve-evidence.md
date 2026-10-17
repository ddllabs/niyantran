# F220 answer-reserve execution evidence

> **Status: Living.** 2026-10-17. Owner authorized fix, verification and
> push/deploy as needed. Corpus ingestion and payment integration excluded.

## Checkout and reproduced cause

Fetched base/current main `f3d5b59a378dc34b13b2844e965fea3882c45d5f`, 0/0 versus
origin, origin only DDL Labs GitHub. Existing local edits were exactly the two
authorized 11:42 UTC closure observations; preserved without stashing or
discarding. Implementation branch `task/f220-answer-reserve` carries them.

Controlled clock reproduced the actual F220 request mismatch: the watchdog's
60.75/80.75 ms delays truncate to 60/80 ms; after cutoff the next `timeLeft`
still reads reserve + 0.75 ms. The old loop recomputes late=false and sends high
reasoning again. This is a runtime transition bug exposed by a wall-clock test,
not merely a test needing a longer sleep.

`AgentCheckpoint.answerReserveReached` now retains entry into the reserve,
including an accepted watchdog cut. Subsequent calls use the configured late
reasoning even across provider failure/checkpoint resume. This checkpoint is
in-process only. Independent turns start with a fresh false flag. No timeouts,
budgets, retrieval, account/billing behavior or public schemas changed.

## Test evidence and review

The three affected real-time F199 tests now use Deno's standard fake clock,
pinned `jsr:@std/testing@1.0.21/time`. It is test-only and not in the deployed
function dependency graph. No bespoke scheduler or new production dependency.
See [standard clock implementation](https://github.com/denoland/std/blob/main/testing/time.ts).

- Initial original-runtime run: four failures / four passes. Research/answer
  replacement uses high instead of low; null override remains present;
  checkpoint retry also restores high.
- Final guards with the original deployed runtime restored: four failures /
  five passes. Fixed source restored immediately afterwards. Same four failures.
- Fixed runtime: nine focused F199 cases passed in ten independent executions.
  Cases include fractional research and answer cutoffs, configured/removed/absent
  reasoning overrides, retry budgets and evidence retention, another independent
  turn, caller cancellation, and active text/tool streaming without a cut.
- Focused command: `deno test -A --config supabase/functions/deno.json --filter
  F199 supabase/functions/research-chat/agent_test.ts`.
- Full `deno test -A --config supabase/functions/deno.json supabase/functions`:
  1,155 pass, zero failures, seven seconds.
- `npm run lint`: pass, zero warnings. `npm run build`: pass, 5.07 seconds,
  existing >500 KB lazy chunk warning. `npm run check:bundle`: pass, 180,398 B
  entry gzip, no increase or terminal schema leak. Router import and
  `git diff --check`: pass. No standalone type-check claim.

Node commands use the existing no-dotenv preload at
`/tmp/niyantran-cleanup-no-env/guard.mjs`; no environment/credential files read.
No local SQL/container run needed for this in-process change; normal CI retains
its disposable SQL fixture/vacuity/Down job. No live data fixtures or paid calls.

First full `npm test`: 390 files pass / one fails, 6,124 pass / two failures,
91.58 seconds. Both failures in `src/lib/userPrefsSync.test.js` global fetch
counts: an unrelated pending PIB GET reached its mock, contradicting assertions
that no calls or only one call occurred. Focused preference suite: 36/36 pass.
No preference source/test changes or assertion loosening. Separate finding
F221 records the interference; the initial full-suite failure is preserved.
A second complete `npm test` run passed all 391 files / 6,126 tests in 87.72
seconds. Both outcomes are retained; this local rerun is not a first-attempt CI
acceptance run and does not close F221's isolation finding.

Review: per-turn state, checkpoint ownership, null/absent overrides, cancellation,
active streaming, evidence and budget behavior inspected. The small runtime
change reuses existing state/loop boundaries; no new service/interface.

## Release preparation

Retrieved research-chat v65, verify_jwt=false, bundle SHA-256
`e9f084cd83f2006dce7b92f979736bb3470e04c63fd785579893d54fd94e6eb5`.
Preserved exact bundle and all 36 files locally for rollback. Compared every
deployed file to the checkout: only `functions/research-chat/agent.ts` differs.
Prepared release preserves all other 35 files byte-for-byte, entrypoint and
authentication. Prepared files equal local tested files exactly. New agent
SHA-256 `ce7e96cdb9cb3111774c0a7b83a69d64f3e3f833cb3fb318b63d2d8041245c32`.

Push, CI and deployment results will be recorded after verification. Closure
follow-up `niyantran-m1-m2-closure-checks` remains active; T15 still needs real
scheduled daily opportunities and its actual first-attempt CI checkpoint.
