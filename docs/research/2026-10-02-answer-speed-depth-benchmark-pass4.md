# answer-speed amendment 1: does the pre-search cost research depth? (pass 4, complete)

> **Status: Historical (dated 2026-10-02).** This completes the measurement that amendment 1 of
> `docs/specs/2026-10-02-answer-speed.md` requires. Pass 3
> (`2026-10-02-answer-speed-depth-benchmark.md`) stopped when the OpenRouter credits ran out.
>
> **Method:** as in pass 3.
> - The real agent, prompt and Gemini 3.8 Flash at Low, against the local NTER corpus replica.
> - `--kinds broad,followup`: all 15 four-part briefs again, and the 10 follow-ups.
> - Raw results: `eval/agent/results/2026-10-02T12-45-46-170Z.json`.
> - **Cost:** $3.68 in all, including $0.38 to produce the follow-ups' first answers. Every call
>   succeeded.
>
> **Variants:**
> - `baseline`: no pre-search;
> - `presearch`: v43, every turn, no note;
> - `presearch2`: amendment 1, with the note and no pre-search on follow-ups.

## Four-part briefs (15)

| | Baseline | v43 | Amendment 1 |
| --- | --- | --- | --- |
| Model calls | 4.00 | 4.93 | 4.47 |
| Searches | 3.87 | 4.93 | **4.47** |
| Documents / pages cited | 2.60 / 9.60 | 2.33 / 8.93 | **2.67 / 9.60** |
| First word p50 / p90 | 20.4 s / 38.2 s | 24.5 s / 52.0 s | **16.7 s** / 42.2 s |
| Total p50 | 28.2 s | 35.2 s | 25.7 s |
| Cost per answer | $0.047 | $0.057 | $0.054 |
| Valid / gold | 15/15 / 15/15 | 15/15 / 15/15 | 15/15 / 15/15 |

**Pooled with pass 3's 9 briefs (24 per variant):**

| | Baseline | v43 | Amendment 1 |
| --- | --- | --- | --- |
| Searches | 3.79 | 4.71 | **4.71** |
| Documents / pages cited | 2.33 / 8.25 | 2.17 / 8.00 | **2.38 / 8.50** |
| First word p50 | 21.3 s | 24.6 s | **18.1 s** |
| Total p50 | 29.2 s | 33.7 s | 32.8 s |
| Cost per answer | $0.046 | $0.059 | $0.060 |
| Gold | 23/24 | 24/24 | **24/24** |

**Amendment 1 meets the pass mark on briefs.** Against the baseline:
- it searches more;
- it cites at least as many documents and pages;
- every citation is valid, and the expected document is cited 24 of 24 times.

v43 searched as often but cited fewer documents and pages than the baseline: the depth loss that
amendment 1 was written to stop.

**Time varies between passes.** In pass 3, amendment 1 reached its first word 13 s later than the
baseline; in this pass, 4 s sooner. Pooled, it is 3 s sooner at p50 and about 3.5 s later in total.
At 9–15 questions a pass, timing differences of this size are within run-to-run noise.

**The cost** is about $0.013 more per brief.

## Follow-ups (10)

| | Baseline | v43 | Amendment 1 |
| --- | --- | --- | --- |
| Model calls | 2.90 | 2.80 | 2.80 |
| Searches | 2.00 | 2.80 | 2.10 |
| Documents / pages cited | 2.40 / 4.70 | 2.20 / 3.90 | 2.30 / 3.40 |
| First word p50 / p90 | 12.8 s / 14.3 s | 14.4 s / 24.9 s | 9.5 s / 38.2 s |
| Cost per answer | $0.030 | $0.035 | $0.030 |
| Valid / gold | 10/10 / 10/10 | 10/10 / **9/10** | 10/10 / 10/10 |

**On follow-ups, amendment 1 is the baseline configuration.** It runs no pre-search, so it adds no
note either. Its row is therefore a second sample of the baseline, and the gaps between the two
rows show the noise:
- 1.3 pages;
- 3 s at p50, 24 s at p90 (one slow answer).

Read literally, the pass mark is missed on documents and pages cited. Its rule for a miss, "the
pre-search is turned off for that type", is already how amendment 1 treats follow-ups.

**v43's verbatim pre-search drifted once.** On `q-0008` it cited 2 documents but not the expected
one. The baseline and amendment 1 both cited it. This is the follow-up risk that amendment 1
named.

## Conclusion

**Amendment 1 should ship.** With pass 3:
- narrow questions keep the whole gain: 1.3 calls instead of 3.4, and the first word in 4.7 s
  instead of 12.5 s;
- briefs keep or exceed the baseline's depth;
- follow-ups behave as the baseline does, avoiding v43's drift.

**`research-chat` is still v43 on NTER.** Deploying amendment 1 needs its own go-ahead.
