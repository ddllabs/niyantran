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
- **Session Lifecycle:** Client sessions rely on Supabase JWT tokens. Profile data and roles are hydrated from `public.user_profiles` (via the `get_my_profile` RPC; `user_profiles.user_id` references `auth.users`). There is no `public.profiles` or `public.user_preferences` table (verified against the live schema 2026-09-28); preferences are currently stored by `/api/user-prefs` in SQLite (see below).

### Database & Persistence

- **Authoritative System of Record:** **Supabase PostgreSQL** is the durable system of record.
- **Data Integrity:** Primary enterprise entities, analyst profiles, audit logs, document corpora, and conversation histories reside in PostgreSQL.
- **Local Cache Boundaries (the rule):** SQLite, browser `localStorage`, and server `tmp/` directories may serve only as ephemeral local scratchpads or caching tiers. They must never become the durable production source of truth.
- **Current state (corrected 2026-09-28, by reading the code at `ca73200`): the rule is not yet met.** `api/router.js` serves these handlers on Vercel, where `writablePath()` resolves to `/tmp/niyantran` and is lost on cold starts and between instances:
  - `tmp/niyantran.sqlite` (`server/db.mjs`) holds five tables: `users` (`/api/users`), `analytics_events` (`/api/analytics/*`), `user_prefs` (`/api/user-prefs`), `invoices` (`/api/billing/*`) and `entry_briefs` (desk-brief cache). Only `entry_briefs` is a cache; the other four are durable data.
  - `issued-users.json` (`/api/users`), `app-flags.json` (`/api/app-flags`), `nter-news.json` (`/api/news/ingest`), `marketing-intro-video.json` plus the uploaded video (`/api/marketing/intro-video`): durable data written to files.
  - `desk-briefs/*.json` and the Budget STAT-1 cache (`server/budgetStat1.mjs`): caches, safe to lose.
  - The plan that closes the gap is `docs/specs/2026-09-28-serverless-state-to-supabase.md`.
- **Read-only and client-side stores:**
  - `public/data/*.json`: Static read-only snapshot bundles and seed feeds.
  - Client `localStorage`: client working copy for UI state and offline preferences; synced through `/api/user-prefs` after sign-in (`userPrefsSync.js`), which today means the SQLite store above.

### Universal AI Gateway (Supabase Edge Secret Boundary)

- **Single Outbound Gateway:** **OpenRouter (`https://openrouter.ai`)** is the single LLM gateway for the platform.
- **Supabase Secret Boundary:** The provider credential `OPENROUTER_API_KEY` is held **exclusively in Supabase Secrets**. It is never stored in `.env`, `.env.local`, Vercel environment variables, browser bundles, client requests, or local state.
- **Secure Edge Architecture:** All production AI operations are executed through authenticated Supabase Edge Functions (`research-chat`, `desk-brief`, `embed.ts`).
- **No Direct Provider Bypasses:** No direct calls to `generativelanguage.googleapis.com`, `GoogleGenerativeAI`, `api.deepseek.com`, or other provider endpoints exist in production paths. Model names such as `google/gemini-...` and `openai/...` are canonical OpenRouter model identifiers routed via OpenRouter.
- **Credential Safety & Error Invariant:** If the Edge service is unreachable, interfaces report that the service is temporarily unavailable without exposing infrastructure keys or instructing users to configure local secrets.


### Retrieval-Augmented Generation (RAG)

- **Vector Architecture:** The existing backend RAG architecture remains authoritative.
- **Embedding Baseline:** `openai/text-embedding-3-small` served via OpenRouter embeddings endpoint (`https://openrouter.ai/api/v1/embeddings`), fixed at 1536 dimensions.
- **Storage & Search:** Document chunks reside in `public.document_chunks`, indexed with pgvector cosine distance (`<=>`).
- **Grounding & Evidence:** Strict grounding mandates evidence-first output, verifiable citation links, and prohibition of speculative claims.

### Frontend Integration

- **Contract Adherence:** The React/Vite frontend workbench consumes backend REST and Edge Function APIs directly without redefining entity schemas.
- **UI Preservation:** Rich analytical desk views, data visualizations, and interactive rails from the upstream UI are preserved while wired to the authoritative Supabase backend contracts.
- **Mock/Hydration Isolation:** Client-side mock fallbacks (`aiDrop`, `aiClient`) exist solely to support testing and isolated dev environments; production requests flow to verified backend routes.

### Live TV Intelligence Subsystem (CR-08 & ADR 0009 Production Integration)

- **Curated YouTube Sources:** Server-side configuration (`server/liveTvApi.mjs`) supports 13 curated channels across 6 standard categories:
  - `NEWS`: DD News, Sansad TV, WION, NDTV 24x7, India Today, Aaj Tak
  - `EDUCATION`: Think School, Khan GS Research Centre
  - `POLITICS`: Dhruv Rathee
  - `ECONOMICS`: CNBC-TV18, ET Now
  - `RESEARCH`: CSIS (Center for Strategic and International Studies)
  - `GENERAL`: Soch by Mohak Mangal
- **Server-Side API Security & Quota Optimization:** Connects to YouTube Data API v3 using server-side `YOUTUBE_API_KEY` (never exposed via `VITE_` variables). Queries upload playlists (`UU...`) for 1 quota unit instead of `search.list` (100 units). Enforces an in-memory 10-minute TTL cache and provides graceful fallback to curated channel data and fallback videos when the API key is missing or quota is exhausted.
- **Prohibition of Fabricated Telemetry:** Live viewer counts reflect authoritative server-side metrics; when metrics are unmetered or unconfigured, the system reports `null` or "Telemetry source: unmetered stream" rather than generating random or hardcoded figures.
- **Multi-Mode Player & Video Deck:** Supports live feed, channel videos grid, and archived broadcasts. Features category filtering pills (`ALL`, `NEWS`, `EDUCATION`, `POLITICS`, `ECONOMICS`, `RESEARCH`, `GENERAL`), status chips (`LIVE`, `RECENT`, `SOON`, `OFFLINE`), video switcher, player controls, and desk routing.
- **Transcript Provenance:** Transcripts load from verified official records. When viewing external YouTube videos or unavailable broadcasts, the UI renders an explicit non-fabricated message ("Transcript unavailable for this broadcast. Caption extraction is not configured for this external YouTube video.") and strictly prohibits generating simulated dialogue or fictitious speaker text.

### Front-Page Segment Carousel & Navigation Gate (CR-09)

- **Segment Parity:** Exactly one slide per analytical segment (8 canonical segments: Legislative, Electoral, Operations, Economy, Global, Judicial, Climate, Strategic).
- **Authoritative Segment Metrics:** Live counts reflect durable database records (e.g. 9,819 bills, 543 constituencies, 1,280+ notices, 42 macro series, 18 open fronts) served by `/api/home/segments`.
- **Destination Preservation:** Unauthenticated interactions with segment cards set `sessionStorage.getItem('niyantranLand')` and `niyantranFeature`. Post-login authentication preserves this destination, bypassing default landing tabs to honor user intent.

### API Grounding and Evidence Verification (CR-06)

- **Evidence Invariant:** All API responses and analytical outputs must be tied to verified document chunks, desk rows, or canonical snapshots.
- **Citation Guard (D5):** Non-verifiable URLs, javascript schemes, or placeholder citations (`PRID=placeholder`) are rejected by `citationGuard.js`.
- **Sector Mapping Consistency:** Sector taxonomies must align with `public/data/ontology.json` and canonical desk configurations in `impactRecord.js`.

### NTER.news Live Rail & Landing Experience (CR-12)

- **Authoritative News Path:** Ingests live news pushes via `POST /api/news/ingest` and serves current intelligence via `GET /api/home/latest` (`serveNterLatest()`).
- **Replacement of Frozen Market Metrics:** Frozen/delayed Market Metrics is decommissioned from primary position on the landing page and internal Home desk rail, replaced by the live Latest rail (`NterLatestRail.jsx`).
- **Data Invariant:** No synthetic headlines, fabricated dates, or generated live counts. When live ingests have not occurred, the interface explicitly signals "waiting for ingest" from fallback seeds.
- **Visual Design Standard:** Public landing page features polished dark-mode aesthetics, responsive card grids, strong typography contrast, and high-visibility CTAs into research desks.

### NyAI Thinking Component & State Engine (CR-13)

- **Dedicated Visual Indicator:** Canonical component (`NyAiThinking.jsx`) renders a branded neural diamond mark, localized status text ("NyAI is thinking"), and a pulsating wave shimmer.
- **Accessibility Invariant:** Implements `role="status"`, `aria-live="polite"`, and `@media (prefers-reduced-motion: reduce)` compliance.
- **Clean State Transitions:** Mounts when request is inflight/pending prior to the arrival of first stream tokens; transitions seamlessly into streaming markdown as soon as tokens arrive; guaranteed cleanup upon completion, cancel, or network error.

### Desk Landing Pages Architecture

- **Data-Driven Dashboard Model:** Replaces instructional text walls in `guideMode` with `DeskLandingView.jsx`.
- **Live Institutional Counters:** Computes live metrics directly from backend records: verified records on file, distinct classifications, institutional publishers, and active module tools.
- **One Real Chart Invariant:** Every desk landing features one real categorical chart derived from actual record distributions (e.g. Bill stage, Geopolitical theatre, Economic sector). No decorative or randomized mock curves.
- **Capability Cards:** Interactive module cards derived from `catalog.js` buckets with direct routing to active analytical features.
- **Mockup Synchronization:** Component hierarchy is prepared to accept visual mockup styling without architectural alteration.

### Mobile & Responsive System Design (CR-05 / CR-08 / CR-09 / CR-12 / CR-13)

- **Mobile Viewport Targets:** 320×568 (iPhone SE 1st gen / narrow devices), 375×667 (iPhone SE 2nd/3rd gen), 390×844 (iPhone 12/13/14), 412×915 (Android flagship standard).
- **Responsive Invariants:**
  - Zero horizontal overflow (`overflow-x: hidden` / flex wrapping across all cards and grids).
  - Desk Landing: Grid collapse to single column at `<=480px`, counter grid collapses to 2 columns with reduced padding at `<=360px`, chart container scales responsively.
  - Front-Page Carousel: Slide reflows into single column at `<=768px`, navigation tabs wrap cleanly without horizontal scroll at `<=360px`.
  - Live TV: Modal expands to full viewport width/height (`100vw`, `100vh`) on mobile (`<=768px`) with 0 border-radius; player stage adapts fluidly; transcript search expands to 100% width; transcript cues stack timestamp and speaker above text without fixed-width clipping on 320px screens.
  - NTER.news Rail: Cards reflow to 1 column at `<=480px`, header wraps flex items cleanly, brand metadata remains accessible.

### Deployment Architecture

- **Target Hosting:** The production application is deployed on Vercel (`ddllabs/niyantran` / `niyantran-six.vercel.app`).
- **Consolidated Serverless Gateway:** `api/router.js` acts as the single entrypoint for all `/api/*` requests on Vercel (respecting Hobby function limits). All backend services (`marketingMediaApi`, `analyticsApi`, `userPrefsApi`, `billingApi`, `liveTvApi`, `transitApi`, `diplomacyApi`, `assetsApi`, `authApi`, `usersApi`, `aiApi`) are mapped and served without duplicate routes or 404s.
- **AI Gateway & OpenRouter Security:** `OPENROUTER_API_KEY` is maintained server-side in Supabase Secrets for Edge Functions (`research-chat`, `desk-brief`, `embed.ts`). `server/aiApi.mjs` proxies requests to the Supabase Edge Function with required `turn_key`, session JWT bearer, and `apikey`. Zero AI secrets exist in the client bundle.
- **Operational Boundaries:** Deployment operations, Vercel configuration updates, Supabase dashboard changes, and production DNS adjustments are strictly governed by human authorization and are isolated from repository reconciliation tasks.


