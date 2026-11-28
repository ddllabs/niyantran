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


const claim = (id, verdict, status = 'checked') => ({ id, quote: 'q', claim_en: `Claim ${id}`, kind: 'claim', status, verdict, reason: 'r', sources: [], checked_at: null });
const videoPart = (html) => html.slice(html.indexOf('class="ltv-video-container"'), html.indexOf('class="ltv-nowplaying"'));

describe('over the video', () => {
  it('shows the Fact-check on pill and the newest verdict while a session runs', () => {
    seen.view = viewWith({ status: 'running', claims: [claim('1', 'supported'), claim('2', 'contradicted'), claim('3', null, 'pending')] });
    const video = videoPart(render());
    expect(video).toMatch(/class="ltv-fcpill/);
    expect(text(video)).toContain('Muted · not hearing'); // F422: a static render is muted, so the pill is the quiet one
    expect(video).toMatch(/class="ltv-claimstrip"/);
    expect(text(video)).toContain('Claim 2');
    expect(text(video)).not.toContain('Claim 3');
    expect(video).not.toMatch(/aria-live/);
    expect(video).toMatch(/data-fc="see-why"/);
  });
  it('shows the pill but no strip until a claim has a verdict', () => {
    seen.view = viewWith({ status: 'running', claims: [claim('3', null, 'pending')] });
    const video = videoPart(render());
    expect(video).toMatch(/class="ltv-fcpill/);
    expect(video).not.toMatch(/class="ltv-claimstrip"/);
  });
  it('shows neither when no session is running', () => {
    for (const status of ['idle', 'choosing', 'sharing', 'starting', 'ended', 'error']) {
      seen.view = viewWith({ status, claims: [claim('1', 'supported')] });
      const video = videoPart(render());
      expect(video).not.toContain('Fact-check on');
      expect(video).not.toContain('ltv-fcpill');
      expect(video).not.toMatch(/ltv-claimstrip|See why/);
    }
  });
  it('shows neither when fact-check is not available', () => {
    seen.view = viewWith({ status: 'running', claims: [claim('1', 'supported')] }, false);
    expect(videoPart(render())).not.toMatch(/Fact-check on|ltv-claimstrip/);
  });
  it('has no channel badge over the video (it would cover the player title bar)', () => {
    seen.view = viewWith({ status: 'running', claims: [claim('1', 'supported')] });
    expect(videoPart(render())).not.toMatch(/ltv-live-badge|ltv-recent-badge|ltv-offline-badge/);
  });
  it('uses the newest result of a re-checked claim', () => {
    seen.view = { ...viewWith({ status: 'running', claims: [claim('1', 'supported')] }), flag: { available: true, creditsPerMinute: 500, recheckCredits: 40, userId: 'u1' }, rechecks: { 1: { phase: 'idle', results: [claim('1b', 'opinion')] } } };
    expect(videoPart(render())).toMatch(/fc-badge--opinion/);
  });
});
