# F341 — CI & Production Readiness Report

> **Status: Normative.** Comprehensive audit of GitHub Actions CI SQL fixture repairs, disposable PostgreSQL test execution, unit/integration verification, and production environment compatibility for Feature F341 (Private File Manager & Knowledge Integration).

---

## 1. Executive Summary

| Verification Gate | Command | Result | Evidence / Notes |
|---|---|---|---|
| **SQL Fixture Registry** | `./supabase/tests/run.sh no_such_fixture` | **PASS** | Guard verified: unknown fixtures fail with non-zero exit code as required by CI |
| **Disposable Postgres Fixtures** | `./supabase/tests/run.sh user_files_*` | **PASS (8/8)** | All 8 suites executed against disposable PostgreSQL (`niyantran-corpus-test-db`); 100% assertions passed; vacuity checks passed |
| **ESLint** | `npm run lint` | **PASS** | 0 errors, 0 warnings (`--max-warnings 0`) across `src server api scripts` |
| **Unit & Integration Tests** | `npm test src/fileManager/` | **PASS (26/26)** | 3 test files, 26 tests passed in Vitest runner |
| **Deno Edge Functions** | `deno test supabase/functions` | **PASS (1662/1662)** | 1,662 tests passed, 0 failed across all production edge functions |
| **Production Build** | `npm run build` | **PASS** | Vite production bundle built in 28.81s (`dist/`) |
| **Vercel Router Import** | `node -e "import('./api/router.js')"` | **PASS** | Router import OK; zero syntax or export errors |
| **Production Remote DB** | `vfgcppstyzjarlzyqdac.supabase.co` | **PROTECTED (Outcome C)** | Zero modifications performed on production. Missing F341 tables communicated via honest error boundary |

---

## 2. GitHub Actions Fixture Failure Analysis & Resolution

### 2.1 The Root Cause of CI Failure
In `.github/workflows/ci.yml`, the `SQL fixtures (disposable Postgres)` job runs:
```bash
if ./supabase/tests/run.sh no_such_fixture; then
  echo "run.sh passed an unknown fixture"; exit 1
fi
npm run test:sql
```
`run.sh` discovers all `*.sql` files in `supabase/tests/`. For each discovered file, it invokes `chain "$fixture_name"`. Any fixture absent from the `chain()` registry triggers:
```text
=== <name>
  FAIL  (no chain() entry)
```
When commit `c9cab291` added the 8 F341 test fixtures to `supabase/tests/`, they were not registered in `supabase/tests/run.sh`. Consequently, the CI runner encountered unregistered fixtures and terminated with failure.

### 2.2 Secondary Fixture Defects Identified & Repaired
During local test execution against disposable PostgreSQL, four secondary defects were identified and systematically resolved:

1. **Storage Schema Permissions (`42501`)**:
   - `supabase/migrations/20261115000001_private_file_manager.sql` originally attempted `CREATE OR REPLACE FUNCTION storage.foldername(name text)` in the `storage` schema.
   - When run by `as_non_superuser` (`nter_migrator`), PostgreSQL denied schema modification (`permission denied for schema storage`).
   - *Resolution*: Removed `CREATE FUNCTION storage.foldername` from the migration file (Supabase Storage natively provides this function in cloud and local runtimes) and added it to `supabase/tests/bootstrap_storage.sql` for disposable test containers.
2. **Missing RPC Definition (`user_file_enqueue_indexing`)**:
   - `src/fileManager/fileManagerService.js:492` invokes `supabase.rpc('user_file_enqueue_indexing')`, but the definition was omitted from the migration file.
   - *Resolution*: Implemented `user_file_enqueue_indexing(p_file_id uuid)` in `20261115000001_private_file_manager.sql`, enforcing owner validation, upload status verification, and atomic job insertion into `user_file_jobs`.
3. **Parameter Mismatch in Priority 3 Test**:
   - `supabase/tests/user_files_priority3_storage_api.sql` called `user_file_prepare_upload(p_file_name := ...)` instead of `p_name := ...`.
   - *Resolution*: Corrected named parameter to `p_name := ...` to match the migration signature and client contract.
4. **Plan Enum Drift in Quota Fixture**:
   - `supabase/tests/user_files_quota_complete.sql` tested the post-INR plans (`plus`) alongside legacy names (`explorer`, `professional`, `enterprise`).
   - *Resolution*: Updated fixture to use normative INR plan enum values (`free`, `plus`, `pro`, `max`) and configured a dedicated dependency chain in `run.sh` that loads `20261012120000_inr_plans.sql`.

---

## 3. Actual Disposable PostgreSQL Test Results

Executed using `./supabase/tests/run.sh`:

```text
=== user_files_isolation  [corpus-test-db]
  PASS  (267 lines of output)
  vacuity ok - fails without 20261115000001_private_file_manager.as_non_superuser.sql
  time 14 s
=== user_files_lifecycle  [corpus-test-db]
  PASS  (13 lines of output)
  vacuity ok - fails without 20261115000001_private_file_manager.as_non_superuser.sql
  time 12 s
=== user_files_retrieval  [corpus-test-db]
  PASS  (5 lines of output)
  vacuity ok - fails without 20261115000001_private_file_manager.as_non_superuser.sql
  time 11 s
=== user_files_storage_lifecycle  [corpus-test-db]
  PASS  (10 lines of output)
  vacuity ok - fails without 20261115000001_private_file_manager.as_non_superuser.sql
  time 10 s
=== user_files_quota_complete  [corpus-test-db]
  PASS  (9 lines of output)
  vacuity ok - fails without 20261115000001_private_file_manager.as_non_superuser.sql
  time 16 s
=== user_files_reliability  [corpus-test-db]
  PASS  (12 lines of output)
  vacuity ok - fails without 20261115000001_private_file_manager.as_non_superuser.sql
  time 11 s
=== user_files_priority3_storage_api  [corpus-test-db]
  PASS  (10 lines of output)
  vacuity ok - fails without 20261115000001_private_file_manager.as_non_superuser.sql
  time 11 s
=== user_files_ingestion_rag  [corpus-test-db]
  PASS  (11 lines of output)
  vacuity ok - fails without 20261115000001_private_file_manager.as_non_superuser.sql
  time 11 s

total 1 min 36 s
all fixtures passed
```

Every single fixture:
1. Ran all assertions against an isolated database built from scratch.
2. Underwent the automated vacuity test (rebuilt without `20261115000001_private_file_manager.sql`) and proved that the assertions fail without the migration.

---

## 4. Production Compatibility Status

As formally established in `docs/reports/f341-production-compatibility-audit.md`, the production Supabase database (`vfgcppstyzjarlzyqdac.supabase.co`) currently lacks the isolated schema objects required for private file management:

- `public.user_folders` — **DOES NOT EXIST**
- `public.user_files` — **DOES NOT EXIST**
- `public.user_file_chunks` — **DOES NOT EXIST**
- `public.user_file_jobs` — **DOES NOT EXIST**
- `user-files` Storage Bucket — **DOES NOT EXIST**
- F341 RPC Functions — **DOES NOT EXIST**

### Architectural Guardrails Honored:
- **Zero Production Mutations**: Under no circumstances was production schema altered, nor were migrations pushed to the live database.
- **Corpus Integrity Preserved**: Private user files are **NEVER** routed to `public.documents` or `public.document_chunks_partitioned`. Doing so would violate user privacy and tenant isolation because the legal corpus is globally queryable by design.
- **No Mock or Phantom Storage**: The application does **NOT** simulate successful uploads using `sessionStorage` or `localStorage` when running against production.
- **Honest Error Normalization**: When a user attempts to upload or browse files against an environment lacking the F341 schema, the UI displays:
  > *"Backend schema pending: Personal file storage requires the approved F341 schema to be applied to the database."*

---

## 5. Supported vs. Blocked Functionality

### Supported (Local Supabase / Approved F341 Backend)
- **File Uploads**: Drag-and-drop, multi-file batch uploads, progress tracking, cancellation.
- **Folder Management**: Root and nested folder creation, breadcrumb navigation, folder movement.
- **Trash & Soft-Delete**: 30-day retention, recursive folder trashing, atomic folder restoration with orphan relocation to root, permanent purge via `user_files_empty_trash`.
- **Tenant Isolation**: Strict `auth.uid() = user_id` row-level security. Platform administrators barred from viewing private user files.
- **Quota Accounting**: Plan-based quotas enforced at database level (`Free = 500 MB`, `Plus = 2 GB`, `Pro = 5 GB`, `Max = 50 GB`). Advisory locks prevent concurrent quota overage races.
- **Private RAG & Indexing**: Document chunking, vector indexing in `user_file_chunks`, and private semantic search via `match_user_files`.

### Blocked (Production Supabase until Schema Approval)
- Persistent file upload initialization (`PGRST205` / table missing).
- Cloud storage persistence in `user-files` bucket.
- Background indexing and embedding of private documents.
- "✦ Ask AI" questions over private user documents on the live site.

---

## 6. Next Steps for Production Enablement

When the repository owner decides to activate the Private File Manager in production:

1. **Review and Approve Additive Migration**:
   - Apply `supabase/migrations/20261115000001_private_file_manager.sql` via Supabase CLI (`supabase db push`) or the Supabase Cloud SQL Editor.
   - Note: The migration is purely additive; it creates new tables, RPCs, and the isolated `user-files` bucket without modifying any shared corpus tables.
2. **Verify Storage Bucket Configuration**:
   - Ensure the `user-files` bucket is created as private (`public = false`) with 50 MB file size limit (`52428800` bytes).
3. **Verify Edge Function Secrets**:
   - Ensure `OPENROUTER_API_KEY` is configured in production Edge Functions for embedding generation during private document indexing.
4. **Deploy Vercel Preview / Production**:
   - Once the database migration is applied, the existing frontend code will automatically detect the presence of `public.user_files` and enable full file management operations.

---

## 7. Release Recommendation

**RECOMMENDATION: APPROVE FOR RELEASE ON `file-manager` BRANCH.**

- All code quality gates (ESLint, Vitest, Deno, Vite build, Router import) are **100% GREEN**.
- All 8 SQL authorization, lifecycle, quota, and RAG fixtures pass with non-vacuous proof on disposable PostgreSQL.
- CI pipeline failures are resolved with proper fixture registry and test dependency chaining.
- The codebase strictly adheres to repository rules: zero production database mutations, zero corpus pollution, zero fake persistence, and honest error boundaries.
