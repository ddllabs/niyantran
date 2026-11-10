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
- NCLT's search set (measured on NTER 2026-11-11): vector index `document_chunks_nclt_embedding_halfvec_hnsw` 877 MB,
  keyword index `document_chunks_nclt_to_tsvector_idx` 67 MB, table `document_chunks_nclt` 286 MB, and the table's TOAST
  relation 1.76 GB with its index 19 MB: about 3.0 GB. The embeddings live in TOAST (attstorage 'e', about 6 KB each) and
  hybrid reads them for up to 2,000 candidates per search, so warming only the first three would leave the slow part
  cold. For comparison Bills' search set is about 4.1 GB; all vector indexes together are about 2.5 GB.
- Decision (developer, 2026-11-11): warm NCLT's whole search set on the current 8 GB. This is more than `shared_buffers`
  (2 GB) but within `effective_cache_size` (6 GB) and the OS page cache; the cost accepted is that Bills and the other
  desks are evicted more often.

## Change

1. Migration `20261111090000_search_keep_warm.sql`:
   - `create extension if not exists pg_prewarm with schema extensions`; execute on all its functions revoked from
     `public`, `anon` and `authenticated`, and nothing granted to anyone: only the owner keeps it (the cron job runs as
     `postgres`). `search_keep_warm()` is the same.
   - `public.search_keep_warm()` (security invoker, `search_path = ''`, `lock_timeout = '2s'`): the three named
     relations from a fixed list, plus the table's TOAST relation and its TOAST index, found through
     `pg_class.reltoastrelid` and `pg_index`, never by name. A relation that does not exist is skipped with a
     `WARNING` naming it, so a rename shows in the logs. Each gets `pg_prewarm(rel, 'prefetch')` (the OS page cache,
     not `shared_buffers`), falling back to `'read'` on SQLSTATE 0A000 only. Returns the relations and `blocks` (blocks
     requested, not blocks that had to be read) as `jsonb`.
   - A self-check at the end, inside the transaction: the apply fails if `public` (an empty-grantee ACL entry, read
     from `aclexplode(proacl)`), `anon` or `authenticated` can execute any pg_prewarm function or `search_keep_warm()`, or
     if `postgres` cannot execute `extensions.pg_prewarm`. Where the extension's functions are owned by another role
     the revokes could do nothing silently; this makes it fail loudly in the dry run.
2. Apply step (runbook, not the migration, as the other cron jobs):
   - Dry run, rolled back: read `proowner`, `proacl` and `has_function_privilege` for the three extension functions and
     `search_keep_warm()` (as `postgres`, `anon`, `authenticated`; PUBLIC from `aclexplode`).
   - After the apply, prove prefetch works on this platform with one direct call:
     `select extensions.pg_prewarm('public.document_chunks_nclt_to_tsvector_idx', 'prefetch')`.
   - Time the first `select public.search_keep_warm()` (about 3.0 GB, so expect it to be the slow one) and keep the
     result.
   - Create the `pg_cron` job `search-keep-warm` every 10 minutes running `select public.search_keep_warm()`; check that
     `cron.job.database` is the application database, then read `cron.job_run_details` for its first runs.
   - Pause it during DDL on the `document_chunks` partitions (`select cron.alter_job(<jobid>, active := false)`, then
     `active := true` afterwards); `lock_timeout` stops it queueing behind DDL, but a paused job also stops it
     re-reading while indexes are rebuilt.

## Acceptance evidence

- SQL fixture: the extension has exactly three functions, none executable by PUBLIC, `anon` or `authenticated`; the
  function returns the five relations (three named, TOAST relation, TOAST index), skips a renamed one, and is refused to
  `anon`; the migration's self-check, run again from its own text, raises after a grant to `anon`, `authenticated` or
  PUBLIC; fails without the migration (vacuity) and without the revokes.
- NTER: dry run (rolled back), apply with the history row, one call (blocks returned), the cron job, and its first
  successful runs in `cron.job_run_details`.
- Then, after the next eviction (the next bulk load or a restart), the cold measurement once more, vector-only first,
  same rule (no call over 2.5 s); the measurement counts `toast_blks_read` and `tidx_blks_read` as well as the heap and
  index blocks. T9 stays held until that passes.

## Rollback

`select cron.unschedule('search-keep-warm')`; `drop function public.search_keep_warm()`; `drop extension pg_prewarm`;
delete the history row. Nothing else depends on them.

## Not in this change

Keeping other desks warm, `shared_buffers` or compute size changes, autoprewarm (needs `shared_preload_libraries`), and
the hybrid switch itself (T9, F288).
