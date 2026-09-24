# Phase 2: Backend & Authentication Hardening Specification

> **Status: Normative.** Specifications governing authentication hardening, router endpoint
> resolution, durable write boundaries, and dev-branch preparation for Niyantran Terminal.

## 1. Context & Objectives

Following the backend-first reconciliation between `ddllabs/main` and `upstream/main`,
Phase 2 hardens the platform's authentication boundaries, retires unneeded legacy user routes,
audits all persistent storage mechanisms against the Supabase PostgreSQL system of record,
and validates the development and build environments without requiring production secrets.

### Core Objectives:
1. **Router Auth Routes Resolution:** Ensure `/api/auth/*` routes (signup, resend-verification, forgot-password, reset-password, me, login, logout, provider) are fully served and never return unhandled 404s.
2. **Retire Unnecessary `/api/users` Invocations:** Confirm that ordinary user flows use Supabase Auth and `public.user_profiles` directly, reserving `/api/users` solely for server-authenticated platform admin operations with strict RLS/Bearer token validation.
3. **Authentication Hardening:** Harden client-side authentication gates in `App.jsx` with direct Supabase Auth session listeners (`subscribeLocalIdentity`), ensuring active profile validation and fail-closed state management.
4. **Durable-Write Audit:** Enforce the invariant that Supabase PostgreSQL is the sole durable production system of record. Verify that SQLite, local files, and server `tmp/` are strictly ephemeral caches.
5. **Build / Environment Validation:** Ensure `npm run build` succeeds cleanly in development and CI environments without requiring production Supabase/Resend secrets, while preserving rigorous validation on server startup.
6. **Dev-Branch Readiness:** Verify all tests, builds, and safety gates without committing or pushing, preparing the branch `integration/reconcile-backend-frontend` for review and push to `dev`.

---

## 2. Technical Requirements

### 2.1 Server-Side Authentication Endpoints (`/api/auth/*`)
- Supported Methods & Paths:
  - `GET /api/auth/provider`: Health check and diagnostic returning active strategy (`SUPABASE_NATIVE` or `RESEND_API`).
  - `POST /api/auth/signup`: Account registration with validation and email verification dispatch.
  - `POST /api/auth/resend-verification`: Rate-limited resend of verification emails (60s cooldown).
  - `POST /api/auth/forgot-password`: Anti-enumeration password recovery dispatch.
  - `POST /api/auth/reset-password`: Server-side password update with recovery token/session.
  - `POST /api/auth/login`: Direct email/password authentication using Supabase Auth.
  - `POST /api/auth/logout`: Revocation of active session.
  - `GET /api/auth/me`: Current user inspection via Bearer token.
- Stream & Serverless Resilience: `readBody` must handle pre-parsed JSON bodies (`req.body`) in serverless environments as well as streaming chunks in Node HTTP servers.

### 2.2 Client-Side Auth Gating
- `src/App.jsx` must synchronize `authed` state directly with `subscribeLocalIdentity` from `userStore.js`.
- Upon initial load, session restoration, or OAuth redirect return, `authed` updates reactively.
- On logout or session expiry, the UI fails closed and unauthenticated users are restricted from protected terminal views.

### 2.3 Durable-Write Boundary
- **Durable Data:** Supabase PostgreSQL (`profiles`, `conversations`, `document_chunks`, `desk_rows`, `models`).
- **Ephemeral Data:**
  - `tmp/niyantran.sqlite` (or `/tmp/niyantran/niyantran.sqlite` on serverless): Local SQLite cache for desk briefs and local admin test users.
  - `desk-briefs/*.json`: Intermediate desk brief cache.
  - `app-flags.json`: Ephemeral local toggle for testing mode.
  - `public/data/*.json`: Static read-only seed feeds and offline snapshots.
- No durable production state may be committed exclusively to local files or SQLite.

### 2.4 Build and Environment Validation
- In `server/authApi.mjs`, defer `validateEmailProviderStartup()` execution to `configureServer` and `configurePreviewServer`.
- `npm run build` bundles frontend code without failing on missing backend secrets.
- Server startup in dev/production validates `SUPABASE_URL` and provider keys before accepting traffic.
