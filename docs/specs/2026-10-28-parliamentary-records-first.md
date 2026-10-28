# Parliamentary questions: records first

> **Status: Living. Proposed, awaiting the owner's approval** (open-work F266). Written 2026-10-28
> after the review of the client's corpus branch. Nothing here is implemented or authorized:
> no ingestion, no mapping apply and no data-file change without separate approval.

## 1. Current state (measured on NTER, 2026-10-28, read-only)

- **Listing.** `desk_rows` holds 8,000 rows for `national / Parliamentary Question Database`, loaded
  from the shipped file `public/data/embedded_csv/national_question_database.json` (all Lok Sabha,
  answered 2024-07-22 to 2026-04-02). Each row has `id` "1"–"8000", which becomes `row_key`;
  `document_key` is empty on all 8,000; there is no session field, so the page shows "Not reported".
- **The identity is already in the data.** Every row's `source_url` is a sansad.in answer file,
  `…/loksabhaquestions/annex/<session>/<stem>.pdf?source=pqals` (for example `187/AU6302_KIQmzb`).
  `pq:ls:<session>:<stem>` is derivable for all 8,000 rows and names 6,840 distinct answer documents
  (one answer can serve several members' rows), the same 6,840 the client's pack holds.
- **Documents.** 5,947 question documents are registered:
  - 5,865 from the client on 2026-10-27, each with `metadata.document_key_suggested` =
    `pq:ls:<session>:<stem>`; **all 5,865 match a listing row's derived key**;
  - 82 from 2026-09-21 with no `file_url`; their pack path `…/PDFs/<session>_<stem>.pdf` gives the
    same key, and all 82 match a listing row (none duplicates a client document).
- **Links.** `record_document_links` holds 5,638 links for 4,749 documents (the F257 repair,
  2026-10-27, by exact source URL plus house, subject, date and ministry checks). Held: 1,198.
  - The 1,116 held as "index incomplete" are now complete except 6: 1,110 are indexed with every
    vector (10,349 chunks); 6 have failed ingest jobs.
  - The 82 were held for having no source URL.
- **Law, for comparison.** Law admission creates or links the canonical listing record in the same
  step as registration (`law_records`, `law_document_links`): 7,549 of 7,549 Law documents are linked.

## 2. Problem

The question listing never carried the identity its own data contains, and admission of a document
never wrote its link to the listing. So a correctly identified document could be indexed and
searchable but invisible on its record. Matching had to be reconstructed afterwards (F257), and
whatever was still indexing at that snapshot stayed unlinked.

`row_key` is the row's position in the shipped file. The website's record pointer
(`desk-record:["national","Parliamentary Question Database","<row_key>"]`) and every saved link
depend on it, so a re-export in a different order would silently attach documents and saved chats to
the wrong questions.

## 3. Expected outcome

1. Every question row carries its answer document key, derived from its own `source_url`.
2. A question document is admitted only together with its links to the listing rows that name its
   key, in one transaction; otherwise it is held with a reason. No later repair is needed.
3. The 1,192 linkable held documents are linked without re-ingestion; the 6 failed ones stay held.
4. Row identity survives a re-export, and existing links and saved references keep working.

## 4. Design

### 4.1 Answer key on every row (no data-file change)

- One pure function, `pqAnswerKey(sourceUrl)`, returns `pq:ls:<session>:<stem>` for an https
  sansad.in `…/loksabhaquestions/annex/<digits>/<stem>.pdf` URL, else null. Rajya Sabha (`pq:rs:`)
  is defined the same way but out of scope until such rows exist.
- The desk-row loader writes it to `document_key` for this feature (`scripts/load-desk-rows.mjs`,
  through `src/lib/deskRows.js`). The shipped data file is not edited (it is under `public/data/`).
- The page may show the session from the same parse instead of "Not reported" (display only).
- `documentKey()` in `src/lib/deskRows.js` keeps returning the `desk-record:` pointer for questions;
  the answer key is evidence for linking, not a new attachment identity, as
  `supplied-text-import.md` already requires.

### 4.2 Link at admission (server-enforced)

- For supplied-text documents in this collection, registration resolves the document's answer key
  against live `desk_rows` and writes `record_document_links` (role `answer`, version `1`, the row
  and document fingerprints and the evidence hash) **in the same transaction** as the document.
- Admission checks, all required: answer key derived from the document's own source URL or pack path
  equals the row's; house, answer date, ministry and subject agree with the row (the F257 checks);
  the key is not claimed by another document. Any failure holds the document with a named reason and
  writes nothing.
- An exact rerun returns the existing document and links (idempotent, no duplicate links).
- Indexing still completes asynchronously; a linked document shows Full text only once indexing and
  vectors are complete (F261/F264 rules unchanged).
- This is the "adapter" the bulk-orchestration spec asks for; Law keeps its own path.

### 4.3 Backfill the held documents (association only)

- Re-run the reviewed F257 planner (`scripts/record-mapping-repair.mjs`) on a fresh inventory, with
  the answer key as an additional required match, so the 1,110 completed documents and the 82
  September documents are evaluated; the 82 use the pack path in place of the URL.
- Dry run, an owner-approved manifest, apply through the existing service-only path, then replay to
  prove zero duplicates. No OCR, chunk, vector or document change. The 6 failed documents stay held.

### 4.4 Stable row keys (second step, recommended)

- Give each question row a key that does not depend on file order: `<answer key>#<member slug>`
  (one row per member asking). Keep an alias table from the old `row_key` to the new one, and move
  the 5,638 links and any saved references through it in one reviewed migration.
- Do this before the listing is next regenerated. Until then the loader must refuse to load a file
  whose `id` → answer-key pairs differ from the loaded rows (a guard, not a rewrite).

## 5. Acceptance evidence

- Unit tests (red first): `pqAnswerKey` for valid, query-string, non-sansad, malformed and Rajya
  Sabha URLs; the loader writes the key for all 8,000 rows and 6,840 distinct keys; the reorder guard
  refuses a shuffled file.
- SQL fixture (disposable database, with its vacuity check): admission links in the same transaction;
  each failed check holds and writes nothing; reruns are idempotent; a key claimed twice holds.
- Dry run on a fresh read-only inventory: counts of linkable, held (with reasons) and unchanged
  documents, expected 1,192 linkable and 6 held; independent review of the manifest before apply.
- After apply: `record_document_links` covers 5,941 documents; document, chunk and vector hashes
  unchanged; the five F257 reference records and a sample of newly linked rows show Full text, and
  an attached-record question cites the right answer.
- Lint, build, router import, full Vitest and Deno, SQL fixtures; both CI jobs before merge.

## 6. Scope

`src/lib/deskRows.js` (key function), `scripts/load-desk-rows.mjs` (key and reorder guard),
the supplied-text admission path for this collection (`supabase/functions/_shared/suppliedText.ts`,
`admin-ingest`, one migration), `scripts/record-mapping-repair.mjs` (answer-key match), tests and
docs. Step 4.4 is a separate approval.

## 7. Exclusions

New ingestion or batches; re-OCR or re-embedding; the client's National branch (F265 decides whether
its changes are merged first; this design must be built on whichever is on `main`); Rajya Sabha;
Bills, Regulatory and other collections (each needs its own adapter); changes to
`public/data/`.

## 8. Decisions for the owner

1. Approve 4.1–4.3 as one task, with 4.4 as a follow-up?
2. F265 first: merge the client's National admission change, or build 4.2 on the current `main` code?
3. The 6 failed documents: re-run their ingest jobs, or discard?
