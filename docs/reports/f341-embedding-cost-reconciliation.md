# F341 (main: F419) Embedding Cost & Model Telemetry Reconciliation

> **Status: Historical (2026-11-18).** From the contributor's file-manager branch (a4a09d84); records work as it stood then.

> **Branch status: Normative Record**  
> **Feature:** F341 — Private File Manager & AI Retrieval  
> **Component:** Ingestion Pipeline, Embedding Telemetry & Cost Accounting  
> **Author:** Principal Engineer / Ingestion & Ingest Pipeline Specialist  
> **Target Production:** NTER Supabase (`vfgcppstyzjarlzyqdac`)  
> **Date:** 2026-11-18

---

## 1. Scope & Objective

This report details the reconciliation of embedding generation, provider token usage accounting, and telemetry logging for private file indexing within the `ingest-worker` Edge Function.

---

## 2. Ingestion Pipeline Architecture

The F341 private file indexing pipeline strictly reuses the core shared ingestion architecture:
1. **OCR Processing:** Mistral OCR (`mistral-ocr-latest`) extracts markdown and page metadata from uploaded PDFs.
2. **Text Normalization & Chunking:** Extracted pages are split into semantic chunks using standard platform chunkers (`supabase/functions/_shared/chunking.ts`).
3. **Embedding Vector Generation:** Chunks are embedded via OpenRouter (`openai/text-embedding-3-small`, 1536-dimensional vectors) in batches of $\le 32$ chunks.
4. **Isolated Storage Destination:** Generated chunks are inserted strictly into `public.user_file_chunks` with `(user_id, file_id)`. **No private chunks are ever written to the public `documents` or `document_chunks` table.**
5. **Provider Telemetry & Accounting:** Every call to the embedding API captures prompt tokens and calculates actual USD cost.

---

## 3. Mathematical Reconciliation of Embedding Pricing

### 3.1 Model & Pricing Parameters
- **Provider:** OpenRouter
- **Model:** `openai/text-embedding-3-small`
- **Cost per Million Tokens:** $\$0.02$
- **Cost per Single Token:**
  $$\text{Cost}_{\text{token}} = \frac{\$0.02}{1,000,000} = \$0.00000002$$

### 3.2 Page-Level Token Projections
- Typical density: $800 - 1,200\text{ tokens per PDF page}$ (median baseline: $1,000\text{ tokens}$).
- 1,000 tokens cost:
  $$\text{USD Cost} = 1,000 \times \$0.00000002 = \$0.000020$$
- In Indian Rupees at USD/INR = 95:
  $$\text{INR Cost} = \$0.000020 \times 95 = ₹0.00190 = 0.19\text{ paise}$$
- In AI Credits (1 Credit = 1 Paisa):
  $$\text{Credits} = 0.19\text{ credits}$$

> **Key Takeaway:** Embedding cost is negligible compared to OCR ($38\text{ paise/page}$). Embedding represents approximately $0.5\%$ of the total indexing expense ($0.19\text{ paise}$ vs. $38\text{ paise}$). The upfront 40-credit reservation easily covers the combined expense ($38.19\text{ paise}$ total).

---

## 4. Telemetry Logging Implementation

To ensure auditability without trusting client estimates, telemetry is recorded directly into `public.model_call_logs`:

```typescript
// supabase/functions/ingest-worker/user-file-step.ts
if (deps.db.recordCallLog) {
  await deps.db.recordCallLog({
    user_id: job.user_id,
    purpose: 'embedding',
    model: 'openai/text-embedding-3-small',
    tokens_input: totalTokens,
    tokens_output: 0,
    cost_usd: embeddingCostUsd,
    metadata: {
      job_id: job.id,
      file_id: job.file_id,
      chunks_count: chunks.length,
      step: 'embed_user_chunks',
    },
  });
}
```

The service-role client guarantees that every call is auditable in administrative views and reconcilable against the provider's billing dashboard.
