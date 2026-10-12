# Single existing-text corpus pilot

> **Status: Living.** Owner authorized exactly one live ingestion on 2026-10-09, following the interactive mapping walkthrough. Bulk ingestion remains unapproved.

Current state: live NTER contains two desk rows keyed `bill:2025:113`, and no document with that metadata key or source ID `d22d15a577d9b404a04dbf133b0f5385b3dbcb48`. Both local corpus and Citation Pack V1 contain the same extracted text. The actual four-page Sansad PDF and the existing Download PDF resolver agree with the proposed document identity and URL. Existing local chunker produces six chunks with valid character spans.

Problem: this bill has listing data but no indexed document text for scoped retrieval.

Outcome: use the unmodified `scripts/ingest-national-desk.mjs` manifest path and existing authenticated `ingest-documents` endpoint to add exactly one text-based document and six real embedded chunks. Preserve the source ID, title, PDF URL, and `metadata.document_key= bill:2025:113` with role `as_introduced`.

Acceptance evidence: authenticated dry run; one successful live result; matching stored text hash, URL and bill key; six nonempty embedded chunks with valid source spans; indexed timestamp; scoped retrieval returning the new document. Owner then checks signed-in bill drag/drop, answer citations and the Download PDF source. Owner acceptance is not inferred from SQL checks.

Scope: one production document, its chunks and normal embedding-call accounting. Durable local documentation under this spec, its plan and `docs/plans/open-work.md`; nonsecret receipts outside the checkout. No application code, migration, deployment, listing edit, page geometry, re-OCR, existing-document refresh or bulk operation.

Stop on an identity/hash mismatch, endpoint authentication failure, unexpected existing document, partial ingestion or unexpected chunk count. Investigate partial results before any retry. No deletion is authorized.
