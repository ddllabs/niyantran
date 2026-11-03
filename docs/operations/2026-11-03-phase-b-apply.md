# Phase B apply runbook: partitioned chunks and the policy set

> **Status: Living (2026-11-03).** How the two Phase B migrations are applied to NTER, checked, and rolled back.
> Plan: [chunk partitions](../plans/2026-11-01-chunk-partitions.md). Spec: [bulk ingestion](../specs/2026-11-01-bulk-ingestion.md)
> §4.1, §4.4 (gate and recorded exceptions). Open work: F278. Nothing here runs without the developer's explicit
> authorization of this apply.

## What is applied

In this order, each with psql from the developer's terminal, from `main` at the merge commit (`515fb489`, PR #95):

1. `supabase/migrations/20261101120000_document_chunks_partitioned.sql`: builds the partitioned table beside the old
   one (NCLT, Bills, Regulatory, default; one HNSW index each), verifies it row for row, then swaps the names. The old
   table stays as `document_chunks_unpartitioned`, with no grants, for the rollback.
2. `supabase/migrations/20261101130000_law_documents_serving_set.sql`: the documents access policy evaluated as a set.
   Same rows admitted. Never applied without (1): alone it slows feature search.

Rehearsed on copies of the retrieval replica on the laptop's Docker (4 GB, 512 MB shared buffers). The final file
sets `maintenance_work_mem` 1GB (NTER is the 8 GB instance since 2026-11-03): 24 min 17 s in one transaction (copy
2 min 48 s, NCLT graph 16 min 16 s, verify 1 min 27 s of 392,945 rows, swap 20 ms holding the exclusive lock), peak
growth 5.06 GiB plus about 0.6 GiB of WAL (`*rehearsal-b8part*`). The same file, rehearsed again with the policy
migration straight after it (`*rehearsal-b9part*`, `*rehearsal-b9final*`), took 46 min 44 s on a slower machine
(copy 8 min 2 s, NCLT graph 32 min 12 s; swap 21 ms; 392,945 rows verified), and the policy migration 227 ms. At 256MB
it took 39 min 33 s. Plan for up to an hour on NTER; the file's own statement timeout is 2 h.

## Preconditions (each checked, and recorded with the time, before the apply)

| Check | How | Pass |
|---|---|---|
| Authorization | the developer says go for this window | in chat |
| Files | sha256 of both migration files on `main` equals the rehearsed ones | listed in the plan |
| Instance | Supabase dashboard: compute size and disk | Large (8 GB); disk 20 GB, at least 7 GiB free |
| Health | `get_project` status; `pg_is_in_recovery()` false; `default_transaction_read_only` off | healthy, writable |
| Quiet | `ingest_jobs` running or queued; conversations in the last 10 minutes; active client sessions | 0 jobs; low traffic |
| Freeze | see below | everyone told |
| History | `select version from supabase_migrations.schema_migrations where version in ('20261101120000','20261101130000')` | no row |
| Client | `/opt/homebrew/opt/libpq/bin/psql --version` in the developer's terminal | psql 17 or later |
| Before measurement | below | results file written |

**Who is frozen for the window (up to about an hour).** Nothing writes chunks or documents:
- No ingestion of any kind: the owner's agent has been told to ingest nothing until the bulk pipeline is ready
  (2026-11-02); no local supervisor (`docs/operations/corpus-jobs.md`) is running; no queued `ingest_jobs`.
- No admin Documents-page uploads, relinks or deletions; no F281 repair batches; no law-listing changes.
- The migration also refuses to start while an ingestion job holds a live claim, but the freeze is the guarantee: a
  writer that reads chunks and then updates documents during the swap deadlocks with it.

Readers (chat and search) keep working throughout; the swap makes them wait at most about 2 s.

## Connection and host

**Not `supabase db push`.** Since 2026-10-18 migrations were applied to NTER through the Supabase MCP, which records
its own timestamp as the version: 19 history rows differ from the repository's file versions (open work F283). A push
would therefore try to re-run 18 old migrations, the billing ones among them. Until F283 is resolved, a migration is
applied by running its file, and its history row is written by hand under the repository's version.

The developer runs it in their own terminal, on mains power, with sleep prevented. The connection string (Dashboard →
Connect → Session pooler, port 5432, IPv4; or the direct connection where IPv6 works) is pasted there and never into
chat, the repository or a log. TCP keepalives are set so a quiet connection is not dropped while the NCLT graph builds:

```bash
cd "<repository>"   # main at 515fb489; check both sha256 values first
read -rs PGURL      # paste the connection string; nothing is echoed
export PGURL="${PGURL}?keepalives=1&keepalives_idle=30&keepalives_interval=10&keepalives_count=6&application_name=phase-b-apply"
PSQL=/opt/homebrew/opt/libpq/bin/psql
caffeinate -dimsu "$PSQL" "$PGURL" -X -v ON_ERROR_STOP=1 -f supabase/migrations/20261101120000_document_chunks_partitioned.sql 2>&1 | tee ~/phase-b-1.log
# only when the first exits 0:
"$PSQL" "$PGURL" -X -v ON_ERROR_STOP=1 -f supabase/migrations/20261101130000_law_documents_serving_set.sql 2>&1 | tee ~/phase-b-2.log
"$PSQL" "$PGURL" -X -v ON_ERROR_STOP=1 -c "insert into supabase_migrations.schema_migrations (version, name) values ('20261101120000', 'document_chunks_partitioned'), ('20261101130000', 'law_documents_serving_set')"
unset PGURL
```

(If the pasted string already has a `?`, join the extra parameters with `&` instead.) Each file is one transaction
with its own `begin;` and `commit;`; it sets `statement_timeout` 2 h and `lock_timeout` 30 s locally, so the role's
120 s timeout does not apply inside it. The laptop does not sleep, close or change network during the window. The
logs hold only the phase notices; the supervisor reads them and runs every check below read-only.

- If the connection drops, do **not** run the file again. The server may still be running, and committing, the file
  it was sent. Do the orphan check first.

### Orphan check (after any disconnect or unclear exit)

Read-only, on NTER:

```sql
begin transaction read only;
select pid, state, now() - xact_start as age, application_name, left(query, 80)
  from pg_stat_activity where (query ilike '%document_chunks%' or application_name = 'phase-b-apply') and pid <> pg_backend_pid();
select relkind from pg_class where oid = 'public.document_chunks'::regclass;          -- 'p' = partitioned (applied)
select to_regclass('public.document_chunks_unpartitioned') is not null as old_kept;
select version from supabase_migrations.schema_migrations where version in ('20261101120000','20261101130000');
rollback;
```

- A backend still running the migration: wait for it; never start a second one.
- Partitioned table present: the first file committed. Go on with the policy file, then the history rows.
- Neither: nothing was committed (the file is one transaction); fix the cause and run it again.

## Before and after measurement (the exception's condition)

Both read-only, no cost (frozen vectors), against NTER, as `service_role` (the harness's live target):

```bash
npx vite-node --config vitest.config.js scripts/eval-retrieval.mjs -- --set eval/retrieval/questions.v2.jsonl --target live --modes broad,focused,feature --label prod-before-phase-b
npx vite-node --config vitest.config.js scripts/eval-retrieval.mjs -- --set eval/retrieval/questions.v2.jsonl --target live --modes broad,focused,feature --label prod-after-phase-b --compare eval/retrieval/results/<prod-before-phase-b>.json
```

- `service_role` bypasses row-level security, so these figures do not include the policy's cost; they measure the
  partitions. Add three signed-in checks by SQL (`set local role authenticated` in a read-only transaction): one broad,
  one NCLT feature and one focused search, each returns rows within the 8 s timeout.
- The harness aborts (exit 2) if a gold chunk changed. If the F281 repairs changed one, record which and run with the
  unaffected questions; do not edit the question set in the window.
- **Pass:** recall unchanged in every feature; feature p95 no worse; broad and focused within the recorded exception.
  **Roll back** if recall drops anywhere, if signed-in searches fail or time out, or if broad or focused p95 is more
  than twice the before figure. Otherwise the result is recorded and the exception stands.

## After the apply

1. `analyze public.document_chunks; analyze public.desk_rows; analyze public.documents;`, then compare `n_live_tup`
   with exact counts (`AGENTS.md`).
2. Live checks: `document_chunks` is partitioned with four partitions and four valid HNSW indexes; row counts per
   feature equal the before counts; grants equal the before grants (authenticated SELECT, service_role DIUS);
   `document_chunks_unpartitioned` has no grants; no invalid index; the security advisor shows nothing new.
3. The after measurement above.
4. Record the times, counts and results in this file's log section and in open work F278.

## Rollback (paired, while `document_chunks_unpartitioned` exists)

Ingestion stays frozen. First the policy migration's rollback, then the partition migration's, both as written in
the headers of the two files (each also deletes its own version row). Run each the same way, with psql from the developer's terminal. The old table
comes back by rename under a short exclusive lock; any rows written since the swap are copied back first, as the
header's script does. Run the after-apply live checks again against the restored table.

## Later (open work)

- Drop `document_chunks_unpartitioned` once production has run cleanly on the partitions for an agreed period (it
  holds about 5 GB of the disk).
- Post-apply measurements: broad and focused latency on production after a few days of real use.

## Log

Applied 2026-11-03, authorized by the developer in chat. Times are IST; the apply times are the creation and
last-write times of the two psql logs, which hold only the phase notices.

| Step | Time | Result |
|---|---|---|
| Preconditions | before 20:55 | Large instance, 20 GB disk; healthy and writable; 0 ingest jobs; no history rows for either version; psql 17 |
| Before measurement | 20:55 | `*prod-before-phase-b*`, 315 questions (below) |
| Partition migration | 21:30:35 to 21:38:02 | exit 0, about 7 min 27 s in one transaction; 395,375 rows copied and verified; swap lock taken on the first attempt |
| Policy migration | 21:42:08 to 21:42:09 | exit 0 |
| History rows | after 21:42 | `INSERT 0 2` under the repository's versions; the connection string unset |
| Statistics | after the apply | `analyze` on the three corpus tables |
| After measurement | 22:00 | `*prod-after-phase-b*`, `--compare` verdict no worse |

The partition migration took about a third of the fastest rehearsal (24 min 17 s on the laptop).

**Live checks (read-only).** `document_chunks` is partitioned, with NCLT 225,273 rows, Bills 89,009, Regulatory
12,983 and default 68,110: 395,375 in all, equal to the copy and verify counts. Each partition has a valid HNSW
index; grants match the before state; `document_chunks_unpartitioned` has no grants. As a signed-in user (`authenticated`, 8 s
timeout, an NCLT chunk's vector as the query), a broad, an NCLT feature and a focused search each return 10 rows,
and the three unpublished orders stay hidden. The security advisor
shows only the expected new items: an RLS notice for each of the four partitions, which no role but the owner and
`service_role` can read, and the `law_published_document_ids` warning, which is by design. Database 12 GB; the
backup table 5,301 MB.

**Measurement.** The harness refused the full set: the F281 repairs replaced the gold chunks of q-0197 and
q-0209. Both runs used the other 315 questions, unchanged, as `service_role` against NTER with frozen vectors.
Timings include about 330 ms of network round trip.

| Mode | p50 before → after | p95 before → after |
|---|---|---|
| Broad | 758 → 560 ms | 1,516 → 1,368 ms |
| Focused | 382 → 367 ms | 677 → 641 ms |
| Feature | 695 → 662 ms | 812 → 762 ms |

Document hit@10, before → after: broad 196 → 199 of 249 (Regulatory 47 → 50, the rest equal); feature
205 → 206 (NCLT 29 → 30, the rest equal); focused 249 of 249 both. No question was lost in any mode. Four broad
calls took over 2 s (slowest 2.7 s). The broad and focused exceptions recorded in the plan were not needed on
production: both are faster than before.

**Correction to the applied file's comments.** The header and the comment above `match_documents` in
`20261101120000_document_chunks_partitioned.sql` say its document-id and unscoped branches are unchanged. Both
changed: the document-id branch is limited to the requested documents' partitions, and the unscoped branch sets
`work_mem` 256kB for its access check and restores it. The function bodies carry the correct comments. The file
is left byte-identical to what was applied (sha256 `77ddc136…`).
