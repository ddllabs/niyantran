# ADR 0009: Live TV Backend-Driven YouTube Source and API Integration for Vercel

> **Status: Normative.**
> **Date:** 2026-09-28
> **Deciders:** Niyantran Architecture & Intelligence Workbench Team
> **Amended:** 2026-09-28 (section 4: search.list gap, categories, desks); 2026-09-29 (YouTube calls after F4, invented content)

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

- **Known gap: `search.list` is still called.** *(Closed later on 2026-09-28 by plan task F4: the live check now uses `videos.list` on the recent uploads plus the channel's curated live video, so a refresh costs 2 units; `src/lib/liveTvQuota.test.js`.)* When `YOUTUBE_API_KEY` is set
  and a channel has no fresh cache entry, `fetchYouTubeChannelVideos` first
  calls `youtube/v3/search` with `eventType=live` for that channel (100 quota
  units), then `playlistItems.list` on the uploads playlist (1 unit). So each
  uncached `GET /api/livetv/videos` costs about 101 units, not 1. The
  10-minute cache is held in memory, so each server instance keeps its own
  copy. `GET /api/livetv/live` does not call YouTube; it lists sources whose
  curated `status` is `live`. *(Changed on 2026-11-19 by F374: `GET /api/livetv/channels` now makes one
  `videos.list` call, 1 unit, for every enabled channel's curated video, cached 10 minutes in memory per
  instance, and marks a channel `live` only when that video is live; `GET /api/livetv/live` reuses that list,
  so it can cause the same call. `search.list` is still not used.)* This gap is to be tracked in the backlog
  (`docs/niyantran-conflict-audit-and-plan/04-open-backlog.md`).
- **Categories.** The 13 sources are split differently from context point 1:
  `NEWS` is DD News, Sansad TV, WION and NDTV 24x7; `GENERAL` is India Today TV
  and Aaj Tak; `RESEARCH` is CSIS and Soch by Mohak Mangal; `EDUCATION`,
  `POLITICS` and `ECONOMICS` are as listed.
- **Linked desks.** The sources link to the desk ids `national`, `economics`,
  `global`, `legislative` and `media`, not the four named in section 2.1.

---

## Amendment (2026-09-29)

Checked against `server/liveTvApi.mjs` on 2026-09-29. The original text and
the 2026-09-28 amendment are kept; where they disagree with this section,
this section is correct.

- **YouTube calls.** Since F4 (`47fa681`, 2026-09-28) an uncached
  `GET /api/livetv/videos` calls `playlistItems.list` on the channel's uploads
  playlist, then one `videos.list` on the recent uploads plus the channel's
  curated live video. `videos.list` supplies the live state and fills
  `upcomingVideos`. Nothing calls `search.list`, so a refresh costs 2 quota
  units (`src/lib/liveTvQuota.test.js`). If `videos.list` fails, the recent
  uploads still show, without a live video.
- **Superseded in the 2026-09-28 amendment:** the sentence "The code has not
  changed" and the whole "Known gap: `search.list` is still called"
  paragraph, including its pointer to `04-open-backlog.md`. The one list of
  open work is now `docs/plans/open-work.md`.
- **Invented content is still in the code.** `CHANNEL_ARCHIVES`,
  `BROADCAST_TRANSCRIPTS` (hand-written cues labelled "Official Parliamentary
  Broadcast / ASR Verified Record") and the placeholder schedules that
  `getLiveTvSchedule()` returns for channels without one are not real
  records, so section 2's "Authoritative Transcript Pane" is not yet true for
  the archive entries.
  It is F7 in `docs/plans/open-work.md`, parked until the owner shares the
  new Live TV sources (O7).

---

## Amendment (2026-11-19)

Records the phase 2 channel lookup as built on `feature/livetv-phase-2`. It is not merged to `main` and not
deployed. The text above and the earlier amendments are kept; where they disagree with this section, this section is
correct.

- **Lookup calls.** When a user picks a channel, the server calls `playlistItems.list` on the channel's uploads playlist
  and then `videos.list`: 2 units in all. `search.list` is not used. 47 channels carry a hint video id, which is checked
  first. The 2 units figure is replaced by the second amendment below.
- **List check.** The channel list check is the one `videos.list` call per enabled channel described in the 2026-11-19
  amendment in section 4. It has a 3-second limit.
- **Cache times.** A live answer is cached 10 minutes; a no-live answer 60 minutes; a failed lookup 60
  seconds; a failed list check 5 minutes, with at most 12 list-check failures a day.
- **Timeout.** 4 seconds per request (3 seconds for the list check).
- **Daily budget.** One budget is shared by the list check and the lookups: 3,000 units per server instance per YouTube
  day, where the day is the Pacific date. The default is set by the environment variable
  `LIVETV_LOOKUP_UNITS_PER_DAY`. The value 0 means no YouTube calls at all, and an invalid value means the default.
  Units are taken before each call.
- **Errors.** A 403 whose reason is `quotaExceeded`, `dailyLimitExceeded`, `rateLimitExceeded`,
  `userRateLimitExceeded`, `accessNotConfigured`, `keyInvalid`, `forbidden` or `none`, and a 400 whose reason is
  `keyInvalid`, block the whole key for 30 minutes. Any other 403, and a 404 `playlistNotFound`, affect only that
  channel, for 30 minutes. The key is never logged or returned.
- **Known limit.** The budget is kept per instance and resets on a cold start. `/api/livetv/*` is public, so heavy load
  can start more instances. Four full budgets (12,000 units) exceed the key's 10,000 units. Then the 30-minute block
  applies and the page falls back to the written videos. This costs no money.
- **Not done.** CDN caching of `/api/livetv/channels` and `/api/livetv/videos` is not set up. The routes stay
  `no-store` until the owner decides the cache policy of F154 (F380 in `docs/plans/open-work.md`).

---

## Amendment 2026-11-19 (second): the lookup order

Records the lookup order of the phase 2 channel lookup as built on `feature/livetv-phase-2`. It is not merged to `main`
and not deployed. The text above and the earlier amendments are kept; where they disagree with this section, this
section is correct.

- **Calls.** There is still no `search.list`. Every call costs 1 unit.
- **Order for one channel.** The lookup stops at the first live video it finds.
  1. One `videos.list` for the live video found last time, the remembered video and the curated video.
  2. `playlistItems.list` on the channel's live-streams playlist, with 50 results, then `videos.list`. The playlist id is
     `UULV` plus the channel id without its leading `UC`.
  3. The uploads playlist, with 50 results, then `videos.list`.
- **Cost.** 1 unit when the video found last time is still live. 2 units when the stream is in the live-streams playlist
  and nothing is remembered. At most 5 units. A channel with nothing live costs 4 or 5 units. For 96 channels each
  looked up once with none live, the total is at most 480 units.
- **Fields.** `videos.list` asks for `snippet,liveStreamingDetails,status`.
- **One definition of live.** The lookup and the channel list check use the same rule. `snippet.liveBroadcastContent`
  is `live`, there is an actual start time, and there is no actual end time. An abandoned broadcast keeps a start time
  and no end time indefinitely, so the start time alone is not enough.
- **Embeddable.** The answer carries `embeddable` from `status.embeddable`.
- **Why the change.** Measured on public YouTube pages on 2026-11-19: 63 of the 96 channels were live, and only 30 of
  the 47 remembered videos were still the current live video. The uploads playlist alone missed most 24-hour streams.
  The live-streams playlist held the live video for 54 of the 63 channels in its first 45 entries.
  `embed/live_stream?channel=` was tried and rejected: it gave player error 150 for every channel tested.
- **Known limit.** About 9 of the 63 live channels are not in the first entries of their live-streams playlist. The hint
  and uploads steps recover some of them. Measured on the branch's preview deployment with the real key on 2026-11-19: 55 of
  the 96 channels answered live, including 8 of those 9. `status.embeddable` was true for every live video, also for
  channels whose player refuses with error 150, so it does not predict a refusal; the player's error does.
- **Unchanged.** The shared daily budget and the cache times of the first amendment are unchanged.
