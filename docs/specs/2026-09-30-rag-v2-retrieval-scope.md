# Spec: focus on a document, and filter by desk (`retrieval-scope`)

> **Status: Normative — approved by the owner on 2026-09-30,** with the
> recommendations below accepted. Module `retrieval-scope` of
> `docs/specs/2026-09-30-rag-v2-capability-map.md`. It depends on `eval`
> (`docs/specs/2026-09-30-rag-v2-eval.md`), whose bar it must meet before
> deployment. The evidence is `docs/research/2026-09-30-rag-v2-investigation.md`
> §3. Revision 2 folds in a fresh-context adversarial review: 16 findings, all
> accepted (see "Review record").

## Objective

1. **Focus on a document the researcher is reading.** From the evidence
   reader, one click confines the next questions to that document.
   - Today only bills that arrive through a desk row's `bill:<year>:<number>`
     key can be focused. Of 9,415 distinct desk keys, 1,235 resolve to an
     indexed document (`src/lib/corpusCoverage.js:11-12`).
   - The reader opens only on a cited document (`WorkSurface.jsx:42`). So
     this reaches **any document an answer has cited**, which is not the same
     as any document. Reaching an uncited document needs a document picker:
     see decision 1.
2. **Desk focus filters documents.** With focus "desk" on a module that has
   documents, every document search covers only that module's documents.
   Today desk focus changes one prompt line (`prompt.ts:131`) and filters
   nothing. The `desk_tier` filter filters nothing either, because every
   document is on the `national` tier.

## Current state (read and executed 2026-09-30)

**Request**

- `validate.ts` accepts:
  - `focus ∈ {attached, selection, desk, broad}` (`:7`);
  - a `selection` with an optional `document_key`;
  - attachments of kind `row`, `record` or `file`, each **requiring
    non-empty `text`**. Invalid ones are silently dropped (`:132-148`);
  - `desk_context {tier, feature?}`.
- There is no document-id field. `documentKeysOf` (`:200-205`) collects the
  keys.
- The keys resolve through `metadata->>'document_key'` with **no
  `indexed_at` check** (`index.ts:320-325`).

**Confinement and disclosure**

- `agent.ts:390` confines only under `attached` or `selection`.
- The "Search widened" disclosure is raised **only** under a confining focus
  (`agent.ts:398-401`), with the reasons `unkeyed`, `unresolved` and `empty`.
- Their texts all speak of "attached documents" (`handler.ts:414-425`,
  labels `:957-961`).
- `AgentInput` and the checkpoint `inputKey` (`agent.ts:160-171`) carry
  `scopedDocumentIds`, `focus` and `documentKeysSent`.

**Tool and prompt**

- `SEARCH_DOCUMENTS_TOOL` is `{query, desk_tier}`, with
  `additionalProperties: false`, pinned by `searchDocuments_test.ts:10`.
- `documentArguments` (`agent.ts:271-275`) keeps only those keys.
- The attachments reach the prompt as `{kind, title, text}`
  (`handler.ts:619-623`). `RenderedAttachment.kind` allows `row`, `record`
  and `file` (`prompt.ts:219-240`).

**The module list has an existing bug.** `documentModules` (`index.ts:265-281`)
reads one `desk_feature` per document (2,338 rows) with no range.
PostgREST's `max_rows` is 1000 (`supabase/config.toml:18`; the hosted
default is the same). So the list can silently miss modules whose documents
sort after row 1000; the 1-document Budget module is the likeliest. This
spec fixes it, because it depends on that list.

**SQL**

- `match_documents(vector, int, uuid[], text)` (`20260929120100`):
  - `security invoker`;
  - revoked from public and anon, granted to `authenticated` and
    `service_role` (`:107-108`);
  - scoped branch: exact, with a quota of `ceil(match_count / n)` (`:63`);
  - unscoped branch: HNSW on `embedding::halfvec(1536)` at the default
    `ef_search` 40, with `indexed_at` and `desk_tier` applied after the
    index scan.
- The full-vector index is gone, so an order by full-precision distance is an
  exact scan (782 ms over the whole corpus on live).
- The 2026-09-22 spec's "signature … must not change" (`:104-106`) is
  **superseded for the signature only**.

**Features** (executed): Bills 42,025 chunks (78%); Regulatory 11,040 (20%);
Parliamentary Questions 1,108; Industry 40; Budget 6. The catalogue has 75
modules, so 70 have no documents. Module names repeat across tiers (for
example "Cabinet Decisions" on both the national and state tiers). The
catalogue spells the regulatory module "(RBI/SEBI/TRAI/CCI)", while
`documents` has spaces.

**Timeouts** (executed): `research-chat` abandons an RPC after 4 s;
`authenticated` 8 s; `service_role` 300 s.

**Browser**

- `research.actions.attach(materialize)` takes a **function** returning the
  attachments. It refuses while the thread is locked
  (`useResearchThread.js:238-247`).
- `WorkSurface` gets no research or focus props (`AiPanel.jsx:941`).
- Focus is `AiPanel` state persisted in `localStorage` (`:267-273, :344`).
- The desk focus option is labelled "Desk sample" (`:21`).

## Owner decisions (recommendations in bold)

1. **Reach:** **ship the reader button now: "Ask about this document", for
   cited documents.** A title-search document picker, for any document, is a
   separate follow-up (a new open-work item), not in this module.
2. **The button's effect on focus:** it adds a document chip. **If focus is
   `broad` or `desk`, it switches to `attached`, and that stays, as any focus
   change does.** The focus control shows the change and a one-line notice
   says why. Other chips stay: the scope is shared, and the notice says
   "searching N attached documents" when N > 1.
3. **Desk focus filters:** **yes, when the module has documents.** When it
   has none (70 of 75 modules), searches run unfiltered **with no banner**.
   The coverage line already tells the model, and a banner on almost every
   module would be noise. The label "Desk sample" becomes "Desk", with a hint
   saying documents are limited to this module.
4. **The model choosing a feature filter itself: not in this module.**
   Nothing here measures whether the model picks well, and a wrong pick makes
   answers worse. It needs an answer-level evaluation first. It becomes a
   follow-up open-work item.

## Expected outcome

### Request (`validate.ts`)

- **A new attachment kind, `document`:** `{kind: 'document', title,
  document_id}`.
  - **No `text`.** The chip is a pointer, never corpus content.
  - A malformed `document_id` is a **400 field error**, not silently dropped,
    because a client bug should surface.
- **`documentIdsOf(request)`** returns the distinct ids, capped at
  `LIMITS.attachments`.
- **`desk_context.feature`:** an empty string counts as absent.

### Handler and index

- **One resolution for keys and ids:** keys are resolved as today, the ids
  are validated, and **both** keep only documents with `indexed_at` set. So
  an unindexed key and an unindexed id both disclose as `unresolved`.
  **This changes behaviour for keys,** which today disclose `empty`.
- **`documentKeysSent`** is renamed `scopeSent`, and is true when a key or an
  id was sent. The text "Drag a bill's row…" appears only when neither was.
- **Feature scope:**
  - Condition: focus is `desk`, and `desk_context` names a module.
  - Matching: the module is matched on **tier and feature**, against the live
    list of `(desk_tier, desk_feature)` pairs, comparing lowercase text with
    punctuation and `/` turned into spaces.
  - A match gives `featureScope = {tier, feature}` (the exact `documents`
    values). No match gives none, with no banner.
- **The live list** comes from a new SQL function,
  `document_modules() returns table(desk_tier text, desk_feature text)`: a
  `select distinct` over indexed documents, `security invoker`, `stable`,
  granted to `authenticated` and `service_role`. It replaces the capped read,
  and is still cached per isolate.
- **The prompt** gets a pointer line for each document chip: "Attached
  document: <title> — searches are limited to it." `RenderedAttachment`
  gains the `document` kind. `handler.ts` passes the title only.

### Agent (`agent.ts`)

- **`AgentInput`** gains `featureScope?: {tier, feature}`, and it is part of
  `inputKey`, so a resumed turn can't diverge.
- **Search precedence:**
  1. confined document ids (under `attached` or `selection`, as today);
  2. otherwise `featureScope` (under `desk`);
  3. otherwise the model's `desk_tier`, as today.
- **Empty feature result:** it re-runs once without the feature, and raises a
  new reason, `feature-empty`, with its own text: "Search widened: nothing in
  <module> matched, so all documents were searched." It has its own ticker
  label.
- **The disclosure texts** are rewritten per reason, so that none claims
  "attached documents" when the scope was a module.

### SQL: migration `…_match_documents_feature.sql`

- **Replace the function:**
  - `drop function match_documents(vector, int, uuid[], text)`;
  - `create function match_documents(query_embedding, match_count,
    p_document_ids, p_desk_tier, p_desk_feature text default null)`;
  - the same return columns, `security invoker`, `stable` and `search_path`;
  - `revoke all … from public, anon`, and `grant execute … to
    authenticated, service_role`. `create function` grants PUBLIC by default,
    which the revoke undoes.
- **Branches:**
  - ids given: the scoped branch, unchanged, with `p_desk_feature` ignored;
  - no ids, no feature: the unscoped branch, byte-for-byte unchanged;
  - no ids, with a feature: the **feature branch**, using the strategy
    chosen below. It must return the full `match_count` whenever the
    feature (with its tier) holds at least that many indexed chunks.
- **Session settings** such as `hnsw.ef_search` and `hnsw.iterative_scan`
  are set only inside a **helper function with a `SET` clause**, which
  scopes them to that call. Never with `set_config(…, true)`, which would
  leak to later statements in the same transaction.

  **Amended 2026-10-01, at deploy:** NTER refused the `SET` clause with
  "permission denied to set parameter hnsw.ef_search". Until pgvector's
  library is loaded, the setting is a placeholder, and only a superuser may
  attach one to a function. The helper therefore uses
  `set_config('hnsw.ef_search', '400', true)`, runs its query to completion
  with `RETURN QUERY`, and restores the caller's value before returning, so
  nothing leaks. The fixture proves the caller's own value survives the call
  as `authenticated`, and goes red without the restore.
- **`document_modules()`**, as above.
- **The down script** is in the file header, and runs **after** rolling back
  the function code:
  1. drop the 5-argument function;
  2. recreate the `20260929120100` definition;
  3. revoke and grant as before;
  4. drop `document_modules()`.

### Deploy order and compatibility

1. **Apply the migration.** The old `research-chat` keeps working, because
   PostgREST fills in the new defaulted argument.
2. **Deploy `research-chat`.** `retrieval.ts` **omits** `p_desk_feature`
   when there is no feature scope; it never sends `null`.
3. **Deploy the frontend.**

A rollback runs in reverse: the frontend, then the function, then the down
script. A fixture assertion checks that exactly one `match_documents`
overload exists.

### Choosing the feature-branch strategy

| Id | Strategy |
| --- | --- |
| **E** | Exact: join to `documents` on tier and feature, order by full-precision distance, no quota |
| **Eh** | Like E, but ordered by `halfvec` distance: half the bytes read, then a full-precision re-rank of the top `match_count` |
| **H** | HNSW through the helper with `SET hnsw.ef_search = N`, filtered after the index scan |
| **I** | HNSW with `iterative_scan = relaxed_order`, a MATERIALIZED CTE and a re-sort on `distance + 0` |
| **X** | Hybrid: E or Eh when the feature's indexed chunk count is ≤ T, else H or I. The count comes from an indexed query, which is measured too. |

**The decision rule:** the simplest candidate that, on the replica, meets
all of these:

- the `eval` `feature` bar: per feature, document hit@10 at least the same
  feature's `broad` baseline, and the full `match_count`;
- **an absolute latency bar for the feature branch:** p95 ≤ 1.5 s and
  p99 ≤ 2.5 s per feature, measured as the `authenticated` role with an 8 s
  timeout. It has no earlier baseline, so it gets an absolute bar with room
  under the 4 s limit. An empty result's re-run can double the cost;
- **no effect on broad search while feature calls run:** broad p95 measured
  while 4 concurrent Bills feature calls run stays within the `eval` latency
  bar. This checks that a big exact scan doesn't push the halfvec index out
  of memory.

Then, **before deployment**, with the owner's go-ahead: one read-only
`EXPLAIN (ANALYZE, BUFFERS)` of the chosen Bills query on NTER, under
`set local role authenticated`. This confirms the replica's timing holds on
the real instance. The choice, T, N and every measurement go into
`docs/research/<date>-feature-filter-measurements.md`.

### The local replica (for measuring)

- **Database** `niyantran_retrieval_replica` in `niyantran-corpus-test-db`.
  The loader refuses any other target.
- **Schema** (`scripts/eval-replica/schema.sql`):
  - `documents`: `id`, `desk_tier`, `desk_feature`, `title`, `file_name`,
    `file_url`, `indexed_at`, `metadata`, `content_sha256`; **no
    `ocr_text`**;
  - `document_chunks`: every live column **except** `content` is kept.
    `content` is kept too: it is returned, and response size matters;
  - the same indexes as live;
  - the roles `authenticated` (8 s `statement_timeout`) and `anon`, and the
    same RLS policies;
  - the live `match_documents`, the candidates and `document_modules`;
  - a table `replica_meta(source_migration, copied_at, doc_count,
    chunk_count)` so the `eval` fingerprint works.
- **Loading:** a paged, service-key read. `pg_dump` can't leave out one
  column. It is **rate-limited** (for example 2 requests per second) and run
  at a quiet hour, so NTER's cache isn't flushed at a busy time. It is
  written to the container through `docker exec psql`. The local copy stays
  in Docker; nothing lands in the repository.
- **Comparisons are replica against replica only.** The replica's HNSW is a
  new build, so the baseline is re-run on it, and `eval`'s same-build rule
  applies. No replica figure is compared with a live figure.
- **Building the replica** needs the owner's go-ahead.

### Browser

- **`AiPanel`** passes `onAskAboutDocument(citation)` to `WorkSurface`. The
  handler:
  - calls `research.actions.attach(async () => [{kind: 'document', title,
    document_id, feature: desk_feature}])`;
  - applies decision 2 to focus;
  - shows the notice.

  It does nothing while the thread is locked, and the button is disabled
  then.
- **`WorkSurface`** shows the button for text sources only.
- **`AiPanel`** forwards `document_id` for `document` chips, with no `text`.
- **`attachmentIdentity`** includes `document_id`.
- **`corpusCoverage`** marks a `document` chip "full".
- **The focus labels and hints change** for "Desk", per decision 3.

## Tests

- **A new SQL fixture, `feature_filter.sql`,** with its own chain in
  `run.sh`. `halfvec_retrieval` keeps its own chain and still guards
  `20260929120100`; its regprocedure line gets a second variant after this
  migration. The fixture uses:
  - a few hundred out-of-feature chunks placed **nearer** the query than a
    small in-feature set;
  - `set enable_seqscan = off`.

  It asserts:
  - the feature call returns the full count, all in-feature, in exact order;
  - ids given means the feature is ignored;
  - the unscoped branch returns the same rows as before;
  - there is exactly one overload;
  - `NOT has_function_privilege('anon', …)`, and the same for PUBLIC;
  - `authenticated` can execute;
  - `document_modules()` returns distinct pairs beyond 1,000 documents.

  It is **shown red against an H-only body** (filtering after HNSW). The
  vacuity check drops the migration.
- **Deno:**
  - `validate` (the document kind; a bad UUID gives a 400; no text
    required);
  - `handler` (id and key resolution with `indexed_at`; `scopeSent`;
    `featureScope` matched on tier and feature; no match means no scope and
    no banner);
  - `agent` (the precedence; `feature-empty` widening; `inputKey` includes
    the feature scope);
  - `prompt` (the pointer line);
  - `retrieval` (omits `p_desk_feature` when absent);
  - `searchDocuments` (unchanged keys);
  - a handler-level smoke test: a document chip under `attached` scopes to
    exactly that id.
- **Vitest:**
  - `AiPanel` (forwarding; focus switching and its notice);
  - `AgentComponents` (the button calls `onAskAboutDocument` and is disabled
    while locked);
  - `aiDrop` identity;
  - `corpusCoverage`.
- **Every new test is shown to fail first.**
- **`eval`:** a replica baseline, the candidates, then the chosen function.
  After deployment, a live run against the live baseline.

## Commands

```bash
npm test
deno test -A --config supabase/functions/deno.json supabase/functions
npm run test:sql
npm run lint
npm run build
npx vite-node --config vitest.config.js scripts/eval-retrieval.mjs -- --set eval/retrieval/questions.v1.jsonl --target replica --modes broad,focused,focused-multi,feature
```

## Boundaries

- **Always:**
  - Measure before choosing.
  - Keep the unscoped branch unchanged.
  - Revoke public and anon.
  - Keep confinement ahead of any filter.
  - Omit arguments that are absent.
- **Ask first:**
  - Building the replica.
  - The `EXPLAIN` on NTER.
  - The migration.
  - The function deploy.
  - The push.
- **Never:**
  - Filter on chunk `metadata`.
  - Change the return columns (that belongs to `chunk-contract`).
  - Inline corpus text for a chip.
  - Raise the role timeouts to make a strategy pass.
  - Let the model choose the feature (decision 4).

## Acceptance evidence

1. Both suites, lint, build and `npm run test:sql` pass, with vacuity checks
   and fail-first evidence, including the red H-only run.
2. The measurements report is committed, with the chosen strategy meeting
   the decision rule.
3. Before deployment, the `EXPLAIN` on NTER is within the bar.
4. After deployment:
   - the live `eval` meets the bar against the live baseline;
   - "Ask about this document" on a cited Regulatory document gives
     citations only from it;
   - desk focus on Parliamentary Questions cites only parliamentary
     questions;
   - desk focus on a module with no documents shows no banner.
5. A rollback rehearsal on the replica restores one overload and the
   baseline figures.

## Scope

- `research-chat/{validate,handler,index,agent,prompt}.ts`;
- `_shared/retrieval.ts`;
- one migration and a new fixture, plus `run.sh`;
- `src/ai/{AiPanel,WorkSurface}.jsx`;
- `src/lib/{aiDrop,corpusCoverage}.js`;
- tests for all of the above;
- `scripts/eval-replica/`;
- the `eval` `--target replica` option;
- the measurements report;
- two new open-work items: the document picker, and the model-chosen
  feature filter.

## Exclusions

- A document picker.
- The model choosing a feature.
- A feature column on chunks.
- New return columns (`chunk-contract`).
- Reranking and hybrid search (P6).
- Any change to the scoped branch or its quota.
- Ingestion.

## Review record

A fresh-context adversarial review of revision 1 (2026-09-30) raised 16
findings. All were accepted and addressed:

1. Comparing replica figures with live was invalid: every comparison is now
   replica against replica, and the replica carries fingerprint data.
2. The latency bar couldn't be measured: an absolute feature bar, the
   `authenticated` role in the replica, and an `EXPLAIN` on NTER.
3. The module list was capped at 1,000 rows: `document_modules()` replaces
   it.
4. "Any document" overclaimed: it is now "any cited document", with the
   picker deferred and shared scope disclosed.
5. The model's feature choice was unmeasured: it is dropped from this
   module.
6. The SQL test was vacuous: a new fixture, red against an H-only body.
7. Deploy and rollback were coupled: the argument is omitted, and the order
   is fixed.
8. Grants: public and anon are now revoked, and the fixture asserts it.
9. `set_config` could leak into later statements: a helper with a `SET`
   clause instead.
10. A big exact scan could slow everyone else's searches: a concurrency
    check, plus the `Eh` candidate.
11. Widening semantics were loose: reasons, texts, `inputKey`, and no banner
    when there are no documents.
12. The browser interface was wrong: `onAskAboutDocument`, `attach`'s
    function argument, and the focus persistence decided.
13. Chip rendering in the prompt: a pointer line.
14. Matching and validation edges: tier and feature, empty strings, a 400
    on a bad UUID, `indexed_at` for keys too.
15. Replica logistics: a paged, rate-limited read, the guard, and the
    commands.
16. The "1,235 documents" figure was wrong: it is 1,235 of 9,415 keys.
