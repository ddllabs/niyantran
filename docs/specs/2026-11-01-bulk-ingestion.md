# Bulk corpus ingestion

> **Status: Living (draft, 2026-11-01).** Not approved. The developer (Vighnesh Shukla) asked for this spec on 2026-11-01:
> "We have more than 18 million documents to ingest. We need to figure out a faster process." It changes who runs
> ingestion and how runs are approved. So it needs the owner's sign-off, in one consolidated decision message, before
> any part replaces the [rules for every ingestion run](../operations/2026-10-28-corpus-client-handoff.md#rules-for-every-ingestion-run-owner-2026-10-29).
> Open work: F278 (this spec) and F279 (capacity decision).
>
> **Revision 2026-11-01:** the developer agreed that retrieval comes first. §4 now defines how chunks are divided,
> filtered and searched, and every later step (adapters, the pipeline, the capacity decision) builds on it.

## 1. Current state (measured 2026-10-31 and 2026-11-01)

**How a document gets in today:**
1. The client's agent runs a cohort from a Colab notebook.
2. `scripts/corpus-text-import.mjs` posts one document per request to `admin-ingest`, using the owner's own nter.pro
   session token, which is typed for each run and expires within about an hour.
3. `ingest_register_text` writes the document and its job under a per-source lock.
4. `ingest-worker` chunks the text and embeds it with `openai/text-embedding-3-small` through OpenRouter (batches of
   up to 96 inputs or 200,000 tokens), then activates the chunks.

| Measure | Value |
|---|---|
| Throughput, remainder cohort | 523 documents in two submissions of about 23 and 20 minutes: about **850 documents an hour** |
| Approvals | one owner approval of an exact manifest and one owner sign-in per run (rules 1, 2 and 7) |
| Acceptance | five signed-in research chats per cohort, by hand (rule 5) |
| Embedding cost | US$0.0235 for 523 documents, about 2,250 tokens and **US$0.000045 per document** |
| Database | 17,496 documents, 391,555 chunks, **6.5 GB** in all; chunks with indexes 5.2 GB, about **14 kB per chunk**; about 22 chunks per document |
| Vector index | `document_chunks_embedding_halfvec_hnsw`, **1.5 GB**, about 3.9 kB per chunk |
| Search bound | feature search recovers exactly only up to 100,000 chunks per feature (F272). NCLT already has 225,273 |
| Search shape | one HNSW index over every chunk; the feature filter is applied **after** the index returns its 400 nearest candidates (`match_documents_feature_hnsw`, ef_search 400). Chunks carry no tier, feature or date of their own: the filter joins `documents` |
| Feature shares of indexed chunks | NCLT / NCLAT 57.3%, Bills 22.7%, Parliamentary Questions 17.3%, Regulatory 2.7%, Industry and Budget under 0.1% |
| Keyword search | none: no `tsvector` column or full-text index on chunks |
| Reliability | an `admin-ingest` response stalled 44 s after a committed write (F274); the importer now retries once (#87) |

## 2. Problem

**At 18 million documents, the current process does not finish:**
- **Time:** about 21,000 hours of submission.
- **Approvals:** about 25,000 owner approvals and sign-ins.
- **Storage:** about 400 million chunks and about 6.5 TB, of which about 1.5 TB is HNSW index that has to sit in memory to be fast.
- **Search:** feature search already fails above 100,000 chunks.

**Cost is not the constraint.** At today's rate, embedding everything costs about US$800.

**Three things block it:**
- every run needs the client's attention;
- search filters after the index, so a narrow scope gets fewer good candidates the larger the corpus grows (§4.1);
- one Postgres database with one HNSW index is the wrong shape for this volume.

## 3. Outcome

- **Search is scoped before it ranks.** A feature-scoped search reads only that feature's index, finer filters run
  inside the index walk, and keyword and meaning-based results are combined. Retrieval quality is measured per feature
  and does not fall as the corpus grows.
- The client approves **policy once per collection**, not every run. After that it hears from us only about policy
  questions and stops that need it.
- The developers run ingestion on a **server-side bulk pipeline**: batched, parallel, resumable, and stopped
  automatically by explicit limits. It uses no personal session tokens.
- **Acceptance is mostly automatic**, with a short developer spot check per collection.
- **A recorded capacity decision** fixes where text, vectors and search live before the corpus passes about 1 million
  documents.

## 4. Retrieval foundation (built first)

Every document ingested before this lands would have to be moved, re-labelled or re-embedded later. So it comes before
any new adapter and before the bulk pipeline.

### 4.1 Where scoping happens: three layers, one table

There are three ways to scope a vector search. The design uses each for what it is good at:

| Approach | What it does | Good for | Why it is not the main cut |
|---|---|---|---|
| **Filter after the search** (today) | the index returns its N nearest chunks from the whole corpus, then rows outside the scope are dropped | a final access check | a scope holding p of the corpus keeps about N × p candidates. With N = 400, Regulatory (2.7%) keeps about 11 of the 40 requested, so the search falls back to an exact scan, which F272 caps at 100,000 chunks. At hundreds of millions of chunks every feature is a small slice |
| **Metadata on each chunk, filtered during the walk** (pgvector 0.8 `hnsw.iterative_scan`) | the index keeps walking until enough chunks pass the filter | fine filters inside a feature: year, court, ministry, state | the walk visits about k / p chunks. At 2.7% that is about 1,500 for 40 results; at 0.01% it is close to a full scan |
| **Separate vector tables** | one table and index per feature | an index that holds only the scope | every RPC, access policy, trigger and worker path would be copied 83 times, and cross-feature search would be a hand-written union |

**Decision: one logical `document_chunks` table, list-partitioned by feature, with chunk-level metadata and the
access check last.**
1. **Partition (the coarse cut).** Postgres partitions `document_chunks` by `desk_feature`, with an HNSW index on each
   partition. A query that names a feature reads only that partition's index, so its candidates are all in scope.
   Code still sees one table, so RPCs, access policies and the worker stay single. A search across features reads every
   partition's index and merges the ordered results.
   - **Threshold.** A feature gets its own partition when it passes 100,000 chunks (the F272 bound). Smaller features
     share a default partition, where an exact search inside the feature stays cheap.
   - **Sub-partitions.** A feature that grows past a measured size (NCLT is the first candidate) is sub-partitioned by
     its strongest facet, such as year, chosen from the eval in §4.4.
2. **Facets (the fine cut).** Chunks carry indexed copies of the document fields that searches filter on: `desk_tier`,
   `desk_feature`, document date, jurisdiction or state, source type, language and `servable`. The exact list per
   collection comes from the inventory (§6). The document stays the source of truth; a trigger keeps the chunk copies
   equal, and a document whose feature changes moves partition with its chunks.
3. **The access check stays last.** Row access, `indexed_at` and `servable` are still enforced on every result. They
   are never used to scope.

The current `section` key in chunk `metadata` stays. The ontology in `supabase/functions/_shared/deskCatalog.json`
(83 entries: global 16, national 12, state 22, law 12, economics 6, carbon 4, sports 6, entertainment 5) is the
partition and facet vocabulary. Its tiers are too coarse to partition by: law alone is 57% of chunks today.

**Typed columns, not a JSON filter.** Supabase's documented filter pattern is a `jsonb` metadata column matched with
`metadata @> filter` inside the match function, which is the same filter-after-the-index search as today. Facets are
ordinary typed, indexed columns instead:
- the partition key has to be a column;
- the planner keeps statistics on columns and can estimate how selective a filter is;
- iterative index scans filter on them during the walk.

Supabase Vector Buckets (S3-backed, in preview) also filter on metadata. They are a candidate for F279's external
store, not for this step.

### 4.2 Hybrid search

Legal and parliamentary questions often turn on exact identifiers: case numbers, section numbers, bill titles,
question numbers. Meaning-based search alone ranks those poorly.
- Each partition gets a full-text column (generated `tsvector`) with a GIN index. The text configuration is chosen by
  the eval in §4.4.
- The search RPCs run the keyword and vector searches in the same scope and combine them with reciprocal rank fusion.

### 4.3 Contextual chunk headers

Each chunk's embedding input is prefixed with a short header built from its document: title, feature, date and
section. A chunk that says "the respondent's appeal is dismissed" then also carries which case it belongs to.
- **Stored text is unchanged.** Only the embedded input changes, and `embed_hash` records the change.
- **Re-embedding.** The 391,555 existing chunks are re-embedded through the worker's normal path. At today's rate of
  about 225 tokens per chunk and US$0.02 per million tokens, that is roughly US$2–3.

### 4.4 Measured before it ships

- **Eval set.** A per-feature set built with the existing tooling (`src/lib/evalSet.js`, `src/lib/retrievalEval.js`,
  `scripts/eval-retrieval.mjs`), at least 50 queries for each feature above 10,000 chunks. It mixes passage probes
  (the document must come back first) with developer-written research questions. It uses no user queries.
- **Baseline first.** Recall@10, the rate of `FEATURE_SEARCH_RECOVERY_LIMIT`, and p95 search latency, all measured on
  today's shape on a disposable copy.
- **Gate.** Each step in §4.1–4.3 ships only if recall@10 is equal or better for every feature, and p95 latency is no
  worse. Each is measured on its own, so a step that does not help is dropped.
- **Production.** The partition migration rebuilds the chunk table and its indexes. It is tested end to end on a
  disposable database, with SQL fixtures for the access policies, and applied to production only with the
  developer's explicit authorization of that migration.

### 4.5 Existing chunks and new chunks

**Existing chunks are backfilled once, inside the migration.** Only the context headers call the embedding API.

| Part | Existing 391,555 chunks | New chunks |
|---|---|---|
| Partition | copied into the partitioned table with their vectors unchanged; per-partition indexes built; then the tables swap. Built side by side, so search keeps running until the swap | land in their feature's partition on insert |
| Facets | filled by SQL from each document's stored metadata. No source files, no OCR and no API calls | written by the worker on insert; the trigger keeps them equal to the document |
| Keyword search | generated column, computed during the copy | computed on insert |
| Context headers | re-embedded in background batches, about US$2–3. The old vector serves until the new one replaces it | embedded with the header from the start |

**What the stored metadata already holds** (measured 2026-11-01, read-only). Documents keep their source fields in
`metadata.citation`:

| Feature | Facet fields present | Coverage |
|---|---|---|
| NCLT / NCLAT | case number, order date, forum, bench, section, order type | case number and order date on all 7,549 documents; bench filled on none |
| Parliamentary Questions | question number, answered on, ministry, house, session, subject | number and ministry on 6,601 of 6,683; no ISO answer date, so dates are absent or need normalising |
| Bills | bill number, year, house, ministry, status, introduced on | 1,149 of 2,893 |
| Regulatory, Budget, Industry | source host and document type only | the regulator or ministry has to be derived |

`metadata.as_of` is the pack date (one or three values per feature), not the document's date, so it is not a facet.

**Rules for the backfill:**
- A facet that is null never matches a filter on it. So a facet is offered as a filter only once its coverage in that
  feature is measured and recorded (plan step 2).
- Missing facets are filled from the packs and listings during each collection's adapter work, not by OCR or guessing.
  The Bills gap (1,744 documents without citation fields) is part of the Bills adapter.

## 5. Ingestion design

### 5.1 Approval model (replaces rules 1–5 and 7 for bulk work; needs the owner's sign-off)

| Level | Who | What | How often |
|---|---|---|---|
| Collection policy | owner | scope, exclusions (personal data, `servable=false`, sensitive cases), budget ceiling, stop rules | once per collection, or when the policy changes |
| Batch manifest | developers | generated and checked automatically: hashes, counts, chunk and cost estimates, duplicates against live | every batch, no owner involvement |
| Stop | pipeline | stops itself on a refusal class above threshold, an uncertain outcome after retry, cost or chunk overrun, or an error-rate breach | automatic; developers resume after the fix |
| Acceptance | pipeline, then developers | automated sample checks per batch (§5.3); one manual spot check per collection | every batch / once per collection |
| Report | developers | a summary per collection, and anything that needs a policy decision | per collection |

The F266 admission checks, idempotent registration and the per-source lock stay as they are. Payments, billing and
user accounts are outside this pipeline and keep their hard stop.

### 5.2 Bulk pipeline

- **Runner.** A developer-operated job runner holds a scoped ingestion credential server-side. It never uses a
  person's session; the server-issued grant bound to a manifest (F275) is one option. It reads the packs from storage
  directly, so no Colab and no Drive mount are involved.
- **Writes.**
  - Set-based registration of a batch of documents per call, not one Edge Function request per document. This also
    removes the F274 stall from the path.
  - Same admission rules, keyed by `source_key` and payload hash, so reruns are idempotent.
- **Embedding.**
  - Batched across documents, with concurrency limits.
  - Use a provider batch endpoint where available (about half price). It may need a direct provider API if
    OpenRouter lacks one, as already allowed for OCR.
- **Checkpoints.** A ledger of batches (manifest hash, state, counts, spend), so any stop resumes exactly.

### 5.3 Automated acceptance per batch

For a random sample of documents in each batch, the pipeline checks that:
- the stored text hash equals the pack;
- the chunk count and vectors are complete;
- the listing links resolve `full` under the signed-in role;
- a retrieval probe built from a passage of the document returns that document first.

Results go into the batch receipt automatically. A batch whose sample fails stops the collection.

### 5.4 Capacity (decision F279, after the inventory)

Partitioning by feature is decided in §4.1. It fixes scoping, not size: at about 400 million chunks the partitions'
HNSW indexes still total about 1.5 TB, and an index outside memory is slow. Options to evaluate against the real
inventory, on top of the partitions:
1. **Smaller vectors:** binary or lower-dimension vectors in the index, re-ranked with the full vectors, to cut index
   memory several-fold.
2. **Two tiers:** every document stored with metadata and keyword search, and embeddings only where meaning-based
   search is needed (or computed on first use).
3. **External vector store:** a dedicated store for vectors (one namespace per partition), with Postgres keeping the
   records, text and links.
4. **Bigger instance or read replicas:** this raises cost without changing the shape.

The decision is recorded in `docs/decisions/` with measured costs, latency and the F272 bound for each candidate. It is
made before the ramp passes 1 million documents.

## 6. Inventory first

The client's agent produces one read-only inventory of every pack it holds:
- counts by collection;
- supplied text versus OCR needed;
- personal-data and `servable=false` counts;
- duplicates within and across packs;
- chunk estimates from `supabase/functions/_shared/chunking.ts`;
- which facet fields (§4.1) each collection carries, and how complete they are: date, jurisdiction or state, court
  or ministry, language.

Per-collection key lists (`source_key`, text hash, chunk estimate) go to Drive. The developers compute overlap with
the live database from those lists. This replaces the guesswork in §2 with real numbers. The "18 million" figure is
not yet accounted for: the packs known so far (National v1.1–v1.5, the 74 GB legal pack) look like hundreds of
thousands of documents.

## 7. Ramp and acceptance evidence

| Step | Gate to pass before the next |
|---|---|
| Before any bulk batch | the retrieval foundation (§4) is live and its eval gate passed |
| 10,000 documents (one admitted collection) | batch receipts complete; automated sample 100%; verify equals plan; the §4.4 eval rerun with no feature's recall@10 lower, and p95 latency measured |
| 100,000 | same, plus database size and index build time against the projection; spend within ceiling |
| 1,000,000 | F279 decided and implemented; the same gates on the chosen design |
| Beyond | per collection, under its approved policy |

## 8. Scope and exclusions

**In scope:** the retrieval foundation, the approval model, the bulk pipeline, automated acceptance, the capacity
decision, and the inventory.

**Out of scope:**
- **Billing and accounts:** payments, credits and user accounts.
- **Policy-gated collections:** personal-data collections (affidavits, MP profiles) until the owner sets a policy.
- **Destructive changes:** the v1.2 text replacements (1,819), which stay a separately reviewed developer step.
- **Other search behaviour:** retrieval changes beyond §4 (for example answer generation, re-rankers, or the research
  chat's prompts) need their own spec.
- **Cohorts still in flight:** they run under the current rules until this spec is approved.

## 9. Decisions needed

**From the owner, in one message:**
1. The approval model in §5.1.
2. The collections in and out.
3. The budget ceiling.
4. Data access for the pipeline.
5. What the 18 million documents are, if more than the packs the agent holds.

**From the developers:**
6. Retrieval foundation (§4): agreed on 2026-11-01. Still to decide from the eval: the facet list per collection,
   the sub-partition rule, and the full-text configuration.
7. The runner host.
8. The capacity option (F279).
9. Provider batch embedding.

## 10. Plan (tasks, after approval)

The retrieval steps (2–6) are developer work and do not wait for the owner's message. The inventory (1) runs in
parallel.

1. Inventory (client agent, read-only), then the developers' overlap analysis.
2. Retrieval eval set and baseline on today's shape (§4.4), on a disposable copy, with facet coverage per feature (§4.5).
3. Partitioned `document_chunks` with chunk facets and the sync trigger: migration, access-policy fixtures (with a
   vacuity check), search RPCs updated, and the eval rerun. This retires F272's 100,000-chunk bound for partitioned
   features. Existing chunks are backfilled inside this migration (§4.5); the vectors are copied, not recomputed.
4. Hybrid search (§4.2), gated by the eval.
5. Contextual headers and re-embedding (§4.3), gated by the eval.
6. Bills adapter (F275) on the new shape, writing facets from its first document.
7. F279 capacity decision record, with measurements on a disposable copy.
8. Set-based registration RPC and fixtures (SQL authorization tests, vacuity), with no change to admission rules.
9. Runner, ledger and stop rules, with offline tests and a dry run against a disposable database.
10. Automated acceptance checks.
11. Ramp per §7.
