# Retrieval evaluation

- Set: set.jsonl
- Commit: 07144f86
- Migration version: match_documents_feature_hnsw@20261027185840_feature_search_recovery.sql; match_documents@20261015130000_unscoped_ef_search.sql (replica copied 2026-11-01T11:42:56.68002+00:00)
- Database: niyantran_rehearsal_c2hybrid
- Corpus fingerprint: 17603 documents, 392876 chunks, latest indexed_at 2026-10-31T20:25:01.298011+00:00
- Cost: $0.0000 (0 embedding tokens)

Ranking is the row order returned by match_documents. Bar figures exclude ambiguous and owner questions.
Developer-written questions are left out of those figures and tabulated, and judged, on their own rows.

## Mode: feature

| Scope | n | Ambiguous excluded | Doc@5 | Doc@10 | Doc@40 | Key@5 | Key@10 | Key@40 | Chunk@5 | Chunk@10 | Chunk@40 | Doc MRR@40 | Chunk MRR@40 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Overall | 0 | 0 | 0/0 (0.0%) | 0/0 (0.0%) | 0/0 (0.0%) | 0/0 (0.0%) | 0/0 (0.0%) | 0/0 (0.0%) | 0/0 (0.0%) | 0/0 (0.0%) | 0/0 (0.0%) | 0.000 | 0.000 |
| Developer: Overall | 17 | 0 | 11/17 (64.7%) | 12/17 (70.6%) | 14/17 (82.4%) | 11/17 (64.7%) | 12/17 (70.6%) | 14/17 (82.4%) | 0/0 (0.0%) | 0/0 (0.0%) | 0/0 (0.0%) | 0.489 | 0.000 |
| Developer: NCLT / NCLAT (Insolvency) | 12 | 0 | 6/12 (50.0%) | 7/12 (58.3%) | 9/12 (75.0%) | 6/12 (50.0%) | 7/12 (58.3%) | 9/12 (75.0%) | 0/0 (0.0%) | 0/0 (0.0%) | 0/0 (0.0%) | 0.398 | 0.000 |
| Developer: Bill Passage Probability Index | 1 | 0 | 1/1 (100.0%) | 1/1 (100.0%) | 1/1 (100.0%) | 1/1 (100.0%) | 1/1 (100.0%) | 1/1 (100.0%) | 0/0 (0.0%) | 0/0 (0.0%) | 0/0 (0.0%) | 0.200 | 0.000 |
| Developer: Regulatory Body Watch (RBI SEBI TRAI CCI) | 1 | 0 | 1/1 (100.0%) | 1/1 (100.0%) | 1/1 (100.0%) | 1/1 (100.0%) | 1/1 (100.0%) | 1/1 (100.0%) | 0/0 (0.0%) | 0/0 (0.0%) | 0/0 (0.0%) | 0.333 | 0.000 |
| Developer: Parliamentary Question Database | 3 | 0 | 3/3 (100.0%) | 3/3 (100.0%) | 3/3 (100.0%) | 3/3 (100.0%) | 3/3 (100.0%) | 3/3 (100.0%) | 0/0 (0.0%) | 0/0 (0.0%) | 0/0 (0.0%) | 1.000 | 0.000 |

## Latency

- feature: RPC p50 1343 ms, p95 1686.8 ms (17 calls); network baseline p50 75.1 ms, p95 95.3 ms; mean response 58696 bytes
