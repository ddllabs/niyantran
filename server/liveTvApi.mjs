/**
 * Live TV backend API: channels, schedule, archive, videos, live streams, and transcript.
 *
 * Supported endpoints:
 *   GET /api/livetv/channels?category=<category>
 *   GET /api/livetv/live
 *   GET /api/livetv/videos?channelId=<id>
 *   GET /api/livetv/schedule?channel=<id>
 *   GET /api/livetv/archive?channel=<id>
 *   GET /api/livetv/transcript?broadcastId=<id>
 *
 * Designed for Vercel serverless execution:
 *   - No persistent filesystem writes
 *   - In-memory cache with TTL (10 minutes) for quota conservation
 *   - Graceful fallback to curated channel data when YouTube API key is missing or quota is exhausted
 *   - YouTube API credentials remain strictly server-side (YOUTUBE_API_KEY)
 */

import { LIVE_TV_LISTS, CURATED_CHANNEL_LISTS, LIST_CATEGORY, ADDED_CHANNELS } from './liveTvChannels.mjs';

function json(res, body, status = 200) {
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    res.setHeader?.('Cache-Control', 'no-store');
    res.status(status).json(body);
    return;
  }
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export const LIVE_TV_CATEGORIES = [
  'ALL',
  'NEWS',
  'EDUCATION',
  'POLITICS',
  'ECONOMICS',
  'RESEARCH',
  'GENERAL',
];

// The 13 curated channels, as they have always been (ids, videos and desks unchanged).
const CURATED_SOURCES = [
  // ── POLITICS ─────────────────────────────────────────────────────────────
  {
    id: 'dhruv-rathee',
    name: 'Dhruv Rathee',
    short: 'DR',
    category: 'POLITICS',
    channelId: 'UC-CSyyi47VX1lD9zyeABW3w',
    channelUrl: 'https://www.youtube.com/@dhruvrathee',
    color: '#F59E0B',
    lang: 'Hindi · English',
    description: 'In-depth video essays and factual analysis on governance, public policy, and national affairs.',
    enabled: true,
    priority: 1,
    deskId: 'national',
    status: 'recent',
    viewers: null,
    defaultVideoId: 'RJfqzUWZ0Bw',
    embedUrl: 'https://www.youtube-nocookie.com/embed/RJfqzUWZ0Bw?autoplay=1&mute=1&playsinline=1',
    fallbackVideos: [
      {
        videoId: 'RJfqzUWZ0Bw',
        title: "Electoral Bonds | The Biggest Scam in History of India? | Explained by Dhruv Rathee",
        thumbnail: 'https://i.ytimg.com/vi/RJfqzUWZ0Bw/hqdefault.jpg',
        embedUrl: 'https://www.youtube-nocookie.com/embed/RJfqzUWZ0Bw?autoplay=1&mute=1&playsinline=1',
      },
      {
        videoId: '-e72F_bBcqA',
        title: "Sad Reality of Uttarkashi Tunnel Rescue | 3D Animation | Dhruv Rathee",
        thumbnail: 'https://i.ytimg.com/vi/-e72F_bBcqA/hqdefault.jpg',
        embedUrl: 'https://www.youtube-nocookie.com/embed/-e72F_bBcqA?autoplay=1&mute=1&playsinline=1',
      },
    ],
  },

  // ── EDUCATION ────────────────────────────────────────────────────────────
  {
    id: 'think-school',
    name: 'Think School',
    short: 'TS',
    category: 'EDUCATION',
    channelId: 'UCKZozRVHRYsYHGEyNKuhhdA',
    channelUrl: 'https://www.youtube.com/@ThinkSchool',
    color: '#3B82F6',
    lang: 'English · Hindi',
    description: 'Case studies dissecting corporate strategy, national infrastructure, and economic megaprojects.',
    enabled: true,
    priority: 2,
    deskId: 'economics',
    status: 'recent',
    viewers: null,
    defaultVideoId: 'UY9H83yQnzc',
    embedUrl: 'https://www.youtube-nocookie.com/embed/UY9H83yQnzc?autoplay=1&mute=1&playsinline=1',
    fallbackVideos: [
      {
        videoId: 'UY9H83yQnzc',
        title: "BETRAYAL OF SAUDI ARABIA? | Why America Abandoned Saudi Arabia in Its Darkest Hour?",
        thumbnail: 'https://i.ytimg.com/vi/UY9H83yQnzc/hqdefault.jpg',
        embedUrl: 'https://www.youtube-nocookie.com/embed/UY9H83yQnzc?autoplay=1&mute=1&playsinline=1',
      },
      {
        videoId: 'ky6jesFvIqY',
        title: "Elon Musk & Dario’s Final Warning | Why the AI Race Is Getting Dangerously Out of Control?",
        thumbnail: 'https://i.ytimg.com/vi/ky6jesFvIqY/hqdefault.jpg',
        embedUrl: 'https://www.youtube-nocookie.com/embed/ky6jesFvIqY?autoplay=1&mute=1&playsinline=1',
      },
    ],
  },
  {
    id: 'khan-gs',
    name: 'Khan GS Research Centre',
    short: 'KGS',
    category: 'EDUCATION',
    channelId: 'UCatL-c6pmnjzEOHSyjn-sHA',
    channelUrl: 'https://www.youtube.com/@khangsresearchcentre1685',
    color: '#10B981',
    lang: 'Hindi',
    description: 'Detailed geopolitical, constitutional, and historical lectures on bilateral treaties and border security.',
    enabled: true,
    priority: 3,
    deskId: 'national',
    status: 'recent',
    viewers: null,
    defaultVideoId: 'ECoO7eyknPs',
    embedUrl: 'https://www.youtube-nocookie.com/embed/ECoO7eyknPs?autoplay=1&mute=1&playsinline=1',
    fallbackVideos: [
      {
        videoId: 'ECoO7eyknPs',
        title: "Anti Tank Missile | Javelin Anti Tank Missile | Military Tank | How Javelin Missile work ",
        thumbnail: 'https://i.ytimg.com/vi/ECoO7eyknPs/hqdefault.jpg',
        embedUrl: 'https://www.youtube-nocookie.com/embed/ECoO7eyknPs?autoplay=1&mute=1&playsinline=1',
      },
      {
        videoId: '4SyrQHSmQlQ',
        title: "Raksha Bandhan 2026 Full Video | Rakhi 2026 By Khan Sir | Raksha Bandhan | Raksha Bandhan Festival ",
        thumbnail: 'https://i.ytimg.com/vi/4SyrQHSmQlQ/hqdefault.jpg',
        embedUrl: 'https://www.youtube-nocookie.com/embed/4SyrQHSmQlQ?autoplay=1&mute=1&playsinline=1',
      },
    ],
  },

  // ── RESEARCH ─────────────────────────────────────────────────────────────
  {
    id: 'soch-mohak',
    name: 'Soch by Mohak Mangal',
    short: 'SOCH',
    category: 'RESEARCH',
    channelId: 'UCz4a7agVFr1TxU-mpAP8hkw',
    channelUrl: 'https://www.youtube.com/@mohak_mangal',
    color: '#8B5CF6',
    lang: 'Hindi · English',
    description: 'Data-driven journalism covering public administration, economic disparities, and urban governance.',
    enabled: true,
    priority: 4,
    deskId: 'national',
    status: 'recent',
    viewers: null,
    defaultVideoId: '3MtJg5rJars',
    embedUrl: 'https://www.youtube-nocookie.com/embed/3MtJg5rJars?autoplay=1&mute=1&playsinline=1',
    fallbackVideos: [
      {
        videoId: '3MtJg5rJars',
        title: "Inside Air India's Most Disturbing Flight Incident",
        thumbnail: 'https://i.ytimg.com/vi/3MtJg5rJars/hqdefault.jpg',
        embedUrl: 'https://www.youtube-nocookie.com/embed/3MtJg5rJars?autoplay=1&mute=1&playsinline=1',
      },
      {
        videoId: 'E4tNtZO6_6M',
        title: "How One IAS Officer Exposed India’s Food Mafia",
        thumbnail: 'https://i.ytimg.com/vi/E4tNtZO6_6M/hqdefault.jpg',
        embedUrl: 'https://www.youtube-nocookie.com/embed/E4tNtZO6_6M?autoplay=1&mute=1&playsinline=1',
      },
    ],
  },
  {
    id: 'csis',
    name: 'CSIS',
    short: 'CSIS',
    category: 'RESEARCH',
    channelId: 'UCr5jq6MC_VCe1c5ciIZtk_w',
    channelUrl: 'https://www.youtube.com/@csis',
    color: '#0284C7',
    lang: 'English',
    description: 'Center for Strategic and International Studies: bipartisan defence, foreign policy, and multilateral security briefings.',
    enabled: true,
    priority: 5,
    deskId: 'global',
    status: 'recent',
    viewers: null,
    defaultVideoId: '7ncDwpDZkho',
    embedUrl: 'https://www.youtube-nocookie.com/embed/7ncDwpDZkho?autoplay=1&mute=1&playsinline=1',
    fallbackVideos: [
      {
        videoId: '7ncDwpDZkho',
        title: "Red Lines and Reality: The West's Escalation Dilemma in Ukraine",
        thumbnail: 'https://i.ytimg.com/vi/7ncDwpDZkho/hqdefault.jpg',
        embedUrl: 'https://www.youtube-nocookie.com/embed/7ncDwpDZkho?autoplay=1&mute=1&playsinline=1',
      },
      {
        videoId: 'urj_IlvLo5A',
        title: "Powering America: Rethinking the Economics of Transmission",
        thumbnail: 'https://i.ytimg.com/vi/urj_IlvLo5A/hqdefault.jpg',
        embedUrl: 'https://www.youtube-nocookie.com/embed/urj_IlvLo5A?autoplay=1&mute=1&playsinline=1',
      },
    ],
  },

  // ── NEWS ─────────────────────────────────────────────────────────────────
  {
    id: 'dd-news',
    name: 'DD News',
    short: 'DD',
    category: 'NEWS',
    channelId: 'UCKwucPzHZ7zCUIf7If-Wo1g',
    channelUrl: 'https://www.youtube.com/@ddnews',
    color: '#C8102E',
    lang: 'Hindi · English',
    description: 'Doordarshan News: National public broadcaster providing direct state notifications, gazettes, and parliamentary summaries.',
    enabled: true,
    priority: 6,
    deskId: 'legislative',
    status: 'recent',
    viewers: null,
    defaultVideoId: 'qD6GkaU2lD0',
    embedUrl: 'https://www.youtube-nocookie.com/embed/qD6GkaU2lD0?autoplay=1&mute=1&playsinline=1',
    fallbackVideos: [
    ],
  },
  {
    id: 'sansad-tv',
    name: 'Sansad TV',
    short: 'STV',
    category: 'NEWS',
    channelId: 'UCISgnSNwqQ2i8lhCun3KtQg',
    channelUrl: 'https://www.youtube.com/@sansadtv',
    color: '#1B365D',
    lang: 'Hindi · English',
    description: 'Official broadcaster for the Parliament of India, telecasting Lok Sabha and Rajya Sabha sessions live.',
    enabled: true,
    priority: 7,
    deskId: 'legislative',
    status: 'recent',
    viewers: null,
    defaultVideoId: 'live_stream',
    embedUrl: 'https://www.youtube-nocookie.com/embed/live_stream?channel=UCISgnSNwqQ2i8lhCun3KtQg&autoplay=1&mute=1',
    fallbackVideos: [
    ],
  },
  {
    id: 'wion',
    name: 'WION',
    short: 'WION',
    category: 'NEWS',
    channelId: 'UC_gUM8rL-Lrg6O3adPW9K1g',
    channelUrl: 'https://www.youtube.com/@wion',
    color: '#0A3D62',
    lang: 'English',
    description: 'World Is One News: International news network delivering strategic reporting on South Asia, multilateral treaties, and diplomacy.',
    enabled: true,
    priority: 8,
    deskId: 'global',
    status: 'recent',
    viewers: null,
    defaultVideoId: 'vfszY1JYbMc',
    embedUrl: 'https://www.youtube-nocookie.com/embed/vfszY1JYbMc?autoplay=1&mute=1&playsinline=1',
    fallbackVideos: [
    ],
  },
  {
    id: 'ndtv-24x7',
    name: 'NDTV 24x7',
    short: 'NDTV',
    category: 'NEWS',
    channelId: 'UCZFMm1mMw0F81Z37aaEzTUA',
    channelUrl: 'https://www.youtube.com/@ndtv',
    color: '#E4002B',
    lang: 'English',
    description: 'English national news channel focusing on governance, investigative reports, and political analysis.',
    enabled: true,
    priority: 9,
    deskId: 'national',
    status: 'recent',
    viewers: null,
    defaultVideoId: 'I8643WY0BgA',
    embedUrl: 'https://www.youtube-nocookie.com/embed/I8643WY0BgA?autoplay=1&mute=1&playsinline=1',
    fallbackVideos: [
    ],
  },

  // ── ECONOMICS ────────────────────────────────────────────────────────────
  {
    id: 'cnbc-tv18',
    name: 'CNBC-TV18',
    short: 'CNBC',
    category: 'ECONOMICS',
    channelId: 'UCmRbHAgG2k2vDUvb3xsEunQ',
    channelUrl: 'https://www.youtube.com/@cnbctv18',
    color: '#005C9E',
    lang: 'English',
    description: 'Financial news broadcaster providing live market surveillance, corporate disclosure tracking, and RBI policy analysis.',
    enabled: true,
    priority: 10,
    deskId: 'economics',
    status: 'recent',
    viewers: null,
    defaultVideoId: '1_Ih0JYmkjI',
    embedUrl: 'https://www.youtube-nocookie.com/embed/1_Ih0JYmkjI?autoplay=1&mute=1&playsinline=1',
    fallbackVideos: [
    ],
  },
  {
    id: 'et-now',
    name: 'ET Now',
    short: 'ET',
    category: 'ECONOMICS',
    channelId: 'UCI_mwTKUhicNzFrhm33MzBQ',
    channelUrl: 'https://www.youtube.com/@etnow',
    color: '#8E24AA',
    lang: 'English',
    description: 'Economic and financial news desk reviewing trade policy, market liquidity, and industrial benchmarks.',
    enabled: true,
    priority: 11,
    deskId: 'economics',
    status: 'recent',
    viewers: null,
    defaultVideoId: 'v-HldpGnVT8',
    embedUrl: 'https://www.youtube-nocookie.com/embed/v-HldpGnVT8?autoplay=1&mute=1&playsinline=1',
    fallbackVideos: [
    ],
  },

  // ── GENERAL ──────────────────────────────────────────────────────────────
  {
    id: 'india-today',
    name: 'India Today TV',
    short: 'IT',
    category: 'GENERAL',
    channelId: 'UCYPvAwZP8pZhSMW8qs7cVCw',
    channelUrl: 'https://www.youtube.com/@indiatoday',
    color: '#EC1C24',
    lang: 'English',
    description: 'National reporting on civic developments, election pulse, and ministerial announcements.',
    enabled: true,
    priority: 12,
    deskId: 'national',
    status: 'recent',
    viewers: null,
    defaultVideoId: '9NH-hAV3H6M',
    embedUrl: 'https://www.youtube-nocookie.com/embed/9NH-hAV3H6M?autoplay=1&mute=1&playsinline=1',
    fallbackVideos: [
    ],
  },
  {
    id: 'aaj-tak',
    name: 'Aaj Tak',
    short: 'AT',
    category: 'GENERAL',
    channelId: 'UCt4t-jeY85JegMlZ-E5UWtA',
    channelUrl: 'https://www.youtube.com/@aajtak',
    color: '#E11B22',
    lang: 'Hindi',
    description: 'Broadcasting national debates, state assembly reports, and field investigations.',
    enabled: true,
    priority: 13,
    deskId: 'media',
    status: 'recent',
    viewers: null,
    defaultVideoId: 'ChQPEkASCb4',
    embedUrl: 'https://www.youtube-nocookie.com/embed/ChQPEkASCb4?autoplay=1&mute=1&playsinline=1',
    fallbackVideos: [
    ],
  },
];

// The curated channels (now with their lists) followed by the channels added to the client's lists.
export const YOUTUBE_SOURCES = [
  ...CURATED_SOURCES.map((c) => ({ ...c, lists: CURATED_CHANNEL_LISTS[c.id] || [] })),
  ...ADDED_CHANNELS,
];

export { LIVE_TV_LISTS, LIST_CATEGORY };

// Backward-compatible alias for existing tests
export const LIVE_TV_CHANNELS = YOUTUBE_SOURCES;

// F7 (F171 B8): no channel publishes a schedule we read, so none is shown.
export const CHANNEL_SCHEDULES = {};

// F7: the archive entries were invented; none is shown until a real archive is connected.
export const CHANNEL_ARCHIVES = [];

// F7: the transcripts were hand-written and labelled "Verified Record"; none is shown.
export const BROADCAST_TRANSCRIPTS = {};

// ── Vercel In-Memory Cache (TTL: 10 mins) ──────────────────────────────────
const memoryCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

export function getCached(key) {
  const hit = memoryCache.get(key);
  if (!hit) return null;
  const isFresh = Date.now() - hit.timestamp < (hit.ttlMs ?? CACHE_TTL_MS);
  return { data: hit.data, isFresh, timestamp: hit.timestamp };
}

export function setCached(key, data, ttlMs) {
  memoryCache.set(key, { data, timestamp: Date.now(), ttlMs });
}

export function clearCache() {
  memoryCache.clear();
  liveStatusInFlight = null;
  channelInFlight.clear();
  lastLiveId.clear();
  spent = { day: '', units: 0, listFailures: 0 };
}

// ── YouTube quota (ADR 0009: no search.list) ───────────────────────────────
// A per-channel lookup costs 1 unit when the stream found last time is still live, 2 to 3 for a live stream found in
// the live-streams playlist, up to 5 when nothing is live (every call is 1 unit); the list check costs 1 unit per 50 ids.
// With ~100 channels the cache alone cannot keep one server instance under the 10,000-unit quota of a YouTube day
// (which ends at midnight Pacific), so:
//   * an answer that found a live video is kept 10 minutes; one that found NONE is kept 60 minutes; a failure
//     is kept 60 seconds, so "Try again" can get a fresh answer;
//   * lookups of the same channel in flight share one request, and every request has a time limit;
//   * a refusal that concerns the whole key or the quota is remembered for 30 minutes for every call; one that
//     concerns a single resource (a private playlist) only for that channel;
//   * an instance spends at most YOUTUBE_UNITS_PER_DAY units a Pacific day on ALL its YouTube calls, the list
//     check included (about 288 of them), so two warm instances together stay under the quota; past it, answers
//     come from the curated data. A failing list check is retried at most LIST_CHECK_FAILURES_PER_DAY times a day.
export const NO_LIVE_TTL_MS = 60 * 60 * 1000;
export const FAILURE_TTL_MS = 60 * 1000;
export const INACCESSIBLE_TTL_MS = 30 * 60 * 1000;
export const QUOTA_BLOCK_MS = 30 * 60 * 1000;
export const REQUEST_TIMEOUT_MS = 4000;
export const YOUTUBE_UNITS_PER_DAY = 3000; // LIVETV_LOOKUP_UNITS_PER_DAY overrides it (0 means no YouTube calls)
export const LIST_CHECK_FAILURES_PER_DAY = 12;
const LIST_FAILURE_TTL_MS = 5 * 60 * 1000;
/** A finite number of units, 0 or more; anything else is the default. */
function dailyBudget() {
  const raw = process.env.LIVETV_LOOKUP_UNITS_PER_DAY;
  if (raw === undefined || String(raw).trim() === '') return YOUTUBE_UNITS_PER_DAY;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : YOUTUBE_UNITS_PER_DAY;
}
const QUOTA_BLOCK_KEY = 'yt-quota-blocked';
const channelInFlight = new Map();
let spent = { day: '', units: 0, listFailures: 0 };
// Refusals that are about the key or the quota, not about one resource. No reason given counts as one.
const ACCOUNT_WIDE_REASONS = new Set([
  'quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded', 'userRateLimitExceeded', 'accessNotConfigured', 'keyInvalid', 'forbidden', '',
]);

// YouTube's day ends at midnight Pacific time.
const pacificFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
const today = () => pacificFormat.format(new Date());
function spentToday() {
  const day = today();
  if (spent.day !== day) spent = { day, units: 0, listFailures: 0 };
  return spent;
}
const unitsLeft = () => Math.max(0, dailyBudget() - spentToday().units);

function quotaBlocked() {
  const hit = memoryCache.get(QUOTA_BLOCK_KEY);
  return Boolean(hit) && Date.now() - hit.timestamp < QUOTA_BLOCK_MS;
}

/** An error from one YouTube request. `kind` says why it did not give an answer. */
class YouTubeError extends Error {
  constructor(kind, status = 0, reason = '') {
    super(`YouTube ${kind}${status ? ` ${status}` : ''}${reason ? ` ${reason}` : ''}`);
    this.kind = kind; // 'budget' | 'quota' | 'inaccessible' | 'timeout' | 'error'
    this.status = status;
    this.reason = reason;
  }
}

/** What an error body says: the first reason, and whether it is about the API key itself. */
async function errorDetail(resp) {
  try {
    const body = await resp.json();
    const r = body?.error?.errors?.[0]?.reason;
    const reasons = [r, ...(Array.isArray(body?.error?.details) ? body.error.details.map((d) => d?.reason) : [])];
    const aboutKey = reasons.includes('keyInvalid') || reasons.includes('API_KEY_INVALID') || /api key/i.test(String(body?.error?.message || ''));
    return { reason: typeof r === 'string' ? r : '', aboutKey };
  } catch { return { reason: '', aboutKey: false }; }
}

/**
 * One GET to YouTube: takes a unit of today's budget first, has a time limit, and sorts a refusal into "the
 * whole key" (remembered for every call) or "this resource" (only this call fails). Returns the parsed body.
 */
async function youtubeGet(url, timeoutMs = REQUEST_TIMEOUT_MS) {
  if (quotaBlocked()) throw new YouTubeError('quota');
  if (unitsLeft() < 1) throw new YouTubeError('budget');
  spentToday().units += 1;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!resp.ok) {
      if (resp.status === 403) {
        const { reason } = await errorDetail(resp);
        if (ACCOUNT_WIDE_REASONS.has(reason)) {
          setCached(QUOTA_BLOCK_KEY, true, QUOTA_BLOCK_MS);
          throw new YouTubeError('quota', 403, reason);
        }
        throw new YouTubeError('inaccessible', 403, reason);
      }
      // A key YouTube does not accept is the whole key's problem, like a refused 403.
      if (resp.status === 400) {
        const { reason, aboutKey } = await errorDetail(resp);
        if (aboutKey) {
          setCached(QUOTA_BLOCK_KEY, true, QUOTA_BLOCK_MS);
          throw new YouTubeError('quota', 400, reason);
        }
        throw new YouTubeError('error', 400, reason);
      }
      // A playlist that does not exist is that channel's problem only.
      if (resp.status === 404) {
        const { reason } = await errorDetail(resp);
        if (reason === 'playlistNotFound') throw new YouTubeError('inaccessible', 404, reason);
        throw new YouTubeError('error', 404, reason);
      }
      try { await resp.body?.cancel(); } catch { /* the body is not needed */ }
      throw new YouTubeError('error', resp.status);
    }
    return await resp.json();
  } catch (err) {
    if (err instanceof YouTubeError) throw err;
    throw new YouTubeError(controller.signal.aborted ? 'timeout' : 'error');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Safely extracts an 11-character YouTube video ID from strings or various URL formats:
 * - Direct ID: "y60wB0i2b7g"
 * - Watch URL: "https://www.youtube.com/watch?v=y60wB0i2b7g"
 * - Short URL: "https://youtu.be/y60wB0i2b7g"
 * - Embed URL: "https://www.youtube-nocookie.com/embed/y60wB0i2b7g"
 * - Live URL: "https://www.youtube.com/live/y60wB0i2b7g"
 */
export function extractYouTubeVideoId(input) {
  if (!input || typeof input !== 'string') return '';
  const trimmed = input.trim();
  if (trimmed === 'live_stream') return 'live_stream';
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/(?:youtu\.be\/|(?:youtube\.com|youtube-nocookie\.com)\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|live\/))([a-zA-Z0-9_-]{11})/);
  if (match && match[1]) return match[1];
  return trimmed;
}

/**
 * Normalizes YouTube video item to uniform NTER video schema.
 */
export function normalizeYouTubeVideo(item, defaultChannelId) {
  if (!item || typeof item !== 'object') return null;

  const rawId =
    typeof item.id === 'string'
      ? item.id
      : item.id?.videoId || item.snippet?.resourceId?.videoId || item.videoId || '';

  const id = extractYouTubeVideoId(rawId);
  if (!id) return null;

  const snippet = item.snippet || {};
  const thumbnails = snippet.thumbnails || {};
  const thumbUrl =
    thumbnails.high?.url ||
    thumbnails.medium?.url ||
    thumbnails.default?.url ||
    item.thumbnail ||
    // F7: the video's own YouTube thumbnail, never a stock photo.
    (id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '');

  const isLive =
    snippet.liveBroadcastContent === 'live' ||
    item.isLive === true ||
    item.eventType === 'live';

  const isUpcoming =
    snippet.liveBroadcastContent === 'upcoming' ||
    item.isUpcoming === true ||
    item.eventType === 'upcoming';

  const channelId = snippet.channelId || defaultChannelId || '';

  const defaultEmbed = id === 'live_stream'
    ? `https://www.youtube-nocookie.com/embed/live_stream?channel=${channelId}&autoplay=1&mute=1`
    : `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&playsinline=1`;

  return {
    id,
    videoId: id,
    channelId,
    title: snippet.title || item.title || '',
    description: snippet.description || item.description || '',
    thumbnail: thumbUrl,
    // F7: unknown stays unknown (the curated list has no verified dates or durations).
    publishedAt: snippet.publishedAt || item.publishedAt || null,
    duration: item.duration || (isLive ? 'LIVE' : null),
    isLive,
    isUpcoming,
    embedUrl: item.embedUrl || defaultEmbed,
  };
}

/**
 * Server-side YouTube Data API fetcher with rate-limiting protection & caching.
 */
export async function fetchYouTubeChannelVideos(channel) {
  const cacheKey = `yt-videos-${channel.id}`;
  const cached = getCached(cacheKey);
  if (cached && cached.isFresh) {
    return { ok: true, source: 'cache', ...cached.data };
  }
  // Callers that arrive while a refresh of the same channel is under way share it.
  const open = channelInFlight.get(channel.id);
  if (open) return open;
  const run = refreshChannelVideos(channel, cacheKey, cached);
  channelInFlight.set(channel.id, run);
  try {
    return await run;
  } finally {
    if (channelInFlight.get(channel.id) === run) channelInFlight.delete(channel.id);
  }
}

/**
 * What a channel answers with when YouTube cannot be asked: its curated data, never a claim that it is live.
 * `reason` says why in a word (quota, budget, timeout, inaccessible, error, no-key); the page shows "couldn't
 * check" for these and "isn't live" only for an answer from YouTube data.
 */
function curatedAnswer(channel, source, reason) {
  const data = {
    channelId: channel.id,
    channelName: channel.name,
    status: channel.status || 'recent',
    liveVideo: null,
    recentVideos: (channel.fallbackVideos || []).map((v) => normalizeYouTubeVideo(v, channel.id)),
    upcomingVideos: [],
    dataOrigin: 'fallback',
    reason,
  };
  return { data, answer: { ok: true, source, ...data } };
}

const ID11 = /^[a-zA-Z0-9_-]{11}$/;
/** Live: started and not ended. An announced broadcast has no actual start. */
const isLiveItem = (it) => it?.snippet?.liveBroadcastContent === 'live'
  && Boolean(it?.liveStreamingDetails?.actualStartTime) && !it?.liveStreamingDetails?.actualEndTime;
// A start time that cannot be read counts as the latest, so it never wins "earliest start".
const startOf = (it) => { const t = Date.parse(it?.liveStreamingDetails?.actualStartTime); return Number.isFinite(t) ? t : Infinity; };
// The live video found for each channel the last time, kept after its answer has expired: a refresh asks about it
// first, so a stream that is still live costs one unit.
const lastLiveId = new Map();

async function refreshChannelVideos(channel, cacheKey, cached) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    // Graceful fallback to curated channel data when YOUTUBE_API_KEY is not configured
    const fallbackData = {
      channelId: channel.id,
      channelName: channel.name,
      status: channel.status || 'recent',
      liveVideo:
        channel.status === 'live'
          ? {
              videoId: channel.defaultVideoId,
              title: channel.name,
              embedUrl: channel.embedUrl,
              thumbnail: channel.fallbackVideos?.[0]?.thumbnail,
              publishedAt: null,
              isLive: true,
            }
          : null,
      recentVideos: (channel.fallbackVideos || []).map((v) => normalizeYouTubeVideo(v, channel.id)),
      upcomingVideos: [],
      dataOrigin: 'fallback',
      reason: 'no-key',
    };
    setCached(cacheKey, fallbackData);
    return { ok: true, source: 'curated-fallback', ...fallbackData };
  }
  // Failed lookups are kept only briefly, a private playlist for longer; neither is an answer about being live.
  const failed = (err) => {
    const { data, answer } = curatedAnswer(channel, err.kind === 'quota' || err.kind === 'budget' ? 'quota-fallback' : 'curated-fallback', err.kind);
    setCached(cacheKey, data, err.kind === 'inaccessible' ? INACCESSIBLE_TTL_MS : FAILURE_TTL_MS);
    return answer;
  };
  if (quotaBlocked()) return failed(new YouTubeError('quota'));
  if (unitsLeft() < 1) return failed(new YouTubeError('budget'));

  // Quota (ADR 0009): search.list costs 100 units, so it is not used. A channel's live video is looked for in
  // order, and the search stops at the first step that finds one:
  //   1. the live video the channel had when it was added (the hint) and its curated video: one videos.list (1 unit);
  //   2. the channel's live-streams playlist ("UULV" + the channel id without "UC"): playlistItems.list (1 unit,
  //      up to 50 entries; a 404 means the channel has none) and one videos.list to verify them (1 unit);
  //   3. the channel's uploads playlist ("UU…"): playlistItems.list with 50 entries (1) and videos.list (1).
  // Best case 1 unit, typical 2 to 3, worst case 5. A 24-hour stream is often not among the latest uploads, which
  // is why the live-streams playlist comes first.
  const base = 'https://www.googleapis.com/youtube/v3';
  const keyParam = `&key=${encodeURIComponent(apiKey)}`;
  const details = new Map(); // video id -> the videos.list item
  let trouble = null; // the first error that left the answer incomplete
  const soft = (err) => { // what ends the search at once, versus what only leaves the answer incomplete
    if (err.kind === 'error') { trouble = trouble || err; return null; }
    return failed(err);
  };
  const verify = async (ids) => {
    const unique = [...new Set(ids)].filter((id) => ID11.test(id || '')).slice(0, 50);
    if (!unique.length) return [];
    const url = `${base}/videos?part=snippet,liveStreamingDetails,status&id=${encodeURIComponent(unique.join(','))}${keyParam}`;
    const data = await youtubeGet(url);
    for (const it of Array.isArray(data.items) ? data.items : []) if (typeof it?.id === 'string') details.set(it.id, it);
    return unique;
  };
  const playlistIds = async (playlistId) => {
    const data = await youtubeGet(`${base}/playlistItems?part=snippet&playlistId=${encodeURIComponent(playlistId)}&maxResults=50${keyParam}`);
    const items = Array.isArray(data.items) ? data.items : [];
    const ids = items
      .map((it) => extractYouTubeVideoId(it?.snippet?.resourceId?.videoId || it?.id?.videoId || ''))
      .filter((id) => ID11.test(id));
    return { items, ids };
  };
  // Live: it has started and not ended (an announced broadcast has not started). The earliest start wins, which is
  // the 24-hour stream when a channel also has a short programme live.
  const liveOf = (ids) => ids
    .filter((id) => isLiveItem(details.get(id)))
    .sort((x, y) => { const a = startOf(details.get(x)); const b = startOf(details.get(y)); return a < b ? -1 : a > b ? 1 : 0; })[0];

  let liveId = '';
  let uploads = [];
  let recentIds = [];
  let uploadsRead = false;
  const hint = [...new Set([lastLiveId.get(channel.id), channel.liveHintVideoId, channel.defaultVideoId])].filter((id) => ID11.test(id || ''));

  // 1. the hint and the curated video
  if (hint.length) {
    try { liveId = liveOf(await verify(hint)) || ''; } catch (err) { const r = soft(err); if (r) return r; }
  }
  // 2. the live-streams playlist
  if (!liveId) {
    try {
      const { ids } = await playlistIds('UULV' + channel.channelId.slice(2));
      recentIds = ids;
      liveId = liveOf(await verify(ids)) || '';
    } catch (err) {
      // No live-streams playlist (404) or a private one: nothing here, the search goes on.
      if (err.kind === 'inaccessible' || err.status === 404) recentIds = [];
      else { const r = soft(err); if (r) return r; }
    }
  }
  // 3. the uploads playlist
  if (!liveId) {
    try {
      const got = await playlistIds('UU' + channel.channelId.slice(2));
      uploads = got.items;
      uploadsRead = true;
      recentIds = got.ids;
      liveId = liveOf(await verify(got.ids)) || '';
    } catch (err) {
      if (err.kind === 'inaccessible') return failed(err);
      const r = soft(err); if (r) return r;
    }
  }

  // Remembered while it lasts: forgotten when a whole search ran and found nothing live, kept through a failure.
  if (liveId) lastLiveId.set(channel.id, liveId);
  else if (!trouble) lastLiveId.delete(channel.id);
  const liveItem = liveId ? details.get(liveId) : null;
  const liveVideo = liveItem ? normalizeYouTubeVideo(liveItem, channel.id) : null;
  if (liveVideo) {
    liveVideo.isLive = true;
    liveVideo.embeddable = liveItem.status?.embeddable !== false; // false only when YouTube says so
  }
  const upcomingVideos = [...details.values()]
    .filter((it) => it?.snippet?.liveBroadcastContent === 'upcoming')
    .map((it) => normalizeYouTubeVideo(it, channel.id))
    .filter(Boolean);

  // Recent videos: what was read, newest first, without the live and announced ones; at most 12.
  let recentVideos = recentIds
    .map((id) => details.get(id))
    .filter((it) => it && !isLiveItem(it) && it.snippet?.liveBroadcastContent !== 'upcoming')
    .map((it) => normalizeYouTubeVideo(it, channel.id))
    .filter(Boolean)
    .slice(0, 12);

  // If the API gave no recent videos, fall back to configured fallback videos
  const hasFallbackVideos = Array.isArray(channel.fallbackVideos) && channel.fallbackVideos.length > 0;
  if (recentVideos.length === 0 && hasFallbackVideos) {
    recentVideos = channel.fallbackVideos.map((v) => normalizeYouTubeVideo(v, channel.id));
  }

  const status = liveVideo ? 'live' : recentVideos.length > 0 ? 'recent' : 'offline';

  // Where the DATA came from (kept with the cached payload, unlike `source`, which says how it was served):
  // 'youtube-api' when a live video was found, or when the whole search ran without a failed call (a channel with
  // no uploads at all is known too, unless a curated list stands in for them). Otherwise 'fallback'.
  const complete = Boolean(liveVideo) || (!trouble && uploadsRead && (uploads.length > 0 || !hasFallbackVideos));

  const result = {
    channelId: channel.id,
    channelName: channel.name,
    status,
    liveVideo,
    recentVideos,
    upcomingVideos,
    dataOrigin: complete ? 'youtube-api' : 'fallback',
    ...(liveVideo ? { embeddable: liveVideo.embeddable } : {}),
    ...(complete ? {} : { reason: trouble?.kind || 'error' }),
  };

  // From YouTube data: a live video is kept 10 minutes, none 60 minutes. Anything else is kept briefly.
  setCached(cacheKey, result, complete ? (liveVideo ? undefined : NO_LIVE_TTL_MS) : FAILURE_TTL_MS);
  return { ok: true, source: 'youtube-api', ...result };
}

// ── Public API Handlers ────────────────────────────────────────────────────

// F367: live state for the whole channel list from ONE videos.list call (1 quota unit, ADR 0009: no
// search.list). The call asks about each enabled channel's default video; a channel is live when that
// video's liveBroadcastContent is 'live'. The answer is cached for the module's 10 minutes; a failure is
// remembered for one minute only, so a broken key or a quota stop is not retried on every list request.
const LIVE_STATUS_KEY = 'yt-live-status';
const LIVE_STATUS_FAILED_KEY = 'yt-live-status-failed';
const LIVE_STATUS_TIMEOUT_MS = 3000;
const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
let liveStatusInFlight = null;

export const LIVE_STATUS_BATCH = 50; // videos.list takes at most 50 ids

/**
 * What the batched check found: { liveIds: ids of channels whose curated video is live, hints: { channel id:
 * video id } for added channels whose remembered live video (liveHintVideoId) is live now }. null when the
 * answer is unknown (no key, a refusal, a failure). The ids are asked about in as many videos.list calls of
 * 50 as needed, curated videos first (1 unit each).
 */
async function fetchLiveChannelIds(channels) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return null;

  const fresh = getCached(LIVE_STATUS_KEY);
  if (fresh && fresh.isFresh) return fresh.data;
  const failed = getCached(LIVE_STATUS_FAILED_KEY);
  if (failed && failed.isFresh) return null;
  if (quotaBlocked()) return null;
  // A check that keeps failing is not retried all day: each failed attempt spends units too.
  if (spentToday().listFailures >= LIST_CHECK_FAILURES_PER_DAY) return null;
  if (liveStatusInFlight) return liveStatusInFlight;

  const withVideo = channels.filter((c) => VIDEO_ID_RE.test(c.defaultVideoId || ''));
  const withHint = channels.filter((c) => !VIDEO_ID_RE.test(c.defaultVideoId || '') && VIDEO_ID_RE.test(c.liveHintVideoId || ''));
  const ids = [...new Set([...withVideo.map((c) => c.defaultVideoId), ...withHint.map((c) => c.liveHintVideoId)])];
  if (!ids.length) return null;
  const batches = [];
  for (let i = 0; i < ids.length; i += LIVE_STATUS_BATCH) batches.push(ids.slice(i, i + LIVE_STATUS_BATCH));
  if (unitsLeft() < batches.length) return null; // not enough of today's units for the whole check

  const embeddable = {}; // video id -> whether YouTube lets it be embedded
  const run = (async () => {
    try {
      const answers = await Promise.all(batches.map(async (batch) => {
        const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,liveStreamingDetails,status&id=${encodeURIComponent(
          batch.join(','),
        )}&key=${encodeURIComponent(apiKey)}`;
        const body = await youtubeGet(url, LIVE_STATUS_TIMEOUT_MS);
        if (!Array.isArray(body?.items)) throw new YouTubeError('error');
        for (const it of body.items) if (typeof it?.status?.embeddable === 'boolean') embeddable[it.id] = it.status.embeddable;
        return body.items.filter(isLiveItem).map((it) => it.id);
      }));
      const liveVideoIds = new Set(answers.flat());
      const liveIds = withVideo.filter((c) => liveVideoIds.has(c.defaultVideoId)).map((c) => c.id);
      const hints = {};
      for (const c of withHint) if (liveVideoIds.has(c.liveHintVideoId)) hints[c.id] = c.liveHintVideoId;
      const found = { liveIds, hints, embeddable };
      setCached(LIVE_STATUS_KEY, found);
      return found;
    } catch {
      spentToday().listFailures += 1;
      setCached(LIVE_STATUS_FAILED_KEY, true, LIST_FAILURE_TTL_MS);
      return null;
    }
  })();
  liveStatusInFlight = run;
  try {
    return await run;
  } finally {
    if (liveStatusInFlight === run) liveStatusInFlight = null;
  }
}

const embeddableOf = (map, id) => (typeof map?.[id] === 'boolean' ? { embeddable: map[id] } : {});
/** Whether the live video in a fresh per-channel entry may be embedded, when YouTube said. */
function cachedEmbeddable(channelId) {
  const v = getCached(`yt-videos-${channelId}`)?.data?.liveVideo?.embeddable;
  return typeof v === 'boolean' ? { embeddable: v } : {};
}

/** The live video id held by a fresh per-channel entry built from YouTube data; '' otherwise. */
function freshLiveVideoId(channelId) {
  const hit = getCached(`yt-videos-${channelId}`);
  if (!hit || !hit.isFresh || hit.data?.dataOrigin !== 'youtube-api') return '';
  const id = hit.data.liveVideo?.videoId;
  return typeof id === 'string' && VIDEO_ID_RE.test(id) ? id : '';
}

const embedUrlFor = (id) => `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&playsinline=1`;

/** What the page reads of a channel: no description, fallback videos, priority or hint, so the list stays small. */
function toListEntry(c) {
  const out = {
    id: c.id, name: c.name, short: c.short, category: c.category, lists: c.lists || [], lang: c.lang, color: c.color, channelId: c.channelId,
    status: c.status, channelUrl: c.channelUrl, deskId: c.deskId, viewers: c.viewers ?? null,
  };
  if (c.officialName) out.officialName = c.officialName;
  if (c.defaultVideoId) out.defaultVideoId = c.defaultVideoId;
  if (c.embedUrl) out.embedUrl = c.embedUrl;
  if (c.liveVideoId) out.liveVideoId = c.liveVideoId;
  if (typeof c.embeddable === 'boolean') out.embeddable = c.embeddable; // whether YouTube lets its live video be embedded
  if (c.hinted) out.hinted = true; // its video is a remembered live one that YouTube confirmed, not a curated one
  return out;
}

export async function getLiveTvChannels(options = {}) {
  const category = (options.category || 'ALL').toUpperCase();
  const enabledChannels = YOUTUBE_SOURCES.filter((c) => c.enabled !== false);
  const found = await fetchLiveChannelIds(enabledChannels);
  const liveIds = new Set(found?.liveIds || []);
  const hints = found?.hints || {};

  // Copies: YOUTUBE_SOURCES is never changed. A channel is live here only when the video this page
  // plays (its defaultVideoId) is live; a live upload elsewhere on the channel does not count.
  // A channel someone opened recently may hold a live video of its own in the per-channel cache (written
  // by getLiveTvVideos from YouTube data). Read it from memory only: no request, no search.list (ADR 0009).
  let channels = enabledChannels.map((c) => {
    if (liveIds.has(c.id)) return { ...c, status: 'live', ...embeddableOf(found?.embeddable, c.defaultVideoId) };
    // A remembered live video that YouTube confirms is live now is the video to play; one that is not is ignored.
    if (hints[c.id]) return { ...c, status: 'live', defaultVideoId: hints[c.id], embedUrl: embedUrlFor(hints[c.id]), hinted: true, ...embeddableOf(found?.embeddable, hints[c.id]) };
    const liveVideoId = freshLiveVideoId(c.id);
    // `status` keeps its F367 meaning (the curated video is live); the client decides what to do with this.
    return liveVideoId ? { ...c, liveVideoId, ...cachedEmbeddable(c.id) } : { ...c };
  });

  if (category !== 'ALL') {
    channels = channels.filter((c) => c.category === category);
  }
  channels = channels.map(toListEntry);

  // Active channel defaults to first enabled channel or 'dd-news'
  const activeChannelId = channels.some((c) => c.id === 'dd-news')
    ? 'dd-news'
    : channels[0]?.id || 'dhruv-rathee';

  return {
    ok: true,
    channels,
    count: channels.length,
    activeChannelId,
    categories: LIVE_TV_CATEGORIES,
    lists: LIVE_TV_LISTS,
    selectedCategory: category,
  };
}

export async function getLiveTvVideos(channelId) {
  if (!channelId) {
    return { ok: false, error: 'channelId required', recentVideos: [], upcomingVideos: [] };
  }

  const channel = YOUTUBE_SOURCES.find((c) => c.id === channelId);
  if (!channel) {
    return {
      ok: false,
      error: `Channel not found: ${channelId}`,
      recentVideos: [],
      upcomingVideos: [],
    };
  }

  return await fetchYouTubeChannelVideos(channel);
}

export async function getLiveTvLiveStreams() {
  const liveChannels = [];
  for (const ch of (await getLiveTvChannels()).channels) {
    if (ch.status === 'live') {
      liveChannels.push({
        id: ch.id,
        name: ch.name,
        category: ch.category,
        embedUrl: ch.embedUrl,
        viewers: ch.viewers,
        color: ch.color,
      });
    }
  }
  return {
    ok: true,
    count: liveChannels.length,
    liveStreams: liveChannels,
  };
}

export function getLiveTvSchedule(channelId) {
  const chId = channelId || 'dd-news';
  const ch = YOUTUBE_SOURCES.find((c) => c.id === chId) || YOUTUBE_SOURCES[0];
  // F7 (F171 B8): no invented programmes; a channel without a published schedule has none.
  const items = CHANNEL_SCHEDULES[ch.id] || [];
  return {
    ok: true,
    channelId: ch.id,
    channelName: ch.name,
    date: new Date().toISOString().split('T')[0],
    items,
    ...(items.length ? {} : { message: 'Schedule not published' }),
  };
}

export function getLiveTvArchive(channelId) {
  let items = CHANNEL_ARCHIVES;
  if (channelId) {
    items = items.filter((a) => a.channelId === channelId);
  }
  return {
    ok: true,
    items,
    total: items.length,
  };
}

export function getLiveTvTranscript(broadcastId) {
  if (!broadcastId) {
    return {
      ok: false,
      error: 'broadcastId required',
      cues: [],
    };
  }

  const hit = BROADCAST_TRANSCRIPTS[broadcastId];
  if (hit) {
    return {
      ok: true,
      ...hit,
    };
  }

  // Explicit, honest unavailable state without fabricating synthetic cues
  return {
    ok: true,
    broadcastId,
    available: false,
    message: 'No transcript available.',
    cues: [],
  };
}

// ── HTTP Dispatcher & Middleware ──────────────────────────────────────────

export async function handleLiveTvApi(req, res, next) {
  const host = req.headers?.host || 'localhost';
  const url = new URL(req.url, `http://${host}`);
  const p = url.pathname.replace(/\/+$/, '');

  if (!p.startsWith('/api/livetv')) {
    if (typeof next === 'function') next();
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    json(res, { ok: false, error: 'GET or HEAD only' }, 405);
    return;
  }

  try {
    if (p === '/api/livetv/channels') {
      const category = url.searchParams.get('category') || 'ALL';
      json(res, await getLiveTvChannels({ category }));
      return;
    }

    if (p === '/api/livetv/live') {
      const liveData = await getLiveTvLiveStreams();
      json(res, liveData);
      return;
    }

    if (p === '/api/livetv/videos') {
      const channelId = url.searchParams.get('channelId') || url.searchParams.get('channel') || '';
      const videos = await getLiveTvVideos(channelId);
      json(res, videos, videos.ok ? 200 : 400);
      return;
    }

    if (p === '/api/livetv/schedule') {
      const channelId = url.searchParams.get('channel') || '';
      json(res, getLiveTvSchedule(channelId));
      return;
    }

    if (p === '/api/livetv/archive') {
      const channelId = url.searchParams.get('channel') || '';
      json(res, getLiveTvArchive(channelId));
      return;
    }

    if (p === '/api/livetv/transcript') {
      const broadcastId = url.searchParams.get('broadcastId') || '';
      const result = getLiveTvTranscript(broadcastId);
      json(res, result, result.ok ? 200 : 400);
      return;
    }

    json(res, { ok: false, error: 'Unknown Live TV endpoint' }, 404);
  } catch (err) {
    json(res, { ok: false, error: err.message || String(err) }, 500);
  }
}

export function liveTvApiPlugin() {
  return {
    name: 'niyantran-livetv-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const p = handleLiveTvApi(req, res, next);
        if (p && p.catch) p.catch(next);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const p = handleLiveTvApi(req, res, next);
        if (p && p.catch) p.catch(next);
      });
    },
  };
}
