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
| [ADR 0006](file:///docs/decisions/0006-live-tv-carousel-and-api-verification-contracts.md) | Live TV Backend Contract, Segment Carousel Parity, and Non-Fabricated Telemetry | Normative | 2026-09-27 | Activated Live TV with real broadcast schedule/archive/transcript; implemented 8-segment carousel with authoritative counts; enforced sign-in destination preservation and strict anti-fabrication evidence invariants. |
| [ADR 0007](file:///docs/decisions/0007-nter-news-rail-nyai-thinking-and-desk-landing-contracts.md) | NTER.news Live Rail, NyAI Thinking Lifecycle, and Desk Landing Contracts | Normative | 2026-09-27 | Replaced frozen Market Metrics with Live Latest rail; established canonical NyAiThinking animation lifecycle with streaming transition; implemented desk landing pages with live counters, module cards, and real categorical charts. |
| [ADR 0008](file:///docs/decisions/0008-supabase-secret-openrouter-gateway.md) | Universal Supabase Secret OpenRouter Gateway | Normative | 2026-09-27 | Confined OPENROUTER_API_KEY exclusively to Supabase Secrets; designated Supabase Edge runtime as sole secure AI gateway; unified model abstractions under OpenRouter; sanitized legacy Node/Vite fallback paths. |
| [ADR 0009](file:///docs/decisions/0009-live-tv-youtube-source-and-api-integration.md) | Live TV Backend-Driven YouTube Source and API Integration for Vercel | Normative | 2026-09-28 | Elevated Live TV to support curated YouTube channels across 6 categories, server-side YouTube Data API v3 with quota optimization (1 unit playlistItems.list), 10m TTL cache, graceful fallback, video cards grid, and non-fabricated transcript contract. |


---

## Key Decision Guidelines for Contributors

1. **Backend First:** All client interactions adapt to backend contracts. Do not construct competing local data models or auth mechanisms.
2. **Universal OpenRouter Access:** No direct AI provider SDKs or endpoints may be added to browser or server without amending ADR 0002 and ADR 0005.
3. **PostgreSQL System of Record:** Ephemeral SQLite or local file stores are restricted to offline caches only.
