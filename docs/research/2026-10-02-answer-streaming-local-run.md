# answer-streaming: local run, TTFT and cache measurements (plan T5)

> **Status: Historical (dated 2026-10-02).** The local run for
> `docs/specs/2026-10-02-answer-streaming.md` (approved; amendments 1 and 2).
>
> **Method:** everything below was executed on the local stack, with the 12-page bill attached
> and indexed, Gemini 3.8 Flash at Low reasoning, and real OpenRouter calls.
>
> **Evidence:** a tee on the browser's `research-chat` response timestamped every SSE frame on
> arrival. Server `timing`, `model_call_logs` and the Edge logs give the rest.
>
> **Cost:** about $0.45 in total:
> - about $0.25 of answers across 17 turns;
> - $0.13 for the direct OpenRouter cache comparison;
> - $0.05 for OCR.
>
> Nothing touched NTER except read-only copies of its model configuration and one read-only
> query of its logs.

## 1. The answer now streams

| | Old code (`main`) | New code (`task/answer-streaming`) |
| --- | --- | --- |
| Answer frames per turn | 1 (one block) | 13–37 |
| Text on screen | appears at once at the end | grows in 39 steps over about 6 s (DOM recording) |
| Server `writing_ms` | 0 | 1.8–7.8 s |

- The old code was measured in the same session: 3 turns, one `chunk` each, arriving 25.1, 15.0
  and 29.5 s after Send.
- **Retraction:** no natural retraction occurred in 14 new-code turns. The path is covered by the
  agent and handler tests (shown red against the old behaviour). A browser-side guard shows
  that the clearing frame, `patch` (0, ''), leaves only the final answer on today's live
  client, so the server can ship first.

## 2. Time to first answer word

**New code, breakpoints unchanged** (as Gemini runs today):

| | Turns |
| --- | --- |
| Server `first_answer_ms` | 9.2–25.1 s (2–3 rounds) |
| On screen, after Send | 10.2–19.0 s |

**Where the time goes**, for a warm request (second question):

| Stage | Time after Send |
| --- | --- |
| The browser re-verifies the account twice in a row (user plus profile, twice) | 0 – 918 ms |
| The request leaves the browser | 918 ms |
| Server setup to the first frame | about 1.1 s more |
| First stage label | 2.15 s |
| Each research round | 6–8 s |

- **The pre-send check runs twice** (`auth/v1/user` and `get_my_profile`, twice) before the
  request goes out.
  - Removing the duplicate, while keeping one fresh check per send, would save about 0.45 s
    locally without weakening the re-verify invariant.
  - This is the narrower option that amendment 2 promised. It needs the owner's decision.
- **The citation step at the end** can rewrite the answer. One turn sent
  `patch` (from 450, 3,048 chars) 2.9 s after the last chunk. This is out of scope and works
  as before.

## 3. CPU: the local kills were the local runtime, not the change

- **What happened:** with `policy = "per_worker"`, the local runtime counts CPU across every
  request a reused worker serves.
  - The old code reached the soft limit on the third question in a row and retired the worker
    gracefully.
  - The new code reached it on the second question. It twice went on to the hard limit
    mid-turn, which left the assistant row `running`.
- **Instrumented, local copy only:** the new per-delta handler work costs 13–18 ms per turn,
  and sending frames 4–6 ms.
- **With `policy = "oneshot"`** (a fresh worker per request), three streamed turns ran with 0 CPU
  events.
- **On NTER:** no CPU-limit or early-termination events in the 24 hours queried.
- **Conclusion:** the change adds about 20 ms of CPU per turn. The kills come from per-worker
  accumulation, which is local behaviour.

## 4. Caching

- **`session_id`:** every model call of a turn sends the conversation id (unit and handler tests).

### Gemini: per-block breakpoints are a cost-versus-latency trade-off, not a free win

**First, a synthetic A/B** (direct OpenRouter, three growing rounds, run twice). Each variant
began with a unique nonce, so it never reused a cache:

| | Cost for 3 rounds | Per call |
| --- | --- | --- |
| With breakpoints | $0.0219 | 6.2–8.4 s |
| Without | $0.0191 | 2.7–3.3 s |

With breakpoints, every call reported writing as many tokens as it read. This setup cannot show
reuse across turns, so it overstated the case against breakpoints.

**Then real turns,** same three questions, Gemini 3.8 Flash, 2 rounds each:

| | With breakpoints (today) | Without (parked patch) |
| --- | --- | --- |
| First call (search decision, about 5k prompt) | 6.2–8.0 s, $0.0008. About 4.7k tokens read from the cross-turn explicit cache of the static system prompt | 2.0–2.9 s, $0.0038–0.0046. No cache read |
| Answer call (about 14k prompt) | 8.6–16 s, $0.010–0.011 | 9.8–12.6 s, $0.013–0.014. One implicit hit of 4,011 tokens |
| `first_answer_ms` | 9.2–25.1 s | 5.1–6.4 s |
| Cost per answer | about $0.011 | about $0.018 (about +60%) |

**Decision for the owner.**
- **Dropping the breakpoints on Google:**
  - roughly halves time to first word (about 4–5 s less per research round);
  - costs about 60% more per Gemini answer at today's volume.
- **The patch is parked:** `gemini-no-breakpoints.patch`, a one-line model check plus a test.
- **Not measured:** whether Gemini's implicit cache would hit more often under production
  traffic, or with a breakpoint on the static prefix alone.

### Claude

The breakpoints work as designed. Each later round read the earlier prefix from cache and wrote
only the new tail:
- round 2 read 6,396 of 12,124 tokens (53%);
- round 3 read 12,122 of 17,850 (68%).

NTER's 24% reflects turns with few rounds, where the first call always writes. No change was
made.
