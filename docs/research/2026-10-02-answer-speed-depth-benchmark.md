# answer-speed amendment 1: does the pre-search cost research depth? (pass 3, partial)

> **Status: Historical (dated 2026-10-02).** The measurement that amendment 1 of
> `docs/specs/2026-10-02-answer-speed.md` requires.
>
> **Method:** as in `2026-10-02-answer-speed-benchmark.md` (the real agent, prompt and Gemini 3.8
> Flash at Low, against the local NTER corpus replica, 40 passages per search), extended:
> - 10 narrow questions, 15 four-part bill briefs, and 10 follow-ups;
> - per answer: the distinct documents and pages it cites.
>
> **Variants:**
> - `baseline`: no pre-search;
> - `presearch`: v43, every turn, no note;
> - `presearch2`: amendment 1, with the note and no pre-search on follow-ups.
>
> Raw results: `eval/agent/results/2026-10-02T08-49-04-640Z.json`. Spent $2.24.

## Partial: the OpenRouter account ran out of credits

From the 10th brief on, every call returned OpenRouter 402 ("requires more credits"). The results
cover:
- all 10 narrow questions;
- 9 of the 15 briefs;
- **none of the follow-ups.**

The error rows are excluded from the averages below.

## Narrow questions (10)

| | Baseline | v43 | Amendment 1 |
| --- | --- | --- | --- |
| Model calls | 3.40 | 1.30 | **1.30** |
| Searches | 2.40 | 1.30 | 1.30 |
| Documents / pages cited | 1.20 / 5.4 | 1.30 / 5.0 | 1.40 / 4.9 |
| First word p50 | 12.5 s | 4.6 s | **4.7 s** |
| Total p50 | 22.8 s | 8.9 s | 9.8 s |
| Cost per answer | $0.033 | $0.015 | **$0.017** |
| Valid / gold | 10/10 / 10/10 | 10/10 / 10/10 | 10/10 / 10/10 |

The note does not make narrow questions search more. They keep the whole gain.

## Four-part briefs (9 of 15)

| | Baseline | v43 | Amendment 1 |
| --- | --- | --- | --- |
| Searches | 3.67 | 4.33 | **5.11** |
| Documents / pages cited | 1.89 / 6.00 | 1.89 / 6.44 | 1.89 / **6.67** |
| First word p50 | 22.3 s | 25.6 s | 35.9 s |
| Total p50 | 35.1 s | 30.7 s | 45.8 s |
| Cost per answer | $0.045 | $0.062 | $0.070 |
| Valid / gold | 9/9 / 8/9 | 9/9 / 9/9 | 9/9 / **9/9** |

**Amendment 1 meets the depth pass mark on briefs:**
- it searches more than the baseline (+1.4 searches);
- it cites as many documents and slightly more pages;
- all its citations are valid, and it cited the expected document 9/9, against 8/9 for the baseline.

**The price is time and cost on briefs:**
- the first word comes about 13 s later at p50;
- each answer costs about $0.025 more.

Depth is bought with time, which is the owner's stated priority.

The extra searches add less coverage than their count suggests: 1.4 more searches buy 0.7 more
pages. Nine questions are too few to separate this from noise.

## Not yet measured

- **The other six briefs,** and a second pass.
- **The 10 follow-ups.** Amendment 1 does not pre-search a follow-up, so it behaves like the
  baseline there by construction. The run would measure how far v43's verbatim pre-search drifted.
