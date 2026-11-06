# Bulk runner (F285)

> **Status: Living (2026-11-07).** Spec and plan for step 9 of the [bulk ingestion spec](2026-11-01-bulk-ingestion.md). Interfaces
> are fixed by section 7 of the [registration design](../research/2026-11-02-batch-registration-design.md). Local only until the
> real credential and pack access exist. Writing nothing to NTER is a rule of this work, not a limit of the code.

## Current state

- The database side is merged: batches, ledger, stop rules, F290 and the Bills adapter. None of it is on NTER.
- Nothing turns a pack into sealed batches. `scripts/load-proof/` registers synthetic documents only, and has no refusal handling.
- `prepareSuppliedText`, `billTextIdentity`, `manifestSha256` and the sizing rule in `callEnd` already exist and are reused.

## Problem

The pipeline stops at the database's front door. Eight-tenths of the rules the owner approved are the runner's job, and a bad
batch costs money and leaves wrong text in a live product.

## Outcome

One command takes a collection's prepared records to a sealed batch, registers it, watches the worker and writes a receipt. It stops
itself on any named stop rule, and a rerun resumes from the ledger without paying twice.

## Design

Deno, in `scripts/bulk-runner/`, so that it imports the code the worker uses and cannot drift from it. Each stage is pure where it
can be, with one `Db` interface for the calls, so that tests need no database.

**Prepare (no database).** One record in, one request or one named hold out:

| Hold | Reason |
|---|---|
| `over_chunk_limit` | Over the policy's limit: 700 for Bills |
| `no_text`, `prepare_failed` | `prepareSuppliedText` refused it, with its message |
| `text_identity_failed` | `billTextIdentity` failed, only when the policy requires it |
| `corrigendum_unmapped` | No bill mapping for a corrigendum |
| `superseded_by_patch` | A patch record replaces it. Patches load, and the original never does |

Control codes are removed from the text before hashing, and the count is reported, because registration refuses them. Holds are
written to the receipt, never dropped.

**Plan (no database writes).** Slices prepared requests into batches of at most 10,000 documents, and calls of at most 100 documents
and 7 MB, counted on the whole request. Refuses to start when:

- the load would take a feature with no partition past 100,000 chunks;
- the batch would pass the collection's budget or chunk ceiling;
- projected disk use passes the stop line given to the run, at 13,970 bytes a chunk;
- two records share a text, unless the pack's own dedupe list names the keeper.

**Pre-check.** `ingest_text_holders`, then `ingest_register_batch` with `p_dry_run`. Any refusal the runner did not predict is a
disagreement, and it stops the batch.

**Run.** `ingest_batch_open`, `ingest_batch_add_items`, `ingest_batch_seal`, then registration call by call.

- A lost answer reads `ingest_batch_status` and re-sends only items still `planned`.
- An unexpected error backs off and retries. Two in a row stop the batch.
- `lock_timeout` 5 s and `statement_timeout` 60 s on the session.

**Pace.** Cold writes run four to five times slower, with commits up to 85 s (F293). The runner releases work in steps: the first
step is small, and the next starts only when the queue has drained and commit time is back under a set bound.

**Watch.** Polls `ingest_batch_status` until every item is indexed, failed or stopped. Requeues only what the rules allow. Reads
disk use if the run was given a way to, and stops on it.

**Receipt.** A file per batch, kept outside the repository: manifest hash, counts by outcome and reason, holds, spend, timings, runner
commit and stop reason.

## Acceptance evidence

- Unit tests for each hold, guard and stop, with each guard shown failing once.
- A fake `Db` proves: resume after a lost answer, two-failure stop, disagreement stop, no double send.
- On the load copy, with the real worker: a synthetic pack of question and bill records, a kill mid-batch, and a resume.
- Rerunning a finished batch sends nothing and spends nothing.

## Plan

Sequential. One write scope: `scripts/bulk-runner/`.

| Task | Scope | Depends on | Verification |
|---|---|---|---|
| T1. Prepare | `prepare.ts` and test | none | `deno test scripts/bulk-runner` |
| T2. Plan and guards | `plan.ts` and test | T1 | same |
| T3. Run, watch, receipt, pace | `run.ts`, `db.ts` and tests | T2 | same, with a fake `Db` |
| T4. Load copy proof | `prove.ts` | T3 | a run against PostgREST on the load copy |
| T5. Independent review | none | T4 | review notes |

## Not in this work

- **Real pack format.** Records are taken in the shape live bills and the harness show. A small pack reader follows once the service
  account gives access.
- **F291.** A strict batch cannot recover after a kill. That is a migration, and needs its own decision.
- **The per-page text check** against official PDFs, which needs network access and OCR spend. It gets its own task.
- **Acceptance (step 10), the login for `corpus_ingest`, and anything on NTER.** The credential is the owner's out-of-band step.
- **Provider batch embedding.**
