# F341 Production Deployment Runbook

> **Status: Normative Runbook — CONDITIONALLY READY (AWAITING OWNER ACTION)**
> **Feature:** F341 — Private File Manager, PDF Indexing, Billing, AI Retrieval & Chat Attachments
> **Target Supabase Project:** `vfgcppstyzjarlzyqdac` (NTER Production)
> **Branch:** `file-manager`
> **Author:** Principal Engineer / Release Supervisor
> **Date:** 2026-11-18

---

> [!CAUTION]
> **PRODUCTION FREEZE IN EFFECT:**
> Do not execute any deployment commands in this runbook until explicit, written authorization is received from the repository owner.
> Production database push (`supabase db push --linked`), function deployment, and feature flag activation must follow the exact ordered sequence below.

---

## 1. Pre-Deployment Verification Gates & Local Baseline

Before initiating production deployment, confirm that local verification is 100% green:

```bash
# 1. Lint verification (must report 0 errors, 0 warnings)
npm run lint

# 2. Production build verification (must succeed cleanly)
npm run build

# 3. Deno Edge Functions verification (all 1,362 tests must pass)
deno test -A --config supabase/functions/deno.json supabase/functions/ingest-worker
deno test -A --config supabase/functions/deno.json supabase/functions/research-chat
deno test -A --config supabase/functions/deno.json supabase/functions/_shared

# 4. Vitest client-side suite (all 7,352 tests across 462 files must pass)
npm test
```

---

## 2. Operator Pre-Deployment Migration Verification Procedure

Because CLI commands on the local machine lack interactive Supabase Cloud session credentials, the production migration inventory is marked **UNKNOWN** until the operator performs the following read-only verification:

### Operator Step-by-Step Inspection:
```bash
# 1. Authenticate to Supabase Cloud CLI using your personal access token
npx supabase login

# 2. Link your local environment to the production project
npx supabase link --project-ref vfgcppstyzjarlzyqdac

# 3. Perform read-only inspection of remote migrations
npx supabase migration list --remote
```

### Remote History Reconciliation Checklist:
1. Confirm that all core migrations up to `20261113090000_national_search_only.sql` are applied remotely.
2. Confirm whether `20261115000001_private_file_manager.sql` is already applied or pending:
   - If **pending**: It must be applied first before `20261118000001_file_indexing_billing.sql`.
   - If **applied**: Only `20261118000001_file_indexing_billing.sql` will be applied.
3. Verify that no remote migrations exist that are absent from the local checkout.
4. **Stop on any ordering conflict or unverified remote migration.**

---

## 3. Production Backup & Recovery Readiness Assessment

### 3.1 Distinguishing Platform Capability from Verified Restoration
1. **Supabase Platform Backup & PITR Availability:**
   - The production instance `vfgcppstyzjarlzyqdac` is hosted on Supabase Pro/Team Large compute. Continuous Write-Ahead Log (WAL) archiving and daily automated physical backups are enabled at the platform infrastructure level.
2. **Actual Production Backup Health:**
   - Prior to deployment, the operator must inspect the Supabase Dashboard (`Database` -> `Backups`) and record the exact timestamp of the most recent successful physical backup and the active PITR recovery window (typically 7 to 30 days).
3. **Tested Restoration Status (Residual Risk):**
   - **Status: NOT TESTED.** No dry-run database restoration drill to an isolated staging instance was executed during this release cycle.
   - *Residual Risk:* While platform-level PITR guarantees WAL replay integrity, recovery time objective (RTO) has not been empirically timed for the current ~18 GB database size.
4. **Storage Object Reconciliation Protocol:**
   - **Crucial Architectural Boundary:** PostgreSQL PITR restores database records only; it does **not** roll back or synchronize objects in the S3-compatible Supabase Storage bucket (`user-files`).
   - If a database restore to timestamp $T$ is performed following a post-deployment incident, any binary objects uploaded to the storage bucket between $T$ and the incident time become unreferenced (orphaned) storage objects.
   - *Reconciliation Script:* Following any database restore, run the storage reconciliation query to identify orphaned objects:
     ```sql
     -- Identify file records missing physical storage links or vice versa
     SELECT id, user_id, storage_path, created_at
     FROM public.user_files
     WHERE created_at >= :restore_target_timestamp;
     ```

---

## 4. Production Deployment Sequence (Ordered)

### Step 1: Owner Authorization Sign-off
Obtain explicit written approval confirming:
- Target Supabase Project: `vfgcppstyzjarlzyqdac`
- Migration files to apply: `20261115000001_private_file_manager.sql` (if pending) and `20261118000001_file_indexing_billing.sql`
- Edge functions to deploy: `ingest-worker`, `research-chat`

### Step 2: Database Migration Deployment
Apply the pending migration(s) using Supabase CLI:
```bash
# Push pending migrations to the linked production project
supabase db push --linked
```

**Post-Migration SQL Verification:**
Execute in the Supabase SQL Editor:
```sql
-- 1. Verify schema migrations table
SELECT version FROM supabase_migrations.schema_migrations
WHERE version IN ('20261115000001', '20261118000001')
ORDER BY version ASC;

-- 2. Verify server-side feature gate is present and false (fail-closed)
SELECT key, value FROM public.app_flags WHERE key = 'file_indexing_billing';
-- Expected result: value = false
```

### Step 3: Edge Function Deployment
Deploy the updated Edge Functions containing the dynamic billing and telemetry logic:
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

## 5. Post-Deployment Smoke Test Protocol

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

## 6. Targeted Incident-Containment & Rollback Procedure

> [!IMPORTANT]
> **NO BULK CANCELLATIONS OR REFUNDS:**
> Do not execute bulk cancellation queries (`SELECT user_file_job_cancel(id) FROM ...`) or broad refund sweeps.
> Follow the controlled 8-step containment procedure below.

If any unexpected billing variance, provider error spike, or functional defect occurs:

### Step 1: Immediate Ingress Cutoff
Disable the server-side feature flag immediately in PostgreSQL:
```sql
UPDATE public.app_flags
SET value = 'false'::jsonb
WHERE key = 'file_indexing_billing';
```
*Effect:* Any subsequent call to `user_file_enqueue_indexing` or `user_file_job_retry` immediately raises `55000: feature_disabled`. Normal file upload, download, folder organization, and deletion continue operating safely without interruption.

### Step 2: Prevent New Enqueue & Retry Ingress
Confirm feature gate is active by probing with a test RPC:
```sql
SELECT value FROM public.app_flags WHERE key = 'file_indexing_billing';
-- Must return: false
```

### Step 3: Assess Active Queue State & Allow Safe Draining
Inspect in-flight queue state without disrupting active worker tasks:
```sql
SELECT id, user_id, file_id, status, step, attempt_count, credits_hold_paise, created_at, updated_at
FROM public.user_file_jobs
WHERE status IN ('queued', 'running')
ORDER BY created_at ASC;
```
Allow running worker jobs to finish active OCR/embedding slices where possible. Jobs that complete normally will settle their exact provider usage and release unused holds safely.

### Step 4: Identify Affected Jobs Individually
For any job that is stuck, timed out, or explicitly reported by a user, identify its ID:
```sql
SELECT j.id, j.user_id, j.status, j.step, j.credits_hold_paise, j.credits_settled_paise,
       h.held_amount, h.settled_at, l.id AS ledger_id, l.credits AS ledger_credits
FROM public.user_file_jobs j
LEFT JOIN public.credit_holds h ON h.user_id = j.user_id AND h.turn_key = 'file_job:' || j.id
LEFT JOIN public.credit_ledger l ON l.user_id = j.user_id AND l.turn_key = 'file_job:' || j.id
WHERE j.id = :target_job_id;
```

### Step 5: Inspect Job Status & Settlement History
Verify:
- What step was reached (`ocr`, `chunk`, `embed`).
- Was any partial cost debited?
- Is the hold still active (`settled_at IS NULL`)?

### Step 6: Selectively Cancel Explicitly Approved Jobs
Cancel only explicitly verified job IDs one by one using the safe, idempotent RPC:
```sql
-- Explicitly verified single job cancellation
SELECT public.user_file_job_cancel(:verified_job_id);
```
*Safety Guarantee:* `user_file_job_cancel` operates only on `queued` or `running` jobs, releases the specific hold associated with that `turn_key`, and stamps `status = 'cancelled'`. It never touches other jobs, never deletes ledger history, and never modifies uploaded files or chunks.

### Step 7: Verify Ledger and Wallet Consistency
Check that the user's wallet balance and hold state are consistent:
```sql
SELECT * FROM public.credit_wallets WHERE user_id = :affected_user_id;
SELECT * FROM public.credit_holds WHERE user_id = :affected_user_id AND turn_key = 'file_job:' || :verified_job_id;
```

### Step 8: Complete Data Preservation
All uploaded files in storage (`user-files`), folder hierarchies (`user_folders`), file records (`user_files`), chunks (`user_file_chunks`), and job history records (`user_file_jobs`) remain preserved. No destructive table truncations or batch deletions are ever executed.
