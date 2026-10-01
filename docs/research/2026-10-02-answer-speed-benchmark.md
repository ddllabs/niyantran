# answer-speed: the agent benchmark (pre-search against today's agent)

> **Status: Historical (dated 2026-10-02).** The measurement that
> `docs/specs/2026-10-02-answer-speed.md` requires before `research-chat` ships the pre-search.
>
> **Method:**
> - the real `runAgent`, the real system prompt (policy persona, national catalogue) and real
>   OpenRouter calls, on Gemini 3.8 Flash at Low;
> - searches through the real retrieval code against the local NTER corpus replica (2,338
>   documents, 54,219 chunks), 40 passages each;
> - the harness is `scripts/bench-agent/run.ts`; raw results are in `eval/agent/results/`.
>
> Nothing touched NTER. Cost: about $3.8 (pass 1 $2.27, pass 2 $1.40, smoke run about $0.10).

## Questions

**20 in all:**
- **15 narrow,** every ninth question of `eval/retrieval/questions.v1.jsonl`, each with a known
  gold document;
- **5 broad:** "Brief me on <title>: what it does, its key clauses, penalties and who
  administers it", on gold documents of five of them.

**Quality, per answer:**
- the envelope parses;
- **valid:** every cited handle was assigned in the turn;
- **gold:** the gold document is cited.

## Results

**Pass 1** (`2026-10-01T22-37-31-225Z.json`, with a third variant):

| | Baseline | Pre-search | Pre-search + "all queries at once" |
| --- | --- | --- | --- |
| Model calls per answer | 3.65 | **2.15** | 2.70 |
| Answered in one call | 0 | **11** | 10 |
| First word p50 / p90 | 9.1 / 36.4 s | **7.3 / 17.7 s** | 7.3 / 26.5 s |
| Total p50 / p90 | 16.5 / 44.6 s | **13.3 / 24.1 s** | 13.3 / 30.5 s |
| Cost per answer | $0.047 | **$0.029** | $0.037 |
| Prompt tokens per answer | 94.9k | **49.9k** | 81.1k |
| Valid / gold | 20/20 / 17/20 | 20/20 / **19/20** | 20/20 / 16/20 |

- **Narrow questions with the pre-search:** first word p50 3.7 s (baseline 5.6 s), and 10 of 15
  were answered in a single call.
- **Broad questions:** 3.6 calls (baseline 4.8).
- **Head to head:** the pre-search's first word came sooner on 16 of 20 questions.

**Pass 2** (`2026-10-01T22-48-08-452Z.json`):

| | Baseline | Pre-search |
| --- | --- | --- |
| Model calls per answer | 3.15 | **2.30** |
| Answered in one call | 0 | **9** |
| First word p50 / p90 | 7.6 / 23.2 s | **6.5 / 21.8 s** |
| Total p50 / p90 | 13.6 / 28.8 s | **12.5 / 28.4 s** |
| Cost per answer | $0.038 | **$0.033** |
| Valid / gold | 20/20 / 17/20 | 20/20 / **19/20** |

## Reading

**The pre-search meets the spec's gate in both passes:**
- fewer model calls (−32% on average);
- an earlier first word (p50 −1.1 to −1.8 s; p90 much lower in pass 1);
- citation validity unchanged (40/40);
- the gold document cited more often (38/40 against 34/40).

**Cost** fell 13–38%: one round fewer, and less re-sent context.

**Variance is real:** the same agent varied by about 20% between passes. These are directions with
magnitudes, not exact figures.

**"All queries at once" (batching) is not recommended.** It was worse than the pre-search alone
on calls, cost and gold citations: the model made more broad searches and cited less precisely.

**Not measured:**
- a fast routing model (step 4), which needs a design first (see the spec);
- client and network time on NTER.
