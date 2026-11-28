// F417: the live captions sit on the player inside .ltv-video-container while a session runs or ends, and the
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

describe('captions raised above the latest-claim strip', () => {
  const verdictClaim = { id: 'c1', quote: 'q', claim_en: 'A claim', kind: 'claim', status: 'checked', verdict: 'supported', reason: 'r', sources: [], checked_at: null };
  const strip = (out) => find(out, (e) => e.props && 'latest' in e.props && 'onSee' in e.props);
  it('are raised exactly while the strip shows a claim', async () => {
    h.fcView = session({ claims: [verdictClaim] });
    let out = await open();
    expect(strip(out).props.latest).toBeTruthy();
    expect(captionsIn(out).props.raised).toBe(true);
    h.fcView = session({ claims: [] }); // running, but no claim with a verdict yet: no strip content
    out = render();
    expect(strip(out).props.latest).toBeNull();
    expect(captionsIn(out).props.raised).toBe(false);
  });
  it('are not raised while ending (the strip is only for a running session)', async () => {
    h.fcView = session({ status: 'ending', claims: [verdictClaim] });
    const out = await open();
    expect(strip(out)).toBeUndefined();
    expect(captionsIn(out).props.raised).toBe(false);
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

describe('captions CSS', () => {
  const css = readFileSync(new URL('./liveTv.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (selector, from = 0) => {
    const at = css.indexOf(`${selector} {`, from);
    expect(at, selector).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf('}', at));
  };
  const bottom = (r) => Number(/bottom:\s*(\d+)px/.exec(r)[1]);
  const px = (r, prop) => Number(new RegExp(`${prop}:\\s*(\\d+)px`).exec(r)[1]);
  const touchAt = css.indexOf('@media (max-width: 1080px), (pointer: coarse) {');
  const phonesAt = css.indexOf('@media (max-width: 600px) {');
  // The strip: 6px padding above and below its button; the button is 28px, or 40px under the page's touch rule.
  const stripPad = 12;
  const fineHeight = stripPad + px(rule('.ltv-claimstrip-btn'), 'min-height');
  const touchHeight = stripPad + px(css.slice(touchAt), 'min-height');
  const GAP = 4;
  it('never takes a click', () => {
    expect(rule('.ltv-captions')).toMatch(/pointer-events:\s*none/);
  });
  it('uses a class set by the page, not :has()', () => {
    expect(css).not.toMatch(/\.ltv-captions:has/);
    expect(css).toMatch(/\.ltv-captions\.is-raised \{/);
  });
  it('knows the strip heights: about 40px on a fine pointer, about 52px where the 40px rule applies', () => {
    expect(fineHeight).toBe(40);
    expect(touchHeight).toBe(52);
  });
  it('sits at the strip place, and clears the 40px strip by at least 4px on a fine pointer above 1080px', () => {
    const strip = bottom(rule('.ltv-claimstrip-live'));
    expect(bottom(rule('.ltv-captions'))).toBe(strip);
    expect(bottom(rule('.ltv-captions.is-raised'))).toBeGreaterThanOrEqual(strip + fineHeight + GAP);
  });
  it('clears the 52px strip by at least 4px on touch screens and at 1080px and below', () => {
    const touch = css.slice(touchAt, css.indexOf('\n}', touchAt));
    const strip = bottom(rule('.ltv-claimstrip-live'));
    expect(bottom(rule('.ltv-captions.is-raised', touchAt))).toBeGreaterThanOrEqual(strip + touchHeight + GAP);
    expect(touch).toMatch(/\.ltv-captions\.is-raised \{/);
  });
  it('clears the 52px strip by at least 4px on phones, where the strip sits at 52px', () => {
    const stripBottom = bottom(rule('.ltv-claimstrip-live', phonesAt));
    expect(stripBottom).toBe(52);
    expect(bottom(rule('.ltv-captions', phonesAt))).toBe(stripBottom);
    expect(bottom(rule('.ltv-captions.is-raised', phonesAt))).toBeGreaterThanOrEqual(stripBottom + touchHeight + GAP);
  });
  it('is white on a dark translucent band, larger in fullscreen', () => {
    const text = rule('.ltv-captions-text');
    expect(text).toMatch(/color:\s*#fff/);
    expect(text).toMatch(/background:\s*rgba\(0, 0, 0, 0\.[5-9]/);
    expect(rule(':fullscreen .ltv-captions-text')).toMatch(/font-size:\s*22px/);
  });
});

describe('the silence threshold', () => {
  it('lives in panelStatus.js and is not re-declared by the captions or the panel', async () => {
    const status = await import('./factcheck/panelStatus.js');
    expect(status.SILENT_NOTICE_MS).toBe(30000);
    expect(await import('./factcheck/LiveCaptions.jsx')).not.toHaveProperty('SILENT_NOTICE_MS');
    for (const f of ['./factcheck/FactCheckPanel.jsx', './factcheck/LiveCaptions.jsx', './LiveTvPage.jsx']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8');
      expect(src, f).not.toMatch(/(const|let) SILENT_NOTICE_MS/);
    }
  });
});
