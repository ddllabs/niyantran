# F341 (main: F419) Database Security & Access Control Final Audit

> **Status: Historical (2026-11-18).** From the contributor's file-manager branch (a4a09d84); records work as it stood then.

> **Branch status: Normative Record**  
> **Feature:** F341 — Private File Manager & Storage Architecture  
> **Component:** PostgreSQL Schemas, RLS Policies, Function Security & Privilege Boundaries  
> **Author:** Principal Engineer / Database Security Specialist  
> **Target Production:** NTER Supabase (`vfgcppstyzjarlzyqdac`)  
> **Date:** 2026-11-18

---

## 1. Scope & Objective

This audit verifies the isolation, row-level security (RLS), least-privilege RPC execution rights, and storage bucket security across all database objects introduced or modified by F341.

---

## 2. Table-Level Isolation & RLS Matrix

Every table introduced for user files has row-level security explicitly enabled (`ENABLE ROW LEVEL SECURITY`) with `RESTRICTIVE` or user-bound policies:

| Table Name | RLS Enabled | Policies Defined | Permitted Roles | Isolation Rule |
|---|:---:|:---:|---|---|
| `public.user_folders` | YES | `user_folders_owner_select`, `user_folders_owner_insert`, `user_folders_owner_update`, `user_folders_owner_delete` | `authenticated` | `auth.uid() = user_id` |
| `public.user_files` | YES | `user_files_owner_select`, `user_files_owner_insert`, `user_files_owner_update`, `user_files_owner_delete` | `authenticated` | `auth.uid() = user_id` |
| `public.user_file_chunks` | YES | `user_file_chunks_owner_select`, `user_file_chunks_owner_delete` | `authenticated`, `service_role` | `auth.uid() = user_id` (No direct insert for authenticated users) |
| `public.user_file_indexing_jobs` | YES | `user_file_jobs_owner_select` | `authenticated`, `service_role` | `auth.uid() = user_id` (Direct modifications restricted to service role) |

### 2.1 Complete Corpus Isolation
`public.user_file_chunks` is completely separate from `public.document_chunks`.
- Foreign key references `public.user_files(id) ON DELETE CASCADE`.
- No join or union exists between public legal documents and private user files in retrieval functions (`search_document_chunks` vs `match_user_files`).
- Cross-tenant data leakage is mathematically impossible under the enforced `user_id = auth.uid()` predicate.

---

## 3. Storage Bucket Security (`user-files`)

The `user-files` storage bucket is configured as private:
- `public = false`.
- Storage objects path convention: `${user_id}/${file_id}/${filename}`.
- Storage RLS policies enforce:
  ```sql
  (bucket_id = 'user-files' AND (storage.foldername(name))[1] = auth.uid()::text)
  ```
- Direct public access via CDN is denied. Uploads and downloads require signed URLs generated via authenticated RPCs (`user_file_prepare_upload`).

---

## 4. RPC Security Inventory (13 Procedures)

Privileges on all F341 RPCs follow strict least-privilege principles:

| Function Name | Security Type | Permitted Roles | Explicit REVOKE | Purpose |
|---|:---:|---|---|---|
| `user_file_prepare_upload` | `SECURITY DEFINER` | `authenticated` | `anon`, `PUBLIC` | Enforces quota, checks mime/size, creates pending record |
| `user_file_complete_upload` | `SECURITY DEFINER` | `authenticated` | `anon`, `PUBLIC` | Verifies file in storage, activates status |
| `user_storage_quota_bytes` | `SECURITY DEFINER` | `authenticated` | `anon`, `PUBLIC` | Returns used vs allocated quota (500 MB base) |
| `user_folder_soft_delete` | `SECURITY DEFINER` | `authenticated` | `anon`, `PUBLIC` | Soft deletes folder and cascades to nested files |
| `user_file_restore` | `SECURITY DEFINER` | `authenticated` | `anon`, `PUBLIC` | Restores files/folders from trash |
| `user_files_empty_trash` | `SECURITY DEFINER` | `authenticated` | `anon`, `PUBLIC` | Purges deleted records permanently |
| `match_user_files` | `SECURITY DEFINER` | `authenticated` | `anon`, `PUBLIC` | Vector similarity search scoped strictly to `auth.uid()` |
| `user_file_enqueue_indexing` | `SECURITY DEFINER` | `authenticated` | `anon`, `PUBLIC` | Enqueues job with pre-flight hold & fail-closed feature gate |
| `user_file_job_cancel` | `SECURITY DEFINER` | `authenticated` | `anon`, `PUBLIC` | Cancels pending job, releases hold |
| `user_file_job_retry` | `SECURITY DEFINER` | `authenticated` | `anon`, `PUBLIC` | Retries failed job, gated by `file_indexing_billing` |
| `user_file_settle_credits` | `SECURITY DEFINER` | `service_role` | `PUBLIC`, `anon`, `authenticated` | Authoritative billing settlement |
| `user_file_claim` | `SECURITY DEFINER` | `service_role` | `PUBLIC`, `anon`, `authenticated` | Ingest worker lease acquisition |
| `user_file_advance` | `SECURITY DEFINER` | `service_role` | `PUBLIC`, `anon`, `authenticated` | Checkpoints progress and commits chunks |

### 4.1 Server-Side Feature Gate Hardening
In `supabase/migrations/20261118000001_file_indexing_billing.sql`, `user_file_enqueue_indexing` and `user_file_job_retry` enforce a fail-closed guard:
```sql
IF NOT COALESCE((SELECT (value = 'true'::jsonb) FROM public.app_flags WHERE key = 'file_indexing_billing'), false) THEN
  RAISE EXCEPTION 'feature_disabled: AI indexing and billing is temporarily disabled pending production rollout'
    USING ERRCODE = '55000';
END IF;
```
Even if client-side code is modified or bypassed, direct RPC invocation fails with SQLSTATE `55000` until explicitly enabled by an administrator.
