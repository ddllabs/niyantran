# Retrieval evaluation

- Set: questions.v2.jsonl
- Commit: 07144f86
- Migration version: match_documents_feature_hnsw@20261027185840_feature_search_recovery.sql; match_documents@20261015130000_unscoped_ef_search.sql (replica copied 2026-11-01T11:42:56.68002+00:00)
- Database: niyantran_rehearsal_c2mixed
- Corpus fingerprint: 17603 documents, 392876 chunks, latest indexed_at 2026-10-31T20:25:01.298011+00:00
- Cost: $0.0000 (0 embedding tokens)

Ranking is the row order returned by match_documents. Bar figures exclude ambiguous and owner questions.
Developer-written questions are left out of those figures and tabulated, and judged, on their own rows.

## Mode: feature

| Scope | n | Ambiguous excluded | Doc@5 | Doc@10 | Doc@40 | Key@5 | Key@10 | Key@40 | Chunk@5 | Chunk@10 | Chunk@40 | Doc MRR@40 | Chunk MRR@40 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Overall | 251 | 12 | 194/251 (77.3%) | 209/251 (83.3%) | 219/251 (87.3%) | 196/251 (78.1%) | 212/251 (84.5%) | 219/251 (87.3%) | 149/251 (59.4%) | 169/251 (67.3%) | 208/251 (82.9%) | 0.629 | 0.438 |
| NCLT / NCLAT (Insolvency) | 56 | 2 | 35/56 (62.5%) | 38/56 (67.9%) | 39/56 (69.6%) | 35/56 (62.5%) | 38/56 (67.9%) | 39/56 (69.6%) | 22/56 (39.3%) | 28/56 (50.0%) | 38/56 (67.9%) | 0.549 | 0.282 |
| Bill Passage Probability Index | 60 | 8 | 49/60 (81.7%) | 53/60 (88.3%) | 57/60 (95.0%) | 51/60 (85.0%) | 56/60 (93.3%) | 57/60 (95.0%) | 34/60 (56.7%) | 38/60 (63.3%) | 51/60 (85.0%) | 0.628 | 0.407 |
| Regulatory Body Watch (RBI SEBI TRAI CCI) | 60 | 0 | 48/60 (80.0%) | 51/60 (85.0%) | 54/60 (90.0%) | 48/60 (80.0%) | 51/60 (85.0%) | 54/60 (90.0%) | 41/60 (68.3%) | 43/60 (71.7%) | 52/60 (86.7%) | 0.577 | 0.441 |
| Parliamentary Question Database | 60 | 2 | 47/60 (78.3%) | 52/60 (86.7%) | 54/60 (90.0%) | 47/60 (78.3%) | 52/60 (86.7%) | 54/60 (90.0%) | 38/60 (63.3%) | 45/60 (75.0%) | 52/60 (86.7%) | 0.663 | 0.556 |
| Industry Updates (Ministry Data) | 12 | 0 | 12/12 (100.0%) | 12/12 (100.0%) | 12/12 (100.0%) | 12/12 (100.0%) | 12/12 (100.0%) | 12/12 (100.0%) | 11/12 (91.7%) | 12/12 (100.0%) | 12/12 (100.0%) | 1.000 | 0.607 |
| Budget Utilisation & Schemes | 3 | 0 | 3/3 (100.0%) | 3/3 (100.0%) | 3/3 (100.0%) | 3/3 (100.0%) | 3/3 (100.0%) | 3/3 (100.0%) | 3/3 (100.0%) | 3/3 (100.0%) | 3/3 (100.0%) | 1.000 | 0.833 |
| Overall incl. ambiguous | 263 | — | 202/263 (76.8%) | 219/263 (83.3%) | 230/263 (87.5%) | 204/263 (77.6%) | 222/263 (84.4%) | 230/263 (87.5%) | 152/263 (57.8%) | 175/263 (66.5%) | 217/263 (82.5%) | 0.615 | 0.423 |
| Developer: Overall | 54 | 0 | 48/54 (88.9%) | 51/54 (94.4%) | 51/54 (94.4%) | 48/54 (88.9%) | 51/54 (94.4%) | 51/54 (94.4%) | 0/0 (0.0%) | 0/0 (0.0%) | 0/0 (0.0%) | 0.869 | 0.000 |
| Developer: NCLT / NCLAT (Insolvency) | 14 | 0 | 10/14 (71.4%) | 11/14 (78.6%) | 11/14 (78.6%) | 10/14 (71.4%) | 11/14 (78.6%) | 11/14 (78.6%) | 0/0 (0.0%) | 0/0 (0.0%) | 0/0 (0.0%) | 0.688 | 0.000 |
| Developer: Bill Passage Probability Index | 13 | 0 | 11/13 (84.6%) | 13/13 (100.0%) | 13/13 (100.0%) | 11/13 (84.6%) | 13/13 (100.0%) | 13/13 (100.0%) | 0/0 (0.0%) | 0/0 (0.0%) | 0/0 (0.0%) | 0.868 | 0.000 |
| Developer: Regulatory Body Watch (RBI SEBI TRAI CCI) | 14 | 0 | 14/14 (100.0%) | 14/14 (100.0%) | 14/14 (100.0%) | 14/14 (100.0%) | 14/14 (100.0%) | 14/14 (100.0%) | 0/0 (0.0%) | 0/0 (0.0%) | 0/0 (0.0%) | 0.929 | 0.000 |
| Developer: Parliamentary Question Database | 13 | 0 | 13/13 (100.0%) | 13/13 (100.0%) | 13/13 (100.0%) | 13/13 (100.0%) | 13/13 (100.0%) | 13/13 (100.0%) | 0/0 (0.0%) | 0/0 (0.0%) | 0/0 (0.0%) | 1.000 | 0.000 |

## Latency

- feature: RPC p50 1615.8 ms, p95 9159.9 ms (317 calls); network baseline p50 112.9 ms, p95 855.3 ms; mean response 52435 bytes
