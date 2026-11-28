// F422: what the panel shows while a session is live: the empty state, the "Now hearing" line, the dot on the
// Transcript tab, the last-minute clock and the silence notice wording. Static markup, no network.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabaseClient.js', () => ({ supabase: {}, accessToken: async () => null, functionsUrl: () => '' }));
import { FactCheckPanel } from './FactCheckPanel.jsx';
import { LIMITS } from '../../lib/factcheck/session.js';
import { SILENT_NOTICE_MS } from './panelStatus.js';

const noop = () => {};
const claim = (id, verdict = 'supported') => ({
  id, quote: 'q', claim_en: `Claim ${id}`, kind: 'claim', status: 'checked', verdict, reason: `Reason ${id}`, sources: [], checked_at: null,
});
const lines = (n) => Array.from({ length: n }, (_, i) => ({ seq: i, text: `Spoken line ${i + 1}`, startMs: i * 10000 }));
const view = (session = {}) => ({
  flag: { available: true, creditsPerMinute: 500, userId: 'u' }, supported: true, ready: true, announcement: '', balance: 5000,
  session: {
    status: 'running', sessionId: 's', minutesBought: 5, creditsPerMinute: 500, creditsHeld: 2500, secondsLeft: 200,
    transcript: [], claims: [], silentFor: 0, skippedPieces: 0, droppedTurns: 0, budgetReached: false, final: null, endReason: null, error: null, ...session,
  },
});
const render = (v, props = {}) => renderToStaticMarkup(
  <FactCheckPanel view={v} persistent isMuted={false} onUnmute={noop} onConfirm={noop} onCancel={noop} onStop={noop} onRetry={noop} onDismiss={noop} onChoose={noop} {...props} />,
);
const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
const claimsPanel = (html) => html.slice(html.indexOf('id="fc-panel-claims"'), html.indexOf('id="fc-panel-transcript"'));

describe('the live empty state (running, no claims)', () => {
  it('says it is listening, explains the delay with the real constant and shows the newest four lines, newest last', () => {
    const panel = claimsPanel(render(view({ transcript: lines(6) })));
    expect(text(panel)).toContain('Listening to the video');
    expect(text(panel)).toContain('Claims appear here as they are checked. Speech shows about 14 seconds after it is said.');
    expect(panel).toMatch(/<p class="fc-live-head"><span class="fc-status--on fc-live-dot" aria-hidden="true"><span class="fc-dot">/);
    const shown = panel.match(/<p class="fc-live-text" dir="auto">[^<]*<\/p>/g).map((p) => text(p).trim());
    expect(shown).toEqual(['Spoken line 3', 'Spoken line 4', 'Spoken line 5', 'Spoken line 6']);
  });
  it('shows no verdict tiles and no "No claims yet."', () => {
    const panel = claimsPanel(render(view({ transcript: lines(2) })));
    expect(panel).not.toMatch(/fc-tile|Filter claims by verdict/);
    expect(text(panel)).not.toContain('No claims yet');
    expect(panel).not.toMatch(/fc-claims/);
  });
  it('with no transcript yet: the heading and the line only, no lines', () => {
    const panel = claimsPanel(render(view()));
    expect(text(panel)).toContain('Listening to the video');
    expect(panel).not.toContain('fc-live-text');
    expect(panel).not.toMatch(/fc-tile/);
  });
  it('has a Full transcript button and is not a live region', () => {
    const panel = claimsPanel(render(view({ transcript: lines(1) })));
    expect(panel).toMatch(/<button[^>]*data-fc="full-transcript"[^>]*>Full transcript<\/button>/);
    expect(panel).not.toMatch(/aria-live|role="status"|role="alert"|role="log"/);
  });
  it('is drawn while ending too', () => {
    expect(text(claimsPanel(render(view({ status: 'ending', transcript: lines(1) }))))).toContain('Listening to the video');
  });
  it('does not replace the ended and error views: tiles stay, "No claims were found." stays', () => {
    const ended = claimsPanel(render(view({ status: 'ended', endReason: 'time', final: { minutes_used: 1 }, transcript: lines(2) })));
    expect(ended).toMatch(/fc-tile/);
    expect(text(ended)).toContain('No claims were found.');
    expect(ended).not.toMatch(/Listening to the video|fc-now/);
  });
});

describe('the "Now hearing" line (running, at least one claim)', () => {
  it('is the first thing in the Claims panel body after the tiles, ahead of the first card, with the newest line only', () => {
    const panel = claimsPanel(render(view({ transcript: lines(3), claims: [claim('1'), claim('2')] })));
    expect(panel).toMatch(/<p class="fc-now-text" dir="auto"><span class="fc-now-label">Now hearing:<\/span> Spoken line 3<\/p>/);
    expect(panel).not.toContain('Spoken line 2');
    expect(panel.indexOf('fc-tiles')).toBeLessThan(panel.indexOf('fc-now'));
    expect(panel.indexOf('fc-now')).toBeLessThan(panel.indexOf('<ol'));
    expect(panel.indexOf('fc-now')).toBeLessThan(panel.indexOf('Claim 2'));
    expect(panel).toMatch(/<button[^>]*data-fc="full-transcript"[^>]*>Full transcript<\/button>/);
    expect(panel).not.toMatch(/aria-live|role="status"/);
    expect(panel).not.toContain('Listening to the video');
  });
  it('is not drawn without a transcript line, nor on an ended session', () => {
    expect(claimsPanel(render(view({ claims: [claim('1')] })))).not.toContain('fc-now');
    expect(claimsPanel(render(view({ status: 'ended', endReason: 'time', final: { minutes_used: 1 }, transcript: lines(2), claims: [claim('1')] })))).not.toContain('fc-now');
  });
});

describe('the dot on the Transcript tab', () => {
  const tab = (html) => html.match(/<button[^>]*id="fc-tab-transcript"[^>]*>[\s\S]*?<\/button>/)[0];
  it('is there while running and ending, hidden from assistive technology, so the tab is still named Transcript', () => {
    for (const status of ['running', 'ending']) {
      const t = tab(render(view({ status, transcript: lines(1), claims: [claim('1')] })));
      expect(t).toMatch(/<span class="fc-tab-dot" aria-hidden="true"><\/span>/);
      expect(text(t).trim()).toBe('Transcript');
    }
  });
  it('is absent when the session is not live', () => {
    expect(tab(render(view({ status: 'ended', endReason: 'time', final: { minutes_used: 1 }, claims: [claim('1')] })))).not.toContain('fc-tab-dot');
  });
  it('does not pulse until a line arrives (the pulse class is added by an arriving line: see the interaction test)', () => {
    expect(tab(render(view({ transcript: lines(2) })))).not.toContain('fc-tab-dot--pulse');
  });
  it('is dropped under prefers-reduced-motion and takes no width in the running row', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(new URL('./factCheck.css', import.meta.url), 'utf8');
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced.slice(0, reduced.indexOf('}\n}') + 1)).toMatch(/\.fc-tab-dot--pulse[^}]*animation:\s*none/);
    // The dot is absolutely placed inside the tab's 7px right padding: it adds no width to the running top row.
    expect(css).toMatch(/\.fc-tab-dot\s*\{[^}]*position:\s*absolute;[^}]*right:\s*1px;[^}]*width:\s*5px/);
    expect(css).toMatch(/\.fc-head--live \.fc-toprow \.fc-tab\s*\{[^}]*padding:\s*8px 7px/);
  });
});

describe('the last minute', () => {
  const clock = (html) => html.match(/<span class="(fc-clock[^"]*)">[^<]*<\/span>/);
  it('turns the clock low at 60 seconds in a five-minute block, not before', () => {
    expect(clock(render(view({ secondsLeft: 61 })))[1]).toBe('fc-clock');
    expect(clock(render(view({ secondsLeft: 60 })))[1]).toBe('fc-clock fc-clock--low');
    expect(clock(render(view({ secondsLeft: 5 })))[1]).toBe('fc-clock fc-clock--low');
  });
  it('turns it low only at 30 seconds in a one-minute block', () => {
    expect(clock(render(view({ minutesBought: 1, secondsLeft: 60 })))[1]).toBe('fc-clock');
    expect(clock(render(view({ minutesBought: 1, secondsLeft: 31 })))[1]).toBe('fc-clock');
    expect(clock(render(view({ minutesBought: 1, secondsLeft: 30 })))[1]).toBe('fc-clock fc-clock--low');
  });
  it('is amber and bold in the stylesheet', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(new URL('./factCheck.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.fc-clock--low\s*\{[^}]*color:\s*var\(--fc-amber\)[^}]*font-weight:\s*(700|800|900)/);
  });
  it('leaves "Finishing…" alone while ending', () => {
    expect(clock(render(view({ status: 'ending', secondsLeft: 10 })))[1]).toBe('fc-clock');
  });
});

describe('the silence notice', () => {
  const real = 'No speech heard for 30 seconds. The session ends by itself if this goes on for 90 seconds, and the time is still charged. Is the video muted or paused?';
  it('says how long, that it ends by itself, and that the time is charged, with the real constants', () => {
    expect(text(render(view({ silentFor: SILENT_NOTICE_MS + 1 })))).toContain(real);
    expect(text(render(view({ silentFor: SILENT_NOTICE_MS })))).not.toContain('No speech heard');
  });
  it('the wording follows the constants: it fails if the session limit or the notice threshold drifts from 30 and 90', () => {
    expect(SILENT_NOTICE_MS / 1000).toBe(30);
    expect(LIMITS.silentMs / 1000).toBe(90);
  });
});
