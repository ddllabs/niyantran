// F367: the status a channel's own video lookup found (YouTube data only) reaches the header badge and
// that channel's tile, and changes nothing else: not the video, the embed address, the mode or the
// fact-check target. The REAL page runs with real effects (hookHarness.js).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { harness, elements } from './hookHarness.js';

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal()), ...harness.patch() }));
const lookups = { 'dd-news': null, 'aaj-tak': null };
const factCheckArgs = [];
vi.mock('../lib/liveTvClient.js', () => {
  const never = () => new Promise(() => {});
  const channels = [
    { id: 'dd-news', name: 'DD News', category: 'NEWS', status: 'recent', lang: 'Hindi', defaultVideoId: 'abcdefghijk', embedUrl: 'https://www.youtube-nocookie.com/embed/abcdefghijk?autoplay=1' },
    { id: 'aaj-tak', name: 'Aaj Tak', category: 'NEWS', status: 'recent', lang: 'Hindi', defaultVideoId: 'lmnopqrstuv', embedUrl: 'https://www.youtube-nocookie.com/embed/lmnopqrstuv?autoplay=1' },
  ];
  return {
    fetchLiveTvChannels: async () => ({ ok: true, channels, categories: ['NEWS'] }),
    fetchLiveTvVideos: async (id) => lookups[id],
    fetchLiveTvSchedule: never, fetchLiveTvArchive: never, fetchLiveTvTranscript: never,
  };
});
vi.mock('./factcheck/useFactCheck.js', () => ({ useFactCheck: (args) => { factCheckArgs.push(args); return { view: null, actions: {} }; } }));
vi.mock('./liveTv/useYoutubePlayer.js', () => ({ useYoutubePlayer: () => ({ iframeRef: { current: null }, requestMute() {}, getPositionS: () => 0 }) }));
const { default: LiveTvPage } = await import('./LiveTvPage.jsx');
const { ChannelCard } = await import('./liveTv/ChannelCard.jsx');

const settle = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };
const page = () => harness.render(LiveTvPage, { open: true, onClose() {} });
const find = (out, type) => [...elements(out)].find((e) => e.type === type);
const badge = (out) => [...elements(out)].find((e) => /ltv-(live|recent|offline)-badge/.test(e.props?.className || ''))?.props.className;
const iframeSrc = (out) => [...elements(out)].find((e) => e.type === 'iframe')?.props.src;
const tileStatus = (out, id) => find(out, ChannelCard).props.visible.find((c) => c.id === id).status;
const youtubeAnswer = (status) => ({ ok: true, source: 'youtube-api', dataOrigin: 'youtube-api', status, recentVideos: [] });

beforeEach(() => {
  harness.reset(); factCheckArgs.length = 0;
  lookups['dd-news'] = null; lookups['aaj-tak'] = null;
});

describe('a detected status', () => {
  it('reaches the header badge and the watched channel tile, from YouTube data', async () => {
    lookups['dd-news'] = youtubeAnswer('live');
    let out = page();
    await settle();
    out = page();
    expect(badge(out)).toBe('ltv-live-badge');
    expect(tileStatus(out, 'dd-news')).toBe('live');
    expect(tileStatus(out, 'aaj-tak')).toBe('recent');
    expect(find(out, ChannelCard).props.channels.find((c) => c.id === 'dd-news').status).toBe('live');
  });

  it('is kept for a channel after the visitor moves on to another', async () => {
    lookups['dd-news'] = youtubeAnswer('live');
    lookups['aaj-tak'] = youtubeAnswer('recent');
    let out = page();
    await settle();
    out = page();
    find(out, ChannelCard).props.onSelectChannel({ id: 'aaj-tak' });
    await settle();
    out = page();
    expect(badge(out)).toBe('ltv-recent-badge');
    expect(tileStatus(out, 'dd-news')).toBe('live');
  });

  it('from a fallback or failed lookup changes nothing', async () => {
    lookups['dd-news'] = { ok: true, source: 'curated-fallback', dataOrigin: 'fallback', status: 'live', recentVideos: [] };
    let out = page();
    await settle();
    out = page();
    expect(badge(out)).toBe('ltv-recent-badge');
    expect(tileStatus(out, 'dd-news')).toBe('recent');
    harness.reset();
    lookups['dd-news'] = { ok: false, error: 'HTTP 500', recentVideos: [], upcomingVideos: [] };
    out = page();
    await settle();
    out = page();
    expect(tileStatus(out, 'dd-news')).toBe('recent');
  });

  it('changes neither the video that plays, the embed address, the mode nor the fact-check target', async () => {
    const run = async (answer) => {
      harness.reset(); factCheckArgs.length = 0;
      lookups['dd-news'] = answer;
      let out = page();
      await settle();
      out = page();
      const last = factCheckArgs.at(-1);
      return { src: iframeSrc(out), target: last.target, start: { ...last.start, getStartPositionS: undefined }, watch: JSON.stringify([...elements(out)].map((e) => e.props?.href).filter(Boolean)) };
    };
    const without = await run({ ok: true, source: 'curated-fallback', dataOrigin: 'fallback', status: 'recent', recentVideos: [] });
    const withLive = await run(youtubeAnswer('live'));
    expect(withLive.src).toBeTruthy();
    expect(withLive).toEqual(without);
    expect(withLive.start.videoKind).toBe('live');
  });
});
