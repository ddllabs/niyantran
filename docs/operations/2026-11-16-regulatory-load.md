# Regulatory v1.1 load on NTER, files 2 to 27 (F330)

> **Status: Historical (2026-11-16).** The rest of the Regulatory v1.1 load on NTER, on the developer's go-ahead
> ("load the rest"). It follows [the record of 2026-11-15](2026-11-15-release.md), which covers the first file. Open
> work: F330 (the search-check result below needs the developer's decision).

Runner from `main` at `dc92bb60`, clean. Records: the 26 remaining part files of the live screen of 2026-11-15
(2,505 records). All times UTC.

## Steps

| Step | Result | Time |
|---|---|---|
| Policy `national-regulatory` re-approved (decision `F330-national-regulatory-ceiling-2026-11-16`) | chunk ceiling 200,000 to 260,000; nothing else changed | 02:58 |
| Parts 001 to 026, one at a time, acceptance on 50 documents each | 26 batches, 2,505 admitted, 0 refused, 2,505 jobs succeeded | 02:58 to 09:35 |
| `analyze` on `document_chunks_regulatory` and `documents` | after each part from 008 on, and at the end (with `desk_rows`) | to 09:36 |
| `ingest_settings` put back | `max_running` 16 to 1, `claim_batch` 8 to 2 (decision `F330-regulatory-load-revert-2026-11-16`); no unfinished job | 09:36 |
| E2, read-only: the same 55 Regulatory questions as E0 and E1 | Doc@10 40 of 55 (E0 and E1: 50 of 55) | 09:41 |

## The whole collection after the load

| Measure | Value |
|---|---|
| Batches of `national-regulatory` | 27, all `indexed` |
| Records admitted | 2,605 of 2,605; none refused; no failed or uncertain job |
| Chunks planned and stored for the load | 170,822 |
| Regulatory on NTER | 3,079 documents, all indexed; 183,805 chunks, none without a vector |
| Acceptance | 27 reports, all passed; 1,305 documents sampled, 0 failures, 0 index misses |
| Embedding spend logged by the runner | US$0.61 (planned estimate US$0.92; budget US$5) |
| Database size | 16.78 GB before the first file, 19.54 GB after the last |

The full load was estimated at about 229,000 chunks; it came to 170,822, so the earlier ceiling of 200,000 would have
been enough. The ceiling stays at 260,000.

## The search check fell from 50 to 40 of 55

Feature mode, 55 questions whose reference chunks exist on NTER; ranking is the order `match_documents` returns.

| Measure | E0 (before any load) | E1 (after 100) | E2 (after 2,605) |
|---|---|---|---|
| Document in the first 5 | 47 | 47 | 40 |
| Document in the first 10 | 50 | 50 | 40 |
| Document in the first 40 | 53 | 53 | 45 |
| Reference chunk in the first 40 | 51 | 51 | 39 |
| Search time, median | 3.0 s | 2.9 s | 2.9 s |

Ten questions lost their reference document from the first 10; none gained. For each of the ten, the exact (no index)
ranking was computed on NTER, read-only, with the same question vector:

- Nine: the exact search also ranks other documents above the reference one (9 to 36 documents ahead), and most of
  those are documents loaded in this collection (8 to 33 of them). The index agrees with the exact order; the new
  documents simply score higher for these questions.
- One (`q-0133`): the exact search ranks the reference document first, and the index does not return it in the first
  40. That is an index miss.

What this does and does not show: the questions were written from single documents when the desk held 474; the desk
now holds 3,079 from the same regulators, and a question such as "what did the Commission conclude on section 4" fits
many of them. Whether the newer documents are equally good answers was not judged. No question was asked through the
site.

**The script's verdict line is not evidence here.** `eval-retrieval.mjs --compare` printed "no worse" for E1 and for
E2. Its comparison counts lost questions in broad mode only; these runs were feature mode, so the verdict compared
nothing. The record of 2026-11-15 quotes that verdict for E1; E1's figures were in fact equal to E0's, as the table
shows. Read the figures, not the verdict, until the script compares the mode it ran.

## What went wrong

- **Acceptance ended without a report three times** (part 008 once, part 019 twice); the batches themselves were
  indexed each time. Cause, from the computer's sleep log: the machine running the runner slept with its lid closed
  (04:24 to 04:40, and on and off from 07:02 to 08:00), so the acceptance queries overran their client limit. Repeating
  the same command, awake, passed both. The runner does not keep the error text when acceptance throws, which is why
  the cause had to be found from the sleep log.
- Part 024 printed a database notice that a word longer than 2,047 characters is not indexed for keyword search. The
  document is loaded and searchable by meaning.

## Not done

- No signed-in question on the site about one of the new documents; attribution in citations (F332) not spot-checked.
- The 714 records the screen held are not loaded (by design; reasons are in the screen receipt).
- Titles and dates of the new documents are as the pack gives them (F346): mostly file names, mostly no date.
- The cold hybrid measurement (F324, F288) was not part of this load. It was taken afterwards, at 11:19 UTC, and is
  recorded in the [hybrid runbook](2026-11-09-hybrid-apply-and-measure.md).

## Rollback

The 2,605 documents can be removed by batch (27 batch ids in the receipts kept outside the repository). No removal is
made without the developer's specific approval.
