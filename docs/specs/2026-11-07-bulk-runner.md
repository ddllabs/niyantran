# Bulk runner (F285)

> **Status: Living (2026-11-07).** Spec and plan for step 9 of the [bulk ingestion spec](2026-11-01-bulk-ingestion.md). Interfaces
> are fixed by section 7 of the [registration design](../research/2026-11-02-batch-registration-design.md). Local only until the
> real credential and pack access exist. Writing nothing to NTER is a rule of this work, not a limit of the code.

## Current state

- The database side is merged: batches, ledger, stop rules, F290 and the Bills adapter. None of it is on NTER.
- Nothing turns a pack into sealed batches. `scripts/load-proof/` registers synthetic documents only, and has no refusal handling.
- `prepareSuppliedText`, `billTextIdentity`, `manifestSha256` and the sizing rule in `callEnd` already exist and are reused.

## Problem

The pipeline stops at the database's front door. Many of the rules the owner approved are the runner's job, such as patches first,
oversized holds and stopping itself, and a bad batch costs money and leaves wrong text in a live product.

## Outcome

The runner takes a collection's prepared records to sealed batches, registers them, watches the worker and writes a receipt per
batch. It stops itself on any named stop rule, and a rerun resumes from the ledger without paying twice. This work builds the runner's
stages as a library; the command line and the production `Db` come with the pack reader (see the last section).

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
| `patch_not_in_pack`, `patch_key_mismatch` | A patch names a record the pack does not hold, or a different one |
| `corrigendum_conflict` | A corrigendum's own citation or key disagrees with its mapping |
| `control_codes_excess` | More than 10 control codes and more than 1 in 200 characters: likely a shifted font, not stray codes |
| `duplicate_of_keeper` | Set by the plan: another record keeps this text, by the pack's dedupe list |

Control codes are handled after the pack's hashes are checked against the original text, so a record cannot be altered and then
rehashed as clean. Up to the cap they are removed, the hashes are recomputed, the count is reported, and a bill carries its pack hash
as `original_text_sha256`. Registration refuses them otherwise. On 2,896 live bills, 510 have some, 149 more than 10 and 9 more than
100, at most 143. `maxChunks` must be given; there is no default. Any claim in the pack that a text matches its bill is dropped, since
only the runner's own check says so. Holds are written to the receipt, never dropped.

**Plan (no database writes).** Slices prepared requests into batches of at most 10,000 documents, and calls of at most 100 documents
and 7 MB, counted on the whole request. Refuses to start when:

- the load would take a feature with no partition past 100,000 chunks;
- the batch would pass the collection's budget or chunk ceiling, with the estimate raised by `costHeadroom` (default 1.25);
- a record's chunk count is unknown;
- projected disk use passes the stop line given to the run, at 13,970 bytes a chunk;
- two records share a text, unless the pack's own dedupe list names the keeper.

**Pre-check.** `ingest_text_holders`, then `ingest_register_batch` with `p_dry_run`. Each collection lists the refusals it expects, such
as `no_desk_row`, which about 4% of live bills would get. Those are counted by reason and governed by the policy's refusal thresholds,
and the dry run's verdict binds the real call. Any other refusal is a disagreement, and it stops the batch. Expected refusals over
`maxAllowedRefusalShare` of the batch stop it before anything real is sent.

**Run.** `ingest_batch_open`, `ingest_batch_add_items`, `ingest_batch_seal`, then registration call by call.

- A lost answer reads `ingest_batch_status` and re-sends only items still `planned`.
- An unexpected error backs off and retries. Two in a row stop the batch.
- `lock_timeout` 5 s and `statement_timeout` 60 s on the session.

**Pace.** Cold writes run four to five times slower, with commits up to 85 s (F293). The runner releases work in steps: the first
step is small, and the next starts only when the queue has drained and commit time is back under a set bound.

**Watch.** Polls `ingest_batch_status` until every item is indexed, failed or stopped. Requeues only what the rules allow, once a
job. A requeue the database refuses stops the batch at once by name, rather than asking again until the watch limit. Reads disk use if
the run was given a way to, and stops on it. A quiet queue is not a finished batch: the database must say indexed with nothing failed
or uncertain, or the run stops with `batch_incomplete`.

**Chaining.** A batch starts only after the one before it passed acceptance, through a required `accept` function. Absent, false or
throwing, the run stops with `awaiting_acceptance`.

**Stops** the run can name, besides the plan's: `open_refused`, `seal_refused`, `batch_stopped`, `two_failures`,
`precheck_disagreement`, `registration_disagreement`, `drain_timeout`, `watch_timeout`, `requeue_refused`, `disk_stop_line`,
`items_undecided`, `batch_incomplete`, `refusal_share_over_cap`, `awaiting_acceptance`, `bad_input`, `runner_error` and
`receipt_write_failed`.

**Receipt.** A file per batch, kept outside the repository: manifest hash, counts by outcome and reason, holds, spend, timings, runner
commit and stop reason.

## Acceptance evidence

- Unit tests for each hold, guard and stop, with each guard shown failing once.
- A fake `Db` proves: resume after a lost answer, two-failure stop, disagreement stop, no double send.
- On the load copy, with the real worker: a synthetic pack of question and bill records, a kill mid-batch, and a resume.
- Rerunning a finished batch sends nothing and spends nothing.

Result on the full-size copy, `scripts/load-proof/bulk-proof.ts`, with the real worker, on 2026-11-07: a 226-document batch of
bills, killed after one call of 100, then resumed from the ledger in two calls, with one answer lost on the way and one failed document
requeued. All 21 checks pass, including no document admitted twice, the patch loaded in place of its original, a control code
removed, a corrigendum on its bill, an expected refusal written nowhere, and a rerun, with the workers still running, that sent and
bought nothing. Eight deliberate breaks each fail the check meant to catch them: a resume that resends everything, a ledger that
disagrees, a tampered record, a dropped text check, a refused requeue, a disk stop line, slow commits and a rerun that buys. 99 unit
tests pass, and the requeue test was shown failing before its fix.

## Plan

Sequential. One write scope: `scripts/bulk-runner/`.

| Task | Scope | Depends on | Verification |
|---|---|---|---|
| T1. Prepare | `prepare.ts` and test | none | `deno test scripts/bulk-runner` |
| T2. Plan and guards | `plan.ts` and test | T1 | same |
| T3. Run, watch, receipt, pace | `run.ts`, `db.ts` and tests | T2 | same, with a fake `Db` |
| T4. Load copy proof | `scripts/load-proof/bulk-proof.ts` | T3 | a run against PostgREST on the load copy |
| T5. Independent review | none | T4 | review notes |

## Not in this work

- **Real pack format.** Records are taken in the shape live bills and the harness show. A small pack reader follows once the service
  account gives access.
- **F291.** A strict batch cannot recover after a kill. That is a migration, and needs its own decision.
- **The per-page text check** against official PDFs, which needs network access and OCR spend. It gets its own task.
- **The command line and the production `Db`** (direct pooler connection as `corpus_ingest`). The proof uses a PostgREST `Db`.
- **Acceptance (step 10)**, which supplies `accept`. **The login for `corpus_ingest`, and anything on NTER.** The credential is the owner's out-of-band step.
- **Provider batch embedding.**
