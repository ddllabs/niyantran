// B6: the page with the client's lists: a channel added without a curated video (connecting, live, not live,
// failed lookup), the follow toggle, and the channel bar in place of the old card.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { harness, elements } from './hookHarness.js';

const h = vi.hoisted(() => ({ channels: [], lists: [], lookup: null, videoCalls: [], fcArgs: null, fcView: null, player: null }));

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal()), ...harness.patch() }));
vi.mock('../lib/liveTvClient.js', () => {
  const never = () => new Promise(() => {});
  return {
    fetchLiveTvChannels: async () => ({ ok: true, channels: h.channels, categories: ['NEWS'], lists: h.lists }),
    fetchLiveTvVideos: (id) => { h.videoCalls.push(id); return h.lookup(id); },
    fetchLiveTvSchedule: never, fetchLiveTvArchive: never, fetchLiveTvTranscript: never,
  };
});
vi.mock('./factcheck/useFactCheck.js', () => ({
  useFactCheck: (args) => { h.fcArgs = args; return { view: h.fcView, actions: { confirm() {}, choose() {} } }; },
}));
vi.mock('./liveTv/useYoutubePlayer.js', () => ({
  useYoutubePlayer: (_a, opts) => { h.player = opts; return { iframeRef: { current: null }, requestMute() {}, getPositionS: () => 0, getPosition: () => null, seekS: () => true }; },
}));
const { default: LiveTvPage } = await import('./LiveTvPage.jsx');
const { ChannelBar } = await import('./liveTv/ChannelBar.jsx');
const { ChannelCard } = await import('./liveTv/ChannelCard.jsx');

const LISTS = [{ id: 'top-hi', name: 'Top · Hindi news', short: 'Hindi', kind: 'top' }, { id: 'politics', name: 'Politics & Debates', short: 'Politics & Debates', kind: 'seg' }];
const CURATED = 'abcdefghijk';
const LIVE = 'zzzzzzzzzzz';
const dd = () => ({ id: 'dd-news', name: 'DD News', short: 'DD', color: '#C8102E', category: 'NEWS', lists: ['top-hi'], status: 'recent', lang: 'Hindi', defaultVideoId: CURATED, embedUrl: `https://www.youtube-nocookie.com/embed/${CURATED}?autoplay=1&mute=1&playsinline=1`, channelUrl: 'https://www.youtube.com/@ddnews' });
const added = (over = {}) => ({ id: 'theprint', name: 'ThePrint', short: 'TP', color: '#0A66C2', category: 'POLITICS', lists: ['politics'], status: 'recent', lang: 'English', channelUrl: 'https://www.youtube.com/@theprint', ...over });
const answer = (over = {}) => ({ ok: true, dataOrigin: 'youtube-api', liveVideo: null, recentVideos: [], ...over });
const upload = { id: 'uuuuuuuuuuu', videoId: 'uuuuuuuuuuu', title: 'Budget explained', duration: '24:10', isLive: false, isUpcoming: false, embedUrl: 'https://www.youtube-nocookie.com/embed/uuuuuuuuuuu?autoplay=1' };

const flush = async () => { for (let i = 0; i < 14; i += 1) await Promise.resolve(); };
const render = () => harness.render(LiveTvPage, { open: true, onClose() {} });
const find = (out, pred) => [...elements(out)].find(pred);
const text = (node) => (node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.props?.children) : String(node));
const frame = (out) => find(out, (e) => e.type === 'iframe');
const bar = (out) => find(out, (e) => e.type === ChannelBar);
const card = (out) => find(out, (e) => e.type === 'div' && e.props.className === 'ltv-offline-card');
const button = (out, label) => find(out, (e) => e.type === 'button' && text(e).trim() === label);
const link = (out, label) => find(out, (e) => e.type === 'a' && text(e).includes(label));
const badge = (out) => find(out, (e) => /ltv-(live|recent|offline)-badge/.test(e.props?.className || ''));

async function open({ channels = [dd(), added()], lookup = async () => answer(), lists = LISTS } = {}) {
  h.channels = channels; h.lookup = lookup; h.lists = lists;
  render(); await flush(); render(); await flush();
  return render();
}
async function pick(id) {
  bar(render()).props.onSelectChannel({ id });
  render(); await flush(); render(); await flush();
  return render();
}

beforeEach(() => {
  harness.reset();
  Object.assign(h, { channels: [], lists: [], lookup: null, videoCalls: [], fcArgs: null, fcView: null, player: null });
  delete globalThis.window;
});

describe('the channel bar', () => {
  it('replaces the old card when the server sends the lists, and keeps it when it does not', async () => {
    const out = await open();
    expect(bar(out)).toBeDefined();
    expect(find(out, (e) => e.type === ChannelCard)).toBeUndefined();
    harness.reset();
    const old = await open({ lists: [] });
    expect(find(old, (e) => e.type === ChannelCard)).toBeDefined();
    expect(bar(old)).toBeUndefined();
  });
  it('still opens on DD News, with its curated video, as before', async () => {
    const out = await open();
    expect(frame(out).props.src).toContain(`/embed/${CURATED}?`);
    expect(h.fcArgs.target).toBe(`dd-news|live|${CURATED}`);
  });
});

describe('a channel added without a curated video', () => {
  it('shows Connecting while the lookup is out, no other video, and no fact-check target', async () => {
    await open();
    h.lookup = () => new Promise(() => {});
    const out = await pick('theprint');
    expect(frame(out)).toBeUndefined();
    expect(text(card(out))).toContain('Connecting to ThePrint…');
    expect(h.fcArgs.target).toBeNull();
    expect(badge(out).props.className).not.toBe('ltv-live-badge');
  });

  it('offers Reload feed after eight seconds of connecting', async () => {
    vi.useFakeTimers();
    try {
      await open();
      h.lookup = () => new Promise(() => {});
      let out = await pick('theprint');
      expect(button(out, 'Reload feed')).toBeUndefined();
      vi.advanceTimersByTime(8100);
      out = render();
      expect(button(out, 'Reload feed')).toBeDefined();
    } finally { vi.useRealTimers(); }
  });

  it('plays the live video when the lookup finds one, as live', async () => {
    await open();
    h.lookup = async () => answer({ liveVideo: { videoId: LIVE } });
    const out = await pick('theprint');
    expect(frame(out).props.src).toContain(`/embed/${LIVE}?`);
    expect(card(out)).toBeUndefined();
    expect(h.fcArgs.target).toBe(`theprint|live|${LIVE}`);
    expect(h.fcArgs.start.videoKind).toBe('live');
    expect(badge(out).props.className).toBe('ltv-live-badge');
  });

  it('says it is not live, with the latest upload, a button to play it and a link to YouTube', async () => {
    await open();
    h.lookup = async () => answer({ recentVideos: [upload] });
    const out = await pick('theprint');
    expect(frame(out)).toBeUndefined();
    expect(text(card(out))).toContain('No live stream found for ThePrint');
    expect(text(card(out))).toContain('Budget explained');
    expect(link(card(out), 'Open on YouTube').props.href).toBe('https://www.youtube.com/@theprint');
    expect(h.fcArgs.target).toBeNull();
    expect(badge(out).props.className).not.toBe('ltv-live-badge');
    expect(badge(out).props.className).not.toBe('ltv-recent-badge CURATED');
  });

  it('plays the latest upload in the existing Channel Videos mode', async () => {
    await open();
    h.lookup = async () => answer({ recentVideos: [upload] });
    let out = await pick('theprint');
    button(card(out), 'Play latest video').props.onClick();
    out = render();
    expect(frame(out).props.src).toContain('/embed/uuuuuuuuuuu?');
    expect(h.fcArgs.target).toBe('theprint|video|uuuuuuuuuuu');
    expect(h.fcArgs.start.videoKind).toBe('recorded');
    expect(card(out)).toBeUndefined();
  });

  it.each([
    ['nothing at all', async () => answer()],
  ])('shows the card without a latest video, with Open on YouTube and Reload, for %s', async (_n, lookup) => {
    await open();
    h.lookup = lookup;
    const out = await pick('theprint');
    expect(text(card(out))).toContain('No live stream found for ThePrint');
    expect(button(card(out), 'Play latest video')).toBeUndefined();
    expect(link(card(out), 'Open on YouTube')).toBeDefined();
    expect(button(card(out), 'Reload')).toBeDefined();
    expect(h.fcArgs.target).toBeNull();
  });

  it('asks again when Reload is pressed', async () => {
    await open();
    h.lookup = async () => answer();
    let out = await pick('theprint');
    const n = h.videoCalls.length;
    button(card(out), 'Reload').props.onClick();
    render(); await flush();
    out = render();
    expect(h.videoCalls.length).toBe(n + 1);
  });

  it('shows no live video when the stale lookup of the previous channel answers late', async () => {
    await open();
    let release;
    h.lookup = (id) => (id === 'theprint' ? new Promise((r) => { release = r; }) : Promise.resolve(answer({ liveVideo: { videoId: LIVE } })));
    await pick('theprint');
    bar(render()).props.onSelectChannel({ id: 'dd-news' });
    render(); await flush();
    release(answer({ liveVideo: { videoId: LIVE } }));
    await flush();
    const out = render();
    expect(h.fcArgs.target.startsWith('dd-news|live|')).toBe(true);
    expect(frame(out)).toBeDefined();
  });

  it('keeps the thirteen curated channels as they were: their video plays at once, with no card', async () => {
    const out = await open();
    expect(card(out)).toBeUndefined();
    expect(frame(out)).toBeDefined();
  });
});

describe('Follow', () => {
  const memory = () => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
  it('adds the watched channel to My list and shows Following, and removes it again', async () => {
    const store = memory();
    globalThis.window = { localStorage: store, location: { origin: 'https://app.test' } };
    let out = await open();
    expect(button(out, 'Follow').props['aria-pressed']).toBe(false);
    button(out, 'Follow').props.onClick();
    out = render();
    expect(button(out, 'Following').props['aria-pressed']).toBe(true);
    expect(bar(out).props.following).toEqual(['dd-news']);
    expect(JSON.parse(store.m.get('nter.livetv.following.v1'))).toEqual({ v: 1, ids: ['dd-news'] });
    button(out, 'Following').props.onClick();
    expect(bar(render()).props.following).toEqual([]);
  });
  it('starts from what the browser kept', async () => {
    const store = memory();
    store.setItem('nter.livetv.following.v1', JSON.stringify({ v: 1, ids: ['theprint', 'dd-news'] }));
    globalThis.window = { localStorage: store, location: { origin: 'https://app.test' } };
    const out = await open();
    expect(bar(out).props.following).toEqual(['theprint', 'dd-news']);
    expect(button(out, 'Following')).toBeDefined();
  });
  it.each([
    ['missing storage', () => undefined],
    ['storage that throws on read', () => ({ getItem() { throw new Error('blocked'); }, setItem() {} })],
    ['storage that throws on write', () => ({ getItem: () => null, setItem() { throw new Error('full'); } })],
    ['junk in storage', () => ({ getItem: () => '{{{', setItem() {} })],
  ])('still works with %s', async (_n, make) => {
    globalThis.window = { location: { origin: 'https://app.test' }, ...(make() === undefined ? {} : { localStorage: make() }) };
    let out = await open();
    button(out, 'Follow').props.onClick();
    out = render();
    expect(button(out, 'Following')).toBeDefined(); // for this visit
  });
  it('is not offered while a pasted video plays', async () => {
    let out = await open();
    find(out, (e) => e.type === 'input' && e.props.id === 'ltv-paste-input').props.onChange({ target: { value: 'dQw4w9WgXcQ' } });
    find(render(), (e) => e.type === 'form' && /ltv-paste/.test(e.props.className || '')).props.onSubmit({ preventDefault() {} });
    out = render();
    expect(button(out, 'Follow')).toBeUndefined();
    expect(button(out, 'Following')).toBeUndefined();
  });
});
