// F360 T4: where the page puts "Past sessions" and what it hands it. The section itself is replaced by a
// recorder; its own behaviour is covered by PastSessions.test.jsx and usePastSessions.test.js.
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const seen = { view: null, props: [] };
vi.mock('./useFactCheck.js', () => ({
  useFactCheck: () => ({ view: seen.view, actions: { choose() {}, cancel() {}, confirm() {}, stop() {}, retry() {}, dismiss() {} } }),
}));
vi.mock('./PastSessions.jsx', () => ({
  PastSessions: (props) => {
    seen.props.push(props);
    return props.enabled ? <section className="pst" data-status={props.sessionStatus} /> : null;
  },
}));
vi.mock('../liveTv/useYoutubePlayer.js', () => ({
  useYoutubePlayer: () => ({ iframeRef: { current: null }, requestMute() {}, getPositionS: () => 77 }),
}));
const { default: LiveTvPage } = await import('../LiveTvPage.jsx');

const baseSession = {
  status: 'idle', sessionId: null, minutesBought: 0, creditsPerMinute: null, creditsHeld: null, secondsLeft: 0,
  transcript: [], claims: [], silentFor: 0, skippedPieces: 0, droppedTurns: 0, final: null, endReason: null, error: null,
};
const viewWith = (session = {}, available = true) => ({
  flag: { available, creditsPerMinute: 500, userId: available ? 'u1' : null }, supported: true, ready: true,
  session: { ...baseSession, ...session }, announcement: '', balance: 10000,
});
const render = () => renderToStaticMarkup(<LiveTvPage open onClose={() => {}} />);
beforeEach(() => { seen.props = []; seen.view = viewWith(); });

describe('Past sessions on the page (F360)', () => {
  it('sits after the page body, as a sibling of it, and after the tabs', () => {
    seen.view = viewWith({ status: 'running' });
    const html = render();
    const pst = html.indexOf('<section class="pst"');
    expect(pst).toBeGreaterThan(html.indexOf('class="ltv-deck-tabs"'));
    expect(pst).toBeGreaterThan(html.indexOf('class="fc-panel'));
    // the body's last two closing tags come right before it: the section is not inside the body
    expect(html.slice(0, pst)).toMatch(/<\/div><\/div>$/);
    expect(html.slice(pst)).toMatch(/^<section class="pst"[^>]*><\/section><\/div><\/section>$/);
    expect(html.match(/class="ltv-main"/g)).toHaveLength(1);
    expect(html.indexOf('class="ltv-main"')).toBeLessThan(html.indexOf('class="ltv-body"'));
  });

  it('is gated by the fact-check flag', () => {
    seen.view = viewWith({}, false);
    const html = render();
    expect(html).not.toContain('class="pst"');
    expect(seen.props.at(-1).enabled).toBe(false);
    seen.view = viewWith({}, true);
    render();
    expect(seen.props.at(-1).enabled).toBe(true);
  });

  it('is off when the hook has no view at all', () => {
    seen.view = null;
    render();
    expect(seen.props.at(-1).enabled).toBe(false);
  });

  it('hands over the session status that triggers the reload, and the channel list', () => {
    seen.view = viewWith({ status: 'ended' });
    render();
    expect(seen.props.at(-1).sessionStatus).toBe('ended');
    expect(Array.isArray(seen.props.at(-1).channels)).toBe(true);
  });
});

it('hands over the user id the flag view already holds (M4)', () => {
  seen.view = viewWith({}, true);
  render();
  expect(seen.props.at(-1).userId).toBe('u1');
});

// M8: the layout rules that keep the panel's size. Read from the stylesheet, since the markup alone cannot show them.
describe('layout rules (M8)', () => {
  const css = readFileSync(new URL('./factCheck.css', import.meta.url), 'utf8');
  const rule = (selector) => {
    const i = css.indexOf(selector);
    return i < 0 ? null : css.slice(i, css.indexOf('}', i));
  };
  it('pins the body to the wrapper only when the panel is there', () => {
    const pinned = rule('.ltv-main:has(> .pst):has(> .ltv-body > .fc-panel) > .ltv-body');
    expect(pinned).toContain('flex: 0 0 100%');
    expect(css).not.toMatch(/\n\.ltv-main:has\(> \.pst\) > \.ltv-body \{ flex: 0 0 100%/);
  });
  it('lets the body flow when the section is there without the panel, and below 1100px', () => {
    const flow = rule('.ltv-main:has(> .pst) > .ltv-body { flex: 0 0 auto');
    expect(flow).toContain('overflow: visible');
  });
  it('leaves the wrapper alone when there is no section', () => {
    expect(rule('.ltv-main { ')).not.toContain('overflow-y');
  });
});
