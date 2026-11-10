# Hybrid search on NTER: apply and measure (T8)

> **Status: Living (2026-11-09).** How `20261102120000_chunk_hybrid_search.sql` is applied to NTER, measured there, and
> rolled back. Plan: [hybrid and contextual retrieval](../plans/2026-11-04-hybrid-and-contextual-retrieval.md), "Still to
> check before T9". Open work: F278 (step 4), F288, F295, F286. Nothing here runs without the developer's explicit
> authorization of this apply. The app is not switched to hybrid here: that is T9, after these numbers and F288.

## What is applied, and what is not touched

One file, by `psql` from the developer's terminal (never `supabase db push`, F283). It only adds:

1. the schema `retrieval_internal`;
2. the helper `retrieval_internal.hybrid_candidate_ids(text, extensions.vector, text, text)`;
3. the function `public.match_documents_hybrid(extensions.vector, text, int, uuid[], text, text)`;
4. the index `document_chunks_content_tsv` (GIN on `to_tsvector('simple', content)`; about 141 MB on today's corpus).

It drops, alters or replaces nothing. It changes no data row. `match_documents`, its helpers and every policy are
unchanged, and the app keeps calling `match_documents`. The file is one transaction: it first checks that NTER's access
policies are the ones the helper was written against, and rolls back with `55000` before building anything if they are
not.

## Preconditions (each checked, and recorded with the time, before the apply)

| Check | How | Pass |
|---|---|---|
| Authorization | the developer says go for this window | in chat |
| File | sha256 of the file on `main` equals the reviewed one (PR #99 merge) | recorded |
| Exposed schemas | Dashboard → Settings → API: "Exposed schemas" and "Extra search path" do not list `retrieval_internal`; note whether "Automatically expose new tables" is on | the developer, by hand |
| Policy text | read-only: `pg_policies` for `documents` and `document_chunks` matches the copy the helper checks (the supervisor compares) | identical; otherwise stop, nothing applied |
| Quiet | `ingest_jobs` queued or running: 0; no admin uploads, relinks or repairs during the window | 0 |
| Disk | free space at least 2 GiB (the index and its WAL) | Dashboard |
| History | `select version from supabase_migrations.schema_migrations where version = '20261102120000'` | no row |
| Client | `psql --version` in the developer's terminal | 17 or later |

The index build holds a `ShareLock` on every chunk partition for its duration, so writes to chunks wait; reads
(chat and search) keep working. On the rehearsal copies the build took seconds to minutes; on NTER it is unrecorded,
which is why the window is quiet.

## Apply

In the developer's terminal, with the connection string pasted there and never into chat, the repository or a log
(the Phase B pattern, [record](2026-11-03-phase-b-apply.md)):

```bash
cd "<repository>"   # main; check the file's sha256 first
read -rs PGURL      # paste the connection string; nothing is echoed
export PGURL="${PGURL}?keepalives=1&keepalives_idle=30&keepalives_interval=10&keepalives_count=6&application_name=hybrid-apply"
PSQL=/opt/homebrew/opt/libpq/bin/psql
caffeinate -dimsu "$PSQL" "$PGURL" -X -v ON_ERROR_STOP=1 -f supabase/migrations/20261102120000_chunk_hybrid_search.sql 2>&1 | tee ~/hybrid-apply.log
# only when it exits 0:
"$PSQL" "$PGURL" -X -v ON_ERROR_STOP=1 -c "insert into supabase_migrations.schema_migrations (version, name) values ('20261102120000', 'chunk_hybrid_search')"
unset PGURL
```

If the connection drops, do not run the file again: check first whether the server is still running it
(`pg_stat_activity`, `application_name = 'hybrid-apply'`) and whether `match_documents_hybrid` exists.

## Checks right after, read-only

```sql
begin transaction read only;
select to_regprocedure('public.match_documents_hybrid(extensions.vector, text, int, uuid[], text, text)') is not null as fn;
select indisvalid from pg_index where indexrelid = 'public.document_chunks_content_tsv'::regclass;      -- true
select has_function_privilege('anon', 'public.match_documents_hybrid(extensions.vector, text, int, uuid[], text, text)', 'execute');  -- false
select pg_size_pretty(pg_relation_size('public.document_chunks_content_tsv'));
rollback;
```

And from outside, with no key: the Data API must not answer for `retrieval_internal` (the exposed-schemas check, made
again now that the schema exists).

## Measure

All read-only, no spend (frozen question vectors), with `scripts/eval-retrieval.mjs --target nter`: psql from the
developer's terminal, connected by libpq's environment (`PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGSSLMODE`, and
`PGPASSWORD` or a password file), each statement in a read-only transaction that is rolled back, each search as
`authenticated` under row access and the 8 s limit. The developer runs it; the supervisor reads the results.

Question set: `eval/retrieval/questions.v2.jsonl` (72 NCLT questions) in feature mode, with
`developer-questions.holdout-2026-11.jsonl` (30 NCLT) as a second set. Recall here is a check that NTER answers as the
copies did, not a new verdict: the sealed set is spent.

1. **Cold**, straight after the apply, with `--no-warmup`: hybrid (`--rpc match_documents_hybrid`), then vector-only
   (`--rpc match_documents`) on the same questions.
2. **Warm**, at once after: the same two runs, with warm-ups.
3. **Cold again**, after at least 6 hours with no use of hybrid (overnight): steps 1 and 2 repeated. NTER is lightly
   used, so this is the case real users meet most.
4. Around each pair, read-only: buffer hits and reads for the NCLT chunk partition and the new index
   (`pg_statio_user_tables`, `pg_statio_user_indexes`), to see whether a slow window is the cache.

Recorded per run: p50, p95, max, timeouts (57014), any 55000, and calls over 2.5 s and over 4 s (F288's budget and the
app's limit, F295). Raw output stays outside the repository; the summary goes in this file and the plan.

### Privacy: what rests where

The plan's canary (a question naming an unpublished order's party, which must return the same rows with and without
that order) cannot be run on NTER as written: it needs production document content to write, and an order hidden and
then shown to compare, which is a data change. A check that hybrid's returned rows are all readable would prove nothing,
since the calls run as `authenticated` and row access filters the final rows by construction. So on NTER:

- **What carries it:** the SQL fixture `supabase/tests/chunk_hybrid_search.sql`, run on every CI build. It seeds an
  unpublished NCLT order and proves the helper never sees it, in its word counts or its candidate cut, so it can
  neither appear as an id nor change a visible answer. It also replays the publication rule's matrix to prove the
  helper's copy admits exactly what `authenticated` can read. The policy-text precondition and the file's own `55000`
  guard make that copy the rule NTER enforces.
- **What is measured on NTER instead:** the count of NCLT documents a signed-in user cannot read (aggregate only), so the
  timings are taken with a production-sized hidden list, as the plan asks.
- **Not tested here:** the residual timing channel the migration header accepts.

## Stop rules (any one ends the measurement; the app is not switched)

- any `55000`;
- a cold hybrid timeout where vector-only returns for the same question;
- hybrid p95 over the plan's bar (1.2 × vector-only p95 + 20 ms) when warm, or any warm call over 4 s;
- a buffer-hit drop that coincides with a slow window (then F286 first);

A stop leaves hybrid applied but unused, which costs nothing but the index; it is removed only if the developer
decides to (rollback below).

## Rollback

Nothing depends on these objects; the app does not call them. As the developer, by `psql`, with approval:

```sql
drop function public.match_documents_hybrid(extensions.vector, text, int, uuid[], text, text);
drop function retrieval_internal.hybrid_candidate_ids(text, extensions.vector, text, text);
drop schema retrieval_internal;
drop index public.document_chunks_content_tsv;
delete from supabase_migrations.schema_migrations where version = '20261102120000';
```

## Result, 2026-11-09

**Applied** at 17:50 IST (12:20 UTC), in 55 s, exit 0. How it differed from the steps above:

- **No psql or password.** The file went through `supabase db query --linked -f` (the logged-in CLI, Management API,
  as `postgres`), byte for byte the reviewed file (sha256 `2978589e…181c223`, unchanged since the PR #99 merge). It had a
  three-line header in front: `statement_timeout` 30 min (the API session's default is 2 min), `lock_timeout` 10 s, and
  `application_name`. The history row was then inserted by hand, as in Phase B.
- **Exposed schemas** were read from the Data API itself, since the dashboard was not reachable from the session. A
  request for an unknown schema answers "Only the following schemas are exposed: public, graphql_public". **Disk** came
  from the disk plan (20 GB provisioned) against the live database size (12 GB).

**Preconditions, 12:19 UTC:** policy text identical to the helper's copy (4 policies); history had no row (latest
`20261101130000`); `ingest_jobs` queued or running 0; no other active session; Postgres 17.6.

**Checks after:** both functions exist; `document_chunks_content_tsv` is valid on all 4 partitions, 124 MB; `anon`
cannot execute `match_documents_hybrid` or use `retrieval_internal`; `authenticated` can execute it. From outside, with
no key, the Data API refuses `retrieval_internal` (PGRST106). History row `20261102120000 chunk_hybrid_search` written.
Hidden list: 3 of 7,549 NCLT documents are not readable by `authenticated`.

**How it was measured.** `--target nter` could not be used, since it needs a database password in the developer's
terminal, and through the CLI every call would include about 3 s of connection. Instead, a runner outside the
repository sent the same calls as the eval:
- the same parameters (`rpcParams`, `replicaCallSql`), feature mode, the 72 NCLT questions of `questions.v2`;
- the same seeded order, and the same 5 unscored warm-ups for the warm runs;
- scored with the same `outcome` and `summarise`.

How each call ran:
- In a read-only transaction that was rolled back, as `authenticated`.
- Six calls per request.
- Timed by the database's own clock (`clock_timestamp()` around each call). Times exclude network and connection,
  which the app adds.
- A call over 8 s would have counted as a timeout; none came close.

About one request in twelve got no answer from the Management API and never reached the database. Each was killed
after 120 s and sent again, which changes nothing, since every request is read-only.

**Not cold.** The index build had read the NCLT partition minutes before, and an aborted first attempt ran 18 hybrid
calls (34.8 s in all), so the first pair is labelled "after build". The true cold run, after at least 6 hours with no
hybrid use, is still to do.

| NTER, 72 NCLT questions | p50 | p95 | max | over 2.5 s | doc@10 | chunk@10 | chunk@40 | chunk MRR |
|---|---|---|---|---|---|---|---|---|
| hybrid, after build | 460 ms | 1,211 ms | 1,585 ms | 0 | 58/72 | 28/58 | 32/58 | 0.337 |
| vector-only, after build | 127 ms | 181 ms | 192 ms | 0 | 40/72 | 25/58 | 29/58 | 0.299 |
| hybrid, warm | 371 ms | 483 ms | 521 ms | 0 | 58/72 | 28/58 | 32/58 | 0.337 |
| vector-only, warm | 123 ms | 170 ms | 191 ms | 0 | 40/72 | 25/58 | 29/58 | 0.299 |
| *replica, 2026-11-05 (`t7lim-*-p2`): hybrid / vector-only* | | | | | *58 / 40* | *28 / 25* | *33 / 30* | *0.349 / 0.314* |

No `55000`, no timeout. NTER answers as the replica did at 10; at 40 each function has one fewer chunk hit than the
replica. Raw output: `~/niyantran-eval-cache/hybrid-nter/`.

**Stop rule fired.** Warm hybrid p95 is 483 ms against the plan's bar of 1.2 × 170 ms + 20 ms = 224 ms. The
measurement stopped there: the cold-again run was not taken, and the app was not switched.

**Exception, the developer, 2026-11-09:** hybrid ships despite the bar, as Phase B's broad-search latency did on
2026-11-03. The bar is the eval's "no worse" rule for versions of the same search. Hybrid adds a keyword stage and
costs about 310 ms at p95 for 58 against 40 of 72 NCLT questions with the right document in the top 10.

Vector-only search stays in two places:
- inside the function, for every non-NCLT scope and whenever there is no keyword or month candidate;
- in the app, as F288's fallback when hybrid fails or passes its budget.

Still before T9, in order:
1. the cold run after at least 6 hours with no hybrid use, with no call over 2.5 s;
2. F288's two read-only rollout checks: whether NTER's logs record RPC arguments, and whether a cancelled hybrid call
   keeps running on the database;
3. F288 merged and `research-chat` deployed, each with approval;
4. the `hybrid_search` flag row, with approval.

## Result, 2026-11-10: cold run and F288's rollout checks

All read-only, no spend, 02:18 to 02:24 UTC. Same runner, settings and question set as on 2026-11-09.

**Cold, 11 h 12 min without hybrid.**
- `document_chunks_nclt`'s keyword index was last scanned at 15:06:46 UTC on 2026-11-09, the end of the warm run. The
  other three partitions' keyword indexes have never been scanned.
- In `pg_stat_statements`, no statement naming `match_documents_hybrid` or `hybrid_candidate_ids` was first seen after
  15:06:12 UTC.
- The Data API's only request for the function in 24 h was the no-key check at 12:27 UTC (404).

**Not quiet.** The Bills load (F307) ran throughout, with 8 ingest jobs running, writing to `document_chunks_bills`.
These questions search only the NCLT partition, so the load cannot change their answers. It does compete for CPU, disk
and the buffer cache.

| NTER, 72 NCLT questions | p50 | p95 | max | over 2.5 s | over 4 s | doc@10 | chunk@10 | chunk@40 | chunk MRR |
|---|---|---|---|---|---|---|---|---|---|
| hybrid, cold (11 h), during the Bills load | 718 ms | 2,715 ms | 5,498 ms | 4 | 1 | 58/72 | 28/58 | 32/58 | 0.337 |
| vector-only, straight after | 159 ms | 275 ms | 596 ms | 0 | 0 | 40/72 | 25/58 | 29/58 | 0.299 |

No timeout at 8 s, no `55000`, and answers identical to 2026-11-09. **It fails the pass rule** (no hybrid call over
2.5 s).

**Where the slow calls are.** All are at the start of the run. The first six calls took 5,498, 3,321, 3,155, 1,854,
2,715 and 2,123 ms. After that every call was under 1.4 s, and from the thirteenth on under 800 ms.

**Cache reads across the pair.** Blocks the NCLT partition read from outside Postgres's buffer cache:

| | blocks |
|---|---|
| table | 27,173 |
| vector index | 132,340 (about 1 GB) |
| keyword index | 2,185 |

Hybrid ran first, so it paid most of these. That makes the vector-only run warm, not cold: its slowest call, at
596 ms, is its first. This run cannot separate the cold cache from the load's competition.

**Under F288 option A,** each of the four calls would have reached the 2.5 s hybrid budget and fallen back to vector-only
search. The search would still answer, as vector-only, after about 2.5 s plus the fallback call. Without F288, the
5.5 s call would have hit the app's 4 s abort and returned no results.

### F288 check A: do NTER's logs record the search text?

**No, for the app's path, on the current settings.** Counts only; no user text was read.

- **Data API (`edge_logs`):** each request's method, path, URL, status, timings and content length, but not the body. An
  RPC call is a POST with its arguments in the body. In 24 h the only request naming an RPC search was the 404 above,
  which had no body.
- **Postgres (`postgres_logs`):**
  - The settings are `log_statement = ddl`, `log_min_duration_statement = -1`, `log_min_error_statement = error`,
    `log_parameter_max_length_on_error = 0`. A successful search is never logged.
  - A failing statement, a 57014 timeout included, is logged with its text. The Data API sends the request body as a
    bound parameter, and parameters are not logged on error. The one Data API error on 2026-11-03 shows this: its logged
    text is PostgREST's statement with `$1`, and no parameter values.
  - In 24 h, two Postgres log lines name the function:
    - the apply, which is DDL and so logged in full;
    - one failed eval batch from the Management API, whose text held the eval's own questions as literals.

    User question text: 0.
  - `auto_explain` logs statements over 10 s, and the 8 s limit on `authenticated` stops an app search first.
- **Functions (`function_logs`):** no line names either RPC. F288's `research.hybrid_fallback` line carries no query
  text, which is a tested property.

**What would change this:** raising `log_parameter_max_length_on_error`, `log_statement = all`, a duration log, or a
direct SQL client that puts the search text in the statement, as the eval runner does. Those would log errors with
their literals.

### F288 check B: does a cancelled hybrid fetch stop its statement?

**No, on the path that could be tested. Assume the same for the app.**

- **Settings:** `authenticated` and `authenticator` have an 8 s `statement_timeout`, and
  `client_connection_check_interval` is 0, so Postgres does not notice mid-statement that a client has gone.
- **Probe, through the CLI (Management API):**
  - one read-only call as `authenticated`: `pg_sleep(15)`, then one hybrid search;
  - the client was killed 1.8 s after the statement started;
  - `pg_stat_activity` still showed it active at 4.4, 7.5, 10.2, 12.6 and 15.0 s, and it ended on its own after about
    15 s.

  Here the role's 8 s limit did not apply, because `set local role` does not load role settings. Through the Data API it
  does.
- **The app's path** (`research-chat` to the Data API) cannot be tested without a deploy or a user's token. The one real
  app search aborted at 4 s on NTER (2026-10-26, 10:58 UTC) left no Data API log line for `match_documents` and no
  Postgres cancel or timeout error. That fits a statement that ran to the end after the app gave up, but it is not proof.
- **For F288:** when hybrid passes its budget and the fallback starts, the abandoned hybrid statement keeps running
  beside it for up to 8 s. In the cold run the slowest finished in 5.5 s. The cost is database work, not user-visible
  time, and the abandoned call still warms the cache.

### Decision for the developer

The cold rule failed, by four calls in the first six of the run, during a bulk load. Two ways on:

- **(a)** Ship anyway, with F288's fallback covering the cold start, as the 2026-11-09 exception did for warm p95. Then
  merge F288, deploy `research-chat` from `main`, and create the flag row, each with approval.
- **(b)** Hold T9, and run the cold pair again after the Bills loads finish and the database has had 6 quiet hours,
  hybrid and vector-only in alternating order so neither warms the other.

**Decided 2026-11-10: (b).** The Bills loads finished at 05:20 UTC on 2026-11-10; the cold pair is re-run after 6 quiet
hours, read-only, with the same pass rule. T9 stays held until then.

## Result, 2026-11-10: cold re-run, window 1 of 2 (quiet, hybrid first)

All read-only, no spend, 11:38 to 11:41 UTC. Same runner, settings and question set as before.

**Quiet, checked at 11:38 UTC.**
- No runner process on the measuring machine, and no ingest job queued or running.
- No ingest batch after 04:50 UTC; the last job was created at 05:01 UTC.
- No other active query.
- `document_chunks_nclt`'s keyword index and vector index were last scanned at 02:23 UTC, the end of the previous cold
  run: 9 h 15 min. The last `match_documents_hybrid` statement in `pg_stat_statements` was first seen at 02:23 UTC.
- The partition's document-id index was touched at 10:59 UTC by a read-only resolver check (F314) whose chunk counts
  name no feature, so they probe that index on every partition. Search does not use that index; the vector index, the
  keyword index and the table were not read.

| NTER, 72 NCLT questions | p50 | p95 | max | over 2.5 s | over 4 s | doc@10 | chunk@10 | chunk@40 | chunk MRR |
|---|---|---|---|---|---|---|---|---|---|
| hybrid, cold (9 h), quiet | 696 ms | 2,634 ms | 5,535 ms | 4 | 1 | 58/72 | 28/58 | 32/58 | 0.337 |
| vector-only, straight after | 134 ms | 165 ms | 240 ms | 0 | 0 | 40/72 | 25/58 | 29/58 | 0.299 |

No timeout at 8 s, no `55000`, and answers identical to 2026-11-09. **It fails the pass rule again** (no hybrid call
over 2.5 s), by the same four calls.

**The load does not explain the earlier failure.**

| Run | Call 1 | Call 2 | Call 3 | Call 4 | Call 5 | Call 6 |
|---|---|---|---|---|---|---|
| During the load, 02:20 UTC | 5,498 ms | 3,321 ms | 3,155 ms | 1,854 ms | 2,715 ms | 2,123 ms |
| Quiet, 11:40 UTC | 5,535 ms | 3,397 ms | 3,314 ms | 1,976 ms | 2,634 ms | 2,020 ms |

The slow calls are the same ones, within 7% of each other. What they pay for is the cold cache. Blocks the NCLT
partition read from outside Postgres's buffer cache:

| | hybrid run | vector-only run after it |
|---|---|---|
| vector index | 103,664 (about 810 MB) | 18,506 |
| table | 25,606 | 62 |
| keyword index | 1,988 | 0 |

The vector index dominates, and hybrid reads it too. Window 2 runs vector-only first. That shows whether a cold
vector-only search pays the same first-call cost, since that is what the app does today.

## Result, 2026-11-10: cold re-run, window 2 of 2 (quiet, vector-only first)

All read-only, no spend, 18:49 to 18:52 UTC. Same question set, settings and runner as window 1. The runner script was
lost from the scratchpad in a session restart and restored from its last full copy in the session record; offline it
selects the same 72 questions in the same order as window 1 for both arms.

**Quiet, checked at 18:49 UTC.** No runner process; no ingest job queued or running; no ingest batch after 04:50 UTC; no
other active query. `document_chunks_nclt`'s vector index was last scanned at 11:41 UTC and its keyword index and table
at 11:40 UTC (window 1): 7 h 8 min. The partition's document-id index was touched at 12:34 UTC by the F314 apply and its
acceptance re-runs (chunk counts by document id); search does not use that index.

| NTER, 72 NCLT questions | first call | p50 | p95 | max | over 2.5 s | doc@10 | chunk@10 | chunk@40 | chunk MRR |
|---|---|---|---|---|---|---|---|---|---|
| vector-only, cold (7 h), first | 321 ms | 144 ms | 240 ms | 363 ms | 0 | 40/72 | 25/58 | 29/58 | 0.299 |
| hybrid, straight after | 760 ms | 591 ms | 875 ms | 1,030 ms | 0 | 58/72 | 28/58 | 32/58 | 0.337 |

No timeout, no `55000`, answers identical to 2026-11-09. In this window hybrid meets the pass rule.

**Blocks the NCLT partition read from outside Postgres's buffer cache:**

| | vector-only run (first) | hybrid run (second) | window 1, hybrid run (first) |
|---|---|---|---|
| vector index | 14,986 | 4,845 | 103,664 |
| table | 60 | 14,328 | 25,606 |
| keyword index | 0 | 1,715 | 1,988 |

## The two windows together

- **Idle time is not what makes a search cold; eviction is.** After 9 h quiet that followed a day of bulk loading
  (window 1) the vector index was mostly out of memory: hybrid's first call took 5.5 s and read 103,664 index blocks
  (about 810 MB). After 7 h quiet with nothing else running (window 2) it was mostly still cached: vector-only read 14,986
  blocks and no call passed 363 ms, and hybrid after it peaked at 1.03 s.
- **The cold cost is the vector index's, which hybrid shares, plus hybrid's own keyword index and table reads.** In both
  windows the vector index dominates the reads. A truly cold vector-only search was not measured on NTER (window 2's
  index was warm), so whether today's vector-only search also passes 2.5 s on a first call after eviction is not shown;
  window 1 suggests it pays most of the same reads.
- **The rule as written passes in one window and fails in the other.** Production will see evictions (bulk loads,
  restarts), so the first searches after one will be slow for hybrid and probably for vector-only.

### Decision for the developer

- **(a) Ship hybrid with F288's fallback** (vector-only after the 2.5 s budget) as a recorded exception, and add a
  keep-warm step for the NCLT indexes (`pg_prewarm` after a restart or bulk load, and a small scheduled warm-up query);
  the memory checks first (NTER: 8 GB RAM, 2 GB shared buffers; the NCLT vector index is about 1 GB).
- **(b) Hold T9** until the keep-warm step is in place, then measure once straight after an eviction (for example right
  after the next bulk load), vector-only first, with the same rule.

Recommended: (b). The fix for the slow first calls is the keep-warm step either way, and one measurement after an
eviction would show whether it works before users see hybrid.

## Decisions for the developer

**Decided 2026-11-09:** both as recommended. Apply and measure now, before the bulk load; privacy on NTER rests on the
fixture and the policy match. The apply itself still waits for the preconditions below to be checked in the window.


1. **When to apply.** Before the bulk load, the index is updated for every new chunk (the disk plan estimates a third or
   more extra WAL for the load); after it, hybrid waits and the index builds once on the larger corpus
   ([disk plan](2026-11-06-nter-disk-plan.md), option F). **Recommended: apply and measure now**, since the numbers
   decide whether hybrid ships at all; if the bulk load starts before T9, the index can be left in place.
2. **Privacy on NTER** resting on the fixture and the policy match, as above, rather than the plan's canary, which
   would need content reads and a data change on production. **Recommended.**
