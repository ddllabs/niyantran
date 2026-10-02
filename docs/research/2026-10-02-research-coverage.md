# research-coverage: measurement (F53)

> **Status: Historical (dated 2026-10-03).** This is the measurement required by
> `docs/specs/2026-10-02-research-coverage.md`. Both stages are done, and neither fix ships.
>
> **Setup:** local only. The real agent, prompt and Gemini 3.8 Flash at Low ran against the NTER
> corpus replica, with the reviewed coverage set (`research/2026-10-02-coverage-set-review.md`:
> 15 questions, 75 points).
> - **Variants:**
>   - `v46`, as deployed;
>   - `check`, the prompt's coverage check (fix A);
>   - `nudge`, the dig nudge (fix B);
>   - `both`.
> - **Runs:** two passes, with the variant order rotated per question.
> - **Raw results:** `eval/agent/results/2026-10-02T18-24-47-260Z.json` and
>   `…T18-55-28-505Z.json`, $6.71. Every run completed.
> - **Scored by** `scripts/bench-agent/coverage_eval.py`.

## Stage 1: the coverage set (pooled over two passes, 30 answers per variant)

| Variant | Coverage | Fully covered | Searches | Nudge fired | First word p50 / p90 | Total p50 / p90 | Cost per answer | Valid | Expected bill |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `v46` | 88.0% | 17/30 (8, 9) | 2.53 | – | 8.9 / 28.3 s | 16.9 / 34.2 s | $0.033 | 30/30 | 30/30 |
| `check` | 87.3% | 16/30 (8, 8) | 3.83 | – | 15.3 / 35.3 s | 25.4 / 47.1 s | $0.053 | 30/30 | 30/30 |
| `nudge` | **94.2%** | **23/30 (11, 12)** | 3.40 | 16/30 | 21.9 / 43.4 s | 29.0 / 51.4 s | $0.058 | 30/30 | 30/30 |
| `both` | 92.3% | 21/30 (11, 10) | 4.77 | 19/30 | 30.3 / 55.8 s | 41.8 / 65.5 s | $0.080 | 30/30 | 30/30 |

**Pass mark 1** asks for coverage +10 points, or full coverage +3 questions per pass.
- **`nudge` passes, at the threshold:** full coverage +3.0 per pass, and coverage +6.2 points.
- **`check` fails:** coverage −0.7 points, full coverage −0.5 per pass, at 62% more cost.
- **`both` fails:** coverage +4.3 points, full coverage +2.0 per pass. It is worse than `nudge`
  alone, at 145% more cost.

**Where the nudge helps** (points covered, pass 1 and pass 2):
- cov-02 Coinage: 5 and 5 against 4 and 4 (forfeiture, clause 17);
- cov-07 Technology Bank: 4 and 4 against 3 and 3;
- cov-06 State Emblem: 4 and 5 against 4 and 4;
- cov-14 Population Policy: 5 and 4 against 4 and 4;
- cov-09 Domestic Violence: 3 and 6 against 3 and 3.

The cov-09 gain is one pass of two, so part of the total is noise. The rest repeat.

**The prompt check does not make the model dig.** It searches more (3.8 searches against 2.5) and
covers no more.

**The nudge's price on these questions:** it fires on about half of them and adds a model call
and a search. First word comes about 13 s later at p50, total time about 12 s later, and cost is
79% higher.

The spec's speed and cost limits apply to narrow questions and briefs, which stage 2 measures.

## Cost overrun

**Stage 1 cost $6.71 against the $3.60 estimated** in amendment 2. `nudge` and `both` make more
calls than the estimate allowed for.

**This work has spent about $7.50 in total**, against the owner's approved $3–4:
- the headroom probe, $0.44;
- the stopped run, $0.32;
- a smoke run, $0.02;
- stage 1, $6.71.

## Stage 2: narrow questions and briefs, `v46` against `nudge`

**Run** with the owner's go-ahead after the overrun. One pass, 10 narrow questions and 15 briefs.
Raw results are in `eval/agent/results/2026-10-02T20-16-31-002Z.json`, $2.91 (about $2
estimated). Every run completed. Scored by `scripts/bench-agent/coverage_stage2.py`.

| | Narrow `v46` | Narrow `nudge` | Brief `v46` | Brief `nudge` |
| --- | --- | --- | --- | --- |
| Searches | 1.10 | 2.00 | 5.27 | 5.93 |
| Documents / pages cited | 1.20 / 5.00 | 1.10 / 4.50 | 2.20 / 9.40 | 2.13 / 10.60 |
| Valid citations, expected document | 10/10, 10/10 | 10/10, 10/10 | 15/15, 15/15 | 15/15, 15/15 |
| Nudge fired | – | 6/10 | – | 9/15 |
| First word p50 | 3.6 s | 14.7 s | 21.4 s | 38.0 s |
| Total p50 | 9.7 s | 18.9 s | 30.7 s | 47.7 s |
| Cost per answer | $0.0145 | $0.0321 | $0.0650 | $0.0978 |

**The nudge fails pass marks 2, 3 and 4.**
- **Narrow questions:** it cites fewer documents and pages, and adds 9.1 s at p50 against a 1 s
  limit. It fires on 6 of 10 against a 20% limit, and costs 122% more against a 10% limit.
- **Briefs:** documents dip from 2.20 to 2.13 (pages rise). It adds 17 s at p50 and costs 50% more.

**Why it fires so often.** S2 explains at most 1 of the 6 narrow nudges, and none on briefs,
which always search more than once. So S1 did the firing.

The 13% estimate in amendment 1 was per passage cited alone. A real answer cites 5 to 10
passages, and one cross-reference among them fires S1. At 13% a passage, five cited passages fire
about half the time, which is what was measured. This should have been worked out before the run.

## Decision (T6)

**Neither fix ships.**
- **The prompt check (fix A)** failed pass mark 1.
- **The nudge (fix B)** passed pass mark 1 at the threshold but failed pass marks 2–4: it slows
  and costs ordinary questions far more than it gains.

Both stay in the code as options, off by default, as the reply cap and the widened limit do:
`PromptInput.coverageCheck` and `AgentDeps.digNudge`. Nothing changes on NTER.

**The risk, as measured:** on 15 questions built to need several parts of a bill, today's agent
covers 88% of the points and answers 57% of them in full (17 of 30). The points it misses are
provisions later in the bill than its first search reached: consequence clauses, procedure, and
extensions.

**Not pursued, for a later decision:** a narrower S1 that fires only when the cited sentence the
answer relies on names a provision, rather than any sentence in any cited passage. It would need
its own measurement.

**Total spent on F53:** about $10.40, against the $3–4 first approved. The owner approved
continuing after stage 1's overrun.
