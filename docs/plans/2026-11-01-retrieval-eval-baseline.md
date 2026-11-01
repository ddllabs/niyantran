# Retrieval eval baseline (bulk ingestion plan step 2)

> **Status: Living (2026-11-01).** Implementation plan for step 2 of the
> [bulk ingestion spec](../specs/2026-11-01-bulk-ingestion.md) §10, against §4.4 ("Measured before it ships").
> The eval method, metrics and "no worse" bar stay those of the
> [RAG v2 eval spec](../specs/2026-09-30-rag-v2-eval.md); this plan extends its set and replica to today's corpus.
> Open work: F278.

## Current state (executed 2026-11-01, read-only on NTER)

| Feature | Indexed documents | Chunks | Questions in `questions.v1` |
|---|---|---|---|
| NCLT / NCLAT (Insolvency) | 7,549 | 225,273 | 0 |
| Bill Passage Probability Index | 2,893 | 89,014 | 80 |
| Parliamentary Question Database | 6,683 | 68,064 | 40 |
| Regulatory Body Watch (RBI SEBI TRAI CCI) | 474 | 10,548 | 60 |
| Industry Updates (Ministry Data) | 6 | 40 | 12 |
| Budget Utilisation & Schemes | 1 | 6 | 3 |

- The tooling exists: `scripts/eval-retrieval.mjs` (live or replica target, frozen vectors, fingerprint, `--compare`),
  `scripts/build-eval-set.mjs` with `src/lib/evalSet.js`, and `scripts/eval-replica/load.mjs`.
- `questions.v1` (195 questions, 2026-09-30) predates the law corpus and has fewer than 50 questions for
  Parliamentary Questions. It stays frozen and unchanged.
- The replica loader installs `match_documents` from `20260929120100_match_documents_halfvec.sql`. Live search has
  since gained the feature branch, the unscoped `ef_search` and feature recovery, so the replica's search path is stale.
- A fresh replica load (NTER, read-only through PostgREST) was started on 2026-11-01.

## Outcome

1. `eval/retrieval/questions.v2.jsonl` with its vectors and build log: at least 50 non-ambiguous questions for each
   feature above 10,000 chunks (the first four rows above), plus v1's Industry and Budget questions carried over when
   their gold chunks are unchanged. It mixes generated passage probes with developer-written research questions.
2. A replica whose search functions equal live's, checked by comparing function definitions.
3. The baseline on the replica in modes `broad`, `focused`, `focused-multi` and `feature`: document and chunk hit@k,
   MRR, p95 latency, and the count of `FEATURE_SEARCH_RECOVERY_LIMIT` per feature.
4. Facet coverage per feature on NTER (read-only), for the fields listed in the spec's §4.5.
5. A report, `docs/research/2026-11-xx-retrieval-baseline-v2.md`, with its JSON beside it.

## Interfaces fixed before dispatch

- **Question line.** v1's schema (`validateQuestionLine`) unchanged, with one addition: `source` may be `developer`,
  validated like `owner` (one or more gold documents, `gold_chunk_id` may be null). A developer question's gold set is
  the documents its writer read to write it, never documents found by searching.
- **Replica.** Database `niyantran_retrieval_replica` in `niyantran-corpus-test-db`; the harness's `--target replica`
  path is unchanged.

## Tasks

| Task | Model | Write scope | Depends on | Verification |
|---|---|---|---|---|
| A0. Replica data load; facet coverage on NTER | supervisor | none in the repo | none | load log; read-only queries in `begin transaction read only` |
| A1. Replica search path equal to live: install the current search functions from their migrations, add a check that compares each replicated function's definition with live's | Sonnet | `scripts/eval-replica/` | A0 data | the check passes against live; `npm run lint` |
| A2. Set v2 builder: per-feature targets for v2, the `developer` source, carry-over of unchanged v1 questions; unit tests | Sonnet | `src/lib/evalSet.js`, `src/lib/evalSet.test.js`, `scripts/build-eval-set.mjs` | none | `npm test -- evalSet`; `npm run lint`; no network calls by the agent |
| A2b. Developer research questions: at least 10 per large feature, written from documents read in the replica | Opus | `eval/retrieval/developer-questions.v2.jsonl` | A0 data, A2 schema | each line validates; gold documents exist in the replica |
| A3. Build v2 (paid, capped at US$5), review A1–A2b, run the baseline | supervisor build and run; Opus review | `eval/retrieval/questions.v2*`, `eval/retrieval/results/` | A1, A2, A2b | the harness's own checks; review notes |
| A4. Baseline report, open-work update, model roles in `docs/agents/coordination.md` | Haiku | `docs/research/`, `docs/plans/open-work.md`, `docs/agents/coordination.md` | A3 | supervisor reads every figure against the JSON |

- A1 and A2 run concurrently in separate worktrees: their write scopes are disjoint and they share no interface.
- Scope extensions granted by the supervisor during review: A1 also owns `src/lib/replicaCopy.js` and its test
  (the row encoder, so Vitest collects it); A2 also owns `src/lib/retrievalEval.js`, its test and
  `scripts/eval-retrieval.mjs`, so the no-worse bar counts generated questions only and developer questions are
  judged separately.
- Landed after an independent Opus review: A1 `6d8872f8`, A2 `79eb9751`.
- Task agents never read `.env.local`, call NTER or OpenRouter, or commit. The supervisor runs every command that
  reads NTER or spends money, and commits after verification.
- Fable reviews at phase gates (the partition migration and before the first bulk batch), not this step.

## Exclusions

- No change to live search, migrations, Edge Functions or production data.
- Facet filters in the harness arrive with step 3, when chunks have facet columns. Here, facet questions are scored
  in `feature` mode.
