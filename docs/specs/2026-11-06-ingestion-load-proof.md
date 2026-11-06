# Ingestion proof on partitions (F287)

> **Status: Living (2026-11-06).** Spec for F287, under the [bulk ingestion spec](2026-11-01-bulk-ingestion.md).
> [Plan](../plans/2026-11-06-ingestion-load-proof.md). Local and disposable only: no NTER, no paid API, no client data
> beyond what the rehearsal copies already hold.

## Current state

- NTER has written no document since 2026-10-31. Partitions went live on 2026-11-03, so the worker has never run on them
  in production.
- SQL fixtures cover chunk routing, facets and feature moves. Deno tests cover the worker against fakes. No test runs the
  real worker, through real PostgREST, against partitioned tables.
- Set-based registration (C3) is merged and unapplied. No run has taken a batch from registration to indexed documents.
- Bulk insert speed, disk per chunk under live insert, and search at Bills 445,000 and Regulatory 228,000 chunks are
  unmeasured. National v1.1 is about 630,000 chunks, estimated at 8.8 GB against about 8 GB free on NTER.

## Problem

The first validation batch would be the first time the write path runs on partitions, on production. A failure there
costs client trust and a production repair, and the disk estimate could be wrong by the amount that matters.

## Outcome

Before any validation batch, we can say from an execution:

1. the worker takes documents from registration to searchable on every partition, by both write paths;
2. a rerun is idempotent, and a killed run stops and resumes as designed;
3. how fast chunks go in, and how that changes as a partition grows and as concurrency rises;
4. how many bytes one chunk costs in full, including everything ingestion stores besides the chunk;
5. how search latency holds at the target partition sizes;
6. what the NTER disk plan needs, with the options costed. Choosing among them stays the developer's decision.

## Acceptance evidence

**E1. End to end.** The real worker code (`supabaseIngestDb`, `runOnce`, the real steps) through real PostgREST as
`service_role`, on a database built from the migration chain, with only the outside providers faked:

| Case | Passes when |
|---|---|
| Supplied text, one document, on each of Bills, NCLT, Regulatory, Parliamentary Questions (default partition) and a new feature (default partition) | job succeeds; chunks in the expected partition; facets correct; a search as `authenticated` returns the document |
| Sealed batch through `ingest_register_batch` and `suppliedBatchStep` | every document admitted and indexed; ledger counts match; embedding calls carry the batch id |
| Page path: OCR stage then `chunk_commit`, on one partitioned feature | document indexed in the right partition |
| Rerun of the same batch | no new chunk, no embedding call |
| Worker killed mid-batch | the job holds as `text_outcome_uncertain`, nothing is paid for twice, and requeue finishes it |
| A provider failure | the failed job stops; other jobs and committed slices stay |

**E2. Write load.** Bills to 445,000 and Regulatory to 228,000 chunks through the real commit path, recording per slice
latency, chunks per second by partition size, and WAL per chunk, at the default `max_running` of 2 and at higher
concurrency. Any statement timeout, deadlock or failed job is a finding, not noise.

**E3. Bytes per chunk.** Heap, TOAST, the HNSW index as grown by live insert, other indexes, `ingest_text_inputs` and any
other table ingestion writes, and the HNSW size and build time when rebuilt at full size.

**E4. Search at size.** The retrieval eval's latency on the grown copy against the same copy before growth, under the
8 s limit and the `LATENCY` bar. Synthetic chunks crowd real answers, so recall at size is not evidence and is not claimed.

**E5. Hybrid's write cost.** A short insert window after applying the hybrid migration, against the same window without
it. NTER may carry that GIN index during ingestion.

**E6. Disk plan.** A note applying E3 to National v1.1 on NTER, with options costed, and no choice made.

## Scope

- A harness under `scripts/load-proof/`, its tests, and result files under `eval/ingestion/results/`.
- A research note and the disk plan. New open items for anything found.
- Defects found are reported in `open-work.md`. Fixes to the worker or migrations are separate tasks.

## Exclusions

- NTER, in any form. Paid APIs. Real OCR. Text from the client's packs.
- The bulk runner, its stop rules, the Bills adapter and the F285 guard. This work informs them and does not build them.
- The capacity decision (F279). Hybrid's latency work (F286, F288).
- Absolute speed on NTER. See below.

## What this cannot prove

- **Speed.** The local database has 512 MB of shared buffers in a 3.8 GiB container on a laptop disk, and NTER has 2 GB
  in 8 GB. Local chunks per second do not transfer. Bytes per chunk and WAL per chunk do, and so does the shape of the
  slowdown as an index grows.
- **Recall at size**, as E4 says.
- **Real embeddings.** Vectors are real ones with noise added, so HNSW sees clustered data, but it is not the real
  distribution. The note must report how close the nearest-neighbour distances came.
- **NTER's configuration**, connection limits and Supavisor. The first validation batch is still its own test.
