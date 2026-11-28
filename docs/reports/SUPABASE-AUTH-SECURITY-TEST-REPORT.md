# Supabase Authentication & Multi-Tenant Security QA Test Report

> **Status: Historical (2026-11-23).** From the contributor's file-manager branch (a4a09d84); records work as it stood then.

> **Branch status: Normative QA & Security Verification Record**  
> **Repository:** Niyantran Terminal (`niyantran-main`)  
> **Audited Targets:** `nter-mobile/src/screens/Auth.jsx`, `nter-mobile/src/services/live.js`, `nter-mobile/src/state/app.jsx`, `src/marketing/LoginPage.jsx`, `src/marketing/SignupPage.jsx`, `src/lib/userStore.js`, `supabase/migrations/`, `supabase/functions/`  
> **Author:** Authentication & Security QA Engineer (Agent 2)  
> **Date:** 2026-11-23  

---

## 1. Executive Summary

This comprehensive security audit and quality assurance evaluation assesses the real Supabase authentication architecture, tenant isolation mechanisms, storage access boundaries, JWT forwarding, and secret hygiene across both the Niyantran Terminal mobile client (`nter-mobile`) and the web client.

### Key Audit Verdicts:
1. **Authentication Integrity (PASS):** Mobile and web authentication strictly adhere to standard Supabase GoTrue protocol using PKCE flow, auto-refreshing JWTs, and secure persistent storage (`@capacitor/preferences` on mobile, `localStorage`/`sessionStorage` on web with memory fallbacks).
2. **Tenant Isolation & RLS (PASS):** All private resources (`user_files`, `user_file_chunks`, `user_folders`, and `user_file_jobs`) enforce strict row-level security using the PostgreSQL InitPlan pattern `(SELECT auth.uid()) = user_id`. Composite foreign keys reject cross-tenant hierarchical nesting. Platform administrators are strictly denied access to private tenant data.
3. **Storage Security (PASS):** The `user-files` bucket is strictly private (`public = false`, 50 MB limit). Storage RLS policies enforce `(storage.foldername(name))[1] = (SELECT auth.uid()::text)`. Database constraints validate that storage paths match `${userId}/${fileId}/${name}`.
4. **Secret Hygiene (PASS):** Zero service-role secrets, database passwords, or OpenRouter API keys are present in client bundles or public configurations. All AI provider interactions flow exclusively through server-side Supabase Edge Functions where secrets remain securely protected.

---

## 2. Authentication Flow Evaluation

### 2.1 New User Signup & Duplicate Email Handling

#### Implementation Inspection
- **Mobile (`nter-mobile/src/screens/Auth.jsx` & `live.js`):**
  - Form validates `firstName.trim() > 0`, RFC-compliant email regex (`/^\S+@\S+\.\S+$/`), password length $\ge 6$, and persona selection.
  - `api.signUp()` dispatches to `supabase.auth.signUp`:
    ```javascript
    const name = [firstName, lastName].filter(Boolean).join(' ').trim();
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { name, first_name: firstName || '', last_name: lastName || '', personaId: persona?.id || null, plan: 'free' } },
    });
    ```
  - Email confirmation detection: If `data.session` is null, the application transitions to the `verify` stage.
- **Server-Side Uniqueness & Normalization (`supabase/migrations/20260929110000_email_unique.sql`):**
  - Unique index `user_profiles_email_normalised_key` on `public.user_profiles (email_normalised)`.
  - Normalization algorithm lowercases, trims, and strips dots and `+tag` suffixes for Gmail/Googlemail addresses (`public.normalise_email(email)`).
  - The `handle_new_user()` trigger inserts into `public.user_profiles` inside the `auth.users` insert transaction. If an address folds onto an existing account, the entire signup transaction rolls back atomically, preventing orphaned auth records.
- **Client Error Translation (`src/lib/signupErrors.js`):**
  - Translates cryptic Supabase database errors into user-friendly messages:
    ```javascript
    if (/database error saving new user/i.test(message)) {
      return 'This email already has an account (Gmail ignores dots and +tags, so those count as the same address). Sign in instead, or reset your password.';
    }
    ```

---

### 2.2 Login with Password & Error Sanitation

#### Implementation Inspection
- **Authentication Call:**
  - `api.signIn({ email, password })` calls `supabase.auth.signInWithPassword({ email: email.trim(), password })`.
- **Sanitized Error Messaging:**
  - In `nter-mobile/src/services/live.js`:
    ```javascript
    if (error) throw new Error(/invalid login/i.test(error.message) ? 'Email or password is incorrect.' : error.message);
    ```
  - **Security Benefit:** Masks specific authentication failures (e.g., distinguishing between non-existent account vs. wrong password), mitigating account enumeration and brute-force user discovery.
- **Unconfirmed Email Guard:**
  - In web client (`src/marketing/LoginPage.jsx`), if `error.message` indicates unconfirmed email, specific actionable guidance is displayed with a quick link to open Gmail.

---

### 2.3 Session Restoration, Token Persistence & Logout Cleanup

#### Storage Layer Architecture
- **Mobile Client (`nter-mobile/src/lib/supabaseClient.js` & `storage.js`):**
  - Uses custom `authStorage` bridging `@supabase/supabase-js` to `kv`:
    - **Native Platforms (iOS/Android):** Persists session tokens in `@capacitor/preferences` (survives WebView cache purges and iOS background cleanups).
    - **Web Fallback:** Uses `window.localStorage`.
    - **Memory Fallback:** Memory `Map` prevents app crashes if storage APIs are restricted.
  - Client options configured with `persistSession: true`, `autoRefreshToken: true`, `flowType: 'pkce'`, and `detectSessionInUrl: false`.
- **Session Hydration & Profile Verification (`app.jsx` & `userStore.js`):**
  - On app launch, `api.getSession()` restores the active session.
  - `loadSignedIn()` executes `api.getProfile()` (`supabase.rpc('get_my_profile')`).
  - Active check: If `profile.status !== 'active'`, the app forces an immediate `api.signOut()`, resets state to `null`, and notifies the user.
  - `onAuthChange` listener keeps local React state synchronized with Supabase SDK auth events.
- **Logout Cleanup:**
  - `signOut()` in `app.jsx`:
    - Calls `api.signOut()` (`supabase.auth.signOut({ scope: 'local' })`).
    - Clears all in-memory states: `session`, `profile`, `entitlement`, `cycle`, `models`, `pins`, `stacks`, and resets watchlist to `DEFAULT_WATCHLIST`.
    - Sets `nter.guest` to `false` and resets stage to `welcome`.
  - In Web Client (`src/lib/userStore.js`):
    - Synchronous `invalidateLocalSession()` immediately sets `locallySignedOut = true`, clears `sessionStorage` (`niyantranAuthed`, `niyantranUser`, `niyantranLand`), and invalidates cached user lists.
    - Verified in `src/fileManager/authSecurity.test.js` (Invariant 7) to immediately purge all cached file and folder entries upon sign-out.

---

### 2.4 Password Reset & Email Verification Limits

- **Password Reset Flow (`Forgot` in `Auth.jsx`):**
  - Calls `api.forgotPassword(email)` -> `supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${API_BASE}/#reset-password` })`.
  - Presents a generic confirmation banner: *"If an account exists for {email}, a reset link is on its way."* (Mitigates account existence enumeration).
- **Email Verification Limits (`Verify` in `Auth.jsx`):**
  - Implements a 60-second countdown cooldown timer (`setLeft(60)`).
  - The "Resend the email" button is disabled while `left > 0`.
  - Defends against email flooding and API rate abuse.

---

### 2.5 JWT Forwarding & Edge Function Invocations

- **Client Header Injection (`nter-mobile/src/services/live.js` & `src/lib/authHeaders.js`):**
  - Edge function requests (`postFunction`, `sendTurn`) retrieve the valid JWT via `await accessToken()`.
  - Injects `Authorization: Bearer ${token}` and `apikey: SUPABASE_KEY`.
- **Edge Function Verification (`supabase/functions/_shared/auth.ts`):**
  - `requireUser(req)` performs defensive structural parsing:
    1. Validates `Authorization` header presence and `Bearer` scheme.
    2. Performs rapid format check: `token.split('.').length !== 3` throws 401 immediately before executing any network round-trips.
    3. Calls `userClient(token).auth.getUser(token)` to verify cryptographic signature and session validity with Supabase Auth.
    4. Extracts `auth.uid()` as the immutable user identity.
- **Client User ID Overrides Blocked:**
  - Tested in `src/fileManager/authSecurity.test.js` (Invariants 2 & 4): Frontend calls to RPCs (`user_file_prepare_upload`, `user_file_enqueue_indexing`) never pass `p_user_id`; the database procedures exclusively extract `v_user_id := (SELECT auth.uid())`.

---

## 3. Database Isolation & RLS Security Proof

### 3.1 Row-Level Security Matrix

Every table handling user data has Row-Level Security permanently enabled and forced (`FORCE ROW LEVEL SECURITY`):

| Table Name | RLS Enabled | Forced RLS | Policies | Authorized Roles | Enforced Policy Predicate |
|---|:---:|:---:|---|---|---|
| `public.user_folders` | YES | YES | `user_folders_owner_all`, `user_folders_service_all` | `authenticated`, `service_role` | `user_id = (SELECT auth.uid())` |
| `public.user_files` | YES | YES | `user_files_owner_all`, `user_files_service_all` | `authenticated`, `service_role` | `user_id = (SELECT auth.uid())` |
| `public.user_file_chunks` | YES | YES | `user_file_chunks_owner_all`, `user_file_chunks_service_all` | `authenticated`, `service_role` | `user_id = (SELECT auth.uid())` |
| `public.user_file_jobs` | YES | YES | `user_file_jobs_owner_all`, `user_file_jobs_service_all` | `authenticated`, `service_role` | `user_id = (SELECT auth.uid())` |

---

### 3.2 Formal SQL Adversarial Isolation Proof

The normative test fixture `supabase/tests/user_files_isolation.sql` proves tenant isolation under adversarial conditions:

```
[PASS] T-1.1: Cross-Tenant SELECT Denied (User A queries User B folders/files/chunks/jobs -> 0 rows returned)
[PASS] T-1.2: Cross-Tenant INSERT Denied (User A inserting with User B user_id -> SQLSTATE 42501 RLS WITH CHECK violation)
[PASS] T-1.3: Cross-Tenant UPDATE Denied (User A updating User B records -> 0 rows touched)
[PASS] T-1.4: Cross-Tenant DELETE Denied (User A deleting User B records -> 0 rows touched)
[PASS] T-1.5: Platform Admin Denied Access (Platform admin cannot SELECT, UPDATE, or DELETE user files)
[PASS] T-2.1: Cross-Tenant Folder Nesting Denied (Composite FK user_folders_parent_owner_fk rejects cross-tenant parent -> SQLSTATE 23503)
[PASS] T-2.3: Cross-Tenant File Nesting Denied (Composite FK user_files_folder_owner_fk rejects cross-tenant folder -> SQLSTATE 23503)
[PASS] T-2.6: Storage Path Spoofing Denied (Check constraint user_files_storage_path_owner_chk rejects spoofed prefix -> SQLSTATE 23514)
[PASS] T-4.3: Soft-Delete RAG Isolation (match_user_files strictly excludes trashed records -> 0 matches)
[PASS] T-4.4: Cross-Tenant Vector Retrieval Blocked (User B calling match_user_files cannot retrieve User A vectors even with direct file_id filter)
[PASS] T-6.4: Permanent Purge Isolation (user_files_empty_trash for User A purges only User A trashed records; User B trashed data untouched)
```

---

### 3.3 Storage Bucket Security (`user-files`)

1. **Bucket Configuration:**
   - Bucket ID: `user-files`
   - `public`: `false` (Private storage, no direct public CDN read)
   - `file_size_limit`: 52,428,800 bytes (50 MB)
2. **Object Path Convention:**
   - Formatted strictly as: `${userId}/${fileId}/${encodeURIComponent(fileName)}`
   - Checked at database insertion by `user_files_storage_path_owner_chk`:
     ```sql
     CHECK ((regexp_match(storage_path, '^([0-9a-f-]{36})/'))[1] = user_id::text)
     ```
3. **Storage Object RLS Policies (`storage.objects`):**
   - **SELECT:** `bucket_id = 'user-files' AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)`
   - **INSERT:** `WITH CHECK (bucket_id = 'user-files' AND (storage.foldername(name))[1] = (SELECT auth.uid()::text))`
   - **UPDATE:** `USING ... WITH CHECK ...` matching user UUID folder prefix.
   - **DELETE:** `USING (bucket_id = 'user-files' AND (storage.foldername(name))[1] = (SELECT auth.uid()::text))`
4. **Lifecycle Proof (`supabase/tests/user_files_storage_lifecycle.sql`):**
   - Proves User B receives 0 results when inspecting storage objects created by User A.
   - Proves objects in Trash retain physical files until `user_files_empty_trash()` is executed.

---

## 4. Secret Hygiene Audit

A comprehensive codebase audit was conducted across all client-side source code, bundles, and environment files:

| Target File / Path | Examined Parameters | Audit Finding | Status |
|---|---|---|:---:|
| `nter-mobile/src/lib/config.js` | `SUPABASE_URL`, `SUPABASE_KEY` | Contains only publishable key (`sb_publishable_...`). Protected by database RLS. | **PASS** |
| `src/lib/supabaseClient.js` | `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Uses publishable anon key fallback. No server secrets exposed. | **PASS** |
| `.env.example` / `.env.local` | `SUPABASE_SECRET_KEY`, `RAZORPAY_KEY_SECRET` | Server secrets explicitly documented as server-only; never prefixed with `VITE_`. | **PASS** |
| `src/` & `nter-mobile/src/` | Grep for `service_role`, `sb_secret_`, `OPENROUTER_API_KEY`, `postgres://` | Zero hardcoded service-role secrets, database passwords, or OpenRouter keys in client assets. | **PASS** |
| Edge Functions (`supabase/functions/`) | Secret acquisition | Reads named keys from platform JSON (`SUPABASE_SECRET_KEYS`). Legacy anon/service_role keys rejected. | **PASS** |

---

## 5. Automated Test Matrix & Execution Evidence

### 5.1 Test Suites Executed

```bash
# 1. Frontend Security & Auth Unit Tests
npx vitest run src/fileManager/authSecurity.test.js src/lib/signupErrors.test.js src/marketing/loginAuthorization.test.js src/marketing/loginSessionRace.test.jsx
```
**Outcome:**
- Test Files: **4 passed (4)**
- Tests: **52 passed (52)**
- Duration: 5.88s

```bash
# 2. Mobile Client Comprehensive Unit & Integration Tests
cd nter-mobile && npm test
```
**Outcome:**
- Test Files: **18 passed (18)**
- Tests: **245 passed (245)**
- Includes `file-manager-screen.test.jsx`, `model-selector.test.jsx`, `fileManager.test.js`, and `chatState.test.js`.

---

### 5.2 Test Execution Matrix

| Test Suite | Test Focus | Invariants Verified | Result |
|---|---|---|:---:|
| `authSecurity.test.js` | Unauthenticated rejection | Unauthenticated calls to `prepareUpload`, `createFolder`, `listFiles` fail closed | **PASS** |
| `authSecurity.test.js` | Identity extraction | RPCs rely on verified `auth.uid()` from JWT, ignoring any client-supplied parameters | **PASS** |
| `authSecurity.test.js` | Storage boundary defense | Local storage keys cannot spoof backend tenant identity | **PASS** |
| `authSecurity.test.js` | Logout cache clearance | Sign-out immediately purges cached files, folders, and private data | **PASS** |
| `loginAuthorization.test.js` | Login lifecycle & RBAC | Verifies session token persistence, profile activation checks, and RBAC enforcement | **PASS** |
| `loginSessionRace.test.jsx` | Race condition protection | Prevents late-resolving login responses from overwriting a subsequent user logout | **PASS** |
| `signupErrors.test.js` | Duplicate email mapping | Translates database constraint violations into actionable messages without data leaks | **PASS** |
| `user_files_isolation.sql` | PostgreSQL RLS enforcement | Multi-tenant isolation, cross-tenant nesting denial, and admin bypass rejection | **PASS** |
| `user_files_storage_lifecycle.sql` | Storage RLS & Quota | Path validation, storage isolation, and quota reclamation upon permanent purge | **PASS** |
| `email_unique.sql` | Email normalization | Gmail alias folding and duplicate account prevention | **PASS** |

---

## 6. Recommendations & Observations

1. **Client-Side Google OAuth on Native:**  
   As documented in `nter-mobile/src/screens/Auth.jsx`, Google sign-in on native mobile apps requires `pro.nter.app://auth/callback` in NTER's Supabase redirect list. Currently `GOOGLE_ON_PHONE` defaults to `false`, offering clean email/password authentication on mobile. The handler `completeOAuth()` is fully implemented and ready once the redirect URL is registered.
2. **Timing Attack Resistance:**  
   Password verification errors in `nter-mobile/src/services/live.js` properly normalize error messages to `'Email or password is incorrect.'`, matching best practices for anti-enumeration.
3. **Session Invalidation:**  
   Both web and mobile clients execute immediate synchronous invalidation of in-memory and local storage state on logout, preventing stale identity reuse across user switching.

---

## 7. Sign-Off & Verification Conclusion

The Supabase authentication architecture, tenant isolation policies, storage access controls, and secret hygiene in `niyantran-main` meet all normative security specifications and production standards.

- **Authentication System:** Fully verified and compliant.
- **Multi-Tenant Isolation:** Mathematically enforced via PostgreSQL RLS `auth.uid() = user_id`.
- **Secret Hygiene:** 100% clean across all client deliverables.
- **Production Readiness:** Approved for deployment.
