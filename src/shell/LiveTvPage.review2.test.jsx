// Review round 2 of B6: a lookup answered from YouTube data is the truth for its channel, the list only a hint
// while it is young; the third state "couldn't check"; Open Desk only to a real tab; My list across tabs.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { harness, elements } from './hookHarness.js';

const h = vi.hoisted(() => ({ channels: [], lists: [], lookup: null, listCalls: 0, videoCalls: [], fcArgs: null, fcView: null, player: null, freeze: false, position: 0, listGate: null }));

vi.mock('react', async (importOriginal) => {
  const p = harness.patch();
  const gate = (name) => (fn, deps) => p[name](h.freeze ? () => {} : fn, deps);
  return { ...(await importOriginal()), ...p, useEffect: gate('useEffect'), useLayoutEffect: gate('useLayoutEffect') };
});
vi.mock('../lib/liveTvClient.js', () => {
  const never = () => new Promise(() => {});
  return {
    fetchLiveTvChannels: async () => { h.listCalls += 1; if (h.listGate) await h.listGate; return { ok: true, channels: h.channels, categories: ['NEWS'], lists: h.lists }; },
    fetchLiveTvVideos: (id) => { h.videoCalls.push(id); return h.lookup(id); },
    fetchLiveTvSchedule: never, fetchLiveTvArchive: never,
  };
});
vi.mock('./factcheck/useFactCheck.js', () => ({
  useFactCheck: (args) => { h.fcArgs = args; return { view: h.fcView, actions: { confirm() {}, choose() {} } }; },
}));
vi.mock('./liveTv/useYoutubePlayer.js', () => ({
  useYoutubePlayer: (_a, opts) => { h.player = opts; return { iframeRef: { current: null }, requestMute() {}, getPositionS: () => h.position, getPosition: () => null, seekS: () => true }; },
}));
const { default: LiveTvPage } = await import('./LiveTvPage.jsx');
const { ChannelBar } = await import('./liveTv/ChannelBar.jsx');
const { TABS } = await import('../desks/tabs.js');

const LISTS = [{ id: 'top-hi', name: 'Top · Hindi news', short: 'Hindi', kind: 'top' }, { id: 'politics', name: 'Politics & Debates', short: 'Politics & Debates', kind: 'seg' }];
const CURATED = 'abcdefghijk';
const X = 'xxxxxxxxxx1';
const Y = 'yyyyyyyyyy1';
const embed = (id) => `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&playsinline=1`;
const dd = (over = {}) => ({ id: 'dd-news', name: 'DD News', short: 'DD', color: '#C8102E', category: 'NEWS', lists: ['top-hi'], status: 'recent', lang: 'Hindi', defaultVideoId: CURATED, embedUrl: embed(CURATED), channelUrl: 'https://www.youtube.com/@ddnews', deskId: 'national', ...over });
const added = (over = {}) => ({ id: 'theprint', name: 'ThePrint', short: 'TP', color: '#0A66C2', category: 'POLITICS', lists: ['politics'], status: 'recent', lang: 'English', channelUrl: 'https://www.youtube.com/@theprint', deskId: 'national', ...over });
const other = (over = {}) => ({ id: 'other', name: 'Other', short: 'OT', color: '#222222', category: 'POLITICS', lists: ['politics'], status: 'recent', lang: 'English', channelUrl: 'https://www.youtube.com/@other', deskId: 'national', ...over });
const none = () => ({ ok: true, dataOrigin: 'youtube-api', liveVideo: null, recentVideos: [] });
const live = (id) => ({ ok: true, dataOrigin: 'youtube-api', liveVideo: { videoId: id }, recentVideos: [] });
const upload = { id: 'uuuuuuuuuuu', videoId: 'uuuuuuuuuuu', title: 'Budget explained', duration: '24:10', isLive: false, isUpcoming: false, embedUrl: embed('uuuuuuuuuuu') };

const flush = async () => { for (let i = 0; i < 14; i += 1) await Promise.resolve(); };
const render = () => harness.render(LiveTvPage, { open: true, onClose() {} });
const find = (out, pred) => [...elements(out)].find(pred);
const text = (node) => (node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.props?.children) : String(node));
const frame = (out) => find(out, (e) => e.type === 'iframe');
const bar = (out) => find(out, (e) => e.type === ChannelBar);
const card = (out) => find(out, (e) => e.type === 'div' && e.props.className === 'ltv-offline-card');
const button = (out, label) => find(out, (e) => e.type === 'button' && text(e).trim() === label);
const link = (out, label) => find(out, (e) => e.type === 'a' && text(e).includes(label));
const badge = (out) => find(out, (e) => /ltv-(live|recent|offline)-badge/.test(e.props?.className || ''))?.props.className;
const tile = (out, id) => bar(out).props.channels.find((c) => c.id === id);

async function open({ channels = [dd(), added(), other()], lookup = async () => none(), lists = LISTS } = {}) {
  h.channels = channels; h.lookup = lookup; h.lists = lists;
  render(); await flush(); render(); await flush();
  return render();
}
async function pick(id) {
  bar(render()).props.onSelectChannel({ id });
  render(); await flush(); render(); await flush();
  return render();
}
const MIN = 60 * 1000;

beforeEach(() => {
  harness.reset(); harness.refFactory = null;
  Object.assign(h, { channels: [], lists: [], lookup: null, listCalls: 0, videoCalls: [], fcArgs: null, fcView: null, player: null, freeze: false, position: 0, listGate: null });
  delete globalThis.window;
});
afterEach(() => { vi.useRealTimers(); delete globalThis.window; harness.refFactory = null; });

describe('1: a lookup from YouTube data is the truth for its channel, including "none"', () => {
  it("the reviewer's case: the list says live video X, the lookup says none: not X, not LIVE, the not-live card", async () => {
    await open({ channels: [dd(), added({ liveVideoId: X }), other()] });
    h.lookup = async () => none();
    const out = await pick('theprint');
    expect(frame(out)).toBeUndefined();
    expect(text(card(out))).toContain('No live stream found for ThePrint');
    expect(badge(out)).not.toBe('ltv-live-badge');
    expect(tile(out, 'theprint').status).not.toBe('live');
    expect(h.fcArgs.target).toBeNull();
  });

  it('a remembered live video the list confirmed earlier is dropped when the lookup says none', async () => {
    await open({ channels: [dd(), added({ status: 'live', hinted: true, defaultVideoId: X, embedUrl: embed(X) }), other()] });
    h.lookup = async () => none();
    const out = await pick('theprint');
    expect(frame(out)).toBeUndefined();
    expect(text(card(out))).toContain('No live stream found');
    expect(badge(out)).not.toBe('ltv-live-badge');
    expect(tile(out, 'theprint').status).not.toBe('live');
  });

  it('a curated video the list called live is still played when the lookup says none, but it is not called LIVE', async () => {
    h.lookup = async () => none();
    const out = await open({ channels: [dd({ status: 'live' }), added(), other()], lookup: async () => none() });
    expect(frame(out).props.src).toContain(`/embed/${CURATED}?`);
    expect(badge(out)).not.toBe('ltv-live-badge');
    expect(tile(out, 'dd-news').status).not.toBe('live');
  });

  it('a curated video the list called live stays LIVE when the lookup agrees', async () => {
    const out = await open({ channels: [dd({ status: 'live' }), added(), other()], lookup: async () => live(CURATED) });
    expect(badge(out)).toBe('ltv-live-badge');
    expect(tile(out, 'dd-news').status).toBe('live');
  });

  it('the list is believed while the lookup is out, if the list is young', async () => {
    await open({ channels: [dd(), added({ liveVideoId: X }), other()] });
    h.lookup = () => new Promise(() => {});
    const out = await pick('theprint');
    expect(frame(out).props.src).toContain(`/embed/${X}?`);
    expect(badge(out)).toBe('ltv-live-badge');
  });

  it('the list is not believed while the lookup is out once it is over ten minutes old', async () => {
    vi.useFakeTimers();
    await open({ channels: [dd(), added({ liveVideoId: X }), other()] });
    h.lookup = () => new Promise(() => {});
    vi.setSystemTime(Date.now() + 11 * MIN);
    h.listGate = new Promise(() => {}); // the new read of the list is still on its way
    const out = await pick('theprint');
    expect(frame(out)).toBeUndefined();
    expect(badge(out)).not.toBe('ltv-live-badge');
  });

  it('tiles of other channels stop saying LIVE when the list is over ten minutes old', async () => {
    vi.useFakeTimers();
    let out = await open({ channels: [dd(), added({ liveVideoId: X }), other()] });
    expect(tile(out, 'theprint').status).toBe('live');
    vi.advanceTimersByTime(10 * MIN + 1000);
    out = render();
    expect(tile(out, 'theprint').status).not.toBe('live');
  });

  it('reads the list again when a channel is picked after ten minutes, and not before', async () => {
    vi.useFakeTimers();
    await open();
    const n = h.listCalls;
    vi.setSystemTime(Date.now() + 5 * MIN);
    await pick('theprint');
    expect(h.listCalls).toBe(n);
    vi.setSystemTime(Date.now() + 6 * MIN);
    await pick('other');
    expect(h.listCalls).toBe(n + 1);
  });

  it('a lookup that finds a live video overrides a list that says none', async () => {
    await open();
    h.lookup = async () => live(Y);
    const out = await pick('theprint');
    expect(frame(out).props.src).toContain(`/embed/${Y}?`);
    expect(badge(out)).toBe('ltv-live-badge');
  });

  it('never drops a list-confirmed live video under a session running on it: a late "none" arrives while the session runs', async () => {
    let release;
    h.channels = [dd(), added({ status: 'live', hinted: true, defaultVideoId: X, embedUrl: embed(X) }), other()]; h.lists = LISTS;
    h.lookup = (id) => (id === 'theprint' ? new Promise((r) => { release = r; }) : Promise.resolve(none()));
    render(); await flush(); render(); await flush();
    bar(render()).props.onSelectChannel({ id: 'theprint' });
    render(); await flush(); render();
    expect(frame(render()).props.src).toContain(`/embed/${X}?`); // the list's confirmation is believed while the lookup is out
    h.fcView = { flag: { available: true }, session: { status: 'running', claims: [] }, rechecks: {} };
    render(); // the session is running on that video
    expect(h.fcArgs.target).toBe(`theprint|live|${X}`);
    release(none()); // the late answer: YouTube says it is not live
    await flush();
    const out = render();
    expect(frame(out).props.src).toContain(`/embed/${X}?`); // the video is not taken away under the session
    expect(h.fcArgs.target).toBe(`theprint|live|${X}`);
    // and once the session is over, the answer is taken: the video goes
    h.fcView = { flag: { available: true }, session: { status: 'ended', claims: [] }, rechecks: {} };
    render(); render();
    expect(frame(render())).toBeUndefined();
  });
});

describe('1 (round 2): a LIVE answer ages; nothing is swapped or asked because of age', () => {
  it('after ten minutes the badge and tile stop saying LIVE, the video keeps playing, and no request is made', async () => {
    vi.useFakeTimers();
    await open();
    h.lookup = async () => live(Y);
    let out = await pick('theprint');
    expect(badge(out)).toBe('ltv-live-badge');
    expect(tile(out, 'theprint').status).toBe('live');
    const [calls, lists] = [h.videoCalls.length, h.listCalls];
    vi.advanceTimersByTime(9 * MIN);
    expect(badge(render())).toBe('ltv-live-badge');
    vi.advanceTimersByTime(60 * MIN);
    out = render();
    expect(frame(out).props.src).toContain(`/embed/${Y}?`);
    expect(badge(out)).not.toBe('ltv-live-badge');
    expect(tile(out, 'theprint').status).not.toBe('live');
    expect(h.fcArgs.target).toBe(`theprint|live|${Y}`);
    expect(h.videoCalls.length).toBe(calls);
    expect(h.listCalls).toBe(lists);
  });
  it('draws again by itself when the ten minutes are over: the page sets a timer', async () => {
    vi.useFakeTimers();
    await open();
    h.lookup = async () => live(Y);
    await pick('theprint');
    harness.dirty = false;
    vi.advanceTimersByTime(10 * MIN + 100); // the page's own timer fires and asks for a new draw
    expect(harness.dirty).toBe(true);
  });
  it('a "none" answer needs no ageing', async () => {
    vi.useFakeTimers();
    await open();
    h.lookup = async () => none();
    await pick('theprint');
    vi.advanceTimersByTime(90 * MIN);
    expect(text(card(render()))).toContain('No live stream found');
  });
  it('a curated video the lookup confirmed stops being called LIVE after ten minutes, and keeps playing', async () => {
    vi.useFakeTimers();
    let out = await open({ channels: [dd({ status: 'live' }), added(), other()], lookup: async () => live(CURATED) });
    expect(badge(out)).toBe('ltv-live-badge');
    vi.advanceTimersByTime(11 * MIN);
    out = render();
    expect(frame(out).props.src).toContain(`/embed/${CURATED}?`);
    expect(badge(out)).not.toBe('ltv-live-badge');
  });
  it('a remembered live video the list confirmed is not stopped because the list got old', async () => {
    vi.useFakeTimers();
    h.lookup = () => new Promise(() => {});
    let out = await open({ channels: [dd(), added({ status: 'live', hinted: true, defaultVideoId: X, embedUrl: embed(X) }), other()], lookup: () => new Promise(() => {}) });
    out = await pick('theprint');
    expect(frame(out).props.src).toContain(`/embed/${X}?`);
    vi.advanceTimersByTime(3 * 60 * MIN);
    out = render();
    expect(frame(out).props.src).toContain(`/embed/${X}?`);
    expect(badge(out)).not.toBe('ltv-live-badge');
  });
});

describe('2 (round 2): the lookup is the truth at once', () => {
  it('plays the live video the lookup names at once, instead of a curated one the list called live', async () => {
    vi.useFakeTimers();
    const out = await open({ channels: [dd({ status: 'live' }), added(), other()], lookup: async () => live(Y) });
    expect(frame(out).props.src).toContain(`/embed/${Y}?`);
    expect(h.fcArgs.target).toBe(`dd-news|live|${Y}`);
    expect(badge(out)).toBe('ltv-live-badge');
    vi.advanceTimersByTime(30 * MIN);
    expect(frame(render()).props.src).toContain(`/embed/${Y}?`); // no switch later from a timer
  });
  it('does not call the curated video LIVE while the lookup has named another', async () => {
    const out = await open({ channels: [dd({ status: 'live' }), added(), other()], lookup: async () => live(Y) });
    expect(frame(out).props.src).not.toContain(CURATED);
  });
  it('does not switch under a session running on the curated video', async () => {
    let release;
    h.channels = [dd({ status: 'live' }), added(), other()]; h.lists = LISTS;
    h.lookup = () => new Promise((r) => { release = r; });
    render(); await flush(); render(); await flush();
    h.fcView = { flag: { available: true }, session: { status: 'running', claims: [] }, rechecks: {} };
    render();
    release(live(Y)); await flush();
    expect(frame(render()).props.src).toContain(`/embed/${CURATED}?`);
  });
});

describe('5 (round 2): a failed lookup contradicts nothing', () => {
  const failed = async () => ({ ok: false, error: 'HTTP 500', recentVideos: [] });
  it('keeps a young list\'s live video id: the video plays and is called LIVE', async () => {
    await open({ channels: [dd(), added({ liveVideoId: X }), other()] });
    h.lookup = failed;
    const out = await pick('theprint');
    expect(frame(out).props.src).toContain(`/embed/${X}?`);
    expect(badge(out)).toBe('ltv-live-badge');
  });
  it('keeps a young list\'s live status too', async () => {
    h.lookup = failed;
    const out = await open({ channels: [dd({ status: 'live' }), added(), other()], lookup: failed });
    expect(frame(out).props.src).toContain(`/embed/${CURATED}?`);
    expect(badge(out)).toBe('ltv-live-badge');
  });
});

describe('4: three honest states', () => {
  it.each([
    ['a fallback answer', async () => ({ ok: true, dataOrigin: 'fallback', reason: 'quota', liveVideo: null, recentVideos: [upload] })],
    ['a failed answer', async () => ({ ok: false, error: 'HTTP 500', recentVideos: [] })],
    ['a thrown error', async () => { throw new Error('network'); }],
    ['an answer with no data origin', async () => ({ ok: true, liveVideo: null, recentVideos: [upload] })],
  ])("says it could not check, and claims nothing about the latest upload, for %s", async (_n, lookup) => {
    await open();
    h.lookup = lookup;
    const out = await pick('theprint');
    expect(text(card(out))).toContain("Couldn't check ThePrint right now");
    expect(text(card(out))).not.toContain('No live stream found');
    expect(text(card(out))).not.toContain('Budget explained');
    expect(button(card(out), 'Play latest video')).toBeUndefined();
    expect(link(card(out), 'Open on YouTube').props.href).toBe('https://www.youtube.com/@theprint');
    expect(button(card(out), 'Try again')).toBeDefined();
    expect(h.fcArgs.target).toBeNull();
    expect(badge(out)).not.toBe('ltv-live-badge');
  });
  it('says "No live stream found" only for an answer from YouTube data', async () => {
    await open();
    h.lookup = async () => ({ ...none(), recentVideos: [upload] });
    const out = await pick('theprint');
    expect(text(card(out))).toContain('No live stream found for ThePrint');
    expect(text(card(out))).toContain('Budget explained');
  });
  it('Try again asks the lookup again', async () => {
    await open();
    h.lookup = async () => ({ ok: false, error: 'x', recentVideos: [] });
    let out = await pick('theprint');
    let calls = 0;
    h.lookup = async () => { calls += 1; return live(Y); };
    button(card(out), 'Try again').props.onClick();
    render(); await flush(); render(); await flush();
    out = render();
    expect(calls).toBe(1);
    expect(frame(out).props.src).toContain(`/embed/${Y}?`);
  });
});

describe('10: picking a channel never shows the previous channel\'s latest upload', () => {
  it('shows Connecting in the first render after the pick, before any effect has run', async () => {
    await open({ channels: [dd(), added(), other()], lookup: async () => ({ ...none(), recentVideos: [upload] }) });
    await pick('theprint'); // ThePrint's own lookup returned an upload: the card shows it
    h.lookup = () => new Promise(() => {});
    bar(render()).props.onSelectChannel({ id: 'other' });
    h.freeze = true; // no effect runs: this is what the first paint after the click shows
    const first = render();
    expect(text(card(first))).toContain('Connecting to Other…');
    expect(text(card(first))).not.toContain('Budget explained');
    expect(text(card(first))).not.toContain('No live stream found');
  });
});

describe('5: Open Desk only to a desk that exists', () => {
  const deskButton = (out) => find(out, (e) => e.type === 'button' && /Open Desk/.test(text(e)));
  it.each(TABS.map((t) => t.id))('is offered for the real tab %s', async (id) => {
    const out = await open({ channels: [dd({ deskId: id }), added(), other()] });
    expect(deskButton(out)).toBeDefined();
  });
  it.each(['media', 'legislative', 'nowhere', '', undefined])('is hidden for the desk %j, which is not a tab', async (id) => {
    const out = await open({ channels: [dd({ deskId: id }), added(), other()] });
    expect(deskButton(out)).toBeUndefined();
  });
});

describe('7: the page behind the phone sheet', () => {
  it('is inert while the sheet is open', async () => {
    let out = await open();
    expect(find(out, (e) => e.type === 'header')).toBeUndefined(); // F387: no header strip
    expect(find(out, (e) => /ltv-body/.test(e.props?.className || '')).props.inert).toBeUndefined();
    bar(out).props.onModalChange(true);
    out = render();
    expect(find(out, (e) => /ltv-body/.test(e.props?.className || '')).props.inert).toBe(true);
    bar(out).props.onModalChange(false);
    expect(find(render(), (e) => /ltv-body/.test(e.props?.className || '')).props.inert).toBeUndefined();
  });
});

describe('11: My list', () => {
  const memory = (initial) => {
    const m = new Map(initial ? [['nter.livetv.following.v1', initial]] : []);
    return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
  };
  const win = (store, listeners) => ({ location: { origin: 'https://app.test' }, localStorage: store, addEventListener: (t, fn) => { (listeners[t] ||= new Set()).add(fn); }, removeEventListener: (t, fn) => { listeners[t]?.delete(fn); } });

  it('follows the other tab: a storage event for the list updates it', async () => {
    const store = memory(); const listeners = {};
    globalThis.window = win(store, listeners);
    let out = await open();
    expect(bar(out).props.following).toEqual([]);
    store.setItem('nter.livetv.following.v1', JSON.stringify({ v: 1, ids: ['other'] }));
    for (const fn of listeners.storage) fn({ key: 'nter.livetv.following.v1' });
    out = render();
    expect(bar(out).props.following).toEqual(['other']);
    for (const fn of listeners.storage) fn({ key: 'something-else' });
    expect(bar(render()).props.following).toEqual(['other']);
  });
  it('listens only while the page lives', async () => {
    const listeners = {};
    globalThis.window = win(memory(), listeners);
    await open();
    expect([...listeners.storage]).toHaveLength(1);
    harness.unmount();
    expect([...listeners.storage]).toHaveLength(0);
  });
  it('hides ids that are no longer channels but keeps them stored, so a rollout cannot wipe a list', async () => {
    const stored = JSON.stringify({ v: 1, ids: ['gone', 'other', 'also-gone', 'dd-news'] });
    const store = memory(stored);
    globalThis.window = win(store, {});
    const out = await open();
    expect(store.m.get('nter.livetv.following.v1')).toBe(stored); // nothing was written back
    expect(bar(out).props.following).toEqual(['gone', 'other', 'also-gone', 'dd-news']); // the bar shows only the known ones
  });
  it('writes the stored ids back whole when the user follows one more', async () => {
    const store = memory(JSON.stringify({ v: 1, ids: ['gone', 'other'] }));
    globalThis.window = win(store, {});
    const out = await open();
    find(out, (e) => e.type === 'button' && e.props['aria-label'] === 'Follow DD News').props.onClick();
    expect(JSON.parse(store.m.get('nter.livetv.following.v1')).ids).toEqual(['gone', 'other', 'dd-news']);
  });
  it('says the list is full at the cap instead of doing nothing', async () => {
    const ids = Array.from({ length: 60 }, (_, i) => `c${i}`); // none of them is a channel any more: they still count
    globalThis.window = win(memory(JSON.stringify({ v: 1, ids })), {});
    let out = await open();
    find(out, (e) => e.type === 'button' && e.props['aria-label'] === 'Follow DD News').props.onClick();
    out = render();
    expect(text(find(out, (e) => e.props?.role === 'status' && /ltv-follow-note/.test(e.props.className || '')))).toBe('My list is full (60). Unfollow one first.');
    expect(bar(out).props.following).toHaveLength(60);
  });
  it('names the toggle "Follow {channel}" whatever it says, with aria-pressed', async () => {
    globalThis.window = win(memory(), {});
    let out = await open();
    let b = find(out, (e) => e.type === 'button' && e.props['aria-label'] === 'Follow DD News');
    expect([b.props['aria-pressed'], text(b)]).toEqual([false, 'Follow']);
    b.props.onClick();
    b = find(render(), (e) => e.type === 'button' && e.props['aria-label'] === 'Follow DD News');
    expect([b.props['aria-pressed'], text(b)]).toEqual([true, 'Following']);
  });
});

describe('12: what the panel and the controls say', () => {
  const paste = (value) => {
    find(render(), (e) => e.type === 'input' && e.props.id === 'ltv-paste-input').props.onChange({ target: { value } });
    find(render(), (e) => e.type === 'form' && /ltv-paste/.test(e.props.className || '')).props.onSubmit({ preventDefault() {} });
    return render();
  };
  const panel = (out) => find(out, (e) => e.props && 'videoTitle' in e.props && 'remainingSeconds' in e.props);
  it('names a pasted video by its title in the panel, "this video" before it is known, never "YouTube video"', async () => {
    h.fcView = { flag: { available: true }, session: { status: 'idle', claims: [] }, rechecks: {} };
    await open();
    expect(panel(paste('dQw4w9WgXcQ')).props.channelName).toBe('this video');
    h.player.onInfo({ title: 'A long debate', durationS: 300, isLive: false });
    expect(panel(render()).props.channelName).toBe('“A long debate”');
  });
  const hidden = ['Pause', 'Unmute', 'Fullscreen'];
  it('hides Pause, Unmute and Fullscreen while nothing is playing', async () => {
    await open();
    h.lookup = async () => none();
    for (const l of hidden) expect(button(render(), l)).toBeDefined();
    const out = await pick('theprint');
    for (const l of hidden) expect(button(out, l)).toBeUndefined();
    expect(button(out, 'Reload Feed')).toBeDefined();
  });
  it('hides them for a pasted video that cannot be played', async () => {
    await open();
    paste('dQw4w9WgXcQ');
    h.player.onError(150);
    for (const l of hidden) expect(button(render(), l)).toBeUndefined();
  });
});

describe('C: a live stream the player refuses', () => {
  const REFUSED = 'rrrrrrrrrr1';
  const note = (out) => find(out, (e) => e.type === 'p' && /ltv-refused-note/.test(e.props.className || ''));
  const refuse = (code = 150) => { h.player.onError(code); return render(); };

  it("goes back to the curated video, is not LIVE, and says so with a link to the live video (the A2 switch refused)", async () => {
    let out;
    out = await open({ channels: [dd(), added(), other()], lookup: async () => live(REFUSED) });
    expect(frame(out).props.src).toContain(`/embed/${REFUSED}?`);
    out = refuse(150);
    expect(frame(out).props.src).toContain(`/embed/${CURATED}?`);
    expect(badge(out)).not.toBe('ltv-live-badge');
    expect(tile(out, 'dd-news').status).not.toBe('live');
    expect(text(note(out))).toContain("DD News's live stream can't be played here.");
    expect(link(note(out), 'Open on YouTube').props.href).toBe(`https://www.youtube.com/watch?v=${REFUSED}`);
    expect(h.fcArgs.target).toBe(`dd-news|live|${CURATED}`);
  });

  it('does not flip back: the refusal is remembered for the page, across redraws, picks and a new lookup', async () => {
    await open({ channels: [dd(), added(), other()], lookup: async () => live(REFUSED) });
    refuse(101);
    for (let i = 0; i < 3; i += 1) render();
    expect(frame(render()).props.src).toContain(`/embed/${CURATED}?`);
    await pick('other');
    const out = await pick('dd-news'); // looked up again: the same live video is named again
    expect(frame(out).props.src).toContain(`/embed/${CURATED}?`);
    expect(text(note(out))).toContain("live stream can't be played here");
  });

  it('never switches to a live video the answer says may not be embedded', async () => {
    const out = await open({ channels: [dd(), added(), other()], lookup: async () => ({ ...live(REFUSED), embeddable: false, liveVideo: { videoId: REFUSED, embeddable: false } }) });
    expect(frame(out).props.src).toContain(`/embed/${CURATED}?`);
    expect(badge(out)).not.toBe('ltv-live-badge');
    expect(link(note(out), 'Open on YouTube').props.href).toBe(`https://www.youtube.com/watch?v=${REFUSED}`);
  });

  it('never switches to a list-named live video the list says may not be embedded', async () => {
    h.lookup = () => new Promise(() => {});
    const out = await open({ channels: [dd({ liveVideoId: REFUSED, embeddable: false }), added(), other()], lookup: () => new Promise(() => {}) });
    expect(frame(out).props.src).toContain(`/embed/${CURATED}?`);
    expect(note(out)).toBeDefined();
  });

  it('without a curated video, shows the cannot-be-played card with Open on YouTube and offers no fact-check', async () => {
    await open();
    h.lookup = async () => live(REFUSED);
    let out = await pick('theprint');
    expect(frame(out).props.src).toContain(`/embed/${REFUSED}?`);
    out = refuse(150);
    expect(frame(out)).toBeUndefined();
    expect(text(card(out))).toContain("can't be played here");
    expect(link(card(out), 'Open on YouTube').props.href).toBe(`https://www.youtube.com/watch?v=${REFUSED}`);
    expect(h.fcArgs.target).toBeNull();
    expect(badge(out)).not.toBe('ltv-live-badge');
    out = await pick('other'); out = await pick('theprint'); // and it stays so
    expect(frame(out)).toBeUndefined();
  });

  it('when the curated video is refused too, it is the same card', async () => {
    let out = await open({ channels: [dd({ status: 'live' }), added(), other()], lookup: async () => live(CURATED) });
    out = refuse(150);
    expect(frame(out)).toBeUndefined();
    expect(text(card(out))).toContain("can't be played here");
    expect(h.fcArgs.target).toBeNull();
    for (const l of ['Pause', 'Unmute', 'Fullscreen']) expect(button(out, l)).toBeUndefined();
  });

  const running = { flag: { available: true }, session: { status: 'running', claims: [] }, rechecks: {} };
  const ended = { flag: { available: true }, session: { status: 'ended', claims: [] }, rechecks: {} };
  const STOPPED = 'This video stopped playing here. End the fact-check to get unused minutes back.';
  const stopped = (out) => find(out, (e) => e.type === 'p' && /ltv-stopped-note/.test(e.props.className || ''));

  it('a refusal during a running session does not move the video: frame and target stay, and the line says so', async () => {
    await open({ channels: [dd(), added(), other()], lookup: async () => live(REFUSED) });
    h.fcView = running;
    render();
    expect(h.fcArgs.target).toBe(`dd-news|live|${REFUSED}`);
    const out = refuse(150);
    expect(frame(out).props.src).toContain(`/embed/${REFUSED}?`);
    expect(h.fcArgs.target).toBe(`dd-news|live|${REFUSED}`);
    expect(text(stopped(out))).toBe(STOPPED);
    expect(card(out)).toBeUndefined();
    // once the session is over, the refusal is applied as usual: back to the curated video
    h.fcView = ended;
    render();
    const after = render();
    expect(frame(after).props.src).toContain(`/embed/${CURATED}?`);
    expect(stopped(after)).toBeUndefined();
    expect(text(note(after))).toContain("live stream can't be played here");
    expect(h.fcArgs.target).toBe(`dd-news|live|${CURATED}`);
  });

  it('a late answer that says the playing video may not be embedded does not move it either', async () => {
    let release;
    h.channels = [dd(), added({ status: 'live', hinted: true, defaultVideoId: X, embedUrl: embed(X) }), other()]; h.lists = LISTS;
    h.lookup = (id) => (id === 'theprint' ? new Promise((r) => { release = r; }) : Promise.resolve(none()));
    render(); await flush(); render(); await flush();
    bar(render()).props.onSelectChannel({ id: 'theprint' });
    render(); await flush(); render();
    expect(frame(render()).props.src).toContain(`/embed/${X}?`);
    h.fcView = running;
    render();
    release({ ...live(X), embeddable: false, liveVideo: { videoId: X, embeddable: false } });
    await flush();
    const out = render();
    expect(frame(out).props.src).toContain(`/embed/${X}?`);
    expect(h.fcArgs.target).toBe(`theprint|live|${X}`);
    expect(text(stopped(out))).toBe(STOPPED);
    h.fcView = ended;
    render();
    expect(frame(render())).toBeUndefined(); // no curated video: the card
    expect(text(card(render()))).toContain("can't be played here");
  });

  it('a curated video held by a session is not taken away when the player refuses it', async () => {
    let out = await open({ channels: [dd({ status: 'live' }), added(), other()], lookup: async () => live(CURATED) });
    h.fcView = running;
    render();
    out = refuse(150);
    expect(frame(out).props.src).toContain(`/embed/${CURATED}?`);
    expect(h.fcArgs.target).toBe(`dd-news|live|${CURATED}`);
    expect(text(stopped(out))).toBe(STOPPED);
    h.fcView = ended;
    render();
    out = render();
    expect(frame(out)).toBeUndefined();
    expect(text(card(out))).toContain("can't be played here");
  });

  it('a start screen or a finished session does not hold the video', async () => {
    await open({ channels: [dd(), added(), other()], lookup: async () => live(REFUSED) });
    h.fcView = { flag: { available: true }, session: { status: 'choosing', claims: [] }, rechecks: {} };
    render();
    expect(frame(refuse(150)).props.src).toContain(`/embed/${CURATED}?`);
  });

  it('M1: names the reason for the code: 101 and 150 the owner turned playback off, 100 private or removed', async () => {
    await open();
    h.lookup = async () => live(REFUSED);
    let out = await pick('theprint');
    out = refuse(100);
    expect(text(card(out))).toContain('This video is private or was removed.');
    harness.reset();
    await open();
    h.lookup = async () => live(REFUSED);
    out = await pick('theprint');
    out = refuse(101);
    expect(text(card(out))).toContain('Its owner has turned off playback on other sites.');
  });

  it('M1: 153 is a page-wide player error, not a refusal: nothing is remembered and the video stays', async () => {
    await open({ channels: [dd(), added(), other()], lookup: async () => live(REFUSED) });
    const out = refuse(153);
    expect(frame(out).props.src).toContain(`/embed/${REFUSED}?`);
    expect(note(out)).toBeUndefined();
    expect(text(find(out, (e) => e.type === 'p' && /ltv-np-note/.test(e.props.className || '')))).toContain('The player reported a problem with this video.');
    expect(h.fcArgs.target).toBe(`dd-news|live|${REFUSED}`);
  });

  it('M2: Reload Feed lets a refused video be tried again', async () => {
    await open({ channels: [dd(), added(), other()], lookup: async () => live(REFUSED) });
    let out = refuse(150);
    expect(frame(out).props.src).toContain(`/embed/${CURATED}?`);
    button(out, 'Reload Feed').props.onClick();
    render(); await flush(); render(); await flush(); // the channel is asked about again
    out = render();
    expect(frame(out).props.src).toContain(`/embed/${REFUSED}?`);
    out = refuse(150); // refused again: remembered again
    expect(frame(out).props.src).toContain(`/embed/${CURATED}?`);
  });

  it('M2: Try again clears the refusal, and an answer that says it may not be embedded marks it again', async () => {
    await open();
    h.lookup = async () => ({ ...live(REFUSED), embeddable: false, liveVideo: { videoId: REFUSED, embeddable: false } });
    let out = await pick('theprint');
    expect(text(card(out))).toContain("can't be played here");
    h.lookup = async () => live(REFUSED); // the owner turned embedding on
    button(out, 'Reload Feed').props.onClick();
    render(); await flush(); render(); await flush();
    out = render();
    expect(frame(out).props.src).toContain(`/embed/${REFUSED}?`);
  });

  it.each([2, 5, 99])('a player error code %s that is not a refusal changes nothing', async (code) => {
    await open({ channels: [dd(), added(), other()], lookup: async () => live(REFUSED) });
    const out = refuse(code);
    expect(frame(out).props.src).toContain(`/embed/${REFUSED}?`);
    expect(note(out)).toBeUndefined();
  });

  it('is only about the live mode: a refusal while another mode plays does not mark the channel\'s live video', async () => {
    await open({ channels: [dd(), added(), other()], lookup: async () => live(REFUSED) });
    find(render(), (e) => e.type === 'input' && e.props.id === 'ltv-paste-input').props.onChange({ target: { value: 'dQw4w9WgXcQ' } });
    find(render(), (e) => e.type === 'form' && /ltv-paste/.test(e.props.className || '')).props.onSubmit({ preventDefault() {} });
    render();
    h.player.onError(150);
    button(render(), 'Back to channels').props.onClick();
    expect(frame(render()).props.src).toContain(`/embed/${REFUSED}?`);
  });
});
