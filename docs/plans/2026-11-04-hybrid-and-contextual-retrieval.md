# Hybrid search round 2 and contextual chunk headers (bulk ingestion plan steps 4 and 5)

> **Status: Living (2026-11-04).** Implementation plan for steps 4 and 5 of the
> [bulk ingestion spec](../specs/2026-11-01-bulk-ingestion.md) §10, building §4.2 and §4.3 under the §4.4 gate.
> Follows [Phase C](2026-11-02-phase-c-hybrid-and-registration.md) (C1 round 1). Open work: F278. Nothing here
> changes production without the developer's explicit authorization of that step.

## Current state (2026-11-04)

- **Phase B is live** on NTER: four partitions (NCLT 225,273 chunks, Bills 89,009, Regulatory 12,983, default
  68,110), production measured no worse ([runbook log](../operations/2026-11-03-phase-b-apply.md#log)).
- **Hybrid round 1** (`20261102120000_chunk_hybrid_search.sql`, `task/hybrid-search`, not applied anywhere but the
  rehearsal copy `niyantran_rehearsal_c1hybrid`): NCLT feature search only; rare words of the question, `simple`
  config, word budget 2,000, RRF k = 60 with the 100 vector rows.
  - Generated set v2 (questions often name the party): NCLT doc@10 29 → 40 of 56, nothing lost elsewhere.
  - Held-out developer set (30 NCLT questions, 16 naming no party): doc@5 19 → 18, **doc@10 19 → 19**, doc@40
    21 → 24. Gained in the top 10: q-0003, q-0023; lost: q-0025, q-0030.
  - Its latency run failed (feature p95 12.9 s) but is suspect: unchanged Bills and Regulatory calls were also slow
    and the network baseline spiked.
  - Conclusion: round 1 does not ship. Its keyword side helps when the question names the party, and the top-40
    gain shows it finds right documents that RRF then ranks below the top 10.
  - The held-out set has now been used to judge, so from here it is a **development set**. The final verdict needs
    a new sealed set (T2).
- **Chunks today embed their text alone.** NCLT chunks average 881 characters (about 220 tokens); titles average
  51 characters. Every NCLT chunk has a date facet; Bills 50%; Regulatory none. NCLT metadata holds case number,
  order date, forum, section and order type on every document; bench on none (spec §4.5).

## Outcome

1. **Contextual headers.** Each chunk's embedding input becomes a short header built from its document, then the
   chunk text. The stored text is unchanged; `embed_hash` records the header version. Headers are built by a pure
   function per feature from stored metadata, unless D1 picks a model-written context.
2. **Hybrid round 2.** The keyword side also sees the header, so a chunk that says "the appeal is dismissed" matches
   the company's name and case number (contextual keyword search). Fusion is tuned from a failure analysis of round 1.
3. **One measured matrix**, not one step at a time, because the two interact. Arms: vector-only, headers only,
   hybrid round 2 only, headers plus hybrid round 2. Each arm is judged per feature on v2, on the development set,
   and once, at the end, on the sealed set.
4. **The vectors computed for the rehearsal are reused for production** where a chunk's text and header are
   unchanged (`embed_hash` equal), so the embedding cost is paid once.

## Decisions needed (developer)

- **D1. What the header is.**
  - Recommended: built from metadata (title, feature, case number, date, forum, section, order type; per-feature
    fields), about 40 tokens. Re-embedding all 395,375 chunks costs about US$2; NCLT alone about US$1.20.
  - Alternative: one model-written summary per document (7,549 NCLT documents), used as the header of all that
    document's chunks. About 50 million input tokens; to be priced exactly, estimated US$5–20.
  - Alternative: a model-written context per chunk (the "contextual retrieval" method). 225,273 calls, each reading
    its whole document; estimated US$150–400 for NCLT even with prompt caching. Not recommended before the cheaper
    two are measured.
- **D2. A second sealed question set.** Recommended: 30 NCLT questions written by the developer the way users ask,
  half naming no party, plus 5 controls each for Bills, Parliamentary Questions and Regulatory. Not seen by anyone
  tuning until the final run, then judged once.
- **D3. Reranker.** Out of scope for this plan (it adds a model call per search, a cost per chat). The top-40 gain is
  recorded as the reason to consider one later.
- **D4. Gate for NCLT.** Recommended: on the sealed set, NCLT doc@10 at least 3 of 30 better than vector-only with no
  lost question in the other features, and feature p95 no worse than the §4.4 allowance on a quiet machine, run twice.

## Tasks

| Task | Model | Write scope | Depends on | Verification |
|---|---|---|---|---|
| T1. Research note for round 1: the design as built, the measurements above, the per-question changes, why it does not ship | Haiku | new `docs/research/2026-11-02-hybrid-search.md` (the migration's header already cites it) | none | facts match the committed result files; links resolve |
| T2. Sealed set 2 | developer | new `eval/retrieval/developer-questions.sealed-2026-11.jsonl` (the questions); vectors embedded by the supervisor | D2 | the harness loads it; gold documents exist in the copy |
| T3. Round 1 failure analysis, read-only on `niyantran_rehearsal_c1hybrid`: for every NCLT question whose rank changed, and every miss in both arms, the kept words, keyword ranks and fused ranks; candidate fusion changes with their predicted effect | Sonnet | new `docs/research/2026-11-04-hybrid-round1-failures.md` | none | every claim cites a query run on the copy |
| T4. Header builder: a pure function from a document's stored fields to the header text, per feature, versioned, with the header version folded into `embed_hash`; used by the worker for new chunks | Sonnet, Opus reviews | `supabase/functions/_shared/chunkHeader.ts` and its test; `supabase/functions/ingest-worker/` embed input only | D1 | Deno tests (headers for each feature from real metadata shapes; empty fields omitted; version change changes `embed_hash`); `npm run lint` |
| T5. Re-embedding on a copy: a script that embeds header plus text for chosen features of a rehearsal copy into a side column, resumable, with a cost ceiling, and writes the vectors to a local file keyed by chunk id and `embed_hash` for reuse | Sonnet builds, supervisor runs (paid) | `scripts/eval-replica/reembed.mjs` and its offline test | T4 | offline test with a fake embedder; supervisor run with the ceiling, cost recorded |
| T6. Hybrid round 2: keyword side over header plus text (how the header reaches the index, a stored per-chunk column or a per-document `tsvector`, is chosen by measured index size and build time), fusion changes from T3; the round 1 security properties kept, with the fixture extended | Sonnet builds, Opus reviews | the C1 migration (not applied anywhere, so revised in place), `supabase/tests/chunk_hybrid_search.sql`, `supabase/tests/run.sh` entry | T3, T4 | `npm run test:sql` (no VACUITY FAIL), the security probes of round 1 |
| T7. The matrix on the copy: four arms × three sets, quiet machine, latency run twice | supervisor | `eval/retrieval/results/`, a research note | T2, T5, T6 | `--compare` per arm against vector-only; the sealed set run once, last |
| T8. Gate review | Fable | none (report) | T7 | review notes |
| T9. Production, each step separately authorized: headers in the worker and the re-embedding backfill (vectors loaded where `embed_hash` matches, the rest through the worker), then the hybrid migration, then the app switch | supervisor | runbook under `docs/operations/` | T8 and the developer's authorization | before-and-after measurement on NTER, as for Phase B |

- T1, T3 and T4 can run in parallel: their write scopes are disjoint. T5 waits on T4's header function and
  `embed_hash` rule. T6 waits on T3 and T4.
- Task agents do not read `.env.local`, call NTER or a paid API, or commit. Embedding runs are the supervisor's.
- Docker-heavy work (T3 queries, T5 runs, T7) runs one at a time; no test suites during a measured run.

## Exclusions

- No reranker, no Hindi tokenizer (`pgroonga` stays the candidate if Hindi questions fail), no change to the app's
  search calls before T9.
- No change to Phase B, C3 or the billing schema.
