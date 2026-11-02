# Migration rehearsal

- Ran at: 2026-11-02T14:42:28.660Z
- Migration: 20261101120000_document_chunks_partitioned.sql (52021 bytes, sha256 a9f449902ad4866947172f018e540bc2fa1da4ab8773682cbb87075ae74da8f6)
- Source database: niyantran_rehearsal_pol (5.08 GiB)
- Rehearsal database: niyantran_rehearsal_polpart (kept)
- Free disk before the copy: 916.22 GiB (required 10.15 GiB)
- Settings: max_parallel_maintenance_workers=0 (session level, before the migration)
- Transaction: self-managed (the file has its own begin; and commit;)

## Timings

- Copy of the source (create database ... template): 9.2 s
- Migration: ok, 22 min 42 s, in one transaction
  - phase preconditions: 23 ms
  - phase lock: 3 ms
  - phase date facet function: 4 ms
  - phase new table: 4 ms
  - phase copy: 2 min 2 s
  - phase keys and indexes: 2.2 s
  - phase hnsw nclt: 13 min 57 s
  - phase hnsw default: 5 min 51 s
  - phase verify: 32.4 s
  - phase sync triggers: 32 ms
  - phase policies and grants: 9 ms
  - phase functions: 20 ms
  - phase analyze: 17.1 s
  - phase old table grants: 19 ms
  - phase swap: 23 ms
  - mark verified 392945 rows at 22 min 25 s (32.4 s after the previous marker)
  - mark swap lock taken on attempt 1 at 22 min 42 s (7 ms after the previous marker)
- Analyze (documents, document_chunks): 32.5 s

## Size

- Database before: 5.08 GiB
- Database after: 10.13 GiB
- Peak database size: 10.13 GiB at 22 min 42 s into the migration (431 samples)
- Peak database size growth over the start: 5.06 GiB
- WAL directory (cluster-wide, includes recycled segments): 896.0 MiB at the start, 1.01 GiB at the peak; peak database plus WAL 11.13 GiB
- Lowest free disk during the migration: 906.93 GiB
- Disk used at the worst point: 9.29 GiB (free before the copy minus the lowest free, so it includes the copy)
- Tables (heap and indexes) before 5.07 GiB, after 10.12 GiB

| Relation | Kind | Total before | Total after |
| --- | --- | --- | --- |
| document_chunks | p | 5.03 GiB | 0 B |
| document_chunks_default | r | — | 2.14 GiB |
| document_chunks_default_desk_feature_desk_tier_idx | i | — | 1.2 MiB |
| document_chunks_default_desk_feature_doc_date_idx | i | — | 1.2 MiB |
| document_chunks_default_desk_feature_language_idx | i | — | 1.2 MiB |
| document_chunks_default_document_id_chunk_hash_desk_feature_key | i | — | 23.5 MiB |
| document_chunks_default_document_id_chunk_index_idx | i | — | 6.5 MiB |
| document_chunks_default_embedding_halfvec_hnsw | i | — | 641.1 MiB |
| document_chunks_default_id_desk_feature_key | i | — | 11.0 MiB |
| document_chunks_document_id_chunk_hash_desk_feature_key | I | — | 0 B |
| document_chunks_document_id_chunk_hash_key | i | 55.7 MiB | — |
| document_chunks_document_order | I | 19.2 MiB | 0 B |
| document_chunks_embedding_halfvec_hnsw | I | 1.48 GiB | 0 B |
| document_chunks_feature_date | I | — | 0 B |
| document_chunks_feature_language | I | — | 0 B |
| document_chunks_feature_tier | I | — | 0 B |
| document_chunks_id_desk_feature_key | I | — | 0 B |
| document_chunks_nclt | r | — | 2.92 GiB |
| document_chunks_nclt_desk_feature_desk_tier_idx | i | — | 1.6 MiB |
| document_chunks_nclt_desk_feature_doc_date_idx | i | — | 1.6 MiB |
| document_chunks_nclt_desk_feature_language_idx | i | — | 1.6 MiB |
| document_chunks_nclt_document_id_chunk_hash_desk_feature_key | i | — | 30.4 MiB |
| document_chunks_nclt_document_id_chunk_index_idx | i | — | 8.7 MiB |
| document_chunks_nclt_embedding_halfvec_hnsw | i | — | 877.0 MiB |
| document_chunks_nclt_id_desk_feature_key | i | — | 14.5 MiB |
| document_chunks_pkey | i | 11.8 MiB | — |
| document_chunks_unpartitioned | r | — | 5.03 GiB |
| document_chunks_unpartitioned_document_id_chunk_hash_key | i | — | 55.7 MiB |
| document_chunks_unpartitioned_document_order | i | — | 19.2 MiB |
| document_chunks_unpartitioned_embedding_halfvec_hnsw | i | — | 1.48 GiB |
| document_chunks_unpartitioned_pkey | i | — | 11.8 MiB |
| documents | r | 40.6 MiB | 40.6 MiB |
| documents_desk | i | 176.0 KiB | 176.0 KiB |
| documents_document_key | i | 248.0 KiB | 248.0 KiB |
| documents_pkey | i | 560.0 KiB | 560.0 KiB |
| documents_source_key_key | i | 1.5 MiB | 1.5 MiB |

## Row counts

Row counts: equal before and after (documents 17609 -> 17609, document_chunks 392945 -> 392945)

## Readers during the migration

A second connection ran a trivial select on document_chunks every probe interval: 5434 probes, 0 failed.
- Longest reader wait: 706 ms (began 17 min 12 s into the migration)
- p50 1 ms, p95 5 ms, probes over 1 s: 0

Probes go through one persistent psql session, so the p50 is the floor (pipe and query) and the maximum is the figure to read.
