# National corpus ingest, first pass — Implementation plan

**Date:** 2026-09-21
**Spec:** `docs/specs/2026-09-20-document-rag-and-citations-design.md` §A
(Historical; the pipeline is built) and
`docs/research/2026-09-21-corpus-mapping-study.md` §6 (the decisions this
plan executes). Module id `document-rag-and-citations`, follow-up cut.
> **Status:** Historical (2026-09-21) — executed and verified; merged to
> `main`. The verification record and the limitations below are the evidence.
> Open remainders are tracked in `plans/open-work.md` (ids L1, P7).

**Goal:** Every current OCR document of the Bill Passage Probability
Index, Regulatory Body Watch, Parliamentary Question Database, Industry
Updates and Budget Utilisation features — 2,338 documents — is in `NTER`
with its text, its chunks and embeddings, its sansad.in file URL and bill
identity where the corpus provides them, and a `document_key` that desk
rows can carry. Affidavits are not touched.

**Architecture:** One new script builds a link map from the corpus's
dataset records once (`ingest/national-desk/links.json`, gitignored). The
existing ingest script gains a `--corpus` mode that reads the OCR index,
joins the link map, and posts to the deployed `ingest-documents` function
in small batches, one document per request above a size threshold. No
function or schema change.

**Tech stack:** Node 23 streams (`zlib`, `readline`) over
`documents.jsonl.gz`; the existing edge function; SQL evidence.

**Branch:** `task/corpus-ingest`, from `main`. Sequential.

## Global constraints

- The corpus stays outside the repository. Inputs are read from
  `/Users/vighneshshukla/Downloads/NTER-Complete-Processed-Data` through a
  `--corpus <dir>` argument; outputs go under `ingest/` (gitignored).
- Only `in_current_corpus = True` rows of `OCR_FILES.csv` are ingested; one
  text version per id.
- `source_key` stays the corpus document id, as for the ten already
  ingested, so re-running is an update, not a duplicate.
- Documents above `--max-chars` (default 2,000,000) are skipped and listed;
  documents above 200,000 characters go one per request.
- No secret in the tree; `SUPABASE_SECRET_KEY` from the environment only.
- Nothing is pushed; the owner names the push.

## Fixed interfaces

```
scripts/build-corpus-links.mjs --corpus <dir> [--out ingest/national-desk/links.json]
  → { built_at, records_scanned, links: { "<file name>": { url, doc_type, title, bill_number?, bill_year?, house?, status? } } }

scripts/ingest-national-desk.mjs --corpus <dir> --feature "<feature>" [--links <file>] [--dry-run] [--batch 10] [--max-chars 2000000] [--limit N]
  per document posted:
    source_key   = id
    title        = bill title from the link map when present, else the index title
    file_name    = document_name
    file_url     = link url or null
    desk_tier    = 'national'
    desk_feature = feature (index)
    metadata     = { source_path, doc_type, ocr_lang, n_pages, n_chars, integrity, text_sha256,
                     title_stem, file_url_source?, document_key?, bill_number?, bill_year?, house?, status? }
  document_key   = `bill:<year>:<number>` when the link map yields both; absent otherwise
```

## Tasks

### Task 0 — Branch and baseline

1. `git checkout -b task/corpus-ingest`.
2. `npm test`, Deno tests, build: green before any change.

### Task 1 — `scripts/build-corpus-links.mjs`

Streams `01_original_corpus/documents.jsonl.gz` line by line; for records
whose line contains `http`, extracts every `https?://…` URL whose base
name ends in `.pdf`, `.doc` or `.docx`; records `{ url, doc_type, title }`
per base name, preferring a `bill_record` over a `text_document` for the
title and adding `bill_number`, `bill_year`, `house`, `status` parsed from
the record text's `billNumber:`, `billYear:`, `billIntroducedInHouse:`,
`status:` lines. A base name seen with two different URLs is kept with
`ambiguous: true` and no URL. Writes the map and prints counts.

**Verify:** the map holds ≥ 200,000 names (the study measured 203,599),
the ten smallest resolve exactly as in the study (eight with URLs, two
without), and `2005-115-gaz.pdf` yields the Prevention of Insults title,
`bill_number 115`, `bill_year 2005`.

### Task 2 — `--corpus` mode in `scripts/ingest-national-desk.mjs`

Reads `04_indexes/OCR_FILES.csv`, filters to the feature and
`in_current_corpus`, loads each `markdown_path`, joins the link map, and
posts as in Fixed interfaces. `--batch` and `--max-chars` as above;
documents above 200,000 characters are posted alone. `--limit N` for a
smoke run. Output one line per document plus totals and a list of skipped
documents.

**Verify (dry run):** `--feature "Parliamentary Question Database"
--dry-run` reports 82 documents, 0 errors; the one already ingested
(`184_AU172_5LFTB7`) reports as a re-chunk of an existing document.

### Task 3 — Ingest, smallest feature first

In order, each followed by the same command re-run to prove
idempotence: Budget Utilisation (1), Industry Updates (6), Parliamentary
Question Database (82), Regulatory Body Watch (506), Bill Passage
Probability Index (1,743, with `--max-chars` skipping the 5.4 M-character
document, listed for a later large-document path).

**Evidence (SQL):** per feature, `documents` count equals the index count
minus skips; every chunk exact-span; `file_url` filled for ≈ 1,620 bills;
`metadata->>'document_key'` filled for the same; `model_call_logs` totals
(tokens, USD) recorded here; the ten original documents unchanged in id.

### Task 4 — Close

Plan → Historical with the verification record; coordination.md shared
knowledge updated with the corpus counts; merge to `main`.

## Risks

| Risk | Mitigation |
|---|---|
| Edge function time or body limits on large documents | one document per request above 200 k chars; skip above 2 M and list |
| OpenRouter rate limits over ~2,300 documents | the client retries 429 with backoff; the script continues per document and reports errors; re-run picks up only misses |
| A re-run re-embeds unchanged text | `content_sha256` + `chunker_version` short-circuit, proven on the ten |

## Verification record

Filled during execution.

| # | Check | Result |
|---|---|---|
| 3 | Throughput and the 8 s timeout | one process ≈ 10 documents/min; eight shards hit `chunk_commit` statement timeouts (service role inherited 8 s) → migration 0010 (300 s); then `546 WORKER_RESOURCE_LIMIT` and `504` from the function → two shards, `--batch 3` |
| 3 | Budget, Industry, Questions, Regulatory | complete: 1 + 6 + 82 + 506 documents, 0 errors after the timeout fix; Regulatory re-run all `unchanged` |
| 3 | **Database restarts under the two-shard bills pass** | Postgres restarted at ≈ 07:24 and 07:40:41 UTC on 2026-09-21 (`pg_postmaster_start_time`); PostgREST answered 503 / "Could not query the database for the schema cache" for minutes each time; 108 + 22 documents errored across the two attempts (none marked indexed, so re-runs re-index them). The project is on the base Nano compute with no add-on (224 MB shared buffers, `work_mem` 2 MB) and the vector index is 435 MB; two concurrent embedding writers exhaust it. Decision: one process, `--batch 2`, from 07:46; the compute question goes to the owner |
| 3 | State at 07:44 UTC | 1,630 documents indexed, 26,351 chunks (435 MB); bills ≈ 1,530 of 1,743 done |
| 3 | Single gentle pass (`--batch 2`, 07:48–09:46 UTC) | live then re-run for bills, regulators and questions; all six passes exited 0; regulators and questions re-ran entirely `unchanged`, so both features are complete |
| 3 | **Final counts** | 2,337 documents, 51,057 chunks. Bills 1,739 of 1,742 in the index (1 skipped above 2 M characters, 2 unindexed — see below); Regulatory Body Watch 506/506; Parliamentary Questions 82/82; Industry Updates 6/6; Budget Utilisation 1/1 |
| 3 | Provenance | 1,616 bill documents carry both `file_url` and `metadata.document_key` (`bill:<year>:<number>`); the other features have no URL in the corpus records, as the study measured |
| 3 | Spend | `model_call_logs` totals 0.2886 USD over 2,383 calls, embeddings only |
| 4 | Merge | `task/corpus-ingest` merged to `main` on 2026-09-21 alongside the desk-row and agent modules. Not pushed; the owner names the push |

## Known limitations

- **Two bill documents are stored but not indexed**, so nothing can retrieve
  them. "The Finance Bill, 2006" (969,286 characters) fails `chunk_commit`
  with a 503 on every attempt — it is simply too heavy for this instance.
  "The National Waterway (Kakinada-Puducherry …) Bill, 2008" (5,306
  characters) is small and failed only to a transient 503; another re-run
  would very likely pick it up, and none was made because the instance had
  already restarted twice today. Everything else in the first pass is
  indexed. A third pass is `node scripts/ingest-national-desk.mjs --corpus
  <dir> --feature "Bill Passage Probability Index" --batch 1`.
- **One bill is skipped by size**, above the 2,000,000-character ceiling. A
  large-document path (page-wise chunking, or commits in slices) is the fix
  for both it and the Finance Bill.
- **The compute is the constraint, not the pipeline.** `NTER` runs on the
  base Nano instance with no add-on (224 MB shared buffers, 2 MB
  `work_mem`) against a 435 MB vector index. Two concurrent embedding
  writers restarted Postgres twice; one writer at `--batch 2` completes but
  still meets occasional 503s. Raising the compute is the owner's call, and
  is what the affidavit corpus (10,492 documents, 809 M characters) would
  need before it could be attempted at all.
- **Affidavits, and the rest of the corpus, are deliberately not loaded.**
  See `docs/research/2026-09-21-corpus-mapping-study.md` §6.
