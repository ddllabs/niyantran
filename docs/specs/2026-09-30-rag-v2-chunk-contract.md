# Spec: the page, block and image contract (`chunk-contract`)

> **Status: Normative — approved by the owner on 2026-09-30,** with the
> recommendations below accepted. Module `chunk-contract` of
> `docs/specs/2026-09-30-rag-v2-capability-map.md`. The evidence is the
> research doc §2 and §4, the Mistral test of 2026-09-30 (the saved response
> for the 12-page Classified Information and Espionage Control Bill, 2025),
> and TenderBase's `chunk-embed/assemble.ts` and `_shared/chunking.ts`.
> Revision 2 folds in a fresh-context adversarial review that ran the real
> chunker on that response: 15 findings, all accepted (see "Review record").

## Objective

Fix, once, what ingestion writes and what retrieval and citations read for
page-aware documents. `ingestion-v2` (the writer) and `citations-pdf` (the
reader) are built against this contract. It is **additive**: the 2,338
existing documents, `ingest-documents`, and every saved citation keep
working.

This module delivers:

- the schema;
- the page-text, section, chunking, hashing and linking rules (R1–R6);
- the changes to `chunk_commit`, `match_documents` and the citation payload;
- the pure code that implements the rules;
- the ADR 0004 amendment.

It does not deliver OCR calls, the bucket, the queue or any UI.

## Current state (read and executed 2026-09-30)

- **Tables:**
  - `documents.ocr_text` and `content_sha256` are NOT NULL (`0003:18-19`);
    `page_count` is null for all documents.
  - `document_chunks`: `source_kind ∈ {document, pdf_page}`, a nullable
    `page_number`; `content` must be exactly `ocr_text[char_from:char_to]`,
    in UTF-16 offsets (`0014:4-6`); `metadata` is `{}`; unique on
    `(document_id, chunk_hash)`.
- **Grants:**
  - `service_role` has **only** select, insert, update and delete
    (`0015:65-71`), and `authenticated` has select.
  - Supabase's defaults grant new tables and functions broadly
    (`supabase/tests/bootstrap_auth.sql:58-59` reproduces that), so every new
    object must revoke first.
- **`ingest-documents` depends on one global chunker version:**
  - a document counts as unchanged only when
    `chunker_version === CHUNK.version` (`handler.ts:252`);
  - rows and documents are stamped with it (`:229`, `:354`);
  - `chunkDocument` defaults to it (`chunking.ts:202`);
  - `chunking_test.ts:161` pins it to 2.
  - It upserts on `source_key`, so it would overwrite any document's
    `ocr_text`.
- **`chunk_commit`** (`0014:15-95`) deletes non-kept hashes, and on a hit
  keeps the id and vector and refreshes the anchors and metadata. It is
  service-role only.
- **Citations:**
  - `text_hash = sha256(normalise(content))`.
  - `resolveSpan` shows `exact`, `moved` (it needs the cited text, which
    `SourceReader` reloads **by chunk id**, `SourceReader.jsx:23-26`) or
    `changed`.
  - `applyCitationLadder` and `toSource` are pure and synchronous, called
    twice per turn (`handler.ts:840,867`). The test twin is
    `_shared/citations.ts` `buildSources`.
  - `isReadableCitation` returns false for the whole citation on any bad
    field, and the bubble then disappears (`CitationBubble.jsx:14-21,38`).
- **Observed in the Mistral response for the 12-page bill:**
  - Page indexes are original, also for a page-range request. Dimensions
    are in pixels (720×1018 at 87 DPI). Blocks carry no id.
  - Headings: only a heading's first line has `#`
    (`# CHAPTER I\nPRELIMINARY`); a run can be separated by blank lines;
    margin line numbers leak into headings ("… INFORMATION 45"); the back
    page has `# A`.
  - **Margin notes**, which are the bill's section titles, are typed
    `aside_text` only on pages 2–3. From page 4 they are typed **`text`**,
    at x≈55 (left margin) or x≈594 (right margin).
  - Page 2's definitions are **one** `list` block of 1,388 characters.
  - The page-12 footer is two blocks joined by a newline.

## Rules

### R1. Page text (the only text chunk spans refer to)

1. **Tables inline.** Request `table_format: "markdown"`. Replace each
   `[tbl-….md](tbl-….md)` placeholder with that table's markdown (TenderBase's
   `inlineTables`). An unresolved placeholder is left in place and reported.
2. **Images.** Each image placeholder is rewritten to
   `![img:<page>-<n>](img:<page>-<n>)`, unique within the document, and kept
   as an atomic token.
3. **Headers and footers,** judged **line by line.** Each header or footer
   is split on newlines. Each line is normalised: NFKC, lowercase, every
   `\p{Nd}+` run (any script's digits, including Devanagari ०–९) replaced by
   `#`, whitespace collapsed. Then:
   - A line is **running** if it appears on at least 3 pages, or, in a
     document of 4 or more pages, on at least 30% of its pages. Running lines
     are stored on the page row only.
   - Documents of **1 or 2 pages** treat every line as unique, since no line
     can reach 3 pages.
   - A **unique** line is put back at the top (header) or bottom (footer) of
     the page text, **unless** the page markdown already starts (or ends)
     with it. That guards against Mistral leaving it in, which is why
     TenderBase's `stripChrome` exists.
4. **Empty pages.** If a page has no text other than placeholders and
   whitespace, it gets `text = ''` and **no chunks**. Its images are still
   stored and shown in the PDF viewer, but a page with only a chart is not
   searchable while annotations are off.
5. **Document text.** `ocr_text` is the page texts joined with `"\n\n"` in
   page order. Each page row stores `char_from` and `char_to` in UTF-16 code
   units, with `char_from ≤ char_to`, and `ocr_text.slice(char_from,
   char_to) === text`. `content_sha256` is the hash of `ocr_text`.

### R2. Sections

The document is walked in reading order, keeping a state `{heading, note}`.

**Headings come from Mistral `title` blocks**, using the block's full
content. The first line has its leading `#` removed, and all lines are
joined with a space. The heading is then cleaned:

- trailing line-number tokens (`\s+\p{Nd}{1,3}$`) are removed;
- a title with fewer than 3 letters is ignored, which drops the back page's
  "A".

Titles separated only by blank lines form one **run**, joined with " › ".
A new run **replaces** the heading and **clears** the note.

**Margin notes are found by geometry**, not type. A margin note is a block
of type `aside_text` or `text` that meets all of these:

- its normalised box lies entirely in the outer margin: `x1 ≤ 0.18`, or
  `x0 ≥ 0.82`;
- it has at most 150 characters and at least 3 letters;
- it is not an Act citation (`^\p{Nd}+ of \p{Nd}{4}\.?$`).

These limits were **measured on the bill**:

- Left notes span x 0.075–0.174, and right notes x 0.825–0.928.
- The body spans x 0.19–0.81.
- Line numbers sit at 0.786–0.808, and are excluded both by position and
  by having no letters.
- The margin citation "5 of 1908." sits at 0.826 and is excluded by the
  pattern.

A note **replaces** `note` from its position onwards. The note is **cleared**
at the next numbered section start that has no note of its own (a line
matching `^\s*\p{Nd}+\.\s`).

**Positions:** each block is located in the page text by searching forward
(R5), so a heading or note takes effect at its offset.

**A chunk's section** is the state at the chunk's start, updated by any
heading or note starting within its first 200 characters (replace, not
append). The state carries across pages, so a section continuing onto the
next page keeps its heading and note until something replaces or clears
them.

It is stored as `document_chunks.metadata.section = {heading?, note?}`. Each
is whitespace-collapsed, and at most 200 characters.

**The expected sections for the 12-page bill** are part of the acceptance
test. For example:
- a chunk in section 7 on page 4 must have the note "Presumption of
  prejudicial purpose.", not "Espionage.";
- page 2's definitions must have the heading "CHAPTER I PRELIMINARY" (one
  title block, its lines joined with a space) and the note "Definitions.".

### R3. Chunking pages (page chunker version 3)

1. **A separate constant, `PAGE_CHUNK_VERSION = 3`.** `CHUNK.version` stays
   2, and `chunkDocument` and `ingest-documents` are byte-for-byte unchanged.
   A regression test proves `chunkDocument`'s output is identical on the
   existing fixtures.
2. **One `ChunkUnit` per non-empty page:** `unitKey = 'page:<n>'`,
   `sourceKind = 'pdf_page'`, and a 1-based `pageNumber`. The sizes and split
   order are the same as today.
3. **Placeholder atomicity** is an **option**, on only for page chunking. A
   split never falls inside an `![…](…)` or `[…](…)` token.
4. **Exact spans.** The text is never trimmed or rewritten. Spans become
   global (plus the page's `char_from`) before commit.
5. **Chunk order.** `chunk_index` runs across the whole document, in page
   order and then by span.
6. **Duplicates.** Rows with equal identity hashes are de-duplicated, keeping
   the first, as `ingest-documents` does today (`handler.ts:236-239`).

### R4. Identity, embedding input and vector reuse

- **Identity (unchanged, ADR 0004):** `chunk_hash = SHA-256(page chunk
  version ‖ unit_key ‖ normalise(content))`. The id of a chunk whose text on
  its page is unchanged **survives** a re-extraction. That keeps saved
  citations resolvable, because `SourceReader` reloads the cited text by
  chunk id.
- **The embedding input** for a page chunk:

  | Section state | Prefix |
  | --- | --- |
  | heading and note | `<heading> › <note>\n\n` |
  | heading only | `<heading>\n\n` |
  | note only | `<note>\n\n` |
  | neither | none |

  After the prefix comes the table header row and its divider, if the chunk
  starts inside a table that it doesn't open. Then the content.
- **`embed_hash`** (new column) is `SHA-256(normalise(embedding input))`.
- **On an identity hit:**
  - if `embed_hash` is equal, the vector and id are kept, as today;
  - if `embed_hash` differs, because the context changed but the text
    didn't, the caller embeds the new input, and `chunk_commit` **replaces
    the vector and keeps the id**.

  So a heading edit re-embeds the chunks it affects without killing their
  citations.

### R5. Blocks and images link to chunks by position

- Each block is located in its page text by **forward search** of its
  normalised content. Its `char_from` and `char_to` (page-local) are stored.
  If it can't be found, both are null and the block never links.
- A chunk's `block_ids` are the located blocks on its page **whose span
  overlaps the chunk's span by at least 1 character**, excluding
  header and footer blocks. So a chunk inside page 2's 1,388-character
  definitions block links to that block, not to the heading next to it.
- A chunk's images are those whose placeholder lies inside its span.
- **Write order**, because block and image ids come from the database:
  1. insert pages, blocks and images for the new `extract_hash`;
  2. read back `(page_number, block_index) → id` and `placeholder → id`;
  3. map the pure chunker's references to ids;
  4. commit the chunks.

### R6. Extractions and consistency

- `documents.extract_hash` names the current extraction. It is SHA-256 over:
  - the PDF's content hash;
  - the **requested model id**, which must be a pinned version confirmed in
    the pilot, not `mistral-ocr-latest`. The response echoed the alias, so it
    can't show what actually served;
  - the request options;
  - `PAGE_CHUNK_VERSION`;
  - a composition version for R1–R2.
- **At most one active extraction per document** is guaranteed by
  `ingestion-v2`'s job table, with one active job per document. In addition,
  `documents.extract_hash` changes only through a **compare-and-set**
  (`… where extract_hash is not distinct from <expected>`), so a second
  writer loses instead of mixing.
- **Invariant:** whenever `documents.indexed_at` is set, `ocr_text`, the
  current extraction's page rows, and the chunks agree. The write sequence
  (in `ingestion-v2`) is:
  1. clear `indexed_at`, which hides the document from search;
  2. compare-and-set `extract_hash`, and update `ocr_text`,
     `content_sha256` and `page_count`;
  3. `chunk_commit` in slices;
  4. set `indexed_at`;
  5. delete the superseded extraction's pages and blocks.

  **Images are content-addressed and kept,** so saved citations can still
  show them.
- `ingest-documents` **refuses** any document whose stored `extract_hash`
  is not null, so the old path can never overwrite a page-aware document.

## Schema (one migration, `…_page_contract.sql`, after `retrieval-scope`'s)

**Every new table and function:** `revoke all on … from public, anon,
authenticated, service_role`, then grant `select` to `authenticated`, and
`select, insert, update, delete` to `service_role`. RLS is enabled with
`select to authenticated using (true)`.

**`documents`: new nullable columns**

| Column | Type | Meaning |
| --- | --- | --- |
| `storage_path` | text | the original PDF in the private `corpus` bucket, content-addressed: `<document_id>/<file_sha256>.pdf`. A replaced file gets a new path, and old PDFs are kept. |
| `file_sha256` | text | the PDF's content hash |
| `extract_hash` | text | R6 |
| `source_mime` | text | `application/pdf` |

`page_count` is filled for page-aware documents.

**`document_pages`:**

| Column | Type |
| --- | --- |
| `id` | uuid pk |
| `document_id` | uuid fk cascade |
| `extract_hash` | text not null |
| `page_number` | int not null, ≥ 1 |
| `text` | text not null |
| `char_from`, `char_to` | int not null, `check (0 ≤ char_from ≤ char_to)` |
| `header`, `footer` | text (as returned) |
| `header_in_text`, `footer_in_text` | boolean not null default false |
| `width_px`, `height_px`, `dpi` | int |
| `created_at` | timestamptz |

Unique on `(document_id, extract_hash, page_number)`.

**`document_page_blocks`:**

| Column | Type |
| --- | --- |
| `id` | uuid pk |
| `document_id` | uuid fk cascade |
| `extract_hash` | text not null |
| `page_number` | int not null |
| `block_index` | int not null (reading order) |
| `type` | text not null |
| `x0`, `y0`, `x1`, `y1` | real, `check (0 ≤ x0 ≤ x1 ≤ 1 and 0 ≤ y0 ≤ y1 ≤ 1)`; **null when the page has no dimensions** |
| `char_from`, `char_to` | int, page-local, null when not located |
| `content` | text |

Unique on `(document_id, extract_hash, page_number, block_index)`. Indexed
on `(document_id, extract_hash, page_number)`.

**`document_page_images`:**

| Column | Type |
| --- | --- |
| `id` | uuid pk |
| `document_id` | uuid fk cascade |
| `extract_hash` | text not null |
| `page_number` | int not null |
| `placeholder` | text not null |
| `sha256` | text not null |
| `mime` | text not null |
| `storage_path` | text not null (`<document_id>/img/<sha256>.<ext>`) |
| `byte_size` | int |
| `x0`, `y0`, `x1`, `y1` | real, as for blocks |

Unique on `(document_id, extract_hash, placeholder)`.

**`document_chunks`: new nullable columns**

- `block_ids uuid[]`
- `image_ids uuid[]`
- `embed_hash text`

`metadata.section` per R2.

**`chunk_commit`** (`create or replace`, same signature; the grants are
re-asserted):

- on a hit: also refresh `block_ids`, `image_ids` and `embed_hash`, and
  **replace `embedding` when the row carries one** (the R4 re-embed case);
- on insert: write them.

**`match_documents`:** drop and recreate with `retrieval-scope`'s signature,
adding return columns `block_ids uuid[]`, `image_ids uuid[]` and
`section jsonb`. It revokes from public and anon, and grants to
`authenticated` and `service_role`. Old rows return nulls.

## Citation payload (additive)

`TextCitation` (both twins) gains optional fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `extract_hash` | string | the extraction the boxes belong to. The viewer compares it with the document's current one, and on a mismatch it shows "The document was updated since this was cited" and doesn't draw stale boxes. |
| `boxes` | `Array<{page, x0, y0, x1, y1}>` | at most 20, resolved from `block_ids` |
| `images` | `Array<{page, sha256, mime}>` | content-addressed, so it survives re-extraction. A signed URL is minted when the image is viewed. |
| `section` | `{heading?, note?}` | |

`page_number` is the **physical** page number (1-based). The printed page
label is a running footer and is not carried.

**Resolving boxes** needs one bounded service select per turn, for the cited
chunks only. It runs as an **async step in `handler.ts`**, after the first
`applyCitationLadder` and before the citations are saved. The ladder and
`toSource` stay pure: they receive a prepared `boxesByChunk` map. The same
fields are mapped in `_shared/citations.ts` `buildSources`.

**Validation.** `isReadableCitation` **strips** malformed optional fields
and never rejects a citation because of them. The required fields are
unchanged, so old citations pass exactly as before.

**The model's line** for a page chunk is
`handle | title | desk_feature | page <n> | <heading › note>`, where heading
and note are whitespace-collapsed and `|` is escaped. The model never sees a
storage path.

## ADR 0004 amendment (written with this module)

- **Unit key.** The text "the document id today" becomes: the literal
  `'document'` for whole-document chunks, and `'page:<n>'` for page chunks.
  It is a page number, not a row id.
- **Identity is unchanged** (a hash over content). A new `embed_hash`
  decides whether to reuse the vector, and `chunk_commit` can replace a
  vector while keeping the id.
- **Pages, blocks and images** are tables keyed by `extract_hash`. The
  original PDF and images are content-addressed and never overwritten.

## Code this module owns

- **`_shared/pageText.ts`** (new, pure): R1 (inline tables, rewrite
  placeholders, header and footer lines, offsets), locating blocks,
  `normaliseBox` (TenderBase `normaliseBBox`), and margin-note detection.
- **`_shared/chunking.ts`:** `PAGE_CHUNK_VERSION`, placeholder atomicity as
  an option, and `chunkPages(pages, blocks, images)`. It returns rows with
  global spans, `chunk_index`, block and placeholder references, `section`,
  the embedding input, `chunk_hash` and `embed_hash`.
- **`ingest-documents/handler.ts`:** the refusal rule in R6.
- **The migration** and a new fixture, `page_contract.sql`, plus its chain in
  `run.sh`.
- **`_shared/retrieval.ts`:** the new row fields.
- **`research-chat/handler.ts`:** the async box step.
- **`research-chat/{sources,agent}.ts`** and `_shared/citations.ts`.
- **`_shared/citation.types.ts`, `src/types/citation.js`,
  `src/ai/CitationBubble.jsx`.**
- **`docs/decisions/0004-…`:** the amendment.

## Testing strategy

- **A Deno fixture test on the real response**, with the saved 12-page JSON
  copied into `supabase/functions/_shared/__fixtures__/`. It is public
  parliamentary text. It asserts:
  - the page offsets round-trip;
  - every chunk's global span reproduces its content;
  - no chunk crosses a page;
  - the page-number footers are running and dropped, while the page-1
    header (introduction date) and the page-12 sponsor line are unique and
    kept;
  - the section list for the named chunks (R2 examples);
  - `block_ids` for the chunk inside page 2's definitions includes that
    block.
- **Synthetic Deno tests:**
  - a Devanagari running footer ("पृष्ठ ३");
  - a table split with its header only in the embedding input;
  - placeholder atomicity;
  - a page with only an image produces no chunk;
  - a unique header already at the page edge is not duplicated;
  - `normaliseBox` with missing dimensions;
  - `embed_hash` changes and `chunk_hash` doesn't when only the heading
    changes;
  - `chunkDocument` output is byte-identical to version 2 (regression);
  - `ingest-documents` refuses a document whose `extract_hash` is not null.
- **Deno:**
  - `sources` and `citations` map the new fields;
  - the async box step, capped at 20;
  - old-shape rows produce old-shape citations.
- **Vitest:**
  - `isReadableCitation` strips a bad box and keeps the citation;
  - old saved citations validate unchanged.
- **SQL fixture `page_contract.sql`:**
  - the constraints (box range, offsets);
  - for each new table, a loop over **every** privilege (select, insert,
    update, delete, truncate, references, trigger, maintain) for anon,
    authenticated and PUBLIC, as `analytics_events.sql:35` does;
  - `chunk_commit` replaces the vector on an `embed_hash` change and keeps
    the id;
  - `match_documents` returns the new columns, with nulls for old rows, in
    one overload.

  **Each assertion is shown to fail on its own**, not only through the
  vacuity check, because missing tables make that trivially red.
- **Every new test is shown to fail first.**

## Boundaries

- **Always:**
  - Additive.
  - Exact spans.
  - Identity by content.
  - Revoke before grant.
  - Old citations keep validating.
- **Ask first:**
  - Applying the migration to NTER.
  - Deploying functions.
- **Never:**
  - Change `CHUNK.version` or `chunkDocument`.
  - Re-chunk the 2,338 documents.
  - Filter on `metadata`.
  - Show the model a storage path.
  - Store a signed URL.
  - Overwrite a stored PDF or image.

## Acceptance evidence

1. Both suites, lint, build and `npm run test:sql` pass, with per-assertion
   fail-first evidence.
2. The real-response fixture test passes, with the expected page texts,
   sections, kept and dropped header and footer lines, and block links.
3. The ADR 0004 amendment is committed.
4. After the migration, on the replica, with its schema extended by the
   contract's columns, and later on live with the owner's go-ahead: the
   `eval` `broad` figures are identical to its baseline. Added return columns
   must not change ranking, and latency stays within the bar.

## Scope

As listed under "Code this module owns", plus their tests and the replica
schema extension.

## Exclusions

- OCR calls, the bucket, uploads and the queue (`ingestion-v2`).
- Signed URLs, the viewer and the image strip (`citations-pdf`).
- Typed table rows.
- The document title in the embedding input (a possible later `eval`
  experiment).
- Figure understanding (annotations are off).

## Open questions for the owner

1. **Repetition thresholds:** 3 pages, or 30% of pages for documents of 4+
   pages, judged line by line, digits of any script ignored. I recommend
   these, revisited after the pilot.
2. **Margin geometry:** a block counts as a margin note if it lies in the
   outer 18% of the page width on either side. This was measured on one
   bill; the pilot checks it on others.
3. **Pages with only images** (charts, maps) aren't searchable while
   annotations are off. I recommend accepting that for now.

## Review record

A fresh-context adversarial review of revision 1 (2026-09-30), which ran the
real chunker on the real response, raised 15 findings. All were accepted:

1. A global version bump would re-chunk old documents: now a separate page
   version, and the old path refuses page-aware documents.
2. `aside_text` misses most margin notes: geometry, plus clearing rules.
3. Heading parsing was wrong: full title blocks, runs, number stripping,
   replace semantics, prefixes.
4. `block_ids` pointed at the wrong boxes: blocks are located by position
   and linked by overlap.
5. A hash over the embedding input would kill citations: identity by
   content, plus `embed_hash` and vector replacement.
6. Grants: revoke all, then explicit grants, with a full privilege loop.
7. How ids get mapped: the write order is specified.
8. Concurrency: one job, compare-and-set, the sequence and the invariant.
9. Stale citations after re-extraction: content-addressed files and images,
   `extract_hash` on citations, a notice.
10. Repetition rule defects: line by line, Unicode digits, no duplication,
    wording fixed.
11. Empty and image-only pages produce no chunk.
12. Placeholder atomicity became an option, with a version 2 regression
    test.
13. Model line: sanitised, and the physical page stated.
14. Where boxes are resolved: an async step in the handler, and bad fields
    stripped.
15. Details: UTF-16, `chunk_index`, dedupe, pinned `table_format`, missing
    dimensions, pinned model id, ADR wording, replica columns, per-assertion
    tests.
