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
  the documents its writer read and found to answer it. Keyword lookup may find candidates to complete the set (sibling
  orders, bill versions, repeated answers), but every gold document is read, and nothing is chosen by vector search or
  `match_documents*`, the system being measured.
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
- A0 replica, reloaded 2026-11-01 (2 h 12 min): 17,609 documents (17,606 indexed) and 392,945 chunks, equal to NTER per
  feature; search functions, settings and the seven policies equal to live by fingerprint; `search-smoke.sql` returns
  10 rows in all six modes. Its `replica_meta` predates A1's count columns; the counts were reconciled by hand.
- A3 prep `cffbba1e` (Sonnet): `eval-retrieval.mjs` exits 3 when a `--compare` verdict is worse; NCLT is first in
  the report order.
- A2b `547614d8` (Opus, reviewed by a second Opus): 54 developer questions (NCLT 14, Bills 13, Parliamentary
  Questions 13, Regulatory 14) with 97 gold documents. Review fixes: seven rewordings and two missed bills added to one gold set.
  Known bias: most NCLT and CCI questions name the party, which favours keyword search; the next set should add
  questions that name no party.
- A3 (supervisor): set v2 built `f7c1044b` (US$0.63; four generated NCLT questions naming private individuals removed
  before commit) and the baseline run with the NCLT exact-search comparison `51fd6644`.
- A4 (Haiku): [report](../research/2026-11-01-retrieval-baseline-v2.md), F278 and F281 in open work, and the model
  assignment in `docs/agents/coordination.md`; every figure checked by the supervisor against the result files.
- The v2 build runs without a separate `--dry-run`: the build validates the plan, carry-over and developer lines
  before it spends anything, and a dry run would read every chunk from NTER a second time.
- Task agents never read `.env.local`, call NTER or OpenRouter, or commit. The supervisor runs every command that
  reads NTER or spends money, and commits after verification.
- Fable reviews at phase gates (the partition migration and before the first bulk batch), not this step.

## Exclusions

- No change to live search, migrations, Edge Functions or production data.
- Facet filters in the harness arrive with step 3, when chunks have facet columns. Here, facet questions are scored
  in `feature` mode.
