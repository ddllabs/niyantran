# Unscoped search recall against `hnsw.ef_search` (F35)

> **Status: Historical (2026-10-15).** Measurements for open-work F35: does raising
> `hnsw.ef_search` close the gap between NTER's unscoped (whole-library) search and exact
> search? Every figure was **executed** on the local replica
> (`niyantran-corpus-test-db`, database `niyantran_retrieval_replica`). Nothing was run on
> NTER. Base commit `589d577`. Context: `docs/research/2026-10-01-feature-filter-measurements.md`
> ("A separate finding").

## Answer

- **Raising `ef_search` to 150–200 closes the gap on the replica.** The index finds the right
  document in the top 10 for 170 of 184 questions, the same as exact search. At the default
  of 40 it finds 162.
- **Recommended: `ef_search = 200`** for the unscoped branch. It costs about 2 ms more at the
  median and about 9 ms more at p90 than the default, far inside the 50 ms budget.
- **Do not go to 500 or more.** Past about 500 the planner stops using the index and runs an
  exact scan, which took 11–57 s under load here.
- **Do not lower T so that Regulatory takes the pure index path.** On-topic questions do fine,
  but a question that is off-topic for the module returns **no rows** at any `ef_search` up to
  400. It needs an exact fallback first (see "Threshold T").

## Method

- **Same set-up as the 2026-10-01 measurements.** The replica holds 2,338 documents and
  54,219 chunks, pgvector 0.8.6, the halfvec HNSW index (204 MB, default `m` and
  `ef_construction`), `shared_buffers` 512 MB, and the live `match_documents` (5 arguments).
  Counts were re-checked on 2026-10-15 and are unchanged.
- **Questions.** `eval/retrieval/questions.v1.jsonl`: 195 questions, 184 of them not ambiguous.
  The harness's own frozen query vectors (`questions.v1.vectors.json`) are the query
  embeddings, so **no embedding call was made**.
- **Why not the existing harness.** `scripts/eval-retrieval.mjs --target replica` opens a new
  `psql` per call and cannot set `hnsw.ef_search`. The function's unscoped branch sets no
  `ef_search`, so a session-level `SET` is honoured by the very same function. I used one
  long-lived `psql` session per round instead. Each statement:
  1. `set hnsw.ef_search = N;`
  2. `select ... from public.match_documents(<vector>, 40, null::uuid[], null, null)`
     (unchanged function, unscoped branch), as role `authenticated` under RLS, with
     `search_path = public, extensions`. Rows keep their returned order.
  3. Time read from psql `\timing` (server time plus the local socket; no `docker exec` or
     process start-up, so absolute times are far lower than the 2026-10-01 harness figures,
     whose floor was a 73 ms ping).
- **Reference.** Exact search = the unscoped branch without the index, ordered by
  full-precision distance over every indexed chunk (the body of the 2026-10-01
  `match_documents_exact`, which is no longer installed, so I ran it inline; no object was
  created). Its top 40 chunks are the truth for recall.
- **Recall@40** = the share of exact search's 40 chunks that the index also returns, averaged
  over questions. **Right document in the top 10** = the question's gold document appears in
  the first 10 returned rows (the eval harness's `Doc@10`).
- **Timing design.** `ef_search` values were interleaved per question (rotated order), so slow
  moments on this laptop hit every setting alike. Three rounds, 585 timed calls per setting,
  seeded shuffle, 5 warm-up calls per round. Quality comes from round 1 (the index is
  deterministic).
- **Reproducibility check.** At `ef_search` 40 this method gives recall@40 **0.922** over all 195
  questions and 162 right documents in the top 10, which are exactly the 2026-10-01 replica
  figures (0.922 and 162). So the method matches the earlier one.

Commands (the scripts were throwaway, kept outside the repository; this is the shape):

```bash
export PATH="$HOME/.docker/bin:$PATH"
# one psql session per round, vectors loaded with \set so each call sees a literal:
docker exec -i niyantran-corpus-test-db psql -U postgres -d niyantran_retrieval_replica \
  -v ON_ERROR_STOP=1 -q -At <<'SQL'
\set v_q_0001 '[...1536 floats...]'          -- one per question
set role authenticated;  set search_path = public, extensions;
\timing off
set hnsw.ef_search = 200;
\echo @@ u|200|q-0001
\timing on
select string_agg(id::text, ',' order by n), string_agg(document_id::text, ',' order by n), count(*)
  from (select id, document_id, row_number() over () n
          from public.match_documents(:'v_q_0001'::extensions.vector, 40, null::uuid[], null, null) m) t;
-- exact reference:
select ... from (select c.id, c.document_id from public.document_chunks c
  join public.documents d on d.id = c.document_id
  where c.embedding is not null and d.indexed_at is not null
  order by c.embedding <=> :'v_q_0001'::extensions.vector limit 40) m;
SQL
```

## Results: unscoped search

Right document in the top 10, out of the 184 non-ambiguous questions; per-module counts are
Bills /72, Regulatory /57, Parliamentary Questions /40, Industry /12, Budget /3. Times are
milliseconds per call, pooled over 585 calls (195 for exact).

| `ef_search` | Recall@40 vs exact (184 / 195 questions) | Doc in top 10 | Bills | Reg | PQ | Ind | Bud | Doc in top 5 | Doc in top 40 | p50 | p90 | p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| exact | 1.000 | **170** | 67 | 50 | 38 | 12 | 3 | 159 | 180 | 385 | 1,657 | 6,013 |
| **40** (default) | 0.920 / 0.922 | 162 | 63 | 49 | 35 | 12 | 3 | 154 | 173 | 2.3 | 8.7 | 18.4 |
| 100 | 0.973 / 0.972 | 168 | 66 | 50 | 37 | 12 | 3 | 157 | 178 | 2.7 | 10.7 | 23.1 |
| 150 | 0.989 / 0.989 | **170** | 67 | 50 | 38 | 12 | 3 | 159 | 180 | 3.4 | 14.8 | 32.1 |
| **200** | 0.991 / 0.991 | **170** | 67 | 50 | 38 | 12 | 3 | 159 | 180 | 4.1 | 17.4 | 38.1 |
| 400 | 0.994 / 0.994 | **170** | 67 | 50 | 38 | 12 | 3 | 159 | 180 | 8.2 | 45.0 | 88.3 |

Also at `ef_search` 150 and above: the exact passage in the top 10 is 141 and in the top 40 is
166, equal to exact search (at 40 they are 134 and 159).

- **Which questions are lost.** Eight questions that exact search answers are lost at 40
  (q-0001, q-0013, q-0026, q-0073, q-0132, q-0144, q-0147, q-0168). At 100 two remain
  (q-0026, q-0147). At 150 and above none. The index never found a question that exact search
  missed, at any setting.
- **Cost.** Mean time per call: 5.1 ms at 40, 7.0 at 100, 9.0 at 150, 10.2 at 200, 22.2 at 400.
  Against 40, the median rises by 0.4 / 1.1 / 1.8 / 5.9 ms for 100 / 150 / 200 / 400.
- **Exact search** is 2–3 orders of magnitude slower in the tail on this laptop. It is
  not an option for the unscoped branch.
- **The residual 0.6–0.9% at 200–400** is not index loss that more `ef_search` can fix. Exact
  search orders by full precision and the index by half precision, so a few chunks at rank 40
  swap places. No question's answer was affected. I did not run a half-precision exact
  reference (a sequential scan took 30+ s per query under load), so the split between the two
  causes is not measured.

### The planner flips to an exact scan at high `ef_search`

`EXPLAIN` on the unscoped query, one question vector, replica:

| `ef_search` | Plan | Estimated cost |
| --- | --- | --- |
| 40 / 100 / 200 / 400 / 450 / 500 | HNSW index scan | 1,235 / 2,481 / 4,343 / 7,750 / 8,564 / 9,368 |
| 550 / 600 / 800 | Parallel sequential scan plus sort (exact) | 9,852 |

The index scan's estimated cost grows with `ef_search`. Past about 500 it exceeds the cost
of scanning the table, and the planner chooses the exact scan. That is the slow plan (11–57 s
per call under load here). NTER's table is about 1.8 times larger, so its
flip point is probably higher, but that is unmeasured. At 200 the index plan is 2.3 times
cheaper than the exact plan on the replica, which is a safe margin.

## Results: threshold T (feature filter)

The feature path is `match_documents_feature_hnsw` (HNSW, filter afterwards). I ran its query
inline at each `ef_search` against the exact in-feature scan, using the questions whose own
module is the feature (on-topic questions). Counts: recall@40 against the exact in-feature top
40; "short" = calls that returned fewer than 40 rows.

**Regulatory** (11,040 chunks, 20% of the replica; 57 questions, 180 timed calls each):

| Path | Recall@40 | Doc in top 10 | Short results | p50 ms | p90 ms | p95 ms |
| --- | --- | --- | --- | --- | --- | --- |
| exact (today, T = 15,000) | 1.000 | 50 | 0 | 79.9 | 188.0 | 204.5 |
| index, ef 40 | 0.950 | 49 | 9 calls | 1.8 | 3.9 | 4.8 |
| index, ef 100 | 0.996 | 50 | 0 | 2.4 | 7.1 | 12.5 |
| index, ef 200 | 0.998 | 50 | 0 | 3.5 | 9.4 | 13.1 |
| index, ef 400 | 0.998 | 50 | 0 | 6.7 | 20.9 | 35.3 |

**Bills** (42,025 chunks; 72 questions, 240 calls each), for reference: the index path at ef
200 matches exact (recall 0.994, 67 of 72 right documents in the top 10, p50 8.9 ms) and the
exact scan costs p50 229 ms. At ef 40 the index path returns short results for 7 calls
and loses 4 right documents (63 against 67).

**On-topic questions favour the index path.** For Regulatory, the index at ef 100–400 equals
exact search's quality and is 12–33 times faster at the median on the replica. NTER's exact
scan (733 ms warm) is about 9 times slower than the replica's, so the saving there would be
larger.

**Off-topic questions break it.** A module can be focused for a question that is really about
another module. I replayed every question that belongs to a different module inside the
feature (135 against Regulatory, 155 against Parliamentary Questions):

| Feature | ef | Calls returning fewer than 40 rows | Recall@40 vs exact in feature |
| --- | --- | --- | --- |
| Regulatory | 40 | 135 of 135 (all empty) | 0.02 |
| Regulatory | 100 | 132 of 135 | 0.07 |
| Regulatory | 200 | 124 of 135 | 0.11 |
| Regulatory | 400 | 121 of 135 | 0.15 |
| Parliamentary Questions | 40–200 | 155 of 155 | 0.00–0.01 |
| Parliamentary Questions | 400 | 0 of 155 | 1.00 |

The index returns the nearest chunks of the whole library, and none belongs to the feature.
Most of these calls return **zero rows**. Parliamentary Questions at 400 is fine only because
the planner picked an exact scan for that small feature, as the 2026-10-01 note says. Regulatory
was not given an exact scan by the planner.

**Conclusion on T.** Lowering T so that Regulatory takes the index path is not safe on its own.
It would be safe with a fallback: run the index at about 100–200, and if it returns fewer
than `match_count` rows, run the exact scan. On-topic questions then pay about 3 ms, and the
off-topic ones pay the index time plus today's exact cost (about 80 ms replica, about 730 ms
NTER). The fallback is not built or measured end to end. The share of questions that are
off-topic in real use is not measured either.

## Spend

- **Embedding calls: none. Cost: $0.00.** All query vectors were frozen in the repository.
- No request left this machine. No remote service and no NTER object was touched.
- Replica use was read-only (session `SET`s only, plus `set role authenticated`). The replica's
  data is unchanged.

## Caveats

- **Size.** The replica holds 54,219 chunks and 2,338 documents. NTER held **99,225 chunks and
  3,379 documents (3,376 indexed) on 2026-10-13** (`docs/research/2026-10-13-f115-cleanup.md`).
  The replica is 55% of NTER's chunk count. The 2026-10-01 NTER figure (recall 0.913) was
  measured when NTER held the same 54,219 chunks. **Recall at a fixed `ef_search` falls as the
  index grows, so NTER today is probably below 0.913 at 40, and needs more `ef_search` than the
  replica.** I could not measure it. The questions and gold chunks are still valid on NTER; the
  extra 45,000 chunks are distractors. This is why I recommend 200 and not 150.
- **Two graphs, two answers.** The 2026-10-01 note showed that independently built graphs lose
  different questions (Budget and Industry were lost on NTER's build, not on the replica's). The
  replica's build is not NTER's build. The size of the gain on NTER is unverified. On the
  replica, the gain is 8 of 8 lost questions recovered.
- **Time is noisy.** The laptop was shared with other agents' lint, test and SQL runs while
  this ran (load average 8–29 on 8 CPUs; 8.4 at the start and end of the final run). The interleaved design makes the
  settings comparable with each other, but absolute times, and especially p95 and the
  multi-second exact outliers, are inflated. Times are warm. A cold cache after an NTER restart
  costs about 2 s once (2026-10-01 note), whatever `ef_search` is.
- **Server time only.** The times exclude the Edge Function, the network and the embedding call.
  The 2026-10-01 harness figures (broad p50 86 ms) include a 73 ms ping floor.
- **One query at a time.** No concurrency test was run. Higher `ef_search` costs more CPU per
  search (mean 10 ms at 200 against 5 ms at 40, and 22 ms at 400). Under many simultaneous
  searches the cost adds up, and I did not measure it.
- **Planner estimate on NTER.** The flip point (about 500) is from the replica's planner
  estimates. NTER needs its own `EXPLAIN` at the chosen value (read-only, owner approval).
- **Not measured:** the half-precision exact reference; `hnsw.iterative_scan` (candidate I of
  2026-10-01 scored 167 against 171 for the feature branch, so it was not repeated);
  rebuilding the index with a higher `ef_construction` or `m`, which could also raise recall;
  the unscoped branch with `p_desk_tier` set (the same index-then-filter loss applies to it).

## Recommendation

1. **Set `hnsw.ef_search = 200` in the unscoped branch of `match_documents`.** On the replica
   it recovers all 8 lost questions (162 to 170 of 184; recall@40 0.920 to 0.991) for about
   2 ms more at the median and 9 ms at p90. 150 is as good on this data and cheaper; 200 is
   chosen for NTER's larger index. 400 adds about 6 ms at the median and 36 ms at p90 for a
   further 0.003 of recall, so it is not worth it.
2. **How to apply it.** A new migration that re-creates `match_documents` with the same
   signature, return columns and grants, and in the unscoped branch only (`elsif p_desk_feature is null`):

   ```sql
   -- NTER refuses a function-level SET clause for this setting (non-superuser, placeholder):
   -- see the comment on match_documents_feature_hnsw in 20261001100000.
   declare v_previous text := current_setting('hnsw.ef_search', true);
   ...
   perform set_config('hnsw.ef_search', '200', true);
   return query ... ;   -- the existing unscoped select, unchanged
   perform set_config('hnsw.ef_search', coalesce(nullif(v_previous, ''), '40'), true);
   ```

   This is the same pattern `match_documents_feature_hnsw` already uses (it sets 400 and
   restores). The scoped and feature branches stay byte for byte as they are. The down
   migration is the previous definition.
3. **Verify before and after on NTER.** With owner approval: one read-only
   `EXPLAIN (ANALYZE, BUFFERS)` of the unscoped query at `ef_search` 200 (confirm the plan is
   the index scan and the time), then
   `npx vite-node --config vitest.config.js scripts/eval-retrieval.mjs -- --set eval/retrieval/questions.v1.jsonl --modes broad --target live --label ef200 --compare <baseline.json>`
   against a baseline taken before the migration. If NTER's recall at 200 is still below
   about 0.98, raise toward 300 (the planner flip is the ceiling) or look at rebuilding the
   index with a higher `ef_construction`.
4. **Leave T at 15,000.** Revisit lowering it only together with the exact fallback described
   above, measured end to end, and only if Regulatory's 733 ms exact scan becomes a real
   problem under load.
5. **Record in `docs/plans/open-work.md`** (not done here; outside this task's write scope):
   F35 measured on the replica, the migration to write, and the NTER confirmation step.
