# Hybrid search, round 1 (2026-11-02)

> **Status: Historical (2026-11-04).** Record of hybrid search round 1, measured on a rehearsal copy. Round 1 does not ship.
> The work continues in round 2 and contextual chunk headers, under:
> - [Hybrid search round 2 and contextual chunk headers](../plans/2026-11-04-hybrid-and-contextual-retrieval.md)
> - [Phase C: hybrid search and batch registration](../plans/2026-11-02-phase-c-hybrid-and-registration.md), task C1
> - [Bulk corpus ingestion spec](../specs/2026-11-01-bulk-ingestion.md), sections 4.2 and 4.4

This note reports results. It does not re-run anything. Every figure comes from the files cited beside it.

## Summary

- Round 1 adds a keyword search to the NCLT feature search. Its results are fused with the vector results. Other features are not changed.
- On a copy of the database, the migration ran in 44.2 s and added 134.7 MiB.
- On the generated question set (v2), NCLT document hit@10 rose from 29 to 40 of 56. Other features did not change.
- On the held-out developer set, NCLT document hit@10 stayed at 19 of 30. Hit@40 rose from 21 to 24.
- The held-out latency run failed its harness verdict. The run shows signs of machine load, so it says little about the migration.
- Round 1 does not ship. The gain on v2 did not carry over to the held-out set.

## 1. What was built

The migration is `supabase/migrations/20261102120000_chunk_hybrid_search.sql`. It is additive. The app does not call it yet. Its header describes the design. The parts that matter for the results:

- **Scope.** The keyword side applies to the NCLT feature only. For any other scope, `match_documents_hybrid` returns what `match_documents` returns. That includes broad search and searches that name document ids.
- **Keyword index.** A GIN index on `to_tsvector('simple', content)` on the parent table. No stored column. The `simple` configuration keeps case and section numbers whole, with no stemming.
- **Rare words.** A word counts as rare when at most 300 chunks the caller can read contain it. The function probes at most 64 words and reads at most 4,000 characters of the question.
- **Word budget.** Words with a digit come first, then the rest. Each group is ordered rarest first. A word is kept while the readable counts of the kept words sum to at most 2,000. The kept words are OR'd, and every match is ranked by `ts_rank_cd`.
- **Fusion.** Reciprocal rank fusion with weight 1 and k = 60. The vector side is the top 100 rows of `match_documents`.
- **Definer helper.** The keyword lookup runs in a definer function in schema `retrieval_internal`. The header gives the reason. Under the row-level policies, a signed-in keyword query could not use the index. The header measured 22 to 29 s for a signed-in query with no match, against 57 ms as `service_role`. A definer runs as the table owner and could see hidden rows. So the helper applies the publication rule itself, before any count or rank. At run time it compares the policy text with the list it was written against and raises an error on a mismatch.
- **Access check.** `match_documents_hybrid` runs as `security invoker`. Every returned row is read again through the caller's own policies.

**How it differs from Supabase's recipe** (plan, "Relation to Supabase's hybrid search recipe"):

- The recipe requires every word of the question (`websearch_to_tsquery`). Round 1 searches the rare words only.
- The recipe's function runs as the caller. Round 1 uses the definer helper above.
- The recipe searches the whole table. Round 1 searches inside the feature's partition.
- The recipe uses `english`. Round 1 uses `simple`.

**Still open before any apply** (migration header): check the hosted project's exposed schemas and extra search path by hand, and read the policy expressions on production.

## 2. How it was measured

- **Database.** Rehearsal copy `niyantran_rehearsal_c1hybrid`, made from `niyantran_rehearsal_b9final` (the Phase B copy, per the plan). Eval commit `00ad319d`.
- **Modes.** Broad, focused and feature. Broad and focused numbers are identical in both runs (section 3.2).
- **Question sets.**
  - v2 (`eval/retrieval/questions.v2.jsonl`): 263 generated questions. 12 are ambiguous and left out of the bar figures, which leaves 251 scored. The file also holds 54 developer questions, reported in their own rows.
  - Held-out (`eval/retrieval/developer-questions.holdout-2026-11.jsonl`): 45 developer questions. 30 are NCLT, and 5 each cover Bills, Parliamentary Questions and Regulatory. None are ambiguous.
  - Embeddings: `openai/text-embedding-3-small`, 1,536 dimensions (`*.vectors.json`).
- **Gate.** Spec section 4.4. Each step ships only if recall@10 is equal or better for every feature, and p95 latency is no worse.

## 3. Results

### 3.1 Migration on the rehearsal copy

Source: `eval/retrieval/results/2026-11-03T19-08-27-030Z-rehearsal-c1hybrid.md`

| Measure | Value |
| --- | --- |
| Copy of the database | 40.3 s |
| Migration, one transaction | ok, 44.2 s |
| ANALYZE on `documents` and `document_chunks` | 26.3 s |
| Database size, before and after | 10.13 GiB and 10.26 GiB |
| Peak growth | 134.7 MiB |
| Keyword indexes: NCLT, Bills, default, Regulatory | 72.1, 23.1, 31.6 and 7.9 MiB (sum 134.7 MiB) |
| Row counts, before and after | 17,609 documents and 392,945 chunks, unchanged |
| Reader probes during the migration | 177, none failed. Longest wait 17 ms |

The size table also lists `document_chunks_unpartitioned` (5.03 GiB), which has no keyword index. The file does not say whether it is attached to the parent. This note does not rely on it.

### 3.2 Generated set v2, feature mode

Sources: `eval/retrieval/results/2026-11-03T19-20-51-895Z-c1-vector-v2.md` (vector) and `2026-11-03T19-32-38-730Z-c1-hybrid-v2.md` (hybrid). Bar figures exclude ambiguous questions.

| Scope (n) | Measure | Vector | Hybrid |
| --- | --- | --- | --- |
| Overall (251) | doc@5 | 195 | 204 |
| Overall (251) | doc@10 | 208 | 219 |
| Overall (251) | doc@40 | 222 | 232 |
| NCLT (56) | doc@5 | 29 | 38 |
| NCLT (56) | doc@10 | 29 | 40 |
| NCLT (56) | doc@40 | 34 | 44 |
| Developer NCLT (14) | doc@10 | 10 | 12 |
| Developer, all features (54) | doc@10 | 50 | 52 |

Broad and focused tables are identical in both files. Broad overall doc@10 is 200 of 251 in both. Focused is 251 of 251 in both.

Per-question changes. The markdown files do not list these. They come from the two JSON files, with ambiguous questions excluded:

- doc@10: 13 gained, 0 lost. Every change is an NCLT question (11 generated, 2 developer).
- doc@5: 2 lost. q-0022 moved from rank 1 to rank 8. q-0043 moved from rank 4 to rank 8.
- doc@40: 1 lost. q-0040 moved from rank 25 to outside the top 40.

The hybrid file's comparison reads PASS, with 0 lost on broad doc@10. Feature doc@10 also loses nothing, but the file does not show that.

Latency, feature mode (`*-hybrid-v2.md`): RPC p95 was 1,902.3 ms for vector and 2,238.7 ms for hybrid. Network baseline p95 was 102.3 and 107.7 ms. The harness PASS. Its allowance, 1.2 times the vector p95 plus 20 ms, is about 2,303 ms. The per-call medians in the JSON show NCLT at 1,434 ms (vector) and 1,697 ms (hybrid), about 18 percent slower. Bills, Parliamentary Questions and Regulatory medians moved by about 3 percent or less.

### 3.3 Held-out developer set, feature mode

Sources: `eval/retrieval/results/2026-11-03T19-34-28-271Z-c1-vector-holdout.md` and `2026-11-03T19-38-56-889Z-c1-hybrid-holdout.md`.

| Feature (n) | Measure | Vector | Hybrid |
| --- | --- | --- | --- |
| NCLT (30) | doc@5 | 19 | 18 |
| NCLT (30) | doc@10 | 19 | 19 |
| NCLT (30) | doc@40 | 21 | 24 |
| Bills (5) | doc@10 | 5 | 5 |
| Parliamentary Questions (5) | doc@10 | 4 | 4 |
| Regulatory (5) | doc@10 | 5 | 5 |

Per-question changes (from the JSON files):

- NCLT doc@10 gained q-0003 (outside the top 40 to rank 6) and q-0023 (outside the top 40 to rank 2).
- NCLT doc@10 lost q-0025 and q-0030. Both were at rank 2 and moved to rank 13, still inside the top 40.
- NCLT doc@40 also gained q-0013 (to rank 25) and q-0017 (to rank 12). It lost q-0024 (from rank 23 to outside the top 40).
- No question outside NCLT changed rank.

Latency, feature mode:

| Measure | Vector | Hybrid |
| --- | --- | --- |
| RPC p50 | 901.3 ms | 2,346 ms |
| RPC p95 | 1,751.4 ms | 12,904.3 ms |
| Network baseline p95 | 108.6 ms | 1,806.7 ms |

Harness verdict: **FAIL**. The file gives two failures: the p95 of 12,904.3 ms exceeds 2,121.7 ms (1.2 times 1,751.4 plus 20), and 11 calls ran over 4,000 ms (the slowest at 28,991.1 ms).

From the JSON, the 11 slow calls were 7 NCLT, 3 Bills and 1 Regulatory. Per-feature medians, vector to hybrid: NCLT 901 to 2,377 ms; Bills 1,285 to 5,853 ms; Parliamentary Questions 1,289 to 2,011 ms; Regulatory 872 to 1,073 ms.

Bills and Regulatory calls run the same SQL under both modes, because non-NCLT scopes return `match_documents`. Their ranks did not change. Their slowdown, and the jump in the network baseline, point to machine load during this run. The run therefore cannot show what the migration costs. A quiet-machine run, repeated twice, is still needed (plan task T7).

### 3.4 Supabase's recipe as measured in the plan

The 2026-11-04 plan records that the recipe's query (`websearch_to_tsquery`, `english`, every word required) matched no chunk for 28 of the 30 held-out NCLT questions. The plan gives the measurement date as 2026-11-04, on the rehearsal copy. No file in `eval/retrieval/results/` records it. Treat it as the plan's figure until a result file exists.

## 4. Why round 1 does not ship

1. **The v2 gain did not carry over.** The migration header says the feature ships only after it "clearly beats vector-only on a fresh NCLT question set". The held-out set is that fresh set, and its doc@10 did not change. The plan notes that the generated v2 questions often name the party, which favours keyword search. The plan also records that 16 of the 30 held-out NCLT questions name no party. The held-out file has no field for that, so the count is the plan's.
2. **The held-out gain sits below the top 10.** Hit@40 rose by 3, but hit@10 did not move. The two questions that left the top 10 both fell from rank 2 to rank 13. The plan reads the top-40 gain as right documents that fusion ranks below the top 10. Round 2 is the planned response. A reranker is out of scope for now (plan decision D3).
3. **The latency check has no clean result.** Round 1 meets the recall wording of section 4.4 at doc@10 for every feature on both sets (equal or better). The p95 check failed, but the run is disturbed by load, so it cannot judge the step. A clean latency run is needed before the gate can pass.
4. **The held-out set has now been used.** It judged round 1, so it is a development set. A sealed second set (plan task T2) must decide round 2.

## 5. Gaps and checks

- **Two counts for one database.** The rehearsal file reports 17,609 documents and 392,945 chunks for `niyantran_rehearsal_c1hybrid`, counted by the owner. The v2 and held-out files report 17,603 documents and 392,876 chunks: the eval's fingerprint counts as `authenticated`, which does not see the 6 unpublished NCLT orders and their 69 chunks ([failure analysis](2026-11-04-hybrid-round1-failures.md)).
- **Role.** The replica target of `scripts/eval-retrieval.mjs` runs every call as `authenticated` under RLS and the 8 s timeout (the script's header); the result files do not repeat it.
- **Figures recorded elsewhere.** The "16 of 30 name no party" count is in the held-out set's commit message (`4b632365`); the embedding cost (US$0.0000287, 1,435 tokens) is in the results commit message (`2ce1f670`); the 28-of-30 recipe measurement is in the [plan](../plans/2026-11-04-hybrid-and-contextual-retrieval.md) (measured 2026-11-04 on the copy).
- **Fixture not run.** `supabase/tests/chunk_hybrid_search.sql` was not run for this note, and the note makes no claim about its result.
- **Commit.** The runs record commit `00ad319d` (task/hybrid-search after merging main); later commits on the branch add documents and eval files only, no code or SQL.

## 6. Files

- Migration: `supabase/migrations/20261102120000_chunk_hybrid_search.sql`
- Results, each as `.md` and `.json` under `eval/retrieval/results/`: `2026-11-03T19-08-27-030Z-rehearsal-c1hybrid`, `2026-11-03T19-20-51-895Z-c1-vector-v2`, `2026-11-03T19-32-38-730Z-c1-hybrid-v2`, `2026-11-03T19-34-28-271Z-c1-vector-holdout`, `2026-11-03T19-38-56-889Z-c1-hybrid-holdout`
- Question sets and vectors: `eval/retrieval/questions.v2.jsonl`, `eval/retrieval/developer-questions.holdout-2026-11.jsonl`, `*.vectors.json`
