// F4 / ADR 0009: the YouTube live check must not use search.list (100 quota
// units). One refresh costs playlistItems.list + videos.list: 2 units.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CHANNEL = {
  id: 'fixture-news', name: 'Fixture News', channelId: 'UCabcdefghijklmnopqrstuv',
  defaultVideoId: 'CURATEDLIV1', fallbackVideos: [{ videoId: 'FALLBACK001', title: 'Fallback' }],
};
const upload = (id, title) => ({ snippet: { title, resourceId: { videoId: id }, thumbnails: {} } });
const video = (id, state) => ({ id, snippet: { title: id, liveBroadcastContent: state, thumbnails: {} } });

let urls;
function stubYouTube({ uploads = [], videos = [], videosFail = false } = {}) {
  urls = [];
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    urls.push(String(url));
    const u = new URL(url);
    if (u.pathname.endsWith('/playlistItems')) return { ok: true, json: async () => ({ items: uploads }) };
    if (u.pathname.endsWith('/videos')) {
      if (videosFail) return { ok: false, status: 403, json: async () => ({}) };
      const asked = new Set(u.searchParams.get('id').split(','));
      return { ok: true, json: async () => ({ items: videos.filter((v) => asked.has(v.id)) }) };
    }
    return { ok: true, json: async () => ({ items: [video('SEARCHHIT01', 'live')] }) };
  }));
}

let api;
beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('YOUTUBE_API_KEY', 'fixture-key');
  api = await import('../../server/liveTvApi.mjs');
  api.clearCache();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Live TV YouTube quota', () => {
  it('never calls search.list and spends two cheap calls per refresh', async () => {
    stubYouTube({ uploads: [upload('RECENT00001', 'Recent')], videos: [video('RECENT00001', 'none')] });
    await api.fetchYouTubeChannelVideos(CHANNEL);
    expect(urls.some((u) => u.includes('/youtube/v3/search'))).toBe(false);
    expect(urls.map((u) => new URL(u).pathname.split('/').pop())).toEqual(['playlistItems', 'videos']);
  });

  it('finds a live stream among recent uploads, and upcoming broadcasts', async () => {
    stubYouTube({
      uploads: [upload('LIVENOW0001', 'Live now'), upload('SOON0000001', 'Soon'), upload('OLD00000001', 'Old')],
      videos: [video('LIVENOW0001', 'live'), video('SOON0000001', 'upcoming'), video('OLD00000001', 'none'), video('CURATEDLIV1', 'none')],
    });
    const out = await api.fetchYouTubeChannelVideos(CHANNEL);
    expect(out.status).toBe('live');
    expect(out.liveVideo).toMatchObject({ videoId: 'LIVENOW0001', isLive: true });
    expect(out.upcomingVideos.map((v) => v.videoId)).toEqual(['SOON0000001']);
    expect(out.recentVideos.map((v) => v.videoId)).toEqual(['LIVENOW0001', 'SOON0000001', 'OLD00000001']);
  });

  it('checks the curated 24/7 stream even when it has left the recent uploads', async () => {
    stubYouTube({ uploads: [upload('RECENT00001', 'Recent')], videos: [video('RECENT00001', 'none'), video('CURATEDLIV1', 'live')] });
    const out = await api.fetchYouTubeChannelVideos(CHANNEL);
    expect(new URL(urls[1]).searchParams.get('id').split(',')).toEqual(['RECENT00001', 'CURATEDLIV1']);
    expect(out.liveVideo).toMatchObject({ videoId: 'CURATEDLIV1', isLive: true });
  });

  it('falls back to recent uploads without a live video when videos.list fails', async () => {
    stubYouTube({ uploads: [upload('RECENT00001', 'Recent')], videosFail: true });
    const out = await api.fetchYouTubeChannelVideos(CHANNEL);
    expect(out.liveVideo).toBeNull();
    expect(out.status).toBe('recent');
    expect(out.recentVideos.map((v) => v.videoId)).toEqual(['RECENT00001']);
  });
});
