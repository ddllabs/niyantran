// F380: Vercel's CDN may keep /api/livetv/channels and /api/livetv/videos for a minute. Every other
// Live TV path, every non-GET/HEAD method, every non-2xx answer and every answer that is not built from
// YouTube data stays `no-store`, so a quota or network problem is not pinned at the edge.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const live = vi.hoisted(() => ({ status: 200, body: {} }));

// Mirrors the real json() helper: sets no-store first, then answers with status and body.
vi.mock('../../server/liveTvApi.mjs', () => ({
  handleLiveTvApi: vi.fn(async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(live.status).json(live.body);
  }),
}));

import handler, { API_CACHE, cachePolicyFor } from '../../api/router.js';

function vercelResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader: vi.fn((name, value) => { res.headers[name.toLowerCase()] = value; }),
    status: vi.fn((code) => { res.statusCode = code; return res; }),
    json: vi.fn((body) => { res.body = body; return res; }),
    end: vi.fn(() => res),
  };
  return res;
}

const request = (method, route) => {
  const [path, query] = route.split('?');
  return {
    method,
    url: `/api/router?__route=${path}${query ? `&${query}` : ''}`,
    query: { __route: path },
    headers: { host: 'localhost' },
  };
};

const videosFromYouTube = { ok: true, source: 'youtube-api', channelId: 'x', dataOrigin: 'youtube-api', recentVideos: [] };
const send = async (method, route) => {
  const res = vercelResponse();
  await handler(request(method, route), res);
  return res;
};

describe('Live TV edge policy (F380)', () => {
  it('only GET and HEAD of channels and videos are edge-cached', () => {
    for (const path of ['/api/livetv/channels', '/api/livetv/videos']) {
      expect(cachePolicyFor(path, 'GET')).toBe('edge');
      expect(cachePolicyFor(path, 'HEAD')).toBe('edge');
      expect(cachePolicyFor(path, 'POST')).toBe('no-store');
    }
  });

  it.each(['/api/livetv', '/api/livetv/transcript', '/api/livetv/schedule', '/api/livetv/archive', '/api/livetv/live', '/api/livetv/channels/x', '/api/livetv/other'])(
    '%s stays no-store',
    (path) => {
      expect(cachePolicyFor(path, 'GET')).toBe('no-store');
    },
  );

  it('the Live TV CDN window is short', () => {
    expect(API_CACHE.cdnLiveTv).toBe('public, s-maxage=60, stale-while-revalidate=120');
  });
});

describe('Live TV cache headers on responses (F380)', () => {
  beforeEach(() => {
    live.status = 200;
    live.body = videosFromYouTube;
  });

  it('a 2xx videos answer from YouTube data is kept briefly, with the query string', async () => {
    const res = await send('GET', 'livetv/videos?channelId=dd-news');
    expect(res.headers['cache-control']).toBe(API_CACHE.browser);
    expect(res.headers['vercel-cdn-cache-control']).toBe(API_CACHE.cdnLiveTv);
  });

  it('a channels answer with dataOrigin youtube-api is kept briefly', async () => {
    live.body = { ok: true, channels: [], count: 0, dataOrigin: 'youtube-api' };
    const res = await send('GET', 'livetv/channels?category=ALL');
    expect(res.headers['cache-control']).toBe(API_CACHE.browser);
    expect(res.headers['vercel-cdn-cache-control']).toBe(API_CACHE.cdnLiveTv);
  });

  it('a HEAD request gets the same headers', async () => {
    const res = await send('HEAD', 'livetv/videos?channelId=dd-news');
    expect(res.headers['vercel-cdn-cache-control']).toBe(API_CACHE.cdnLiveTv);
  });

  it('a POST is never kept', async () => {
    const res = await send('POST', 'livetv/videos?channelId=dd-news');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['vercel-cdn-cache-control']).toBeUndefined();
  });

  it('transcript is never kept', async () => {
    live.body = { ok: true, broadcastId: 'b', cues: [] };
    const res = await send('GET', 'livetv/transcript?broadcastId=b');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['vercel-cdn-cache-control']).toBeUndefined();
  });

  it('a non-2xx answer is not kept', async () => {
    live.status = 400;
    live.body = { ...videosFromYouTube, ok: false, error: 'bad' };
    const res = await send('GET', 'livetv/videos?channelId=nope');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['vercel-cdn-cache-control']).toBeUndefined();
  });

  it('a 2xx answer with ok:false is not kept', async () => {
    live.body = { ...videosFromYouTube, ok: false };
    const res = await send('GET', 'livetv/videos?channelId=dd-news');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['vercel-cdn-cache-control']).toBeUndefined();
  });

  it.each(['fallback', undefined])('a videos answer with dataOrigin %s is not kept', async (dataOrigin) => {
    live.body = { ...videosFromYouTube, source: 'curated-fallback', dataOrigin, reason: 'quota' };
    const res = await send('GET', 'livetv/videos?channelId=dd-news');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['vercel-cdn-cache-control']).toBeUndefined();
  });

  it('channels without dataOrigin youtube-api is not kept', async () => {
    live.body = { ok: true, channels: [], count: 0 };
    const res = await send('GET', 'livetv/channels');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['vercel-cdn-cache-control']).toBeUndefined();
  });

  it('a channels answer that says it is a fallback is not kept', async () => {
    live.body = { ok: true, channels: [], dataOrigin: 'fallback' };
    const res = await send('GET', 'livetv/channels');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['vercel-cdn-cache-control']).toBeUndefined();
  });
});
