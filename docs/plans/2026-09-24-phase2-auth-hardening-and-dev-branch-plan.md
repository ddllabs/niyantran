# Phase 2 Implementation Plan: Auth Hardening & Dev-Branch Preparation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden server auth routes, client-side auth gates, durable-write boundaries, and build environments to finalize Phase 2 in preparation for review and push to `dev`.

**Architecture:** Route all auth paths through `server/authApi.mjs` and native Supabase Auth, harden client session lifecycle in `App.jsx`, enforce PostgreSQL system-of-record invariants, and eliminate build-time secret dependencies.

**Tech Stack:** React 18, Vite 5, Supabase Auth JS, Node 24, Vitest.

**Spec:** `docs/specs/2026-09-24-phase2-auth-hardening-and-backend-first-spec.md`

## Global Constraints

- Backend architecture is the authoritative source of truth.
- Supabase PostgreSQL is the sole durable production system of record.
- Google authentication must remain Supabase-native (`signInWithOAuth`).
- No commits or pushes during this phase; all changes remain staged/working in local workspace.
- Preserved directories `backup/` and `public/data/` must not be deleted or modified.

## Review Focus

1. Serverless body parsing: `readBody` in `server/authApi.mjs` must handle both stream chunks and pre-parsed `req.body`.
2. Router route handling: `/api/auth/*` must never 404 on supported endpoints (`signup`, `resend-verification`, `forgot-password`, `reset-password`, `me`, `login`, `logout`, `provider`).
3. Build isolation: `npm run build` must succeed without requiring Supabase or Resend environment secrets in clean developer environments.
4. Client-side reactive auth gating: `App.jsx` must reactively update authentication status when Supabase sessions change or expire.
5. Verification integrity: Full test suite (605 tests) must pass with zero regressions.

---

### Task 1: Auth Route Expansion & Serverless Body Resilience

**Files:**
- Modify: `server/authApi.mjs:25-45,70-130,220-240`
- Test: `api/router.js` import & route invocation

**Interfaces:**
- Consumes: `req.body`, `req.url`, `getSupabaseAnonClient()`
- Produces: JSON response for `/api/auth/reset-password`, `/api/auth/me`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/signup`

- [ ] **Step 1: Update `readBody` in `server/authApi.mjs` to support pre-parsed bodies**
- [ ] **Step 2: Add `/api/auth/reset-password`, `/api/auth/me`, `/api/auth/login`, `/api/auth/logout` handlers in `server/authApi.mjs`**
- [ ] **Step 3: Move `validateEmailProviderStartup()` inside `configureServer` and `configurePreviewServer` so `vite build` does not require credentials**
- [ ] **Step 4: Verify router dynamic import with `node -e "import('./api/router.js').then(()=>console.log('ok'))"`**

---

### Task 2: Client-Side Auth Gate Hardening in `App.jsx`

**Files:**
- Modify: `src/App.jsx:50-80`
- Test: `src/marketing/loginAuthorization.test.js`

**Interfaces:**
- Consumes: `subscribeLocalIdentity` from `src/lib/userStore.js`
- Produces: Reactive `authed` state synchronization in `App.jsx`

- [ ] **Step 1: Subscribe to `subscribeLocalIdentity` in `src/App.jsx` to reactively track Supabase session state**
- [ ] **Step 2: Ensure unauthenticated users fail closed to `MarketingSite` upon token expiry or logout**
- [ ] **Step 3: Run `npm test src/marketing/loginAuthorization.test.js` and `npm test src/lib/userStore.bridge.test.js`**

---

### Task 3: Durable-Write Audit & Documentation Verification

**Files:**
- Audit: `server/writableRoot.mjs`, `server/db.mjs`, `server/usersApi.mjs`, `src/lib/userPrefsSync.js`
- Modify: `docs/flow.md`, `docs/design.md`, `docs/ai-agent.md`, `NTER_BACKEND_FIRST_INTEGRATION_REPORT.md`

**Interfaces:**
- Produces: Documented durable-write boundaries and Phase 2 completion report

- [ ] **Step 1: Verify all durable writes route to Supabase PostgreSQL and all local writes are confirmed ephemeral**
- [ ] **Step 2: Update documentation files (`docs/flow.md`, `docs/design.md`, `docs/ai-agent.md`)**
- [ ] **Step 3: Update `NTER_BACKEND_FIRST_INTEGRATION_REPORT.md` with section 14 "Phase 2 Completion"**

---

### Task 4: Full Verification Gates & Dev-Branch Push Preparation

**Files:**
- Review: Working tree status, git diffs, clean build output

- [ ] **Step 1: Execute `npm run build` and `npm test`**
- [ ] **Step 2: Check `git diff --name-only --diff-filter=U` (must be empty)**
- [ ] **Step 3: Check `git status` (confirm 0 commits, 0 pushes, no untracked secrets)**
- [ ] **Step 4: Formulate final Phase 2 Acceptance Report with exact dev push command**
