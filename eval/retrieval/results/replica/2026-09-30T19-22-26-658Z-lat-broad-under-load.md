# Retrieval evaluation

- Set: questions.v1.jsonl
- Commit: 99bb116
- Migration version: 20260929120100_match_documents_halfvec.sql (replica copied 2026-09-30T18:53:26.525558+00:00)
- Corpus fingerprint: 2338 documents, 54219 chunks, latest indexed_at 2026-09-22T09:24:00.79+00:00
- Cost: $0.0000 (0 embedding tokens)

Ranking is the row order returned by match_documents. Bar figures exclude ambiguous and owner questions.

## Mode: broad

| Scope | n | Ambiguous excluded | Doc@5 | Doc@10 | Doc@40 | Key@5 | Key@10 | Key@40 | Chunk@5 | Chunk@10 | Chunk@40 | Doc MRR@40 | Chunk MRR@40 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Overall | 184 | 11 | 154/184 (83.7%) | 162/184 (88.0%) | 173/184 (94.0%) | 157/184 (85.3%) | 164/184 (89.1%) | 173/184 (94.0%) | 124/184 (67.4%) | 134/184 (72.8%) | 159/184 (86.4%) | 0.710 | 0.491 |
| Bill Passage Probability Index | 72 | 8 | 58/72 (80.6%) | 63/72 (87.5%) | 67/72 (93.1%) | 61/72 (84.7%) | 65/72 (90.3%) | 67/72 (93.1%) | 43/72 (59.7%) | 46/72 (63.9%) | 55/72 (76.4%) | 0.652 | 0.354 |
| Regulatory Body Watch (RBI SEBI TRAI CCI) | 57 | 3 | 47/57 (82.5%) | 49/57 (86.0%) | 54/57 (94.7%) | 47/57 (82.5%) | 49/57 (86.0%) | 54/57 (94.7%) | 37/57 (64.9%) | 42/57 (73.7%) | 52/57 (91.2%) | 0.718 | 0.561 |
| Parliamentary Question Database | 40 | 0 | 34/40 (85.0%) | 35/40 (87.5%) | 37/40 (92.5%) | 34/40 (85.0%) | 35/40 (87.5%) | 37/40 (92.5%) | 30/40 (75.0%) | 31/40 (77.5%) | 37/40 (92.5%) | 0.692 | 0.578 |
| Industry Updates (Ministry Data) | 12 | 0 | 12/12 (100.0%) | 12/12 (100.0%) | 12/12 (100.0%) | 12/12 (100.0%) | 12/12 (100.0%) | 12/12 (100.0%) | 11/12 (91.7%) | 12/12 (100.0%) | 12/12 (100.0%) | 1.000 | 0.596 |
| Budget Utilisation & Schemes | 3 | 0 | 3/3 (100.0%) | 3/3 (100.0%) | 3/3 (100.0%) | 3/3 (100.0%) | 3/3 (100.0%) | 3/3 (100.0%) | 3/3 (100.0%) | 3/3 (100.0%) | 3/3 (100.0%) | 1.000 | 0.833 |
| Overall incl. ambiguous | 195 | — | 161/195 (82.6%) | 170/195 (87.2%) | 182/195 (93.3%) | 164/195 (84.1%) | 173/195 (88.7%) | 183/195 (93.8%) | 128/195 (65.6%) | 139/195 (71.3%) | 166/195 (85.1%) | 0.691 | 0.479 |

## Latency

- broad: RPC p50 210.4 ms, p95 367.2 ms (195 calls); network baseline p50 168.9 ms, p95 286.7 ms; mean response 54992 bytes
