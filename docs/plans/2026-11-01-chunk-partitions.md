# Partitioned chunks, facets and backfill (bulk ingestion plan step 3)

> **Status: Living (2026-11-01).** Implementation plan for step 3 of the
> [bulk ingestion spec](../specs/2026-11-01-bulk-ingestion.md) §10, building §4.1 and §4.5. Gated by the
> [retrieval baseline v2](../research/2026-11-01-retrieval-baseline-v2.md). Open work: F278, F272.

## Current state (read-only on NTER, 2026-11-01)

- `document_chunks`: 392,945 chunks, 5,190 MB with indexes (table 459 MB). Primary key `(id)`; unique
  `(document_id, chunk_hash)`; foreign key to `documents` on delete cascade; check on `source_kind`; indexes
  `document_chunks_document_order (document_id, chunk_index)` and the HNSW index on `embedding::halfvec(1536)`.
  No triggers, no views, no publication, and no foreign key points at it.
- Policies: `document_chunks_read` (permissive) and `law_chunks_serving` (restrictive), both `SELECT` to
  `authenticated`.
- Every chunk write goes through `chunk_commit` (latest in `20261001120000_page_contract.sql`; confirm no later
  definition). Application code otherwise reads chunks by `document_id` or `id` (`ingest-worker`,
  `ingest-documents`, `research-chat`, `src/ai/SourceReader.jsx`).
- Functions whose bodies name `document_chunks`: `chunk_commit`, `match_documents`, `match_documents_feature_hnsw`,
  `admin_readiness_document`, `ingest_text_activate_unmapped`, `record_mapping_fingerprint`,
  `record_resolve_document_keys`.
- `documents.desk_feature` and `desk_tier` are nullable text; today every document has both. Six features; only
  NCLT (225,273 chunks) passes the spec's 100,000-chunk partition threshold.
- `documents` triggers: `documents_updated_at`, `law_indexed_publication`, `protect_supplied_text`.
- Baseline (replica): feature-mode document hit@10 NCLT 51.8%, Bills 91.7%, Regulatory 90.0%, Parliamentary
  Questions 91.7%. Exact search on NCLT reaches 58.9% (33 of 56), so partitioning can recover at most about 4 NCLT
  questions; hybrid search and headers (steps 4 and 5) are the larger levers.

## Outcome

1. `document_chunks` is list-partitioned on a chunk column `desk_feature`: one partition for NCLT, a default
   partition for the rest, each with its own HNSW index. Code still names one table.
2. Facet columns on chunks, typed and indexed, filled from the document: `desk_tier`, `desk_feature` (the partition
   key), `doc_date` (NCLT `order_date`, Bills `introduced_on`, Parliamentary Questions `answered_on` parsed from
   D/M/Y; null elsewhere) and `language`. Further facets are added when a collection supplies them (nullable columns
   on a partitioned table are cheap to add). A trigger on `documents` keeps the chunk copies equal, and a change of
   feature moves the chunks.
3. Search RPCs scope by the chunk's own `desk_feature`, so a feature search reads only its partition (or the default
   partition with an in-walk filter, `hnsw.iterative_scan`). The access check stays last. F272's recovery bound no
   longer applies to a feature with its own partition.
4. The backfill copies the existing chunks with their vectors unchanged, side by side, then swaps; no embedding call.
5. Rehearsed on a copy of the replica: migration time per phase, peak disk, lock time at the swap, and the eval
   rerun with `--compare` against the baseline (exit 0 required).

## Design constraints the build must respect

- A partitioned table's unique keys must include the partition key: the primary key becomes `(id, desk_feature)` and
  the unique key `(document_id, chunk_hash, desk_feature)`. Every chunk of a document shares its feature, so the old
  uniqueness still holds; prove it in a fixture.
- Tuple routing happens before row triggers, and a `BEFORE` trigger may not move a row to another partition. So the
  writer (`chunk_commit`) sets `desk_feature` from the document; a trigger may fill the other facets.
- Querying a partition directly bypasses the parent's policies. No role but the owner and `service_role` gets any
  privilege on the partitions.
- Supabase applies a migration in one transaction, so no `CONCURRENTLY`. The side-by-side copy, index builds and the
  swap must be ordered so search keeps working until the swap, and chunks written during the copy are not lost
  (either a stated ingestion freeze for the window, or a catch-up step inside the swap).
- The migration must be re-runnable on a disposable database from scratch (`npm run test:sql` builds every database
  from the migrations) and on the replica.

## Tasks

| Task | Model | Write scope | Depends on | Verification |
|---|---|---|---|---|
| B1. Migration: partitioned table, facets, sync trigger, `chunk_commit` and every function above updated, search RPCs scoped by partition with iterative scan, grants. SQL fixture for partitions and facets (with its vacuity check); existing fixtures still pass | Opus | new `supabase/migrations/20261101120000_document_chunks_partitioned.sql`; new `supabase/tests/document_chunks_partitions.sql`; existing `supabase/tests/*.sql` only where a fixture must change for the new keys (each change justified) | none | `npm run test:sql` (all fixtures, no VACUITY FAIL); `npm test`; `npm run lint`; Deno tests |
| B2. Rehearsal tooling: run the eval against a named replica database, and a script that copies the replica (`createdb -T`), applies the B1 migration to the copy, and records phase timings, peak size and swap lock time | Sonnet | `scripts/eval-replica/`, `scripts/eval-retrieval.mjs` (a `--database` option), `src/lib/retrievalEval*` only if needed | B1's migration file name | unit tests; `npm run lint`; a dry run on a small copy |
| B3. Rehearsal and eval rerun on the replica copy; report | supervisor | `eval/retrieval/results/`, `docs/research/` | B1, B2 | `--compare` exit 0, every feature no worse; timings recorded |
| B4. Phase-gate review of B1–B3 | Fable | none (report only) | B3 | review notes |
| B5. Production apply | supervisor | none | B4 and the developer's explicit authorization of this migration | read-only checks before and after; eval rerun |

- B1 and B2 run in parallel in separate worktrees: their write scopes are disjoint, and the only shared interface
  is B1's migration file name, which B2 takes as an argument.
- B5 also needs a disk check first: the side-by-side copy roughly doubles the chunk table and its indexes for the
  window. If NTER would need a larger disk or instance, that is a billing change and stops for approval.
- Task agents never read `.env.local`, call NTER or any paid API, or commit.

## Exclusions

- No hybrid search, headers or re-embedding (steps 4 and 5). No change to registration or admission. No production
  change before B5's authorization.
- Sub-partitioning NCLT, and partitions for features below 100,000 chunks, are measured options for later, not part
  of B1.
