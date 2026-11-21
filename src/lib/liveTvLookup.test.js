// B6: the live check with remembered live videos (hints), and the quota rules of the per-channel lookup
// (ADR 0009: no search.list). Mocked fetch, controlled env and clock.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  YOUTUBE_SOURCES, clearCache, getLiveTvChannels, fetchYouTubeChannelVideos, getLiveTvVideos, NO_LIVE_TTL_MS, QUOTA_BLOCK_MS,
  YOUTUBE_UNITS_PER_DAY, LIST_CHECK_FAILURES_PER_DAY, REQUEST_TIMEOUT_MS,
} from '../../server/liveTvApi.mjs';

const byId = (res, id) => res.channels.find((c) => c.id === id);
const added = (id) => YOUTUBE_SOURCES.find((c) => c.id === id);
const MIN = 60 * 1000;

let calls;
const kind = (url) => new URL(url).pathname.split('/').pop();
const upload = (id, title = id) => ({ snippet: { title, resourceId: { videoId: id }, thumbnails: {} } });
const video = (id, state) => ({
  id,
  snippet: { title: id, liveBroadcastContent: state, thumbnails: {} },
  status: { embeddable: true },
  ...(state === 'live' ? { liveStreamingDetails: { actualStartTime: '2026-11-19T00:00:00Z' } } : {}),
});

/** A YouTube stand-in: `live` ids report live in videos.list; `uploads` are the channel's recent uploads. */
function stub({ live = [], uploads = [], status = 200 } = {}) {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    calls.push(String(url));
    if (status !== 200) return new Response('{}', { status });
    const u = new URL(url);
    if (kind(url) === 'playlistItems') {
      if (u.searchParams.get('playlistId').startsWith('UULV')) return new Response(JSON.stringify({ error: { errors: [{ reason: 'playlistNotFound' }] } }), { status: 404 });
      return new Response(JSON.stringify({ items: uploads.map((id) => upload(id)) }), { status: 200 });
    }
    const asked = u.searchParams.get('id').split(',');
    return new Response(JSON.stringify({ items: asked.map((id) => video(id, live.includes(id) ? 'live' : 'none')) }), { status: 200 });
  }));
}

beforeEach(() => {
  clearCache();
  calls = [];
  vi.stubEnv('YOUTUBE_API_KEY', 'test-key-not-real');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('the batched live check with remembered live videos', () => {
  const ABP = () => added('abp-news');

  it('asks about the curated videos and the remembered ones together, 50 to a request, and says how many requests', async () => {
    stub();
    await getLiveTvChannels();
    // 13 curated + 51 remembered (47 added + 4 curated recordings) = 64 ids: two videos.list requests, 2 units per 10 minutes
    expect(calls).toHaveLength(2);
    const sizes = calls.map((u) => new URL(u).searchParams.get('id').split(',').length);
    expect(sizes).toEqual([50, 14]);
    expect(calls.every((u) => kind(u) === 'videos')).toBe(true);
    expect(calls.join(' ')).not.toMatch(/search/);
  });

  it('marks a channel live, with that video as the one to play, when YouTube confirms its remembered video', async () => {
    stub({ live: [ABP().liveHintVideoId] });
    const res = await getLiveTvChannels();
    const c = byId(res, 'abp-news');
    expect(c.status).toBe('live');
    expect(c.defaultVideoId).toBe(ABP().liveHintVideoId);
    expect(c.embedUrl).toContain(`/embed/${ABP().liveHintVideoId}?`);
    expect(JSON.stringify(c)).not.toContain('liveHintVideoId');
    expect(c.hinted).toBe(true); // marks its video as a remembered one, not a curated one
    expect(byId(res, 'dd-news').hinted).toBeUndefined();
  });

  it('ignores a remembered video that is no longer live: the channel has no video to play', async () => {
    stub();
    const c = byId(await getLiveTvChannels(), 'abp-news');
    expect(c.status).toBe('recent');
    expect(c.embedUrl).toBeUndefined();
    expect(c.defaultVideoId).toBeUndefined();
  });

  it('does not let a live remembered video change a curated channel', async () => {
    const dd = added('dd-news');
    stub({ live: [dd.defaultVideoId] });
    const res = await getLiveTvChannels();
    expect(byId(res, 'dd-news').defaultVideoId).toBe(dd.defaultVideoId);
    expect(res.channels.filter((c) => c.status === 'live').map((c) => c.id)).toEqual(['dd-news']);
  });

  describe('a live stream the per-channel lookup found (a new stream id after the hard-coded hint went stale)', () => {
    const NEW = 'NewLive_123'; // 11 characters, not a curated or hard-coded id
    const askedIds = () => calls.filter((u) => kind(u) === 'videos').flatMap((u) => new URL(u).searchParams.get('id').split(','));

    it('is asked about by the next list check, which marks the channel live with it', async () => {
      stub({ live: [NEW], uploads: [NEW] });
      await getLiveTvVideos('abp-news'); // the lookup finds NEW and remembers it
      calls = [];
      const c = byId(await getLiveTvChannels(), 'abp-news');
      expect(askedIds()).toContain(NEW);
      expect(c.status).toBe('live');
      expect(c.defaultVideoId).toBe(NEW);
      expect(c.embedUrl).toContain(`/embed/${NEW}?`);
      expect(c.hinted).toBe(true);
      expect(c.embeddable).toBe(true);
    });

    it('comes before a live hard-coded hint, and the hint is used when it is not live any more', async () => {
      stub({ live: [NEW], uploads: [NEW] });
      await getLiveTvVideos('abp-news');
      stub({ live: [NEW, ABP().liveHintVideoId] });
      expect(byId(await getLiveTvChannels(), 'abp-news').defaultVideoId).toBe(NEW);
    });

    it('is ignored when it is not live any more: a live hard-coded hint is used', async () => {
      vi.useFakeTimers();
      stub({ live: [NEW], uploads: [NEW] });
      await getLiveTvVideos('abp-news');
      calls = [];
      vi.setSystemTime(Date.now() + 11 * MIN); // past the list check's ten minutes
      stub({ live: [ABP().liveHintVideoId] });
      const c = byId(await getLiveTvChannels(), 'abp-news');
      expect(askedIds()).toContain(NEW);
      expect(c.defaultVideoId).toBe(ABP().liveHintVideoId);
    });

    it('never beats a live curated video', async () => {
      const dd = added('dd-news');
      stub({ live: [NEW], uploads: [NEW] });
      await getLiveTvVideos('dd-news');
      stub({ live: [dd.defaultVideoId, NEW] });
      const c = byId(await getLiveTvChannels(), 'dd-news');
      expect(c.status).toBe('live');
      expect(c.defaultVideoId).toBe(dd.defaultVideoId);
      expect(c.hinted).toBeUndefined();
    });

    it('still asks about every id once, in requests of at most 50, one unit each', async () => {
      stub({ live: [NEW], uploads: [NEW] });
      await getLiveTvVideos('abp-news');
      calls = [];
      await getLiveTvChannels();
      const ids = askedIds();
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.length).toBeGreaterThan(64); // the 64 ids of the plain check plus the remembered one
      expect(calls).toHaveLength(Math.ceil(ids.length / 50));
      expect(calls.map((u) => new URL(u).searchParams.get('id').split(',').length).every((n) => n <= 50)).toBe(true);
    });
  });

  it('remembers a 403 for thirty minutes: no request from the list or from a lookup', async () => {
    vi.useFakeTimers();
    stub({ status: 403 });
    const res = await getLiveTvChannels();
    expect(res.ok).toBe(true);
    expect(res.channels.every((c) => c.status !== 'live')).toBe(true);
    const n = calls.length;
    vi.setSystemTime(Date.now() + 5 * MIN);
    await getLiveTvChannels();
    await fetchYouTubeChannelVideos(added('abp-news'));
    expect(calls).toHaveLength(n);
    vi.setSystemTime(Date.now() + QUOTA_BLOCK_MS + MIN);
    stub();
    calls = [];
    await getLiveTvChannels();
    expect(calls.length).toBeGreaterThan(0);
  });
});

describe('the per-channel lookup: cache rules', () => {
  const CH = () => added('the-lallantop') || YOUTUBE_SOURCES.find((c) => c.lists.includes('politics') && !c.liveHintVideoId && c.id !== 'dhruv-rathee');

  it('keeps an answer that found no live video for sixty minutes', async () => {
    vi.useFakeTimers();
    stub({ uploads: ['RECENT00001'] });
    const first = await fetchYouTubeChannelVideos(CH());
    expect(first.dataOrigin).toBe('youtube-api');
    expect(first.liveVideo).toBeNull();
    const n = calls.length;
    expect(n).toBe(4); // the remembered video, the live-streams playlist (404), the uploads and their videos: 4 units
    vi.setSystemTime(Date.now() + 55 * MIN);
    await fetchYouTubeChannelVideos(CH());
    expect(calls).toHaveLength(n);
    vi.setSystemTime(Date.now() + 6 * MIN);
    await fetchYouTubeChannelVideos(CH());
    expect(calls.length).toBeGreaterThan(n);
    expect(NO_LIVE_TTL_MS).toBe(60 * MIN);
  });

  it('keeps an answer that found a live video for ten minutes', async () => {
    vi.useFakeTimers();
    stub({ uploads: ['LIVENOW0001'], live: ['LIVENOW0001'] });
    const first = await fetchYouTubeChannelVideos(CH());
    expect(first.liveVideo.videoId).toBe('LIVENOW0001');
    const n = calls.length;
    vi.setSystemTime(Date.now() + 9 * MIN);
    await fetchYouTubeChannelVideos(CH());
    expect(calls).toHaveLength(n);
    vi.setSystemTime(Date.now() + 2 * MIN);
    await fetchYouTubeChannelVideos(CH());
    expect(calls.length).toBeGreaterThan(n);
  });

  it('shares one lookup between callers that arrive together', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      calls.push(String(url));
      await gate;
      if (kind(url) === 'playlistItems' && new URL(url).searchParams.get('playlistId').startsWith('UULV')) return new Response('{}', { status: 404 });
      return new Response(JSON.stringify(kind(url) === 'playlistItems' ? { items: [upload('RECENT00001')] } : { items: [video('RECENT00001', 'none')] }), { status: 200 });
    }));
    const all = Promise.all([fetchYouTubeChannelVideos(CH()), fetchYouTubeChannelVideos(CH()), getLiveTvVideos(CH().id)]);
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(calls).toHaveLength(1); // the first request, shared by all three
    release();
    await all;
    // one lookup's calls, not three: the remembered video, the live-streams playlist (404), the uploads, their videos
    expect(calls).toHaveLength(4);
  });

  it('asks about the remembered live video first, so a 24-hour stream is found in one call', async () => {
    const ch = added('abp-news');
    stub({ uploads: ['RECENT00001'], live: [ch.liveHintVideoId] });
    const out = await fetchYouTubeChannelVideos(ch);
    expect(out.liveVideo.videoId).toBe(ch.liveHintVideoId);
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]).searchParams.get('id').split(',')).toContain(ch.liveHintVideoId);
  });
});

describe('the per-channel lookup: quota', () => {
  const A = () => added('abp-news');
  const B = () => added('zee-news');

  it('answers from the curated data on a 403, remembers it, and spends no second call', async () => {
    stub({ status: 403 });
    const out = await fetchYouTubeChannelVideos(A());
    expect(out.ok).toBe(true);
    expect(out.liveVideo).toBeNull();
    expect(out.recentVideos).toEqual([]);
    expect(out.dataOrigin).toBe('fallback');
    expect(calls).toHaveLength(1);
  });

  it('does not retry on every request: other channels, and the same channel later, make no call until the block ends', async () => {
    vi.useFakeTimers();
    stub({ status: 403 });
    await fetchYouTubeChannelVideos(A());
    const n = calls.length;
    const other = await fetchYouTubeChannelVideos(B());
    expect(other.dataOrigin).toBe('fallback');
    vi.setSystemTime(Date.now() + 12 * MIN);
    await fetchYouTubeChannelVideos(A());
    expect(calls).toHaveLength(n);
    vi.setSystemTime(Date.now() + QUOTA_BLOCK_MS);
    stub();
    calls = [];
    await fetchYouTubeChannelVideos(A());
    expect(calls.length).toBeGreaterThan(0);
  });

  it('never calls search.list', async () => {
    stub({ uploads: ['RECENT00001'] });
    await fetchYouTubeChannelVideos(A());
    await fetchYouTubeChannelVideos(B());
    expect(calls.every((u) => ['playlistItems', 'videos'].includes(kind(u)))).toBe(true);
  });

  it('stops asking when this instance has spent its daily units', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-20T10:00:00Z'));
    vi.stubEnv('LIVETV_LOOKUP_UNITS_PER_DAY', '4');
    stub({ uploads: ['RECENT00001'] });
    await fetchYouTubeChannelVideos(A()); // 2 units
    await fetchYouTubeChannelVideos(B()); // 2 units: 4 spent
    expect(calls).toHaveLength(4);
    const third = await fetchYouTubeChannelVideos(added('news18-india'));
    expect(calls).toHaveLength(4);
    expect(third.dataOrigin).toBe('fallback');
    expect(third.reason).toBe('budget');
  });
});

describe('the daily budget: a YouTube day is a Pacific day, and the list check is in it', () => {
  const A = () => added('abp-news');
  const B = () => added('zee-news');
  const run = async (when) => { vi.setSystemTime(new Date(when)); await fetchYouTubeChannelVideos(A()); };

  it('is not renewed at UTC midnight, which is mid-afternoon in California', async () => {
    vi.useFakeTimers();
    vi.stubEnv('LIVETV_LOOKUP_UNITS_PER_DAY', '2');
    stub({ uploads: ['RECENT00001'] });
    await run('2026-11-19T23:30:00Z'); // 15:30 Pacific, 2 units: spent
    expect(calls).toHaveLength(2);
    vi.setSystemTime(new Date('2026-11-20T00:30:00Z')); // a new UTC date, the same Pacific day
    await fetchYouTubeChannelVideos(B());
    expect(calls).toHaveLength(2);
  });

  it('is renewed at midnight Pacific', async () => {
    vi.useFakeTimers();
    vi.stubEnv('LIVETV_LOOKUP_UNITS_PER_DAY', '2');
    stub({ uploads: ['RECENT00001'] });
    await run('2026-11-20T07:30:00Z'); // 23:30 Pacific on the 19th
    expect(calls).toHaveLength(2);
    vi.setSystemTime(new Date('2026-11-20T08:30:00Z')); // 00:30 Pacific on the 20th
    await fetchYouTubeChannelVideos(B());
    expect(calls).toHaveLength(4);
  });

  it('counts the list check and the lookups together, and stops a lookup when the units run out', async () => {
    vi.stubEnv('LIVETV_LOOKUP_UNITS_PER_DAY', '3');
    stub({ uploads: ['RECENT00001'] });
    await getLiveTvChannels(); // two videos.list requests: 2 units
    expect(calls).toHaveLength(2);
    const out = await fetchYouTubeChannelVideos(A()); // the first step takes the last unit; the next has none
    expect(calls).toHaveLength(3);
    expect(out.dataOrigin).toBe('fallback');
    expect(out.reason).toBe('budget');
  });

  it('does not start a list check it cannot finish', async () => {
    vi.stubEnv('LIVETV_LOOKUP_UNITS_PER_DAY', '1');
    stub();
    const res = await getLiveTvChannels(); // needs two requests, has one unit
    expect(calls).toHaveLength(0);
    expect(res.channels.every((c) => c.status !== 'live')).toBe(true);
  });

  it('limits how often a failing list check is tried in a day', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-20T10:00:00Z'));
    stub({ status: 503 });
    for (let i = 0; i < 40; i += 1) {
      await getLiveTvChannels();
      vi.setSystemTime(new Date(Date.now() + 6 * MIN));
    }
    expect(calls.length).toBeLessThanOrEqual(LIST_CHECK_FAILURES_PER_DAY * 2);
    expect(calls.length).toBeGreaterThan(0);
  });
});

describe('the units a day', () => {
  it('is 3,000 by default, for everything one instance asks YouTube', () => {
    expect(YOUTUBE_UNITS_PER_DAY).toBe(3000);
  });
  it('is read as a number of units, 0 or more; 0 means no YouTube calls at all', async () => {
    stub();
    vi.stubEnv('LIVETV_LOOKUP_UNITS_PER_DAY', '0');
    await getLiveTvChannels();
    const out = await fetchYouTubeChannelVideos(added('abp-news'));
    expect(calls).toHaveLength(0);
    expect(out.reason).toBe('budget');
  });
  it.each(['-5', 'abc', '', ' ', 'NaN', 'Infinity'])('treats %j as not set', async (raw) => {
    stub();
    vi.stubEnv('LIVETV_LOOKUP_UNITS_PER_DAY', raw);
    await getLiveTvChannels();
    expect(calls.length).toBeGreaterThan(0); // the default budget applies
  });
});

describe('a request that hangs', () => {
  it('answers from the curated data after four seconds, and frees the shared lookup', async () => {
    vi.useFakeTimers();
    let aborted = 0;
    vi.stubGlobal('fetch', vi.fn((url, init) => {
      calls.push(String(url));
      return new Promise((_, reject) => { init.signal.addEventListener('abort', () => { aborted += 1; reject(new Error('aborted')); }); });
    }));
    const pending = fetchYouTubeChannelVideos(added('abp-news'));
    await vi.advanceTimersByTimeAsync(4100);
    const out = await pending;
    expect(aborted).toBe(1);
    expect(out.dataOrigin).toBe('fallback');
    expect(out.reason).toBe('timeout');
    expect(REQUEST_TIMEOUT_MS).toBe(4000);
    // a failure is kept a minute only: a minute later the lookup is made again
    await vi.advanceTimersByTimeAsync(61 * 1000);
    stub({ uploads: ['RECENT00001'] });
    calls = [];
    await fetchYouTubeChannelVideos(added('abp-news'));
    expect(calls.length).toBeGreaterThan(0);
  });
});

describe('a 403 is blocked for the whole key only when it is about the key or the quota', () => {
  const refuse = (reason, status = 403) => vi.stubGlobal('fetch', vi.fn(async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify(reason === undefined ? {} : { error: { errors: [{ reason }] } }), { status });
  }));
  it.each(['quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded', 'userRateLimitExceeded', 'accessNotConfigured', 'keyInvalid', 'forbidden', undefined])(
    'reason %s: nothing else is asked for thirty minutes',
    async (reason) => {
      refuse(reason);
      await fetchYouTubeChannelVideos(added('abp-news'));
      const n = calls.length;
      const other = await fetchYouTubeChannelVideos(added('zee-news'));
      expect(calls).toHaveLength(n);
      expect(other.reason).toBe('quota');
    },
  );
  it('a private playlist is only that channel: other channels are still asked, and this one is not asked again for a while', async () => {
    vi.useFakeTimers();
    refuse('playlistItemsNotAccessible');
    const first = await fetchYouTubeChannelVideos(added('abp-news'));
    expect(first.dataOrigin).toBe('fallback');
    expect(first.reason).toBe('inaccessible');
    const n = calls.length;
    await fetchYouTubeChannelVideos(added('abp-news'));
    expect(calls).toHaveLength(n);
    vi.setSystemTime(Date.now() + 29 * MIN); // still remembered after 29 minutes
    await fetchYouTubeChannelVideos(added('abp-news'));
    expect(calls).toHaveLength(n);
    await fetchYouTubeChannelVideos(added('zee-news'));
    expect(calls.length).toBeGreaterThan(n);
    const list = await getLiveTvChannels();
    expect(list.ok).toBe(true);
    vi.setSystemTime(Date.now() + 2 * MIN); // 31 minutes: asked again
    const before = calls.length;
    await fetchYouTubeChannelVideos(added('abp-news'));
    expect(calls.length).toBeGreaterThan(before);
  });

  it('a private videos.list is kept thirty minutes for that channel too, and a missing playlist is "inaccessible"', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      calls.push(String(url));
      if (kind(url) === 'playlistItems') return new Response(JSON.stringify({ items: [upload('RECENT00001')] }), { status: 200 });
      return new Response(JSON.stringify({ error: { errors: [{ reason: 'videoNotAccessible' }] } }), { status: 403 });
    }));
    const first = await fetchYouTubeChannelVideos(added('abp-news'));
    expect(first.reason).toBe('inaccessible');
    const n = calls.length;
    vi.setSystemTime(Date.now() + 29 * MIN);
    await fetchYouTubeChannelVideos(added('abp-news'));
    expect(calls).toHaveLength(n);
    vi.setSystemTime(Date.now() + 2 * MIN);
    await fetchYouTubeChannelVideos(added('abp-news'));
    expect(calls.length).toBeGreaterThan(n);
  });

  it('a 404 playlistNotFound is that channel only, kept thirty minutes', async () => {
    vi.useFakeTimers();
    refuse('playlistNotFound', 404);
    const first = await fetchYouTubeChannelVideos(added('abp-news'));
    expect(first.reason).toBe('inaccessible');
    const n = calls.length;
    vi.setSystemTime(Date.now() + 29 * MIN);
    await fetchYouTubeChannelVideos(added('abp-news'));
    expect(calls).toHaveLength(n);
    await fetchYouTubeChannelVideos(added('zee-news')); // the key is fine
    expect(calls.length).toBeGreaterThan(n);
  });

  it.each([
    ['reason keyInvalid', { error: { errors: [{ reason: 'keyInvalid' }] } }],
    ['a bad request about the API key', { error: { message: 'API key not valid. Please pass a valid API key.', errors: [{ reason: 'badRequest' }] } }],
  ])('an HTTP 400 with %s blocks the whole key for thirty minutes', async (_n, body) => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (url) => { calls.push(String(url)); return new Response(JSON.stringify(body), { status: 400 }); }));
    const first = await fetchYouTubeChannelVideos(added('abp-news'));
    expect(first.reason).toBe('quota');
    const n = calls.length;
    const other = await fetchYouTubeChannelVideos(added('zee-news'));
    expect(calls).toHaveLength(n);
    expect(other.reason).toBe('quota');
    vi.setSystemTime(Date.now() + 31 * MIN);
    stub({ uploads: ['RECENT00001'] });
    calls = [];
    await fetchYouTubeChannelVideos(added('abp-news'));
    expect(calls.length).toBeGreaterThan(0);
  });

  it('an HTTP 400 about something else is only that call', async () => {
    refuse('invalidPageToken', 400);
    const first = await fetchYouTubeChannelVideos(added('abp-news'));
    expect(first.reason).toBe('error');
    const n = calls.length;
    await fetchYouTubeChannelVideos(added('zee-news'));
    expect(calls.length).toBeGreaterThan(n);
  });
  it('a server error is kept for a minute and gives the reason error', async () => {
    vi.useFakeTimers();
    refuse(undefined, 500);
    const out = await fetchYouTubeChannelVideos(added('abp-news'));
    expect(out.reason).toBe('error');
    const n = calls.length;
    vi.setSystemTime(Date.now() + 61 * 1000);
    await fetchYouTubeChannelVideos(added('abp-news'));
    expect(calls.length).toBeGreaterThan(n);
  });
});

describe('parallel requests and a small budget', () => {
  it('spend exactly the budget: six lookups at once at three units make three requests', async () => {
    vi.stubEnv('LIVETV_LOOKUP_UNITS_PER_DAY', '3');
    stub({ uploads: ['RECENT00001'] });
    const ids = ['abp-news', 'zee-news', 'india-tv', 'news18-india', 'ndtv-india', 'republic-bharat'];
    const out = await Promise.all(ids.map((id) => fetchYouTubeChannelVideos(added(id))));
    expect(calls).toHaveLength(3);
    expect(out.every((o) => o.ok)).toBe(true);
  });
  it('list checks and lookups together never pass the budget either', async () => {
    vi.stubEnv('LIVETV_LOOKUP_UNITS_PER_DAY', '4');
    stub({ uploads: ['RECENT00001'] });
    await Promise.all([getLiveTvChannels(), fetchYouTubeChannelVideos(added('abp-news')), fetchYouTubeChannelVideos(added('zee-news')), fetchYouTubeChannelVideos(added('india-tv'))]);
    expect(calls.length).toBeLessThanOrEqual(4);
  });
});

describe('a videos.list that fails part-way through a lookup', () => {
  it('gives a fallback answer with reason error, kept a minute, and is not cached as "nothing live"', async () => {
    vi.useFakeTimers();
    let videosCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      calls.push(String(url));
      if (kind(url) === 'playlistItems') {
        if (new URL(url).searchParams.get('playlistId').startsWith('UULV')) return new Response('{}', { status: 404 });
        return new Response(JSON.stringify({ items: [upload('RECENT00001')] }), { status: 200 });
      }
      videosCalls += 1;
      if (videosCalls === 2) return new Response('{}', { status: 500 }); // the verify of the uploads
      return new Response(JSON.stringify({ items: [video('RECENT00001', 'none')] }), { status: 200 });
    }));
    const out = await fetchYouTubeChannelVideos(added('abp-news'));
    expect(out.dataOrigin).toBe('fallback');
    expect(out.reason).toBe('error');
    expect(out.liveVideo).toBeNull();
    const n = calls.length;
    vi.setSystemTime(Date.now() + 59 * 1000);
    await fetchYouTubeChannelVideos(added('abp-news'));
    expect(calls).toHaveLength(n); // kept for a minute
    vi.setSystemTime(Date.now() + 2 * 1000);
    await fetchYouTubeChannelVideos(added('abp-news'));
    expect(calls.length).toBeGreaterThan(n); // and not for the hour a "nothing live" answer is kept
  });
});

describe('what the answer says about where it came from', () => {
  it('has no reason, and dataOrigin youtube-api, when YouTube answered', async () => {
    stub({ uploads: ['RECENT00001'] });
    const out = await fetchYouTubeChannelVideos(added('abp-news'));
    expect(out.dataOrigin).toBe('youtube-api');
    expect(out.reason).toBeUndefined();
  });
  it('says no-key without a key', async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('YOUTUBE_API_KEY', '');
    const out = await fetchYouTubeChannelVideos(added('abp-news'));
    expect(out.reason).toBe('no-key');
  });
  it('treats a channel with no uploads at all as known: nothing live, nothing to show', async () => {
    stub({ uploads: [] });
    const out = await fetchYouTubeChannelVideos(added('theprint'));
    expect(out.dataOrigin).toBe('youtube-api');
    expect(out.recentVideos).toEqual([]);
  });
});
