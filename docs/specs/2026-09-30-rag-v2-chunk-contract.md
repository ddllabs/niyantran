# Spec: the page, block and image contract (`chunk-contract`)

> **Status: Living — draft for owner approval (2026-09-30).** It becomes
> Normative once approved. Module `chunk-contract` of
> `docs/specs/2026-09-30-rag-v2-capability-map.md`. The evidence is
> `docs/research/2026-09-30-rag-v2-investigation.md` §2 and §4, the Mistral
> test of 2026-09-30 (recorded in the capability map), and TenderBase's
> `chunk-embed/assemble.ts` and `_shared/chunking.ts`.

## Objective

Fix, once, the shape that ingestion writes and that retrieval and citations
read, for page-aware documents. Once this contract has landed, `ingestion-v2`
(the writer) and `citations-pdf` (the reader) can be built against it
independently. The 2,338 existing documents are untouched and keep working:
every new column is nullable and every new table is additive.

This module delivers:

- the schema (tables, columns, RLS, grants);
- the **page-text composition rules**;
- the **chunking rules for pages**;
- the **embedding input**;
- the changes to `match_documents` and the citation payload;
- the amendment to ADR 0004.

It does not deliver the OCR worker, the bucket, the queue or any UI.

## Current state (read 2026-09-30)

**`documents`** (`20260921000003:10-26`, plus `metadata` from `0009`):

- `ocr_text NOT NULL`;
- `page_count` "null until page-wise Markdown exists";
- no storage or extraction columns.

**`document_chunks`** (`:32-49`):

- `source_kind ∈ {document, pdf_page}`, with a nullable `page_number`;
- `char_from` and `char_to` NOT NULL. `content` must be exactly
  `ocr_text[char_from:char_to]`;
- `metadata jsonb` is always `{}`;
- unique on `(document_id, chunk_hash)`.

**RLS:** `select to authenticated using (true)`; anon revoked; the service
role writes. The grants were reset in `0015_least_privilege`.

**ADR 0004:**

- a random, stable chunk `id`;
- `chunk_hash = SHA-256(chunker_version ‖ unit_key ‖ normalised chunk text)`,
  where the unit key is "the page id once pages exist";
- `chunk_commit` keeps the row and its vector on a hash hit;
- anchors are nullable;
- a citation carries `chunk_id`, `document_id`, the span and `text_hash`.

**Chunker** (`_shared/chunking.ts`, version 2):

- `ChunkUnit {unitKey, text, sourceKind, pageNumber?}`;
- split order: heading, then table, paragraph, sentence, character;
- target 1,000 characters, overlap 200, minimum 200 (a short tail folds
  back), whole tables up to 1,500, maximum 6,000;
- exact spans: `content === unit.text.slice(from, to)`;
- `chunkDocument` builds one `document` unit;
- no placeholder atomicity;
- no repeated table headers.

**Citations:**

- `TextCitation` (`_shared/citation.types.ts:5-20`, twin in
  `src/types/citation.js`) carries `char_from`, `char_to`, `text_hash`
  (`sha256(normalise(content))`), `source_kind` and `page_number?`.
- `SourceReader` highlights by span over `ocr_text` (`src/ai/sourceReader.js`
  `resolveSpan`).
- The model sees each chunk as `handle | title | desk_feature` followed by the
  content (`agent.ts:407`).

**Mistral OCR output** (executed 2026-09-30, a 12-page bill):

- `pages[].index`: original 0-based indexes, also when `pages: "5-7"` is
  requested.
- `markdown`, with headings as `#` lines at inconsistent levels.
- `header` and `footer`, removed from the markdown.
- `dimensions {dpi, width, height}` in pixels.
- `blocks[]` with `type` (`title`, `text`, `list`, `aside_text`, `header`,
  `footer`, …), a pixel box and `content`, and **no id**.
- `images[]` and `tables[]` were empty for that bill. Per the docs, they carry
  ids that match the `![id](id)` and `[id](id)` placeholders in the markdown.
- The bill's section titles are margin notes (`aside_text`), which appear in
  the markdown as plain lines.

## Decisions (owner-approved 2026-09-30, restated as rules)

### R1. Page text composition

The text a page's chunks are cut from. It is stored, and it is the only thing
chunk spans refer to.

1. Start from Mistral's page `markdown`, with tables inlined: each
   `[tbl-N.…](tbl-N.…)` placeholder is replaced by that table's markdown.
   This is TenderBase's `inlineTables`: an unknown placeholder is left as it
   is and reported.
2. **Image placeholders are rewritten** to a document-unique form,
   `![img:<page>-<n>](img:<page>-<n>)`, so that images from two OCR calls
   can't collide. They stay in the text as atomic tokens.
3. **Headers and footers are judged by repetition** within the document:
   - Normalise each one: NFKC, lowercase, every digit run replaced by `#`,
     whitespace collapsed.
   - A normalised string is **running** if it appears on at least 3 pages,
     **or** on at least 30% of the pages of a document with 4 or more pages.
   - A running header or footer is stored on the page row only.
   - A **unique** one is put back into the page text: the header on its own
     line at the top, the footer at the bottom.
   - Documents of 1–3 pages keep every header and footer, since nothing can
     repeat three times.
4. The page text is trimmed, and must not be empty. An empty page is stored
   with `text = ''` and produces no chunks.
5. **The document text** is `documents.ocr_text`, the page texts joined with
   `"\n\n"` in page order. Each page row stores its own `char_from` and
   `char_to` inside `ocr_text`. So `ocr_text.slice(page.char_from,
   page.char_to) === page.text`, and every chunk's global span is its page
   offset plus its local span.

### R2. Chunking pages (chunker version 3)

1. **One `ChunkUnit` per non-empty page:**
   - `unitKey = 'page:<page_number>'` (the page **number**, not a row id);
   - `sourceKind = 'pdf_page'`;
   - `pageNumber` is 1-based.
2. The same split order and sizes as today.
3. **New in version 3:**
   - **Atomic placeholders.** A split point never falls inside an
     `![…](…)` or `[…](…)` token (TenderBase's `safeSplitPoint`).
   - **Exact spans stay.** The chunk text is never trimmed, prefixed or
     rewritten.
4. **Global offsets.** The ingest step converts each span to a global one
   (plus `page.char_from`) before committing. The column comment's invariant,
   `content = ocr_text[char_from:char_to]`, still holds.
5. Documents ingested today stay on version 2 unless re-run. Nothing re-runs
   them.

### R3. Section context (carried across pages)

The document is walked page by page, keeping a state `{heading, note}`:

- **A heading line** (`^#{1,6}\s+\S`, level ignored) sets `heading`. A run
  of consecutive heading lines is joined with `" › "`, and `note` is cleared.
- **A margin note** (a Mistral `aside_text` block whose content is found in
  the page text, searching forward) sets `note` at its position.
- **Each chunk's context** is the state at the chunk's start, plus any
  heading or note that begins inside the chunk's first 200 characters.
- **The state carries over into the next page**, so a section that continues
  onto page 8 keeps its heading.
- It is stored as `document_chunks.metadata.section = {heading?, note?}`,
  each at most 200 characters. It is for display and embedding only; nothing
  filters on it.

### R4. Embedding input and hash

**The embedding input** for a `pdf_page` chunk is:

```
[<heading>][ › <note>]\n\n[<table header row + divider, if the chunk starts inside a table>]<content>
```

Empty parts are omitted. Chunks of version-2 documents embed `content` only,
as today.

**`chunk_hash`** becomes `SHA-256(chunker_version ‖ unit_key ‖
normalise(embedding input))`. The hash exists to decide whether the stored
vector can be reused. If a chunk's context changes but its text doesn't, the
vector is stale, so the hash must change too.

This amends ADR 0004 point 2. `text_hash` on a citation stays
`sha256(normalise(content))`, so reader staleness checks are unaffected.

### R5. Blocks and images link to chunks

- **`block_ids`:** the blocks on the chunk's page whose normalised content
  (at least 12 characters; its first 120 characters) occurs in the chunk's
  normalised content. This is TenderBase's rule, and it drives the PDF
  highlight.
- **`image_ids`:** the images whose placeholder occurs in the chunk's
  content.

## Schema (one migration, `…_page_contract.sql`, after `retrieval-scope`'s)

**`documents`: new nullable columns**

| Column | Type | Meaning |
| --- | --- | --- |
| `storage_path` | text | object path of the original PDF in the private `corpus` bucket, e.g. `<document_id>/original.pdf` |
| `extract_hash` | text | the current extraction: SHA-256 over the file's content hash, the OCR model, the request options and the composition version |
| `source_mime` | text | `application/pdf` for new documents |

`page_count` is **filled** for page-aware documents, and stays null for the
2,338.

**`document_pages`** (new)

| Column | Type |
| --- | --- |
| `id` | uuid pk |
| `document_id` | uuid fk → documents on delete cascade |
| `extract_hash` | text not null |
| `page_number` | int not null, ≥ 1 |
| `text` | text not null (R1) |
| `char_from`, `char_to` | int not null (offsets in `ocr_text`) |
| `header`, `footer` | text (as returned) |
| `header_in_text`, `footer_in_text` | boolean not null default false (R1.3) |
| `width_px`, `height_px`, `dpi` | int |
| `created_at` | timestamptz |

Unique on `(document_id, extract_hash, page_number)`.

**`document_page_blocks`** (new)

| Column | Type |
| --- | --- |
| `id` | uuid pk |
| `document_id` | uuid fk cascade |
| `extract_hash` | text not null |
| `page_number` | int not null |
| `block_index` | int not null (reading order; Mistral gives no id) |
| `type` | text not null |
| `x0`, `y0`, `x1`, `y1` | real not null, `check (0 ≤ x0 ≤ x1 ≤ 1 and 0 ≤ y0 ≤ y1 ≤ 1)`, normalised by the page's pixel `width` and `height` and clamped |
| `content` | text |

Unique on `(document_id, extract_hash, page_number, block_index)`. Indexed
on `(document_id, page_number)`.

**`document_page_images`** (new)

| Column | Type |
| --- | --- |
| `id` | uuid pk |
| `document_id` | uuid fk cascade |
| `extract_hash` | text not null |
| `page_number` | int not null |
| `placeholder` | text not null (the R1.2 token id) |
| `storage_path` | text not null (`<document_id>/p<page>/<sha256>.<ext>` in `corpus`) |
| `sha256` | text not null |
| `mime` | text not null |
| `byte_size` | int |
| `x0`, `y0`, `x1`, `y1` | real, the same normalisation and check |

Unique on `(document_id, extract_hash, placeholder)`.

**`document_chunks`: new nullable columns**

- `block_ids uuid[]`
- `image_ids uuid[]`

`metadata.section` per R3. The `source_kind` check already allows
`pdf_page`.

**`chunk_commit`:** on a hash hit, it also refreshes `block_ids` and
`image_ids`; on insert, it writes them. Both come from `p_rows`. The
signature is unchanged. The `create or replace` keeps the grants.

**RLS and grants** for the three new tables, the same as `documents`:

- `select to authenticated using (true)`;
- anon revoked;
- `service_role` has all privileges.

The column `storage_path` is readable by signed-in users. That's harmless,
because the bucket is private and only a server-minted signed URL opens it.

**`match_documents`:** drop and recreate, keeping `retrieval-scope`'s
signature, with **extra return columns**: `block_ids uuid[]`,
`image_ids uuid[]` and `section jsonb` (`metadata->'section'`). Everything
else is identical. The grants are re-applied. Old rows return nulls.

**One current extraction per document.** Rows whose `extract_hash` differs
from `documents.extract_hash` are superseded. `ingestion-v2` deletes them
after the new extraction's chunks are committed. Until then, readers filter
on `documents.extract_hash`.

## Citation payload (additive; old citations unchanged)

`TextCitation` (both twins) gains optional fields:

| Field | Type | Filled when |
| --- | --- | --- |
| `boxes` | `Array<{page: number, x0, y0, x1, y1}>` | page-aware chunk with `block_ids`. Resolved **by the server** when the citation is built, from `document_page_blocks`, for cited chunks only. At most 20 boxes. |
| `image_ids` | `string[]` | the chunk has images. The browser asks for signed URLs when it renders them (`citations-pdf`). |
| `section` | `{heading?: string, note?: string}` | page-aware chunk |

`page_number` is already there, and is now set for `pdf_page`.
`isReadableCitation` accepts the new fields when they're well formed, and
ignores them when they're absent. Old saved messages still validate.

**The model sees** `handle | title | desk_feature | p. <n> | <heading › note>`
for page-aware chunks, so answers can refer to a page and a section. The
handle rule is unchanged: the model still can't cite anything the server
didn't issue, and it never sees storage paths.

## ADR 0004 amendment (written with this module)

- **Unit key:** "the page id once pages exist" becomes `page:<page_number>`.
  A row id would change on every re-extraction and re-embed every chunk; a
  page number keeps an unchanged page's vectors.
- **The hash** covers the embedding input (R4), not the bare chunk text.
- **Pages, blocks and images** are tables of their own, keyed by
  `(document_id, extract_hash, …)`. `block_ids` and `image_ids` sit on the
  chunk and are refreshed by `chunk_commit` on a hit.

## Code this module owns

- **`_shared/chunking.ts`, version 3:**
  - placeholder atomicity;
  - a `chunkPages(pages, blocks)` entry point that runs R2, R3 and R5 and
    returns rows with global spans, `block_ids` candidates, `image_ids`,
    `section` and the embedding input;
  - `chunkDocument` unchanged.
- **`_shared/pageText.ts`** (new, pure), for R1:
  - `inlineTables`;
  - placeholder rewriting;
  - header and footer repetition;
  - page offsets;
  - `normaliseBox`, the pixel-to-0..1 conversion that TenderBase's
    `mistral.ts` does.
- **The migration** above, plus a new SQL fixture, `page_contract.sql`.
- **`retrieval.ts` and `rowToChunk`:** the new fields.
- **`research-chat/sources.ts` `toSource`**, and its test twin: map `section`
  and `image_ids`; resolve `boxes`, through one bounded service select per
  turn.
- **`agent.ts`:** the model line.
- **`citation.types.ts`, `src/types/citation.js` and `isReadableCitation`.**
- **`docs/decisions/0004-…`:** the amendment.

## Testing strategy

- **Deno, for `pageText.ts` and `chunking.ts`**, using fixtures built from
  the saved Mistral response of the 12-page bill, plus synthetic pages for
  what that bill lacks: tables, images, a running header, a unique header.
  - The page offsets round-trip: `ocr_text.slice(page.char_from,
    page.char_to) === page.text` for every page.
  - Every chunk's global span reproduces its content.
  - No chunk crosses a page, and no placeholder is split.
  - The repetition rule: a running header is dropped, a unique one kept,
    digits are ignored, and 1–3 page documents keep everything.
  - Section context carries over a page break, and a margin note is picked
    up.
  - `block_ids` and `image_ids` linking.
  - Box normalisation and clamping.
  - The hash changes when the context changes and the text doesn't.
  - Version 2 behaviour is unchanged for `chunkDocument`: the existing
    tests stay green.
- **Deno, for `sources.ts` and `retrieval.ts`:**
  - the new fields are mapped;
  - boxes are resolved and capped;
  - old-shape rows produce old-shape citations.
- **Vitest:**
  - `isReadableCitation` accepts old and new shapes and rejects a
    malformed box;
  - `src/types/citation.js` stays in step.
- **SQL fixture `page_contract.sql`** (a new chain entry in `run.sh`, with
  vacuity):
  - the tables and constraints exist;
  - a box outside 0..1 is rejected;
  - `authenticated` can select and not write, and anon can do neither;
  - `chunk_commit` writes and refreshes `block_ids` and `image_ids`;
  - `match_documents` returns the new columns, with nulls for old rows;
  - the grants are present.
- **Every new test is shown to fail first.**

## Boundaries

- **Always:**
  - Additive only.
  - Old rows and old citations keep working.
  - Exact spans.
  - A task agent may not change R1–R5 without updating this spec, with the
    owner's approval.
- **Ask first:**
  - Applying the migration to NTER.
  - Deploying functions.
- **Never:**
  - Re-chunk or alter the 2,338 existing documents.
  - Filter on `metadata`.
  - Show the model a storage path.
  - Put a signed URL in a stored citation (they expire).

## Acceptance evidence

1. Both suites, lint, build and `npm run test:sql`, including the new
   fixture and its vacuity check, all pass. There is fail-first evidence for
   each new test.
2. A dry run of `chunkPages` over the saved 12-page bill response, committed
   as a Deno fixture test, shows the expected page texts and chunk count, the
   section contexts, and that the unique header (introduction date) and
   footer (sponsor) are kept while the page-number footers are dropped.
3. The ADR 0004 amendment is committed.
4. `eval` in `broad` mode still meets the bar after the migration (on the
   replica, then live after the owner applies it). The added return columns
   must not change ranking or latency.

## Scope

`_shared/pageText.ts`, `_shared/chunking.ts`, `_shared/retrieval.ts`,
`_shared/citation.types.ts`, `research-chat/{sources,agent}.ts` and their
tests; `src/types/citation.js`, `src/ai/CitationBubble.jsx`
(`isReadableCitation`) and their tests; one migration and one fixture, plus
`run.sh`; the ADR amendment.

## Exclusions

- Calling Mistral, the bucket, uploading images, the queue and the job table:
  all `ingestion-v2`.
- Signed URLs, the PDF viewer and the image strip: `citations-pdf`.
- Typed table rows, as in TenderBase's `drive_item_tables`.
- Putting the document title into the embedding input. It is a possible
  later experiment, measured with `eval`, and not part of this contract.

## Open questions for the owner

1. **The repetition thresholds** (3 pages, or 30% of pages in documents of
   4+ pages). I recommend starting with these and revisiting after the
   pilot.
2. **Section context in every chunk's embedding.** Approved in principle.
   The pilot and a v2 `eval` set will confirm it beats the first chunk only.
