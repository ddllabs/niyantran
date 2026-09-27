# Corpus expansion — picking this up after the instance upgrade

Status: **Living** — parked until the Supabase instance compute is raised
(owner decision 2026-09-22). Nothing built.

Written 2026-09-22, parked deliberately. Everything below is measured, not
estimated, unless a line says otherwise. Read with
`docs/specs/2026-09-22-scoped-retrieval-design.md`, which covers the retrieval
defects D1-D4, D6 and D7. This file is about D5: the corpus itself.

## Why this is parked

Ingesting what we already hold would take the HNSW index from 404 MB to between
1 GB and 4 GB, against **224 MB of shared_buffers**. On 2026-09-22 a 380 MB index
already produced cold-search pathology, and a single 17 MB `chunk_commit` killed
the postmaster for 2 minutes 38 seconds. The instance is the gate. Nothing below
should be attempted before it is raised.

One mitigation earned today: after D1, a **scoped** search does not touch HNSW at
all - it pre-filters on `document_id` and scores exactly. Corpus growth therefore
costs nothing on the attached-document path, which is the path this expansion
exists to serve. It degrades only unscoped/broad search. Growth is safer than it
was this morning; it is not free.

## The discovery that changes the plan

`scripts/ingest-national-desk.mjs` reads `04_indexes/OCR_FILES.csv`. That index
holds **12,830 rows**, all of them `extraction: ocr`. It is not the corpus.

`01_original_corpus/documents.jsonl.gz` (747 MB) holds **1,876,044 document
records**:

| extraction | records |
| --- | --- |
| dataset | 1,840,686 |
| **pdf_text** | **18,071** |
| ocr | 12,830 |
| html | 4,079 |
| doc | 367 |
| text | 11 |

We have ingested 2,337 documents, all from the `ocr` slice. The entire
`pdf_text` slice - PDFs whose text layer was already extracted, no OCR needed -
has never been touched:

| doc_type | documents | avg chars |
| --- | --- | --- |
| **bill** | **7,966** | 34,871 |
| parl_question | 6,758 | 8,066 |
| regulatory | 2,813 | 59,470 |
| budget_document | 483 | 62,050 |
| transfer_order | 29 | 2,343 |
| industry_document | 22 | 116,229 |

Verified real text, not stubs: `"AS INTRODUCED IN THE RAJYA SABHA ... Bill No.
LXII of 2013"`.

### The bills specifically

- 7,966 `pdf_text` bills, **0 of them already ingested** (compared by id against
  the 1,743 we hold - the two sets are disjoint)
- **5,218** have a filename that matches `ingest/national-desk/links.json` with a
  `bill_year`, so they resolve to a `document_key` and **will scope**
- **2,104 of those are 2015-2026**, including **60 for 2026, 89 for 2025, 111 for
  2024**

That is the coverage gap. Distinct bill keys on the desk that resolve to a
document today: 2020-2026 **6 of 1,242 (0.5%)**; 2000-2009 831 of 1,797 (46%).
The corpus is a 2000s archive; the desk shows current business.

### What `bill_record` is not

There are also 14,675 `doc_type: bill_record` entries covering 1952-2026, and
they look tempting. They are `extraction: dataset` and average **491
characters** - metadata stubs, e.g. `"[sansad_bills_full_10099] The Constitution
(Amendment) Bill, 1990 ..."`. That is what the desk row already carries.
Ingesting them would add rows and no evidence. Do not.

## Sizing, and why the instance is the gate

Basis: the 1,743 bills already loaded average 20,259 characters and 24 chunks;
the corpus averages 984 characters per chunk and **7,821 bytes of HNSW index per
chunk**.

| plan | new chunks | HNSW after | embedding cost |
| --- | --- | --- | --- |
| Phase A: 2,104 recent keyed bills | ~74,600 | ~1.0 GB | ~$0.50 |
| Phase B: + 3,114 remaining keyed bills | ~110,000 more | ~1.9 GB | ~$0.75 |
| Phase C: + parl questions and regulatory | ~150,000 more | ~3.1 GB | ~$1.00 |
| everything `pdf_text` | ~540,000 | ~4.2 GB | ~$2.50 |

Embedding cost is trivial throughout and is not a consideration. Index size
against `shared_buffers` is the only one that matters. Size the instance for the
phase you intend to reach, not the phase you start with.

## Phases

Each is independently verifiable, narrowest value first.

1. **Phase A - 2,104 bills, 2015-2026, with a `document_key`.** Fixes the
   reported complaint directly. Acceptance: attach a 2026 bill in the panel and
   the scoped search holds instead of reporting "Search widened".
2. **Phase B - the remaining 3,114 keyed bills.** Deepens historical coverage.
3. **Phase C - parliamentary questions (6,758) and regulatory (2,813).** Serves
   other desks; revisit whether those desks want it.

The 2,748 `pdf_text` bills with no link match are last: they have text but no
`document_key`, so they are retrievable in an unscoped search and cannot be
scoped to from a desk row. Worth ingesting for breadth, worthless for the
attach-a-bill flow, and they carry no `file_url`.

## What has to be built

**A new ingest path.** `ingest-national-desk.mjs` only knows `OCR_FILES.csv`, so
it cannot see any of this. The new path reads `documents.jsonl.gz`, selects
`extraction: pdf_text` and the chosen `doc_type`, and posts to the existing
`ingest-documents` edge function - which already chunks, embeds, and commits in
slices of 100 (migration of 2026-09-22; the slicing fix handles large bills).

Reuse without change: `chunk-commit` slicing, `existingHashes` paging (both
fixed today), `fromCorpusRow`-style metadata assembly, and the `--only` flag
pattern for a bounded retry.

Carry into `documents.metadata` at ingest, because the original records have
fields the OCR sidecars never had and we currently drop: `dataset_key`,
`row_ref`, `integrity`, `licence_basis`, `prid`, `posted_on`, `profile_ref`.

## Ruled out, with reasons - do not revisit without new evidence

- **Crawling sansad.in.** Unnecessary. `links.json` holds 7,293 bill PDF URLs and
  a fetch was proven to work (HTTP 200, text layer present, no OCR needed) - but
  the text is already on disk in `pdf_text`. A crawl would re-acquire what we
  have, and would raise a licence question (`gazette_s52_1_q_i_unconfirmed`) that
  reading our own package does not.
- **An OCR pipeline.** The `pdf_text` slice is already extracted.
- **A graph database.** The relationship a graph would model already exists:
  `document_chunks.document_id uuid NOT NULL`, indexed by
  `document_chunks_document_order`. This is the equivalent of TenderBase's
  `tender_id`. Scoping through it was measured at 40/40 chunks in 12-16 ms.
- **Denormalising document metadata onto `document_chunks.metadata`.** Buys
  nothing: scoping works through `document_id` today. TenderBase explicitly
  removed the same denormalisation - migration 20260730192839, "Undo part 1's
  denormalisation (not needed)" - and scopes tenancy by joining the parent.
- **Recovering the 716 missing `file_url` values from the package.** Scanned all
  1,876,044 records: no field anywhere holds a URL (4 records have one inside
  `text`). The 1,622 URLs we do have were scraped from filenames by
  `build-corpus-links.mjs`. Good news for the future, though: links.json matches
  5,218 of the 7,966 new bills, so most Phase A/B documents arrive *with* a URL.

## Corrections made while investigating this - so they are not re-made

- "Everything ingestible is already ingested" was **wrong**. It was true of
  `OCR_FILES.csv` and false of the corpus. The index is a slice, not a manifest.
- "The 716 URLs are unrecoverable" was **too strong**. They are not in the
  package; the hosts and filenames are known, so they are re-crawlable. Different
  problem, different cost.
- "Chunk count scales with character count" is **false**. The Finance Bill 2006
  averaged 1,059 chars per chunk; the Customs Tariff Bill 2003 averaged 2,405.
  Estimating one document's chunk count from another's is unsafe - always dry-run.
- The invocation ceiling is **`IDLE_TIMEOUT`, 150 s**, returned as HTTP 504. An
  earlier note called it "~104 s"; that was a client wall clock, not the limit.

## State at the time of parking

2,338 documents, all indexed. 54,219 chunks, all embedded. 34,184 desk rows.
Provenance complete on 2,338 of 2,338. `match_documents` and `search_desk_rows`
both rewritten today and live. Postgres up 2.6 hours with no restart since the
08:49 incident.
