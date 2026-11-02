# Retrieval baseline, 2026-11-01 (question set v2)

> **Status: Historical (dated 2026-11-01).** The first run of question set v2 on the local replica. It is step 2 of the
> [retrieval eval baseline plan](../plans/2026-11-01-retrieval-eval-baseline.md), under the
> [bulk ingestion spec](../specs/2026-11-01-bulk-ingestion.md) §4.4 and §10. Every search figure was executed on the
> replica. The facet counts were read from NTER, read-only.
>
> **Raw results**, holding ids and ranks:
> - `eval/retrieval/results/2026-11-01T12-46-19-824Z-baseline-v2.md` and `.json`
> - `eval/retrieval/results/2026-11-01-nclt-exact-vs-feature.json`, the NCLT comparison below
> - `eval/retrieval/questions.v2.build-log.json`, the build facts

## What was measured

**Question set v2** (`eval/retrieval/questions.v2.jsonl`, 317 questions). `google/gemini-3.8-flash` wrote the generated
questions and `anthropic/claude-sonnet-5` judged them. The build cost US$0.63 against a US$5 cap.

- 248 generated questions, 54 developer-written research questions, and 15 questions carried over unchanged from v1
  (Industry 12, Budget 3). 248 + 54 + 15 = 317.
- 12 generated or carried-over questions are marked ambiguous. They are scored but left out of the bars. Every bar is
  therefore over the 251 non-ambiguous questions.
- Four generated NCLT questions were removed before the set was committed, because they named private individuals
  (personal debtors and guarantors). NCLT keeps 56 non-ambiguous generated questions, above the floor of 50.
- Of the 195 v1 questions, 15 were carried over and 180 were superseded. None of the carried-over gold chunks drifted.

| Feature | Non-ambiguous (bars) | Ambiguous (excluded) | Developer |
| --- | --- | --- | --- |
| NCLT / NCLAT (Insolvency) | 56 | 2 | 14 |
| Bill Passage Probability Index | 60 | 8 | 13 |
| Parliamentary Question Database | 60 | 2 | 13 |
| Regulatory Body Watch (RBI SEBI TRAI CCI) | 60 | 0 | 14 |
| Industry Updates (Ministry Data), carried over | 12 | 0 | 0 |
| Budget Utilisation & Schemes, carried over | 3 | 0 | 0 |
| **Total** | **251** | **12** | **54** |

**Replica.** Database `niyantran_retrieval_replica`, in the `niyantran-corpus-test-db` container, loaded from NTER on
2026-11-01. Its search functions, settings and policies equal live's by fingerprint. Corpus fingerprint at the run:
17,603 documents, 392,876 chunks, latest `indexed_at` 2026-10-31T20:25:01Z. The replica holds 17,609 documents
(17,606 indexed) and 392,945 chunks, equal to NTER per feature. The fingerprint counts what search can see: it runs as
`authenticated`, and the law-listing publication policy hides 3 indexed NCLT documents and their 69 chunks. The harness
recorded commit `f7c1044b`.

**Modes.** Each question's frozen vector is sent to `match_documents`, once per mode. Ranking is the row order returned.

- `broad`: the whole corpus, no scope.
- `focused`: only the question's gold documents are allowed.
- `focused-multi`: the gold documents plus four distractors. Questions with no distractors are skipped (57 in this run).
- `feature`: scoped to the question's own feature. This is the live HNSW path for a feature.

**Measures.**

- Document hit@k: the share of questions whose first gold document ranks within the top k rows.
- Doc MRR@40: the mean of 1 / rank of the first gold document, counted as zero beyond row 40.
- Developer questions are reported on their own rows and are not in the bars.
- The results file also holds key hit@k, chunk hit@k and chunk MRR. They are not tabulated here.

## Results

### Document hit@10, generated non-ambiguous questions

| Feature | n | broad | feature |
| --- | --- | --- | --- |
| NCLT / NCLAT (Insolvency) | 56 | 26/56 (46.4%) | 29/56 (51.8%) |
| Bill Passage Probability Index | 60 | 52/60 (86.7%) | 55/60 (91.7%) |
| Regulatory Body Watch (RBI SEBI TRAI CCI) | 60 | 53/60 (88.3%) | 54/60 (90.0%) |
| Parliamentary Question Database | 60 | 54/60 (90.0%) | 55/60 (91.7%) |
| Industry Updates (Ministry Data) | 12 | 12/12 (100.0%) | 12/12 (100.0%) |
| Budget Utilisation & Schemes | 3 | 3/3 (100.0%) | 3/3 (100.0%) |
| **Overall** | **251** | **200/251 (79.7%)** | **208/251 (82.9%)** |

- Feature mode is above broad mode at hit@10 for all four large features in this run.
- Focused mode: 251/251 (100.0%) overall.
- Focused-multi mode: 247/248 (99.6%) overall. The 57 skipped questions had no distractors.

### Developer questions

| Feature | n | broad | feature |
| --- | --- | --- | --- |
| NCLT / NCLAT (Insolvency) | 14 | 10/14 (71.4%) | 10/14 (71.4%) |
| Bill Passage Probability Index | 13 | 13/13 (100.0%) | 13/13 (100.0%) |
| Regulatory Body Watch (RBI SEBI TRAI CCI) | 14 | 14/14 (100.0%) | 14/14 (100.0%) |
| Parliamentary Question Database | 13 | 13/13 (100.0%) | 13/13 (100.0%) |
| **Overall** | **54** | **50/54 (92.6%)** | **50/54 (92.6%)** |

Broad and feature are identical on every developer row, at hit@5, hit@10, hit@40 and MRR. Focused mode scores 54/54
(100.0%) overall.

### Mean reciprocal rank (Doc MRR@40), generated non-ambiguous questions

| Mode | Doc MRR@40 |
| --- | --- |
| broad | 0.597 |
| focused | 1.000 |
| focused-multi | 0.988 |
| feature | 0.622 |

The developer MRR is 0.854 in both broad and feature mode.

### Latency

| Mode | Calls | RPC p50 (ms) | RPC p95 (ms) |
| --- | --- | --- | --- |
| broad | 317 | 512.4 | 1135.8 |
| focused | 317 | 86.4 | 158 |
| focused-multi | 260 | 113.7 | 293.2 |
| feature | 317 | 1007.3 | 2856.1 |

The replica runs in Docker on the developer's laptop. These numbers compare replica runs with each other. They are not
comparable with production.

### Feature search recovery

`FEATURE_SEARCH_RECOVERY_LIMIT` was raised 0 times. Every feature-mode call returned its expected row count: 40, or 6
for the three Budget questions, where the feature holds 6 chunks on the replica.

## NCLT: the weakest feature

NCLT is the weakest feature by far. Its feature-mode document hit@10 is 29 of 56 (51.8%). The other three large
features are at 90.0% to 91.7% in the same mode. In broad mode NCLT is 26 of 56 (46.4%), and feature-mode hit@40 is 34
of 56 (60.7%). Hit@5 equals hit@10 for NCLT in both modes, so no question has its gold document at rank 6 to 10.

To separate the index from the ranking, each non-ambiguous NCLT question's live feature-mode result was compared with
an exact brute-force search over all NCLT chunks, using the same frozen vector. The exact search takes the top 40 chunks
by cosine distance, with ties broken by chunk id. It is read-only on the replica. It does not apply the law-listing
publication policy, which hides 3 of the 7,549 NCLT documents, so its figures may count hidden documents.

| Questions | Search | hit@5 | hit@10 | hit@40 |
| --- | --- | --- | --- | --- |
| Generated, non-ambiguous (56) | live, feature mode (HNSW) | 29 | 29 | 34 |
| Generated, non-ambiguous (56) | exact, all NCLT chunks | 33 | 33 | 40 |
| Developer (14) | live, feature mode (HNSW) | 10 | 10 | 10 |
| Developer (14) | exact, all NCLT chunks | 11 | 11 | 11 |

What the comparison shows:

- The approximate index loses 4 of the 56 generated questions at hit@10: q-0006, q-0008, q-0019 and q-0020 are in the
  exact top 10 but not the live top 10. It loses one developer question the same way (q-0274). No question goes the
  other way.
- Exact search itself places only 33 of 56 in the top 10, and 40 of 56 in the top 40. So 23 generated questions have
  their gold document below rank 10 even with exact search, and 16 are not in the top 40 at all.
- At 40 rows the live search misses 22 questions. Exact search misses 16 of them, so the index accounts for the other 6.
  Most of the NCLT gap is ranking, not the index.

Implications for spec §10, stated as expectations to measure, not promises:

- A per-feature partition searches the same chunks as the exact search above. It can recover at most what exact search
  recovers here: 4 more questions at hit@10 and 6 more at hit@40.
- The larger levers for NCLT are expected to be hybrid keyword search (spec §4.2) and contextual chunk headers
  (spec §4.3), because most of the gap is ranking. Plan steps 4 and 5 will measure them.
- Bias: most NCLT and CCI questions name the party in the question, which favours keyword search. A keyword gain on this
  set may therefore overstate what a user would get. The plan asks the next set to add questions that name no party.

## Facet coverage on NTER (read-only, 2026-11-01)

Counts are documents with the field filled, read from `metadata.citation`.

| Feature | Documents with a citation | Fields filled |
| --- | --- | --- |
| Bills | 1,149 of 2,893 indexed | bill_name, bill_number, bill_year, house, kind, source, version 1,149; status 1,147; introduced_on 1,145 (all ISO dates); ministry 1,141 |
| NCLT / NCLAT | 7,549 of 7,549 | case_number, forum, forum_name, kind, order_date (all ISO dates), members, case_details_found, source 7,549; remarks 7,541; petitioner and respondent 457; order_type, section, bench, order_status 0 |
| Parliamentary Questions | 6,601 of 6,683 | question_no, question_type, session, source, subject, answered_on (all D/M/Y, none ISO), asked_by, house, kind, ministry 6,601 |
| Regulatory, Industry, Budget | none | no citation object |

What this means for facet columns:

- Date facets: NCLT `order_date` and Bills `introduced_on` are ISO and can be used as they are. Parliamentary Questions
  `answered_on` is D/M/Y and must be parsed first.
- NCLT `bench` is empty on every document. A bench facet must come from another source, for example by parsing the case
  number.
- 1,744 indexed Bills (2,893 less 1,149) have no citation, and every Regulatory document lacks one. Their regulator or
  ministry has to be derived.
- A facet that is null never matches a filter. Under spec §4.5, a facet is offered as a filter only once its coverage
  is recorded here.
- Bills `ministry` is filled on 1,141 documents, but private members' bills carry a ministry too, so a ministry facet
  would misclassify them (open-work F281).

## How later steps use this

- This run is the baseline for the "no worse" gate in spec §4.4. A later step ships only if document recall@10 is equal
  or better for every feature, and p95 latency is no worse.
- A later candidate runs `scripts/eval-retrieval.mjs --compare eval/retrieval/results/2026-11-01T12-46-19-824Z-baseline-v2.json`.
  The script exits 3 when the verdict is worse.
- The NCLT figures above are the reference for spec §10 steps 3 to 5.

## Reproduce

Build the set. This is paid (capped at US$5), calls OpenRouter, and reads NTER:

```bash
npx vite-node --config vitest.config.js scripts/build-eval-set.mjs -- --set-version v2 --carry-over eval/retrieval/questions.v1.jsonl --developer eval/retrieval/developer-questions.v2.jsonl --max-usd 5 --rate 2
```

Run the baseline. This reads only the replica, which must be loaded first with `scripts/eval-replica/load.mjs`:

```bash
npx vite-node --config vitest.config.js scripts/eval-retrieval.mjs -- --set eval/retrieval/questions.v2.jsonl --target replica --modes broad,focused,focused-multi,feature --label baseline-v2
```

## Limits

- This is one run. The figures are not averaged over repeats.
- The latency figures come from a replica on a laptop.
- Each large feature has 13 or 14 developer questions. Their rows are small counts, so single questions move them a lot.
- The NCLT exact comparison does not apply the publication policy (see above).
