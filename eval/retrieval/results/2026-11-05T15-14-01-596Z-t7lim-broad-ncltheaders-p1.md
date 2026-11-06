# Retrieval evaluation

- Set: questions.v2.jsonl
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
| Overall | 251 | 12 | 203/251 (80.9%) | 218/251 (86.9%) | 230/251 (91.6%) | 205/251 (81.7%) | 221/251 (88.0%) | 230/251 (91.6%) | 163/251 (64.9%) | 185/251 (73.7%) | 220/251 (87.6%) | 0.668 | 0.489 |
| NCLT / NCLAT (Insolvency) | 56 | 2 | 41/56 (73.2%) | 44/56 (78.6%) | 46/56 (82.1%) | 41/56 (73.2%) | 44/56 (78.6%) | 46/56 (82.1%) | 32/56 (57.1%) | 41/56 (73.2%) | 45/56 (80.4%) | 0.686 | 0.470 |
| Bill Passage Probability Index | 60 | 8 | 50/60 (83.3%) | 53/60 (88.3%) | 57/60 (95.0%) | 52/60 (86.7%) | 56/60 (93.3%) | 57/60 (95.0%) | 35/60 (58.3%) | 39/60 (65.0%) | 52/60 (86.7%) | 0.617 | 0.402 |
| Regulatory Body Watch (RBI SEBI TRAI CCI) | 60 | 0 | 51/60 (85.0%) | 53/60 (88.3%) | 57/60 (95.0%) | 51/60 (85.0%) | 53/60 (88.3%) | 57/60 (95.0%) | 44/60 (73.3%) | 46/60 (76.7%) | 55/60 (91.7%) | 0.625 | 0.489 |
| Parliamentary Question Database | 60 | 2 | 46/60 (76.7%) | 53/60 (88.3%) | 55/60 (91.7%) | 46/60 (76.7%) | 53/60 (88.3%) | 55/60 (91.7%) | 38/60 (63.3%) | 44/60 (73.3%) | 53/60 (88.3%) | 0.661 | 0.555 |
| Industry Updates (Ministry Data) | 12 | 0 | 12/12 (100.0%) | 12/12 (100.0%) | 12/12 (100.0%) | 12/12 (100.0%) | 12/12 (100.0%) | 12/12 (100.0%) | 11/12 (91.7%) | 12/12 (100.0%) | 12/12 (100.0%) | 1.000 | 0.594 |
| Budget Utilisation & Schemes | 3 | 0 | 3/3 (100.0%) | 3/3 (100.0%) | 3/3 (100.0%) | 3/3 (100.0%) | 3/3 (100.0%) | 3/3 (100.0%) | 3/3 (100.0%) | 3/3 (100.0%) | 3/3 (100.0%) | 1.000 | 0.833 |
| Overall incl. ambiguous | 263 | — | 211/263 (80.2%) | 228/263 (86.7%) | 241/263 (91.6%) | 213/263 (81.0%) | 231/263 (87.8%) | 241/263 (91.6%) | 166/263 (63.1%) | 191/263 (72.6%) | 229/263 (87.1%) | 0.652 | 0.472 |
| Developer: Overall | 54 | 0 | 49/54 (90.7%) | 51/54 (94.4%) | 53/54 (98.1%) | 49/54 (90.7%) | 51/54 (94.4%) | 53/54 (98.1%) | 0/0 (0.0%) | 0/0 (0.0%) | 0/0 (0.0%) | 0.886 | 0.000 |
| Developer: NCLT / NCLAT (Insolvency) | 14 | 0 | 11/14 (78.6%) | 11/14 (78.6%) | 13/14 (92.9%) | 11/14 (78.6%) | 11/14 (78.6%) | 13/14 (92.9%) | 0/0 (0.0%) | 0/0 (0.0%) | 0/0 (0.0%) | 0.756 | 0.000 |
| Developer: Bill Passage Probability Index | 13 | 0 | 11/13 (84.6%) | 13/13 (100.0%) | 13/13 (100.0%) | 11/13 (84.6%) | 13/13 (100.0%) | 13/13 (100.0%) | 0/0 (0.0%) | 0/0 (0.0%) | 0/0 (0.0%) | 0.868 | 0.000 |
| Developer: Regulatory Body Watch (RBI SEBI TRAI CCI) | 14 | 0 | 14/14 (100.0%) | 14/14 (100.0%) | 14/14 (100.0%) | 14/14 (100.0%) | 14/14 (100.0%) | 14/14 (100.0%) | 0/0 (0.0%) | 0/0 (0.0%) | 0/0 (0.0%) | 0.929 | 0.000 |
| Developer: Parliamentary Question Database | 13 | 0 | 13/13 (100.0%) | 13/13 (100.0%) | 13/13 (100.0%) | 13/13 (100.0%) | 13/13 (100.0%) | 13/13 (100.0%) | 0/0 (0.0%) | 0/0 (0.0%) | 0/0 (0.0%) | 1.000 | 0.000 |

## Latency

- broad: RPC p50 1123.1 ms, p95 3906.7 ms (317 calls); network baseline p50 121.8 ms, p95 313.2 ms; mean response 57322 bytes
