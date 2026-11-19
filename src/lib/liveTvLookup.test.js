// B6: the live check with remembered live videos (hints), and the quota rules of the per-channel lookup
// (ADR 0009: no search.list). Mocked fetch, controlled env and clock.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  YOUTUBE_SOURCES, clearCache, getLiveTvChannels, fetchYouTubeChannelVideos, getLiveTvVideos, NO_LIVE_TTL_MS, QUOTA_BLOCK_MS,
} from '../../server/liveTvApi.mjs';

const byId = (res, id) => res.channels.find((c) => c.id === id);
const added = (id) => YOUTUBE_SOURCES.find((c) => c.id === id);
const MIN = 60 * 1000;

let calls;
const kind = (url) => new URL(url).pathname.split('/').pop();
const upload = (id, title = id) => ({ snippet: { title, resourceId: { videoId: id }, thumbnails: {} } });
const video = (id, state) => ({ id, snippet: { title: id, liveBroadcastContent: state, thumbnails: {} } });

/** A YouTube stand-in: `live` ids report live in videos.list; `uploads` are the channel's recent uploads. */
function stub({ live = [], uploads = [], status = 200 } = {}) {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    calls.push(String(url));
    if (status !== 200) return new Response('{}', { status });
    const u = new URL(url);
    if (kind(url) === 'playlistItems') return new Response(JSON.stringify({ items: uploads.map((id) => upload(id)) }), { status: 200 });
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
    // 13 curated + 47 remembered = 60 ids: two videos.list requests, 2 units per 10 minutes
    expect(calls).toHaveLength(2);
    const sizes = calls.map((u) => new URL(u).searchParams.get('id').split(',').length);
    expect(sizes).toEqual([50, 10]);
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

  it('keeps an answer that found no live video for thirty minutes', async () => {
    vi.useFakeTimers();
    stub({ uploads: ['RECENT00001'] });
    const first = await fetchYouTubeChannelVideos(CH());
    expect(first.dataOrigin).toBe('youtube-api');
    expect(first.liveVideo).toBeNull();
    const n = calls.length;
    expect(n).toBe(2); // playlistItems + videos: 2 units
    vi.setSystemTime(Date.now() + 25 * MIN);
    await fetchYouTubeChannelVideos(CH());
    expect(calls).toHaveLength(n);
    vi.setSystemTime(Date.now() + 6 * MIN);
    await fetchYouTubeChannelVideos(CH());
    expect(calls.length).toBeGreaterThan(n);
    expect(NO_LIVE_TTL_MS).toBe(30 * MIN);
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
      return new Response(JSON.stringify(kind(url) === 'playlistItems' ? { items: [upload('RECENT00001')] } : { items: [video('RECENT00001', 'none')] }), { status: 200 });
    }));
    const all = Promise.all([fetchYouTubeChannelVideos(CH()), fetchYouTubeChannelVideos(CH()), getLiveTvVideos(CH().id)]);
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(calls).toHaveLength(1); // the playlist request, shared by all three
    release();
    await all;
    expect(calls).toHaveLength(2);
  });

  it('asks about the remembered live video along with the recent uploads, so a 24-hour stream is found', async () => {
    const ch = added('abp-news');
    stub({ uploads: ['RECENT00001'], live: [ch.liveHintVideoId] });
    const out = await fetchYouTubeChannelVideos(ch);
    expect(out.liveVideo.videoId).toBe(ch.liveHintVideoId);
    expect(calls.some((u) => new URL(u).searchParams.get('id')?.split(',').includes(ch.liveHintVideoId))).toBe(true);
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

  it('stops asking when this instance has spent its daily units, and starts again the next day', async () => {
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
    vi.setSystemTime(new Date('2026-11-21T00:30:00Z'));
    clearCacheKeepingBudget();
    await fetchYouTubeChannelVideos(added('news18-india'));
    expect(calls.length).toBeGreaterThan(4);
  });
});

// The per-channel entries expire on their own; this just lets the next day's lookup run in a test.
function clearCacheKeepingBudget() { vi.advanceTimersByTime(40 * MIN); }
