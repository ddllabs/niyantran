# Hands-off loads: register, leave, accept later (F394)

> **Status: Living (2026-11-20).** Design for the `hands-off-loads` module of the
> [programme spec](2026-11-20-corpus-and-search-completion.md). Developer decision 2026-11-20: the operator's laptop
> does not carry a long load; a small batch is tested, then the bulk runs on Supabase. Extends the
> [bulk ingestion spec](2026-11-01-bulk-ingestion.md). Nothing here changes production without the developer's yes.

## Current state (read from code 2026-11-20, not executed)

- `cli.ts run` for one part: open, add items, seal, dry run, paced registration, then `watch` until the batch is
  indexed, `confirm`, the receipt, then acceptance. Chunking, embedding and indexing run in the `ingest-worker`
  function. Only `watch`, the waits between registration steps and acceptance keep the laptop attached.
- No flag skips the watch or acceptance, and no command runs acceptance alone. A rerun of an indexed part registers
  nothing (F356) but still passes through the planner.
- A batch moves from registered to indexed inside `ingest_batch_status`; if nobody reads the status it stays
  `registered` while its jobs succeed.
- Stops that hold with no client: batch and collection spend, the uncertain count and the failure rate
  (`ingest_batch_block_reason`, applied at claim), refusal share at registration, chunk ceiling and budget at seal.
  The failure rate is judged only once `min_decided` jobs of one batch are decided; Cabinet's policy has 400, so it
  cannot fire for a batch of 100.
- Stops that exist only in the client: the one requeue of failed jobs, the watch and drain timeouts, the planner's
  partition and disk lines (from static numbers in the collection file).
- Several batches of one collection may be registered at once; seal reserves against the ceilings cumulatively.
- `ingest_settings` is changed by the table owner only; nothing restores it on a schedule. At the normal values the
  worker takes about 2 documents a minute; at the raised values about 16.
- Acceptance is recorded only as report files on the operator's machine.

## Problem

A load of several batches needs the laptop awake for its whole length (about 11 hours per 10,000 documents). On
2026-11-20 a closed lid left a batch indexed and unaccepted.

## Expected outcome

After a desk's first batch has passed attended, the rest is registered in minutes and the laptop may close. Supabase
finishes the work. Acceptance of every batch is run later by a command that registers nothing. A bad load still stops
itself.

## Design

1. **`run --register-only`.** After registration the command writes its receipt with the batch state as read and
   returns. It does not watch, confirm or accept, and it does not stop for acceptance between parts. The waits
   between registration steps stay, so commits are still paced within a batch.
2. **`accept`.** `accept --batch <id>` or `accept --collection <name>` (every batch of the collection that has no
   passing report in the receipts directory). It reads the status first, which also moves the batch on; it refuses a
   batch that is not indexed; it runs the same acceptance as today and writes the same report. It makes no open, seal
   or register call and does not pass through the planner.
3. **Batch size for the unattended part.** The remainder of a desk is cut into batches of at least the policy's
   `min_decided` where the remainder is that large, so the failure-rate stop is live with no client. A remainder
   smaller than `min_decided` goes as one batch and relies on the spend and uncertain stops; the record says so.
4. **Limits.** The first use, the Cabinet remainder, runs at the normal worker limits and needs no change to
   `ingest_settings` (about 4.5 hours for 547 documents, unattended). Raised limits for larger loads need the
   limits put back on Supabase when the queue is empty: a scheduled owner function, a migration, its own short spec
   and its own yes. Not in this change.
5. **Failed jobs.** With no client nobody requeues a failed job. `accept` reports a batch with failed or undecided
   jobs as not accepted and names the counts; the operator reruns the part attended. No server-side requeue in this
   change.
6. **Planner numbers.** Before a register-only sitting the operator's script sets `chunksNow` and the disk figure
   from the database once, and adds each part's planned chunks before the next, so the partition and disk lines see
   the sum.

## Acceptance evidence

1. Runner tests: with `--register-only` no status-watch, confirm or acceptance call is made (a recording double);
   with the option made a no-op the test fails. `accept` makes no open, seal or register call; a failing sample exits
   non-zero; a batch not indexed is refused.
2. Both test suites, lint and build pass.
3. On the local load copy: three parts registered with `--register-only`, the client exits, the worker indexes them,
   `accept --collection` then passes each.
4. First use on NTER: batch `2537b346` accepted by `accept --batch`; the Cabinet remainder registered and left;
   acceptance of each batch afterwards; a record in `docs/operations/`.

## Scope

`scripts/bulk-runner/cli.ts`, `run.ts`, `db.ts`, `psql_db.ts`, their tests, and the runner's README. No migration,
no function change.

## Exclusions

Server-side restore of the limits, server-side requeue, recording acceptance in the database, and a loader that
reads Drive from Supabase are not in this change.

## Not verified

Everything under Current state was read from code. The worker's rate at the normal limits is arithmetic from the
schedule, not a measurement.
