# F341 Production Deployment Runbook

> **Status: Normative Runbook — AWAITING EXPLICIT OWNER APPROVAL**  
> **Feature:** F341 — Private File Manager, PDF Indexing, Billing, AI Retrieval & Chat Attachments  
> **Target Supabase Project:** `vfgcppstyzjarlzyqdac` (NTER Production)  
> **Branch:** `file-manager`  
> **Author:** Principal Engineer / Release Supervisor  
> **Date:** 2026-11-18

---

> [!CAUTION]
> **PRODUCTION FREEZE IN EFFECT:**  
> Do not execute any commands in this runbook until explicit, written authorization is received from the repository owner.  
> Production database push (`supabase db push --linked`), function deployment, and feature flag activation must follow the exact ordered sequence below.

---

## 1. Pre-Deployment Verification Gates

Before initiating production deployment, confirm that local verification is 100% green:

```bash
# 1. Lint verification (must report 0 errors, 0 warnings)
npm run lint

# 2. Production build verification (must succeed cleanly)
npm run build

# 3. Deno Edge Functions verification
deno test -A --config supabase/functions/deno.json supabase/functions/ingest-worker
deno test -A --config supabase/functions/deno.json supabase/functions/research-chat
deno test -A --config supabase/functions/deno.json supabase/functions/_shared

# 4. Vitest client-side suite
npm test
```

---

## 2. Production Deployment Sequence (Ordered)

### Step 1: Owner Authorization Sign-off
Obtain explicit written approval confirming:
- Target Supabase Project: `vfgcppstyzjarlzyqdac`
- Migration file to apply: `supabase/migrations/20261118000001_file_indexing_billing.sql`
- Edge functions to deploy: `ingest-worker`, `research-chat`

### Step 2: Database Migration Deployment
Apply the migration to the production Supabase database:
```bash
# Link to production project (if not already linked)
supabase link --project-ref vfgcppstyzjarlzyqdac

# Push pending migration
supabase db push --linked
```

**Verification:**
Execute via Supabase SQL Editor to confirm the new migration applied cleanly:
```sql
SELECT version FROM supabase_migrations.schema_migrations WHERE version = '20261118000001';
```

Verify that the server-side feature gate is initially set to `false` (fail-closed):
```sql
SELECT key, value FROM public.app_flags WHERE key = 'file_indexing_billing';
-- Expected result: key = 'file_indexing_billing', value = false
```

### Step 3: Edge Function Deployment
Deploy the updated Edge Functions containing the reconciled billing and telemetry logic:
```bash
# Deploy ingest-worker (handles Mistral OCR, embeddings, and dynamic credit settlement)
supabase functions deploy ingest-worker --project-ref vfgcppstyzjarlzyqdac

# Deploy research-chat (handles private file RAG context retrieval)
supabase functions deploy research-chat --project-ref vfgcppstyzjarlzyqdac
```

### Step 4: Storage Bucket Verification
Verify that the `user-files` private bucket and its RLS policies exist on production:
```sql
SELECT id, name, public FROM storage.buckets WHERE id = 'user-files';
-- Must return: id = 'user-files', public = false
```

### Step 5: Enable Server-Side Feature Gate
Activate the server-side feature gate in `app_flags`:
```sql
UPDATE public.app_flags 
SET value = 'true'::jsonb 
WHERE key = 'file_indexing_billing';
```

Verify that `user_file_enqueue_indexing` is now operational and no longer raises SQLSTATE `55000`.

### Step 6: Frontend Feature Gate Activation & Web Build Release
In `src/fileManager/featureGate.js`:
Set `IS_INDEXING_BILLING_DEPLOYED = true`:
```javascript
export const IS_INDEXING_BILLING_DEPLOYED = true;
```

Commit this change and deploy the production web application via Vercel.

---

## 3. Post-Deployment Smoke Test Protocol

Perform the following smoke tests on production with a designated test account:

1. **File Upload & Quota:**
   - Upload a test PDF file (e.g., 2 pages, ~500 KB).
   - Verify upload completes and file status transitions to `Uploaded`.
   - Verify quota usage updates accurately in the quota bar.
2. **Indexing Pre-Flight Hold:**
   - Click "Index PDF".
   - Verify `IndexConfirmationModal` shows:
     - Page count: 2 pages
     - Temporary reservation hold: 80 credits (₹0.80)
   - Confirm indexing. Verify the hold is drawn and the job status transitions to `indexing`.
3. **Ingestion & Settlement:**
   - Wait for `ingest-worker` to complete processing (~15–30 seconds).
   - Verify file status transitions to `Indexed`.
   - Verify final wallet debit in `public.credit_ledger`:
     - Approximate actual charge: ~76 credits (~76 paise).
     - Released hold: ~4 credits refunded automatically.
   - Verify `public.model_call_logs` records entry with `purpose = 'embedding'` and accurate `tokens_input`.
4. **Chat Retrieval & Citations:**
   - Open Research Chat.
   - Attach the indexed PDF from the Attachment Tray.
   - Ask a question specifically answered by the PDF content.
   - Verify chat responds with grounded answer and displays citation pill linking to the document.

---

## 4. Rollback & Contingency Plan

If any critical issue or unexpected billing variance occurs in production:

### Immediate Mitigation (Stop Ingestion & Enqueueing):
Disable the server-side feature flag immediately:
```sql
UPDATE public.app_flags 
SET value = 'false'::jsonb 
WHERE key = 'file_indexing_billing';
```
*Effect:* Any subsequent call to `user_file_enqueue_indexing` or `user_file_job_retry` immediately raises `55000: feature_disabled`. Normal file upload, download, folder organization, and deletion continue operating safely.

### User Hold Release:
Any stuck or uncompleted jobs can be cancelled safely:
```sql
-- All pending holds can be cancelled and refunded without error
SELECT user_file_job_cancel(job_id) FROM public.user_file_indexing_jobs WHERE status IN ('pending', 'processing');
```
