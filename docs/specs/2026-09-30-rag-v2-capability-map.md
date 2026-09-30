# RAG v2 capability map

> **Status: Living.** Approved by the owner on 2026-09-30. This is the index of
> the RAG v2 work: each module below has one spec, named by its id, and specs
> are written, reviewed and built in the order given here. Module ids never
> change. The evidence behind the map is
> `docs/research/2026-09-30-rag-v2-investigation.md`.

## Intent (owner-confirmed 2026-09-30)

- **Retrieval, on today's corpus.** Focus a question on any document, and
  filter by desk feature. Retrieval must be no worse than today on an
  evaluation set.
- **Page-aware PDF ingestion, for new documents.** Originals are kept in a
  private bucket. Mistral OCR returns page text, block boxes and page images.
  Chunks never cross a page. Citations show the page number, the text and any
  images, and open the PDF inside NTER with the box highlighted.
- **Unchanged:** the 2,338 documents already ingested keep today's citations,
  and are not OCR'd again.
- **Who adds documents.** Only platform admins: first by backend scripts
  (the 5,327 corpus records with a direct PDF link, mostly sansad.in bills),
  later through an admin upload tab. Candidate affidavits stay out. PDFs of
  any size must work.
- **Out of scope:** uploads from the chat composer and a file manager; DOCX
  and spreadsheets; plan gating; the model reading figures (Mistral bbox
  annotations stay off); reranking and hybrid search.

## Modules

| Module id | Responsibility | Depends on |
| --- | --- | --- |
| `eval` | A fixed question set with known answers, and a harness that measures retrieval quality and latency. Its first run records today's baseline. | — |
| `retrieval-scope` | Focus a question on any document by id; pre-filter search by `desk_feature`. | `eval` |
| `chunk-contract` | The page, block and image tables; the new chunk columns; the chunking rules for pages; what `match_documents` and a citation carry. | — |
| `ingestion-v2` | The private `corpus` bucket, the job table and queue, the worker, Mistral OCR, page-bounded chunking and embedding. | `chunk-contract` |
| `citations-pdf` | The page label and image strip in the text reader, and the PDF.js viewer with box highlights. | `ingestion-v2` |
| `acquisition` | Scripts that find, download and split the linked corpus PDFs and hand them to the pipeline. | `ingestion-v2` |
| `admin-upload` | The platform-admin upload tab, including splitting in the browser. | `ingestion-v2` |

**Build order:**

1. `eval`
2. `retrieval-scope`, with the `chunk-contract` spec written alongside it
3. the `chunk-contract` migration
4. `ingestion-v2`
5. a pilot of about 10 PDFs
6. `citations-pdf`
7. `acquisition`, then the linked-bills backfill (on a separate owner
   go-ahead)
8. `admin-upload`

**Running in parallel.** Once the `chunk-contract` migration has landed, the
retrieval track (`eval`, `retrieval-scope`) and the ingestion track can run in
separate worktrees. They share `match_documents` and `_shared/retrieval.ts`, so
the contract lands before either one changes them. Migrations always run one
at a time.

## Decision records that go with the specs

- **Amendment to ADR 0002.** OpenRouter is the first preference; a direct
  integration is allowed when OpenRouter has no endpoint. Mistral OCR is the
  first such case, with `MISTRAL_API_KEY` held server-side only.
- **Page citations and corpus storage.** This amends ADR 0004 where needed:
  the unit key is the page, and pages, blocks and images are tables of their
  own. The originals sit in a private bucket and are reached only through
  signed URLs that the server mints.

## Owner decisions recorded during the interview (2026-09-30)

- **Chunking** follows TenderBase's structure: split by heading, then table,
  paragraph, sentence and character, with the same sizes. Chunks never cross a
  page, tables stay inline, placeholders are atomic, and `block_ids` and
  `image_ids` are kept. NTER differs on four points:
  - A chunk's text stays an exact slice of the page text.
  - Section context is stored with each chunk and added to the embedding
    input of every chunk, carried across pages. The context is the last
    heading line plus the bill's margin note (Mistral's `aside_text`). It is
    not taken from heading levels.
  - Repeated table headers go into the embedding input only.
  - Headers and footers are judged by repetition within the document. Running
    ones (on 3 or more pages, or at least 30% of pages, digits ignored) stay
    out of search. Unique ones are put back into the page text.
- **Async processing.** A pgmq queue, a pg_cron timer, pg_net and one worker
  Edge Function. A message is "OCR this part or document" or "chunk and embed
  it".
- **Page ranges.** Large parts are OCR'd in page ranges only if the pilot shows
  one call is too slow or too large. A PDF over Mistral's limits (50 MB or
  1,000 pages) is split in the admin's browser or by the local script, never
  inside an Edge Function.
- **Access.** The corpus bucket is private. Any signed-in user reads through
  a server-minted signed URL, and only platform admins upload.
- **Mistral OCR** (`mistral-ocr-latest`, OCR 4.1) was verified on 2026-09-30
  against a 12-page bill:
  - the whole document took 1.7 s;
  - `pages: "5-7"` returns the original page indexes;
  - boxes are in pixels at the page's DPI;
  - blocks carry no id;
  - headers and footers come back separately.

  Bills are billed on the paid account (Scale plan).
