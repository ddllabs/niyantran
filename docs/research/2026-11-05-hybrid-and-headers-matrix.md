# Hybrid round 2 and contextual headers: the matrix on the tuning sets

> **Status: Living (2026-11-05).** Task T7 of the
> [hybrid round 2 and contextual headers plan](../plans/2026-11-04-hybrid-and-contextual-retrieval.md). Everything here
> is from local rehearsal copies. Round 2 was tuned on the development set and on v2; the headers were not. The sealed
> run is [below](#the-sealed-run). It was written by agents, not by a practitioner.

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

### Under the 8 s limit

Later on 2026-11-05, feature search, 317 v2 calls, a timeout counted as a miss, NCLT compacted on every copy
(`*-t7lim-*`). Seconds:

| Arm | Run | Host load | p50 | p95 | Slowest | Timeouts | NCLT p95 |
|---|---|---|---|---|---|---|---|
| Vector-only | first | about 6 | 1.4 | 4.8 | 10.6 | 6 | 9.2 |
| Vector-only | last | about 6 | 0.9 | 1.8 | 2.6 | 0 | 2.0 |
| Hybrid only | first | about 6 to 13 | 1.4 | 5.9 | 15.2 | 7 | 8.8 |
| Hybrid only | last | about 8 | 0.9 | 2.4 | 6.4 | 0 | 5.1 |
| Hybrid, headers on NCLT | under load | about 20 | 1.3 to 1.7 | 9.2 to 9.9 | 20.5 | 31 and 32 | 9.4 to 13.3 |
| Hybrid, headers on NCLT | quiet, first | about 5 | 1.3 | 3.6 | 9.3 | 4 | 8.3 |
| Hybrid, headers on NCLT | quiet, second | about 7 | 1.1 | 3.3 | 7.6 | 0 | 5.7 |

Host load is approximate, read at the start of a run or partway through. In the runs under load, even a trivial ping
had a p95 of 1.1 s against 0.12 to 0.23 s elsewhere, and timeouts hit desks where hybrid does nothing; the copy
was healthy when checked afterwards. Those two runs say nothing about the arm. With every call returning, NCLT hits are
42/44/47 for hybrid and 44/47/48 for hybrid with NCLT headers, as above.

Warm and quiet, both candidates finish inside the limit locally, with an NCLT p95 of about 5 to 6 s against 2 s for
vector-only. Cold, every arm times out, vector-only included. Broad search with NCLT headers was timed only on an
uncompacted copy under load, so it has no valid latency yet.

## The sealed run

Run once on 2026-11-05 under the [rules committed before it](../plans/2026-11-04-hybrid-and-contextual-retrieval.md#the-sealed-run-rules-fixed-before-it-runs-2026-11-05)
(`07144f86`). 45 questions: 30 NCLT, half naming no party, and 5 each for Bills, Parliamentary Questions and Regulatory.
Fresh agents wrote them from 82 randomly drawn documents outside the tuning sets; another fresh agent checked them
against the source, dropped 12 of 57 and reworded 16 of the 45 kept. The supervisor did not read them before the run.
They were written from the document by a model, and a practitioner has not reviewed them. The set is now spent.

**The hybrid-only arm's feature pass is not clean.** It had 17 timeouts, p50 5.4 s, on every desk, including 5 on
desks where hybrid does nothing, while the same search path ran vector-only two minutes earlier with no timeout (slowest
2.0 s). Host load rose from about 3 to about 12 during that window, and the warm-up after it was also slow (24 timeouts).
The cause is not established: no autovacuum appears and no other query was found. As the rules allow, the 17
calls were repeated once, unchanged, at load about 4: none timed out, the slowest took 1.7 s. A repeat is partly warm, so
those timings flatter. One broad call of the third arm was repeated too.

Feature search, top 5 / 10 / 40:

| Scope | Vector-only | Hybrid, as run | Hybrid, timeouts repeated | Hybrid, NCLT headers |
|---|---|---|---|---|
| NCLT (30) | 13/14/22 | 12/14/16 | **18/21/25** | 18/19/23 |
| NCLT, no party (15) | 3/3/9 | 5/5/7 | 6/6/10 | 4/4/8 |
| NCLT, names a party (15) | 10/11/13 | 7/9/9 | 12/15/15 | 14/15/15 |
| Bills (5) | 4/5/5 | 3/4/4 | 4/5/5 | 4/5/5 |
| Parliamentary Questions (5) | 5/5/5 | 2/2/2 | 5/5/5 | 5/5/5 |
| Regulatory (5) | 5/5/5 | 4/4/4 | 5/5/5 | 5/5/5 |

Top-10 changes against vector-only: hybrid with repeats gains 7 and loses none; hybrid with NCLT headers gains 6 and
loses 1. Against hybrid with repeats, adding headers gains 1 and loses 3.

Broad search, top 10, all 45: vector-only and hybrid are the same (hybrid does not act there), 38; NCLT headers 42,
gaining 6 and losing 2. NCLT alone goes 13 to 17. Focused is 45 of 45 in all arms.

Read against the rules:

- **As written, with timeouts as misses:** hybrid only fails D4 (NCLT doc@10 14 to 14, 5 lost elsewhere) and hybrid with
  NCLT headers passes it (14 to 19, none lost elsewhere). The 5 lost elsewhere are timeouts on desks hybrid does not touch.
- **With the repeats, reported separately as the rules require:** both pass D4 on recall. Hybrid only is higher, 21
  against 19, so by the rule for headers they are not added.
- The two arms differ by 2 of 30, which is within noise for a set this size.

Latency against the code's bar (feature p95 at most 1.2 × vector-only + 20 ms, no call over 4 s). Neither candidate
passes locally:

| Arm | Run | Feature p95 | Bar | Calls over 4 s |
|---|---|---|---|---|
| Hybrid only | v2, quiet, last | 2.37 s | 2.15 s | 7 |
| Hybrid, NCLT headers | v2, quiet, last | 3.26 s | 2.15 s | 10 |
| Hybrid, NCLT headers | sealed | 2.03 s | 1.83 s | 0 |
| Hybrid only | sealed | 11.2 s (the slow window above) | 1.83 s | 25, with 17 timeouts |

Broad search on the sealed pass: vector-only p95 1.0 s, slowest 1.2 s, no timeouts; hybrid the same path, 1.1 s; NCLT
headers p95 4.3 s, 5 calls over 4 s, one 13.8 s timeout, which fails the bar. Focused: vector-only p95 133 ms, NCLT headers
555 ms. Every arm's figure above is stated as measured, including the hybrid pass inside the slow window.

Broad search under the 8 s limit, 317 calls, compacted copies: vector-only last pass p50 1.0 s, p95 1.9 s, slowest 4.9 s;
NCLT headers last pass p50 0.8 s, p95 1.9 s, slowest 4.9 s, no timeouts in either last pass. First passes each had one
timeout. Its p95 is within the bar; its 3 calls over 4 s, against 1 for vector-only, are not.

Slow windows hitting every desk have now appeared in three hybrid-side runs on this cluster (the two runs under load
above and this one). They were read as machine load, which fits the first two, but the cause of this one is unknown and
hybrid's own cache pressure on a 512 MB buffer cannot be ruled out. See F286.

### Gate review (T8, 2026-11-05)

Fable, read-only, recomputed every sealed and `t7lim` figure from the raw files and found them accurate. It found no
critical defect in the SQL and no test that passes on broken code, and reviewed the six `c473327b` fixes as correct.
Verdict: changes requested, no production step yet.

- As written, hybrid only fails and hybrid with NCLT headers passes recall but fails latency. With the repeats, hybrid
  only passes recall and its latency is unmeasured. Neither passes in full.
- The repeat is the sound reading for recall only: ranks are deterministic given the index, so a repeat recovers the true
  rank and flatters only latency. The rule was fixed beforehand and hybrid's cache pressure is not excluded.
- Hybrid only against headers, 21 to 19, is noise: four discordant questions, 3 to 1, sign test p about 0.6. Hybrid
  against vector-only, 7 gained and 0 lost, is credible (p about 0.016). Headers against vector-only, 6 and 1, is marginal
  (p about 0.13). Model-written questions copy party spellings exactly, which favours keyword search, so expect a smaller
  gain from real users.

## Not yet known

- Whether a higher `ef_search`, or a rebuild with higher build parameters, recovers the index misses, and at what cost.
- What caused the slow window in the sealed run (F286), and whether hybrid's calls contribute to it.
- How users split between broad and feature search, which decides how much the headers' broad gain is worth.
