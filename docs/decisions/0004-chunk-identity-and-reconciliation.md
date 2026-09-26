# ADR 0004: Chunk identity is a random id; reconciliation is by content hash

> **Status:** Normative — accepted 2026-09-20. Binds the `document_chunks`
> primary key, the `chunk_hash` column and the commit RPC until superseded.

## Status

Accepted.

## Context

A citation is stored inside an assistant message as a reference to a chunk.
Whatever identifies a chunk is therefore frozen into every conversation that
cites it. Re-indexing is guaranteed: Niyantran has said page-wise Markdown
will replace the current whole-document OCR, and re-chunking will follow.
Ingestion will also be re-run for ordinary reasons — a chunker fix, a
re-supplied file, a batch of additions.

During design, making the chunk id itself a hash of its content was proposed.
The reference implementation was then read
(`docs/research/2026-09-20-tenderbase-reference-patterns.md` §4): it keeps a
random primary key and a **separate** `chunk_hash` column, and its commit RPC
reconciles by hash — on a hit it keeps the row, its id and its vector, and
refreshes only the anchors and ordering.

## Decision

1. `document_chunks.id uuid PRIMARY KEY DEFAULT gen_random_uuid()`. The id
   means nothing and never changes for the life of the row.
2. `document_chunks.chunk_hash text NOT NULL` = SHA-256 over
   `chunker_version ‖ unit_key ‖ normalised chunk text`, where `unit_key` is
   the document id today and the page id once pages exist. Unique on
   `(document_id, chunk_hash)`.
3. One commit RPC, `chunk_commit(p_document_id, p_rows jsonb, p_keep_hashes
   text[])`, `SECURITY DEFINER`, callable by the service role only:
   - delete every chunk of the document whose `chunk_hash` is not in
     `p_keep_hashes`;
   - for each incoming row, look up `(document_id, chunk_hash)`; on a hit keep
     the row, id and embedding and update `chunk_index`, anchors and
     metadata; on a miss insert.
   The caller embeds **only** the rows that missed. A hit costs no embedding
   call.
4. Every anchor column (`page_number`, `char_from`, `char_to`, and any later
   `bbox`, `sheet_name`, `cell_range`) is nullable from the first migration.
   `source_kind text NOT NULL` names what the chunk was cut from
   (`document` today; `pdf_page` later).
5. A stored citation carries `chunk_id`, `document_id`, the character span and
   `text_hash` (hash of the cited chunk text). If the id ever fails to
   resolve, the span and hash allow re-resolution by content; if the text has
   changed, the viewer says so rather than showing the wrong passage.

## Alternatives considered

**Id = hash of content and position.** Idempotent and simple. Rejected: a
chunk whose text is unchanged but whose position moved — every chunk after
an inserted paragraph, every chunk on a later page after re-pagination — gets
a new id, and every citation to it dies even though the passage is
word-for-word the same. The reference implementation's comment names the
case: *"Anchors and ordering can still have moved."*

**Natural key `(document_id, chunk_index)`.** Rejected: an insertion in the
middle of a document renumbers every chunk after it, breaking every later
citation, and the same index can name different text across two indexings.

**Delete every chunk, then insert.** The simplest re-index. Rejected: there
is a window with no chunks in which a query returns nothing; a partial
failure leaves the document half-indexed or duplicated; and every chunk is
re-embedded whether or not it changed.

## Consequences

- Ingestion is idempotent. Running it twice on the same input converges to
  the same rows; no delete-first step, no duplicate passages in retrieval.
- Unchanged chunks are never re-embedded. A chunker fix that touches one
  section of a document costs one section's embeddings.
- Citations survive any re-index whose chunk text is unchanged. They do
  **not** survive a re-chunk that changes boundaries — the coming page-wise
  re-index will change most texts and therefore most rows. That is accepted;
  point 5 keeps those citations honest rather than dead.
- Bumping `chunker_version` deliberately invalidates every hash and
  re-chunks the corpus on its next run. That is the intended way to roll out
  a splitter change.
- The `text_hash` on a citation is what makes an "edited since cited" notice
  possible, at no cost beyond one column.
