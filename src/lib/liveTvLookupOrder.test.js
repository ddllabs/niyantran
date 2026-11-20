// A1/B: how the per-channel lookup finds a live video. In order, stopping at the first step that finds one:
// the remembered live video and the curated video; the channel's live-streams playlist (UULV…); the uploads.
// A fake YouTube answers from tables; every call is recorded and counted as one unit.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { YOUTUBE_SOURCES, clearCache, getLiveTvChannels, fetchYouTubeChannelVideos } from '../../server/liveTvApi.mjs';

const ch = (id) => YOUTUBE_SOURCES.find((c) => c.id === id);
const HINTED = () => ch('abp-news'); // a remembered live video, no curated one
const PLAIN = () => ch('theprint'); // neither
const lv = (c) => 'UULV' + c.channelId.slice(2);
const uu = (c) => 'UU' + c.channelId.slice(2);
const ids50 = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(11 - prefix.length, '0')}`);

let calls;
let fake;
const kind = (url) => new URL(url).pathname.split('/').pop();
const lsd = (state, start) => (state === 'live' ? { actualStartTime: start || '2026-11-19T00:00:00Z' } : state === 'ended' ? { actualStartTime: '2026-11-18T00:00:00Z', actualEndTime: '2026-11-18T02:00:00Z' } : state === 'upcoming' ? { scheduledStartTime: '2026-11-21T00:00:00Z' } : undefined);
/** fake.videos: id -> { state, start?, embeddable? }; fake.playlists: playlist id -> ids, or 404 / 403 */
function install() {
  fake = { videos: {}, playlists: {} };
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    calls.push(String(url));
    const u = new URL(url);
    if (kind(url) === 'playlistItems') {
      const entry = fake.playlists[u.searchParams.get('playlistId')];
      if (entry === 404 || entry === undefined) return new Response(JSON.stringify({ error: { errors: [{ reason: 'playlistNotFound' }] } }), { status: 404 });
      if (entry === 403) return new Response(JSON.stringify({ error: { errors: [{ reason: 'playlistItemsNotAccessible' }] } }), { status: 403 });
      return new Response(JSON.stringify({ items: entry.map((id) => ({ snippet: { title: id, resourceId: { videoId: id } } })) }), { status: 200 });
    }
    const asked = u.searchParams.get('id').split(',');
    return new Response(JSON.stringify({
      items: asked.filter((id) => fake.videos[id]).map((id) => {
        const v = fake.videos[id];
        const broadcast = v.state === 'abandoned' ? 'none' : v.state === 'ghost' ? 'live' : v.state === 'live' ? 'live' : v.state === 'upcoming' ? 'upcoming' : 'none';
        return { id, snippet: { title: id, liveBroadcastContent: broadcast, thumbnails: {} }, liveStreamingDetails: v.state === 'abandoned' ? { actualStartTime: v.start || '2020-01-01T00:00:00Z' } : lsd(v.state, v.start), status: { embeddable: v.embeddable !== false } };
      }),
    }), { status: 200 });
  }));
}
const playlistCalls = () => calls.filter((u) => kind(u) === 'playlistItems');

beforeEach(() => { clearCache(); vi.stubEnv('YOUTUBE_API_KEY', 'test-key-not-real'); install(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('the order of the search, and stopping early', () => {
  it('stops at the remembered live video: one call', async () => {
    const c = HINTED();
    fake.videos[c.liveHintVideoId] = { state: 'live' };
    const out = await fetchYouTubeChannelVideos(c);
    expect(out.liveVideo.videoId).toBe(c.liveHintVideoId);
    expect(out.dataOrigin).toBe('youtube-api');
    expect(calls).toHaveLength(1);
    expect(kind(calls[0])).toBe('videos');
  });
  it('asks the remembered and the curated video together, in the same call', async () => {
    const c = { ...HINTED(), defaultVideoId: 'CURATEDVID1' };
    await fetchYouTubeChannelVideos(c);
    expect(new URL(calls[0]).searchParams.get('id').split(',')).toEqual([c.liveHintVideoId, 'CURATEDVID1']);
  });
  it('goes to the live-streams playlist when the remembered video is stale, and stops there when it finds a live one', async () => {
    const c = HINTED();
    fake.videos[c.liveHintVideoId] = { state: 'ended' };
    fake.playlists[lv(c)] = ['LIVENEW0001', 'OLDSTREAM01'];
    fake.videos.LIVENEW0001 = { state: 'live' };
    fake.videos.OLDSTREAM01 = { state: 'ended' };
    const out = await fetchYouTubeChannelVideos(c);
    expect(out.liveVideo.videoId).toBe('LIVENEW0001');
    expect(calls.map(kind)).toEqual(['videos', 'playlistItems', 'videos']); // 3 units; the uploads were not read
    expect(playlistCalls().map((u) => new URL(u).searchParams.get('playlistId'))).toEqual([lv(c)]);
  });
  it('starts at the live-streams playlist for a channel with nothing remembered: two calls', async () => {
    const c = PLAIN();
    fake.playlists[lv(c)] = ['LIVENEW0001'];
    fake.videos.LIVENEW0001 = { state: 'live' };
    const out = await fetchYouTubeChannelVideos(c);
    expect(out.liveVideo.videoId).toBe('LIVENEW0001');
    expect(calls.map(kind)).toEqual(['playlistItems', 'videos']);
  });
  it('asks for 50 entries from each playlist', async () => {
    const c = PLAIN();
    await fetchYouTubeChannelVideos(c);
    for (const u of playlistCalls()) expect(new URL(u).searchParams.get('maxResults')).toBe('50');
  });
  it('asks videos.list for the details it needs and never calls search.list', async () => {
    const c = PLAIN();
    fake.playlists[lv(c)] = ['LIVENEW0001'];
    fake.videos.LIVENEW0001 = { state: 'live' };
    await fetchYouTubeChannelVideos(c);
    const videos = calls.find((u) => kind(u) === 'videos');
    expect(new URL(videos).searchParams.get('part')).toBe('snippet,liveStreamingDetails,status');
    expect(calls.some((u) => /search/.test(new URL(u).pathname))).toBe(false);
  });
});

describe('a channel with no live-streams playlist', () => {
  it('is nothing here, not an error: the uploads are read next, and the channel is not marked inaccessible', async () => {
    const c = PLAIN();
    fake.playlists[uu(c)] = ['LIVEUP00001', 'OLDUPLOAD01'];
    fake.videos.LIVEUP00001 = { state: 'live' };
    fake.videos.OLDUPLOAD01 = { state: 'none' };
    const out = await fetchYouTubeChannelVideos(c);
    expect(out.liveVideo.videoId).toBe('LIVEUP00001');
    expect(out.dataOrigin).toBe('youtube-api');
    expect(out.reason).toBeUndefined();
    expect(calls.map(kind)).toEqual(['playlistItems', 'playlistItems', 'videos']); // the 404 cost its unit
  });
  it('and when nothing is live anywhere, the answer is from YouTube data with the recent uploads', async () => {
    const c = PLAIN();
    fake.playlists[uu(c)] = ['OLDUPLOAD01', 'OLDUPLOAD02'];
    fake.videos.OLDUPLOAD01 = { state: 'none' };
    fake.videos.OLDUPLOAD02 = { state: 'ended' };
    const out = await fetchYouTubeChannelVideos(c);
    expect(out.liveVideo).toBeNull();
    expect(out.dataOrigin).toBe('youtube-api');
    expect(out.recentVideos.map((v) => v.videoId)).toEqual(['OLDUPLOAD01', 'OLDUPLOAD02']);
  });
  it('a private live-streams playlist (403) is nothing here as well', async () => {
    const c = PLAIN();
    fake.playlists[lv(c)] = 403;
    fake.playlists[uu(c)] = ['OLDUPLOAD01'];
    fake.videos.OLDUPLOAD01 = { state: 'none' };
    const out = await fetchYouTubeChannelVideos(c);
    expect(out.dataOrigin).toBe('youtube-api');
    expect(out.reason).toBeUndefined();
  });
  it('a private uploads playlist still marks the channel inaccessible', async () => {
    const c = PLAIN();
    fake.playlists[uu(c)] = 403;
    const out = await fetchYouTubeChannelVideos(c);
    expect(out.reason).toBe('inaccessible');
  });
});

describe('what counts as live', () => {
  it('an announced broadcast is not live', async () => {
    const c = PLAIN();
    fake.playlists[lv(c)] = ['SOON0000001'];
    fake.playlists[uu(c)] = ['SOON0000001'];
    fake.videos.SOON0000001 = { state: 'upcoming' };
    const out = await fetchYouTubeChannelVideos(c);
    expect(out.liveVideo).toBeNull();
    expect(out.upcomingVideos.map((v) => v.videoId)).toEqual(['SOON0000001']);
    expect(out.dataOrigin).toBe('youtube-api');
  });
  it('a stream that has ended is not live', async () => {
    const c = PLAIN();
    fake.playlists[lv(c)] = ['ENDED000001'];
    fake.videos.ENDED000001 = { state: 'ended' };
    expect((await fetchYouTubeChannelVideos(c)).liveVideo).toBeNull();
  });
  it('a video that merely says live in its snippet but has no start time is not live', async () => {
    const c = PLAIN();
    fake.playlists[lv(c)] = ['ODD00000001'];
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      calls.push(String(url));
      if (kind(url) === 'playlistItems') return new Response(JSON.stringify({ items: [{ snippet: { resourceId: { videoId: 'ODD00000001' } } }] }), { status: 200 });
      return new Response(JSON.stringify({ items: [{ id: 'ODD00000001', snippet: { liveBroadcastContent: 'live', title: 'x' }, status: { embeddable: true } }] }), { status: 200 });
    }));
    expect((await fetchYouTubeChannelVideos(c)).liveVideo).toBeNull();
  });
  it('of several live videos, the one that started first wins: the 24-hour stream', async () => {
    const c = PLAIN();
    fake.playlists[lv(c)] = ['SHORTSHOW01', 'DAYSTREAM01', 'MIDSHOW0001'];
    fake.videos.SHORTSHOW01 = { state: 'live', start: '2026-11-20T09:00:00Z' };
    fake.videos.DAYSTREAM01 = { state: 'live', start: '2026-11-01T00:00:00Z' };
    fake.videos.MIDSHOW0001 = { state: 'live', start: '2026-11-20T03:00:00Z' };
    expect((await fetchYouTubeChannelVideos(c)).liveVideo.videoId).toBe('DAYSTREAM01');
  });
});

describe('50 ids to a videos.list call', () => {
  it('sends at most 50 ids, even from a longer playlist', async () => {
    const c = PLAIN();
    const many = ids50('LONGLIST', 60);
    fake.playlists[lv(c)] = many;
    await fetchYouTubeChannelVideos(c);
    for (const u of calls.filter((x) => kind(x) === 'videos')) expect(new URL(u).searchParams.get('id').split(',').length).toBeLessThanOrEqual(50);
    expect(new URL(calls.find((u) => kind(u) === 'videos')).searchParams.get('id').split(',')).toEqual(many.slice(0, 50));
  });
  it('finds a live video that is the 45th entry of the live-streams playlist', async () => {
    const c = PLAIN();
    const many = ids50('OLDSTREAM', 50);
    fake.playlists[lv(c)] = many;
    fake.videos[many[44]] = { state: 'live' };
    expect((await fetchYouTubeChannelVideos(c)).liveVideo.videoId).toBe(many[44]);
  });
});

describe('units: every call is taken from the budget first', () => {
  it('best 1, with a live remembered video; 2 for a channel with nothing remembered and a live stream; worst 5', async () => {
    const best = HINTED();
    fake.videos[best.liveHintVideoId] = { state: 'live' };
    await fetchYouTubeChannelVideos(best);
    expect(calls).toHaveLength(1);

    clearCache(); calls = [];
    const typical = PLAIN();
    fake.playlists[lv(typical)] = ['LIVENEW0001'];
    fake.videos.LIVENEW0001 = { state: 'live' };
    await fetchYouTubeChannelVideos(typical);
    expect(calls).toHaveLength(2);

    clearCache(); calls = [];
    const worst = HINTED();
    fake.videos[worst.liveHintVideoId] = { state: 'none' };
    fake.playlists[lv(worst)] = ['OLDSTREAM01'];
    fake.videos.OLDSTREAM01 = { state: 'ended' };
    fake.playlists[uu(worst)] = ['OLDUPLOAD01'];
    fake.videos.OLDUPLOAD01 = { state: 'none' };
    const out = await fetchYouTubeChannelVideos(worst);
    expect(out.liveVideo).toBeNull();
    expect(calls).toHaveLength(5); // remembered video, live-streams playlist and its videos, uploads and their videos
  });
  it('parallel lookups at a small budget make exactly budget-many requests, whatever step each is in', async () => {
    vi.stubEnv('LIVETV_LOOKUP_UNITS_PER_DAY', '7');
    const channels = ['abp-news', 'zee-news', 'india-tv', 'news18-india', 'ndtv-india'].map(ch);
    for (const c of channels) { fake.playlists[lv(c)] = ['OLDSTREAM01']; fake.playlists[uu(c)] = ['OLDUPLOAD01']; }
    fake.videos.OLDSTREAM01 = { state: 'ended' };
    fake.videos.OLDUPLOAD01 = { state: 'none' };
    const out = await Promise.all(channels.map((c) => fetchYouTubeChannelVideos(c)));
    expect(calls).toHaveLength(7);
    expect(out.every((o) => o.ok)).toBe(true);
    expect(out.some((o) => o.reason === 'budget')).toBe(true);
  });
  it('96 channels looked up once each, none live, cost at most 5 x 96 = 480 units', async () => {
    for (const c of YOUTUBE_SOURCES) { fake.playlists[lv(c)] = ['OLDSTREAM01']; fake.playlists[uu(c)] = ['OLDUPLOAD01']; }
    fake.videos.OLDSTREAM01 = { state: 'ended' };
    fake.videos.OLDUPLOAD01 = { state: 'none' };
    await Promise.all(YOUTUBE_SOURCES.map((c) => fetchYouTubeChannelVideos(c)));
    expect(calls.length).toBeLessThanOrEqual(5 * 96);
    expect(calls.length).toBeGreaterThan(4 * 96 - 20);
  });
});

describe('whether the live video may be embedded', () => {
  it('is in the answer: true by default, false when YouTube says so', async () => {
    const c = PLAIN();
    fake.playlists[lv(c)] = ['LIVEOK00001'];
    fake.videos.LIVEOK00001 = { state: 'live' };
    const ok = await fetchYouTubeChannelVideos(c);
    expect(ok.embeddable).toBe(true);
    expect(ok.liveVideo.embeddable).toBe(true);
    clearCache();
    fake.videos.LIVEOK00001.embeddable = false;
    const refused = await fetchYouTubeChannelVideos(c);
    expect(refused.embeddable).toBe(false);
    expect(refused.liveVideo.embeddable).toBe(false);
    expect(refused.liveVideo.videoId).toBe('LIVEOK00001'); // still reported, so the page can say it cannot be played
  });
  it('reaches the channel list through the liveVideoId a recently opened channel carries', async () => {
    const c = PLAIN();
    fake.playlists[lv(c)] = ['LIVEOK00001'];
    fake.videos.LIVEOK00001 = { state: 'live', embeddable: false };
    await fetchYouTubeChannelVideos(c);
    const entry = (await getLiveTvChannels()).channels.find((x) => x.id === c.id);
    expect(entry.liveVideoId).toBe('LIVEOK00001');
    expect(entry.embeddable).toBe(false);
  });
  it('reaches the list check for a remembered live video that YouTube confirms but will not embed', async () => {
    const c = HINTED();
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      calls.push(String(url));
      const asked = new URL(url).searchParams.get('id').split(',');
      return new Response(JSON.stringify({ items: asked.map((id) => ({ id, snippet: { liveBroadcastContent: id === c.liveHintVideoId ? 'live' : 'none' }, ...(id === c.liveHintVideoId ? { liveStreamingDetails: { actualStartTime: '2026-11-19T00:00:00Z' } } : {}), status: { embeddable: id !== c.liveHintVideoId } })) }), { status: 200 });
    }));
    const entry = (await getLiveTvChannels()).channels.find((x) => x.id === c.id);
    expect(entry.status).toBe('live');
    expect(entry.hinted).toBe(true);
    expect(entry.embeddable).toBe(false);
  });
});

describe('I1: one definition of live, for the lookup and the list check', () => {
  it('an item with an old start, no end and a snippet that says none (an abandoned stream) is not live and does not win "earliest start"', async () => {
    const c = PLAIN();
    fake.playlists[lv(c)] = ['ABANDONED01', 'REALLIVE001'];
    fake.videos.ABANDONED01 = { state: 'abandoned', start: '2019-01-01T00:00:00Z' };
    fake.videos.REALLIVE001 = { state: 'live', start: '2026-11-20T00:00:00Z' };
    expect((await fetchYouTubeChannelVideos(c)).liveVideo.videoId).toBe('REALLIVE001');
  });
  it('and a channel with only an abandoned item has no live video', async () => {
    const c = PLAIN();
    fake.playlists[lv(c)] = ['ABANDONED01'];
    fake.videos.ABANDONED01 = { state: 'abandoned' };
    expect((await fetchYouTubeChannelVideos(c)).liveVideo).toBeNull();
  });
  it('the list check and the lookup agree on the same videos', async () => {
    const c = HINTED();
    for (const state of ['live', 'abandoned', 'ghost', 'ended', 'upcoming', 'none']) { // ghost: the snippet says live, there is no start time
      clearCache(); install();
      fake.videos[c.liveHintVideoId] = { state };
      const entry = (await getLiveTvChannels()).channels.find((x) => x.id === c.id);
      clearCache(); calls = [];
      const lookup = await fetchYouTubeChannelVideos(c);
      expect([state, entry.status === 'live']).toEqual([state, Boolean(lookup.liveVideo)]);
    }
  });
  it('the list check asks for the live-streaming details too', async () => {
    await getLiveTvChannels();
    expect(new URL(calls[0]).searchParams.get('part')).toBe('snippet,liveStreamingDetails,status');
  });
});

describe('I2: a refresh asks about the live video found last time first', () => {
  it('costs 1 unit when the stream is still live (the first lookup, finding it in the live-streams playlist, took 2)', async () => {
    vi.useFakeTimers();
    const c = PLAIN();
    fake.playlists[lv(c)] = ['LIVENEW0001'];
    fake.videos.LIVENEW0001 = { state: 'live' };
    await fetchYouTubeChannelVideos(c);
    expect(calls).toHaveLength(2); // nothing remembered: the live-streams playlist and its videos
    vi.setSystemTime(Date.now() + 11 * 60 * 1000); // the 10-minute answer has expired
    calls = [];
    const again = await fetchYouTubeChannelVideos(c);
    expect(again.liveVideo.videoId).toBe('LIVENEW0001');
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]).searchParams.get('id').split(',')).toContain('LIVENEW0001');
  });
  it('goes on to the playlists when that video has ended, and forgets it once a search finds nothing', async () => {
    vi.useFakeTimers();
    const c = PLAIN();
    fake.playlists[lv(c)] = ['LIVENEW0001'];
    fake.videos.LIVENEW0001 = { state: 'live' };
    await fetchYouTubeChannelVideos(c);
    fake.videos.LIVENEW0001 = { state: 'ended' };
    fake.playlists[uu(c)] = ['OLDUPLOAD01'];
    fake.videos.OLDUPLOAD01 = { state: 'none' };
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    calls = [];
    const out = await fetchYouTubeChannelVideos(c);
    expect(out.liveVideo).toBeNull();
    expect(calls.length).toBeGreaterThan(1);
    vi.setSystemTime(Date.now() + 61 * 60 * 1000);
    calls = [];
    await fetchYouTubeChannelVideos(c);
    expect(new URL(calls[0]).pathname.endsWith('/playlistItems')).toBe(true); // no stale id to ask about first
  });
  it('keeps the id through a failed lookup', async () => {
    vi.useFakeTimers();
    const c = PLAIN();
    fake.playlists[lv(c)] = ['LIVENEW0001'];
    fake.videos.LIVENEW0001 = { state: 'live' };
    await fetchYouTubeChannelVideos(c);
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    await fetchYouTubeChannelVideos(c); // fails
    vi.setSystemTime(Date.now() + 2 * 60 * 1000);
    install(); fake.playlists[lv(c)] = ['LIVENEW0001']; fake.videos.LIVENEW0001 = { state: 'live' };
    await fetchYouTubeChannelVideos(c);
    expect(calls).toHaveLength(1);
  });
});

describe('M5: an unparsable start time counts as the latest', () => {
  it('does not let a broken time win', async () => {
    const c = PLAIN();
    fake.playlists[lv(c)] = ['BROKENTIME1', 'GOODSTREAM1'];
    fake.videos.BROKENTIME1 = { state: 'live', start: 'not a time' };
    fake.videos.GOODSTREAM1 = { state: 'live', start: '2026-11-20T00:00:00Z' };
    expect((await fetchYouTubeChannelVideos(c)).liveVideo.videoId).toBe('GOODSTREAM1');
  });
});
