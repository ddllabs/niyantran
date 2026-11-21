// F344 T6: how the page feeds the fact-check hook and where it puts the entry and the panel.
// The hook is replaced by a recorder; its own logic is covered by the controller tests.
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const seen = { args: [], view: null, seeks: [] };
vi.mock('./useFactCheck.js', () => ({
  useFactCheck: (args) => {
    seen.args.push(args);
    return { view: seen.view, actions: { choose() {}, cancel() {}, confirm() {}, stop() {}, retry() {}, dismiss() {} } };
  },
}));
vi.mock('../liveTv/useYoutubePlayer.js', () => ({
  useYoutubePlayer: () => ({ iframeRef: { current: null }, requestMute() {}, getPositionS: () => 77, seekS: (s) => { seen.seeks.push(s); return true; } }),
}));
const { default: LiveTvPage } = await import('../LiveTvPage.jsx');

const baseSession = {
  status: 'idle', sessionId: null, minutesBought: 0, creditsPerMinute: null, creditsHeld: null, secondsLeft: 0,
  transcript: [], claims: [], silentFor: 0, skippedPieces: 0, droppedTurns: 0, final: null, endReason: null, error: null,
};
const viewWith = (session = {}, extra = {}) => ({
  flag: { available: true, creditsPerMinute: 500, userId: 'u1' }, supported: true, ready: true,
  session: { ...baseSession, ...session }, announcement: '', balance: 10000, ...extra,
});
const render = (props = {}) => renderToStaticMarkup(<LiveTvPage open onClose={() => {}} {...props} />);

beforeEach(() => { seen.args = []; seen.seeks = []; seen.view = viewWith(); });

describe('wiring into the page', () => {
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

  it('hands the hook a seek that moves the player (F363)', () => {
    render();
    expect(seen.args[0].seek(130)).toBe(false); // nothing recorded is playing: a live stream is never moved
    expect(seen.seeks).toEqual([]);
  });

  it('ignores the player position for a live stream even when the player has one', () => {
    render();
    expect(seen.args[0].start.videoKind).toBe('live');
    expect(seen.args[0].start.getStartPositionS()).toBeNull();
  });

  // F366: the panel is always open, so the start control lives in it (idle state); the button under the video is gone.
  it('puts the entry button in the always-open panel, not in the player controls', () => {
    const html = render();
    const controls = html.slice(html.indexOf('class="ltv-player-controls"'), html.indexOf('class="ltv-panelcol"'));
    expect(controls).not.toMatch(/data-fc="open"/);
    const panel = html.slice(html.indexOf('class="ltv-panelcol"'));
    expect(panel).toMatch(/data-fc="open"/);
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

  it('lists Channel Videos and adds My sessions (F366)', () => {
    seen.view = viewWith({ status: 'running' });
    const html = render();
    // The deck tabs only: the panel's own Claims and Transcript tabs (F366) are counted in FactCheckPanel.tabs.test.jsx.
    const tabs = html.match(/<button[^>]*role="tab"[^>]*class="ltv-tab-btn[^"]*"[^>]*>|<button[^>]*class="ltv-tab-btn[^"]*"[^>]*role="tab"[^>]*>/g) || [];
    expect(tabs).toHaveLength(2);
    expect(tabs.filter((t) => /tabindex="0"/.test(t))).toHaveLength(1);
  });
});

// F359: opening a desk from the page navigates once; the shell's navigation closes the page (the address
// changes), so the page must not also call onClose, which is "Back" and would navigate a second time.
describe('leaving the page', () => {
  it('has no Back button of its own (F387), and does not call onClose when opening a desk', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../LiveTvPage.jsx', import.meta.url), 'utf8');
    const fn = source.slice(source.indexOf('function handleOpenDesk'), source.indexOf('function handlePlayArchive'));
    expect(fn).toContain('onNavigateDesk(deskId, feature)');
    expect(fn).not.toContain('onClose');
    expect(source).not.toMatch(/onClick=\{onClose\}|ltv-back-btn/);
  });
});
