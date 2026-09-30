# Plan: RAG v2, part 1 — `eval`, `retrieval-scope`, `chunk-contract`

> **Status: Living (2026-09-30).** It becomes Historical when its last task
> lands. It implements three approved specs:
> - `docs/specs/2026-09-30-rag-v2-eval.md`
> - `docs/specs/2026-09-30-rag-v2-retrieval-scope.md`
> - `docs/specs/2026-09-30-rag-v2-chunk-contract.md`
>
> The map is `docs/specs/2026-09-30-rag-v2-capability-map.md`. The tasks are
> tracked in `docs/plans/open-work.md` §3 (items R1–R3). This file describes
> them but does not track them.
> `ingestion-v2`, `citations-pdf`, `acquisition` and `admin-upload` get
> their own specs and a part-2 plan.

## Ground rules

- **Branches:**
  - Each phase runs on its own `task/rag-v2-<phase>` branch from `main`.
  - Concurrent work runs only in worktrees the supervisor creates, with the
    disjoint write scopes named below.
  - Task agents leave their changes uncommitted; the supervisor verifies,
    commits and merges locally.
  - A push, a migration applied to NTER, a function deploy, building the
    replica, and the `EXPLAIN` on NTER each need **the owner's go-ahead for
    that action**.
- **Every task:**
  - read `AGENTS.md`, `docs/agents/coordination.md`, the spec and the files
    in scope before editing;
  - write the tests first and show them red, recording the red output in the
    task report;
  - run the checks named in the task.
- **The standard checks** (AGENTS.md):
  - `npm test`
  - `deno test -A --config supabase/functions/deno.json supabase/functions`
  - `npm run test:sql` (when SQL changes)
  - `npm run lint`
  - `npm run build`
- **Scripts that reach the network** (Node `fetch`, the Supabase CLI,
  Docker) run outside the sandbox. They read `.env.local` and never print a
  secret.

## Dependency graph

```
E1 eval ─────────────┐
   T1 evalSet ─┐     │
   T2 metrics ─┼─ T3 build set ─ [owner review] ─ T4 runner ─ T5 baseline ─ [checkpoint A]
               │                                                    │
E2 retrieval-scope   │                                              ▼
   T6 replica (owner go) ─ T7 candidates + measurements ─ T8 migration + fixture
   T9a server: request/handler/index/retrieval ─┐
   T9b server: agent/prompt ────────────────────┼─ [checkpoint B] ─ T11 deploy (owner go)
   T10 browser ─────────────────────────────────┘
E3 chunk-contract (T12, T13 and T17 can run beside E2: disjoint files)
   T12 pageText ─ T13 chunkPages ─┐
   T14 migration (after T8) ──────┼─ T15a server citations ─ T15b browser citation types ─ T16 ingest refusal ─ [checkpoint C]
   T17 ADR amendments ────────────┘
```

**Parallel work.** Only T12, T13 and T17 run beside E2, in a worktree the
supervisor creates. Their write scope is `supabase/functions/_shared/
pageText.ts`, `_shared/chunking.ts`, `_shared/__fixtures__/`,
`_shared/pageText_test.ts`, `_shared/chunking_test.ts` and
`docs/decisions/`, and nothing in E2 touches those files. Everything else
runs one task at a time. Migrations T8 and T14 are strictly in that order.

## Phase E1 — `eval` (branch `task/rag-v2-eval`)

**T1. The question-set logic** (S). **Files:** `src/lib/evalSet.js`,
`src/lib/evalSet.test.js`.

- Sampling:
  - order by `md5`, computed in JavaScript;
  - cycle through documents, one chunk each, until each feature's target is
    met;
  - apply the exclusion filters, using the chunker's `isTableRow` rule,
    copied with a comment that points to `_shared/chunking.ts`.
- The 5-token leakage check: NFKC, lowercase, punctuation removed, split on
  whitespace; it must work for Devanagari.
- Question-line validation against the spec's schema, and the
  distractor-freezing rule.

**Acceptance:** each rule has a test shown red against a broken variant.
**Check:** `npm test -- src/lib/evalSet.test.js`, `npm run lint`.

**T2. The metrics and the report** (M). **Files:**
`src/lib/retrievalEval.js`, `src/lib/retrievalEval.test.js`.

- Metrics: document and chunk hit@k, MRR@40, the same-key variant, and
  ranking by row order only.
- Per-question outcomes.
- The fingerprint check, which aborts listing every missing or changed gold
  chunk.
- The "no worse" comparator, with per-question flips and the absolute bars
  from the spec.
- Rendering the Markdown report.

**Acceptance:** tests include hit@k at ranks k and k+1, a re-sort by
similarity turning a test red, an abort on a drifted gold chunk, and the
comparator catching 5 lost / 5 gained flips. **Check:** `npm test`,
`npm run lint`.

**T3. Build the set** (M). **Files:** `scripts/build-eval-set.mjs`,
`.gitignore` (`eval/retrieval/.cache/`), then outputs
`eval/retrieval/questions.v1.jsonl` and `questions.v1.vectors.json`.

- A paged service-key read of candidates, with `indexed_at` set and a
  non-null embedding.
- Generation with the live default chat model, through OpenRouter.
- Grading by a second model from a different vendor.
- The ambiguity check, using each chunk's stored embedding.
- Writing the vectors and their hashes.
- Spend is capped at $2: the script stops beyond it.

**Acceptance:**
- 195 lines, with the target count per feature;
- every line validates;
- no leakage;
- the ambiguous count reported;
- the judge's results saved.

**Check:** run it outside the sandbox. `npm run lint`.

**Owner step:**
- The supervisor hand-reviews 40 questions (at least 38 must pass).
- The owner reviews 20 (at least 18 must pass).
- The owner optionally adds up to 20 real questions.
- The set is committed and frozen.

**T4. The harness** (M). **Files:** `scripts/eval-retrieval.mjs`.

- The `live` target, calling `match_documents` through PostgREST with the
  secret key.
- The modes `broad`, `focused` and `focused-multi`.
- Warm-up and a seeded shuffle.
- The network baseline call.
- Response sizes.
- JSON results holding ids and ranks only.
- The Markdown report.

**Acceptance:** a 5-question smoke run is checked by hand. **Check:**
`npm run lint`, `npm run build`.

**T5. The baseline** (S). Two runs, identical per question. The report goes
to `docs/research/<date>-retrieval-baseline.md` and the JSON to
`eval/retrieval/results/`.

**Checkpoint A (owner):** the set sample, the baseline figures and the cost.
E1 then merges locally, and pushes only on the owner's go.

## Phase E2 — `retrieval-scope` (branch `task/rag-v2-retrieval-scope`)

**T6. The replica** (M). **Files:** `scripts/eval-replica/schema.sql`,
`scripts/eval-replica/load.mjs`, and the `--target replica` option in
`scripts/eval-retrieval.mjs`.

- The schema, roles, RLS and `replica_meta` as the spec describes.
- The loader: paged, rate-limited, refusing any target except
  `niyantran_retrieval_replica`.
- The harness target: `docker exec … psql` with `json_agg`.

**Owner go-ahead before the load runs.** **Acceptance:** the replica
fingerprint matches NTER's counts, and a replica baseline run completes
twice with identical outcomes.

**T7. The candidates and the measurements** (M). **Files:**
`scripts/eval-replica/candidates.sql`, and
`docs/research/<date>-feature-filter-measurements.md`.

- The candidates E, Eh, H (a helper with a `SET` clause), I and X.
- Per feature: quality, p95 and p99 as `authenticated` with an 8 s
  timeout, and broad p95 while 4 concurrent Bills feature calls run.
- The decision rule applied, with T and N recorded.

**Owner go-ahead for the single read-only `EXPLAIN (ANALYZE, BUFFERS)` on
NTER** of the chosen Bills query.

**T8. The migration and the fixture** (M). **Files:**
- `supabase/migrations/<ts>_match_documents_feature.sql`;
- `supabase/tests/feature_filter.sql`;
- `supabase/tests/run.sh` (a new chain entry);
- `supabase/tests/halfvec_retrieval.sql` (a regprocedure variant only).

The spec's SQL, with the down script in the header.

**Acceptance:**
- the fixture passes;
- it is shown red against an H-only body;
- the vacuity check drops the migration;
- exactly one overload;
- anon and PUBLIC have no execute;
- `document_modules()` still returns every module beyond 1,000 documents.

**Check:** `npm run test:sql`.

**T9a. The server's request, handler, index and retrieval** (M). **Files:**
`research-chat/validate.ts`, `research-chat/handler.ts`,
`research-chat/index.ts`, `_shared/retrieval.ts` and their `_test.ts`
files.

- The `document` kind, with a 400 for a bad UUID, and `documentIdsOf`.
- Ids and keys resolved with the `indexed_at` check; `scopeSent`.
- `featureScope`, matched on tier and feature through `document_modules()`.
- The pointer line data passed to the prompt.
- `p_desk_feature` omitted when absent.

**Check:** the Deno suite.

**T9b. The server's agent and prompt** (M). **Files:**
`research-chat/agent.ts`, `research-chat/prompt.ts` and their tests, plus
the disclosure texts and labels in `handler.ts`, **after T9a lands**.

- The precedence: confinement, then feature, then the model's `desk_tier`.
- `feature-empty` widening.
- `inputKey` includes `featureScope`.
- The `document` pointer line.
- Per-reason disclosure texts.
- The "Desk" focus line.

**Check:** the Deno suite, including a handler-level smoke test.

**T10. The browser** (M). **Files:** `src/ai/AiPanel.jsx`,
`src/ai/WorkSurface.jsx`, `src/lib/aiDrop.js`, `src/lib/corpusCoverage.js`
and their tests.

- `onAskAboutDocument`, disabled while the thread is locked.
- The focus switch to `attached`, with its notice.
- `document` chips forwarded without text.
- `attachmentIdentity` includes `document_id`.
- The coverage badge.
- The "Desk" label and hint.

**Check:** `npm test`, `npm run lint`, `npm run build`, and the browser
preview (the reader button on a cited document).

**Checkpoint B:**
- all suites, `test:sql`, lint and build are green;
- the replica `eval` meets the bar;
- the rollback has been rehearsed on the replica;
- the owner reviews the measurements report.

**T11. Deploy** (owner go for each step). The steps:

1. Apply the migration (MCP `apply_migration`, with its version pinned to
   the file name).
2. `supabase functions deploy research-chat --use-api`.
3. Push `main`, so Vercel deploys the frontend.
4. A live `eval` run against the live baseline.
5. The manual checks from the spec.
6. An operations entry in `coordination.md`.

The rollback runs in reverse order.

## Phase E3 — `chunk-contract` (branch `task/rag-v2-chunk-contract`)

**T12. `pageText.ts`** (M). **Files:** `_shared/pageText.ts`,
`_shared/pageText_test.ts`, and `_shared/__fixtures__/mistral-bill-12p.json`
(copied from the saved OCR test response).

- R1: inline tables, rewrite placeholders, judge header and footer lines
  with `\p{Nd}`, don't reinsert text already at the page edge, handle empty
  pages, compute page offsets.
- Block locating.
- `normaliseBox`.
- Margin-note geometry with the measured thresholds.

**Acceptance:** the real fixture's kept and dropped header and footer lines;
the page offsets round-trip; a Devanagari running footer.

**T13. `chunkPages`** (M). **Files:** `_shared/chunking.ts`,
`_shared/chunking_test.ts`.

- `PAGE_CHUNK_VERSION = 3`.
- Placeholder atomicity as an option.
- R2 sections, R3 chunking, R4 `chunk_hash` and `embed_hash` and the
  embedding input, R5 overlap linking by reference.

**Acceptance:**
- the spec's expected sections on the real fixture;
- the definitions chunk links its block;
- no chunk crosses a page;
- `chunkDocument` is byte-identical to version 2 (regression test);
- only `embed_hash` changes when a heading changes.

**T14. The migration and the fixture** (M), **after T8 lands**. **Files:**
- `supabase/migrations/<ts>_page_contract.sql`;
- `supabase/tests/page_contract.sql`;
- `supabase/tests/run.sh`.

The spec's schema, `chunk_commit` (vector replacement) and
`match_documents` (new columns). Revoke, then grant.

**Acceptance:**
- the per-privilege loop;
- each assertion shown red on its own;
- one overload;
- nulls for old rows.

**T15a. Server citations** (M). **Files:** `_shared/retrieval.ts`,
`_shared/citation.types.ts`, `_shared/citations.ts`,
`research-chat/sources.ts`, `research-chat/handler.ts` (the async box step),
`research-chat/agent.ts` (the model line), and their tests.

**T15b. Browser citation types** (S). **Files:** `src/types/citation.js`,
`src/ai/CitationBubble.jsx` (strip malformed optional fields), and their
tests. The old saved-citation fixtures still validate.

**T16. `ingest-documents` refuses page-aware documents** (S). **Files:**
`ingest-documents/handler.ts` and its test.

**T17. Decision records** (S). **Files:** `docs/decisions/0004-…`
(amendment: unit keys, `embed_hash`, the new tables, content addressing),
and `docs/decisions/0002-…` (amendment: OpenRouter first, direct APIs
allowed when it has no endpoint; Mistral OCR with `MISTRAL_API_KEY` held
server-side).

**Checkpoint C:**
- all suites and `test:sql` are green;
- the replica, with the contract columns added, gives identical `broad`
  figures;
- the owner's go for applying the migration and deploying `research-chat`,
  which can go out with T11 or after it.

## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| The generated questions are weak or leak wording | The bar measures the wrong thing | Leakage check, a second-vendor judge, 38/40 and 18/20 reviews |
| A 700 MB replica read loads NTER | Slower live queries during the load | Rate limit, a quiet hour, the owner's go |
| No candidate meets the feature latency bar for Bills | The feature filter can't ship | Ship the filter for small features only (X with Bills unfiltered), disclosed; record it |
| Margin geometry doesn't generalise beyond one bill | Wrong section notes | The pilot checks other bills; thresholds live in one constant |
| A deploy-order mistake breaks search | Chat can't search | Migration first (old code still works), the argument omitted, one-overload assertion, a rehearsed rollback |

## Follow-ups this plan creates (recorded in open-work)

- A document picker, to focus on an uncited document.
- The model choosing a desk filter itself, after an answer-level evaluation
  exists.
- `deno.lock` is stale: it lists `sql.js` and lacks the ESLint packages.
