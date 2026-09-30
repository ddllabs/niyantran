# RAG v2 investigation: retrieval, page-aware ingestion and PDF citations

> **Status: Historical (dated 2026-09-30).** Phase A of the RAG v2 work: what
> the code, the corpus and the official documentation say before any spec is
> written. It records evidence, not decisions; decisions go in the specs and
> ADRs that follow. Five read-only agents (A1–A5) gathered the material; the
> supervisor re-checked the load-bearing claims. Each claim is marked
> **executed** (a command or query was run) or **read** (read from code or
> docs). Nothing was edited, deployed or written to the database.

## 1. The confirmed intent (owner, 2026-09-30)

- **Outcome.** Two things.
  - Better retrieval on today's corpus: focus a question on any document, and
    filter by desk feature.
  - A new PDF pipeline for new documents: originals in a private bucket;
    Mistral OCR with pages, block boxes and page images; page-bounded chunks;
    embeddings. Citations show page number, text and images in the Work panel,
    and open the PDF inside NTER with the box highlighted.
- **Users.** Every signed-in researcher, over one global corpus. Only platform
  admins add documents: first by backend scripts that find originals from
  source links and APIs, later through an admin upload tab.
- **Success.**
  1. Any-document focus works, and an evaluation set shows retrieval no worse
     than today with fast scoped searches.
  2. A pilot of about 10 PDFs gives the right page and text, the right
     highlighted box, images shown, cost recorded per document, and no OCR
     cost when a document is re-run.
- **Constraints.**
  - The 2,338 existing documents stay as they are, with no re-OCR.
  - PDF only.
  - OpenRouter is the first preference; direct APIs are allowed where it has
    no endpoint (Mistral OCR). This needs an amendment to ADR 0002.
  - Mistral bbox annotations stay off. The model does not read figures.
  - No plan gating.
  - Nothing scales beyond the pilot until the pilot passes.
- **Out of scope.** Chat-composer uploads and a file manager; DOCX and
  spreadsheets; plan gating; re-ingesting the 2,338; reranking and hybrid search
  (open-work P6).

**Correction to the wording above it:** the chunking rule is "a chunk never
crosses a page boundary", not "one chunk per page". A long page still yields
several chunks of about 1,000 characters, each carrying its one page number
(both chunkers; A3, read).

## 2. Citation path today (A1)

A document citation travels:

1. `searchDocuments.ts` calls `search()` in `_shared/retrieval.ts:72-98`, which
   calls `match_documents`.
2. `rowToChunk` builds the chunk (`retrieval.ts:50-70`).
3. `research-chat/agent.ts:405-409` issues a handle (`_shared/handles.ts`,
   `ref:<nonce>-<n>`). The model sees `handle | title | desk_feature` and the
   content, with no page number.
4. `research-chat/sources.ts:108-168` runs the citation ladder, and `toSource`
   (`:76-93`) builds the `TextCitation`.
5. The citations are saved to `chat_messages.sources` (jsonb; the finalize RPC
   checks only that it is an array) and streamed as `{sources}`.
6. In the browser: `AiMarkdown` → `CitationBubble` → `WorkSurface.jsx:42` →
   `SourceReader`, which reads `documents` and `document_chunks` directly under
   RLS. `resolveSpan` checks the hash, and `RichText` marks the span.

A `TextCitation` carries `id, kind, chunk_id, document_id, title, file_name?,
file_url?, desk_tier?, desk_feature?, char_from, char_to, text_hash,
source_kind, page_number?` (`_shared/citation.types.ts:5-20`, twin in
`src/types/citation.js`). There are no box, image or storage fields.

Already in place (read, supervisor-checked):

- `pdfjs-dist ^4.10.38` is a dependency (`package.json:16`). It is used only on
  the server today.
- `isReadableCitation` already accepts `source_kind 'pdf_page'` with
  `page_number > 0` (`src/ai/CitationBubble.jsx:14-27`).
- `document_chunks.page_number` and `source_kind` (which allows `pdf_page`)
  exist.
- `documents.ocr_text` is NOT NULL, and chunk content must equal
  `ocr_text[char_from:char_to]` (`20260921000003:19,41`).
- RLS lets any authenticated user select from `documents` and
  `document_chunks`; anon is revoked (`:67-76`).

What changes, all additively (old documents unaffected):

- **Database.** New tables for pages, blocks and images, with the same
  authenticated-read rule. `match_documents` returns new columns, which needs a
  drop and recreate, since Postgres cannot change return columns in place.
- **Ingest.** Emit `pdf_page` chunks with a page number. New documents still
  fill `ocr_text` (pages concatenated) so the exact-span rule holds.
- **Citation type.** Optional box and image fields, mapped in `sources.ts`.
  The validator must accept them without rejecting old citations.
- **Reader.** `SourceReader` gains a page label and an image strip. A new PDF
  viewer sits beside it in `WorkSurface`, chosen when
  `source_kind === 'pdf_page'`.
- **Stream and storage format.** Unchanged.

Constraints on the design:

- ADR 0004 keeps chunk ids stable. `chunk_hash` covers `unit_key`, which is
  "the page id once pages exist" (`0004:28-33`). Anchor columns, including a
  future `bbox`, are nullable (`0004:43-44`).
- The RAG spec planned the page view "without changing the citation shape"
  (`docs/specs/2026-09-20-document-rag-and-citations-design.md:52-54`).
- Only handles the server issued may be cited, and the model never writes a
  storage path (streaming spec `:152-154`).
- The corpus is global: authenticated users read it, and only the service role
  writes it (ADR 0003).

Tests that guard this path are listed in A1's digest, which the specs will
cite. They include `_shared/citations_test.ts`,
`research-chat/sources_test.ts`, `src/ai/sourceReader.test.js`,
`SourceComponents.test.jsx` and `AgentComponents.test.jsx`.

## 3. Retrieval today (A2)

**Request.** `AiPanel.jsx:425-457` builds `{message, focus, selection?,
attachments[], desk_context?, …}`. A `document_key` comes only from
`billDocumentKey()` (`src/lib/deskRows.js:93-101`). `validate.ts:7` defines
`FOCUS_VALUES` as attached, selection, desk and broad; there is no
`document_ids` field. `index.ts:320-325` resolves keys through
`metadata->>'document_key'`, with no `indexed_at` check.

**Scope.** `agent.ts:390` confines search only when focus is `attached` or
`selection`. It widens scope, with the disclosure "Search widened", when there
are no ids or no rows.

**`match_documents`** (`20260929120100`):

- Signature `(query_embedding, match_count 40, p_document_ids, p_desk_tier)`.
- `security invoker`, granted to authenticated and service_role.
- Scoped branch: exact distance, a per-document quota, and the `documents`
  join after ranking.
- Unscoped branch: HNSW on `embedding::halfvec(1536)`, with `desk_tier`
  filtered afterwards.
- No migration sets `hnsw.ef_search` or `hnsw.iterative_scan`.

Measurements from `docs/specs/2026-09-22-scoped-retrieval-design.md` (read,
supervisor-checked):

| Strategy | 45-chunk doc | 915-chunk doc |
| --- | --- | --- |
| HNSW, then filter | 1 chunk, 8 ms | 12 chunks, 3 ms |
| `iterative_scan = relaxed_order` | 40, **19,820 ms** | 40, 1,019 ms |
| Exact scan | 40, 1,635 ms | 40, 1,634 ms |
| Pre-filter on `document_id`, then sort | 40, 12 ms | 40, 840 ms |

That spec also says the "Signature, return type, volatility and grants must not
change" (`:104-106`). A new spec that changes them must supersede it
explicitly.

**`desk_feature` values** (executed, a read-only query on NTER):

| desk_feature | documents | chunks | max chunks/doc |
| --- | ---: | ---: | ---: |
| Bill Passage Probability Index | 1,743 | 42,025 | 2,240 |
| Regulatory Body Watch (RBI SEBI TRAI CCI) | 506 | 11,040 | 404 |
| Parliamentary Question Database | 82 | 1,108 | 214 |
| Industry Updates (Ministry Data) | 6 | 40 | 11 |
| Budget Utilisation & Schemes | 1 | 6 | 6 |

The values are desk module names. `_shared/deskCatalog.json` spells the
regulatory one "(RBI/SEBI/TRAI/CCI)", with slashes. Bills are 78% of all
chunks, so a Bills filter is almost a full scan, while the small features are
highly selective. That is the case where filtering after HNSW fails.

**Any-document focus needs no SQL change.** The scoped branch already accepts
any `uuid[]`. It needs:

- a validated `document_ids` field (`UUID_RE` exists at `validate.ts:66`);
- a merge at `handler.ts:626`;
- `documentKeysSent` set when ids are sent;
- an entry point in the browser, for example "Ask about this document" in the
  reader, through `research.actions.attach`.

No document picker exists.

**A `desk_feature` filter** changes the `match_documents` signature: drop and
recreate it, re-grant it, and update the fixture regprocedure
(`halfvec_retrieval.sql:15`). The tool schema (`searchDocuments_test.ts:10`
pins its keys), `agent.ts`, `retrieval.ts` and the prompt all change. Options
to measure per feature:

- exact pre-filter, without the per-document quota;
- HNSW with a raised `ef_search`;
- iterative scan;
- partial indexes.

**Evaluation assets: none.** The F22 figures (recall@40 0.9875, 161 ms) exist
only in prose, and the 20 queries behind them were never committed. The SQL
fixtures run through `npm run test:sql` on local Docker containers, and a new
migration must be appended to the fixture's chain for the vacuity check.

## 4. Ingestion today, and what to take from TenderBase (A3)

### NTER ingestion today (read, supervisor-checked)

**`ingest-documents`** takes at most 50 documents per call and requires the
secret key as bearer. For each document it:

1. checks the SHA-256 of the text;
2. takes the unchanged-text path if the text and chunker version match;
3. otherwise chunks the **whole document as one unit** (`chunkDocument`,
   `chunking.ts:200-215`, whose comment says "page-wise Markdown will call
   chunkUnit per page instead");
4. embeds only the new hashes through OpenRouter (`_shared/embed.ts`, with a
   check on the served model and vector width), logging cost to
   `model_call_logs`;
5. commits with `chunk_commit` in slices of 100 rows (one 17 MB RPC once
   crashed Postgres);
6. marks the document indexed.

**`chunk_commit`** (`0014:15-95`) is security definer and granted to
service_role only. It deletes chunks whose hash is not kept, updates the
anchors and metadata of a matching hash in place (keeping the id and
embedding), and inserts the rest.

**The chunker** already has `pdf_page` units with a `pageNumber`, the one-unit
rule and the exact-span rule. It does not repeat table headers.

**Storage today** is one public bucket, `marketing`, with no
`storage.objects` policies. Uploads go through server-issued signed upload
URLs, and only admins may request them (`server/marketingMediaApi.mjs:131-135,
:231`).

**Admin.** Tabs are the `NAV` array in `src/admin/AdminApp.jsx:14-24`. The
client-side gate is UI only. The server gate is the `admin-models` pattern,
`rpc('is_platform_admin')` returning 403.

**Existing scheduling.** A pg_cron + pg_net + Vault pattern already exists for
`refresh-model-pricing` (`20260921000007:104-112`).

### TenderBase: what to port, adapt or skip (read)

| TenderBase piece | Decision for NTER |
| --- | --- |
| `extract-pdf/mistral.ts`: request defaults, `normaliseBBox` (pixels → 0..1 by page dimensions, checked), table matching by content first (Mistral's `table_id` is unreliable), `inlineTables`, `mapImages` | **Port.** Its cost constant ($1/1k) is stale; the price is $4/1k. |
| `split.ts` (pdf-lib 1.17.1, 600-page parts, 1,500-page limit) | **Port**, with smaller parts (see §5). |
| `_shared/tempStorage.ts` `withTempObject` (always cleans up in `finally`) | **Port.** |
| `extract-pdf/index.ts`: `extract_hash` cache (a hit costs 0), 3 parts at once, retries, per-part delete-then-insert | **Adapt:** key on `documents.id`; drop organisations and credits. |
| `images.ts`: at most 5 MB per image and 100 per page, sha dedupe, a failed upload is non-fatal | **Port.** Path `{document_id}/p{n}/{sha}.{ext}`. |
| `_shared/reduce.ts`: pages joined with `<!-- page:N -->` | **Adapt:** NTER must define how page text maps to offsets in `ocr_text`. |
| `chunk-embed/assemble.ts`: strip headers and footers, one unit per page, resolve placeholders | **Port.** |
| `chunk-embed/index.ts`: `block_ids` are same-page blocks whose content appears in the chunk; `image_ids` come from placeholders; only new hashes are embedded | **Adapt** into NTER's flow. Keep NTER's paged reads (TenderBase still has the 1,000-row cap bug) and its 100-row commits. |
| Stage machine (queued → dispatch → extract → chunk → embed → done, resume, never rewind) | **Port the idea,** not the nested HTTP chain. |
| TenderBase `chunking.ts` (trims text, prepends headings, repeats table headers) | **Do not port.** It breaks the exact-span rule. Take only placeholder atomicity. |
| TenderBase `embed.ts` (calls OpenAI directly) | **Skip.** Keep OpenRouter. |

**Schema to borrow:**

- jobs: status, stage, attempts, `error_code`, retryable, `cost_usd` (not null,
  default 0), `content_hash`, `extract_hash`, and one active job per document;
- pages: `extract_hash`, `page_number`, markdown, header, footer, dimensions,
  confidence;
- blocks: `block_index`, type, `bbox` jsonb, content, confidence;
- images: `placeholder_id`, bucket, path, sha256, `bbox`, `byte_size`;
- `block_ids uuid[]` and `image_ids uuid[]` on chunks.

**PDF viewer in TenderBase.** It uses `react-pdf` 9.1.1 on `pdfjs-dist`
4.4.168, with the worker loaded from cdnjs. `PdfCitationView` downloads the
file through storage RLS (NTER will use a server-issued signed URL instead),
draws boxes as page percentages, makes figure boxes clickable, and highlights
text-layer sentences where 60% or more of the tokens overlap. Boxes are
resolved on the server, from `block_ids` to `bbox`.

**Long PDFs in TenderBase.** It runs a synchronous chain of nested HTTP calls
and relies on resuming. It has **no background worker**: its `enqueue` mode has
nothing that drains the queue (supervisor-checked: the only `waitUntil` in its
functions refreshes pricing). NTER needs a real worker.

## 5. External facts from official documentation (A4)

### Mistral OCR 4.1 (`mistral-ocr-latest`, GA 2026-07-16)

- **Price:** $4 per 1,000 pages, or $5 when annotated. Which pages count as
  "annotated" is unconfirmed; annotations stay off.
- **Each page returns:**
  - `index` (0-based) and `markdown`;
  - `images[]`: `id`, box, a `data:` URI;
  - `tables[]`, `header` and `footer` (removed from the markdown);
  - `dimensions{dpi,height,width}` and confidence;
  - `blocks`: a type (text, title, list, table, image, caption, signature, …),
    a box, the content, and a `table_id` or `image_id`.
- **Coordinates are pixels** at each page's own DPI (72 or 200 in the
  examples), so normalise per page.
- **Placeholders:** `![img-0.jpeg](img-0.jpeg)` and `[tbl-3.html](tbl-3.html)`.
  The docs disagree about the format of image ids, so match on the id fields.
- **Limits:** 50 MB and 1,000 pages per file. Page ranges are available via
  `pages`.
- **Inputs:** `document_url`, or the files API with a signed URL. A batch mode
  exists.
- Hindi is on the language list.

### Supabase Storage

- **Private buckets.** Leave out any authenticated SELECT policy, so only the
  server (service role, which bypasses RLS) can mint signed URLs;
  `expiresIn` is in seconds.
- **Uploads.** Each bucket has its own size and MIME limits. The global upload
  limit is 50 MB on Free, up to 500 GB on Pro. The local `config.toml:117`
  says 50 MiB; the live setting is to be confirmed (open-work mentions it).
  Use resumable (TUS) uploads above 6 MB.
- **Range requests.** The storage server's source supports them
  (`Accept-Ranges: bytes`). Whether the hosted CORS setup exposes those
  headers, and whether the CDN passes ranges through, is **unverified** and
  must be tested in the pilot.

### Edge Functions

- **Limits:** 256 MB of memory; wall clock 150 s (Free) or 400 s (paid); 2 s of
  CPU per request, excluding async I/O; a 150 s idle timeout, which returns
  504.
- **Long jobs:** the recommended pattern is pgmq + pg_cron + pg_net, deleting
  a message only on success. `EdgeRuntime.waitUntil` is capped by the same
  limits.
- **Consequence:** one synchronous OCR call over a large PDF with
  `include_image_base64` will not fit. Work in page ranges from a queue.

### PDF.js

- **Version.** The latest is 6.3.289 (executed: `npm view`; it needs Node
  ≥ 22.13; local Node is 23.11). Version 6 removed
  `convertToViewportRectangle`, so overlays need point conversion or their own
  arithmetic.
- **Range loading** needs `Accept-Ranges: bytes`, an integer
  `Content-Length` larger than twice `rangeChunkSize` (64 KiB), and no content
  encoding. Across origins the headers must be exposed (inference).
- **Worker.** `workerSrc` must be set, and there is no official Vite recipe.

### pgvector 0.8.2

- Filters apply after the approximate index scan.
- `SET LOCAL hnsw.ef_search` scopes the setting to one transaction.
- Iterative scans need a MATERIALIZED CTE and a re-sort on `distance + 0` on
  PG17. `max_scan_tuples` defaults to 20,000.
- The README recommends:
  - exact scans behind a B-tree for selective filters;
  - partial HNSW indexes for a few values;
  - partitioning for many values.
- The halfvec expression in the query must match the index.

## 6. The corpus: what is actually left to ingest (A5)

**What remains is not what we thought** (executed: a Python tally of
`04_indexes/OCR_FILES.csv`, current and not excluded):

| Feature | Documents | Pages | Ingested? |
| --- | ---: | ---: | --- |
| Candidate Affidavit Database | 5,093 | 100,151 | **no** (deliberately excluded) |
| Bill Passage Probability Index | 1,743 | 13,720 | yes |
| Regulatory Body Watch | 506 | 4,643 | yes |
| Parliamentary Question Database | 82 | 486 | yes |
| Industry Updates | 6 | 20 | yes |
| Budget Utilisation & Schemes | 1 | 3 | yes |
| **Total** | **7,431** | **119,023** | 2,338 ingested |

So the "~5,100 remaining documents, ~100k pages" are **all candidate
affidavits**. Every non-affidavit OCR document is already ingested. None of the
affidavits has a source link (A5, read). They were excluded on purpose
(open-work P7, `docs/research/2026-09-21-corpus-mapping-study.md`).

**The other un-ingested pool is the `pdf_text` records** in
`01_original_corpus/documents.jsonl.gz` (executed):

| doc_type | Records | Pages |
| --- | ---: | ---: |
| bill | 7,966 | 96,498 |
| parl_question | 6,758 | 24,625 |
| regulatory | 2,813 | 84,998 |
| budget_document | 483 | 7,269 |
| transfer_order | 29 | 31 |
| industry_document | 22 | 818 |
| **Total** | **18,071** | **214,239** |

Of these, **5,327 have a direct PDF link** (A5: a Python rebuild of
`build-corpus-links.mjs`, since the gitignored `links.json` is absent).

- By host: sansad.in 5,218 (bills), rbidocs.rbi.org.in 76, mha.gov.in 29
  (transfer orders naming officers), and indiabudget 4.
- 12,735 records have no link, including every parliamentary question.
- 284 of the linked bills are other versions of bills already ingested.

**The one local PDF** is a Gujarat draft electoral roll (a scanned OCR
benchmark fixture full of personal data). It is not suitable for the pilot.

**Pilot candidates** (A5, read; no URL was fetched): 14 public sansad.in, RBI
and indiabudget PDFs, from 4 to 255 pages, covering:

- born-digital bills (National Sports Governance Bill 2025; Classified
  Information and Espionage Control Bill 2025; Finance Bill 2026);
- old scans (States Reorganisation Bill 1956; Wild Life (Protection) Bill
  1972; Central Excise Tariff Bill 1985);
- table-heavy documents (Expenditure Profile 2026-27 Statement 10B; RBI
  borrowing calendar);
- a chart (RBI International Investment Position, March 2026);
- long documents (Finance Bill 2026, 232 pages; Central Excise Tariff Bill
  1985, 255 pages);
- Hindi. Two Hindi bills whose text layer is Kruti-Dev mojibake, and a
  bilingual 1991 scan, are exactly the case where Mistral OCR should beat the
  existing text layer.

A5's digest has the full table with URLs and local line numbers.

## 7. Open questions this investigation raises

1. **Ingestion scope** (owner decision). The new pipeline's real backlog is:
   - the linked `pdf_text` records (5,327, mostly bills);
   - possibly the rest by API or admin upload;
   - and the affidavits (5,093, 100k pages, no links, personal data; excluded
     so far).

   Which of these are in scope?
2. **`match_documents` signature change.** It supersedes the constraint in
   the 2026-09-22 scoped-retrieval spec.
3. **Worker design.** Supabase's queue pattern versus script-driven stages,
   and how many pages per OCR call fit within 400 s.
4. **PDF.js version** (4.10 as pinned, or 6.3) and whether to add
   `react-pdf`.
5. **Range and CORS on hosted Storage.** To be proven in the pilot.
6. **The live Storage global upload limit.** To be confirmed before admin
   uploads.
