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

export const YOUTUBE_SOURCES = [
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
        title: 'Electoral Bonds | The Biggest Scam in History of India? | Explained by Dhruv Rathee',
        thumbnail: 'https://i.ytimg.com/vi/RJfqzUWZ0Bw/hqdefault.jpg',
        embedUrl: 'https://www.youtube-nocookie.com/embed/RJfqzUWZ0Bw?autoplay=1&mute=1&playsinline=1',
      },
      {
        videoId: '-e72F_bBcqA',
        title: 'Sad Reality of Uttarkashi Tunnel Rescue | 3D Animation | Dhruv Rathee',
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
    channelUrl: 'https://www.youtube.com/@thethinkschoool',
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
        title: 'Elon Musk & Dario’s Final Warning | Why the AI Race Is Getting Dangerously Out of Control? | Think School',
        thumbnail: 'https://i.ytimg.com/vi/UY9H83yQnzc/hqdefault.jpg',
        embedUrl: 'https://www.youtube-nocookie.com/embed/UY9H83yQnzc?autoplay=1&mute=1&playsinline=1',
      },
      {
        videoId: 'ky6jesFvIqY',
        title: 'BETRAYAL OF SAUDI ARABIA? | Why America Abandoned Saudi Arabia in Its Darkest Hour? | Think School',
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
    channelId: 'UCi593U-17_44m_1u82fH7aA',
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
        title: 'Anti Tank Missile | Javelin Anti Tank Missile | Military Tank | How Javelin Missile work | Khan GS Research Centre',
        thumbnail: 'https://i.ytimg.com/vi/ECoO7eyknPs/hqdefault.jpg',
        embedUrl: 'https://www.youtube-nocookie.com/embed/ECoO7eyknPs?autoplay=1&mute=1&playsinline=1',
      },
      {
        videoId: '4SyrQHSmQlQ',
        title: 'Raksha Bandhan 2026 Full Video | Rakhi 2026 By Khan Sir | Khan GS Research Centre',
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
    channelId: 'UC1m-g8kn_8r2q_3hS-gZTAg',
    channelUrl: 'https://www.youtube.com/@sochbymohakmangal',
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
        title: 'How One IAS Officer Exposed India’s Food Mafia | Mohak Mangal',
        thumbnail: 'https://i.ytimg.com/vi/3MtJg5rJars/hqdefault.jpg',
        embedUrl: 'https://www.youtube-nocookie.com/embed/3MtJg5rJars?autoplay=1&mute=1&playsinline=1',
      },
      {
        videoId: 'E4tNtZO6_6M',
        title: "Inside Air India's Most Disturbing Flight Incident | Mohak Mangal",
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
    channelId: 'UCxS3xG08x22oD8i7r_21W_g',
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
        title: 'Powering America: Rethinking the Economics of Transmission | Center for Strategic & International Studies',
        thumbnail: 'https://i.ytimg.com/vi/7ncDwpDZkho/hqdefault.jpg',
        embedUrl: 'https://www.youtube-nocookie.com/embed/7ncDwpDZkho?autoplay=1&mute=1&playsinline=1',
      },
      {
        videoId: 'urj_IlvLo5A',
        title: "Red Lines and Reality: The West's Escalation Dilemma in Ukraine | Center for Strategic & International Studies",
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
    channelId: 'UCUB_yGV7wtjWFP_uw3RtT2A',
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
    channelId: 'UC_x5XG1OV2P6uZZ5FSM9Ttw',
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
    embedUrl: 'https://www.youtube-nocookie.com/embed/live_stream?channel=UC_x5XG1OV2P6uZZ5FSM9Ttw&autoplay=1&mute=1',
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
  const isFresh = Date.now() - hit.timestamp < CACHE_TTL_MS;
  return { data: hit.data, isFresh, timestamp: hit.timestamp };
}

export function setCached(key, data) {
  memoryCache.set(key, { data, timestamp: Date.now() });
}

export function clearCache() {
  memoryCache.clear();
}

/**
 * Normalizes YouTube video item to uniform NTER video schema.
 */
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
    title: snippet.title || item.title || 'Broadcast Segment',
    description: snippet.description || item.description || '',
    thumbnail: thumbUrl,
    publishedAt: snippet.publishedAt || item.publishedAt || new Date().toISOString(),
    duration: item.duration || (isLive ? 'LIVE' : 'Segment'),
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

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    // Graceful fallback to curated channel data when API key is not configured
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
    };
    setCached(cacheKey, fallbackData);
    return { ok: true, source: 'curated-fallback', ...fallbackData };
  }

  try {
    // Quota (ADR 0009): search.list costs 100 units, so it is not used. One
    // refresh is playlistItems.list (1 unit) for the recent uploads, then
    // videos.list (1 unit, up to 50 ids) for their live state. The channel's
    // curated live video is added to that call, because a long-running 24/7
    // stream drops out of the recent uploads.
    const playlistId = 'UU' + channel.channelId.slice(2);
    const playlistUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${encodeURIComponent(
      playlistId,
    )}&maxResults=6&key=${encodeURIComponent(apiKey)}`;

    let uploads = [];
    try {
      const pResp = await fetch(playlistUrl, { headers: { Accept: 'application/json' } });
      if (pResp.ok) {
        const pData = await pResp.json();
        if (Array.isArray(pData.items)) uploads = pData.items;
      }
    } catch (e) {
      // Ignore playlist failure
    }

    const uploadIds = uploads
      .map((it) => extractYouTubeVideoId(it?.snippet?.resourceId?.videoId || it?.id?.videoId || ''))
      .filter((id) => /^[a-zA-Z0-9_-]{11}$/.test(id));
    const curated = /^[a-zA-Z0-9_-]{11}$/.test(channel.defaultVideoId || '') ? [channel.defaultVideoId] : [];
    const ids = [...new Set([...uploadIds, ...curated])].slice(0, 50);

    const details = new Map();
    if (ids.length) {
      try {
        const videosUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(
          ids.join(','),
        )}&key=${encodeURIComponent(apiKey)}`;
        const vResp = await fetch(videosUrl, { headers: { Accept: 'application/json' } });
        if (vResp.ok) {
          const vData = await vResp.json();
          for (const it of Array.isArray(vData.items) ? vData.items : []) {
            if (typeof it?.id === 'string') details.set(it.id, it);
          }
        }
      } catch (e) {
        // Ignore the live-state check; recent uploads still show
      }
    }

    const stateOf = (id) => details.get(id)?.snippet?.liveBroadcastContent;
    const liveId = ids.find((id) => stateOf(id) === 'live');
    const liveVideo = liveId ? normalizeYouTubeVideo(details.get(liveId), channel.id) : null;
    if (liveVideo) liveVideo.isLive = true;
    const upcomingVideos = ids
      .filter((id) => stateOf(id) === 'upcoming')
      .map((id) => normalizeYouTubeVideo(details.get(id), channel.id))
      .filter(Boolean);

    let recentVideos = uploads
      .map((it) => {
        const id = extractYouTubeVideoId(it?.snippet?.resourceId?.videoId || it?.id?.videoId || '');
        return normalizeYouTubeVideo(details.get(id) || it, channel.id);
      })
      .filter(Boolean);

    // If API returned no recent videos, fall back to configured fallback videos
    if (recentVideos.length === 0 && Array.isArray(channel.fallbackVideos)) {
      recentVideos = channel.fallbackVideos.map((v) => normalizeYouTubeVideo(v, channel.id));
    }

    const status = liveVideo ? 'live' : recentVideos.length > 0 ? 'recent' : 'offline';

    const result = {
      channelId: channel.id,
      channelName: channel.name,
      status,
      liveVideo,
      recentVideos,
      upcomingVideos,
    };

    setCached(cacheKey, result);
    return { ok: true, source: 'youtube-api', ...result };
  } catch (err) {
    // If YouTube API fails (quota / network), return stale cache or curated fallback
    if (cached) {
      return { ok: true, source: 'stale-cache', ...cached.data };
    }
    const fallbackData = {
      channelId: channel.id,
      channelName: channel.name,
      status: channel.status || 'recent',
      liveVideo: null,
      recentVideos: (channel.fallbackVideos || []).map((v) => normalizeYouTubeVideo(v, channel.id)),
      upcomingVideos: [],
    };
    return { ok: true, source: 'curated-fallback', error: err.message, ...fallbackData };
  }
}

// ── Public API Handlers ────────────────────────────────────────────────────

export function getLiveTvChannels(options = {}) {
  const category = (options.category || 'ALL').toUpperCase();
  let channels = YOUTUBE_SOURCES.filter((c) => c.enabled !== false);

  if (category !== 'ALL') {
    channels = channels.filter((c) => c.category === category);
  }

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
  for (const ch of YOUTUBE_SOURCES) {
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
      json(res, getLiveTvChannels({ category }));
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
