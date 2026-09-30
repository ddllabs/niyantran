# Spec: focus on any document, and filter by desk feature (`retrieval-scope`)

> **Status: Living — draft for owner approval (2026-09-30).** It becomes
> Normative once approved. Module `retrieval-scope` of
> `docs/specs/2026-09-30-rag-v2-capability-map.md`. It depends on `eval`
> (`docs/specs/2026-09-30-rag-v2-eval.md`), whose "no worse" bar it must meet
> **before** deployment. The evidence is
> `docs/research/2026-09-30-rag-v2-investigation.md` §3.

## Objective

Two changes, on today's corpus:

1. **Focus on any document.** A researcher reading any document in the
   evidence reader can ask about that document alone. Today only a bill that
   arrives through a desk row's `bill:<year>:<number>` key can be focused,
   which reaches 1,235 of the 2,338 documents at most.
2. **Filter by desk feature.** Search can be restricted to one desk module's
   documents, such as parliamentary questions only. Today a `desk_tier` filter
   exists, but every document is on the same tier (`national`), so it filters
   nothing.

## Current state (read and executed 2026-09-30)

**Request**

- `validate.ts` accepts `focus ∈ {attached, selection, desk, broad}`
  (`:7`), a `selection` with an optional `document_key`, `attachments` of
  kind `row`, `record` or `file`, each **requiring non-empty `text`**
  (`:132-148`), and a `desk_context {tier, feature?}`.
- There is no document-id field. `documentKeysOf` (`:200-205`) collects the
  keys.
- `handler.ts:626-627` resolves the keys to ids through
  `metadata->>'document_key'` (`index.ts:320-325`), with no `indexed_at`
  check.

**Confinement**

- `agent.ts:390` confines a search only when focus is `attached` or
  `selection` and ids exist. Otherwise it widens, with the disclosure "Search
  widened" (`handler.ts:414-425`).
- Focus `desk` changes only one prompt line (`prompt.ts:131`). It does not
  filter anything.

**Tool**

- `SEARCH_DOCUMENTS_TOOL` exposes `{query, desk_tier}` with
  `additionalProperties: false` (`_shared/tools/searchDocuments.ts:8-24`).
  `searchDocuments_test.ts:10` pins those keys.
- The model already sees the live `documents.desk_feature` values, from
  `documentModules` (`index.ts:265-281`, cached per isolate) and
  `coverageLine` (`prompt.ts:157-163`).

**SQL**

- `match_documents(vector, int, uuid[], text)` (`20260929120100`) is
  `security invoker` and granted to `authenticated` and `service_role`. It has
  two branches:
  - **scoped:** exact, a per-document quota, and the `documents` join after
    ranking;
  - **unscoped:** HNSW on `embedding::halfvec(1536)`, `ef_search` at its
    default of 40, and `indexed_at` and `desk_tier` applied after the index
    scan.
- No function sets `hnsw.ef_search` or `hnsw.iterative_scan`. The full-vector
  index was dropped, so ordering by `embedding <=> query` (full precision)
  cannot use an index and is an exact scan.
- The 2026-09-22 scoped-retrieval spec said the "signature, return type,
  volatility and grants must not change" (`:104-106`). **This spec
  supersedes that constraint for the signature only.**

**Feature values** (executed)

`desk_feature` holds desk module names:

| desk_feature | Chunks | Share of chunks |
| --- | --- | --- |
| Bill Passage Probability Index | 42,025 | 78% |
| Regulatory Body Watch (RBI SEBI TRAI CCI) | 11,040 | 20% |
| Parliamentary Question Database | 1,108 | 2% |
| Industry Updates (Ministry Data) | 40 | 0.07% |
| Budget Utilisation & Schemes | 6 | 0.01% |

`deskCatalog.json` spells the regulatory module with slashes, while
`documents` has spaces. `desk_context.feature` comes from the catalogue name.

**Measured behaviour of the filtering options** (scoped-retrieval spec
D1, document filter):

| Strategy | Small doc (45 chunks) | Large doc (915 chunks) |
| --- | --- | --- |
| HNSW, then filter | 1 of 40 chunks | 12 of 40 chunks |
| Iterative scan (relaxed) | 19,820 ms | 1,019 ms |
| Exact pre-filter | 12 ms | 840 ms |

pgvector's README recommends an exact scan for selective filters, and more
`ef_search` or an iterative scan for broad ones.

**Timeouts** (executed)

- `research-chat` abandons an RPC after 4 s
  (`NETWORK_TIMEOUT_MS`).
- The `authenticated` role's statement timeout is 8 s.
- `service_role`'s is 300 s.

**Browser**

- The reader (`SourceReader.jsx`) holds `citation.document_id` and
  `title`. `WorkSurface.jsx` renders its header.
- `research.actions.attach` (`useResearchThread.js:238-247`) adds a chip.
- `AiPanel.jsx:447-454` maps chips to request attachments.
- `aiDrop.js:178 attachmentIdentity` and `corpusCoverage.js` (keyed on
  `document_key`) decide dedupe and the "full text" badge.
- There is no document picker.

## Owner decisions this spec needs (recommendations in bold)

1. **Where "focus on this document" starts: a button in the evidence reader's
   header, "Ask about this document".** A document picker (search by title)
   is a separate, later piece of UI.
2. **What the button does:**
   - **It adds a document chip.**
   - **If the current focus is `broad` or `desk`, it switches focus to
     `attached` and says so in the panel**, because a chip only confines
     search under `attached` or `selection`.
   - **Otherwise it leaves focus alone.**
3. **Focus `desk` filters search:** when focus is `desk` and a desk module
   is open, **every document search is filtered to that module's documents**.
   If the module has no documents, the search widens with the existing
   disclosure.
4. **The model may choose a feature filter itself** in any focus except a
   confined one, through a new optional `desk_feature` tool argument. **Yes.**

## Expected outcome

### Request (`validate.ts`)

- **A new attachment kind, `document`:** `{kind: 'document', title,
  document_id}`, with `document_id` a UUID and **no `text` required**. The
  chip is a pointer, not content. The corpus text is never inlined into the
  prompt.
- **`documentIdsOf(request)`** returns the distinct `document_id`s of those
  attachments, at most `LIMITS.attachments`.
- **`desk_context.feature`** is matched to a `documents.desk_feature` value
  by normalised comparison: lowercase, `/` and punctuation turned into
  spaces, whitespace collapsed. That makes "(RBI/SEBI/TRAI/CCI)" match
  "(RBI SEBI TRAI CCI)". It is resolved against the live list, not
  hard-coded.

### Handler (`handler.ts`, `index.ts`)

- **Scope ids** are the ids resolved from keys, plus the validated
  `document_id`s. The document ids are checked: only ids of documents with
  `indexed_at` set are kept. Unknown or unindexed ids are dropped, and they
  count as "unresolved" for the disclosure, like an unresolved key.
- **`documentKeysSent`** becomes "a key **or a document id** was sent", so
  the text "Drag a bill's row…" isn't shown when the user attached a
  document.
- **Feature scope:** with focus `desk` and a matched feature, every document
  search carries that feature. With no match, search is not filtered and
  widens with a new reason, `'no-feature-documents'`, which gets its own
  disclosure text.

### Agent and tool

- **`SEARCH_DOCUMENTS_TOOL`** gains an optional `desk_feature`, an `enum` of
  the live `documentModules` values, built when the tool list is assembled
  for the turn. `searchDocuments_test.ts` is updated deliberately.
- **`agent.ts` precedence:**
  1. confined document ids;
  2. otherwise the handler's feature scope, when focus is `desk`;
  3. otherwise the model's `desk_feature` argument.

  A model argument never overrides a confinement.
- **Widening on empty results** also applies to feature scope: zero rows
  means it re-runs unfiltered, once, and discloses that.
- **The prompt** (`prompt.ts:32` tool line, `FOCUS_LINES.desk`) describes
  the filter.

### SQL: one migration, `…_match_documents_feature.sql`

- **Replace `match_documents`:** drop it, then create it with
  `p_desk_feature text default null` added after `p_desk_tier`. The return
  columns, `security invoker`, `stable`, the `search_path` and the grants
  are unchanged. The grants are re-applied, because a drop removes them.
- **The scoped branch** (document ids) is unchanged. `p_desk_feature` is
  ignored when ids are given, because confinement wins.
- **A new feature branch** (feature set, no ids) uses the strategy chosen by
  measurement, below. It must return the full `match_count` whenever the
  feature holds at least that many indexed chunks.
- **The unscoped branch** without a feature is unchanged: the same SQL and
  the same index.
- **Down script** (in the file's comment): recreate the
  `20260929120100` definition exactly.

### Choosing the feature-branch strategy (measured, not assumed)

Candidates, each written as a separate function on the replica (below):

| Id | Strategy | Expected fit |
| --- | --- | --- |
| **E** | Exact: join to `documents` on the feature, order by full-precision distance, no quota | Correct by construction. Cost grows with the feature's size: fine for Parliamentary Questions, Industry and Budget; to be measured for Regulatory (11k) and Bills (42k). |
| **H** | HNSW with `set_config('hnsw.ef_search', N, true)`, filtered afterwards | Should work for Bills (78%); fails for small features. |
| **I** | HNSW with `hnsw.iterative_scan = relaxed_order`, a MATERIALIZED CTE, and a re-sort on `distance + 0` | Measured pathological for tiny targets in D1. Included only for Bills and Regulatory. |
| **X** | Hybrid: E when the feature's indexed chunk count is ≤ T, else H or I | The likely winner. T and N come from the measurements. The count comes from a cheap indexed query, measured too. |

A partial HNSW index per feature isn't possible: the feature lives on
`documents`, and an index predicate can't reference another table. Putting
the feature on each chunk (denormalising it) is out of scope.

**The decision rule.** Take the simplest candidate that meets the `eval` bar
for `feature` mode:
- per feature, document hit@10 at least the `broad` baseline;
- the full `match_count` returned;
- p95 within the latency bar;
- **no feature above 2 s on the replica**, or 4 s at most on the server.

The chosen strategy is recorded, with the measurements, in
`docs/research/<date>-feature-filter-measurements.md`.

### A local replica, for measuring before deploying

- **Database** `niyantran_retrieval_replica_test` in
  `niyantran-corpus-test-db`. The name satisfies the `niyantran_%_test`
  guard convention.
- **A minimal schema,** not the migration chain:
  - `documents` with the columns `match_documents` reads, and no `ocr_text`;
  - `document_chunks` with the columns it returns plus `embedding`;
  - the same indexes as live (`documents (desk_tier, desk_feature)`,
    `document_chunks (document_id, chunk_index)`, and the halfvec HNSW with
    default `m` and `ef_construction`);
  - the live `match_documents` body, copied from `20260929120100`, plus the
    candidate functions.

  No auth, cron or net: the replica needs none of them, and 0007's cron job
  must never run on the laptop. The schema lives in
  `scripts/eval-replica/schema.sql` and is written for this purpose, not
  replayed from migrations.
- **Data:** a read-only copy from NTER of `documents` (without `ocr_text`)
  and `document_chunks` (with embeddings), about 700 MB. It can be a
  data-only dump of those two tables through the linked Supabase CLI, or a
  paged service-key read. The plan picks one after a dry run. `analyze`
  runs after the load. The copy is gitignored, never committed, and
  rebuildable.
- **Harness target:** `eval` gains `--target replica`, which calls
  functions through `docker exec … psql` (results as `json_agg`) instead of
  PostgREST. **Quality figures** from the replica compare directly with live,
  because they're hardware-independent once the corpus fingerprint matches.
  **Latency** on the replica is compared only with a replica baseline.
- **Building the replica** is an explicit owner go-ahead (per the `eval`
  boundaries).

### Browser

- **`WorkSurface` header** (for a text source): a button, "Ask about this
  document". It calls
  `research.actions.attach({kind: 'document', title, document_id,
  feature: citation.desk_feature})`, then applies decision 2 on focus.
- **`AiPanel.jsx`** forwards `document_id` for `document` chips, and never
  sends `text` for them.
- **`attachmentIdentity`** includes `document_id`, so the same document isn't
  added twice.
- **`corpusCoverage`** treats a `document` chip as "full".
- **The chip** shows the document title and a "document" marker.

## Commands

```bash
npm test
deno test -A --config supabase/functions/deno.json supabase/functions
npm run test:sql                      # includes the updated halfvec_retrieval fixture
npm run lint
npm run build
# measurements (after the replica is approved and built)
npx vite-node --config vitest.config.js scripts/eval-retrieval.mjs -- --target replica --modes broad,focused,focused-multi,feature
```

## Testing strategy

- **Deno:**
  - `validate_test.ts`: a `document` attachment with and without a valid
    UUID; the cap; no `text` required; `documentIdsOf`.
  - `handler_test.ts`: ids merged with keys; unindexed ids dropped and
    reported as unresolved; `documentKeysSent` for ids; the feature scope
    for `desk` focus, including a no-match widening.
  - `agent_test.ts`: the precedence (confinement beats feature beats model
    argument); widening from an empty feature result.
  - `searchDocuments_test.ts`: the new key and its enum.
  - `retrieval_test.ts`: `p_desk_feature` passed through, and `null` when
    absent.
  - A **handler-level smoke test**: a request with a `document` chip and
    focus `attached` produces a search scoped to exactly that id.
- **Vitest:**
  - `AiPanel.test.jsx`: the document chip is forwarded without text.
  - `SourceComponents.test.jsx` or `AgentComponents.test.jsx`: the button
    adds the chip and switches focus.
  - `aiDrop` identity.
  - `corpusCoverage`.
- **SQL fixture `halfvec_retrieval.sql`** (updated, with the new migration
  appended to its chain in `run.sh`):
  - the new regprocedure `(vector,int,uuid[],text,text)`;
  - the feature filter returns the full count for a small feature;
  - it ranks exactly within the feature;
  - it is ignored when ids are given;
  - the unscoped branch is unchanged;
  - the grants are present.

  The vacuity check fails when the new migration is removed.
- **Every new test is shown to fail first.** For example, a model argument
  overriding confinement, or a feature branch that filters after HNSW, must
  turn a test red.
- **`eval`:** a replica baseline, then each candidate, then the chosen
  function against the bar. **After** deployment, a live run against the live
  baseline.

## Boundaries

- **Always:**
  - Measure before choosing.
  - Keep the unscoped no-feature branch identical.
  - Re-apply the grants.
  - Keep confinement stronger than any filter.
- **Ask first:**
  - Building the replica.
  - Applying the migration to NTER.
  - Deploying `research-chat`.
  - Pushing the frontend.
- **Never:**
  - Filter with JSON containment on chunk metadata.
  - Change the return columns here (`chunk-contract` owns that).
  - Inline corpus text for a document chip.
  - Raise the role timeouts to make a slow strategy pass.

## Acceptance evidence

1. All Deno and Vitest tests pass, lint and build are clean, and
   `npm run test:sql` passes including vacuity. There is fail-first evidence
   for each new test.
2. The measurements report is committed: every candidate, per feature, with
   quality and latency on the replica, and the chosen strategy with its T
   and N.
3. The chosen function meets the full `eval` bar on the replica.
4. **After deployment**, with the owner's go-ahead:
   - a live `eval` run meets the bar against the live baseline;
   - a manual check in the app: open a Regulatory document in the reader,
     click "Ask about this document", ask a question, and see citations only
     from that document;
   - focus `desk` on the Parliamentary Questions module cites only
     parliamentary questions.
5. The rollback was tested on the replica: the down script restores the
   previous function and the `eval` figures return to the baseline.

## Scope

- `validate.ts`, `handler.ts`, `index.ts`, `agent.ts`, `prompt.ts`;
- `_shared/tools/searchDocuments.ts`, `_shared/retrieval.ts` and their tests;
- one migration, the fixture and `run.sh`;
- `WorkSurface.jsx`, `AiPanel.jsx`, `src/lib/aiDrop.js`,
  `src/lib/corpusCoverage.js` and their tests;
- the replica schema and loader under `scripts/eval-replica/`;
- the `eval` replica target;
- the measurements report.

## Exclusions

- A document picker or title search.
- A feature column on chunks.
- New return columns: `chunk-contract` adds page, block and image fields,
  with its own drop and recreate afterwards.
- Reranking and hybrid keyword search (P6).
- Changing the scoped (document-id) branch or its quota.
- Anything about ingestion.

## Open questions for the owner

1. Decisions 1–4 above. I recommend yes to each, as described.
2. Building the local replica (about 700 MB in Docker; a read-only copy of
   public corpus data).
