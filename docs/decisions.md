# Architecture Decision Records (ADRs)

> **Status: Living.** Index of durable architectural decisions for Niyantran Terminal.
> Decisions that are expensive to reverse are stored in `docs/decisions/`.

## Registry of Decisions

| ADR | Title | Status | Date | Core Decision |
|---|---|---|---|---|
| [ADR 0001](file:///docs/decisions/0001-supabase-edge-functions-for-the-ai-backend.md) | Supabase Edge Functions for the AI Backend | Normative | 2026-09-20 | Migrated backend execution into Supabase Edge Functions (Deno) running close to PostgreSQL. |
| [ADR 0002](file:///docs/decisions/0002-openrouter-gateway-and-embedding-baseline.md) | OpenRouter Single Model Gateway; Embedding Baseline | Normative | 2026-09-20 | Established OpenRouter as single outbound model gateway. Pinned embedding model to `openai/text-embedding-3-small` at 1536 dimensions. |
| [ADR 0003](file:///docs/decisions/0003-global-corpus-user-scoped-conversations.md) | Global Corpus, User-Scoped Conversations | Normative | 2026-09-21 | Established global shared document corpus across users, while conversations and user sessions are strictly tenant/user-scoped. |
| [ADR 0004](file:///docs/decisions/0004-chunk-identity-and-reconciliation.md) | Chunk Identity and Reconciliation | Normative | 2026-09-21 | Defined content-hashed deterministic chunk identity and chunk-level vector reconciliation rules. |
| [ADR 0005](file:///docs/decisions/0005-backend-first-reconciliation-and-universal-openrouter-gateway.md) | Backend-First Reconciliation, Native Supabase OAuth, and Universal OpenRouter Gateway | Normative | 2026-09-24 | Reconciled divergent codebases: Supabase PostgreSQL is system of record; native Supabase Google OAuth replaces custom auth; OpenRouter is universal LLM gateway across all paths (`aiApi.mjs`, `deskBrief.mjs`, edge functions); legacy Gemini server paths decommissioned. |

---

## Key Decision Guidelines for Contributors

1. **Backend First:** All client interactions adapt to backend contracts. Do not construct competing local data models or auth mechanisms.
2. **Universal OpenRouter Access:** No direct AI provider SDKs or endpoints may be added to browser or server without amending ADR 0002 and ADR 0005.
3. **PostgreSQL System of Record:** Ephemeral SQLite or local file stores are restricted to offline caches only.
