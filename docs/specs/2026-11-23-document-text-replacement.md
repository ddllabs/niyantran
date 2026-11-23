# Replacing a live document's text, with the old text kept (F357)

> **Status: Living (2026-11-23).** Design spec for the `repairs` module of
> [corpus and search completion](2026-11-20-corpus-and-search-completion.md), task C2 of the
> [v1.1 to v1.3 plan](../plans/2026-11-19-v1.1-to-v1.3-loads-and-closeout.md) and task B3 of the
> [readiness plan](../plans/2026-11-18-national-scale-readiness.md). Extends the
> [bulk ingestion spec](2026-11-01-bulk-ingestion.md), §8 of which keeps the v1.2 replacements "a separately reviewed
> developer step". Spec only: nothing here is built, applied, deployed or loaded. Every step on NTER waits for the
> developer's named yes, after a rolled-back dry run. The only list of open work is [open-work.md](../plans/open-work.md).

## Current state

Everything in this section was read from the code at `c3a0f687` and from the committed
[v1.2 B0 report](../operations/national-v1.2/) (a read-only NTER export of 2026-10-31). Nothing was executed and NTER
was not read for this spec.

### What the packs ask for

- v1.2's `ocr_repaged` member holds 1,819 records, all with `replaces_text: true` and `page_split: 'exact'`
  ([b0-summary.json](../operations/national-v1.2/b0-summary.json)). The texts were OCRed again with an exact page
  split: only 1 of 1,819 new texts equals a live text, so the characters change as well as the page breaks.
- Each record carries the hash of the text it replaces, `old_content_sha256`
  ([b0-collect-colab.py](../operations/national-v1.2/b0-collect-colab.py), column list).
- Matched against NTER on 2026-10-31 ([b0-replacements.tsv](../operations/national-v1.2/b0-replacements.tsv)):

  | Match | Records | Desks | Live chunks then | New chunks (offline estimate) |
  |---|---:|---|---:|---:|
  | `source_key`, and `old_content_sha256` equals the live hash | 1,796 | Bills 1,711, Lok Sabha answers 82, Regulatory 2, Budget 1 | 42,707 | 41,855 |
  | `old_content_sha256` only (the live `source_key` differs) | 21 | Bills | 213 | 219 |
  | none (not on NTER) | 2 | Budget | 0 | 145 |

  The 1,817 matched documents had 0 record links. 1,601 of the 1,819 records have a `file_url` equal to a live
  document's. Two live documents have more than 800 chunks (the largest 2,240); two new texts are estimated above 700.
- v1.4 carries 7,801 RBI text fixes and v1.6 7,068 replacements (manifests, read 2026-11-18). v1.6 marks them
  `v16_replaces: true` (`scripts/bulk-runner/pack.ts:484` drops them as `replacement`). How v1.4 marks its fixes, and
  whether either pack carries `old_content_sha256`, was not read.

**Not verifiable without the pack and a fresh NTER read:** whether the `ocr_repaged` records carry `pages` with
`text`, `n_pages` or `page_count`, `licence_class`, `citation`, `document_key` and `document_role` in the shapes the
runner reads; whether the 1,796 live hashes still equal `old_content_sha256` today (the F281 repair rewrote 97
documents on 2026-11-02, and some may be among them); which of the 1,796 are supplied-text documents and which came
through the older `ingest-documents` path; whether any has gained a record link since 2026-10-31. Task 0 reads all of
these before anything is built against them.

### How a document's text is held and served

- A document is one `documents` row (`source_key` unique) with its text in `ocr_text`, its hash in `content_sha256`
  and, for supplied text, its page spans in `metadata.supplied_pages`. Supplied-text documents also have one
  `ingest_text_inputs` row (payload, payload hash, the approved chunk plan)
  (`supabase/migrations/20261022230537_supplied_text_connection.sql:7-17`).
- Chunks live in `document_chunks`, list-partitioned by `desk_feature`, unique on `(document_id, chunk_hash)`, with a
  half-precision HNSW index and a keyword GIN index per partition
  (`20261101120000_document_chunks_partitioned.sql`; `20261102120000_chunk_hybrid_search.sql:562`).
- Search reads every chunk of every document with `indexed_at is not null` (`match_documents`,
  `match_documents_hybrid`: `20261101120000_document_chunks_partitioned.sql:753-783`,
  `20261124100000_hybrid_sitewide.sql`). There is no notion of a chunk belonging to an old or a new text: if a
  document's chunk set held both, search would serve both.
- Both search functions are `stable` plpgsql. PostgreSQL gives a stable function the snapshot of its calling query
  for every statement inside it (PostgreSQL documentation, "Function Volatility Categories"; not executed here), so
  one search never mixes two committed states.
- A row's documents are found by `record_resolve_document_keys`. The Bills branch matches `metadata->>'document_key'`
  and checks nothing else; the link branch requires the link's `text_sha256` to equal `documents.content_sha256` and
  its `document_identity_sha256` to equal the hash of `{source_key, metadata}`, or the row reads `held` and the
  document is not served for it (`20261110180000_record_resolver_shared_bill_keys.sql:90-106`). A text change without
  rebinding the links therefore takes linked documents out of their rows.

### Why no path replaces text today

- **Batch registration** (`ingest_admit_document`, last defined in
  `20261123090000_national_search_only_five_desks.sql:221`) looks a record up by `source_key`. An existing
  supplied-text document with another payload is refused `immutable_conflict` (line 239); one without
  `ingest_text_inputs` is refused `legacy_source` (line 236). A record under a new `source_key` whose text another
  document holds is refused `duplicate_text` (line 439).
- **The supplied-text trigger** `protect_supplied_text` refuses any update to a supplied-text document other than
  `updated_at`, `indexed_at` and `chunker_version`, and once it is indexed refuses those too
  (`20261022230537_supplied_text_connection.sql:177-190`).
- **Activation** writes only a first extraction: `ingest_text_activate` refuses a document already indexed
  (`20261022230537_supplied_text_connection.sql:76-97`).
- **The older path**, `ingest-documents`, rewrites a legacy document in place: it clears `indexed_at`, re-chunks
  through `chunk_commit` (which deletes every chunk not in the new plan) and sets `indexed_at` again
  (`supabase/functions/ingest-documents/handler.ts:24-50`). The document leaves search for the whole rewrite, and the
  old text and chunks are gone. It refuses supplied-text and page-aware documents (`handler.ts:21`, `:270`). The F281
  repair (`scripts/f281-repair/repair.mjs`) used it for 97 documents, with its own snapshots for rollback.
- **The admin Replace** (`ingest_swap`, `20261001180000_corpus_records.sql:646-708`) registers a new document and moves
  the `document_key` to it. It applies to uploaded PDFs only (`storage_path` set) and would collide here with the
  per-desk unique indexes on `file_url` and suggested key, which both texts would share.
- **The runner** passes `replaces_text` records through: `pack.ts` drops only `v16_replaces`, and the Bills screen has
  no replacement hold (`scripts/bulk-runner/screens/bills.ts`; the search-only screen holds them,
  `screens/search_only.ts:611-617`). Admission refuses those with a live `source_key` (above). For the 21 under another
  key it is not proven that admission refuses them; they would be refused only if the bill's file or role is already
  held.

### What the app shows from a citation

- A text citation stores `document_id`, `chunk_id`, `char_from`, `char_to`, `text_hash` and an optional `page_number`
  (`supabase/functions/_shared/citation.types.ts`). The reader loads `documents.ocr_text` by id and the cited chunk's
  content by `chunk_id`, then: the stored span still hashes to `text_hash` gives `exact`; else the chunk's content
  found elsewhere in the text gives `moved`; else `changed`, with the document shown from the top and a notice
  (`src/ai/sourceReader.js:32-45`, `src/ai/SourceReader.jsx:17-31`). A citation never highlights the wrong passage.
- Supplied-text chunks carry no page number (`supabase/functions/ingest-worker/supplied-step.ts:11`), and nothing in
  the app or the functions reads `metadata.supplied_pages`. So for a supplied-text document the corrected page breaks
  do not reach a citation; what a reader gains is the new OCR text and its chunks. Legacy chunks may carry page numbers
  (`ingest-documents/handler.ts:245`); after a replacement their new chunks carry none.

## Problem

There is no route that swaps a live document's text, chunks and vectors without a window where the document is absent
or half-indexed, and none that keeps the old text. v1.2's 1,796 corrections wait on it, and v1.4 and v1.6 carry about
15,000 more.

## Expected outcome

A replacement collection is screened, planned, registered, indexed and accepted through the same runner, ledger, stop
rules and worker as an admission. For each document, its new chunks are built and embedded aside; then one transaction
archives the old text and chunks, puts the new ones in place, rebinds the document's links and records the revision.
Before that commit every search sees only the old text; after it, only the new. The old text, payload, metadata,
chunk rows and chunk ids stay in an archive, and one owner-only call puts a document back exactly as it was.

## Design

### 1. The decision this rests on: same document, staged revision, one flip

The document keeps its `id`, `source_key`, `file_url`, desk, title, record links and identity metadata. Only its
text changes. A **revision** holds one text version of one document; a new revision is built aside and **flipped** in.
The alternative, a new document row with the key moved to it (`ingest_swap`), needs a second `source_key`, collides
with the per-desk unique indexes on `file_url` and suggested key, re-points every link and leaves old citations on a
document that search no longer serves. It is listed as decision D1.

### 2. Tables (new; RLS on, no policies, revoked from public, anon, authenticated and corpus_ingest)

`document_text_revisions`, one row per text version of a document:

| Column | Meaning |
|---|---|
| `id` uuid pk; `document_id` uuid not null references documents on delete cascade | |
| `revision` int | 0 for the text the document held before its first replacement, then 1, 2, … |
| `state` | `pending` (being built), `applying` (inside the flip), `live`, `retired`, `abandoned` |
| `batch_id` uuid null references ingest_batches | the replacement batch; null for revision 0 and for a restore |
| `old_content_sha256` | for a pending revision: the live hash it may replace (the compare-and-set value) |
| `content_sha256`, `ocr_text`, `page_count`, `chunker_version`, `metadata` | this version's text and the document columns it set |
| `payload`, `payload_sha256`, `expected` | this version's supplied-text input; for a legacy revision 0, null |
| `origin` | `supplied-text` or `legacy`, as the document was when this version was live |
| `links` jsonb | for a retired revision: the link rows' bound values before the flip rebound them |
| `vectors_purged_at`, `created_at`, `applied_at`, `retired_at`, `actor` (session user) | |

Unique partial indexes: at most one `pending` or `applying`, and exactly one `live`, revision per document.

`document_revision_chunks`, the chunk rows of a pending revision (staging) or a retired one (archive): every column of
`document_chunks` (with the original `id` kept as `chunk_id`), `revision_id`, a `reuse` flag for a staged chunk whose
vector is the live chunk's, and `embedding` nullable. Primary key `(revision_id, chunk_hash)`. No vector or keyword
index: nothing searches it.

Columns added (nullable, no default, no table rewrite): `ingest_jobs.revision_id` and `ingest_batch_items.revision_id`.
A replacement collection's policy carries `"mode": "replace"` and its thresholds inside the policy object
(`ingest_collection_policies` gains `mode text not null default 'admit'`).

### 3. Functions

Each is `security definer`, `search_path = public, extensions, pg_temp`, with no SET clause for a custom setting.
Every replaced function is guarded by the md5 of the body it replaces, as the five-desk migration does.

| Function | Who may run it | Does |
|---|---|---|
| `ingest_replace_batch(p_batch uuid, p_documents jsonb, p_dry_run boolean)` | corpus_ingest, service_role | per item: the admission checks (§4), then a `pending` revision with staging empty and one `supplied_text` job with `revision_id`; outcome `admitted`, `existing` (the same payload already pending or live) or `refused` with a reason, recorded in the ledger |
| `ingest_replace_commit(p_job, p_token, p_rows)` | service_role | at most 100 rows into the pending revision's staging, each equal to the approved plan (as `ingest_text_commit` checks); a row with `reuse: true` carries no vector and must match a live chunk's `chunk_hash` and `embed_hash` |
| `ingest_replace_activate(p_job, p_token, p_tokens, p_cost)` | service_role | the flip (§5) |
| `ingest_revision_restore(p_document uuid, p_revision uuid, p_reason text)` | owner only (the supervisor by psql, on a yes) | puts a retired revision back with its own chunk ids and vectors; refused `vectors_purged` once its vectors are gone (then it is replaced back through a batch whose payload is the archived text) |
| `ingest_revision_purge_vectors(p_batch uuid)` | owner only, on a named yes | sets the archived vectors of the batch's retired revisions to null and stamps `vectors_purged_at`; text and chunk rows stay |

Changed: `ingest_register_batch` refuses a batch whose policy mode is `replace`, and `ingest_replace_batch` refuses one
whose mode is not; `ingest_policy_approve` accepts `mode`, the replacement thresholds and the required check
`replacement_identity`; `ingest_text_commit` and `ingest_text_activate` refuse a job with `revision_id` (so a worker
deployed before this change fails such a job closed instead of writing live chunks); `protect_supplied_text` allows
one update of a supplied-text document: the one made while a revision of that document is `applying` with
`old_content_sha256 = old.content_sha256` and `content_sha256 = new.content_sha256`. The trigger runs as the updating
role, and only the definer functions can read the revisions table, so a direct update by any other role still fails.
`ingest_claim` is unchanged: a replacement job is a `supplied_text` job, so the expired-claim rule and every batch stop
already apply to it.

### 4. Admission rules for a replacement

The screen (runner, §7) does the expensive identity checks and writes them into `review.checks`; registration
re-checks every cheap invariant on the database, under the same locks as admission (source, text, then the document
row `for share`). The payload carries `replaces: {source_key, old_content_sha256}`, so the payload hash (and with it
the sealed manifest) binds which text a record may replace; no manifest format changes.

**What proves the new text is the same document** (screen; each a named check):

1. **Same record.** The target is the live document with the record's `source_key`, tier and feature.
2. **Same starting text.** The live `content_sha256` equals the record's `old_content_sha256`.
3. **Same identity.** For Bills: `document_key`, `document_role`, `house`, bill number and year equal the live
   metadata, and the bill-text check passes (`billTextIdentity`, as admission requires). For every desk: the live
   `file_url`, when there is one, equals the record's.
4. **Same words.** The share of the live text's four-word sequences found in the new text
   (`oldTextContainment`, `src/lib/documentRepair.js:657`): at or above 0.5 passes; 0.05 to 0.5 is held for a person
   (`replacement_low_overlap`); below 0.05 is refused (`replacement_other_document`). A live text under 100 sequences
   is held. These are the F281 thresholds (`IDENTITY_THRESHOLDS`, line 672), set from 44 Regulatory documents; the
   first screen run reports the distribution over the 1,711 Bills before the policy fixes them (D3).
5. **Similar length.** The new text's length is between half and twice the live text's, or held
   (`replacement_length`).
6. **Right pages.** The pack's page count equals its page spans (admission's `page_count_mismatch` rule), and the
   text-per-page check against the official PDF passes (`scripts/bulk-runner/page_check.ts`, as for the Bills load).

**Registration refuses, with these reasons:** `target_missing`; `target_not_live` (not indexed: the 4 of F312);
`target_page_aware` (`extract_hash` or `storage_path` set: the OCR pipeline owns those); `target_busy` (an active job
or a pending revision); `stale_target` (rule 2); `identity_mismatch` with the field named (rule 3);
`review_incomplete` (a required check absent or false); `duplicate_text` (another document holds the new text);
`no_change` (the new text equals the live one); and every policy gate admission applies (licence, servable, declared
counts, control codes, thin text, chunk limit). `existing` answers a rerun of the same payload.

**Held by the runner before registration:** the 21 Bills whose live `source_key` differs and the 2 Budget records not
on NTER (D4); the 82 Lok Sabha answers the owner keeps held (D5); texts over the policy's chunk limit (F311).

### 5. The flip (`ingest_replace_activate`), one transaction

1. Lock the job (claim token, lease, `revision_id` set), then the revision (`pending`), then the document `for update`:
   the order every other writer of these rows uses.
2. Compare and set: the document's `content_sha256` still equals the revision's `old_content_sha256`, it is indexed,
   and `extract_hash` and `storage_path` are null. Otherwise raise `target_changed`; the worker fails the job
   permanently and nothing is changed.
3. Staging is complete: exactly the plan's chunk hashes, each with a vector or a valid `reuse`.
4. Archive: if the document has no `live` revision, write revision 0 from the document as it stands (text, metadata,
   `ingest_text_inputs` if any, origin). Copy every current chunk row, with its id and vector, into the archive under
   that revision. Record the links' bound values.
5. Chunks, as `chunk_commit` reconciles them but set-based from staging (no 18 kB-per-chunk JSON argument): delete the
   chunks whose hash is not in the new plan; update those in both (offsets, index, content, embed hash; the row and
   its id are kept, and its vector unless re-embedded); insert the new ones with the partition key.
6. Mark the revision `applying`; update the document: `ocr_text`, `content_sha256`, `page_count`, `chunker_version`,
   and `metadata` = the live metadata with only the text-bound keys replaced (`payload_sha256`, `supplied_pages`,
   `supplied_sections`, `n_chars`, `origin`, `text_chunking_mode`, `citation_offset_encoding`) and `text_revision` set.
   Identity keys and `indexed_at` are left as they are. Write `ingest_text_inputs` (insert for a legacy document,
   which from now on is a supplied-text document).
7. Rebind each `record_document_links` row of the document: `text_sha256`, `document_identity_sha256` and
   `fingerprint` recomputed; role, version, decision and approver unchanged.
8. The old live revision becomes `retired`, the new one `live`; its staging rows are deleted; the job succeeds with its
   spend.

A search that started before the commit sees the old chunks only; one that starts after sees the new ones only. A
reader that opens a citation sees one text or the other, never a mix. Two searches of one chat turn on either side of
the commit can cite one old and one new passage; the old citation then reads as below.

### 6. Old citations, page numbers and links after a flip

- **An old citation** keeps its `document_id`, which still exists. If its span hashes the same in the new text it
  reads `exact`. If its chunk survived the flip (same `chunk_hash`, row kept), it reads `moved`. Otherwise it reads
  `changed` and the reader opens the document at the top with its notice. Because the archive keeps `chunk_id`, a
  later reader change can show the passage as it was cited; that change is not in this spec (open item, below).
- **A restore** puts the archived rows back with their original ids, so citations made before the flip read `exact`
  again.
- **Page numbers** in stored chats do not change (they are stored in the message). New citations of a replaced
  document carry no page number, because supplied-text chunks have none (§ Current state; D8).
- **Links** are rebound in the flip, so a linked row reads `full` before and after. Bills rows resolve by
  `document_key`, which the flip does not touch.
- **Eval sets** that name a `gold_chunk_id` of a replaced document will report it as drifted
  (`src/lib/evalSet.js:232-238`); the §7 search check judges by document.

### 7. Runner and worker

- **Worker** (`supabase/functions/ingest-worker/`): a job with `revision_id` reads its plan from its revision (not from
  `ingest_text_inputs`), counts as stale only chunks that are neither staged nor live with the same `chunk_hash` and
  `embed_hash`, commits through `ingest_replace_commit` and finishes with `ingest_replace_activate`. The batch step
  keeps every rule it has today (per-job tokens, shared embedding calls, outage handling, deadline reserve).
- **Runner** (`scripts/bulk-runner/`): `pack.ts select --replacements` keeps only records marked as replacements
  (`replaces_text` or `v16_replaces`) and the normal selection keeps dropping both kinds; the Bills screen holds
  `replaces_text` records like the search-only screen does; a `replacement` screen reads each target read-only from
  NTER (developer's login, `begin transaction read only`) and runs §4's checks; collection files with
  `"mode": "replace"`; `plan`/`run` call `ingest_replace_batch`; acceptance adds `revision_live`, `old_text_archived`
  (the retired revision holds the old hash and the old chunk count) and `no_old_chunks` (no chunk outside the new
  plan) to its checks, with the probe and link checks as today.

## Spend and capacity

**Chunks.** From the B0 export (read-only, 2026-10-31): the 1,796 targets held 42,707 chunks; the offline estimate
for the new texts is 41,855. That estimate used the whole-document chunker (`chunkUnit`,
[b0-chunk-estimate.mjs](../operations/national-v1.2/b0-chunk-estimate.mjs)), not the section-context chunker the runner
uses, so it is ±20% until `cli.ts plan` counts every text with the runner's own chunker. Bills alone: 1,711 documents,
41,572 live chunks, 40,784 estimated.

**Embedding.** At the Bills load's measured rate (US$1.34 for 266,947 chunks, US$0.0000050 a chunk), 41,855 chunks
cost about US$0.21, about 9 million tokens at B0's 217 tokens a chunk. Chunks reused from the live text cost nothing;
with new OCR text few will be. Proposed policy budget: US$2.

**Time.** At the normal worker limits (about 2 documents a minute) the 1,711 Bills take about 14 hours; at the raised
limits (about 16) about 2 hours.

**Disk while both texts exist** (per-chunk sizes measured on NTER 2026-11-18: 14 kB in all; stored text and vector
7.9 kB, row 1.1 kB, vector index 4.0 kB):

| Item | Size for the 1,796 |
|---|---|
| Staging, while a job is open (no index, about 9 kB a chunk) | about 20 MB per 100 documents, freed at each flip |
| New live chunks, before vacuum (the old rows are dead but not yet reusable) | about 590 MB |
| Archive with vectors (about 9 kB a chunk) | about 380 MB |
| Archive without vectors (about 2.8 kB a chunk) | about 120 MB |
| Archived texts and payloads (29 million characters of new text; old text is similar) | 60 to 90 MB |
| **Peak, vectors kept** | **about 1.1 GB** |
| **After a manual vacuum of the Bills partition, vectors purged** | **about 0.2 GB held; 0.6 GB reusable inside the partition** |

NTER had 18 GB used of 40 GB on 2026-11-20. At PostgreSQL's default scale factor (20%; NTER's setting not read),
autovacuum does not start on its own for 42,000 dead rows in a 356,000-row partition, so the load ends with
`vacuum (analyze)` of `document_chunks_bills` and the `analyze` AGENTS.md requires; vacuum also repairs the HNSW graph
around the deleted rows, and its duration is measured in the rehearsal first. v1.4 and v1.6 (about 14,900 records,
chunk counts not read): if they average the same 24 chunks a document, about 5 GB of new rows before vacuum and about
3 GB of archived vectors, so about 8 GB at peak; their own inventory (F358) replaces this guess, and the purge of
archived vectors (D2) matters more there than for v1.2.

**How long the old text is kept.** Text, payload, metadata, chunk rows and chunk ids: kept, with no automatic delete.
Archived vectors: kept until the batch is accepted, the §7 search check has passed and a retention period has run
(recommended 30 days), then purged on a named yes (D2). After the purge, a restore re-embeds through a batch (US$0.2
for all 1,796).

## Acceptance evidence

- The SQL fixture, run by `npm run test:sql` on a database built from scratch, shows each of these, and fails when the
  migration is left out (the runner's vacuity rebuild) and when each named guard is removed:
  registration writes a pending revision and a job and changes no document or chunk; while pending, `match_documents`
  returns only the old chunks; `ingest_text_commit` and `ingest_text_activate` refuse a replacement job; the flip leaves
  exactly the new plan's chunks, the new text, payload and metadata, the links reading `full`, and revision 0 holding
  the old text, payload, chunk ids and vectors; a direct update of the document is still refused afterwards; a text
  changed between registration and flip makes the flip fail `target_changed` with nothing changed; every refusal
  reason; a restore gives back the old text byte for byte and the old chunk set with its ids; a legacy target becomes a
  supplied-text document; corpus_ingest, anon and authenticated can read neither table and cannot flip, restore or
  purge.
- A concurrency script holds a flip open before its commit while a second session searches the document's own vectors
  repeatedly: every result set is all old or all new, never mixed; a second flip of the same document waits, then fails
  on the compare-and-set.
- Worker and runner tests, each guard shown failing first.
- Rehearsal on the local load copy: the 1,711 Bills replaced; the time of the largest flip and the longest lock; disk
  before, at peak and after vacuum; the Bills question set before and after (no worse, spec §7); 20 documents restored
  and compared byte for byte; the batch accepted.
- On NTER, only after the yes: a pilot batch of 20, accepted, then the rest in batches of up to 100, each accepted, then
  vacuum, `analyze` and the Bills search check, recorded in `docs/operations/`.

## Tasks

| # | Task | Who | Write scope | Depends on | Verification |
|---|---|---|---|---|---|
| 0 | Read-only inventory of the targets on NTER: for the 1,819 records, the live document by `source_key` and by hash, its origin, `ingest_text_inputs`, `extract_hash`, `storage_path`, `indexed_at`, chunk count, link count, active job, whether its hash still equals `old_content_sha256` and its `file_url` the record's; disk and partition sizes. Pack fields of `ocr_repaged` from the reader. Counts only into this spec | supervisor | this spec (Result section); output outside the repository | none | `begin transaction read only` (PGOPTIONS is not enforced on that service); counts reconcile to 1,819 |
| 1 | The developer decides D1 to D10 | developer | none | 0 | recorded here |
| 2 | Migration and fixtures | senior builder | `supabase/migrations/20261126090000_document_text_replacement.sql`; `supabase/tests/document_text_replacement.sql`; `supabase/tests/document_text_replacement_concurrency.sh`; one case in `supabase/tests/run.sh` | 1 | `npm run test:sql` (including the vacuity rebuild); each guard removed and shown failing; the concurrency script |
| 3 | Worker | engineering agent | `supabase/functions/ingest-worker/` (`types.ts`, `index.ts`, `handler.ts`, `supplied-step.ts`, `supplied-batch-step.ts`, a new `replace-step.ts`, their tests) | the §3 interface fixed in 2 | `deno test -A --config supabase/functions/deno.json supabase/functions`; `npm run lint`; `npm run build` |
| 4 | Runner | engineering agent | `scripts/bulk-runner/` (`pack.ts`, `prepare.ts`, `plan.ts`, `run.ts`, `cli.ts`, `acceptance.ts`, `db.ts`, `psql_db.ts`, `fake_db.ts`, `screens/bills.ts`, new `screens/replacement.ts` and `screens/replacement.json`, `screens/index.ts`, their tests) | the §3 interface fixed in 2 | `deno test -A --config supabase/functions/deno.json scripts/bulk-runner` (not in CI, F306: run and recorded); `deno lint`; `npm run lint`; `npm run build` |
| 5 | Independent review of 2 to 4 against this spec and the access rules | senior reviewer | none | 2, 3, 4 | written review; required fixes applied and re-run |
| 6 | Screen the 1,711 Bills; report the overlap and length distributions; the developer fixes the thresholds; `plan` | supervisor | policy and collection file values only | 4, 1 | screen receipt; plan receipt with exact chunk counts |
| 7 | Rehearsal on the local load copy (acceptance evidence above) | supervisor | `docs/operations/` record | 5, 6 | the record |
| 8 | On NTER, each step on its own yes: apply the migration by psql with a rolled-back dry run first (never `db push`, F283; the history row inserted after); deploy `ingest-worker`; approve the policy; pilot of 20; the rest; vacuum and `analyze`; Bills search check | supervisor | `docs/operations/` record | 7 | acceptance per batch; search check; disk |

Tasks 3 and 4 have disjoint scopes and may run together once task 2 has fixed the function signatures and row shapes
in §3. The readiness plan's B4 also changes `prepare.ts` and follows task 4. v1.4 and v1.6 replacements reuse this
route after their inventory (F358) and their own policy.

## Rollback

- **One document or one batch:** `ingest_revision_restore` for each revision, while its vectors are kept; afterwards, a
  replacement batch whose payloads are the archived texts.
- **Before the flip:** stop the batch (`ingest_batch_stop`); pending revisions and their staging are marked
  `abandoned` and their staging rows removed by the owner on a yes. The live documents were never touched.
- **The worker:** redeploy the previous version; it fails any replacement job closed (§3).
- **The migration:** its Down section restores the replaced function bodies and drops the new functions, tables and
  columns, and is clean only while no revision has been applied. After the first flip the two tables hold the only
  copy of old texts: they stay, and the functions are restored around them.

## Exclusions

No change to chunking, the embedding model, search functions, the reader pane or the page viewer. No new document
rows, no change of `source_key`, title, `file_url` or desk. No page-aware (OCR pipeline) or uploaded documents. No
deletion of archived texts. No load of v1.4 or v1.6 under this spec. The 82 Lok Sabha answers wait on the owner.

## Decisions needed from the developer

1. **D1. The design.** Same document with a staged revision and one flip (recommended), or a new document with the key
   moved to it.
2. **D2. Archived vectors.** Keep them until acceptance, the search check and 30 days, then purge on a named yes
   (recommended: fast exact restore, about 380 MB for v1.2); or never archive vectors (about 120 MB, every restore
   re-embeds and waits in the queue).
3. **D3. Identity thresholds.** Overlap pass 0.5, hold 0.05 to 0.5, refuse below 0.05; length between half and twice;
   text per page required. Recommended: run the screen first and fix the numbers from its distribution.
4. **D4. The 21 Bills matched only by the old hash, and the 2 Budget records not on NTER.** Hold both (recommended);
   or replace the 21 by hash, and route the 2 as new Budget documents.
5. **D5. The 82 Lok Sabha replacements.** Held until the owner decides on the September imports (recommended).
6. **D6. Legacy targets.** After the flip a legacy document becomes a supplied-text document, its identity metadata
   kept and only the text-bound keys replaced (recommended); or legacy documents are refused in this route.
7. **D7. `file_url`.** Keep the live link; refuse when both are set and differ; do not add a link where the live one is
   empty (recommended: adding one is an identity change with its own unique index).
8. **D8. Page numbers.** The corrected page breaks do not reach citations, because supplied-text chunks carry no page
   number. Accept that for v1.2 and record it as an open item (recommended), or hold the replacements until chunks
   carry pages, which is a chunking change the programme spec excludes.
9. **D9. Order and limits.** Bills (1,711) first, at the normal worker limits unless you raise them for the load; the
   policy's `min_decided` set to 50 so the failure-rate stop can fire on a batch of 100; vacuum of the Bills partition
   after the last batch (recommended).
10. **D10. Gate.** open-work.md says F357 waits on Gate 0 of the readiness plan, while the v1.1 to v1.3 plan lists
    C2 as depending on nothing. Say which holds: start tasks 0 to 5 now (recommended: they change nothing on NTER), or
    wait for Gate 0.

## Open items this spec finds (for the supervisor to record in open-work.md)

- `pack.ts` keeps `replaces_text` records in a normal selection, and the Bills screen has no replacement hold
  (task 4 closes both).
- The reader cannot show a cited passage that a replacement removed; the archive keeps `chunk_id` for a later fix.
- Supplied-text chunks carry no page number, so page splits never reach citations (D8).

## Not verified

- Everything about NTER today: this spec rests on the 2026-10-31 export (task 0 re-reads it).
- The `ocr_repaged` record fields beyond those the B0 script names.
- The new chunk counts (offline, another chunker), the time of the largest flip and of the Bills vacuum.
- The single-snapshot behaviour of the stable search functions across a flip, read from the PostgreSQL documentation;
  the concurrency script proves it.
- How v1.4 marks its 7,801 fixes.

## Result

Not started.
