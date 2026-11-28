// F422: the panel's live behaviour that needs real effects (hookHarness.js): the Full transcript buttons, the pulse of
// the Transcript tab's dot, and the screen-reader announcements, each once. The children are not rendered.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { harness, elements } from '../hookHarness.js';

const say = vi.fn();
vi.mock('react', async (importOriginal) => ({ ...(await importOriginal()), ...harness.patch() }));
vi.mock('./announce.jsx', async (importOriginal) => ({ ...(await importOriginal()), createAnnouncer: () => ({ say, attach: () => () => {} }) }));
vi.mock('../../lib/supabaseClient.js', () => ({ supabase: {}, accessToken: async () => null, functionsUrl: () => '' }));
const { PanelBody, Claims } = await import('./FactCheckPanel.jsx');
const { RovingTabs } = await import('./FactCheckTabs.jsx');
const { endReasonText } = await import('./factCheckText.js');

const noop = () => {};
const claim = (id) => ({ id, quote: 'q', claim_en: `Claim ${id}`, kind: 'claim', status: 'checked', verdict: 'supported', reason: 'r', sources: [], checked_at: null });
const lines = (n) => Array.from({ length: n }, (_, i) => ({ seq: i, text: `Line ${i + 1}`, startMs: i * 1000 }));
const view = (session = {}) => ({
  flag: { available: true, creditsPerMinute: 500, recheckCredits: null, userId: 'u' }, supported: true, ready: true, announcement: '', balance: 1000, rechecks: {},
  session: { status: 'running', minutesBought: 5, secondsLeft: 200, creditsHeld: 2500, creditsPerMinute: 500, transcript: [], claims: [], silentFor: 0, skippedPieces: 0, droppedTurns: 0, budgetReached: false, final: null, endReason: null, error: null, ...session },
});
const props = (session) => ({ view: view(session), isMuted: false, onUnmute: noop, onConfirm: noop, onCancel: noop, onStop: noop, onRetry: noop, onDismiss: noop });
const find = (out, type) => [...elements(out)].find((e) => e.type === type);
const transcriptDot = (out) => find(out, RovingTabs).props.tabs.find((t) => t.id === 'transcript').dot;
const said = () => say.mock.calls.map((c) => c[0]);

const focus = vi.fn();
beforeEach(() => {
  harness.reset(); say.mockClear(); focus.mockClear();
  vi.useFakeTimers();
  globalThis.document = { getElementById: (id) => (id === 'fc-tab-transcript' ? { focus } : null), activeElement: null };
  globalThis.window = { matchMedia: () => ({ matches: false }) };
});
afterEach(() => { vi.useRealTimers(); delete globalThis.document; delete globalThis.window; });

describe('Full transcript', () => {
  it('switches to the Transcript tab and moves focus to its tab button, from the empty state and from the Now hearing line', () => {
    for (const session of [{ transcript: lines(2) }, { transcript: lines(2), claims: [claim('1')] }]) {
      harness.reset();
      let out = harness.render(PanelBody, props(session));
      expect(find(out, RovingTabs).props.active).toBe('claims');
      expect(find(out, Claims).props.live).toBe(true);
      find(out, Claims).props.onOpenTranscript();
      out = harness.render(PanelBody, props(session));
      expect(find(out, RovingTabs).props.active).toBe('transcript');
    }
    expect(focus).toHaveBeenCalledTimes(2);
  });
});

describe('the Transcript tab dot', () => {
  it('is there while live, with no pulse until a line arrives, then pulses and stops; a second line restarts it', () => {
    let out = harness.render(PanelBody, props({ transcript: lines(1) }));
    expect(transcriptDot(out)).toEqual({ pulse: false, tick: 0 });
    out = harness.render(PanelBody, props({ transcript: lines(2) }));
    expect(transcriptDot(out)).toEqual({ pulse: true, tick: 1 });
    vi.advanceTimersByTime(600);
    out = harness.render(PanelBody, props({ transcript: lines(3) }));
    expect(transcriptDot(out)).toEqual({ pulse: true, tick: 2 });
    vi.advanceTimersByTime(1300);
    out = harness.render(PanelBody, props({ transcript: lines(3) }));
    expect(transcriptDot(out).pulse).toBe(false);
  });
  it('is not there when the session is not live', () => {
    const out = harness.render(PanelBody, props({ status: 'ended', endReason: 'time', final: { minutes_used: 1 }, transcript: lines(2), claims: [claim('1')] }));
    expect(transcriptDot(out)).toBeNull();
  });
});

describe('announcements', () => {
  it('"Fact-check started" once when the session enters running, not on re-renders', () => {
    harness.render(PanelBody, props({ status: 'starting' }));
    expect(said()).toEqual([]);
    harness.render(PanelBody, props({ status: 'running' }));
    harness.render(PanelBody, props({ status: 'running', secondsLeft: 190 }));
    harness.render(PanelBody, props({ status: 'running', secondsLeft: 180 }));
    expect(said()).toEqual(['Fact-check started']);
  });
  it('"Listening: words are coming in" once, at the first transcript line only', () => {
    harness.render(PanelBody, props({ status: 'running' }));
    say.mockClear();
    harness.render(PanelBody, props({ transcript: lines(1) }));
    harness.render(PanelBody, props({ transcript: lines(2) }));
    harness.render(PanelBody, props({ transcript: lines(3) }));
    expect(said()).toEqual(['Listening: words are coming in']);
  });
  it('the last minute is announced once for a five-minute block', () => {
    harness.render(PanelBody, props({ secondsLeft: 61 }));
    say.mockClear();
    for (const left of [60, 59, 30, 5]) harness.render(PanelBody, props({ secondsLeft: left }));
    expect(said()).toEqual(['1 minute left in this block']);
  });
  it('a one-minute block is announced at 30 seconds, once, in seconds', () => {
    harness.render(PanelBody, props({ minutesBought: 1, secondsLeft: 60 }));
    harness.render(PanelBody, props({ minutesBought: 1, secondsLeft: 31 }));
    say.mockClear();
    for (const left of [30, 29, 3]) harness.render(PanelBody, props({ minutesBought: 1, secondsLeft: left }));
    expect(said()).toEqual(['30 seconds left in this block']);
  });
  it('"Fact-check ended" with the reason once when the session ends, never on mounting an ended view', () => {
    harness.render(PanelBody, props({ status: 'ended', endReason: 'user', final: { minutes_used: 1 } }));
    expect(said()).toEqual([]);
    harness.reset();
    harness.render(PanelBody, props({ status: 'running' }));
    say.mockClear();
    harness.render(PanelBody, props({ status: 'ending' }));
    harness.render(PanelBody, props({ status: 'ended', endReason: 'time', final: { minutes_used: 5 } }));
    harness.render(PanelBody, props({ status: 'ended', endReason: 'time', final: { minutes_used: 5 } }));
    expect(said()).toEqual([`Fact-check ended. ${endReasonText('time')}`]);
  });
  it('a new session in the same panel announces again', () => {
    harness.render(PanelBody, props({ status: 'running', transcript: lines(1) }));
    harness.render(PanelBody, props({ status: 'ended', endReason: 'time', final: { minutes_used: 1 }, transcript: lines(1) }));
    harness.render(PanelBody, props({ status: 'choosing' }));
    say.mockClear();
    harness.render(PanelBody, props({ status: 'running' }));
    harness.render(PanelBody, props({ status: 'running', transcript: lines(1) }));
    expect(said()).toEqual(['Fact-check started', 'Listening: words are coming in']);
  });
});
