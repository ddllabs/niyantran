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
2. **Hybrid round 2.** Candidate selection and fusion are rebuilt from a failure analysis of round 1. The keyword side
   indexes the chunk text only, not the header: T3's emulation of a header-aware keyword side showed no gain, so the
   header reaches search through the embedding.
3. **One measured matrix**, not one step at a time, because the two interact. Arms: vector-only, headers only,
   hybrid round 2 only, headers plus hybrid round 2, and Supabase's recipe as written. Each arm is judged per feature on v2, on the development set,
   and once, at the end, on the sealed set.
4. **The vectors computed for the rehearsal are reused for production** where a chunk's text and header are
   unchanged (`embed_hash` equal), so the embedding cost is paid once.

## Relation to Supabase's hybrid search recipe

Round 1 follows Supabase's recipe (`docs/guides/ai/hybrid-search`, function `hybrid_search`): a full-text search and a
vector search run separately and are fused by reciprocal rank fusion, with `full_text_weight`, `semantic_weight` and
`rrf_k`. It departs from it where the recipe does not fit this corpus:

- **The query.** The recipe matches `websearch_to_tsquery(query_text)`, which requires every word of the question.
  Measured 2026-11-04 on the rehearsal copy (`english`, as the recipe's default): 28 of the 30 held-out NCLT questions
  match no chunk at all, so for them the recipe returns vector search alone. Round 1 searches the question's rare
  words instead.
- **Row-level security.** The recipe's function runs as the caller. Under this table's restrictive policies the
  keyword match cannot use its index for a signed-in user (22 to 29 s measured), so round 1 uses a definer helper
  that applies the publication rule itself.
- **Scope.** The recipe searches the whole table; round 1 searches inside the feature's partition.
- **Text configuration.** `simple` instead of `english`, so case and section numbers stay whole.

T7 adds the recipe as written (its query, `english`, k = 50, 60 candidates a side) as a fifth arm, so the choice is
measured rather than argued.

## Decisions (developer, 2026-11-04)

D1 to D4 approved as recommended: headers built from metadata; a second sealed set written by the developer;
no reranker; the NCLT gate as stated.

## Decisions as proposed

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
| T2. Sealed set 2 | developer | filled in outside the repo as `~/niyantran-eval-cache/sealed-set-2026-11.csv`, unread by anyone tuning; a script converts it to `eval/retrieval/developer-questions.sealed-2026-11.jsonl` and embeds it just before the final run, printing only counts and unresolved row numbers | D2 | the harness loads it; gold documents exist in the copy |
| T3. Round 1 failure analysis, read-only on `niyantran_rehearsal_c1hybrid`: for every NCLT question whose rank changed, and every miss in both arms, the kept words, keyword ranks and fused ranks; candidate fusion changes with their predicted effect | Sonnet | new `docs/research/2026-11-04-hybrid-round1-failures.md` | none | every claim cites a query run on the copy |
| T4. Header builder: a pure function from a document's stored fields to the header text, per feature, versioned, with the header version folded into `embed_hash`; used by the worker for new chunks | Sonnet, Opus reviews | `supabase/functions/_shared/chunkHeader.ts` and its test; `supabase/functions/ingest-worker/` embed input only | D1 | Deno tests (headers for each feature from real metadata shapes; empty fields omitted; version change changes `embed_hash`); `npm run lint` |
| T5. Re-embedding on a copy: a script that embeds header plus text for chosen features of a rehearsal copy into a side column, resumable, with a cost ceiling, and writes the vectors to a local file keyed by chunk id and `embed_hash` for reuse | Sonnet builds, supervisor runs (paid) | `scripts/eval-replica/reembed.mjs` and its offline test | T4 | offline test with a fake embedder; supervisor run with the ceiling, cost recorded |
| T6. Hybrid round 2: fusion and candidate changes from T3 (the keyword side stays over `content`, see Outcome 2); the round 1 security properties kept, with the fixture extended | Sonnet builds, Opus reviews | the C1 migration (not applied anywhere, so revised in place), `supabase/tests/chunk_hybrid_search.sql`, `supabase/tests/run.sh` entry | T3, T4 | `npm run test:sql` (no VACUITY FAIL), the security probes of round 1 |
| T7. The matrix on the copy: five arms × three sets, quiet machine, latency run twice | supervisor | `eval/retrieval/results/`, a research note | T2, T5, T6 | `--compare` per arm against vector-only; the sealed set run once, last |
| T8. Gate review | Fable | none (report) | T7 | review notes |
| T9. Production, each step separately authorized: headers in the worker and the re-embedding backfill (vectors loaded where `embed_hash` matches, the rest through the worker), then the hybrid migration, then the app switch | supervisor | runbook under `docs/operations/` | T8 and the developer's authorization | before-and-after measurement on NTER, as for Phase B |

- T1, T3 and T4 can run in parallel: their write scopes are disjoint. T5 waits on T4's header function and
  `embed_hash` rule. T6 waits on T3 and T4.
- Task agents do not read `.env.local`, call NTER or a paid API, or commit. Embedding runs are the supervisor's.
- Docker-heavy work (T3 queries, T5 runs, T7) runs one at a time; no test suites during a measured run.

## Progress (2026-11-05)

Done on `task/hybrid-search`, unmerged: T1, T3, T4, T5, T6. Nothing here has reached production.

- **T5 run.** All 392,945 chunks of `niyantran_rehearsal_c2headers` embedded with headers for US$2.17 (108,572,162
  tokens) under a US$3 ceiling. The vectors are in a local file outside the repo, for reuse at T9.
- **T6.** Migration sha256 `2978589ebeec657d742584b8d995033ff5c594b8617dd05b6fbd750b5181c223`. `npm run test:sql`: 71
  fixtures pass, 18 mutations caught, no VACUITY FAIL. Opus reviewed the commit before the six fixes and found no
  blocker; the fixes themselves have not had an independent review, so T8 covers them.
- **T6 measured, feature mode, vector-only then hybrid round 2 (doc@5/10/40).** Recomputed from the raw result files.
  These two sets are the ones it was tuned on, so they are not a verdict.

  | Set | Scope | Vector-only | Round 2 | Lost from top 10 |
  |---|---|---|---|---|
  | Development (45) | NCLT, 30 | 19/19/21 | 22/23/25 | none |
  | Development (45) | Bills, PQ, Regulatory, 15 | identical | identical | none |
  | v2 | NCLT generated, 56 | 29/29/34 | 42/44/47 | none |
  | v2 | NCLT developer, 14 | 10/10/10 | 13/13/13 | none |
  | v2 | every other feature | identical | identical | none |

- The `c3-*` result files are stamped commit `05f08dd4` because the fixes were uncommitted when they ran. The
  rehearsal file in the same batch records the migration hash above.
- Latency of these runs is not a measurement: the re-embedding was competing for Docker.

- **T7 on the tuning sets** ([note](../research/2026-11-05-hybrid-and-headers-matrix.md)): hybrid only gains with nothing
  lost, the recipe adds nothing, and headers on every feature are not acceptable under D4 because they lose
  Parliamentary Questions by the embedding itself. Headers on NCLT only is being measured as a sixth arm on
  `niyantran_rehearsal_c2mixed`, from the existing vectors.
- The re-embedding tool built its indexes inside the update's transaction, which doubled them with old row versions.
  Fixed in `65384b9a`; the headers copy was compacted before any measurement.

### Known limits of round 2

- The month parser reads an English month followed by a four-digit year. A day between them is missed.
- The word budget runs before the name gate.
- `match_count` above 100 returns fewer rows.
- Per-call cost grows with documents and hidden documents, because the hidden list is built on each call.
- The rare-word limit of 300 chunks and the 20,000-chunk month cap are fixed numbers. As the corpus grows 10× or 100×,
  fewer words stay rare and more months pass the cap, so both lists quietly stop helping. Re-measure before each
  large ingestion.
- A word probe builds that word's whole GIN bitmap before its `LIMIT` applies, hidden rows included.
- No real month is over the cap yet (the largest holds 8,616 chunks). The over-cap path was measured with a simulated
  cap of 1,000.

### Still to check before T9

- The eval did not enforce the 8 s limit on the replica before commit after `c5a766e4` (`set role` does not apply a role's
  settings), so every local result to that point counted a slower call as a success. Ranking in those runs stands; any
  call over 8 s there would have failed on NTER. Latency runs from now on count a timeout as a miss.
- **Blocking:** cold hybrid latency on NTER against the 8 s limit. A local question took 12 to 22 s on its first call
  and 1.2 s on its second, on a far smaller cache than NTER's. (Month scan alone: warm about 0.2 s, cold 2 to 4 s.)
- Vector-index recall: q-0003 and q-0022 are at exact ranks 35 and 28 but the index misses them.
- The HNSW path with hidden rows, the migration run as the production role, and the production policy text.
- Whether signed-in users can reach `retrieval_internal` while the Data API's "Automatically expose new tables" is on.
- Whether the new function is reachable, since the Data API exposes only part of the schema's functions.
- **Disk for the backfill.** An in-place update of every chunk doubled the tables and, before the tool was fixed, the
  HNSW indexes on the rehearsal copy (tables 3.6 GB to 7.1 GB, NCLT index 877 MB to 1,754 MB). The space is not returned
  by a plain vacuum. NTER has a 20 GB disk with 12 GB used, of which 5.3 GB is the Phase B backup table, so the backfill
  needs that table dropped first or to run in batches with a vacuum between them. Decide this in the T9 runbook. Build
  HNSW indexes only after the old row versions are gone, or they are indexed too.
- `indexStep` does not pass a header yet, and the supplied-text path freezes `embed_hash` at registration, so it needs
  the header built in `prepareSuppliedText`. Both are T9 work.

## Exclusions

- No reranker, no Hindi tokenizer (`pgroonga` stays the candidate if Hindi questions fail), no change to the app's
  search calls before T9.
- No change to Phase B, C3 or the billing schema.
