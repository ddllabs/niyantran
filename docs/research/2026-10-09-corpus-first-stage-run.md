# Corpus first-stage execution

> **Status: Historical (2026-10-09).** Actual live execution and correction record. Owner authorized the frozen 23-document stage. Later corpus expansion and owner acceptance of this stage remain pending.

## Final state

All **23 documents / 518 chunks** were ingested once, with real embeddings. Normal provider accounting reports **117,134 tokens / USD 0.00234268**. No transport/provider/per-document ingestion errors were returned. After the final bill-level join check, **three documents were put on hold**, leaving **20 searchable documents / 457 searchable chunks** from this stage. The three retain their exact text and 61 embeddings, but `indexed_at=null` excludes them from all `match_documents` branches and bill-key resolution. No text, chunks or existing documents were deleted or re-OCRed.

Global final totals: **2,364 documents, 2,361 searchable documents, 54,864 stored chunks**; **1,257** current bill keys have indexed documents (baseline 1,238, net +19). The initial ingestion raised coverage to 1,260, then the three holds removed three keys. Global stored chunk count includes held chunks.

## Mapping issue caught at the final join check

The preflight verified an exact intended listing, PDF URL and PDF bill identity, but initially failed to reject a second distinct listing title under the same existing bill key. The final join returned 52 listing associations rather than the ordinary 46 for two features, which exposed these collisions:

| Shared key | New document now held | Other current listing title |
| --- | --- | --- |
| bill:2025:109 | Indian Institutes of Management (Amendment) Bill, 2025 | Waqf (Amendment) Bill, 2025 |
| bill:2025:111 | Constitution (One Hundred and Thirtieth Amendment) Bill, 2025 | Bills of Lading Bill, 2025 |
| bill:2026:107 | Constitution (One Hundred and Thirty-First Amendment) Bill, 2026 | Insolvency and Bankruptcy Code (Amendment) Bill, 2026 |

Held IDs respectively: `1b801b87-c069-4545-8771-2681b566ea6d`, `0384f9b5-5b99-4798-827a-f45dffcc0fa2`, `624ae9cb-f168-4667-be51-16239cff1191`. Their source IDs and receipts are in the frozen stage evidence. Their metadata includes the hold reason and previous indexed timestamp. This is the known P14 bill-key issue observed concretely; it is distinct from the Download PDF resolver's missing-year fallback. No listing-key or resolver fix was performed.

The runner now rejects any bill key whose current rows contain multiple distinct normalized title/chamber identities **before ingestion**. A failing test reproduced the missing guard; the guard then made it pass. It also blocks automatic retry of these held/partial records. The owner's task authorization covered correcting the just-ingested records by holding their search eligibility; no broad correction or deletion was performed. An initial connector UPDATE returned an invalid/expired request-state error, so the authenticated REST path first read current state and then applied/verifed the three exact guarded holds.

## Executed verification

- Frozen manifest cardinality: 23, expected chunks 518. All original source hashes and evidence checksums matched.
- Current listing/PDF preflight and all 23 authenticated dry runs succeeded before the live stage.
- One source per request, one worker. Checkpoint saved before each live request and after its result and verification. Resume skips only previously checkpointed, fully verified sources; unexpected existing or partial sources stop the job.
- Per-source REST verification proved exact stored text/hash, key/URL, real 1,536-dimensional nonzero finite embeddings, unique hashes and exact UTF-16 citation slices before the next source.
- Independent SQL before holds: 23 correct source hashes, 518 embeddings, 518 exact text spans and retrieval of every document UUID. After holds: 20 searchable stage documents / 20 retrieved; all three held document scopes return **zero results**. Self-vector checks prove retrieval plumbing, not semantic answer quality or owner browser acceptance.
- ANALYZE document_chunks and documents ran after the stage; planner row counts matched 54,864 / 2,364. No server restart: postmaster remained at 2026-09-28.
- Halfvec HNSW index: 214,515,712 → 216,637,440 bytes, +2,121,728 bytes (~2.02 MiB), now ~206.6 MiB versus 512 MiB shared buffers. Held chunks still occupy index space.
- Single post-stage EXPLAIN ANALYZE probes: scoped 4.550 ms, broad 14.815 ms server execution. These are one warm sample, excluding network/model time, not p95, cold-cache capacity evidence or a before/after latency comparison.

## Local implementation and gates

Added `scripts/corpus-stage-job.mjs` and `scripts/corpus-stage-job.test.mjs`. No UI, server/router, Edge Function, schema, existing ingestion handler, production deployment, push or merge changed. Source and documentation remain on `task/corpus-single-pilot-20261009`.

`node --test scripts/corpus-stage-job.test.mjs`: 11 pass. Initial guardless implementation failed all nine initial guard/resume cases; citation offset and key-collision tests were separately proven red before their guards. `npm test`: 184 files / 2,465 tests pass. `npm run lint`: pass. `npm run build`: pass with the existing >500 kB bundle warning. No standalone type-check is defined. Deno/SQL fixture suites were not run: this change is isolated Node tooling, with no src/lib, src/admin, Supabase, API or server edits.

Evidence lives in the thread's `corpus-bulk-preparation` directory: frozen inventory/manifest/text/checksums, checkpoint with 20 verified / 3 held phases, stage receipts/costs, initial PDF preflight, and independent SQL verification. Later stages are not authorized. Resolve the listing resolver and bill-key collisions, then prepare a new unambiguous scope; owner browser RAG acceptance of the 20 is still pending.
