// F366: the page layout. The hook and the past-sessions section are replaced by recorders; their own
// behaviour is covered elsewhere. These pin where things are, not what they do.
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const seen = { view: null, choose: 0 };
vi.mock('./useFactCheck.js', () => ({
  useFactCheck: () => ({ view: seen.view, actions: { choose() { seen.choose += 1; }, cancel() {}, confirm() {}, stop() {}, retry() {}, dismiss() {} } }),
}));
vi.mock('./PastSessions.jsx', () => ({
  PastSessions: (props) => (props.enabled ? <section className="pst" data-status={props.sessionStatus} /> : null),
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
const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');
beforeEach(() => { seen.view = viewWith(); seen.choose = 0; });

describe('title row', () => {
  it('has Back, the title Live TV, the tagline and the status badge in the header', () => {
    const html = render();
    const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
    expect(header).toMatch(/onclick|Back/i);
    expect(header).toMatch(/<h2[^>]*class="ltv-title"[^>]*tabindex="-1"[^>]*>Live TV<\/h2>/);
    expect(text(header)).toContain('Watch and fact-check debates, speeches and bulletins as they happen.');
    expect(header).toMatch(/ltv-recent-badge|ltv-live-badge/);
  });
  it('does not mention fact-check in the tagline when the feature is not offered', () => {
    seen.view = viewWith({}, false);
    const html = render();
    expect(text(html)).toContain('Watch debates, speeches and bulletins as they happen.');
    expect(html).not.toMatch(/fact-check/i);
  });
});

describe('channel card', () => {
  it('sits above the video with TOP CHANNELS, SEGMENTS and segment counts', () => {
    const html = render();
    expect(html.indexOf('class="ltv-channelcard"')).toBeLessThan(html.indexOf('class="ltv-body'));
    expect(text(html)).toContain('SEGMENTS');
    expect(html).toMatch(/class="ltv-category-count">0</);
    expect(html.match(/class="ltv-category-pill/g)).toHaveLength(7);
  });
});

describe('panel column', () => {
  it('is there with no session when fact-check is available, beside the video, with the idle state', () => {
    const html = render();
    const split = html.indexOf('class="ltv-split has-panel"');
    expect(split).toBeGreaterThan(-1);
    expect(html.indexOf('class="ltv-videocol"')).toBeGreaterThan(split);
    expect(html.indexOf('class="ltv-panelcol"')).toBeGreaterThan(html.indexOf('class="ltv-videocol"'));
    expect(html.indexOf('class="ltv-panelcol"')).toBeLessThan(html.indexOf('class="ltv-deck-tabs"'));
    expect(html).toMatch(/fc-panel--idle/);
    expect(text(html)).toContain("Check what's being said");
    expect(text(html)).toContain('500 credits a minute, held up front. Unused whole minutes are returned.');
  });
  it('moves the start button from under the video into the panel (exactly once)', () => {
    const html = render();
    const controls = html.slice(html.indexOf('class="ltv-player-controls"'), html.indexOf('class="ltv-panelcol"'));
    expect(controls).not.toMatch(/data-fc="open"/);
    expect(html.match(/data-fc="open"/g)).toHaveLength(1);
  });
  it('shows the start screen inside the panel while it is open', () => {
    seen.view = viewWith({ status: 'choosing' });
    const html = render();
    expect(html.slice(html.indexOf('class="ltv-panelcol"'))).toMatch(/data-fc="confirm"/);
  });
  it('is absent, and the video takes the full width, when fact-check is not available', () => {
    seen.view = viewWith({}, false);
    const html = render();
    expect(html).not.toMatch(/ltv-panelcol|fc-panel/);
    expect(html).toMatch(/class="ltv-split"/);
    expect(html).not.toMatch(/has-panel/);
  });
  it('is absent before the flag is read (no view)', () => {
    seen.view = null;
    expect(render()).not.toMatch(/ltv-panelcol/);
  });
});

describe('now playing row', () => {
  it('is under the video with the tile, the title, the line and the action buttons', () => {
    const html = render();
    const col = html.slice(html.indexOf('class="ltv-videocol"'), html.indexOf('class="ltv-panelcol"'));
    const video = col.indexOf('ltv-video-container');
    const row = col.indexOf('class="ltv-nowplaying"');
    expect(row).toBeGreaterThan(video);
    const rowHtml = col.slice(row);
    expect(rowHtml).toMatch(/class="ltv-np-tile"/);
    expect(rowHtml).toMatch(/<h3>/);
    expect(rowHtml).toMatch(/ltv-np-line/);
    for (const label of ['Pause', 'Unmute', 'Fullscreen', 'Reload Feed']) expect(rowHtml).toContain(`>${label}<`);
  });
});

describe('lower tabs and My sessions', () => {
  it('adds My sessions as a fifth tab when available, with one tab stop, and keeps the old four', () => {
    const html = render();
    const tabs = html.match(/<button[^>]*role="tab"[^>]*>[^<]*/g) || [];
    expect(tabs).toHaveLength(5);
    expect(tabs.filter((t) => /tabindex="0"/.test(t))).toHaveLength(1);
    for (const id of ['schedule', 'videos', 'archive', 'transcript', 'sessions']) expect(html).toContain(`id="ltv-tab-${id}"`);
    expect(tabs[4]).toContain('My sessions');
  });
  it('has no My sessions tab when the feature is not available', () => {
    seen.view = viewWith({}, false);
    const html = render();
    expect(html.match(/<button[^>]*role="tab"[^>]*>/g)).toHaveLength(4);
    expect(html).not.toContain('My sessions');
  });
  it('holds the past sessions section inside the tab panel, hidden until the tab is chosen, and nowhere else', () => {
    const html = render();
    expect(html.match(/class="pst"/g)).toHaveLength(1);
    const panel = html.indexOf('id="ltv-tab-panel"');
    const pst = html.indexOf('<section class="pst"');
    expect(pst).toBeGreaterThan(panel);
    expect(html.slice(html.lastIndexOf('<div', pst), pst)).toMatch(/hidden/);
  });
  it('keeps the section gated by the flag and handing over the session status', () => {
    seen.view = viewWith({ status: 'ended' });
    expect(render()).toContain('data-status="ended"');
    seen.view = viewWith({}, false);
    expect(render()).not.toContain('class="pst"');
  });
});
