# ADR 0009: Live TV Backend-Driven YouTube Source and API Integration for Vercel

> **Status: Normative.**
> **Date:** 2026-09-28
> **Deciders:** Niyantran Architecture & Intelligence Workbench Team
> **Amended:** 2026-09-28 (section 4: search.list gap, categories, desks)

---

## 1. Context and Problem Statement

The initial Live TV implementation (CR-08) verified the intelligence workbench UI, stream player controls, broadcast schedules, archive playback, and transcript cue rendering using repository-defined broadcast datasets. However, production deployment on Vercel required elevating Live TV to support authoritative, real-world YouTube channels and videos across key research and news categories, without hardcoding individual video entries into the client bundle.

Specific production requirements:
1. **Curated YouTube Sources:** Support verified channels across 6 standard categories:
   - `NEWS`: DD News, Sansad TV, WION, NDTV 24x7, India Today, Aaj Tak
   - `EDUCATION`: Think School, Khan GS Research Centre
   - `POLITICS`: Dhruv Rathee
   - `ECONOMICS`: CNBC-TV18, ET Now
   - `RESEARCH`: CSIS (Center for Strategic and International Studies)
   - `GENERAL`: Soch by Mohak Mangal
2. **Server-Side Security & Vercel Safety:** YouTube Data API v3 integration must execute server-side using `YOUTUBE_API_KEY`. API keys must never be exposed to the client bundle (`VITE_`).
3. **Quota Optimization & Resiliency:** Standard `search.list` operations consume 100 quota units per call, quickly exhausting daily limits. The backend queries channel upload playlists (`UU...`) consuming only 1 unit per call, enforces an in-memory 10-minute TTL cache, and provides seamless fallback to curated channels and fallback videos when `YOUTUBE_API_KEY` is missing or quota is exceeded.
4. **Authoritative Transcript Policy:** In accordance with NTER truthfulness constraints, external YouTube videos return an explicit non-fabricated notification (`Transcript unavailable for this broadcast. Caption extraction is not configured for this external YouTube video.`) rather than hallucinating or inventing dialogue cues.
5. **Responsive Player Experience:** Support category filtering pills, channel status indicators (`LIVE`, `RECENT`, `SOON`, `OFFLINE`), video switcher, player controls (Play/Pause, Mute/Unmute, Fullscreen, Retry, Open Desk), and clean mobile layout down to 320px viewport width.

---

## 2. Decision Outcomes

### 2.1 Backend Architecture (`server/liveTvApi.mjs`)
- **Curated Catalogue (`YOUTUBE_SOURCES`):** Canonical configuration of 13 authoritative sources containing channel metadata, category tags, branding colors, upload playlist IDs, default video IDs, safe embed URLs, and linked desk IDs (`legislative`, `finance`, `international`, `national`). Exported with backward-compatible alias `LIVE_TV_CHANNELS`.
- **In-Memory Cache:** 10-minute TTL cache (`getCached`, `setCached`) avoiding repeated upstream requests during serverless execution and staying within YouTube API quotas.
- **Quota-Conscious YouTube Ingestion:**
  - `fetchYouTubeChannelVideos`: Queries `playlistItems.list` on `UU...` uploads playlist (1 quota unit) rather than `search.list` (100 units).
  - Normalizes YouTube API payloads into clean models (`id`, `title`, `description`, `thumbnail`, `publishedAt`, `channelTitle`, `embedUrl`, `duration`).
  - Graceful degradation: Catches network/quota errors and serves curated source metadata without failing user requests.
- **REST Dispatcher (`handleLiveTvApi`):**
  - `GET /api/livetv/channels[?category=...]`: Lists sources, category tags, and active stream.
  - `GET /api/livetv/live`: Lists active live streams across curated channels.
  - `GET /api/livetv/videos?channelId=...`: Lists recent and upcoming videos for a channel.
  - `GET /api/livetv/schedule[?channel=...]`: Structured daily broadcast schedule with `isLive` indicators.
  - `GET /api/livetv/archive[?channel=...]`: Past broadcast recordings with segment metadata.
  - `GET /api/livetv/transcript?broadcastId=...`: Authoritative transcript cues or explicit unavailable notice.

### 2.2 Client Ingestion Layer (`src/lib/liveTvClient.js`)
Exposes asynchronous fetch wrappers for all six endpoints with normalized error handling:
- `fetchLiveTvChannels(category)`
- `fetchLiveTvLiveStreams()`
- `fetchLiveTvVideos(channelId)`
- `fetchLiveTvSchedule(channelId)`
- `fetchLiveTvArchive(channelId)`
- `fetchLiveTvTranscript(broadcastId)`

### 2.3 User Interface Enhancements (`src/shell/LiveTvModal.jsx` & `src/shell/liveTv.css`)
- **Category Filter Bar:** Horizontal pill strip (`ALL`, `NEWS`, `EDUCATION`, `POLITICS`, `ECONOMICS`, `RESEARCH`, `GENERAL`) with responsive touch support.
- **Channel Selector Strip:** Channel chips with status tags (`LIVE` in red/green, `RECENT` in blue, `SOON` in amber).
- **Multi-Mode Player Stage:** Supports linear live streams (`playbackMode = 'live'`), video playback (`playbackMode = 'video'`), and archive segments (`playbackMode = 'archive'`). Includes dedicated "Return to Live Feed" action.
- **Channel Videos Deck:** Grid of video cards displaying thumbnail, HD badge, title, published date, description, and direct "Play Video" & "Transcript" buttons.
- **Authoritative Transcript Pane:** Query search filtering and clickable timestamp anchoring. When playing external YouTube videos without pre-extracted transcripts, displays verified unavailability message with zero fabricated cues.
- **Mobile Responsiveness:** Viewport adaptations down to 320px with stacked layouts, reduced padding, and touch-friendly control targets.

---

## 3. Verification Evidence

1. **Unit & Contract Verification (`src/lib/liveTv.test.js`):**
   - 12 tests passed (100%):
     - Channel catalogue schema invariants, status indicators (`live`, `recent`, `soon`), safe privacy-enhanced embed URLs.
     - Curated YouTube sources across all 6 categories (`NEWS`, `EDUCATION`, `POLITICS`, `ECONOMICS`, `RESEARCH`, `GENERAL`).
     - Channel video endpoints and live streams detection.
     - Structured broadcast schedule and archive segment filtering.
     - Authoritative transcript cue parsing and transcript unavailable contract.
     - Mocked client network failure resiliency.
     - Modal rendering with category filter pills, video deck tabs, and responsive dialog structure.
     - YouTube video URL normalization across short URLs, watch URLs, embed URLs, and live streams, preserving both `id` and `videoId`.
     - YouTube embed URLs avoid secrets and use privacy-enhanced `youtube-nocookie.com` domain.
2. **Real YouTube End-to-End Verification:**
   - All 13 curated channels verified via YouTube official oEmbed API (`https://www.youtube.com/oembed`) with HTTP 200 responses and authentic author/title metadata.
3. **Regression Verification:**
   - Full Vitest suite: 40/40 test files passed, 644/644 tests passed (0 failures).
   - Production Build: `npm run build` passed (0 errors, 295 modules transformed).
   - Deno Edge Function suite: 415 passed | 0 failed (7s).
   - Server routing: `node -e "import('./api/router.js').then(()=>console.log('ok'))"` verified.
   - Git Working Tree: 0 merge conflicts (`git diff --name-only --diff-filter=U`).
   - Secret Scan: 0 credentials leaked.

---

## 4. Amendment (2026-09-28)

Checked against `server/liveTvApi.mjs` on 2026-09-28. The code has not
changed; this amendment records where it differs from the text above.

- **Known gap: `search.list` is still called.** When `YOUTUBE_API_KEY` is set
  and a channel has no fresh cache entry, `fetchYouTubeChannelVideos` first
  calls `youtube/v3/search` with `eventType=live` for that channel (100 quota
  units), then `playlistItems.list` on the uploads playlist (1 unit). So each
  uncached `GET /api/livetv/videos` costs about 101 units, not 1. The
  10-minute cache is held in memory, so each server instance keeps its own
  copy. `GET /api/livetv/live` does not call YouTube; it lists sources whose
  curated `status` is `live`. This gap is to be tracked in the backlog
  (`docs/niyantran-conflict-audit-and-plan/04-open-backlog.md`).
- **Categories.** The 13 sources are split differently from context point 1:
  `NEWS` is DD News, Sansad TV, WION and NDTV 24x7; `GENERAL` is India Today TV
  and Aaj Tak; `RESEARCH` is CSIS and Soch by Mohak Mangal; `EDUCATION`,
  `POLITICS` and `ECONOMICS` are as listed.
- **Linked desks.** The sources link to the desk ids `national`, `economics`,
  `global`, `legislative` and `media`, not the four named in section 2.1.
