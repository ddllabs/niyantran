# Hybrid round 2 and contextual headers: the matrix on the tuning sets

> **Status: Living (2026-11-05).** Task T7 of the
> [hybrid round 2 and contextual headers plan](../plans/2026-11-04-hybrid-and-contextual-retrieval.md). Everything here
> is from local rehearsal copies. The sealed set has not been run, so this is not the verdict. Round 2 was tuned on
> the development set and on v2; the headers were not.

## Copies and arms

- `niyantran_rehearsal_c2hybrid`: chunks embedded as today, final hybrid functions (migration sha256 `2978589e…`), and
  the recipe arm of `scripts/eval-replica/recipe-arm.sql`.
- `niyantran_rehearsal_c2headers`: the same, without the recipe arm, with all 392,945 chunks embedded with headers
  (US$2.17) and compacted with `vacuum full`.
- Arms: vector-only, headers only, hybrid only, headers plus hybrid, and Supabase's recipe. The recipe arm keeps the
  recipe's query, `english`, ranking, 60 candidates a side and k = 50; what had to change is in the file's header.

Result files are `eval/retrieval/results/*-t7-*`, at commit `6b4d6a35`.

## Feature search, top 5 / 10 / 40

Generated, non-ambiguous v2 questions, recomputed from the result files:

| Arm | NCLT (56) | Bills (60) | Parliamentary Questions (60) | Regulatory (60) |
|---|---|---|---|---|
| Vector-only | 29/29/34 | 51/55/59 | 49/55/57 | 51/54/57 |
| Recipe | 29/29/34 | 51/55/59 | 49/54/57 | 51/54/57 |
| Hybrid only | 42/44/47 | same as vector | same as vector | same as vector |
| Headers only | 43/46/47 | 54/56/58 | 47/49/56 | 50/53/56 |
| Headers plus hybrid | 44/47/48 | 54/56/58 | 47/49/56 | 50/53/56 |

Development set, NCLT (30 questions): vector 19/19/21, recipe 19/19/21, headers 18/21/25, hybrid 22/23/25, both
19/22/26. Bills and Regulatory hold 5/5/5 in every arm. Parliamentary Questions go 4/4/5 to 4/5/5 with headers.

Hybrid only loses nothing from the top 10 on either set. Adding headers to hybrid on NCLT gains 6 and loses 2 on v2
(generated and developer questions together), and gains 2 and loses 3 on the development set (q-0011, q-0021, q-0029).

Broad search on v2 (305 scored questions): doc@10 vector 250, headers 267 (31 gained, 17 lost). Hybrid does not act in
broad or focused mode, and focused is 305/305 in all four arms.

## Where the headers' losses come from

Exact search, ranking chunks as the eval does, on the two copies against the same 317 questions. Per-question ranks are
in `eval/retrieval/results/2026-11-05-t7-exact-chunk-ranks.json`.

| Search | NCLT (56) | Bills (60) | Parliamentary Questions (60) | Regulatory (60) |
|---|---|---|---|---|
| Vector, index | 29/29/34 | 51/55/59 | 49/55/57 | 51/54/57 |
| Vector, exact | 33/33/40 | 51/55/59 | 49/55/57 | 51/54/57 |
| Headers, index | 43/46/47 | 54/56/58 | 47/49/56 | 50/53/56 |
| Headers, exact | 44/47/49 | 56/58/60 | 47/49/56 | 50/53/56 |

- **Parliamentary Questions and Regulatory:** the index matches exact search, so these losses are the embedding itself.
  No index setting recovers them. The six Parliamentary Questions lost are questions about a detail of a passage; the
  right chunk moves further from the question than its rivals do. The number of nearby rival documents mostly fell,
  so this is not crowding.
- **Bills:** with a perfect index the headers would gain 4 and lose 1 in the top 10. The index loses two of them
  (q-0115, q-0130), rank 1 by exact search and absent from the 40 returned.
- **NCLT:** headers gain 17 and lose 3 by exact search; the index loses one more.
- **Today's NCLT index misses answers.** Vector-only at `hnsw.ef_search` 400 finds 5 fewer of the 70 NCLT questions in
  its top 10 than exact search (generated and developer). This is independent of hybrid and headers. Open work F284.

## Latency

Feature search, 317 v2 calls, p95 in seconds, `authenticated` under RLS. The Mac slept during the recipe arm, between
the first and second passes, and the host was still busy when the second pass began. The recipe arm's latency is not
valid and is left out.

| Arm | Pass 1 | Pass 2 | Pass 3 | NCLT only, last pass |
|---|---|---|---|---|
| Vector-only | 1.1 | 1.5 | | 1.7 |
| Headers only | 1.4 | 1.3 | | 1.6 |
| Headers plus hybrid | 2.3 | 1.5 | | 3.2 |
| Hybrid only | 2.6 | 4.2 | 4.3 | 6.4 |

Hybrid only exceeded 8 s on three calls in pass 2 and one in pass 3, with `hybrid-v2-p2` peaking at 23.7 s. One such
question timed twice in a row, as `authenticated` with no vectors in memory: 22.2 s then 1.2 s on the hybrid copy,
12.1 s then 1.2 s on the headers copy. So warm hybrid is close to vector-only (about 1.1 s) and the tail is cold reads.
The local cluster has `shared_buffers` 512 MB in 3.8 GiB, shared by several 10 GB copies; NTER has 2 GB in 8 GB. The
local figures cannot say what NTER does. A first call over the 8 s limit would fail, so cold latency on NTER blocks
production until measured. Why the two copies differ cold is not established; the headers copy was compacted.

The runs in this note did not enforce the 8 s limit: `set role authenticated` does not apply a role's settings, so a
slow call was recorded as a success. On NTER the same call would have failed. Rankings above assume every call
returns. The eval now states the limit in each call and counts a timeout as a miss.

## Not yet known

- Broad search with headers on NCLT only. Chunks with and without headers compete there, so it needs its own copy.
- Whether a higher `ef_search`, or a rebuild with higher build parameters, recovers the index misses, and at what cost.
- The sealed-set result.
