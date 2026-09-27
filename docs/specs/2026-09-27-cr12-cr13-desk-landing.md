# Implementation Specification: CR-12, CR-13, and Desk Landing

> **Status: Normative.**
> **Date:** 2026-09-27
> **Scope:** NTER.news Live Latest Rail on Home Page (CR-12), NyAI Thinking Animation (CR-13), Desk Landing Pages Architecture.

---

## 1. Executive Summary

This specification records the implementation of three core capability extensions to Niyantran Terminal:
1. **CR-12 — NTER.news on Home Page**: Replacing static/frozen Market Metrics from primary position with a live, data-driven Latest Rail consuming verified backend news contracts, accompanied by public landing page beautification.
2. **CR-13 — NyAI Thinking Animation**: Implementing an accessible, polished `NyAiThinking` component integrated into the research chat and turn execution lifecycle, providing smooth transitions into streaming markdown and guaranteed unmounting on cancel, error, or completion.
3. **Desk Landing Pages Architecture**: Transforming textual desk guides into data-driven landing views equipped with verified live counters, capability module cards, and one real categorical chart derived from backend row data, structured to receive final visual styling once the external mockup is delivered.

---

## 2. CR-12 — NTER.news on Home Page & Landing Page Beautification

### 2.1 Backend Contract & Data Flow
- **Authoritative Endpoint:** `GET /api/home/latest` (served by `serveNterLatest()` in `server/nterNews.mjs`).
- **Webhook Ingest:** `POST /api/news/ingest` guarded by bearer token `NTER_TERMINAL_API_KEY`.
- **Payload Shape:**
  ```json
  {
    "ok": true,
    "rows": [
      {
        "id": "string",
        "article_id": "string",
        "title": "string",
        "link": "https://nter.news/...",
        "pub": "ISO-8601",
        "updated_at": "ISO-8601",
        "img": "https://nter.news/assets/...",
        "src": "string",
        "dek": "string",
        "category": "string",
        "tags": [],
        "ago": "string"
      }
    ],
    "note": "Latest from nter.news.",
    "source": "nter.news",
    "updated": "ISO-8601",
    "ageH": 0.4,
    "waiting": false,
    "archive": false
  }
  ```
- **Offline / Static Fallback:** When running offline or without local API server, `fetchNterLatest()` in `src/lib/nterNewsClient.js` falls back to `public/data/nter-news.json` seeded via `homeLatestFromStatic()`.
- **Zero Fake Data:** No fake headlines or randomized counters are created; empty states cleanly indicate waiting for ingest when rows are absent.

### 2.2 Reusable Rail Component (`src/marketing/NterLatestRail.jsx`)
- Mounted prominently on `src/marketing/HomePage.jsx` directly beneath the intelligence preview / segment carousel.
- Displays live pulse dot badge (`● Live Latest`), last updated age indicator, external link to `nter.news`, and a responsive card grid.
- Each card displays headline, summary excerpt (`dek`), category tag, source attribution, relative timestamp (`ago`), and responsive thumbnail image with graceful error fallback.
- Equipped with loading skeleton states, waiting/empty states, and error retry triggers.
- Automatically polls in the background every 60 seconds when the document is visible.

### 2.3 Terminal HomeDesk Integration (`src/desks/HomeDesk.jsx`)
- Previously, the frozen/delayed `MARKETS` quotes table occupied the top of the sidebar `.nh-rail`.
- The top of `.nh-rail` is now occupied by `LIVE LATEST` consuming live `nter.news` developments, repositioning delayed markets secondary as snapshot quotes.

---

## 3. CR-13 — NyAI Thinking Animation

### 3.1 Component Architecture (`src/ai/NyAiThinking.jsx`)
- **Visual Presentation:**
  - Faceted neural diamond icon (`[NyAI icon]`) rendered with the Niyantran brand gradient (`#012ea1` navy to `#38bdf8` cyan to `#f43f5e` red).
  - Primary status text: `"NyAI is thinking"` (or `"NyAI विचार कर रहा है"` in Hindi).
  - Subtle animated processing indicator: shimmering multi-bar neural wave (`.nyai-thinking-wave`) and bouncing cadence dots.
- **Accessibility:**
  - Semantic `role="status"` and `aria-live="polite"`.
  - Full `@media (prefers-reduced-motion: reduce)` support: disables rotation, wave shimmering, and dot bounces in favor of a clean static presentation.

### 3.2 Lifecycle & State Transitions
- **Trigger:** Mounts inside `AiPanel.jsx` when `research.submitting || stream?.isPending || streaming` while `!stream?.streamingText`. Also renders in local chat during `busy`.
- **Handoff:** The instant token chunks arrive and `stream.streamingText` is populated, `NyAiThinking` unmounts seamlessly and `<AiMarkdown text={stream.streamingText} streaming={true} />` takes over the visual field.
- **Cleanup:** On completion, error (`stream.error`), abort (`research.cancelRequested`), or view teardown, `NyAiThinking` unmounts immediately. No orphaned thinking indicators remain.

---

## 4. Desk Landing Pages Architecture

### 4.1 Current State Audit

| Desk Route | Tier (`catalog.js`) | Flagship Register / Feature | Primary Categorical Metric | Sources |
|---|---|---|---|---|
| `national` | `national` | Bill Passage Probability Index | `status` (Stage) | Lok Sabha, Rajya Sabha |
| `global` | `geopolitics` | Open Fronts | `theatre` (Region) | GDELT, Verified Hotspots |
| `economics`| `finance` | NSE/BSE Delayed Market Feed | `sector` | NSE/BSE delayed feed |
| `state` | `state` | Booth-level Results Database | `party` / `alliance` | State Election Commissions |
| `law` | `judiciary` | Supreme Court Order Feed | `bench` / `topic` | Supreme Court of India |
| `carbon` | `climate` | Global Carbon Pricing Tracker | `system` | Carbon Registries |
| `sports` | `sports` | Sports Governance & Policy | `discipline` | Sports Federations |
| `entertainment`| `entertainment`| Box Office Tracker | `language` | Industry Registries |

### 4.2 Data-Driven Components (`src/desks/DeskLandingView.jsx`)
- **Live Counters Strip:**
  - `Verified Records`: Exact count of rows loaded from the primary register (`data.rows.length`).
  - `Distinct Sectors/Stages`: Real distinct classifications identified across the dataset.
  - `Primary Sources`: Count of distinct source URLs/publishers verified on record.
  - `Active Modules`: Count of active capability tools configured for the desk in `catalog.js`.
- **One Real Chart:**
  - Categorical distribution rendered via native `BarList` with SVG track fills.
  - Uses actual row frequencies (e.g. Bill Status, Geopolitical Theatre, or Economic Sector).
  - Explicit title, axis/count displays, source attribution notes, loading state, and empty/error guards.
  - Zero synthetic values or randomized math.
- **Module Capability Cards:**
  - Replaces text lists with modular cards showing feature title, purpose blurb, capability tag, and direct "Launch Module →" action invoking `onFeature(name)`.

### 4.3 Mockup Synchronization Protocol
- Per task specification, a visual mockup will be provided separately.
- The underlying architecture, data contracts, state management, and semantic DOM structure are fully implemented in `DeskLandingView.jsx` and `deskLanding.css`.
- When the mockup is supplied, visual styling, spacing tokens, and color accents can be mapped directly onto the existing component slots without architectural churn.

---

## 5. Verification & Tests

### 5.1 Automated Suites
- `src/lib/nterNewsRail.test.js`: Verifies data retrieval, contract validation, and `NterLatestRail` rendering.
- `src/lib/nyAiThinking.test.js`: Verifies `NyAiThinking` accessibility, localization, model subtext, and DOM indicators.
- `src/ai/AiPanel.test.jsx`: Verifies thinking animation during live inflight turn and smooth transition to streaming text.
- `src/lib/deskLanding.test.js`: Verifies live counter computations, module capability cards, and real chart generation.

### 5.2 Build & Engine Gates
- Production bundle verification via `npm run build` (PASSED: built in 7.72s, zero errors).
- Vitest suite run via `npm test` (PASSED: 40 test files passed, 637 tests passed).
- Deno test status: `DENO TEST BLOCKED` (runtime not installed in environment).

---

## 6. Known External Dependencies & Blockers

1. **Desk Landing Visual Mockup:**
   - Architecture, data models, and reactive components are complete.
   - Exact aesthetic alignment awaits user-provided design mockup.
2. **NTER Ingest Webhooks:**
   - Webhook ingest requires valid `NTER_TERMINAL_API_KEY` configuration on deployment hosts; local/test runs reliably consume seeded registers.
3. **OpenRouter AI Key:**
   - Real LLM streaming requires `OPENROUTER_API_KEY` in server environment (`.env`). When missing, server cleanly responds with HTTP 400 (`OPENROUTER_API_KEY missing on the server`), and `AiPanel` cleanly renders the error state without faking data or displaying orphaned thinking states.

