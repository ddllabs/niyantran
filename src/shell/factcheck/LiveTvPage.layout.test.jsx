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

describe('no header strip (F387)', () => {
  it('has no header, Back button, page title or tagline; the page starts with the channel card', () => {
    const html = render();
    expect(html).not.toMatch(/ltv-header|ltv-back-btn|ltv-title|ltv-tagline|<h2/);
    expect(text(html)).not.toContain('Watch debates, speeches and bulletins as they happen.');
    expect(html.indexOf('<section class="ltv-page"')).toBeLessThan(html.indexOf('class="ltv-main"'));
    expect(html.slice(html.indexOf('<section class="ltv-page"'), html.indexOf('class="ltv-main"'))).not.toMatch(/<header/);
  });
  it('shows the channel name, the focus target, with the status badge beside the player', () => {
    const html = render();
    const info = html.slice(html.indexOf('class="ltv-program-info"'), html.indexOf('class="ltv-np-line"'));
    expect(info).toMatch(/<h3 tabindex="-1">/);
    expect(info).toMatch(/class="ltv-np-badges"[\s\S]*(ltv-recent-badge|ltv-live-badge)/);
    expect(html.indexOf('class="ltv-video-container"')).toBeLessThan(html.indexOf('class="ltv-program-info"'));
  });
});

describe('the paste-a-link form (F387)', () => {
  const form = (html) => html.slice(html.indexOf('<form class="ltv-paste'), html.indexOf('</form>') + 7);
  it('is the top row of the fact-check panel, before its head, and the only copy', () => {
    const html = render();
    expect(html.match(/<form class="ltv-paste/g)).toHaveLength(1);
    const panel = html.slice(html.indexOf('class="ltv-panelcol"'), html.indexOf('class="ltv-deck-tabs"'));
    expect(panel).toContain('<form class="ltv-paste');
    expect(panel.indexOf('class="fc-linkslot"')).toBeLessThan(panel.indexOf('class="fc-head"'));
    expect(panel.indexOf('<form class="ltv-paste')).toBeLessThan(panel.indexOf('class="fc-head"'));
    expect(html).toContain('for="ltv-paste-input"');
    expect(form(html)).toContain('>Load video<');
  });
  it('stays at the top of the panel in the other states too, outside the scrolling body', () => {
    for (const status of ['choosing', 'running', 'ended', 'error']) {
      seen.view = viewWith({ status });
      const html = render();
      expect(html.match(/<form class="ltv-paste/g), status).toHaveLength(1);
      const panel = html.slice(html.indexOf('class="ltv-panelcol"'), html.indexOf('class="ltv-deck-tabs"'));
      expect(panel.indexOf('<form class="ltv-paste'), status).toBeLessThan(panel.indexOf('class="fc-head"'));
      expect(panel.indexOf('<form class="ltv-paste'), status).toBeLessThan(panel.indexOf('class="fc-body"') === -1 ? Infinity : panel.indexOf('class="fc-body"'));
    }
  });
  it('is in its own row above the video, not in the panel, where fact-check is not offered', () => {
    seen.view = viewWith({}, false);
    const html = render();
    expect(html.match(/<form class="ltv-paste/g)).toHaveLength(1);
    expect(html.indexOf('class="ltv-linkbar"')).toBeLessThan(html.indexOf('class="ltv-body'));
    expect(html.indexOf('<form class="ltv-paste')).toBeGreaterThan(html.indexOf('class="ltv-linkbar"'));
  });
});

describe('the lower area (F387)', () => {
  it('holds the tabs and their content, and nothing else of the page', () => {
    const html = render();
    const lower = html.indexOf('class="ltv-lower"');
    expect(lower).toBeGreaterThan(html.indexOf('class="ltv-split'));
    expect(lower).toBeLessThan(html.indexOf('class="ltv-deck-tabs"'));
    expect(html.indexOf('id="ltv-tab-panel"')).toBeGreaterThan(lower);
    expect(html.slice(lower)).not.toMatch(/ltv-player-stage|ltv-panelcol|ltv-nowplaying|ltv-paste/);
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
    // F382: in a static render the channel list is still loading, so the panel does not say "Nothing is playing".
    expect(text(html)).toContain("Check what's being said");
    expect(text(html)).not.toContain('Nothing is playing.');
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
    expect(rowHtml).toMatch(/<h3 tabindex="-1">/);
    expect(rowHtml).toMatch(/ltv-np-line/);
    for (const label of ['Pause', 'Unmute', 'Fullscreen', 'Reload Feed']) expect(rowHtml).toContain(`>${label}<`);
  });
});

describe('lower tabs and My sessions', () => {
  it('adds My sessions after Channel Videos when available, with one tab stop (empty schedule and archive are not listed)', () => {
    const html = render();
    const tabs = html.match(/<button[^>]*role="tab"[^>]*>[^<]*/g) || [];
    expect(tabs).toHaveLength(2);
    expect(tabs.filter((t) => /tabindex="0"/.test(t))).toHaveLength(1);
    for (const id of ['videos', 'sessions']) expect(html).toContain(`id="ltv-tab-${id}"`);
    for (const id of ['schedule', 'archive']) expect(html).not.toContain(`id="ltv-tab-${id}"`);
    expect(tabs[1]).toContain('My sessions');
    expect(html).not.toContain('id="ltv-tab-transcript"');
    expect(tabs.join('')).not.toMatch(/>Transcript/);
  });
  it('does not offer a Transcript tab under the player, while the fact-check panel keeps its own', () => {
    seen.view = viewWith({ status: 'running' });
    const html = render();
    const lower = html.slice(html.indexOf('aria-label="Live TV Modules"'), html.indexOf('id="ltv-tab-panel"'));
    expect(lower).toContain('id="ltv-tab-videos"');
    expect(lower).not.toMatch(/Transcript/);
    expect(html).not.toContain('id="ltv-tab-transcript"');
    expect(html.match(/role="tab"[^>]*>Transcript</g)).toHaveLength(1);
    expect(html).toMatch(/id="[^"]*-tab-transcript"/);
  });
  it('has no My sessions tab when the feature is not available', () => {
    seen.view = viewWith({}, false);
    const html = render();
    expect(html.match(/<button[^>]*role="tab"[^>]*>/g)).toHaveLength(1);
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
