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
const byId = (res, id) => res.channels.find((c) => c.id === id);

/** A videos.list answer in which the given videos are live and every other requested id is a plain video. */
function videosAnswer(url, liveVideoIds) {
  const ids = new URL(url).searchParams.get('id').split(',');
  return new Response(
    JSON.stringify({
      items: ids.map((id) => ({ id, snippet: { title: id, liveBroadcastContent: liveVideoIds.includes(id) ? 'live' : 'none' } })),
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
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]);
    expect(url.pathname).toBe('/youtube/v3/videos');
    expect(url.searchParams.get('part')).toBe('snippet');
    expect(calls[0]).not.toMatch(/search/);
    const ids = url.searchParams.get('id').split(',');
    expect(ids.length).toBeGreaterThan(1);
    expect(ids.length).toBeLessThanOrEqual(50);
    expect(ids.every((id) => ID11.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('skips a default video that is not a real 11-character id', async () => {
    const original = YOUTUBE_SOURCES[0].defaultVideoId;
    try {
      YOUTUBE_SOURCES[0].defaultVideoId = 'live';
      stubFetch((url) => videosAnswer(url, []));
      await getLiveTvChannels();
      const ids = new URL(calls[0]).searchParams.get('id').split(',');
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
    expect(calls).toHaveLength(1);
  });

  it('makes one request for concurrent list calls', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    stubFetch(async (url) => { await gate; return videosAnswer(url, []); });
    const all = Promise.all([getLiveTvChannels(), getLiveTvChannels(), getLiveTvChannels({ category: 'NEWS' })]);
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(calls).toHaveLength(1); // all three are waiting on the one open request
    release();
    await all;
    expect(calls).toHaveLength(1);
  });

  it('asks again after the ten-minute window', async () => {
    vi.useFakeTimers();
    stubFetch((url) => videosAnswer(url, []));
    await getLiveTvChannels();
    vi.setSystemTime(Date.now() + 10 * 60 * 1000 + 1000);
    await getLiveTvChannels();
    expect(calls).toHaveLength(2);
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

  it('on a non-OK answer returns the static list, and does not ask again for a minute', async () => {
    vi.useFakeTimers();
    stubFetch(() => new Response('quota', { status: 403 }));
    const res = await getLiveTvChannels();
    expect(res.ok).toBe(true);
    expect(statuses(res)).toEqual(staticStatuses());
    await getLiveTvChannels();
    expect(calls).toHaveLength(1);
    vi.setSystemTime(Date.now() + 61 * 1000);
    await getLiveTvChannels();
    expect(calls).toHaveLength(2);
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
    expect(Object.keys(res).sort()).toEqual(['activeChannelId', 'categories', 'channels', 'count', 'ok', 'selectedCategory']);
  });
});

describe('a failed answer frees the connection', () => {
  it('cancels the unread body of a non-OK answer', async () => {
    const cancel = vi.fn();
    stubFetch(() => ({ ok: false, status: 503, body: { cancel }, json: async () => ({}) }));
    await getLiveTvChannels();
    expect(cancel).toHaveBeenCalledTimes(1);
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
    expect(calls).toHaveLength(1);
  });
});
