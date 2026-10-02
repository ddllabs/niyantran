# research-coverage: measurement (F53)

> **Status: Historical (dated 2026-10-03).** This is the measurement required by
> `docs/specs/2026-10-02-research-coverage.md`. Stage 1 is done; stage 2 awaits the owner.
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

## Stage 2 (not run): regression and speed for `nudge`

`v46` and `nudge` on the 10 narrow questions and 15 briefs, one pass, at about $2.

It decides pass marks 2–4:
- no depth loss;
- narrow total time p50 within 1 s, with the nudge firing on at most 20% of narrow questions;
- cost within 10%.

It waits for the owner's go-ahead because of the overrun.
