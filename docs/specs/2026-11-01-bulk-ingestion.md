# Bulk corpus ingestion

> **Status: Living (draft, 2026-11-01).** Not approved. The developer (Vighnesh Shukla) asked for this spec on 2026-11-01:
> "We have more than 18 million documents to ingest. We need to figure out a faster process." It changes who runs
> ingestion and how runs are approved. So it needs the owner's sign-off, in one consolidated decision message, before
> any part replaces the [rules for every ingestion run](../operations/2026-10-28-corpus-client-handoff.md#rules-for-every-ingestion-run-owner-2026-10-29).
> Open work: F278 (this spec) and F279 (capacity decision).

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
| Reliability | an `admin-ingest` response stalled 44 s after a committed write (F274); the importer now retries once (#87) |

## 2. Problem

**At 18 million documents, the current process does not finish:**
- **Time:** about 21,000 hours of submission.
- **Approvals:** about 25,000 owner approvals and sign-ins.
- **Storage:** about 400 million chunks and about 6.5 TB, of which about 1.5 TB is HNSW index that has to sit in memory to be fast.
- **Search:** feature search already fails above 100,000 chunks.

**Cost is not the constraint.** At today's rate, embedding everything costs about US$800.

**Two things block it:**
- every run needs the client's attention;
- one Postgres database with one HNSW index is the wrong shape for this volume.

## 3. Outcome

- The client approves **policy once per collection**, not every run. After that it hears from us only about policy
  questions and stops that need it.
- The developers run ingestion on a **server-side bulk pipeline**: batched, parallel, resumable, and stopped
  automatically by explicit limits. It uses no personal session tokens.
- **Acceptance is mostly automatic**, with a short developer spot check per collection.
- **A recorded capacity decision** fixes where text, vectors and search live before the corpus passes about 1 million
  documents.

## 4. Proposed design

### 4.1 Approval model (replaces rules 1–5 and 7 for bulk work; needs the owner's sign-off)

| Level | Who | What | How often |
|---|---|---|---|
| Collection policy | owner | scope, exclusions (personal data, `servable=false`, sensitive cases), budget ceiling, stop rules | once per collection, or when the policy changes |
| Batch manifest | developers | generated and checked automatically: hashes, counts, chunk and cost estimates, duplicates against live | every batch, no owner involvement |
| Stop | pipeline | stops itself on a refusal class above threshold, an uncertain outcome after retry, cost or chunk overrun, or an error-rate breach | automatic; developers resume after the fix |
| Acceptance | pipeline, then developers | automated sample checks per batch (§4.3); one manual spot check per collection | every batch / once per collection |
| Report | developers | a summary per collection, and anything that needs a policy decision | per collection |

The F266 admission checks, idempotent registration and the per-source lock stay as they are. Payments, billing and
user accounts are outside this pipeline and keep their hard stop.

### 4.2 Bulk pipeline

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

### 4.3 Automated acceptance per batch

For a random sample of documents in each batch, the pipeline checks that:
- the stored text hash equals the pack;
- the chunk count and vectors are complete;
- the listing links resolve `full` under the signed-in role;
- a retrieval probe built from a passage of the document returns that document first.

Results go into the batch receipt automatically. A batch whose sample fails stops the collection.

### 4.4 Capacity (decision F279, after the inventory)

Options to evaluate against the real inventory:
1. **Partitioning:** chunks partitioned by desk or collection, with a vector index per partition.
2. **Two tiers:** every document stored with metadata and keyword search, and embeddings only where meaning-based
   search is needed (or computed on first use).
3. **External vector store:** a dedicated store for vectors, with Postgres keeping the records, text and links.
4. **Bigger instance or read replicas:** this raises cost without changing the shape.

The decision is recorded in `docs/decisions/` with measured costs, latency and the F272 bound for each candidate. It is
made before the ramp passes 1 million documents.

## 5. Inventory first

The client's agent produces one read-only inventory of every pack it holds:
- counts by collection;
- supplied text versus OCR needed;
- personal-data and `servable=false` counts;
- duplicates within and across packs;
- chunk estimates from `supabase/functions/_shared/chunking.ts`.

Per-collection key lists (`source_key`, text hash, chunk estimate) go to Drive. The developers compute overlap with
the live database from those lists. This replaces the guesswork in §2 with real numbers. The "18 million" figure is
not yet accounted for: the packs known so far (National v1.1–v1.5, the 74 GB legal pack) look like hundreds of
thousands of documents.

## 6. Ramp and acceptance evidence

| Step | Gate to pass before the next |
|---|---|
| 10,000 documents (one admitted collection) | batch receipts complete; automated sample 100%; verify equals plan; search p95 latency and F272 behaviour measured |
| 100,000 | same, plus database size and index build time against the projection; spend within ceiling |
| 1,000,000 | F279 decided and implemented; the same gates on the chosen design |
| Beyond | per collection, under its approved policy |

## 7. Scope and exclusions

**In scope:** the approval model, the bulk pipeline, automated acceptance, the capacity decision, and the inventory.

**Out of scope:**
- **Billing and accounts:** payments, credits and user accounts.
- **Policy-gated collections:** personal-data collections (affidavits, MP profiles) until the owner sets a policy.
- **Destructive changes:** the v1.2 text replacements (1,819), which stay a separately reviewed developer step.
- **Search behaviour:** any change to retrieval semantics without its own spec.
- **Cohorts still in flight:** they run under the current rules until this spec is approved.

## 8. Decisions needed

**From the owner, in one message:**
1. The approval model in §4.1.
2. The collections in and out.
3. The budget ceiling.
4. Data access for the pipeline.
5. What the 18 million documents are, if more than the packs the agent holds.

**From the developers:**
6. The runner host.
7. The capacity option (F279).
8. Provider batch embedding.

## 9. Plan (tasks, after approval)

1. Inventory (client agent, read-only), then the developers' overlap analysis.
2. F279 capacity decision record, with measurements on a disposable copy.
3. Set-based registration RPC and fixtures (SQL authorization tests, vacuity), with no change to admission rules.
4. Runner, ledger and stop rules, with offline tests and a dry run against a disposable database.
5. Automated acceptance checks.
6. Ramp per §6.
