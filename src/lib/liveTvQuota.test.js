// F4 / ADR 0009: the YouTube live check must not use search.list (100 quota
// units). One refresh costs playlistItems.list + videos.list: 2 units.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CHANNEL = {
  id: 'fixture-news', name: 'Fixture News', channelId: 'UCabcdefghijklmnopqrstuv',
  defaultVideoId: 'CURATEDLIV1', fallbackVideos: [{ videoId: 'FALLBACK001', title: 'Fallback' }],
};
const upload = (id, title) => ({ snippet: { title, resourceId: { videoId: id }, thumbnails: {} } });
// Live means started and not ended (liveStreamingDetails); an announced broadcast has only a scheduled start.
const video = (id, state) => ({
  id,
  snippet: { title: id, liveBroadcastContent: state, thumbnails: {} },
  status: { embeddable: true },
  ...(state === 'live' ? { liveStreamingDetails: { actualStartTime: '2026-11-19T00:00:00Z' } } : state === 'upcoming' ? { liveStreamingDetails: { scheduledStartTime: '2026-11-21T00:00:00Z' } } : {}),
});

let urls;
function stubYouTube({ uploads = [], videos = [], videosFail = false, videosFailReason = '' } = {}) {
  urls = [];
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    urls.push(String(url));
    const u = new URL(url);
    if (u.pathname.endsWith('/playlistItems')) {
      // a channel's live-streams playlist (UULV…) does not exist for these fixtures
      if (u.searchParams.get('playlistId').startsWith('UULV')) return { ok: false, status: 404, json: async () => ({ error: { errors: [{ reason: 'playlistNotFound' }] } }) };
      return { ok: true, json: async () => ({ items: uploads }) };
    }
    if (u.pathname.endsWith('/videos')) {
      if (videosFail) return { ok: false, status: 403, json: async () => (videosFailReason ? { error: { errors: [{ reason: videosFailReason }] } } : {}) };
      const asked = new Set(u.searchParams.get('id').split(','));
      return { ok: true, json: async () => ({ items: videos.filter((v) => asked.has(v.id)) }) };
    }
    return { ok: true, json: async () => ({ items: [video('SEARCHHIT01', 'live')] }) };
  }));
}

function stubYouTubeKey() { stubYouTube({ uploads: [upload('RECENT00001', 'Recent')], videosFail: true, videosFailReason: 'quotaExceeded' }); }

let api;
beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('YOUTUBE_API_KEY', 'fixture-key');
  api = await import('../../server/liveTvApi.mjs');
  api.clearCache();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Live TV YouTube quota', () => {
  it('never calls search.list; with nothing live it takes the curated video, the live-streams playlist (missing here) and the uploads: four calls', async () => {
    stubYouTube({ uploads: [upload('RECENT00001', 'Recent')], videos: [video('RECENT00001', 'none'), video('CURATEDLIV1', 'none')] });
    await api.fetchYouTubeChannelVideos(CHANNEL);
    expect(urls.some((u) => u.includes('/youtube/v3/search'))).toBe(false);
    expect(urls.map((u) => new URL(u).pathname.split('/').pop())).toEqual(['videos', 'playlistItems', 'playlistItems', 'videos']);
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
    expect(out.recentVideos.map((v) => v.videoId)).toEqual(['OLD00000001']); // not the live or the announced one
  });

  it('checks the curated 24/7 stream even when it has left the recent uploads', async () => {
    stubYouTube({ uploads: [upload('RECENT00001', 'Recent')], videos: [video('RECENT00001', 'none'), video('CURATEDLIV1', 'live')] });
    const out = await api.fetchYouTubeChannelVideos(CHANNEL);
    expect(urls).toHaveLength(1); // found by the first step: the curated video, one call
    expect(new URL(urls[0]).searchParams.get('id').split(',')).toEqual(['CURATEDLIV1']);
    expect(out.liveVideo).toMatchObject({ videoId: 'CURATEDLIV1', isLive: true });
  });

  it('answers from the curated data, with no live video, when videos.list is refused for this channel only', async () => {
    stubYouTube({ uploads: [upload('RECENT00001', 'Recent')], videosFail: true, videosFailReason: 'videoNotAccessible' });
    const out = await api.fetchYouTubeChannelVideos(CHANNEL);
    expect(out.liveVideo).toBeNull();
    expect(out.dataOrigin).toBe('fallback');
    expect(out.reason).toBe('inaccessible');
    expect(out.recentVideos.map((v) => v.videoId)).toEqual(['FALLBACK001']);
    // the key is fine: another channel is still asked
    const before = urls.length;
    await api.fetchYouTubeChannelVideos({ ...CHANNEL, id: 'fixture-two' });
    expect(urls.length).toBeGreaterThan(before);
  });

  it('answers from the curated data, and asks nothing more, when videos.list is refused for the whole key', async () => {
    stubYouTubeKey();
    const out = await api.fetchYouTubeChannelVideos(CHANNEL);
    expect(out.liveVideo).toBeNull();
    expect(out.dataOrigin).toBe('fallback');
    expect(out.reason).toBe('quota');
    const before = urls.length;
    await api.fetchYouTubeChannelVideos({ ...CHANNEL, id: 'fixture-two' });
    expect(urls).toHaveLength(before);
  });

  describe('dataOrigin: where the data came from, kept through the cache', () => {
    it('says youtube-api for a full API answer, and still says so from the cache', async () => {
      stubYouTube({ uploads: [upload('RECENT00001', 'Recent')], videos: [video('RECENT00001', 'none')] });
      const first = await api.fetchYouTubeChannelVideos(CHANNEL);
      const again = await api.fetchYouTubeChannelVideos(CHANNEL);
      expect([first.source, first.dataOrigin]).toEqual(['youtube-api', 'youtube-api']);
      expect([again.source, again.dataOrigin]).toEqual(['cache', 'youtube-api']);
    });

    it('says fallback for the curated fallback, and for it served from the cache', async () => {
      vi.stubEnv('YOUTUBE_API_KEY', '');
      const first = await api.fetchYouTubeChannelVideos(CHANNEL);
      const again = await api.fetchYouTubeChannelVideos(CHANNEL);
      expect([first.source, first.dataOrigin]).toEqual(['curated-fallback', 'fallback']);
      expect([again.source, again.dataOrigin]).toEqual(['cache', 'fallback']);
    });

    it('does not say youtube-api when videos.list failed, or when the list is empty and a curated list stands in', async () => {
      stubYouTube({ uploads: [upload('RECENT00001', 'Recent')], videosFail: true });
      expect((await api.fetchYouTubeChannelVideos(CHANNEL)).dataOrigin).toBe('fallback');
      api.clearCache();
      // an upload with no details is a deleted or private video: it is not live, and the search still ran through
      stubYouTube({ uploads: [upload('RECENT00001', 'A'), upload('RECENT00002', 'B')], videos: [video('RECENT00001', 'none')] });
      expect((await api.fetchYouTubeChannelVideos(CHANNEL)).dataOrigin).toBe('youtube-api');
      api.clearCache();
      stubYouTube({ uploads: [], videos: [] });
      expect((await api.fetchYouTubeChannelVideos(CHANNEL)).dataOrigin).toBe('fallback');
    });

    it('does not say youtube-api when a refresh after the cache expired finds the API failing', async () => {
      stubYouTube({ uploads: [upload('RECENT00001', 'Recent')], videos: [video('RECENT00001', 'none')] });
      await api.fetchYouTubeChannelVideos(CHANNEL);
      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + 60 * 60 * 1000);
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('quota'); }));
      const stale = await api.fetchYouTubeChannelVideos(CHANNEL);
      vi.useRealTimers();
      expect(stale.dataOrigin).not.toBe('youtube-api');
    });
  });
});
