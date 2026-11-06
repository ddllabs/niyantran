# Ingestion proof on partitions: plan (F287)

> **Status: Living (2026-11-06).** Implements the [spec](../specs/2026-11-06-ingestion-load-proof.md). Branch
> `task/ingest-load-proof`. Sequential: one task at a time, and one Docker-heavy job at a time.

## Setup facts

- Database: `niyantran_ingest_load_test` in `niyantran-corpus-test-db`. The `_test` suffix is what `bootstrap_auth.sql`
  requires. Its schema is the `ingest_register_batch` fixture chain from `supabase/tests/run.sh`, which holds Phase B and
  C3, plus `20261101130000_law_documents_serving_set.sql`, in timestamp order and as `nter_migrator`.
- The rehearsal copies hold chunks but no `ingest_*` tables, so they cannot run the worker. Real rows come from
  `niyantran_rehearsal_b9final`: `documents` and `document_chunks`, by the columns both sides share. Drop the partitioned
  HNSW index before loading and build it after, as the migration does, with 1 GB of maintenance memory.
- PostgREST: the local image `public.ecr.aws/supabase/postgrest:v16.2`, on Docker's default bridge, published on
  `127.0.0.1` only, with `db-max-rows=1000` and a test-only JWT secret generated at run time and never written to the repo.
- Host disk: 19 GiB free. Docker's reported 872 GB is virtual, and growth comes out of the host. Space freed inside the
  volume is reused first, so `niyantran_rehearsal_c1hybrid` and `niyantran_rehearsal_c2headers` are dropped before the
  load. Both are disposable and can be rebuilt. **Stop rule: the run stops if the host falls below 6 GiB free.**

## Tasks

| Task | Role | Write scope | Depends on | Verification |
|---|---|---|---|---|
| T1. Harness: database build, PostgREST, fake embedder, fake OCR and storage, worker driver | Engineer, independent reviewer | `scripts/load-proof/` | none | `deno test` for the harness; a fake embedder test proves determinism and the 1536 width |
| T2. E1 cases as an executable suite, each case proved able to fail | Engineer, independent reviewer | `scripts/load-proof/` | T1 | the suite passes; each check shown failing once against a deliberate break |
| T3. Load generator: synthetic documents, registration by batch, per-slice timing, size sampling, stop rule | Engineer, independent reviewer | `scripts/load-proof/` | T1 | a 2,000-chunk dry run produces a complete results file |
| T4. Measured runs E2 to E5 | supervisor | `eval/ingestion/results/` | T2, T3 | results files; no test suite during a measured run |
| T5. Research note and disk plan (E6) | supervisor | `docs/research/`, `docs/operations/`, `docs/plans/open-work.md` | T4 | figures recomputed from the results files |
| T6. Gate review | Independent reviewer | none | T5 | review notes |

## Faked boundaries

Only these are faked, and each is injected at `RunDeps`, so nothing else in the worker changes:

- `embed`: no network. A deterministic vector per text, from a sampled real vector of the same desk plus seeded noise,
  normalised. Same return shape as `embedTexts`, with cost 0. The vector pool stays outside the repository.
- `ocr` and `storage`: used only by the page-path case, from `supabase/functions/ingest-worker/__fixtures__/`.

Synthetic documents reuse real chunk text of the same desk, shuffled by a seeded generator, with a unique header so the
duplicate-text refusal stays armed. Chunks per document follow the desk's real distribution.

## Stop conditions for T4

Stop and report on any of these: host below 6 GiB free; a failed job; a statement timeout or deadlock; a chunk landing in
the wrong partition; or the fake embedder being asked for a vector twice for the same `embed_hash` in the idempotence case.

## Rollback

Everything is local: drop `niyantran_ingest_load_test`, remove the PostgREST container, and delete the `authenticator`
test role if the harness created it. Nothing here touches NTER.
