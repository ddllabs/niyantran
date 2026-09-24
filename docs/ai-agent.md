# AI Agent Operating Instructions & Architecture Invariants

> **Status: Normative.** Binding operational instructions for AI coding assistants
> and human engineers contributing to the Niyantran Terminal repository.

## 1. Architectural Invariants

Every coding agent working on this codebase must adhere to these eight non-negotiable rules:

1. **Backend Architecture is Authoritative:**
   The backend architecture (`ddllabs/niyantran` main) is the definitive source of truth for the platform.
   Client code must conform to existing backend contracts, interfaces, and database schemas. Never simplify,
   downgrade, or displace backend implementations to accommodate client-side deviations.

2. **Do Not Introduce SQLite as Durable Production Storage:**
   Supabase PostgreSQL is the sole durable system of record. SQLite (`nter.db`, `db.mjs`), browser
   `localStorage`, and temporary server files (`tmp/`) are strictly ephemeral local scratchpads or caching
   layers. Never build production persistence on SQLite or local files.

3. **Do Not Introduce Custom Google Authentication:**
   Google sign-in and account registration must use native Supabase Auth:
   ```javascript
   supabase.auth.signInWithOAuth({
     provider: 'google',
     options: { redirectTo: ... }
   })
   ```
   Do not introduce custom OAuth backend proxies, `google-auth-library`, custom token verifiers, or
   endpoints such as `/api/auth/google`. All user identity must result in a valid Supabase JWT session.

4. **Do Not Introduce Direct Gemini or Other Provider Calls:**
   Direct outbound calls from either the client or the server to `generativelanguage.googleapis.com`,
   GoogleGenerativeAI SDK, or any other direct LLM provider are prohibited in active production paths.

5. **All LLM Calls Must Go Through OpenRouter:**
   OpenRouter (`https://openrouter.ai`) is the single universal model gateway across the entire platform.
   This applies equally to:
   - Server-side Node APIs (`server/aiApi.mjs`)
   - Desk Brief synthesis (`server/deskBrief.mjs`)
   - Supabase Edge Functions (`supabase/functions/research-chat`, `supabase/functions/refresh-model-pricing`, etc.)
   Outbound requests must use `OPENROUTER_API_KEY` (or `NIYANTRAN_AI_KEY`). Never expose API keys to the browser.

6. **Frontend Changes Must Follow Backend Contracts:**
   Frontend modifications must consume existing backend API and Edge Function contracts. Do not construct
   divergent or competing backend schemas.

7. **Documentation Synchronization is Mandatory:**
   Before introducing or changing any architectural boundary, update the relevant architectural documentation
   in `docs/` (`docs/design.md`, `docs/flow.md`, `docs/decisions/`).

8. **Preserve Established Decisions in Future Integrations:**
   Future git merges, upstream rebases, or integration tasks must strictly preserve the established decisions
   documented in ADR 0001 through ADR 0005.

---

## 2. Verification Checklist for AI Agents

Before declaring any task complete or proposing integration, an agent must execute and provide
concrete evidence for the following gates:

- [ ] `node -e "import('./api/router.js').then(()=>console.log('ok'))"` prints `ok`.
- [ ] `/api/auth/*` routes (signup, resend-verification, forgot-password, reset-password, me, login, logout, provider) route cleanly through server/authApi.mjs.
- [ ] Client authentication gating in `App.jsx` reactively synchronizes with `subscribeLocalIdentity`.
- [ ] `npm run build` succeeds without requiring production secrets in development environments.
- [ ] No active production references to `google-auth-library` or `server/googleAuth.mjs`.
- [ ] No direct API calls to `generativelanguage.googleapis.com` or `GoogleGenerativeAI`.
- [ ] Zero unmerged Git conflicts (`git diff --name-only --diff-filter=U` returns empty).
- [ ] `npm ci` executes cleanly.
- [ ] `npm run build` succeeds with zero errors.
- [ ] `npm test` passes all tests.
- [ ] Durable data files in `backup/` and `public/data/` are protected and unmodified.
- [ ] No unexpected commits or remote pushes.
