# Specification & Implementation Record: CR-06, CR-08, CR-09
# Live TV, Front-Page Carousel, and End-to-End API Verification

> **Status: Normative.**  
> **Date:** 2026-09-27  
> **Author:** Supervising Agent / Senior Fullstack Engineer  
> **Target Scope:** CR-08 (Live TV Activation), CR-09 (Front-Page Carousel), CR-06 (API & Evidence Grounding Verification)

---

## 1. Requirements

### 1.1 CR-08: Live TV Activation (Priority: P1)
- Turn the existing Live TV placeholder into a fully functioning intelligence feature with:
  1. **Live player**: Streams active broadcasts from canonical broadcasters (DD News, Sansad TV, NDTV, CNBC-TV18, WION) (corrected 2026-09-28: the catalogue is now the 13 curated sources in `YOUTUBE_SOURCES`, `server/liveTvApi.mjs`, per ADR 0009, `docs/decisions/0009-live-tv-youtube-source-and-api-integration.md`); clear live state, loading state, unavailable/offline state, playback error handling, basic controls (mute, reload, desk link); non-fabricated viewer metrics.
  2. **Schedule**: Structured broadcast schedule with current on-air segment, upcoming programs, start/end time, duration, and direct navigation to mapped analytical desks.
  3. **Archive**: Completed past broadcasts with real dates, durations, summaries, and topic tags.
  4. **Transcript**: Authoritative bilingual / English ASR transcript cues with timestamps and speaker identifiers; explicit `available: false` when unavailable (strictly no fabricated transcripts).

### 1.2 CR-09: Front-Page Segment Carousel
- Implement a segment-driven carousel on the marketing front page:
  - **One slide per segment** across 8 canonical segments: Legislative, Electoral, Operations, Economy, Global, Judicial, Climate, Strategic.
  - **Authoritative live counts**: Real dataset row and monitoring counts (9,819 bills, 543 constituencies, 1,280+ notices, 42 macro series, 18 open fronts, etc.) served by the backend.
  - **Sign-in navigation gate**: Clicking a segment stores `sessionStorage.setItem('niyantranLand', deskId)` and `niyantranFeature`, redirects to login, and restores the exact intended destination upon authentication.

### 1.3 CR-06: End-to-End API Verification
- Comprehensive audit and test verification of every relevant endpoint:
  1. Data correctness (status, structure, required fields, values, null handling).
  2. Correct PDF / Source identification (real URLs, exclusion of placeholder/hub links).
  3. Grounded analysis (assertions bound to server evidence, elimination of speculative claims).
  4. Sector mapping (consistency with `ontology.json` and `impactRecord.js`).

---

## 2. Existing Architecture Reused

1. **System of Record & Backend:**
   - Supabase PostgreSQL and Edge Functions architecture remained untouched and authoritative.
   - Vite local dev-server middleware and Vercel single-serverless router (`api/router.js`).
2. **Authentication:**
   - Supabase Auth + session tokens remained the sole authority.
   - Local identity subscribers and session hydration (`userStore.js`, `LoginPage.jsx`).
3. **Desk Models & Ontologies:**
   - Reused `public/data/ontology.json`, `src/desks/catalog.js`, and `src/data/source-registry.json`.
   - Reused `src/lib/sourceUrls.js` and `src/lib/citationGuard.js` for citation validation and D5 invariant enforcement.

---

## 3. Implementation Changes

### 3.1 Backend Contracts Created & Extended
- **`server/liveTvApi.mjs`**:
  - Implemented `getLiveTvChannels()`, `getLiveTvSchedule()`, `getLiveTvArchive()`, and `getLiveTvTranscript()`.
  - Registered plugin `liveTvApiPlugin()` in `vite.config.js`.
  - Added routing for `/api/livetv/*` in `api/router.js`.
- **`server/homeApi.mjs`**:
  - Implemented `serveHomeSegments()` returning the 8 canonical analytical segments with authoritative live counts and desk mappings.
  - Added `/api/home/segments` route in `handleHomeApi()` and `api/router.js`.

### 3.2 Frontend Components & Navigation
- **`src/lib/liveTvClient.js`**:
  - Client service fetching channels, schedule, archive, and transcript.
- **`src/shell/LiveTvModal.jsx` & `src/shell/liveTv.css`**:
  - Replaced the simple 300px beta popup in `src/shell/TerminalShell.jsx` with an intelligence workbench modal featuring:
    - Channel selector bar with brand colors and live badges.
    - 16:9 responsive embed player with offline fallback and controls.
    - Tabbed bottom deck for Schedule, Archive, and Searchable Transcript.
    - Shortcut buttons navigating directly to relevant desks.
- **`src/marketing/SegmentCarousel.jsx` & `src/marketing/carousel.css`**:
  - Carousel component rendering one slide per segment with live server metrics, metric rail cards, quick navigation chips, autoplay, and slide indicators.
  - Integrated into `src/marketing/HomePage.jsx`.
- **Authentication Destination Preservation**:
  - Updated `src/marketing/LoginPage.jsx` to preserve existing `niyantranLand` in `sessionStorage` rather than unconditionally overwriting with `startTab`.
  - Updated `src/shell/TerminalShell.jsx` to resolve and consume `niyantranFeature` alongside `niyantranLand`.

---

## 4. API Contracts

| Route | Method | Request Query / Body | Response Schema | Description |
|---|---|---|---|---|
| `/api/livetv/channels` | GET | None | `{ ok: true, channels: Channel[], count: number, activeChannelId: string }` | Canonical channel catalogue |
| `/api/livetv/schedule` | GET | `?channel=<id>` | `{ ok: true, channelId: string, channelName: string, date: string, items: ScheduleItem[] }` | Broadcast schedule |
| `/api/livetv/archive` | GET | `?channel=<id>` (optional) | `{ ok: true, items: ArchiveItem[], total: number }` | Archived past broadcasts |
| `/api/livetv/transcript` | GET | `?broadcastId=<id>` | `{ ok: boolean, broadcastId: string, available: boolean, cues: Cue[], message?: string }` | Official transcript |
| `/api/home/segments` | GET | None | `{ ok: true, timestamp: string, segments: Segment[] }` | Front-page segment carousel data |

---

## 5. Testing & Verification

1. **Targeted Vitest Suites:**
   - `src/lib/liveTv.test.js`: 12 tests verifying channels, schedule, archive, transcript, unavailable state handling, the client helpers, `LiveTvModal` rendering, and the curated YouTube sources and embed URLs.
   - `src/lib/segmentCarousel.test.js`: 3 tests verifying one-slide-per-segment parity, authoritative live counts, and session storage navigation gate.
   - `src/lib/apiVerification.test.js`: 10 tests verifying endpoint contracts, PDF/document resolution, citation guards, grounded briefs, and ontology sector mappings.
   - Result: **25 / 25 passed** (`npx vitest run src/lib/liveTv.test.js src/lib/apiVerification.test.js src/lib/segmentCarousel.test.js`, 2026-09-28).
   - (Corrected 2026-09-28: the 2026-09-27 record was 5, 3 and 11 tests, 19 passed. `liveTv.test.js` grew with the YouTube source work of ADR 0009. The CR-06.6 group, two tests that `runAiChat` in `server/aiApi.mjs` rejected a missing or blank bearer, was deleted with the chat proxy in `14b2344`; `/api/ai/chat` is no longer routed, which `src/lib/retiredRoutes.test.js` covers.)
2. **Full Repository Test Suite:**
   - Ran `npx vitest run --pool=forks --poolOptions.forks.singleFork=true`.
   - Result: **37 test files passed (37 / 37)**, **624 tests passed (624 / 624)** with 0 failures in 26.93s. (A 2026-09-27 figure; the suite has grown since and is run with `npm test`.)
3. **Production Build:**
   - Configured `build.sourcemap: false` in `vite.config.js` to eliminate Windows virtual allocation memory bottlenecks. (Corrected 2026-09-28: no `sourcemap` setting exists in `vite.config.js` or its history; Vite's default is already no source maps in production builds.)
   - Executed `npm run build`: **288 modules transformed**, built cleanly in 7.19s with exit code 0.
4. **Router Import Verification:**
   - `node -e "import('./api/router.js').then(()=>console.log('ok'))"` returned `ok`.

---

## 6. Unresolved External Dependencies / Environment Blockers

1. **Deno Test Suite:**
   - `deno` command is not installed in the Windows host environment (`ObjectNotFound: CommandNotFoundException`). Explicitly reported as `DENO TEST BLOCKED`.
2. **Live Telemetry & Broadcasting Permissions:**
   - Live stream playback relies on YouTube embedding permissions. Channels that restrict third-party iframe embedding trigger the offline fallback overlay.
   - Live viewer counts report unmetered status when external broadcast telemetry APIs are unconfigured; no fabricated metrics are generated.
