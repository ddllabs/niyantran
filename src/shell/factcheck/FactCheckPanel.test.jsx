// F344 T6: every state of the fact-check panel, rendered from a fake session state. No network,
// no browser capture: the panel is a function of the view it is given.
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabaseClient.js', () => ({ supabase: {}, accessToken: async () => null, functionsUrl: () => '' }));
import { FactCheckEntry, FactCheckPanel } from './FactCheckPanel.jsx';

const sessionBase = {
  status: 'idle', sessionId: null, minutesBought: 0, creditsPerMinute: null, creditsHeld: null, secondsLeft: 0,
  transcript: [], claims: [], silentFor: 0, skippedPieces: 0, droppedTurns: 0, budgetReached: false, final: null, endReason: null, error: null,
};
const view = (session = {}, extra = {}) => ({
  flag: { available: true, creditsPerMinute: 500, userId: 'u1' },
  supported: true,
  ready: true,
  session: { ...sessionBase, ...session },
  announcement: '',
  balance: 10000,
  ...extra,
});
const claim = (over = {}) => ({
  id: 'c1', quote: 'q', claim_en: 'The tax rate is 18 percent', claimant: null, reported_by: null, kind: 'claim',
  status: 'checked', verdict: 'supported', reason: 'Official rate schedule agrees.',
  sources: [{ url: 'https://example.org/rates', title: 'Rate schedule' }], checked_at: '2026-11-15T10:20:00.000Z', ...over,
});
const render = (v, props = {}) => renderToStaticMarkup(
  <FactCheckPanel view={v} isMuted={false} onUnmute={() => {}} onConfirm={() => {}} onCancel={() => {}}
    onStop={() => {}} onRetry={() => {}} onDismiss={() => {}} {...props} />,
);
const entry = (v, playable = true) => renderToStaticMarkup(<FactCheckEntry view={v} playable={playable} onChoose={() => {}} />);
const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

describe('entry point', () => {
  it('renders a Fact-check button only when the flag is on and the browser is supported', () => {
    const html = entry(view());
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>[^<]*Fact-check/);
    expect(html).not.toMatch(/tabindex/);
    expect(html).toMatch(/id="fc-entry"/);
  });
  it('shows the per-minute price on the button', () => {
    expect(text(entry(view()))).toContain('Fact-check · 500 credits a minute');
  });
  it('offers no button while the player is paused or showing its error card; says why quietly', () => {
    const html = entry(view(), false);
    expect(html).not.toMatch(/<button/);
    expect(text(html)).toContain('Play the video to fact-check it');
  });
  it('the unsupported note wins over the play note', () => {
    expect(text(entry(view({}, { supported: false }), false))).toContain('available on Chrome on a computer');
  });
  it('shows a quiet note instead of the button on an unsupported browser', () => {
    const html = entry(view({}, { supported: false }));
    expect(html).not.toMatch(/<button/);
    expect(text(html)).toContain('Fact-check is available on Chrome on a computer');
  });
  it('renders nothing at all when the flag is off or not yet read', () => {
    expect(entry(view({}, { flag: { available: false, creditsPerMinute: null, userId: 'u1' } }))).toBe('');
    expect(entry(view({}, { supported: false, flag: { available: false, creditsPerMinute: null, userId: null } }))).toBe('');
  });
  it('renders nothing when there is no video playing to capture', () => {
    expect(entry(view({}, { ready: false }))).toBe('');
  });
  it('hides the button while a session is on screen', () => {
    for (const status of ['choosing', 'running', 'ended', 'error']) expect(entry(view({ status }))).toBe('');
  });
  it('the panel renders nothing when idle or when the flag is off', () => {
    expect(render(view())).toBe('');
    expect(render(view({ status: 'running' }, { flag: { available: false, creditsPerMinute: null, userId: null } }))).toBe('');
  });
});

describe('choosing a block', () => {
  it('lists 1, 2, 5, 10 and 15 minutes with prices and the balance', () => {
    const html = render(view({ status: 'choosing' }, { balance: 10000 }));
    const t = text(html);
    expect(t).toMatch(/1 minute\s*500 credits/);
    expect(t).not.toContain('1 minutes');
    expect(t).toMatch(/2 minutes\s*1,000 credits/);
    expect(t).toMatch(/5 minutes\s*2,500 credits/);
    expect(t).toMatch(/10 minutes\s*5,000 credits/);
    expect(t).toMatch(/15 minutes\s*7,500 credits/);
    expect(t).toContain('10,000');
    expect(html).toMatch(/aria-label="Fact-check"/);
  });
  it('disables options the balance cannot cover, with the reason', () => {
    const html = render(view({ status: 'choosing' }, { balance: 5000 }));
    const buttons = html.match(/<button[^>]*data-minutes="\d+"[^>]*>/g);
    expect(buttons).toHaveLength(5);
    for (const b of buttons.slice(0, 4)) expect(b).not.toMatch(/disabled/);
    expect(buttons[4]).toMatch(/disabled/);
    expect(text(html)).toMatch(/Needs 7,500 credits; you have 5,000/);
    expect(buttons[4]).not.toMatch(/style=/);
  });
  it('has Start and Cancel; Start names the selected block, and is disabled when nothing is affordable', () => {
    const html = render(view({ status: 'choosing' }, { balance: 10000 }));
    expect(text(html)).toContain('Start 5 minutes · 2,500 credits');
    expect(html).toMatch(/<button[^>]*data-fc="cancel"/);
    const poor = render(view({ status: 'choosing' }, { balance: 100 }));
    expect(poor).toMatch(/<button[^>]*data-fc="confirm"[^>]*disabled/);
  });
  it('starts on 5 minutes by default, or the longest shorter length the balance covers', () => {
    expect(text(render(view({ status: 'choosing' }, { balance: null })))).toContain('Start 5 minutes · 2,500 credits');
    expect(text(render(view({ status: 'choosing' }, { balance: 1200 })))).toContain('Start 2 minutes · 1,000 credits');
    expect(text(render(view({ status: 'choosing' }, { balance: 600 })))).toContain('Start 1 minute · 500 credits');
    expect(text(render(view({ status: 'choosing' }, { balance: 600 })))).not.toContain('Start 1 minutes');
  });
  it('says plainly what is held, charged and released, and that closing ends the session', () => {
    const t = text(render(view({ status: 'choosing' })));
    expect(t).toMatch(/ask to share this tab.s audio/i);
    expect(t).toMatch(/whole block is held from your credits when you start/i);
    expect(t).toMatch(/each minute that starts is charged in full, with a one-minute minimum/i);
    expect(t).toMatch(/silence counts as use/i);
    expect(t).toMatch(/unused whole minutes are released/i);
    expect(t).toMatch(/closing live tv ends the session/i);
    expect(t).toMatch(/must be unmuted/i);
  });
  it('shows a price-changed notice with the fresh price on the choose step', () => {
    const html = render(view({ status: 'choosing' }, { priceNotice: 'The price changed to 700 credits a minute. Review and start again.' }));
    expect(html).toMatch(/role="status"[^>]*>The price changed to 700 credits a minute/);
  });
  it('warns prominently when the player is muted and offers the unmute control', () => {
    const muted = render(view({ status: 'choosing' }), { isMuted: true });
    expect(muted).toMatch(/class="fc-warning"[^>]*role="alert"/);
    expect(text(muted)).toMatch(/video is muted/i);
    expect(muted).toMatch(/<button[^>]*data-fc="unmute"/);
    expect(text(muted)).toContain('Unmute and start 5 minutes · 2,500 credits');
    const open = render(view({ status: 'choosing' }), { isMuted: false });
    expect(open).not.toMatch(/data-fc="unmute"/);
    expect(open).not.toMatch(/fc-warning/);
  });
  it('does not claim a balance it could not read, and leaves options to the server', () => {
    const html = render(view({ status: 'choosing' }, { balance: null }));
    expect(text(html)).toMatch(/balance could not be read/i);
    expect(html.match(/<button[^>]*data-minutes="\d+"[^>]*>/g).some((b) => /disabled/.test(b))).toBe(false);
  });
  it('always carries the automated-verdict line', () => {
    expect(text(render(view({ status: 'choosing' })))).toMatch(/Verdicts are automated, may be wrong/i);
  });
});

describe('sharing and starting', () => {
  it('explains what to pick in the Chrome prompt and offers cancel', () => {
    const html = render(view({ status: 'sharing' }));
    expect(html).toMatch(/data-fc="cancel"[^>]*>Cancel</);
    expect(text(html)).toMatch(/This tab/);
    expect(text(html)).toMatch(/tab audio/i);
    expect(html).toMatch(/data-fc="cancel"/);
  });
  it('starting says the session is starting and warns that cancelling may still charge the minimum', () => {
    const html = render(view({ status: 'starting' }));
    expect(text(html)).toMatch(/Starting/);
    expect(html).toMatch(/data-fc="cancel"[^>]*>Stop \(one-minute minimum\)</);
    expect(text(html)).toMatch(/one-minute minimum/i);
    expect(html).toMatch(/data-fc="cancel"/);
  });
});

describe('running', () => {
  const running = (over = {}) => view({
    status: 'running', secondsLeft: 125, minutesBought: 5,
    transcript: [{ seq: 0, text: 'नमस्ते दोस्तों', startMs: 0 }, { seq: 1, text: 'Good evening', startMs: 9000 }],
    claims: [claim()], ...over,
  });
  it('shows time left, Stop, the transcript in the spoken language and a card', () => {
    const html = render(running());
    expect(text(html)).toContain('2:05');
    expect(html).toMatch(/<button[^>]*data-fc="stop"[^>]*>[^<]*Stop/);
    expect(text(html)).toContain('नमस्ते दोस्तों');
    expect(text(html)).toContain('Good evening');
    expect(text(html)).toContain('The tax rate is 18 percent');
  });
  it('is a labelled region and the transcript is not a live region', () => {
    const html = render(running());
    expect(html).toMatch(/<section[^>]*class="fc-panel[^"]*"[^>]*aria-label="Fact-check"/);
    const transcript = html.match(/<div[^>]*class="fc-transcript"[^>]*>/)[0];
    expect(transcript).toMatch(/aria-live="off"/);
    expect(transcript).toMatch(/tabindex="0"/);
  });
  it('says nothing was heard yet rather than inventing a transcript', () => {
    const t = text(render(running({ transcript: [], claims: [] })));
    expect(t).toMatch(/Listening/);
    expect(t).toContain('about 14 seconds');
    expect(t).not.toContain('13 seconds');
    expect(t).not.toContain('10 seconds');
    expect(t).toMatch(/No claims yet/);
  });
  describe('the listening line', () => {
    const lineCount = (html) => (html.match(/class="fc-listening"/g) || []).length;
    it('ends the transcript while running with lines, after the last line', () => {
      const html = render(running());
      expect(lineCount(html)).toBe(1);
      expect(html.indexOf('Good evening')).toBeLessThan(html.indexOf('fc-listening'));
      expect(html).toMatch(/<p class="fc-listening"[^>]*>Listening…<\/p>/);
      expect(html).toMatch(/<div[^>]*class="fc-transcript"[^>]*aria-live="off"/);
    });
    it('is hidden with no lines (the empty text covers that)', () => {
      expect(lineCount(render(running({ transcript: [], claims: [] })))).toBe(0);
    });
    it('is hidden while ending, ended or in error, though the transcript itself is shown', () => {
      for (const status of ['ending', 'ended', 'error']) {
        const html = render(running({ status, claims: [claim()] }));
        expect(text(html), status).toContain('Good evening');
        expect(lineCount(html), status).toBe(0);
      }
    });
    it('no transcript is rendered while choosing, sharing or starting', () => {
      for (const status of ['starting', 'sharing', 'choosing']) {
        const html = render(view({ status, transcript: running().session.transcript }));
        expect(html, status).not.toContain('fc-transcript');
        expect(lineCount(html), status).toBe(0);
      }
    });
    it('is hidden while the muted warning shows', () => {
      const muted = render(running(), { isMuted: true });
      expect(muted).toContain('data-fc="unmute"');
      expect(lineCount(muted)).toBe(0);
      expect(lineCount(render(running(), { isMuted: false }))).toBe(1);
    });
    it('is hidden while the silence notice shows', () => {
      expect(lineCount(render(running({ silentFor: 31000 })))).toBe(0);
      expect(lineCount(render(running({ silentFor: 30000 })))).toBe(1);
    });
  });
  it('shows the silence notice after 30 seconds, not before', () => {
    expect(text(render(running({ silentFor: 31000 })))).toContain('No speech heard. Is the video muted or paused?');
    expect(text(render(running({ silentFor: 30000 })))).not.toContain('No speech heard');
    expect(text(render(running({ silentFor: 5000 })))).not.toContain('No speech heard');
  });
  it('shows the gaps notice when pieces or turns were lost, never invented text', () => {
    const msg = 'Some audio could not be processed; the transcript has gaps';
    expect(text(render(running({ skippedPieces: 1 })))).toContain(msg);
    expect(text(render(running({ droppedTurns: 2 })))).toContain(msg);
    expect(text(render(running()))).not.toContain(msg);
    const html = render(running({ skippedPieces: 1 }));
    expect(html).not.toMatch(/\[gap\]|\.\.\.<\/p>/);
  });
  it('tells the user when the player is muted during a run and offers unmute', () => {
    const html = render(running(), { isMuted: true });
    expect(text(html)).toMatch(/video is muted/i);
    expect(html).toMatch(/data-fc="unmute"/);
  });
  it('ending disables Stop and says it is finishing', () => {
    const html = render(running({ status: 'ending' }));
    expect(text(html)).toMatch(/Finishing/);
    expect(html).toMatch(/<button[^>]*data-fc="stop"[^>]*disabled/);
  });
  it('shows the rate and the hold from the server start response', () => {
    expect(text(render(running({ creditsPerMinute: 500, creditsHeld: 2500 })))).toContain('500 credits a minute · 2,500 credits held');
    expect(text(render(running()))).not.toContain('credits a minute');
  });
  it('marks transcript lines, claims and reasons dir="auto"', () => {
    const html = render(running());
    expect(html).toMatch(/class="fc-line" dir="auto"/);
    expect(html).toMatch(/class="fc-claim" dir="auto"/);
    expect(html).toMatch(/class="fc-reason" dir="auto"/);
  });
  it('has the permanent automated-verdict line', () => {
    expect(text(render(running()))).toContain('Verdicts are automated, may be wrong');
  });
  it('announces new verdicts politely, in a live region separate from the transcript', () => {
    const html = render(running({}), {});
    const withNote = render({ ...running(), announcement: 'Supported: The tax rate is 18 percent' });
    const live = withNote.match(/<div[^>]*aria-live="polite"[^>]*>([^<]*)<\/div>/);
    expect(live).not.toBeNull();
    expect(live[1]).toBe('Supported: The tax rate is 18 percent');
    expect(html.match(/aria-live="polite"/g)).toHaveLength(1);
    // the transcript never sits inside the polite region
    expect(withNote).not.toMatch(/aria-live="polite"[^>]*>[^<]*<[^>]*fc-transcript/);
  });
});

describe('claim cards', () => {
  const cardFor = (c) => render(view({ status: 'running', claims: [c] }));
  it.each([
    ['supported', 'Supported'],
    ['contradicted', 'Contradicted'],
    ['partly_true', 'Partly true'],
    ['no_evidence', 'No evidence found'],
    ['opinion', 'Opinion'],
  ])('verdict %s is labelled "%s" in words and with an icon', (verdict, label) => {
    const html = cardFor(claim({ verdict }));
    expect(html).toMatch(new RegExp(`class="fc-badge fc-badge--${verdict}"[^>]*><span class="fc-glyph" aria-hidden="true">[^<]+</span> ${label}</span>`));
  });
  it('gives each verdict a different glyph so colour is never the only cue', () => {
    const glyphs = ['supported', 'contradicted', 'partly_true', 'no_evidence', 'opinion'].map((verdict) => (
      cardFor(claim({ verdict })).match(/class="fc-glyph" aria-hidden="true">([^<]+)</)[1]
    ));
    expect(new Set(glyphs).size).toBe(5);
  });
  it.each([
    ['pending', 'Checking…'],
    ['needs_context', 'Needs context, not checked'],
    ['not_checkable', 'Not checkable'],
    ['unchecked', 'Not checked'],
    ['error', 'Check failed'],
  ])('status %s reads "%s"', (status, label) => {
    const html = cardFor(claim({ status, verdict: null, reason: null, sources: [], checked_at: null }));
    expect(text(html)).toContain(label);
    expect(html).toMatch(new RegExp(`fc-badge--${status}`));
  });
  it('a checked claim with a verdict outside the five labels is a failed check, not a verdict', () => {
    const html = cardFor(claim({ verdict: 'mostly_false' }));
    expect(text(html)).toContain('Check failed');
    expect(text(html)).not.toContain('mostly_false');
  });
  it('labels unchecked opinions, predictions and questions by kind', () => {
    for (const [kind, word] of [['opinion', 'Opinion'], ['prediction', 'Prediction'], ['question', 'Question']]) {
      const html = cardFor(claim({ kind, status: 'not_checkable', verdict: null, reason: null, sources: [], checked_at: null }));
      expect(html).toMatch(new RegExp(`class="fc-kind">${word}<`));
      expect(text(html)).toContain('Not checkable');
    }
    expect(cardFor(claim({ kind: 'claim' }))).not.toMatch(/class="fc-kind"/);
  });
  it('shows claimant and reporter only when present', () => {
    const both = text(cardFor(claim({ claimant: 'Minister Rao', reported_by: 'Anchor Mehta' })));
    expect(both).toContain('Claim by Minister Rao');
    expect(both).toContain('reported by Anchor Mehta');
    const none = text(cardFor(claim()));
    expect(none).not.toMatch(/Claim by|reported by/);
    const onlyRep = text(cardFor(claim({ reported_by: 'Anchor Mehta' })));
    expect(onlyRep).toContain('reported by Anchor Mehta');
  });
  it('shows the reason, the check time and source links that open safely in a new tab', () => {
    const html = cardFor(claim({ sources: [
      { url: 'https://example.org/rates', title: 'Rate schedule' },
      { url: 'javascript:alert(1)', title: 'Bad' },
      { url: 'https://other.example/a?b=1&c=2', title: '' },
    ] }));
    expect(text(html)).toContain('Official rate schedule agrees.');
    expect(html).toMatch(/<time[^>]*dateTime="2026-11-15T10:20:00.000Z"|<time[^>]*datetime="2026-11-15T10:20:00.000Z"/i);
    expect(text(html)).toMatch(/Checked \d/);
    const links = html.match(/<a [^>]*>/g);
    expect(links).toHaveLength(2);
    for (const a of links) {
      expect(a).toMatch(/target="_blank"/);
      expect(a).toMatch(/rel="noopener noreferrer"/);
      expect(a).toMatch(/href="https:\/\//);
    }
    expect(html).not.toMatch(/javascript:/);
    expect(text(html)).toContain('Rate schedule');
    expect(text(html)).toContain('other.example');
  });
  it('escapes provider text', () => {
    const html = cardFor(claim({ claim_en: '<img src=x onerror=alert(1)>', reason: '<script>x</script>' }));
    expect(html).not.toMatch(/<img src=x/);
    expect(html).not.toMatch(/<script>/);
  });
});

describe('budget, switched off, orphan and honest statuses', () => {
  const BUDGET = 'The checking limit for this session was reached. The transcript continues; later claims are not checked.';
  it('shows the budget notice while running and in the ended summary, not otherwise', () => {
    expect(text(render(view({ status: 'running', budgetReached: true })))).toContain(BUDGET);
    expect(text(render(view({ status: 'ended', endReason: 'time', budgetReached: true })))).toContain(BUDGET);
    expect(text(render(view({ status: 'running' })))).not.toContain('checking limit');
  });
  it('explains the off end reason', () => {
    expect(text(render(view({ status: 'ended', endReason: 'off' })))).toContain('Fact-check was switched off. You were charged only for the time used.');
  });
  it('already_active with a session id offers to end that session', () => {
    const html = render(view({ status: 'error', error: { source: 'start', reason: 'already_active', status: 409, sessionId: 'other-1' } }));
    expect(text(html)).toContain('A fact-check session is already running on your account (perhaps in another tab).');
    expect(html).toMatch(/<button[^>]*data-fc="orphan"[^>]*>End that session</);
  });
  it('already_active without a session id has no end button', () => {
    const html = render(view({ status: 'error', error: { source: 'start', reason: 'already_active', status: 409 } }));
    expect(html).not.toMatch(/data-fc="orphan"/);
  });
  it('says so, and keeps the button, when ending that session failed', () => {
    const html = render(view({ status: 'error', error: { source: 'start', reason: 'already_active', status: 409, sessionId: 'o' } }, { orphanFailed: true }));
    expect(text(html)).toContain('Could not end that session. Try again.');
    expect(html).toMatch(/data-fc="orphan"/);
  });
  it('shows the settlement of the ended session on the choose step', () => {
    const html = render(view({ status: 'choosing' }, { orphanNotice: 'The other session was ended. Used 2 minutes, charged 1,000 credits.' }));
    expect(html).toMatch(/role="status"[^>]*>The other session was ended/);
  });
  it('a check that came back needs_context or not_checkable shows the honest labels', () => {
    const html = render(view({ status: 'running', claims: [
      claim({ id: 'a', status: 'needs_context', verdict: null, reason: 'Who is "he"?', sources: [], checked_at: '2026-11-15T10:20:00.000Z' }),
      claim({ id: 'b', status: 'not_checkable', verdict: null, reason: 'A prediction', sources: [], checked_at: '2026-11-15T10:20:00.000Z' }),
    ] }));
    expect(text(html)).toContain('Needs context, not checked');
    expect(text(html)).toContain('Not checkable');
    expect(html).not.toMatch(/fc-badge--supported/);
  });
});

describe('ended', () => {
  const ended = (endReason, over = {}) => view({
    status: 'ended', endReason, final: { minutes_used: 3, credits_charged: 1500, balance: 8500 },
    transcript: [{ seq: 0, text: 'Hello', startMs: 0 }], claims: [claim()], ...over,
  });
  it('shows minutes used, credits charged and the new balance, and keeps the transcript and cards', () => {
    const t = text(render(ended('user')));
    expect(t).toMatch(/3 minutes/);
    expect(t).toContain('1,500');
    expect(t).toContain('8,500');
    expect(t).toContain('Hello');
    expect(t).toContain('The tax rate is 18 percent');
  });
  it.each([
    ['time', /time is up/i],
    ['user', /you stopped/i],
    ['browser', /sharing ended in the browser/i],
    ['silent', /no speech for 90 seconds/i],
    ['channel_change', /channel or video changed/i],
    ['modal_close', /you left live tv\./i],
    ['server', /server ended the session/i],
  ])('explains end reason %s', (reason, pattern) => {
    expect(text(render(ended(reason)))).toMatch(pattern);
  });
  it('keeps the rate and hold in the ended summary', () => {
    expect(text(render(ended('time', { creditsPerMinute: 500, creditsHeld: 2500 })))).toContain('500 credits a minute · 2,500 credits held');
  });
  it('offers Close and starting a new session', () => {
    const html = render(ended('time'));
    expect(html).toMatch(/data-fc="dismiss"/);
    expect(html).toMatch(/data-fc="again"/);
  });
  it('has no Stop button', () => {
    expect(render(ended('time'))).not.toMatch(/data-fc="stop"/);
  });
});

describe('errors', () => {
  const errored = (error, over = {}) => view({ status: 'error', error, ...over });
  it('not enough credits states needed and available, and lets the user choose again', () => {
    const html = render(errored({ source: 'start', reason: 'insufficient', status: 402, needed: 7500, available: 2000 }));
    expect(text(html)).toMatch(/Not enough credits/);
    expect(text(html)).toContain('7,500');
    expect(text(html)).toContain('2,000');
    expect(html).toMatch(/data-fc="retry"/);
  });
  it('not allowed has no retry', () => {
    const html = render(errored({ source: 'start', reason: 'not_allowed', status: 403 }));
    expect(text(html)).toMatch(/not available for this account/i);
    expect(html).not.toMatch(/data-fc="retry"/);
    expect(html).toMatch(/data-fc="dismiss"/);
  });
  it('already running elsewhere (409)', () => {
    const html = render(errored({ source: 'start', reason: 'already_active', status: 409 }));
    expect(text(html)).toMatch(/already running/i);
    expect(html).toMatch(/data-fc="retry"/);
  });
  it('no audio in the shared tab', () => {
    const html = render(errored({ source: 'capture', reason: 'no_audio', status: 0 }));
    expect(text(html)).toMatch(/No audio was shared/);
    expect(text(html)).toMatch(/This tab/);
    expect(html).toMatch(/data-fc="retry"/);
  });
  it('sharing declined', () => {
    const html = render(errored({ source: 'capture', reason: 'denied', status: 0 }));
    expect(text(html)).toMatch(/Sharing was declined/);
    expect(html).toMatch(/data-fc="retry"/);
  });
  it('network and server failures', () => {
    expect(text(render(errored({ source: 'transcribe', reason: 'timeout', status: 0 })))).toMatch(/network/i);
    const server = render(errored({ source: 'extract', reason: 'server_error', status: 503 }));
    expect(text(server)).toMatch(/service had a problem/i);
    expect(server).toMatch(/data-fc="retry"/);
  });
  it('a start that got no answer warns that a minute may be charged and offers no immediate retry', () => {
    const html = render(errored({ source: 'start', reason: 'timeout', status: 0 }));
    expect(text(html)).toContain('The server did not answer. If the session started, one minute may be charged. Wait a few minutes before trying again.');
    expect(html).not.toMatch(/data-fc="retry"/);
  });
  it('price changed names the fresh price and lets the user review', () => {
    const html = render(errored({ source: 'start', reason: 'price_changed', status: 0, creditsPerMinute: 700 }));
    expect(text(html)).toContain('The price changed to 700 credits a minute. Review and start again.');
    expect(html).toMatch(/data-fc="retry"/);
  });
  it('signed out', () => {
    const html = render(errored({ source: 'start', reason: 'signed_out', status: 401 }));
    expect(text(html)).toMatch(/sign-in/i);
    expect(html).not.toMatch(/data-fc="retry"/);
  });
  it('shows a charge that happened, and keeps what was transcribed', () => {
    const html = render(errored({ source: 'transcribe', reason: 'network', status: 0 }, {
      final: { minutes_used: 2, credits_charged: 1000, balance: 9000 },
      transcript: [{ seq: 0, text: 'kept words', startMs: 0 }],
    }));
    const t = text(html);
    expect(t).toContain('1,000');
    expect(t).toContain('9,000');
    expect(t).toContain('kept words');
  });
  it('does not claim a charge when there was none', () => {
    expect(text(render(errored({ source: 'start', reason: 'network', status: 0 })))).not.toMatch(/Charged/);
  });
  it('a stop that could not be confirmed says so', () => {
    const t = text(render(errored({ source: 'stop', reason: 'network', status: 0 })));
    expect(t).toMatch(/could not confirm/i);
  });
});

describe('keyboard', () => {
  it('every control is a real button or link, none removed from the tab order', () => {
    const html = [
      render(view({ status: 'choosing' }), { isMuted: true }),
      render(view({ status: 'running', claims: [claim()] })),
      render(view({ status: 'ended', endReason: 'user', final: { minutes_used: 1, credits_charged: 500, balance: 1 } })),
    ].join('');
    expect(html.replace(/<h3[^>]*>/g, '')).not.toMatch(/tabindex="-1"/);
    expect(html).not.toMatch(/<div[^>]*onclick/i);
    for (const b of html.match(/<button[^>]*>/g)) expect(b).toMatch(/type="button"/);
  });
});

describe('focus and styles', () => {
  it('the heading can take focus when the panel opens', () => {
    expect(render(view({ status: 'choosing' }))).toMatch(/<h3 id="fc-title" class="fc-title" tabindex="-1">Fact-check<\/h3>/);
  });
  it('a disabled option keeps its reason at full opacity', () => {
    const css = readFileSync(new URL('./factCheck.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.fc-option:disabled\s*\{[^}]*opacity:\s*1/);
  });
});

describe('F349: no sources found', () => {
  const noSources = (over = {}) => claim({ status: 'error', verdict: null, reason: null, sources: [], checked_at: null, fail_reason: 'no_sources', ...over });
  const withRecheck = (c) => view({ status: 'ended', endReason: 'time', claims: [c] }, { flag: { available: true, creditsPerMinute: 500, recheckCredits: 100, userId: 'u1' } });
  it('reads "No sources found" with the one-line explanation, not "Check failed"', () => {
    const t = text(render(view({ status: 'ended', endReason: 'time', claims: [noSources()] })));
    expect(t).toContain('No sources found');
    expect(t).toContain('The check found an answer but no source to show for it, so no verdict is given.');
    expect(t).not.toContain('Check failed');
  });
  it('has a neutral look: its own class, not the failure look', () => {
    const html = render(view({ status: 'ended', endReason: 'time', claims: [noSources()] }));
    expect(html).toMatch(/fc-card--no_sources/);
    expect(html).not.toMatch(/fc-card--error|fc-badge--error/);
  });
  it('offers no Check again, even when re-checks are priced', () => {
    const html = render(withRecheck(noSources()));
    expect(html).not.toMatch(/data-fc="recheck"/);
    expect(text(html)).not.toMatch(/Check again/);
  });
  it('other failures keep "Check failed" and keep Check again', () => {
    for (const fail_reason of ['no_label', 'bad_label', 'label_conflict', null]) {
      const html = render(withRecheck(noSources({ fail_reason })));
      expect(text(html), String(fail_reason)).toContain('Check failed');
      expect(html, String(fail_reason)).toMatch(/data-fc="recheck"/);
      expect(text(html), String(fail_reason)).not.toContain('no source to show');
    }
  });
});

describe('F349: starting again is plainly a new paid session', () => {
  const ended = view({ status: 'ended', endReason: 'time', claims: [claim()] });
  it('the ended view says it is a new session, shows the price and that the list is cleared', () => {
    const html = render(ended);
    expect(html).toMatch(/<button[^>]*data-fc="again"[^>]*>Start a new session · from 500 credits</);
    expect(text(html)).toContain('A new session is charged separately and clears the claims above. You choose the length first.');
    expect(text(html)).not.toContain('Run again');
  });
  it('does not show the note after an error (there is no list to clear on a plain failure)', () => {
    const html = render(view({ status: 'error', error: { source: 'capture', reason: 'failed', status: 0 } }));
    expect(html).not.toMatch(/data-fc="again"/);
    expect(text(html)).not.toContain('clears the claims');
  });
});

describe('F349: consent facts and end reasons', () => {
  it('says the feature needs Chrome on a computer', () => {
    expect(text(render(view({ status: 'choosing' })))).toContain('Fact-check needs Chrome on a computer.');
  });
  it('a 409 settled shows the other-tab text; a plain server end the generic one', () => {
    expect(text(render(view({ status: 'ended', endReason: 'server', endDetail: 'settled' })))).toContain('This session was ended elsewhere: from another tab or window, or after a long pause.');
    expect(text(render(view({ status: 'ended', endReason: 'server', endDetail: null })))).toContain('The server ended the session.');
  });
  it('after two capture failures it explains and offers no Try again', () => {
    const e = { source: 'capture', reason: 'failed', status: 0 };
    const once = render(view({ status: 'error', error: e }, { captureFailures: 1 }));
    expect(once).toMatch(/data-fc="retry"/);
    const twice = render(view({ status: 'error', error: e }, { captureFailures: 2 }));
    expect(twice).not.toMatch(/data-fc="retry"/);
    expect(text(twice)).toContain('failed twice in a row');
    expect(twice).toMatch(/data-fc="dismiss"/);
  });
  it('a blocked capture is not worded as declining', () => {
    const t = text(render(view({ status: 'error', error: { source: 'capture', reason: 'blocked', status: 0 } })));
    expect(t).toContain('Your browser did not allow tab sharing.');
    expect(t).not.toContain('declined');
  });
});

describe('F349 review: the new-session button needs a known price', () => {
  const endedWith = (flag) => view({ status: 'ended', endReason: 'time', claims: [claim()] }, { flag });
  it.each([
    ['no price', { available: true, creditsPerMinute: null, userId: 'u1' }],
    ['price undefined', { available: true, userId: 'u1' }],
    ['price as text', { available: true, creditsPerMinute: '500', userId: 'u1' }],
  ])('%s: only Close, no button and no note', (_n, flag) => {
    const html = render(endedWith(flag));
    expect(html).not.toMatch(/data-fc="again"/);
    expect(text(html)).not.toContain('from 0 credits');
    expect(text(html)).not.toContain('A new session is charged');
    expect(html).toMatch(/data-fc="dismiss"/);
  });
  it('a known price still shows it', () => {
    expect(render(endedWith({ available: true, creditsPerMinute: 500, userId: 'u1' }))).toMatch(/data-fc="again"/);
  });
});
