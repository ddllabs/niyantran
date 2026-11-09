# App fallback when hybrid search fails (F288)

> **Status: Living (2026-11-09).** Spec and plan for [F288](../plans/open-work.md), the app-side guard that must exist before
> the app switches NCLT feature search to `match_documents_hybrid` (T9 of the
> [hybrid plan](../plans/2026-11-04-hybrid-and-contextual-retrieval.md)). The developer decided the time budget on 2026-11-09
> (option A, adjustable through the flag row; section "Decision: the time budget"). Tasks 1 to 3 are implemented in the
> working tree; nothing here changes production.

## Current state

- `research-chat` searches in `search()` (`supabase/functions/_shared/retrieval.ts`): embed the query once, then one RPC,
  always `match_documents`, with `p_desk_tier` and, for a desk module, `p_desk_feature`. (The feature variant is an argument
  of `match_documents`, not a separate public function; `match_documents_feature_hnsw` is internal to it.)
- `supabase/functions/research-chat/index.ts` wires the RPC through `bounded(..., NETWORK_TIMEOUT_MS)`, 4,000 ms per network
  step (F295). On timeout `bounded` throws a generic 503, `search()` throws, and the tool step ends with status `error`.
  The database's own limit is 8 s, so the app's abort always comes first.
- F296 (merged, `research-chat` v111): `embedQuery` retries an embedding call that got no response once per query, each
  attempt under its own 4 s `bounded`. So the embedding phase can take up to about 8 s, and it is spent before the RPC
  starts. Embedding writes nothing, so that retry is safe; the RPC bound has no retry ("never retry here").
- `match_documents_hybrid` (`20261102120000_chunk_hybrid_search.sql`) is merged but **not applied** on production. It takes
  the same arguments as `match_documents` plus `query_text`, returns the same columns, and behaves exactly as
  `match_documents` for every scope except an NCLT feature search (`'NCLT / NCLAT (Insolvency)'`, no document ids).
- `public.app_flags(key, value jsonb, updated_at)` exists (migration `20260928100200`). `anon` and `authenticated` may
  `SELECT key, value, updated_at`; only `service_role` writes. Today only `server/marketingMediaApi.mjs` reads it
  (`marketing_intro_video`). `research-chat` reads no flags. No key exists for hybrid, and none is needed to ship the code:
  a missing row means off.
- Measured: on NTER, search steps have a median of 1.25 s and p95 of 2.75 s including embedding (449 searches); 1 of 449 hit
  the 4 s database abort ([note](../research/2026-11-06-nter-search-timing.md)). Hybrid is not on NTER. In the best quiet local
  hybrid run, 7 of 58 NCLT searches took over 4 s, and a cold question took 12 to 22 s on its first call.

## Problem

When the app is switched to hybrid for NCLT feature search, a slow (cold) hybrid call exceeds the 4 s abort, the search
fails, and the reader gets nothing for a question `match_documents` would have answered. There is also no way to turn hybrid
off without a deploy if it misbehaves on NTER.

## Expected outcome

1. A kill switch in `app_flags` turns hybrid off without a deploy. Default off. With it off, or absent, or unreadable,
   behaviour is today's: the same single `match_documents` call with identical arguments.
2. With it on, an NCLT feature search calls `match_documents_hybrid` under its own time budget. If that call errors, is
   aborted, or the function is missing, the same query vector is sent to `match_documents` under a second budget, and the
   search succeeds with vector-only rows.
3. Every fallback is visible afterwards, without storing query text.

## Design

**Where.** `search()` in `retrieval.ts` gains an optional hybrid path: a dependency `hybrid?: { config(): Promise<HybridConfig> }`
(`{enabled, hybridMs, fallbackMs}`, never rejecting), a `signal` (the turn's), an `onPath` callback for the visibility fields,
and a wider `rpc` signature taking the function name (`'match_documents' | 'match_documents_hybrid'`) and an optional per-call
time budget. `parseHybridFlag` (flag value to `HybridConfig`, with the bounds) is exported from `retrieval.ts`. A new
`research-chat/hybridFlag.ts` holds the cached reader; `index.ts` wires it and passes the budget into `bounded`. The path applies only when
`deskFeature` is the NCLT feature and no document ids are given (the database makes every other scope identical, so there is
nothing to gain and a flag read to save). The embedding is computed once and reused by the fallback. No change to the SQL.

**Fallback triggers.** Only a failure of the hybrid RPC itself: an error, an abort or a timeout of that call, a PostgREST error
(missing function, permission, 57014) and a malformed result. A returned `data` that is not an array also counts as malformed.
Not a trigger: the turn's own signal being aborted (the user pressed Stop or the
turn deadline passed) - then the search ends as today and no second call starts. Not a trigger either: a failure of the role
hydration of rows the hybrid RPC returned successfully. That failure surfaces exactly as it does today (the same error), and no
second search starts, because a second search would repeat the hydration that just failed. (In `index.ts` the hydration runs
inside the `rpc` wrapper, so the wrapper rethrows its failure through `afterRpcFailure`, which marks the error for `search()`
without wrapping it.) An empty but successful hybrid result is a result, not a failure. A failed fallback, including a failed
hydration of its rows, fails the search exactly as `match_documents` failing does today.

**Row handling.** Both paths pass through the same role hydration and the same `Chunk` mapping, so a fallback row is
indistinguishable from today's.

### Decision: the time budget (developer, 2026-11-09)

Today the RPC phase gets 4,000 ms (after embedding). Hybrid gets its own budget, and the vector-only fallback gets a second,
independent one; the sum is the new worst case. Options considered:

| | Hybrid budget | Fallback budget | Worst RPC calls (role hydration, 4,000 ms, comes on top; see the table below) | Cost |
|---|---|---|---|---|
| **A. Short hybrid, full fallback (chosen)** | 2,500 ms | 4,000 ms (today's) | 6,500 ms | A slow hybrid call adds up to 2.5 s, then a normal vector answer. Hybrid calls that would have finished in 2.5 to 4 s lose the hybrid gain. |
| B. Split the existing 4 s | 2,000 ms | 2,000 ms | 4,000 ms | A cold vector call needing 2 to 4 s now fails where today it answers. Rejected. |
| C. Fallback on a fast error only | 4,000 ms | 4,000 ms | 4,000 ms | A merely slow hybrid call still fails the search. Rejected. |

A hedged option (start both calls at once and take the first) is excluded: it doubles load on the slowest, coldest path.

**Chosen: A, with the numbers adjustable without a deploy.** They are read from the same `app_flags` row as the switch
(`{"enabled": true, "hybrid_ms": 2500, "fallback_ms": 4000}`, see "The flag"). Defaults when a field is absent or not a finite
number: `hybrid_ms` 2,500, `fallback_ms` 4,000. A number outside the bounds is clamped, not rejected:

| Field | Default | Minimum | Maximum |
|---|---|---|---|
| `hybrid_ms` | 2,500 | 500 | 4,000 |
| `fallback_ms` | 4,000 | 1,000 | 4,000 |

The maximum equals `NETWORK_TIMEOUT_MS`, so no setting makes the fallback or hybrid phase wait longer than one of today's
network steps. The fallback budget is its own: it is never "what is left after hybrid".
Since 2,500 ms is a starting value and not a measured one, T9's cold and warm p95 on NTER sets the final numbers, by editing
the row.

**Worst-case time of one search step**, from the code (each network step is its own `bounded` call, none shares a clock):

| Part | Today | Hybrid, default settings | Hybrid, maximum settings |
|---|---|---|---|
| Flag read (qualifying searches only; `HYBRID_FLAG_READ_TIMEOUT_MS`) | 0 | 500 | 500 |
| Embedding, with the F296 retry (2 x 4,000) | 8,000 | 8,000 | 8,000 |
| Hybrid RPC (its budget) | 0 | 2,500 | 4,000 |
| Vector RPC (today's 4,000, or the fallback budget) | 4,000 | 4,000 | 4,000 |
| Role hydration of the rows that are returned (`hydrateDocumentRoles`, its own 4,000) | 4,000 | 4,000 | 4,000 |
| **Search step total** | **16,000** | **19,000** | **20,500** |

The hybrid and role hydration steps do not both repeat: hydration runs once per search, on the rows of whichever RPC answered,
and a hydration failure after a successful hybrid RPC does not start a fallback (see "Fallback triggers"). So the fallback
adds at most the hybrid budget (2,500 ms by default, 4,000 ms at most) to today's worst case, and the longest RPC-plus-
hydration stretch is 10,500 ms by default (12,000 ms at the maximum), against 8,000 ms today. The law-context step that
follows the search is unchanged and not counted. The turn deadline is `TURN_DEADLINE_MS` = 300,000 ms
(`research-chat/persistence.ts`), so these totals fit many times over; the budget cannot starve a turn. The check is kept
anyway: the fallback does not start when the turn's signal is aborted (Stop, or the deadline).

### The flag

- Key `hybrid_search`, value `{"enabled": true, "hybrid_ms": 2500, "fallback_ms": 4000}`. Only the boolean `true` in
  `enabled` enables it; `hybrid_ms` and `fallback_ms` are optional (defaults and clamping in "Decision: the time budget").
  Absent row, `false`, a string, a non-object, a missing `enabled`, or a failed read all mean off, which is today's behaviour;
  unknown extra keys are ignored. Set, tuned or cleared by the owner with the service role (SQL or a future admin route); no
  deploy. No migration is needed: the table exists and a missing row is off.
- **Read per search, cached per isolate.** A search that qualifies (NCLT feature scope) calls `getHybridEnabled()`, which reads
  the row with the caller's client (RLS already admits it; no service role) and keeps the answer for 15 s in a module variable,
  like `documentModulesCache`. Cost: one indexed single-row select per isolate per 15 s, only on qualifying searches, so
  roughly zero when hybrid is off and little when on. A flip takes effect within 15 s plus isolate churn, which is what
  "without a deploy" needs. A per-request read would add a round trip (about 50 to 150 ms, not measured) to every NCLT search for
  no benefit a 15 s cache lacks; an indefinite cache would make the kill switch useless.
- **Read failure fails safe.** The read has its own 500 ms bound (not the search's 4 s). A timeout, error, or invalid value
  returns off for this search and is cached as off for 5 s, so an outage of the flag read costs one 500 ms wait per isolate
  per 5 s, not one per search. Nothing in the flag path can throw into the search: it is the vector-only path.
- Unreadable flag with hybrid already on in other isolates is accepted: each isolate decides for itself, off on failure.

### Visibility

- No new `chat_turn_traces.step_type` (the check constraint allows only the existing types, and a change needs a migration,
  which is excluded). The `search_documents` step keeps its row; its `latency_ms` already covers the whole step including a
  fallback. The step-end measurements that already travel with the tool event and the stored activity
  (`latencyMs`, `embeddingMs`, `retrievalMs`) gain `retrievalPath` (`'hybrid'` or `'hybrid_fallback'`; absent means the plain
  vector search, so a search with the switch off emits exactly today's event) and, on a fallback, `hybridMs` (time spent in the
  failed hybrid call) and `fallbackReason` (`'timeout'`: the call failed after using its whole budget; `'error'`: it failed
  sooner, no message text). The chat_turn_traces row's `input` and
  `error_message` are untouched.
- One structured server log line per fallback, `research.hybrid_fallback`, with `reason`, `hybrid_ms`, `fallback_ms`, and the
  PostgREST error code if there was one. No query text, no user id, no chunk content. A second line, `research.hybrid_flag_read_failed`,
  with the error kind only.
- Decided 2026-11-09: no migration and no new `chat_turn_traces` column. Visibility is the activity measurements and the log
  line only.

## Acceptance evidence

All by execution, in Deno tests with a fake `rpc`, fake clock/timers and the existing helpers:

- Flag absent, `false`, malformed, unreadable or timed out: exactly one `match_documents` call, arguments byte-identical to
  today's (no `query_text`), no hybrid call; the search succeeds.
- Flag on, NCLT feature scope: one `match_documents_hybrid` call carrying the same arguments plus `query_text`; its rows are
  returned; `match_documents` is not called.
- Flag on, hybrid exceeds its budget, errors, or returns a missing-function error: one `match_documents` call with the
  identical vector; its rows are returned; the embedding provider was called once; the measurement says `hybrid_fallback`.
- Stop or turn abort during the hybrid call: no fallback call starts.
- Hybrid and fallback both fail: the search fails with today's error, once.
- Other scopes (no feature, another feature, document ids): no flag read, no hybrid call.
- The flag is read once within 15 s and again after, and a flip is seen after the cache expires.
- Fallback log and measurement contain no query text.
- `npm test`, the Deno suite, `npm run lint`, `npm run build` pass; `npm run test:sql` is unaffected (no SQL changes).

## Tests that must fail first

Each test is written and run against the unchanged code (or, where today's behaviour already satisfies it, against a
deliberately broken implementation) and must fail, to prove it catches its defect.

| Test | Defect it catches | How it is shown to fail |
|---|---|---|
| Flag on, hybrid times out, search still returns vector rows | No fallback | Fails on current code: hybrid is never called and the timeout path throws. Also fails if the fallback branch is removed. |
| Flag on and healthy: hybrid called, vector not | Fallback always runs, or hybrid ignored | Fails today (only `match_documents` is called). Fails if the implementation always calls both. |
| Flag off / absent: single `match_documents`, identical arguments | Hybrid used while off; extra argument leaking | Passes today, so it is shown by mutation: an implementation that ignores the flag must fail it. |
| Flag read throws, times out, or is malformed: vector-only, search succeeds | Fail-open flag, or a flag error failing the search | Mutation: treat error as enabled, and let the error propagate; each must fail. |
| Abort during hybrid: no second call | Fallback after Stop spends a paid, wasted call and holds the turn | Mutation: fallback unconditionally in `catch` must fail it. |
| Embedding called once across hybrid and fallback | Re-embedding on fallback (a second paid call) | Mutation: call `embed` again in the fallback must fail it. |
| Fallback budget is its own 4,000 ms, hybrid's is 2,500 ms (fake timers) | Budget shared or wrong (the fallback starved by the time hybrid used) | Mutation: pass the remaining time to the fallback must fail it. |
| Non-NCLT scope or document ids: no flag read | Needless read on every search | Mutation: read the flag unconditionally must fail it. |
| Cache: second search within 15 s does not read; after expiry reads; failure cached off for 5 s | A read on every search, or a kill switch that never takes effect | Mutations: no cache, and cache forever, each must fail. |
| Both calls fail: today's error, once | Swallowed error, or a double-error message | Mutation: return empty rows on double failure must fail it. |
| Log and measurement carry no query text | Personal data in logs | Mutation: include the query in the log must fail it. |
| Flag value parsing: only boolean `true` enables; budgets default when absent or not finite, and clamp to 500 to 4,000 / 1,000 to 4,000 | A truthy string enabling hybrid; an out-of-range budget reaching `bounded` | Mutation: `enabled: Boolean(v.enabled)`, or no clamp, must fail it. |
| Hybrid answers, role hydration fails: one hybrid call, no `match_documents`, the same error as today | A second search that repeats the failed hydration | Mutation: drop the `afterRpcFailure` check in `search()` (or the `.catch(afterRpcFailure)` in `index.ts`); each must fail it. Shown failing against the code before the change. |
| The flag read never answers: the search starts at 500 ms, not 4,000 ms; the failure is logged | An unbounded or search-bounded flag read | Mutation: `r.timeoutMs` in place of `HYBRID_FLAG_READ_TIMEOUT_MS` must fail it. |
| A Stop during the flag read is not cached as unreadable | A Stop silently switching hybrid off for 5 s in the isolate | Mutation: pass `context.signal` to the flag read's `bounded` must fail it. |
| A reader that throws synchronously is read again after 5 s | A settled promise stuck in `inFlight`, the cache off for good | Fails on the first version of `createHybridFlagCache`; a revert of the fix must fail it. |
| `timeout` label at budget - 40 ms; `error` at budget - 100 ms | A slack that is too large or zero | Mutation: slack 0 and slack 200 must each fail it. |
| Fallback rows pass role hydration and `Chunk` mapping like vector rows | A different, unhydrated shape on fallback | Mutation: skip hydration on the fallback must fail it. |

## Scope

May be modified (Task 1 to 3): `supabase/functions/_shared/retrieval.ts` and `retrieval_test.ts`;
`supabase/functions/research-chat/index.ts` and `index_test.ts`; a new `supabase/functions/research-chat/hybridFlag.ts` with
`hybridFlag_test.ts`; the step-end measurement plumbing in `supabase/functions/research-chat/handler.ts` and `agent.ts` (with
their tests) only as far as adding `retrievalPath`, `hybridMs` and `fallbackReason` to the existing measurements.
Tasks 4 (runbook paragraph under `docs/operations/`) and 5 (`docs/plans/open-work.md`) are not part of the 2026-11-09 dispatch.

## Exclusions

- No migration written or applied anywhere (local, rehearsal copy, NTER). `match_documents_hybrid` stays unapplied.
- No app switch to hybrid in production: the flag row is not created, and no code path calls hybrid while it is absent.
- No NTER access, no production flag write, no deploy of the Edge Function. Each is a separate authorized step in T9.
- No change to `match_documents`, the hybrid SQL, the embedding retry (F296), or `NETWORK_TIMEOUT_MS`.
- No new `chat_turn_traces` step type or column; no reranker; no client (browser) change.
- No fallback for `search_desk_rows` or any non-hybrid call.

## Plan

Sequential. Each task is performed by one agent, left uncommitted for the supervisor to verify. No delegation.

| # | Task | Write scope | Depends on | Verification |
|---|---|---|---|---|
| 1 | Failing tests first for the table above, then the hybrid path and fallback in `search()` with injected budgets and flag dependency; confirm the turn-deadline behaviour | `supabase/functions/_shared/retrieval.ts`, `retrieval_test.ts` | decided | focused Deno test file; each new test shown failing before the change |
| 2 | Flag reader with cache, 500 ms bound and fail-safe; wiring of the budgets through `bounded`; tests for the cache and failure modes | `research-chat/index.ts`, `index_test.ts`, `hybridFlag.ts`, `hybridFlag_test.ts` | 1 | focused Deno tests; full Deno suite |
| 3 | Carry `retrievalPath`, `hybridMs`, `fallbackReason` through the step-end measurements; the structured log lines | `research-chat/handler.ts`, `agent.ts`, and their tests | 1, 2 | Deno suite; a test that the log and event contain no query text |
| 4 | Operator note: how to read, set and clear the `hybrid_search` row, what a fallback looks like, and the T9 measurement that finalises the budget | one new file under `docs/operations/` | 1 to 3 | not in this dispatch |
| 5 | Supervisor: `npm run lint`, `npm test`, `npm run build`, the Deno suite; update `docs/plans/open-work.md` | `docs/plans/open-work.md` | 1 to 4 | not in this dispatch |

## Implementation notes (2026-11-09)

Where the code differs from, or settles, the design above:

- `search()` takes `hybrid?: { config(): Promise<HybridConfig> }`, `signal?` and `onPath?`; `rpc` takes an optional third
  argument, the per-call budget in ms. A switch-off search calls `rpc` with exactly two arguments, as before.
- The flag cache is `createHybridFlagCache` in `research-chat/hybridFlag.ts` (`get(read)` / `reset()`), instantiated once in
  `index.ts`. Searches that arrive while a read is in flight share it. `resetHybridFlagCache` is exported for tests only.
- The flag read is `select('value')` on `app_flags` for key `hybrid_search` with the caller's client, bound 500 ms
  (`HYBRID_FLAG_READ_TIMEOUT_MS`), and deliberately not under the turn's signal, so a Stop is never cached as "unreadable".
- The `retrievalMs` timing covers the whole RPC phase, fallback and role hydration included. The flag read sits outside it (inside the step's
  `latencyMs`).
- Reason `timeout` means "failed at or after the hybrid budget": the hybrid call failed by throwing with at least
  `hybrid_ms` minus 50 ms elapsed (the 50 ms is slack for timers that fire a little early against the wall clock; the budget
  bound throws one generic error for every failure, so elapsed time is the only signal). A failure 40 ms short of the budget
  is `timeout`; one 100 ms short is `error`, as is a returned error value or any earlier failure. It is a label for the
  log and the activity, not proof of a database timeout.
- A search that did not consult the switch (flag off, other scope) emits no `retrievalPath` at all, so its event, saved
  activity and logs are byte-identical to today's. The value `'vector'` proposed under "Visibility" is therefore never emitted.
- The step-end event and saved activity gain `retrievalPath`, `hybridMs`, `fallbackReason`. The fallback's own time and the
  database error code go to the `research.hybrid_fallback` log line only.
- Not done, outside the write scope: the `tool` frame type in `supabase/functions/_shared/chatStream.ts` does not list
  the three new fields (the code compiles because the handler spreads them; tests cast), and no client reads them.
- Tests: the abort case is tested at two levels. In `search()` (a deps `signal`) and through `bounded` in `index.ts`, whose
  parent-signal check also refuses to start a call once the turn is aborted.

## Unresolved

- **Unverified:** whether a cancelled hybrid fetch stops the statement on the database, or leaves it running while the fallback
  starts. Not verifiable without NTER or a local replica; it stays a T9 check on production (look for overlapping slow queries).
- Decided, no longer open: the budget (option A, flag-adjustable); no migration or trace column; no environment guard (the 15 s
  flag cache makes the cost negligible).
