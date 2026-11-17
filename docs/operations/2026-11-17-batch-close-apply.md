# Applied on NTER: batch close and the failure count (F326, F327)

> **Status: Historical (2026-11-17).** What was applied to NTER on 2026-11-17 (UTC) on the developer's go-ahead, what
> was checked, and what was not. Nothing was deployed. Open work: the `ingest-worker` deploy for F328.

The migration came from `main` at `a85a6cfb` (PR #159), with CI green on that commit; the file is unchanged on `main`
at `7034e9f7` (PR #163), which was the head at the apply. Before it: 22,437 ingest jobs, all `succeeded`, 8,285 of them
in a batch; none queued or running; 36 batches, all `indexed`; no open pull request; no other session active on the
database.

## What changed

| Step | Before | After | Time (UTC) | Rollback |
|---|---|---|---|---|
| Migration `20261115090000_batch_close_and_failure_count` | no `failures_seen` or `failures_acknowledged` on `ingest_jobs`; no `ingest_batch_close`; no history row | both columns; trigger `ingest_jobs_count_failure`; state `closed_with_failures` and event `closed` allowed; five batch functions replaced; `ingest_batch_close` added; history row present | 19:14 | the transaction in the migration's header; it refuses once any batch is `closed_with_failures` |
| `pg_cron` job 4 (`ingest-worker`) | active | paused 19:14:31, resumed 19:14:45 | 19:14 | none needed |

No Edge Function was deployed. `ingest-worker` on NTER does not yet carry the F328 change.

## Checks

**Another migration landed between the dry run and the apply.** `20261118090000_factcheck_fail_reason` (PR #162, the
Live TV work) was applied to NTER after the dry run, taking the history from 101 to 102 rows. It names no ingest object.
Before the apply the five existing batch functions still had the hashes read before the dry run, so the dry run's
result still described the database being changed.

**Dry run, 16:20.** The file with its trailing `commit;` and `analyze` replaced by checks and `rollback;`, about 14 s,
with the worker running and the queue empty. Inside the transaction:

- both columns are `integer not null default 0`, and 0 for all 22,437 jobs;
- the trigger is enabled and the three constraints are valid;
- `ingest_batch_close` and `ingest_batch_resume` may be executed by `service_role` only; `ingest_batch_status` and
  `ingest_batch_stop` by `corpus_ingest` and `service_role`; `ingest_batch_mark_stopped`,
  `ingest_batch_block_reason` and `ingest_jobs_count_failure` by none of `anon`, `authenticated`, `corpus_ingest` and
  `service_role`;
- for all 36 batches `ingest_batch_status` returns everything it returned before plus one new key, `closure`, and
  `ingest_batch_block_reason` returns what it returned before;
- `ingest_batch_close` on an `indexed` batch is refused as `batch_state` and writes nothing: the event and job counts
  are unchanged.

After the rollback the five definitions' hashes were unchanged, the columns and trigger were absent, and the history
held 101 rows.

**Apply, 19:14.** The same file and checks, then a guard that raises unless the seven function hashes equal the dry
run's, the event and job counts are unchanged, every existing batch reports as before and no history row exists; then
the history row, `commit;` and `analyze public.ingest_jobs`. About 12 s with the worker paused. Read afterwards from a
separate read-only session:

- the seven hashes equal the dry run's (`md5` of the function source, first eight characters): `block_reason`
  `ffbac554`, `close` `e21794f6`, `mark_stopped` `a9220618`, `resume` `efda4180`, `status` `a28f98a4`, `stop`
  `08080f90`, `count_failure` `5c88766e`;
- both columns exist; 22,437 jobs, all `succeeded`; 36 batches, all `indexed`; no `closed` event;
- the history holds 103 rows and includes `20261115090000`;
- `ingest_jobs` was analysed at 19:14:43 with 22,437 live rows;
- job 4 is active, and its first scheduled run after the resume (19:15:16) succeeded. The eleven runs in the five
  minutes before the pause had all succeeded.

## Not verified

- Closing a batch that has failed jobs has not been exercised on NTER, because no such batch exists. That behaviour,
  and the failure count across a requeue and a resume, rest on the fixture `supabase/tests/ingest_batch_close.sql` in
  CI.
- The definitions the migration replaced were not compared with the repository's before it ran; only their hashes
  before and after the dry run were compared with each other.
