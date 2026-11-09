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

## Decisions for the developer

**Decided 2026-11-09:** both as recommended. Apply and measure now, before the bulk load; privacy on NTER rests on the
fixture and the policy match. The apply itself still waits for the preconditions below to be checked in the window.


1. **When to apply.** Before the bulk load, the index is updated for every new chunk (the disk plan estimates a third or
   more extra WAL for the load); after it, hybrid waits and the index builds once on the larger corpus
   ([disk plan](2026-11-06-nter-disk-plan.md), option F). **Recommended: apply and measure now**, since the numbers
   decide whether hybrid ships at all; if the bulk load starts before T9, the index can be left in place.
2. **Privacy on NTER** resting on the fixture and the policy match, as above, rather than the plan's canary, which
   would need content reads and a data change on production. **Recommended.**
