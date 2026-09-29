# Corpus reconciliation and citation integrity

> **Status: Historical (2026-09-29).** Executed: all 2,338 of 2,338 documents are indexed (54,219 chunks). The 1,288 unknown `integrity` values are an accepted risk; the 716 missing `file_url` values are P8 in `plans/open-work.md`.
> Note 2026-09-29: bill-key collisions still have no explicit handling (`scripts/build-corpus-links.mjs` drops a key only when one file name has conflicting URLs; two documents deriving the same `bill:<year>:<number>` both keep it).
> Module: `corpus-reconciliation`. Prepared 2026-09-21.

## Objective

Finish the existing first pass by proving which source records are indexed,
which failed and which were deliberately excluded. Preserve exact text,
provenance and stable citation identity. Do not confuse ingestion completion
with complete source coverage or a live refresh pipeline.

## Source contract established by read-only inspection

The source root is ~/Downloads/NTER-Complete-Processed-Data. Its
04_indexes/OCR_FILES.csv contains 17,443 versions; 12,830 are current. Selecting
current records for the five approved features produces 2,338 unique IDs:

| Feature | Current records | Eligible under existing character cap |
| --- | ---: | ---: |
| Bill Passage Probability Index | 1,743 | 1,742 |
| Regulatory Body Watch (RBI SEBI TRAI CCI) | 506 | 506 |
| Parliamentary Question Database | 82 | 82 |
| Industry Updates (Ministry Data) | 6 | 6 |
| Budget Utilisation & Schemes | 1 | 1 |
| Total | 2,338 | 2,337 |

The excluded oversized bill is source ID
ae6b11152a923ed75a90ab94312db82eab0b984d, 2003-6-gaz.pdf, 5,387,224 characters.
The current script defaults to a 2,000,000-character cap. Do not raise it or
truncate the document silently. The 10,492 affidavits remain outside this pass.
Selected retrieval_excluded values are blank or False; blank integrity values
mean unknown, not verified good quality.

~/Downloads/ten-smallest is an initial smoke corpus, not ten additional unique
documents: its nine bills and one parliamentary question overlap this source
set. Its first document is a 93-character link stub; other tiny files include
corrigenda and noisy OCR. A successful embedding is not proof of substantive
document content. Expose such limitations in retrieval/reader behavior.

The workbook NIYANTRAN_Corrected_Function_Data_Architecture_2026-09-10.xlsx
defines 69 retained functions, excluding Local: 54 Multiple APIs, 3 Live API,
2 Local Pack, 2 Hybrid and 8 Developer Scraper. Read Me and Integration Contract
separate authoritative source acquisition, ownership and serving. The Source
Register gives provider/module endpoints, not a document-level URL join. The
workbook's dated endpoint tests do not establish current availability.

## Mapping rules

| Input | Destination | Rule |
| --- | --- | --- |
| OCR index id | documents.source_key | Stable exact source ID; no filename-derived replacement |
| current index markdown_path | documents.ocr_text | Exact decoded text; validate declared length/hash conventions |
| source_path feature | desk_feature | Explicit controlled mapping, preserving original source_path |
| source metadata | documents.metadata | Preserve provenance, licence, quality, dates and exclusions |
| unambiguous corpus file URL | file_url | Exact source evidence; no hub URL substitution |
| bill year + bill number | metadata.document_key | Existing bill:<year>:<number> convention, no fuzzy guess |
| original filename | file_name | Preserve even if a human title is available |

scripts/build-corpus-links.mjs derives basename matches from original dataset
records. Ambiguous conflicting links remain unresolved. scripts/ingest-national-
desk.mjs maps corpus metadata more narrowly than its export mode; replacing
metadata can drop provenance previously retained by the smoke ingest. Bill
document-key matches also need explicit collision handling, not arbitrary first
match. The broader workbook envelope is a future connector contract; do not
pretend all its fields already exist in documents or desk_rows.

## Completion definition and safe operation

Completion requires set reconciliation against the 2,337 eligible source IDs,
not a row-count threshold. Partition expected IDs into indexed, present but
unfinished, absent, and explicitly failed. Identify unexpected IDs separately.
Compare per-feature totals, current text hashes, chunker version, embedding
presence, chunk spans and final worker summary. A quiet timestamp alone may
mean failure, stall or completion. Use bounded reads, not repeated full scans.

The current worker remains the only ingestion writer. No competing bulk loads,
retries, deployments, migrations, index rebuilds or paid tests while it is
active. Read-only checks compare progress timestamps and counts. Investigate
stall evidence before recommending intervention; never automatically restart.
Once quiescent, any retry is limited to reconciled failed/missing source IDs
under a separate authorized execution step. Preserve the existing source files.

## Integrity repairs to specify before re-ingestion

1. Reused normalized-hash chunks must still store the exact current text span.
   The existing chunk_commit hash-hit path changes offsets but does not update
   content. A whitespace-only revision can therefore break reader highlighting.
   Preserve the chunk UUID and reusable embedding while updating exact content.
2. Retrieval must not serve chunks against a new document text revision before
   that revision has completed indexing. The current write sequence clears
   indexed_at, commits chunks and marks indexed separately; match_documents
   must exclude unfinished documents. Failed ingestion must not masquerade as
   ready. Test interruption between each write stage.
3. Preserve source metadata on unchanged-text re-ingestion with explicit field
   ownership. Verify raw text/hash conventions and actual character size before
   dispatch. No licence/freshness values invented from missing metadata.
4. Keep retries bounded, resume by source ID, distinguish HTTP failure from
   indexing completion, and report skipped oversized files explicitly.

## Acceptance, structure and exclusions

Scope: scripts/ingest-national-desk.mjs and its focused test; ingest-documents
handler/index tests; a new migration for chunk_commit/match_documents and SQL
regression tests. Split these into independent small tasks. Keep ADR-0004's
stable UUID contract; add a dated decision amendment if its semantics change.
Use existing JS/TS naming and dependency-injected test patterns.

Fixtures must cover whitespace-only revisions, metadata-only retries, duplicate
input, ambiguous URLs, partial failures, oversized source and exact reader spans.
Prove the guard fails on the old implementation in a disposable target. Run
`npm test`, `deno test -A --config supabase/functions/deno.json supabase/functions`,
`supabase test db` against the disposable local target, and `npm run build`.
No commands are run by this specification-writing task.

Excluded: affidavits, original PDF upload, public corpus publication, scraper
rollout, compute upgrades, payment changes and automatic URL fetching. Database
restarts were observed; memory pressure is a hypothesis, not a proven cause.

### Link metadata ownership clarification

Preserving sparse provenance must not preserve an obsolete citation join.
The mapper owns document_key, bill_number, bill_year, house, status and
file_url_source as one link-mapping unit. An explicit file_url_ambiguous=true
invalidates that unit; false with an authoritative replacement replaces it.
A changed document_key invalidates old companion fields. A sparse refresh
without explicit link state or changed identity preserves omissions. Unrelated
licence, source-host, quality and source-date metadata remain preserved.


### Live reconciliation update — 2026-09-21

A resumed read-only audit reconciled all 2,337 eligible source IDs and stored
content hashes against OCR_FILES.csv: no absent eligible IDs, unexpected IDs or
hash mismatches. 2,335 are indexed; 2006-93-Synop.pdf and 2006-16-gaz.pdf remain
unindexed with zero chunks. The oversized exclusion remains unchanged. No local
ingestion worker was running. This supersedes the earlier five-record retry
list; any later execution must recheck the exact two IDs immediately beforehand.

The live 51,057 chunks all have embeddings, nonblank content and valid ordered
span fields; a deterministic sample of 300 BMP-text chunks exactly matched the
stored source text. Full semantic relevance and signed-in citation navigation
remain launch acceptance gates. Live match_documents still lacks the locally
verified indexed_at guard; migrations 0012–0015 are not yet deployed.
(Corrected 2026-09-28: all four are applied to NTER, which now has all 31
repository migrations. The live `match_documents` is the
`20260922104646_match_documents_prefilter_and_quota` version, which keeps the
`indexed_at is not null` guard.)

Backfill assessment: 716 file URLs are missing and may only be populated from
unambiguous source evidence. All page_count columns are null despite populated
metadata.n_pages; validate the export semantics before proposing a metadata-only
backfill. Null chunk page_number is expected for document-span chunks and must
not be fabricated from a page count. Blank integrity metadata on 1,288 documents
means unknown quality. The audit does not authorize a live update or re-ingest.


Independent backfill assessment checked all eligible index rows and sidecars:
source n_pages is a positive integer from 1 to 210 with zero disagreements.
The archive derives it from total PDF pages; it is not a chunk-page map. The
foundation's existing null-until-pagewise contract therefore remains in effect
until an explicit semantic amendment, and no page-count write is proposed as an
automatic repair. Of 1,867 records carrying ocr_pages_with_text, 206 have fewer
text-bearing pages than total pages.

All eligible sidecars include source_host, licence_class, as_of and file_mtime,
which are absent from the live metadata-key inventory. C3 preserves them on
future ingestion but does not retroactively restore them. A separate metadata-only
backfill should match source ID plus expected content hash and preserve OCR,
chunks, embeddings and indexed_at. Preserve original labels/dates without claiming
licence permission, publication dates or freshness. OCR-quality heuristics exist
for 2,324 sidecars; integrity remains unknown for the same 1,288 records. Neither
sidecars nor the workbook supplies the 716 missing document URL joins.


A bounded read-only match_documents smoke check used one existing stored chunk
embedding per feature and scoped retrieval to that document. All five features
returned three chunks with nonblank content and ordered spans, all within the
requested document. This confirms the deployed retrieval RPC can return source
spans; it is a privileged SQL check using stored vectors, not a signed-in browser,
new natural-language query embedding, or semantic answer-quality evaluation.
No provider call or database write was made.


### Proposed bounded completion sequence (not executed)

1. Reconcile the current index, source hashes and worker state again immediately
   before an authorized production step. Latest recheck still shows 2,335 indexed
   documents and 51,057 chunks, last indexed at 2026-09-21T10:25:26.051Z.
2. Review/apply the local corpus integrity migration and deploy the reviewed
   provenance-preserving ingest handler before retrying. Do not apply unrelated
   security or research-turn migrations as an unreviewed bundle.
3. Retry only source IDs 1f7ffc739c73a91f3fb346698a07b8bd618c20fa and
   4dc99a9ba57d09577a0e7b0ac37651ed1bc3f0c8 if their current hashes still match
   the reconciled manifest and they remain unfinished. Process sequentially;
   verify indexed_at, chunks and exact spans after each. Do not run the bulk
   desk-row loader concurrently.
4. Prepare a separate metadata-only patch inventory matched by source ID plus
   expected content hash. Include exact old/new metadata and provenance only;
   reject changed hashes, duplicates or ambiguous joins. Preserve OCR text,
   document/chunk IDs, embeddings, offsets and indexed_at. Apply only after the
   inventory and execution are authorized. Verify those invariants afterward.
5. Keep 2003-6-gaz.pdf explicitly excluded at 5,387,224 characters under the
   existing 2,000,000-character limit. Retain the 716 unresolved file URLs,
   unknown integrity values and null page fields honestly. No inferred URL,
   quality score or chunk-page number is an acceptable completion shortcut.
6. Complete the separate signed-in retrieval/answer/reader citation scenarios
   after deployment. Structural spans and stored-vector RPC checks do not
   establish semantic relevance or production UI correctness.

This proposal does not authorize paid embeddings, migrations, backfill or
deployment. Source coverage is fully classified; successful indexing remains
incomplete until the two eligible records have succeeded or the owner explicitly
defers them.


The supervisor prepared a local, non-executable proposed inventory for the four
confirmed absent provenance fields. A fresh SELECT returned 2,337 unique source
keys, with all four prior values null/absent. Every source key and content hash
matched one current OCR index row; all sidecars supplied nonempty string values
for source_host, licence_class, as_of and file_mtime. This is 9,348 proposed field
restorations, without source URL, page, integrity or OCR-quality changes.

Review artifact: /private/tmp/niyantran-provenance-backfill-inventory.json; SHA-256
d37e2fd7accc4b4dca9769835e1aa5604bb90e0917e90cb4b0aa261f104b8ff4.
It records source-sidecar hashes, expected content hashes and prior values, exact
metadata patches, invariant preservation and recheck requirements. It is not an
update script and has not been executed. Rebuild/revalidate immediately before
any separately authorized production use; the original sidecars remain the
authoritative input rather than a temporary artifact.


### Empty columns resolved as by-design — 2026-09-21 (evening)

The owner asked whether the blank chunk metadata and page fields are a defect
needing a backfill. They are not. Each was traced through the code that writes
it, not judged from the nulls. Record this so a later agent does not "repair"
them.

| Column | State | Why |
| --- | --- | --- |
| `document_chunks.metadata` | `{}` on all 51,057 | `ingest-documents/handler.ts` `toCommitRow()` writes `metadata: {}` literally. Nothing reads it — not `match_documents`, not `_shared/citations.ts`, not the reader. A forward-compatibility slot. |
| `document_chunks.page_number` | null on all 51,057 | `chunkDocument()` builds one unit `{unitKey:'document', sourceKind:'document'}` with no page number. The field is plumbed chunker → `chunk_commit` → `match_documents` → `citations.ts:93` awaiting page-wise Markdown. The reader UI never reads it. |
| `documents.page_count` | null on all 2,337 | The foundation's null-until-pagewise contract. `metadata.n_pages` is populated on all 2,337 but is a **total PDF page count**, not a chunk-to-page map. |

No backfill is proposed for any of the three. Filling `page_number` from a
document page count would be a fabrication: a chunk is a character span that may
cross pages. Filling `page_count` would need an explicit ADR amendment and buys
nothing while citations are OCR-span based; the supervisor's decision is to
leave it null and revisit only when page-wise Markdown lands.

The only supported backfill remains the four absent provenance fields —
`source_host`, `licence_class`, `as_of`, `file_mtime` — present in every eligible
sidecar and absent from all 2,337 live documents, with its inventory already
prepared. The 716 missing `file_url` values and 1,288 unknown `integrity` values
cannot be recovered from any inspected input, including the function-architecture
workbook, whose Source Register maps functions to provider endpoints rather than
documents to file URLs. Unknown stays unknown.

### Finance Bill feasibility — earlier assessment corrected

The corpus-ingest first-pass plan records that 2006-16-gaz.pdf, "The Finance
Bill, 2006" (969,286 characters) "fails `chunk_commit` with a 503 on every
attempt — it is simply too heavy for this instance." Live evidence contradicts
the generalisation: **2011-8-gaz.pdf at 959,238 characters produced 741 chunks
and indexed successfully at 09:36:36 UTC** during the single-process `--batch 2`
pass. A document within one percent of the Finance Bill's size is therefore a
demonstrated-feasible workload for this instance when run alone.

The earlier failures occurred under two concurrent embedding shards and around
the database restarts, not under the gentle single-process conditions. The owner
has directed that it be retried as a single file. The supervisor concurs on this
evidence. Expect roughly 750-800 chunks.

Retry conditions: migration 0014 applied first (the deployed `match_documents`
still lacks the `indexed_at` guard); `ANALYZE` on `document_chunks` and
`desk_rows`, which have never been analyzed; one process, `--batch 1`, nothing
else touching the database, smallest record first; verify chunks, spans and
`indexed_at` after each; `ANALYZE` again afterwards. The dated plan's text is
historical and is not rewritten — this entry supersedes its current implication.

`scripts/ingest-national-desk.mjs` has no `--only <source_key>` option, so a
retry today re-posts all 1,742 eligible bill documents (~30 MB) and, because the
unchanged-text path refreshes title, URL and metadata, performs roughly 1,740
unnecessary `documents` updates. That would contaminate the prior-values evidence
in the provenance inventory and weaken the acceptance claim. Adding a bounded
`--only` option before the retry is proposed as its own scoped task.

### Provenance backfill executed — 2026-09-22

The four absent provenance fields are restored. **2,335 documents updated, 9,340
fields**; `source_host`, `licence_class`, `as_of` and `file_mtime` are now
present on 2,337 of 2,337. The two that already carried them were excluded, not
rewritten.

Rebuilt from the original sidecars rather than from the day-old inventory, as
this spec required. Of 12,830 `in_current_corpus` rows in `04_indexes/OCR_FILES.csv`:
0 missing sidecars, 0 sidecars whose `id` disagreed with the index row, 0 absent
fields, 0 blank values, 0 conflicting duplicate ids. Against the live set: 2,335
matched on `source_key` **and** on `left(metadata->>'text_sha256', 16)`, 0 failed
either, 0 malformed against format checks on all four values.

Method. Not through the ingest function: migration 0014 records that "the single
ingestion writer clears indexed_at with each text upsert", so routing a
metadata-only repair through it would have blanked `indexed_at` corpus-wide and
made retrieval return nothing. Instead the validated rows were staged into a
throwaway `public.provenance_backfill_staging` (RLS on, no policies, service_role
only) and applied as one statement, `metadata = metadata || jsonb_build_object(...)`,
guarded on both the source key and the content hash. Staging dropped afterwards;
`VACUUM (ANALYZE)` run; `n_dead_tup` back to 0.

Proof that nothing else moved, by fingerprints taken before and compared after:

| | |
| --- | --- |
| all non-metadata columns of `documents` (incl. `ocr_text` digest, `indexed_at`, `page_count`) | `3e1c9a5690416f112b25c3e70774922f` unchanged |
| `metadata` minus the four restored keys | `63d007d647c6724606b02ecb271c351d` unchanged |
| every `document_chunks.id` | `1a05c84c12c132403575d5e6329d3a13` unchanged |
| chunks / embedded / unindexed | 51,064 / 51,064 / 1 — unchanged |

Three documents were then checked end to end against their sidecar files on disk;
all four values matched exactly in each.

No script was added. `fromCorpusRow` already spreads the sidecar into the stored
metadata ("Sidecar supplies provenance; nonblank index fields own the current
revision", commit 1b71635), so a future corpus ingest re-supplies these fields.
The 2,335 rows were simply ingested before that fix landed. This was a one-time
repair, not a recurring job.

Still not recoverable, unchanged by this: the 716 missing `file_url` values and
1,288 unknown `integrity` values. Confirmed independently this time — the project
has zero storage buckets and zero storage objects, so the PDFs exist only on the
ingesting machine. `page_count`, `chunks.page_number` and `chunks.metadata` were
left alone per the by-design entry above.

### Finance Bill 2006 indexed; the commit is sliced — 2026-09-22

Done. 915 chunks, 915 embedded, 915 distinct hashes, spans covering 0..969,286
exactly — the whole OCR text, no gaps or duplicates — and `match_documents`
returns it. **Zero unindexed documents remain in the corpus** (51,979 chunks).

Two separate ceilings, found in this order.

**Memory.** `chunk_commit` took all 915 chunks in one call; each row carries its
content and a 1536-float embedding, so the argument was roughly 17 MB of jsonb.
It killed the postmaster — no "out of memory", no shutdown request, the process
vanished between checkpoints — and cost 2 min 38 s of downtime. Nothing was
written; the transaction rolled back whole. The fix is `COMMIT_BATCH = 100` in
`ingest-documents/handler.ts`, about 1.8 MB a call. No migration was needed:
the loop passes the **whole** keep list every time, and `chunk_commit`'s delete
is scoped by that list, so it is already idempotent under repeated calls. A
per-slice keep list would delete the slices the same loop had just committed.

**One invocation.** Slicing revealed this. Committing all 915 from scratch got
through seven slices — 700 chunks, Postgres untouched, uptime unbroken — and
then the invocation ended with a Cloudflare 520 at the client after about 104 s.
No matching gateway log entry was found, so that figure is the client's wall
clock rather than a logged limit. Roughly 700 chunks is what one invocation
manages on this instance.

**A 520 from this script is therefore not necessarily a failure.** Re-run the
same `--only` command. `indexed_at` is set only after the last slice, so a
partial document is never visible to readers, and `existingHashes` means the
retry re-embeds only what is missing: the resume cost $0.0018 against $0.0065
for a full pass, and took 37 s. This is asserted by a test, not relied on.

Supersedes the earlier "Finance Bill feasibility" entry, whose reasoning — 2011
at 959,238 characters succeeded, so 2006 at 969,286 should too — was wrong. The
binding number is chunks, not characters: 741 succeeded in one call, 915 did
not, and the 1% difference in characters hid a 23% difference in chunks. That
number was visible in the dry run before the crash and should have stopped it.

Still open: the bill above the 2,000,000-character ceiling is untouched. It
would now need `--max-chars` raised and several invocations, which the resume
path supports but nobody has tried.

### The oversized bill indexed; a truncation bug found — 2026-09-22

`2003-6-gaz`, "The Customs Tariff ... Bill, 2003" — 5,387,224 characters, 550
pages, the one document the 2,000,000-character ceiling had been skipping. Run
with `--max-chars 6000000`. It is now indexed: **2,240 chunks, 2,240 embedded,
2,240 distinct hashes, spans covering 0..5,387,224 exactly.** The corpus is
**2,338 documents, 54,219 chunks, none unindexed**. Postgres did not restart at
any point.

A prediction worth recording because it was wrong. From the Finance Bill's rate
(969,286 characters to 915 chunks) this looked like ~5,090 chunks needing ~157 s
of embedding, so it should have died before committing anything and made no
progress on any retry. The dry run said **2,240**. This document averages 2,405
characters a chunk against the Finance Bill's 1,059 — longer paragraphs, fewer
break points — so chunk count does not scale with characters and cannot be
estimated from another document. Commits also ran ~3.6 s per 100-chunk slice,
not the ~10 s inferred earlier.

The real limit has a name: **`IDLE_TIMEOUT`, 150 s**, returned as HTTP 504. The
earlier Cloudflare 520s were the same ceiling surfacing differently, so the
"~104 s" in the previous entry was the client's wall clock and is superseded.
Pass one committed 2,200 of 2,240 within that budget.

**The bug.** Pass two should have had 40 chunks left. It failed with
`WORKER_RESOURCE_LIMIT` having embedded nothing. `existingHashes` did an unpaged
PostgREST read, and PostgREST returns at most `db-max-rows` — 1000 here —
reporting the true total only in `Content-Range`, which supabase-js does not
surface unless a count is requested. Confirmed directly against the API:
`content-range: 0-999/2240`. So the function saw 1000 hashes, treated the other
1,240 as missing, and tried to re-embed all of them with nothing left to do.

"The Finance Bill, 2006" resumed cleanly the run before **only because its 915
chunks sit under the cap.** That was luck, not design. The bug predates the
slicing work but nothing could reach it: a document this size was skipped by
`--max-chars`, and one over 1000 chunks could not be committed at all. Slicing
is what made it reachable.

Fixed by paging with an explicit ordered range, stopping on a short page. Four
tests run against a fake that enforces the cap as the server does — past it,
under it, empty, and an exact multiple of it, that last being the boundary a
stop-on-empty loop gets wrong. Non-vacuous: the unpaged read fails four,
`length === 0` fails two. `index.ts` also gained the `if (import.meta.main)`
guard `research-chat` already had, so it can be imported without binding a port.

Commits: c51099a (slicing), 7115ffd (truncation). Both deployed.
