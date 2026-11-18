# Regulatory search after the v1.1 load (F355, plan task B0)

> **Status: Living (2026-11-18).** The developer said on 2026-11-18 to build keyword and vector search together for
> the Regulatory desk. The first measurement, made the same day, shows that the recipe already built for NCLT does not
> help this desk. This spec therefore measures candidates before any build. Plan:
> [national scale readiness](../plans/2026-11-18-national-scale-readiness.md), task B0. Open work: F355.

## Current state

All figures were read on NTER, read-only, as a signed-in user would search. Raw output is outside the repository.

- The search check is 55 questions written before the load, each with one reference document. A question counts when
  its reference document is in the first 10 passages returned.

  | Run | Chunks on NTER | First 5 | First 10 | First 40 |
  |---|---|---|---|---|
  | Before the load (2026-11-15) | 662,322 | 47 | 50 | 53 |
  | After the first 100 documents | 671,097 | 47 | 50 | 53 |
  | After the full load (2026-11-16) | 833,144 | 40 | 40 | 45 |

- The chat reads the first 40 passages (`DEFAULT_TOP_K` in `supabase/functions/_shared/retrieval.ts`), so the fall that
  reaches an answer is 53 to 45, not only 50 to 40.
- `match_documents_hybrid` applies keyword search to the NCLT desk alone. The constant is in the function; the helper
  `retrieval_internal.hybrid_candidate_ids` already takes any desk.
- The blind judgement of the ten lost questions is in F355: in 7 the reference answers and none of the three passages
  now ranked first does; in 3 a newly loaded passage answers at least as well.

## What was measured on 2026-11-18

1. **The NCLT recipe applied to Regulatory changes nothing.** Each question was run twice in one sitting: vector
   only, and the same three-list fusion `match_documents_hybrid` uses, with the desk set to Regulatory. Both scored 40
   in the first 5, 40 in the first 10; the first 40 were 45 and 44. No question was gained or lost in the first 10.
   Only 6 of 55 questions produced a keyword list and none a month list. The keyword rule keeps a word only when it is
   in the title of 1 to 50 documents of the desk; that rule was tuned on NCLT party names and seldom fires here.
2. **The lost references are close behind, not gone.** Of the 15 questions now outside the first 10, the reference is
   in the first 100 passages for 10, at ranks 11 to 84. Its similarity is 0.0001 to 0.09 below the tenth passage. In
   those 15 searches, 6 to 10 of the first 10 passages come from documents loaded on or after 2026-11-15.
3. **Counting each document once barely helps.** Ranking distinct documents instead of passages gives 41 in the first
   10 and 44 in the first 20.

Not measured: a keyword rule designed for this desk; a second-stage re-ranker; whether the ten questions outside the
first 10 before today would be answered correctly by the chat from what it now receives.

## Problem

The load added 2,605 documents from the same regulators on neighbouring matters. Vector similarity alone no longer
separates the passage that answers from passages on the same subject. The fix already built for NCLT does not address
this, so building it for Regulatory as it stands would spend a migration and a production step for no gain. Every
further Regulatory load (the packs hold about 100,000 more Regulatory records, not all servable) will crowd the first
10 further.

## Expected outcome

A search path for the Regulatory desk that is measured to be better than vector only on both question sets, within
the app's 4-second search limit, with a switch and a rollback like NCLT's.

## Candidates to measure, cheapest first

| | Candidate | What it costs | What the evidence above says |
|---|---|---|---|
| R1 | A keyword list with a rule for this desk: circular and notification numbers, section and regulation numbers, dates, regulator names; no title rule | SQL only; a migration | Untested. The title rule is why the present recipe is silent |
| R2 | A second stage that re-orders the first 100 passages with a re-ranking model | A model call per search: cost, latency, a new failure path | 10 of the 15 misses have the reference in the first 100, so the ceiling is 50 of 55 |
| R3 | Return more distinct documents (a cap on passages per document) | SQL only | Measured: one question. Not enough alone |
| R4 | The reference set itself: three of the ten lost questions now have an equally good newer answer | No build; changes the check | Re-judge; a fresh set is needed in any case |

R1 is measured first. R2 is measured only if R1 misses the bar below, and it needs the developer's yes before any
call that costs money.

## Acceptance evidence

1. A fresh question set for the desk, written after the load from documents loaded both before and after it, at least
   60 questions, references judged blind. Written before any candidate is tuned and not used for tuning.
2. Each candidate is run against vector only in the same sitting, on the 55 and on the fresh set, with
   `scripts/eval-retrieval.mjs --compare`. The bar: on the 55, at least 47 in the first 10 and no question that vector
   only finds is lost; on the fresh set, clearly more than vector only and none lost.
3. The measurement is shown not to be empty: a deliberately broken variant must score worse.
4. Latency on NTER, warm and after an eviction: no search above 4 s, median no worse than 1.2 times vector only.
5. Other desks return exactly what they return today, proved by a fixture.
6. A second reviewer reads the migration against the access rules, as for NCLT.

## Scope

- Measurement scripts and their output, outside the repository.
- One migration, its fixture in `supabase/tests/`, and the question set under `eval/retrieval/`, once a candidate
  passes.
- The switch: a flag row per desk, off by default, as F288 built for NCLT.

## Exclusions

- No change to NCLT search, to `match_documents`, or to any other desk.
- No Regulatory load until a candidate passes.
- No production step without the developer's specific yes and a rolled-back dry run first.
- Capacity (F279) is separate; the index a candidate needs is counted there.

## Open decisions for the developer

1. **Whether to measure R1 on NTER, read-only, or on a local copy.** The local load copy holds generated vectors for
   this desk, so it cannot judge quality. A local copy of the real Regulatory partition is one read of about 2.5 GB
   from NTER, which pushes other desks out of memory for a while. Recommendation: measure on NTER, read-only, 55 to
   115 searches a run, as today's runs were.
2. **Whether R2 may be measured if R1 falls short.** It needs model calls. Recommendation: yes, with a spending cap
   named beforehand.
