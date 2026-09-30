# Feature filter: candidate measurements (retrieval-scope, T7)

> **Status: Historical (dated 2026-10-01).** Measurements that choose the feature-branch
> strategy for `match_documents` (`docs/specs/2026-09-30-rag-v2-retrieval-scope.md`,
> "Choosing the feature-branch strategy"). Every figure here was **executed** on the local
> replica (`scripts/eval-replica/`), and every comparison is replica against replica.
> Raw results are in `eval/retrieval/results/replica/`.

## Set-up

- **Replica.** `niyantran_retrieval_replica` in `niyantran-corpus-test-db` (pgvector
  **0.8.6**; NTER runs 0.8.2). It holds a read-only copy of NTER's 2,338 documents
  (without `ocr_text`) and 54,219 chunks with embeddings, taken on 2026-09-30 in 499 s at
  2 requests per second.
  - The halfvec HNSW index was rebuilt with NTER's definition: 204 MB, built in 25 s,
    single-process. A parallel build failed, because the container has only 64 MB of
    `/dev/shm`.
  - The live `match_documents` was loaded from its migration file.
  - `shared_buffers` was raised to 512 MB to match NTER. At the default 128 MB the index
    didn't fit, and latencies were noise: the first runs had p95 above 1.6 s for plain
    broad search.
- **Calls** ran through `psql` in the container as `authenticated`, under RLS and the
  8 s statement timeout. "Ping" is `select 1` through the same path, and is the overhead
  floor.
- **Questions.** `questions.v1.jsonl`, the 184 non-ambiguous questions. The `feature` mode
  passes each question's own `desk_feature`, and the bar is the eval spec's `feature` bar.

## Candidates (all with the future 5-argument signature)

| Id | Strategy |
| --- | --- |
| E | Exact: join on the feature, ordered by full-precision distance, no quota |
| Eh | Exact at half precision over the materialised feature set, then a full-precision re-rank |
| H100 / H400 / H1000 | HNSW with `SET hnsw.ef_search = N` (a per-function `SET` clause), filtered after the index scan |
| I | HNSW with `iterative_scan = relaxed_order`, a MATERIALIZED CTE, and a re-sort on `distance + 0` |
| **X** | **Hybrid: E when the feature holds at most 15,000 indexed chunks, else H400** |

## Quality (document hit@10, non-ambiguous)

| | Bills /72 | Regulatory /57 | PQ /40 | Industry /12 | Budget /3 | Total /184 | Full results? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Replica broad, no filter | 63 | 49 | 35 | 12 | 3 | 162 | — |
| E | 67 | 50 | 39 | 12 | 3 | 171 | yes |
| Eh | 67 | 50 | 39 | 12 | 3 | 171 | yes |
| H100 | 66 | 50 | 38 | 12 | 3 | 169 | **no:** PQ calls returned 0–37 of 40 |
| H400 | 67 | 50 | 39 | 12 | 3 | 171 | yes (for small features the planner chose an exact scan) |
| H1000 | 67 | 50 | 39 | 12 | 3 | 171 | yes |
| I | 63 | 50 | 39 | 12 | 3 | 167 | yes |
| **X** | **67** | **50** | **39** | **12** | **3** | **171** | **yes** |

X's chunk hit@10 (exact passage): Bills 49/72, Regulatory 43/57, PQ 37/40, Industry
12/12, Budget 3/3.

## Latency (ms, laptop replica, `shared_buffers` 512 MB)

| Run | p50 | p95 | p99 | max | Ping p50 |
| --- | --- | --- | --- | --- | --- |
| broad, no filter | 86 | 128 | 166 | 296 | 73 |
| E | 177 | 221 | 296 | 404 | 76 |
| H400 | 90 | 111 | 145 | 328 | 74 |
| **X** | **124** | **213** | **238** | 675 | 76 |
| broad while 4 concurrent **E** Bills calls run | 210 | **359** | 436 | 535 | 169 |
| broad while 4 concurrent **X** Bills calls run | 116 | **164** | 227 | 295 | 106 |

Eh, H1000 and I were measured before the cache fix. Eh had outliers up to 146 s and H1000
up to 27 s, and both failed the 4 s bar. They lose on quality ties anyway (the same as E),
so they were not re-run.

## Decision

The spec's rule is the simplest candidate that meets the `feature` bar, the absolute
latency bar (p95 ≤ 1.5 s, p99 ≤ 2.5 s), and the concurrency check.

- **E** meets quality and latency but **fails the concurrency check**. With four exact
  Bills scans running, broad p95 rises from 128 to 359 ms. The server's share, after
  removing the ping, rises about 3.5×, far outside 1.2× + 20 ms. An exact scan over 78%
  of the corpus competes with every other search.
- **H400** is fast, but it is only correct for small features because the planner happens
  to choose an exact scan there. H100 shows that when the index is used, a 2% feature gets
  0 of 40 rows. That is too fragile to rely on.
- **X meets everything:**
  - E's quality (171/184, the full `match_count` every time);
  - p95 213 ms, p99 238 ms;
  - broad p95 under load of 164 ms against 128 ms, within the bar once the ping rise is
    removed.

  **Chosen: X, with T = 15,000 chunks and N = 400.** Bills (42,025 chunks) take the index
  path. Regulatory (11,040), Parliamentary Questions, Industry and Budget take the exact
  path.

**Still required before deployment** (spec): one read-only `EXPLAIN (ANALYZE, BUFFERS)`
on NTER, as `authenticated`, for the Bills path (H400) and the Regulatory path (exact over
11k chunks), to confirm the replica's timings hold on NTER's hardware.

## A separate finding: NTER's broad search loses results to its index

An exact, index-free search over the whole corpus (diagnostic function
`match_documents_exact`, on the replica) compared with both HNSW indexes, document hit@10:

| | Bills | Reg | PQ | Industry | Budget | Total /184 |
| --- | --- | --- | --- | --- | --- | --- |
| NTER HNSW (live baseline) | 66 | 49 | 34 | 8 | 0 | 157 |
| Replica HNSW (a fresh build) | 63 | 49 | 35 | 12 | 3 | 162 |
| **Exact** | 67 | 50 | 38 | 12 | 3 | **170** |

- **Against exact search, NTER's top 40 has a recall of 0.913**, and the replica's 0.922.
  F22's recall@40 of 0.9875 was measured with stored chunk embeddings as queries, which is
  easier than real questions, and overstated it.
- **Unscoped search at `ef_search` 40 loses about 7% of answerable questions.** Two
  independently built graphs lose different ones: Budget and Industry are lost on NTER's
  build, not on the replica's.
- This is outside `retrieval-scope`, whose unscoped branch must not change. It is recorded
  as open-work **F35**: measure raising `ef_search` for the unscoped branch (for example
  100–200) with the `eval` harness before and after.
