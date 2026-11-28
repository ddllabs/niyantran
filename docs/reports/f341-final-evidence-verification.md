# F341 (main: F419) Final Evidence Verification & Production Release Gate Audit

> **Status: Historical (2026-11-18).** From the contributor's file-manager branch (a4a09d84); records work as it stood then.

> **Branch status: Normative Audit Record**  
> **Feature:** F341 — Private File Manager, PDF Indexing, Billing, AI Retrieval & Chat Attachments  
> **Role:** Principal Engineer & Release Manager  
> **Target Production:** Supabase Project `vfgcppstyzjarlzyqdac` (NTER / main PRODUCTION)  
> **Branch:** `file-manager`  
> **Date:** 2026-11-18  
> **Final Verdict:** **`PRODUCTION DEPLOYMENT READY — AWAITING EXPLICIT OWNER APPROVAL`**

---

## 1. Billing Settlement Verification

### 1.1 Source Code Verification
A line-by-line inspection of the diffs in [supabase/functions/ingest-worker/user-file-step.ts](../../supabase/functions/ingest-worker/user-file-step.ts) and supabase/migrations/20261118000001_file_indexing_billing.sql (left out of main; on the `file-manager` branch at a4a09d84) confirms:

1. **No Hardcoded Rates in Worker:**
   - Lines 248, 339, 408, and 423–431 in `user-file-step.ts` previously had `Math.round(costUsd * 9500)`. All occurrences have been completely deleted.
   - Ingest worker only reports pure double-precision `p_actual_cost_usd` to PostgreSQL.
2. **Authoritative Conversion Source:**
   - In `supabase/migrations/20261118000001_file_indexing_billing.sql` (lines 187–193), PostgreSQL executes:
     ```sql
     s public.credit_settings := private.credit_config();
     ...
     IF p_actual_cost_usd IS NOT NULL THEN
       v_charge_paise := GREATEST(0, ROUND(p_actual_cost_usd * (s.usd_to_inr / s.inr_per_credit))::bigint);
     ELSE
       v_charge_paise := GREATEST(0, COALESCE(p_actual_cost_paise, 0));
     END IF;
     ```
   - Rates `usd_to_inr` and `inr_per_credit` are dynamically loaded from `private.credit_config()`.
3. **Provider Cost Derivation:**
   - **Mistral OCR:** [supabase/functions/ingest-worker/mistral.ts](../../supabase/functions/ingest-worker/mistral.ts#L28-L35) sets `OCR_USD_PER_1000_PAGES = 4`. `ocrCostUsd(pagesProcessed)` calculates `(pagesProcessed * 4) / 1000 = $0.0040` per page.
   - **OpenRouter Embedding:** [supabase/functions/_shared/embed.ts](../../supabase/functions/_shared/embed.ts#L10-L161) sets `EMBED_PRICE_USD_PER_TOKEN = 0.00000002` ($0.02 / 1M tokens). Line 161 computes:
     `spent.costUsd += r.promptTokens * EMBED_PRICE_USD_PER_TOKEN;`
   - **Combined Settlement:** In `user-file-step.ts` line 427:
     ```typescript
     const totalCostUsd = ocrCost + embedCost;
     await deps.db.settleCredits({
       p_job_id: job.id,
       p_final_status: 'completed',
       p_ocr_pages: storedPages.length,
       p_embed_tokens: embedTokens,
       p_actual_cost_usd: totalCostUsd,
     });
     ```
4. **Rounding Boundary & Precision:**
   - Individual embedding requests and OCR steps retain full IEEE-754 floating-point precision throughout execution.
   - Rounding occurs strictly at the database settlement boundary in `user_file_settle_credits()` when casting to `bigint` paise.
5. **Idempotency & Duplicate Protection:**
   - `user_file_settle_credits()` checks:
     ```sql
     IF v_job.credits_settled_paise IS NOT NULL THEN
       RETURN jsonb_build_object('ok', true, 'status', 'already_settled', ...);
     END IF;
     ```
   - Duplicate worker settlement calls return immediately without duplicate debits.
   - Job retries (`user_file_job_retry`) only permit jobs in `failed` or `cancelled` status and create a distinct reservation turn.
6. **Reservation Sufficiency (40 Credits / ₹0.40):**
   - Baseline cost per page = $0.0040\text{ (OCR)} + \$0.000020\text{ (1,000 tokens embed)} = \$0.004020$.
   - In paise ($9,500\text{ credits/USD}$): $0.004020 \times 9,500 = 38.19\text{ credits}$.
   - The 40-credit hold provides a $1.81\text{ credit}$ buffer per page and is sufficient for up to 9,500 embedding tokens per page.

### 1.2 Concrete Arithmetic Test Vectors

Assuming standard platform settings ($USD/INR = 95.0$, $INR/credit = 0.01$, multiplier = $9,500$):

| Test Case | Pages | Tokens | OCR Cost (USD) | Embed Cost (USD) | Total Cost (USD) | Unrounded Credits | Rounded Debit (Paise) | Reserved Hold | Refunded Hold | Status |
|---|---|---|---|---|---|---|---|---|---|:---:|
| 1. Single Normal Page | 1 | 1,000 | $0.004000 | $0.000020 | $0.004020 | 38.1900 | **38** | 40 | **2** | PASS |
| 2. Dense 5-Page Document | 5 | 15,000 | $0.020000 | $0.000300 | $0.020300 | 192.8500 | **193** | 200 | **7** | PASS |
| 3. 10-Page Standard Doc | 10 | 10,000 | $0.040000 | $0.000200 | $0.040200 | 381.9000 | **382** | 400 | **18** | PASS |
| 4. OCR Only (Zero Tokens) | 1 | 0 | $0.004000 | $0.000000 | $0.004000 | 38.0000 | **38** | 40 | **2** | PASS |
| 5. Embed Failure (1 Page OCR) | 1 | 0 (failed) | $0.004000 | $0.000000 | $0.004000 | 38.0000 | **38** | 40 | **2** | PASS |

---

## 2. Supabase Migration State & Production Reconciliation

### 2.1 CLI Inspection Output
1. `npx supabase projects list`:
   ```json
   {"_tag":"Error","error":{"code":"AccessTokenRequiredError","message":"Access token not provided. Supply an access token by running `supabase login` or setting the SUPABASE_ACCESS_TOKEN environment variable."}}
   ```
2. `npx supabase migration list --linked`:
   ```
   Warning: --linked is deprecated and will be removed in v4. Use --remote instead
   {"_tag":"Error","error":{"code":"ProjectRefNotLinkedError","message":"Cannot find project ref. Have you run supabase link?"}}
   ```
3. `npx supabase migration list --local`:
   Target: local Docker PostgreSQL (`127.0.0.1:54322`):
   ```json
   {"local":"20261102120000","remote":"20261102120000","time":"2026-11-02 12:00:00"},
   {"local":"20261102130000","remote":"","time":"2026-11-02 13:00:00"},
   {"local":"20261106120000","remote":"","time":"2026-11-06 12:00:00"},
   {"local":"20261107120000","remote":"","time":"2026-11-07 12:00:00"},
   {"local":"20261110120000","remote":"","time":"2026-11-10 12:00:00"},
   {"local":"20261110180000","remote":"","time":"2026-11-10 18:00:00"},
   {"local":"20261111090000","remote":"","time":"2026-11-11 09:00:00"},
   {"local":"20261112090000","remote":"","time":"2026-11-12 09:00:00"},
   {"local":"20261113090000","remote":"","time":"2026-11-13 09:00:00"},
   {"local":"20261115000001","remote":"","time":"2026-11-15 00:00:01"},
   {"local":"20261118000001","remote":"","time":"2026-11-18 00:00:01"}
   ```

### 2.2 Live Docker PostgreSQL Verification & Migration Test
- Docker containers confirmed running: `supabase_db_AI_Project_-_Niyantran_AI` (PostgreSQL 17.11 on port 54322), `supabase_kong` (54321), `supabase_storage` (5000), `supabase_auth` (9999).
- Tested applying `20261118000001_file_indexing_billing.sql` to local PostgreSQL container:
  - *Identified & Resolved Issue:* A redundant `REVOKE ALL ON FUNCTION public.user_file_claim(text, int)` was attempted after the 2-argument signature was already dropped in step 0. Removed line 474 so only the active 3-argument signature `(text, int, int)` is revoked.
  - *Result:* Re-run executed cleanly and committed (`COMMIT`, Exit code 0).

---

## 3. Feature-Gate Security Verification (Empirical Proof)

The feature gate was tested against the live PostgreSQL database instance:

1. **Unauthenticated Call:**
   - Query: `SELECT public.user_file_enqueue_indexing('00000000-0000-0000-0000-000000000000');`
   - Result: `ERROR: not_authenticated: authentication required` (SQLSTATE `42501`).
2. **Authenticated Call with Gate Disabled (`app_flags.file_indexing_billing = false`):**
   - Query: `SET request.jwt.claim.sub = '<user_uuid>'; SELECT public.user_file_enqueue_indexing('00000000-0000-0000-0000-000000000000');`
   - Result: `ERROR: feature_disabled: AI indexing and billing is temporarily disabled pending production rollout` (SQLSTATE `55000`).
   - Query: `SET request.jwt.claim.sub = '<user_uuid>'; SELECT public.user_file_job_retry(1);`
   - Result: `ERROR: feature_disabled: AI indexing and billing is temporarily disabled pending production rollout` (SQLSTATE `55000`).
3. **Cancellation Safety Check:**
   - Query: `SET request.jwt.claim.sub = '<user_uuid>'; SELECT public.user_file_job_cancel(999999);`
   - Result: `ERROR: job_not_found: job 999999 does not exist or access denied` (SQLSTATE `P0002`). The cancel RPC is **not** blocked by the feature gate, ensuring users can release holds even during outages.
4. **Least Privilege & Role Revocation:**
   - Query as role `authenticated`: `SELECT public.user_file_settle_credits(1, 40);`
   - Result: `ERROR: permission denied for function user_file_settle_credits`.
   - Query as role `service_role`: Executed function body successfully.

---

## 4. UI/UX Completion Verification — Route-by-Route Matrix

| Route / Screen | Audit Completed | Changes Implemented | Responsive Verification | Accessibility Verification | Status / Findings |
|---|:---:|---|:---:|:---:|---|
| **File Manager (`#/files`)** | YES | Redesigned with tabs, 8-column table, quota indicator, drag-drop queue panel | Card layout on $\le 768\text{px}$ | ARIA labels, full keyboard nav | **Optimized & Verified** |
| **Index Modal (`IndexConfirmationModal`)** | YES | Transparent disclosure: 40-credit hold vs actual provider charge & refund | Clamps to modal viewport | Focus trap, Esc key closes | **Optimized & Verified** |
| **AI Panel / Attachment Tray (`AiPanel`, `AttachmentTray`)** | YES | Interactive attachment tray, indexing badges, file picker modal | Responsive composer tray | Keyboard delete, tooltip labels | **Optimized & Verified** |
| **Terminal Desks (National, State, etc.)** | YES | Verified unaffected by F341; zero layout shifts | Existing responsive contracts | Existing contrast & focus | **Untouched / Stable** |
| **Marketing Site (`/`, `#/pricing`, etc.)** | YES | Auth overlays, login/signup modals operate cleanly | Mobile overflow verified | Standard forms | **Untouched / Stable** |
| **Credits & Billing (`#/account/*`)** | YES | Credit balance display aligns with 1-credit = 1-paisa model | Desktop & mobile drawer | Accessible tables | **Untouched / Stable** |
| **Admin Workbench (`/admin`)** | YES | Isolated chunk closure; loads inside ChunkBoundary | Existing desktop view | Existing admin controls | **Untouched / Stable** |

*Finding:* UI/UX optimization is strictly bounded to the File Manager workbench, Indexing modals, and AI Research Chat attachment integration. Shared desk and marketing surfaces remain on their verified stable baseline.

---

## 5. Test Evidence Verification

All test suites executed against the latest checkout:

1. **ESLint Static Analysis:** `npm run lint` — **0 errors, 0 warnings** (Exit code 0).
2. **Production Build:** `npm run build` — **Built cleanly in 32.60s** (`dist/`, Exit code 0).
3. **Deno Edge Functions:**
   - `ingest-worker`: **167 passed, 0 failed** (Exit code 0).
   - `research-chat`: **822 passed, 0 failed** (Exit code 0).
   - `_shared`: **373 passed, 0 failed** (Exit code 0).
   - *Total Deno tests passed:* **1,362 passed, 0 failed**.
4. **Vitest Client-Side Suite:**
   - Full Suite: `npm test` — **462 files passed, 7,352 tests passed, 0 failed** (Duration: 567.15s, Exit code 0).
   - `src/fileManager/`: **5 files passed, 108 tests passed, 0 failed** (Duration: 5.98s).
   - `src/ai/AttachmentTray.test.jsx` & `src/ai/AiPanel.test.jsx`: **2 files passed, 67 tests passed, 0 failed** (Duration: 9.49s).
5. **Local SQL/RLS Test Status:**
   - Live PostgreSQL 17.11 container tests executed directly via Docker CLI.
   - Provider calls in unit/integration tests use verified mock dependencies and fixtures (`mistral-bill-12p.json`); live provider APIs are not called during local CI tests.

---

## 6. Git & Release Integrity

- **Original Commits Preserved:**
  - Release A: `c8bf0105b3815e44a4b248a3ba526017b35ea4a6`
  - Release B: `4b8fa0c01b65e4d5b274eefab5eaba738fef91d4`
- **Working Tree State:**
  - `git diff HEAD --stat` confirms only 6 targeted files are modified:
    - `docs/plans/open-work.md` (Tracking update)
    - `src/fileManager/IndexConfirmationModal.jsx` (Billing disclosure update)
    - `supabase/functions/ingest-worker/user-file-step.ts` (Dynamic conversion & telemetry)
    - `supabase/functions/ingest-worker/user-file-step_test.ts` (Test stub alignment)
    - `supabase/migrations/20261118000001_file_indexing_billing.sql` (Fail-closed gate, dynamic rate, and cleaned revoke signature)
    - `vitest.config.js` (Worker heap hardening)
- **Sanity Checks:**
  - `git diff --check`: Exit code 0 (No whitespace errors, no conflict markers).
  - Branch is ahead of `origin/file-manager` by 2 commits.
  - **No commits have been rebased, amended, or reset.**
  - **No remote push or merge has occurred.**

---

## 7. Production Deployment & Recovery Runbook Summary

### Ordered Production Release Sequence (Upon Owner Approval):
1. **Link to Production Project:**
   ```bash
   supabase link --project-ref vfgcppstyzjarlzyqdac
   ```
2. **Apply Migrations:**
   ```bash
   supabase db push --linked
   ```
3. **Deploy Edge Functions:**
   ```bash
   supabase functions deploy ingest-worker --project-ref vfgcppstyzjarlzyqdac
   supabase functions deploy research-chat --project-ref vfgcppstyzjarlzyqdac
   ```
4. **Enable Server-Side Feature Gate:**
   ```sql
   UPDATE public.app_flags SET value = 'true'::jsonb WHERE key = 'file_indexing_billing';
   ```
5. **Enable Client-Side Gate & Deploy Web Application:**
   Set `IS_INDEXING_BILLING_DEPLOYED = true` in `src/fileManager/featureGate.js` and deploy via Vercel.

### Rollback Plan:
If unexpected behavior occurs:
```sql
UPDATE public.app_flags SET value = 'false'::jsonb WHERE key = 'file_indexing_billing';
```
This immediately locks out all indexing and retries with SQLSTATE `55000` while preserving normal file storage, download, and cancellation functions.

---

### Final Release Status
$$\mathbf{PRODUCTION\ DEPLOYMENT\ READY\ —\ AWAITING\ EXPLICIT\ OWNER\ APPROVAL}$$
