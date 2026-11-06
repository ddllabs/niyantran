# Registration without corpus scans (F290)

> **Status: Living (2026-11-06).** Spec and plan for F290, under the [bulk ingestion spec](2026-11-01-bulk-ingestion.md).
> Found by the [load proof](../research/2026-11-06-ingestion-load-proof.md). Merged code does not reach NTER: the migration
> applies straight after batch registration, by `psql`, with separate approval (F283).

## Current state

`ingest_admit_document` runs lookups per National document against `documents` and `desk_rows`. The batch migration is merged
and not applied on NTER, so this cost has never run there.

## Problem

On the full-size copy a real 100-document `ingest_register_batch` call is cancelled at `corpus_ingest`'s 60 s limit, and the cost
grows with the corpus. An index alone is ignored: with `ORDER BY id LIMIT 1` the planner walks the primary key and runs the
predicate on every row. A cost hint held only until an automatic analyze.

## Outcome

Registration reads indexes, not the corpus, and an analyze cannot move it back. Same holders, same refusals.

## Design

- Each `... ORDER BY id LIMIT 1` holder lookup reads its matches in a `MATERIALIZED` CTE and orders outside it, so no ordering
  is visible to the planner inside. An `OR` becomes a `UNION ALL`, so each arm can use an index.
- Applied to the three holder lookups: answer key, older pack key or file name, and duplicate text.
- The answer key lookup drops its `file_url` arm. Admission refuses a National document with no key, and one URL has one key, so
  the key lookup finds every row that arm found.
- Four partial indexes: `documents_national_answer_key`, `documents_pq_key_suggested`, `documents_pq_source_file`,
  `desk_rows_pq_source_url`.
- `ingest_admit_lock` passes question URLs as an array, not a subquery. `desk_rows_source_url_stats` gives the planner real
  numbers for that expression: it keeps none for a partial expression index, and without them it read the desk at 20 or more URLs.
- The migration runs in one transaction with a 10 s lock timeout, and refuses to run ahead of batch registration.

## Acceptance evidence

| Check | Result |
|---|---|
| Every `ingest_register_batch` case passes on the rewritten functions | Passed, by including that fixture |
| A refused 100-document call and two admitted 50-document calls each read under 1,500 rows of `documents` and of `desk_rows`, by any route, including after a further analyze | Passed; fails without the migration |
| No lookup orders in the same query as its scan | Passed. A fixture this size does not walk the key, so the shape is checked directly |
| Each lookup names the lowest id across every match | Passed |
| Each of nine deliberate breaks fails the fixture | All caught, after the shape check above was added for the first |
| Applied before batch registration | Refused, nothing created |
| The rollback note, as written | Schema matches the batch-only chain, apart from another check's scaffolding |
| Old against new, independent reviewer, on the final version | 12,000 randomized admissions and 40 lock cases: no difference |
| Independent reviewer's own breaks | 16 of 16 fail the fixture |
| Lock at NTER's shape, 144,196 desk rows | 9 of 9 100-URL calls used `desk_rows_pq_source_url`, at 8,000 and at 27,000 question rows |

## Measured on the full-size copy

About 36,500 National documents and 27,000 desk rows, more than NTER's 10,060 and 8,000. Test-only indexes and hints were removed
first. Raw results are kept outside the repository, in the harness cache.

| Run | Documents | Registration | Per document |
|---|---|---|---|
| Before | 300 | Cancelled at 60 s, in the first call of 100 | Did not finish |
| First version, batches 1 to 6 | 1,792 | 5.4 to 30.8 s | 18, rising to 104 ms |
| First version, quiet | 241 | 8.3 s | 34 ms |
| **Final version, quiet** | 241 | 4.1 s | 17 ms |
| **Final version, batches 1 to 3** | 896 | 5.1, 5.0, 6.5 s | 17, 17, 22 ms |
| **Final version, after a further analyze** | 240 | 4.5 s | 19 ms |

No commit failed in any completed run. Across the final runs, `documents` and `desk_rows` had no sequential scan at all.

A 100-document call now takes about 2 s, against a 60 s limit, and the cost did not rise across the runs. The first version
rose to 104 ms, which was read at the time as write pressure. The final version stayed flat under load, so most of that rise
came from the lock step reading the desk, or from the conditions of those batches. The two were not separated.

These are local speeds, on a copy with more documents than NTER. NTER's own speed is not measured.

## Plan

| Task | Write scope | Verification |
|---|---|---|
| Migration and fixture | `supabase/migrations/20261106120000_admission_scans.sql`, `supabase/tests/` | `npm run test:sql -- ingest_admission_scans`, with its vacuity check |
| Full-size proof | `eval/ingestion/results/` | The table above |
| Independent review | none | Changes requested and applied, then accepted at `fe08ac86`, with two wording fixes after it |
| Apply on NTER | production | Separate approval, after batch registration |

## Exclusions

- Applying anything to NTER.
- Law admission, on hold with legal.
- The worker, the runner and the other findings of F287.
