// F422: no captions on the video in any state; the "Fact-check on" pill turns amber and reads "Not hearing anything"
// when the video is muted or silent past the threshold. Also: the page tells the panel whether the paste form is open.
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

const channel = () => ({ id: 'dd-news', name: 'DD News', category: 'NEWS', status: 'recent', lang: 'Hindi', defaultVideoId: 'abcdefghijk', embedUrl: 'https://www.youtube-nocookie.com/embed/abcdefghijk?autoplay=1&mute=1&playsinline=1' });
const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
const render = () => harness.render(LiveTvPage, { open: true, onClose() {} });
const find = (out, pred) => [...elements(out)].find(pred);
const panel = (out) => find(out, (e) => e.props && 'videoTitle' in e.props && 'remainingSeconds' in e.props);
const pill = (out) => find(out, (e) => typeof e.props?.className === 'string' && /(^| )ltv-fcpill( |$)/.test(e.props.className));
const textOf = (el) => [el.props.children].flat(Infinity).filter((c) => typeof c === 'string').join('');
const hasCaptions = (out) => Boolean(find(out, (e) => typeof e.props?.className === 'string' && /ltv-captions/.test(e.props.className)));
async function open() { h.channels = [channel()]; render(); await flush(); return render(); }
const session = (over) => ({ flag: { available: true }, rechecks: {}, session: { status: 'running', claims: [], transcript: [{ seq: 1, text: 'one' }, { seq: 2, text: 'two' }], silentFor: 0, ...over } });
const pasteBody = (out) => [...elements(panel(out).props.linkForm)];

beforeEach(() => { harness.reset(); Object.assign(h, { channels: [], fcView: session(), player: null }); });
afterEach(() => { vi.useRealTimers(); });

describe('no captions on the video', () => {
  it.each(['running', 'ending', 'idle', 'choosing', 'starting', 'ended', 'error', 'ready'])('renders none while the session is %s', async (status) => {
    h.fcView = session({ status });
    const out = await open();
    expect(hasCaptions(out)).toBe(false);
    expect(find(out, (e) => typeof e.type === 'function' && e.type.name === 'LiveCaptions')).toBeUndefined();
  });
  it('renders none when fact-check is not offered', async () => {
    h.fcView = { ...session(), flag: { available: false } };
    expect(hasCaptions(await open())).toBe(false);
  });
});

describe('the Fact-check on pill', () => {
  const verdictClaim = { id: 'c1', quote: 'q', claim_en: 'A claim', kind: 'claim', status: 'checked', verdict: 'supported', reason: 'r', sources: [], checked_at: null };
  const strip = (out) => find(out, (e) => e.props && 'latest' in e.props && 'onSee' in e.props);
  const quiet = (out) => /ltv-fcpill--quiet/.test(pill(out).props.className);
  it('reads "Muted · not hearing" with the quiet class while muted (the page starts muted), even when also silent', async () => {
    let out = await open();
    expect(quiet(out)).toBe(true);
    expect(textOf(pill(out))).toContain('Muted · not hearing');
    h.fcView = session({ silentFor: 60000 });
    out = render();
    expect(textOf(pill(out))).toContain('Muted · not hearing');
  });
  it('reads "Fact-check on" without the class once unmuted and heard', async () => {
    let out = await open();
    panel(out).props.onUnmute();
    out = render();
    expect(quiet(out)).toBe(false);
    expect(textOf(pill(out))).toContain('Fact-check on');
    expect(textOf(pill(out))).not.toContain('Not hearing');
  });
  it('turns quiet only beyond the silence threshold while unmuted', async () => {
    let out = await open();
    panel(out).props.onUnmute();
    h.fcView = session({ silentFor: 30000 });
    expect(quiet(render())).toBe(false);
    h.fcView = session({ silentFor: 30001 });
    out = render();
    expect(quiet(out)).toBe(true);
    expect(textOf(pill(out))).toContain('Not hearing anything');
    h.fcView = session({ silentFor: 0 });
    expect(quiet(render())).toBe(false);
  });
  it('is not shown while the session is ending, and the latest-claim strip stays while running', async () => {
    h.fcView = session({ status: 'ending' });
    expect(pill(await open())).toBeUndefined();
    h.fcView = session({ claims: [verdictClaim] });
    expect(strip(render()).props.latest).toBeTruthy();
    expect(pill(render())).toBeTruthy();
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
  it('opens the form body together with the slot: the same state sets the form\'s is-open (phones hide the body without it)', async () => {
    const formClass = (out) => find(out, (e) => e.type === 'form' && /ltv-paste/.test(e.props.className || '')).props.className;
    let out = await open();
    expect(formClass(out)).not.toContain('is-open');
    panel(out).props.onToggleLink();
    out = render();
    expect(panel(out).props.linkOpen).toBe(true);
    expect(formClass(out)).toContain('is-open');
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

describe('pill and captions CSS', () => {
  const raw = readFileSync(new URL('./liveTv.css', import.meta.url), 'utf8');
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  it('has no .ltv-captions rule left, in any media query or in fullscreen', () => {
    expect(css).not.toMatch(/ltv-captions/);
  });
  it('has a quiet pill rule with an amber dot that does not pulse', () => {
    expect(css).toMatch(/\.ltv-fcpill--quiet \{/);
    const dot = /\.ltv-fcpill--quiet \.ltv-fcpill-dot \{([^}]*)\}/.exec(css);
    expect(dot).toBeTruthy();
    expect(dot[1]).toMatch(/background:\s*#fbbf24/);
    expect(dot[1]).toMatch(/animation:\s*none/);
  });
  it('still stops the green dot pulsing under prefers-reduced-motion', () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.ltv-fcpill-dot \{ animation: none; \}/);
  });
});

describe('the silence threshold', () => {
  it('lives in panelStatus.js and is imported, not re-declared, by the page and the panel', async () => {
    const status = await import('./factcheck/panelStatus.js');
    expect(status.SILENT_NOTICE_MS).toBe(30000);
    for (const f of ['./factcheck/FactCheckPanel.jsx', './LiveTvPage.jsx']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8');
      expect(src, f).not.toMatch(/(const|let) SILENT_NOTICE_MS/);
    }
  });
});
