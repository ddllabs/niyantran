-- 084135: make desk_rows survive a loader run without hurting readers.
--
-- scripts/load-desk-rows.mjs upserts EVERY row of every module on every run -
-- there is no change detection - and then prunes what it did not touch using
-- loaded_at as the liveness marker. That marker is why nothing can be skipped:
-- a row that missed its upsert would keep an old loaded_at and be pruned as
-- stale. So a full run is 34,184 updates, and pg_stat_user_tables agrees:
-- n_tup_upd 34,184 against n_tup_hot_upd 9,551, so 72% were not HOT and wrote
-- new entries into every index.
--
-- 073820 made that worse. record_text is now covered by a 24 MB trigram GIN,
-- so any update touching it is guaranteed non-HOT and must write there, on top
-- of the existing 12 MB desk_rows_row_gin. The loader got more expensive the
-- moment that index existed.
--
-- 1. fastupdate. Both GIN indexes were on the default fastupdate=on with a
--    4 MB gin_pending_list_limit. Two consequences, both landing on readers
--    rather than on the loader: while entries sit in the pending list every
--    scan reads that list linearly on top of the index, and the merge runs in
--    the foreground of whichever statement happens to fill it - which can be a
--    user's search. For an index written in offline batches and read on every
--    turn, that trade is backwards. fastupdate=off makes the loader's writes
--    slower and keeps every read predictable.
--
--    ALTER INDEX only stops FUTURE entries from going to the pending list; it
--    does not flush what is already there. gin_clean_pending_list() was called
--    on both afterwards and returned 0 pages for each - the trigram index had
--    just been built and the jsonb one was already merged - so nothing was
--    pending at the time. It is still the right call to make explicitly after
--    any future ALTER.
--
-- 2. autovacuum. The table was on defaults, so it did not fire until
--    50 + 0.2 * 34,184 = 6,887 dead tuples. A loader run makes 34,184, and
--    autovacuum had last run 13 hours before this migration while the
--    visibility map was still stale enough to cost 1,961 heap fetches on an
--    index-only scan. 0.05 brings the trigger to 1,759. The analyze scale
--    factor moves with it because the planner needs fresh statistics to keep
--    choosing the trigram index after a load.
--
-- Not done here, deliberately: autovacuum_vacuum_cost_limit is left at the
-- default. Raising it is plausible but it is tuning without a measurement, and
-- on a shared-CPU instance a faster vacuum is its own latency spike.
-- fillfactor is left alone too: with record_text indexed, an update that
-- changes it can never be HOT however much free space the page has.
--
-- The real fix is upstream and is not a migration: make the loader write only
-- rows whose content changed and prune by key difference instead of loaded_at.
-- That turns a normal run into a few hundred writes and makes both settings
-- above mostly moot. It is a change to one script with its own verification
-- burden - the prune path is where a bug silently deletes real rows - so it is
-- not bolted onto this one.
--
-- Verified after applying: four consecutive rounds of the four search shapes
-- held at 17.8-27.4 / 4.4-5.0 / 39.6-43.6 / 9.9-11.0 ms. An earlier run of the
-- same harness showed a 3,670 ms worst case; re-running immediately showed it
-- was the instance's idle-CPU throttle on the first query after a gap, not
-- this change - reads are not affected by fastupdate at all.
--
-- Down (manual):
--   alter index public.desk_rows_record_text_trgm reset (fastupdate);
--   alter index public.desk_rows_row_gin reset (fastupdate);
--   alter table public.desk_rows
--     reset (autovacuum_vacuum_scale_factor, autovacuum_analyze_scale_factor);

alter index public.desk_rows_record_text_trgm set (fastupdate = off);
alter index public.desk_rows_row_gin set (fastupdate = off);

alter table public.desk_rows set (
  autovacuum_vacuum_scale_factor  = 0.05,
  autovacuum_analyze_scale_factor = 0.05
);
