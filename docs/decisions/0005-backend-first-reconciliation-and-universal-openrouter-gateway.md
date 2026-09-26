# ADR 0005: Backend-First Reconciliation, Native Supabase OAuth, and Universal OpenRouter Gateway

> **Status:** Normative — accepted 2026-09-24. Binds all backend, frontend, authentication,
> and AI integration work across the repository.

## Status

Accepted.

## Context

Following the divergence between the backend development work (`ddllabs/main`) and the frontend
improvements (`upstream/main`), the codebase contained conflicting paradigms:

1. **Authentication Split:** The backend relied on Supabase Auth for identity and RLS policy enforcement.
   The frontend repository had introduced a parallel custom Google OAuth verification workflow using
   `google-auth-library`, `server/googleAuth.mjs`, and `/api/auth/google`, syncing user state into a local
   SQLite database. This created duplicate user records, bypasses of Supabase Auth RLS policies, and
   unnecessary runtime dependencies.
2. **AI Provider Fragmentation:** ADR 0002 established OpenRouter as the single outbound model gateway
   for chat completions and embeddings. However, upstream development introduced direct calls to
   Google Generative Language API (`generativelanguage.googleapis.com`) inside `server/aiApi.mjs` and
   `server/deskBrief.mjs`, requiring separate `GEMINI_API_KEY` configurations and fragmenting auditability.
3. **Storage Discrepancies:** Ephemeral SQLite databases (`nter.db`) and local files were at risk of being
   treated as durable sources of truth instead of Supabase PostgreSQL.

A technical audit established that the backend architecture is the authoritative foundation. To achieve
a clean, robust production state, all components must reconcile to this backend foundation without
downgrading enterprise reliability.

## Decision

1. **Backend Architecture is the Sole Source of Truth:**
   The backend architecture defines data schemas, security boundaries, and API contracts. The frontend
   adapts to these backend contracts; it does not introduce competing persistence engines or authentication
   mechanisms.

2. **Supabase PostgreSQL is the Durable System of Record:**
   All durable domain state (profiles, entitlements, documents, chunks, conversations, analytics) resides
   in Supabase PostgreSQL. SQLite, browser `localStorage`, and temporary server files exist solely as
   ephemeral caches and local development fallbacks.

3. **Native Supabase Google OAuth:**
   Google authentication is consolidated entirely into native Supabase OAuth (`supabase.auth.signInWithOAuth({ provider: 'google' })`).
   The legacy `google-auth-library`, `server/googleAuth.mjs`, and `/api/auth/google` endpoints are removed
   from the active execution path. All user identity flows issue standard Supabase JWTs.

4. **Universal OpenRouter Gateway Across All LLM Paths:**
   OpenRouter is the exclusive outbound LLM gateway for the entire platform:
   - `server/aiApi.mjs` routes all chat completions through `https://openrouter.ai/api/v1/chat/completions`.
   - `server/deskBrief.mjs` routes all desk brief synthesis through OpenRouter using structured JSON objects.
   - Supabase Edge Functions (`research-chat`, `embed`, `refresh-model-pricing`) continue using OpenRouter.
   - All direct calls to `generativelanguage.googleapis.com`, `GoogleGenerativeAI`, and legacy provider endpoints
     are eliminated.

5. **Upstream UI Preservation with Backend Contract Wiring:**
   Valuable UI/UX contributions from upstream (analytical desks, interactive visualizations, marketing
   components) are retained, but wired strictly to backend APIs, ensuring full functional preservation
   without architectural divergence.

## Consequences

- **Security & Compliance:** Secrets remain server-side (`OPENROUTER_API_KEY`). Eliminating custom OAuth token
  verification removes security surface area and ensures Supabase RLS is enforced uniformly.
- **Maintainability:** A single outbound AI provider drastically simplifies credential management, model
  routing, usage monitoring, and rate-limit handling.
- **Operational Clarity:** Developers and automated agents have one unified system of record (PostgreSQL) and
  one auth provider (Supabase Auth).
