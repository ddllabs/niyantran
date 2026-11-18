# F341 Final Billing Arithmetic & Financial Reconciliation Audit

> **Status: Normative Record**  
> **Feature:** F341 — Private File Manager, PDF Indexing, AI Retrieval & Chat Attachments  
> **Component:** Billing & Financial Arithmetic Engine  
> **Author:** Principal Engineer / Multi-Agent Billing Specialist  
> **Target Production:** NTER Supabase (`vfgcppstyzjarlzyqdac`)  
> **Date:** 2026-11-18

---

## 1. Executive Summary

This audit establishes the authoritative reconciliation of the billing engine for F341. Prior drafts and interim Release A / Release B implementations contained potential financial risks:
1. **Hardcoded Exchange & Credit Multipliers in Edge Functions:** `supabase/functions/ingest-worker/user-file-step.ts` previously calculated `Math.round(costUsd * 9500)` in client-side TypeScript. This violated the platform architecture wherein currency exchange rates and credit denominations are strictly owned by PostgreSQL configuration (`public.credit_settings` via `private.credit_config()`).
2. **Ambiguity Between Pre-Flight Hold and Authoritative Settlement:** The 40-credit upfront reservation was conflated with actual costs in user-facing messaging.

### Audit Findings & Resolution
- **Platform Denomination Reconciled:** 1 AI Credit = ₹0.01 = 1 Paisa. 100 Credits = ₹1.00.
- **Dynamic Conversion Engine:** Removed all hardcoded rates (`95`, `0.01`, `9500`) from the ingestion worker. The worker now passes exact `p_actual_cost_usd` (double precision) to `user_file_settle_credits()`. PostgreSQL computes the exact debit using authoritative `private.credit_config()`:
  $$\text{Credits Debited} = \text{ROUND}\left(p\_actual\_cost\_usd \times \frac{usd\_to\_inr}{inr\_per\_credit}\right)$$
- **Reservation Hold Clarified:** The 40-paise (40 credits) pre-flight reservation per page is strictly a maximum upper-bound pre-authorization hold. Unused holds are automatically released to the user wallet upon settlement in `user_file_settle_credits()`.
- **Audit Telemetry Added:** Every model execution logs tokens and exact USD cost to `public.model_call_logs` with `purpose = 'embedding'` for independent auditing.

---

## 2. Authoritative Billing Contract

The platform billing contract is governed by:
- [supabase/migrations/20261014200000_ai_credits.sql](file:///c:/Users/Afreen/Downloads/niyantran-main%20(2)/niyantran-main/supabase/migrations/20261014200000_ai_credits.sql)
- [supabase/migrations/20261017194626_credit_paise_contract.sql](file:///c:/Users/Afreen/Downloads/niyantran-main%20(2)/niyantran-main/supabase/migrations/20261017194626_credit_paise_contract.sql)
- [supabase/migrations/20261017194628_credit_paise_convert.sql](file:///c:/Users/Afreen/Downloads/niyantran-main%20(2)/niyantran-main/supabase/migrations/20261017194628_credit_paise_convert.sql)

### 2.1 Currency & Credit Equivalence Table

| Currency Unit | Paise | AI Credits | Remarks |
|---|---|---|---|
| ₹0.01 | 1 paisa | **1 credit** | Base unit of accounting |
| ₹1.00 | 100 paise | **100 credits** | Base fiat currency unit |
| ₹10.00 | 1,000 paise | **1,000 credits** | Small top-up pack |
| ₹100.00 | 10,000 paise | **10,000 credits** | Standard pack |

### 2.2 Database Configuration Functions
Platform conversion parameters are defined in `public.credit_settings` and retrieved by `private.credit_config()`:
```sql
CREATE OR REPLACE FUNCTION private.credit_config()
RETURNS TABLE (
  usd_to_inr numeric,
  inr_per_credit numeric,
  credits_per_usd numeric
) ...
-- Returns usd_to_inr = 95.0, inr_per_credit = 0.01, credits_per_usd = 9500.0
```

---

## 3. Provider Cost Modeling & Calculation

### 3.1 OCR Costs (Mistral OCR)
- **Model:** `mistral-ocr-latest`
- **Official Pricing:** $4.00 per 1,000 pages ($0.0040 per page).
- **INR Cost per Page:** $\$0.0040 \times 95 = ₹0.38 = 38\text{ paise}$.
- **Credit Equivalent:** $38\text{ credits per page}$.

### 3.2 Embedding Costs (OpenRouter / text-embedding-3-small)
- **Model:** `openai/text-embedding-3-small` (1536 dimensions)
- **Official Pricing:** $0.02 per 1,000,000 tokens ($\$0.00000002$ per token).
- **Page Token Density:** Typical extracted PDF pages contain ~800 to 1,200 tokens (assumed baseline: 1,000 tokens/page).
- **Cost per 1,000 Tokens:** $\$0.000020$.
- **INR Cost per 1,000 Tokens:** $\$0.000020 \times 95 = ₹0.0019 = 0.19\text{ paise}$.
- **Credit Equivalent:** $0.19\text{ credits}$ ($0.19\text{ paise}$, **NOT** 1.9 paise).

### 3.3 Total Expected Processing Cost
$$\text{Expected Total Cost per Page} = 38\text{ paise (OCR)} + 0.19\text{ paise (Embedding)} = 38.19\text{ paise (38.19 credits)}$$

---

## 4. Reservation Hold vs. Actual Settlement

### 4.1 Reservation Hold Policy (40 Credits / ₹0.40 per page)
When a user enqueues a PDF for indexing via `user_file_enqueue_indexing`:
1. The estimated page count $P$ is determined from file metadata.
2. An upfront pre-authorization hold is created:
   $$\text{Hold Amount} = P \times 40\text{ credits}$$
3. The hold is recorded in `public.credit_holds` via `private.credit_draw(...)`.
4. If available credits $< \text{Hold Amount}$, the RPC raises an exception (`insufficient_credits`) with SQLSTATE `P0002` before any expensive worker computation begins.
5. **Safety Margin:** The 40-credit hold provides a $1.81\text{ credit}$ ($1.81\text{ paise}$) buffer per page against dense pages (e.g. up to 10,000 tokens/page).

### 4.2 Authoritative Settlement via PostgreSQL RPC
Upon ingestion completion or step completion, the worker invokes `user_file_settle_credits`:
```sql
CREATE OR REPLACE FUNCTION public.user_file_settle_credits(
  p_job_id uuid,
  p_pages_processed integer,
  p_actual_cost_usd double precision DEFAULT NULL,
  p_actual_cost_paise bigint DEFAULT NULL
) ...
```
1. **Dynamic Conversion:** If `p_actual_cost_usd` is provided, PostgreSQL fetches `usd_to_inr` and `inr_per_credit` from `private.credit_config()`:
   $$v\_cost\_paise = \text{ROUND}(p\_actual\_cost\_usd \times (s.usd\_to\_inr / s.inr\_per\_credit))::bigint$$
2. **Release of Unused Hold:**
   $$v\_release\_amount = \text{GREATEST}(0, v\_held\_amount - v\_actual\_debit)$$
3. **Idempotency:** Once `settled_at` is stamped, subsequent calls are no-ops returning existing settlement figures.
4. **Failure Handling:** If a job fails fatally, all unused holds are released back to the user wallet immediately, charging only for verified completed steps.

---

## 5. Verification Test Vectors

The following test vectors confirm dynamic conversion at $9,500\text{ credits/USD}$ ($USD/INR = 95$, $INR/credit = 0.01$):

| Provider Cost (USD) | Computed Exact Credits | Debited Credits (Rounded) | Status |
|---:|---:|---:|:---:|
| $0.000001 | 0.0095 | 0 | PASS |
| $0.000010 | 0.0950 | 0 | PASS |
| $0.000020 | 0.1900 | 0 | PASS |
| $0.000100 | 0.9500 | 1 | PASS |
| $0.001000 | 9.5000 | 10 | PASS |
| $0.004000 | 38.0000 | 38 | PASS |
| $0.004020 | 38.1900 | 38 | PASS |

---

## 6. Code Remediation Summary

1. **Edge Function [supabase/functions/ingest-worker/user-file-step.ts](file:///c:/Users/Afreen/Downloads/niyantran-main%20(2)/niyantran-main/supabase/functions/ingest-worker/user-file-step.ts):**
   - Replaced all client-side `Math.round(usd * 9500)` conversions with pure USD tracking.
   - Passed `p_actual_cost_usd` directly to `deps.db.settleCredits()`.
   - Added provider call log insertion into `model_call_logs`.
2. **Database Migration [supabase/migrations/20261118000001_file_indexing_billing.sql](file:///c:/Users/Afreen/Downloads/niyantran-main%20(2)/niyantran-main/supabase/migrations/20261118000001_file_indexing_billing.sql):**
   - Implemented dynamic currency conversion in `user_file_settle_credits` via `private.credit_config()`.
   - Added server-side fail-closed feature gate checking `app_flags.file_indexing_billing`.
3. **Frontend UI Disclosure [src/fileManager/IndexConfirmationModal.jsx](file:///c:/Users/Afreen/Downloads/niyantran-main%20(2)/niyantran-main/src/fileManager/IndexConfirmationModal.jsx):**
   - Updated modal text to clearly distinguish the 40-credit upfront reservation hold from actual usage-based settlement and automatic refund of unused credits.
