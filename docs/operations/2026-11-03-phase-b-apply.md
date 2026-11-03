# Phase B apply runbook: partitioned chunks and the policy set

> **Status: Living (2026-11-03).** How the two Phase B migrations are applied to NTER, checked, and rolled back.
> Plan: [chunk partitions](../plans/2026-11-01-chunk-partitions.md). Spec: [bulk ingestion](../specs/2026-11-01-bulk-ingestion.md)
> §4.1, §4.4 (gate and recorded exceptions). Open work: F278. Nothing here runs without the developer's explicit
> authorization of this apply.

## What is applied

In this order, as one `supabase db push` from `main` after the pull request is merged:

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

## Preconditions (each checked, and recorded with the time, before the push)

| Check | How | Pass |
|---|---|---|
| Authorization | the developer says go for this window | in chat |
| Files | sha256 of both migration files on `main` equals the rehearsed ones | listed in the plan |
| Instance | Supabase dashboard: compute size and disk | Large (8 GB); disk 20 GB, at least 7 GiB free |
| Health | `get_project` status; `pg_is_in_recovery()` false; `default_transaction_read_only` off | healthy, writable |
| Quiet | `ingest_jobs` running or queued; conversations in the last 10 minutes; active client sessions | 0 jobs; low traffic |
| Freeze | see below | everyone told |
| History | `supabase migration list --linked`: both files pending, nothing else pending | only these two |
| Dry run | `supabase db push --linked --dry-run` | lists exactly the two files |
| Before measurement | below | results file written |

**Who is frozen for the window (up to about an hour).** Nothing writes chunks or documents:
- No ingestion of any kind: the owner's agent has been told to ingest nothing until the bulk pipeline is ready
  (2026-11-02); no local supervisor (`docs/operations/corpus-jobs.md`) is running; no queued `ingest_jobs`.
- No admin Documents-page uploads, relinks or deletions; no F281 repair batches; no law-listing changes.
- The migration also refuses to start while an ingestion job holds a live claim, but the freeze is the guarantee: a
  writer that reads chunks and then updates documents during the swap deadlocks with it.

Readers (chat and search) keep working throughout; the swap makes them wait at most about 2 s.

## Connection and host

- Run the push from the developer's laptop on mains power, with sleep prevented for the whole run:
  `caffeinate -dimsu supabase db push --linked 2>&1 | tee <scratch>/phase-b-push.log`. The laptop does not sleep,
  close or change network during the window.
- The CLI's linked connection is used as for every earlier migration (F30, P12, migration 51). The file sets
  `statement_timeout` 2 h and `lock_timeout` 30 s locally; the role's 120 s timeout does not apply inside it.
- If the connection drops, do **not** push again. The server may still be running, and committing, the file it was
  sent. Do the orphan check first.

### Orphan check (after any disconnect or unclear exit)

Read-only, on NTER:

```sql
begin transaction read only;
select pid, state, now() - xact_start as age, left(query, 80)
  from pg_stat_activity where query ilike '%document_chunks%' and pid <> pg_backend_pid();
select relkind from pg_class where oid = 'public.document_chunks'::regclass;          -- 'p' = partitioned (applied)
select to_regclass('public.document_chunks_unpartitioned') is not null as old_kept;
select version from supabase_migrations.schema_migrations where version in ('20261101120000','20261101130000');
rollback;
```

- A backend still running the migration: wait for it; never start a second one.
- Partitioned table present but its version row missing: the file committed without the CLI recording it. Insert the
  version row (developer authorization), then push again so only the policy file runs.
- Neither: nothing was committed (the file is one transaction); fix the cause and push again.

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

## After the push

1. `analyze public.document_chunks; analyze public.desk_rows; analyze public.documents;`, then compare `n_live_tup`
   with exact counts (`AGENTS.md`).
2. Live checks: `document_chunks` is partitioned with four partitions and four valid HNSW indexes; row counts per
   feature equal the before counts; grants equal the before grants (authenticated SELECT, service_role DIUS);
   `document_chunks_unpartitioned` has no grants; no invalid index; the security advisor shows nothing new.
3. The after measurement above.
4. Record the times, counts and results in this file's log section and in open work F278.

## Rollback (paired, while `document_chunks_unpartitioned` exists)

Ingestion stays frozen. First the policy migration's rollback, then the partition migration's, both as written in
the headers of the two files (each also deletes its own version row so a later push re-applies it). The old table
comes back by rename under a short exclusive lock; any rows written since the swap are copied back first, as the
header's script does. Run the after-push live checks again against the restored table.

## Later (open work)

- Drop `document_chunks_unpartitioned` once production has run cleanly on the partitions for an agreed period (it
  holds about 5 GB of the disk).
- Post-apply measurements: broad and focused latency on production after a few days of real use.

## Log

(Filled in during the apply.)
