# Cabinet Decisions remainder load on NTER (F374)

> **Status: Historical (2026-11-20).** The remaining 747 eligible records of the Cabinet Decisions desk on NTER, in
> parts 001 to 008 of the National collection, pack v1.1. Part 000 (100 records) is in the
> [first batch record](2026-11-20-cabinet-first-batch.md). Spec:
> [hands-off loads](../specs/2026-11-20-hands-off-loads.md). Open work: F374 (other desks remain) and F394.

All times are UTC on 2026-11-20. Figures were read on NTER unless marked as arithmetic. Nothing was deleted.

## Collection and screening

- Collection `national-cabinet`, pack v1.1: 847 eligible records in total.
- 21 records were held at screening as too short.
- Part 000 (100 records) was loaded first, as recorded in the first batch record. The remaining 747 records are
  parts 001 to 008.

## Attended sitting at raised limits

For this sitting the worker limits were raised to max running 16 and claim batch 8.

- Part 001, batch `08513568-1f33-496d-aaea-27d7629b7c28` (100 records): accepted 50 of 50.
- Part 002, batch `2537b346-a727-4173-bce5-e490864b5eaa` (100 records): the operator's machine slept with its lid
  closed from 08:58 to 09:16 UTC. The batch indexed, but acceptance timed out.
- The limits were put back to max running 1 and claim batch 2 at 09:19:05 UTC (decision
  `F374-cabinet-remainder-revert-2026-11-20`).
- Part 002 was accepted later with the new `accept --batch` command: 50 of 50, at 11:05 to 11:09 UTC.
- Measured speed at the raised limits: 100 documents in 6.5 to 7 minutes. Arithmetic: about 14 to 15 documents a
  minute.

## Hands-off sitting at normal limits

This was the first use of `run --register-only` (item F394). The limits stayed at the normal values, with no settings
change.

Parts 003 to 008 registered between 11:09:38 and 11:12:01 UTC, about 19 seconds each. In all 547 documents were
admitted and 0 were refused, giving 1,697 planned chunks.

| Part | Batch id | Records | Chunks | Spend (US$) |
|---|---|---|---|---|
| 003 | `9ecc99f4-9b92-4822-b980-86a529b73498` | 100 | 273 | 0.000911 |
| 004 | `12b16401-eb5b-44b0-9e2a-2710cdca6ff6` | 100 | 290 | 0.000975 |
| 005 | `7b0a6dcf-518b-4c8d-8d63-73c68cb2e227` | 100 | 280 | 0.000939 |
| 006 | `5bab7c24-c10e-43a7-bcfe-a4e036920fe8` | 100 | 366 | 0.001281 |
| 007 | `ff0296a1-b407-4e45-b885-cd7899177579` | 100 | 354 | 0.001214 |
| 008 | `3a7f2e11-9a24-46dd-9829-b1b7690bea8a` | 47 | 134 | 0.000427 |

The totals of the six batches (547 records, 1,697 chunks) are the sums of this table, which match the figures read on
NTER. Spend for the six batches was US$0.005747 (sum of the table; estimate US$0.008579). Spend for all nine Cabinet
batches was about US$0.0101 (figure read on NTER).

## Indexing with no client attached

- The first job started at 11:10:08 UTC and the last finished at 15:43:10 UTC: 4 h 33 min for 547 documents.
  Arithmetic: about 2 documents a minute, about 50 minutes per 100 documents.
- 0 jobs failed and 0 were uncertain.

## Acceptance

`accept --all` ran from 15:43:39 to 16:07:31 UTC: 6 of 6 batches accepted. It sampled 50 documents per batch; part 008
had 47, the whole batch. There were 0 failures and 0 index misses. It skipped the two batches that already had passing
reports.

## Analyze and final state

- `analyze` on `public.documents`, `public.document_chunks` and `public.desk_rows` finished at 16:08:58 UTC.
- `n_live_tup` equals the real counts: documents 26,741; desk_rows 144,196; `document_chunks_default` 71,053.

State at 16:09 UTC:

- Cabinet: 847 documents and 2,943 chunks, none without an embedding.
- Ingest jobs: 23,284, all succeeded.
- Batches: 45, all indexed.
- Worker limits: max running 1, claim batch 2.
- Default chunk partition: 71,053 chunks. Database: 18 GB.

## Search check

The same method as the first batch record: `match_documents` as the `authenticated` role in a read-only transaction,
for the desk Cabinet Decisions. It returned 40 results, all Cabinet, from 39 distinct documents. The probe document was
at rank 1 with similarity 1.0000. The search took 512 ms. The probe was a stored chunk vector of a loaded document, not
an embedded question.

## Findings

1. The failure-rate stop was not live for this load. Cabinet's `min_decided` is 400, and every batch had 100 or fewer
   documents. The spend and uncertain-count stops were live.
2. Batches of at least `min_decided` are not practical hands-off today. The runner waits between registration steps
   inside a batch after the first 100 documents, which keeps the operator's machine attached.
3. Raised limits were not used hands-off, because nothing on Supabase puts them back.
4. `run` does not check that the receipts folder exists before it registers.
5. `accept --all` with nothing to do prints "0 of 0 batches accepted".
6. `accept` reads batch status first, and that read moves a finished batch from registered to indexed. A batch that
   nobody reads stays `registered`.

Findings 2 to 6 are also listed in the [spec](../specs/2026-11-20-hands-off-loads.md).

## Not verified

- A real question through the site.
- The publisher name in a chat citation. The chat function was not redeployed.
- The search speed of the default partition near 100,000 chunks.

## Rollback

Nothing was deleted. Removing any of these documents would need a separate step, approved on its own.

## Raw outputs

Raw outputs are kept outside the repository, in `~/niyantran-eval-cache/f374-cabinet-remainder-2026-11-20/` and
`~/niyantran-eval-cache/f379-hands-off-2026-11-20/nter/`.
