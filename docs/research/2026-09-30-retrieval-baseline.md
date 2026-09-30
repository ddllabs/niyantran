# Retrieval baseline, 2026-09-30 (question set v1)

> **Status: Historical (dated 2026-09-30).** The first run of the `eval` harness
> (`docs/specs/2026-09-30-rag-v2-eval.md`, plan tasks T1–T5). It is the "before" that
> `retrieval-scope` must not fall below. Every figure here was **executed** against live
> NTER, read-only, as `service_role`.
>
> **Raw results**, holding ids and ranks only:
> - `eval/retrieval/results/2026-09-30T18-06-19-453Z-baseline-1.json` and `.md`
> - `eval/retrieval/results/2026-09-30T18-14-59-569Z-baseline-2.json` and `.md`

## What was measured

- **Question set:** `eval/retrieval/questions.v1.jsonl`, frozen. It has 195
  generated questions: Bills 80, Regulatory 60, Parliamentary Questions 40,
  Industry 12, Budget 3.
  - 11 are marked **ambiguous**, meaning a near-identical passage exists in
    another document. They are scored but left out of the bars, so every bar
    figure below is over **184 questions**.
  - The build cost **$0.54**: `google/gemini-3.8-flash` wrote the questions and
    `anthropic/claude-sonnet-5` judged them.
  - Two reviews:
    - the supervisor reviewed 40 questions: **39 of 40** pass
      (`eval/retrieval/supervisor-review-v1.md`);
    - 20 more were reviewed **by the supervisor on the owner's behalf, at the
      owner's request**: **19 of 20** pass (`eval/retrieval/owner-review-v1.md`).
      This is not an independent owner review.
  - The two fails (q-0172, q-0194) are trivial questions about garbled tables.
- **Corpus fingerprint:** 2,338 indexed documents, 54,219 chunks, latest
  `indexed_at` 2026-09-22T09:24:00Z. `match_documents` as in
  `20260929120100_match_documents_halfvec.sql` (read from the repo). All 195
  gold chunks are present with unchanged hashes.
- **Modes,** each with `match_count` 40:
  - `broad`: unscoped, HNSW on halfvec;
  - `focused`: scoped to the gold document;
  - `focused-multi`: the gold document plus 4 frozen distractors from the same
    feature. 3 Budget questions were skipped because the feature has only one
    document.
- **Reproducibility:** two consecutive runs gave **identical outcomes and
  identical ranked lists** for all 582 question-mode pairs. The p95 latencies
  agreed within about 6%.

## Results (non-ambiguous questions)

"Doc@k": the right document is among the first k rows. "Chunk@k": the exact gold
passage is.

| Mode | Doc@5 | Doc@10 | Doc@40 | Chunk@5 | Chunk@10 | Chunk@40 | Doc MRR | Chunk MRR |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| broad | 79.3% | **85.3%** | 90.2% | 62.5% | 69.0% | 83.2% | 0.664 | 0.458 |
| focused | 100% | 100% | 100% | 91.8% | **97.8%** | 100% | 1.000 | 0.701 |
| focused-multi | 100% | 100% | 100% | 91.7% | 96.1% | 96.1% (capped at 8 per document) | 0.994 | 0.687 |

**`broad` by feature (Doc@10):**

| Feature | n | Doc@10 | Doc@40 |
| --- | --- | --- | --- |
| Bill Passage Probability Index | 72 | 91.7% | 94.4% |
| Regulatory Body Watch (RBI SEBI TRAI CCI) | 57 | 86.0% | 94.7% |
| Parliamentary Question Database | 40 | 85.0% | 90.0% |
| Industry Updates (Ministry Data) | 12 | **66.7%** | 66.7% |
| Budget Utilisation & Schemes | 3 | **0%** | 0% |

**Latency.** Measured as round trips from the owner's laptop (India) to NTER, with
a trivial PostgREST read timed alongside each call as the network baseline
(p50 about 344 ms):

| Mode | RPC p50 | RPC p95 | Mean response |
| --- | --- | --- | --- |
| broad | 667 ms | 765 ms | 56 KB |
| focused | 368 ms | 650 ms | 16 KB |
| focused-multi | 446 ms | 727 ms | 40 KB |

## Findings

1. **Focusing on a document works almost perfectly.** When the right document is in
   scope, the exact passage is in the top 10 for 97.8% of questions. That is the case
   for extending focus to any document (`retrieval-scope`).
2. **Broad search loses small modules.** The Budget document is never found (0 of 3,
   even at 40), and 4 of 12 Industry questions are never found. Their few documents
   are swamped by 42,025 bill chunks. This is what the desk-feature pre-filter in
   `retrieval-scope` has to fix, measured by that spec's `feature`-mode bar.
3. **Eighteen questions are missed entirely in `broad`** (not in the top 40). Three
   kinds:
   - **Numbers in tables:** appropriation schedules (q-0012, q-0062) and national
     income tables (q-0193–q-0195), where the OCR tables are garbled.
   - **Metadata of the document itself:** who asked a parliamentary question, when a
     bill was introduced (q-0074, q-0153, q-0176).
   - **Administrative notices:** DPIIT committees and release calendars (q-0181,
     q-0182, q-0187, q-0188).

   Page-aware OCR (cleaner tables, unique headers kept) and later hybrid keyword
   search (open-work P6) are the levers for these. Nothing here says the index
   itself dropped them. Whether exact search finds them is measured in
   `retrieval-scope`'s replica work.
4. **The database is fast; the round trip is mostly network.** A focused search's
   RPC time is within tens of milliseconds of the network baseline. Broad search
   adds about 320 ms, including transferring about 56 KB of chunk text.

## How to compare against this baseline

```bash
npx vite-node --config vitest.config.js scripts/eval-retrieval.mjs -- \
  --set eval/retrieval/questions.v1.jsonl --modes broad,focused,focused-multi \
  --compare eval/retrieval/results/2026-09-30T18-06-19-453Z-baseline-1.json --label after-change
```

The harness aborts if any gold chunk has changed, and applies the spec's "no worse"
bar: per question, in absolute counts, with every lost question listed. If an index is
rebuilt, the baseline is re-run on the new build first.
