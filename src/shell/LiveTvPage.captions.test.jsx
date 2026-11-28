// F416: the live captions sit on the player inside .ltv-video-container while a session runs or ends, and the
// page tells the panel whether the paste form is open (linkOpen / onToggleLink).
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { harness, elements } from './hookHarness.js';

const h = vi.hoisted(() => ({ channels: [], fcView: null, player: null }));

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal()), ...harness.patch() }));
vi.mock('../lib/liveTvClient.js', () => {
  const never = () => new Promise(() => {});
  return {
    fetchLiveTvChannels: async () => ({ ok: true, channels: h.channels, categories: ['NEWS'] }),
    fetchLiveTvVideos: never, fetchLiveTvSchedule: never, fetchLiveTvArchive: never,
  };
});
vi.mock('./factcheck/useFactCheck.js', () => ({
  useFactCheck: () => ({ view: h.fcView, actions: { confirm() {}, choose() {} } }),
}));
vi.mock('./liveTv/useYoutubePlayer.js', () => ({
  useYoutubePlayer: (_a, opts) => {
    h.player = opts;
    return { iframeRef: { current: null }, requestMute() {}, getPositionS: () => 5, getPosition: () => ({ positionS: 5, playerState: 1 }), seekS: () => true };
  },
}));
const { default: LiveTvPage } = await import('./LiveTvPage.jsx');
const { LiveCaptions } = await import('./factcheck/LiveCaptions.jsx');

const channel = () => ({ id: 'dd-news', name: 'DD News', category: 'NEWS', status: 'recent', lang: 'Hindi', defaultVideoId: 'abcdefghijk', embedUrl: 'https://www.youtube-nocookie.com/embed/abcdefghijk?autoplay=1&mute=1&playsinline=1' });
const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
const render = () => harness.render(LiveTvPage, { open: true, onClose() {} });
const find = (out, pred) => [...elements(out)].find(pred);
const panel = (out) => find(out, (e) => e.props && 'videoTitle' in e.props && 'remainingSeconds' in e.props);
const container = (out) => find(out, (e) => e.type === 'div' && e.props.className === 'ltv-video-container');
const captions = (out) => find(out, (e) => e.type === LiveCaptions);
const captionsIn = (out) => [...elements(container(out).props.children)].find((e) => e.type === LiveCaptions);
async function open() { h.channels = [channel()]; render(); await flush(); return render(); }
const session = (over) => ({ flag: { available: true }, rechecks: {}, session: { status: 'running', claims: [], transcript: [{ seq: 1, text: 'one' }, { seq: 2, text: 'two' }], silentFor: 0, ...over } });
const pasteBody = (out) => [...elements(panel(out).props.linkForm)];

beforeEach(() => { harness.reset(); Object.assign(h, { channels: [], fcView: session(), player: null }); });
afterEach(() => { vi.useRealTimers(); });

describe('captions on the player', () => {
  it('render inside .ltv-video-container with the transcript while the session runs', async () => {
    const out = await open();
    const c = captionsIn(out);
    expect(c).toBeTruthy();
    expect(c.props.lines).toEqual([{ seq: 1, text: 'one' }, { seq: 2, text: 'two' }]);
  });
  it('render while the session is ending', async () => {
    h.fcView = session({ status: 'ending' });
    expect(captionsIn(await open())).toBeTruthy();
  });
  it.each(['idle', 'choosing', 'starting', 'ended', 'error', 'ready'])('are not rendered while the session is %s', async (status) => {
    h.fcView = session({ status });
    expect(captions(await open())).toBeUndefined();
  });
  it('are not rendered when fact-check is not offered', async () => {
    h.fcView = { ...session(), flag: { available: false } };
    expect(captions(await open())).toBeUndefined();
  });
  it('are listening only while running, unmuted and heard within the silence notice', async () => {
    let out = await open();
    expect(captionsIn(out).props.listening).toBe(false); // the page starts muted
    panel(out).props.onUnmute();
    out = render();
    expect(captionsIn(out).props.listening).toBe(true);
    h.fcView = session({ silentFor: 30001 });
    expect(captionsIn(render()).props.listening).toBe(false);
    h.fcView = session({ silentFor: 30000 });
    expect(captionsIn(render()).props.listening).toBe(true);
    h.fcView = session({ status: 'ending' });
    expect(captionsIn(render()).props.listening).toBe(false);
  });
});

describe('the paste link wiring', () => {
  it('gives the panel linkOpen (false at first) and a toggle that flips it', async () => {
    const out = await open();
    expect(panel(out).props.linkOpen).toBe(false);
    panel(out).props.onToggleLink();
    expect(panel(render()).props.linkOpen).toBe(true);
    panel(render()).props.onToggleLink();
    expect(panel(render()).props.linkOpen).toBe(false);
  });
  it('closes the form once a link is loaded', async () => {
    let out = await open();
    panel(out).props.onToggleLink();
    out = render();
    expect(panel(out).props.linkOpen).toBe(true);
    find(out, (e) => e.type === 'input' && e.props.id === 'ltv-paste-input').props.onChange({ target: { value: 'https://youtu.be/dQw4w9WgXcQ' } });
    find(render(), (e) => e.type === 'form' && /ltv-paste/.test(e.props.className || '')).props.onSubmit({ preventDefault() {} });
    expect(panel(render()).props.linkOpen).toBe(false);
  });
  it('keeps the form open when the link is not valid', async () => {
    let out = await open();
    panel(out).props.onToggleLink();
    out = render();
    find(out, (e) => e.type === 'input' && e.props.id === 'ltv-paste-input').props.onChange({ target: { value: 'not a link' } });
    find(render(), (e) => e.type === 'form' && /ltv-paste/.test(e.props.className || '')).props.onSubmit({ preventDefault() {} });
    expect(panel(render()).props.linkOpen).toBe(true);
    expect(pasteBody(render()).length).toBeGreaterThan(0);
  });
});

describe('captions CSS', () => {
  const css = readFileSync(new URL('./liveTv.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (selector) => {
    const at = css.indexOf(`${selector} {`);
    expect(at, selector).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf('}', at));
  };
  it('never takes a click', () => {
    expect(rule('.ltv-captions')).toMatch(/pointer-events:\s*none/);
  });
  it('sits at the claim strip place and above the strip when it shows a claim', () => {
    const base = Number(/bottom:\s*(\d+)px/.exec(rule('.ltv-captions'))[1]);
    const strip = Number(/bottom:\s*(\d+)px/.exec(rule('.ltv-claimstrip-live'))[1]);
    const raised = Number(/bottom:\s*(\d+)px/.exec(rule('.ltv-captions:has(~ .ltv-claimstrip-live .ltv-claimstrip)'))[1]);
    expect(base).toBe(strip);
    expect(raised).toBeGreaterThan(strip + 36); // above the strip's own height
  });
  it('does the same on phones, above the 52px strip', () => {
    const phones = css.slice(css.indexOf('@media (max-width: 600px) {'));
    expect(/\.ltv-captions \{[^}]*bottom:\s*52px/.exec(phones)).toBeTruthy();
    expect(Number(/\.ltv-captions:has\(~ \.ltv-claimstrip-live \.ltv-claimstrip\) \{\s*bottom:\s*(\d+)px/.exec(phones)[1])).toBeGreaterThan(52 + 40);
  });
  it('is white on a dark translucent band, larger in fullscreen', () => {
    const text = rule('.ltv-captions-text');
    expect(text).toMatch(/color:\s*#fff/);
    expect(text).toMatch(/background:\s*rgba\(0, 0, 0, 0\.[5-9]/);
    expect(rule(':fullscreen .ltv-captions-text')).toMatch(/font-size:\s*22px/);
  });
});
