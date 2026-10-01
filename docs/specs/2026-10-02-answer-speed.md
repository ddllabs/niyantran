# Spec: faster answers: search before the first model call, measured on a benchmark (`answer-speed`)

> **Status: Normative — approved by the owner on 2026-10-02.** The owner's decisions:
> - "go ahead with your recommendations for all questions";
> - **chunks are not reduced:** "the model will lose information", so `DEFAULT_TOP_K` stays 40.
>
> **Recommendations adopted:**
> - optimise time to first word first, then total time, then cost;
> - the quality gate: every citation still checks out, and the answer does not drop the evidence
>   it used to cite;
> - skip the pre-search for small talk;
> - a measurement budget of about $5–10.
>
> Tracked as open-work F46.

## Current state (NTER, 14 days, read-only)

| Measure | Value |
| --- | --- |
| Time per answer | p50 21.7 s, p90 42.1 s |
| Cost per answer | average $0.047, p90 $0.14 (Claude $0.158; Gemini 3.8 Flash $0.020) |
| Searches per answer | 1.5 |
| Prompt tokens per answer | 57.8k |
| Model call | 7.7 s average, with a 16.3k-token prompt |
| Calls that only decide to search | 73 of 212, at 5.6 s each with an 11.1k-token prompt |
| Search time per answer | 0.9 s |

**How a turn runs today:**
1. The first model call reads the question and asks for a search.
2. The search runs.
3. The next call reads the evidence and writes the answer.

Step 1 is a whole model call spent deciding to search.

## Expected outcome

**1. Pre-search.**
- For a turn that is not small talk, the agent runs `search_documents` with the reader's
  question, before the first model call. The question is trimmed to 300 characters.
- **The scope is the turn's usual scope:** the attachments, the desk focus, and widening as
  today.
- **The model sees it as a search it had already made:** an assistant tool call followed by its
  result, built through the same tool-execution path. Handles, traces, the search budget, the
  `found` list and the thinking display ("Searching “…”…") all work unchanged.
- **The first model call can answer at once,** with the answer streaming in that call, or search
  again as it does today.
- **The search-first press no longer fires,** because a search has already run.
- **Small talk** (`conversational`) skips the pre-search.
- **A pre-search that fails** is recorded like any failed search, and the model carries on.

**2. Benchmark harness** (`scripts/bench-agent/`, local only).
- **What it runs:** the real `runAgent`, the real prompt and the real OpenRouter models.
- **What it searches:** the local NTER corpus replica (`niyantran_retrieval_replica`, 2,338
  documents and 54,219 chunks), through the same `match_documents`, with live query embeddings.
- **Variants:**
  - `baseline`, today's agent;
  - `presearch`, step 1;
  - `batch`, step 1 plus a prompt asking the model to issue all of a sweep's queries in one
    round (measure only).
- **Questions:** 20 questions from the eval set (`eval/retrieval/questions.v1.jsonl`), spread
  across desks, including broad ones.
- **Recorded per question:**
  - model calls, searches, prompt and completion tokens, cost;
  - time to first answer character, total time;
  - whether the final envelope parses and every cited handle was assigned;
  - whether the answer cites the question's expected document.
- **Results** go to `eval/agent/results/`.

**3. Steps 3 (batching) and 4 (a fast routing model)** are measured and reported, not shipped.
Step 4 needs a design decision first: today the final research call writes the answer, so a
Lite routing model would also write it.

## Acceptance evidence

**Agent tests, shown red first:**
- a non-conversational turn's first model request already contains the pre-search's tool call
  and its result;
- a conversational turn has none;
- a turn whose pre-search found evidence can be promoted on its first call;
- the search-first press does not fire after a pre-search;
- a failed pre-search is traced, and the model is still called.

**Handler test:** the question is passed as the pre-search query.

**Repository checks:** both suites, lint, build and the router import.

**The benchmark:**
- `presearch` against `baseline` on the 20 questions, run twice;
- **the gate:** model calls and time to first word improve, citation validity is unchanged or
  better, and the expected-document citation rate is not lower;
- costs are recorded.

**NTER:** deploy `research-chat`, with a go-ahead.

## Scope

**Write scope:**
- `supabase/functions/research-chat/{agent,handler}.ts` and their tests;
- `scripts/bench-agent/` (new);
- `eval/agent/` (new).

**Exclusions:**
- the passage count (the owner kept 40);
- shipping batching or a routing model (measured only);
- the finishing step (the citation ladder, about 2–3 s);
- the client.
