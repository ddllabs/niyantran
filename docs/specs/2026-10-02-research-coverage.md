# Spec: questions that sound simple but need digging (`research-coverage`)

> **Status: Living.** Draft for the owner's approval. The owner asked "How do we close that open
> risk?" on 2026-10-02 and chose "Go ahead with the spec".

## Current state

The research agent searches as often as it judges necessary:
- each search returns the 40 nearest passages in full;
- a turn may make up to 10 searches in 12 model steps (`BUDGET`, `research-chat/agent.ts`);
- the prompt and the tool description both ask for more than one search where a question needs
  it.

It adapts. Over 89 benchmark answers at 40 passages, 29 of 34 narrow questions were answered from
one search, while every brief used 2 to 7 searches. The 10-search cap was never reached.

There is one deterministic nudge. If the model drafts an answer before any search, the harness
retracts the draft and sends `SEARCH_FIRST` once (`state.pressedToSearch`).

## Problem

**The model decides when it has enough, and it can be wrong.** A question can sound like it has
one answer while the record spreads that answer over several places. Examples:
- penalties in several clauses;
- powers in a later section that the first one points to;
- a figure in a Schedule.

The model may answer from the first 40 passages and miss the rest.

**We cannot see how often this happens.** Every benchmark measure so far counts searches,
documents and pages, or checks whether the expected document was cited. None checks whether the
answer covered everything the record holds on the question.

## Expected outcome

1. **A measurement:** a coverage test set and score, run locally, that shows how often answers
   miss parts of the record.
2. **Two fixes, kept only if the measurement shows they help:**
   - **A. A coverage check in the prompt.** Before answering, the model lists the parts the
     question needs, confirms each has a passage behind it, and follows cross-references the
     passages make to text it has not retrieved.
   - **B. A signal-triggered nudge in the harness.** It reuses the `SEARCH_FIRST` mechanism and adds
     no model call. At most once per turn, when the model starts an answer while a signal holds,
     the harness retracts the draft and asks for the specific search it skipped. The signals:
     - **S1, an unfollowed cross-reference:** a passage the turn retrieved names a section, clause
       or Schedule of its own document ("section 12", "clause 7", "the Second Schedule"), and no
       retrieved passage of that document begins that provision;
     - **S2, giving up too early:** the draft says **Not in record.** for a point, and the turn made
       fewer than two searches.

     The nudge message names what it found, for example "The passages refer to section 12 and the
     Second Schedule, which you have not retrieved". It lets the model answer anyway if those
     provisions are not needed. It fires only while the search budget has room.

## The coverage test set (`eval/agent/coverage.v1.jsonl`)

- **About 15 questions on bills in the local replica.** Each is phrased the way a reader would
  ask, so it sounds answerable in one go: "What penalties does this bill set?", "Who administers
  it, and with what powers?", "What does it change in the earlier Act?".
- **Each question has 2 to 5 points.** A point is one fact the full answer needs. Each point names
  the passage or passages that hold it, by chunk ID and content hash, as
  `eval/retrieval/questions.v1.jsonl` does. A changed passage fails loudly rather than scoring
  wrong.
- **The set is authored from the bills' own text,** read in the replica. Points must sit in
  different parts of the bill, for example a penalty in clause 10 and its cross-referenced offence
  in clause 3. A question whose points all sit in one passage is rejected: it does not test
  digging.
- **The owner spot-checks five questions** before the set is used for a decision.
- **Read only.** The replica's 2,338 legacy documents are read and never changed.

**The score:**
- **Coverage:** the share of a question's points whose passage the answer cites, averaged over
  questions. This is deterministic.
- **Full coverage:** the number of questions with every point cited.
- **Limit:** citing a point's passage is not proof the answer states the point. Ten answers per
  variant are read by hand, and any mismatch is reported.

## Measurement

**Variants,** in `scripts/bench-agent/run.ts`:
- **`v46`:** as deployed;
- **`check`:** fix A;
- **`nudge`:** fix B;
- **`both`:** A and B.

**Sets:** the coverage set, plus the existing 10 narrow questions and 15 briefs (regression).

**Runs:** every variant twice, with the order rotated per question. Today's 40-against-15 pass
showed one pass can mislead.

**Recorded:** coverage, full coverage, searches, nudge rate, first-word and total time (p50 and
p90), cost, valid citations, and the expected-document rate.

**Cost:** about $3–4 for both passes on Gemini 3.8 Flash at Low. No NTER access, and no change to
NTER until a go-ahead.

## Pass marks (a fix ships only if all hold, pooled over both passes)

1. **It covers more:** coverage on the coverage set rises by at least 10 points over `v46`, or
   full coverage by at least 3 questions.
2. **No depth loss elsewhere:** narrow and brief searches, documents and pages cited are not
   lower on average. Citations stay 100% valid. The expected-document rate is not lower.
3. **Ordinary questions stay fast:** narrow total time p50 rises by no more than 1 s. The nudge
   fires on at most 20% of narrow questions, which bounds false alarms.
4. **Cost:** no more than 10% higher on the narrow and brief sets.

If neither fix passes, the risk is recorded as measured, with its size, and nothing ships.

## Acceptance evidence

- **The test set,** with the owner's spot-check recorded.
- **Deno tests, failing first:**
  - S1 fires on an unfollowed section, clause or Schedule reference, and stays quiet when the
    provision's own passage was retrieved;
  - S2 fires on a **Not in record.** draft after one search, and not after two;
  - the nudge fires at most once a turn, never with the budget spent, and never on a
    conversational turn.
- **A prompt test:** fix A's text is present.
- **The results** in `docs/research/`, with the pass-mark decision.
- **Checks:** lint, both suites and the build pass. The router import passes if `api/` changes.

## Scope

- `eval/agent/coverage.v1.jsonl` (new);
- `scripts/bench-agent/run.ts` (variants, coverage score);
- `supabase/functions/research-chat/agent.ts` (signals and nudge, behind an option that is off
  until a fix passes);
- `research-chat/prompt.ts` (fix A, behind the same kind of option);
- the tests.

## Exclusions

- **No "Dig deeper" button.** It can come later as its own spec.
- **No verification call after each draft.** It adds a model call to every turn, which the owner
  rejected for the routing model.
- **No change to the passage count, the search budget, or provider routing.**
- **No change to NTER, or deploy, without a go-ahead.**

## Open questions for the owner

1. **The 10-point coverage gain and the 1 s narrow-time limit:** are those the right thresholds?
2. **Who spot-checks the five questions:** the owner, or someone the owner names?
