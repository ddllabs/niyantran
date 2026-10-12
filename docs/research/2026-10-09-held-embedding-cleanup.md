# Owner-approved held embedding cleanup

> **Status: Historical (2026-10-09).** Actual cleanup after the first-stage run. Owner approved the proposed removal with “go”.

Removed exactly **61 document_chunks rows**, including their embedding vectors, belonging only to:

| Document | UUID | Rows deleted |
| --- | --- | ---: |
| Indian Institutes of Management (Amendment) Bill, 2025 | 1b801b87-c069-4545-8771-2681b566ea6d | 6 |
| Constitution (One Hundred and Thirtieth Amendment) Bill, 2025 | 0384f9b5-5b99-4798-827a-f45dffcc0fa2 | 11 |
| Constitution (One Hundred and Thirty-First Amendment) Bill, 2026 | 624ae9cb-f168-4667-be51-16239cff1191 | 44 |

One atomic SQL block locked the three exact document records, checked held status/source IDs/text hashes, required deletion count 61, and reset exactly three chunker statuses. Count or identity mismatch would roll the block back. Document records, original text/hash/length, source IDs, PDF URLs and mapping-hold metadata were retained. `indexed_at` remains null; `chunker_version` is now null. The latter prevents the existing ingestion handler's unchanged-text/version shortcut from skipping embedding regeneration after a corrected mapping.

Independent before/after verification: all three records remain, original source hashes/lengths and PDF URLs match, actual stored text SHA agrees, zero chunks and zero vectors remain, both status fields are null. ANALYZE refreshed documents/document_chunks. Current totals: **2,364 documents, 2,361 searchable documents, 54,803 chunks**. The stage's **20 searchable documents / 457 chunks** are unchanged. No paid provider call, re-ingestion, listing-key update, deployment or other deletion occurred.

Nonsecret before/after and operation receipt: `corpus-bulk-preparation/held-embedding-cleanup.json` in the thread evidence directory. Checkpoint phases are `held_without_embeddings`; original ingestion receipts and costs remain historical evidence. Re-ingest these documents only after their mappings are corrected and separately verified. The three mapping corrections and later corpus work remain tracked under R7/P14.

Documentation-only local changes on `task/corpus-single-pilot-20261009`; `git diff --check` passes. No application code changed in this cleanup. The prior code verification remains in the [stage execution record](2026-10-09-corpus-first-stage-run.md).
