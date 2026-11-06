# Retrieval evaluation

- Set: set.jsonl
- Commit: 07144f86
- Migration version: match_documents_feature_hnsw@20261027185840_feature_search_recovery.sql; match_documents@20261015130000_unscoped_ef_search.sql (replica copied 2026-11-01T11:42:56.68002+00:00)
- Database: niyantran_rehearsal_c2mixed
- Corpus fingerprint: 17603 documents, 392876 chunks, latest indexed_at 2026-10-31T20:25:01.298011+00:00
- Cost: $0.0000 (0 embedding tokens)

Ranking is the row order returned by match_documents. Bar figures exclude ambiguous and owner questions.
Developer-written questions are left out of those figures and tabulated, and judged, on their own rows.

## Mode: broad

| Scope | n | Ambiguous excluded | Doc@5 | Doc@10 | Doc@40 | Key@5 | Key@10 | Key@40 | Chunk@5 | Chunk@10 | Chunk@40 | Doc MRR@40 | Chunk MRR@40 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Overall | 0 | 0 | 0/0 (0.0%) | 0/0 (0.0%) | 0/0 (0.0%) | 0/0 (0.0%) | 0/0 (0.0%) | 0/0 (0.0%) | 0/0 (0.0%) | 0/0 (0.0%) | 0/0 (0.0%) | 0.000 | 0.000 |
| Developer: Overall | 1 | 0 | 0/1 (0.0%) | 0/1 (0.0%) | 0/1 (0.0%) | 0/1 (0.0%) | 0/1 (0.0%) | 0/1 (0.0%) | 0/0 (0.0%) | 0/0 (0.0%) | 0/0 (0.0%) | 0.000 | 0.000 |
| Developer: NCLT / NCLAT (Insolvency) | 1 | 0 | 0/1 (0.0%) | 0/1 (0.0%) | 0/1 (0.0%) | 0/1 (0.0%) | 0/1 (0.0%) | 0/1 (0.0%) | 0/0 (0.0%) | 0/0 (0.0%) | 0/0 (0.0%) | 0.000 | 0.000 |

## Latency

- broad: RPC p50 143.3 ms, p95 143.3 ms (1 calls); network baseline p50 78.8 ms, p95 78.8 ms; mean response 57234 bytes
