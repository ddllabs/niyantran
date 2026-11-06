# Ingestion proof on partitions: results

> **Status: Living (2026-11-06).** Results of [F287](../plans/open-work.md), under the
> [spec](../specs/2026-11-06-ingestion-load-proof.md) and [plan](../plans/2026-11-06-ingestion-load-proof.md). Local and
> disposable: no NTER write, no paid API. Figures come from `eval/ingestion/results/`. NTER settings were read once, in a
> read-only transaction. The disk options are in the [disk plan](../operations/2026-11-06-nter-disk-plan.md).

## Outcome

| Spec outcome | Result |
|---|---|
| 1. Registration to searchable, on every partition, by both write paths | Proved: E1, 57 of 57 checks, 37 deliberate breaks all caught |
| 2. Rerun is idempotent; a killed run stops and resumes as designed | Rerun and ordinary kill proved. A strict batch policy cannot recover after a kill ([F291](../plans/open-work.md)) |
| 3. Speed by partition size and concurrency | Measured. Speed falls and WAL per chunk rises as a partition grows |
| 4. Bytes per chunk | 13,970 bytes all-in. National v1.1 is about 8.8 GB, as estimated |
| 5. Search latency at size | Focused and feature search hold. Broad search fails the code's `LATENCY` bar. Timeouts appeared only in stalled passes, on the small copy as well as the grown one |
| 6. Disk plan | [Written](../operations/2026-11-06-nter-disk-plan.md), options costed, no choice made |

**One blocker sits ahead of the worker.** On the full-size copy a real 100-document `ingest_register_batch` call is
cancelled at the role's 60 s limit ([F290](../plans/open-work.md)). The load ran only with test-only indexes and planner
settings, in `scripts/load-proof/admission-indexes.sql`. Registration figures below depend on them.

## E1. End to end

The real worker code ran through real PostgREST as `service_role`, on a database built from the migration chain, with only
embedding, OCR and storage faked. All cases passed, on Bills, NCLT, Regulatory, Parliamentary Questions, a new feature in the
default partition, the sealed batch path and the page path. Each check was shown failing once against a deliberate break
(`e1-acceptance.json`).

Two faults in the harness itself were found by reading logs, not by exit status:

- **Crash restarts.** PostgreSQL is PID 1 in the test container. An orphan left by a `docker exec` shell that dies on a signal
  makes the postmaster crash-restart everything. This happened six times on 2026-11-06 and was reproduced on a throwaway
  container. The relay is now one process.
- **A stop rule that could not fire.** `docker logs --since` returns nothing on that container. The rule now uses `--tail`, and
  a real timeout was shown stopping a live load within 5 s.

## E2. Write load

Bills reached 445,001 chunks and Regulatory 222,540, through the real commit path, with no failed job or commit. Regulatory
is 2.4% short of its 228,000 target: 5,468 chunks of a stopped batch went unrelabelled to the default partition. The
shortfall does not affect any conclusion. Bills ran at 172.8 chunks/s overall and Regulatory at 259.1.

| Bills partition size | 100k | 150k | 200k | 250k | 300k | 350k | 400k |
|---|---|---|---|---|---|---|---|
| Chunks/s | 316 | 318 | 163 | 209 | 177 | 143 | 88 |
| WAL per chunk (kB) | 21.4 | 16.7 | 39.9 | 18.2 | 29.9 | 65.7 | 83.8 |

| Regulatory partition size | 0k | 50k | 100k | 150k | 200k |
|---|---|---|---|---|---|
| Chunks/s | 365 | 315 | 295 | 226 | 162 |

WAL averaged 38,456 bytes a chunk on Bills and 28,794 on Regulatory. Four workers beat two and eight on both desks:

| Workers | 2 | 4 | 8 |
|---|---|---|---|
| Bills chunks/s | 159 | 227 | 147 |
| Regulatory chunks/s | 223 | 340 | 254 |

Commit time on the server, in the final segments:

| ms | p50 | p95 | p99 | max |
|---|---|---|---|---|
| Bills | 190 | 2,112 | 5,270 | 16,275 |
| Regulatory | 76 | 1,071 | 3,454 | 9,033 |

Absolute speed does not transfer to NTER; WAL per chunk and the shape of the slowdown do.

**Registration.** About 75 to 78 ms a document with the test indexes, flat through 19,000 documents, against about 870 ms
unindexed.

## E3. Bytes per chunk

The load added 8.01 GB for 573,422 chunks: **13,970 bytes a chunk, all-in.** That counts chunks, their indexes,
`ingest_text_inputs`, documents and the other tables ingestion writes.

| Partition | Chunks | Bytes a chunk | HNSW as grown | HNSW bytes a chunk |
|---|---|---|---|---|
| Bills | 445,183 | 12,281 | 1,092 MB | 2,455 |
| Regulatory | 222,550 | 12,780 | 615 MB | 2,761 |

`ingest_text_inputs` took 603 MB, about 1,052 bytes a chunk. Nothing in the migrations deletes those rows, so they stay.

**Rebuild at full size**, serial, with 1 GB of maintenance memory:

| Index | Before | After | Time |
|---|---|---|---|
| Regulatory HNSW | 615 MB | 583 MB | 16 min 46 s |
| Bills HNSW | 1,092 MB | 1,091 MB | 60 min 44 s |

Live insert does not bloat the index, so the disk figure needs no rebuild allowance. The Bills build outgrew 1 GB after 283,211
tuples and slowed. NTER has 512 MB of `maintenance_work_mem`, so a rebuild there would overflow sooner.

## E4. Search at size

### What changed during the run

The first two grown passes looked acceptable. Two repeats on mains were far worse, with timeouts, so the battery caveat
first attached to the second pass was wrong. A control then ran base and grown in one sitting, in the order base, base,
grown, grown, base. The last base pass, on the smallest copy, was the worst of all: 47 timeouts.

So timeouts are not a function of size here. In the stalled passes the trivial PostgREST read timed beside each search slowed
too. Across the slowest 5% of calls, that read's median was 1,265 to 1,496 ms in the worst passes, against about 100 ms
normally, and rank correlation with search time reached 0.84. The whole chain stalled, not the search.

The cause is only partly known. Host load averaged 9 and peaked at 24 during the last base pass, from other desktop work. It
averaged 5 during the grown pass with 39 timeouts, with a peak of 12, the same average as the quiet grown pass before it, so
that stall is unexplained. Its signature matches
[F286](../plans/open-work.md), and it happened here on vector-only search, so hybrid is not the cause of F286. Same cause is
likely, not proved.

### Latency in ms, on the same 316 questions

q-0238 is left out of every pass (see below). Passes marked stalled are not evidence about size.

| Pass | Chunks | Broad p50 | Broad p95 | Feature p50 | Feature p95 | Focused p95 | Timeouts | Baseline read p50 |
|---|---|---|---|---|---|---|---|---|
| base 1 | 392,945 | 482 | 795 | 588 | 1,315 | 129 | 0 | 67 |
| base 2 | 392,945 | 482 | 741 | 570 | 1,235 | 134 | 0 | 69 |
| grown 1 | 966,392 | 756 | 1,208 | 708 | 1,257 | 129 | 0 | 70 |
| grown 2 | 966,392 | 853 | 1,542 | 1,150 | 2,096 | 267 | 0 | 75 |
| grown repeat 1, stalled | 966,392 | 1,936 | 6,514 | 1,236 | 2,802 | 280 | 6 | 143 |
| grown repeat 2, stalled | 966,392 | 1,065 | 3,008 | 1,650 | 5,782 | 240 | 6 | 93 |
| control base 1 | 392,876 | 752 | 1,098 | 870 | 2,105 | 191 | 0 | 75 |
| control base 2 | 392,876 | 802 | 1,364 | 837 | 1,950 | 177 | 0 | 83 |
| control grown 1 | 1,026,536 | 1,113 | 2,260 | 864 | 1,803 | 153 | 0 | 95 |
| control grown 2, stalled | 1,026,536 | 1,624 | 10,291 | 1,021 | 3,946 | 776 | 39 | 126 |
| control base 3, stalled | 392,876 | 840 | 1,614 | 2,825 | 11,963 | 200 | 47 | 84 |

Timeouts count broad and feature together. The control base copy is the rehearsal copy the load database was built from, so
it is the same data in a different database.

### Reading

Only passes in one sitting are compared, because the same data ran about 1.5 times slower in the afternoon than in the morning.

- **Broad search:** p50 grew 1.4 to 1.8 times and p95 1.5 to 2.1 times, for 2.5 times the chunks. Both sittings miss the code's
  bar of 1.2 × base + 20 ms. See [F292](../plans/open-work.md).
- **Feature search:** on the quiet passes p95 stayed within the bar: 1,257 against 1,235 to 1,315, and 1,803 against 1,950 to
  2,105. The second grown pass, 2,096, is above it, and the focused p50 doubled in that pass too, which points to the host.
- **Focused search:** flat.
- **Calls over 4 s:** the bar also fails any such call. The morning quiet passes had none. Control grown 1 had three, two broad
  and one feature, and the control base passes before it had none.
- **Timeouts:** none on any quiet pass. Local figures cannot say whether NTER would time out at this size. They do show that a
  stall of the whole chain pushes search past 8 s at either size.

The grown control passes carry 60,000 more Regulatory chunks than E4 specified, from the E5 windows, and rebuilt indexes.
Recall at size is not claimed, as the spec says.

### The 38-row question

q-0238 (Regulatory, 40 results) raised `FEATURE_SEARCH_RECOVERY_LIMIT` at 222,000 Regulatory chunks. That is why it is left out
above. The HNSW walk returned 38 rows at every `ef_search` tried, from 40 to 1,000, which means an island in the graph. The
harness reuses text: 42% of synthetic Regulatory chunks are exact duplicates of another chunk, the likely cause. After the
rebuild the same walk returned 200 of 200 rows, though its best distance was 0.5225 against an exact 0.3855, so the rebuilt
graph still does not reach the true nearest on this data. On the real data 0 of 232 walks on the four large desks came up
short. Treat it as not seen on real data, not as impossible, and check it in the first real batch
([F272](../plans/open-work.md)).

## E5. Hybrid's write cost

Only the GIN index on `to_tsvector('simple', content)` touches inserts, so five windows of 20,048 Regulatory chunks ran
with it on and off, at four workers.

| Window | GIN | State | Chunks/s | WAL per chunk | Index bytes a chunk | Commit p95 ms | Commit max ms |
|---|---|---|---|---|---|---|---|
| A1 | off | cold | 14.5 | 30,020 | 715 | 19,007 | 85,055 |
| B1 | on | warm | 70.2 | 38,568 | 1,141 | 3,304 | 22,977 |
| A2 | off | warm | 83.2 | 25,196 | 689 | 2,854 | 12,910 |
| B2 | on | cold | 18.8 | 49,994 | 1,195 | 13,694 | 57,309 |
| A3 | off | warm | 72.1 | 25,747 | 725 | 3,172 | 9,953 |

No window failed a commit. "Cold" means the first window after other work: A1 followed the rebuild, and B2 followed the
search passes and the index build. That label is inferred from the order and was not tested alone. Host load averaged about
10 for both B2 and A3, so it does not explain B2.

- **Disk:** about 460 bytes more a chunk, in both pairs. This is the steadiest figure.
- **WAL:** about 50% more warm, and about 100% more cold.
- **Speed:** 3 to 16% slower warm, on one warm GIN window. Too thin to state more closely.
- **Longest commit:** about twice as long warm, 23 s against 10 to 13 s.
- **Build:** 2 min 53 s and 2 min 58 s on about 1,030,000 chunks.
- **Size:** 295 MB on the synthetic copy, whose reused text understates vocabulary. On the real 392,945 chunks the `simple`
  index is 141 MB, about 359 bytes a chunk.

**Cold writes matter more than the GIN.** The first window after other work ran four to five times slower, with commits up to
85 s ([F293](../plans/open-work.md)). NTER's first batch will start cold, and so will any batch after a restart.

## What this cannot prove

- **Speed on NTER.** The local database has 512 MB of shared buffers in 3.8 GiB, and NTER has 2.5 GB in 8 GB. This laptop is
  also shared with other work, as E4 shows.
- **Real embeddings.** Synthetic vectors match the real nearest-neighbour median and not the shape:

  | Nearest-neighbour cosine | p05 | p50 | p95 | Share over 0.99 |
  |---|---|---|---|---|
  | Regulatory, real | 0.735 | 0.836 | 1.000 | 27% |
  | Regulatory, synthetic | 0.828 | 0.841 | 0.850 | 0% |

  Real Bills has 20.5% over 0.99. Real data is tighter and has near-duplicates, which may change index cost.
- **Bills through its own path.** Bills documents were admitted as question answers and relabelled, because no adapter exists
  ([F275](../plans/open-work.md)). NCLT skipped `law_prepare_intent`, and synthetic rows carry no `doc_date`.
- **Chunk shape.** The 500-chunk cap on synthetic documents touches 2.3% of Bills chunks.
- **Client timing above two workers.** The relay carries about 34 MB/s, so commit times come from the server.
- **NTER's connection limits, Supavisor and Edge Function limits.** The first validation batch tests those.
