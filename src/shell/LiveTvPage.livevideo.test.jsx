// F377: in live mode the page plays the channel's own live video when YouTube data reports one and the
// curated video is not live. Four 24-hour channels write a video id that is not their live stream.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { harness, elements } from './hookHarness.js';

const h = vi.hoisted(() => ({
  channels: [],
  lookup: null,
  videoCalls: [],
  fcArgs: null,
  fcView: null,
}));

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal()), ...harness.patch() }));
vi.mock('../lib/liveTvClient.js', () => {
  const never = () => new Promise(() => {});
  return {
    fetchLiveTvChannels: async () => ({ ok: true, channels: h.channels, categories: ['NEWS'] }),
    fetchLiveTvVideos: (id) => { h.videoCalls.push(id); return h.lookup(id); },
    fetchLiveTvSchedule: never, fetchLiveTvArchive: never, fetchLiveTvTranscript: never,
  };
});
vi.mock('./factcheck/useFactCheck.js', () => ({
  useFactCheck: (args) => { h.fcArgs = args; return { view: h.fcView, actions: {} }; },
}));
vi.mock('./liveTv/useYoutubePlayer.js', () => ({ useYoutubePlayer: () => ({ iframeRef: { current: null }, requestMute() {}, getPositionS: () => 0 }) }));
const { default: LiveTvPage } = await import('./LiveTvPage.jsx');
const { ChannelCard } = await import('./liveTv/ChannelCard.jsx');

const CURATED = 'abcdefghijk';
const LIVE = 'zzzzzzzzzzz';
const embed = (id) => `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&playsinline=1`;
const channel = (over = {}) => ({ id: 'dd-news', name: 'DD News', category: 'NEWS', status: 'recent', lang: 'Hindi', defaultVideoId: CURATED, embedUrl: embed(CURATED), ...over });
const answer = (over = {}) => ({ ok: true, source: 'youtube-api', dataOrigin: 'youtube-api', status: 'live', liveVideo: { videoId: LIVE, embedUrl: embed(LIVE) }, recentVideos: [], ...over });

const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
const render = () => harness.render(LiveTvPage, { open: true, onClose() {} });
const frame = (out) => [...elements(out)].find((e) => e.type === 'iframe');
const badge = (out) => [...elements(out)].find((e) => /ltv-(live|recent|offline)-badge/.test(e.props?.className || ''))?.props.className;
const card = (out) => [...elements(out)].find((e) => e.type === ChannelCard);
async function open(opts = {}) {
  h.channels = opts.channels || [channel()];
  h.lookup = opts.lookup || (async () => answer());
  render();
  await flush();
  return render();
}
const running = { flag: { available: true }, session: { status: 'running', claims: [] }, rechecks: {} };

beforeEach(() => {
  harness.reset();
  h.videoCalls = [];
  h.fcView = null;
  h.fcArgs = null;
});

describe('the four-channel case: the curated video is not live and YouTube reports a live one', () => {
  it('plays the live video: the embed, the fact-check target and the start object', async () => {
    const out = await open();
    expect(frame(out).props.src).toContain(`/embed/${LIVE}?`);
    expect(frame(out).props.src).not.toContain(CURATED);
    expect(h.fcArgs.target).toBe(`dd-news|live|${LIVE}`);
    expect(h.fcArgs.start.videoId).toBe(LIVE);
    expect(h.fcArgs.start.videoKind).toBe('live');
  });

  it('points "Watch on YouTube" at the live video', async () => {
    const out = await open();
    frame(out).props.onError();
    const link = [...elements(render())].find((e) => e.type === 'a' && /youtube\.com\/watch/.test(e.props.href || ''));
    expect(link.props.href).toBe(`https://www.youtube.com/watch?v=${LIVE}`);
  });

  it('shows the curated video while the lookup is loading', async () => {
    h.channels = [channel()];
    h.lookup = () => new Promise(() => {});
    render();
    await flush();
    const out = render();
    expect(frame(out).props.src).toContain(`/embed/${CURATED}?`);
    expect(h.fcArgs.target).toBe(`dd-news|live|${CURATED}`);
  });

  it('shows LIVE on the header badge and on the tile of the watched channel only', async () => {
    const out = await open({ channels: [channel(), channel({ id: 'wion', name: 'WION' })] });
    expect(badge(out)).toBe('ltv-live-badge');
    const vis = card(out).props.visible;
    expect(vis.find((c) => c.id === 'dd-news').status).toBe('live');
    expect(vis.find((c) => c.id === 'wion').status).toBe('recent');
  });

  it('asks for the lookup once per channel selection, with no reload loop', async () => {
    const out = await open();
    expect(h.videoCalls).toEqual(['dd-news']);
    render(); render();
    await flush();
    render();
    expect(h.videoCalls).toEqual(['dd-news']);
    expect(frame(out).props.src).toContain(LIVE);
  });

  it('keeps the live video after a reload of the feed', async () => {
    const out = await open();
    const reload = [...elements(out)].find((e) => e.props?.title === 'Reload Live Feed');
    reload.props.onClick();
    expect(frame(render()).props.src).toContain(`/embed/${LIVE}?`);
  });
});

describe('where nothing changes', () => {
  it('keeps the curated video when it is itself live', async () => {
    const out = await open({ channels: [channel({ status: 'live' })] });
    expect(frame(out).props.src).toContain(`/embed/${CURATED}?`);
    expect(h.fcArgs.target).toBe(`dd-news|live|${CURATED}`);
    expect(badge(out)).toBe('ltv-live-badge');
  });

  it.each([
    ['a fallback answer', { dataOrigin: 'fallback' }],
    ['a stale answer', { dataOrigin: 'stale' }],
    ['no live video', { liveVideo: null, status: 'recent' }],
    ['a live video id that is not 11 characters', { liveVideo: { videoId: 'short' } }],
  ])('keeps the curated video on %s', async (_n, over) => {
    const out = await open({ lookup: async () => answer(over) });
    expect(frame(out).props.src).toContain(`/embed/${CURATED}?`);
    expect(h.fcArgs.target).toBe(`dd-news|live|${CURATED}`);
    expect(badge(out)).toBe('ltv-recent-badge');
    expect(card(out).props.visible[0].status).toBe('recent');
  });

  it('keeps the curated video when the lookup fails', async () => {
    const out = await open({ lookup: async () => ({ ok: false, error: 'HTTP 500', recentVideos: [] }) });
    expect(frame(out).props.src).toContain(`/embed/${CURATED}?`);
  });

  it('leaves Sansad TV (live_stream) alone', async () => {
    const sansad = channel({ id: 'sansad-tv', name: 'Sansad TV', defaultVideoId: 'live_stream', embedUrl: 'https://www.youtube-nocookie.com/embed/live_stream?channel=UCISgnSNwqQ2i8lhCun3KtQg&autoplay=1&mute=1' });
    const out = await open({ channels: [sansad] });
    expect(frame(out).props.src).toContain('/embed/live_stream?');
    expect(frame(out).props.src).not.toContain(LIVE);
  });
});

describe('a fact-check session', () => {
  it('is not switched under: a lookup that arrives while a session runs changes nothing until the session is over', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    h.channels = [channel()];
    h.lookup = () => gate.then(() => answer());
    render(); await flush(); render(); // the list is in, the lookup is out
    h.fcView = running; // a session starts on the curated video
    render();
    release(); await flush();
    const out = render();
    expect(frame(out).props.src).toContain(`/embed/${CURATED}?`);
    expect(h.fcArgs.target).toBe(`dd-news|live|${CURATED}`);
    // once the session on this video is over, the page follows the report (the decision is taken again)
    h.fcView = { ...running, session: { status: 'ended', claims: [] } };
    render(); await flush();
    expect(frame(render()).props.src).toContain(`/embed/${LIVE}?`);
  });

  it('does not take a switch back once made, while a session runs on the live video', async () => {
    const out = await open();
    expect(frame(out).props.src).toContain(LIVE);
    h.fcView = running;
    expect(frame(render()).props.src).toContain(LIVE);
  });
});

describe('a live video the list already reports (liveVideoId)', () => {
  it('plays it at once, and its tile and badge say LIVE', async () => {
    const out = await open({
      channels: [channel({ status: 'live', liveVideoId: LIVE })],
      lookup: () => new Promise(() => {}),
    });
    expect(frame(out).props.src).toContain(`/embed/${LIVE}?`);
    expect(badge(out)).toBe('ltv-live-badge');
  });
});

describe('channel selection', () => {
  it('forgets the switch for a channel left, then decides afresh when it is selected again', async () => {
    const out = await open({ channels: [channel(), channel({ id: 'wion', name: 'WION' })] });
    expect(frame(out).props.src).toContain(LIVE);
    h.lookup = async () => answer({ dataOrigin: 'fallback' });
    card(out).props.onSelectChannel({ id: 'wion' });
    render(); await flush();
    expect(frame(render()).props.src).not.toContain(LIVE);
    card(render()).props.onSelectChannel({ id: 'dd-news' });
    render(); await flush();
    expect(h.videoCalls).toEqual(['dd-news', 'wion', 'dd-news']);
    expect(frame(render()).props.src).toContain(`/embed/${CURATED}?`);
  });

  it('keeps the live video when the watched channel is selected again', async () => {
    const out = await open();
    card(out).props.onSelectChannel({ id: 'dd-news' });
    render(); await flush();
    expect(h.videoCalls).toEqual(['dd-news']);
    expect(frame(render()).props.src).toContain(`/embed/${LIVE}?`);
  });
});
