# System Architecture and Design

> **Status: Living.** Authoritative architecture and design specifications for Niyantran Terminal.

## 1. Architectural Source of Truth

The backend architecture is the authoritative source of truth. All subsystems, interfaces,
and client-side workflows adhere strictly to the backend contracts. The frontend adapts
to backend contracts and does not establish a competing backend architecture.

---

## 2. Core Subsystems

### Authentication

- **Authoritative System:** **Supabase Auth** is the sole authoritative authentication system.
- **Google OAuth:** Handled entirely through native Supabase Auth (`supabase.auth.signInWithOAuth({ provider: 'google' })`).
- **Elimination of Legacy Custom Auth:** Legacy custom Google authentication (`google-auth-library`, `server/googleAuth.mjs`, and `/api/auth/google`) has been permanently decommissioned and removed from the active execution path.
- **Session Lifecycle:** Client sessions rely on Supabase JWT tokens. Profile data and roles are hydrated from Supabase tables (`public.profiles`, `public.user_preferences`).

### Database & Persistence

- **Authoritative System of Record:** **Supabase PostgreSQL** is the durable system of record.
- **Data Integrity:** Primary enterprise entities, analyst profiles, audit logs, document corpora, and conversation histories reside in PostgreSQL.
- **Local Cache Boundaries:** SQLite, browser `localStorage`, and server `tmp/` directories serve only as ephemeral local scratchpads or caching tiers during offline/development workflows. They must never become the durable production source of truth.
  - `tmp/niyantran.sqlite` (or `/tmp/niyantran/niyantran.sqlite` on serverless): Ephemeral cache for desk briefs and local admin testing fixtures.
  - `desk-briefs/*.json`: Ephemeral local desk brief envelopes.
  - `app-flags.json`: Local development feature flag toggles (e.g., testing mode).
  - `public/data/*.json`: Static read-only snapshot bundles and seed feeds.
  - Client `localStorage`: Ephemeral client working copy for current UI state and offline preferences; automatically synced to/from the server database upon authentication (`userPrefsSync.js`).

### Universal AI Gateway

- **Single Outbound Gateway:** **OpenRouter (`https://openrouter.ai`)** is the single LLM gateway for the platform.
- **Universal Scope:** This applies to all LLM paths across the repository without exception:
  - `server/aiApi.mjs` (Vite dev server AI proxy and `/api/ai/chat`)
  - `server/deskBrief.mjs` (desk entry synthesis and `/api/ai/desk-brief`)
  - Supabase Edge Functions (`supabase/functions/research-chat`, `supabase/functions/refresh-model-pricing`, etc.)
- **No Direct Provider Bypasses:** No direct calls to `generativelanguage.googleapis.com`, `GoogleGenerativeAI`, or other provider endpoints exist in production paths.
- **Credential Safety:** Server-only secret `OPENROUTER_API_KEY` (or `NIYANTRAN_AI_KEY`). Secrets are never exposed to browser bundles or client requests (D6 boundary).

### Retrieval-Augmented Generation (RAG)

- **Vector Architecture:** The existing backend RAG architecture remains authoritative.
- **Embedding Baseline:** `openai/text-embedding-3-small` served via OpenRouter embeddings endpoint (`https://openrouter.ai/api/v1/embeddings`), fixed at 1536 dimensions.
- **Storage & Search:** Document chunks reside in `public.document_chunks`, indexed with pgvector cosine distance (`<=>`).
- **Grounding & Evidence:** Strict grounding mandates evidence-first output, verifiable citation links, and prohibition of speculative claims.

### Frontend Integration

- **Contract Adherence:** The React/Vite frontend workbench consumes backend REST and Edge Function APIs directly without redefining entity schemas.
- **UI Preservation:** Rich analytical desk views, data visualizations, and interactive rails from the upstream UI are preserved while wired to the authoritative Supabase backend contracts.
- **Mock/Hydration Isolation:** Client-side mock fallbacks (`aiDrop`, `aiClient`) exist solely to support testing and isolated dev environments; production requests flow to verified backend routes.

### Deployment Architecture

- **Target Hosting:** The production application is intended for the new DDL Labs Vercel project (`ddllabs/niyantran`).
- **Operational Boundaries:** Deployment operations, Vercel configuration updates, Supabase dashboard changes, and production DNS adjustments are strictly governed by human authorization and are isolated from repository reconciliation tasks.
