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
- PostgREST: the local image `public.ecr.aws/supabase/postgrest:v16.2`, in the database container's network namespace
  (`--network container:niyantran-corpus-test-db`), because that container has network mode `none`. It listens on
  `127.0.0.1:3000` inside the namespace, and the harness reaches it through a one-process relay over `docker exec`. It runs
  with `db-max-rows=1000` and a test-only JWT secret generated at run time and never written to the repo.
- The relay limits client-side throughput to about 34 MB/s in total, so commit latency above two workers is read from
  PostgREST's `Server-Timing`, not the client clock.
- Host disk: 32 GiB free on 2026-11-06. Docker's reported free space is virtual, and growth comes out of the host. **Stop
  rule: the run stops if the host falls below 6 GiB free.**
- Registration reads the desk's real admission, which on the full copy costs about 870 ms a document. Bills and Regulatory
  documents are admitted as question answers and relabelled, because no Bills adapter exists yet (F275). The load's own
  indexes for this are in `scripts/load-proof/admission-indexes.sql`, are test-only, and are applied only after the
  unindexed cost has been measured.

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

Stop and report on any of these: host below 6 GiB free; a failed job; a worker failure; a statement timeout or deadlock; any
sign of a server crash in the log; a chunk landing in the wrong partition; a request past its timeout. The idempotence check
(no embedding call for work already committed) belongs to E1.

## What changed in the measured runs

- E4 gained a control, because repeats of the grown passes came out worse than the first ones: base and grown in one sitting,
  in the order base, base, grown, grown, base.
- E5 gained a second pair of windows, because the first window of each kind ran cold.
- Registration ran with test-only indexes throughout, and the unindexed cost was measured first.

## Rollback

Everything is local: drop `niyantran_ingest_load_test`, then run `scripts/load-proof/postgrest.sh down --drop-role`, which
removes the PostgREST container and the `lp_authenticator` test role. Nothing here touches NTER.
