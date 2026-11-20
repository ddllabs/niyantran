// F367: the channel list carries live state for every channel from ONE YouTube videos.list call
// (the channel's default video), cached for the module's 10 minutes. Mocked fetch, controlled env.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  YOUTUBE_SOURCES,
  clearCache,
  getLiveTvChannels,
  getLiveTvLiveStreams,
  setCached,
} from '../../server/liveTvApi.mjs';

const ID11 = /^[A-Za-z0-9_-]{11}$/;
const enabled = () => YOUTUBE_SOURCES.filter((c) => c.enabled !== false);
// Curated videos and remembered live videos, 50 to a videos.list request.
const askedIds = () => new Set(enabled().flatMap((c) => [c.defaultVideoId, c.liveHintVideoId]).filter((id) => ID11.test(id || '')));
const BATCHES = Math.ceil(askedIds().size / 50);
const byId = (res, id) => res.channels.find((c) => c.id === id);

/** A videos.list answer in which the given videos are live and every other requested id is a plain video. */
function videosAnswer(url, liveVideoIds) {
  const ids = new URL(url).searchParams.get('id').split(',');
  return new Response(
    JSON.stringify({
      items: ids.map((id) => ({
        id,
        snippet: { title: id, liveBroadcastContent: liveVideoIds.includes(id) ? 'live' : 'none' },
        ...(liveVideoIds.includes(id) ? { liveStreamingDetails: { actualStartTime: '2026-11-19T00:00:00Z' } } : {}),
      })),
    }),
    { status: 200 },
  );
}

let calls;
beforeEach(() => {
  clearCache();
  calls = [];
  vi.stubEnv('YOUTUBE_API_KEY', 'test-key-not-real');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const stubFetch = (impl) => vi.stubGlobal('fetch', vi.fn(async (url, init) => { calls.push(String(url)); return impl(String(url), init); }));

describe('the channel list marks live channels from one batched call', () => {
  it('marks a channel live when its default video is live, and leaves the others as they were', async () => {
    const dd = YOUTUBE_SOURCES.find((c) => c.id === 'dd-news');
    stubFetch((url) => videosAnswer(url, [dd.defaultVideoId]));
    const res = await getLiveTvChannels();
    expect(byId(res, 'dd-news').status).toBe('live');
    expect(res.channels.filter((c) => c.status === 'live')).toHaveLength(1);
    expect(res.count).toBe(res.channels.length);
  });

  it('asks YouTube once for all channels, with real 11-character ids only, 1-unit videos.list and no search', async () => {
    stubFetch((url) => videosAnswer(url, []));
    await getLiveTvChannels();
    expect(calls).toHaveLength(BATCHES);
    const all = [];
    for (const call of calls) {
      const url = new URL(call);
      expect(url.pathname).toBe('/youtube/v3/videos');
      expect(url.searchParams.get('part')).toBe('snippet,liveStreamingDetails,status'); // the same definition of live as the lookup; status says whether it may be embedded
      expect(call).not.toMatch(/search/);
      const ids = url.searchParams.get('id').split(',');
      expect(ids.length).toBeGreaterThan(0);
      expect(ids.length).toBeLessThanOrEqual(50);
      all.push(...ids);
    }
    expect(all.every((id) => ID11.test(id))).toBe(true);
    expect(new Set(all).size).toBe(all.length);
    expect(new Set(all)).toEqual(askedIds());
  });

  it('skips a default video that is not a real 11-character id', async () => {
    const original = YOUTUBE_SOURCES[0].defaultVideoId;
    try {
      YOUTUBE_SOURCES[0].defaultVideoId = 'live';
      stubFetch((url) => videosAnswer(url, []));
      await getLiveTvChannels();
      const ids = calls.flatMap((c) => new URL(c).searchParams.get('id').split(','));
      expect(ids).not.toContain('live');
      expect(ids.every((id) => ID11.test(id))).toBe(true);
    } finally {
      YOUTUBE_SOURCES[0].defaultVideoId = original;
    }
  });

  it('makes one request for many list calls inside the window', async () => {
    stubFetch((url) => videosAnswer(url, []));
    await getLiveTvChannels();
    await getLiveTvChannels({ category: 'NEWS' });
    await getLiveTvChannels();
    expect(calls).toHaveLength(BATCHES);
  });

  it('makes one request for concurrent list calls', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    stubFetch(async (url) => { await gate; return videosAnswer(url, []); });
    const all = Promise.all([getLiveTvChannels(), getLiveTvChannels(), getLiveTvChannels({ category: 'NEWS' })]);
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(calls).toHaveLength(BATCHES); // all three are waiting on the one open request
    release();
    await all;
    expect(calls).toHaveLength(BATCHES);
  });

  it('asks again after the ten-minute window', async () => {
    vi.useFakeTimers();
    stubFetch((url) => videosAnswer(url, []));
    await getLiveTvChannels();
    vi.setSystemTime(Date.now() + 10 * 60 * 1000 + 1000);
    await getLiveTvChannels();
    expect(calls).toHaveLength(2 * BATCHES);
  });

  it('does not let a per-channel "live" entry mark a channel whose default video is not live', async () => {
    stubFetch((url) => videosAnswer(url, []));
    setCached('yt-videos-wion', { channelId: 'wion', status: 'live', dataOrigin: 'youtube-api' });
    const res = await getLiveTvChannels();
    expect(byId(res, 'wion').status).toBe('recent');
  });

  it('says live when the batch says the default video is live, whatever a per-channel entry says', async () => {
    const wion = YOUTUBE_SOURCES.find((c) => c.id === 'wion');
    stubFetch((url) => videosAnswer(url, [wion.defaultVideoId]));
    setCached('yt-videos-wion', { channelId: 'wion', status: 'recent', dataOrigin: 'youtube-api' });
    const res = await getLiveTvChannels();
    expect(byId(res, 'wion').status).toBe('live');
  });
});

describe('a recently opened channel with a live video of its own (liveVideoId)', () => {
  const wion = () => YOUTUBE_SOURCES.find((c) => c.id === 'wion');
  const entry = (over = {}) => ({
    channelId: 'wion', status: 'live', dataOrigin: 'youtube-api',
    liveVideo: { videoId: 'LIVEvideo_1', embedUrl: 'https://www.youtube-nocookie.com/embed/LIVEvideo_1' }, ...over,
  });

  it('carries the live video id as its own field and keeps status for the curated video (F367), with no extra request', async () => {
    stubFetch((url) => videosAnswer(url, []));
    setCached('yt-videos-wion', entry());
    const res = await getLiveTvChannels();
    expect(byId(res, 'wion').status).toBe('recent'); // an older client reads status alone: never LIVE over a recording
    expect(byId(res, 'wion').liveVideoId).toBe('LIVEvideo_1');
    expect(calls).toHaveLength(BATCHES); // the one batched call of F367 and nothing for the entry
    expect(calls.every((u) => !/search/.test(u))).toBe(true);
  });

  it('carries no liveVideoId from a fallback, stale or expired entry, or an id that is not 11 characters', async () => {
    stubFetch((url) => videosAnswer(url, []));
    for (const over of [{ dataOrigin: 'fallback' }, { dataOrigin: 'stale' }, { liveVideo: { videoId: 'short' } }, { liveVideo: null }]) {
      clearCache();
      setCached('yt-videos-wion', entry(over));
      const res = await getLiveTvChannels();
      expect(byId(res, 'wion').status).toBe('recent');
      expect(byId(res, 'wion').liveVideoId).toBeUndefined();
    }
    vi.useFakeTimers();
    clearCache();
    setCached('yt-videos-wion', entry());
    vi.setSystemTime(Date.now() + 10 * 60 * 1000 + 1000);
    const res = await getLiveTvChannels();
    expect(byId(res, 'wion').liveVideoId).toBeUndefined();
  });

  it('adds no liveVideoId when the default video is itself live', async () => {
    stubFetch((url) => videosAnswer(url, [wion().defaultVideoId]));
    setCached('yt-videos-wion', entry());
    const res = await getLiveTvChannels();
    expect(byId(res, 'wion').status).toBe('live');
    expect(byId(res, 'wion').liveVideoId).toBeUndefined();
  });

  it('never changes YOUTUBE_SOURCES', async () => {
    stubFetch((url) => videosAnswer(url, []));
    setCached('yt-videos-wion', entry());
    const before = JSON.stringify(YOUTUBE_SOURCES);
    await getLiveTvChannels();
    expect(JSON.stringify(YOUTUBE_SOURCES)).toBe(before);
  });
});

describe('the channel list never gets worse than today', () => {
  const staticStatuses = () => Object.fromEntries(enabled().map((c) => [c.id, c.status]));
  const statuses = (res) => Object.fromEntries(res.channels.map((c) => [c.id, c.status]));

  it('with no key returns the static list and sends no request', async () => {
    vi.stubEnv('YOUTUBE_API_KEY', '');
    stubFetch((url) => videosAnswer(url, []));
    const res = await getLiveTvChannels();
    expect(calls).toHaveLength(0);
    expect(statuses(res)).toEqual(staticStatuses());
  });

  it('on a non-OK answer returns the static list, and does not ask again for five minutes', async () => {
    vi.useFakeTimers();
    stubFetch(() => new Response('unavailable', { status: 503 }));
    const res = await getLiveTvChannels();
    expect(res.ok).toBe(true);
    expect(statuses(res)).toEqual(staticStatuses());
    await getLiveTvChannels();
    expect(calls).toHaveLength(BATCHES);
    vi.setSystemTime(Date.now() + 61 * 1000); // past the old one-minute memory: still no call
    await getLiveTvChannels();
    expect(calls).toHaveLength(BATCHES);
    vi.setSystemTime(Date.now() + 238 * 1000); // 299 s after the failure
    await getLiveTvChannels();
    expect(calls).toHaveLength(BATCHES);
    vi.setSystemTime(Date.now() + 3 * 1000); // 302 s
    await getLiveTvChannels();
    expect(calls).toHaveLength(2 * BATCHES);
  });

  it('on a thrown fetch returns the static list', async () => {
    stubFetch(() => { throw new Error('network down'); });
    const res = await getLiveTvChannels();
    expect(res.ok).toBe(true);
    expect(statuses(res)).toEqual(staticStatuses());
  });

  it('on a body that is not a videos list returns the static list', async () => {
    stubFetch(() => new Response('{"error":{}}', { status: 200 }));
    const res = await getLiveTvChannels();
    expect(statuses(res)).toEqual(staticStatuses());
  });

  it('on a timeout aborts the request and returns the static list', async () => {
    vi.useFakeTimers();
    let aborted = false;
    stubFetch((url, init) => new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); });
    }));
    const pending = getLiveTvChannels();
    await vi.advanceTimersByTimeAsync(3500);
    const res = await pending;
    expect(aborted).toBe(true);
    expect(statuses(res)).toEqual(staticStatuses());
  });

  it('does not expose the key or the raw YouTube payload', async () => {
    const dd = YOUTUBE_SOURCES.find((c) => c.id === 'dd-news');
    stubFetch((url) => videosAnswer(url, [dd.defaultVideoId]));
    const res = await getLiveTvChannels();
    const text = JSON.stringify(res);
    expect(text).not.toContain('test-key-not-real');
    expect(text).not.toContain('liveBroadcastContent');
    expect(Object.keys(res).sort()).toEqual(['activeChannelId', 'categories', 'channels', 'count', 'lists', 'ok', 'selectedCategory']);
  });
});

describe('a failed answer frees the connection', () => {
  it('cancels the unread body of a non-OK answer', async () => {
    const cancel = vi.fn();
    stubFetch(() => ({ ok: false, status: 503, body: { cancel }, json: async () => ({}) }));
    await getLiveTvChannels();
    expect(cancel).toHaveBeenCalledTimes(BATCHES);
  });
});

describe('the channel list keeps its shape', () => {
  it('never mutates YOUTUBE_SOURCES', async () => {
    const dd = YOUTUBE_SOURCES.find((c) => c.id === 'dd-news');
    const before = JSON.stringify(YOUTUBE_SOURCES);
    stubFetch((url) => videosAnswer(url, [dd.defaultVideoId]));
    const res = await getLiveTvChannels();
    expect(byId(res, 'dd-news').status).toBe('live');
    expect(JSON.stringify(YOUTUBE_SOURCES)).toBe(before);
    expect(dd.status).toBe('recent');
    expect(res.channels[0]).not.toBe(YOUTUBE_SOURCES.find((c) => c.id === res.channels[0].id));
  });

  it('keeps the category filter, count, activeChannelId, categories and selectedCategory', async () => {
    const dd = YOUTUBE_SOURCES.find((c) => c.id === 'dd-news');
    stubFetch((url) => videosAnswer(url, [dd.defaultVideoId]));
    const all = await getLiveTvChannels();
    expect(all.selectedCategory).toBe('ALL');
    expect(all.activeChannelId).toBe('dd-news');
    expect(all.categories).toContain('NEWS');
    const news = await getLiveTvChannels({ category: 'news' });
    expect(news.selectedCategory).toBe('NEWS');
    expect(news.channels.every((c) => c.category === 'NEWS')).toBe(true);
    expect(news.count).toBe(news.channels.length);
    expect(byId(news, 'dd-news').status).toBe('live');
    const edu = await getLiveTvChannels({ category: 'EDUCATION' });
    expect(edu.channels.every((c) => c.category === 'EDUCATION')).toBe(true);
    expect(edu.activeChannelId).toBe(edu.channels[0].id);
  });
});

describe('the live-streams list uses the same data', () => {
  it('lists the channels the list marks live', async () => {
    const dd = YOUTUBE_SOURCES.find((c) => c.id === 'dd-news');
    stubFetch((url) => videosAnswer(url, [dd.defaultVideoId]));
    const live = await getLiveTvLiveStreams();
    expect(live.liveStreams.map((s) => s.id)).toEqual(['dd-news']);
    expect(live.count).toBe(1);
    expect(calls).toHaveLength(BATCHES);
  });
});
