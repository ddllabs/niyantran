# Plan: ingest the large corpus (L1, L2)

> **Status: Living.** Written 2026-09-29. It is the only runbook for
> ingesting the owner's corpus snapshot, and it replaces
> `plans/2026-09-22-corpus-expansion.md`, which stays as the measured record.
> Tracked in `plans/open-work.md` as L1 and L2, with prerequisites F12, F22
> and F23 (all three are done; only the local run remains). **It runs in a Claude Code session on the owner's laptop**,
> because the corpus is only there.

## Current state (2026-09-29)

- **Supabase NTER:**
  - 2,338 documents, all chunked; 54,219 chunks; 34,184 desk rows;
  - the last document was added on 2026-09-22;
  - database 1,085 MB before F22; the search index is now `document_chunks_embedding_halfvec_hnsw`, 204 MB (it replaced the 404 MB full-precision index on 2026-09-29);
  - `shared_buffers` 512 MB (the 2 GB compute; it was 224 MB).
- **The corpus snapshot:** `~/Downloads/NTER-Complete-Processed-Data`,
  about 10 GB. It isn't in any cloud container.
  - `04_indexes/OCR_FILES.csv`: 12,830 OCR rows. This is the only input the
    current script reads, and 2,338 rows were taken (the national desk).
  - `01_original_corpus/documents.jsonl.gz`: 747 MB, 1,876,044 records. This
    is the real corpus. By `extraction`:

    | extraction | records | ingested |
    |---|---|---|
    | dataset (short metadata stubs; don't ingest) | 1,840,686 | 0 |
    | **pdf_text** (text already extracted) | **18,071** | **0** |
    | ocr | 12,830 | 2,338 |
    | html | 4,079 | 0 |
    | doc | 367 | 0 |

  - The `pdf_text` slice by `doc_type`:
    - bill 7,966;
    - parl_question 6,758;
    - regulatory 2,813;
    - budget_document 483;
    - transfer_order 29;
    - industry_document 22.
  - Of the 7,966 bills, **5,218** match `ingest/national-desk/links.json`
    with a `bill_year`, so they get a `document_key` and scope from a desk
    row. **2,104** of those are 2015–2026.
  - Today only 6 of the 1,242 desk bills from 2020–2026 have a document
    behind them. That is why attached-bill searches report "Search
    widened".

## The gate, and how it is met

The HNSW index should fit in `shared_buffers`. On 2026-09-22 a 380 MB index
against 224 MB caused cold-search pathology, and one 17 MB `chunk_commit`
took the database down for 2 min 38 s.

| Phase | New chunks | HNSW at full precision | With F22 (`halfvec`), approx. |
|---|---|---|---|
| Today | – | 404 MB (dropped) | **204 MB (measured)** |
| A: 2,104 recent keyed bills | ~74,600 | ~1.0 GB | ~0.5 GB |
| B: + 3,114 keyed bills | ~110,000 | ~1.9 GB | ~1.0 GB |
| C: + parl questions and regulatory | ~150,000 | ~3.1 GB | ~1.6 GB |

- **F22** (the half-precision expression index, live since 2026-09-29) brings
  phase A within 512 MB.
- **Phases B and C** need more compute, or acceptance that unscoped search
  will be slower. Scoped (attached-document) search doesn't use HNSW at
  all; it filters by `document_id` and scores exactly.
- Decide phases B and C with the measured numbers after phase A. Don't
  decide them now.

## Prerequisites (from the cloud, before the local session)

1. **F12. Done 2026-09-29** (`d1567d1`; `ingest-documents` v12 runs it).
   The chunker no longer treats stray OCR pipes as tables, and the chunker
   version is 2.
2. **F22. Done 2026-09-29.** The half-precision index is live and measured:
   204 MB; recall@40 0.9875 against 0.990 for the old index; 161 ms against
   224 ms.
3. **F23. Done 2026-09-29.** `scripts/ingest-national-desk.mjs --pdf-text <dir>
   --doc-type <type>`:
   - It streams `documents.jsonl.gz` line by line and keeps only
     `extraction: pdf_text` records of the doc type.
   - It resolves `document_key` through `links.json` with the same function
     as the OCR mode.
   - `--from-year` and `--to-year` filter on the bill year from the link map,
     so they imply a keyed document. `--keyed-only` keeps keyed documents of
     any year.
   - It carries `dataset_key`, `row_ref`, `integrity`, `licence_basis`,
     `prid`, `posted_on` and `profile_ref` into `documents.metadata`, beside
     the other record fields (never the text).
   - It reuses `--dry-run`, `--batch`, `--max-chars`, `--limit`,
     `--shard i/n` and `--only` with their existing meanings.
   - Tests: `src/lib/ingestPdfText.test.js` builds a small `.jsonl.gz` at run
     time.

## The local session, step by step

Environment:
- `.env.local` beside `package.json` holds `SUPABASE_URL` and
  `SUPABASE_SECRET_KEY`. Never commit it, and never print the key.
- Work on a `task/l1-corpus-phase-a` branch from an up-to-date `main`.

```bash
cd <repo>; git checkout main && git pull --ff-only
CORPUS=~/Downloads/NTER-Complete-Processed-Data

# 0. Rebuild the file-name → URL map (it is gitignored; Task 1 of the first pass).
node scripts/build-corpus-links.mjs --corpus "$CORPUS"

# 1. Dry run of phase A: prints counts, sizes and skips, and writes nothing.
node scripts/ingest-national-desk.mjs --pdf-text "$CORPUS" --doc-type bill --from-year 2015 --to-year 2026 --keyed-only --dry-run

# 2. A small real batch first, then check the database (step 4) before continuing.
node scripts/ingest-national-desk.mjs --pdf-text "$CORPUS" --doc-type bill --from-year 2015 --to-year 2026 --keyed-only --limit 20

# 3. The rest of phase A, in shards that can run side by side (two at most).
node scripts/ingest-national-desk.mjs --pdf-text "$CORPUS" --doc-type bill --from-year 2015 --to-year 2026 --keyed-only --shard 1/2
node scripts/ingest-national-desk.mjs --pdf-text "$CORPUS" --doc-type bill --from-year 2015 --to-year 2026 --keyed-only --shard 2/2
```

After each step, in the SQL editor or through the Supabase tools:

```sql
select count(*) from public.documents;                           -- rises by the batch
select count(*) from public.documents d
 where not exists (select 1 from public.document_chunks c where c.document_id = d.id); -- 0
select pg_size_pretty(pg_relation_size('public.document_chunks_embedding_halfvec_hnsw'));
analyze public.document_chunks; analyze public.documents;       -- after every bulk load (AGENTS.md)
```

Stop and investigate if any of these happens:
- a request returns HTTP 504 (the Edge Function's `IDLE_TIMEOUT` is 150 s:
  lower `--batch` or `--max-chars`);
- `docs_without_chunks` stays above zero;
- Postgres restarts. Check with `select pg_postmaster_start_time()`. After
  a restart, re-run the `analyze` statements.

Retry only the failures with `--only <source_key>`, never the whole phase.

**Phase A acceptance:**
1. In the terminal, attach a 2026 bill from the National desk and ask about
   it. The search stays scoped and does not report "Search widened".
2. Desk bills from 2020–2026 that have documents: from 6 to several hundred
   (measure with the desk-row join used in
   `specs/2026-09-22-scoped-retrieval-design.md`).
3. Record the final counts, the index size and `shared_buffers` in
   `agents/coordination.md` under that day's Operations entry. Then decide
   phase B in `plans/open-work.md`.

## Later phases

- **B:** the remaining 3,114 keyed bills. Same commands without
  `--from-year`, after the gate check.
- **C:** parliamentary questions (6,758) and regulatory documents (2,813).
  First confirm those desks want them.
- **Last:** 2,748 unkeyed bills. They're retrievable only unscoped and have
  no `file_url`.
- **L2, the law tier.** 874 Supreme Court and NCLT PDFs, first noted in the
  2026-09-21 session. Confirm their location and whether they carry a text
  layer during the local session, before sizing them. If they need OCR,
  they need their own plan.
- **Never:** the 1.84 M `dataset` stubs (491 characters on average, and
  already on the desk rows) or affidavits (parked as P7).

## Ruled out (see `plans/2026-09-22-corpus-expansion.md` for the evidence)

- crawling sansad.in (the text is already on disk);
- an OCR pipeline for `pdf_text`;
- a graph database;
- denormalising document metadata onto chunks;
- recovering the 716 missing `file_url` values from the package (they aren't
  in it; re-crawling is parked as P8).
