// F344 T6: how the modal feeds the fact-check hook and where it puts the entry and the panel.
// The hook is replaced by a recorder; its own logic is covered by the controller tests.
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const seen = { args: [], view: null };
vi.mock('./useFactCheck.js', () => ({
  useFactCheck: (args) => {
    seen.args.push(args);
    return { view: seen.view, actions: { choose() {}, cancel() {}, confirm() {}, stop() {}, retry() {}, dismiss() {} } };
  },
}));
const { default: LiveTvModal } = await import('../LiveTvModal.jsx');

const baseSession = {
  status: 'idle', sessionId: null, minutesBought: 0, creditsPerMinute: null, creditsHeld: null, secondsLeft: 0,
  transcript: [], claims: [], silentFor: 0, skippedPieces: 0, droppedTurns: 0, final: null, endReason: null, error: null,
};
const viewWith = (session = {}, extra = {}) => ({
  flag: { available: true, creditsPerMinute: 500, userId: 'u1' }, supported: true, ready: true,
  session: { ...baseSession, ...session }, announcement: '', balance: 10000, ...extra,
});
const render = (props = {}) => renderToStaticMarkup(<LiveTvModal open onClose={() => {}} {...props} />);

beforeEach(() => { seen.args = []; seen.view = viewWith(); });

describe('wiring into the modal', () => {
  it('calls the hook on every render, open or closed, with the same shape', () => {
    render({ open: false });
    render();
    expect(seen.args).toHaveLength(2);
    expect(seen.args[0].open).toBe(false);
    expect(seen.args[1].open).toBe(true);
    expect(Object.keys(seen.args[0]).sort()).toEqual(Object.keys(seen.args[1]).sort());
  });

  it('passes no target and live kind when nothing is playing', () => {
    render();
    const a = seen.args[0];
    expect(a.target).toBeNull();
    expect(a.start.channelId).toBe('');
    expect(a.start).toMatchObject({ videoKind: 'live', startPositionS: null, seed: { channel: '', title: '' } });
  });

  it('puts the entry button in the player controls', () => {
    const html = render();
    const controls = html.slice(html.indexOf('class="ltv-player-controls"'), html.indexOf('</section>'));
    expect(controls).toMatch(/data-fc="open"/);
    expect(html.match(/data-fc="open"/g)).toHaveLength(1);
  });

  it('puts the panel inside the body, right after the player stage and before the tabs', () => {
    seen.view = viewWith({ status: 'running', secondsLeft: 90 });
    const html = render();
    const body = html.indexOf('<div class="ltv-body');
    const stageEnd = html.indexOf('</section>', body);
    const panel = html.indexOf('class="fc-panel');
    const tabs = html.indexOf('<div class="ltv-deck-tabs"');
    expect(body).toBeGreaterThan(-1);
    expect(panel).toBeGreaterThan(stageEnd);
    expect(panel).toBeLessThan(tabs);
    expect(html).not.toMatch(/data-fc="open"/);
  });

  it('renders nothing extra when the flag is off', () => {
    seen.view = viewWith({}, { flag: { available: false, creditsPerMinute: null, userId: null } });
    expect(render()).not.toMatch(/fc-|Fact-check/);
  });

  it('leaves the lower tabs as they were', () => {
    seen.view = viewWith({ status: 'running' });
    const html = render();
    const tabs = html.match(/<button[^>]*role="tab"[^>]*>/g) || [];
    expect(tabs).toHaveLength(4);
    expect(tabs.filter((t) => /tabindex="0"/.test(t))).toHaveLength(1);
  });
});
