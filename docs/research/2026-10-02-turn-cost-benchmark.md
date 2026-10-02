# chat-turn-cost: the research turn's prompt size, measured (F41, F46 D1)

> **Status: Historical (dated 2026-10-02).** This is the measurement required by
> `docs/specs/2026-10-02-chat-turn-cost.md`.
>
> **Method:**
> - the real agent, prompt and Gemini 3.8 Flash at Low, against the local NTER corpus replica,
>   with amendment 1 (v44) in every variant;
> - **`v44`:** both prompt limits off;
> - **`capped`:** a widened search asks for 15 passages (`WIDENED_TOP_K`), and a search reply
>   stops at 24,000 characters (`TOOL_REPLY_CHARS`);
> - **kinds:**
>   - 10 narrow questions;
>   - 15 four-part briefs;
>   - 10 widened questions: the narrow ones under "Attached only" with no document named, so every
>     search is widened (`unkeyed`), as in F41's slow turn.
>
> Raw results: `eval/agent/results/2026-10-02T14-11-54-701Z.json`, $1.91. One `v44` narrow call
> failed with a provider 502. Comparisons below use the questions both variants answered.

## Results (matched questions)

| | Narrow v44 | Narrow capped | Brief v44 | Brief capped | Widened v44 | Widened capped |
| --- | --- | --- | --- | --- | --- | --- |
| n | 9 | 9 | 15 | 15 | 10 | 10 |
| Searches | 1.22 | 1.56 | 4.20 | **4.93** | 1.30 | **2.10** |
| Documents cited | 1.22 | 1.33 | 1.93 | **2.40** | 1.10 | **1.40** |
| Pages cited | 5.78 | 5.56 | 7.80 | **9.13** | 5.10 | **5.60** |
| Expected document | 9/9 | 9/9 | 14/15 | **15/15** | 10/10 | 10/10 |
| Prompt tokens per call, p50 | 13,816 | **10,159** | 23,236 | **17,192** | 13,696 | **11,042** |
| Prompt tokens per call, p90 / max | 16,135 / 21,428 | 15,080 / 15,313 | 33,185 / 67,416 | 28,285 / **50,222** | 16,135 / 21,286 | 22,349 / 23,983 |
| Call time p50 / p90 | 7.8 s / 11.3 s | **5.9 s / 9.3 s** | 3.3 s / 14.5 s | 3.0 s / 14.7 s | 7.4 s / 9.6 s | 6.1 s / 10.0 s |
| Cost per answer | $0.0148 | **$0.0134** | $0.0462 | **$0.0424** | $0.0150 | $0.0161 |

Every citation was valid in every row that completed.

**Briefs and widened questions** meet the depth pass mark and go deeper. With fewer passages per
search the model searches more, and it cites more documents and pages. Typical calls are 20–27%
smaller. The largest brief call drops from 67k to 50k tokens.

**Widened turns** trade a smaller p50 for a larger p90. The model makes 2.1 searches instead of
1.3, so later calls carry more replies. The widened turn still ends cheaper per call at the
median, and deeper.

**Narrow questions** have smaller and faster calls and cite at least as many documents. But they
cite slightly fewer pages: 5.56 against 5.78, n = 9. Only the reply cap acts on narrow questions.
A second narrow pass decides it (below): the gap holds.

## Second narrow pass, and the widened limit alone

**Narrow, pass 2** (`eval/agent/results/2026-10-02T14-20-01-250Z.json`, 15 questions, $0.52):
- `capped` cites 1.13 documents against 1.40, and 3.93 pages against 4.07;
- the expected document is 14/15 against 15/15;
- it searches more (2.00 against 1.27), so its p90 prompt per call is larger, not smaller
  (29.8k against 24.0k).

**Pooled over 24 matched narrow questions:**

| | v44 | capped |
| --- | --- | --- |
| Searches | 1.25 | 1.83 |
| Documents cited | 1.33 | 1.21 |
| Pages cited | 4.71 | 4.54 |
| Expected document | 24/24 | 23/24 |

**The reply cap misses the depth pass mark on narrow questions,** in both passes. By the spec's rule
it is turned off. It stays as an option (`toolReplyChars`), off unless asked for.

**The widened limit alone** (`wideonly`: 15 passages on a widened search, reply cap off;
`eval/agent/results/2026-10-02T14-25-45-208Z.json`, 10 widened questions, $0.40):

| | v44 | wideonly |
| --- | --- | --- |
| Searches | 1.50 | 2.80 |
| Documents / pages cited | 1.10 / 5.00 | **1.70 / 5.70** |
| Expected document, valid citations | 10/10, 10/10 | 10/10, 10/10 |
| Prompt tokens per call p50 / p90 / max | 14,125 / 30,388 / 40,096 | 14,464 / 36,118 / 42,855 |
| Total p50 | 9.2 s | 10.9 s |
| Cost per answer | $0.017 | $0.023 |

**It deepens widened answers but does not shrink them.** Given 15 passages, the model searches
again. It cites more documents and pages, and the prompt per call does not fall. Turns take about
1.7 s longer and cost about $0.005 more.

## Prompt size barely drives call time

Across all 289 calls of these runs:
- prompt tokens and call time correlate weakly (Pearson r = 0.14), about **82 ms per 1,000
  tokens**;
- **call time by prompt size:**

  | Prompt | p50 | p90 |
  | --- | --- | --- |
  | Under 12k tokens | 5.0 s | 12.2 s |
  | 12–20k | 3.5 s | 9.8 s |
  | 20–30k | 3.9 s | 16.4 s |
  | Over 30k | 9.0 s | 15.8 s |

F41's turn spent 46 s in one call on a 25,850-token prompt. At this rate its prompt explains about
2 s of that. The rest is the provider's own latency (queueing, a slow route, or long output), which
no prompt cap removes.

## Conclusion

1. **The reply cap is off** (it missed the narrow pass mark).
2. **The widened limit** passes the depth mark and makes widened answers deeper, but not faster or
   cheaper. Keeping it is the owner's call: depth is the standing priority, but F41 asked for
   speed.
3. **F41's slowness is not prompt size.** The NTER log (below) shows provider latency: about 21
   tokens a second on one call, and 18.6 s before 29 tokens on the next.

**Total spent on this measurement:** $2.83.

## F41's slow call, read on NTER (owner-approved read-only query, 2026-10-02)

One query read the turn's `model_call_logs` rows: timing, token, route and status columns only, no
content or user fields. The turn is 2026-10-01 06:44 UTC.

| Call | Route | Latency | Prompt (cached) | Output tokens | Reasoning |
| --- | --- | --- | --- | --- | --- |
| Embedding | OpenAI | 0.6 s | 12 | — | — |
| `chat_answer` | Google AI Studio | **46.1 s** | 25,850 (17,367) | 986 | 0 |
| `chat_answer` | Google (Vertex) | **18.6 s** | 17,432 (17,252) | 29 | 0 |

**The provider was slow, not the prompt:**
- 986 output tokens in 46 s is about 21 tokens a second;
- the second call took 18.6 s to write 29 tokens, almost all of it before the first token;
- two thirds of each prompt was already cached.

The fix is in the route rather than the prompt. A candidate: OpenRouter's provider preferences
(sorting providers by throughput or latency, or a time limit on the first token with fallback).
Like the caps here, it would be measured before it ships.

## The student persona (reported, not changed)

`student.md` is 48,816 characters, against 1.2–1.9k for the other personas. That is about 12k
tokens on every call of a student-persona turn: more than the whole median call above. The owner
chose to leave it as it is.

## Provider routing (amendment 1), measured 2026-10-02

**Method:** the same agent and model as above, on `research-chat` v45 code. Each variant sends a
`session_id`, and the variant order rotates per question.
- **`v45`:** OpenRouter's default routing;
- **`thru`:** `provider.sort: 'throughput'`;
- **`lat`:** `provider.sort: 'latency'`.

The run covered 10 narrow questions and 15 briefs. Raw results are in
`eval/agent/results/2026-10-02T15-58-08-455Z.json`, $2.43. Every run completed.

| | Narrow v45 | thru | lat | Brief v45 | thru | lat |
| --- | --- | --- | --- | --- | --- | --- |
| Searches | 1.10 | 1.40 | 1.10 | 4.47 | 3.07 | 2.80 |
| Documents cited | 1.10 | 1.30 | 1.20 | 2.47 | 2.13 | 2.27 |
| Pages cited | 5.30 | 5.50 | 4.90 | 8.27 | 7.80 | 7.33 |
| Expected document | 10/10 | 10/10 | 10/10 | 15/15 | 14/15 | 15/15 |
| Valid citations | 10/10 | 10/10 | 10/10 | 15/15 | 15/15 | 15/15 |
| Call time p50 / p90 | 6.7 / 27.1 s | 3.8 / 5.9 s | 4.1 / 5.1 s | 3.9 / 16.3 s | 2.3 / 8.3 s | 2.1 / 7.5 s |
| First word p50 / p90 | 7.6 / 29.9 s | 4.0 / 13.2 s | 4.9 / 8.3 s | 23.8 / 63.3 s | 9.9 / 17.8 s | 8.5 / 13.1 s |
| Total p50 / p90 | 12.3 / 32.5 s | 7.5 / 15.3 s | 7.5 / 10.1 s | 35.3 / 75.0 s | 15.9 / 22.1 s | 12.9 / 17.5 s |
| Cost per answer | $0.015 | $0.018 | $0.014 | $0.053 | $0.042 | $0.036 |

**Both sorted routes are much faster and, on briefs, cheaper, but they answer briefs with less
depth.** They search less, and cite fewer documents and pages.
- **The amendment's ship rule fails for both.** `thru` misses the depth mark on briefs and raises
  narrow cost by 18%. `lat` misses the depth mark on narrow pages (4.9 against 5.3) and on briefs.
- **By the rule, routing stays as it is.** The owner is discussing it: the speed gain is large,
  the depth loss modest, and this is one pass.
- **The 15-passage widened limit barely touches this run.** Narrow questions and briefs run
  under "Broad context", which never widens. The only exception is a retry after an empty scoped
  search, which the results do not count, and it ran the same way in all three variants.
