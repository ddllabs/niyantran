# ADR 0006: Live TV Backend Contract, Segment Carousel Parity, and Non-Fabricated Telemetry

> **Status: Normative.**  
> **Date:** 2026-09-27  
> **Applies to:** `server/liveTvApi.mjs`, `server/homeApi.mjs`, `src/shell/LiveTvModal.jsx`, `src/marketing/SegmentCarousel.jsx`, `api/router.js`  
> **Amended:** 2026-09-28 (section 4: the channel list is superseded by ADR 0009)

---

## 1. Context and Problem Statement

Niyantran Terminal previously exhibited three functional gaps in the presentation tier:
1. **Live TV Placeholder:** The desktop shell presented a placeholder "Beta" popup informing users that no live stream was wired. The underlying system required a clean media player with broadcast schedules, archives, and bilingual transcript grounding.
2. **Front-Page Segment Carousel:** The marketing home page lacked a dedicated segment-by-segment carousel with authoritative record counts, and clicking preview cards did not preserve user desk navigation intent across authentication.
3. **API & Telemetry Verification:** The system required end-to-end verification of endpoint contracts, document and PDF identities, evidence grounding, and sector taxonomies, with strict prohibition against fabricated live metrics or synthetic transcripts.

---

## 2. Decision and Invariants

1. **Authoritative Live TV Backend (`server/liveTvApi.mjs`):**
   - Live TV operates under four dedicated server contracts:
     - `GET /api/livetv/channels`: Canonical broadcaster list (DD News, Sansad TV, NDTV, CNBC-TV18, WION).
     - `GET /api/livetv/schedule?channel=<id>`: Time-slotted broadcast schedule mapped to NTER analytical desks.
     - `GET /api/livetv/archive?channel=<id>`: Recorded broadcast segments with verified dates and topics.
     - `GET /api/livetv/transcript?broadcastId=<id>`: Time-coded transcript cues.
   - **No Fabricated Transcripts:** When a broadcast has no recorded transcript, the API explicitly returns `available: false` with an empty cues array. The frontend renders an informative unavailable message rather than generating synthetic LLM hallucinations.
   - **No Fake Live Telemetry:** Viewer counts reflect durable server-side telemetry or report unmetered status; generating randomized or simulated viewer counters is prohibited.

2. **Front-Page Segment Carousel Parity (CR-09):**
   - The carousel operates on a strict **one-slide-per-segment** invariant across the 8 canonical analytical desks (Legislative, Electoral, Operations, Economy, Global, Judicial, Climate, Strategic).
   - Counts are sourced authoritatively via `GET /api/home/segments` representing actual database and snapshot counts (e.g. 9,819 bills, 543 constituencies, 1,280+ notices, 42 macro series, 18 open fronts).

3. **Sign-In Gate Destination Preservation (CR-09.4):**
   - Clicking a segment card on the public carousel persists the user's intent into `sessionStorage.setItem('niyantranLand', deskTab)` and `sessionStorage.setItem('niyantranFeature', feature)`.
   - Post-authentication hydration in `LoginPage.jsx` preserves existing `niyantranLand` rather than unconditionally resetting to the persona default start tab.
   - `TerminalShell.jsx` consumes and executes this destination upon initial mount.

4. **API Grounding and Verification Invariants (CR-06):**
   - Citations must reference actual, valid HTTP/HTTPS URLs; placeholder URLs (`PRID=placeholder`) and non-document registry hubs are actively stripped by `citationGuard.js`.
   - Structural briefs and extract briefs must derive strictly from verified row fields and extracted document text.
   - Sector mappings must conform to `public/data/ontology.json`.

---

## 3. Consequences

- **Positive:** Full activation of Live TV and front-page carousel; strict adherence to evidence-based architecture; verified preservation of user intent across login; zero fabricated metrics or hallucinated transcripts.
- **Negative:** Broadcasting embeds depend on upstream external iframe permissions from official YouTube streams; channels without public ASR records will display transcript unavailable states.

---

## 4. Amendment (2026-09-28)

The five-broadcaster list in decision 1 was replaced by ADR 0009. The channel
catalogue is now `YOUTUBE_SOURCES` in `server/liveTvApi.mjs` (13 entries,
exported also as `LIVE_TV_CHANNELS`). The endpoints have grown to six
(`channels`, `live`, `videos`, `schedule`, `archive`, `transcript`). The
no-fabricated-transcript and no-fake-telemetry invariants still hold: every
curated source sets `viewers: null`. See ADR 0009 and its amendment for the
current catalogue.
