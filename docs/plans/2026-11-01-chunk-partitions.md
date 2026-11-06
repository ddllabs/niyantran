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
   partition with an in-walk filter, `hnsw.iterative_scan`). The access check stays last. Partitioning removes the main
   cause of F272's short walks; the recovery bound itself stays in the helper.
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

## B3 result and the broad-search exception (2026-11-03)

Rehearsals on copies of the replica (results in `eval/retrieval/results/`):
- The two migrations ship together, policy first: the policy migration alone makes feature search on the
  unpartitioned table slower (its feature-size count changed plan), so it is never applied alone.
- Four partitions (NCLT, Bills, Regulatory, default; developer decision 2026-11-02, National first). Swap 12 to
  28 ms; row counts equal; reader waits during the build come from load, not locks.
- Clean gate run (idle machine, both copies prewarmed; `*baseline-v2-b5*` against `*b5-four-partitions*`):
  recall identical in every feature (0 lost questions); feature search p50 773 to 646 ms and p95 3,671 to
  1,462 ms; focused 62 to 86 ms p50; broad search p50 292 to 625 ms and p95 513 to 971 ms, which fails the
  spec's "p95 no worse" bar.
- Cause (B1, measured): a broad search walks four HNSW graphs, touching about 3.7 times the index pages of one
  graph at equal recall (10,758 against 2,935 buffers per query), although the four indexes total the same size.
  Warm, that is about 70 against 24 ms; when the indexes don't fit in memory (this machine: 4 GB for Docker,
  512 MB shared buffers; production: 2 GB RAM), the extra pages are cache misses. A per-row access check in the
  broad path (`work_mem` 256 kB, set and restored inside `match_documents`) cut a warm query from 74 to 15 ms
  and is kept; it does not close the cold-cache gap.
- Usage (NTER, read-only, 2026-11-03): 182 of 185 conversations started from a desk (feature scope); 3 used
  broad search.

**Exception (developer, 2026-11-03):** broad-search latency is accepted as a recorded exception to the §4.4 gate:
feature-scoped search, 98% of real use, is much faster; recall is unchanged everywhere. Recheck broad latency
after any instance upgrade, and before the National bulk load.

**Final files, gate rerun (2026-11-03, `*b7-final*`).** The rehearsed final files (`niyantran_rehearsal_b6final`,
document-id pruning included) on an idle machine; the same-day baselines (`*baseline-v2-b6*`, `*baseline-v2-b7*`)
ran under load (network round trip p50 105 to 160 ms against about 60 ms clean) and are not used; the comparison is
with the clean `*baseline-v2-b5*` on the same replica, same functions:
- Recall identical in every feature and mode (0 lost questions, as in every earlier run).
- Feature search p50 773 to 656 ms, p95 3,671 to 1,599 ms.
- Broad search p50 292 to 797 ms. Calls 227 to 239 took 4 to 32 s while the plain round trip took up to 5 s (a
  machine stall, not the query); outside them two calls took 4.3 and 5.5 s.
- Focused search p50 62 to 80 ms, p95 95 to 159 ms (the bar allows 134 ms). The document-id pruning did not change
  it: the run before it measured 156 ms.

**Exception extended (developer, 2026-11-03):** focused-search latency is accepted with broad search, on condition
that broad and focused search are measured on NTER (read-only, the same queries) right before and right after the
apply, and the paired rollback is run if production is clearly worse. NTER now has 8 GB RAM and 2 GB shared buffers
against this machine's 512 MB, which is expected to narrow both gaps; that expectation is what the production
measurement checks.

**Build memory (2026-11-03).** With the upgrade, the migration's TUNABLE `maintenance_work_mem` is 1GB (was 256MB).
The final pair (sha256 `77ddc136…` then `295f9ebc…`) was rehearsed back to back: 46 min 44 s and 227 ms
(`*rehearsal-b9part*`, `*rehearsal-b9final*`); an earlier run of the same partition file took 24 min 17 s
(`*rehearsal-b8part*`); the swap held its lock 20 to 21 ms; 392,945 rows verified each time. Apply:
[runbook](../operations/2026-11-03-phase-b-apply.md).

**B5, production apply (2026-11-03).** Both files applied to NTER with psql and exit 0, as the runbook says (the
partition migration took about 7 min 27 s); 395,375 rows verified; history rows written by hand (F283). The
before-and-after measurement on NTER (315 questions; two were excluded because the F281 repairs changed their gold
chunks) is no worse in every mode, with no question lost. Broad p95 went from 1,516 to 1,368 ms, focused from
677 to 641 ms and feature from 812 to 762 ms. Document hit@10 rose slightly: broad 196 to 199 of 249, feature 205 to
206. So the broad and focused exceptions above were not needed on production. Figures, checks and a
correction to two comments in the applied file are in the runbook's log. `document_chunks_unpartitioned` (5.3 GB)
stays for the rollback until an agreed drop.

## Exclusions

- No hybrid search, headers or re-embedding (steps 4 and 5). No change to registration or admission. No production
  change before B5's authorization.
- Sub-partitioning NCLT, and partitions for features below 100,000 chunks, are measured options for later, not part
  of B1.
