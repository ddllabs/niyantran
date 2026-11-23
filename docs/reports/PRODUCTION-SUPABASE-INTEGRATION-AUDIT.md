# Production Supabase Integration Audit Report

> **Status: Normative.** Architectural audit of Supabase client configuration, authentication flows, database RPCs, Edge Functions, storage, RLS policies, vector ingestion, and live/sample data mode separation for Niyantran Terminal & NTER Mobile.
> **Date:** 2026-11-23
> **Auditor:** Agent 1 (Production Architecture & Supabase Auditor)

---

## 1. Executive Summary

This audit assesses the backend and database integration between the Niyantran frontend (Niyantran Terminal web client and NTER Mobile Capacitor client) and the Supabase production platform. The audit verifies client configuration, authentication lifecycles, database RPCs, Edge Function execution, storage bucket policies, Row-Level Security (RLS) enforcement, environment variable isolation, and the structural separation between live production data and offline sample modes.

### Key Audit Findings
1. **Supabase Client Architecture (PASS):** Both web and mobile frontend targets implement hardened Supabase JS v2 clients. Mobile uses PKCE flow with Capacitor Preferences (`@capacitor/preferences`) key-value storage adapter for persistent mobile sessions. Public keys are restricted to publishable keys (`sb_publishable_...`).
2. **Path Resolution & Scope Clarification:** The prompt instructed inspection of `nter-mobile/src/lib/config.js`, `src/services/live.js`, and `src/services/fileManager.js`. The audit confirmed that `live.js` and `fileManager.js` are mobile services located at `nter-mobile/src/services/live.js` and `nter-mobile/src/services/fileManager.js`, while the web desktop equivalent is located at `src/fileManager/fileManagerService.js` and `src/lib/supabaseClient.js`. Both implementations are audited below.
3. **Authentication Flows (PASS / PARTIAL):** Standard email/password authentication, registration, session recovery, and token refresh are fully functional. Google OAuth on web is functional; on native mobile, it is gated by `VITE_GOOGLE_ON_PHONE=0` pending whitelist of `pro.nter.app://auth/callback` in Supabase URL redirects (**PARTIAL** on native mobile).
4. **Edge Function Integration (PASS):** `research-chat` (streaming SSE multi-turn RAG) and `ingest-worker` (asynchronous OCR, chunking, and embedding) are verified. Functions run under Deno runtime with bounded execution (`NETWORK_TIMEOUT_MS = 4_000`), JWT authentication via `requireUser`, and server-side secret handling.
5. **Storage & Private File Manager (PASS / PARTIAL):** Storage bucket `user-files` enforces 50 MB limits and strict owner RLS via `(SELECT auth.uid()::text)`. Dual-source RAG search (`match_user_files`) runs concurrently with corpus search (`match_documents`). Server-side billing and indexing enqueue RPC (`user_file_enqueue_indexing`) is implemented but guarded client-side by `IS_INDEXING_BILLING_DEPLOYED = false` (**PARTIAL**).
6. **Strict Separation of Live and Sample Modes (PASS):** Complete isolation between `live` and `sample` modes governed by `DATA_MODE` in `nter-mobile/src/services/index.js`. Sample mode executes 100% offline using bundled JSON fixtures without network emissions.

---

## 2. Supabase Client Configuration

### 2.1 Mobile Client Configuration (`nter-mobile`)
- **Config Entry:** [`nter-mobile/src/lib/config.js`](file:///c:/Users/Afreen/Downloads/niyantran-main%20(2)/niyantran-main/nter-mobile/src/lib/config.js#L1-L18)
- **Client Factory:** [`nter-mobile/src/lib/supabaseClient.js`](file:///c:/Users/Afreen/Downloads/niyantran-main%20(2)/niyantran-main/nter-mobile/src/lib/supabaseClient.js#L1-L26)
- **Configuration Details:**
  ```javascript
  export const SUPABASE_URL = env.VITE_SUPABASE_URL || 'https://vfgcppstyzjarlzyqdac.supabase.co';
  export const SUPABASE_KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_9X9OJnXkf-UuJcVvsY13nA_J_7oJ_-I';
  ```
- **Auth Storage Adapter:**
  Mobile bridges session storage to `@capacitor/preferences` via custom `authStorage`:
  ```javascript
  const authStorage = {
    getItem: (k) => kv.get(k),
    setItem: (k, v) => kv.set(k, v),
    removeItem: (k) => kv.remove(k),
  };
  export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      storage: authStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
  });
  ```
- **Security Assessment:** PASS. The mobile client utilizes PKCE auth flow suitable for mobile native applications, handles token refreshing automatically, and never bundles server secrets.

### 2.2 Web Desktop Client Configuration (`src/lib/supabaseClient.js`)
- **Source File:** [`src/lib/supabaseClient.js`](file:///c:/Users/Afreen/Downloads/niyantran-main%20(2)/niyantran-main/src/lib/supabaseClient.js#L1-L35)
- **Configuration Details:**
  ```javascript
  const SUPABASE_URL = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL) || 'https://vfgcppstyzjarlzyqdac.supabase.co';
  const SUPABASE_ANON_KEY = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY) || 'sb_publishable_9X9OJnXkf-UuJcVvsY13nA_J_7oJ_-I';
  export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: typeof window !== 'undefined',
      autoRefreshToken: true,
    },
  });
  ```
- **Security Assessment:** PASS. Standard browser localStorage persistence with auto-refresh. Only public anon/publishable keys are exposed.

---

## 3. Authentication Architecture & Flow Audit

### 3.1 Authentication Flows in `nter-mobile/src/services/live.js`
- **Source File:** [`nter-mobile/src/services/live.js`](file:///c:/Users/Afreen/Downloads/niyantran-main%20(2)/niyantran-main/nter-mobile/src/services/live.js#L18-L85)

| Flow | Method | Implementation | Status | Evidence / Notes |
|---|---|---|---|---|
| **Session Retrieval** | `getSession()` | `supabase.auth.getSession()` | **PASS** | Retrieves active session from Capacitor Preferences. |
| **Auth State Listener** | `onAuthChange(cb)` | `supabase.auth.onAuthStateChange(...)` | **PASS** | Returns unsubscribe callback to avoid memory leaks. |
| **Email/Password Sign-In** | `signIn({ email, password })` | `supabase.auth.signInWithPassword(...)` | **PASS** | Sanitizes errors ("Email or password is incorrect"). |
| **Email Sign-Up** | `signUp({ email, password, firstName, lastName, persona })` | `supabase.auth.signUp(...)` | **PASS** | Inserts profile metadata (`name`, `personaId`, `plan: 'free'`). Flags `needsConfirmation: !data.session`. |
| **Email Confirmation Resend** | `resendConfirmation(email)` | `supabase.auth.resend({ type: 'signup', email })` | **PASS** | Handles delivery failures via custom exception normalization. |
| **Password Reset** | `forgotPassword(email)` | `supabase.auth.resetPasswordForEmail(email, { redirectTo })` | **PASS** | Redirects to `${API_BASE}/#reset-password`. |
| **Google Sign-In (Web)** | `signInWithGoogle()` | `supabase.auth.signInWithOAuth({ provider: 'google', ... })` | **PASS** | Redirects to `window.location.origin` on desktop/web. |
| **Google Sign-In (Mobile)** | `signInWithGoogle()` & `completeOAuth(url)` | Capacitor Browser + `pro.nter.app://auth/callback` | **PARTIAL** | Gated by `VITE_GOOGLE_ON_PHONE=0` in `.env.example`. Deep-link callback handler `completeOAuth` exchange is implemented, but pending Supabase dashboard URL configuration. |
| **Sign-Out** | `signOut()` | `supabase.auth.signOut({ scope: 'local' })` | **PASS** | Local scope purge avoids invalidating sessions across concurrent browser windows. |

---

## 4. Database RPC Integration Matrix

Every RPC called by frontend clients and edge services was checked against database migrations:

| RPC Function | Called By | Migration Source | Purpose & Behavior | Status |
|---|---|---|---|---|
| `get_my_profile` | `live.getProfile` | [`20260921000012_profile_authority.sql`](file:///c:/Users/Afreen/Downloads/niyantran-main%20(2)/niyantran-main/supabase/migrations/20260921000012_profile_authority.sql) | Fetches user profile for authenticated session. | **PASS** |
| `my_entitlement_manual` | `live.getEntitlement`, `live.getStorageUsage` | [`20260929100000_plan_entitlements.sql`](file:///c:/Users/Afreen/Downloads/niyantran-main%20(2)/niyantran-main/supabase/migrations/20260929100000_plan_entitlements.sql) | Authoritative plan and status evaluation. | **PASS** |
| `my_credits_cycle_v3` | `live.getCredits` | [`20261017194626_credit_paise_contract.sql`](file:///c:/Users/Afreen/Downloads/niyantran-main%20(2)/niyantran-main/supabase/migrations/20261017194626_credit_paise_contract.sql) | Retrieves active credit balances, limits, and cycle window. | **PASS** |
| `model_credit_estimates` | `live.getModels` | [`20260921000008_admin_models_rpc.sql`](file:///c:/Users/Afreen/Downloads/niyantran-main%20(2)/niyantran-main/supabase/migrations/20260921000008_admin_models_rpc.sql) | Returns AI model cost calculations per 1k tokens. | **PASS** |
| `search_desk_rows` | `live.searchRecords` | [`20260921000011_desk_rows_search.sql`](file:///c:/Users/Afreen/Downloads/niyantran-main%20(2)/niyantran-main/supabase/migrations/20260921000011_desk_rows_search.sql), [`20260922073933`](file:///c:/Users/Afreen/Downloads/niyantran-main%20(2)/niyantran-main/supabase/migrations/20260922073933_desk_rows_search_uses_trigram.sql) | Trigram search across desk rows with optional predicates. | **PASS** |
| `user_storage_quota_bytes` | `fileManagerService.js`, Supabase SQL | [`20261115000001_private_file_manager.sql`](file:///c:/Users/Afreen/Downloads/niyantran-main%20(2)/niyantran-main/supabase/migrations/20261115000001_private_file_manager.sql#L234-L282) | Calculates plan quota: Free (500MB), Plus (2GB), Pro (5GB), Max (50GB). | **PASS** |
| `user_storage_used_bytes` | `fileManagerService.js`, Supabase SQL | [`20261115000001_private_file_manager.sql`](file:///c:/Users/Afreen/Downloads/niyantran-main%20(2)/niyantran-main/supabase/migrations/20261115000001_private_file_manager.sql#L285-L312) | Sums non-failed active storage usage for user. | **PASS** |
| `user_file_prepare_upload` | `fileManagerService.js` (Web) | [`20261115000001_private_file_manager.sql`](file:///c:/Users/Afreen/Downloads/niyantran-main%20(2)/niyantran-main/supabase/migrations/20261115000001_private_file_manager.sql#L315-L390) | Atomic quota reservation under `pg_advisory_xact_lock`. Mobile `live.js` bypasses this RPC and does client size check + direct insert. | **PARTIAL** |
| `user_file_complete_upload` | `fileManagerService.js` (Web) | [`20261115000001_private_file_manager.sql`](file:///c:/Users/Afreen/Downloads/niyantran-main%20(2)/niyantran-main/supabase/migrations/20261115000001_private_file_manager.sql#L392-L425) | Sets status to `'uploaded'` and attaches SHA-256 hash. | **PASS** |
| `user_files_empty_trash` | `fileManagerService.js` | [`20261115000001_private_file_manager.sql`](file:///c:/Users/Afreen/Downloads/niyantran-main%20(2)/niyantran-main/supabase/migrations/20261115000001_private_file_manager.sql#L428-L475) | Purges trashed files/folders and returns storage paths to delete. | **PASS** |
| `match_user_files` | `_shared/retrieval.ts` (`research-chat`) | [`20261115000001_private_file_manager.sql`](file:///c:/Users/Afreen/Downloads/niyantran-main%20(2)/niyantran-main/supabase/migrations/20261115000001_private_file_manager.sql#L736), [`20261121000001`](file:///c:/Users/Afreen/Downloads/niyantran-main%20(2)/niyantran-main/supabase/migrations/20261121000001_user_file_chunks_metadata.sql#L19) | Vector similarity search over `user_file_chunks` (1536 dims). | **PASS** |
| `user_file_enqueue_indexing` | `fileManagerService.js` | [`20261118000001_file_indexing_billing.sql`](file:///c:/Users/Afreen/Downloads/niyantran-main%20(2)/niyantran-main/supabase/migrations/20261118000001_file_indexing_billing.sql#L13-L120) | Places pre-flight credit hold and queues indexing job in `user_file_jobs`. Client-gated by `IS_INDEXING_BILLING_DEPLOYED = false`. Mobile `live.js` sets status directly. | **PARTIAL** |
| `match_documents` / `match_documents_hybrid` | `_shared/retrieval.ts` (`research-chat`) | [`20260921000009_rag_rpcs.sql`](file:///c:/Users/Afreen/Downloads/niyantran-main%20(2)/niyantran-main/supabase/migrations/20260921000009_rag_rpcs.sql), [`20261102120000`](file:///c:/Users/Afreen/Downloads/niyantran-main%20(2)/niyantran-main/supabase/migrations/20261102120000_chunk_hybrid_search.sql) | Primary public corpus RAG search functions. | **PASS** |

---

## 5. Edge Function Invocations & Gateway Security

### 5.1 Invocation Profiles

#### 1. `research-chat` (Interactive Streaming RAG)
- **Path:** [`supabase/functions/research-chat/`](file:///c:/Users/Afreen/Downloads/niyantran-main%20(2)/niyantran-main/supabase/functions/research-chat/index.ts)
- **Invocation:** Called directly by frontend `live.sendTurn()` ([`nter-mobile/src/services/live.js#L226-L241`](file:///c:/Users/Afreen/Downloads/niyantran-main%20(2)/niyantran-main/nter-mobile/src/services/live.js#L226-L241)).
- **Transport:** HTTP POST with `Accept: text/event-stream`.
- **Authentication:** `Authorization: Bearer <user_jwt>`, validated server-side by `requireUser(req)`.
- **CORS:** Controlled by `_shared/cors.ts`. Must match entries in `ALLOWED_ORIGINS` secret.
- **Credit Lifecycle:** Calls `reserve_turn_credits` RPC before execution and `settle_turn_credits` RPC after completion.
- **Status:** **PASS**.

#### 2. `desk-brief` (Record Intelligence Briefs)
- **Path:** [`supabase/functions/desk-brief/`](file:///c:/Users/Afreen/Downloads/niyantran-main%20(2)/niyantran-main/supabase/functions/desk-brief/)
- **Invocation:** Called by `live.recordBrief()` ([`nter-mobile/src/services/live.js#L214-L220`](file:///c:/Users/Afreen/Downloads/niyantran-main%20(2)/niyantran-main/nter-mobile/src/services/live.js#L214-L220)).
- **Transport:** HTTP POST with JSON body.
- **Authentication:** Authenticated user or public fallback.
- **Status:** **PASS**.

#### 3. `ingest-worker` (Asynchronous OCR & Vector Pipeline)
- **Path:** [`supabase/functions/ingest-worker/`](file:///c:/Users/Afreen/Downloads/niyantran-main%20(2)/niyantran-main/supabase/functions/ingest-worker/index.ts)
- **Invocation:** Triggered periodically via `pg_cron` / `pg_net` or admin trigger with `x-ingest-secret: INGEST_WORKER_SECRET` header ([`supabase/config.toml#L435-L437`](file:///c:/Users/Afreen/Downloads/niyantran-main%20(2)/niyantran-main/supabase/config.toml#L435-L437)).
- **Authentication:** Verifies `INGEST_WORKER_SECRET`. Uses `serviceClient()` for database operations.
- **Partitioned Concurrency:** Configured in `ingest_settings` (`corpus_max_running = 2`, `user_file_max_running = 2`, `max_running_per_user = 1`) preventing queue starvation.
- **Status:** **PASS**.

---

## 6. Storage Configuration (`user-files`) & RLS Security

### 6.1 Bucket Settings
- **Bucket ID:** `user-files`
- **Public:** `false` (Private storage bucket)
- **File Size Cap:** `52,428,800` bytes (50 MB individual file limit)
- **Path Scheme:** `<user_id>/<file_id>/<encoded_file_name>`
- **Source Definition:** [`supabase/migrations/20261115000001_private_file_manager.sql#L23-L27`](file:///c:/Users/Afreen/Downloads/niyantran-main%20(2)/niyantran-main/supabase/migrations/20261115000001_private_file_manager.sql#L23-L27) and [`supabase/migrations/supabase_dashboard_storage_setup.sql#L12-L16`](file:///c:/Users/Afreen/Downloads/niyantran-main%20(2)/niyantran-main/supabase/migrations/supabase_dashboard_storage_setup.sql#L12-L16).

### 6.2 Storage RLS Policies on `storage.objects`
```sql
CREATE POLICY user_files_storage_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'user-files' AND (storage.foldername(name))[1] = (SELECT auth.uid()::text));

CREATE POLICY user_files_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'user-files' AND (storage.foldername(name))[1] = (SELECT auth.uid()::text));

CREATE POLICY user_files_storage_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'user-files' AND (storage.foldername(name))[1] = (SELECT auth.uid()::text))
  WITH CHECK (bucket_id = 'user-files' AND (storage.foldername(name))[1] = (SELECT auth.uid()::text));

CREATE POLICY user_files_storage_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'user-files' AND (storage.foldername(name))[1] = (SELECT auth.uid()::text));
```
- **Security Assessment:** PASS. The first path component MUST equal `auth.uid()`. Cross-tenant reads, writes, and deletes are strictly prevented by database engine security.

---

## 7. Row-Level Security (RLS) Analysis

### 7.1 Production Migrations (`supabase/migrations/`)
- All user tables have RLS enabled and forced:
  - `user_profiles`: Owner-only select/update (`auth.uid() = user_id`).
  - `conversations`: Owner-only select/insert/update/delete (`auth.uid() = user_id`).
  - `chat_messages`: Owner-only select/insert/update/delete (`auth.uid() = user_id`).
  - `user_preferences`: Owner-only (`auth.uid() = user_id`).
  - `user_folders`: Owner-only using InitPlan pattern `user_id = (SELECT auth.uid())`.
  - `user_files`: Owner-only using `user_id = (SELECT auth.uid())`.
  - `user_file_chunks`: Owner-only using `user_id = (SELECT auth.uid())`. Platform admins are explicitly barred from accessing private file chunks.
  - `user_file_jobs`: Owner-only using `user_id = (SELECT auth.uid())`.
- **Status:** **PASS**.

### 7.2 Bootstrap Test Schema (`backend/sql/auth_schema.sql`)
- Contains bootstrap schema for local disposable test runs (`npm run test:sql`).
- Header explicitly states:
  > *WARNING - this file is NOT the source of truth for the live database. It is created by no migration in supabase/migrations/, so nothing verifies it against production.*
- **Status:** **PASS** (as a local test fixture); **NOT VERIFIED** against live production (by normative repository design).

---

## 8. Environment Variable Handling & Secret Governance

| Variable | Scope | Target | Security Risk Assessment | Status |
|---|---|---|---|---|
| `VITE_SUPABASE_URL` | Client (Public) | Frontend build | Safe: public endpoint. | **PASS** |
| `VITE_SUPABASE_ANON_KEY` / `VITE_SUPABASE_PUBLISHABLE_KEY` | Client (Public) | Frontend build | Safe: publishable key, protected by database RLS. | **PASS** |
| `VITE_DATA_MODE` | Client (Public) | Frontend build | Safe: `'live'` or `'sample'`. | **PASS** |
| `SUPABASE_SECRET_KEY` | Server-Only | Edge Functions / Scripts | Protected: not prefixed with `VITE_`. Legacy `SUPABASE_SERVICE_ROLE_KEY` is revoked and ignored. | **PASS** |
| `OPENROUTER_API_KEY` | Server-Only | Supabase Secrets | Protected: ADR 0008 enforces storage strictly in Supabase secrets. Never present in client builds or `.env`. | **PASS** |
| `MISTRAL_API_KEY` | Server-Only | Supabase Secrets | Protected: used only in `ingest-worker` for OCR. | **PASS** |
| `INGEST_WORKER_SECRET`| Server-Only | Supabase Secrets | Protected: shared bearer for background worker cron trigger. | **PASS** |
| `RAZORPAY_KEY_SECRET` | Server-Only | Server runtime | Protected: server-side billing only. | **PASS** |

---

## 9. Production (`live`) vs Sample (`sample`) Data Mode Separation

The architecture provides complete isolation between live cloud operations and local offline execution:
- **Mode Dispatcher:** [`nter-mobile/src/services/index.js`](file:///c:/Users/Afreen/Downloads/niyantran-main%20(2)/niyantran-main/nter-mobile/src/services/index.js#L1-L8)
  ```javascript
  import { DATA_MODE } from '../lib/config.js';
  import * as live from './live.js';
  import * as sample from './sample.js';

  export const api = DATA_MODE === 'sample' ? sample : live;
  export const isSample = DATA_MODE === 'sample';
  ```
- **Sample Service Contract:** [`nter-mobile/src/services/sample.js`](file:///c:/Users/Afreen/Downloads/niyantran-main%20(2)/niyantran-main/nter-mobile/src/services/sample.js#L1-L100)
  - Simulates authentication locally via `nter.sample.session` and `nter.sample.profile` in device KV storage.
  - Loads canned desk data, models, and briefs from bundled static JSON files (`home-latest.json`, `home-markets.json`, `ai-models.json`, `modules-*.json`).
  - Zero HTTP or WebSocket connections to Supabase or NTER servers.
- **Live Service Fallbacks:** In [`nter-mobile/src/services/live.js`](file:///c:/Users/Afreen/Downloads/niyantran-main%20(2)/niyantran-main/nter-mobile/src/services/live.js#L305-L343), when a user is unauthenticated or when public feeds fail, requests gracefully fall back to local sample mocks rather than crashing with unhandled network exceptions.
- **Status:** **PASS**.

---

## 10. End-to-End Dependency Map

```
[Mobile UI: React/Capacitor]
       │
       ▼ (1) supabase.auth.signIn / getSession()
[Supabase Auth (PKCE + @capacitor/preferences)]
       │
       ├─── (2a) User Session JWT
       │
       ▼
[Database & Storage Layer]
  ├── (2b) user_files / user_folders (RLS: SELECT auth.uid())
  └── (2c) Storage Bucket 'user-files' (${userId}/${fileId}/${name})
       │
       ├─── (3a) POST /functions/v1/research-chat (SSE)
       └─── (3b) Background Trigger: x-ingest-secret
       │
       ▼
[Supabase Edge Functions]
  ├── research-chat/index.ts (requireUser auth)
  └── ingest-worker/index.ts (Worker Secret auth)
       │
       ▼ (4) Ingestion Pipeline
[Ingestion Engine (ingest-worker)]
  ├── PDF: Mistral OCR (mistral-ocr-latest)
  ├── Spreadsheet: xlsx/csv extractor
  └── Docx/Txt: paragraph parser
       │
       ▼ (5) Text Chunks (1000 tokens, 200 overlap)
[Embeddings Generation (_shared/embed.ts)]
  └── OpenRouter: openai/text-embedding-3-small (1536 dims)
       │
       ▼ (6) Insert Chunks & Vectors
[Vector Storage]
  └── public.user_file_chunks (vector(1536))
       │
       ▼ (7) Dual-Source Vector Search
[RAG Retrieval (_shared/retrieval.ts)]
  ├── match_documents / match_documents_hybrid (Public Corpus)
  └── match_user_files (Private User Files)
       │
       ▼ (8) Prompt Sandwich Synthesis
[Agent Engine (research-chat/agent.ts)]
  └── System Directives + Citations [1][2] + Bounded History (60k chars)
       │
       ▼ (9) OpenRouter Streaming Chat
[AI Response Delivery]
  ├── Streaming SSE frames (status, trace, delta, done)
  ├── Credit Settlement (settle_turn_credits RPC)
  └── Turn Persistence (chat_messages, conversations)
       │
       ▼
[Mobile UI: ResearchScreen / ChatDrawer]
```

### Hop-by-Hop Verification Details
1. **Mobile UI → Supabase Auth:** Dispatches email/password or OAuth. Obtains session JWT stored in Capacitor Preferences.
2. **Supabase Auth → Database/Storage:** Direct binary upload or signed URL to `user-files/${userId}/${fileId}/${fileName}`. RLS on `storage.objects` and `user_files` guarantees owner separation.
3. **Storage → Edge Functions:** File record created with `index_status = 'indexing_queued'`. `ingest-worker` claims job via `user_file_claim_job` (fair-share concurrency).
4. **Ingestion → Embeddings:** Ingest worker parses file via Mistral OCR or native parser. Calls OpenRouter embeddings API (`openai/text-embedding-3-small`).
5. **Embeddings → Vector Storage:** 1536-dimensional vectors written to `public.user_file_chunks`.
6. **Vector Search → RAG:** When user queries `research-chat` with attached files, `search()` executes `match_user_files` in parallel with public corpus `match_documents`.
7. **RAG → AI Response:** Retrieved chunks formatted with citation markers, injected into prompt sandwich, streamed via SSE to mobile UI, and billed atomically via `settle_turn_credits`.

---

## 11. Classification Scorecard & Deliverable Matrix

| Integration Domain | Target Component | Status | Evidence / Verification |
|---|---|---|---|
| **Client Config** | `nter-mobile/src/lib/config.js` | **PASS** | Validated config defaults, public keys, fallback mechanisms. |
| **Client Config** | `nter-mobile/src/lib/supabaseClient.js` | **PASS** | Verified PKCE flow, Capacitor Preferences storage adapter. |
| **Client Config** | `src/lib/supabaseClient.js` (Web) | **PASS** | Verified singleton browser client, publishable key, helpers. |
| **Auth** | Email / Password Sign-In & Sign-Up | **PASS** | Complete implementation in `live.js`, tested error paths. |
| **Auth** | Password Recovery & Confirmation | **PASS** | Verified reset redirect URLs and resend methods. |
| **Auth** | Google OAuth (Web) | **PASS** | Verified redirect flow to origin. |
| **Auth** | Google OAuth (Native Phone) | **PARTIAL** | Disabled by default via `VITE_GOOGLE_ON_PHONE=0` pending Supabase URL whitelist. |
| **Database RPCs** | Profile, Plan & Credits (`my_credits_cycle_v3`, etc.) | **PASS** | All RPCs verified in `supabase/migrations/`. |
| **Database RPCs** | Trigram Desk Search (`search_desk_rows`) | **PASS** | Verified in `20260921000011` and `20260922073933`. |
| **Database RPCs** | File Quotas (`user_storage_quota_bytes`, etc.) | **PASS** | Verified in `20261115000001_private_file_manager.sql`. |
| **Database RPCs** | File Upload Preparation (`user_file_prepare_upload`) | **PARTIAL** | Web client uses RPC; mobile client uploads directly to storage with client-side checks. |
| **Database RPCs** | File Indexing Enqueue (`user_file_enqueue_indexing`) | **PARTIAL** | Defined in `20261118000001`; client call gated by `IS_INDEXING_BILLING_DEPLOYED = false`. |
| **Database RPCs** | Private Vector Retrieval (`match_user_files`) | **PASS** | Verified in `20261115000001` and `20261121000001`. |
| **Edge Functions**| `research-chat` (Streaming SSE RAG) | **PASS** | Multi-turn streaming, RAG integration, credit billing verified. |
| **Edge Functions**| `ingest-worker` (OCR & Vector Pipeline) | **PASS** | Leased fair-share user file step verified in `user-file-step.ts`. |
| **Edge Functions**| `desk-brief` (Intelligence Briefs) | **PASS** | Verified in `supabase/functions/desk-brief/`. |
| **Storage** | Bucket `user-files` (Private, 50MB Cap) | **PASS** | Verified in migrations and dashboard setup SQL. |
| **Storage** | Storage Object RLS Policies | **PASS** | Strict owner enforcement via `(storage.foldername(name))[1] = (SELECT auth.uid()::text)`. |
| **RLS Policies** | Production Migrations (`supabase/migrations/`) | **PASS** | Verified InitPlan `(SELECT auth.uid())` across all user tables. |
| **RLS Policies** | Local Test Schema (`backend/sql/auth_schema.sql`) | **NOT VERIFIED** | Documented as local test bootstrap fixture only; not live authority. |
| **Secrets & Env** | Variable Prefix Separation (`VITE_` vs Secret) | **PASS** | Zero server secrets prefixed with `VITE_`; no provider keys in client. |
| **Mode Isolation**| Production (`live`) vs Sample (`sample`) | **PASS** | Verified complete offline isolation via `nter-mobile/src/services/index.js`. |

---

## 12. Recommendations for Engineering Next Steps
1. **Enable Native Mobile Google OAuth:** Add `pro.nter.app://auth/callback` to the Supabase Dashboard Redirect URLs list and update `VITE_GOOGLE_ON_PHONE=1` in production build configuration.
2. **Align Mobile Upload with Quota RPC:** Update `nter-mobile/src/services/live.js` (`uploadFile`) to invoke `user_file_prepare_upload` RPC prior to storage binary transmission, matching `src/fileManager/fileManagerService.js`.
3. **Roll Out File Indexing Billing:** When production billing is ready, set `app_flags.file_indexing_billing = true` in Supabase and toggle `IS_INDEXING_BILLING_DEPLOYED = true` in frontend services.
