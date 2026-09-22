-- 0003: a trigram index for search_desk_rows, so the desk-row tool stops
-- losing races against its own 4-second bound.
--
-- Measured on the live instance on 2026-09-22, idle, cache warm:
--
--   search_desk_rows('national', null, 'Appropriation', null, 20)
--     run 1: 6197 ms   Buffers: shared hit=11354 read=90
--     run 2:  541 ms   Buffers: shared hit=11421 read=26
--
-- Same plan, same data, essentially no disk either time - so the cost is CPU
-- spent evaluating `record_text ~~* '%...%'` over all 34,184 rows, and the 11x
-- spread between the two runs is this instance's CPU being throttled after
-- idle. The slow run is not an outlier: it is what the first search of a
-- session gets, which is why turns fail in clusters and then work fine.
--
-- The edge function gives a tool call 4000 ms (NETWORK_TIMEOUT_MS,
-- research-chat/index.ts) and the `authenticated` role would allow 8 s, so
-- every "tool step failed" in chat_turn_traces is us hanging up on a query
-- Postgres was still running. Raising our bound would only trade a failed
-- search for a slow one; the scan itself has to go.
--
-- pg_trgm turns the predicate into an index lookup: `%Appropriation%` has
-- trigrams, so the GIN index answers it instead of 34,184 case-insensitive
-- comparisons. It lives in `extensions` with this project's other extensions
-- (vector, pgcrypto, pg_net). Index use does not need that schema on any
-- caller's search_path - the operator class is resolved when the index is
-- built and recorded in the catalogue - so search_desk_rows keeps its
-- `set search_path = public`.
--
-- The index alone is not enough, and this migration does not pretend to be:
-- measured straight after it was applied, the raw predicate takes 35 ms
-- (Bitmap Index Scan, 1288 buffers) while search_desk_rows itself still takes
-- 560 ms over 14,701 buffers, because `p_query is null or p_query = '' or ...`
-- forces a plan that has to work when p_query is null. Migration 0004 rewrites
-- that predicate; this one only makes the index it will use exist.
--
-- What neither migration fixes: a query of one or two characters has no
-- trigram and still scans, and `row @> p_filters` keeps the same structural
-- problem in its own OR. Both stay bounded by this instance's CPU.
--
-- Down (manual):
--   drop index if exists public.desk_rows_record_text_trgm;
--   drop extension if exists pg_trgm;

create extension if not exists pg_trgm with schema extensions;

-- GIN, not GiST: this column is written by a loader script in batches and read
-- by every desk-row search, so a slower build for a faster probe is the right
-- trade. `public.desk_rows` is 89 MB / 34,184 rows, so the build is short and
-- a plain CREATE INDEX (no CONCURRENTLY, which cannot run inside the
-- transaction a migration gets) blocks writers only briefly.
create index if not exists desk_rows_record_text_trgm
  on public.desk_rows using gin (record_text extensions.gin_trgm_ops);

analyze public.desk_rows;
