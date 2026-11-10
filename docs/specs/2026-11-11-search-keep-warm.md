# Keeping NCLT search warm (T9 precondition)

> **Status: Living (2026-11-11).** The developer chose option (b) of the cold re-run on 2026-11-11 ("go ahead with your
> recommendations"): hold the hybrid switch (T9), add a keep-warm step, then measure once straight after an eviction.
> Runbook: [hybrid apply and measure](../operations/2026-11-09-hybrid-apply-and-measure.md). Open work: T9, F288.

## Current state

- Two cold windows on NTER (2026-11-10): after a day of bulk loading, hybrid's first NCLT call took 5.5 s and read
  103,664 vector-index blocks from disk; after 7 quiet hours with nothing else running, the index was mostly cached and
  no call passed 1.03 s. Slow first searches follow eviction, not idle time.
- NTER (read 2026-11-11): 8 GB RAM, `shared_buffers` 2 GB, `effective_cache_size` 6 GB. `pg_prewarm` 1.2 is available
  and not installed; it is not in `shared_preload_libraries`, so nothing reloads the cache after a restart.
- NCLT's search set: vector index `document_chunks_nclt_embedding_halfvec_hnsw` 877 MB, keyword index
  `document_chunks_nclt_to_tsvector_idx` 67 MB, table `document_chunks_nclt` 286 MB: 1.23 GB. All vector indexes
  together are about 2.5 GB (Bills 1.31 GB), more than `shared_buffers`, so only NCLT (hybrid's only desk) is kept warm.

## Change

1. Migration `20261111090000_search_keep_warm.sql`:
   - `create extension if not exists pg_prewarm with schema extensions`; execute on its functions revoked from
     `public`, `anon` and `authenticated` (only the owner and `service_role` keep it).
   - `public.search_keep_warm()`: for each relation in a fixed list (the three above, looked up with `to_regclass`, a
     missing one skipped), `pg_prewarm(rel, 'prefetch')`, falling back to `'read'` where prefetch is not supported;
     returns the relations and blocks as `jsonb`. Security invoker; execute revoked from `public`, `anon` and
     `authenticated`.
2. Apply step (runbook, not the migration, as the other cron jobs): a `pg_cron` job `search-keep-warm` every 10 minutes
   running `select public.search_keep_warm()`. That also covers a restart within 10 minutes.

## Acceptance evidence

- SQL fixture: the function exists, prefetches the listed relations that exist, skips a missing one, and `anon` and
  `authenticated` cannot execute it or `pg_prewarm`; fails without the migration (vacuity).
- NTER: dry run (rolled back), apply with the history row, one call (blocks returned), the cron job, and its first
  successful runs in `cron.job_run_details`.
- Then, after the next eviction (the next bulk load or a restart), the cold measurement once more, vector-only first,
  same rule (no call over 2.5 s). T9 stays held until that passes.

## Rollback

`select cron.unschedule('search-keep-warm')`; `drop function public.search_keep_warm()`; `drop extension pg_prewarm`;
delete the history row. Nothing else depends on them.

## Not in this change

Keeping other desks warm, `shared_buffers` or compute size changes, autoprewarm (needs `shared_preload_libraries`), and
the hybrid switch itself (T9, F288).
