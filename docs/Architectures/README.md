# Niyantran Terminal — Master Architecture & Technical Documentation

> **Status: Living.** Reconciled 2026-10-03 against the current checkout.
> Dated infrastructure versions and counts are maintained in [open-work](../plans/open-work.md).
> Comprehensive architectural blueprints, data dictionaries, wire protocols, and security matrices for Niyantran Terminal (NTER).

---

## 1. System Mission & Ecosystem Architecture

Niyantran Terminal is an institutional-grade intelligence workbench designed for analysts, legal researchers, and policy strategists. It provides real-time verification of claims against public records: parliamentary bills, gazette notifications, committee reports, regulatory rulings, court orders, and economic datasets.

The system is architected around a fundamental principle: **Parametric LLM weights are never trusted for facts; only server-grounded, cryptographically cited passages constitute the record.**

```mermaid
graph TB
    subgraph ClientTier["Client Tier (Browser / React 19 + Vite)"]
        UI["AiPanel & useResearchThread<br/>(Reactive Workbench)"]
        Reader["SourceReader.jsx<br/>(DOM Span Verification)"]
    end

    subgraph EdgeTier["Edge Compute Tier (Supabase Edge Runtime / Deno)"]
        RC["research-chat<br/>(Agent Loop & Streamer)"]
        ID["ingest-documents<br/>(Chunker & Vectorizer)"]
        RP["refresh-model-pricing<br/>(Catalog Sync Every 12 Hours)"]
        AM["admin-models<br/>(Allowlist & Role API)"]
        HE["health<br/>(Verification Probe)"]
        DB["desk-brief<br/>(One-Row Brief)"]
        IW["ingest-worker (Queued PDF OCR & Indexing)"]
        AI["admin-ingest (Admin Upload & Records)"]
        DF["document-file (Private PDF Signing)"]
        Shared["_shared/ Library<br/>(Auth, CORS, Handles, Stream)"]
    end

    subgraph DatabaseTier["Persistence Tier (PostgreSQL 17 + Extensions)"]
        DocCorpus[("Document Corpus<br/>documents & document_chunks<br/>(halfvec HNSW; dated counts in open-work)")]
        DeskData[("Desk Datasets<br/>desk_rows (structured records)<br/>(GIN Trigram & JSONB)")]
        ChatState[("Chat & Turn State<br/>conversations, chat_messages,<br/>research_turns (Mutex)")]
        Telemetry[("Telemetry & Admin<br/>model_pricing, ai_models,<br/>chat_turn_traces, call_logs")]
        RPCs["Versioned RPCs<br/>(match_documents, search_desk_rows,<br/>chunk_commit, lookup/claim/finalize)"]
    end

    subgraph ExternalTier["External Intelligence Providers"]
        OR["OpenRouter API<br/>(Primary LLMs: DeepSeek, Claude, GPT)"]
        OAI["OpenRouter Embeddings API<br/>(openai/text-embedding-3-small)"]
        OCR["Mistral OCR (Approved Direct Capability)"]
        Gemini["OpenRouter<br/>(citation repair model from AI_REPAIR_MODEL)"]
    end

    IW --> OCR
    IW --> OAI
    AI --> Shared
    DF --> Shared
    IW --> Shared
    UI <-->|HTTP POST / SSE Stream| RC
    Reader <-->|Verify ref: Spans| DocCorpus
    ID <-->|1536-dim Vectors| OAI
    RC <-->|Stream Tokens & Tools| OR
    RC <-->|Citation Auto-Repair| Gemini
    RP <-->|Fetch Catalog & Pricing| OR
    DB <-->|JSON Brief| OR

    RC --> Shared
    ID --> Shared
    RP --> Shared
    AM --> Shared
    HE --> Shared
    DB --> Shared

    Shared <-->|RPC & SQL (JWT RLS / Service Role)| RPCs
    RPCs <--> DocCorpus
    RPCs <--> DeskData
    RPCs <--> ChatState
    RPCs <--> Telemetry
```

---

## 2. The 6-Volume Documentation Index

The architecture is documented across six specialized volumes. Each volume covers a distinct layer of the stack with full wire contracts, schemas, and visual diagrams:

| Document | Title | Core Subsystems Covered | Primary Audience |
| :--- | :--- | :--- | :--- |
| [**`01-ingestion-pipeline.md`**](./01-ingestion-pipeline.md) | **Dual Ingestion & Structural Chunking** | OCR sidecar processing, PDF extraction, atomic table preservation (`colspan`/`rowspan`), deterministic chunk hashing (ADR 0004), 100-chunk slice commits (preventing Postgres OOM), PostgREST 1000-row pagination loop, desk row pin-key generation. | Data Engineers, Pipeline Developers |
| [**`02-database-schema-and-tables.md`**](./02-database-schema-and-tables.md) | **Database Schema & Entity Topology** | Mermaid ER diagram of the AI-backend tables and data dictionary (33 public tables observed on 2026-10-03, including page, storage, queue and corpus-audit tables), full data dictionary, indexing topology (half-precision HNSW cosine index, 204 MB since F22 on 2026-09-29, `pg_trgm` GIN, JSONB GIN, index-only window scans), RLS permissions matrix across roles. | Database Administrators, Backend Engineers |
| [**`03-rag-and-sql-retrieval.md`**](./03-rag-and-sql-retrieval.md) | **Dual Retrieval Architecture: RAG & SQL** | Dual routing philosophy, post-mortem of D1 HNSW post-filtering bug (which dropped 98% of candidates) and B-tree pre-filter resolution (`20260922104646`), fair quota partitions, dynamic parameterized SQL, zero-spill window scans, cryptographic citation ladder (`ref:xxxxxx-n`). | Search Engineers, AI Architects |
| [**`04-prompt-sandwich-and-agent-engine.md`**](./04-prompt-sandwich-and-agent-engine.md) | **Prompt Sandwich & Agent Engine** | Master Prompt Sandwich visual blueprint, 60,000-character rolling window algorithm (`windowMessages`), verbatim system prompt blocks (`ROLE`, `GROUNDING`, `TOOLS`, `DESK_GROUNDING_RULES`), tool wire payloads, strict JSON schema streaming decoder, citation auto-repair pass (`repair.ts`), `research_turns` concurrency mutex. | Prompt Engineers, Full-Stack AI Engineers |
| [**`05-supabase-edge-functions.md`**](./05-supabase-edge-functions.md) | **Edge Functions & Shared Runtime** | Catalog of all nine functions (including `ingest-worker`, `admin-ingest` and `document-file`), Deno runtime configuration, bounded execution wrapper (`NETWORK_TIMEOUT_MS = 4_000`), key rotation architecture (`SUPABASE_SECRET_KEYS`), OOM crash prevention, shared library catalog (`_shared/`). | Platform Engineers, Cloud DevOps |
| [**`06-stored-procedures-and-rpcs.md`**](./06-stored-procedures-and-rpcs.md) | **Stored Procedures, RPCs & Security** | Catalog of the AI-backend stored procedures, the service-role functions added on 2026-09-28 and the plan-entitlement functions added on 2026-09-29, RPC Invocation Sandwich blueprint, B-tree vector pre-filtering, dynamic SQL assembly without `OR IS NULL`, 1536-dim vector assertion, `research_turns` lifecycle, pricing reconciliation, `search_path = ''` hardening audit, execution grant matrix. | Database Engineers, Security Auditors |

---

## 3. The Unifying "Sandwich" Architectural Pattern

Across every layer of Niyantran Terminal, complex multi-step operations are organized using the **Sandwich Layer Architecture**. Immutable security boundaries, deterministic pre-filters, and strict schemas form the outer layers (the bread), safely encapsulating dynamic user inputs, business logic, and database operations (the filling):

```
+--------------------------------------------------------------------------------------------------+
| 1. THE PROMPT SANDWICH (LLM Context Assembly)                                                    |
|    Top: Immutable Cacheable Prefix (ROLE, GROUNDING, TOOLS, CITATIONS)                           |
|    Filling: Rolling History Window (60k chars) + Active User Prompt + Untrusted Attachments      |
|    Bottom: Pre-flight Guard (BEFORE_YOU_ANSWER) + Strict JSON Schema (ANSWER_JSON_SCHEMA)        |
+--------------------------------------------------------------------------------------------------+
| 2. THE INGESTION CHUNK SANDWICH (Data Pipeline Storage)                                          |
|    Top: Metadata & Identity Header (UUID, deterministic SHA-256 chunk_hash, chunk_index)         |
|    Filling: Structural Content & Atomic Tables (~1,000 chars target, rowspan/colspan preserved)  |
|    Bottom: Vector Embedding & Provenance Footer (1536-dim vector, character coordinate spans)    |
+--------------------------------------------------------------------------------------------------+
| 3. THE DESK ROW PIN-KEY SANDWICH (Tabular Identity)                                              |
|    Top: Namespace Identity Header (tier: feature)                                                |
|    Filling: First available row identity; normalized record-text hash fallback                      |
|    Bottom: Scalar pin key or FNV-1a fallback; tier/feature form the namespace               |
+--------------------------------------------------------------------------------------------------+
| 4. THE RETRIEVAL EXECUTION SANDWICH (Vector Search)                                              |
|    Top: Query Vector & Pre-Filter Boundary (B-tree index scan on c.document_id)                  |
|    Filling: Fair-Quota Partition & In-Memory Exact Scoring (row_number() OVER (...) <= v_quota)   |
|    Bottom: Late Metadata Join & Citation Nonce Assignment (ref:xxxxxx-n)                         |
+--------------------------------------------------------------------------------------------------+
| 5. THE SQL DESK SEARCH SANDWICH (Tabular Query)                                                  |
|    Top: Dynamic Parameterized Predicate Assembly (100% injection-safe USING bindings)            |
|    Filling: Dual-Index Accelerated Filtering (pg_trgm GIN on record_text + JSONB GIN on row)      |
|    Bottom: Zero-Spill Index-Only Window Scan & Late Join (count(*) OVER () on pkey only)         |
+--------------------------------------------------------------------------------------------------+
| 6. THE EDGE FUNCTION EXECUTION SANDWICH (Serverless API)                                         |
|    Top: Ingress Perimeter & CORS Preflight (allowedOrigins, requireUser JWT validation)          |
|    Filling: Bounded Network Wrapper (4000ms bound) + Core Multi-Turn Agent Loop                  |
|    Bottom: Wire Streaming (SSE/JSON) + Detached Telemetry Flush (EdgeRuntime.waitUntil)          |
+--------------------------------------------------------------------------------------------------+
| 7. THE RPC INVOCATION SANDWICH (PostgreSQL Stored Procedures)                                    |
|    Top: Search Path Hardening (SET search_path = '') & Type Validation                           |
|    Filling: Concurrency Mutex Locks (SELECT ... FOR UPDATE) + Core SQL Business Logic           |
|    Bottom: Trigger Integrity Assertions (guard triggers) + Structured JSONB/Table Returns       |
+--------------------------------------------------------------------------------------------------+
```

---

## 4. Engineering Verification Runbook

To verify code changes, migrations, and Edge Function behaviors against the verified baseline:

### 4.1 Edge Function & Shared Library Tests (Deno)
```bash
# Run all Deno Edge Function tests (447 passed, 38 files, as of 2026-09-29; CI runs this command on every push)
deno test -A --config supabase/functions/deno.json supabase/functions/

# Run research-chat tests only
deno test -A --config supabase/functions/deno.json supabase/functions/research-chat/

# Run shared module tests only
deno test -A --config supabase/functions/deno.json supabase/functions/_shared/
```

### 4.2 Browser Application & Desk Feeds (Vitest)
```bash
# Run all Vitest tests (66 files, 958 tests on 2026-09-29; also run by CI)
npm test
```

### 4.3 Production Build Verification
```bash
# Lint fails on errors or warnings; no standalone type-check exists
npm run lint

# Production build
npm run build
```

### 4.4 SQL Fixtures (disposable local Postgres only)
```bash
# 15 fixtures in supabase/tests/ (plus two bootstrap files), each rebuilt from scratch and checked for vacuity
npm run test:sql
```

`.github/workflows/ci.yml` runs lint, the build, both test suites and the SQL fixtures on every push. It is advisory: nothing is blocked on it.

`backend/sql/auth_schema.sql` is not the source of truth for the live schema: no migration creates it, and parts of it have drifted before. It is kept because `supabase/tests/run.sh` uses it, with `bootstrap_auth.sql`, to bootstrap the disposable fixture databases (section 23 deliberately duplicates migration 0012, which is where the vacuity check cuts it). Its header says the same. Read `information_schema.columns` on the live project before trusting a column in it (open-work F19).

---

## 5. Security & Operating Principles

1. **Zero Secret Leakage:** The provider API key (`OPENROUTER_API_KEY`) and platform secrets (`SUPABASE_SECRET_KEYS`) are stored strictly server-side. No `VITE_` variable may ever carry a service credential.
2. **Untrusted Evidence Isolation:** External feeds, parsed OCR text, user attachments, and LLM completions are treated as untrusted evidence, never instructions.
3. **Deterministic Immutability:** Terminal results in `chat_messages` and claims in `research_turns` are guarded by PostgreSQL triggers that raise exception `23514` on tampering attempts.
4. **Idempotent Concurrency:** Double submissions and concurrent tabs acquire distributed locks via `claim_research_turn`, returning cached streams rather than triggering redundant billable calls.
