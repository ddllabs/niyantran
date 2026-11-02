# Hybrid search and batch registration (bulk ingestion plan steps 4 and 8)

> **Status: Living (2026-11-02).** Implementation plan for steps 4 (hybrid search, §4.2) and 8 (set-based
> registration, §5.2) of the [bulk ingestion spec](../specs/2026-11-01-bulk-ingestion.md). Gated by the
> [retrieval baseline v2](../research/2026-11-01-retrieval-baseline-v2.md). Open work: F278.
> Owner decision 2026-11-02: National (packs v1.1 to v1.5) is finished first; the legal pack comes after.

## Current state

- Phase B (`task/chunk-partitions`, not on production): `document_chunks` partitioned by feature (NCLT, Bills,
  Regulatory, default), chunk facets, the documents access policy evaluated as a set. The two migrations ship
  together, policy first.
- Search is vector-only: `match_documents` (broad, focused, feature) and `match_documents_feature_hnsw`.
- Baseline feature-mode document hit@10: NCLT 51.8%, Bills 91.7%, Regulatory 90.0%, Parliamentary Questions
  91.7%. Exact vector search on NCLT reaches only 58.9%, so ranking, not the index, is NCLT's gap; most NCLT
  questions name the party or case, which keyword search should find.
- National documents are registered today by `ingest-documents` (one Edge Function request per batch of
  documents, upsert by `source_key`, chunk and embed in the same request). Law supplied text goes through
  `ingest_register_text`. Nothing rejects the same text under a different `source_key`.

## C1. Hybrid search (Sonnet builds, Opus reviews)

**Outcome.** A new RPC `match_documents_hybrid` with `match_documents`'s scoping (document ids, tier, feature) plus the
query text: keyword search and vector search run in the same scope and are fused by reciprocal rank fusion. The
current RPCs are unchanged; the app switches only after the eval passes (a later task).

- Keyword side: a GIN index on an expression `to_tsvector(<config>, content)` on `document_chunks` (the parent, so
  every partition gets its own), no stored column, so no table rewrite. `websearch_to_tsquery` on the question;
  candidates capped before ranking (`ts_rank_cd` cannot use the index).
- Text configuration chosen by measurement on a rehearsal copy: `simple` against `english` (case numbers, section
  numbers and bill titles favour `simple`; inflected prose favours `english`). Record both results.
- Vector side: the existing scoped path, halfvec cosine.
- Fusion: RRF with k = 60 by default, parameters recorded; the access check stays last on every row returned.
- Eval: `scripts/eval-retrieval.mjs` gains the hybrid RPC (it must pass the question text; the frozen vectors stay
  the vector input). Run on a rehearsal copy with Phase B applied, against the Phase B result: recall@10 no lower in
  any feature, p95 no worse beyond the gate's allowance. Report NCLT separately, with the bias note (questions that
  name the party favour keyword search).

Write scope: new `supabase/migrations/20261102120000_chunk_hybrid_search.sql`, new
`supabase/tests/chunk_hybrid_search.sql` and its `supabase/tests/run.sh` chain entry, `scripts/eval-retrieval.mjs`,
`src/lib/retrievalEval*`. Not `supabase/functions/` (the app switch is a separate task after the eval).

## C3. Set-based registration (Opus), design first

**Outcome.** One call registers a batch of documents with the same admission rules as today, rejects a text that is
already live under another `source_key`, and leaves chunking and embedding to the worker, so the bulk runner never
makes one request per document.

C3a (design, docs only): a short design note in `docs/research/` for the supervisor's review before any code:
- how National registration (today `ingest-documents`) and law registration (`ingest_register_text`) map onto one
  set-based RPC, or why they stay two;
- the admission rules carried over, by name (immutability, per-source lock, payload hash, F266 checks, listing rows);
- duplicate-text rejection: on `content_sha256` across keys, its behaviour for re-registration of the same key,
  and what happens to the 0 existing duplicate groups (none on 2026-11-02);
- how chunking and embedding move to the worker (queue, ledger, retries), and what stays synchronous;
- interfaces fixed for C1's and the runner's later work; the SQL authorization fixtures and vacuity checks needed.

C3b (implementation) is dispatched only after the design is accepted.

## Order and parallelism

- C1 and C3a run in parallel: disjoint write scopes (C3a writes one new research file).
- C1 is built on `task/chunk-partitions` and rebased onto its final state before review.
- Nothing here touches production. Every networked or paid step is the supervisor's.
